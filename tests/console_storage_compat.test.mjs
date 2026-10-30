// Cross-version test: the inputs must be the actual complete Worker bundles.
// This never contacts a provider and never imports either bundle into Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// Provider credentials must not be present when test runtime modules load.
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.CLOUDFLARE_ACCOUNT_ID;
const { __test, initializeDirectory } = await import('./helpers/directory_worker.mjs');

const require = createRequire(new URL('../web/strategy-switch-console/package.json', import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || 'miniflare');
const oldDigest = '7b64da8edd2627175019e5c529f9eec048732ffb7acec502cdf4122fc0dbb06a';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const id = '11111111-1111-4111-8111-111111111111';
const target = 'binance.crypto_live_pool_rotation';
const account = { key: 'default', label: 'Binance', target_name: 'crypto_live_pool_rotation',
  runtime_status_target_id: target, supported_domains: ['crypto'], service_name: 'binance-platform', default_execution_mode: 'live' };
const bindings = { SESSION_SECRET: 'synthetic-only-session-key', STRATEGY_SWITCH_ADMIN_LOGINS: 'fixture-admin',
  ALLOWED_GITHUB_LOGINS: 'fixture-reader', STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ binance: [account] }),
  EXECUTION_EVIDENCE_SYNC_TOKEN: 'synthetic-lifecycle-token', ACCOUNT_DIAGNOSIS_SYNC_TOKEN: 'synthetic-diagnosis-token',
  ACCOUNT_DIAGNOSIS_AUTO_ENABLED: 'false', RUNTIME_SETTINGS_DISPATCH_TOKEN: 'synthetic-dispatch-token' };
const nativeBinding = { schema_version: 'qrs.account-diagnosis-native.v1', project: 'QuantStrategyLab/QuantRuntimeSettings',
  resource: 'https://native.invalid', audience: 'quant-fixture', provider: 'dot', profile: 'account-diagnosis',
  model: 'synthetic-model', worker: 'synthetic-quant-worker' };
const cookie = `qsl_switch_session=${await __test.makeSession('fixture-admin', [], bindings)}`;
const now = new Date().toISOString();
const source = { schema_version: 'qsl_runtime_target_lifecycle_source_snapshot.v1', source_id: 'diagnosis-fixture',
  generated_at: now, computed_at: now, data_status: 'ready', targets: [{ target_id: target,
    target: { platform: 'binance', configured_state: 'enabled', execution_mode: 'live' },
    monitoring: { runtime_guard: 'pass', execution_heartbeat: 'pass' },
    disposition: { code: 'continue_enabled_monitoring', reason_code: 'none' }, no_order: true,
    deployment: { observed_at: now, runtime_enabled: true, scheduler_state: 'enabled', strategy_profile: null, execution_mode: 'live' } }], errors: [] };

// Inspect the real persisted SQLite schema only while workerd is stopped. Find
// the target table, rather than relying on Miniflare's internal file names.
async function storedRow(root, requestId) {
  const files = [];
  async function walk(dir) { for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name); if (e.isDirectory()) await walk(p); else if (e.name.endsWith('.sqlite')) files.push(p);
  } }
  await walk(root);
  const script = `import json,sqlite3,sys\nout=[]\nfor path in sys.argv[2:]:\n c=sqlite3.connect('file:'+path+'?mode=ro',uri=True)\n c.row_factory=sqlite3.Row\n try:\n  columns=[r[1] for r in c.execute('PRAGMA table_info(account_diagnosis_tasks)')]\n  if columns:\n   row=c.execute('SELECT * FROM account_diagnosis_tasks WHERE request_id=?',(sys.argv[1],)).fetchone()\n   if row is not None: out.append({'columns':columns,'row':dict(row)})\n finally: c.close()\nprint(json.dumps(out))`;
  const result = JSON.parse(execFileSync('python3', ['-c', script, requestId, ...files], { encoding: 'utf8' }));
  assert.equal(result.length, 1, 'fixture request must occur in exactly one runtime instance database');
  return result[0];
}

