import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFixedApi,runBackendRelease} from '../scripts/console_946_backend_release.mjs';
const prior='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',latest='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cand='cccccccc-cccc-4ccc-8ccc-cccccccccccc',dep='dddddddd-dddd-4ddd-8ddd-dddddddddddd',newDep='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const old=Buffer.from('synthetic old'),next=Buffer.from('synthetic new');
const binding=[{name:'STRATEGY_SWITCH_CONFIG',type:'kv_namespace',namespace_id:'1'.repeat(32)},
  {name:'STRATEGY_SWITCH_RUNTIME_INSTANCES',type:'durable_object_namespace',namespace_id:'2'.repeat(32),class_name:'RuntimeInstances'},
  {name:'PRIVATE_SECRET',type:'secret_text'},{name:'PUBLIC_FLAG',type:'plain_text',text:'synthetic'}];
const makeResources=(id,tag='tag-old')=>({id,resources:{bindings:structuredClone(binding),script_runtime:{compatibility_date:'2026-06-08',usage_model:'standard',compatibility_flags:[],limits:{cpu_ms:50},...(tag===null?{}:{migration_tag:tag})},script:{etag:id,handlers:['fetch'],named_handlers:[],placement_mode:null}}});
const moduleFor=(id,bytes)=>({id,modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:bytes.toString('base64')}]});
function scenario(opt={}){
  const calls=[];let uploaded=false,deployed=false,readActive=0,readPrior=0,readCandidate=0;let uploadedBody;
  const api={
    async deployments(){calls.push('deployments');readActive++;if(opt.throwRecovery&&readActive>2)throw Error('private');
      if(opt.driftBeforeUpload&&readActive===2)return {deployments:[{id:newDep,strategy:'percentage',versions:[{version_id:latest,percentage:100}]}]};
      if(opt.driftBeforeActivate&&readActive===3)return {deployments:[{id:newDep,strategy:'percentage',versions:[{version_id:latest,percentage:100}]}]};
      return {deployments:[{id:deployed?newDep:dep,strategy:'percentage',versions:[{version_id:deployed?cand:prior,percentage:100}]}]};},
    async versions(){calls.push('versions');return {items:(uploaded?(opt.latestDrift?[latest,cand]:[cand,latest]):[latest,prior]).map(id=>({id}))};},
    async scriptVersion(id){calls.push(id===prior?'prior_config':'candidate_config');
      if(id===prior){readPrior++;const x=makeResources(prior);if(opt.configDrift&&readPrior===3)x.resources.script_runtime.limits.cpu_ms=99;return x;}
      readCandidate++;const tag=opt.badCandidateTag?'wrong':deployed?(opt.missingFinalTag?null:'tag-old'):null;
      return makeResources(cand,tag);},
    async betaVersion(id){calls.push(id===prior?'prior_module':'candidate_module');const x=moduleFor(id,id===prior?old:(opt.badBytes?Buffer.from('different'):next));if(id===prior&&opt.historicalMigration)x.migrations={old_tag:'historical',new_tag:'tag-old'};if(id===cand&&opt.migration)x.migrations={new_tag:'not-allowed'};if(id===cand&&opt.exportChange)x.exports_reconciliation={updated:['private-class']};if(id===cand&&opt.unknownExport)x.exports_reconciliation={unrecognized:['private-class']};if(id===cand&&opt.emptyReconciliation)x.exports_reconciliation={created:[],deleted:[],renamed:[],transferred:[],transfer_pending:[],updated:[],removable_entries:[],info:[],warnings:[]};return x;},
    async upload(body){calls.push('upload');uploadedBody=body;if(opt.uploadThrows)throw Error('synthetic private response');uploaded=true;return {id:cand};},
    async activate(body){calls.push('activate');assert.equal(body.versions[0].version_id,cand);if(opt.activateThrows)throw Error('synthetic private response');deployed=true;return {id:newDep};},
  };
  return {api,calls,get body(){return uploadedBody}};
}
async function run(opt={}){const f=scenario(opt);const result=await runBackendRelease(f.api,async input=>{assert.deepEqual(input,old);if(opt.patchThrows)throw Error('synthetic private content');return next},async input=>{assert.deepEqual(input,next);if(opt.runtimeThrows)throw Error('synthetic runtime')});return {f,result};}

