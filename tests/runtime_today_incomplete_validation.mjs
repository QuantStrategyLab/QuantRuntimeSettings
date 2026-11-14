import assert from 'node:assert/strict';
import { runStatus } from '../web/strategy-switch-console/application/console_api/run_status.js';
import { todaySummary } from '../web/strategy-switch-console/application/console_api/operations.js';
import { lastRun, runsToday } from '../web/strategy-switch-console/application/desk/overview.js';
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

// The reader's completeness decision is preserved, never rebuilt into a weaker one.
const complete={...base,read_error_count:0,read_error_codes:[],
 record:{...base.record,completeness:'complete',status:'no_rebalance',kind:'run',runs:[{run_id:'one',started_at:'2026-10-16T14:31:00Z',finished_at:'2026-10-16T14:32:00Z',activity:'no_rebalance',errors_present:false}],
  schedule:{state:'not_due',business_date:date,timezone:'America/New_York',latest_due_at:null,next_due_at:'2026-10-16T19:55:00Z',grace_ends_at:null,publication_grace_ended:null,expected_window:'unspecified'}}};
async function summarise(body,options){
 return todaySummary(new Request('https://synthetic.invalid/api/runtime/today'),{},
  {dailyBindings:async()=>[binding],daily:async()=>Response.json(body)},[account],now,options);
}
const summaryOf=(status,observed=1)=>({source:'stored_runtime_daily_projection',status,reason:status==='complete'?null:'runtime_daily_incomplete',observed_run_count:observed,total_run_count:status==='complete'?observed:null});
const target=[{platform:'ibkr',key:'synthetic'}];
// Accepted projection, outer read incomplete, record complete: never complete here.
let summary=await summarise({...complete,read_summary:summaryOf('partial')});
assert.deepEqual([summary.accounts[0].status,summary.accounts[0].completeness,summary.counts.runs],['partial','incomplete',null]);
let last=lastRun(summary,summary.accounts[0],now);
assert.equal(last.status,'partial','an outer-incomplete record is a verified subset, never a complete read');
assert.notDeepEqual([last.status,last.value],['known',null],'never a known-null last run');
assert.notEqual(runsToday({targets:target,summary,businessDate:date,now}).coverage.included,1,'never a covered count');
// Same, without a finished run: unknown coverage gap, never "no run" or a covered zero.
summary=await summarise({...complete,record:{...complete.record,runs:[]},read_summary:summaryOf('partial',0)});
last=lastRun(summary,summary.accounts[0],now);
assert.deepEqual([last.status,last.reason],['unknown','coverage_incomplete']);
const zero=runsToday({targets:target,summary,businessDate:date,now});
assert.deepEqual([zero.status,zero.reason],['unknown','coverage_incomplete'],'no covered zero runs');
// Any non-complete or malformed reader summary stays incomplete.
for(const read_summary of [summaryOf('no_data'),summaryOf('read_failed'),null,{status:'COMPLETE'}]) {
 summary=await summarise({...complete,read_summary});
 assert.equal(summary.accounts[0].completeness,'incomplete',`read_summary ${JSON.stringify(read_summary)}`);
}
// Complete reader decision and complete record: complete, a real (known) count.
summary=await summarise({...complete,read_summary:summaryOf('complete')});
assert.deepEqual([summary.accounts[0].status,summary.accounts[0].completeness,summary.counts.runs],['ok','complete',1]);
assert.equal(lastRun(summary,summary.accounts[0],now).status,'known');
summary=await summarise({...complete,record:{...complete.record,runs:[]},read_summary:summaryOf('complete',0)});
last=lastRun(summary,summary.accounts[0],now);
assert.deepEqual([last.status,last.value],['known',null],'only a complete reader decision is a verified empty day');
// Legacy bodies without read_summary keep working; the record's own incomplete kind/status still counts.
assert.equal((await summarise(complete)).accounts[0].completeness,'complete','legacy complete body unchanged');
for(const record of [{...complete.record,kind:'incomplete'},{...complete.record,status:'read_incomplete'},{...complete.record,status:'missing_report'}])
 assert.equal((await summarise({...complete,record})).accounts[0].completeness,'incomplete');
// Stale and fresh partials keep their status.
summary=await summarise({...complete,data_status:'stale',read_summary:summaryOf('partial')});
assert.deepEqual([summary.accounts[0].status,summary.accounts[0].completeness],['stale','incomplete']);

