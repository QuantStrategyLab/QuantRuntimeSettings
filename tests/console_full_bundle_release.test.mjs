import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execute,diagnose,describeNamedHandlers,POLICY} from '../scripts/console_full_bundle_release.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const old=Buffer.from('old fixture'),candidate=Buffer.from('new fixture');
const policy={before:hash(old),candidate:hash(candidate)};
const expected={version:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',deployment:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
function fixture(){
 const calls=[];
 const api={async deployments(){calls.push('deployments');return {deployments:[{id:expected.deployment,strategy:'percentage',versions:[{version_id:expected.version,percentage:100}]}]}},
 async betaVersion(id){calls.push('beta');return {id,modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:old.toString('base64')}]};},
 async scriptVersion(id){calls.push('script');return {id};},async upload(){calls.push('upload')},async activate(){calls.push('activate')}};
 return {api,calls};
}
test('fixed policies bind candidate and compatible recovery in both directions', async()=>{
 const { SNAPSHOT, RECOVERY_SNAPSHOT } = await import('../scripts/console_frontend_candidate_preflight.mjs');
 assert.equal(POLICY.frontend.before, RECOVERY_SNAPSHOT.bundleSha256);
 assert.equal(POLICY.frontend.candidate, SNAPSHOT.bundleSha256);
 assert.equal(POLICY.recovery.before, SNAPSHOT.bundleSha256);
 assert.equal(POLICY.recovery.candidate, RECOVERY_SNAPSHOT.bundleSha256);
});
test('preflight only reads the exact active identity and bytes',async()=>{
 const f=fixture(); const result=await execute({...f,policy,expected,candidate});
 assert.equal(result.ok,true);assert.equal(result.preflight,true);assert.deepEqual(f.calls,['deployments','beta','script','deployments']);
});
test('preflight returns only bounded non-secret configuration metadata with no writes',async()=>{
 const f=fixture();
 f.api.scriptVersion=async id=>{ f.calls.push('script'); return {id,resources:{bindings:[
  {name:'PRIVATE_BINDING_SENTINEL',type:'plain_text',text:'PRIVATE_TEXT_SENTINEL'},
  {name:'PRIVATE_JSON_SENTINEL',type:'json',json:{value:'PRIVATE_JSON_VALUE_SENTINEL'}},
  {name:'PRIVATE_SECRET_SENTINEL',type:'secret_text'},
  {name:'PRIVATE_KV_SENTINEL',type:'kv_namespace',namespace_id:'PRIVATE_NAMESPACE_SENTINEL'}],
  script_runtime:{compatibility_date:'2026-06-08',compatibility_flags:['nodejs_compat','PRIVATE_FLAG_SENTINEL'],usage_model:'standard',limits:{cpu_ms:50,other:'PRIVATE_LIMIT_SENTINEL'},migration_tag:'PRIVATE_TAG_SENTINEL',exports:{RuntimeInstances:{},PRIVATE_EXPORT_SENTINEL:{}}},
  script:{handlers:['fetch','PRIVATE_HANDLER_SENTINEL'],named_handlers:[{name:'RuntimeInstances',handlers:['fetch','PRIVATE_METHOD_SENTINEL']},{name:'PRIVATE_NAMED_SENTINEL',handlers:[]}],placement_mode:'PRIVATE_PLACEMENT_SENTINEL'}}}; };
 const r=await execute({...f,policy,expected,candidate});
 assert.equal(r.ok,true);assert.equal(r.upload_attempted,false);assert.equal(r.deploy_attempted,false);
 assert.deepEqual(f.calls,['deployments','beta','script','deployments']);
 const summary=r.configuration_summary;
 assert.equal(summary.available,true);assert.equal(summary.binding_count,4);assert.equal(summary.binding_types.secret_text,1);
 assert.equal(summary.compatibility_date,'2026-06-08');assert.equal(summary.compatibility_flags.nodejs_compat,true);
 assert.equal(summary.compatibility_flags.count,2);assert.equal(summary.limits.cpu_ms,50);
 assert.deepEqual(summary.migration_tag,{shape:'string',present:true});
 assert.equal(summary.exports.count,2);assert.equal(summary.exports.known.RuntimeInstances,1);
 assert.equal(summary.named_handlers.count,2);assert.equal(summary.named_handlers.handlers.fetch,1);
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_|SENTINEL/);
});
test('preflight does not misrepresent unavailable resource shape as a valid summary',async()=>{
 const f=fixture();const r=await execute({...f,policy,expected,candidate});
 assert.equal(r.ok,true);assert.deepEqual(r.configuration_summary,{available:false});
 assert.ok(!f.calls.includes('upload'));assert.ok(!f.calls.includes('activate'));
});
test('candidate substitution and active drift stop before any write',async()=>{
 for(const mutation of ['candidate','active','bytes','secondActive']){
  const f=fixture();let n=0;
  if(mutation==='active') f.api.deployments=async()=>({deployments:[]});
  if(mutation==='bytes') f.api.betaVersion=async id=>({id,modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:Buffer.from('other').toString('base64')}]});
  if(mutation==='secondActive'){const original=f.api.deployments;f.api.deployments=async()=>++n===2?{deployments:[]}:original();}
  const r=await execute({...f,policy,expected,candidate:mutation==='candidate'?old:candidate,release:true});
  assert.equal(r.ok,false);assert.ok(!f.calls.includes('upload'));assert.ok(!f.calls.includes('activate'));
 }
});
test('outer failures identify each pre-core read without exposing provider errors',async()=>{
 for(const stage of ['active_before','module','configuration','active_recheck']){
  for(const failure of ['throw','invalid']){
   const f=fixture();let deployments=0,coreCalled=false;
   const original=f.api.deployments;
   f.api.deployments=async()=>{
    deployments++;
    if((stage==='active_before'&&deployments===1)||(stage==='active_recheck'&&deployments===2)){
     if(failure==='throw')throw Error('PRIVATE_ERROR_SENTINEL');
     return {deployments:[{id:'PRIVATE_RESPONSE_SENTINEL'}]};
    }
    return original();
   };
   if(stage==='module') f.api.betaVersion=async()=>{if(failure==='throw')throw Error('PRIVATE_ERROR_SENTINEL');return {id:'PRIVATE_RESPONSE_SENTINEL'};};
   if(stage==='configuration') f.api.scriptVersion=async()=>{if(failure==='throw')throw Error('PRIVATE_ERROR_SENTINEL');return {id:'PRIVATE_RESPONSE_SENTINEL'};};
   const core=async()=>{coreCalled=true;throw Error('core must not run');};
   const r=await execute({...f,policy,expected,candidate,release:true,core});
   const failure_kind = failure === 'throw' ? 'unexpected' : stage === 'module' ? 'active_module_invalid' : stage === 'configuration' ? 'active_configuration_invalid' : 'active_identity_mismatch';
   assert.deepEqual(r,{ok:false,reason:'verification_failed',stage,failure_kind,upload_attempted:false,deploy_attempted:false,outcome:'NOT_ATTEMPTED',retry:false});
   assert.equal(coreCalled,false);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_|SENTINEL/);
  }
 }
});
test('outer module read distinguishes fixed verification and transport failures',async()=>{
 for(const kind of ['transport','size','length','envelope','id']){
  const f=fixture();f.api.betaVersion=async()=>{throw Error(kind);};
  const r=await execute({...f,policy,expected,candidate,release:true});
  assert.equal(r.stage,'module');assert.equal(r.failure_kind,kind);assert.equal(r.outcome,'NOT_ATTEMPTED');
  assert.equal(r.upload_attempted,false);assert.equal(r.deploy_attempted,false);assert.equal(r.retry,false);
 }
 const f=fixture();f.api.betaVersion=async id=>({id,modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:Buffer.from('different').toString('base64')}]});
 const r=await execute({...f,policy,expected,candidate,release:true});
 assert.equal(r.stage,'module');assert.equal(r.failure_kind,'active_module_mismatch');assert.equal(r.outcome,'NOT_ATTEMPTED');
});
test('outer failures after core entry retain conservative outcome and write attempt flags',async()=>{
 for(const point of ['before_write','upload_throw','after_upload','activation_throw','after_activation','core_result']){
  const f=fixture(),version='cccccccc-cccc-4ccc-8ccc-cccccccccccc',deployment='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  f.api.upload=async()=>{if(point==='upload_throw')throw Error('PRIVATE_UPLOAD_SENTINEL');return {id:version};};
  f.api.activate=async()=>{if(point==='activation_throw')throw Error('PRIVATE_ACTIVATION_SENTINEL');return {id:deployment};};
  const core=async api=>{
   if(point==='before_write')throw Error('PRIVATE_CORE_SENTINEL');
   await api.upload({});
   if(point==='after_upload')throw Error('PRIVATE_CORE_SENTINEL');
   await api.activate({});
   if(point==='after_activation')throw Error('PRIVATE_CORE_SENTINEL');
   return Object.defineProperty({},'ok',{get(){throw Error('PRIVATE_RESULT_SENTINEL');}});
  };
  const r=await execute({...f,policy,expected,candidate,release:true,core});
  assert.deepEqual(r,{ok:false,reason:'verification_failed',stage:point==='core_result'?'core_result':'core',failure_kind:'unexpected',
   upload_attempted:point!=='before_write',deploy_attempted:['activation_throw','after_activation','core_result'].includes(point),outcome:'REQUIRES_READBACK',retry:false});
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE_|SENTINEL/);
 }
});
test('release binds core baseline and feeds only the fixed complete bundle',async()=>{
 const f=fixture();let called=false;
 const version='cccccccc-cccc-4ccc-8ccc-cccccccccccc',deployment='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 f.api.upload=async()=>({id:version});f.api.activate=async()=>({id:deployment});
 const core=async(api,make,regression)=>{called=true;await api.deployments();assert.deepEqual(await make(old),candidate);await assert.rejects(()=>make(Buffer.from('wrong')));await regression(candidate);await assert.rejects(()=>regression(old));await api.upload({});await api.activate({});return {ok:true};};
 const r=await execute({...f,policy,expected,candidate,release:true,core});assert.equal(r.ok,true);assert.equal(r.version_id,version);assert.equal(r.deployment_id,deployment);assert.equal(called,true);
});
test('the core baseline must match the approved deployment even after preflight',async()=>{
 const f=fixture();let n=0;const original=f.api.deployments;
 f.api.deployments=async()=>++n===3?{deployments:[]}:original();
 const core=async api=>{await api.deployments();throw Error('must not reach');};
 const r=await execute({...f,policy,expected,candidate,release:true,core});assert.equal(r.ok,false);assert.equal(r.retry,false);
});
test('actual core stages and verifies the whole candidate with inherited bindings',async()=>{
 const f=fixture(), staged='cccccccc-cccc-4ccc-8ccc-cccccccccccc', dep2='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 let uploaded=false,activated=false,body,activation;
 const bindings=[{name:'STRATEGY_SWITCH_CONFIG',type:'kv_namespace',namespace_id:'1'.repeat(32)},
  {name:'STRATEGY_SWITCH_RUNTIME_INSTANCES',type:'durable_object_namespace',namespace_id:'2'.repeat(32),class_name:'RuntimeInstances'},
  {name:'SECRET',type:'secret_text'}];
 f.api.deployments=async()=>({deployments:[{id:activated?dep2:expected.deployment,strategy:'percentage',versions:[{version_id:activated?staged:expected.version,percentage:100}]}]});
 f.api.versions=async()=>({items:(uploaded?[staged,expected.version]:[expected.version]).map(id=>({id}))});
 f.api.scriptVersion=async id=>({id,resources:{bindings:structuredClone(bindings),script_runtime:{compatibility_date:'2026-06-08',usage_model:'standard',migration_tag:'v1'},script:{handlers:['fetch']}}});
 f.api.betaVersion=async id=>({id,modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:(id===staged?candidate:old).toString('base64')}]});
 f.api.upload=async x=>{body=x;uploaded=true;return {id:staged};};
 f.api.activate=async x=>{activation=x;activated=true;return {id:dep2};};
 const r=await execute({...f,policy,expected,candidate,release:true});
 assert.equal(r.ok,true);assert.equal(r.active_verified,true);assert.deepEqual(body.bindings,bindings.map(b=>({type:'inherit',name:b.name,version_id:expected.version})));
 assert.equal(body.modules[0].content_base64,candidate.toString('base64'));assert.ok(!Object.hasOwn(body,'migrations'));
 assert.deepEqual(body.annotations,{'workers/message':'Reviewed fixed complete console bundle'});
 assert.deepEqual(activation.annotations,body.annotations);assert.equal(r.version_id,staged);assert.equal(r.deployment_id,dep2);
});
test('missing verified identities after a core result preserve actual attempt flags',async()=>{
 const f=fixture();f.api.upload=async()=>({id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'});
 f.api.activate=async()=>({id:'PRIVATE_RESULT_SENTINEL'});
 const core=async api=>{await api.upload({});await api.activate({});return {ok:true};};
 const r=await execute({...f,policy,expected,candidate,release:true,core});
 assert.deepEqual(r,{ok:false,reason:'verified_identity_unavailable',stage:'core_result',upload_attempted:true,deploy_attempted:true,outcome:'REQUIRES_READBACK',retry:false});
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_|SENTINEL/);
});
test('failed core outcomes do not disclose IDs obtained from provider responses',async()=>{
 const f=fixture(), staged='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 f.api.upload=async()=>({id:staged});
 const core=async api=>{await api.upload({});return {ok:false,reason:'candidate_migrations'};};
 const r=await execute({...f,policy,expected,candidate,release:true,core});
 assert.equal(r.ok,false);assert.equal(r.reason,'candidate_migrations');assert.ok(!Object.hasOwn(r,'version_id'));
});
test('workflow keeps PR validation offline and shares the manual deployment lock',async()=>{
 const {readFile}=await import('node:fs/promises');
 const yaml=await readFile(new URL('../.github/workflows/console-full-bundle-release.yml',import.meta.url),'utf8');
 const [validation,release]=yaml.split('\n  release:\n');
 assert.match(validation,/pull_request:/);assert.match(validation,/github\.event_name == 'pull_request'/);
 assert.match(validation,/options: \[preflight, diagnose, release\]/);
 assert.match(validation,/case \"\$RELEASE_ACTION\" in preflight\|diagnose\|release/);
 assert.match(release,/case \"\$RELEASE_ACTION\" in preflight\|diagnose\|release/);
 assert.match(validation,/github\.event_name == 'workflow_dispatch' && 'strategy-switch-console-deploy'/);
 assert.doesNotMatch(validation,/secrets\.CLOUDFLARE/);
 assert.match(release,/if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
 assert.match(release,/environment: runtime-strategy-switch/);
 assert.match(release,/uses: actions\/setup-node@v6\n        with:\n          node-version: '22'/);
 assert.match(release,/secrets\.CLOUDFLARE_ACCOUNT_ID \|\| vars\.CLOUDFLARE_ACCOUNT_ID/);
 assert.equal((yaml.match(/git ls-remote origin refs\/heads\/main/g)||[]).length,3);
 assert.match(release,/Guard control revision before provider access[\s\S]*Read active state and optionally release[\s\S]*Guard control revision after provider access\n        if: always\(\)/);
});
function diagnosticFixture({difference=false,wrongModule=false,wrongResource=false,drift=false}={}){
 const f=fixture(), staged='cccccccc-cccc-4ccc-8ccc-cccccccccccc';let reads=0;
 const base={bindings:[{name:'SECRET_SENTINEL',type:'secret_text'},{name:'PRIVATE_CONFIG',type:'plain_text',text:'PRIVATE_VALUE_SENTINEL'}],
  script_runtime:{compatibility_date:'2026-06-08',compatibility_flags:[],usage_model:'standard',limits:{cpu_ms:50},exports:{},migration_tag:'v1'},
  script:{handlers:['fetch'],named_handlers:[],placement_mode:null}};
 const baseDeploy=f.api.deployments;
 f.api.deployments=async()=>{reads++;return drift&&reads===2?{deployments:[]}:baseDeploy();};
 f.api.versions=async()=>({items:[{id:staged},{id:expected.version}]});
 f.api.betaVersion=async id=>({id,modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:(id===staged?(wrongModule?old:candidate):old).toString('base64')}]});
 f.api.scriptVersion=async id=>{const resources=structuredClone(base);if(id===staged&&difference)resources.bindings[1].text='OTHER_PRIVATE_VALUE';return {id:id===staged&&wrongResource?expected.version:id,resources};};
 f.api.upload=async()=>{f.calls.push('upload');throw Error('must not write');};
 f.api.activate=async()=>{f.calls.push('activate');throw Error('must not write');};
 return {...f,staged};
}
test('diagnosis only reads and reports fixed equality and shapes, never metadata values',async()=>{
 for(const difference of [false,true]){
  const f=diagnosticFixture({difference});const r=await diagnose({...f,policy,expected,candidate});
  assert.equal(r.ok,true);assert.equal(r.read_only,true);assert.equal(r.configuration_equal,!difference);assert.equal(r.staged_version_id,f.staged);assert.equal(r.active_rechecked,true);
  assert.equal(r.fields.bindings.equal,!difference);assert.equal(r.binding_details.text_equal,!difference);
  assert.equal(r.binding_details.names_equal,true);assert.equal(r.fields.migration_tag.equal,true);
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE_VALUE|SECRET_SENTINEL|PRIVATE_CONFIG/);
  assert.ok(!f.calls.includes('upload'));assert.ok(!f.calls.includes('activate'));
 }
});
test('diagnosis rejects mismatched staged bytes, resource identity or active drift without exposing staged ID',async()=>{
 for(const change of [{wrongModule:true},{wrongResource:true},{drift:true}]){
  const f=diagnosticFixture(change),r=await diagnose({...f,policy,expected,candidate});
  assert.equal(r.ok,false);assert.equal(r.reason,'diagnostic_verification_failed');assert.ok(!Object.hasOwn(r,'staged_version_id'));
  assert.ok(!f.calls.includes('upload'));assert.ok(!f.calls.includes('activate'));
 }
});
test('diagnosis identifies runtime differences and does not access mutation methods',async()=>{
 const f=diagnosticFixture(),original=f.api.scriptVersion;
 f.api.scriptVersion=async id=>{const out=await original(id);if(id===f.staged)out.resources.script_runtime.limits.cpu_ms=99;return out;};
 Object.defineProperty(f.api,'upload',{get(){throw Error('write access');}});
 Object.defineProperty(f.api,'activate',{get(){throw Error('write access');}});
 const r=await diagnose({...f,policy,expected,candidate});
 assert.equal(r.ok,true);assert.equal(r.configuration_equal,false);assert.equal(r.fields.limits.equal,false);assert.equal(r.fields.limits.active_shape,'object');
 assert.equal(r.fields.usage_model.equal,true);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_VALUE|cpu_ms/);
});
test('named handler detail distinguishes order and fixed public additions without disclosing unknown names',()=>{
 const before=[{name:'RuntimeInstances',handlers:['fetch','UNKNOWN_PRIVATE_SENTINEL']},{name:'__test',handlers:['fetch']}];
 const order=[{name:'RuntimeInstances',handlers:['UNKNOWN_PRIVATE_SENTINEL','fetch']},{name:'__test',handlers:['fetch']}];
 const a=describeNamedHandlers(before,order).exports.RuntimeInstances;
 assert.equal(a.ordered_equal,false);assert.equal(a.multiset_equal,true);assert.equal(a.unknown_handlers_added,0);assert.equal(a.unknown_handlers_removed,0);
 const added=structuredClone(before);added[0].handlers.push('researchNativeDailyReturns');added[1].handlers.push('effectiveAccountSettings','dispatchAccountDiagnosis');
 const b=describeNamedHandlers(before,added);
 assert.equal(b.exports.RuntimeInstances.handlers.researchNativeDailyReturns.active_count,0);
 assert.equal(b.exports.RuntimeInstances.handlers.researchNativeDailyReturns.staged_count,1);
 assert.equal(b.exports.__test.handlers.effectiveAccountSettings.staged_count,1);assert.equal(b.exports.__test.handlers.dispatchAccountDiagnosis.staged_count,1);
 assert.equal(b.exports.RuntimeInstances.unknown_handlers_added,0);assert.doesNotMatch(JSON.stringify(b),/UNKNOWN_PRIVATE_SENTINEL/);
});
test('named handler detail flags unknown changes, duplicates, unexpected keys, and malformed input',()=>{
 const before=[{name:'RuntimeInstances',handlers:['fetch','SECRET_ONE']},{name:'UNKNOWN_EXPORT_SECRET',handlers:['SENSITIVE_A']}];
 const after=[{name:'RuntimeInstances',handlers:['fetch','SECRET_TWO'],PRIVATE_KEY:'PRIVATE_VALUE'},{name:'UNKNOWN_EXPORT_SECRET',handlers:['SENSITIVE_B']}];
 const r=describeNamedHandlers(before,after);assert.equal(r.exports.RuntimeInstances.unknown_handlers_added,1);assert.equal(r.exports.RuntimeInstances.unknown_handlers_removed,1);
 assert.equal(r.exports.RuntimeInstances.staged_unknown_keys,true);assert.equal(r.exports.RuntimeInstances.other_fields_equal,false);assert.equal(r.unknown_matched_entries_changed,1);
 assert.doesNotMatch(JSON.stringify(r),/SECRET_ONE|SECRET_TWO|UNKNOWN_EXPORT_SECRET|SENSITIVE_|PRIVATE_/);
 const duplicate=describeNamedHandlers([{name:'__test',handlers:['fetch','fetch']},{name:'__test',handlers:[]}],[]);
 assert.equal(duplicate.active_duplicate_names,true);assert.equal(duplicate.exports.__test.active_duplicate,true);
 const repeated=describeNamedHandlers([{name:'__test',handlers:['fetch','fetch']}],[{name:'__test',handlers:['fetch']}]);
 assert.equal(repeated.exports.__test.active_duplicate_handlers,true);assert.equal(repeated.exports.__test.multiset_equal,false);
 const unknown=describeNamedHandlers([{name:'REMOVED_PRIVATE',handlers:[]}],[{name:'ADDED_PRIVATE',handlers:[]}]);
 assert.equal(unknown.unknown_names_removed,1);assert.equal(unknown.unknown_names_added,1);assert.doesNotMatch(JSON.stringify(unknown),/REMOVED_PRIVATE|ADDED_PRIVATE/);
 const optional=describeNamedHandlers([{name:'RuntimeInstances'}],[{name:'RuntimeInstances',handlers:[]}]).exports.RuntimeInstances;
 assert.equal(optional.active_handlers_shape,'missing');assert.equal(optional.staged_handlers_shape,'array');
 assert.equal(optional.ordered_equal,false);assert.equal(optional.multiset_equal,null);assert.equal(optional.active_handler_count,null);
 assert.equal(optional.handlers.fetch.active_count,null);assert.equal(optional.unknown_handlers_added,null);
 for(const invalid of [[{name:'RuntimeInstances',handlers:['fetch',null]}],[{name:42,handlers:[]}],[{name:'RuntimeInstances',handlers:'bad'}],[{name:'RuntimeInstances',handlers:null}],Array(129).fill({name:'x',handlers:[]})])
  assert.throws(()=>describeNamedHandlers(invalid,[]),/invalid_named_handlers/);
});
test('read-only diagnosis attaches named handler detail to verified staged version',async()=>{
 const f=diagnosticFixture(),original=f.api.scriptVersion;
 f.api.scriptVersion=async id=>{const out=await original(id);out.resources.script.named_handlers=[{name:'RuntimeInstances',handlers:id===f.staged?['fetch','researchNativeDailyReturns']:['fetch']}];return out;};
 const r=await diagnose({...f,policy,expected,candidate});assert.equal(r.ok,true);assert.equal(r.configuration_equal,false);
 assert.equal(r.named_handler_details.exports.RuntimeInstances.handlers.researchNativeDailyReturns.staged_count,1);
 assert.equal(r.fields.named_handlers.core_equal,false);assert.ok(!f.calls.includes('upload'));assert.ok(!f.calls.includes('activate'));
});
test('named handler fingerprints preserve omitted fields and method order, while ignoring entry order and other metadata',()=>{
 const base=[{name:'RuntimeInstances',handlers:['fetch','SECRET_METHOD']},{name:'__test',handlers:['fetch']}];
 const ordered=describeNamedHandlers(base,[...base].reverse());
 assert.match(ordered.active_sha256,/^[a-f0-9]{64}$/);assert.equal(ordered.active_sha256,ordered.staged_sha256);
 const withOther=structuredClone(base);withOther[0].private_metadata='PRIVATE_SENTINEL';
 assert.equal(describeNamedHandlers(base,withOther).active_sha256,describeNamedHandlers(base,withOther).staged_sha256);
 const missing=describeNamedHandlers([{name:'RuntimeInstances'}],[{name:'RuntimeInstances',handlers:[]}]);
 assert.notEqual(missing.active_sha256,missing.staged_sha256);
 for(const handlers of [['fetch','another'],['SECRET_METHOD','fetch'],['fetch']]){
  const changed=describeNamedHandlers(base,[{name:'RuntimeInstances',handlers},{name:'__test',handlers:['fetch']}]);
  assert.notEqual(changed.active_sha256,changed.staged_sha256);
  assert.doesNotMatch(JSON.stringify(changed),/SECRET_METHOD|PRIVATE_SENTINEL/);
 }
});
