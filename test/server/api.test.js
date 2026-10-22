import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { request as httpRequest } from 'node:http';
import { createApp } from '../../server/app.js';
import { createModels } from '../../server/models.js';
import { createRepository } from '../../server/repository.js';
import { readConfig } from '../../server/config.js';

// These tests use a real Express HTTP listener and a disconnected Mongoose
// connection. They verify guards and failure paths, NOT database persistence.
const valid = () => ({ eventId: randomUUID(), type: 'TypeError', message: 'products.map is not a function', kind: 'error', source: '/demo.js', line: 20, column: 8 });
async function fixture(options = {}) {
  const connection = mongoose.createConnection();
  const repository = createRepository({ connection, ...createModels(connection) });
  const app = createApp({ repository, config: readConfig(options.env || {}), ...options });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = 'http://127.0.0.1:' + server.address().port;
  const request = (path, body, headers = {}, method = 'POST') => fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return { url, request, close: async () => { await new Promise(resolve => server.close(resolve)); await connection.close(); } };
}

test('HTTP rejects invalid, unknown, malformed and oversized JSON before database work', async t => {
  const f = await fixture(); t.after(f.close);
  const cases = [
    [{}, 400, 'INVALID_EVENT'], [{ ...valid(), message: '' }, 400, 'INVALID_EVENT'],
    [{ ...valid(), message: 'x'.repeat(1025) }, 400, 'INVALID_EVENT'],
    [{ ...valid(), admin: true }, 400, 'INVALID_BODY'], ['{"bad":', 400, 'INVALID_JSON'],
    [{ ...valid(), stack: 'x'.repeat(18000) }, 413, 'PAYLOAD_TOO_LARGE']
  ];
  for (const [payload, status, code] of cases) {
    const response = await f.request('/api/events', payload); const body = await response.json();
    assert.equal(response.status, status); assert.equal(body.ok, false); assert.equal(body.error.code, code);
    assert.equal(body.error.requestId, response.headers.get('x-request-id'));
  }
  const wrongType = await f.request('/api/events', '{}', { 'Content-Type': 'text/plain' });
  assert.equal(wrongType.status, 415);
});

test('HTTP health and valid ingestion return honest 503 with disconnected MongoDB', async t => {
  const f = await fixture(); t.after(f.close);
  for (const [path, payload, method] of [['/api/health', undefined, 'GET'], ['/api/events', valid(), 'POST'], ['/api/issues', undefined, 'GET']]) {
    const response = await f.request(path, payload, {}, method); const body = await response.json();
    assert.equal(response.status, 503); assert.equal(body.ok, false); assert.equal(body.error.code, 'DATABASE_UNAVAILABLE');
    assert.ok(!JSON.stringify(body).includes('mongodb://'));
  }
});

test('HTTP validates issue ids, status, pagination and bounded literal search input', async t => {
  const f = await fixture(); t.after(f.close);
  const cases = [
    ['/api/issues/bad', undefined, 'GET'], ['/api/issues/' + 'a'.repeat(64), { status: 'deleted' }, 'PATCH'],
    ['/api/issues?limit=101', undefined, 'GET'], ['/api/issues?page=-1', undefined, 'GET'],
    ['/api/issues?q=' + 'a'.repeat(81), undefined, 'GET'], ['/api/issues?status[$ne]=resolved', undefined, 'GET']
  ];
  for (const [path, body, method] of cases) assert.equal((await f.request(path, body, {}, method)).status, 400);
  assert.equal((await f.request('/api/not-a-route', undefined, {}, 'GET')).status, 404);
});

test('HTTP CORS allowlist, host guard, bearer auth and security headers', async t => {
  const token = 'unit-test-token-with-more-than-32-characters';
  const f = await fixture({ env: { API_TOKEN: token } }); t.after(f.close);
  assert.equal((await f.request('/api/events', valid())).status, 401);
  assert.equal((await f.request('/api/events', valid(), { Authorization: 'Bearer bad' })).status, 401);
  assert.equal((await f.request('/api/events', valid(), { Origin: 'https://untrusted.invalid' })).status, 403);
  // Node fetch normalizes Host; raw HTTP is required to exercise rebinding protection.
  const badHost = await new Promise(resolve => {
    const request = httpRequest(f.url + '/api/health', { headers: { Host: 'untrusted.invalid' } }, response => { response.resume(); resolve(response.statusCode); });
    request.end();
  });
  assert.equal(badHost, 403);
  const allowed = await f.request('/api/events', valid(), { Origin: 'http://localhost:4173', Authorization: 'Bearer ' + token });
  assert.equal(allowed.status, 503); // Authorization succeeded; the actual DB is disconnected.
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:4173');
  assert.equal(allowed.headers.get('cache-control'), 'no-store');
  assert.equal(allowed.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(allowed.headers.get('x-powered-by'), null);
  const preflight = await f.request('/api/events', undefined, { Origin: 'http://localhost:4173' }, 'OPTIONS');
  assert.equal(preflight.status, 204); assert.match(preflight.headers.get('access-control-allow-methods'), /PATCH/);
});

test('HTTP rate limit returns 429 and a retry delay', async t => {
  const f = await fixture({ rateLimit: 2 }); t.after(f.close);
  await f.request('/api/events', valid()); await f.request('/api/events', valid());
  const response = await f.request('/api/events', valid());
  assert.equal(response.status, 429); assert.ok(Number(response.headers.get('retry-after')) > 0);
});

test('network binding refuses missing credentials and wildcard/insecure origins', () => {
  assert.throws(() => readConfig({ HOST: '0.0.0.0' }));
  assert.throws(() => readConfig({ API_TOKEN: 'short' }));
  assert.throws(() => readConfig({ ALLOWED_ORIGINS: '*' }));
  assert.throws(() => readConfig({ ALLOWED_ORIGINS: 'http://remote.example' }));
  assert.throws(() => readConfig({ ALLOWED_HOSTS: '*' }));
  assert.equal(readConfig({}).host, '127.0.0.1');
});
