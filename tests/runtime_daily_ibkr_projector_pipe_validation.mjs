// From the IBKR checkout, with its test dependencies installed and QRS set to
// the QRS checkout path, run this command to provide synthetic producer output:
// PYTHONPATH=. python -c 'import json; from tests.test_project_ibkr_runtime_daily import project,source,EXPECTED; from scripts.publish_account_facts_from_report import _bound_source_id; k=("project_id","service_name","runtime_revision","account_scope","account_selector","deployment_selector"); print(json.dumps({"projections":[project([]),project([source()])],"source_id":_bound_source_id(**{x:EXPECTED["expected_"+x] for x in k})}))' | node "$QRS/tests/runtime_daily_ibkr_projector_pipe_validation.mjs"
import assert from 'node:assert/strict';
import worker, { __test } from './helpers/directory_worker.mjs';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const { projections, source_id } = JSON.parse(input);
const target = projections[0].records[0].target_key;
const option = { key:'fixture-account', label:'Fixture', target_name:'ibkr-primary', service_name:'ibkr-primary-service',
  deployment_selector:'live-primary', account_scope:'live-primary', account_selector:'U00000001' };
const binding = { platform:'ibkr', account_key:option.key, account_scope:option.account_scope, target_name:option.target_name,
  service_name:option.service_name, deployment_selector:option.deployment_selector, account_selector:option.account_selector,
  target_id:'ibkr-primary', source_binding:{kind:'deployment_runtime_account', id:source_id} };
const registration = {account_key:option.key, target_id:binding.target_id, source_binding_id:source_id,
  strategy_profile:'fixture_strategy', target_key:target};
const store = new Map([
  ['account_options',JSON.stringify({ibkr:[option]})],
  ['account_facts_bindings',JSON.stringify({schema_version:'qsl_account_facts_bindings.v1',bindings:[binding]})],
  ['runtime_daily_bindings',JSON.stringify({schema_version:'qsl_runtime_daily_bindings.v1',bindings:[registration]})],
]);
const env = { STRATEGY_SWITCH_CONFIG:{async get(key){return store.get(key) ?? null;},async put(key,value){store.set(key,value);}},
  RUNTIME_DAILY_READ_MODEL_ENABLED:'true', IBKR_RUNTIME_DAILY_SYNC_TOKEN:'fixture-token', IBKR_RUNTIME_DAILY_TARGET_KEY:target,
  SESSION_SECRET:'fixture-session', ALLOWED_GITHUB_LOGINS:'reader' };
const cookie=await __test.makeSession('reader',[],env);
for (const [index,projection] of projections.entries()) {
  // Each case starts with an empty day; equal timestamp but different contents is a conflict.
  store.delete(`runtime_daily:${target}:${projection.records[0].business_date}`);
  const response=await worker.fetch(new Request('https://fixture.example/api/runtime-daily/sync',{method:'POST',
    headers:{Authorization:'Bearer fixture-token','Content-Type':'application/json','X-QSL-Source-Binding-ID':source_id},
    body:JSON.stringify(projection)}),env);
  assert.equal(response.status,200,`producer projection ${index}`);
  const ack=await response.json(); assert.equal(ack.observed_at,projection.observed_at);
  const read=await worker.fetch(new Request(`https://fixture.example/api/runtime-daily?date=${projection.records[0].business_date}&platform=ibkr&account_key=fixture-account&include_history=false`,
    {headers:{Cookie:`qsl_switch_session=${cookie}`}}),env);
  assert.equal(read.status,200); const body=await read.json();
  assert.equal(body.read_summary.status,'partial'); assert.equal(body.read_summary.total_run_count,null);
  assert.equal(body.record.runs.length,index);
}
console.log('IBKR projector to receiver synthetic contract: PASS');
