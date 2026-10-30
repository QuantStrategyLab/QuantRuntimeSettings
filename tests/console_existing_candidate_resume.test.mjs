import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareCandidateResources,stagedEffectsEmpty,validateExistingCandidate,validatePostActivation,unchangedValidatedReadbacks,reviewedHandlerDelta} from '../scripts/console_existing_candidate_resume.mjs';
// These synthetic values exercise pure predicates. Later tests inject an offline
// transport to exercise activation control flow; no network or upload is used.
const resources=()=>({bindings:[{name:'STRATEGY_SWITCH_CONFIG',type:'kv_namespace',namespace_id:'1'.repeat(32)},
  {name:'STRATEGY_SWITCH_RUNTIME_INSTANCES',type:'durable_object_namespace',namespace_id:'2'.repeat(32),class_name:'RuntimeInstances'},
  {name:'SECRET',type:'secret_text'}],script_runtime:{compatibility_date:'2026-06-08',usage_model:'standard',migration_tag:'v1',compatibility_flags:[],limits:{cpu_ms:50}},
  script:{handlers:['fetch'],named_handlers:[{name:'RuntimeInstances',handlers:['fetch']}],placement_mode:null}});
test('invalid pre- and post-activation inputs fail closed',()=>{
 assert.deepEqual(validateExistingCandidate({},{}),{ok:false,reason:'resume_verification_failed'});
 assert.deepEqual(validateExistingCandidate(null,null),{ok:false,reason:'resume_verification_failed'});
 assert.deepEqual(validatePostActivation(null,null,null,'bad'),{ok:false,outcome:'ACTIVATION_REQUIRES_READBACK',retry:false});
});
test('resource predicates preserve bindings, runtime, handlers and tag gates',()=>{
 const a=resources(),b=structuredClone(a);delete b.script_runtime.migration_tag;
 let r=compareCandidateResources(a,b);assert.equal(r.shape_valid,true);assert.equal(r.config_equal,true);assert.equal(r.migration_tag_valid,true);
 for(const mutate of [x=>x.bindings[0].namespace_id='3'.repeat(32),x=>x.script_runtime.limits.cpu_ms=99,x=>x.script.handlers.push('scheduled'),x=>x.script.placement_mode='smart']){
  const changed=structuredClone(b);mutate(changed);r=compareCandidateResources(a,changed);assert.equal(r.config_equal,false);
 }
 for(const mutate of [x=>x.bindings[0].type='unrecognized',x=>x.bindings[2].text='private',x=>x.script_runtime.unexpected=true,x=>x.script.extra=true]){
  const changed=structuredClone(b);mutate(changed);assert.equal(compareCandidateResources(a,changed).shape_valid,false);
 }
 const wrong=structuredClone(b);wrong.script_runtime.migration_tag='new';assert.equal(compareCandidateResources(a,wrong).migration_tag_valid,false);
});
test('fingerprints detect named differences and other named metadata cannot be ignored',()=>{
 const a=resources(),b=structuredClone(a);b.script.named_handlers[0].handlers.push('researchNativeDailyReturns');
 let r=compareCandidateResources(a,b);assert.equal(r.config_equal,true);assert.equal(r.named_other_fields_equal,true);assert.notEqual(r.active_named_fingerprint,r.staged_named_fingerprint);
 b.script.named_handlers[0].unreviewed='private';r=compareCandidateResources(a,b);assert.equal(r.named_other_fields_equal,false);
 assert.doesNotMatch(JSON.stringify(r),/private|researchNativeDailyReturns/);
 const dupe=structuredClone(a);dupe.script.named_handlers.push(structuredClone(dupe.script.named_handlers[0]));assert.equal(compareCandidateResources(a,dupe).shape_valid,false);
});
test('candidate migration and export reconciliation reject nonempty or unknown forms',()=>{
 assert.equal(stagedEffectsEmpty(undefined,undefined),true);assert.equal(stagedEffectsEmpty({}, {created:[],warnings:[]}),true);
 for(const [m,e] of [[{new_tag:'v2'},undefined],[null,undefined],[{},null],[{},{created:['x']}],[{},{unknown:[]}]])assert.equal(stagedEffectsEmpty(m,e),false);
});
test('changed metadata or version lineage between validated reads fails the pure drift predicate',()=>{
 const first={activeResources:resources(),stagedResources:resources(),versions:['one','two']};
 assert.equal(unchangedValidatedReadbacks(first,structuredClone(first)),true);
 for(const mutate of [x=>x.activeResources.script_runtime.limits.cpu_ms=99,x=>x.stagedResources.bindings[0].namespace_id='3'.repeat(32),x=>x.versions.reverse()]){
  const next=structuredClone(first);mutate(next);assert.equal(unchangedValidatedReadbacks(first,next),false);
 }
});
test('reviewed semantic exception allows exactly the two additions and preserves all existing order',()=>{
 const before=[{name:'RuntimeInstances',handlers:['fetch']},{name:'__test',handlers:Array.from({length:97},(_,i)=>`method_${i}`)}];
 const after=structuredClone(before);after[1].handlers.push('effectiveAccountSettings','dispatchAccountDiagnosis');
 assert.equal(reviewedHandlerDelta(before,after),true);
 for(const change of [x=>x[1].handlers.reverse(),x=>x[0].handlers.push('unknown'),x=>x[1].handlers.push('unknown'),x=>x[1].handlers[0]='other',x=>x[0].extra='value',x=>x.push({name:'other',handlers:[]})]){
  const altered=structuredClone(after);change(altered);assert.equal(reviewedHandlerDelta(before,altered),false);
 }
});

