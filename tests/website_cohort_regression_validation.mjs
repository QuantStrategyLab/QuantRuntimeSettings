import assert from 'node:assert/strict';
import { performanceBlocks, dailyChanges } from '../web/strategy-switch-console/application/console_api/performance.js';
import { aggregateEquityHistory } from '../web/strategy-switch-console/application/console_api/equity_history.js';
import { applyNativeDailyReturns } from '../web/strategy-switch-console/application/console_api/native_daily_returns.js';
const points = [1, 2].map((day, i) => ({date: `2026-10-0${day}`, value: 100 + i * 10, externalFlow: 0}));
const input = {accounts: [{platform:'ibkr',account_key:'synthetic-a'}, {platform:'ibkr',account_key:'synthetic-b'}],
  histories:[{id:'synthetic-a',currency:'USD',points},{id:'synthetic-b',currency:'USD',points:[]}],
  range:'ALL',today:'2026-10-02',year:2026,month:10,benchmarks:[],failed:[]};
const incomplete=performanceBlocks(input);
assert.equal(incomplete.summary.twr_return_percent,null,'a member with no history cannot disappear from a portfolio return');
assert.equal(incomplete.summary.max_drawdown.percent,null);
assert.equal(incomplete.summary.per_currency[0].max_drawdown.percent,null);
assert.equal(incomplete.summary.simple_weighted_return_percent,null);
assert.equal(incomplete.summary.coverage.cashflows,"unknown");
assert.equal(incomplete.summary.amount,null,'the known member subtotal is not portfolio profit');
assert.equal(incomplete.summary.best_day,null);
assert.equal(incomplete.calendar.cells.find(cell=>cell.date==='2026-10-02').return_percent,null);
const failed=performanceBlocks({...input,histories:input.histories.slice(0,1),failed:['synthetic-b']});
assert.equal(failed.summary.twr_return_percent,null,'a failed account read cannot yield a subset portfolio TWR');
assert.deepEqual(failed.returns.points,[]);
assert.equal(failed.summary.per_currency[0].max_drawdown.percent,null);
const boundary=dailyChanges([points[0],{...points[1],breakBefore:true}])[1];
assert.equal(boundary.amount,null,'a declared source/cohort break is not a daily gain');
assert.equal(boundary.return_percent,null);
assert.equal(boundary.unavailable_reason,'snapshot_history_missing');
const partial=dailyChanges([points[0],{...points[1],partial:true}])[1];
assert.equal(partial.return_percent,null,'a partial valuation is not a qualified daily return');
// Existing cohort boundaries must prevent a misleading line when a member is lost/rejoins.
const cohort=aggregateEquityHistory([
 {id:'synthetic-a',currency:'USDT',crypto:true,points:[{date:'2026-10-01',value:100},{date:'2026-10-06',value:100}]},
 {id:'synthetic-b',currency:'USDT',crypto:true,points:[1,2,3,4,5,6].map(day=>({date:`2026-10-0${day}`,value:10}))},
], 'USDT');
assert.equal(cohort.points.find(p=>p.date==='2026-10-05').value,10);
assert.equal(cohort.points.find(p=>p.date==='2026-10-05').breakBefore,true,'loss of a stale member must not be connected as a loss');
assert.equal(cohort.points.find(p=>p.date==='2026-10-06').breakBefore,true,'the return of a member must not be connected as a gain');
assert.ok(cohort.points.filter(p=>p.forward_filled_accounts.length).every(p=>p.partial&&p.externalFlow===null));
const weekendBoundary=dailyChanges([{date:'2026-10-02',value:100,externalFlow:0},
 {date:'2026-10-03',value:100,externalFlow:0,breakBefore:true},
 {date:'2026-10-05',value:110,externalFlow:0}]).at(-1);
assert.equal(weekendBoundary.return_percent,null,'a source break on the weekend also invalidates the next daily interval');
const native = date => ({status:'available',method:'native_ibkr_twr',source:'ChangeInNAV.twr',unit:'ratio',currency:'USD',period:{from:date,to:date},value:'0.01'});
const nativeInput={...input,accounts:[{...input.accounts[0],return:{daily:points.map(p=>native(p.date))}},input.accounts[1]]};
const output=applyNativeDailyReturns(performanceBlocks(nativeInput),nativeInput);
assert.equal(output.summary.twr_return_percent,null,'one qualified native account does not qualify the portfolio');
assert.deepEqual(output.returns.points,[]);
assert.equal(output.summary.per_account.length,1,'an unrelated missing source cannot hide qualified single-account returns');
assert.equal(output.summary.per_account[0].account_alias,'synthetic-a');
assert.ok(Math.abs(output.summary.per_account[0].twr_return_percent-2.01)<1e-10);
assert.equal(output.returns.per_account[0].points.length,2);
assert.equal(output.calendar.per_account[0].cells.find(cell=>cell.date==='2026-10-02').return_percent,1);
const multiNative={...nativeInput,accounts:nativeInput.accounts.map(a=>({...a,return:nativeInput.accounts[0].return}))};
const independent=applyNativeDailyReturns(performanceBlocks(multiNative),multiNative);
assert.equal(independent.summary.per_account.length,2);
assert.equal(independent.summary.twr_return_percent,null,'two native percentages cannot be averaged into a portfolio');
const paper={...nativeInput,accounts:[{...nativeInput.accounts[0],broker_environment:'paper'},nativeInput.accounts[1]]};
assert.equal(applyNativeDailyReturns(performanceBlocks(paper),paper).returns.per_account,undefined,'paper returns cannot be offered as real-account coverage');
console.log('website_cohort_regression_validation: PASS (missing members, read failures, explicit boundaries, unchanged cohort gaps, independent native accounts)');
