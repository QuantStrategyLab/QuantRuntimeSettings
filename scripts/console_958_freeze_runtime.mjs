// Isolated synthetic checks of actual candidate bytes. No live storage or network.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,writeFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
const require=createRequire(new URL('../web/strategy-switch-console/package.json',import.meta.url));
const {Miniflare,NoOpLog}=require('miniflare');
export async function testCandidate958Freeze(candidate) {
 const tmp=await mkdtemp(join(process.env.RUNNER_TEMP,'qrs958-check-')); let mf; let outbound=0;
 try {
  await chmod(tmp,0o700);
  const testCopy=Buffer.concat([candidate,Buffer.from('\nexport { buildAdminState };\n')]);
  assert.ok(testCopy.subarray(0,candidate.length).equals(candidate));
  await writeFile(join(tmp,'candidate.mjs'),testCopy,{mode:0o600});
  await writeFile(join(tmp,'harness.mjs'),String.raw`
import worker, {__test, buildAdminState} from './candidate.mjs';
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
 test('legacy_continuity_preserved',()=>{const p=normalized([profile('global_etf_rotation','us_equity',['dry_run'],{frozen:true,live_continuity:{eligible:true,allowed_platforms:['ibkr']}})]);const o=observed('ibkr','us_equity','dry_run');const input={platform:'ibkr',strategy_profile:'global_etf_rotation',execution_mode:'live',live_continuity_baseline_id:'synthetic',live_continuity_captured_at:'2026-01-01',plugin_mode:'current',option_overlay_mode:'current'};for(const state of ['RECONCILE_ONLY','RISK_REDUCTION_ONLY'])__test.assertStrategyAllowedForAccount({...input,live_continuity_state:state},o.config,p);reject(()=>__test.assertStrategyAllowedForAccount({...input,live_continuity_state:'ACTIVE_LKG'},o.config,p));for(const changes of [{live_continuity_baseline_id:''},{live_continuity_captured_at:''},{platform:'schwab'},{extra_variables_json:'{\"UNAPPROVED_VARIABLE\":\"true\"}'}])reject(()=>__test.assertStrategyAllowedForAccount({...input,live_continuity_state:'RECONCILE_ONLY',...changes},o.config,p))},out);
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
 try {
  const legacy=profile('global_etf_rotation','us_equity',['dry_run','live'],{frozen:false,lifecycle_stage:'runtime_enabled',runtime_enabled:true,can_switch_live:true,live_continuity:{eligible:true,allowed_platforms:['ibkr']}});
  const payload={platform:'ibkr',target_name:'legacy-ibkr-route',account_selector:'LEGACY_IBKR',deployment_selector:'legacy-ibkr-route',account_scope:'legacy-ibkr-route',service_name:'interactive-brokers-legacy-ibkr-route-service',strategy_profile:'global_etf_rotation',execution_mode:'live',live_continuity_state:'RECONCILE_ONLY',live_continuity_baseline_id:'synthetic-lkg',live_continuity_captured_at:'2026-08-30',variable_scope:'default',plugin_mode:'current',option_overlay_mode:'current',cash_only_execution_mode:'current'};
  const account={key:'legacy-ibkr-route',label:'Legacy',target_name:payload.target_name,account_selector:payload.account_selector,deployment_selector:payload.deployment_selector,account_scope:payload.account_scope,service_name:payload.service_name,supported_domains:['us_equity'],default_strategy_profile:'global_etf_rotation'};
  const kv=new Map([['strategy_profiles',JSON.stringify([legacy])],['account_options',JSON.stringify({ibkr:[]})]]);let writes=0;
  const env={STRATEGY_SWITCH_SYNC_TOKEN:'synthetic',STRATEGY_SWITCH_CONFIG:{get:async key=>kv.get(key)||null,put:async(key,value)=>{writes++;kv.set(key,value)}}};
  const call=body=>worker.fetch(new Request('https://synthetic.invalid/api/internal/sync-account-default',{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify(body)}),env,{waitUntil(){}});
  let response=await call(payload);assert(response.status===409&&writes===0);
  kv.set('account_options',JSON.stringify({ibkr:[{...account,default_strategy_profile:'tqqq_growth_income'}]}));response=await call(payload);assert(response.status===409&&writes===0);
  kv.set('account_options',JSON.stringify({ibkr:[account]}));
  for(const state of ['RECONCILE_ONLY','RISK_REDUCTION_ONLY']){response=await call({...payload,live_continuity_state:state});assert(response.status===200)}
  const before=writes;
  for(const change of [{live_continuity_baseline_id:''},{live_continuity_captured_at:''},{live_continuity_state:'ACTIVE_LKG'},{extra_variables_json:'{\"UNAPPROVED_VARIABLE\":\"true\"}'}]){response=await call({...payload,...change});assert(response.status===409&&writes===before)}
  out.continuity_http_guards=true;
 }catch{out.continuity_http_guards=false}
 try {
  const data=new Map([['strategy_profiles',JSON.stringify([profile('global_etf_rotation','us_equity',['dry_run'],{frozen:false,lifecycle_stage:'runtime_enabled'}),profile('crypto_trend_rotation','crypto')])]]);
  const env={STRATEGY_SWITCH_CONFIG:{get:async k=>data.get(k)||null,put:async()=>{throw Error('writes_forbidden')}},STRATEGY_SWITCH_RUNTIME_INSTANCES:{idFromName:()=> 'synthetic',get:()=>({fetch:async()=>Response.json({ok:true})})}};
  const state=await buildAdminState({login:'synthetic'},env);
  out.admin_frozen_choices=Array.isArray(state.runtimeInstanceStrategies)&&!state.runtimeInstanceStrategies.some(x=>x.profile==='global_etf_rotation');
 }catch{out.admin_frozen_choices=false}
 return Response.json(out);
}};
`,{mode:0o600});
  mf=new Miniflare({rootPath:tmp,modulesRoot:tmp,modules:true,modulesRules:[{type:'ESModule',include:['**/*.mjs']}],scriptPath:join(tmp,'harness.mjs'),compatibilityDate:'2026-06-08',cf:false,log:new NoOpLog(),outboundService:()=>{outbound++;throw Error('external_calls_forbidden')}});
  const response=await mf.dispatchFetch('https://synthetic.invalid/test');
  assert.equal(response.status,200); const result=await response.json();
  const names=['dry_run_selection','missing_or_live_mode_excluded','wrong_domain_excluded','ordinary_live_policy_retained','legacy_continuity_preserved','frozen_choice_and_draft','frozen_direct_policy','account_settings_http','continuity_http_guards','admin_frozen_choices'];
  assert.equal(outbound,0);
  if(!result||names.some(k=>typeof result[k]!=='boolean')||Object.keys(result).length!==names.length)throw Error('harness_invalid');
  return result;
 } finally {try{if(mf)await mf.dispose()}finally{await rm(tmp,{recursive:true,force:true})}}
}
