// M09/P02 release remains closed until the reviewed source, bundle, active
// deployment and verified rollback version have all been pinned in this file.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createFixedApi} from './console_946_backend_release.mjs';
import {execute} from './console_full_bundle_release.mjs';
import {RECOVERY_SNAPSHOT} from './console_frontend_candidate_preflight.mjs';
import {compareAssetDeclarations} from './console_m09_asset_compare.mjs';

export const POLICY = Object.freeze({source:'cabe5a1534e0c992713b084030af313eada758ca',
  tree:'42b404d5755b658deff73100b495ecf26fa3a6b1',
  frontendBlob:RECOVERY_SNAPSHOT.assetBlob,
  before:RECOVERY_SNAPSHOT.bundleSha256,
  candidate:'ea76cfb5648486a8358f7bd339807f1aa8c0dc1a7eb70df1d31518bad0d957d3',
  version:null, deployment:null, rollback:null});
const hex=(x,n)=>typeof x==='string'&&new RegExp(`^[a-f0-9]{${n}}$`).test(x);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
function sourcePinned(p) {
  return !!p && hex(p.source,40) && hex(p.tree,40) && hex(p.frontendBlob,40) &&
    hex(p.before,64) && hex(p.candidate,64);
}
export function pinned(p) {
  return sourcePinned(p) && uuid(p.version) && uuid(p.deployment) &&
    uuid(p.rollback) && p.rollback===p.version;
}
// No provider method is touched until all provenance and rollback pins match.
export async function release({api, policy, evidence, candidate, release=false}) {
  if (!pinned(policy) || !evidence || evidence.source!==policy.source || evidence.tree!==policy.tree ||
      evidence.frontendBlob!==policy.frontendBlob || !Buffer.isBuffer(candidate) || hash(candidate)!==policy.candidate)
    return {ok:false,reason:'hold_or_provenance_mismatch',upload_attempted:false,deploy_attempted:false};
  return execute({api,policy:{before:policy.before,candidate:policy.candidate},
    expected:{version:policy.version,deployment:policy.deployment},candidate,release});
}
export function createPreflightApi(fixedApi=createFixedApi()) {
  const {deployments,versions,scriptVersion,betaVersion}=fixedApi;
  return Object.freeze({deployments,versions,scriptVersion,betaVersion});
}
function activeIdentity(result) {
  const list=result?.deployments;
  const top=list?.[0];
  const [slot]=Array.isArray(top?.versions)?top.versions:[];
  if(!Array.isArray(list)||list.length>10||!uuid(top?.id)||top.strategy!=='percentage'||
     top.versions?.length!==1||!uuid(slot?.version_id)||slot.percentage!==100) throw Error('invalid_active');
  return {deployment:top.id,version:slot.version_id};
}
function versions(result) {
  const items=result?.items;
  if(!Array.isArray(items)||!items.length||items.length>10||items.some(x=>!uuid(x?.id))||
     new Set(items.map(x=>x.id)).size!==items.length) throw Error('invalid_versions');
  return items.map(x=>x.id);
}
function readModule(result,id) {
  const module=result?.modules?.[0];
  if(result?.id!==id||!Array.isArray(result.modules)||result.modules.length!==1||
     module?.name!=='worker.js'||module.content_type!=='application/javascript+module'||
     typeof module.content_base64!=='string'||!module.content_base64.length||
     module.content_base64.length>Math.ceil(10*1024*1024/3)*4) throw Error('invalid_module');
  const bytes=Buffer.from(module.content_base64,'base64');
  if(!bytes.length||bytes.length>10*1024*1024||bytes.toString('base64')!==module.content_base64)
    throw Error('invalid_module');
  return bytes;
}
// This bounded check is separate from release and never returns the module or IDs.
export async function inspectActiveAssets(api,candidate,expectedHash=POLICY.candidate) {
  if(!Buffer.isBuffer(candidate)||hash(candidate)!==expectedHash)
    return {ok:false,reason:'candidate_mismatch'};
  let stage='active_before';
  try {
    const prior=activeIdentity(await api.deployments());
    stage='active_module';
    const active=readModule(await api.betaVersion(prior.version),prior.version);
    stage='active_after';
    const after=activeIdentity(await api.deployments());
    if(after.deployment!==prior.deployment||after.version!==prior.version)
      return {ok:false,reason:'active_drift'};
    return {...compareAssetDeclarations(active,candidate),active_identity_unchanged:true};
  } catch {
    return {ok:false,reason:stage};
  }
}
function readConfiguration(result,id) {
  const resources=result?.resources;
  const runtime=resources?.script_runtime,script=resources?.script;
  if(result?.id!==id||!runtime||!script||!Array.isArray(resources.bindings)||resources.bindings.length>128||
     resources.bindings.some(b=>typeof b?.type!=='string')||!/^\d{4}-\d{2}-\d{2}$/.test(runtime.compatibility_date??'')||
     !['standard','bundled','unbound'].includes(runtime.usage_model)||
     (script.placement_mode!=null&&!['smart','off'].includes(script.placement_mode))||
     (runtime.compatibility_flags!==undefined&&!Array.isArray(runtime.compatibility_flags))||
     (script.named_handlers!==undefined&&!Array.isArray(script.named_handlers))) throw Error('invalid_configuration');
  return resources;
}
// Inspect the same inputs the write path would inherit. Return only redacted evidence.
async function inspectBackendRelease(api, referenceHash) {
  let stage='traffic';
  const result={read_only:true,upload_attempted:false,deploy_attempted:false};
  try {
    const initial=await api.deployments();
    const traffic=initial?.deployments?.[0]?.versions;
    if (Array.isArray(traffic) && traffic.length<=10 && traffic.every(v=>uuid(v?.version_id)&&Number.isFinite(v?.percentage)))
      result.traffic=traffic.map((v,index)=>({slot:index+1,percentage:v.percentage}));
    const prior=activeIdentity(initial);
    result.single_active_version=true;
    stage='version_list';
    const listed=versions(await api.versions());
    result.active_listed=listed.includes(prior.version);
    result.active_is_latest=listed[0]===prior.version;
    stage='module';
    const bytes=readModule(await api.betaVersion(prior.version),prior.version);
    result.module_matches_reference=hash(bytes)===referenceHash;
    stage='configuration';
    const live=readConfiguration(await api.scriptVersion(prior.version),prior.version);
    const runtime=live.script_runtime;
    const script=live.script;
    result.configuration={
      bindings:Object.fromEntries(['plain_text','json','secret_text','kv_namespace','durable_object_namespace']
        .map(type=>[type,live.bindings.filter(b=>b.type===type).length])),
      binding_count:live.bindings.length,
      compatibility_date:runtime.compatibility_date, compatibility_flag_count:runtime.compatibility_flags?.length??0,
      usage_model:runtime.usage_model, limits_present:runtime.limits!=null, migration_tag_present:typeof runtime.migration_tag==='string'&&!!runtime.migration_tag,
      named_handler_count:script.named_handlers?.length??0, placement_mode:script.placement_mode??null,
      candidate_configuration_source:'active_version_inheritance',
      candidate_provider_configuration_observed:false,
    };
    stage='recheck';
    if (JSON.stringify(activeIdentity(await api.deployments()))!==JSON.stringify(prior) ||
        JSON.stringify(versions(await api.versions()))!==JSON.stringify(listed)) throw Error('active_drift');
    return {result:{...result,ok:true,active_identity_unchanged:true},version:prior.version};
  } catch {
    return {result:{...result,ok:false,stage}};
  }
}

