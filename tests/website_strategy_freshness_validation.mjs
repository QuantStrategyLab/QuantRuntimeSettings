import assert from 'node:assert/strict';
import { strategySummary } from '../web/strategy-switch-console/application/console_api/operations.js';
const request = new Request('https://synthetic.invalid/api/strategies/summary');
const profile = {profile:'synthetic-growth',domain:'us_equity',allowed_execution_modes:['paper']};
const account = {platform:'ibkr',key:'synthetic-account'};
const observation = {profile:profile.profile,status:'healthy',score:100,as_of:'2026-10-02',
  freshness:{status:'stale',age_seconds:86400}};
const deps = {profiles:async()=>[profile],health:async()=>Response.json({data_status:'ready',
  computed_at:'2026-10-27T00:00:00Z',strategies:[observation]})};
const current = {ibkr:{[account.key]:{strategy_profile:profile.profile}}};
const stale = await strategySummary(request,{},deps,[account],current);
assert.equal(stale.strategies[0].status,'stale','a refreshed dashboard does not refresh the underlying strategy source');
assert.equal(stale.strategies[0].as_of,observation.as_of);
assert.deepEqual(stale.strategies[0].freshness,observation.freshness);
assert.equal(stale.strategies[0].unavailable_reason,'strategy_health_stale');
assert.equal(stale.status,'partial');
assert.equal(stale.as_of,'2026-10-27T00:00:00Z','dashboard generation time remains a separate field');
assert.equal(stale.strategies[0].configured_accounts[0].runtime_observation_status,'unknown');
const freshDeps={...deps,health:async()=>Response.json({data_status:'ready',strategies:[{...observation,freshness:{status:'fresh',age_seconds:0}}]})};
for(const status of ['read_failed','permission_denied']) {
 const failedCurrent={ibkr:{[account.key]:{execution_evidence:{status,value:'unknown'}}}};
 const result=await strategySummary(request,{},freshDeps,[account],failedCurrent);
 assert.equal(result.status,'partial','retain readable health while marking missing account configuration');
 assert.equal(result.account_assignment_status,'read_failed');
 assert.deepEqual(result.account_assignment_read_failures,[{platform:'ibkr',account_alias:account.key,status}]);
 assert.equal(result.strategies[0].health_status,'healthy','configuration failure does not destroy independent health evidence');
 assert.equal(result.strategies[0].configured_accounts.length,0,'defaults must not fill an unreadable assignment');
}
const disconnected = await strategySummary(request,{},freshDeps,[account],{ibkr:{[account.key]:{execution_evidence:{status:'not_connected'}}}});
assert.equal(disconnected.account_assignment_status,'unavailable','a source not connected is distinct from read failure');
assert.deepEqual(disconnected.account_assignment_read_failures,[]);
const healthFailed=await strategySummary(request,{}, {...freshDeps,health:async()=>Response.json({data_status:'unavailable',errors:['snapshot_invalid'],strategies:[]})},[account],current);
assert.equal(healthFailed.status,'read_failed');
assert.equal(healthFailed.strategies[0].health_status,null);
assert.equal(healthFailed.no_order,true);assert.equal(healthFailed.execution_authority_granted,false);
console.log('website_strategy_freshness_validation: PASS (source/dashboard dates, per-strategy stale state, assignment failure visibility, independent health and configuration-only evidence)');
const partialHealth={data_status:'partial',errors:['crypto_read_failed'],strategies:[{...observation,freshness:{status:'fresh',age_seconds:0}}]};
const partial=await strategySummary(request,{}, {...deps,health:async()=>Response.json(partialHealth)},[account],current);
assert.equal(partial.status,'partial');
assert.equal(partial.strategies[0].health_status,'healthy');
assert.equal(partial.strategies[0].health_score,100);
const other={profile:'synthetic-crypto',domain:'crypto',allowed_execution_modes:[]};
const mixed=await strategySummary(request,{}, {...deps,profiles:async()=>[profile,other],health:async()=>Response.json(partialHealth)},[account],current);
assert.equal(mixed.strategies[1].health_status,null);
assert.equal(mixed.strategies[1].status,'not_connected');
assert.equal(mixed.strategies[1].unavailable_reason,'strategy_health_not_connected');
