// Fixed full-bundle release wrapper around the unmodified #946 release core.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createFixedApi,runBackendRelease} from './console_946_backend_release.mjs';
import {describeNamedHandlers} from './console_named_handler_metadata.mjs';
export {describeNamedHandlers} from './console_named_handler_metadata.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = s => typeof s === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s);
const outerFailureKinds = new Set(['active_identity_mismatch','active_module_invalid','active_module_mismatch',
  'active_configuration_invalid','transport','size','length','envelope','id']);
export const POLICY = Object.freeze({
  frontend: Object.freeze({before:'f8a9b2598fcac89b5c7dc4d9bd8b6417a75126744c5e53c30f7d35bf8555fd15', candidate:'fc219f21adae7f2aac68f351a134413b5e2de301f85ccccc9aaf62e87af3469d'}),
  recovery: Object.freeze({before:'fc219f21adae7f2aac68f351a134413b5e2de301f85ccccc9aaf62e87af3469d', candidate:'f8a9b2598fcac89b5c7dc4d9bd8b6417a75126744c5e53c30f7d35bf8555fd15'}),
});
function verifyActive(result, expected) {
  const d=result?.deployments?.[0];
  if (!Array.isArray(result?.deployments) || !result.deployments.length || result.deployments.length>10 ||
      d?.id!==expected.deployment || d.strategy!=='percentage' || !Array.isArray(d.versions) || d.versions.length!==1 ||
      d.versions[0]?.version_id!==expected.version || d.versions[0]?.percentage!==100) throw Error('active_identity_mismatch');
}
function verifyModule(v, id, hash) {
  const m=v?.modules?.[0];
  if (v?.id!==id || !Array.isArray(v.modules) || v.modules.length!==1 || m?.name!=='worker.js' ||
      m.content_type!=='application/javascript+module' || typeof m.content_base64!=='string' ||
      !m.content_base64.length || m.content_base64.length>Math.ceil(10*1024*1024/3)*4 ||
      m.content_base64.length%4 || /[^A-Za-z0-9+/=]/.test(m.content_base64)) throw Error('active_module_invalid');
  const bytes=Buffer.from(m.content_base64,'base64');
  if (!bytes.length || bytes.length>10*1024*1024 || bytes.toString('base64')!==m.content_base64 || sha(bytes)!==hash) throw Error('active_module_mismatch');
}
const plainObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const canonical = x => JSON.stringify(x,(_k,v)=>plainObject(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const shape = x => x === undefined ? 'missing' : x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x;
function latest(result) {
  const items=result?.items;
  if(!Array.isArray(items)||!items.length||items.length>10||items.some(x=>!uuid(x?.id))||new Set(items.map(x=>x.id)).size!==items.length)throw Error('invalid_versions');
  return items[0].id;
}
function resourceParts(value,id) {
  const r=value?.resources;
  if(value?.id!==id||!plainObject(r)||!plainObject(r.script_runtime)||!plainObject(r.script)||!Array.isArray(r.bindings)||
     r.bindings.some(b=>!plainObject(b)||typeof b.name!=='string')||new Set(r.bindings.map(b=>b.name)).size!==r.bindings.length)
    throw Error('invalid_resources');
  return r;
}
// A read-only summary never returns binding names, values or resource IDs.
// Unknown provider strings are counted, not emitted.
function summarizeActiveConfiguration(value, id) {
  try {
    const r = resourceParts(value, id), runtime = r.script_runtime, script = r.script;
    const types = ['plain_text','json','secret_text','kv_namespace','durable_object_namespace'];
    const counts = Object.fromEntries(types.map(type => [type, r.bindings.filter(b => b.type === type).length]));
    counts.other = r.bindings.filter(b => !types.includes(b.type)).length;
    const publicNames = ['RuntimeInstances','__test','default'];
    const publicHandlers = ['fetch','scheduled','researchNativeDailyReturns','effectiveAccountSettings','dispatchAccountDiagnosis'];
    const names = x => ({ shape: shape(x), count: Array.isArray(x) ? x.length : plainObject(x) ? Object.keys(x).length : null,
      known: Object.fromEntries(publicNames.map(name => [name, Array.isArray(x) ? x.filter(item => (typeof item === 'string' ? item : item?.name) === name).length : plainObject(x) ? Number(Object.hasOwn(x,name)) : null])) });
    const named = names(script.named_handlers);
    named.handlers = Object.fromEntries(publicHandlers.map(name => [name, Array.isArray(script.named_handlers)
      ? script.named_handlers.reduce((n,item) => n + (Array.isArray(item?.handlers) ? item.handlers.filter(h => h === name).length : 0), 0) : null]));
    const flags = runtime.compatibility_flags;
    const cpu = runtime.limits?.cpu_ms;
    return { available: true, binding_count: r.bindings.length, binding_types: counts,
      compatibility_date: typeof runtime.compatibility_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(runtime.compatibility_date) ? runtime.compatibility_date : null,
      compatibility_flags: { shape: shape(flags), count: Array.isArray(flags) ? flags.length : null,
        nodejs_compat: Array.isArray(flags) ? flags.includes('nodejs_compat') : null },
      usage_model: ['standard','bundled','unbound'].includes(runtime.usage_model) ? runtime.usage_model : null,
      limits: { shape: shape(runtime.limits), cpu_ms: Number.isSafeInteger(cpu) && cpu >= 0 && cpu <= 300000 ? cpu : null },
      migration_tag: { shape: shape(runtime.migration_tag), present: typeof runtime.migration_tag === 'string' && runtime.migration_tag.length > 0 },
      exports: names(runtime.exports), named_handlers: named, handlers_shape: shape(script.handlers), placement_mode_shape: shape(script.placement_mode) };
  } catch { return { available: false }; }
}
// Diagnostic output contains only fixed field names, primitive shapes and equality.
// No upload or activation method is referenced on this path.
export async function diagnose({api,policy,expected,candidate}) {
  if (!policy || !/^[a-f0-9]{64}$/.test(policy.before) || !/^[a-f0-9]{64}$/.test(policy.candidate) ||
      !uuid(expected?.version) || !uuid(expected?.deployment) || !Buffer.isBuffer(candidate) || !candidate.length ||
      candidate.length>10*1024*1024 || sha(candidate)!==policy.candidate)
    return {ok:false,read_only:true,reason:'input_or_candidate_invalid'};
  try {
    verifyActive(await api.deployments(),expected);
    verifyModule(await api.betaVersion(expected.version),expected.version,policy.before);
    const staged=latest(await api.versions());
    if(staged===expected.version)throw Error('latest_is_active');
    verifyModule(await api.betaVersion(staged),staged,policy.candidate);
    const before=resourceParts(await api.scriptVersion(expected.version),expected.version);
    const after=resourceParts(await api.scriptVersion(staged),staged);
    const fields={};
    const compare=(name,a,b,coreA=a,coreB=b)=>{fields[name]={active_shape:shape(a),staged_shape:shape(b),equal:canonical(a)===canonical(b),core_equal:canonical(coreA)===canonical(coreB)};};
    const sortedBindings=x=>[...x].sort((a,b)=>a.name.localeCompare(b.name));
    compare('bindings',before.bindings,after.bindings,sortedBindings(before.bindings),sortedBindings(after.bindings));
    const aBindings=sortedBindings(before.bindings),bBindings=sortedBindings(after.bindings);
    const same=x=>canonical(x(aBindings))===canonical(x(bBindings));
    const namesEqual=same(bs=>bs.map(b=>b.name));
    const bindingDetails={names_equal:namesEqual};
    for(const key of ['type','namespace_id','class_name','script_name','environment','text','json'])
      bindingDetails[key+'_equal']=namesEqual&&same(bs=>bs.map(b=>[Object.hasOwn(b,key),b[key]]));
    bindingDetails.property_keys_equal=namesEqual&&same(bs=>bs.map(b=>Object.keys(b).sort()));
    bindingDetails.secret_shape_equal=namesEqual&&same(bs=>bs.filter(b=>b.type==='secret_text').map(b=>Object.keys(b).sort()));
    for(const k of ['compatibility_date','compatibility_flags','usage_model','limits','exports','migration_tag'])
      compare(k,before.script_runtime[k],after.script_runtime[k]);
    compare('handlers',before.script.handlers,after.script.handlers);
    const named=x=>Array.isArray(x)?[...x].sort((a,b)=>String(a?.name).localeCompare(String(b?.name))):x===undefined?null:x;
    compare('named_handlers',before.script.named_handlers,after.script.named_handlers,named(before.script.named_handlers),named(after.script.named_handlers));
    const namedDetails=describeNamedHandlers(before.script.named_handlers,after.script.named_handlers);
    compare('placement_mode',before.script.placement_mode,after.script.placement_mode,before.script.placement_mode??null,after.script.placement_mode??null);
    verifyActive(await api.deployments(),expected);
    if(latest(await api.versions())!==staged)throw Error('latest_drift');
    const equal=Object.values(fields).every(x=>x.equal);
    return {ok:true,read_only:true,configuration_equal:equal,reason:equal?'configuration_equal':'configuration_mismatch',staged_version_id:staged,active_rechecked:true,fields,binding_details:bindingDetails,named_handler_details:namedDetails};
  } catch {
    return {ok:false,read_only:true,reason:'diagnostic_verification_failed'};
  }
}
// Injected policy and core enable synthetic offline tests. The CLI uses POLICY only.
export async function execute({api,core=runBackendRelease,policy,expected,candidate,release=false}) {
  if (!policy || !/^[a-f0-9]{64}$/.test(policy.before) || !/^[a-f0-9]{64}$/.test(policy.candidate) ||
      !uuid(expected?.version) || !uuid(expected?.deployment) || typeof release!=='boolean' ||
      !Buffer.isBuffer(candidate) || !candidate.length || candidate.length>10*1024*1024 || sha(candidate)!==policy.candidate)
    return {ok:false,reason:'input_or_candidate_invalid',upload_attempted:false,deploy_attempted:false};
  let stage='active_before',coreEntered=false,uploadAttempted=false,deployAttempted=false;
  try {
    verifyActive(await api.deployments(),expected);
    stage='module';
    verifyModule(await api.betaVersion(expected.version),expected.version,policy.before);
    stage='configuration';
    const activeConfiguration = await api.scriptVersion(expected.version);
    if (activeConfiguration?.id!==expected.version) throw Error('active_configuration_invalid');
    const configurationSummary = release ? undefined : summarizeActiveConfiguration(activeConfiguration, expected.version);
    stage='active_recheck';
    verifyActive(await api.deployments(),expected);
    if (!release) return {ok:true,preflight:true,active_identity_verified:true,active_module_verified:true,candidate_sha256:policy.candidate,configuration_summary:configurationSummary,upload_attempted:false,deploy_attempted:false};
    // Bind the core's own first baseline read to the operator's observation. The
    // core then checks drift itself immediately before upload and activation.
    let first=true,versionId=null,deploymentId=null;
    const annotation={'workers/message':'Reviewed fixed complete console bundle'};
    const guarded={...api,
      deployments:async()=>{const value=await api.deployments();if(first){first=false;verifyActive(value,expected);}return value;},
      upload:async body=>{uploadAttempted=true;const value=await api.upload({...body,annotations:annotation});if(uuid(value?.id))versionId=value.id;return value;},
      activate:async body=>{deployAttempted=true;const value=await api.activate({...body,annotations:annotation});if(uuid(value?.id))deploymentId=value.id;return value;},
    };
    stage='core';coreEntered=true;
    const result=await core(guarded,async old=>{if(sha(old)!==policy.before)throw Error('active_module_mismatch');return candidate;},async bytes=>{
      if(sha(bytes)!==policy.candidate)throw Error('candidate_mismatch');
    });
    stage='core_result';
    if(!result.ok)return result;
    if(!versionId||!deploymentId)return {ok:false,reason:'verified_identity_unavailable',stage:'core_result',upload_attempted:uploadAttempted,deploy_attempted:deployAttempted,outcome:'REQUIRES_READBACK',retry:false};
    return {...result,version_id:versionId,deployment_id:deploymentId};
  } catch (error) {
    const failureKind = outerFailureKinds.has(error?.message) ? error.message : 'unexpected';
    return {ok:false,reason:'verification_failed',stage,failure_kind:failureKind,upload_attempted:uploadAttempted,deploy_attempted:deployAttempted,
      outcome:coreEntered?'REQUIRES_READBACK':'NOT_ATTEMPTED',retry:false};
  }
}
async function main(){
  const [mode,action,version,deployment,path,...extra]=process.argv.slice(2);
  if (!Object.hasOwn(POLICY,mode) || !['preflight','diagnose','release','resume'].includes(action) || (action==='resume'&&mode!=='frontend') || extra.length || !path) throw Error('invalid_arguments');
  const candidate=await readFile(path);
  const api=createFixedApi();
  const args={policy:POLICY[mode],expected:{version,deployment},candidate};
  let result;
  if(action==='diagnose')result=await diagnose({...args,api:{deployments:api.deployments,versions:api.versions,betaVersion:api.betaVersion,scriptVersion:api.scriptVersion}});
  else if(action==='resume'){
    const {resumeExisting}=await import('./console_existing_candidate_resume.mjs');
    result=await resumeExisting({deployments:api.deployments,versions:api.versions,betaVersion:api.betaVersion,
      scriptVersion:api.scriptVersion,activate:api.activate},candidate,{version,deployment});
  }else result=await execute({...args,api,release:action==='release'});
  console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{await main()}catch{console.error(JSON.stringify({ok:false,reason:'configuration_or_input_invalid',upload_attempted:false,deploy_attempted:false}));process.exitCode=1;}}