export function readRollbackTargets(git) {
  const workflow=git('show','HEAD:.github/workflows/deploy-strategy-switch-console.yml');
  const fixed=workflow.split('      - name: Restore fixed pre-release Worker version');
  if(fixed.length!==2)throw Error('rollback_policy');
  const target=pattern=>{
    const matches=[...fixed[1].matchAll(pattern)];
    if(matches.length!==1||!uuid(matches[0][1]))throw Error('rollback_policy');
    return matches[0][1];
  };
  return {
    fixed:[target(/const target = process\.env\.ROLLBACK_VERSION \|\| '([^']+)';/g),
      target(/const fe11 = target === '([^']+)';/g)],
    fixedSuccessor:target(/const dailyRestore = target === '([^']+)';/g),
  };
}
export async function preflight(api,rollbackTargets={fixed:[],fixedSuccessor:null}) {
  const {result,version}=await inspectBackendRelease(api,POLICY.before);
  if(!result.ok)return result;
  // The daily restore target requires a specific, unrelated successor deployment.
  const route=rollbackTargets.fixed.includes(version) ? 'fixed_target'
    : version===rollbackTargets.fixedSuccessor ? 'fixed_successor_only' : 'no_matching_target';
  return {...result,source:POLICY.source,candidate_sha256:POLICY.candidate,reference_sha256:POLICY.before,
    rollback:{route,prior_version_readable:true,write_rehearsed:false,
      eligible_after_release:route==='fixed_target'&&result.active_listed&&result.module_matches_reference&&result.configuration.migration_tag_present},
    hold:true};
}
async function main() {
  const [action,path,...extra]=process.argv.slice(2);
  const sourceOnly=['build-source','asset-candidate-source','preflight'];
  const readOnly=['asset-candidate-source','asset-compare','preflight'].includes(action);
  if (extra.length || ![...sourceOnly,'verify-inputs','asset-compare','release'].includes(action) ||
      (sourceOnly.includes(action) ? path!==undefined : !path)) throw Error('arguments');
  if (readOnly ? !sourcePinned(POLICY) : !pinned(POLICY)) throw Error('hold');
  const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
  git('merge-base','--is-ancestor',POLICY.source,'HEAD');
  const evidence={source:git('rev-parse',`${POLICY.source}^{commit}`),tree:git('rev-parse',`${POLICY.source}^{tree}`),
    frontendBlob:git('rev-parse',`${RECOVERY_SNAPSHOT.commit}:web/strategy-switch-console/v2_asset_map.js`)};
  if (POLICY.before!==RECOVERY_SNAPSHOT.bundleSha256 || POLICY.frontendBlob!==RECOVERY_SNAPSHOT.assetBlob ||
      evidence.source!==POLICY.source || evidence.tree!==POLICY.tree || evidence.frontendBlob!==POLICY.frontendBlob)
    throw Error('provenance');
  if (action==='preflight') {
    const result=await preflight(createPreflightApi(),readRollbackTargets(git));
    console.log(JSON.stringify(result));
    if(!result.ok)process.exitCode=1;
    return;
  }
  if (action==='build-source'||action==='asset-candidate-source') {
    console.log(POLICY.source);
    return;
  }
  const candidate=await readFile(path);
  if (hash(candidate)!==POLICY.candidate) throw Error('provenance');
  if (action==='verify-inputs') return;
  const result=action==='asset-compare' ? await inspectActiveAssets(createPreflightApi(),candidate)
    : await release({api:createFixedApi(),policy:POLICY,evidence,candidate,release:true});
  console.log(JSON.stringify(result));
  if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  try{await main()}catch{console.error(JSON.stringify({ok:false,reason:'hold_or_input_invalid',upload_attempted:false,deploy_attempted:false}));process.exitCode=1;}
