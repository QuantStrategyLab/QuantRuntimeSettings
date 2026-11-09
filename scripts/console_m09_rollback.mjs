// Rollback is closed until the reviewed policy and actual successor are authorized.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resources,config} from './console_946_backend_release.mjs';
import {pinned} from './console_m09_release.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function bound(p,r){
 return pinned(p)&&digest(p.configuration_sha256)&&digest(p.migration_tag_sha256)&&r&&
  r.source===p.source&&r.tree===p.tree&&r.frontendBlob===p.frontendBlob&&r.before===p.before&&r.candidate===p.candidate&&
  r.configuration_sha256===p.configuration_sha256&&r.migration_tag_sha256===p.migration_tag_sha256&&
  r.active===p.version&&r.deployment===p.deployment&&uuid(r.previous)&&uuid(r.staged)&&
  r.staged!==r.active&&r.staged!==r.previous&&r.successorVersion===r.staged&&uuid(r.successorDeployment)&&
  r.successorDeployment!==r.deployment;
}
function active(value,deployment,version){
 const list=value?.deployments,d=list?.[0];
 if(!Array.isArray(list)||!list.length||list.length>10||d?.id!==deployment||d.strategy!=='percentage'||
  !Array.isArray(d.versions)||d.versions.length!==1||d.versions[0]?.version_id!==version||d.versions[0]?.percentage!==100)
  throw Error('active');
}
function moduleMatches(value,id,expected){
 const m=value?.modules?.[0],s=m?.content_base64;
 if(value?.id!==id||!Array.isArray(value.modules)||value.modules.length!==1||m?.name!=='worker.js'||
  m.content_type!=='application/javascript+module'||typeof s!=='string'||!s.length||s.length>Math.ceil(10*1024*1024/3)*4)
  throw Error('module');
 const bytes=Buffer.from(s,'base64');
 if(!bytes.length||bytes.length>10*1024*1024||bytes.toString('base64')!==s||sha(bytes)!==expected)throw Error('module');
}
function configurationMatches(value,id,p){
 const r=resources(value,id),tag=r.script_runtime.migration_tag;
 if(typeof tag!=='string'||!tag||sha(config(r))!==p.configuration_sha256||sha(tag)!==p.migration_tag_sha256)
  throw Error('configuration');
}
// The optional receipt returned on success must remain in protected storage.
export async function rollback({api,policy,receipt}){
 if(!bound(policy,receipt))return {result:{ok:false,reason:'hold_or_invalid_pins',deploy_attempted:false,retry:false}};
 let attempted=false;
 try{
  active(await api.deployments(),receipt.successorDeployment,receipt.successorVersion);
  moduleMatches(await api.betaVersion(policy.version),policy.version,policy.before);
  configurationMatches(await api.scriptVersion(policy.version),policy.version,policy);
  moduleMatches(await api.betaVersion(receipt.successorVersion),receipt.successorVersion,policy.candidate);
  configurationMatches(await api.scriptVersion(receipt.successorVersion),receipt.successorVersion,policy);
  active(await api.deployments(),receipt.successorDeployment,receipt.successorVersion);
  attempted=true;
  const result=await api.activate({strategy:'percentage',versions:[{version_id:policy.version,percentage:100}],annotations:{'workers/message':'Reviewed rollback'}});
  if(!uuid(result?.id)||(result.strategy!==undefined&&result.strategy!=='percentage')||
   (result.versions!==undefined&&(!Array.isArray(result.versions)||result.versions.length!==1||
    result.versions[0]?.version_id!==policy.version||result.versions[0]?.percentage!==100)))throw Error('response');
  active(await api.deployments(),result.id,policy.version);
  moduleMatches(await api.betaVersion(policy.version),policy.version,policy.before);
  configurationMatches(await api.scriptVersion(policy.version),policy.version,policy);
  active(await api.deployments(),result.id,policy.version);
  return {result:{ok:true,deploy_attempted:true,active_verified:true,retry:false,provider_cas:false},
   receipt:{...receipt,rollbackVersion:policy.version,rollbackDeployment:result.id}};
 }catch{return {result:{ok:false,reason:attempted?'activation_requires_readback':'verification_failed',
   deploy_attempted:attempted,outcome:attempted?'UNKNOWN':'NOT_ATTEMPTED',retry:false}};}
}
// No credentials, files or provider client are accessed by the held CLI.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 console.error('{"ok":false,"reason":"hold","deploy_attempted":false,"retry":false}');process.exitCode=1;
}
