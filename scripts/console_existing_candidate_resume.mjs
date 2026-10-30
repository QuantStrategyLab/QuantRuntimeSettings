// Fixed existing-candidate activation; transport is injected for offline tests.
// The production entry point always uses these exact reviewed identities.
import {createHash} from 'node:crypto';
import {describeNamedHandlers} from './console_named_handler_metadata.mjs';

const EXPECTED=Object.freeze({
  deployment:'50aade1f-2a51-42ef-86b2-464d1b665c30',
  active:'3f87638d-482a-46c5-a859-279fa6ee7e6c',
  staged:'0f361edb-737b-4f27-9159-a275270fd5b5',
  before:'7b64da8edd2627175019e5c529f9eec048732ffb7acec502cdf4122fc0dbb06a',
  candidate:'afe13eefe12d0e4f4db0f1bcfc515a2d3445963fd8f42ef8e5286c4062b6027d',
  activeNamedFingerprint:'f4c4460ae7772fc6dcffdd6a72258d1c6a84648176713173f89e4610014109f4',
  stagedNamedFingerprint:'e8c0303c3ee8f8fdbb1b4bbed9b41dbff901244c3718a0bb82950c25d8dc5df0',
});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const canonical=x=>JSON.stringify(x,(_key,v)=>object(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const digest=b=>createHash('sha256').update(b).digest('hex');
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const id=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);
const check=x=>{if(!x)throw Error('resume_verification_failed');};

// Shape and binding rules intentionally follow #946 resources(). This operates
// on already-read data; it never prints or returns the values it examines.
function checkResources(x){
  const r=x?.script_runtime,s=x?.script;
  check(object(x)&&object(r)&&object(s)&&Array.isArray(x.bindings)&&x.bindings.length>0&&x.bindings.length<=128);
  check(Object.keys(x).every(k=>['bindings','script','script_runtime'].includes(k)));
  check(Object.keys(r).every(k=>['compatibility_date','compatibility_flags','usage_model','limits','migration_tag','exports'].includes(k)));
  check(Object.keys(s).every(k=>['etag','handlers','named_handlers','last_deployed_from','placement_mode'].includes(k)));
  check(/^\d{4}-\d{2}-\d{2}$/.test(r.compatibility_date??'')&&['standard','bundled','unbound'].includes(r.usage_model));
  check(r.compatibility_flags===undefined||(Array.isArray(r.compatibility_flags)&&r.compatibility_flags.every(v=>typeof v==='string')));
  check(s.handlers===null||(Array.isArray(s.handlers)&&s.handlers.every(v=>typeof v==='string')));
  check(s.placement_mode==null||['smart','off'].includes(s.placement_mode));
  check(s.named_handlers===undefined||(Array.isArray(s.named_handlers)&&s.named_handlers.length<=128&&s.named_handlers.every(v=>object(v)&&typeof v.name==='string')));
  const seen=new Set();
  for(const b of x.bindings){
    check(object(b)&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(b.name??'')&&!seen.has(b.name));
    check(['plain_text','json','secret_text','kv_namespace','durable_object_namespace'].includes(b.type));
    check(b.type!=='secret_text'||Object.keys(b).every(k=>['name','type'].includes(k)));
    check(b.type!=='plain_text'||typeof b.text==='string');
    check(b.type!=='json'||Object.hasOwn(b,'json'));
    check(!['kv_namespace','durable_object_namespace'].includes(b.type)||/^[0-9a-f]{32}$/i.test(b.namespace_id??''));
    check(b.type!=='durable_object_namespace'||(typeof b.class_name==='string'&&!!b.class_name));seen.add(b.name);
  }
  check(x.bindings.some(b=>b.name==='STRATEGY_SWITCH_CONFIG'&&b.type==='kv_namespace'));
  check(x.bindings.some(b=>b.name==='STRATEGY_SWITCH_RUNTIME_INSTANCES'&&b.type==='durable_object_namespace'));
}
function configExceptNamed(x){
  const runtime=structuredClone(x.script_runtime);delete runtime.migration_tag;
  return canonical({bindings:[...x.bindings].sort((a,b)=>a.name.localeCompare(b.name)),runtime,
    handlers:x.script.handlers,placement_mode:x.script.placement_mode??null});
}
function additionalNamedFields(entries){
  check(Array.isArray(entries));const names=new Set();
  return entries.map(entry=>{check(object(entry)&&typeof entry.name==='string'&&!names.has(entry.name));names.add(entry.name);
    return {name:entry.name,other:Object.fromEntries(Object.entries(entry).filter(([k])=>!['name','handlers'].includes(k)))};
  }).sort((a,b)=>a.name.localeCompare(b.name));
}
export function reviewedHandlerDelta(active,staged){
  try{
    check(Array.isArray(active)&&active.length===2&&Array.isArray(staged)&&staged.length===2);
    const get=(items,name)=>{const matches=items.filter(x=>object(x)&&x.name===name);check(matches.length===1);return matches[0];};
    const ar=get(active,'RuntimeInstances'),br=get(staged,'RuntimeInstances'),at=get(active,'__test'),bt=get(staged,'__test');
    for(const x of [ar,br,at,bt])check(Object.keys(x).every(k=>['name','handlers'].includes(k))&&Array.isArray(x.handlers)&&x.handlers.every(v=>typeof v==='string')&&new Set(x.handlers).size===x.handlers.length);
    check(ar.handlers.length===1&&canonical(ar)===canonical(br)&&at.handlers.length===97&&bt.handlers.length===99);
    const added=['effectiveAccountSettings','dispatchAccountDiagnosis'];
    check(added.every(x=>!at.handlers.includes(x)&&bt.handlers.filter(y=>y===x).length===1));
    check(canonical(at.handlers)===canonical(bt.handlers.filter(x=>!added.includes(x))));
    return true;
  }catch{return false;}
}
// Pure local predicates: returning booleans is not an authorization or an API response.
export function compareCandidateResources(active,staged){
  try{
    checkResources(active);checkResources(staged);
    const oldTag=active.script_runtime.migration_tag,newTag=staged.script_runtime.migration_tag;
    const tags=typeof oldTag==='string'&&!!oldTag&&(newTag===undefined||newTag===oldTag);
    const named=describeNamedHandlers(active.script.named_handlers,staged.script.named_handlers);
    return {shape_valid:true,config_equal:configExceptNamed(active)===configExceptNamed(staged),migration_tag_valid:tags,
      named_other_fields_equal:canonical(additionalNamedFields(active.script.named_handlers))===canonical(additionalNamedFields(staged.script.named_handlers)),
      named_semantics_valid:reviewedHandlerDelta(active.script.named_handlers,staged.script.named_handlers),
      active_named_fingerprint:named.active_sha256,staged_named_fingerprint:named.staged_sha256};
  }catch{return {shape_valid:false};}
}
export function stagedEffectsEmpty(migrations,reconciliation){
  if(migrations!==undefined&&(!object(migrations)||Object.keys(migrations).length))return false;
  if(reconciliation===undefined)return true;
  if(!object(reconciliation))return false;
  const known=['created','deleted','renamed','transferred','transfer_pending','updated','removable_entries','info','warnings'];
  return Object.keys(reconciliation).every(k=>known.includes(k))&&known.every(k=>reconciliation[k]===undefined||(Array.isArray(reconciliation[k])&&!reconciliation[k].length));
}
export function unchangedValidatedReadbacks(first,second){
  return canonical(first.activeResources)===canonical(second.activeResources)&&canonical(first.stagedResources)===canonical(second.stagedResources)
    &&canonical(first.versions)===canonical(second.versions);
}
function checkSnapshot(snapshot){
  check(object(snapshot)&&snapshot.deployment===EXPECTED.deployment&&snapshot.activeVersion===EXPECTED.active&&snapshot.stagedVersion===EXPECTED.staged);
  check(snapshot.deploymentStrategy==='percentage'&&snapshot.activeVersionCount===1&&snapshot.activePercent===100);
  check(snapshot.activeModuleVersion===EXPECTED.active&&snapshot.stagedModuleVersion===EXPECTED.staged&&
    snapshot.activeResourcesVersion===EXPECTED.active&&snapshot.stagedResourcesVersion===EXPECTED.staged);
  check(snapshot.activeModuleName==='worker.js'&&snapshot.stagedModuleName==='worker.js'&&
    snapshot.activeModuleType==='application/javascript+module'&&snapshot.stagedModuleType==='application/javascript+module'&&
    snapshot.activeModuleCount===1&&snapshot.stagedModuleCount===1);
  check(Array.isArray(snapshot.versions)&&snapshot.versions.length>0&&snapshot.versions.length<=10&&snapshot.versions.every(id));
  check(new Set(snapshot.versions).size===snapshot.versions.length&&snapshot.versions[0]===EXPECTED.staged);
  check(Buffer.isBuffer(snapshot.activeModule)&&snapshot.activeModule.length>0&&snapshot.activeModule.length<=10*1024*1024&&digest(snapshot.activeModule)===EXPECTED.before);
  check(Buffer.isBuffer(snapshot.stagedModule)&&snapshot.stagedModule.length>0&&snapshot.stagedModule.length<=10*1024*1024&&digest(snapshot.stagedModule)===EXPECTED.candidate);
  check(stagedEffectsEmpty(snapshot.migrations,snapshot.exportsReconciliation));
  const comparison=compareCandidateResources(snapshot.activeResources,snapshot.stagedResources);
  check(comparison.shape_valid&&comparison.config_equal&&comparison.migration_tag_valid&&comparison.named_other_fields_equal&&comparison.named_semantics_valid);
  check(comparison.active_named_fingerprint===EXPECTED.activeNamedFingerprint&&comparison.staged_named_fingerprint===EXPECTED.stagedNamedFingerprint);
}
// Inputs come from two independently read snapshots, in sequence.
export function validateExistingCandidate(first,second){
  try{
    check(hash(EXPECTED.activeNamedFingerprint)&&hash(EXPECTED.stagedNamedFingerprint));
    checkSnapshot(first);checkSnapshot(second);
    check(unchangedValidatedReadbacks(first,second));
    return {ok:true};
  }catch{return {ok:false,reason:'resume_verification_failed'};}
}
// Two independent post-activation readbacks are required. Any failure is ambiguous.
export function validatePostActivation(baseline,first,second,activationId){
  try{
    check(hash(EXPECTED.activeNamedFingerprint)&&hash(EXPECTED.stagedNamedFingerprint));
    checkSnapshot(baseline);check(id(activationId));
    for(const post of [first,second]){
      check(object(post)&&post.deployment===activationId&&post.activeVersion===EXPECTED.staged&&post.deploymentStrategy==='percentage'&&post.activeVersionCount===1&&post.activePercent===100);
      check(post.activeModuleVersion===EXPECTED.staged&&post.activeResourcesVersion===EXPECTED.staged&&post.activeModuleCount===1&&
        post.activeModuleName==='worker.js'&&post.activeModuleType==='application/javascript+module');
      check(Buffer.isBuffer(post.activeModule)&&post.activeModule.length>0&&post.activeModule.length<=10*1024*1024&&digest(post.activeModule)===EXPECTED.candidate);
      check(stagedEffectsEmpty(post.migrations,post.exportsReconciliation));
      const compared=compareCandidateResources(baseline.activeResources,post.activeResources);
      check(compared.shape_valid&&compared.config_equal&&compared.named_other_fields_equal&&compared.named_semantics_valid&&
        compared.active_named_fingerprint===EXPECTED.activeNamedFingerprint&&compared.staged_named_fingerprint===EXPECTED.stagedNamedFingerprint);
      check(post.activeResources.script_runtime.migration_tag===baseline.activeResources.script_runtime.migration_tag);
    }
    check(canonical(first.activeResources)===canonical(second.activeResources));
    return {ok:true};
  }catch{return {ok:false,outcome:'ACTIVATION_REQUIRES_READBACK',retry:false};}
}

function deployment(value,version,deploymentId){
  const items=value?.deployments;check(Array.isArray(items)&&items.length>0&&items.length<=10);
  const d=items[0];check(d?.id===deploymentId&&d.strategy==='percentage'&&Array.isArray(d.versions)&&d.versions.length===1&&
    d.versions[0]?.version_id===version&&d.versions[0]?.percentage===100);return d;
}
function versionList(value){
  const items=value?.items;check(Array.isArray(items)&&items.length>0&&items.length<=10&&items.every(v=>id(v?.id)));
  const result=items.map(v=>v.id);check(new Set(result).size===result.length&&result[0]===EXPECTED.staged);return result;
}
function moduleRecord(value,version,checkEffects){
  check(value?.id===version&&Array.isArray(value.modules)&&value.modules.length===1);
  if(checkEffects)check(stagedEffectsEmpty(value.migrations,value.exports_reconciliation));
  const m=value.modules[0];check(m?.name==='worker.js'&&m.content_type==='application/javascript+module'&&typeof m.content_base64==='string'&&
    m.content_base64.length>0&&m.content_base64.length<=Math.ceil(10*1024*1024/3)*4&&m.content_base64.length%4===0&&!/[^A-Za-z0-9+/=]/.test(m.content_base64));
  const bytes=Buffer.from(m.content_base64,'base64');check(bytes.length>0&&bytes.length<=10*1024*1024&&bytes.toString('base64')===m.content_base64);
  return bytes;
}
function resourceRecord(value,version){check(value?.id===version);checkResources(value.resources);return value.resources;}
async function readPre(api){
  deployment(await api.deployments(),EXPECTED.active,EXPECTED.deployment);
  const versions=versionList(await api.versions());
  const old=await api.betaVersion(EXPECTED.active),candidate=await api.betaVersion(EXPECTED.staged);
  const oldModule=moduleRecord(old,EXPECTED.active,false),candidateModule=moduleRecord(candidate,EXPECTED.staged,true);
  const activeResources=resourceRecord(await api.scriptVersion(EXPECTED.active),EXPECTED.active);
  const stagedResources=resourceRecord(await api.scriptVersion(EXPECTED.staged),EXPECTED.staged);
  return {deployment:EXPECTED.deployment,activeVersion:EXPECTED.active,stagedVersion:EXPECTED.staged,deploymentStrategy:'percentage',activeVersionCount:1,activePercent:100,
    activeModuleVersion:EXPECTED.active,stagedModuleVersion:EXPECTED.staged,activeResourcesVersion:EXPECTED.active,stagedResourcesVersion:EXPECTED.staged,
    activeModuleName:'worker.js',stagedModuleName:'worker.js',activeModuleType:'application/javascript+module',stagedModuleType:'application/javascript+module',
    activeModuleCount:1,stagedModuleCount:1,versions,activeModule:oldModule,stagedModule:candidateModule,activeResources,stagedResources,
    migrations:candidate.migrations,exportsReconciliation:candidate.exports_reconciliation};
}
async function readPost(api,deployedId){
  deployment(await api.deployments(),EXPECTED.staged,deployedId);versionList(await api.versions());
  const version=await api.betaVersion(EXPECTED.staged),activeModule=moduleRecord(version,EXPECTED.staged,true);
  const activeResources=resourceRecord(await api.scriptVersion(EXPECTED.staged),EXPECTED.staged);
  return {deployment:deployedId,activeVersion:EXPECTED.staged,deploymentStrategy:'percentage',activeVersionCount:1,activePercent:100,
    activeModuleVersion:EXPECTED.staged,activeResourcesVersion:EXPECTED.staged,activeModuleCount:1,activeModuleName:'worker.js',activeModuleType:'application/javascript+module',
    activeModule,activeResources,migrations:version.migrations,exportsReconciliation:version.exports_reconciliation};
}
// The API parameter supports offline fixtures; there is no caller-selected policy,
// endpoint, staged version, payload, or upload operation in production.
export async function resumeExisting(api,candidateBytes,requested){
  let attempted=false,stage='preflight';
  try{
    check(requested?.version===EXPECTED.active&&requested?.deployment===EXPECTED.deployment&&Buffer.isBuffer(candidateBytes)&&digest(candidateBytes)===EXPECTED.candidate);
    const first=await readPre(api),second=await readPre(api);
    check(validateExistingCandidate(first,second).ok);
    stage='pre_activate';
    check(canonical(versionList(await api.versions()))===canonical(second.versions));
    deployment(await api.deployments(),EXPECTED.active,EXPECTED.deployment);
    stage='activate';attempted=true;
    const deployed=await api.activate({strategy:'percentage',versions:[{version_id:EXPECTED.staged,percentage:100}],annotations:{'workers/message':'Reviewed fixed existing console bundle'}});
    check(id(deployed?.id));
    if(Object.hasOwn(deployed,'strategy'))check(deployed.strategy==='percentage');
    if(Object.hasOwn(deployed,'versions'))check(Array.isArray(deployed.versions)&&deployed.versions.length===1&&deployed.versions[0]?.version_id===EXPECTED.staged&&deployed.versions[0]?.percentage===100);
    stage='post_activate';
    const post1=await readPost(api,deployed.id),post2=await readPost(api,deployed.id);
    check(validatePostActivation(first,post1,post2,deployed.id).ok);
    deployment(await api.deployments(),EXPECTED.staged,deployed.id);
    return {ok:true,active_verified:true,version_id:EXPECTED.staged,deployment_id:deployed.id,provider_cas:false,upload_attempted:false,activation_attempted:true};
  }catch{
    return {ok:false,stage,outcome:attempted?'ACTIVATION_REQUIRES_READBACK':'NOT_ATTEMPTED',retry:false,upload_attempted:false,activation_attempted:attempted};
  }
}
