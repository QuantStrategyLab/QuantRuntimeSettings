import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { matchBinanceDailyBinding } from '../web/strategy-switch-console/binance_daily_binding.mjs';

const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const wallet = {platform:'binance', account_key:'fixture-account', account_scope:'live', target_name:'fixture-target',
  service_name:'', deployment_selector:'fixture-deploy', account_selector:'fixture-selector', target_id:'fixture-target',
  account_scope_sha256:'a'.repeat(64), reader_revision:'b'.repeat(40), approved_application_revision:'c'.repeat(40),
  source_binding:{kind:'binance_readonly_scope_revision', id:''}};
wallet.source_binding.id = sha(JSON.stringify({account_scope_sha256:wallet.account_scope_sha256,
  approved_application_revision:wallet.approved_application_revision, reader_public_revision:wallet.reader_revision, scope:'spot+flexible_earn'}));
const option = {key:wallet.account_key, label:'Fixture', target_name:wallet.target_name, service_name:'',
  deployment_selector:wallet.deployment_selector, account_selector:wallet.account_selector, account_scope:wallet.account_scope};
const options = {binance:[option]};
const target = {platform_id:'binance', service_name:'fixture-service', strategy_profile:'fixture-profile',
  account_scope:'live', account_selector:['fixture-selector'], deployment_selector:'fixture-deploy'};
const nonce='d'.repeat(64);
const candidate={account_scope:'live',account_selector:'fixture-selector',deployment_selector:'fixture-deploy',platform:'binance',
  service_name:'fixture-service',source_binding_id:wallet.source_binding.id,strategy_profile:'fixture-profile',target_id:'fixture-target'};
const expected=sha(JSON.stringify({binding:candidate,domain:'qsl.binance-daily-binding.v1',nonce}));
assert.equal(expected,'04e93d06823e63c4d401b806426aae6b5c9c2ef582203100956c280192c33be7'); // Python sender canonical vector.
const matched=await matchBinanceDailyBinding(options,wallet,target,nonce,expected);
assert.deepEqual(matched,{...candidate,account_key:'fixture-account'});
assert.equal(matched.service_name,'fixture-service'); // Never derive this from an empty wallet service.
for (const [label,opts,binding,source,digest] of [
  ['duplicate options',{binance:[option,option]},wallet,target,expected],
  ['wrong nonce',options,wallet,target,expected],
  ['wrong selector',options,wallet,{...target,account_selector:['other']},expected],
  ['wrong deployment',options,wallet,{...target,deployment_selector:'other'},expected],
  ['missing service',options,wallet,{...target,service_name:''},expected],
  ['wrong service',options,wallet,{...target,service_name:'other'},expected],
  ['wrong profile',options,wallet,{...target,strategy_profile:'other'},expected],
  ['wrong digest',options,wallet,target,'0'.repeat(64)],
  ['wrong wallet source',options,{...wallet,source_binding:{...wallet.source_binding,id:'0'.repeat(64)}},target,expected],
]) {
  await assert.rejects(() => matchBinanceDailyBinding(opts,binding,source,label === 'wrong nonce' ? 'x' : nonce,digest), undefined, label);
}
console.log('binance daily binding validation passed');
