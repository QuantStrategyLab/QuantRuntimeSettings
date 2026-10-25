import assert from 'node:assert/strict';
import {performanceBlocks} from '../web/strategy-switch-console/application/console_api/performance.js';
import {applyNativeDailyReturns} from '../web/strategy-switch-console/application/console_api/native_daily_returns.js';
import {applyCashflowPerformance} from '../web/strategy-switch-console/application/console_api/cashflow_performance.js';
const row=(date,value)=>({status:'available',method:'native_ibkr_twr',source:'ChangeInNAV.twr',unit:'ratio',currency:'USD',period:{from:date,to:date},value});
const input={accounts:[{platform:'ibkr',account_key:'synthetic-account',return:{daily:[row('2026-10-22','0.1'),row('2026-10-23','-0.05')]}}],
 histories:[{id:'synthetic-account',currency:'USD',points:[{date:'2026-10-22',value:100,externalFlow:null},{date:'2026-10-23',value:1100,externalFlow:null}]}],range:'ALL',today:'2026-10-24',year:2026,month:10,failed:[],benchmarks:[]};
const raw=performanceBlocks(input);
assert.deepEqual(raw.returns.points,[], 'an unexplained deposit must not be plotted as a gain');
assert.equal(raw.assets.points.at(-1).value,1100,'asset balance keeps actual capital movements');
const native=applyNativeDailyReturns(structuredClone(raw),input);
assert.ok(Math.abs(native.summary.twr_return_percent-4.5)<1e-10);
assert.ok(Math.abs(native.returns.points[0].value-10)<1e-10,'do not discard first reported daily return');
assert.ok(Math.abs(native.returns.points[1].value-4.5)<1e-10);
assert.deepEqual(native.returns.points.map(p=>p.daily_return_percent),[10,-5], 'daily chart receives original native first-day and subsequent returns');
assert.ok(Math.abs(native.summary.max_drawdown.percent-5)<1e-10);
assert.ok(Math.abs(native.summary.per_currency.find(x=>x.currency==='USD').max_drawdown.percent-5)<1e-10,'rendered currency drawdown follows native return too');
assert.equal(native.summary.amount,null,'native percentage is not money P/L');
assert.equal(native.calendar.cells.find(c=>c.date==='2026-10-23').return_percent,-5);
assert.equal(native.calendar.cells.find(c=>c.date==='2026-10-23').amount,null);
assert.equal(native.calendar.cells.find(c=>c.date==='2026-10-24').unavailable_reason,'non_trading_weekend');
assert.equal(native.returns.return_kind,'twr');
assert.deepEqual(native.assets,raw.assets);
for(const patch of [{accounts:[...input.accounts,...input.accounts]},
 {accounts:[{...input.accounts[0],return:{daily:[{...row('2026-10-23','1'),method:'balance_change'}]}}]}]){
 const changed={...input,...patch};const blocks=performanceBlocks(changed);
 assert.deepEqual(applyNativeDailyReturns(structuredClone(blocks),changed),blocks,'unqualified sources and portfolios are not averaged');
}
const missing={...input,accounts:[{...input.accounts[0],return:{daily:[row('2026-10-20','0.1'),row('2026-10-23','0.1')]}}]};
const gap=applyNativeDailyReturns(performanceBlocks(missing),missing);
assert.equal(gap.summary.twr_return_percent,null);assert.deepEqual(gap.returns.points,[]);
const initialLoss={...input,accounts:[{...input.accounts[0],return:{daily:[row('2026-10-22','-0.1'),row('2026-10-23','0')]}}]};
assert.ok(Math.abs(applyNativeDailyReturns(performanceBlocks(initialLoss),initialLoss).summary.max_drawdown.percent-10)<1e-10,'opening capital participates without a fabricated date');
// Calendar uses the same linked interval return as the displayed approximation.
const flowInput={...input,accounts:[{platform:'ibkr',account_key:'synthetic-account'}],histories:[{id:'synthetic-account',currency:'USD',
 points:[{date:'2026-10-22',value:100,observed_at:'2026-10-22T00:00:00.000Z'},{date:'2026-10-23',value:220,observed_at:'2026-10-23T00:00:00.000Z'}],
 externalFlow:{schema_version:'external_flow.v1',windows:[{currency:'USD',date:'2026-10-23',period_start:'2026-10-22T00:00:00.000Z',period_end:'2026-10-23T00:00:00.000Z',coverage:'complete',source:'ibkr_flex',records:[{source_ref:'a'.repeat(64),type:'deposit',amount:'100',effective_at:'2026-10-22T12:00:00.000Z',settlement_date:null,transfer_ref:null}]}]}}]};
const adjusted=applyCashflowPerformance(performanceBlocks(flowInput),flowInput,{CONSOLE_EXTERNAL_FLOW_ENABLED:'true'});
assert.equal(adjusted.returns.approximate,true);
assert.ok(Math.abs(adjusted.calendar.cells.find(c=>c.date==='2026-10-23').return_percent-adjusted.summary.twr_return_percent)<1e-10,'calendar and curve use the same linked return');
console.log('native_daily_returns_validation: PASS (deposit, native compounding, calendar, first-day return, drawdown, gaps, portfolio exclusion, approximation consistency)');

const partialMonthInput={...input,range:'1M'};
const partialMonth=applyNativeDailyReturns(performanceBlocks(partialMonthInput),partialMonthInput);
assert.equal(partialMonth.summary.twr_return_percent,null,'two available days cannot certify a whole month return');
assert.equal(partialMonth.summary.max_drawdown.percent,null);
assert.equal(partialMonth.returns.points.length,2,'known partial-period observations remain visible');
assert.equal(partialMonth.returns.coverage.range_complete,false);
assert.equal(partialMonth.calendar.cells.find(c=>c.date==='2026-10-23').return_percent,-5);

// The annual calendar compounds the same native daily returns, including the
// opening day; an incomplete month cannot be reported as a full monthly gain.
const yearInput={...input,month:null,today:'2026-10-05',accounts:[{...input.accounts[0],return:{daily:[
  row('2026-10-01','0.1'),row('2026-10-02','-0.05'),row('2026-10-05','0.02')]}}]};
const yearCalendar=applyNativeDailyReturns(performanceBlocks(yearInput),yearInput).calendar;
const october=yearCalendar.cells.find(c=>c.month==='2026-10');
assert.ok(Math.abs(october.return_percent-6.59)<1e-10,'month-to-date native return compounds known trading days');
assert.equal(october.amount,null,'native monthly return cannot invent money P/L');
assert.equal(october.observed_amount,null,'asset changes are not retained as monthly profit');
assert.equal(october.value_kind,'pnl');
assert.equal(october.status,'ok');
assert.deepEqual(october.coverage,{observed_days:3,expected_weekdays:3});
assert.equal(yearCalendar.value_kind,'pnl');
const missingMonth={...yearInput,accounts:[{...input.accounts[0],return:{daily:[
  row('2026-10-02','-0.05'),row('2026-10-05','0.02')]}}]};
const incomplete=applyNativeDailyReturns(performanceBlocks(missingMonth),missingMonth).calendar.cells.find(c=>c.month==='2026-10');
assert.equal(incomplete.return_percent,null);
assert.equal(incomplete.status,'partial');
assert.equal(incomplete.unavailable_reason,'incomplete_month');
