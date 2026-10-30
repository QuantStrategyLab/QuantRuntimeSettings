import {test} from 'node:test';
import assert from 'node:assert/strict';
import {candidateHashAvailable,fixedApi,run958,runSyntheticTest,validateRegression} from '../scripts/console_958_publish.mjs';
const dep='7bc41232-5b83-4e46-b220-8fe912f3234f',version='2ee87f0f-d07f-436f-9d54-f311ba37923b';
const good=()=>({deployments:[{id:dep,strategy:'percentage',versions:[{version_id:version,percentage:100}]}]});
const flags=['dry_run_selection','missing_or_live_mode_excluded','wrong_domain_excluded','ordinary_live_policy_retained','legacy_continuity_preserved','frozen_choice_and_draft','frozen_direct_policy','account_settings_http','continuity_http_guards','admin_frozen_choices'];
test('unavailable final hash blocks all provider calls',async(t)=>{
 if(candidateHashAvailable()){t.skip('final hash is available');return;}
 let calls=0;const api=new Proxy({}, {get(){calls++;throw Error('api called')}});
 const result=await run958({api,ts:null,baseline:null});
 assert.deepEqual(result,{ok:false,reason:'candidate_sha_unavailable',upload_attempted:false,deploy_attempted:false});assert.equal(calls,0);
});
test('fixed deployment and version required before activation',async()=>{
 for(const altered of [{deployments:[]},{deployments:[{id:'bad',versions:[{version_id:version,percentage:100}]}]},
  {deployments:[{id:dep,versions:[{version_id:'bad',percentage:100}]}]},
  {deployments:[{id:dep,versions:[{version_id:version,percentage:99}]}]}]){
  await assert.rejects(fixedApi({deployments:async()=>altered}).deployments());
 }
 assert.deepEqual(await fixedApi({deployments:async()=>good()}).deployments(),good());
});
test('only annotations change and failure after activation permits recovery readback',async()=>{
 let upload,activation,reads=0;const api=fixedApi({deployments:async()=>{reads++;return reads===1?good():{deployments:[]}},
  upload:async body=>{upload=body},activate:async body=>{activation=body;throw Error('synthetic')}});
 await api.deployments();await api.upload({bindings:[{type:'inherit',name:'synthetic'}],modules:['synthetic'],annotations:{old:'old'}});
 await assert.rejects(api.activate({strategy:'percentage',versions:[{version_id:version,percentage:100}],annotations:{old:'old'}}));
 assert.deepEqual(await api.deployments(),{deployments:[]});
 assert.deepEqual(upload.bindings,[{type:'inherit',name:'synthetic'}]);assert.deepEqual(upload.modules,['synthetic']);
 assert.equal(upload.annotations['workers/message'],'Reviewed dry-run selector and frozen-policy compatibility');
 assert.deepEqual(activation.versions,[{version_id:version,percentage:100}]);assert.deepEqual(activation.annotations,upload.annotations);
});
test('all exact synthetic regressions are mandatory',()=>{
 const good=Object.fromEntries(flags.map(k=>[k,true]));validateRegression(good);
 for(const flag of flags)assert.throws(()=>validateRegression({...good,[flag]:false}));
 assert.throws(()=>validateRegression({...good,extra:true}));assert.throws(()=>validateRegression(null));
});

const next='cccccccc-cccc-4ccc-8ccc-cccccccccccc',newDep='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',latest='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const binding=[{name:'STRATEGY_SWITCH_CONFIG',type:'kv_namespace',namespace_id:'1'.repeat(32)},
 {name:'STRATEGY_SWITCH_RUNTIME_INSTANCES',type:'durable_object_namespace',namespace_id:'2'.repeat(32),class_name:'RuntimeInstances'},
 {name:'PRIVATE_SECRET',type:'secret_text'},{name:'PUBLIC_FLAG',type:'plain_text',text:'synthetic'}];
