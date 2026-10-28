import assert from 'node:assert/strict';
import {accountFactsHistoryResponse} from '../web/strategy-switch-console/application/account_facts/read.js';
import {projectAccountFactsHistoryCurrencies, projectAccountFactsHistorySeries} from '../web/strategy-switch-console/account_facts.js';

const id='a'.repeat(64), old='b'.repeat(64), unknown='c'.repeat(64);
const option={key:'synthetic',label:'Synthetic',target_name:'synthetic-target',service_name:'synthetic-service',
  deployment_selector:'synthetic-deploy',account_scope:'paper',account_selector:'PAPER'};
const binding={platform:'longbridge',account_key:option.key,account_scope:option.account_scope,target_name:option.target_name,
  service_name:option.service_name,deployment_selector:option.deployment_selector,account_selector:option.account_selector,
  target_id:'synthetic-target',source_binding:{kind:'deployment_scope_token_version',id},history_source_binding_ids:[old]};
function day(date,currency,source=id) {
  const payload={schema_version:'longbridge_account_snapshot_history.v1',snapshot_schema_version:'longbridge_account_snapshot.v1',
    account_scope:'PAPER',target_id:binding.target_id,source_binding:{kind:binding.source_binding.kind,status:'bound',id:source},
    observed_started_at:`${date}T10:00:00Z`,observed_finished_at:`${date}T10:01:00Z`,snapshot_atomic:false,observation_date:date,
    broker_reported_balances:[{currency,net_assets:'100',total_cash:'1'}],cash:[{currency,available_cash:'1',frozen_cash:'0',settling_cash:'0'}]};
  return {observation_date:date,target_id:binding.target_id,account_scope:'paper',source_binding_id:source,payload};
}
const days=[day('2026-10-01','USD'),day('2026-10-02','HKD',old),day('2026-10-03','EUR',unknown)];
assert.deepEqual(projectAccountFactsHistoryCurrencies({days,binding}),['HKD','USD']);
assert.deepEqual(projectAccountFactsHistoryCurrencies({days,binding,maxDays:1}),['HKD'], 'retention applies to trusted observations');
const usd=projectAccountFactsHistorySeries({days,binding,currency:'USD'});
assert.deepEqual(usd.points.map(point=>point.observation_date),['2026-10-01']);
assert.deepEqual(usd.gap_dates,['2026-10-02'], 'a qualified date without the currency stays a gap');
const retained=projectAccountFactsHistorySeries({days,binding,currency:'USD',maxDays:1});
assert.equal(retained.truncated,true);assert.deepEqual(retained.points,[]);assert.deepEqual(retained.gap_dates,['2026-10-02']);
let readFails=false, malformed=false;
const deps={json:(body,status=200)=>Response.json(body,{status}),readSession:async()=>({allowed:true}),
  hasConfigStore:()=>true,hasRuntimeInstanceStore:()=>true,
  loadAccountOptionsConfig:async()=>({options:{longbridge:[option]}}),
  loadAccountFactsBindings:async()=>({bindings:[binding]}),
  runtimeInstanceCommand:async()=>{if(readFails)throw Error('synthetic');return malformed?{ok:true}:{ok:true,days};},
  accountFactsErrorResponse:()=>Response.json({ok:false,error:'stored_records_unreadable'},{status:503})};
const url=new URL('https://synthetic.invalid/api/account-facts/history?platform=longbridge&account_key=synthetic&projection=currencies');
const read=()=>accountFactsHistoryResponse(new Request(url),{ACCOUNT_FACTS_READ_MODEL_ENABLED:'true'},url,deps);
let response=await read(); assert.equal(response.status,200);
assert.deepEqual((await response.json()).currencies,['HKD','USD']);
const legacyUrl=new URL('https://synthetic.invalid/api/account-facts/history?platform=longbridge&account_key=synthetic&currency=USD');
response=await accountFactsHistoryResponse(new Request(legacyUrl),{ACCOUNT_FACTS_READ_MODEL_ENABLED:'true'},legacyUrl,deps);
assert.equal(response.status,200);assert.equal((await response.json()).series.points.length,1, 'legacy currency projection remains supported');
const combined=new URL(legacyUrl);combined.searchParams.set('include_currencies','true');
response=await accountFactsHistoryResponse(new Request(combined),{ACCOUNT_FACTS_READ_MODEL_ENABLED:'true'},combined,deps);
const combinedBody=await response.json();assert.equal(response.status,200);assert.deepEqual(combinedBody.currencies,['HKD','USD']);
assert.equal(combinedBody.series.points.length,1);
response=await accountFactsHistoryResponse(new Request(combined),{ACCOUNT_FACTS_READ_MODEL_ENABLED:'true'},combined,
  {...deps,loadAccountOptionsConfig:async()=>({options:{longbridge:[{...option,account_selector:'HK'}]}})});
assert.equal(response.status,409,'combined read must reject mismatched identity');
response=await accountFactsHistoryResponse(new Request(url),{ACCOUNT_FACTS_READ_MODEL_ENABLED:'true'},url,{...deps,readSession:async()=>null});
assert.equal(response.status,401);
response=await accountFactsHistoryResponse(new Request(url),{ACCOUNT_FACTS_READ_MODEL_ENABLED:'true'},url,
  {...deps,loadAccountOptionsConfig:async()=>({options:{longbridge:[{...option,account_selector:'HK'}]}})});
assert.equal(response.status,409, 'identity mismatch must not enumerate');
response=await accountFactsHistoryResponse(new Request(url),{ACCOUNT_FACTS_READ_MODEL_ENABLED:'true'},url,
  {...deps,loadAccountOptionsConfig:async()=>{throw Error('synthetic');}});
assert.equal(response.status,503, 'configuration read errors are not empty currency histories');
readFails=true;response=await read();assert.equal(response.status,503);
readFails=false;malformed=true;response=await read();assert.equal(response.status,503);
console.log('account facts history currency discovery: synthetic qualified lineage and failures passed');
