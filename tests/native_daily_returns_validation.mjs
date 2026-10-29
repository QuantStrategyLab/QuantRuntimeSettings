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
assert.equal(gap.summary.twr_return_percent,null);
assert.equal(gap.summary.max_drawdown.percent,null);
assert.equal(gap.returns.coverage.native_daily_only,true);
assert.deepEqual(gap.returns.points.map(p=>({date:p.date,value:p.value,daily_return_percent:p.daily_return_percent,breakBefore:p.breakBefore})),[
 {date:'2026-10-20',value:10,daily_return_percent:10,breakBefore:false},
 {date:'2026-10-23',value:10,daily_return_percent:10,breakBefore:true},
]);
assert.deepEqual(gap.returns.benchmarks,[]);
const portfolioInput={...missing,accounts:[missing.accounts[0],{platform:'ibkr',account_key:'other-synthetic',return:{daily:[row('2026-10-22','0.01'),row('2026-10-23','0.02')]}}]};
const portfolio=applyNativeDailyReturns(performanceBlocks(portfolioInput),portfolioInput);
const gapAccount=portfolio.returns.per_account.find(account=>account.account_alias==='synthetic-account');
assert.equal(gapAccount.coverage.native_daily_only,true);
assert.equal(gapAccount.points[1].breakBefore,true);
assert.equal(portfolio.summary.twr_return_percent,null,'native account returns are not averaged into a portfolio');

// A missing weekday separates real observations; no 10/26 point is invented.
const observedDays=['2026-10-01','2026-10-02','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-27'];
for (const range of ['ALL','YTD']) {
 const x={...input,range,today:'2026-10-28',accounts:[{...input.accounts[0],return:{daily:observedDays.map(day=>row(day,'0.001'))}}]};
 const r=applyNativeDailyReturns(performanceBlocks(x),x);
 assert.equal(r.summary.twr_return_percent,null);
 assert.equal(r.summary.max_drawdown.percent,null);
 assert.equal(r.returns.coverage.native_daily_only,true);
 assert.deepEqual(r.returns.points.map(point=>point.date),observedDays);
 assert.equal(r.returns.points.at(-1).breakBefore,true);
 assert.equal(r.returns.points.at(-1).daily_return_percent,0.1);
 assert.deepEqual(r.returns.benchmarks,[]);
}

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

// Future sessions are not missing snapshots. Calendar shape stays complete,
// while future and past missing days both keep their values unknown.
const futureCalendar=applyNativeDailyReturns(performanceBlocks(input),input).calendar;
const futureDay=futureCalendar.cells.find(c=>c.date==='2026-10-26');
assert.equal(futureDay.unavailable_reason,'future_date');
assert.equal(futureDay.amount,null);assert.equal(futureDay.return_percent,null);
assert.equal(futureCalendar.cells.find(c=>c.date==='2026-10-21').unavailable_reason,'snapshot_missing',
  'unobserved historical weekdays remain a real gap');
const futureMonths=yearCalendar.cells.filter(c=>c.month>'2026-10');
assert.equal(futureMonths.length,2);
assert.ok(futureMonths.every(c=>c.unavailable_reason==='future_date'&&c.return_percent===null&&c.amount===null));
const noSnapshots=performanceBlocks({...input,histories:[],today:'2026-10-24'}).calendar;
assert.equal(noSnapshots.cells.find(c=>c.date==='2026-10-26').unavailable_reason,'future_date',
  'future classification does not depend on having native returns');

// Native NAV reconciliation is independent of the TWR percentage. A deposit
// changes assets but is not a gain; money must be known for every summed day.
const moneyRow=(date,value,amount)=>({...row(date,value),nav_change:{method:'ibkr_nav_reconciliation',source:'ChangeInNAV',amount}});
const moneyInput={...input,accounts:[{...input.accounts[0],return:{daily:[
  moneyRow('2026-10-22','0.1','0.1'),moneyRow('2026-10-23','-0.05','0.2')]}}]};
const money=applyNativeDailyReturns(performanceBlocks(moneyInput),moneyInput);
assert.equal(money.summary.amount,0.3,'decimal sums are exact before display conversion');
assert.equal(money.summary.twr_return_percent,native.summary.twr_return_percent);
assert.equal(money.calendar.cells.find(c=>c.date==='2026-10-23').amount,0.2);
assert.equal(money.summary.worst_day.amount,0.2,'money is not inferred from the sign or magnitude of TWR');
assert.equal(money.returns.coverage.native_amount_method,'ibkr_nav_reconciliation');
assert.deepEqual(money.assets,raw.assets,'account balance charts retain deposits');
const missingMoney={...moneyInput,accounts:[{...input.accounts[0],return:{daily:[
  moneyRow('2026-10-22','0.1','0.1'),row('2026-10-23','-0.05')]}}]};
