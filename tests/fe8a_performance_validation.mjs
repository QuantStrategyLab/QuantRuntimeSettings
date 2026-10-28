import assert from "node:assert/strict";
import { test } from "node:test";
import { alignReturns, chainReturns, hasGap } from "../web/strategy-switch-console/performance_math.js";
import { performanceBlocks } from "../web/strategy-switch-console/application/console_api/performance.js";
import { applyCashflowPerformance } from "../web/strategy-switch-console/application/console_api/cashflow_performance.js";
import { accountFreshness, currencyTotals } from "../web/strategy-switch-console/application/console_api/performance_snapshots.js";
import { aggregateEquityHistory, equityHistoryCurve } from "../web/strategy-switch-console/application/console_api/equity_history.js";

const now = Date.parse("2026-10-22T12:00:00Z");
const env = { CONSOLE_EXTERNAL_FLOW_ENABLED: "true" };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const dates = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"];
const stamp = date => `${date}T12:00:00.000Z`;
function sourceInput() {
  return {
    now, accounts: [{ platform: "schwab", account_key: "synthetic" }],
    histories: [{ id: "synthetic", currency: "USD",
      points: dates.map((date, index) => ({ date, value: [100, 110, 210, 168][index], observed_at: stamp(date), externalFlow: null })),
      externalFlow: { schema_version: "external_flow.v1", windows: dates.slice(1).map((date, index) => ({
        currency: "USD", date, period_start: stamp(dates[index]), period_end: stamp(date), coverage: "complete",
        source: "schwab_transactions", records: index === 0 ? [] : [{
          source_ref: String(index).repeat(64), type: index === 1 ? "deposit" : "withdrawal",
          amount: index === 1 ? "100" : "-42", effective_at: stamp(date), settlement_date: date, transfer_ref: null,
        }],
      })) },
    }], benchmarks: [{ id: "synthetic-benchmark", points: dates.map((date, index) => ({ date, value: 100 + index })) }],
    failed: [], range: "YTD", today: dates.at(-1), year: 2026, month: 10,
  };
}
const calculate = input => applyCashflowPerformance(performanceBlocks(input), input, env);
function datedInput(days, values, flows) {
  const input = sourceInput();
  input.histories[0].points = days.map((date, index) => ({ date, value: values[index], observed_at: stamp(date), externalFlow: null }));
  input.histories[0].externalFlow.windows = days.slice(1).map((date, index) => ({ currency: "USD", date,
    period_start: stamp(days[index]), period_end: stamp(date), coverage: "complete", source: "schwab_transactions",
    records: flows[index] ? [{ source_ref: String(index + 1).repeat(64),
      type: flows[index] > 0 ? "deposit" : "withdrawal", amount: String(flows[index]),
      effective_at: stamp(date), settlement_date: date, transfer_ref: null }] : [],
  }));
  input.benchmarks = [];
  return input;
}

test("end-of-valuation deposit and withdrawal give exact chained TWR and cash-adjusted daily P/L", () => {
  const input = sourceInput();
  const blocks = calculate(input);
  close(blocks.summary.twr_return_percent, 10);
  close(blocks.summary.amount, 10);
  assert.equal(blocks.summary.value_kind, "pnl");
  assert.equal(blocks.summary.cashflow_method, undefined);
  assert.equal(blocks.summary.approximate, undefined);
  assert.equal(blocks.calendar.status, "ok");
  assert.equal(blocks.calendar.unavailable_reason, null);
  const cells = new Map(blocks.calendar.cells.map(cell => [cell.date, cell]));
  for (const date of dates.slice(2)) {
    close(cells.get(date).amount, 0);
    close(cells.get(date).return_percent, 0);
    assert.equal(cells.get(date).value_kind, "pnl");
  }
  close(cells.get(dates[1]).amount, 10);
  close(cells.get(dates[1]).return_percent, 10);
  assert.equal(blocks.summary.coverage.cashflows, "complete");
  assert.equal(JSON.stringify(blocks).includes('"periods"'), false);
  assert.equal(JSON.stringify(blocks).includes('"net_flow"'), false);
});

