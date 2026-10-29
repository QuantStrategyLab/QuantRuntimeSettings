import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {comparison} from '../web/strategy-switch-console/compare_ibkr_daily_binding.mjs';
import {__test, executeAdditionalDailySetup} from '../web/strategy-switch-console/execute_ibkr_daily_setup.mjs';
import {prepareAdditionalDailySetup} from '../web/strategy-switch-console/prepare_ibkr_daily_version.mjs';

const sha = x=>createHash('sha256').update(x).digest('hex');
const option={key:'account',label:'Synthetic',target_name:'target',service_name:'service',deployment_selector:'deploy',account_scope:'live',account_selector:'U1234567'};
const fact={platform:'ibkr',account_key:'account',account_scope:'live',target_name:'target',service_name:'service',deployment_selector:'deploy',account_selector:'U1234567',target_id:'target',source_binding:{kind:'deployment_runtime_account',id:'b'.repeat(64)}};
const options={ibkr:[option]}, bindings={schema_version:'qsl_account_facts_bindings.v1',bindings:[fact]};
const anchor=sha('target'), nonce='a'.repeat(64), module=Buffer.from('synthetic');
const old={bindings:[{name:'CONFIG',type:'kv_namespace'}],script_runtime:{compatibility_date:'2026-01-01',usage_model:'bundled',migration_tag:'v1'},script:{handlers:['fetch']}};
const before={activeVersion:'2b097d2e-ffb5-4f08-af3b-9cc1d4b9e9ee',latestVersion:'2b097d2e-ffb5-4f08-af3b-9cc1d4b9e9ee',percentage:100,concurrentWriters:false,githubSecretNames:[],options,bindings,nonce,
  expectedComparison:comparison(options,bindings,nonce,anchor),moduleBase64:module.toString('base64'),resources:old,registry:{schema_version:'qsl_runtime_daily_bindings.v1',bindings:[]}};
const calls=[]; let failed=null;
const action = async name=>{calls.push(name);if(failed===name)throw Error('synthetic');};
const candidate={moduleBase64:before.moduleBase64,resources:{...old,bindings:[...old.bindings,{name:'IBKR_RUNTIME_DAILY_SYNC_TOKEN',type:'secret_text'},{name:'IBKR_RUNTIME_DAILY_TARGET_KEY',type:'secret_text'}]}};
const io={preflight:async()=>before,verifyUnchanged:async()=>action('verifyUnchanged'),uploadVersion:async()=>{await action('upload');return 'cccccccc-cccc-4ccc-accc-cccccccccccc';},
  readVersion:async()=>candidate,writeGithubSecret:async name=>action(name),verifyGithubSecretMetadata:async()=>action('verifySecrets'),
  writeRegistry:async()=>action('registry'),verifyRegistry:async()=>action('verifyRegistry'),verifyBeforeActivation:async()=>action('verifyActivation'),
  activate:async()=>{await action('activate');return 'synthetic-deployment';},verifyDeployment:async()=>action('verifyDeployment')};
let result=await __test.execute(io,sha(module),anchor);
assert.equal(result.status,'configured');
assert.deepEqual(calls,['verifyUnchanged','upload','verifyUnchanged','IBKR_RUNTIME_DAILY_SYNC_TOKEN','IBKR_RUNTIME_DAILY_TARGET_KEY','verifySecrets','verifyUnchanged','registry','verifyRegistry','verifyActivation','activate','verifyDeployment']);
for (const point of ['upload','IBKR_RUNTIME_DAILY_SYNC_TOKEN','IBKR_RUNTIME_DAILY_TARGET_KEY','registry','activate']) {
  calls.length=0;failed=point;result=await __test.execute(io,sha(module),anchor);
  assert.equal(result.status,'stopped');assert.equal(result.outcome,'unknown_requires_readback');
  assert.equal(result.retry,false);assert.equal(calls.at(-1),point);
}
calls.length=0;failed=null;result=await __test.execute({...io,preflight:async()=>({...before,concurrentWriters:true})},sha(module),anchor);
assert.equal(result.status,'stopped');assert.equal(calls.length,0);
console.log('IBKR daily setup state machine: synthetic cases passed');

