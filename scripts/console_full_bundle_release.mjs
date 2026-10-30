// Fixed full-bundle release wrapper around the unmodified #946 release core.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createFixedApi,runBackendRelease} from './console_946_backend_release.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = s => typeof s === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s);
export const POLICY = Object.freeze({
  frontend: Object.freeze({before:'7b64da8edd2627175019e5c529f9eec048732ffb7acec502cdf4122fc0dbb06a', candidate:'afe13eefe12d0e4f4db0f1bcfc515a2d3445963fd8f42ef8e5286c4062b6027d'}),
  recovery: Object.freeze({before:'afe13eefe12d0e4f4db0f1bcfc515a2d3445963fd8f42ef8e5286c4062b6027d', candidate:'61ba684d100a090bd54a50f56c45b420a969fba67b7289b1396321e5410c8162'}),
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
const publicExports=['RuntimeInstances','__test','default'];
const publicHandlers=['fetch','scheduled','researchNativeDailyReturns','effectiveAccountSettings','dispatchAccountDiagnosis'];
function delta(a,b) {
  const counts=xs=>{const m=new Map();for(const x of xs)m.set(x,(m.get(x)||0)+1);return m;};
  const left=counts(a),right=counts(b);let added=0,removed=0;
  for(const k of new Set([...left.keys(),...right.keys()])){const d=(right.get(k)||0)-(left.get(k)||0);if(d>0)added+=d;else removed-=d;}
  return {added,removed};
}
function inspectNamed(x) {
  if(!Array.isArray(x)||x.length>128)throw Error('invalid_named_handlers');
  for(const item of x) {
    if(!plainObject(item)||typeof item.name!=='string'||!item.name.length||item.name.length>128||
       (item.handlers!==undefined&&(!Array.isArray(item.handlers)||item.handlers.length>128||item.handlers.some(h=>typeof h!=='string'||!h.length||h.length>256)))||
       Object.keys(item).length>16||Buffer.byteLength(canonical(item))>8192)throw Error('invalid_named_handlers');
  }
  return x;
}
// Only fixed public names and aggregate counts leave this function.
export function describeNamedHandlers(active,staged) {
  const a=inspectNamed(active),b=inspectNamed(staged),names=x=>x.map(v=>v.name);
  const duplicates=x=>new Set(x).size!==x.length;
  const unknownNames=x=>names(x).filter(n=>!publicExports.includes(n));
  const unknownDelta=delta(unknownNames(a),unknownNames(b));
  const out={active_count:a.length,staged_count:b.length,active_duplicate_names:duplicates(names(a)),staged_duplicate_names:duplicates(names(b)),
    unknown_names_added:unknownDelta.added,unknown_names_removed:unknownDelta.removed,exports:{}};
  const unknownMatched=new Set(unknownNames(a).filter(n=>unknownNames(b).includes(n)));
  let changed=0,complete=true;
  for(const name of unknownMatched){const aa=a.filter(x=>x.name===name),bb=b.filter(x=>x.name===name);
    if(aa.length!==1||bb.length!==1){complete=false;continue;}if(canonical(aa[0])!==canonical(bb[0]))changed++;}
  out.unknown_matched_entries_changed=changed;out.unknown_matched_comparison_complete=complete;
  for(const name of publicExports){
    const aa=a.filter(x=>x.name===name),bb=b.filter(x=>x.name===name);
    const entry={active_count:aa.length,staged_count:bb.length,active_duplicate:aa.length>1,staged_duplicate:bb.length>1};
    if(aa.length<=1&&bb.length<=1&&(aa.length||bb.length)){
      const x=aa[0]??{name},y=bb[0]??{name},h=x.handlers,k=y.handlers;
      const bothArrays=Array.isArray(h)&&Array.isArray(k);
      const u=bothArrays?delta(h.filter(v=>!publicHandlers.includes(v)),k.filter(v=>!publicHandlers.includes(v))):null;
      const other=v=>Object.fromEntries(Object.entries(v).filter(([key])=>!['name','handlers'].includes(key)));
      Object.assign(entry,{active_handler_count:Array.isArray(h)?h.length:null,staged_handler_count:Array.isArray(k)?k.length:null,
        active_duplicate_handlers:Array.isArray(h)?duplicates(h):null,staged_duplicate_handlers:Array.isArray(k)?duplicates(k):null,
        active_name_shape:aa.length?'string':'missing',staged_name_shape:bb.length?'string':'missing',
        active_handlers_shape:shape(h),staged_handlers_shape:shape(k),
        ordered_equal:aa.length&&bb.length?canonical(h)===canonical(k):null,multiset_equal:bothArrays?canonical([...h].sort())===canonical([...k].sort()):null,
        active_unknown_keys:Object.keys(other(x)).length>0,staged_unknown_keys:Object.keys(other(y)).length>0,
        other_key_shape_equal:canonical(Object.keys(other(x)).sort())===canonical(Object.keys(other(y)).sort()),other_fields_equal:canonical(other(x))===canonical(other(y)),
        unknown_handlers_added:u?.added??null,unknown_handlers_removed:u?.removed??null,handlers:{}});
      for(const method of publicHandlers)entry.handlers[method]={active_count:Array.isArray(h)?h.filter(v=>v===method).length:null,staged_count:Array.isArray(k)?k.filter(v=>v===method).length:null};
    }
    out.exports[name]=entry;
  }
  return out;
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
  try {
    verifyActive(await api.deployments(),expected);
    verifyModule(await api.betaVersion(expected.version),expected.version,policy.before);
    if ((await api.scriptVersion(expected.version))?.id!==expected.version) throw Error('active_configuration_invalid');
    verifyActive(await api.deployments(),expected);
    if (!release) return {ok:true,preflight:true,active_identity_verified:true,active_module_verified:true,candidate_sha256:policy.candidate,upload_attempted:false,deploy_attempted:false};
    // Bind the core's own first baseline read to the operator's observation. The
    // core then checks drift itself immediately before upload and activation.
    let first=true,versionId=null,deploymentId=null;
    const annotation={'workers/message':'Reviewed fixed complete console bundle'};
    const guarded={...api,
      deployments:async()=>{const value=await api.deployments();if(first){first=false;verifyActive(value,expected);}return value;},
      upload:async body=>{const value=await api.upload({...body,annotations:annotation});if(uuid(value?.id))versionId=value.id;return value;},
      activate:async body=>{const value=await api.activate({...body,annotations:annotation});if(uuid(value?.id))deploymentId=value.id;return value;},
    };
    const result=await core(guarded,async old=>{if(sha(old)!==policy.before)throw Error('active_module_mismatch');return candidate;},async bytes=>{
      if(sha(bytes)!==policy.candidate)throw Error('candidate_mismatch');
    });
    if(!result.ok)return result;
    if(!versionId||!deploymentId)return {ok:false,reason:'verified_identity_unavailable',outcome:'REQUIRES_READBACK',retry:false};
    return {...result,version_id:versionId,deployment_id:deploymentId};
  } catch {
    return {ok:false,reason:'verification_failed',outcome:release?'REQUIRES_READBACK':'NOT_ATTEMPTED',retry:false};
  }
}
async function main(){
  const [mode,action,version,deployment,path,...extra]=process.argv.slice(2);
  if (!Object.hasOwn(POLICY,mode) || !['preflight','diagnose','release'].includes(action) || extra.length || !path) throw Error('invalid_arguments');
  const candidate=await readFile(path);
  const api=createFixedApi();
  const args={policy:POLICY[mode],expected:{version,deployment},candidate};
  const result=action==='diagnose'
    ?await diagnose({...args,api:{deployments:api.deployments,versions:api.versions,betaVersion:api.betaVersion,scriptVersion:api.scriptVersion}})
    :await execute({...args,api,release:action==='release'});
  console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{await main()}catch{console.error(JSON.stringify({ok:false,reason:'configuration_or_input_invalid',upload_attempted:false,deploy_attempted:false}));process.exitCode=1;}}
