// M09/P02 split release. The production caller must supply the fixed policy and
// verified provenance; the existing #946 core remains unchanged.
import {createHash} from 'node:crypto';
import {execute} from './console_full_bundle_release.mjs';
import {pinned} from './console_m09_release.mjs';
import {resources,config} from './console_946_backend_release.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);
const valid=(p,e,c)=>pinned(p)&&/^[a-f0-9]{64}$/.test(p.configuration_sha256??'')&&
  /^[a-f0-9]{64}$/.test(p.migration_tag_sha256??'')&&e?.source===p.source&&e?.tree===p.tree&&e?.frontendBlob===p.frontendBlob&&
  Buffer.isBuffer(c)&&c.length>0&&c.length<=10*1024*1024&&sha(c)===p.candidate;
function checkedVersion(api,policy){
  return async id=>{
    const value=await api.scriptVersion(id);
    if(id===policy.version){
      const r=resources(value,id),tag=r.script_runtime.migration_tag;
      if(typeof tag!=='string'||!tag||sha(config(r))!==policy.configuration_sha256||sha(tag)!==policy.migration_tag_sha256)
        throw Error('baseline_configuration_drift');
    }
    return value;
  };
}
const ids=x=>{
  const a=x?.items;
  if(!Array.isArray(a)||!a.length||a.length>10||a.some(v=>!uuid(v?.id))||new Set(a.map(v=>v.id)).size!==a.length)throw Error('versions');
  return a.map(v=>v.id);
};
const noWrite={ok:false,reason:'hold_or_input_invalid',upload_attempted:false,deploy_attempted:false};

// receipt is returned only to the caller's protected storage, never to public logs.
export async function uploadOnly({api,policy,evidence,candidate}) {
  if(!valid(policy,evidence,candidate))return {result:noWrite};
  let uploaded=null,previous=null,verified=false;
  const limited={deployments:api.deployments,versions:async()=>{
    const v=await api.versions();if(previous===null)previous=ids(v)[0];return v;
  },scriptVersion:checkedVersion(api,policy),betaVersion:api.betaVersion,
  upload:async body=>{const value=await api.upload(body);if(uuid(value?.id))uploaded=value.id;return value;},
  // This local sentinel is reached only after the core's complete upload readback,
  // configuration, version ordering and active-traffic checks have succeeded.
  activate:async()=>{verified=true;throw Error('split_stop');}};
  const result=await execute({api:limited,policy,expected:{version:policy.version,deployment:policy.deployment},candidate,release:true});
  if(!verified||!uploaded||!previous||result.stage!=='activate')
    return {result:{...result,deploy_attempted:false,outcome:result.upload_attempted?'UPLOAD_REQUIRES_READBACK':'NOT_ATTEMPTED'}};
  return {result:{ok:true,upload_attempted:true,deploy_attempted:false,staged_verified:true},
    receipt:{source:policy.source,tree:policy.tree,frontendBlob:policy.frontendBlob,before:policy.before,candidate:policy.candidate,
      configuration_sha256:policy.configuration_sha256,migration_tag_sha256:policy.migration_tag_sha256,
      active:policy.version,deployment:policy.deployment,staged:uploaded,previous}};
}

// A synthetic upload response allows the unmodified core to re-run its exact
// candidate/readback checks on the staged version. No upload method is exposed.
export async function activateOnly({api,policy,evidence,candidate,receipt}) {
  if(!valid(policy,evidence,candidate)||!receipt||receipt.source!==policy.source||receipt.tree!==policy.tree||
    receipt.frontendBlob!==policy.frontendBlob||receipt.before!==policy.before||receipt.candidate!==policy.candidate||
    receipt.configuration_sha256!==policy.configuration_sha256||receipt.migration_tag_sha256!==policy.migration_tag_sha256||
    receipt.active!==policy.version||receipt.deployment!==policy.deployment||!uuid(receipt.staged)||!uuid(receipt.previous)||
    receipt.staged===receipt.active||receipt.staged===receipt.previous)return {result:noWrite};
  let first=true;
  const limited={deployments:api.deployments,scriptVersion:checkedVersion(api,policy),betaVersion:api.betaVersion,
    versions:async()=>{
      const value=await api.versions(),list=ids(value);
      if(list.length<2||list[0]!==receipt.staged||list[1]!==receipt.previous)throw Error('versions_drift');
      if(first){first=false;return {...value,items:value.items.slice(1)};}
      return value;
    },
    upload:async body=>{
      if(first||body?.modules?.length!==1||body.modules[0]?.content_base64!==candidate.toString('base64'))throw Error('candidate');
      return {id:receipt.staged};
    },activate:api.activate};
  const result=await execute({api:limited,policy,expected:{version:policy.version,deployment:policy.deployment},candidate,release:true});
  // Core's upload flag denotes the local substitute, never a provider write.
  const {version_id,deployment_id,...publicResult}=result;
  if(!result.ok) return {result:{...publicResult,upload_attempted:false,
    outcome:result.deploy_attempted?'ACTIVATION_REQUIRES_READBACK':'NOT_ATTEMPTED'}};
  return {result:{...publicResult,upload_attempted:false},receipt:{...receipt,successorVersion:version_id,successorDeployment:deployment_id}};
}
