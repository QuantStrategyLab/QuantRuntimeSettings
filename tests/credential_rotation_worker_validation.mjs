import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js';
import { __test } from '../web/strategy-switch-console/worker.js';
import { totp, keyedDigest, factorCandidates, rotationConfig } from '../web/strategy-switch-console/secretRotationStepUp.js';
const require = createRequire(new URL('../web/strategy-switch-console/package.json', import.meta.url));
const { Miniflare } = require('miniflare');
const at = Date.parse('2035-01-01T00:00:00.000Z'), expiry = '2035-04-01T00:00:00.000Z';
const seed = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', key = 'synthetic-fingerprint-key-0000000000';
const codes = Array.from({ length: 30 }, (_, n) => `synthetic-recovery-${n}`);
const bindings = { SESSION_SECRET: 'synthetic-rotation-session', STRATEGY_SWITCH_ADMIN_LOGINS: 'synthetic-owner,synthetic-admin', ALLOWED_GITHUB_LOGINS: 'synthetic-reader',
  CREDENTIAL_ROTATION_OWNER: 'synthetic-owner', CREDENTIAL_ROTATION_TOTP_SEED: seed, CREDENTIAL_ROTATION_FINGERPRINT_KEY: key,
  CREDENTIAL_ROTATION_RECOVERY_VERIFIERS: JSON.stringify(await Promise.all(codes.map(code => keyedDigest(key, 'recovery:' + code)))),
  CREDENTIAL_ROTATION_HMAC_KEY_ID: 'synthetic', CREDENTIAL_ROTATION_HMAC_KEY: 'synthetic-hmac-material-000000000000', CREDENTIAL_ROTATION_PROXY_URL: 'https://proxy.invalid' };
