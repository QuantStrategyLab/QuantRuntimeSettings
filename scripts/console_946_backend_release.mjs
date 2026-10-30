// Fixed #946 Worker release; no caller-selected Worker, URL, ref or command.
// No module bytes, binding values, identifiers or provider errors are logged.
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {verify946OnFixed54e} from './console_946_54e_patch.mjs';

const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const reasons=new Set(['configuration_invalid','active_invalid','active_drift','version_list_invalid','latest_drift',
  'baseline_invalid','configuration_drift','candidate_invalid','candidate_migrations','candidate_exports_change','candidate_bytes_mismatch',
  'candidate_configuration_mismatch','migration_tag_mismatch','deployment_response_invalid','post_deploy_mismatch',
  'active_54e_bytes_mismatch','active_54e_statements_mismatch','historical_build_id_mismatch','helper_declaration_mismatch',
  'helper_shape_invalid','active_target_mismatch','active_target_offset_mismatch','candidate_target_mismatch',
  'candidate_layout_mismatch','reverse_mismatch','invalid_bundle','unapproved_synthetic_bundles','bundle_parse_failed',
  'required_statement_missing','source_map_target_mismatch','synthetic_diff_not_exact','nonunique_patch_region']);
const fail=x=>{throw Error(reasons.has(x)?x:'verification_failed')};
const canonical=x=>JSON.stringify(x,(_key,v)=>object(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);

function active(result){
  const a=result?.deployments;
  if(!Array.isArray(a)||!a.length||a.length>10)fail('active_invalid');
  const d=a[0];
  if(!uuid(d?.id)||d.strategy!=='percentage'||!Array.isArray(d.versions)||d.versions.length!==1
    ||d.versions[0]?.percentage!==100||!uuid(d.versions[0]?.version_id))fail('active_invalid');
  return {deployment:d.id,version:d.versions[0].version_id};
}
function versions(result){
  const items=result?.items;
  if(!Array.isArray(items)||!items.length||items.length>10||items.some(x=>!uuid(x?.id)))fail('version_list_invalid');
  if(new Set(items.map(x=>x.id)).size!==items.length)fail('version_list_invalid');
  return items.map(x=>x.id);
}
function resources(value,id){
  if(value?.id!==id)fail('baseline_invalid');
  const x=value.resources,r=x?.script_runtime,s=x?.script;
  if(!object(x)||!object(r)||!object(s)||!Array.isArray(x.bindings)||!x.bindings.length||x.bindings.length>128
    ||Object.keys(x).some(k=>!['bindings','script','script_runtime'].includes(k))
    ||Object.keys(r).some(k=>!['compatibility_date','compatibility_flags','usage_model','limits','migration_tag','exports'].includes(k))
    ||Object.keys(s).some(k=>!['etag','handlers','named_handlers','last_deployed_from','placement_mode'].includes(k))
    ||!/^\d{4}-\d{2}-\d{2}$/.test(r.compatibility_date??'')||!['standard','bundled','unbound'].includes(r.usage_model)
    ||(r.compatibility_flags!==undefined&&(!Array.isArray(r.compatibility_flags)||r.compatibility_flags.some(v=>typeof v!=='string')))
    ||!(s.handlers===null||(Array.isArray(s.handlers)&&s.handlers.every(v=>typeof v==='string')))
    ||(s.placement_mode!=null&&!['smart','off'].includes(s.placement_mode)))fail('baseline_invalid');
  if(s.named_handlers!==undefined&&(!Array.isArray(s.named_handlers)||s.named_handlers.length>128
    ||s.named_handlers.some(v=>!object(v)||typeof v.name!=='string')))fail('baseline_invalid');
  const seen=new Set();
  for(const b of x.bindings){
    if(!object(b)||!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(b.name??'')||seen.has(b.name)
      ||!['plain_text','json','secret_text','kv_namespace','durable_object_namespace'].includes(b.type))fail('baseline_invalid');
    if(b.type==='secret_text'&&Object.keys(b).some(k=>!['name','type'].includes(k)))fail('baseline_invalid');
    if(b.type==='plain_text'&&typeof b.text!=='string')fail('baseline_invalid');
    if(b.type==='json'&&!Object.hasOwn(b,'json'))fail('baseline_invalid');
    if(['kv_namespace','durable_object_namespace'].includes(b.type)&&!/^[0-9a-f]{32}$/i.test(b.namespace_id??''))fail('baseline_invalid');
    if(b.type==='durable_object_namespace'&&(typeof b.class_name!=='string'||!b.class_name))fail('baseline_invalid');
    seen.add(b.name);
  }
  if(!x.bindings.some(b=>b.name==='STRATEGY_SWITCH_CONFIG'&&b.type==='kv_namespace')
    ||!x.bindings.some(b=>b.name==='STRATEGY_SWITCH_RUNTIME_INSTANCES'&&b.type==='durable_object_namespace'))fail('baseline_invalid');
  return x;
}
function config(x){
  const runtime=structuredClone(x.script_runtime);delete runtime.migration_tag;
  return canonical({bindings:[...x.bindings].sort((a,b)=>a.name.localeCompare(b.name)),runtime,
    handlers:x.script.handlers,named_handlers:x.script.named_handlers===undefined?null:[...x.script.named_handlers].sort((a,b)=>a.name.localeCompare(b.name)),
    placement_mode:x.script.placement_mode??null});
}
function moduleBytes(v,id,checkMigrations=true){
  if(v?.id!==id||!Array.isArray(v.modules)||v.modules.length!==1)fail('candidate_invalid');
  if(checkMigrations&&v.migrations!==undefined&&(!object(v.migrations)||Object.keys(v.migrations).length))fail('candidate_migrations');
  if(checkMigrations&&v.exports_reconciliation!==undefined){
    const reconciliation=v.exports_reconciliation;
    if(!object(reconciliation))fail('candidate_exports_change');
    const known=['created','deleted','renamed','transferred','transfer_pending','updated','removable_entries','info','warnings'];
    if(Object.keys(reconciliation).some(key=>!known.includes(key)))fail('candidate_exports_change');
    for(const key of known){
      if(reconciliation[key]!==undefined&&(!Array.isArray(reconciliation[key])||reconciliation[key].length))fail('candidate_exports_change');
    }
  }
  const m=v.modules[0];
  if(m?.name!=='worker.js'||m.content_type!=='application/javascript+module'||typeof m.content_base64!=='string'
    ||!m.content_base64.length||m.content_base64.length>Math.ceil(10*1024*1024/3)*4||m.content_base64.length%4
    ||/[^A-Za-z0-9+/=]/.test(m.content_base64))fail('candidate_invalid');
  const bytes=Buffer.from(m.content_base64,'base64');
  if(!bytes.length||bytes.length>10*1024*1024||bytes.toString('base64')!==m.content_base64)fail('candidate_invalid');
  return bytes;
}
function candidateConfig(next,base,after){
  const oldTag=base.script_runtime.migration_tag,newTag=next.script_runtime.migration_tag;
  if(typeof oldTag!=='string'||!oldTag)fail('migration_tag_mismatch');
  if(after ? newTag!==oldTag : newTag!==undefined&&newTag!==oldTag)fail('migration_tag_mismatch');
  if(config(next)!==config(base))fail('candidate_configuration_mismatch');
  return newTag!==undefined;
}
function metadata(base,version,bytes){
  const r=base.script_runtime,s=base.script;
  const body={main_module:'worker.js',bindings:base.bindings.map(b=>({type:'inherit',name:b.name,version_id:version})),
    compatibility_date:r.compatibility_date,usage_model:r.usage_model,
    modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:bytes.toString('base64')}],
    annotations:{'workers/message':'Reviewed account history and native return backend repair'}};
  for(const key of ['compatibility_flags','limits'])if(r[key]!==undefined)body[key]=r[key];
  if(s.placement_mode==='smart')body.placement={mode:'smart'};
  return body;
}

