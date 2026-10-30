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
  if (!Object.hasOwn(POLICY,mode) || !['preflight','release'].includes(action) || extra.length || !path) throw Error('invalid_arguments');
  const candidate=await readFile(path);
  const result=await execute({api:createFixedApi(),policy:POLICY[mode],expected:{version,deployment},candidate,release:action==='release'});
  console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{await main()}catch{console.error(JSON.stringify({ok:false,reason:'configuration_or_input_invalid',upload_attempted:false,deploy_attempted:false}));process.exitCode=1;}}
