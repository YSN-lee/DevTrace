export type Status = 'open' | 'resolved';
export type Kind = 'error' | 'unhandledrejection';
export type Mode = 'sample' | 'live';
export interface RawEvent { type: string; message: string; kind: Kind; stack?: string; source?: string; line?: number; column?: number; page?: string }
export interface TraceEvent extends RawEvent { id: string; fingerprint: string; timestamp: number; synthetic: boolean }
export interface Workspace { version: 1; createdAt: number; events: TraceEvent[]; statuses: Record<string, Status> }
export interface Issue { id: string; label: string; type: string; message: string; kind: Kind; source: string; count: number; firstSeen: number; lastSeen: number; status: Status; events: TraceEvent[]; recentTimestamps?: number[] }
export const MAX_EVENTS = 1000;
export const STORAGE_PREFIX = 'devtrace.browser.v1.';
export function emptyWorkspace(now = Date.now()): Workspace { return { version: 1, createdAt: now, events: [], statuses: {} }; }
export function cleanPath(value = ''): string {
  try { const u = new URL(value, 'https://demo.invalid'); return u.pathname.slice(0, 1024); } catch { return value.split(/[?#]/)[0].slice(0, 1024); }
}
export function redact(value: string, cap: number): string {
  return value.replace(/https?:\/\/[^\s)]+/g, v => { try { const u = new URL(v); return u.origin + u.pathname; } catch { return '[url]'; } })
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(token|password|api[_-]?key|secret)\s*[:=]\s*[^\s,;&]+/gi, '$1=[redacted]')
    .replace(/\r\n?/g, '\n').slice(0, cap);
}
export function sanitize(raw: RawEvent): RawEvent {
  if (!raw || typeof raw.message !== 'string' || !raw.message.trim() || typeof raw.type !== 'string') throw new Error('An error type and message are required.');
  if (!['error', 'unhandledrejection'].includes(raw.kind)) throw new Error('Unsupported event kind.');
  const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
  return { type: redact(raw.type, 64).trim() || 'Error', message: redact(raw.message, 1024).trim(), kind: raw.kind,
    stack: raw.stack ? redact(raw.stack, 8192) : undefined, source: raw.source ? cleanPath(raw.source) : undefined,
    page: raw.page ? cleanPath(raw.page) : undefined, line: integer(raw.line), column: integer(raw.column) };
}
export async function fingerprint(raw: RawEvent): Promise<string> {
  const r = sanitize(raw);
  const canonical = JSON.stringify([1, r.type, r.message, r.source ?? null, r.line ?? null, r.column ?? null]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}
export async function capture(raw: RawEvent, now = Date.now(), synthetic = false): Promise<TraceEvent> {
  const clean = sanitize(raw);
  return { ...clean, fingerprint: await fingerprint(clean), id: crypto.randomUUID(), timestamp: now, synthetic };
}
export function appendEvent(state: Workspace, event: TraceEvent): Workspace {
  const events = [...state.events, event].slice(-MAX_EVENTS);
  const fingerprints = new Set(events.map(e => e.fingerprint));
  const statuses = Object.fromEntries(Object.entries(state.statuses).filter(([id]) => fingerprints.has(id)));
  return { ...state, events, statuses };
}
export function changeStatus(state: Workspace, id: string, status: Status): Workspace {
  if (!['open', 'resolved'].includes(status) || !state.events.some(e => e.fingerprint === id)) return state;
  return { ...state, statuses: { ...state.statuses, [id]: status } };
}
export function groupIssues(state: Workspace, events = state.events): Issue[] {
  const groups = new Map<string, Issue>();
  for (const e of events) {
    let issue = groups.get(e.fingerprint);
    if (!issue) { issue = { id: e.fingerprint, label: 'DT-' + e.fingerprint.slice(0, 4).toUpperCase(), type: e.type, message: e.message, kind: e.kind, source: e.source || 'Source unavailable', count: 0, firstSeen: e.timestamp, lastSeen: e.timestamp, status: state.statuses[e.fingerprint] || 'open', events: [] }; groups.set(e.fingerprint, issue); }
    issue.count++; issue.firstSeen = Math.min(issue.firstSeen, e.timestamp); issue.lastSeen = Math.max(issue.lastSeen, e.timestamp); issue.events.push(e);
  }
  return [...groups.values()].map(i => ({ ...i, events: i.events.sort((a, b) => b.timestamp - a.timestamp) })).sort((a, b) => b.lastSeen - a.lastSeen || a.id.localeCompare(b.id));
}
export function histogram(events: Pick<TraceEvent, 'timestamp'>[], hours: number, now = Date.now(), bins = 48): number[] {
  const output = Array(bins).fill(0) as number[]; const start = now - hours * 3600000;
  for (const e of events) { if (e.timestamp < start || e.timestamp > now) continue; const i = Math.min(bins - 1, Math.floor((e.timestamp - start) / (hours * 3600000) * bins)); output[i]++; }
  return output;
}
export function parseWorkspace(text: string | null): Workspace | null {
  if (!text) return null;
  try {
    const d = JSON.parse(text);
    if (d.version !== 1 || !Array.isArray(d.events) || d.events.length > MAX_EVENTS || typeof d.createdAt !== 'number' || !Number.isFinite(d.createdAt)) return null;
    if (!d.events.every((e: TraceEvent) => e && typeof e.id === 'string' && typeof e.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(e.fingerprint) && typeof e.type === 'string' && typeof e.message === 'string' && ['error','unhandledrejection'].includes(e.kind) && Number.isFinite(e.timestamp) && typeof e.synthetic === 'boolean' && (e.stack === undefined || typeof e.stack === 'string') && (e.source === undefined || typeof e.source === 'string'))) return null;
    const statuses: Record<string, Status> = {};
    if (d.statuses && typeof d.statuses === 'object') for (const [id, value] of Object.entries(d.statuses)) if (/^[a-f0-9]{64}$/.test(id) && (value === 'open' || value === 'resolved')) statuses[id] = value;
    return { version: 1, createdAt: d.createdAt, events: d.events, statuses };
  } catch { return null; }
}
export async function sampleWorkspace(now = Date.now()): Promise<Workspace> {
  const samples: (RawEvent & { count: number; resolved?: boolean })[] = [
    { type: 'TypeError', message: "Cannot read properties of undefined (reading 'map')", source: '/src/components/ProductList.tsx', line: 42, column: 18, kind: 'error', count: 24 },
    { type: 'TypeError', message: 'Failed to fetch', source: '/src/api/products.ts', line: 18, column: 11, kind: 'unhandledrejection', count: 17 },
    { type: 'ReferenceError', message: 'cartTotal is not defined', source: '/src/components/Checkout.tsx', line: 67, column: 9, kind: 'error', count: 9 },
    { type: 'ChunkLoadError', message: 'Loading chunk 8 failed', source: '/src/routes/catalog.tsx', line: 12, column: 5, kind: 'unhandledrejection', count: 7, resolved: true },
    { type: 'RangeError', message: 'Invalid array length', source: '/src/utils/pagination.ts', line: 24, column: 12, kind: 'error', count: 5, resolved: true },
    { type: 'Error', message: 'Checkout request timed out', source: '/src/api/checkout.ts', line: 31, column: 7, kind: 'unhandledrejection', count: 14 }
  ];
  let state = emptyWorkspace(now);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const raw: RawEvent = { type: s.type, message: s.message, source: s.source, line: s.line, column: s.column, kind: s.kind, page: '/demo-store', stack: `${s.type}: ${s.message}\n    at ${i === 0 ? 'ProductList' : 'handleRequest'} (${s.source}:${s.line}:${s.column})\n    at renderWithHooks (/node_modules/react-dom/client.js:5529:22)\n    at updateFunctionComponent (/node_modules/react-dom/client.js:8897:19)\n    at beginWork (/node_modules/react-dom/client.js:10522:18)` };
    const fp = await fingerprint(raw);
    for (let j = 0; j < s.count; j++) state.events.push({ ...raw, id: crypto.randomUUID(), fingerprint: fp, timestamp: now - ((j * 113 + i * 61 + 3) % 1435) * 60000, synthetic: true });
    if (s.resolved) state.statuses[fp] = 'resolved';
  }
  return state;
}
