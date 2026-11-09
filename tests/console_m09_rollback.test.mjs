import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {config} from '../scripts/console_946_backend_release.mjs';
import {uploadOnly,activateOnly} from '../scripts/console_m09_split_release.mjs';
import {rollback} from '../scripts/console_m09_rollback.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const prior='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',deployment='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 staged='cccccccc-cccc-4ccc-8ccc-cccccccccccc',successor='dddddddd-dddd-4ddd-8ddd-dddddddddddd',restored='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const old=Buffer.from('prior module'),candidate=Buffer.from('candidate module');
const base={bindings:[{name:'STRATEGY_SWITCH_CONFIG',type:'kv_namespace',namespace_id:'1'.repeat(32)},
 {name:'STRATEGY_SWITCH_RUNTIME_INSTANCES',type:'durable_object_namespace',namespace_id:'2'.repeat(32),class_name:'RuntimeInstances'}],
 script_runtime:{compatibility_date:'2026-06-08',usage_model:'standard',migration_tag:'v1'},script:{handlers:['fetch']}};
const policy={source:'1'.repeat(40),tree:'2'.repeat(40),frontendBlob:'3'.repeat(40),before:sha(old),candidate:sha(candidate),
 version:prior,deployment,rollback:prior,configuration_sha256:sha(config(base)),migration_tag_sha256:sha('v1')};
const evidence={source:policy.source,tree:policy.tree,frontendBlob:policy.frontendBlob};
function fixture(){
 let uploaded=false,current={deployment,version:prior},uploads=0,activations=0,drift=null;
 const api={deployments:async()=>({deployments:[{id:current.deployment,strategy:'percentage',versions:[{version_id:current.version,percentage:100}]}]}),
  versions:async()=>({items:(uploaded?[staged,prior]:[prior]).map(id=>({id}))}),
  betaVersion:async id=>({id,modules:[{name:'worker.js',content_type:'application/javascript+module',
   content_base64:(drift===`module:${id}`?Buffer.from('changed'):id===prior?old:candidate).toString('base64')}]}),
  scriptVersion:async id=>{const r=structuredClone(base);if(drift===`config:${id}`)r.script_runtime.usage_model='unbound';
   if(drift===`tag:${id}`)r.script_runtime.migration_tag='other';return {id,resources:r};},
  upload:async()=>{uploads++;uploaded=true;return {id:staged};},
  activate:async body=>{activations++;const version=body.versions[0].version_id;current={deployment:version===staged?successor:restored,version};return {id:current.deployment};}};
 return {api,counts:()=>({uploads,activations}),setDrift:value=>{drift=value;},setActive:value=>{current=value;}};
}
async function released(f){
 const args={api:f.api,policy,evidence,candidate},stage=await uploadOnly(args);assert.equal(stage.result.ok,true);
 const done=await activateOnly({...args,receipt:stage.receipt});assert.equal(done.result.ok,true);
 return done.receipt;
}
test('actual split successor receipt binds a verified rollback and protected outcome',async()=>{
 const f=fixture(),receipt=await released(f),out=await rollback({api:f.api,policy,receipt});
 assert.equal(out.result.ok,true);assert.deepEqual(f.counts(),{uploads:1,activations:2});
 assert.equal(out.receipt.rollbackVersion,prior);assert.equal(out.receipt.rollbackDeployment,restored);
 assert.doesNotMatch(JSON.stringify(out.result),new RegExp(prior+'|'+restored));
});
test('missing or mismatched receipt and policy reject before any provider access',async()=>{
 const f=fixture(),receipt=await released(f),api=new Proxy({},{get(){throw Error('provider read');}});
 for(const r of [{...receipt,successorVersion:prior},{...receipt,successorDeployment:null},
  {...receipt,migration_tag_sha256:'0'.repeat(64)},{...receipt,active:staged}])
  assert.equal((await rollback({api,policy,receipt:r})).result.deploy_attempted,false);
 assert.equal((await rollback({api,policy:{...policy,configuration_sha256:undefined},receipt})).result.deploy_attempted,false);
});
test('module, configuration and migration drift on either version prevent rollback',async()=>{
 for(const id of [prior,staged])for(const type of ['module','config','tag']){
  const f=fixture(),receipt=await released(f);f.setDrift(`${type}:${id}`);
  const out=await rollback({api:f.api,policy,receipt});
  assert.equal(out.result.outcome,'NOT_ATTEMPTED',`${type}:${id}`);assert.deepEqual(f.counts(),{uploads:1,activations:1});
 }
});
test('successor drift and unknown rollback response never retry',async()=>{
 const f=fixture(),receipt=await released(f);f.setActive({deployment:restored,version:staged});
 assert.equal((await rollback({api:f.api,policy,receipt})).result.outcome,'NOT_ATTEMPTED');assert.equal(f.counts().activations,1);
 const g=fixture(),receipt2=await released(g);let calls=0;g.api.activate=async()=>{calls++;throw Error('timeout');};
 const out=await rollback({api:g.api,policy,receipt:receipt2});
 assert.equal(out.result.outcome,'UNKNOWN');assert.equal(out.result.retry,false);assert.equal(calls,1);assert.equal(out.receipt,undefined);
});
test('last pre-write identity change stops, and failed readback is unknown',async()=>{
 const f=fixture(),receipt=await released(f),read=f.api.deployments;let reads=0;
 f.api.deployments=async()=>{const result=await read();if(++reads===2)result.deployments[0].id=restored;return result;};
 assert.equal((await rollback({api:f.api,policy,receipt})).result.outcome,'NOT_ATTEMPTED');
 assert.equal(f.counts().activations,1);
 const g=fixture(),receipt2=await released(g),read2=g.api.deployments;
 g.api.deployments=async()=>{const result=await read2();if(g.counts().activations===2)result.deployments[0].versions[0].percentage=90;return result;};
 const out=await rollback({api:g.api,policy,receipt:receipt2});
 assert.equal(out.result.outcome,'UNKNOWN');assert.equal(out.result.retry,false);assert.equal(g.counts().activations,2);assert.equal(out.receipt,undefined);
});
test('rollback CLI stays held before any credential or binding access',()=>{
 const script=fileURLToPath(new URL('../scripts/console_m09_rollback.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[script,'rollback'],{encoding:'utf8',env:{PATH:process.env.PATH}});
 assert.notEqual(result.status,0);assert.match(result.stderr,/"reason":"hold"/);assert.match(result.stderr,/"deploy_attempted":false/);
});
