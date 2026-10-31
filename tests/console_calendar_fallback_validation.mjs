import assert from "node:assert/strict";
import { performanceBlocks } from "../web/strategy-switch-console/application/console_api/performance.js";
import { applyCashflowPerformance } from "../web/strategy-switch-console/application/console_api/cashflow_performance.js";

// All identifiers, dates and amounts in this file are synthetic.
const days = (dates, values) => dates.map((date, i) => ({ date, value: values[i], externalFlow: null }));
const a = { id: "synthetic-a", currency: "USD", points: days(
  ["2026-10-20", "2026-10-22", "2026-10-24", "2026-10-26", "2026-10-28", "2026-10-30"],
  [100, 101, 102, 103, 104, 105]) };
const b = { id: "synthetic-b", currency: "USD", points: days(
  ["2026-10-21", "2026-10-23", "2026-10-25", "2026-10-27", "2026-10-29"],
  [200, 201, 202, 203, 204]) };
const disjoint = {
  accounts: [{ platform: "ibkr", account_key: "synthetic-a" }, { platform: "ibkr", account_key: "synthetic-b" }],
  histories: [a, b],
  range: "ALL", today: "2026-10-30", year: 2026, month: 10, benchmarks: [], failed: [],
};

// A strict fixed cohort omits every date the members do not share, so the
// calendar has no value. The bounded per-currency asset series still describes
// money movement; it may fill the calendar as asset change, never as a return.
const blocks = performanceBlocks(disjoint);
assert.equal(blocks.summary.twr_return_percent, null, "a split cohort still has no qualified TWR");
assert.deepEqual(blocks.returns.points, [], "asset change never becomes a return point");
assert.equal(blocks.calendar.status, "partial");
assert.equal(blocks.calendar.value_kind, "asset_change");
assert.equal(blocks.calendar.unavailable_reason, "snapshot_history_missing");
assert.equal(blocks.calendar.coverage.asset_change_fallback, true);
const valued = blocks.calendar.cells.filter(cell => cell.amount !== null);
assert.ok(valued.length > 0, "the fallback calendar shows bounded asset deltas");
assert.ok(valued.every(cell => cell.return_percent === null
  && cell.value_kind === "asset_change"
  && cell.status === "partial"
  && cell.unavailable_reason === "snapshot_history_missing"));
assert.equal(blocks.calendar.as_of, "2026-10-30");
assert.ok((blocks.returns.asset_change?.points.length || 0) > 1, "the returns payload keeps the asset series separately");
assert.equal(blocks.returns.asset_change.return_kind, "unadjusted_asset_ratio");

// Year view: a partial month exposes the observed asset subtotal instead of a
// blank cell, and still refuses to report a return percentage.
const yearView = performanceBlocks({ ...disjoint, month: null });
const october = yearView.calendar.cells.find(cell => cell.month === "2026-10");
assert.equal(october.value_kind, "asset_change");
assert.equal(october.return_percent, null);
assert.equal(october.status, "partial");
assert.ok(october.amount !== null, "observed monthly asset change stays visible");
assert.equal(yearView.calendar.coverage.asset_change_fallback, true);

// A missing member is not a sparse date. The fallback must stay off so a
// subset of accounts never stands in for the requested cohort.
const missingMember = performanceBlocks({
  ...disjoint,
  histories: [a, { id: "synthetic-c", currency: "USD", points: [] }],
});
assert.notEqual(missingMember.calendar.coverage.asset_change_fallback, true);
assert.equal(missingMember.calendar.cells.find(cell => cell.date === "2026-10-30").amount, null);

// A failed read is also a cohort gap, not a forward-fill opportunity.
const failedRead = performanceBlocks({ ...disjoint, failed: ["synthetic-b"] });
assert.notEqual(failedRead.calendar.coverage.asset_change_fallback, true);
assert.equal(failedRead.calendar.cells.find(cell => cell.date === "2026-10-30").amount, null);

// Mixed currencies keep the existing per-currency contract: the combined
// calendar stays unavailable, while each currency retains its own asset series.
const mixed = performanceBlocks({
  ...disjoint,
  histories: [...disjoint.histories, {
    id: "synthetic-wallet", currency: "USDT", crypto: true,
    points: days(["2026-10-20", "2026-10-24", "2026-10-28"], [500, 505, 510]),
  }],
});
assert.equal(mixed.calendar.status, "unavailable");
assert.equal(mixed.calendar.unavailable_reason, "mixed_currency");
assert.notEqual(mixed.calendar.coverage.asset_change_fallback, true);
for (const entry of mixed.returns.per_currency) {
  assert.deepEqual(entry.points, [], `${entry.currency}: no TWR without a shared cohort`);
  assert.ok((entry.asset_change?.points.length || 0) > 1, `${entry.currency}: asset series stays available`);
}

// Cash-flow calculation failures replace only the return points. The separate
// asset change series survives so a currency tab never falls back to blank.
const cashflowInput = {
  ...disjoint,
  histories: disjoint.histories.map(history => ({ ...history, externalFlow: { windows: [] } })),
};
const cashflowBlocks = applyCashflowPerformance(
  performanceBlocks(cashflowInput), cashflowInput, { CONSOLE_EXTERNAL_FLOW_ENABLED: "true" });
assert.equal(cashflowBlocks.returns.status, "partial");
assert.ok(cashflowBlocks.returns.per_currency.length === 0, "single-currency failure keeps the top-level contract");
assert.ok((cashflowBlocks.returns.asset_change?.points.length || 0) > 1,
  "a failed return calculation does not discard the asset series");

// A strict calendar with real daily values is left untouched: the fallback is
// only a last resort, never a relabeling of a qualified return.
const overlap = performanceBlocks({
  ...disjoint,
  histories: [
    { id: "synthetic-a", currency: "USD", points: days(["2026-10-20", "2026-10-21"], [100, 101]) },
    { id: "synthetic-b", currency: "USD", points: days(["2026-10-20", "2026-10-21"], [200, 202]) },
  ],
  today: "2026-10-21",
});
assert.notEqual(overlap.calendar.coverage.asset_change_fallback, true);
assert.equal(overlap.calendar.cells.find(cell => cell.date === "2026-10-21").value_kind, "asset_change",
  "unknown flows keep the existing asset-change label instead of becoming P/L");
assert.ok(overlap.returns.asset_change, "the separate series is still exposed for consumers that need it");

console.log("console_calendar_fallback_validation: PASS (gated forward-filled asset calendar, missing/failed/mixed guards, strict calendar untouched)");