test('verified production Worker and complete candidate preserve SQLite upgrade and rollback boundaries', async () => {
  assert.ok(process.env.QRS_OLD_WORKER_BUNDLE && process.env.QRS_NEW_WORKER_BUNDLE, 'both Worker bundle paths are required');
  const oldPath = resolve(process.env.QRS_OLD_WORKER_BUNDLE), newPath = resolve(process.env.QRS_NEW_WORKER_BUNDLE);
  const [oldBytes, newBytes] = await Promise.all([readFile(oldPath), readFile(newPath)]);
  assert.equal(sha(oldBytes), oldDigest, 'old Worker must be the fixed, previously verified production candidate');
  assert.notEqual(sha(newBytes), oldDigest, 'the full new candidate must be a distinct bundle');
  console.log(JSON.stringify({ old_worker_sha256: sha(oldBytes), candidate_worker_sha256: sha(newBytes) }));
  const persist = await mkdtemp(join(tmpdir(), 'qrs-upgrade-'));
  let mf, outbound = 0, nativeCalls = 0;
  async function stop() { if (mf) { await mf.dispose(); mf = undefined; } }
  async function start(scriptPath, { native = false, transport = false } = {}) {
    await stop();
    // Bundles live under RUNNER_TEMP, outside the checkout. As in the existing
    // candidate runtime tests, make their directory workerd's module root.
    mf = new Miniflare({ cf: false, rootPath: dirname(scriptPath), modulesRoot: dirname(scriptPath),
      modules: true, scriptPath, compatibilityDate: '2026-06-08',
      bindings: { ...bindings, ...(native ? { ACCOUNT_DIAGNOSIS_NATIVE_BINDING_JSON: JSON.stringify(nativeBinding) } : {}) },
      ...(transport ? { serviceBindings: { ACCOUNT_DIAGNOSIS_NATIVE_TRANSPORT: async request => {
        nativeCalls++;
        assert.equal(new URL(request.url).pathname, '/v1/tasks');
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.has('Authorization'), false);
        const body = await request.json();
        return Response.json({ id: 'synthetic-task-1', owner: nativeBinding.project, provider: 'dot',
          result_kind: 'advisory', revision: 1, request: body, status: 'queued', worker: null, attempt: null,
          deadline: Date.now() / 1000 + 600, output: null });
      } } } : {}),
      durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: 'RuntimeInstances', useSQLite: true } },
      durableObjectsPersist: persist, kvNamespaces: ['STRATEGY_SWITCH_CONFIG'], kvPersist: join(persist, 'kv'),
      outboundService: async () => { outbound++; throw Error('unexpected outbound request'); } });
    await initializeDirectory(mf);
  }
  async function command(body) {
    const ns = await mf.getDurableObjectNamespace('STRATEGY_SWITCH_RUNTIME_INSTANCES');
    const response = await ns.get(ns.idFromName('runtime-instances')).fetch('https://fixture.invalid/', {
      method: 'POST', body: JSON.stringify({ actor: 'synthetic-state-fixture', ...body }) });
    return { status: response.status, body: await response.json() };
  }
  const create = (request_id, target_id) => command({ action: 'diagnosis_create', request_id, platform: 'binance', key: 'default',
    target_id, trigger: 'manual_check', observed_at: now, checks: {}, state_fingerprint: request_id, created_at: now, now: Date.now() });
  const read = request_id => command({ action: 'diagnosis_read', request_id });
  try {
    await start(oldPath);
    let made = await create(id, target); assert.equal(made.status, 200); assert.equal(made.body.created, true);
    const claim = { action: 'diagnosis_claim', request_id: id, workflow_run_id: '100', workflow_run_attempt: '1', updated_at: now };
    let control = await command(claim); assert.equal(control.status, 200); assert.equal(control.body.claimed, true);
    control = await command({ ...claim, action: 'diagnosis_result', status: 'succeeded', job_id: '200',
      summary: 'Synthetic completed diagnosis.', reason_code: 'diagnosis_ready' });
    assert.equal(control.status, 200); assert.equal(control.body.changed, true);
    const original = (await read(id)).body.task;
    await stop();
    const oldRecord = await storedRow(persist, id);
    assert.ok(!oldRecord.columns.includes('native_json'), 'old Worker must actually create a pre-native schema');

    await start(newPath);
    let migrated = await read(id); assert.equal(migrated.status, 200);
    for (const field of ['request_id', 'platform', 'key', 'target_id', 'status', 'state_fingerprint'])
      assert.deepEqual(migrated.body.task[field], original[field], `upgrade preserves ${field}`);
    assert.equal((await command(claim)).status, 409, 'new Worker retires legacy claim');
    assert.equal((await command({ ...claim, action: 'diagnosis_result', status: 'succeeded', job_id: '200',
      summary: 'Synthetic completed diagnosis.', reason_code: 'diagnosis_ready' })).status, 409,
    'new Worker retires legacy result');
    // The real HTTP handler must fail closed without either native setting.
    let response = await mf.dispatchFetch('https://console.example/api/internal/sync-runtime-target-lifecycle-source', {
      method: 'POST', headers: { Authorization: 'Bearer synthetic-lifecycle-token', 'Content-Type': 'application/json' }, body: JSON.stringify(source) });
    assert.equal(response.status, 200, 'synthetic lifecycle seed');
    async function createHttp() { return mf.dispatchFetch('https://console.example/api/account-diagnosis', { method: 'POST',
      headers: { Cookie: cookie, Origin: 'https://console.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'binance', key: 'default', trigger: 'manual_check' }) }); }
    response = await createHttp(); assert.equal(response.status, 503, 'missing both native settings fails closed');
    await start(newPath, { transport: true });
    response = await createHttp(); assert.equal(response.status, 503, 'missing native binding fails closed');
    await start(newPath, { native: true });
    response = await createHttp(); assert.equal(response.status, 503, 'missing native transport fails closed');
    assert.equal(outbound, 0, 'no external dispatch'); assert.equal(nativeCalls, 0, 'no native call without both settings');

    // Generate the native record using the real authenticated handler and a
    // synthetic local service, using the same response contract as existing tests.
    await start(newPath, { native: true, transport: true });
    response = await createHttp(); const created = await response.json();
    assert.equal(response.status, 202, JSON.stringify(created));
    const newId = created.request_id;
    assert.ok(newId && newId !== id); assert.equal(nativeCalls, 1);
    const intent = await read(newId);
    assert.equal(intent.status, 200); assert.equal(intent.body.task.backend_kind, 'native');
    await stop();
    const beforeRollback = await storedRow(persist, newId);
    assert.ok(beforeRollback.columns.includes('native_json'), 'new schema must actually contain native_json');
    const native = JSON.parse(beforeRollback.row.native_json);
    assert.equal(native.binding.project, nativeBinding.project);
    assert.equal(native.request.materials[0].request_id, newId);
    assert.equal(beforeRollback.row.status, 'queued', 'real native task remains pending, not terminal');
    assert.equal(native.phase, 'pending');
    await start(newPath);
    assert.equal((await read(newId)).body.task.backend_kind, 'native', 'native data survives restart');
    assert.equal((await read(id)).body.task.request_id, id, 'legacy data survives repeat startup');
    await start(oldPath);
    assert.equal((await read(id)).body.task.request_id, id, 'old Worker can read legacy row after rollback');
    const rollbackLegacy = await create('33333333-3333-4333-8333-333333333333', 'binance.synthetic-third-target');
    assert.equal(rollbackLegacy.status, 200, 'old Worker can create a legacy row after rollback');
    assert.equal((await read('33333333-3333-4333-8333-333333333333')).body.task.request_id,
      '33333333-3333-4333-8333-333333333333', 'legacy write is persisted');
    const rollbackNative = await read(newId);
    assert.equal(rollbackNative.status, 200, 'old Worker can read the new row');
    const nativeClaim = { ...claim, request_id: newId, workflow_run_id: '101', workflow_run_attempt: '1' };
    const claimResult = await command(nativeClaim);
    const resultResult = await command({ ...nativeClaim, action: 'diagnosis_result', status: 'succeeded', job_id: '201',
      summary: 'Synthetic completed diagnosis.', reason_code: 'diagnosis_ready' });
    await stop();
    const afterRollback = await storedRow(persist, newId);
    const mutated = JSON.stringify(beforeRollback.row) !== JSON.stringify(afterRollback.row);
    if (claimResult.body.claimed === true || resultResult.body.changed === true || mutated) {
      console.log(JSON.stringify({ upgrade: 'pass', rollback: 'unsupported', reason: 'legacy_write_mutated_native_task',
        claim_status: claimResult.status, claimed: claimResult.body.claimed ?? null,
        result_status: resultResult.status, changed: resultResult.body.changed ?? null, persisted_row_changed: mutated }));
      assert.fail('unsupported rollback: legacy claim/result can mutate a native task');
    }
    console.log(JSON.stringify({ upgrade: 'pass', rollback: 'pass' }));
  } finally { await stop(); await rm(persist, { recursive: true, force: true }); }
});
