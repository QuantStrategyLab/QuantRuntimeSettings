import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import {primaryBinding, comparison} from './compare_ibkr_daily_binding.mjs';
import {appendPrimaryDailyRegistration, prepareIbkrDailyVersion, validateIbkrDailyVersion, prepareAdditionalDailySetup, validateAdditionalDailyVersion} from './prepare_ibkr_daily_version.mjs';
import {prepareExecutionDailyRegistration} from './prepare_execution_daily_registration.mjs';

const ACTIVE = '2b097d2e-ffb5-4f08-af3b-9cc1d4b9e9ee';
const MODULE_SHA = 'd1e10f49c2a537733751ac8418384c1bffa52763cb959521f5c5bf7940e2149e';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const equalHash = (a,b) => /^[a-f0-9]{64}$/.test(a ?? '') && /^[a-f0-9]{64}$/.test(b ?? '')
  && timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));

// One fixed TQQQ operation. The transport is injected so tests exercise failures
// without hitting a real Worker, KV namespace, or GitHub secret.
export async function executePrimaryDailySetup(io) { return execute(io,MODULE_SHA); }
async function execute(io, moduleSha, anchor) {
  let phase = 'preflight', attempted = false, uploaded = null;
  const effects = [];
  try {
    const before = await io.preflight();
    if (before.activeVersion !== ACTIVE || before.latestVersion !== ACTIVE || before.percentage !== 100
        || before.concurrentWriters || before.githubSecretNames.some(name=>['IBKR_RUNTIME_DAILY_SYNC_TOKEN','IBKR_RUNTIME_DAILY_TARGET_KEY'].includes(name))
        || !equalHash(before.expectedComparison, comparison(before.options, before.bindings, before.nonce, anchor))) throw Error('preflight');
    const binding = primaryBinding(before.options,before.bindings,anchor);
    const rawModule = Buffer.from(before.moduleBase64,'base64');
    if (!rawModule.length || rawModule.toString('base64') !== before.moduleBase64 || hash(rawModule) !== moduleSha) throw Error('module_mismatch');
    const targetKey = `${binding.service_name}|tqqq_growth_income|${binding.account_scope}|${randomBytes(16).toString('hex')}`;
    const token = randomBytes(32).toString('hex');
    const registration = {account_key:binding.account_key,target_id:binding.target_id,source_binding_id:binding.source_binding_id,
      strategy_profile:'tqqq_growth_income',target_key:targetKey};
    const nextRegistry = appendPrimaryDailyRegistration(before.registry,registration);
    const version = prepareIbkrDailyVersion({activeVersion:ACTIVE,existingBindings:before.resources.bindings,
      runtime:before.resources.script_runtime,moduleBase64:before.moduleBase64,token,targetKey});
    await io.verifyUnchanged(before);
    phase='version_upload'; attempted=true; effects.push(phase);
    uploaded=await io.uploadVersion(version);
    attempted=false;
    const candidate=await io.readVersion(uploaded);
    if (candidate.moduleBase64 !== before.moduleBase64) throw Error('candidate_module');
    validateIbkrDailyVersion(before.resources,candidate.resources,false);
    await io.verifyUnchanged(before,{uploaded});
    phase='github_token'; attempted=true; effects.push(phase); await io.writeGithubSecret('IBKR_RUNTIME_DAILY_SYNC_TOKEN',token); attempted=false;
    phase='github_target'; attempted=true; effects.push(phase); await io.writeGithubSecret('IBKR_RUNTIME_DAILY_TARGET_KEY',targetKey); attempted=false;
    await io.verifyGithubSecretMetadata();
    await io.verifyUnchanged(before,{uploaded,secretNames:['IBKR_RUNTIME_DAILY_SYNC_TOKEN','IBKR_RUNTIME_DAILY_TARGET_KEY']});
    phase='registry_write'; attempted=true; effects.push(phase); await io.writeRegistry(nextRegistry); attempted=false;
    await io.verifyRegistry(nextRegistry);
    await io.verifyBeforeActivation(before,{uploaded,registry:nextRegistry});
    phase='activate'; attempted=true; effects.push(phase); const deployment=await io.activate(uploaded); attempted=false;
    await io.verifyDeployment(uploaded,deployment);
    const active=await io.readVersion(uploaded);
    if (active.moduleBase64 !== before.moduleBase64) throw Error('active_module');
    validateIbkrDailyVersion(before.resources,active.resources,true);
    return {status:'configured',version_id:uploaded,effects};
  } catch {
    return {status:'stopped',phase,outcome:attempted?'unknown_requires_readback':'not_attempted_or_check_failed',
      uploaded_version:uploaded,effects,retry:false};
  }
}
export const __test = Object.freeze({execute});

