// Offline only: the complete pinned bundle and synthetic workers/bindings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.CLOUDFLARE_ACCOUNT_ID;
const require = createRequire(new URL('../web/strategy-switch-console/package.json', import.meta.url));
const { Miniflare } = require('miniflare');
const path = process.env.QRS_NEW_WORKER_BUNDLE && resolve(process.env.QRS_NEW_WORKER_BUNDLE);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const methods = ['effectiveAccountSettings', 'dispatchAccountDiagnosis'];

test('pinned candidate has no RPC or HTTP surface for the two test helpers', async () => {
  assert.ok(path, 'QRS_NEW_WORKER_BUNDLE is required');
  assert.equal(digest(await readFile(path)), '1f58021acb0b6af1738c89d81f9698dee72ff272980f3165ea76df468f1873da', 'candidate bundle must be exact');
  const root = dirname(path);
  const target = { name: 'candidate', modules: true, scriptPath: path, modulesRoot: root, rootPath: root,
    compatibilityDate: '2026-06-08', bindings: { SESSION_SECRET: 'synthetic-only-session-key' },
    durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: 'RuntimeInstances', useSQLite: true } },
    kvNamespaces: ['STRATEGY_SWITCH_CONFIG'] };
  let outbound = 0;
  const denyOutbound = async () => { outbound++; throw Error('unexpected outbound request'); };
  // A standalone default request must succeed independently of named bindings.
  const boot = new Miniflare({
    ...target,
    cf: false,
    outboundService: denyOutbound,
  });
  try {
    const home = await boot.dispatchFetch('https://console.example/');
    assert.equal(home.status, 200, 'default candidate route must boot');
    assert.match(home.headers.get('content-type') || '', /text\/html/i);
    const protectedApi = await boot.dispatchFetch('https://console.example/api/runtime/today');
    assert.equal(protectedApi.status, 401, 'protected API must deny unauthenticated access');
    for (const method of methods) {
      const response = await boot.dispatchFetch(`https://console.example/__test/${method}`, { method: 'POST' });
      assert.ok([401, 403, 404, 405].includes(response.status), `HTTP helper path unexpectedly exposed: ${response.status}`);
    }
  } finally { await boot.dispose(); }

  // The positive-control class proves RPC is functional. The named __test
  // target is the actual candidate export, with no transport or real tokens.
  const caller = `export default { async fetch(request, env) {
    const method = new URL(request.url).pathname.slice(1);
    try { return Response.json({ ok: true, value: await env.TARGET[method]({}, {}) }); }
    catch (e) { return Response.json({ ok: false, name: String(e?.name || ''), message: String(e?.message || '') }); }
  } }`;
  const control = `import { WorkerEntrypoint } from 'cloudflare:workers';
    export class Control extends WorkerEntrypoint {
      effectiveAccountSettings() { return 'synthetic-rpc-ok'; }
      dispatchAccountDiagnosis() { return 'synthetic-rpc-ok'; }
    }
    export default { fetch() { return new Response('control'); } };`;
  const mf = new Miniflare({
    cf: false,
    outboundService: denyOutbound, workers: [
    { name: 'test-caller', modules: true, script: caller, compatibilityDate: '2026-06-08',
      serviceBindings: { TARGET: { name: 'candidate', entrypoint: '__test' } } },
    { name: 'control-caller', modules: true, script: caller, compatibilityDate: '2026-06-08',
      serviceBindings: { TARGET: { name: 'control', entrypoint: 'Control' } } },
    target,
    { name: 'control', modules: true, script: control, compatibilityDate: '2026-06-08' },
  ] });
  try {
    const controlWorker = await mf.getWorker('control-caller');
    const testWorker = await mf.getWorker('test-caller');
    for (const method of methods) {
      const good = await (await controlWorker.fetch(`https://fixture.invalid/${method}`)).json();
      assert.deepEqual(good, { ok: true, value: 'synthetic-rpc-ok' }, 'synthetic RPC positive control must work');
      const rejected = await (await testWorker.fetch(`https://fixture.invalid/${method}`)).json();
      assert.equal(rejected.ok, false, `${method} unexpectedly callable through named service RPC`);
      assert.match(`${rejected.name}: ${rejected.message}`,
        /(?:not|does not|cannot|unsupported|unknown|no such|must).{0,160}(?:rpc|method|entrypoint|function|class)|(?:rpc|method|entrypoint|function|class).{0,160}(?:not|cannot|unsupported|unknown|no such|must)/i,
        'rejection must identify the RPC entrypoint or method, not a generic startup or application error');
    }
    assert.equal(outbound, 0, 'no external request is permitted');
  } finally { await mf.dispose(); }
});
