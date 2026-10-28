import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Entirely synthetic subprocess, gh and Cloudflare responses; never use credentials.
const dir=mkdtempSync(join(tmpdir(),'ibkr-daily-test-'));
const state=join(dir,'state.json'), gh=join(dir,'gh'), loader=join(dir,'loader.mjs'), preload=join(dir,'preload.mjs');
const sha=createHash('sha256').update('synthetic module').digest('hex');
const syntheticSecrets=['IBKR_ACCOUNT_FACTS_PROJECT_ID','IBKR_ACCOUNT_FACTS_REPORT_PREFIX','IBKR_ACCOUNT_FACTS_TARGET_ID',
  'IBKR_ACCOUNT_FACTS_SERVICE_NAME','IBKR_ACCOUNT_FACTS_RUNTIME_REVISION','IBKR_ACCOUNT_FACTS_ACCOUNT_SCOPE',
  'IBKR_ACCOUNT_FACTS_ACCOUNT_SELECTOR_JSON','IBKR_ACCOUNT_FACTS_DEPLOYMENT_SELECTOR','IBKR_PERIOD_RETURN_ACCOUNT_KEY',
  'IBKR_PERIOD_RETURN_ACCOUNT_SCOPE','IBKR_PERIOD_RETURN_SOURCE_BINDING_ID','IBKR_PERIOD_RETURN_TARGET_ID']
  .map(name=>({name,updated_at:'2026-10-27T00:00:00Z'}));