const missingMoneyBlocks=applyNativeDailyReturns(performanceBlocks(missingMoney),missingMoney);
assert.equal(missingMoneyBlocks.summary.amount,null);
assert.equal(missingMoneyBlocks.summary.twr_return_percent,native.summary.twr_return_percent);
assert.equal(missingMoneyBlocks.calendar.cells.find(c=>c.date==='2026-10-22').amount,0.1);
assert.equal(missingMoneyBlocks.calendar.cells.find(c=>c.date==='2026-10-23').amount,null);
assert.equal(applyNativeDailyReturns(performanceBlocks({...moneyInput,range:'1M'}),{...moneyInput,range:'1M'}).summary.amount,null,'incomplete range does not claim a full monetary result');
const yearMoneyInput={...yearInput,accounts:[{...input.accounts[0],return:{daily:[
  moneyRow('2026-10-01','0.1','10'),moneyRow('2026-10-02','-0.05','-5'),moneyRow('2026-10-05','0.02','2')]}}]};
const yearMoney=applyNativeDailyReturns(performanceBlocks(yearMoneyInput),yearMoneyInput).calendar;
assert.equal(yearMoney.cells.find(c=>c.month==='2026-10').amount,7);
assert.equal(yearMoney.cells.find(c=>c.month==='2026-11').amount,null);
console.log('native NAV money: exact sums, missing money, deposits, independent TWR and calendar PASS');

// A local-calendar date can have begun before the broker's next session. An
// unobserved current day is pending, not an already-missed historical snapshot.
const beforeSessionInput = {...input, today:'2026-10-26'};
const pendingDay = applyNativeDailyReturns(performanceBlocks(beforeSessionInput), beforeSessionInput).calendar.cells.find(c=>c.date==='2026-10-26');
assert.equal(pendingDay.unavailable_reason,'snapshot_pending');
assert.equal(pendingDay.status,'no_data');
assert.equal(pendingDay.amount,null); assert.equal(pendingDay.return_percent,null);
const beforeSessionCalendar = performanceBlocks(beforeSessionInput).calendar;
assert.equal(beforeSessionCalendar.cells.find(c=>c.date==='2026-10-21').unavailable_reason,'snapshot_missing','past gaps stay real gaps');
assert.equal(beforeSessionCalendar.cells.find(c=>c.date==='2026-10-27').unavailable_reason,'future_date');
const observedTodayInput = {...moneyInput,today:'2026-10-23'};
assert.equal(applyNativeDailyReturns(performanceBlocks(observedTodayInput),observedTodayInput).calendar.cells.find(c=>c.date==='2026-10-23').amount,0.2,'actual current-day money overrides the pending placeholder');
console.log('native_daily_returns_current_day_pending: PASS');

// A YTD query is not complete just because its late-year observed window is.
// Native daily money remains usable even when a whole-year KPI is withheld.
const shortYtdInput={...moneyInput,range:'YTD',today:'2026-10-26'};
const shortYtd=applyNativeDailyReturns(performanceBlocks(shortYtdInput),shortYtdInput);
assert.equal(shortYtd.summary.coverage.range_complete,false);
assert.equal(shortYtd.summary.twr_return_percent,null);
assert.equal(shortYtd.summary.amount,null);
assert.equal(shortYtd.summary.coverage.requested_period_from,'2026-01-01');
const knownYtdDay=shortYtd.calendar.cells.find(c=>c.date==='2026-10-23');
assert.equal(knownYtdDay.amount,0.2,'daily NAV money is not withheld with the incomplete YTD aggregate');
assert.equal(knownYtdDay.observed_amount,null,'legacy asset-change subtotal is not a second NAV profit field');
assert.equal(shortYtdInput.accounts[0].return.daily[0].method,'native_ibkr_twr','TWR and NAV reconciliation retain different method identities');
console.log('native_daily_returns_short_ytd: PASS');