const resources=(id,tag='old-tag')=>({id,resources:{bindings:structuredClone(binding),script_runtime:{compatibility_date:'2026-06-08',usage_model:'standard',compatibility_flags:[],migration_tag:tag},script:{etag:id,handlers:['fetch'],named_handlers:[],placement_mode:null}}});
const moduleFor=(id,b)=>({id,modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:Buffer.from(b).toString('base64')}]});
function fakeProvider(opt={}){
 let uploaded=false,activated=false,reads=0;const calls=[];let body,activation;
 const api={
  async deployments(){calls.push('deployments');reads++;if(opt.driftBeforeUpload&&reads===2)return {deployments:[]};return {deployments:[{id:activated?newDep:dep,strategy:'percentage',versions:[{version_id:activated?next:version,percentage:100}]}]}},
  async versions(){calls.push('versions');return {items:(uploaded?[next,latest]:[latest,version]).map(id=>({id}))}},
  async scriptVersion(id){calls.push('config');return resources(id)},
  async betaVersion(id){calls.push('module');return moduleFor(id,id===version?'synthetic old':'synthetic new')},
  async upload(payload){calls.push('upload');body=payload;if(opt.unknownUpload)throw Error('synthetic private');uploaded=true;return {id:next}},
  async activate(payload){calls.push('activate');activation=payload;if(opt.unknownActivate)throw Error('synthetic private');activated=true;return {id:newDep}},
 };
 return {api,calls,get body(){return body},get activation(){return activation}};
}
const goodResult=()=>Object.fromEntries(flags.map(k=>[k,true]));
async function fakeRun(options={}){
 const originalToken=process.env.CLOUDFLARE_API_TOKEN,originalAccount=process.env.CLOUDFLARE_ACCOUNT_ID;
 process.env.CLOUDFLARE_API_TOKEN='synthetic-token';process.env.CLOUDFLARE_ACCOUNT_ID='synthetic-account';
 const f=fakeProvider(options);const trace=[];
 try{
  const result=await runSyntheticTest({api:f.api,corruptCandidate:options.corruptCandidate,
   regression:async bytes=>{trace.push('freeze');assert.equal(bytes.toString(),'synthetic new');assert.equal(process.env.CLOUDFLARE_API_TOKEN,undefined);assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID,undefined);return options.badFreeze?{...goodResult(),frozen_direct_policy:false}:goodResult()},
   regression946:async bytes=>{trace.push('946');assert.equal(bytes.toString(),'synthetic new');assert.equal(process.env.CLOUDFLARE_API_TOKEN,undefined);return {ok:!options.bad946}}});
  return {f,result,trace};
 }finally{
  if(originalToken===undefined)delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=originalToken;
  if(originalAccount===undefined)delete process.env.CLOUDFLARE_ACCOUNT_ID;else process.env.CLOUDFLARE_ACCOUNT_ID=originalAccount;
 }
}
test('fixed synthetic hash goes through both regressions and the real state machine',async()=>{
 const {f,result,trace}=await fakeRun();assert.equal(result.ok,true);assert.deepEqual(trace,['freeze','946']);
 assert.deepEqual(f.body.bindings,binding.map(b=>({type:'inherit',name:b.name,version_id:version})));
 assert.equal(f.body.modules[0].content_base64,Buffer.from('synthetic new').toString('base64'));
 assert.equal(f.body.annotations['workers/message'],'Reviewed dry-run selector and frozen-policy compatibility');
 assert.deepEqual(f.activation.annotations,f.body.annotations);assert.equal(f.calls.filter(x=>x==='upload').length,1);assert.equal(f.calls.filter(x=>x==='activate').length,1);
});
test('invalid candidate or failing regressions and drift do not upload',async()=>{
 for(const opt of [{corruptCandidate:true},{badFreeze:true},{bad946:true},{driftBeforeUpload:true}]){
  const {f,result}=await fakeRun(opt);assert.equal(result.ok,false);assert.equal(result.upload_attempted,false);assert.ok(!f.calls.includes('upload'));assert.ok(!f.calls.includes('activate'));
 }
});
test('unknown provider writes are never retried and recovery reads are attempted',async()=>{
 for(const opt of [{unknownUpload:true},{unknownActivate:true}]){
  const {f,result}=await fakeRun(opt);assert.equal(result.ok,false);assert.equal(result.retry,false);assert.equal(f.calls.filter(x=>x==='upload').length,1);
  assert.equal(f.calls.at(-1),'deployments');assert.equal(result.recovery.readback_available,true);assert.ok(f.calls.filter(x=>x==='activate').length<=1);
  assert.doesNotMatch(JSON.stringify(result),/synthetic private|synthetic-token|synthetic-account/);
 }
});
