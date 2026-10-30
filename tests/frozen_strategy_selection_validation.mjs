import assert from 'node:assert/strict';
import worker, { __test } from '../web/strategy-switch-console/worker.js';
import { DEFAULT_STRATEGY_PROFILES } from '../web/strategy-switch-console/strategy_profiles_asset.js';

const frozen = DEFAULT_STRATEGY_PROFILES.filter(p => p.frozen === true);
assert.equal(frozen.length, 14);
for (const item of frozen) {
  const platform = item.domain === 'cn_equity' ? 'qmt' : 'ibkr';
  const account = {key:'synthetic', supported_domains:[item.domain]};
  const stale = __test.normalizeStrategyProfilesPayload([{...item, frozen:false}]);
  assert.equal(stale[0].frozen, true);
  assert.equal(__test.accountDraftStrategyChoices(platform, account, stale).length, 0);
  assert.throws(() => __test.assertStrategyAllowedForAccount({platform, strategy_profile:item.profile, execution_mode:'dry_run'}, account, stale), /frozen/);
}
const retired = ['global_etf_rotation', 'global_macro_etf_rotation', 'global_etf_confidence_vol_gate'];
const core = ['tqqq_growth_income', 'soxl_soxx_trend_income', 'russell_top50_leader_rotation', 'ibit_smart_dca', 'nasdaq_sp500_smart_dca'];
const stale = __test.normalizeStrategyProfilesPayload([...retired, ...core].map(profile => ({profile, domain: 'us_equity', allowed_execution_modes: ['paper', 'dry_run']})));
const options = {key:'synthetic', supported_domains:['us_equity']};
const choices = __test.accountDraftStrategyChoices('ibkr', options, stale).map(p => p.profile);
for (const id of retired) {
  assert.equal(stale.find(p => p.profile === id).frozen, true);
  assert(!choices.includes(id));
  assert.throws(() => __test.assertStrategyAllowedForAccount({platform:'ibkr', strategy_profile:id, execution_mode:'dry_run'}, options, stale), /frozen/);
}
for (const id of core) assert(choices.includes(id));
const legacy = __test.normalizeStrategyProfilesPayload([DEFAULT_STRATEGY_PROFILES.find(p => p.profile === 'global_etf_rotation')]);
const inputs = {platform:'ibkr', strategy_profile:'global_etf_rotation', execution_mode:'live', live_continuity_state:'RECONCILE_ONLY', live_continuity_baseline_id:'legacy', live_continuity_captured_at:'2026-01-01', plugin_mode:'current', option_overlay_mode:'current'};
assert.doesNotThrow(() => __test.assertStrategyAllowedForAccount(inputs, options, legacy));
assert.doesNotThrow(() => __test.assertStrategyAllowedForAccount({...inputs, live_continuity_state:'RISK_REDUCTION_ONLY'}, options, legacy));
assert.throws(() => __test.assertStrategyAllowedForAccount({...inputs, live_continuity_state:'ACTIVE_LKG'}, options, legacy), /frozen/);
console.log('Frozen strategy selection validation passed.');