test("midperiod flow remains explicitly approximate and calendar uses the linked period return", () => {
  const input = sourceInput();
  input.histories[0].externalFlow.windows[1].records[0].effective_at = "2026-10-21T00:00:00.000Z";
  input.histories[0].points[2].value = 226;
  input.histories[0].points[3].value = 184;
  const blocks = calculate(input);
  close(blocks.summary.twr_return_percent, 21);
  assert.equal(blocks.summary.approximate, true);
  assert.equal(blocks.summary.cashflow_method, "modified_dietz");
  const depositDay = blocks.calendar.cells.find(cell => cell.date === "2026-10-21");
  close(depositDay.amount, 16);
  close(depositDay.return_percent, 10);
});

test("missing cashflow coverage and disabled source never invent a zero flow or qualified TWR", () => {
  const input = sourceInput();
  const baseline = performanceBlocks(input);
  assert.deepEqual(applyCashflowPerformance(structuredClone(baseline), input, {}), baseline);
  input.histories[0].externalFlow.windows[1].coverage = "incomplete";
  const blocks = calculate(input);
  assert.equal(blocks.summary.twr_return_percent, null);
  assert.equal(blocks.summary.unavailable_reason, "external_cashflow_required");
  assert.deepEqual(blocks.calendar, performanceBlocks(input).calendar);
});

test("eight latest known balances remain counted across observation dates; missing values stay excluded", () => {
  const accounts = Array.from({ length: 8 }, (_, index) => ({ platform: "schwab", account_key: `synthetic-${index}`,
    observed_finished_at: stamp("2026-10-22"), observation_date: "2026-10-22", balances: [{ currency: "USD", net_assets: "100" }] }));
  const total = rows => currencyTotals(rows, accountFreshness(rows, now))[0];
  assert.equal(total(accounts).account_count, 8);
  assert.equal(total(accounts).total, 800);
  accounts[7].observation_date = "2026-10-21";
  accounts[7].observed_finished_at = stamp("2026-10-21");
  assert.equal(total(accounts).account_count, 8);
  assert.equal(total(accounts).total, 800);
  assert.equal(total(accounts).status, "ok");
  assert.equal(total(accounts).unavailable_reason, null);
  assert.equal(total(accounts).observation_date, null);
  assert.equal(total(accounts).as_of, stamp("2026-10-21"));
  assert.equal(total(accounts).latest_as_of, stamp("2026-10-22"));
  accounts[7].balances[0].net_assets = null;
  assert.equal(total(accounts).account_count, 7);
  assert.equal(total(accounts).expected_account_count, 8);
});

test("Friday to Monday connects without fabricated weekend valuations; explicit breaks survive", () => {
  const points = [{ date: "2026-10-16", value: 100 }, { date: "2026-10-19", value: 110, externalFlow: 0 }];
  assert.equal(hasGap(points[0], points[1]), false);
  assert.equal(chainReturns(points).index[1].breakBefore, false);
  assert.equal(hasGap(points[0], { ...points[1], breakBefore: true }), true);
  const group = aggregateEquityHistory([{ id: "synthetic", currency: "USD", points }], "USD");
  assert.equal(group.points.length, 2);
  assert.equal(group.points[1].breakBefore, false);
  assert.equal(hasGap(points[1], { date: "2026-10-21", value: 111 }), true);
});

test("account and benchmarks use a common observed axis and the same zero starting point", () => {
  const own = [{ date: "2026-10-16", value: 1 }, { date: "2026-10-17", value: 1.01 },
    { date: "2026-10-19", value: 1.1, breakBefore: true }, { date: "2026-10-20", value: 1.2 }];
  const market = [{ id: "synthetic", points: [{ date: "2026-10-16", value: 100 }, { date: "2026-10-19", value: 101 }] }];
  const aligned = alignReturns(own, market);
  assert.deepEqual(aligned.primary.map(point => point.date), ["2026-10-16", "2026-10-19"]);
  assert.deepEqual(aligned.primary.map(point => point.date), aligned.benchmarks[0].points.map(point => point.date));
  assert.equal(aligned.primary[0].value, 0);
  assert.equal(aligned.benchmarks[0].points[0].value, 0);
  assert.equal(aligned.primary[1].breakBefore, true);
  assert.equal(aligned.benchmarks[0].points[1].breakBefore, false);
});