test('explicitly inherits the active version and proves the candidate before and after activation',async()=>{
  const {f,result}=await run();assert.equal(result.ok,true);assert.equal(result.candidate_tag_observed_before_activation,false);assert.equal(result.post_tag_equal,true);assert.equal(result.binding_metadata_equal,true);assert.equal(result.explicit_active_binding_inheritance,true);assert.equal(result.version_configuration_equal,true);assert.equal(result.secret_values_read,false);
  assert.deepEqual(f.body.bindings,binding.map(b=>({type:'inherit',name:b.name,version_id:prior})));
  assert.ok(!Object.hasOwn(f.body,'migrations'));assert.ok(!Object.hasOwn(f.body,'migration_tag'));
  assert.ok(!JSON.stringify(f.body).includes('synthetic"'));assert.equal(f.body.modules[0].content_base64,next.toString('base64'));
  assert.equal(f.calls.filter(x=>x==='upload').length,1);assert.equal(f.calls.filter(x=>x==='activate').length,1);
  assert.ok(f.calls.lastIndexOf('versions')<f.calls.indexOf('activate'));assert.ok(f.calls.lastIndexOf('candidate_module')>f.calls.indexOf('activate'));
});
test('a deployed baseline may contain historical migrations',async()=>{assert.equal((await run({historicalMigration:true})).result.ok,true)});
test('empty export reconciliation is accepted without exposing contents',async()=>{assert.equal((await run({emptyReconciliation:true})).result.ok,true)});
test('candidate verification, baseline or active failures cannot upload',async()=>{
  for(const opt of [{patchThrows:true},{runtimeThrows:true},{driftBeforeUpload:true}]){
    const {f,result}=await run(opt);assert.equal(result.ok,false);assert.equal(result.upload_attempted,false);assert.ok(!f.calls.includes('upload'));assert.ok(!f.calls.includes('activate'));
  }
});
test('candidate drift, migration, lineage, config or active change cannot activate',async()=>{
  for(const opt of [{badBytes:true},{badCandidateTag:true},{migration:true},{exportChange:true},{unknownExport:true},{latestDrift:true},{configDrift:true},{driftBeforeActivate:true}]){
    const {f,result}=await run(opt);assert.equal(result.ok,false);assert.equal(result.upload_attempted,true);assert.equal(result.deploy_attempted,false);assert.ok(!f.calls.includes('activate'));
  }
});
test('unknown writes are never repeated or rolled back and only read-only recovery follows',async()=>{
  for(const opt of [{uploadThrows:true},{activateThrows:true},{missingFinalTag:true}]){
    const {f,result}=await run(opt);assert.equal(result.ok,false);assert.equal(f.calls.filter(x=>x==='upload').length,1);
    assert.ok(f.calls.filter(x=>x==='activate').length<=1);assert.equal(result.retry,false);
    assert.equal(f.calls.at(-1),'deployments');if(opt.uploadThrows)assert.equal(result.recovery.candidate_active,null);assert.doesNotMatch(JSON.stringify(result),/synthetic private|aaaaaaaa|cccccccc/);
  }
});

test('provider transport uses only fixed Worker routes, methods and non-force activation',async()=>{
  const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID,original=globalThis.fetch,calls=[];
  process.env.CLOUDFLARE_API_TOKEN='synthetic-token';process.env.CLOUDFLARE_ACCOUNT_ID='f'.repeat(32);
  globalThis.fetch=async(url,options)=>{calls.push({url,method:options.method});return Response.json({success:true,result:{},errors:[]});};
  try{
    const api=createFixedApi();await api.deployments();await api.versions();await api.scriptVersion(prior);await api.betaVersion(prior);
    await api.upload({synthetic:true});await api.activate({synthetic:true});
    assert.deepEqual(calls.map(x=>x.method),['GET','GET','GET','GET','POST','POST']);
    assert.ok(calls.every(x=>x.url.startsWith('https://api.cloudflare.com/client/v4/accounts/'+ 'f'.repeat(32) +'/workers/')));
    assert.ok(calls[3].url.endsWith('/versions/'+prior+'?include=modules'));
    assert.ok(calls[4].url.endsWith('/versions?deploy=false'));
    assert.ok(calls[5].url.endsWith('/deployments?force=false'));
    assert.throws(()=>api.betaVersion('../other'));
    assert.equal(calls.length,6);
  }finally{
    globalThis.fetch=original;
    if(token===undefined)delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=token;
    if(account===undefined)delete process.env.CLOUDFLARE_ACCOUNT_ID;else process.env.CLOUDFLARE_ACCOUNT_ID=account;
  }
});
