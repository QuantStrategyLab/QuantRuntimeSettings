import assert from 'node:assert/strict';
import { createRotationProxy, canonicalRequest, bodyDigest } from '../web/strategy-switch-console/secretRotationGcp.js';
import { keyedDigest } from '../web/strategy-switch-console/secretRotationStepUp.js';
import { verifyRequest } from '../web/secret-rotation-proxy/hmac.js';
const now = () => Date.parse('2035-01-01T00:00:00.000Z');
const env = { CREDENTIAL_ROTATION_PROXY_URL: 'https://proxy.invalid', CREDENTIAL_ROTATION_HMAC_KEY_ID: 'synthetic', CREDENTIAL_ROTATION_HMAC_KEY: 'synthetic-hmac-material-000000000000' };
const sentinel = 'synthetic-write-only-value';
const opts = { now, nonce: () => 'synthetic-nonce-0001' };
const good = { ok: true, operation_id: 'synthetic-operation', state: 'staged', updated_at: new Date(now()).toISOString() };
let writes = 0;
const client = createRotationProxy(env, { ...opts, fetcher: async (url, options) => {
  writes++;
  assert.equal(options.redirect, 'error');
  assert.equal(options.signal instanceof AbortSignal, true);
  const request = new Request(url, options);
  const auth = verifyRequest(request, options.body, { synthetic: env.CREDENTIAL_ROTATION_HMAC_KEY }, now());
  assert.equal(auth.operationId, good.operation_id);
  for (const [key, replacement] of [['X-Rotation-Time', String(now() / 1000 - 301)], ['X-Rotation-Key', 'inactive'], ['X-Rotation-Signature', '0'.repeat(64)]]) {
    const bad = new Request(request.clone()); bad.headers.set(key, replacement);
    assert.throws(() => verifyRequest(bad, options.body, { synthetic: env.CREDENTIAL_ROTATION_HMAC_KEY }, now()));
  }
  assert.throws(() => verifyRequest(new Request('https://proxy.invalid/v1/operations/synthetic-other', options), options.body, { synthetic: env.CREDENTIAL_ROTATION_HMAC_KEY }, now()));
  assert.throws(() => verifyRequest(request, '{}', { synthetic: env.CREDENTIAL_ROTATION_HMAC_KEY }, now()));
  return Response.json(good);
} });
assert.deepEqual(await client('stage', good.operation_id, 'synthetic-request', sentinel), good);
assert.equal(writes, 1);
const canonical = canonicalRequest({ method: 'POST', path: '/v1/secrets/ibkr_flex/versions', timestamp: '2051222400', nonce: 'synthetic-nonce-0001', operationId: good.operation_id, requestId: 'synthetic-request', digest: await bodyDigest('{}') });
assert.equal(await keyedDigest(env.CREDENTIAL_ROTATION_HMAC_KEY, canonical), '5561ffdcbee01f55bdac1a4b4e016b21d2986199463d0d774e29d8418c059ebe');
for (const response of [() => Response.json({ ...good, value: sentinel }), () => Response.json({ ...good, state: 'success' }),
  () => Response.json({ ...good, updated_at: '2035-02-30T00:00:00.000Z' }), () => new Response('x'.repeat(4097)),
  () => new Response(sentinel, { status: 503 }), () => new Response(null, { status: 302, headers: { Location: 'https://elsewhere.invalid' } })]) {
  const bad = createRotationProxy(env, { ...opts, fetcher: async () => response() });
  await assert.rejects(bad('stage', good.operation_id, 'synthetic-request', sentinel), error => error.message === 'credential_rotation_unavailable' && !error.stack.includes(sentinel));
}
const timeout = createRotationProxy(env, { ...opts, timeoutMs: 1, fetcher: async (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error(sentinel)))) });
await assert.rejects(timeout('stage', good.operation_id, 'synthetic-request', sentinel), /credential_rotation_unavailable/);
for (const url of ['http://proxy.invalid', 'https://user:password@proxy.invalid', 'https://proxy.invalid/path']) assert.throws(() => createRotationProxy({ ...env, CREDENTIAL_ROTATION_PROXY_URL: url }));
console.log('credential rotation proxy client validation passed');