// Schedule projection: explicit opt-in only. By default the output shape is unchanged and
// carries no schedule key; values follow the approved completeness and chronological
// corrections, which intentionally changed values that were wrong before.
summary=await summarise({...complete,read_summary:summaryOf('complete')});
assert.equal('schedule' in summary.accounts[0],false,'no schedule field without the opt-in');
const defaultKeys=Object.keys(summary.accounts[0]).sort();
summary=await summarise({...complete,read_summary:summaryOf('complete')},{schedule:true});
assert.deepEqual(Object.keys(summary.accounts[0]).filter(key=>key!=='schedule').sort(),defaultKeys,'the opt-in adds only the schedule key');
assert.deepEqual(summary.accounts[0].schedule,{state:'not_due',business_date:date,timezone:'America/New_York',next_due_at:'2026-10-16T19:55:00Z'});
assert.equal(JSON.stringify(summary.accounts[0].schedule).includes('latest_due_at'),false,'only the fields the projection needs');
summary=await summarise({...complete,record:{...complete.record,schedule:null}},{schedule:true});
assert.equal(summary.accounts[0].schedule,null,'a missing schedule is null, not invented');
let reads=0;
const counted=await todaySummary(new Request('https://synthetic.invalid/api/runtime/today'),{},
 {dailyBindings:async()=>[binding],daily:async()=>{reads+=1;return Response.json({...complete,read_summary:summaryOf('complete')});}},[account],now,{schedule:true});
assert.equal(reads,1,'the opt-in makes no additional storage read');
assert.equal(counted.accounts[0].schedule.next_due_at,'2026-10-16T19:55:00Z');
const missing=await todaySummary(new Request('https://synthetic.invalid/api/runtime/today'),{},
 {dailyBindings:async()=>[],daily:async()=>{throw Error('unreachable');}},[account],now,{schedule:true});
assert.equal(missing.accounts[0].schedule,null,'an unbound account carries no schedule');

// Summary as_of is the chronologically oldest raw observed_at: "14:00:00.500Z" is after "14:00:00Z" though it sorts first as a string.
async function oldestOf(times){
 const keys=times.map((_,i)=>`synthetic-${i}`);
 const bindings=keys.map(key=>({...binding,account_key:key}));
 const result=await todaySummary(new Request('https://synthetic.invalid/api/runtime/today'),{},
  {dailyBindings:async()=>bindings,daily:async req=>{const key=new URL(req.url).searchParams.get('account_key');
   return Response.json({...complete,account_key:key,read_summary:summaryOf('complete'),record:{...complete.record,observed_at:times[keys.indexOf(key)]}});}},
  keys.map(key=>({platform:'ibkr',key})),now);
 assert.deepEqual(result.accounts.map(r=>r.as_of),times,'rows keep their own raw observed_at');
 return result.as_of;
}
assert.equal(await oldestOf(['2026-10-16T14:00:00.500Z','2026-10-16T14:00:00Z']),'2026-10-16T14:00:00Z','the whole second precedes its own fraction');
assert.equal(await oldestOf(['2026-10-16T14:00:00Z','2026-10-16T14:00:00.500Z']),'2026-10-16T14:00:00Z','independent of row order');
assert.equal(await oldestOf(['2026-10-16T14:00:00.001000000Z','2026-10-16T14:00:00Z']),'2026-10-16T14:00:00Z','nine fractional digits order by time');
// Epochs resolve to milliseconds, as the reader's own check does: a sub-millisecond difference is a tie.
assert.equal(await oldestOf(['2026-10-16T14:00:00Z','2026-10-16T14:00:00.000000001Z']),'2026-10-16T14:00:00.000000001Z','a sub-millisecond tie keeps the legacy string pick');
assert.equal(await oldestOf(['2026-10-16T10:00:00.250-04:00','2026-10-16T13:30:00Z']),'2026-10-16T13:30:00Z','an offset instant orders by its UTC time');
for(const times of [['2026-10-16T14:00:00Z','2026-10-16T14:00:00.000Z'],['2026-10-16T14:00:00.000Z','2026-10-16T10:00:00-04:00']])
 assert.equal(await oldestOf(times),[...times].sort()[0],'an exact instant tie keeps the legacy string pick');
assert.equal(await oldestOf(['2026-10-16T14:00:00.500Z']),'2026-10-16T14:00:00.500Z','a single row is its own oldest');
assert.equal((await summarise({...complete,record:null})).as_of,null,'no observation is null, never invented');
assert.equal(await oldestOf(['2026-10-16T14:00:00.500Z','2026-10-16T14:00:00Z','not-a-time']),'2026-10-16T14:00:00.500Z','an unparseable value keeps the legacy string pick');

console.log('runtime today incomplete: coverage, read failures, unknown, execution priority, reader completeness, schedule opt-in and chronological as_of passed');
