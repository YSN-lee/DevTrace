import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { connectDatabase } from '../server/models.js';
import { createApi } from '../src/api.ts';
import { installCollector } from '../src/collector.ts';

const configuredUri = process.env.TEST_MONGODB_URI;

test('real MongoDB integration — no mock database', { timeout: 60000, skip: !configuredUri ? 'Not Tested: set TEST_MONGODB_URI to a dedicated MongoDB 7+ instance.' : false }, async t => {
  const databaseName = 'devtrace_test_' + randomBytes(10).toString('hex');
  if (!/^mongodb(?:\+srv)?:\/\//.test(configuredUri)) throw new Error('TEST_MONGODB_URI must be a MongoDB URI.');
  const uri = configuredUri.replace(/^(mongodb(?:\+srv)?:\/\/[^/]+)(?:\/[^?]*)?/, '$1/' + databaseName);
  let db;
  try { db = await connectDatabase(uri); }
  catch { throw new Error('BLOCKED: MongoDB connection/index initialization failed before persistence assertions. Check TEST_MONGODB_URI and the running database.'); }
  let child;
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; }
  }
  t.after(async () => {
    await stop();
    // Only this freshly generated database is eligible for cleanup.
    assert.equal(db.connection.name, databaseName);
    assert.match(databaseName, /^devtrace_test_[a-f0-9]{20}$/);
    await db.connection.dropDatabase(); await db.connection.close();
  });
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const baseUrl = `http://127.0.0.1:${port}`;
  async function start() {
    child = spawn(process.execPath, ['server/index.js'], { cwd: new URL('..', import.meta.url), env: {
      ...process.env, MONGODB_URI: uri, HOST: '127.0.0.1', PORT: String(port), API_TOKEN: '',
      ALLOWED_ORIGINS: 'http://localhost:4173', ALLOWED_HOSTS: '127.0.0.1,localhost'
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('API startup timed out.')), 10000);
      child.once('error', () => { clearTimeout(timer); reject(new Error('API process could not start.')); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`API exited before readiness (${code}).`)); });
      child.stdout.on('data', chunk => { if (String(chunk).includes('API ready')) { clearTimeout(timer); resolve(); } });
      child.stderr.on('data', () => {});
    });
  }
  await start();
  const api = createApi({ baseUrl });
  const payload = () => ({ eventId: randomUUID(), clientTimestamp: 12345, type: 'TypeError', message: 'Cannot read products', kind: 'error', source: '/demo.js', line: 8, column: 4, stack: 'TypeError: Cannot read products\n at /demo.js:8:4', page: '/lab' });
  const post = body => fetch(baseUrl + '/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let first, issueId;

  await t.test('valid HTTP ingestion is visible in the actual MongoDB collection', async () => {
    assert.equal((await api.health()).database, 'connected');
    first = payload(); const response = await post(first); assert.equal(response.status, 201);
    const { data } = await response.json(); issueId = data.issueId;
    const row = await db.ErrorEvent.findOne({ eventId: first.eventId }).lean();
    assert.ok(row); assert.equal(row.fingerprint, issueId); assert.equal(row.message, first.message);
    assert.equal(await db.Issue.countDocuments({ fingerprint: issueId }), 1);
    assert.ok(row.timestamp > row.clientTimestamp);
  });
  await t.test('same id is idempotent; conflicting payload gets 409', async () => {
    assert.equal((await post(first)).status, 200);
    assert.equal((await post({ ...first, message: 'Different payload' })).status, 409);
    assert.equal(await db.ErrorEvent.countDocuments({ eventId: first.eventId }), 1);
  });
  await t.test('20 concurrent occurrences produce one issue and exactly 21 stored events', async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, () => post(payload())));
    assert.ok(responses.every(r => r.status === 201));
    const issue = await api.detail(issueId);
    assert.equal(issue.count, 21); assert.equal(issue.events.length, 20);
    assert.ok(issue.lastSeen >= issue.firstSeen);
    assert.equal(await db.ErrorEvent.countDocuments({ fingerprint: issueId }), 21);
    assert.equal(await db.Issue.countDocuments({ fingerprint: issueId }), 1);
  });
  await t.test('simultaneous retries of one new id produce only one occurrence', async () => {
    const retry = payload(); const results = await Promise.all(Array.from({ length: 8 }, () => post(retry)));
    assert.equal(results.filter(r => r.status === 201).length, 1);
    assert.ok(results.every(r => [200, 201].includes(r.status)));
    assert.equal((await api.detail(issueId)).count, 22);
  });
  await t.test('different source location creates a distinct issue; list stats and filters match records', async () => {
    const response = await post({ ...payload(), line: 99 }); const body = await response.json();
    assert.notEqual(body.data.issueId, issueId);
    const snapshot = await api.list({ range: 'all', status: 'all', kind: 'all', q: '', page: 1 });
    assert.equal(snapshot.summary.events, 23); assert.equal(snapshot.summary.issues, 2);
    assert.equal(snapshot.activity.reduce((sum, n) => sum + n, 0), 23);
    assert.equal(snapshot.pagination.total, 2); assert.equal(snapshot.recentEvents.length, 23);
    assert.ok(snapshot.recentEvents.every(e => e.synthetic === false && !('stack' in e)));
    const literal = await api.list({ range: 'all', status: 'all', kind: 'all', q: '[.*]', page: 1 });
    assert.equal(literal.pagination.total, 0);
  });
  await t.test('manual status persists across fresh fetch and recurring events', async () => {
    assert.equal((await api.updateStatus(issueId, 'resolved')).status, 'resolved');
    await post(payload());
    const freshApi = createApi({ baseUrl });
    assert.equal((await freshApi.detail(issueId)).status, 'resolved');
    assert.equal((await freshApi.detail(issueId)).count, 23);
    assert.equal((await db.Issue.findOne({ fingerprint: issueId }).lean()).status, 'resolved');
  });
  await t.test('new API process retrieves the same MongoDB events and status', async () => {
    await stop(); await start();
    const fresh = await createApi({ baseUrl }).detail(issueId);
    assert.equal(fresh.count, 23); assert.equal(fresh.status, 'resolved');
  });
  await t.test('EventTarget collector → actual HTTP → actual MongoDB (not a real browser)', async () => {
    const target = new EventTarget(); Object.assign(globalThis, { window: target, location: { pathname: '/integration' } });
    const received = new Promise((resolve, reject) => {
      const cleanup = installCollector({ send: api.send, onCapture: resolve, onFailure: reject }); t.after(cleanup);
    });
    target.dispatchEvent(Object.assign(new Event('error'), { message: 'Collector integration error', error: new TypeError('Collector integration error'), filename: 'https://demo.invalid/collector.js?token=private', lineno: 12, colno: 3 }));
    const stored = await received;
    const document = await db.ErrorEvent.findOne({ eventId: stored.id }).lean();
    assert.ok(document); assert.equal(document.source, '/collector.js'); assert.equal(document.page, '/integration');
    assert.equal((await api.detail(stored.fingerprint)).count, 1);
  });
  await t.test('stopped API produces client failure, not success', async () => {
    await stop(); await assert.rejects(api.detail(issueId), /unreachable/);
  });
});
