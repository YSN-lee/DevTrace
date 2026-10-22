import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateEvent } from '../../server/validation.js';
import { fingerprint, sanitize } from '../../src/core.ts';

const base = { eventId: randomUUID(), type: 'TypeError', message: 'Cannot read products', kind: 'error', source: 'https://demo.test/app.js', line: 42, column: 9 };
test('server and collector agree on canonical SHA-256 identity across normalized inputs', async () => {
  for (const event of [base, { ...base, message: '  Cannot read products\r\n ', source: 'https://demo.test/app.js?token=private#section' }, { ...base, source: undefined, line: undefined, column: undefined }, { ...base, message: 'email=user@example.com password=secret Bearer credential' }]) {
    const result = validateEvent(event);
    assert.equal(result.fingerprint, await fingerprint(event));
    assert.equal(result.message, sanitize(event).message);
  }
});
test('server preserves meaningful message numbers and distinguishes source positions', () => {
  const a = validateEvent({ ...base, message: 'Request failed: 401' });
  const b = validateEvent({ ...base, message: 'Request failed: 500' });
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.notEqual(validateEvent(base).fingerprint, validateEvent({ ...base, line: 43 }).fingerprint);
});
test('server strips secrets from error content and rejects non-scalar injection', () => {
  const clean = validateEvent({ ...base, message: 'user@example.com api_key=secret', stack: 'https://user:pass@demo.test/a.js?secret=value#fragment', page: '/checkout?token=x' });
  assert.equal(clean.message, '[email] api_key=[redacted]');
  assert.equal(clean.stack, 'https://demo.test/a.js'); assert.equal(clean.page, '/checkout');
  assert.throws(() => validateEvent({ ...base, message: { $ne: null } }));
  assert.throws(() => validateEvent({ ...base, line: 1.1 }));
  assert.throws(() => validateEvent({ ...base, clientTimestamp: -1 }));
  assert.throws(() => validateEvent({ ...base, eventId: 'not-a-uuid' }));
});
