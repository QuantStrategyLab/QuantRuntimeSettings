import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {POLICY,createPreflightApi,pinned,preflight,release} from '../scripts/console_m09_release.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const old=Buffer.from('old'),candidate=Buffer.from('candidate');
const version='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',deployment='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const policy={source:'a'.repeat(40),tree:'b'.repeat(40),frontendBlob:'c'.repeat(40),before:hash(old),candidate:hash(candidate),version,deployment,rollback:version};
const evidence={source:policy.source,tree:policy.tree,frontendBlob:policy.frontendBlob};
function fixture(){
 const calls=[];let uploaded=false,activated=false,body;
 const next='cccccccc-cccc-4ccc-8ccc-cccccccccccc',dep='dddddddd-dddd-4ddd-8ddd-dddddddddddd',latest='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 const bindings=[{name:'STRATEGY_SWITCH_CONFIG',type:'kv_namespace',namespace_id:'1'.repeat(32)},
 {name:'STRATEGY_SWITCH_RUNTIME_INSTANCES',type:'durable_object_namespace',namespace_id:'2'.repeat(32),class_name:'RuntimeInstances'}, {name:'SECRET',type:'secret_text'}];
 const api={
  async deployments(){calls.push('deployments');return {deployments:[{id:activated?dep:deployment,strategy:'percentage',versions:[{version_id:activated?next:version,percentage:100}]}]};},
  async versions(){calls.push('versions');return {items:(uploaded?[next,latest]:[latest,version]).map(id=>({id}))};},
  async betaVersion(id){calls.push('module');return {id,modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:(id===next?candidate:old).toString('base64')}]};},
  async scriptVersion(id){calls.push('config');return {id,resources:{bindings,script_runtime:{compatibility_date:'2026-06-08',usage_model:'standard',migration_tag:'tag'},script:{handlers:['fetch']}}};},
  async upload(value){calls.push('upload');body=value;uploaded=true;return {id:next};},
  async activate(){calls.push('activate');activated=true;return {id:dep};}
 };
 return {api,calls,get body(){return body},bindings};
}
test('unbound real entry fails before provider or file access',()=>{
 assert.equal(pinned(POLICY),false);
 const p=spawnSync(process.execPath,['scripts/console_m09_release.mjs','release','nonexistent'],{encoding:'utf8'});
 assert.equal(p.status,1);assert.match(p.stderr,/hold_or_input_invalid/);
});
test('pins, rollback, source, tree, frontend and artifact must match before provider access',async()=>{
 for(const [p,e,c] of [[POLICY,evidence,candidate],[{...policy,rollback:'ffffffff-ffff-4fff-8fff-ffffffffffff'},evidence,candidate],
  [policy,{...evidence,source:'d'.repeat(40)},candidate],[policy,{...evidence,tree:'d'.repeat(40)},candidate],
  [policy,{...evidence,frontendBlob:'d'.repeat(40)},candidate],[policy,evidence,old]]) {
  const f=fixture();const r=await release({api:f.api,policy:p,evidence:e,candidate:c,release:true});
  assert.equal(r.ok,false);assert.deepEqual(f.calls,[]);
 }
});
test('synthetic release inherits active config and verifies exact module around activation',async()=>{
 const f=fixture();const r=await release({api:f.api,policy,evidence,candidate,release:true});
 assert.equal(r.ok,true);assert.equal(r.active_verified,true);assert.equal(r.provider_cas,false);
 assert.deepEqual(f.body.bindings,f.bindings.map(b=>({type:'inherit',name:b.name,version_id:version})));
 assert.equal(f.body.modules[0].content_base64,candidate.toString('base64'));
 assert.equal(f.calls.filter(x=>x==='upload').length,1);assert.equal(f.calls.filter(x=>x==='activate').length,1);
});

test('preflight reads active state with write pins unset and returns redacted evidence',async()=>{
 const f=fixture();
 const result=await preflight(f.api);
 assert.equal(result.ok,true);
 assert.equal(result.active.version_prefix,version.slice(0,8));
 assert.equal(result.module_sha256,hash(old));
 assert.equal(result.module_matches_reference,false);
 assert.equal(result.configuration.bindings.secret_text,1);
 assert.equal(result.configuration.candidate_provider_configuration_observed,false);
 assert.equal(result.rollback.eligible_after_release,false);
 assert.equal(result.hold,true);
 assert.doesNotMatch(JSON.stringify(result),/namespace_id|STRATEGY_SWITCH_CONFIG|SECRET|aaaaaaaa-aaaa/);
 assert.deepEqual(f.calls,['deployments','versions','module','config','deployments','versions']);
});

test('preflight stops on split traffic or changed deployment',async()=>{
 const split=fixture();
 split.api.deployments=async()=>({deployments:[{id:deployment,strategy:'percentage',
   versions:[{version_id:version,percentage:99},{version_id:deployment,percentage:1}]}]});
 const splitResult=await preflight(split.api);
 assert.equal(splitResult.stage,'traffic');
 assert.equal(splitResult.traffic.length,2);
 assert.deepEqual(split.calls,[]);
 const drift=fixture();
 const read=drift.api.deployments;
 drift.api.deployments=async()=>{
   const value=await read();
   if(drift.calls.length>1)value.deployments[0].id=version;
   return value;
 };
 assert.equal((await preflight(drift.api)).stage,'recheck');
 assert.ok(!drift.calls.includes('upload')&&!drift.calls.includes('activate'));
});

test('preflight adapter exposes only the fixed read methods',async()=>{
 const f=fixture();
 const api=createPreflightApi(f.api);
 assert.deepEqual(Object.keys(api).sort(),['betaVersion','deployments','scriptVersion','versions']);
 assert.equal(api.upload,undefined);
 assert.equal(api.activate,undefined);
 assert.equal((await preflight(api)).ok,true);
 assert.deepEqual(f.calls,['deployments','versions','module','config','deployments','versions']);
});