// API is injected for offline state-machine tests only; production constructs
// the fixed Cloudflare transport below, with no selectable endpoint or verb.
export async function runBackendRelease(api,makeCandidate,runRegression){
  let stage='initial',uploadAttempted=false,deployAttempted=false,prior=null,uploaded=null,candidateTagObserved=false;
  try{
    stage='baseline';prior=active(await api.deployments());
    const oldModule=moduleBytes(await api.betaVersion(prior.version),prior.version,false);
    const baseline=resources(await api.scriptVersion(prior.version),prior.version);
    if(typeof baseline.script_runtime.migration_tag!=='string'||!baseline.script_runtime.migration_tag)fail('migration_tag_mismatch');
    stage='candidate';const candidate=await makeCandidate(oldModule);
    if(!Buffer.isBuffer(candidate)||!candidate.length||candidate.length>10*1024*1024)fail('candidate_invalid');
    await runRegression(candidate);
    stage='pre_upload';
    const still=active(await api.deployments());
    if(still.deployment!==prior.deployment||still.version!==prior.version)fail('active_drift');
    const again=resources(await api.scriptVersion(prior.version),prior.version);
    if(config(again)!==config(baseline)||again.script_runtime.migration_tag!==baseline.script_runtime.migration_tag)fail('configuration_drift');
    const previous=versions(await api.versions())[0];
    stage='upload';uploadAttempted=true;
    const created=await api.upload(metadata(baseline,prior.version,candidate));
    if(!uuid(created?.id)||created.id===prior.version)fail('candidate_invalid');
    uploaded=created.id;
    stage='candidate_readback';
    if(!(moduleBytes(await api.betaVersion(uploaded),uploaded)).equals(candidate))fail('candidate_bytes_mismatch');
    candidateTagObserved=candidateConfig(resources(await api.scriptVersion(uploaded),uploaded),baseline,false);
    stage='pre_activate';
    const items=versions(await api.versions());
    if(items.length<2||items[0]!==uploaded||items[1]!==previous)fail('latest_drift');
    const oldAgain=resources(await api.scriptVersion(prior.version),prior.version);
    if(config(oldAgain)!==config(baseline)||oldAgain.script_runtime.migration_tag!==baseline.script_runtime.migration_tag)fail('configuration_drift');
    const current=active(await api.deployments());
    if(current.deployment!==prior.deployment||current.version!==prior.version)fail('active_drift');
    stage='activate';deployAttempted=true;
    const deployed=await api.activate({strategy:'percentage',versions:[{version_id:uploaded,percentage:100}],
      annotations:{'workers/message':'Reviewed account history and native return backend repair'}});
    if(!uuid(deployed?.id)||(Object.hasOwn(deployed,'strategy')&&deployed.strategy!=='percentage')
      ||(Object.hasOwn(deployed,'versions')&&(!Array.isArray(deployed.versions)||deployed.versions.length!==1
      ||deployed.versions[0]?.version_id!==uploaded||deployed.versions[0]?.percentage!==100)))fail('deployment_response_invalid');
    stage='post_activate';
    const post=active(await api.deployments());
    if(post.deployment!==deployed.id||post.version!==uploaded)fail('post_deploy_mismatch');
    if(!moduleBytes(await api.betaVersion(uploaded),uploaded).equals(candidate))fail('candidate_bytes_mismatch');
    candidateConfig(resources(await api.scriptVersion(uploaded),uploaded),baseline,true);
    const final=active(await api.deployments());
    if(final.deployment!==deployed.id||final.version!==uploaded)fail('post_deploy_mismatch');
    return {ok:true,upload_attempted:true,deploy_attempted:true,active_verified:true,binding_metadata_equal:true,explicit_active_binding_inheritance:true,version_configuration_equal:true,
      secret_values_read:false,candidate_tag_observed_before_activation:candidateTagObserved,post_tag_equal:true,provider_cas:false};
  }catch(error){
    const reason=reasons.has(error?.message)?error.message:'request_or_verification_failed';
    let recovery={readback_available:false};
    if(uploadAttempted){
      try{const now=active(await api.deployments());recovery={readback_available:true,
        prior_still_active:!!prior&&now.deployment===prior.deployment&&now.version===prior.version,
        candidate_active:uploaded===null?null:now.version===uploaded};}catch{}
    }
    return {ok:false,stage,reason,upload_attempted:uploadAttempted,deploy_attempted:deployAttempted,
      outcome:deployAttempted?'ACTIVATION_REQUIRES_READBACK':uploadAttempted?'UPLOAD_REQUIRES_READBACK':'NOT_ATTEMPTED',
      recovery,retry:false};
  }
}

