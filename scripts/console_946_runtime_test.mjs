// Fixed isolated candidate regression. Never print candidate bytes or errors.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chmod,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const require=createRequire(new URL('../web/strategy-switch-console/package.json',import.meta.url));
const {Miniflare,NoOpLog}=require('miniflare');
export async function testCandidate946(candidate) {
const instrument='\nexport { applyNativeDailyReturns, performanceBlocks };\n';
const testCopy=Buffer.concat([candidate,Buffer.from(instrument)]);
assert.ok(testCopy.subarray(0,candidate.length).equals(candidate));
const tmp=await mkdtemp(join(process.env.RUNNER_TEMP,'qrs946-candidate-test-'));
let mf, outbound=0;
try {
  await chmod(tmp,0o700);
  await writeFile(join(tmp,'candidate.mjs'),testCopy,{mode:0o600});
  await writeFile(join(tmp,'harness.mjs'),String.raw`
import worker, {__test, applyNativeDailyReturns, performanceBlocks} from './candidate.mjs';
const check=(ok,code)=>{if(!ok)throw Error(code)};
export default {async fetch() {
  const row=date=>({status:'available',method:'native_ibkr_twr',source:'ChangeInNAV.twr',unit:'ratio',currency:'USD',period:{from:date,to:date},value:'0.01'});
  const input={accounts:[{platform:'ibkr',account_key:'synthetic-account',return:{daily:[row('2026-10-21')]}}],histories:[],range:'ALL',today:'2026-10-23',year:2026,month:10,failed:[],benchmarks:[]};
  const result=applyNativeDailyReturns(performanceBlocks(input),input);
  check(result.summary.status==='partial','native_status');
  check(result.summary.unavailable_reason==='snapshot_history_missing','native_reason');
  check(result.returns.coverage.range_complete===false,'native_coverage');
  check(Math.abs(result.summary.twr_return_percent-1)<1e-10,'native_observed_return');
  check(result.summary.metric_reasons.twr===null,'native_metric_reason');
  const id='a'.repeat(64);
  const option={key:'synthetic',label:'Synthetic',target_name:'synthetic-target',service_name:'synthetic-service',deployment_selector:'synthetic-deploy',account_scope:'paper',account_selector:'PAPER'};
  const binding={platform:'longbridge',account_key:'synthetic',account_scope:'paper',target_name:option.target_name,service_name:option.service_name,deployment_selector:option.deployment_selector,account_selector:'PAPER',target_id:'synthetic-target',source_binding:{kind:'deployment_scope_token_version',id}};
  let failKey='',stored={ok:true,days:[]},status=200,failStore=false;
  const env={ACCOUNT_FACTS_READ_MODEL_ENABLED:'true',SESSION_SECRET:'synthetic-session-only',ALLOWED_GITHUB_LOGINS:'synthetic-reader',
    STRATEGY_SWITCH_CONFIG:{put:async()=>{throw Error('unexpected_write')},get:async key=>{
      if(key===failKey)throw Error('synthetic_kv_failure');
      if(key==='account_options')return JSON.stringify({longbridge:[option]});
      if(key==='account_facts_bindings')return JSON.stringify({schema_version:'qsl_account_facts_bindings.v1',bindings:[binding]});
      return null;
    }},
    STRATEGY_SWITCH_RUNTIME_INSTANCES:{idFromName:()=> 'synthetic',get:()=>({fetch:async(_url,options)=>{
      if(!options?.body)return Response.json({ok:true,initialized:false});
      if(failStore)throw Error('synthetic_do_failure');
      return Response.json(stored,{status});
    }})}};
  const session=await __test.makeSession('synthetic-reader',[],env);
  const base='https://synthetic.invalid/api/account-facts/history?platform=longbridge&account_key=synthetic';
  const queries=[base+'&currency=USD',base+'&currency=USD&include_currencies=true',base+'&projection=currencies'];
  for(const url of queries){
    const request=()=>worker.fetch(new Request(url,{headers:{Cookie:'qsl_switch_session='+session}}),env,{waitUntil(){}});
    for(const key of ['account_options','account_facts_bindings']){
      failKey=key;const response=await request();check(response.status===503,'kv_failure_status');
      check((await response.json()).error==='account_facts_history_unavailable','kv_failure_reason');
    }
    failKey='';failStore=true;let response=await request();check(response.status===503,'do_failure_status');
    check((await response.json()).error==='runtime_instances_unavailable','do_failure_reason');
    failStore=false;stored={ok:true};response=await request();check(response.status===503,'malformed_status');
    stored={ok:true,days:[]};response=await request();check(response.status===200,'empty_status');
    stored={ok:false,error:'account_facts_stored_invalid'};status=409;response=await request();check(response.status===409,'corrupt_status');
    status=200;stored={ok:true,days:[]};
  }
  return Response.json({ok:true});
}};
`,{mode:0o600});
  mf=new Miniflare({rootPath:tmp,modulesRoot:tmp,modules:true,modulesRules:[{type:'ESModule',include:['**/*.mjs']}],scriptPath:join(tmp,'harness.mjs'),
    compatibilityDate:'2026-06-08',cf:false,log:new NoOpLog(),outboundService:()=>{outbound++;throw Error('external_calls_forbidden');}});
  const response=await mf.dispatchFetch('https://synthetic.invalid/test');
  assert.equal(response.status,200,'candidate regression harness must succeed');
  assert.deepEqual(await response.json(),{ok:true});
  assert.equal(outbound,0,'candidate regressions must not access the network');
  return {ok:true,instrumentation:'fixed_test_copy_only',offline_runtime:true};
} finally {
  try { if(mf)await mf.dispose(); }
  finally { await rm(tmp,{recursive:true,force:true}); }
}

}
