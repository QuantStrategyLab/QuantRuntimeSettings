import assert from 'node:assert/strict';
import {prepareIbkrDailyVersion, appendPrimaryDailyRegistration, validateIbkrDailyVersion} from '../web/strategy-switch-console/prepare_ibkr_daily_version.mjs';

const input = {activeVersion:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', existingBindings:[{name:'CONFIG',type:'kv_namespace'},{name:'OLD_SECRET',type:'secret_text'}],
  runtime:{compatibility_date:'2026-01-01',usage_model:'bundled',compatibility_flags:['nodejs_compat']},
  moduleBase64:'c3ludGhldGlj', token:'b'.repeat(64), targetKey:`service|tqqq_growth_income|live|${'c'.repeat(32)}`};
const result = prepareIbkrDailyVersion(input);
assert.deepEqual(result.bindings.slice(0,2),input.existingBindings.map(({name})=>({type:'inherit',name,version_id:input.activeVersion})));
assert.deepEqual(result.bindings.slice(2).map(x=>[x.type,x.name]),[['secret_text','IBKR_RUNTIME_DAILY_SYNC_TOKEN'],['secret_text','IBKR_RUNTIME_DAILY_TARGET_KEY']]);
assert.equal(result.modules[0].content_base64,input.moduleBase64);
assert.throws(()=>prepareIbkrDailyVersion({...input,existingBindings:[...input.existingBindings,{name:'IBKR_RUNTIME_DAILY_SYNC_TOKEN'}]}));
assert.throws(()=>prepareIbkrDailyVersion({...input,existingBindings:[input.existingBindings[0],input.existingBindings[0]]}));
assert.throws(()=>prepareIbkrDailyVersion({...input,activeVersion:'latest'}));
assert.throws(()=>prepareIbkrDailyVersion({...input,targetKey:`service|another_strategy|live|${'c'.repeat(32)}`}));
assert.throws(()=>prepareIbkrDailyVersion({...input,token:'short'}));
const other = {account_key:'other',target_id:'other',source_binding_id:'d'.repeat(64),strategy_profile:'other',target_key:`service|other|live|${'d'.repeat(32)}`};
const primary = {account_key:'primary',target_id:'primary',source_binding_id:'e'.repeat(64),strategy_profile:'tqqq_growth_income',target_key:input.targetKey};
const registry = {schema_version:'qsl_runtime_daily_bindings.v1',bindings:[other]};
assert.deepEqual(appendPrimaryDailyRegistration(registry,primary).bindings,[other,primary]);
assert.deepEqual(registry.bindings,[other]);
for (const key of ['account_key','target_id','source_binding_id','target_key']) {
  assert.throws(()=>appendPrimaryDailyRegistration(registry,{...primary,[key]:other[key]}));
}
assert.throws(()=>appendPrimaryDailyRegistration({...registry,extra:true},primary));
assert.throws(()=>appendPrimaryDailyRegistration(registry,{...primary,strategy_profile:'other'}));
const oldResources={bindings:input.existingBindings,script_runtime:{...input.runtime,migration_tag:'v1'},script:{handlers:['fetch'],named_handlers:[],placement_mode:null}};
const newResources={...oldResources,bindings:[...input.existingBindings,{name:'IBKR_RUNTIME_DAILY_SYNC_TOKEN',type:'secret_text'},{name:'IBKR_RUNTIME_DAILY_TARGET_KEY',type:'secret_text'}]};
assert.equal(validateIbkrDailyVersion(oldResources,newResources,true),true);
assert.throws(()=>validateIbkrDailyVersion(oldResources,{...newResources,bindings:newResources.bindings.slice(1)},true));
assert.throws(()=>validateIbkrDailyVersion(oldResources,{...newResources,bindings:[...newResources.bindings.slice(0,-1),{...newResources.bindings.at(-1),text:'synthetic'}]},true));
assert.throws(()=>validateIbkrDailyVersion(oldResources,{...newResources,script_runtime:{...oldResources.script_runtime,migration_tag:'v2'}},true));
assert.equal(validateIbkrDailyVersion(oldResources,{...newResources,script_runtime:input.runtime},false),true);
assert.throws(()=>validateIbkrDailyVersion(oldResources,{...newResources,script_runtime:input.runtime},true));
console.log('IBKR daily version preparation: synthetic cases passed');