test("unadjusted asset balances are never benchmark comparisons", () => {
  const group = aggregateEquityHistory([{ id: "synthetic", currency: "USD", points: [
    { date: "2026-10-21", value: 100 }, { date: "2026-10-22", value: 200, externalFlow: null },
  ] }], "USD");
  const curve = equityHistoryCurve(group, { today: "2026-10-22", benchmarks: [{ id: "synthetic", points: [
    { date: "2026-10-21", value: 100 }, { date: "2026-10-22", value: 101 },
  ] }] });
  assert.equal(curve.return_kind, "unadjusted_asset_ratio");
  assert.deepEqual(curve.benchmarks, []);
});

test("calendar percentage uses end-flow TWR while money P/L stays cash adjusted", () => {
  const blocks = calculate(datedInput(["2026-10-19", "2026-10-20"], [100, 220], [100]));
  close(blocks.summary.twr_return_percent, 20);
  const day = blocks.calendar.cells.find(cell => cell.date === "2026-10-20");
  close(day.amount, 20);
  close(day.return_percent, 20);
});

test("a shorter benchmark reports the real comparison cutoff without truncating summary or asset dates", () => {
  const input = datedInput(dates, [100, 110, 220, 264], [0, 100, 0]);
  input.benchmarks = [{ id: "synthetic-benchmark", points: [
    { date: dates[0], value: 100 }, { date: dates[1], value: 101 },
  ] }];
  const blocks = calculate(input);
  close(blocks.summary.twr_return_percent, 44);
  assert.equal(blocks.summary.as_of, "2026-10-22");
  assert.equal(blocks.assets.as_of, "2026-10-22");
  assert.equal(blocks.assets.history_per_currency[0].as_of, "2026-10-22");
  for (const legacy of [false, true]) {
    if (legacy) input.histories[0].points.forEach((point, index) => { point.externalFlow = index === 2 ? 100 : 0; });
    const result = legacy ? performanceBlocks(input) : blocks;
    close(result.summary.twr_return_percent, 44);
    assert.equal(result.returns.points.at(-1).date, "2026-10-20");
    close(result.returns.points.at(-1).value, 10);
    assert.equal(result.returns.as_of, "2026-10-20");
    assert.equal(result.returns.status, "partial");
    assert.equal(result.returns.unavailable_reason, "benchmark_history_missing");
    assert.equal(result.assets.as_of, "2026-10-22");
    assert.equal(result.assets.history_per_currency[0].status, "ok");
  }
});

test("a break on a filtered-out account date survives on the common comparison axis", () => {
  const own = [{ date: "2026-10-19", value: 1 }, { date: "2026-10-20", value: 1.1, breakBefore: true },
    { date: "2026-10-21", value: 1.2 }];
  const aligned = alignReturns(own, [{ id: "synthetic", points: [{ date: own[0].date, value: 100 },
    { date: own[2].date, value: 110 }] }]);
  assert.equal(aligned.primary[1].breakBefore, true);
  const input = sourceInput();
  input.histories[0].points = input.histories[0].points.filter(point => ["2026-10-20", "2026-10-22"].includes(point.date));
  const blocks = calculate(input);
  assert.equal(blocks.returns.points[1].breakBefore, true);
});

test("Monday daily P/L combines weekend observations and their proven cash flows from Friday", () => {
  const input = datedInput(["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"], [100, 100, 200, 210], [0, 100, 0]);
  const blocks = calculate(input);
  const monday = blocks.calendar.cells.find(cell => cell.date === "2026-10-19");
  close(monday.amount, 10);
  close(monday.return_percent, 5);
  assert.equal(monday.value_kind, "pnl");
  assert.equal(monday.status, "ok");
  assert.equal(blocks.calendar.cells.find(cell => cell.date === "2026-10-18").amount, null);
});

test("cashflow updates inside the return range do not certify untouched calendar cells outside it", () => {
  const input = datedInput(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"], [100, 210, 220, 230], [100, 0, 0]);
  input.range = "1M";
  input.month = 9;
  const blocks = calculate(input);
  assert.equal(blocks.calendar.cells.find(cell => cell.date === "2026-09-22").value_kind, "asset_change");
  assert.equal(blocks.calendar.cells.find(cell => cell.date === "2026-09-23").value_kind, "pnl");
  assert.equal(blocks.calendar.status, "stale");
  assert.equal(blocks.calendar.value_kind, "asset_change");
  assert.equal(blocks.calendar.coverage.cashflows, "unknown");
  assert.equal(blocks.calendar.unavailable_reason, "external_cashflow_required");
});
