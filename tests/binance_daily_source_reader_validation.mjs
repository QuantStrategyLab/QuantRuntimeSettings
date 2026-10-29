import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { matchBinanceDailyFromGitHub } from '../web/strategy-switch-console/binance_daily_source_reader.mjs';

const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const wallet = {platform:'binance',account_key:'fixture-account',account_scope:'live',target_name:'fixture-target',service_name:'',
  deployment_selector:'fixture-deploy',account_selector:'fixture-selector',target_id:'fixture-target',account_scope_sha256:'a'.repeat(64),
  reader_revision:'b'.repeat(40),approved_application_revision:'c'.repeat(40),source_binding:{kind:'binance_readonly_scope_revision',id:''}};
wallet.source_binding.id=sha(JSON.stringify({account_scope_sha256:wallet.account_scope_sha256,approved_application_revision:wallet.approved_application_revision,
  reader_public_revision:wallet.reader_revision,scope:'spot+flexible_earn'}));
const options={binance:[{key:wallet.account_key,label:'Fixture',target_name:wallet.target_name,service_name:'',
  deployment_selector:wallet.deployment_selector,account_selector:wallet.account_selector,account_scope:wallet.account_scope}]};
const target={platform_id:'binance',service_name:'fixture-service',strategy_profile:'fixture-profile',account_scope:'live',
  account_selector:['fixture-selector'],deployment_selector:'fixture-deploy'};
const nonce='d'.repeat(64),expected='04e93d06823e63c4d401b806426aae6b5c9c2ef582203100956c280192c33be7';
const request={options,wallet,nonce,expected,githubToken:'synthetic-github-token'};
let calls=0;
const fetchOk=async (url,init)=>{
  calls++;
  assert.equal(url,'https://api.github.com/repos/QuantStrategyLab/BinancePlatform/actions/variables/RUNTIME_TARGET_JSON');
  assert.equal(init.headers.Authorization,'Bearer synthetic-github-token');
  assert.equal(init.redirect,'error'); assert.equal(init.method,'GET');
  return new Response(JSON.stringify({name:'RUNTIME_TARGET_JSON',value:JSON.stringify(target)}),{status:200});
};
const result=await matchBinanceDailyFromGitHub({...request,fetchImpl:fetchOk});
assert.equal(result.status,'matched');assert.equal(result.binding.account_key,'fixture-account');assert.equal(calls,1);
for (const [status,expectedStatus] of [[403,'forbidden'],[404,'not_found'],[401,'unavailable'],[500,'unavailable']]) {
  let count=0;
  const result=await matchBinanceDailyFromGitHub({...request,fetchImpl:async()=>{count++;return new Response('',{status});}});
  assert.deepEqual(result,{status:expectedStatus});assert.equal(count,1);
}
assert.deepEqual(await matchBinanceDailyFromGitHub({...request,githubToken:''}),{status:'unavailable'});
assert.deepEqual(await matchBinanceDailyFromGitHub({...request,fetchImpl:async()=>new Response('x'.repeat(128*1024+1))}),{status:'unavailable'});
assert.deepEqual(await matchBinanceDailyFromGitHub({...request,fetchImpl:async()=>new Response(JSON.stringify({name:'RUNTIME_TARGET_JSON',value:'{}'}))}),{status:'unavailable'});
console.log('binance daily source reader validation passed');
