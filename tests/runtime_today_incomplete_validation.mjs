import assert from 'node:assert/strict';
import { runStatus } from '../web/strategy-switch-console/application/console_api/run_status.js';
import { todaySummary } from '../web/strategy-switch-console/application/console_api/operations.js';
const now=Date.parse('2026-10-16T18:00:00Z');
const account={platform:'ibkr',key:'synthetic'};
const binding={platform:'ibkr',account_key:'synthetic',target_key:'synthetic-target',status:'bound'};
const date='2026-10-16';
const base={platform:'ibkr',account_key:'synthetic',date,data_status:'fresh',unmatched_count:0,
 record:{business_date:date,target_key:binding.target_key,observed_at:new Date(now).toISOString(),completeness:'incomplete',status:'read_incomplete',conflict_count:0,
 runs:[{run_id:'one',activity:'unknown',errors_present:false},{run_id:'two',activity:'no_rebalance',errors_present:false}]}};
async function check(extra,expected){
 const body={...base,...extra}; const result=await todaySummary(new Request('https://synthetic.invalid/api/runtime/today'),{},
  {dailyBindings:async()=>[binding],daily:async()=>Response.json(body)},[account],now);
 assert.equal(result.accounts[0].run_status,expected);
 assert.equal(result.accounts[0].run_count,2);assert.equal(result.counts.runs,null);
 assert.equal(result.counts.by_state[expected],1);
 return result.accounts[0];
}
let row=await check({read_error_count:1,read_error_codes:['coverage_unconfirmed']},'incomplete');
assert.deepEqual(row.read_error_codes,['coverage_unconfirmed']);
for(const code of ['report_read_error','read_failed','list_failed','source_read_error']) await check({read_error_count:1,read_error_codes:[code]},'read_failed');
for(const code of ['read_truncated','listing_truncated','report_rejected','schedule_unverified','target_disabled']) await check({read_error_count:1,read_error_codes:[code]},'incomplete');
await check({read_error_count:2,read_error_codes:['target_disabled','read_failed']},'read_failed');
for(const extra of [{},{read_error_count:2,read_error_codes:['coverage_unconfirmed']},{read_error_count:1,read_error_codes:['private-error-sentinel']},{read_error_count:0,read_error_codes:[]}]) {
 row=await check(extra,'unknown'); assert.deepEqual(row.read_error_codes,extra.read_error_count===0?[]:null);assert.ok(!JSON.stringify(row).includes('private-error-sentinel'));
}
for(const state of ['failed','blocked']) {row=await check({read_error_count:1,read_error_codes:['target_disabled'],record:{...base.record,status:state}},state);}
assert.equal(runStatus({status:'partial',activity:'read_incomplete',runs:[],read_error_count:2,
 read_error_codes:['list_failed','unrecognized']}),'unknown','an unknown code makes mixed diagnostics unknown');
console.log('runtime today incomplete: coverage, read failures, unknown and execution priority passed');
