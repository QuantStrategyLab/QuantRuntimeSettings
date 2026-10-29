import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {executePrimaryDailySetup,executeAdditionalDailySetup} from './execute_ibkr_daily_setup.mjs';
import {comparison,primaryBinding,matchAdditionalDailyBinding} from './compare_ibkr_daily_binding.mjs';
import {appendPrimaryDailyRegistration,prepareIbkrDailyVersion,prepareAdditionalDailySetup} from './prepare_ibkr_daily_version.mjs';
import {DEFAULT_STRATEGY_PROFILES} from './strategy_profiles_asset.js';
import {hasRelevantWriter,writtenSecretsHaveFreshMetadata,versionResponseLimit,matchesConfigNamespace,selectInventoryMetadata} from './ibkr_daily_setup_checks.mjs';

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
let baseline, diagnosticStage='configuration', diagnosticOperation=null, diagnosticHttpStatus=null, moduleResponseLimit=versionResponseLimit();
function gh(args,{input,repo=qrs}={}) {
  const path=args[1] ?? '';
  diagnosticOperation=args[0]==='run'?'gh_run_logs':path.includes('/actions/runs?')?'gh_runs':path.includes('/actions/runs/')?'gh_run_metadata':
    path.includes('/actions/secrets/public-key')?'gh_public_key':path.includes('/actions/secrets?')?'gh_secret_metadata':'gh_other';
  diagnosticHttpStatus=null;
  const p=spawnSync('gh',args,{input,encoding:'utf8',timeout:30000,maxBuffer:10*1024*1024,
    env:{...process.env,GH_TOKEN:repo===ibkr?ghToken:ownToken}});
  if (p.status !== 0 || p.error) {
    const status=/\bHTTP\s+([1-5]\d\d)\b/.exec(p.stderr ?? '');
    if(status)diagnosticHttpStatus=Number(status[1]);
    throw Error('github_request_failed');
  }
  return p.stdout;
}
async function request(url,{method='GET',body,raw=false,missing=false,limit=524288}={}) {
  diagnosticOperation=url.startsWith(kvBase)?'cf_kv':url.includes('/deployments')?'cf_deployment':url.includes('/versions')?'cf_version':'cf_other';
  diagnosticHttpStatus=null;
  const r=await fetch(url,{method,body,redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{Authorization:`Bearer ${token}`,Accept:raw?'application/json':'application/json','Accept-Encoding':'identity',
      ...(body===undefined?{}:{'Content-Type':'application/json'})}});
  diagnosticHttpStatus=r.status;
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
const validUuid = value => typeof value==='string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
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
  const meta=await request(`${scriptBase}/versions/${id}`);
  const withModules=await request(`${betaBase}/versions/${id}?include=modules`,{limit:moduleResponseLimit});
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
  const options=await kvRead('account_options');
  const bindings=await kvRead('account_facts_bindings');
  const registryRaw=await kvRead('runtime_daily_bindings');
  if (options===null || bindings===null) throw Error('binding_missing');
  return {options:JSON.parse(options),bindings:JSON.parse(bindings),registryRaw,
    registry:registryRaw===null?{schema_version:'qsl_runtime_daily_bindings.v1',bindings:[]}:JSON.parse(registryRaw)};
}
async function unchanged(before,{uploaded,secretNames=[]}={}) {
  noWriters(); const current=await deployment(), versions=await latest(), config=await configuration();
  diagnosticOperation='state_compare'; diagnosticHttpStatus=null;
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
    diagnosticStage='writer_check'; noWriters();
    diagnosticStage='comparison_evidence'; const evidence=compareEvidence();
    diagnosticStage='source_secret_metadata'; const secrets=secretsMetadata(); validateSourceSecrets(secrets,evidence.sourceTime);
    diagnosticStage='github_public_key';
    gh(['api',`repos/${ibkr}/actions/secrets/public-key`],{repo:ibkr});
    diagnosticStage='deployment'; const current=await deployment();
    diagnosticStage='versions'; const versions=await latest();
    diagnosticStage='configuration_read'; const config=await configuration();
    diagnosticStage='version_read'; const version=await readVersion(oldVersion);
    diagnosticStage='namespace_check'; diagnosticOperation='namespace_check'; diagnosticHttpStatus=null;
    if (!matchesConfigNamespace(version.resources,namespace)) throw Error('kv_namespace_mismatch');
    moduleResponseLimit=versionResponseLimit(version.moduleBase64.length);
    diagnosticStage='own_run_metadata';
    const own=JSON.parse(gh(['api',`repos/${qrs}/actions/runs/${ownRun}`]));
    if (!Number.isFinite(Date.parse(own.created_at))) throw Error('run_metadata_invalid');
    baseline={...evidence,...config,...version,startedAt:own.created_at,deploymentId:current.id,activeVersion:current.version,percentage:current.percentage,
      latestVersion:versions[0],concurrentWriters:false,githubSecretNames:secrets.map(x=>x.name)};
    return baseline;
  },
  verifyUnchanged:unchanged,
  async uploadVersion(value) { const x=await request(`${betaBase}/versions?deploy=false`,{method:'POST',body:JSON.stringify(value),limit:moduleResponseLimit}); if(!validUuid(x?.id))throw Error('upload_id_invalid'); return x.id; },
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
  async activate(version) { const x=await request(`${scriptBase}/deployments?force=false`,{method:'POST',body:JSON.stringify({strategy:'percentage',versions:[{version_id:version,percentage:100}],annotations:{'workers/message':'IBKR primary daily binding'}})}); if(!validUuid(x?.id))throw Error('deployment_id_invalid'); return x.id; },
  async verifyDeployment(version,id) { const d=await deployment(); if (!id || d.id!==id || d.version!==version || d.percentage!==100) throw Error('deployment_readback'); },
};
// Read comparison evidence from the original IBKR workflow, never its raw logs or bindings.
function additionalEvidence(nonce, runs) {
  if (!/^[a-f0-9]{64}$/.test(nonce ?? '') || !Array.isArray(runs) || runs.length!==3
      || new Set(runs).size!==3 || runs.some(id=>!/^\d+$/.test(id ?? ''))) throw Error('comparison_invalid');
  const slots=['additional-1','additional-2','additional-3'], out={}, times=[];
  for (let i=0;i<slots.length;i++) {
    const run=JSON.parse(gh(['api',`repos/${ibkr}/actions/runs/${runs[i]}`],{repo:ibkr}));
    if (run.status!=='completed' || run.conclusion!=='success' || run.run_attempt!==1 || run.event!=='workflow_dispatch'
      || run.head_branch!=='main' || String(run.path||'').split('@')[0]!=='.github/workflows/primary-account-facts-readonly.yml'
      || !Number.isFinite(Date.parse(run.created_at))) throw Error('comparison_invalid');
    const jobs=JSON.parse(gh(['api',`repos/${ibkr}/actions/runs/${runs[i]}/jobs?per_page=100`],{repo:ibkr}));
    const candidates=jobs?.jobs?.filter(job=>job.name==='compare-additional-website-binding / inspect');
    if (!Array.isArray(jobs?.jobs) || jobs.total_count!==jobs.jobs.length || !Array.isArray(candidates) || candidates.length!==1
        || candidates[0].conclusion!=='success' || !Number.isSafeInteger(candidates[0].id)) throw Error('comparison_invalid');
    const version=gh(['--version'],{repo:ibkr}), match=/^gh version (\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(version);
    const modern=match && (Number(match[1])>2 || (Number(match[1])===2 && Number(match[2])>=97));
    const log=gh(['api','--method','GET',...(modern?['--allow-escape-sequences']:[]),
      `repos/${ibkr}/actions/jobs/${candidates[0].id}/logs`],{repo:ibkr});
    const matches=[...log.matchAll(/status=ok slot=(additional-[123]) comparison=([a-f0-9]{64})/g)];
    const nonces=[...log.matchAll(/DAILY_COMPARISON_NONCE: ([a-f0-9]{64})/g)].map(x=>x[1]);
    if (matches.length!==1 || matches[0][1]!==slots[i] || new Set(nonces).size!==1 || nonces[0]!==nonce) throw Error('comparison_invalid');
    out[slots[i]]=matches[0][2]; times.push(Date.parse(run.created_at));
  }
  return {digests:out,sourceTime:Math.min(...times)};
}
function additionalSourceFresh(secrets, sourceTime) {
  const names=['IBKR_ACCOUNT_FACTS_ADDITIONAL_TARGETS_JSON','IBKR_PERIOD_RETURN_ADDITIONAL_ACCOUNT_KEYS_JSON','IBKR_PERIOD_RETURN_ADDITIONAL1_ACCOUNT_KEY',
    'IBKR_ACCOUNT_FACTS_ACCOUNT_SELECTOR_JSON','IBKR_ACCOUNT_FACTS_TARGET_ID','IBKR_ACCOUNT_FACTS_REPORT_PREFIX'];
  for (const name of names) {
    const rows=secrets.filter(x=>x.name===name);
    if (rows.length>1 || (rows.length===1 && (!Number.isFinite(Date.parse(rows[0].updated_at)) || Date.parse(rows[0].updated_at)>sourceTime))) throw Error('source_changed');
  }
  if (![...names.slice(0,2),...names.slice(3)].every(name=>secrets.some(x=>x.name===name))) throw Error('source_changed');
  let variable;
  try { variable=JSON.parse(gh(['api',`repos/${ibkr}/actions/variables/CLOUD_RUN_SERVICE_TARGETS_JSON`],{repo:ibkr})); }
  catch (error) { if (diagnosticHttpStatus!==404) throw error; variable=null; }
  const sec=secrets.filter(x=>x.name==='CLOUD_RUN_SERVICE_TARGETS_JSON');
  selectInventoryMetadata(variable,sec,sourceTime);
}
async function additionalState(nonce,digests) {
  noWriters();
  const current=await deployment(), versions=await latest();
  if (!validUuid(process.env.PLATFORM_CONTROL_EXPECTED_VERSION) || current.version!==process.env.PLATFORM_CONTROL_EXPECTED_VERSION
      || current.percentage!==100) throw Error('deployment_invalid');
  const config=await configuration(), profilesRaw=await kvRead('strategy_profiles');
  const primary=primaryBinding(config.options,config.bindings), old=config.registry.bindings?.find(item=>item.account_key===primary.account_key);
  const parsed=old?.target_key?.split('|');
  if (config.registry.bindings?.filter(item=>item.account_key===primary.account_key).length!==1 || !old || old.account_key!==primary.account_key || old.target_id!==primary.target_id
      || old.source_binding_id!==primary.source_binding_id || old.strategy_profile!==primary.strategy_profile
      || !Array.isArray(parsed) || parsed.length!==4 || parsed[0]!==primary.service_name || parsed[1]!==primary.strategy_profile
      || parsed[2]!==primary.account_scope || !/^[a-f0-9]{32}$/.test(parsed[3])) throw Error('primary_binding_invalid');
  const profiles=profilesRaw===null?DEFAULT_STRATEGY_PROFILES:JSON.parse(profilesRaw);
  const matches=Object.fromEntries(Object.entries(digests).map(([slot,digest])=>[slot,matchAdditionalDailyBinding(config.options,config.bindings,profiles,nonce,digest)]));
  const version=await readVersion(current.version);
  if (createHash('sha256').update(Buffer.from(version.moduleBase64,'base64')).digest('hex') !== '8084f5c66b637ac72285493f07ffa6348e8957d894bc47425928ad3cfaeda457') throw Error('module_mismatch');
  if (!matchesConfigNamespace(version.resources,namespace)) throw Error('kv_namespace_mismatch');
  moduleResponseLimit=versionResponseLimit(version.moduleBase64.length);
  const secrets=secretsMetadata();
  if (!['IBKR_RUNTIME_DAILY_SYNC_TOKEN','IBKR_RUNTIME_DAILY_TARGET_KEY'].every(name=>secrets.some(x=>x.name===name))) throw Error('secret_metadata_invalid');
  const own=JSON.parse(gh(['api',`repos/${qrs}/actions/runs/${ownRun}`]));
  if (!Number.isFinite(Date.parse(own.created_at))) throw Error('run_metadata_invalid');
  return {...config,profilesRaw,matches,primaryAccountKey:primary.account_key,...version,activeVersion:current.version,deploymentId:current.id,latestVersion:versions[0],startedAt:own.created_at};
}
async function runAdditionalMode() {
  let phase='comparison';
  try {
    const nonce=process.env.DAILY_COMPARISON_NONCE, runs=[1,2,3].map(i=>process.env[`DAILY_COMPARISON_RUN_${i}`]);
    const evidence=additionalEvidence(nonce,runs);phase='source_metadata';additionalSourceFresh(secretsMetadata(),evidence.sourceTime);
    phase='binding_read';const state=await additionalState(nonce,evidence.digests); state.nonce=nonce;state.digests=evidence.digests;state.sourceTime=evidence.sourceTime;
    phase='setup_prepare';const sample=Object.fromEntries([1,2,3].map(i=>[`additional-${i}`,String(i).repeat(32)]));
    prepareAdditionalDailySetup({registry:state.registry,matches:state.matches,suffixes:sample,activeVersion:state.activeVersion,resources:state.resources,moduleBase64:state.moduleBase64,primaryAccountKey:state.primaryAccountKey});
    const unchangedAdditional=async (before,{uploaded,registry}={})=>{
      noWriters(); const current=await deployment(),versions=await latest(),cfg=await configuration(),p=await kvRead('strategy_profiles');
      if (current.id!==before.deploymentId || current.version!==before.activeVersion || current.percentage!==100
        || versions[0] !== (uploaded ?? before.latestVersion) || (uploaded && versions[1]!==before.latestVersion)
        || canonical(cfg.options)!==canonical(before.options) || canonical(cfg.bindings)!==canonical(before.bindings) || p!==before.profilesRaw
        || (registry ? canonical(cfg.registry)!==canonical(registry) : cfg.registryRaw!==before.registryRaw)) throw Error('state_changed');
      additionalSourceFresh(secretsMetadata(),before.sourceTime);
    };
    io.additionalPreflight=async()=>state;
    io.additionalUnchanged=async(before,opts={})=>unchangedAdditional(before,opts);
    io.additionalBeforeActivation=async(before,opts)=>unchangedAdditional(before,opts);
    io.verifyAdditionalGithubSecretMetadata=async start=>{
      const row=secretsMetadata().filter(x=>x.name==='IBKR_RUNTIME_DAILY_TARGET_KEY');
      if (row.length!==1 || !Number.isFinite(Date.parse(row[0].updated_at)) || Date.parse(row[0].updated_at)<Date.parse(start)) throw Error('secret_readback');
    };
    if (process.env.DAILY_SETUP_MODE==='multi-preflight') {
      phase='state_check';await unchangedAdditional(state);
      return {status:'preflight_verified',unique_matches:3,business_writes:0};
    }
    phase='execute';return await executeAdditionalDailySetup(io,{nonce,digests:evidence.digests});
  } catch (error) {
    const allowed=new Set(['comparison_invalid','source_changed','deployment_invalid','kv_namespace_mismatch','module_mismatch','primary_binding_invalid','binding_not_unique','invalid_existing_setup','invalid_additional_binding','registration_collision','target_binding_invalid','invalid_bindings','state_changed','github_request_failed','cloudflare_request_failed']);
    return {status:'stopped',phase,reason:allowed.has(error?.message)?error.message:'unclassified',retry:false,business_writes:0};
  }
}

if (process.env.DAILY_SETUP_MODE==='preflight') {
  let healthBindingPresent=null, healthRouteReachable=null, healthVersion=null;
  try {
    const current=await deployment();
    if (current.percentage!==100 || !validUuid(current.version)) throw Error('deployment_invalid');
    const version=await request(`${scriptBase}/versions/${current.version}`);
    if (version?.id!==current.version || !Array.isArray(version.resources?.bindings)) throw Error('version_invalid');
    const matches=version.resources.bindings.filter(binding=>binding?.name==='STRATEGY_HEALTH_SYNC_TOKEN');
    healthBindingPresent=matches.length===1 && matches[0].type==='secret_text';
    healthVersion=current.version;
  } catch { /* Independent read-only diagnostic; unknown remains null. */ }
  try {
    const response=await fetch('https://qsl-strategy-switch-console.pigbibi.workers.dev/api/strategy-health',
      {method:'GET',redirect:'error',signal:AbortSignal.timeout(10000)});
    const body=await response.json();
    healthRouteReachable=response.status===401 && body?.ok===false && body?.error==='login required';
  } catch { /* Health diagnostics do not change the setup decision. */ }
  try {
    const state=await io.preflight();
    diagnosticStage='binding_comparison'; diagnosticOperation='binding_compare'; diagnosticHttpStatus=null;
    if (state.activeVersion!==oldVersion || state.latestVersion!==oldVersion || state.percentage!==100
        || state.githubSecretNames.some(name=>['IBKR_RUNTIME_DAILY_SYNC_TOKEN','IBKR_RUNTIME_DAILY_TARGET_KEY'].includes(name))
        || comparison(state.options,state.bindings,state.nonce)!==state.expectedComparison) throw Error('preflight_mismatch');
    diagnosticStage='module_check'; diagnosticOperation='module_check'; diagnosticHttpStatus=null; const module=Buffer.from(state.moduleBase64,'base64');
    if (module.toString('base64')!==state.moduleBase64 || createHash('sha256').update(module).digest('hex')!=='d1e10f49c2a537733751ac8418384c1bffa52763cb959521f5c5bf7940e2149e') throw Error('module_mismatch');
    diagnosticStage='registration_check'; diagnosticOperation='registration_check'; diagnosticHttpStatus=null; const binding=primaryBinding(state.options,state.bindings);
    const targetKey=`${binding.service_name}|tqqq_growth_income|${binding.account_scope}|${'0'.repeat(32)}`;
    appendPrimaryDailyRegistration(state.registry,{account_key:binding.account_key,target_id:binding.target_id,
      source_binding_id:binding.source_binding_id,strategy_profile:'tqqq_growth_income',target_key:targetKey});
    prepareIbkrDailyVersion({activeVersion:oldVersion,existingBindings:state.resources.bindings,runtime:state.resources.script_runtime,
      moduleBase64:state.moduleBase64,token:'0'.repeat(64),targetKey});
    diagnosticStage='final_readback'; await io.verifyUnchanged(state);
    console.log(JSON.stringify({status:'preflight_verified',writes:0,health_binding_present:healthBindingPresent,health_route_reachable:healthRouteReachable,health_version:healthVersion}));
  } catch (error) {
    const allowed=new Set(['github_request_failed','cloudflare_request_failed','response_type','response_length','response_too_large','cloudflare_envelope',
      'deployment_invalid','versions_invalid','version_invalid','module_invalid','secret_metadata_invalid','comparison_run_invalid','comparison_invalid',
      'source_changed','runs_incomplete','concurrent_writer','binding_missing','state_changed','secret_state_changed','kv_namespace_mismatch',
      'run_metadata_invalid','preflight_mismatch','module_mismatch','invalid_input','invalid_registry','registration_collision','invalid_bindings','binding_exists','invalid_runtime',
      'target_not_unique','option_mismatch','invalid_runs','invalid_module_length']);
    const reason=allowed.has(error?.message)?error.message:'unclassified';
    console.log(JSON.stringify({status:'preflight_blocked',stage:diagnosticStage,operation:diagnosticOperation,reason,http_status:diagnosticHttpStatus,writes:0,
      health_binding_present:healthBindingPresent,health_route_reachable:healthRouteReachable,health_version:healthVersion})); process.exitCode=1;
  }
} else if (process.env.DAILY_SETUP_MODE==='multi-preflight' || process.env.DAILY_SETUP_MODE==='multi-execute') {
  const result=await runAdditionalMode();
  console.log(JSON.stringify(result));
  if (!['preflight_verified','configured'].includes(result.status)) process.exitCode=1;
} else if (process.env.DAILY_SETUP_MODE==='execute') {
  const result=await executePrimaryDailySetup(io);
  console.log(JSON.stringify(result));
  if (result.status!=='configured') process.exitCode=1;
} else {
  console.log(JSON.stringify({status:'stopped',phase:'mode',retry:false})); process.exitCode=1;
}
