import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {comparison} from '../web/strategy-switch-console/compare_ibkr_daily_binding.mjs';
import {__test} from '../web/strategy-switch-console/execute_ibkr_daily_setup.mjs';

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
