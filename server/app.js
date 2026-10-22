import express from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { ApiError, validateEvent, validateId, validateQuery, validateStatus } from './validation.js';

export function createApp({ repository, config, rateLimit = 120, rateWindowMs = 60_000 }) {
  const app = express(); app.disable('x-powered-by'); app.set('trust proxy', false);
  const arrivals = new Map();
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set({ 'X-Request-Id': req.requestId, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (!config.hosts.includes(req.hostname)) return next(new ApiError(403, 'HOST_NOT_ALLOWED', 'Request host is not allowed.'));
    const origin = req.get('origin');
    if (origin && !config.origins.includes(origin)) return next(new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.'));
    if (origin) { res.set('Access-Control-Allow-Origin', origin); res.vary('Origin'); }
    if (req.method === 'OPTIONS') {
      res.set({ 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' });
      return res.sendStatus(204);
    }
    if (req.path !== '/api/health' && config.token) {
      const provided = Buffer.from(req.get('authorization') || ''); const expected = Buffer.from('Bearer ' + config.token);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return next(new ApiError(401, 'UNAUTHORIZED', 'A valid API token is required.'));
    }
    const now = Date.now();
    for (const [key, value] of arrivals) if (value.reset <= now) arrivals.delete(key);
    const key = req.ip; const bucket = arrivals.get(key) || { count: 0, reset: now + rateWindowMs };
    if (!arrivals.has(key) && arrivals.size >= 10_000) return next(new ApiError(429, 'RATE_LIMITED', 'Request capacity reached. Try again later.'));
    bucket.count++; arrivals.set(key, bucket);
    if (bucket.count > rateLimit) { res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.reset - now) / 1000)))); return next(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again later.')); }
    next();
  });
  app.use((req, res, next) => {
    if (['POST', 'PATCH'].includes(req.method) && !req.is('application/json')) return next(new ApiError(415, 'JSON_REQUIRED', 'Content-Type must be application/json.'));
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true, inflate: false }));
  const send = (res, data, status = 200) => res.status(status).json({ ok: true, data });
  app.get('/api/health', async (req, res) => send(res, await repository.health()));
  app.post('/api/events', async (req, res) => { const result = await repository.ingest(validateEvent(req.body)); send(res, result, result.duplicate ? 200 : 201); });
  app.get('/api/issues', async (req, res) => send(res, await repository.list(validateQuery(req.query))));
  app.get('/api/issues/:id', async (req, res) => send(res, await repository.detail(validateId(req.params.id))));
  app.patch('/api/issues/:id', async (req, res) => { const id = validateId(req.params.id); const status = validateStatus(req.body); send(res, await repository.updateStatus(id, status)); });
  app.use((req, res, next) => next(new ApiError(404, 'NOT_FOUND', 'API route not found.')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = 500, code = 'INTERNAL_ERROR', message = 'The request could not be completed.';
    if (error instanceof ApiError) ({ status, code, message } = error);
    else if (error.type === 'entity.too.large') { status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'JSON payload must be at most 16 KiB.'; }
    else if (error.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; message = 'Request body is not valid JSON.'; }
    else if (error.status === 415) { status = 415; code = 'ENCODING_UNSUPPORTED'; message = 'Use uncompressed UTF-8 JSON.'; }
    else if (/Mongo|Mongoose/.test(error.name || '')) { status = 503; code = 'DATABASE_UNAVAILABLE'; message = 'The database request failed. Retry later; no local fallback is used.'; }
    // Never log a payload, token, Mongo URI or database exception message.
    if (status >= 500 && !(error instanceof ApiError)) console.error(JSON.stringify({ requestId: req.requestId, code }));
    res.status(status).json({ ok: false, error: { code, message, requestId: req.requestId } });
  });
  return app;
}