writeFileSync(loader,`
import {readFile} from 'node:fs/promises';
const mock='export const comparison=()=>"'+'b'.repeat(64)+'"; export const primaryBinding=()=>({account_key:"synthetic",target_id:"synthetic",source_binding_id:"'+'c'.repeat(64)+'",service_name:"service",account_scope:"live"});';
export async function resolve(s,c,n){if(s.endsWith('/compare_ibkr_daily_binding.mjs')||s==='./compare_ibkr_daily_binding.mjs')return {url:'data:text/javascript,'+encodeURIComponent(mock),shortCircuit:true};return n(s,c);}
export async function load(u,c,n){if(u.endsWith('/execute_ibkr_daily_setup.mjs')||u.endsWith('/ibkr_daily_setup_transport.mjs')){let src=await readFile(new URL(u),'utf8');src=src.replace('d1e10f49c2a537733751ac8418384c1bffa52763cb959521f5c5bf7940e2149e','${sha}');return {format:'module',source:src,shortCircuit:true};}return n(u,c);}
`);
writeFileSync(gh,`#!/bin/sh\nunset NODE_OPTIONS\nexec node "${gh}.cjs" "$@"\n`);
writeFileSync(`${gh}.cjs`,`
const fs=require('fs'), p=process.env.MOCK_STATE; let s=JSON.parse(fs.readFileSync(p)); const args=process.argv.slice(2), path=args[1]||'';
const save=()=>fs.writeFileSync(p,JSON.stringify(s));
if(args[0]==='secret'){const name=args[2];s.effects.push(name);s.secrets.push({name,updated_at:'2026-10-28T16:41:00Z'});save();if(process.env.MOCK_FAIL===name)process.exit(1);process.exit(0);}
if(process.env.MOCK_FAIL==='preflight_403'&&path.includes('actions/runs?')){console.error('HTTP 403: synthetic');process.exit(1);}
if(args[0]==='run'){let id=args[2];console.log(id==='40728959942'?'DAILY_COMPARISON_NONCE: '+ 'a'.repeat(64)+'\\nstatus=ok comparison='+ 'b'.repeat(64):'status=ok comparison='+ 'b'.repeat(64));process.exit(0);}
if(path.includes('actions/secrets/public-key'))console.log('{}');
else if(path.includes('actions/secrets?'))console.log(JSON.stringify({total_count:s.secrets.length,secrets:s.secrets}));
else if(path.includes('actions/runs?'))console.log(JSON.stringify({total_count:0,workflow_runs:[]}));
else if(path.endsWith('/40728959942'))console.log(JSON.stringify({status:'completed',conclusion:'success',head_sha:'489f31f64de99cf589f1459ff256687c2fb8fe4f'}));
else if(path.endsWith('/40728951358'))console.log(JSON.stringify({status:'completed',conclusion:'success',head_sha:'0e143781ebe15999d1dee24f8c9ce79a58fbec90',created_at:'2026-10-28T16:30:00Z'}));
else if(path.endsWith('/123'))console.log(JSON.stringify({created_at:'2026-10-28T16:40:00Z'}));
else process.exit(2);
`);
chmodSync(gh,0o700);
writeFileSync(preload,`
import {readFileSync,writeFileSync} from 'node:fs';
const file=process.env.MOCK_STATE, old='2b097d2e-ffb5-4f08-af3b-9cc1d4b9e9ee', next='cccccccc-cccc-4ccc-accc-cccccccccccc';
const b64=Buffer.from('synthetic module').toString('base64');
const resources=(isNew)=>({bindings:[{name:'STRATEGY_SWITCH_CONFIG',type:'kv_namespace',namespace_id:(process.env.MOCK_FAIL==='namespace'?'c':'b').repeat(32)},{name:'STRATEGY_HEALTH_SYNC_TOKEN',type:'secret_text'},...(isNew?[{name:'IBKR_RUNTIME_DAILY_SYNC_TOKEN',type:'secret_text'},{name:'IBKR_RUNTIME_DAILY_TARGET_KEY',type:'secret_text'}]:[])],script_runtime:{compatibility_date:'2026-01-01',usage_model:'bundled',migration_tag:'v1'},script:{handlers:['fetch']}});
globalThis.fetch=async(url,opts={})=>{let s=JSON.parse(readFileSync(file));let u=new URL(url),body;
 const save=()=>writeFileSync(file,JSON.stringify(s));
 if(u.hostname==='qsl-strategy-switch-console.pigbibi.workers.dev')return new Response(JSON.stringify({ok:false,error:'login required'}),{status:401,headers:{'content-type':'application/json'}});
 if(u.pathname.includes('/storage/kv/')){const k=u.pathname.split('/').at(-1);if(opts.method==='PUT'){s.effects.push('registry');s.registry=JSON.parse(opts.body);save();if(process.env.MOCK_FAIL==='registry')throw Error('synthetic');body={success:true,result:null};}
 else if(k==='runtime_daily_bindings'&&!s.registry)return new Response('',{status:404});else return new Response(JSON.stringify(k==='runtime_daily_bindings'?s.registry:{}),{status:200,headers:{'content-type':'application/json'}});}
 else if(u.pathname.endsWith('/deployments')&&opts.method==='POST'){s.effects.push('activate');s.deployed=true;save();body={success:true,result:process.env.MOCK_FAIL==='activate_id'?{}:{id:'dddddddd-dddd-4ddd-addd-dddddddddddd'}};}
 else if(u.pathname.endsWith('/deployments'))body={success:true,result:{deployments:[{id:s.deployed?'dddddddd-dddd-4ddd-addd-dddddddddddd':'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee',strategy:'percentage',versions:[{version_id:s.deployed?next:old,percentage:100}]}]}};
 else if(u.pathname.endsWith('/versions')&&opts.method==='POST'){s.effects.push('upload');s.uploaded=true;save();body={success:true,result:process.env.MOCK_FAIL==='upload_id'?{}:{id:next}};}
 else if(u.pathname.endsWith('/versions'))body={success:true,result:{items:(s.uploaded?[{id:next},{id:old}]:[{id:old}])}};
 else if(u.pathname.includes('/versions/')){const id=u.pathname.split('/').at(-1),isNew=id===next;body={success:true,result:u.searchParams.has('include')?{id,modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:b64}]}:{id,resources:resources(isNew)}};}
 else throw Error('unexpected request');
 return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
};
`);
try {
  const script=resolve('web/strategy-switch-console/ibkr_daily_setup_transport.mjs');
  const cases=[['preflight','','preflight_verified'],['preflight','preflight_403','preflight_blocked'],['execute','','configured'],['execute','IBKR_RUNTIME_DAILY_TARGET_KEY','stopped'],['execute','registry','stopped'],['execute','upload_id','stopped'],['execute','activate_id','stopped'],['execute','namespace','stopped']];
  for(const [mode,fail,expected] of cases.filter(([,f])=>!process.env.TEST_FILTER||f===process.env.TEST_FILTER)) {
    writeFileSync(state,JSON.stringify({secrets:syntheticSecrets,effects:[],uploaded:false,deployed:false,registry:null}));
    const env={...process.env,PATH:`${dir}:${process.env.PATH}`,NODE_OPTIONS:`--import ${preload} --loader ${loader}`,
      MOCK_STATE:state,MOCK_FAIL:fail,CLOUDFLARE_API_TOKEN:'synthetic',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),
      STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID:'b'.repeat(32),RUNTIME_SETTINGS_GH_TOKEN:'synthetic',GITHUB_TOKEN:'synthetic',GITHUB_RUN_ID:'123',DAILY_SETUP_MODE:mode};
    const child=spawnSync(process.execPath,[script],{env,encoding:'utf8',timeout:120000});
    assert.ok(child.stdout.trim(),child.stderr);const result=JSON.parse(child.stdout.trim());assert.equal(result.status,expected,child.stderr);
    const seen=JSON.parse(readFileSync(state));
    if(mode==='preflight'){assert.deepEqual(seen.effects,[]);if(!fail){assert.equal(result.health_binding_present,true);assert.equal(result.health_route_reachable,true);}}
    if(mode==='execute'&&!fail)assert.deepEqual(seen.effects,['upload','IBKR_RUNTIME_DAILY_SYNC_TOKEN','IBKR_RUNTIME_DAILY_TARGET_KEY','registry','activate']);
    if(fail==='preflight_403'){assert.equal(result.stage,'writer_check');assert.equal(result.operation,'gh_runs');assert.equal(result.reason,'github_request_failed');assert.equal(result.http_status,403);assert.equal(result.writes,0);}
    else if(fail==='namespace'){assert.equal(result.phase,'preflight');assert.deepEqual(seen.effects,[]);}
    else if(fail){assert.equal(result.outcome,'unknown_requires_readback');assert.equal(result.retry,false);assert.equal(seen.effects.at(-1),fail.replace('_id',''));}
    assert.ok(!child.stdout.includes('service|tqqq_growth_income|live|')); // no target or token in receipts
  }
  console.log('IBKR daily transport: synthetic preflight, success and uncertain-write cases passed');
} finally {rmSync(dir,{recursive:true,force:true});}
