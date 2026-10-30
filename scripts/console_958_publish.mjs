// Fixed #958 release wrapper around the existing reviewed state machine.
// No module, binding, account, credential or provider error text is emitted.
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runBackendRelease,createFixedApi} from './console_946_backend_release.mjs';
import {verifyFixedActive} from './console_958_candidate.mjs';
import {buildFreezeCandidate,assertFrozenPolicySource} from './console_958_freeze_candidate.mjs';
import {DEFAULT_STRATEGY_PROFILES} from '../web/strategy-switch-console/strategy_profiles_asset.js';

const ACTIVE='bed839bd226613cca4fa9508b8a75b4a3b54c9ab5f8326f28dfedb59bcf8d213';
const INTERMEDIATE='207d258c7c09c36b3d20eeba61b947e282c92b0cf36f6881f67c8beedfde2510';
// This literal must be replaced only with the exact successful, reviewed
// read-only probe receipt. No environment or workflow input can override it.
const FINAL_CANDIDATE_SHA256='7b64da8edd2627175019e5c529f9eec048732ffb7acec502cdf4122fc0dbb06a';
const annotation='Reviewed dry-run selector and frozen-policy compatibility';
const required=['dry_run_selection','missing_or_live_mode_excluded','wrong_domain_excluded','ordinary_live_policy_retained','legacy_continuity_preserved','frozen_choice_and_draft','frozen_direct_policy','account_settings_http','continuity_http_guards','admin_frozen_choices'];
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function candidateHashAvailable(){return validHash(FINAL_CANDIDATE_SHA256)}

export function fixedApi(api){
 let activationAttempted=false;
 return {
  ...api,
  async deployments(){const result=await api.deployments();if(!activationAttempted)verifyFixedActive(result);return result},
  async upload(body){return api.upload({...body,annotations:{'workers/message':annotation}})},
  async activate(body){activationAttempted=true;return api.activate({...body,annotations:{'workers/message':annotation}})},
 };
}
export function validateRegression(result){
 if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).length!==required.length||required.some(key=>result[key]!==true))throw Error('regression');
}
async function runCore({api,build,expected,regression,regression946}){
 return runBackendRelease(fixedApi(api),async active=>{
   const built=build(active);
   const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
   if(!Buffer.isBuffer(built.candidate)||built.report.active_code_sha256!==expected.active||digest(active)!==expected.active
      ||built.report.two_insertions_sha256!==expected.intermediate||built.report.candidate_code_sha256!==expected.candidate
      ||digest(built.candidate)!==expected.candidate)throw Error('identity');
   return built.candidate;
 },async candidate=>{
   delete process.env.CLOUDFLARE_API_TOKEN;delete process.env.CLOUDFLARE_ACCOUNT_ID;
   const testFreeze=regression || (await import('./console_958_freeze_runtime.mjs')).testCandidate958Freeze;
   const test946=regression946 || (await import('./console_946_runtime_test.mjs')).testCandidate946;
   validateRegression(await testFreeze(candidate));
   const result946=await test946(candidate);
   if(result946?.ok!==true)throw Error('regression946');
 });
}
export async function run958({api,ts,baseline}){
 // Must be checked before any use of the API, even its read methods.
 if(!validHash(FINAL_CANDIDATE_SHA256))return {ok:false,reason:'candidate_sha_unavailable',upload_attempted:false,deploy_attempted:false};
 assertFrozenPolicySource(DEFAULT_STRATEGY_PROFILES);
 return runCore({api,build:active=>buildFreezeCandidate(ts,baseline,active),expected:{active:ACTIVE,intermediate:INTERMEDIATE,candidate:FINAL_CANDIDATE_SHA256}});
}
// Fixed synthetic bytes and fixed fake-hash expectations only. Production main
// never calls this seam and cannot take candidate hashes from inputs or env.
export async function runSyntheticTest({api,regression,regression946,corruptCandidate=false}){
 const old=Buffer.from('synthetic old'),candidate=Buffer.from('synthetic new');
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
 const expected={active:digest(old),intermediate:digest(Buffer.from('synthetic intermediate')),candidate:digest(candidate)};
 return runCore({api,expected,regression,regression946,build:active=>({candidate:corruptCandidate?Buffer.from('corrupt'):candidate,
   report:{active_code_sha256:digest(active),two_insertions_sha256:expected.intermediate,candidate_code_sha256:expected.candidate}})});
}
async function main(){
 try {
  // Refuse before credentials, source builds, or any provider access.
  if(!validHash(FINAL_CANDIDATE_SHA256)){console.log(JSON.stringify({ok:false,reason:'candidate_sha_unavailable',upload_attempted:false,deploy_attempted:false}));process.exitCode=1;return}
  const frontend=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url));
  const ts=frontend('typescript');
  const baseline=await readFile(join(process.env.RUNNER_TEMP,'qrs54e-baseline/worker.js'));
  const api=createFixedApi();
  const result=await run958({api,ts,baseline});
  console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
 } catch {
  console.error(JSON.stringify({ok:false,reason:'release_setup_failed',upload_attempted:false,deploy_attempted:false}));process.exitCode=1;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
