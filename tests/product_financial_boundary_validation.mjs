import assert from "node:assert/strict";
import { test } from "node:test";
import { holdingsRows, performanceBlocks } from "../web/strategy-switch-console/application/console_api/performance.js";
import { applyNativeDailyReturns } from "../web/strategy-switch-console/application/console_api/native_daily_returns.js";
import { applyCashflowPerformance } from "../web/strategy-switch-console/application/console_api/cashflow_performance.js";

const env = { CONSOLE_EXTERNAL_FLOW_ENABLED: "true" };
const stamp = date => `${date}T12:00:00.000Z`;
function inputFor(days, values, breaks = []) {
  return { accounts: [{ platform: "schwab", account_key: "synthetic" }],
    histories: [{ id: "synthetic", currency: "USD",
      points: days.map((date, i) => ({ date, value: values[i], observed_at: stamp(date), ...(breaks.includes(i) ? { breakBefore: true } : {}) })),
      externalFlow: { schema_version: "external_flow.v1", windows: days.slice(1).map((date, i) => ({
        currency: "USD", date, period_start: stamp(days[i]), period_end: stamp(date), coverage: "complete", source: "schwab_transactions", records: [] })) } }],
    benchmarks: [], failed: [], range: "ALL", today: days.at(-1), year: 2026, month: 10 };
}
function calculate(input) { return applyCashflowPerformance(performanceBlocks(input), input, env); }

test("holding percentages use finite positive cost basis, known currency, and preserve existing pnl", () => {
  const positions = [
    { symbol: "profit", quantity: 2, avg_cost: 10, market_value: 25, currency: "USD" },
    { symbol: "loss", quantity: 2, avg_cost: 10, market_value: 15, currency: "USD" },
    { symbol: "zero", quantity: 2, avg_cost: 10, market_value: 20, currency: "USD" },
    { symbol: "missing", quantity: 2, avg_cost: null, market_value: 20, currency: "USD" },
    { symbol: "invalid", quantity: Infinity, avg_cost: 10, market_value: 20, currency: "USD" },
    { symbol: "no_currency", quantity: 2, avg_cost: 10, market_value: 25, currency: "" },
    { symbol: "zero_basis", quantity: 0, avg_cost: 10, market_value: 20, currency: "USD" },
    { symbol: "overflow", quantity: 1e308, avg_cost: 1e308, market_value: 1, currency: "USD" },
  ];
  const rows = Object.fromEntries(holdingsRows([{ platform: "schwab", account_key: "synthetic", positions }]).map(row => [row.symbol, row]));
  assert.equal(rows.profit.unrealized_pnl, 5);
  assert.equal(rows.profit.unrealized_pnl_percent, 25);
  assert.equal(rows.loss.unrealized_pnl_percent, -25);
  assert.equal(rows.zero.unrealized_pnl_percent, 0);
  for (const key of ["missing", "invalid", "no_currency", "zero_basis", "overflow"]) assert.equal(rows[key].unrealized_pnl_percent, null, key);
});

test("cashflow-backed return points expose only qualified original one-day intervals", () => {
  const input = inputFor(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-23", "2026-10-24"], [100, 110, 110, 99, 108.9], [4]);
  const points = calculate(input).returns.points;
  const byDate = Object.fromEntries(points.map(point => [point.date, point]));
  assert.equal(byDate["2026-10-19"].daily_return_percent, null);
  assert.ok(Math.abs(byDate["2026-10-20"].daily_return_percent - 10) < 1e-10);
  assert.equal(byDate["2026-10-21"].daily_return_percent, 0);
  assert.equal(byDate["2026-10-23"].daily_return_percent, null);
  assert.equal(byDate["2026-10-24"].daily_return_percent, null);
  input.histories[0].externalFlow.windows[0].coverage = "incomplete";
  assert.deepEqual(calculate(input).returns.points, []);
});


test("aligned dates never convert a removed observation into a daily interval", () => {
  const input = inputFor(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"], [100, 110, 99, 99]);
  input.benchmarks = [{ id: "synthetic", points: [
    { date: "2026-10-19", value: 100 }, { date: "2026-10-21", value: 101 }, { date: "2026-10-22", value: 102 },
  ] }];
  const points = calculate(input).returns.points;
  assert.deepEqual(points.map(p => p.date), ["2026-10-19", "2026-10-21", "2026-10-22"]);
  assert.equal(points[1].daily_return_percent, null);
  assert.equal(points[2].daily_return_percent, 0);
  const negative = inputFor(["2026-10-19", "2026-10-20"], [100, 90]);
  assert.ok(Math.abs(calculate(negative).returns.points[1].daily_return_percent + 10) < 1e-10);
  negative.histories[0].points[1].membership_changed = true;
  assert.equal(calculate(negative).returns.points[1].daily_return_percent, null);
  const overflow = inputFor(["2026-10-19", "2026-10-20"], [1, 1e308]);
  assert.equal(calculate(overflow).returns.points[1].daily_return_percent, null);
});

test("disabled cashflow source preserves old response without new point fields", () => {
  const input = inputFor(["2026-10-19", "2026-10-20"], [100, 110]);
  const before = performanceBlocks(input);
  assert.deepEqual(applyCashflowPerformance(structuredClone(before), input, {}), before);
});

test("multiple currencies retain independent daily return points", () => {
  const input = inputFor(["2026-10-19", "2026-10-20"], [100, 110]);
  const second = structuredClone(input.histories[0]);
  second.id = "second";
  second.currency = "EUR";
  second.points[1].value = 90;
  second.externalFlow.windows[0].currency = "EUR";
  input.histories.push(second);
  const currencies = Object.fromEntries(calculate(input).returns.per_currency.map(row => [row.currency, row]));
  assert.ok(Math.abs(currencies.USD.points[1].daily_return_percent - 10) < 1e-10);
  assert.ok(Math.abs(currencies.EUR.points[1].daily_return_percent + 10) < 1e-10);
});


test("native first reported zero remains explicit zero", () => {
  const input = inputFor(["2026-10-19", "2026-10-20"], [100, 100]);
  const row = date => ({ status: "available", method: "native_ibkr_twr", source: "ChangeInNAV.twr", unit: "ratio", currency: "USD", period: { from: date, to: date }, value: "0" });
  input.accounts = [{ platform: "ibkr", account_key: "synthetic", return: { daily: [row("2026-10-19"), row("2026-10-20")] } }];
  const result = applyNativeDailyReturns(applyCashflowPerformance(performanceBlocks(input), input, env), input);
  assert.equal(result.returns.points[0].daily_return_percent, 0);
});
