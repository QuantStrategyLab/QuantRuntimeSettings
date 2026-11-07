import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compareVersions, boundedReader, safeOutput } from '../scripts/console_version_comparator.mjs';
const hash = x => createHash('sha256').update(x).digest('hex');
const C = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const sha = 'a'.repeat(40), secret = 'PRIVATE_SENTINEL';
const worker = 'fake-console-worker';
const env = { CLOUDFLARE_WORKER_NAME: worker, GITHUB_SHA: sha, RO_COMPARATOR_EXECUTOR_SHA: sha, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_READ_ONLY_API_TOKEN: secret, CANDIDATE_COMMITMENT: hash(C), BASELINE_MODE: 'saved', BASELINE_COMMITMENT: hash(B) };
const resources = () => ({ bindings: [{name:'STRATEGY_SWITCH_CONFIG',type:'kv_namespace',namespace_id:'b'.repeat(32)}, {name:'STRATEGY_SWITCH_RUNTIME_INSTANCES',type:'durable_object_namespace',namespace_id:'c'.repeat(32),class_name:'FakeClass'}, {name:'PRIVATE_BINDING',type:'plain_text',text:secret}], script_runtime:{compatibility_date:'2026-01-01',usage_model:'standard',migration_tag:'fake-tag'}, script:{etag:'fake-etag',handlers:['fetch'],named_handlers:[]} });
const deployment = () => ({deployments:[{id: 'fake-deployment',strategy:'percentage',created_on:'2026-11-06T00:00:00Z',versions:[{version_id:B,percentage:100}]}]});
const fixtures = () => [deployment(),{items:[{id:C},{id:B}]},{id:C,resources:resources()},{id:B,resources:resources()},{id:C,resources:resources()},deployment()];
let cases = 0;
async function run({change, envDelta={}, stop, expectedGets, expectedCode=1}={}) {
 const bodies=fixtures(); change?.(bodies); let calls=0;
 const result=await compareVersions({...env,...envDelta},async(url,options)=>{
  calls++; assert.equal(options.method,'GET'); assert.equal(options.redirect,'error'); assert.equal(new URL(url).hostname,'api.cloudflare.com');
  if(stop) return stop(calls, bodies);
  return new Response(JSON.stringify({success:true,errors:[],result:bodies[calls-1]}),{headers:{'content-type':'application/json'}});
 });
 assert.equal(result.exitCode,expectedCode, JSON.stringify(result.output));
 if(expectedGets !== undefined) assert.equal(calls,expectedGets);
 const text=safeOutput(result.output); for(const value of [secret,worker,C,B,'PRIVATE_BINDING','fake-tag','fake-etag'])assert.ok(!text.includes(value));
 cases++; return result.output;
}
assert.equal((await run({expectedCode:0,expectedGets:6})).normalized_config_equal,true);
assert.equal((await run({expectedCode:0})).etag_equal,true);
assert.equal((await run({envDelta:{BASELINE_MODE:'derived',BASELINE_COMMITMENT:''},expectedCode:0})).category,'DERIVED_COMPARISON');
assert.equal((await run({envDelta:{BASELINE_MODE:'none',BASELINE_COMMITMENT:''},change:b=>b.splice(3,1),expectedCode:0,expectedGets:5})).category,'CANDIDATE_ONLY_PARTIAL');
await run({envDelta:{RO_COMPARATOR_EXECUTOR_SHA:'b'.repeat(40)},expectedGets:0});
await run({envDelta:{BASELINE_COMMITMENT:''},expectedGets:0});
await run({envDelta:{BASELINE_MODE:'bad'},expectedGets:0});
await run({envDelta:{CANDIDATE_COMMITMENT:'bad'},expectedGets:0});
await run({envDelta:{CLOUDFLARE_READ_ONLY_API_TOKEN:''},expectedGets:0});
await run({envDelta:{CLOUDFLARE_ACCOUNT_ID:''},expectedGets:0});
await run({change:b=>b[1].items=[{id:B}],expectedGets:2});
await run({change:b=>b[1].items.push({id:C}),expectedGets:2});
await run({change:b=>b[2].id=B,expectedGets:3});
await run({change:b=>b[2].resources.script_runtime.PRIVATE_UNKNOWN=secret,expectedGets:3});
await run({change:b=>b[2].resources.bindings[0].PRIVATE_UNKNOWN=secret,expectedGets:3});
await run({change:b=>b[2].resources.bindings.push(b[2].resources.bindings[0]),expectedGets:3});
await run({change:b=>delete b[2].resources.script.etag,expectedGets:3});
await run({change:b=>b[2].resources.bindings.push({name:'FAKE_SECRET',type:'secret_text',text:secret}),expectedGets:3});
await run({change:b=>b[2].resources.script_runtime.migration_tag='different',expectedGets:4});
await run({change:b=>b[4].resources.script.etag='drift',expectedGets:5});
await run({change:b=>b[5].deployments[0].versions[0].version_id=C,expectedGets:6});
await run({stop:()=>new Response('',{status:302,headers:{location:'https://example.invalid'}}),expectedGets:1});
await run({stop:()=>{throw new Error(secret)},expectedGets:1});
await run({stop:()=>new Response('{}',{status:403}),expectedGets:1});
await run({stop:()=>new Response('{}',{headers:{'content-type':'text/html'}}),expectedGets:1});
await run({stop:()=>new Response('{bad',{headers:{'content-type':'application/json'}}),expectedGets:1});
await run({stop:()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'524289'}}),expectedGets:1});
await run({stop:()=>new Response('x'.repeat(524289),{headers:{'content-type':'application/json'}}),expectedGets:1});
await run({stop:()=>new Response(JSON.stringify({success:true,errors:[{}],result:[]}),{headers:{'content-type':'application/json'}}),expectedGets:1});
await run({change:b=>b[2].resources.script_runtime.compatibility_flags='bad',expectedGets:3});
await run({change:b=>b[2].resources.script.named_handlers=[{name:'FakeClass',handlers:'bad'}],expectedGets:3});
await run({change:b=>b[0].deployments[0].created_on='not-a-date',expectedGets:1});
await run({change:b=>b[0].deployments[0].versions[0].percentage=90,expectedGets:1});
assert.equal((await run({envDelta:{BASELINE_MODE:'derived',BASELINE_COMMITMENT:''},change:b=>{b[0].deployments[0].created_on='2026-11-07T02:00:00Z';b[5].deployments[0].created_on='2026-11-07T02:00:00Z';b.splice(3,1);},expectedCode:0,expectedGets:5})).category,'CANDIDATE_ONLY_PARTIAL');
assert.equal((await run({change:b=>b[2].resources.bindings[2].text='changed-fake-value',expectedCode:1,expectedGets:5})).drift_observed,true);
const different=await run({change:b=>{b[2].resources.bindings[2].text='changed-fake-value';b[4].resources.bindings[2].text='changed-fake-value';b[2].resources.script.etag='different';b[4].resources.script.etag='different';},expectedCode:0});
assert.equal(different.normalized_config_equal,false);assert.equal(different.etag_equal,false);
await run({change:b=>{b[0].deployments[0].strategy='unknown';b[5].deployments[0].strategy='unknown';},expectedGets:1});
let clock=0,calls=0;
const deadlineRead=boundedReader({worker,account:'a'.repeat(32),token:secret,now:()=>clock,fetchImpl:async()=>{calls++;return new Response('{"success":true,"result":[]}',{headers:{'content-type':'application/json'}})}});
clock=120000;await assert.rejects(()=>deadlineRead('/deployments?page=1&per_page=10'),/budget/);assert.equal(calls,0);
const read=boundedReader({worker,account:'a'.repeat(32),token:secret,fetchImpl:async()=>new Response('{"success":true,"result":[]}',{headers:{'content-type':'application/json'}})});
for(let i=0;i<6;i++)await read('/deployments?page=1&per_page=10');
await assert.rejects(()=>read('/deployments?page=1&per_page=10'),/budget/);
assert.throws(()=>safeOutput({category:secret}),/output/);
assert.throws(()=>safeOutput({executor_sha:secret}),/output/);
assert.throws(()=>safeOutput({...awaitedOutput(),PRIVATE_UNKNOWN:secret}),/unknown_field/);
function awaitedOutput(){return {category:'STOPPED'}}
const script=readFileSync(new URL('../scripts/console_version_comparator.mjs',import.meta.url),'utf8');
assert.deepEqual([...script.matchAll(/method:\s*['"]([^'"]+)/g)].map(m=>m[1]),['GET']);
assert.match(script,/redirect: 'error'/);
const workflow=readFileSync(new URL('../.github/workflows/compare-console-versions.yml',import.meta.url),'utf8');
assert.deepEqual([...workflow.slice(workflow.indexOf('\non:'),workflow.indexOf('\npermissions:')).matchAll(/^  (\w+):/gm)].map(m=>m[1]),['workflow_dispatch']);
assert.equal((workflow.match(/runs-on:/g)||[]).length,1);
assert.match(workflow,/contents: read/);
assert.ok(!workflow.includes('vars.CLOUDFLARE_ACCOUNT_ID'), 'account binding must be a masked Secret in runner step headers');
assert.ok(!/secrets\.CLOUDFLARE_API_TOKEN\b|upload-artifact|wrangler|curl|sync_secrets|sync_strategy_profiles/.test(workflow));
console.log(`console version comparator: ${cases} provider cases and budget/output/static assertions passed`);

// Pin the copied primitives to the exact release source, including validation.
const release=readFileSync(new URL('../.github/workflows/deploy-strategy-switch-console.yml',import.meta.url),'utf8');
for(const [start,end] of [
 ['const canonical = value => JSON.stringify(value, function','let stage ='],
 ['function resources(version, id) {',"stage = 'pre_release_active'"],
 ['const comparable = value =>','const desired ='],
]) {
 const primitive=release.slice(release.indexOf(start),release.indexOf(end,release.indexOf(start))).split('\n').map(line=>line.trim()).join('\n').trim();
 assert.ok(script.split('\n').map(line=>line.trim()).join('\n').includes(primitive));
}

// Regression coverage for protected resource configuration and fractional budgets.
test('configured Worker identity is used only for the bounded request URL', async () => {
 const read = boundedReader({worker, account:'a'.repeat(32), token:secret, fetchImpl:async url => {
  assert.equal(new URL(url).pathname, '/client/v4/accounts/'+'a'.repeat(32)+'/workers/scripts/'+worker+'/versions');
  return new Response('{"success":true,"result":[]}',{headers:{'content-type':'application/json'}});
 }});
 await read('/versions?page=1&per_page=10');
});
test('missing or unsafe Worker identity fails before any request', async () => {
 for (const value of [undefined, '', 'bad/name', '../other', 'bad?name', 'bad#name', 'bad name', 'bad\nname', 'bad\n', 'bad\r\n', '-bad', 'a'.repeat(64)]) {
  assert.throws(()=>boundedReader({worker:value, account:'a'.repeat(32), token:secret, fetchImpl:()=>assert.fail('must not fetch')}), /configuration/);
  assert.equal((await run({envDelta:{CLOUDFLARE_WORKER_NAME:value},expectedGets:0})).category,'configuration');
 }
});
test('workflow passes the protected Worker binding', () => {
 assert.match(workflow, /CLOUDFLARE_WORKER_NAME: \$\{\{ secrets\.CLOUDFLARE_WORKER_NAME \}\}/);
});
test('fractional remaining budget issues a GET with integer timeout', async () => {
 for (const elapsed of [100000.25, 119999.75]) {
  let clock=0, calls=0;
  const read=boundedReader({worker,account:'a'.repeat(32),token:secret,now:()=>clock,fetchImpl:async()=>{
   calls++; return new Response('{"success":true,"result":[]}',{headers:{'content-type':'application/json'}});
  }});
  clock=elapsed;
  await read('/versions?page=1&per_page=10');
  assert.equal(calls,1);
 }
});
test('budget crossing between checks never supplies a negative timeout', async () => {
 const ticks=[0,119999.75,120000.25]; let timeout;
 const original=AbortSignal.timeout;
 AbortSignal.timeout=ms=>{ timeout=ms; return original(ms); };
 try {
  const read=boundedReader({worker,account:'a'.repeat(32),token:secret,now:()=>ticks.shift() ?? 120000.25,fetchImpl:async()=>new Response('{"success":true,"result":[]}',{headers:{'content-type':'application/json'}})});
  await assert.rejects(()=>read('/versions?page=1&per_page=10'),/budget/);
  assert.equal(timeout,0);
 } finally { AbortSignal.timeout=original; }
});
