import assert from 'node:assert/strict';
import {accountFactsHistoryResponse} from '../web/strategy-switch-console/application/account_facts/read.js';
import {buildAccountFactsHistoryReadModel, projectAccountFactsHistoryCurrencies, projectAccountFactsHistorySeries} from '../web/strategy-switch-console/account_facts.js';

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
// One qualification pass must match independent legacy projections, including
// untrusted lineage, absent currencies and retention truncation.
for (const limit of [1, 366]) {
  const inputs = { platform:'longbridge', accountKey:option.key, option, binding, days, currency:'USD', maxDays:limit };
  const separate = buildAccountFactsHistoryReadModel(inputs);
  const combinedModel = buildAccountFactsHistoryReadModel({...inputs, includeCurrencies:true});
  assert.deepEqual(combinedModel.series, separate.series);
  assert.deepEqual(combinedModel.currencies, projectAccountFactsHistoryCurrencies({days,binding,maxDays:limit}));
  const {currencies, ...withoutCurrencies} = combinedModel;
  assert.deepEqual(withoutCurrencies, separate);
}
const invalidOption = {...option, account_selector:'OTHER'};
const invalid = buildAccountFactsHistoryReadModel({platform:'longbridge',accountKey:option.key,
  option:invalidOption,binding,days,currency:'USD',includeCurrencies:true});
assert.equal(invalid.identity_mismatch,true);
assert.equal(Object.hasOwn(invalid,'currencies'),false,'untrusted identities must not enumerate currencies');
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
// Every history read shape must preserve failed reads instead of presenting
// an unavailable source as a successfully observed empty history.
for (const query of [legacyUrl, combined, url]) {
  for (const override of [
    {loadAccountOptionsConfig:async()=>{throw Error('synthetic private configuration detail');}},
    {loadAccountFactsBindings:async()=>{throw Error('synthetic private binding detail');}},
    ...[null, {}, {ok:false,days:[]}, {ok:true}, {ok:true,days:null}]
      .map(result=>({runtimeInstanceCommand:async()=>result})),
  ]) {
    const result=await accountFactsHistoryResponse(new Request(query),
      {ACCOUNT_FACTS_READ_MODEL_ENABLED:'true'},query,{...deps,...override});
    assert.equal(result.status,503,`${query.search}: unavailable reads are not empty history`);
    assert.deepEqual(await result.json(),{ok:false,error:'account_facts_history_unavailable'});
  }
  const empty=await accountFactsHistoryResponse(new Request(query),
    {ACCOUNT_FACTS_READ_MODEL_ENABLED:'true'},query,
    {...deps,runtimeInstanceCommand:async()=>({ok:true,days:[]})});
  assert.equal(empty.status,200,'a successfully read empty source remains distinct');
}
console.log('account facts history currency discovery: synthetic qualified lineage and failures passed');

// Exercise the actual Worker wiring: its binding loader must not swallow a KV
// read failure before the history use case can distinguish it from no binding.
const { default: worker, __test } = await import('../web/strategy-switch-console/worker.js');
let kvFailure=null, missingBinding=false, storedHistory={ok:true,days:[]}, storedStatus=200;
const workerEnv={
  ACCOUNT_FACTS_READ_MODEL_ENABLED:'true',
  SESSION_SECRET:'synthetic-session-only',
  ALLOWED_GITHUB_LOGINS:'synthetic-reader',
  STRATEGY_SWITCH_CONFIG:{
    put:async ()=>{throw Error('unexpected write in read-only history test');},
    get:async key=>{
      if(key===kvFailure) throw Error('synthetic private store detail');
      if(key==='account_options') return JSON.stringify({longbridge:[option]});
      if(key==='account_facts_bindings') return missingBinding ? null
        : JSON.stringify({schema_version:'qsl_account_facts_bindings.v1',bindings:[binding]});
      return null;
    },
  },
  STRATEGY_SWITCH_RUNTIME_INSTANCES:{
    idFromName:()=> 'synthetic-object',
    get:()=>({fetch:async (_url,options)=>{
      if(!options?.body) return Response.json({ok:true,initialized:false});
      const command=JSON.parse(options.body);
      assert.equal(command.action,'account_facts_history_read');
      return Response.json(storedHistory,{status:storedStatus});
    }}),
  },
};
const session=await __test.makeSession('synthetic-reader',[],workerEnv);
const requestHistory=query=>worker.fetch(new Request(query,{
  headers:{Cookie:`qsl_switch_session=${session}`},
}),workerEnv);
const originalFetch=globalThis.fetch;
globalThis.fetch=()=>{throw Error('outbound access forbidden in synthetic history test');};
try {
  for(const query of [legacyUrl,combined,url]) {
    for(const key of ['account_options','account_facts_bindings']) {
      kvFailure=key;
      const result=await requestHistory(query);
      assert.equal(result.status,503,`Worker ${query.search}: ${key} failure must remain unavailable`);
      assert.deepEqual(await result.json(),{ok:false,error:'account_facts_history_unavailable'});
    }
    kvFailure=null;
    for(const value of [null,{}, {ok:false,days:[]},{ok:true}]) {
      storedHistory=value;
      const result=await requestHistory(query);
      assert.equal(result.status,503,'Worker must reject malformed storage success');
    }
    storedHistory={ok:true,days:[]};
    const empty=await requestHistory(query);
    assert.equal(empty.status,200,'Worker preserves a confirmed empty history');
    storedStatus=409;storedHistory={ok:false,error:'account_facts_stored_invalid'};
    const corrupt=await requestHistory(query);
    assert.equal(corrupt.status,409,'existing corrupt-data status stays distinct from transport failure');
    assert.deepEqual(await corrupt.json(),{ok:false,error:'account_facts_stored_invalid'});
    storedStatus=200;storedHistory={ok:true,days:[]};
  }
  missingBinding=true;
  assert.equal((await requestHistory(legacyUrl)).status,200,'a successful missing binding read keeps its legacy empty state');
} finally {globalThis.fetch=originalFetch;}
console.log('account facts history Worker wiring: synthetic KV/DO failures and empty states passed');