// Native returns must compare against their own opening boundary, independently
// of cash snapshots. Prices before the selected range are needed for day one.
const nativeDates=[];
for(let time=Date.parse('2026-09-25T00:00:00Z');time<=Date.parse('2026-10-23T00:00:00Z');time+=86400000){
  if(![0,6].includes(new Date(time).getUTCDay()))nativeDates.push(new Date(time).toISOString().slice(0,10));
}
const benchmarkIds=['标普500','纳斯达克100','道琼斯工业平均指数','罗素2000'];
const benchmarkPrices=benchmarkIds.map(id=>({id,points:['2026-09-24',...nativeDates]
  .map((date,i)=>({date,value:100+i}))}));
const benchmarkInput={...input,today:'2026-10-26',accounts:[{...input.accounts[0],return:{daily:
  nativeDates.map(date=>row(date,'0.001'))}}],benchmarks:benchmarkPrices};
const withoutBenchmarks=applyNativeDailyReturns(performanceBlocks({...benchmarkInput,benchmarks:[]}),
  {...benchmarkInput,benchmarks:[]});
const calculateBenchmarks=patch=>{
  const changed={...benchmarkInput,...patch};
  return applyNativeDailyReturns(performanceBlocks(changed),changed);
};
for(const points of [[{date:'2026-10-26',value:100,externalFlow:null}],
  nativeDates.map((date,i)=>({date,value:100+i,externalFlow:0}))]){
  const compared=calculateBenchmarks({histories:[{id:'synthetic-account',currency:'USD',points}]});
  assert.equal(compared.returns.benchmarks.length,4,'cash history cannot discard qualified native-window benchmark prices');
  assert.deepEqual(compared.returns.points,withoutBenchmarks.returns.points,'keep all 21 native points and the original first-day return');
  assert.equal(compared.summary.twr_return_percent,withoutBenchmarks.summary.twr_return_percent);
  assert.equal(compared.returns.no_common_date,false);
  assert.ok(compared.returns.benchmark_availability.every(item=>item.status==='ok'&&item.unavailable_reason===null));
  assert.deepEqual(compared.summary.excess_returns.map(item=>item.benchmark),benchmarkIds);
  for(const excess of compared.summary.excess_returns){
    assert.equal(excess.start,nativeDates[0]);
    assert.equal(excess.end,nativeDates.at(-1));
    assert.equal(excess.unavailable_reason,null);
    assert.ok(Math.abs(excess.percentage_points-((1.001**21-1)*100-21))<1e-10,
      'excess return includes the first native day and the matching preceding-close benchmark boundary');
  }
  for(const comparison of compared.returns.benchmarks){
    assert.deepEqual(comparison.points.map(point=>point.date),nativeDates);
    assert.ok(Math.abs(comparison.points[0].value-1)<1e-10,'day one uses the actual preceding close, not a rebased zero');
    assert.ok(Math.abs(comparison.points.at(-1).value-21)<1e-10);
    assert.ok(Math.abs(comparison.points[0].daily_return_percent-1)<1e-10);
  }
}
assert.equal(nativeDates.length,21);

const unavailableBenchmarks=(points,reason)=>{
  const compared=calculateBenchmarks({benchmarks:[{id:benchmarkIds[0],points}]});
  assert.deepEqual(compared.returns.benchmarks,[]);
  assert.deepEqual(compared.summary.excess_returns,[],'invalid benchmarks cannot create excess-return results');
  assert.deepEqual(compared.returns.points,withoutBenchmarks.returns.points);
  assert.equal(compared.returns.no_common_date,false,'benchmark failure must not hide the native curve');
  assert.equal(compared.returns.benchmark_availability[0].status,'unavailable');
  assert.equal(compared.returns.benchmark_availability[0].unavailable_reason,reason);
};
unavailableBenchmarks([],'benchmark_history_missing');
unavailableBenchmarks([{date:'2026-08-31',value:100}],'no_common_date');
unavailableBenchmarks(benchmarkPrices[0].points.slice(1),'benchmark_history_missing');
unavailableBenchmarks(benchmarkPrices[0].points.filter(point=>point.date>='2026-10-09'),'benchmark_history_missing');
unavailableBenchmarks([{date:'2026-09-21',value:100},...benchmarkPrices[0].points.slice(1)],'benchmark_history_missing');
unavailableBenchmarks(benchmarkPrices[0].points.map(point=>point.date==='2026-09-24'?{...point,value:0}:point),'benchmark_history_missing');
unavailableBenchmarks(benchmarkPrices[0].points.map(point=>point.date==='2026-10-09'?{...point,breakBefore:true}:point),'benchmark_history_missing');
unavailableBenchmarks(benchmarkPrices[0].points.map(point=>point.date==='2026-09-25'?{...point,breakBefore:true}:point),'benchmark_history_missing');
unavailableBenchmarks([{date:'2026-09-21',value:100},...benchmarkPrices[0].points.slice(1)
  .map(point=>({...point,breakBefore:false}))],'benchmark_history_missing');

