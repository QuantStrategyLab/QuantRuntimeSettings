// Executes the exact synthetic #946 candidate in an offline Worker runtime.
// A separate test-only copy receives fixed exports; production candidates do not.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {verify946} from '../scripts/console_946_patch.mjs';

const consoleRequire=createRequire(new URL('../web/strategy-switch-console/package.json',import.meta.url));
const frontendRequire=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url));
const ts=frontendRequire('typescript');
const trace=consoleRequire('@jridgewell/trace-mapping');
const {Miniflare}=consoleRequire('miniflare');
const root=join(process.env.RUNNER_TEMP,'qrs946-bundle-evidence');
const old=await readFile(join(root,'old/worker.js'));
const next=await readFile(join(root,'new/worker.js'));
const oldMap=JSON.parse(await readFile(join(root,'old/worker.js.map'),'utf8'));
const newMap=JSON.parse(await readFile(join(root,'new/worker.js.map'),'utf8'));
const candidate=verify946(ts,trace,old,next,old,oldMap,newMap);
assert.ok(candidate.equals(next),'all three replacements must exactly reproduce reviewed new bundle');
const text=old.toString('utf8');
const parsedOld=ts.createSourceFile('worker.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const htmlDeclarations=parsedOld.statements.flatMap(statement => ts.isVariableStatement(statement)
  ? [...statement.declarationList.declarations].filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text==='V2_PAGE_HTML') : []);
assert.equal(htmlDeclarations.length,1,'the synthetic bundle has one static HTML declaration');
const html=htmlDeclarations[0].initializer;
assert.ok(html && ts.isStringLiteral(html),'HTML is a plain string literal');
const htmlStart=html.getStart(parsedOld), htmlEnd=html.end;
const activeWithDifferentHtml=Buffer.from(text.slice(0,htmlStart)+'"synthetic-active-page"'+text.slice(htmlEnd));
const candidateWithDifferentHtml=verify946(ts,trace,old,next,activeWithDifferentHtml,oldMap,newMap).toString('utf8');
assert.ok(candidateWithDifferentHtml.includes('"synthetic-active-page"'),'active HTML stays byte-identical');
const activeWithDynamicHtml=Buffer.from(text.slice(0,htmlStart)+'(()=>"unsafe")()'+text.slice(htmlEnd));
assert.throws(()=>verify946(ts,trace,old,next,activeWithDynamicHtml,oldMap,newMap),/asset_shape_invalid/);
assert.throws(()=>verify946(ts,trace,old,next,Buffer.from(text.replace('function hasGap(', 'function hasGapAltered(')),oldMap,newMap),
  /active_dependency_or_wiring_mismatch/,'a changed helper cannot pass');
assert.throws(()=>verify946(ts,trace,old,next,Buffer.from(text.replace('function applyNativeDailyReturns(', 'function applyNativeDailyReturnsAltered(')),oldMap,newMap),
  /required_statement_missing/,'a missing target cannot pass');
assert.throws(()=>verify946(ts,trace,old,next,Buffer.from(text + '\nfunction applyNativeDailyReturns() {}\n'),oldMap,newMap),
  /duplicate_target/,'duplicate target declarations cannot pass');
const wrapper=parsedOld.statements.find(statement=>ts.isFunctionDeclaration(statement) && statement.name?.text==='accountFactsHistoryResponse2');
assert.ok(wrapper,'old history Worker wrapper exists');
const wrapperStart=wrapper.getStart(parsedOld), wrapperCode=text.slice(wrapperStart,wrapper.end);
assert.ok(!wrapperCode.includes('*/'),'the synthetic negative fixture can hold the old wrapper in one comment');
const alteredWrapper=wrapperCode.replace('loadAccountFactsBindings,','loadAccountFactsBindings: null,');
assert.notEqual(alteredWrapper,wrapperCode,'the synthetic negative fixture changes the actual wrapper');
const changedWithComment=Buffer.from(text.slice(0,wrapperStart)+alteredWrapper+text.slice(wrapper.end)+'\n/*'+wrapperCode+'*/\n');
assert.throws(()=>verify946(ts,trace,old,next,changedWithComment,oldMap,newMap),/active_target_mismatch/,
  'a matching old function in a comment cannot substitute for the live AST node');
assert.ok(!wrapperCode.includes('`') && !wrapperCode.includes('${'),'the old wrapper is safe for a synthetic template literal');
const changedWithString=Buffer.from(text.slice(0,wrapperStart)+alteredWrapper+text.slice(wrapper.end)+'\nconst decoy = `'+wrapperCode+'`;\n');
assert.throws(()=>verify946(ts,trace,old,next,changedWithString,oldMap,newMap),/active_dependency_or_wiring_mismatch/,
  'a matching old function in a string cannot substitute for the live AST node');

const instrument='\nexport { applyNativeDailyReturns, performanceBlocks };\n';
const testCopy=Buffer.concat([candidate,Buffer.from(instrument)]);
assert.ok(testCopy.subarray(0,candidate.length).equals(candidate));
const tmp=await mkdtemp(join(process.env.RUNNER_TEMP,'qrs946-candidate-test-'));
let mf, outbound=0;
try {
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
  mf=new Miniflare({modules:true,modulesRules:[{type:'ESModule',include:['**/*.mjs']}],scriptPath:join(tmp,'harness.mjs'),
    compatibilityDate:'2026-06-08',outboundService:()=>{outbound++;throw Error('external_calls_forbidden');}});
  const response=await mf.dispatchFetch('https://synthetic.invalid/test');
  assert.equal(response.status,200,'candidate regression harness must succeed');
  assert.deepEqual(await response.json(),{ok:true});
  assert.equal(outbound,0,'candidate regressions must not access the network');
  console.log(JSON.stringify({ok:true,synthetic_candidate_exact:true,instrumentation:'fixed_test_copy_only',offline_runtime:true}));
} finally {
  if(mf)await mf.dispose();
  await rm(tmp,{recursive:true,force:true});
}
