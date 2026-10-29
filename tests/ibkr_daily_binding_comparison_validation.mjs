import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { comparison, matchAdditionalDailyBinding, matchExecutionDailyBinding } from '../web/strategy-switch-console/compare_ibkr_daily_binding.mjs';

const option = {key:'synthetic-key',label:'Synthetic',target_name:'synthetic-target',service_name:'synthetic-service',deployment_selector:'synthetic-deployment',account_scope:'live',account_selector:'U1234567'};
const binding = {platform:'ibkr',account_key:option.key,account_scope:option.account_scope,target_name:option.target_name,
  service_name:option.service_name,deployment_selector:option.deployment_selector,account_selector:option.account_selector,
  target_id:'synthetic-target',source_binding:{kind:'deployment_runtime_account',id:'b'.repeat(64)}};
const options = {ibkr:[option]};
const facts = {schema_version:'qsl_account_facts_bindings.v1',bindings:[binding]};
const anchor = createHash('sha256').update(binding.target_id).digest('hex');
const nonce = 'a'.repeat(64);
const base = comparison(options,facts,nonce,anchor);
assert.match(base,/^[a-f0-9]{64}$/);
assert.notEqual(base,comparison(options,facts,'c'.repeat(64),anchor));
assert.throws(() => comparison(options,facts,'A'.repeat(64),anchor));
assert.throws(() => comparison(options,facts,nonce,'0'.repeat(64)));
assert.throws(() => comparison({ibkr:[{...option,service_name:'different'}]},facts,nonce,anchor));
const changed = {...binding,source_binding:{...binding.source_binding,id:'c'.repeat(64)}};
assert.notEqual(base,comparison(options,{...facts,bindings:[changed]},nonce,anchor));
console.log(`synthetic_digest=${base}`);

const additional = '21c50c1bcb601733050a0109ab79ad7b74525c10865dac00cd3ba98b5b842b40';
const profiles=[{profile:'other_strategy'},{profile:'synthetic_strategy'}];
assert.equal(matchAdditionalDailyBinding(options,facts,profiles,nonce,additional).strategy_profile,'synthetic_strategy');
assert.throws(()=>matchAdditionalDailyBinding(options,facts,profiles,'c'.repeat(64),additional));
assert.throws(()=>matchAdditionalDailyBinding(options,{...facts,bindings:[changed]},profiles,nonce,additional));
assert.throws(()=>matchAdditionalDailyBinding({ibkr:[option,option]},facts,profiles,nonce,additional));
assert.throws(()=>matchAdditionalDailyBinding(options,facts,[{profile:'other_strategy'}],nonce,additional));

const lbOption={key:'fixture-key',target_name:'fixture-target',service_name:'fixture-service',deployment_selector:'fixture-deploy',account_scope:'HK',account_selector:'HK'};
const lbFacts={schema_version:'qsl_account_facts_bindings.v1',bindings:[{platform:'longbridge',account_key:lbOption.key,target_name:lbOption.target_name,service_name:lbOption.service_name,deployment_selector:lbOption.deployment_selector,account_scope:lbOption.account_scope,account_selector:lbOption.account_selector,target_id:lbOption.target_name,source_binding:{kind:'deployment_scope_token_version',id:'e'.repeat(64)}}]};
const lbDigest='48b2ad005eeda150239f62d33032b4f5075d005ce00518dfd41599ceed4336ab';
assert.equal(matchExecutionDailyBinding({longbridge:[lbOption]},lbFacts,[{profile:'fixture_strategy'}],'longbridge',nonce,lbDigest).account_key,'fixture-key');
assert.throws(()=>matchExecutionDailyBinding({longbridge:[{...lbOption,account_selector:'SG'}]},lbFacts,[{profile:'fixture_strategy'}],'longbridge',nonce,lbDigest));
const fallbackBinding={account_scope:'HK',account_selector:'HK',deployment_selector:'fixture-deploy',platform:'longbridge',service_name:'fixture-service',source_binding_id:'e'.repeat(64),strategy_profile:'soxl_soxx_trend_income',target_id:'fixture-target'};
const fallbackDigest=createHash('sha256').update(JSON.stringify({binding:fallbackBinding,domain:'qsl.longbridge-daily-binding.v1',nonce})).digest('hex');
assert.equal(matchExecutionDailyBinding({longbridge:[lbOption]},lbFacts,[{profile:'unrelated'}],'longbridge',nonce,fallbackDigest).strategy_profile,'soxl_soxx_trend_income');
