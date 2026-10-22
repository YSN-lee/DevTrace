import type { Issue, Status, TraceEvent } from './core.ts';

export interface Snapshot {
  items: Issue[];
  summary: { events: number; issues: number; open: number; resolved: number; lastSeen: number };
  activity: number[];
  recentEvents: TraceEvent[];
  eventsTruncated: boolean;
  pagination: { page: number; limit: number; total: number; pages: number };
  window: { from: number; to: number; hours: number };
  generatedAt: number;
}
export interface ListQuery { range: string; status: string; kind: string; q: string; page: number }
export function createApi({ baseUrl = '', token = '', fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const base = baseUrl.trim().replace(/\/$/, '');
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (base) {
      let url: URL; try { url = new URL(base); } catch { throw new Error('API URL must be a complete HTTPS URL.'); }
      if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))))
        throw new Error('Use HTTPS for remote APIs, or HTTP on localhost. Keep credentials out of the URL.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    try {
      const response = await fetchImpl(base + '/api' + path, { ...options, signal,
        credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
      if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('No DevTrace API responded. Start the local backend or connect an external HTTPS API.');
      const body = await response.json();
      if (!response.ok || body.ok !== true) throw new Error(body.error?.message || `API request failed (${response.status}).`);
      return body.data as T;
    } catch (error) {
      if (signal.aborted) throw new Error('API request timed out or was cancelled. Delivery is not confirmed.');
      if (error instanceof TypeError) throw new Error('API unreachable. Check the backend, URL and allowed origin.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  return {
    health: (signal?: AbortSignal) => request<{ status: string; database: string; storage: string }>('/health', { signal }),
    list: (query: ListQuery, signal?: AbortSignal) => request<Snapshot>('/issues?' + new URLSearchParams({ ...query, page: String(query.page), limit: '10' }), { signal }),
    detail: (id: string, signal?: AbortSignal) => request<Issue>('/issues/' + encodeURIComponent(id), { signal }),
    updateStatus: (id: string, status: Status) => request<Issue>('/issues/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status }) }),
    async send(event: TraceEvent): Promise<TraceEvent> {
      const { id, timestamp, fingerprint: _fingerprint, synthetic: _synthetic, ...raw } = event;
      const result = await request<{ event: TraceEvent; issueId: string; duplicate: boolean }>('/events', {
        method: 'POST', body: JSON.stringify({ ...raw, eventId: id, clientTimestamp: timestamp })
      });
      return result.event;
    }
  };
}