// Existing protected transport, scoped to the three reviewed additional slots.
export async function executeAdditionalDailySetup(io, {nonce, digests}) {
  let phase='preflight', attempted=false, uploaded=null;
  const effects=[];
  try {
    const before=await io.additionalPreflight({nonce,digests});
    const suffixes=Object.fromEntries(['additional-1','additional-2','additional-3'].map(slot=>[slot,randomBytes(16).toString('hex')]));
    const plan=prepareAdditionalDailySetup({registry:before.registry,matches:before.matches,suffixes,
      activeVersion:before.activeVersion,resources:before.resources,moduleBase64:before.moduleBase64,primaryAccountKey:before.primaryAccountKey});
    await io.additionalUnchanged(before);
    phase='version_upload';attempted=true;effects.push(phase);uploaded=await io.uploadVersion(plan.version);attempted=false;
    const candidate=await io.readVersion(uploaded);
    if (candidate.moduleBase64!==before.moduleBase64) throw Error('candidate_module');
    validateAdditionalDailyVersion(before.resources,candidate.resources,false);
    await io.additionalUnchanged(before,{uploaded});
    phase='registry_write';attempted=true;effects.push(phase);await io.writeRegistry(plan.registry);attempted=false;
    await io.verifyRegistry(plan.registry);
    await io.additionalBeforeActivation(before,{uploaded,registry:plan.registry});
    phase='activate';attempted=true;effects.push(phase);const deployment=await io.activate(uploaded);attempted=false;
    await io.verifyDeployment(uploaded,deployment);
    const active=await io.readVersion(uploaded);
    if (active.moduleBase64!==before.moduleBase64) throw Error('active_module');
    validateAdditionalDailyVersion(before.resources,active.resources,true);
    phase='github_mapping';attempted=true;effects.push(phase);
    await io.writeGithubSecret('IBKR_RUNTIME_DAILY_TARGET_KEY',JSON.stringify(plan.mapping));attempted=false;
    await io.verifyAdditionalGithubSecretMetadata(before.startedAt);
    return {status:'configured',bindings_equal:true,runtime_equal:true,additional_count:3,effects};
  } catch {
    return {status:'stopped',phase,outcome:attempted?'unknown_requires_readback':'not_attempted_or_check_failed',effects,retry:false};
  }
}

export async function executeExecutionDailySetup(io, before) {
  let phase='preflight', attempted=false, uploaded=null;
  const effects=[];
  try {
    const plan=prepareExecutionDailyRegistration(before.planInput);
    await io.executionUnchanged(before);
    phase='version_upload'; attempted=true; effects.push(phase); uploaded=await io.uploadVersion(plan.version); attempted=false;
    const candidate=await io.readVersion(uploaded);
    if (candidate.moduleBase64!==before.moduleBase64) throw Error('candidate_module');
    validateAdditionalDailyVersion(before.resources,candidate.resources,false);
    await io.executionUnchanged(before,{uploaded});
    phase='registry_write'; attempted=true; effects.push(phase); await io.writeRegistry(plan.registry); attempted=false;
    await io.verifyRegistry(plan.registry);
    await io.executionUnchanged(before,{uploaded,registry:plan.registry});
    phase='activate'; attempted=true; effects.push(phase); const deployment=await io.activate(uploaded); attempted=false;
    await io.verifyDeployment(uploaded,deployment);
    const active=await io.readVersion(uploaded);
    if (active.moduleBase64!==before.moduleBase64) throw Error('active_module');
    validateAdditionalDailyVersion(before.resources,active.resources,true);
    return {status:'configured',bindings_equal:true,runtime_equal:true,additional_count:1,effects};
  } catch {
    return {status:'stopped',phase,outcome:attempted?'unknown_requires_readback':'not_attempted_or_check_failed',effects,retry:false};
  }
}
