import assert from 'node:assert/strict';
import { createProxyHandler } from '../web/secret-rotation-proxy/server.js';
import { createFirestoreStore } from '../web/secret-rotation-proxy/replayStore.js';
import { createSecretManager, googleTransport } from '../web/secret-rotation-proxy/secretManager.js';
import { createRotationProxy } from '../web/strategy-switch-console/secretRotationGcp.js';
const at = Date.parse('2035-01-01T00:00:00.000Z'); let clock = at;
const now = () => clock, documents = new Map(), calls = [], versions = new Map([['synthetic-old', 'ENABLED']]);
let tail = Promise.resolve(), failStore = false, failAfterDisable = false, addTimeout = false;
// Serializable shared fake, used by two independent handler instances.
const store = { run: callback => { const task = tail.then(async () => {
  if (failStore) throw Error('synthetic-provider-private-body');
  const changes = new Map();
  const result = await callback({ get: async key => structuredClone(documents.get(key) ?? null), put: (key, value) => changes.set(key, structuredClone(value)) });
  for (const [key, value] of changes) documents.set(key, value);
  return result;
}); tail = task.catch(() => {}); return task; } };
const manager = {
  async list() { calls.push('list'); return [...versions].map(([name, state]) => ({ name, state })); },
  async get(name) { calls.push('get:' + name); return { name, state: versions.get(name) }; },
  async add(value) { assert.equal(value, 'synthetic-new-value'); calls.push('add'); const name = 'synthetic-new-' + calls.filter(c => c === 'add').length; versions.set(name, 'ENABLED'); if (addTimeout) throw Error('synthetic-provider-private-body'); return { name, state: 'ENABLED' }; },
  async disable(name) { calls.push('disable:' + name); versions.set(name, 'DISABLED'); if (failAfterDisable) throw Error('synthetic-provider-private-body'); return { name, state: 'DISABLED' }; },
};
const env = { CREDENTIAL_ROTATION_PROXY_URL: 'https://proxy.invalid', CREDENTIAL_ROTATION_HMAC_KEY_ID: 'synthetic', CREDENTIAL_ROTATION_HMAC_KEY: 'synthetic-hmac-material-000000000000' };
const handlers = [1, 2].map(() => createProxyHandler({ keys: { synthetic: env.CREDENTIAL_ROTATION_HMAC_KEY }, store, manager, now }));
let index = 0, nonce = 0, captured;
const client = createRotationProxy(env, { now, nonce: () => `synthetic-nonce-${++nonce}`, fetcher: async (url, options) => { captured = [url, options]; return handlers[index++ % 2](new Request(url, options)); } });
assert.equal((await client('stage', 'synthetic-operation-1', 'synthetic-request-1', 'synthetic-new-value')).state, 'staged');
const wire = captured;
const race = await Promise.all(handlers.map(h => h(new Request(...wire))));
assert.ok(race.every(r => r.status === 200));
assert.equal(calls.filter(c => c === 'add').length, 1);
assert.equal(versions.get('synthetic-old'), 'ENABLED');
await assert.rejects(client('stage', 'synthetic-operation-1', 'synthetic-request-1', 'synthetic-changed-value'));
assert.equal((await client('finalize', 'synthetic-operation-1', 'synthetic-request-2')).state, 'finalized');
assert.equal(versions.get('synthetic-old'), 'DISABLED'); assert.equal(versions.get('synthetic-new-1'), 'ENABLED');
assert.equal((await client('finalize', 'synthetic-operation-1', 'synthetic-request-2')).state, 'finalized');
assert.equal(calls.filter(c => c.startsWith('disable:')).length, 1);
assert.equal((await client('stage', 'synthetic-operation-2', 'synthetic-request-3', 'synthetic-new-value')).state, 'staged');
failAfterDisable = true;
assert.equal((await client('cancel', 'synthetic-operation-2', 'synthetic-request-4')).state, 'cancel_unknown');
failAfterDisable = false;
assert.equal((await client('read', 'synthetic-operation-2')).state, 'canceled');
assert.equal(versions.get('synthetic-new-1'), 'ENABLED'); assert.equal(versions.get('synthetic-new-2'), 'DISABLED');
assert.equal(calls.filter(c => c === 'disable:synthetic-new-2').length, 1);
failStore = true;
await assert.rejects(client('stage', 'synthetic-operation-3', 'synthetic-request-5', 'synthetic-new-value'));
failStore = false;
assert.equal(calls.filter(c => c === 'add').length, 2);
addTimeout = true;
assert.equal((await client('stage', 'synthetic-operation-3', 'synthetic-request-5', 'synthetic-new-value')).state, 'add_unknown');
assert.equal((await client('read', 'synthetic-operation-3')).state, 'add_unknown');
assert.equal(calls.filter(c => c === 'add').length, 3);
for (const [, record] of documents) for (const forbidden of ['synthetic-new-value', 'synthetic-provider-private-body', 'new_value', 'signature', env.CREDENTIAL_ROTATION_HMAC_KEY]) assert.ok(!JSON.stringify(record).includes(forbidden));
const ttl = documents.get('nonces/synthetic_synthetic-nonce-1').expires_at;
assert.equal(Date.parse(ttl) - at, 600000);
clock += 300001;
assert.equal((await handlers[0](new Request(...wire))).status, 403);
clock = at;
const anonymous = () => new Request('https://proxy.invalid/v1/secrets/ibkr_flex/metadata', { headers: { 'Content-Type': 'application/json' } });
const denialLogs = [];
const anonymousHandler = createProxyHandler({ keys: { synthetic: env.CREDENTIAL_ROTATION_HMAC_KEY }, store, manager, now, onDenial: (...args) => denialLogs.push(args) });
for (let i = 0; i < 51; i++) { const denied = await anonymousHandler(anonymous()); assert.equal(denied.status, i < 50 ? 403 : 429); }
assert.deepEqual(denialLogs, [[]], 'anonymous auth logging receives no request context and is bounded');
const target = 'projects/synthetic-project/secrets/synthetic-credential', transportCalls = [];
const adapter = createSecretManager(target, { transport: async (url, options) => {
  transportCalls.push([url, options]);
  return url.includes('?') ? { versions: [{ name: target + '/versions/1', state: 'ENABLED' }] } : { name: target + '/versions/2', state: options?.body === '{}' ? 'DISABLED' : 'ENABLED' };
} });
assert.deepEqual(Object.keys(adapter).sort(), ['add', 'disable', 'get', 'list']);
await adapter.list(); await adapter.add('synthetic-new-value'); await adapter.get(target + '/versions/2'); await adapter.disable(target + '/versions/2');
for (const bad of ['projects/other/secrets/else/versions/1', target + '/versions/latest', target + '/versions/1:access']) await assert.rejects(adapter.get(bad));
assert.ok(transportCalls.every(([url]) => !/:access|:destroy|:enable/.test(url)));
// Exercise the actual REST transaction adapter and assert writes never include payload.
const rest = [];
const firestore = createFirestoreStore('projects/synthetic-project/databases/(default)', { transport: async (url, opts) => {
  rest.push([url, opts]);
  if (url.endsWith(':beginTransaction')) return { transaction: 'synthetic-transaction' };
  if (url.includes('?transaction=')) return null;
  return {};
} });
await firestore.run(async tx => { assert.equal(await tx.get('nonces/synthetic'), null); tx.put('nonces/synthetic', { expires_at: new Date(at + 600000).toISOString() }); });
const commit = JSON.parse(rest.find(([url]) => url.endsWith(':commit'))[1].body);
assert.equal(commit.transaction, 'synthetic-transaction');
assert.equal(commit.writes[0].update.fields.expires_at.timestampValue, new Date(at + 600000).toISOString());
let requests = 0;
const transport = googleTransport({ fetcher: async () => { requests++; throw Error('synthetic-provider-private-body'); } });
await assert.rejects(transport('https://secretmanager.googleapis.com/v1/synthetic'), error => !error.stack.includes('synthetic-provider-private-body'));
assert.equal(requests, 1);
console.log('secret rotation proxy validation passed');
