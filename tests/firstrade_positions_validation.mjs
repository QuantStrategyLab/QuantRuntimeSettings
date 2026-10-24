import assert from 'node:assert/strict';
import {normalizeAccountFactsHistoryPayload,buildAccountFactsReadModel} from '../web/strategy-switch-console/account_facts.js';
import {holdingsRows} from '../web/strategy-switch-console/application/console_api/performance.js';
const now=Date.parse('2026-10-24T14:00:10Z');
const position={symbol:'SYNTH',quantity:'0.25',market_value:'70.125',currency:'USD',currency_source:'configured'};
const snapshot={schema_version:'firstrade_account_snapshot_history.v1',snapshot_schema_version:'firstrade_account_snapshot.v1',
  account_scope:'live',target_id:'synthetic-target',source_binding:{kind:'deployment_runtime_account',status:'bound',id:'a'.repeat(64)},
  observed_started_at:'2026-10-24T14:00:00Z',observed_finished_at:'2026-10-24T14:00:03Z',observation_date:'2026-10-24',snapshot_atomic:false,
  broker_account_id:'private-synthetic-native',broker_reported_balances:[{currency:'USD',net_assets:'100.125'}],cash:[{currency:'USD',cash_balance:'30',source_tag:'provider.cash_balance'}],
  broker_reported_positions:[position],broker_reported_positions_scope:'broker_reported'};
const option={key:'synthetic',account_scope:'live',account_selector:'synthetic-selector',target_name:'synthetic-target',service_name:'synthetic-service',deployment_selector:'synthetic-deployment',broker_environment:'live'};
const binding={platform:'firstrade',account_key:option.key,account_scope:option.account_scope,account_selector:option.account_selector,target_name:option.target_name,service_name:option.service_name,deployment_selector:option.deployment_selector,
  target_id:snapshot.target_id,source_binding:{kind:snapshot.source_binding.kind,id:snapshot.source_binding.id},broker_account_id:snapshot.broker_account_id};
const normalize=(patch={})=>normalizeAccountFactsHistoryPayload({...snapshot,...patch},{now,expectedPlatform:'firstrade',expectedBrokerAccountId:binding.broker_account_id});
assert.deepEqual(normalize().broker_reported_positions,[position]);
const native={...position};delete native.currency_source;
assert.deepEqual(normalize({broker_reported_positions:[native]}).broker_reported_positions,[native]);
for(const patch of [{broker_reported_positions:[]},{broker_reported_positions_scope:'stocks_only'},
 {broker_reported_positions:[position,position]},
 ...[{currency_source:'owner_confirmed'},{currency_source:'broker_guessed'},{currency:'BASE'},{quantity:'NaN'},{market_value:null},{account_number:'private'}].map(x=>({broker_reported_positions:[{...position,...x}]}))]) {
 assert.throws(()=>normalize(patch),/invalid_account_facts/);
}
const input={now,accountOptions:{firstrade:[option]},bindings:{schema_version:'qsl_account_facts_bindings.v1',bindings:[binding]},storedByAccount:new Map([['firstrade:synthetic',snapshot]])};
const model=buildAccountFactsReadModel(input);
assert.deepEqual(model.accounts[0].positions,[position]);
assert.equal(model.accounts[0].positions_scope,'broker_reported');
assert.ok(!JSON.stringify(model).includes(snapshot.broker_account_id));
const holdings=holdingsRows(model.accounts);
assert.equal(holdings.length,1);assert.equal(holdings[0].quantity,0.25);assert.equal(holdings[0].market_value,70.125);
assert.equal(holdings[0].avg_cost,null);assert.equal(holdings[0].unrealized_pnl,null,'missing cost is never manufactured');
assert.equal(holdings[0].unavailable_reason,'avg_cost_missing');
const stale=buildAccountFactsReadModel({...input,now:now+40*3600000});assert.equal(stale.accounts[0].positions,undefined);
console.log('Firstrade positions: PASS (exact account/source, configured/native currency, projection, honest missing cost, stale/privacy)');
