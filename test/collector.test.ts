import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApi } from '../src/api.ts';
import { installCollector } from '../src/collector.ts';
import { capture } from '../src/core.ts';

const raw = { type: 'TypeError', message: 'products.map is not a function', kind: 'error' as const, source: '/demo.js' };
function errorTarget() {
  const target = new EventTarget(); Object.assign(globalThis, { window: target, location: { pathname: '/lab' } });
  return target;
}
function emit(target: EventTarget) {
  target.dispatchEvent(Object.assign(new Event('error'), { message: raw.message, error: new TypeError(raw.message), filename: 'https://example.test/demo.js?token=hidden', lineno: 10, colno: 4 }));
}
test('collector HTTP contract: sends sanitized payload; acknowledges only the response (fixture, no DB)', { timeout: 5000 }, async t => {
  const target = errorTarget(); let submitted: any; let authorization = '';
  const server = createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    submitted = JSON.parse(Buffer.concat(parts).toString()); authorization = req.headers.authorization || '';
    assert.equal(req.url, '/api/events'); assert.equal(req.method, 'POST');
    // Explicit transport fixture: never counted as persistence evidence.
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, data: { event: { ...submitted, id: submitted.eventId, fingerprint: 'f'.repeat(64), timestamp: 123, synthetic: false }, duplicate: false } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address() as { port: number }; const api = createApi({ baseUrl: `http://127.0.0.1:${address.port}`, token: 'fixture-token' });
  const result = new Promise<any>((resolve, reject) => { const cleanup = installCollector({ send: api.send, onCapture: resolve, onFailure: reject }); t.after(cleanup); });
  emit(target); const acknowledged = await result;
  assert.equal(submitted.source, '/demo.js'); assert.equal(submitted.page, '/lab');
  assert.equal(submitted.synthetic, undefined); assert.equal(submitted.fingerprint, undefined);
  assert.ok(Number.isSafeInteger(submitted.clientTimestamp)); assert.match(submitted.eventId, /^[a-f0-9-]{36}$/);
  assert.equal(authorization, 'Bearer fixture-token'); assert.equal(acknowledged.timestamp, 123);
});
test('failed submission and throwing failure callback never become a capture success or loop', { timeout: 5000 }, async t => {
  const target = errorTarget(); let sends = 0, captures = 0, failures = 0;
  const cleanup = installCollector({ send: async () => { sends++; throw new Error('API offline'); }, onCapture: () => { captures++; }, onFailure: () => { failures++; throw new Error('UI callback failed'); } });
  t.after(cleanup); emit(target); await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(sends, 1); assert.equal(captures, 0); assert.equal(failures, 1);
});
test('collector backpressure bounds in-flight sends and cleanup suppresses acknowledgements', { timeout: 5000 }, async t => {
  const target = errorTarget(); let sends = 0, captures = 0; const pending: Array<() => void> = [];
  const cleanup = installCollector({ send: event => { sends++; return new Promise(resolve => pending.push(() => resolve(event))); }, onCapture: () => { captures++; }, onFailure: () => {} });
  t.after(cleanup); for (let i = 0; i < 30; i++) emit(target);
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(sends, 10);
  cleanup(); pending.forEach(resolve => resolve()); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(captures, 0);
});
test('transport rejects an HTML fallback, API error, insecure remote URL and timeout', async () => {
  const event = await capture(raw);
  const html = createApi({ fetchImpl: async () => new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }) });
  await assert.rejects(html.send(event), /No DevTrace API/);
  const failure = createApi({ fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: { message: 'Database unavailable' } }), { status: 503, headers: { 'Content-Type': 'application/json' } }) });
  await assert.rejects(failure.send(event), /Database unavailable/);
  await assert.rejects(createApi({ baseUrl: 'http://remote.example' }).send(event), /HTTPS/);
  const timeout = createApi({ timeoutMs: 5, fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))) });
  await assert.rejects(timeout.send(event), /timed out/);
});