// Exercise the real internal HTTP handler with an in-memory KV and stale catalog.
const payload = {
  platform:'ibkr', target_name:'legacy-ibkr-route', account_selector:'LEGACY_IBKR',
  deployment_selector:'legacy-ibkr-route', account_scope:'legacy-ibkr-route',
  service_name:'interactive-brokers-legacy-ibkr-route-service', strategy_profile:'global_etf_rotation',
  execution_mode:'live', live_continuity_state:'RECONCILE_ONLY',
  live_continuity_baseline_id:'legacy-ibkr-lkg-20260830', live_continuity_captured_at:'2026-08-30',
  variable_scope:'default', plugin_mode:'current', option_overlay_mode:'current', cash_only_execution_mode:'current',
};
const kv = new Map([['strategy_profiles', JSON.stringify(DEFAULT_STRATEGY_PROFILES.map(({frozen, ...item}) => item))], ['account_options', JSON.stringify({ibkr:[]})]]);
let writes = 0;
const env = {STRATEGY_SWITCH_SYNC_TOKEN:'synthetic', STRATEGY_SWITCH_CONFIG:{get:async key => kv.get(key) || null, put:async (key, value) => { writes++; kv.set(key, value); }}};
const request = body => new Request('https://switch.example/api/internal/sync-account-default', {method:'POST', headers:{Authorization:'Bearer synthetic', 'Content-Type':'application/json'}, body:JSON.stringify(body)});
let response = await worker.fetch(request(payload), env);
assert.equal(response.status, 409);
assert.equal(writes, 0, 'frozen new account is rejected before KV writes');
const account = {key:'legacy-ibkr-route', label:'Legacy', target_name:'legacy-ibkr-route', account_selector:'LEGACY_IBKR', deployment_selector:'legacy-ibkr-route', account_scope:'legacy-ibkr-route', service_name:'interactive-brokers-legacy-ibkr-route-service', supported_domains:['us_equity'], default_strategy_profile:'global_etf_rotation'};
kv.set('account_options', JSON.stringify({ibkr:[account]}));
response = await worker.fetch(request(payload), env);
assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
kv.set('account_options', JSON.stringify({ibkr:[{...account, default_strategy_profile:'tqqq_growth_income'}]}));
response = await worker.fetch(request(payload), env);
assert.equal(response.status, 409, 'continuity cannot switch an existing account from a different strategy');
kv.set('account_options', JSON.stringify({ibkr:[account]}));
const writesBeforeMalformed = writes;
response = await worker.fetch(request({...payload, live_continuity_baseline_id:'', live_continuity_captured_at:''}), env);
assert.equal(response.status, 409);
assert.equal(writes, writesBeforeMalformed, 'malformed continuity cannot write');
response = await worker.fetch(request({...payload, live_continuity_state:'ACTIVE_LKG'}), env);
assert.equal(response.status, 409);
console.log('Frozen selection HTTP handler validation passed.');

// Stale KV can contain hyphenated catalog identifiers without a frozen flag.
for (const [canonical, platform, alias] of [
  ['global_etf_rotation', 'ibkr', 'global-etf-rotation'],
  ['global_etf_rotation', 'ibkr', 'global-macro-etf-rotation'],
  ['global_etf_rotation', 'ibkr', 'global-etf-confidence-vol-gate'],
  ['hk_global_etf_tactical_rotation', 'longbridge', 'hk-global-etf-tactical-rotation'],
  ['cn_industry_etf_rotation', 'qmt', 'cn-industry-etf-rotation'],
]) {
  const original = DEFAULT_STRATEGY_PROFILES.find(item => item.profile === canonical);
  const staleProfile = {...original, profile:alias, frozen:false, lifecycle_stage:'runtime_enabled',
    runtime_enabled:true, can_switch_live:true, allowed_execution_modes:['dry_run']};
  const profiles = __test.normalizeStrategyProfilesPayload([staleProfile]);
  assert.equal(profiles[0].profile, alias);
  assert.equal(profiles[0].frozen, true, alias);
  const syntheticAccount = {key:'synthetic', label:'Synthetic', target_name:'synthetic',
    account_selector:'synthetic', deployment_selector:'synthetic', account_scope:'synthetic',
    service_name:'synthetic-service', supported_domains:[original.domain], default_strategy_profile:'tqqq_growth_income'};
  const data = new Map([['strategy_profiles', JSON.stringify([staleProfile])],
    ['account_options', JSON.stringify({[platform]:[syntheticAccount]})]]);
  let aliasWrites = 0;
  const aliasEnv = {STRATEGY_SWITCH_SYNC_TOKEN:'synthetic', STRATEGY_SWITCH_CONFIG:{
    get:async key => data.get(key) || null, put:async (key, value) => {aliasWrites++; data.set(key, value);},
  }};
  const aliasRequest = {platform, target_name:'synthetic', account_selector:'synthetic',
    deployment_selector:'synthetic', account_scope:'synthetic', service_name:'synthetic-service',
    strategy_profile:alias, execution_mode:'dry_run', variable_scope:'default', plugin_mode:'current',
    option_overlay_mode:'current', cash_only_execution_mode:'current'};
  const result = await worker.fetch(request(aliasRequest), aliasEnv);
  assert.equal(result.status, 409, alias);
  assert.equal(aliasWrites, 0, alias);
}
const unchanged = __test.normalizeStrategyProfilesPayload([
  {profile:'tqqq-growth-income', domain:'us_equity', allowed_execution_modes:['dry_run']},
  {profile:'synthetic-unknown', domain:'us_equity', allowed_execution_modes:['dry_run']},
]);
assert.deepEqual(unchanged.map(item => item.profile), ['tqqq-growth-income', 'synthetic-unknown']);
assert(unchanged.every(item => item.frozen !== true));
