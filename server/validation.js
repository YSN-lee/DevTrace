import { createHash } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function redact(value, cap) {
  return value.replace(/https?:\/\/[^\s)]+/g, v => { try { const u = new URL(v); return u.origin + u.pathname; } catch { return '[url]'; } })
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(token|password|api[_-]?key|secret)\s*[:=]\s*[^\s,;&]+/gi, '$1=[redacted]')
    .replace(/\r\n?/g, '\n').slice(0, cap);
}
function cleanPath(value) {
  try { return new URL(value, 'https://demo.invalid').pathname.slice(0, 1024); }
  catch { return value.split(/[?#]/)[0].slice(0, 1024); }
}
function object(body, allowed) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(k => !allowed.includes(k)))
    throw new ApiError(400, 'INVALID_BODY', 'Provide a JSON object containing only documented fields.');
}
export function validateEvent(body) {
  object(body, ['eventId', 'clientTimestamp', 'type', 'message', 'kind', 'stack', 'source', 'line', 'column', 'page']);
  if (typeof body.eventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.eventId))
    throw new ApiError(400, 'INVALID_EVENT', 'eventId must be a UUID v4. Reuse it only when retrying the same event.');
  if (!['error', 'unhandledrejection'].includes(body.kind)) throw new ApiError(400, 'INVALID_EVENT', 'kind must be error or unhandledrejection.');
  for (const [key, cap] of Object.entries({ type: 64, message: 1024, stack: 8192, source: 1024, page: 1024 })) {
    const value = body[key];
    if (value === undefined && !['type', 'message'].includes(key)) continue;
    if (typeof value !== 'string' || value.length > cap || (['type', 'message'].includes(key) && !value.trim()))
      throw new ApiError(400, 'INVALID_EVENT', `${key} must be a string${['type','message'].includes(key) ? ' with content' : ''}, at most ${cap} characters.`);
  }
  for (const key of ['line', 'column', 'clientTimestamp']) if (body[key] !== undefined && (!Number.isSafeInteger(body[key]) || body[key] < 0))
    throw new ApiError(400, 'INVALID_EVENT', `${key} must be a nonnegative safe integer.`);
  const clean = { type: redact(body.type, 64).trim(), message: redact(body.message, 1024).trim(), kind: body.kind };
  for (const key of ['source', 'page']) if (body[key]) clean[key] = cleanPath(body[key]);
  if (body.stack) clean.stack = redact(body.stack, 8192);
  for (const key of ['line', 'column', 'clientTimestamp']) if (body[key] !== undefined) clean[key] = body[key];
  const canonical = JSON.stringify([1, clean.type, clean.message, clean.source ?? null, clean.line ?? null, clean.column ?? null]);
  const fingerprint = createHash('sha256').update(canonical).digest('hex');
  const payloadHash = createHash('sha256').update(JSON.stringify(clean)).digest('hex');
  return { ...clean, eventId: body.eventId.toLowerCase(), fingerprint, payloadHash };
}
export function validateId(id) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new ApiError(400, 'INVALID_ID', 'Issue id must be a 64-character lowercase SHA-256 fingerprint.');
  return id;
}
export function validateStatus(body) {
  object(body, ['status']);
  if (!['open', 'resolved'].includes(body.status)) throw new ApiError(400, 'INVALID_STATUS', 'status must be open or resolved.');
  return body.status;
}
export function validateQuery(query) {
  object(query, ['range', 'status', 'kind', 'q', 'page', 'limit']);
  const { range = '24', status = 'all', kind = 'all', q = '', page = '1', limit = '10' } = query;
  if (!['24', '168', 'all'].includes(range) || !['all', 'open', 'resolved'].includes(status) || !['all', 'error', 'unhandledrejection'].includes(kind) || typeof q !== 'string' || q.length > 80)
    throw new ApiError(400, 'INVALID_QUERY', 'Invalid range, status, kind or search query.');
  if (!/^[1-9]\d{0,4}$/.test(page) || !/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100)
    throw new ApiError(400, 'INVALID_QUERY', 'page must be 1–99999 and limit 1–100.');
  return { range, status, kind, q, page: Number(page), limit: Number(limit) };
}
