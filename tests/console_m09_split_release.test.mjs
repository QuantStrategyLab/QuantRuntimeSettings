import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {uploadOnly,activateOnly} from '../scripts/console_m09_split_release.mjs';
import {POLICY} from '../scripts/console_m09_release.mjs';
import {config} from '../scripts/console_946_backend_release.mjs';
const digest=x=>createHash('sha256').update(x).digest('hex');
const old=Buffer.from('old fixture'),candidate=Buffer.from('new fixture');
const active='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',deployment='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',staged='cccccccc-cccc-4ccc-8ccc-cccccccccccc',next='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const baseResources={bindings:[{name:'STRATEGY_SWITCH_CONFIG',type:'kv_namespace',namespace_id:'1'.repeat(32)},{name:'STRATEGY_SWITCH_RUNTIME_INSTANCES',type:'durable_object_namespace',namespace_id:'2'.repeat(32),class_name:'RuntimeInstances'},{name:'SECRET',type:'secret_text'}],script_runtime:{compatibility_date:'2026-06-08',usage_model:'standard',migration_tag:'v1'},script:{handlers:['fetch']}};
const policy={source:'1'.repeat(40),tree:'2'.repeat(40),frontendBlob:'3'.repeat(40),before:digest(old),candidate:digest(candidate),version:active,deployment,rollback:active,
 configuration_sha256:digest(config(baseResources)),migration_tag_sha256:digest('v1')};
const evidence={source:policy.source,tree:policy.tree,frontendBlob:policy.frontendBlob};
function fixture(){
 let uploaded=false,activated=false,uploads=0,activations=0;
 const api={deployments:async()=>({deployments:[{id:activated?next:deployment,strategy:'percentage',versions:[{version_id:activated?staged:active,percentage:100}]}]}),
 versions:async()=>({items:(uploaded?[staged,active]:[active]).map(id=>({id}))}),
 betaVersion:async id=>({id,modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:(id===staged?candidate:old).toString('base64')}]}),
 scriptVersion:async id=>({id,resources:structuredClone(baseResources)}),
 upload:async()=>{uploads++;uploaded=true;return {id:staged};},activate:async()=>{activations++;activated=true;return {id:next};}};
 return {api,counts:()=>({uploads,activations})};
}
test('separate phases verify readback and use only their own write capability',async()=>{
 const f=fixture(), args={api:f.api,policy,evidence,candidate};
 const first=await uploadOnly(args);assert.equal(first.result.ok,true);assert.deepEqual(f.counts(),{uploads:1,activations:0});
 assert.doesNotMatch(JSON.stringify(first.result),new RegExp(staged+'|'+active));
 Object.defineProperty(f.api,'upload',{get(){throw Error('provider upload must never be read');}});
 const second=await activateOnly({...args,receipt:first.receipt});assert.equal(second.result.ok,true);assert.equal(second.result.upload_attempted,false);
 assert.equal(second.receipt.successorVersion,staged);assert.equal(second.receipt.successorDeployment,next);
 assert.deepEqual(f.counts(),{uploads:1,activations:1});assert.doesNotMatch(JSON.stringify(second.result),new RegExp(staged+'|'+next));
});
test('closed hold and bad provenance make no provider call',async()=>{
 const api=new Proxy({},{get(){throw Error('provider called');}});
 assert.equal((await uploadOnly({api,policy:POLICY,evidence,candidate})).result.ok,false);
 assert.equal((await uploadOnly({api,policy,evidence:{...evidence,tree:'4'.repeat(40)},candidate})).result.ok,false);
 assert.equal((await activateOnly({api,policy,evidence,candidate,receipt:{}})).result.ok,false);
});
test('changed staged bytes or current version order stop activation',async()=>{
 for(const change of ['bytes','versions','traffic','config']){
  const f=fixture(),args={api:f.api,policy,evidence,candidate},first=await uploadOnly(args);assert.equal(first.result.ok,true);
  if(change==='bytes')f.api.betaVersion=async id=>({id,modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:old.toString('base64')}]});
  if(change==='versions')f.api.versions=async()=>({items:[{id:active},{id:staged}]});
  if(change==='traffic')f.api.deployments=async()=>({deployments:[]});
  if(change==='config'){const original=f.api.scriptVersion;f.api.scriptVersion=async id=>{const out=await original(id);if(id===staged)out.resources.script_runtime.usage_model='unbound';return out;};}
  const {result:r,receipt:successor}=await activateOnly({...args,receipt:first.receipt});assert.equal(r.ok,false,change);assert.equal(r.upload_attempted,false);assert.equal(r.outcome,'NOT_ATTEMPTED');assert.equal(successor,undefined);assert.equal(f.counts().activations,0);
 }
});
test('unverified uploaded candidate produces no receipt and cannot activate',async()=>{
 const f=fixture(),original=f.api.betaVersion;
 f.api.betaVersion=async id=>id===staged?{id,modules:[]}:original(id);
 const out=await uploadOnly({api:f.api,policy,evidence,candidate});
 assert.equal(out.result.ok,false);assert.equal(out.result.upload_attempted,true);assert.equal(out.result.deploy_attempted,false);
 assert.equal(out.result.outcome,'UPLOAD_REQUIRES_READBACK');assert.equal(out.receipt,undefined);assert.deepEqual(f.counts(),{uploads:1,activations:0});
});
test('activation failure reports only the provider activation attempt',async()=>{
 const f=fixture(),args={api:f.api,policy,evidence,candidate},first=await uploadOnly(args);
 f.api.activate=async()=>{throw Error('provider failure');};
 const {result,receipt}=await activateOnly({...args,receipt:first.receipt});
 assert.equal(result.ok,false);assert.equal(result.upload_attempted,false);assert.equal(result.deploy_attempted,true);
 assert.equal(result.outcome,'ACTIVATION_REQUIRES_READBACK');assert.equal(receipt,undefined);
});
test('captured configuration and migration drift stop each phase before its write',async()=>{
 for(const field of ['configuration','migration']){
  const change=api=>{const original=api.scriptVersion;api.scriptVersion=async id=>{const v=await original(id);
   if(id===active){if(field==='configuration')v.resources.script_runtime.usage_model='unbound';else v.resources.script_runtime.migration_tag='v2';}return v;};};
  const upload=fixture();change(upload.api);
  const before=await uploadOnly({api:upload.api,policy,evidence,candidate});
  assert.equal(before.result.ok,false);assert.deepEqual(upload.counts(),{uploads:0,activations:0});
  const activate=fixture(),args={api:activate.api,policy,evidence,candidate};
  const stagedResult=await uploadOnly(args);assert.equal(stagedResult.result.ok,true);
  change(activate.api);
  const after=await activateOnly({...args,receipt:stagedResult.receipt});
  assert.equal(after.result.ok,false);assert.deepEqual(activate.counts(),{uploads:1,activations:0});
 }
});
test('missing digest or a mismatched receipt is rejected before provider access',async()=>{
 const api=new Proxy({},{get(){throw Error('provider called');}});
 assert.equal((await uploadOnly({api,policy:{...policy,configuration_sha256:undefined},evidence,candidate})).result.ok,false);
 const f=fixture(),args={api:f.api,policy,evidence,candidate};
 const stagedResult=await uploadOnly(args);
 const receipt={...stagedResult.receipt,migration_tag_sha256:'0'.repeat(64)};
 assert.equal((await activateOnly({api,policy,evidence,candidate,receipt})).result.ok,false);
});
