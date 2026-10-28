import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { comparison } from '../web/strategy-switch-console/compare_ibkr_daily_binding.mjs';

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
