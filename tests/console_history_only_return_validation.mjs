import assert from 'node:assert/strict';
import { performanceResponse } from '../web/strategy-switch-console/application/console_api/performance_routes.js';
const start='2026-10-26T12:00:00.000Z',end='2026-10-27T12:00:00.000Z';
const flow={schema_version:'external_flow.v1',windows:[{currency:'USD',date:'2026-10-27',period_start:start,period_end:end,source:'schwab_transactions',coverage:'complete',records:[]}]};
const make = async (balances, {includeFlow=true, identityMismatch=false, historyFailure=false, incompleteFlow=false}={}) => {
 const fact={platform:'schwab',account_key:'synthetic',binding_status:'bound',identity_status:'partial_identity',identity_mismatch:identityMismatch,aggregation_status:'included',data_status:'fresh',broker_environment:'live',account_scope:'live',balances,cash:[]};
 const deps={json:(body,status=200)=>Response.json(body,{status}),readSession:async()=>({allowed:true}),accountOptions:async()=>({options:{schwab:[{key:'synthetic'}]}}),facts:async()=>Response.json({accounts:[fact]}),benchmarks:async()=>Response.json({points:[]}),history:async request=>{if(historyFailure) return new Response(null,{status:503});const q=new URL(request.url).searchParams;if(q.get('projection')==='currencies') return Response.json({ok:true,platform:'schwab',account_key:'synthetic',projection:'currencies',currencies:['USD']});return Response.json({ok:true,platform:'schwab',account_key:'synthetic',identity_mismatch:false,currencies:['USD'],externalFlow:includeFlow ? (incompleteFlow ? {...flow,windows:flow.windows.map(window=>({...window,coverage:'incomplete'}))} : flow) : null,series:{currency:'USD',points:[{currency:'USD',observation_date:'2026-10-26',net_assets:'100',observed_finished_at:start},{currency:'USD',observation_date:'2026-10-27',net_assets:'110',observed_finished_at:end}]}})}};
 const r=await performanceResponse(new Request('https://console.example/api/performance/summary?scope=synthetic&range=ALL'),{CONSOLE_EXTERNAL_FLOW_ENABLED:'true'},deps); const out=await r.json();return {http:r.status,twr:out.twr_return_percent,reason:out.unavailable_reason};
};
const current = await make([{currency:'USD',net_assets:'110'}]);
const historyOnly = await make([]);
assert.ok(Math.abs(current.twr - 10) < 1e-9);
assert.ok(Math.abs(historyOnly.twr - 10) < 1e-9, 'qualified historical chain does not require a current balance');
assert.equal((await make([], {includeFlow:false})).twr, null, 'missing flow is not zero');
assert.equal((await make([], {identityMismatch:true})).twr, null, 'identity mismatch remains excluded');
assert.equal((await make([], {incompleteFlow:true})).twr, null, 'incomplete flow is not treated as complete');
assert.equal((await make([], {historyFailure:true})).twr, null, 'history read errors remain unknown');
console.log('history-only qualified return: PASS');
