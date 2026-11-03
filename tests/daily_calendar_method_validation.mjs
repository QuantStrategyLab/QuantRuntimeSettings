import assert from "node:assert/strict";
import { test } from "node:test";
import { performanceBlocks } from "../web/strategy-switch-console/application/console_api/performance.js";
import { applyCashflowPerformance } from "../web/strategy-switch-console/application/console_api/cashflow_performance.js";
import { applyNativeDailyReturns } from "../web/strategy-switch-console/application/console_api/native_daily_returns.js";

const env = { CONSOLE_EXTERNAL_FLOW_ENABLED: "true" };
const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"];
function fixture(platform = "ibkr") {
  return {
    accounts: [{ platform, account_key: "synthetic-calendar" }],
    histories: [{ id: "synthetic-calendar", currency: "USD",
      points: days.map((date, i) => ({ date, value: 100 + i * 20, observed_at: `${date}T12:00:00.000Z` })),
      externalFlow: { schema_version: "external_flow.v1", windows: days.slice(1).map((date, i) => ({
        currency: "USD", date, period_start: `${days[i]}T12:00:00.000Z`, period_end: `${date}T12:00:00.000Z`,
        source: "ibkr_flex", coverage: "complete", records: [{ source_ref: String(i + 1).repeat(64),
          type: "deposit", amount: "10", effective_at: `${date}T${i === 0 ? "00" : "12"}:00:00.000Z`,
          settlement_date: date, transfer_ref: null }],
      })) },
    }], range: "ALL", today: "2026-10-07", year: 2026, month: 10, benchmarks: [], failed: [],
  };
}
const calculate = input => applyCashflowPerformance(performanceBlocks(input), input, env);
const serialized = blocks => JSON.parse(JSON.stringify(blocks));
const cell = (blocks, date) => serialized(blocks).calendar.cells.find(row => row.date === date);
const units = { method_version: null, return_unit: "percent", amount_unit: "native_currency" };
function assertMethod(row, method) {
  assert.equal(row.return_method, method);
  for (const [key, value] of Object.entries(units)) {
    assert.ok(Object.hasOwn(row, key), `${key} must survive serialization`);
    assert.equal(row[key], value);
  }
  assert.equal(row.currency, "USD");
}

test("Dietz daily metadata distinguishes approximation from exact end flow", () => {
  const result = calculate(fixture());
  const approximate = cell(result, days[1]);
  assertMethod(approximate, "modified_dietz");
  assert.equal(approximate.cashflow_method, "modified_dietz");
  assert.equal(approximate.approximate, true);
  const exact = cell(result, days[5]);
  assertMethod(exact, "modified_dietz");
  assert.equal(exact.approximate, false, "earlier approximation must not taint this day");
  assert.equal(exact.amount, 10);
  assert.ok(Math.abs(approximate.return_percent - 1000 / 105) < 1e-10);
  assert.equal(Object.hasOwn(result.summary.best_day, "approximate"), false);
  assert.equal(Object.hasOwn(result.summary.worst_day, "approximate"), false);
});

test("stock weekend grouping uses only contributing periods", () => {
  const input = fixture();
  input.histories[0].externalFlow.windows[2].records[0].effective_at = `${days[3]}T00:00:00.000Z`;
  const result = calculate(input);
  assert.equal(cell(result, days[4]).approximate, true, "Monday includes an intraday Sunday flow");
  assert.equal(cell(result, days[5]).approximate, false);
  assert.deepEqual(cell(result, days[3]), cell(performanceBlocks(input), days[3]), "weekend placeholder unchanged");
});

test("crypto daily cells retain their own approximation scope", () => {
  const input = fixture("binance");
  const result = calculate(input);
  assertMethod(cell(result, days[2]), "modified_dietz");
  assert.equal(cell(result, days[2]).approximate, false);
});

test("unqualified cells and all monthly cells remain structurally unchanged", () => {
  const input = fixture();
  const result = calculate(input);
  assert.deepEqual(cell(result, days[0]), cell(performanceBlocks(input), days[0]));
  input.month = null;
  assert.deepEqual(calculate(input).calendar, performanceBlocks(input).calendar);
  input.month = 10;
  input.histories[0].externalFlow.windows[0].coverage = "incomplete";
  assert.deepEqual(calculate(input).calendar, performanceBlocks(input).calendar);
});

test("native replacement removes inherited Dietz labels and replaces method identity", () => {
  const input = fixture();
  input.accounts[0].return = { daily: [{ status: "available", method: "native_ibkr_twr",
    source: "ChangeInNAV.twr", unit: "ratio", currency: "USD", value: "0.07",
    period: { from: days[1], to: days[1] } }] };
  const blocks = calculate(input);
  // Also exercise a pre-tagged input independently of the Dietz implementation.
  Object.assign(blocks.calendar.cells.find(row => row.date === days[1]), {
    return_method: "modified_dietz", ...units, cashflow_method: "modified_dietz", approximate: true,
  });
  const native = cell(applyNativeDailyReturns(blocks, input), days[1]);
  assertMethod(native, "native_ibkr_twr");
  assert.equal(Object.hasOwn(native, "cashflow_method"), false);
  assert.equal(Object.hasOwn(native, "approximate"), false);
  assert.ok(Math.abs(native.return_percent - 7) < 1e-10);
  assert.equal(native.amount, null, "percentage never supplies native money");
});