const actualNow = Date.now;
Date.now = () => at;
let owner, admin, reader;
try { [owner, admin, reader] = await Promise.all(['synthetic-owner', 'synthetic-admin', 'synthetic-reader'].map(async login => 'qsl_switch_session=' + await __test.makeSession(login, [], bindings))); }
finally { Date.now = actualNow; }
assert.equal(await totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1), '287082', 'RFC 6238 vector truncated to six digits');
const config = rotationConfig(bindings), step = Math.floor(at / 30000);
for (const offset of [-1, 0, 1]) assert.equal((await factorCandidates(config, { method: 'totp', code: await totp(seed, step + offset) }, at)).length, 1);
assert.equal((await factorCandidates(config, { method: 'totp', code: await totp(seed, step - 2) }, at)).length, 0);
const persist = await mkdtemp(join(tmpdir(), 'qrs-rotation-'));
const frontendBundle = join(persist, 'frontend.cjs');
await build({
  stdin: {
    resolveDir: fileURLToPath(new URL('../web/strategy-switch-console/frontend/', import.meta.url)),
    contents: `export * from './src/api/endpoints'; export * from './src/api/client';
      export { loadAuditEvents, MutationOutcomeUnknown } from './src/api/cockpit';`,
  },
  bundle: true, platform: 'node', format: 'cjs', outfile: frontendBundle,
  define: { 'import.meta.env': '{}' }, logLevel: 'silent',
});
const frontend = require(frontendBundle);
const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
let invalidations = 0;
globalThis.window = { dispatchEvent: () => { invalidations++; } };
async function withResponse(value, status, callback) {
  globalThis.fetch = async () => Response.json(value, { status });
  try { return await callback(); } finally { globalThis.fetch = originalFetch; }
}
const scriptPath = fileURLToPath(new URL('../web/strategy-switch-console/worker.js', import.meta.url));
const original = await readFile(scriptPath, 'utf8');
const script = original.replace('session: readSession, command: runtimeInstanceCommand,', 'session: readSession, command: runtimeInstanceCommand, now: () => Date.now() + Number(request.headers.get("X-Synthetic-Offset") || 0),') + `
Date.now = () => ${at};
export class SyntheticRotationInstances extends RuntimeInstances {
  async fetch(request) {
    const c = request.method === 'POST' ? await request.clone().json() : {};
    if (c.action === 'fixture_revision') { this.sql.exec("INSERT INTO credential_maintenance_metadata VALUES ('ibkr_flex', 10, '2035-06-01T00:00:00.000Z', NULL) ON CONFLICT(id) DO UPDATE SET revision=revision+1, expires_at='2035-06-01T00:00:00.000Z'"); return Response.json({}); }
    if (c.action === 'fixture_abort') { this.sql.exec("CREATE TRIGGER rotation_abort BEFORE UPDATE ON credential_rotation_operations BEGIN SELECT RAISE(ABORT, 'synthetic fault'); END"); return Response.json({}); }
    if (c.action === 'fixture_clear') { this.sql.exec('DROP TRIGGER IF EXISTS rotation_abort'); return Response.json({}); }
    if (c.action === 'fixture_snapshot') return Response.json(Object.fromEntries(['credential_rotation_operations','credential_rotation_requests','credential_rotation_factors','credential_rotation_audit'].map(table => [table,this.sql.exec('SELECT * FROM '+table).toArray()])));
    return super.fetch(request);
  }
}`;
let writes = [], reads = 0, mode = 'normal', onProxy;
const proxyStates = new Map();
const options = {
  cf: false,
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], scriptPath, script,
  compatibilityDate: '2026-06-08', bindings, kvNamespaces: ['STRATEGY_SWITCH_CONFIG'],
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: 'SyntheticRotationInstances', useSQLite: true } }, durableObjectsPersist: persist,
  outboundService: async request => {
    const url = new URL(request.url), operation = request.headers.get('X-Rotation-Operation');
    if (request.method === 'GET') { reads++; return Response.json({ ok: true, operation_id: operation, state: proxyStates.get(operation) || 'add_unknown', updated_at: new Date(at).toISOString() }); }
    const action = url.pathname.endsWith('/versions') ? 'stage' : url.pathname.split('/').at(-1);
    writes.push(action);
    if (action === 'stage') assert.equal((await request.json()).new_value, 'synthetic-write-only-value');
    proxyStates.set(operation, { stage: 'staged', finalize: 'finalized', cancel: 'canceled' }[action]);
    if (onProxy) await onProxy();
    if (mode === 'unknown') return new Response('synthetic-private-provider-response', { status: 503 });
    return Response.json({ ok: true, operation_id: operation, state: proxyStates.get(operation), updated_at: new Date(at).toISOString() });
  },
};
let mf = new Miniflare(options), stub;
async function start() { const ns = await mf.getDurableObjectNamespace('STRATEGY_SWITCH_RUNTIME_INSTANCES'); stub = ns.get(ns.idFromName('runtime-instances')); }
await start();
const fixture = action => stub.fetch('https://internal/', { method: 'POST', body: JSON.stringify({ action }) });
let sequence = 0;
const factor = () => ({ method: 'recovery', code: codes[sequence++] });
const body = (step_up = factor()) => ({ request_id: `synthetic-request-${sequence}-${writes.length}`, new_value: 'synthetic-write-only-value', expires_at: expiry, step_up });
const root = '/api/credential-rotation/ibkr_flex';
async function call(path = root, payload, cookie = owner, origin = 'https://console.example', extra = {}) {
  const response = await mf.dispatchFetch('https://console.example' + path, { method: payload === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookie, ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json', ...extra },
    ...(payload === undefined ? {} : { body: typeof payload === 'string' ? payload : JSON.stringify(payload) }) });
  const value = await response.json();
  for (const sentinel of ['synthetic-write-only-value','synthetic-private-provider-response',seed,key, ...codes]) assert.ok(!JSON.stringify(value).includes(sentinel), 'response must exclude sensitive synthetic input');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  if (value.schema_version === 'qsl.credential_rotation.v1') {
    assert.deepEqual(await withResponse(value, response.status, () => frontend.loadCredentialRotation()), value,
      'actual backend envelope must survive the real frontend adapter');
  }
  if (value.schema_version === 'qsl.audit_events.v1') {
    const parsed = await withResponse(value, response.status, () => frontend.loadAuditEvents());
    assert.equal(parsed.status, 'ready');
    assert.deepEqual(parsed.data.map(e => e.event_id), value.events.map(e => e.event_id || e.id));
    for (const event of value.events.filter(e => e.event_id))
      assert.equal(parsed.data.find(e => e.event_id === event.event_id).operation_id, event.operation_id);
  }
  return { status: response.status, value };
}
const operationPath = op => root + '/operations/' + op;
try {
  assert.equal((await call(root, undefined, '')).status, 401);
  assert.deepEqual((await call(root, undefined, reader)).value.allowed_actions, []);
  assert.deepEqual((await call()).value.metadata, { name: 'IBKR Flex token', expires_at: null, last_rotated_at: null });
  const initial = body();
  assert.equal((await call(root + '/stage', initial, admin)).status, 403);
  assert.equal((await call(root + '/stage', initial, reader)).status, 403);
  assert.equal((await call(root + '/stage', initial, owner, '')).value.error, 'origin_required');
  assert.equal((await call(root + '/stage', initial, owner, 'https://elsewhere.invalid')).value.error, 'cross_origin_rejected');
  for (const path of ['/api/credential-rotation/other/stage', root + '/payload', root + '/versions']) assert.equal((await call(path, initial)).status, 400);
  for (const payload of [{ ...initial, extra: true }, { ...initial, step_up: { method: 'totp', code: '123456', seed: 'synthetic' } }, { ...initial, new_value: 'x'.repeat(1025) }, { ...initial, new_value: '界'.repeat(342) }, 'x'.repeat(4097)]) assert.equal((await call(root + '/stage', payload)).status, 400);
  for (const value of ['2035-02-30T00:00:00Z', '2035-01-01T00:00:00', '2035-01-01T00:00:00.000Z', null]) assert.equal((await call(root + '/stage', { ...initial, expires_at: value })).value.error, 'invalid_credential_expiry');
  assert.equal((await call(root + '/stage', initial, owner, 'https://console.example', { 'Content-Type': 'text/plain' })).status, 400);
  assert.equal(writes.length, 0);
  const totpBody = body({ method: 'totp', code: await totp(seed, step) });
  const staged = await call(root + '/stage', totpBody); assert.equal(writes.length, 1, 'proxy write reached fake'); assert.equal(staged.value.operation.state, 'staged');
  const op = staged.value.operation.operation_id;
  assert.deepEqual((await call(operationPath(op), undefined, reader)).value.operation.allowed_actions, []);
  assert.equal(staged.value.metadata.expires_at, null); assert.equal(staged.value.metadata.last_rotated_at, null);
  assert.equal((await call(root + '/stage', totpBody)).value.replayed, true); assert.equal(writes.length, 1);
  assert.equal((await call(root + '/stage', { ...totpBody, new_value: 'synthetic-other' })).value.error, 'credential_rotation_request_conflict');
  assert.equal((await call(root + '/stage', body())).value.error, 'credential_rotation_state_conflict');
  assert.equal((await call(operationPath(op) + '/finalize', { request_id: 'synthetic-no-ack', downstream_verified: false, step_up: factor() })).status, 400);
  const rejected = await call(operationPath(op) + '/finalize', { request_id: 'synthetic-reused-totp', downstream_verified: true, step_up: totpBody.step_up });
  assert.equal(rejected.value.error, 'step_up_invalid');
  await assert.rejects(withResponse(rejected.value, rejected.status, () => frontend.finalizeCredentialRotation({
    operation_id: op, request_id: 'synthetic-browser-request', downstream_verified: true, step_up: totpBody.step_up,
  })), error => error instanceof frontend.HttpError && frontend.rotationErrorCode(error) === 'step_up_invalid');
  assert.equal(invalidations, 0, 'wrong second factor must preserve login');
  for (const suffix of ['/stage', '/operations/' + op + '/finalize', '/operations/' + op + '/cancel']) {
    await assert.rejects(withResponse(rejected.value, 403, () => frontend.postJson(root + suffix, {})), frontend.HttpError);
  }
  for (const [path, status, errorBody] of [
    [root + '/stage', 401, { ok: false, error: 'login required' }],
    [root + '/stage', 403, { ok: false, error: 'rotation_owner_required' }],
    [root + '/stage', 403, { ok: false, error: 'cross_origin_rejected' }],
    ['/api/admin/config', 403, rejected.value],
    [root + '/stage', 403, { ...rejected.value, extra: true }],
  ]) {
    const before = invalidations;
    await assert.rejects(withResponse(errorBody, status, () => frontend.postJson(path, {})), frontend.AccessError);
    assert.equal(invalidations, before + 1, 'real permission failures must invalidate login');
  }
  const finish = { request_id: 'synthetic-finalize-1', downstream_verified: true, step_up: factor() };
  const finalized = await call(operationPath(op) + '/finalize', finish);
  assert.equal(finalized.value.operation.state, 'finalized'); assert.equal(finalized.value.metadata.expires_at, expiry); assert.equal(finalized.value.metadata.last_rotated_at, new Date(at).toISOString());
  assert.equal((await call(operationPath(op) + '/finalize', finish)).value.replayed, true); assert.equal(writes.length, 2);
  assert.equal((await call(operationPath(op) + '/cancel', { request_id: 'synthetic-wrong-state', step_up: factor() })).status, 409);
  const p1 = body(), p2 = body();
  const race = await Promise.all([call(root + '/stage', p1), call(root + '/stage', p2)]);
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409]); assert.equal(writes.length, 3);
  const cancelOp = race.find(r => r.status === 200).value.operation.operation_id;
  const cancel = { request_id: 'synthetic-cancel-1', step_up: factor() };
  assert.equal((await call(operationPath(cancelOp) + '/cancel', cancel)).value.operation.state, 'canceled');
  assert.deepEqual((await call()).value.metadata, finalized.value.metadata);
  assert.equal((await call(operationPath(cancelOp) + '/cancel', cancel)).value.replayed, true);
  const reusedRecovery = { ...body(), step_up: cancel.step_up };
  assert.equal((await call(root + '/stage', reusedRecovery)).value.error, 'step_up_invalid');
  mode = 'unknown';
  const uncertain = await call(root + '/stage', body()); assert.equal(uncertain.value.operation.state, 'add_unknown');
  const unknownOp = uncertain.value.operation.operation_id, writesBeforeRead = writes.length;
  mode = 'normal';
  assert.equal((await call(operationPath(unknownOp))).value.operation.state, 'staged'); assert.equal(writes.length, writesBeforeRead);
  // A concurrent maintenance update during proxy finalize prevents local overwrite.
  onProxy = async () => { onProxy = null; await fixture('fixture_revision'); };
  const conflict = await call(operationPath(unknownOp) + '/finalize', { request_id: 'synthetic-finalize-cas', downstream_verified: true, step_up: factor() });
  assert.equal(conflict.value.operation.state, 'finalize_unknown'); assert.equal(conflict.value.operation.reason_code, 'maintenance_revision_conflict');
  assert.equal(conflict.value.metadata.expires_at, '2035-06-01T00:00:00.000Z');
  const count = writes.length;
  assert.equal((await call(operationPath(unknownOp))).value.operation.state, 'finalize_unknown'); assert.equal(writes.length, count);
  const snapshot = await (await fixture('fixture_snapshot')).json();
  for (const value of ['synthetic-write-only-value',seed,key,...codes,'synthetic-private-provider-response']) assert.ok(!JSON.stringify(snapshot).includes(value), 'durable data cannot contain raw inputs');
  const audit = await call('/api/audit-events?limit=100'); assert.equal(audit.status, 200);
  assert.ok(audit.value.events.some(event => event.action === 'credential_rotation_stage'));
  for (const event of audit.value.events) if (event.event_id) assert.deepEqual(Object.keys(event).sort(), ['action','actor_alias','event_id','occurred_at','operation_id','outcome','subject']);
  const page = await call('/api/audit-events?limit=1'); assert.ok(page.value.next_cursor);
  const next = await call('/api/audit-events?limit=1&cursor=' + page.value.next_cursor);
  assert.notEqual(next.value.events[0].event_id, page.value.events[0].event_id);
  await mf.dispose(); mf = new Miniflare(options); await start();
  assert.equal((await call(operationPath(unknownOp))).value.operation.state, 'finalize_unknown');
  assert.equal((await call(operationPath('synthetic-missing-op'))).status, 404);
  // Separate fixture: failures, throttling, completion rollback and restart.
  await mf.dispose(); mf = new Miniflare({ ...options, durableObjectsPersist: false }); await start();
  for (let n = 0; n < 5; n++) assert.equal((await call(root + '/stage', { ...body(), request_id: 'synthetic-invalid-' + n, step_up: { method: 'recovery', code: 'synthetic-invalid' } })).value.error, 'step_up_invalid');
  assert.equal((await call(root + '/stage', body())).value.error, 'step_up_rate_limited');
  const afterWindow = { 'X-Synthetic-Offset': '300001' };
  onProxy = async () => { onProxy = null; await fixture('fixture_abort'); };
  const rollback = await call(root + '/stage', body(), owner, 'https://console.example', afterWindow);
  assert.equal(rollback.value.operation.state, 'add_unknown'); assert.deepEqual(rollback.value.operation.allowed_actions, []);
  await fixture('fixture_clear');
  const rollbackWrites = writes.length;
  assert.equal((await call(operationPath(rollback.value.operation.operation_id))).value.operation.state, 'staged');
  assert.equal(writes.length, rollbackWrites);
  // Revision changed before finalize blocks the proxy entirely.
  await fixture('fixture_revision');
  assert.equal((await call(operationPath(rollback.value.operation.operation_id) + '/finalize', { request_id: 'synthetic-pre-cas', downstream_verified: true, step_up: factor() })).value.error, 'credential_maintenance_revision_conflict');
  assert.equal(writes.length, rollbackWrites);
  mode = 'unknown';
  const cancelUnknown = await call(operationPath(rollback.value.operation.operation_id) + '/cancel', { request_id: 'synthetic-cancel-unknown', step_up: factor() });
  assert.equal(cancelUnknown.value.operation.state, 'cancel_unknown');
  mode = 'normal';
  const cancelCount = writes.length;
  assert.equal((await call(operationPath(rollback.value.operation.operation_id))).value.operation.state, 'canceled');
  assert.equal(writes.length, cancelCount);
  await mf.dispose();
  mf = new Miniflare({ ...options, durableObjectsPersist: false, bindings: { ...bindings, CREDENTIAL_ROTATION_OWNER: '' } });
  assert.equal((await call()).value.error, 'credential_rotation_unavailable');
  assert.ok(reads > 0);
  for (const [state, reason_code] of [['failed', 'provider_failed'], ['add_unknown', 'proxy_unconfirmed'], ['finalize_unknown', 'maintenance_revision_conflict']]) {
    const value = { ...staged.value, operation: { ...staged.value.operation, state, reason_code, allowed_actions: [] } };
    assert.equal((await withResponse(value, 200, () => frontend.loadCredentialRotation())).operation.reason_code, reason_code);
  }
  for (const value of [
    { ...staged.value, secret: 'synthetic-forbidden' },
    { ...staged.value, operation: { ...staged.value.operation, reason_code: 'step_up_invalid' } },
    { ...staged.value, server_time: null },
    { ...staged.value, operation: { ...staged.value.operation, allowed_actions: null } },
  ]) await assert.rejects(withResponse(value, 200, () => frontend.loadCredentialRotation()), /invalid_credential_rotation_response/);
  for (const timestamp of ['2035-02-30T00:00:00Z', '2035-04-01T00:00:00.1234Z', '2035-04-01T25:00:00Z'])
    assert.equal(frontend.isRotationTimestamp(timestamp), false);
  for (const request_id of ['short', 'synthetic:invalid', '.synthetic'])
    await assert.rejects(frontend.stageCredentialRotation({ ...initial, request_id }), /request_id_invalid/);
  // Mixed legacy/rotation page preserves old links as well as rotation identity.
  const mixed = { schema_version: 'qsl.audit_events.v1', events: [
    ...audit.value.events,
    { id: 'synthetic-legacy', action: 'synthetic', ref: '/api/operations/operation%3Asynthetic', subject: { kind: 'strategy_promotion', id: 'synthetic' } },
  ] };
  const mixedParsed = await withResponse(mixed, 200, () => frontend.loadAuditEvents());
  assert.equal(mixedParsed.data.at(-1).operation_id, 'operation:synthetic');
  assert.equal(new Set(mixedParsed.data.map(e => e.event_id)).size, mixedParsed.data.length);
  console.log('credential rotation Worker/DO validation passed');
} finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow; await mf.dispose(); await rm(persist, { recursive: true, force: true }); }
