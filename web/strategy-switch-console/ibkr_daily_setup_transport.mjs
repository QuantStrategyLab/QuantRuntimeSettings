import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {executePrimaryDailySetup} from './execute_ibkr_daily_setup.mjs';
import {comparison,primaryBinding} from './compare_ibkr_daily_binding.mjs';
import {appendPrimaryDailyRegistration,prepareIbkrDailyVersion} from './prepare_ibkr_daily_version.mjs';
import {hasRelevantWriter,writtenSecretsHaveFreshMetadata,versionResponseLimit} from './ibkr_daily_setup_checks.mjs';

const qrs='QuantStrategyLab/QuantRuntimeSettings', ibkr='QuantStrategyLab/InteractiveBrokersPlatform';
const oldVersion='2b097d2e-ffb5-4f08-af3b-9cc1d4b9e9ee';
const qrsRun='40728959942', ibkrRun='40728951358';
const worker='qsl-strategy-switch-console';
const token=process.env.CLOUDFLARE_API_TOKEN, account=process.env.CLOUDFLARE_ACCOUNT_ID;
const namespace=process.env.STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID, ghToken=process.env.RUNTIME_SETTINGS_GH_TOKEN;
const ownToken=process.env.GITHUB_TOKEN, ownRun=process.env.GITHUB_RUN_ID;
if (!token || !ghToken || !ownToken || !/^[a-f0-9]{32}$/i.test(account ?? '') || !/^[a-f0-9]{32}$/i.test(namespace ?? '') || !/^\d+$/.test(ownRun ?? '')) {
  console.log(JSON.stringify({status:'stopped',phase:'configuration',retry:false})); process.exit(1);
}
const scriptBase=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}`;
const betaBase=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/workers/${worker}`;
const kvBase=`https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespace}/values`;
let baseline, moduleResponseLimit=versionResponseLimit();
function gh(args,{input,repo=qrs}={}) {
  const p=spawnSync('gh',args,{input,encoding:'utf8',timeout:30000,maxBuffer:10*1024*1024,
    env:{...process.env,GH_TOKEN:repo===ibkr?ghToken:ownToken}});
  if (p.status !== 0 || p.error) throw Error('github_request_failed');
  return p.stdout;
}
async function request(url,{method='GET',body,raw=false,missing=false,limit=524288}={}) {
  const r=await fetch(url,{method,body,redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{Authorization:`Bearer ${token}`,Accept:raw?'application/json':'application/json','Accept-Encoding':'identity',
      ...(body===undefined?{}:{'Content-Type':'application/json'})}});
  if (missing && r.status===404) { await r.body?.cancel(); return null; }
  if (!r.ok || !r.body || !['','identity'].includes(r.headers.get('content-encoding') ?? '')) { await r.body?.cancel(); throw Error('cloudflare_request_failed'); }
  const contentType=r.headers.get('content-type') ?? '';
  if (!raw && !/^application\/json(?:\s*;|$)/i.test(contentType)) { await r.body.cancel(); throw Error('response_type'); }
  const length=r.headers.get('content-length');
  if (length!==null && (!/^\d+$/.test(length) || Number(length)>limit)) { await r.body.cancel(); throw Error('response_length'); }
  const reader=r.body.getReader(), chunks=[]; let size=0;
  try { for (;;) {const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>limit)throw Error('response_too_large'); chunks.push(value);} }
  finally {await reader.cancel();}
  if (length!==null && Number(length)!==size) throw Error('response_length');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  if (raw) return text;
  const data=JSON.parse(text);
  if (data?.success!==true || (data.errors!=null && (!Array.isArray(data.errors)||data.errors.length))) throw Error('cloudflare_envelope');
  return data.result;
}
const kvRead = async key => request(`${kvBase}/${key}`,{raw:true,missing:true});
const canonical = x => JSON.stringify(x);
async function deployment() {
  const list=(await request(`${scriptBase}/deployments?page=1&per_page=10`))?.deployments;
  if (!Array.isArray(list) || !list.length || list.length>10 || list[0].strategy!=='percentage'
      || !Array.isArray(list[0].versions) || list[0].versions.length!==1) throw Error('deployment_invalid');
  return {id:list[0].id,version:list[0].versions[0].version_id,percentage:list[0].versions[0].percentage};
}
async function latest() {
  const items=(await request(`${scriptBase}/versions?page=1&per_page=10`))?.items;
  if (!Array.isArray(items) || !items.length || items.length>10) throw Error('versions_invalid');
  return items.map(x=>x.id);
}
async function readVersion(id) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) throw Error('version_invalid');
  const [meta,withModules]=await Promise.all([request(`${scriptBase}/versions/${id}`),request(`${betaBase}/versions/${id}?include=modules`,{limit:moduleResponseLimit})]);
  const modules=withModules?.modules;
  if (meta?.id!==id || withModules?.id!==id || !Array.isArray(modules) || modules.length!==1
      || modules[0]?.name!=='worker.js' || modules[0]?.content_type!=='application/javascript+module'
      || typeof modules[0]?.content_base64!=='string' || (withModules.migrations!==undefined && Object.keys(withModules.migrations).length)) throw Error('module_invalid');
  return {resources:meta.resources,moduleBase64:modules[0].content_base64};
}
function secretsMetadata() {
  const x=JSON.parse(gh(['api',`repos/${ibkr}/actions/secrets?per_page=100`],{repo:ibkr}));
  if (!Array.isArray(x.secrets) || x.total_count!==x.secrets.length || x.secrets.length>=100) throw Error('secret_metadata_invalid');
  return x.secrets;
}
function compareEvidence() {
  const qr=JSON.parse(gh(['api',`repos/${qrs}/actions/runs/${qrsRun}`]));
  const ir=JSON.parse(gh(['api',`repos/${ibkr}/actions/runs/${ibkrRun}`],{repo:ibkr}));
  if (qr.status!=='completed' || qr.conclusion!=='success' || qr.head_sha!=='489f31f64de99cf589f1459ff256687c2fb8fe4f'
      || ir.status!=='completed' || ir.conclusion!=='success' || ir.head_sha!=='0e143781ebe15999d1dee24f8c9ce79a58fbec90') throw Error('comparison_run_invalid');
  const qlog=gh(['run','view',qrsRun,'-R',qrs,'--log']);
  const ilog=gh(['run','view',ibkrRun,'-R',ibkr,'--log'],{repo:ibkr});
  const nonces=[...qlog.matchAll(/DAILY_COMPARISON_NONCE: ([a-f0-9]{64})/g)].map(m=>m[1]);
  const extract=log=>[...log.matchAll(/status=ok comparison=([a-f0-9]{64})/g)].map(m=>m[1]);
  const q=extract(qlog), i=extract(ilog);
  if (new Set(nonces).size!==1 || q.length!==1 || i.length!==1 || q[0]!==i[0]) throw Error('comparison_invalid');
  return {nonce:nonces[0],expectedComparison:q[0],sourceTime:ir.created_at};
}
function validateSourceSecrets(secrets,sourceTime) {
  const required=['IBKR_ACCOUNT_FACTS_PROJECT_ID','IBKR_ACCOUNT_FACTS_REPORT_PREFIX','IBKR_ACCOUNT_FACTS_TARGET_ID',
    'IBKR_ACCOUNT_FACTS_SERVICE_NAME','IBKR_ACCOUNT_FACTS_RUNTIME_REVISION','IBKR_ACCOUNT_FACTS_ACCOUNT_SCOPE',
    'IBKR_ACCOUNT_FACTS_ACCOUNT_SELECTOR_JSON','IBKR_ACCOUNT_FACTS_DEPLOYMENT_SELECTOR','IBKR_PERIOD_RETURN_ACCOUNT_KEY',
    'IBKR_PERIOD_RETURN_ACCOUNT_SCOPE','IBKR_PERIOD_RETURN_SOURCE_BINDING_ID','IBKR_PERIOD_RETURN_TARGET_ID'];
  const start=Date.parse(sourceTime);
  if (!Number.isFinite(start) || required.some(name=>{const matches=secrets.filter(x=>x.name===name);return matches.length!==1 || !Number.isFinite(Date.parse(matches[0].updated_at)) || Date.parse(matches[0].updated_at)>=start;})) throw Error('source_changed');
}
function noWriters() {
  for (const repo of [qrs,ibkr]) for (const status of ['queued','in_progress','waiting','pending','requested']) {
    const x=JSON.parse(gh(['api',`repos/${repo}/actions/runs?status=${status}&per_page=100`],{repo}));
    if (!Array.isArray(x.workflow_runs) || x.total_count!==x.workflow_runs.length || x.workflow_runs.length>=100) throw Error('runs_incomplete');
    if (hasRelevantWriter(x.workflow_runs,repo===qrs?'qrs':'ibkr',ownRun)) throw Error('concurrent_writer');
  }
}
async function configuration() {
  const [options,bindings,registryRaw]=await Promise.all([kvRead('account_options'),kvRead('account_facts_bindings'),kvRead('runtime_daily_bindings')]);
  if (options===null || bindings===null) throw Error('binding_missing');
  return {options:JSON.parse(options),bindings:JSON.parse(bindings),registryRaw,
    registry:registryRaw===null?{schema_version:'qsl_runtime_daily_bindings.v1',bindings:[]}:JSON.parse(registryRaw)};
}
async function unchanged(before,{uploaded,secretNames=[]}={}) {
  noWriters(); const current=await deployment(), versions=await latest(), config=await configuration();
  if (current.id!==before.deploymentId || current.version!==oldVersion || current.percentage!==100
      || versions[0] !== (uploaded ?? oldVersion) || (uploaded && versions[1]!==oldVersion)
      || config.registryRaw!==before.registryRaw || comparison(config.options,config.bindings,before.nonce)!==before.expectedComparison) throw Error('state_changed');
  const secrets=secretsMetadata();
  validateSourceSecrets(secrets,before.sourceTime);
  const newNames=['IBKR_RUNTIME_DAILY_SYNC_TOKEN','IBKR_RUNTIME_DAILY_TARGET_KEY'];
  if (newNames.some(name=>secrets.some(x=>x.name===name)!==secretNames.includes(name))) throw Error('secret_state_changed');
}
const io={
  async preflight() {
    noWriters(); const evidence=compareEvidence(), secrets=secretsMetadata(); validateSourceSecrets(secrets,evidence.sourceTime);
    gh(['api',`repos/${ibkr}/actions/secrets/public-key`],{repo:ibkr});
    const [current,versions,config,version]=await Promise.all([deployment(),latest(),configuration(),readVersion(oldVersion)]);
    moduleResponseLimit=versionResponseLimit(version.moduleBase64.length);
    const own=JSON.parse(gh(['api',`repos/${qrs}/actions/runs/${ownRun}`]));
    if (!Number.isFinite(Date.parse(own.created_at))) throw Error('run_metadata_invalid');
    baseline={...evidence,...config,...version,startedAt:own.created_at,deploymentId:current.id,activeVersion:current.version,percentage:current.percentage,
      latestVersion:versions[0],concurrentWriters:false,githubSecretNames:secrets.map(x=>x.name)};
    return baseline;
  },
  verifyUnchanged:unchanged,
  async uploadVersion(value) { const x=await request(`${betaBase}/versions?deploy=false`,{method:'POST',body:JSON.stringify(value),limit:moduleResponseLimit}); return x?.id; },
  readVersion,
  async writeGithubSecret(name,value) { gh(['secret','set',name,'--repo',ibkr],{input:value,repo:ibkr}); },
  async verifyGithubSecretMetadata() { if (!writtenSecretsHaveFreshMetadata(secretsMetadata(),baseline.startedAt)) throw Error('secret_readback'); },
  async writeRegistry(value) { await request(`${kvBase}/runtime_daily_bindings`,{method:'PUT',body:JSON.stringify(value)}); },
  async verifyRegistry(value) { if (canonical(JSON.parse(await kvRead('runtime_daily_bindings'))) !== canonical(value)) throw Error('registry_readback'); },
  async verifyBeforeActivation(before,{uploaded,registry}) {
    noWriters(); const current=await deployment(),versions=await latest(),config=await configuration();
    if (current.id!==before.deploymentId || current.version!==oldVersion || current.percentage!==100
        || versions[0]!==uploaded || versions[1]!==oldVersion || canonical(config.registry)!==canonical(registry)
        || comparison(config.options,config.bindings,before.nonce)!==before.expectedComparison) throw Error('activation_guard');
    validateSourceSecrets(secretsMetadata(),before.sourceTime);
  },
  async activate(version) { return (await request(`${scriptBase}/deployments?force=false`,{method:'POST',body:JSON.stringify({strategy:'percentage',versions:[{version_id:version,percentage:100}],annotations:{'workers/message':'IBKR primary daily binding'}})}))?.id; },
  async verifyDeployment(version,id) { const d=await deployment(); if (!id || d.id!==id || d.version!==version || d.percentage!==100) throw Error('deployment_readback'); },
};
if (process.env.DAILY_SETUP_MODE==='preflight') {
  try {
    const state=await io.preflight();
    if (state.activeVersion!==oldVersion || state.latestVersion!==oldVersion || state.percentage!==100
        || state.githubSecretNames.some(name=>['IBKR_RUNTIME_DAILY_SYNC_TOKEN','IBKR_RUNTIME_DAILY_TARGET_KEY'].includes(name))
        || comparison(state.options,state.bindings,state.nonce)!==state.expectedComparison) throw Error('preflight_mismatch');
    const module=Buffer.from(state.moduleBase64,'base64');
    if (module.toString('base64')!==state.moduleBase64 || createHash('sha256').update(module).digest('hex')!=='d1e10f49c2a537733751ac8418384c1bffa52763cb959521f5c5bf7940e2149e') throw Error('module_mismatch');
    const binding=primaryBinding(state.options,state.bindings);
    const targetKey=`${binding.service_name}|tqqq_growth_income|${binding.account_scope}|${'0'.repeat(32)}`;
    appendPrimaryDailyRegistration(state.registry,{account_key:binding.account_key,target_id:binding.target_id,
      source_binding_id:binding.source_binding_id,strategy_profile:'tqqq_growth_income',target_key:targetKey});
    prepareIbkrDailyVersion({activeVersion:oldVersion,existingBindings:state.resources.bindings,runtime:state.resources.script_runtime,
      moduleBase64:state.moduleBase64,token:'0'.repeat(64),targetKey});
    await io.verifyUnchanged(state);
    console.log(JSON.stringify({status:'preflight_verified',writes:0}));
  } catch { console.log(JSON.stringify({status:'preflight_blocked',writes:0})); process.exitCode=1; }
} else if (process.env.DAILY_SETUP_MODE==='execute') {
  const result=await executePrimaryDailySetup(io);
  console.log(JSON.stringify(result));
  if (result.status!=='configured') process.exitCode=1;
} else {
  console.log(JSON.stringify({status:'stopped',phase:'mode',retry:false})); process.exitCode=1;
}