test('resume activates only an already-staged exact synthetic candidate, rechecks, and never uploads',async()=>{
 const f=await resumeFixture();const result=await f.run();
 assert.equal(result.ok,true);assert.equal(result.upload_attempted,false);assert.equal(result.activation_attempted,true);
 assert.equal(result.version_id,f.staged);assert.equal(result.deployment_id,f.newDeployment);assert.equal(result.provider_cas,false);
 assert.equal(f.activations.length,1);assert.deepEqual(f.activations[0].versions,[{version_id:f.staged,percentage:100}]);
 assert.equal(f.calls.filter(x=>x==='deployment').length,6);
});
test('resume refuses mismatched identity, module, configuration, semantics, effects and preactivation drift before activation',async()=>{
 for(const option of ['requested','module','config','semantics','migration','export','activeDrift','latestDrift']){
  const f=await resumeFixture(option),r=await f.run();assert.equal(r.ok,false,option);assert.equal(r.activation_attempted,false,option);
  assert.equal(r.outcome,'NOT_ATTEMPTED',option);assert.equal(f.activations.length,0,option);
 }
});
test('resume never retries an ambiguous activation or a failed postcondition',async()=>{
 for(const option of ['activationThrows','postTag','postDrift']){
  const f=await resumeFixture(option),r=await f.run();assert.equal(r.ok,false,option);assert.equal(r.activation_attempted,true,option);
  assert.equal(r.outcome,'ACTIVATION_REQUIRES_READBACK',option);assert.equal(r.retry,false);assert.equal(f.activations.length,1,option);
 }
});
test('actual resume CLI exits cleanly without provider access for an unapproved candidate',async()=>{
 const {mkdtemp,writeFile,access,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');const {spawnSync}=await import('node:child_process');
 const temp=await mkdtemp(join(tmpdir(),'qrs-resume-cli-'));
 try{
  const candidate=join(temp,'candidate.js'),preload=join(temp,'deny.cjs'),sentinel=join(temp,'network-access');
  await writeFile(candidate,'synthetic candidate');
  await writeFile(preload,"globalThis.fetch=async()=>{require('node:fs').writeFileSync(process.env.QRS_NETWORK_SENTINEL,'attempted');throw Error('network denied');};\n");
  const entry=new URL('../scripts/console_full_bundle_release.mjs',import.meta.url);
  const result=spawnSync(process.execPath,[entry.pathname,'frontend','resume','3f87638d-482a-46c5-a859-279fa6ee7e6c','50aade1f-2a51-42ef-86b2-464d1b665c30',candidate],
   {encoding:'utf8',timeout:15000,env:{...process.env,CLOUDFLARE_API_TOKEN:'synthetic-cli-token',CLOUDFLARE_ACCOUNT_ID:'f'.repeat(32),NODE_OPTIONS:`--require=${preload}`,QRS_NETWORK_SENTINEL:sentinel}});
  assert.ifError(result.error);
  assert.equal(result.status,1,`unexpected CLI status ${result.status}; ${result.stderr}`);
  assert.ok(result.stdout.trim(),`missing CLI output: ${result.stderr}`);
  const output=JSON.parse(result.stdout.trim());assert.equal(output.ok,false);assert.equal(output.outcome,'NOT_ATTEMPTED');
  assert.equal(output.upload_attempted,false);assert.equal(output.activation_attempted,false);assert.equal(output.retry,false);
  assert.doesNotMatch(result.stdout+result.stderr,/unsettled top-level await|synthetic-cli-token/);
  await assert.rejects(()=>access(sentinel),{code:'ENOENT'});
 }finally{await rm(temp,{recursive:true,force:true});}
});

async function resumeFixture(option=''){
 // A transient in-memory copy substitutes synthetic pins solely for offline
 // tests. Production's fixed exported function accepts no policy override.
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const {describeNamedHandlers}=await import('../scripts/console_named_handler_metadata.mjs');
 const sha=b=>createHash('sha256').update(b).digest('hex'),old=Buffer.from('synthetic previous module'),next=Buffer.from('synthetic complete module');
 const oldNames=Array.from({length:97},(_,i)=>`method_${i}`);
 const activeNames=[{name:'RuntimeInstances',handlers:['fetch']},{name:'__test',handlers:oldNames}];
 const stagedNames=[{name:'RuntimeInstances',handlers:['fetch']},{name:'__test',handlers:[...oldNames,'effectiveAccountSettings','dispatchAccountDiagnosis']}];
 const fp=describeNamedHandlers(activeNames,stagedNames);
 const file=new URL('../scripts/console_existing_candidate_resume.mjs',import.meta.url),importUrl=new URL('../scripts/console_named_handler_metadata.mjs',import.meta.url).href;
 let source=await readFile(file,'utf8');
 for(const [from,to] of [['7b64da8edd2627175019e5c529f9eec048732ffb7acec502cdf4122fc0dbb06a',sha(old)],
  ['afe13eefe12d0e4f4db0f1bcfc515a2d3445963fd8f42ef8e5286c4062b6027d',sha(next)],
  ['f4c4460ae7772fc6dcffdd6a72258d1c6a84648176713173f89e4610014109f4',fp.active_sha256],
  ['e8c0303c3ee8f8fdbb1b4bbed9b41dbff901244c3718a0bb82950c25d8dc5df0',fp.staged_sha256]])source=source.replace(from,to);
 source=source.replace("'./console_named_handler_metadata.mjs'",JSON.stringify(importUrl));
 const {resumeExisting}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const active='3f87638d-482a-46c5-a859-279fa6ee7e6c',deployment='50aade1f-2a51-42ef-86b2-464d1b665c30',staged='0f361edb-737b-4f27-9159-a275270fd5b5',newDeployment='11111111-1111-4111-8111-111111111111';
 let activated=false,reads=0,versionReads=0;const activations=[],calls=[];
 const base=resources();base.script.named_handlers=activeNames;
 const api={
  async deployments(){calls.push('deployment');reads++;let id=activated?newDeployment:deployment,version=activated?staged:active;
   if(option==='activeDrift'&&reads===3)version=staged;if(option==='postDrift'&&activated&&reads>=4)id=deployment;
   return {deployments:[{id,strategy:'percentage',versions:[{version_id:version,percentage:100}]}]};},
  async versions(){calls.push('versions');versionReads++;return {items:(option==='latestDrift'&&versionReads===3?[active,staged]:[staged,active]).map(id=>({id}))};},
  async betaVersion(id){calls.push('beta');const isStage=id===staged,bytes=isStage?(option==='module'?old:next):old;
   const result={id,modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:bytes.toString('base64')}]};
   if(isStage&&option==='migration')result.migrations={new_tag:'v2'};if(isStage&&option==='export')result.exports_reconciliation={created:['private']};return result;},
  async scriptVersion(id){calls.push('script');const out=structuredClone(base);if(id===staged){out.script.named_handlers=structuredClone(stagedNames);
    if(!activated||option==='postTag')delete out.script_runtime.migration_tag;
    if(option==='semantics')out.script.named_handlers[1].handlers.reverse();if(option==='config')out.script_runtime.limits.cpu_ms=99;}
   return {id,resources:out};},
  async activate(body){calls.push('activate');activations.push(body);if(option==='activationThrows')throw Error('private');activated=true;return {id:newDeployment};},
 };
 Object.defineProperty(api,'upload',{get(){throw Error('upload must not be accessed');}});
 return {staged,newDeployment,activations,calls,run:()=>resumeExisting(api,next,{version:option==='requested'?staged:active,deployment})};
}
