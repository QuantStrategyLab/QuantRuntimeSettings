import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadOnlyRequest, inspectModule, probe } from '../scripts/console_active_module_probe.mjs';

const version = '01234567-89ab-cdef-0123-456789abcdef';
const deployment = '11234567-89ab-cdef-0123-456789abcdef';
const active = () => ({ deployments: [{ id: deployment, strategy: 'percentage', versions: [{ version_id: version, percentage: 100 }] }] });
const moduleVersion = (text = 'const trailingGap = hasGap(daily.at(-1), { date: input.today });') => ({
  id: version, modules: [{ name: 'worker.js', content_type: 'application/javascript+module', content_base64: Buffer.from(text).toString('base64') }],
});

test('reports only bounded structure and boolean markers, not code or identifiers', () => {
  const result = inspectModule(moduleVersion(), version);
  assert.equal(result.single_javascript_module, true);
  assert.equal(result.markers.trailing_gap_new, true);
  assert.equal(result.markers_unique.trailing_gap_new, true);
  const repeated = inspectModule(moduleVersion('var trailingGap = hasGap(daily.at(-1), { date: input.today });\nvar trailingGap = hasGap(daily.at(-1), { date: input.today });'), version);
  assert.equal(repeated.markers.trailing_gap_new, true);
  assert.equal(repeated.markers_unique.trailing_gap_new, false);
  assert.equal(result.markers.trailing_gap_old, false);
  assert.doesNotMatch(JSON.stringify(result), /01234567|const trailingGap/);
});
test('rejects missing, multiple, noncanonical or invalid module content', () => {
  for (const obj of [
    {...moduleVersion(), id: deployment},
    {...moduleVersion(), modules: []},
    {...moduleVersion(), modules: [...moduleVersion().modules, ...moduleVersion().modules]},
    {...moduleVersion(), modules: [{...moduleVersion().modules[0], content_base64: '!!!'}]},
    {...moduleVersion(), modules: [{...moduleVersion().modules[0], content_base64: '/w=='}]},
  ]) assert.throws(() => inspectModule(obj, version));
});
test('returns fixed categories for unsupported module shapes without exposing the name', () => {
  assert.throws(() => inspectModule({...moduleVersion(), modules: []}, version), {message: 'active_module_schema'});
  assert.throws(() => inspectModule({...moduleVersion(), modules: [{...moduleVersion().modules[0], name: 'private-name'}]}, version), {message: 'unsupported_module_name'});
  assert.throws(() => inspectModule({...moduleVersion(), modules: [{...moduleVersion().modules[0], content_type: 'private-type'}]}, version), {message: 'unsupported_module_type'});
  assert.throws(() => inspectModule({...moduleVersion(), modules: [{...moduleVersion().modules[0], content_base64: '!!!!'}]}, version), {message: 'encoding_invalid'});
});
test('accepts a five MiB module without regex stack exhaustion', () => {
  assert.equal(inspectModule(moduleVersion('a'.repeat(5 * 1024 * 1024)), version).single_javascript_module, true);
});
test('only performs two active deployment reads and one version-pinned module read', async () => {
  const calls = [];
  const result = await probe(async (path, beta) => {
    calls.push([path, beta]);
    return path.startsWith('/deployments') ? active() : moduleVersion();
  });
  assert.deepEqual(calls, [
    ['/deployments?page=1&per_page=10', false],
    [`/versions/${version}?include=modules`, true],
    ['/deployments?page=1&per_page=10', false],
  ]);
  assert.equal(result.active_observations_match, true);
  assert.doesNotMatch(JSON.stringify(result), /01234567|const trailingGap/);
});
test('stops on split traffic or deployment drift', async () => {
  let count = 0;
  await assert.rejects(probe(async path => path.startsWith('/deployments')
    ? (++count === 1 ? active() : { deployments: [{...active().deployments[0], id: version}] })
    : moduleVersion()), {message: 'observation_changed'});
  await assert.rejects(probe(async () => ({deployments: [{...active().deployments[0], versions: [{version_id: version, percentage: 50}]}]})));
});
test('fixed in-memory verification runs between the two active observations', async () => {
  const calls=[];
  await probe(async (path,beta)=>{
    calls.push(path.startsWith('/deployments')?'active':beta?'module':'unexpected');
    return path.startsWith('/deployments') ? active() : moduleVersion('synthetic-body');
  }, async bytes=>{
    calls.push('verify');
    assert.ok(Buffer.isBuffer(bytes));
    assert.equal(bytes.toString(),'synthetic-body');
  });
  assert.deepEqual(calls,['active','module','verify','active']);
});
test('a candidate validation failure stops before reporting a second observation', async () => {
  const paths=[];
  await assert.rejects(probe(async (path)=>{
    paths.push(path);
    return path.startsWith('/deployments') ? active() : moduleVersion('synthetic-body');
  }, async ()=>{throw Error('synthetic_verification_failure');}), /synthetic_verification_failure/);
  assert.equal(paths.length,2);
});

test('the fixed provider transport uses only the approved Worker GET endpoints', async () => {
  const originalFetch=globalThis.fetch;
  const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
  const calls=[];
  process.env.CLOUDFLARE_API_TOKEN='synthetic-only';
  process.env.CLOUDFLARE_ACCOUNT_ID='a'.repeat(32);
  globalThis.fetch=async (url,options)=>{
    calls.push({url,method:options.method});
    const result=url.includes('/deployments?') ? active() : moduleVersion();
    return Response.json({success:true,result,errors:[]});
  };
  try {
    await probe(createReadOnlyRequest());
    assert.equal(calls.length,3);
    assert.ok(calls.every(call=>call.method==='GET'));
    assert.ok(calls.every(call=>call.url.startsWith('https://api.cloudflare.com/client/v4/accounts/'+ 'a'.repeat(32) +'/workers/')));
    assert.ok(calls[1].url.endsWith('/versions/'+version+'?include=modules'));
  } finally {
    globalThis.fetch=originalFetch;
    if(token===undefined)delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=token;
    if(account===undefined)delete process.env.CLOUDFLARE_ACCOUNT_ID;else process.env.CLOUDFLARE_ACCOUNT_ID=account;
  }
});
