import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {buildFreezeCandidate,assertFrozenPolicySource,FROZEN_POLICY} from '../scripts/console_958_freeze_candidate.mjs';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const ts=require(process.env.QRS_TEST_TYPESCRIPT || '../web/strategy-switch-console/frontend/node_modules/typescript');
const original=Buffer.from(`
const DEFAULT_STRATEGY_PROFILES = [{profile:"global_etf_rotation"}];
const PLATFORM_CONFIG = {binance:{supported_execution_modes:["dry_run"]},ibkr:{supported_execution_modes:["dry_run","live"]}};
class HttpError extends Error {}
function isEligibleLegacyContinuityInput(inputs, strategy) { return inputs.execution_mode === "live" && strategy.continuity === true; }
function supportedExecutionModesForPlatform(platform) { return PLATFORM_CONFIG[platform]?.supported_execution_modes || []; }
function normalizeStrategyProfilesPayload(payload) { return payload.map(item => { const entry={...item}; if (item.frozen === true) entry.frozen = true; return entry; }); }
function assertStrategyAllowedForAccount(inputs, accountOption, strategyProfiles) {
 const strategy = strategyProfiles.find(item => item.profile === inputs.strategy_profile);
 const executionMode=inputs.execution_mode;
 if (executionMode === "live") { if(isEligibleLegacyContinuityInput(inputs,strategy)) return; }
}
async function buildAdminState() { return profiles.filter((item) => (item.allowed_execution_modes || []).includes("dry_run")); }
async function syncAccountDefaultResponse(request, env) {
 const rawInput={};const inputs = normalizeSwitchInputs(rawInput);
 const strategy={};let accountOption=null;
 if (!accountOption) { accountOption={}; }
 assertStrategyAllowedForAccount(inputs, accountOption, strategyProfiles);
}
function accountDraftStrategyChoices(platform, accountOption, profiles) {
 const choices = [];
 for (const profile of profiles) {
  if (profile.frozen === true) continue;
  const modes = profile.allowed_execution_modes;
  if (!modes.some((mode) => mode === "paper" || mode === "live")) continue;
  choices.push(profile);
 }
 return choices;
}
`);
test('bounded candidate restores alias freeze, direct gate and continuity',()=>{
 const {candidate,report}=buildFreezeCandidate(ts,original,original);assert.equal(report.freeze_changes_bounded,true);
 const c=runInNewContext(candidate.toString()+`\n;({normalizeStrategyProfilesPayload,accountDraftStrategyChoices,assertStrategyAllowedForAccount})`);
 for(const id of [...FROZEN_POLICY,'global-macro-etf-rotation','global_etf_confidence_vol_gate']) for(const state of [false,undefined]){
  const row={profile:id,allowed_execution_modes:['dry_run'],continuity:true};if(state===false)row.frozen=false;
  const rows=c.normalizeStrategyProfilesPayload([row]);
  assert.equal(rows[0].frozen,true);assert.equal(c.accountDraftStrategyChoices('ibkr',{default_execution_mode:'dry_run'},rows).length,0);
  assert.throws(()=>c.assertStrategyAllowedForAccount({strategy_profile:id,execution_mode:'dry_run'}, {},rows));
  assert.doesNotThrow(()=>c.assertStrategyAllowedForAccount({strategy_profile:id,execution_mode:'live',live_continuity_state:'RECONCILE_ONLY'}, {},rows));
  assert.throws(()=>c.assertStrategyAllowedForAccount({strategy_profile:id,execution_mode:'live',live_continuity_state:'ACTIVE_LKG'}, {},rows));
 }
 assert.equal(c.accountDraftStrategyChoices('binance',{default_execution_mode:'dry_run'},[{profile:'crypto_trend_rotation',allowed_execution_modes:['dry_run']}]).length,1);
});
test('modified historic freeze function or duplicate helper is refused',()=>{
 assert.throws(()=>buildFreezeCandidate(ts,original,Buffer.from(original.toString().replace('item.frozen === true','item.frozen !== true'))));
 assert.throws(()=>buildFreezeCandidate(ts,original,Buffer.concat([original,Buffer.from('\nfunction __qrs958Frozen() {}')])));
 assert.throws(()=>buildFreezeCandidate(ts,original,Buffer.from(original.toString().replace('strategy.continuity === true','strategy.continuity === false'))));
 assert.throws(()=>buildFreezeCandidate(ts,original,Buffer.from(original.toString().replace('normalizeSwitchInputs(rawInput)','normalizeSwitchInputs({})'))));
});

test('frozen set equals fixed main asset including all 14 entries',async()=>{
 const policyUrl=process.env.QRS_TEST_POLICY ? pathToFileURL(process.env.QRS_TEST_POLICY).href : new URL('../web/strategy-switch-console/strategy_profiles_asset.js',import.meta.url).href;
 const {DEFAULT_STRATEGY_PROFILES}=await import(policyUrl);
 assert.equal(FROZEN_POLICY.length,14);assertFrozenPolicySource(DEFAULT_STRATEGY_PROFILES);
 assert.throws(()=>assertFrozenPolicySource(DEFAULT_STRATEGY_PROFILES.filter(x=>x.profile!==FROZEN_POLICY[0])));
});
