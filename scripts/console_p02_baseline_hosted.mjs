// Hosted P02 capture: fixed object and routes; provider responses are never logged.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {capture,R2_ACTIVE_MODULE} from './console_p02_baseline_capture.mjs';
import {createFixedApi} from './console_946_backend_release.mjs';
import {createHash} from 'node:crypto';

export const KEY='evidence/qrs-worker-p02/p02-20261109-r2/baseline.json';
export function verifyCapability(env,now=Date.now()){
  const uri=/^gs:\/\/([a-z0-9][a-z0-9._-]{1,220}[a-z0-9])(?:\/[^?#]*)?$/.exec(env.DIGEST_CANDIDATES_GCS_URI??'');
  const provider=env.DIGEST_CANDIDATES_READER_WIF_PROVIDER||env.DIGEST_GCP_WORKLOAD_IDENTITY_PROVIDER;
  const account=env.DIGEST_CANDIDATES_READER_SERVICE_ACCOUNT||env.DIGEST_GCP_WORKLOAD_IDENTITY_SERVICE_ACCOUNT;
  let r;try{r=JSON.parse(env.QRS_P02_STORAGE_CAPABILITY_RECEIPT||'')}catch{throw Error('capability');}
  const issued=Date.parse(r.issued_at),expires=Date.parse(r.expires_at);
  if(!uri||!provider||!account||!/^[a-f0-9]{40}$/.test(env.P02_CONTROL_SHA??'')||
    !/^[a-f0-9]{40}$/.test(env.P02_CONTROL_TREE??'')||r.schema!=='qrs-p02-storage-capability-v1'||
    r.bucket!==uri[1]||r.object!==KEY||r.wif_provider!==provider||r.service_account!==account||
    r.control_sha!==env.P02_CONTROL_SHA||r.control_tree!==env.P02_CONTROL_TREE||
    typeof r.owner_project!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(r.owner_project)||
    r.policy_readback_reviewed!==true||r.create_permitted!==true||r.get_permitted!==true||r.target_absent!==true||
    !Number.isFinite(issued)||!Number.isFinite(expires)||issued>now||expires<=now||expires-issued>24*60*60*1000)
    throw Error('capability');
  return {bucket:uri[1]};
}
export function storage({bucket,token,fetcher=fetch}){
  if(!bucket||!token)throw Error('storage');
  const base=`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(KEY)}`;
  const headers={Authorization:`Bearer ${token}`};
  const request=(url,options={})=>fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000),headers:{...headers,...options.headers}});
  return {
    async reserve(){const response=await request(base);await response.body?.cancel();if(response.status!==404)throw Error('target_unavailable');},
    async create(bytes){
      const url=`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(KEY)}&ifGenerationMatch=0`;
      const response=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:bytes});
      if(!response.ok){await response.body?.cancel();throw Error('write_unknown');}
      const body=await response.json();
      if(body?.bucket!==bucket||body.name!==KEY||!/^\d+$/.test(body.generation??''))throw Error('write_unknown');
      return body.generation;
    },
    async read(generation){
      if(!/^\d+$/.test(generation??''))throw Error('readback');
      const response=await request(`${base}?alt=media&generation=${generation}`);
      if(!response.ok){await response.body?.cancel();throw Error('readback');}
      const len=response.headers.get('content-length');
      if(len!==null&&(!/^\d+$/.test(len)||Number(len)>12*1024*1024)){await response.body?.cancel();throw Error('readback');}
      const data=Buffer.from(await response.arrayBuffer());if(data.length>12*1024*1024)throw Error('readback');return data;
    }
  };
}
export function readOnlyWorkerApi(api){
  return Object.freeze({deployments:api.deployments,betaVersion:api.betaVersion,scriptVersion:api.scriptVersion});
}
async function main(){
  const action=process.argv[2];
  if(action==='verify-capability'){verifyCapability(process.env);console.log('{"ok":true,"capability_verified":true}');return;}
  if(action!=='capture'||process.argv.length!==4)throw Error('input');
  const candidate=await readFile(process.argv[3]);
  if(createHash('sha256').update(candidate).digest('hex')!==R2_ACTIVE_MODULE)throw Error('candidate');
  const {bucket}=verifyCapability(process.env);
  const store=storage({bucket,token:process.env.GOOGLE_ACCESS_TOKEN});
  const result=await capture({api:readOnlyWorkerApi(createFixedApi()),store,candidate,
    reference:R2_ACTIVE_MODULE,expectedActive:R2_ACTIVE_MODULE,
    controlSha:process.env.P02_CONTROL_SHA,controlTree:process.env.P02_CONTROL_TREE});
  console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await main()}catch{console.error('{"ok":false,"reason":"input_or_capability_invalid","retry":false}');process.exitCode=1;}
}
