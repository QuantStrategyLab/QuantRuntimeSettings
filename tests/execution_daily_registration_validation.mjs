import assert from 'node:assert/strict';
import {prepareExecutionDailyRegistration as prepare,firstExecutionAuthorization,secondExecutionAuthorization} from '../web/strategy-switch-console/prepare_execution_daily_registration.mjs';
import {executeExecutionDailySetup} from '../web/strategy-switch-console/execute_ibkr_daily_setup.mjs';

const old = Array.from({length:4}, (_, i) => ({account_key:`old-${i}`,target_id:`old-id-${i}`,
  source_binding_id:String(i).repeat(64),strategy_profile:'old-profile',target_key:`old-service|old-profile|live|${String(i).repeat(32)}`}));
const matches = [
  {platform:'longbridge',account_key:'sg-account',target_id:'sg-id',source_binding_id:'a'.repeat(64),service_name:'sg-service',strategy_profile:'sg-strategy',account_scope:'sg'},
  {platform:'longbridge',account_key:'hk-account',target_id:'hk-id',source_binding_id:'b'.repeat(64),service_name:'hk-service',strategy_profile:'hk-strategy',account_scope:'HK'},
  {platform:'firstrade',account_key:'ft-account',target_id:'ft-id',source_binding_id:'c'.repeat(64),service_name:'ft-service',strategy_profile:'ft-strategy',account_scope:'live'},
  {platform:'binance',account_key:'bn-account',target_id:'bn-id',source_binding_id:'d'.repeat(64),service_name:'bn-service',strategy_profile:'bn-strategy',account_scope:'live'},
];
const targetKeys=['sg-service|sg-strategy|sg','hk-service|hk-strategy|hk','ft-service|ft-strategy|live','bn-service|bn-strategy|live'];
const input={registry:{schema_version:'qsl_runtime_daily_bindings.v1',bindings:old},matches,targetKeys,
  authorizedTargets:{ibkr:old.slice(0,3).map(x=>x.target_key),execution:['existing-service|existing-profile|live']},
  activeVersion:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  resources:{bindings:[{name:'KV',type:'kv_namespace'},{name:'IBKR_RUNTIME_DAILY_TARGET_KEY',type:'secret_text'},
    {name:'OTHER',type:'secret_text'}],script_runtime:{compatibility_date:'2026-01-01',usage_model:'bundled',compatibility_flags:['nodejs_compat'],limits:{cpu_ms:50}}},
  moduleBase64:'c3ludGhldGlj'};
const original=structuredClone(input), result=prepare(input);
assert.deepEqual(firstExecutionAuthorization(input.registry,old),{ibkr:old.map(x=>x.target_key),execution:[]});
assert.throws(()=>firstExecutionAuthorization(input.registry,[...old.slice(0,3),{...old[3],source_binding_id:'f'.repeat(64)}]),/binding_not_unique/);
assert.throws(()=>firstExecutionAuthorization({bindings:[...old,{platform:'longbridge'}]},old),/invalid_existing_setup/);
const hk=prepare({...input,matches:[matches[1]],targetKeys:[targetKeys[1]],authorizedTargets:{ibkr:old.map(x=>x.target_key),execution:[]}}).registry;
assert.deepEqual(secondExecutionAuthorization(hk,old,matches[1]),{ibkr:old.map(x=>x.target_key),execution:[targetKeys[1]]});
assert.throws(()=>secondExecutionAuthorization(hk,old,{...matches[1],source_binding_id:'f'.repeat(64)}),/binding_not_unique/);
assert.throws(()=>secondExecutionAuthorization({bindings:[...hk.bindings,{platform:'firstrade'}]},old,matches[1]),/invalid_existing_setup/);
assert.deepEqual(input,original);
assert.deepEqual(result.registry.bindings.slice(0,4),old);
assert.deepEqual(result.authorization.ibkr,input.authorizedTargets.ibkr);
assert.deepEqual(result.authorization.execution,[...input.authorizedTargets.execution,...targetKeys]);
assert.ok(!result.authorization.ibkr.includes(old[3].target_key)); // registry alone never grants authorization
assert.equal(result.registry.bindings[5].target_key,targetKeys[1]);
assert.deepEqual(result.version.bindings.slice(0,2),[{type:'inherit',name:'KV',version_id:input.activeVersion},
  {type:'inherit',name:'OTHER',version_id:input.activeVersion}]);
assert.deepEqual(JSON.parse(result.version.bindings[2].text),result.authorization);
assert.deepEqual(result.version.compatibility_flags,input.resources.script_runtime.compatibility_flags);
assert.deepEqual(result.version.limits,input.resources.script_runtime.limits);
for (const field of ['target_id','source_binding_id','target_key']) {
  const conflict=structuredClone(input);
  if (field === 'target_key') conflict.targetKeys[1] = conflict.targetKeys[0];
  else conflict.matches[1][field] = conflict.matches[0][field];
  assert.throws(()=>prepare(conflict));
}
const accountConflict=structuredClone(input); accountConflict.matches[1].account_key=matches[0].account_key;
assert.throws(()=>prepare(accountConflict), /registration_collision/);
for (const mutate of [x=>x.matches.pop(),x=>{x.matches[0].source_binding_id='bad';},
  x=>{x.targetKeys[1]='hk-service|hk-strategy|HK';},x=>{x.targetKeys[2]='wrong|ft-strategy|live';},
  x=>{x.authorizedTargets.execution=[targetKeys[0]];},x=>{x.resources.bindings.pop();x.resources.bindings.pop();},
  x=>{x.authorizedTargets=null;}]) {
  const bad=structuredClone(input);mutate(bad);assert.throws(()=>prepare(bad));
}
const single=structuredClone(input); single.matches=[matches[1]]; single.targetKeys=[targetKeys[1]];
single.resources.script={handlers:[],named_handlers:[],placement_mode:null};
const before={planInput:single,resources:single.resources,moduleBase64:single.moduleBase64};
let effects=[], failure='';
const effect=name=>{effects.push(name); if(failure===name)throw Error('synthetic');};
const io={executionUnchanged:async()=>{},uploadVersion:async()=>{effect('upload');return 'candidate';},
  readVersion:async()=>({moduleBase64:before.moduleBase64,resources:before.resources}),
  writeRegistry:async()=>effect('registry'),verifyRegistry:async()=>{},activate:async()=>{effect('activate');return 'deployment';},
  verifyDeployment:async()=>{}};
let outcome=await executeExecutionDailySetup(io,before);
assert.equal(outcome.status,'configured');assert.deepEqual(effects,['upload','registry','activate']);
for(const name of ['upload','registry','activate']) {
  effects=[];failure=name;outcome=await executeExecutionDailySetup(io,before);
  assert.equal(outcome.outcome,'unknown_requires_readback');assert.equal(outcome.retry,false);assert.equal(effects.at(-1),name);
}
console.log('execution daily registration: matched-only authorization, conflicts and preservation passed');