export function createFixedApi(){
  const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
  if(!token||!/^[0-9a-f]{32}$/i.test(account??''))fail('configuration_invalid');
  const base=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/qsl-strategy-switch-console`;
  const beta=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/workers/qsl-strategy-switch-console`;
  async function request(url,method='GET',payload){
    const limit=15*1024*1024;
    const r=await fetch(url,{method,body:payload===undefined?undefined:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Accept-Encoding':'identity',...(payload===undefined?{}:{'Content-Type':'application/json'})}});
    const len=r.headers.get('content-length');
    if(!r.ok||!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')??'')||!['','identity'].includes(r.headers.get('content-encoding')??'')
      ||(len!==null&&(!/^\d+$/.test(len)||Number(len)>limit))||!r.body){await r.body?.cancel();throw Error('transport');}
    const reader=r.body.getReader(),parts=[];let n=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>limit)throw Error('size');parts.push(value);}}finally{await reader.cancel();}
    if(len!==null&&Number(len)!==n)throw Error('length');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
    if(value?.success!==true||(value.errors!=null&&(!Array.isArray(value.errors)||value.errors.length)))throw Error('envelope');
    return value.result;
  }
  const valid=id=>{if(!uuid(id))throw Error('id');return id};
  return {
    deployments:()=>request(base+'/deployments?page=1&per_page=10'),
    versions:()=>request(base+'/versions?page=1&per_page=10'),
    scriptVersion:id=>request(base+'/versions/'+valid(id)),
    betaVersion:id=>request(beta+'/versions/'+valid(id)+'?include=modules'),
    upload:body=>request(beta+'/versions?deploy=false','POST',body),
    activate:body=>request(base+'/deployments?force=false','POST',body),
  };
}
async function main(){
  let api;try{api=createFixedApi()}catch{console.error(JSON.stringify({ok:false,reason:'configuration_invalid',upload_attempted:false,deploy_attempted:false}));process.exitCode=1;return;}
  const worker=createRequire(new URL('../web/strategy-switch-console/package.json',import.meta.url));
  const frontend=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url));
  let ts,trace;try{ts=frontend('typescript');trace=worker('@jridgewell/trace-mapping')}catch{console.error(JSON.stringify({ok:false,reason:'runtime_dependencies_missing',upload_attempted:false,deploy_attempted:false}));process.exitCode=1;return;}
  const result=await runBackendRelease(api,activeBytes=>verify946OnFixed54e(ts,trace,activeBytes),async candidate=>{
    // The API closure holds credentials; never pass them to workerd.
    delete process.env.CLOUDFLARE_API_TOKEN;delete process.env.CLOUDFLARE_ACCOUNT_ID;
    const {testCandidate946}=await import('./console_946_runtime_test.mjs');await testCandidate946(candidate);
  });
  console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