const primary={account_key:'primary',target_id:'target-primary',source_binding_id:'a'.repeat(64),strategy_profile:'tqqq_growth_income',target_key:'service-primary|tqqq_growth_income|live|'+'0'.repeat(32)};
const multiResources={...old,bindings:[...old.bindings,{name:'IBKR_RUNTIME_DAILY_SYNC_TOKEN',type:'secret_text'},{name:'IBKR_RUNTIME_DAILY_TARGET_KEY',type:'secret_text'}]};
const matches=Object.fromEntries([1,2,3].map(i=>[`additional-${i}`,{account_key:`account-${i}`,target_id:`target-${i}`,source_binding_id:String(i).repeat(64),strategy_profile:`strategy_${i}`,service_name:`service-${i}`,account_scope:'live'}]));
const multiBefore={...before,activeVersion:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',resources:multiResources,primaryAccountKey:'primary',registry:{schema_version:'qsl_runtime_daily_bindings.v1',bindings:[primary]},matches,startedAt:'2026-01-01T00:00:00Z'};
const sample=prepareAdditionalDailySetup({registry:multiBefore.registry,matches,suffixes:Object.fromEntries([1,2,3].map(i=>[`additional-${i}`,String(i).repeat(32)])),activeVersion:multiBefore.activeVersion,resources:multiResources,moduleBase64:multiBefore.moduleBase64,primaryAccountKey:'primary'});
const unrelated={platform:'longbridge',account_key:'fixture-lb',target_id:'fixture-lb-target',source_binding_id:'f'.repeat(64),strategy_profile:'fixture_lb',target_key:'fixture-lb-service|fixture_lb|hk'};
const withExisting=prepareAdditionalDailySetup({registry:{...multiBefore.registry,bindings:[primary,unrelated]},matches,suffixes:Object.fromEntries([1,2,3].map(i=>[`additional-${i}`,String(i).repeat(32)])),activeVersion:multiBefore.activeVersion,resources:multiResources,moduleBase64:multiBefore.moduleBase64,primaryAccountKey:'primary'});
assert.deepEqual(withExisting.registry.bindings.slice(0,2),[primary,unrelated]);
const targets=JSON.parse(withExisting.version.bindings.find(x=>x.name==='IBKR_RUNTIME_DAILY_TARGET_KEY').text);
assert.equal(targets.ibkr.length,4);assert.deepEqual(targets.execution,[]);
assert.equal(sample.registry.bindings.length,4);assert.equal(sample.mapping['primary-live'].target_key,primary.target_key);
assert.equal(sample.version.bindings.filter(x=>x.name==='IBKR_RUNTIME_DAILY_TARGET_KEY')[0].type,'secret_text');
assert.equal(sample.version.bindings.find(x=>x.name==='IBKR_RUNTIME_DAILY_SYNC_TOKEN').type,'inherit');
assert.throws(()=>prepareAdditionalDailySetup({registry:multiBefore.registry,matches:{...matches,'additional-2':matches['additional-1']},suffixes:Object.fromEntries([1,2,3].map(i=>[`additional-${i}`,String(i).repeat(32)])),activeVersion:multiBefore.activeVersion,resources:multiResources,moduleBase64:multiBefore.moduleBase64,primaryAccountKey:'primary'}));
let failedMulti=null;const multiCalls=[];
const step=async name=>{multiCalls.push(name);if(failedMulti===name)throw Error('synthetic');};
const mio={additionalPreflight:async()=>multiBefore,additionalUnchanged:async()=>step('unchanged'),
 uploadVersion:async()=>{await step('upload');return 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb';},
 readVersion:async()=>({moduleBase64:multiBefore.moduleBase64,resources:multiResources}),
 writeRegistry:async()=>step('registry'),verifyRegistry:async()=>step('registry_read'),additionalBeforeActivation:async()=>step('activation_check'),
 activate:async()=>{await step('activate');return 'fixture';},verifyDeployment:async()=>step('deployment_read'),
 writeGithubSecret:async name=>{assert.equal(name,'IBKR_RUNTIME_DAILY_TARGET_KEY');await step('github');},verifyAdditionalGithubSecretMetadata:async()=>step('github_read')};
let multiResult=await executeAdditionalDailySetup(mio,{nonce,digests:{}});
assert.equal(multiResult.status,'configured');assert.deepEqual(multiCalls,['unchanged','upload','unchanged','registry','registry_read','activation_check','activate','deployment_read','github','github_read']);
for (const point of ['upload','registry','activate','github']) {multiCalls.length=0;failedMulti=point;multiResult=await executeAdditionalDailySetup(mio,{nonce,digests:{}});assert.equal(multiResult.outcome,'unknown_requires_readback');assert.equal(multiResult.retry,false);assert.equal(multiCalls.at(-1),point);}
console.log('IBKR additional daily setup: preserved token and bounded side effects passed');