const missingOnePrice=calculateBenchmarks({benchmarks:[{...benchmarkPrices[0],points:benchmarkPrices[0].points
  .filter(point=>point.date!=='2026-10-09')},...benchmarkPrices.slice(1)]});
assert.deepEqual(missingOnePrice.returns.benchmarks.map(item=>item.id),benchmarkIds.slice(1),'a missing comparison does not suppress independent qualified series');
assert.equal(missingOnePrice.returns.benchmark_availability[0].unavailable_reason,'benchmark_history_missing');
assert.deepEqual(missingOnePrice.returns.points,withoutBenchmarks.returns.points);
assert.deepEqual(missingOnePrice.summary.excess_returns.map(item=>item.benchmark),benchmarkIds.slice(1));

const mondayNative={...benchmarkInput,range:'1M',today:'2026-10-28',accounts:[{...input.accounts[0],return:{daily:[row('2026-09-28','0.1')]}}],
  benchmarks:[{id:benchmarkIds[0],points:[{date:'2026-09-25',value:100},{date:'2026-09-28',value:102}]}]};
const mondayComparison=applyNativeDailyReturns(performanceBlocks(mondayNative),mondayNative);
assert.equal(mondayComparison.returns.benchmarks.length,1,'a real Friday close remains valid across the weekend, even before the requested range');
assert.ok(Math.abs(mondayComparison.returns.benchmarks[0].points[0].value-2)<1e-10);
assert.ok(Math.abs(mondayComparison.returns.points[0].value-10)<1e-10);
assert.equal(mondayComparison.summary.excess_returns[0].start,'2026-09-28');
assert.equal(mondayComparison.summary.excess_returns[0].end,'2026-09-28');
assert.equal(mondayComparison.summary.excess_returns[0].unavailable_reason,null);
assert.ok(Math.abs(mondayComparison.summary.excess_returns[0].percentage_points-8)<1e-10,
  '10% native first-day return minus 2% benchmark first-day return is 8 percentage points');

const incompleteYtd=calculateBenchmarks({range:'YTD'});
assert.equal(incompleteYtd.summary.coverage.range_complete,false);
assert.equal(incompleteYtd.summary.twr_return_percent,null);
assert.deepEqual(incompleteYtd.summary.excess_returns.map(item=>item.benchmark),benchmarkIds);
assert.ok(incompleteYtd.summary.excess_returns.every(item=>item.percentage_points===null
  &&item.unavailable_reason==='snapshot_history_missing'),'an incomplete YTD cannot supply observed-window excess as a full-year metric');

const missingNativeDay=calculateBenchmarks({accounts:[{...input.accounts[0],return:{daily:
  nativeDates.filter(date=>date!=='2026-10-09').map(date=>row(date,'0.001'))}}]});
assert.equal(missingNativeDay.summary.twr_return_percent,null);
assert.equal(missingNativeDay.returns.coverage.native_daily_only,true);
assert.equal(missingNativeDay.returns.points.length,nativeDates.length-1);
assert.equal(missingNativeDay.returns.points.find(point=>point.date==='2026-10-12').breakBefore,true);
assert.equal(missingNativeDay.returns.points.some(point=>point.date==='2026-10-09'),false);
assert.deepEqual(missingNativeDay.returns.benchmarks,[],'benchmark prices cannot fill a missing native return');
assert.deepEqual(missingNativeDay.summary.excess_returns,[]);
assert.ok(missingNativeDay.returns.benchmark_availability.every(item=>item.unavailable_reason==='snapshot_history_missing'));
const staleBenchmarks=calculateBenchmarks({today:'2026-10-27'}).returns.benchmark_availability;
assert.ok(staleBenchmarks.every(item=>item.status==='stale'&&item.as_of==='2026-10-23'));
console.log('native_daily_returns_benchmarks: PASS (native dates, prior close, first day, independent series, missing boundaries/prices, explicit breaks and gaps)');
