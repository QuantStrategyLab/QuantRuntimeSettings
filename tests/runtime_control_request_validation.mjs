import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import worker, { __test } from '../web/strategy-switch-console/worker.js';
const require = createRequire(new URL('../web/strategy-switch-console/package.json', import.meta.url));
const { Miniflare } = require('miniflare');
const account = { key: 'synthetic', label: 'Synthetic', target_name: 'synthetic', variable_scope: 'repository',
  deployment_selector: 'synthetic-deployment', account_scope: 'synthetic-scope', account_selector: 'synthetic-account',
  service_name: 'synthetic-service', supported_domains: ['us_equity'] };
const incomplete = { ...account, key: 'incomplete', target_name: 'incomplete', account_selector: 'other-account',
  deployment_selector: 'other-deployment', account_scope: 'other-scope', service_name: '' };
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  scriptPath: fileURLToPath(new URL('../web/strategy-switch-console/worker.js', import.meta.url)), compatibilityDate: '2026-06-08',
  bindings: { STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ ibkr: [account] }) },
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: 'RuntimeInstances', useSQLite: true } },
  kvNamespaces: ['STRATEGY_SWITCH_CONFIG'], outboundService: () => new Response('offline', { status: 503 }) });
try {
  const ns = await mf.getDurableObjectNamespace('STRATEGY_SWITCH_RUNTIME_INSTANCES');
  const stub = ns.get(ns.idFromName('runtime-instances'));
  async function call(body) {
    const response = await stub.fetch('https://runtime-instances/', { method: 'POST', body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  const initialized = await call({ action: 'initialize', expected_revision: 0, actor: 'synthetic-admin', account_options: { ibkr: [account, incomplete] } });
  assert.equal(initialized.status, 200);
  const revision = initialized.body.revision;
  const identity = { platform: 'ibkr', key: 'synthetic', target_name: 'synthetic', broker_environment: null,
    account_selector: 'synthetic-account', deployment_selector: 'synthetic-deployment', account_scope: 'synthetic-scope', service_name: 'synthetic-service' };
  const common = { platform: 'ibkr', key: 'synthetic', request_id: '12345678-1234-4abc-8def-123456789abc' };
  const read = await call({ ...common, action: 'runtime_control_read' });
  assert.equal(read.status, 200);
  assert.equal((await call({ platform: 'ibkr', key: 'incomplete', action: 'runtime_control_read' })).status, 409);
  for (const changed of [{ broker_environment: 'live' }, { service_name: '' }, { account_selector: 'other' }]) {
    const mismatch = await call({ ...common, action: 'runtime_control_claim', operation: 'enable', source_revision: revision, identity: { ...identity, ...changed } });
    assert.equal(mismatch.status, 409);
  }
  const claim = await call({ ...common, action: 'runtime_control_claim', operation: 'enable', source_revision: revision, identity });
  assert.equal(claim.body.state, 'reserved');
  const replay = await call({ ...common, action: 'runtime_control_claim', operation: 'enable', source_revision: revision, identity });
  assert.equal(replay.body.state, 'replay');
  const other = await call({ ...common, request_id: '7da8fca2-b168-46ac-9a83-b531f79eb605', action: 'runtime_control_claim', operation: 'disable', source_revision: revision, identity });
  assert.equal(other.body.state, 'blocked');
  await call({ ...common, action: 'runtime_control_record', phase: 'unknown' });
  const missing = await call({ ...common, action: 'runtime_control_resolve', phase: 'applied', run_id: '123' });
  assert.equal(missing.status, 400);
  await call({ ...common, action: 'runtime_control_record', phase: 'unknown', run_id: '123' });
  const wrong = await call({ ...common, action: 'runtime_control_resolve', phase: 'applied', run_id: '124' });
  assert.equal(wrong.status, 400);
  const resolved = await call({ ...common, action: 'runtime_control_resolve', phase: 'applied', run_id: '123' });
  assert.equal(resolved.body.record.phase, 'applied');
  const env = { STRATEGY_SWITCH_RUNTIME_INSTANCES: ns, SESSION_SECRET: 'synthetic-signing',
    ALLOWED_GITHUB_LOGINS: 'synthetic-admin,synthetic-viewer', STRATEGY_SWITCH_ADMIN_LOGINS: 'synthetic-admin',
    RUNTIME_SETTINGS_DISPATCH_TOKEN: 'synthetic-token' };
  const cookie = `qsl_switch_session=${await __test.makeSession('synthetic-admin', [], env)}`;
  const response = await worker.fetch(new Request('https://console.example/api/runtime-stop?platform=ibkr&target_name=synthetic', { headers: { Cookie: cookie } }), env);
  assert.equal(response.status, 200);
  const unavailable = await worker.fetch(new Request('https://console.example/api/runtime-stop?platform=ibkr&target_name=incomplete', { headers: { Cookie: cookie } }), env);
  assert.equal(unavailable.status, 409);
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => { requests.push({ url: String(url), body: JSON.parse(init.body) }); return Response.json({ workflow_run_id: 777 }); };
  async function submit(login, requestId) {
    const cookie = `qsl_switch_session=${await __test.makeSession(login, [], env)}`;
    return worker.fetch(new Request('https://console.example/api/runtime-stop', { method: 'POST', headers: {
      Cookie: cookie, Origin: 'https://console.example', 'Content-Type': 'application/json' }, body: JSON.stringify({
        platform: 'ibkr', target_name: 'synthetic', operation: 'enable', request_id: requestId, confirm: 'CONTROL_ONLY' }) }), env);
  }
  try {
    const nextId = 'cba438b5-8fbc-4f5a-9c8c-d23dc867f001';
    assert.equal((await submit('synthetic-viewer', nextId)).status, 403);
    assert.equal(requests.length, 0);
    const result = await submit('synthetic-admin', nextId);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).phase, 'accepted');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.return_run_details, true);
    assert.equal(requests[0].body.inputs.runtime_control_request_id, nextId);
    assert.equal((await submit('synthetic-admin', nextId)).status, 200);
    assert.equal(requests.length, 1);
    const blocked = await submit('synthetic-admin', 'cba438b5-8fbc-4f5a-9c8c-d23dc867f002');
    assert.equal(blocked.status, 409);
    assert.equal(requests.length, 1);
    await call({ ...common, request_id: nextId, action: 'runtime_control_resolve', phase: 'applied', run_id: '777' });
    globalThis.fetch = async (url, init) => { requests.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); };
    const unknownId = 'cba438b5-8fbc-4f5a-9c8c-d23dc867f003';
    const unknown = await submit('synthetic-admin', unknownId);
    assert.equal((await unknown.json()).phase, 'unknown');
    assert.equal((await submit('synthetic-admin', 'cba438b5-8fbc-4f5a-9c8c-d23dc867f004')).status, 409);
    assert.equal(requests.length, 2);
    await call({ ...common, request_id: unknownId, action: 'runtime_control_record', phase: 'unknown', run_id: '888' });
    const capture = await call({ ...common, request_id: unknownId, action: 'runtime_control_capture', run_id: '888', platform_run_id: '999' });
    assert.equal(JSON.parse(capture.body.record.result_json).platform_run_id, '999');
    let readbackInputs = null;
    globalThis.fetch = async (url, init = {}) => {
      if (!init.body) return new Response('offline', { status: 503 });
      readbackInputs = JSON.parse(init.body).inputs;
      return Response.json({ workflow_run_id: 111 });
    };
    const adminCookie = `qsl_switch_session=${await __test.makeSession('synthetic-admin', [], env)}`;
    async function inspect(extra = {}) {
      return worker.fetch(new Request('https://console.example/api/runtime-stop', { method: 'POST', headers: {
        Cookie: adminCookie, Origin: 'https://console.example', 'Content-Type': 'application/json' }, body: JSON.stringify({
          platform: 'ibkr', target_name: 'synthetic', operation: 'inspect', confirm: 'READ_ONLY', ...extra }) }), env);
    }
    assert.equal((await inspect({ platform_run_id: '1' })).status, 400);
    assert.equal(readbackInputs, null);
    assert.equal((await inspect()).status, 200);
    assert.equal(readbackInputs.runtime_control_platform_run_id, '999');
    assert.equal(readbackInputs.runtime_control_request_id, unknownId);
    assert.equal(readbackInputs.runtime_control_mode, 'readback');
    const checkId = readbackInputs.runtime_control_check_id;
    const repeatCheck = await call({ ...common, request_id: unknownId, action: 'runtime_control_begin_check', check_id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff' });
    assert.equal(repeatCheck.body.state, 'replay');
    await call({ ...common, request_id: unknownId, action: 'runtime_control_record_check', check_id: checkId, run_id: '111', complete: true });
    assert.equal((await call({ ...common, request_id: unknownId, action: 'runtime_control_resolve', phase: 'applied', run_id: '888', check_id: checkId, check_run_id: '112' })).status, 409);
    assert.equal((await call({ ...common, request_id: unknownId, action: 'runtime_control_resolve', phase: 'applied', run_id: '888', check_id: checkId, check_run_id: '111' })).body.record.phase, 'applied');
  } finally { globalThis.fetch = previousFetch; }
  console.log('runtime control request persistence and dispatch: PASS');
} finally { await mf.dispose(); }
