// Isolated synthetic checks of actual candidate bytes. No live storage or network.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,writeFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
const require=createRequire(new URL('../web/strategy-switch-console/package.json',import.meta.url));
const {Miniflare,NoOpLog}=require('miniflare');
export async function testCandidate958(candidate) {
 const tmp=await mkdtemp(join(process.env.RUNNER_TEMP,'qrs958-check-')); let mf; let outbound=0;
 try {
  await chmod(tmp,0o700);
  await writeFile(join(tmp,'candidate.mjs'),candidate,{mode:0o600});
  await writeFile(join(tmp,'harness.mjs'),String.raw`
import worker, {__test} from './candidate.mjs';
const test=(name,fn,results)=>{try{fn();results[name]=true}catch{results[name]=false}};
const reject=fn=>{let blocked=false;try{fn()}catch{blocked=true}if(!blocked)throw Error('expected_rejection')};
const assert=x=>{if(!x)throw Error('assertion')};
const normalized=rows=>__test.normalizeStrategyProfilesPayload(rows);
const profile=(id,domain,modes=['dry_run'],extra={})=>({profile:id,label:id,domain,allowed_execution_modes:modes,...extra});
const observed=(platform,domain,mode)=>({platform,config:{supported_domains:[domain],...(mode===undefined?{}:{default_execution_mode:mode})},draft:{status:'current',overrides:{}},identity:{},risk:{revision:0,scope_id:'synthetic',preference:null},key:'synthetic',instance_revision:0});
const choice=(platform,obs,profiles,id)=>__test.accountDraftStrategyChoices(platform,obs.config,profiles).some(p=>p.profile===id);
const frozen=[
 ['global_etf_rotation','us_equity','ibkr'], ['tecl_xlk_trend_income','us_equity','ibkr'],
 ['hk_global_etf_tactical_rotation','hk_equity','longbridge'], ['hk_low_vol_dividend_quality_snapshot','hk_equity','longbridge'], ['hk_equity_combo','hk_equity','longbridge'],
 ['cn_industry_etf_rotation','cn_equity','qmt'], ['cn_industry_etf_rotation_aggressive','cn_equity','qmt'], ['cn_index_etf_tactical_rotation','cn_equity','qmt'],
 ['cn_chinext_tactical_rotation','cn_equity','qmt'], ['cn_chinext_growth_momentum_quality','cn_equity','qmt'], ['cn_dividend_quality_snapshot','cn_equity','qmt'],
 ['cn_chinext_growth_momentum_quality_snapshot','cn_equity','qmt'], ['cn_star_growth_momentum_quality','cn_equity','qmt'], ['cn_equity_combo','cn_equity','qmt']];
const aliases=[['global_macro_etf_rotation','us_equity','ibkr'],['global_etf_confidence_vol_gate','us_equity','ibkr'],
 ['global-etf-rotation','us_equity','ibkr'],['global-macro-etf-rotation','us_equity','ibkr'],['global-etf-confidence-vol-gate','us_equity','ibkr'],
 ['hk-global-etf-tactical-rotation','hk_equity','longbridge'],['cn-industry-etf-rotation','cn_equity','qmt']];
export default {async fetch(){
 const out={};
 test('dry_run_selection',()=>{const p=normalized([profile('crypto_trend_rotation','crypto')]);const o=observed('binance','crypto','dry_run');assert(choice('binance',o,p,'crypto_trend_rotation'));__test.assertAccountDraftPatch(p,o,{strategy_profile:'crypto_trend_rotation'},'')},out);
 test('missing_or_live_mode_excluded',()=>{const p=normalized([profile('crypto_trend_rotation','crypto')]);for(const m of [undefined,'paper','live']){const o=observed('binance','crypto',m);assert(!choice('binance',o,p,'crypto_trend_rotation'));reject(()=>__test.assertAccountDraftPatch(p,o,{strategy_profile:'crypto_trend_rotation'},''))}},out);
 test('wrong_domain_excluded',()=>{const p=normalized([profile('crypto_trend_rotation','crypto')]);assert(!choice('ibkr',observed('ibkr','us_equity','dry_run'),p,'crypto_trend_rotation'));assert(!choice('unknown',observed('unknown','crypto','dry_run'),p,'crypto_trend_rotation'))},out);
 test('ordinary_live_policy_retained',()=>{const p=normalized([profile('crypto_trend_rotation','crypto')]);reject(()=>__test.assertStrategyAllowedForAccount({platform:'binance',strategy_profile:'crypto_trend_rotation',execution_mode:'live'},observed('binance','crypto','dry_run').config,p))},out);
 const staleCases=()=>[...frozen,...aliases].flatMap(([id,domain,platform])=>[false,undefined].map(state=>{const extra={lifecycle_stage:'runtime_enabled',runtime_enabled:true,can_switch_live:true};if(state===false)extra.frozen=false;return {id,platform,p:normalized([profile(id,domain,['dry_run'],extra)]),o:observed(platform,domain,'dry_run')}}));
 test('frozen_choice_and_draft',()=>{for(const {id,platform,p,o} of staleCases()){assert(!choice(platform,o,p,id));reject(()=>__test.assertAccountDraftPatch(p,o,{strategy_profile:id},''))}},out);
 test('frozen_direct_policy',()=>{for(const {id,platform,p,o} of staleCases())reject(()=>__test.assertStrategyAllowedForAccount({platform,strategy_profile:id,execution_mode:'dry_run'},o.config,p))},out);
 try {
  const account=observed('binance','crypto','dry_run');
  const env={SESSION_SECRET:'synthetic-only',ALLOWED_GITHUB_LOGINS:'synthetic-reader',
   STRATEGY_SWITCH_CONFIG:{put:async()=>{throw Error('writes_forbidden')},get:async key=>key==='strategy_profiles'?JSON.stringify([profile('crypto_trend_rotation','crypto')]):null},
   STRATEGY_SWITCH_RUNTIME_INSTANCES:{idFromName:()=> 'synthetic',get:()=>({fetch:async()=>Response.json(account)})}};
  const cookie=await __test.makeSession('synthetic-reader',[],env);
  const res=await worker.fetch(new Request('https://synthetic.invalid/api/account-settings?platform=binance&key=synthetic',{headers:{Cookie:'qsl_switch_session='+cookie}}),env,{waitUntil(){}});
  const body=await res.json();out.account_settings_http=res.status===200&&Array.isArray(body.strategy_options)&&body.strategy_options.some(x=>x.profile==='crypto_trend_rotation');
 }catch{out.account_settings_http=false}
 return Response.json(out);
}};
`,{mode:0o600});
  mf=new Miniflare({rootPath:tmp,modulesRoot:tmp,modules:true,modulesRules:[{type:'ESModule',include:['**/*.mjs']}],scriptPath:join(tmp,'harness.mjs'),compatibilityDate:'2026-06-08',cf:false,log:new NoOpLog(),outboundService:()=>{outbound++;throw Error('external_calls_forbidden')}});
  const response=await mf.dispatchFetch('https://synthetic.invalid/test');
  assert.equal(response.status,200); const result=await response.json();
  const names=['dry_run_selection','missing_or_live_mode_excluded','wrong_domain_excluded','ordinary_live_policy_retained','frozen_choice_and_draft','frozen_direct_policy','account_settings_http'];
  assert.equal(outbound,0);
  if(!result||names.some(k=>typeof result[k]!=='boolean')||Object.keys(result).length!==names.length)throw Error('harness_invalid');
  return result;
 } finally {try{if(mf)await mf.dispose()}finally{await rm(tmp,{recursive:true,force:true})}}
}
