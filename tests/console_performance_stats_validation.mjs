import "./console_equity_history_validation.mjs";
import assert from "node:assert/strict";
import "./console_external_flow_validation.mjs";
import "./external_flow_receiver_validation.mjs";
import {
  businessDate,
  calendarCells,
  closedTradeStats,
  dailyChanges,
  holdingsRows,
  maxDrawdown,
  performanceBlocks,
} from "../web/strategy-switch-console/application/console_api/performance.js";
import { chainReturns } from "../web/strategy-switch-console/performance_math.js";
const points = [
  { date: "2026-10-01", value: 100, externalFlow: 0 },
  { date: "2026-10-02", value: 200, externalFlow: 100 },
  { date: "2026-10-05", value: 180, externalFlow: 0 },
  { date: "2026-10-06", value: 270, externalFlow: 100 },
  { date: "2026-10-07", value: 280, externalFlow: 0 },
];
assert.equal(dailyChanges(points)[1].amount, 0, "deposit is not P/L");
assert.equal(dailyChanges(points)[1].return_percent, 0);
assert.equal(
  dailyChanges([
    { date: "2026-10-02", value: 100, externalFlow: 0 },
    { date: "2026-10-03", value: 200, externalFlow: 100 },
    { date: "2026-10-05", value: 200, externalFlow: 0 },
  ])[2].amount,
  0,
  "weekend capital stays investment at the next close",
);
const calendar = calendarCells(points, 2026, 10);
assert.equal(calendar.find((p) => p.date === "2026-10-02").amount, 0);
assert.equal(calendar.find((p) => p.date === "2026-10-08").amount, null);
assert.equal(
  calendar.find((p) => p.date === "2026-10-03").unavailable_reason,
  "non_trading_weekend",
);
assert.equal(
  dailyChanges([
    { date: "2026-10-01", value: 100 },
    { date: "2026-10-05", value: 105 },
  ])[1].amount,
  null,
  "missing Friday prevents pretending Monday is daily",
);
assert.equal(businessDate(Date.parse("2026-12-31T16:01:00Z")), "2027-01-01");
assert.equal(businessDate(Date.parse("2026-12-31T15:59:00Z")), "2026-12-31");
assert.equal(calendarCells([], 2024, 2).length, 29);
assert.equal(calendarCells([], 2026, null).length, 12);
const dd = maxDrawdown(chainReturns(points).index);
assert.ok(Math.abs(dd.percent - 15) < 1e-10);
assert.equal(dd.peak_date, "2026-10-01");
assert.equal(dd.trough_date, "2026-10-06");
assert.equal(
  maxDrawdown([
    { date: "2026-01-01", value: 1 },
    { date: "2026-01-02", value: 2 },
  ]).percent,
  0,
);
assert.equal(maxDrawdown([]).percent, null);
assert.equal(maxDrawdown(points.slice(0, 1)).percent, null);
assert.equal(closedTradeStats([]).win_rate_percent, null);
const holdings = holdingsRows([
  {
    account_key: "synthetic",
    platform: "ibkr",
    positions_scope: "stocks_only",
    positions: [
      {
        symbol: "SYNTH",
        quantity: "2",
        market_value: "250",
        avg_cost: "100",
        currency: "USD",
      },
      {
        symbol: "UNKNOWN",
        quantity: "1",
        market_value: "100",
        currency: "USD",
      },
    ],
  },
]);
assert.equal(holdings[0].unrealized_pnl, 50);
assert.equal(holdings[1].unrealized_pnl, null);
assert.equal(holdings[1].unavailable_reason, "avg_cost_missing");
const input = {
  accounts: [{ account_key: "synthetic", platform: "ibkr" }],
  histories: [{ id: "synthetic", currency: "USD", points }],
  range: "ALL",
  today: "2026-10-08",
  year: 2026,
  month: 10,
};
const blocks = performanceBlocks(input);
assert.ok(
  Math.abs(blocks.summary.twr_return_percent - ((280 / 270) * 0.85 - 1) * 100) <
    1e-10,
);
assert.equal(blocks.summary.amount, -20);
assert.equal(blocks.assets.points.length, 5);
assert.ok(!("benchmarks" in blocks.assets));
assert.equal(blocks.returns.points[0].value, 0);
const mixed = performanceBlocks({
  ...input,
  histories: [...input.histories, { id: "other", currency: "HKD", points }],
});
assert.equal(mixed.returns.per_currency.length, 2);
assert.equal(mixed.returns.per_currency[0].points[0].value, 0);
assert.equal(mixed.summary.unavailable_reason, "mixed_currency");
assert.equal(mixed.summary.amount, null);
assert.deepEqual(mixed.assets.points, []);
const unknown = performanceBlocks({
  ...input,
  histories: [
    {
      id: "synthetic",
      currency: "USD",
      points: points.map(({ externalFlow, ...p }) => p),
    },
  ],
});
assert.equal(unknown.summary.value_kind, "asset_change");
assert.equal(unknown.summary.twr_return_percent, null);
assert.equal(unknown.summary.max_drawdown.percent, null);
const empty = performanceBlocks({ ...input, histories: [] });
assert.equal(empty.summary.status, "no_data");
assert.equal(empty.summary.amount, null);
const single = performanceBlocks({
  ...input,
  histories: [{ id: "synthetic", currency: "USD", points: points.slice(0, 1) }],
});
assert.equal(single.summary.twr_return_percent, null);
const boundaryPoints = [
  { date: "2026-12-31", value: 100, externalFlow: 0 },
  { date: "2027-01-01", value: 110, externalFlow: 0 },
];
assert.equal(calendarCells(boundaryPoints, 2027, 1)[0].amount, 10);
const yearPoints = Array.from({ length: 32 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 0, i)).toISOString().slice(0, 10),
  value: 100 + i,
  externalFlow: 0,
}));
const days = calendarCells(yearPoints, 2026, 1, { crypto: true });
const months = calendarCells(yearPoints, 2026, null, { crypto: true });
assert.equal(
  months[0].amount,
  days.reduce((s, p) => s + p.amount, 0),
);
assert.equal(months[1].amount, null);
console.log("console_performance_stats_validation: PASS");

assert.equal(
  dailyChanges([
    { date: "2026-10-01", value: 0, externalFlow: 0 },
    { date: "2026-10-02", value: 0, externalFlow: 0 },
  ])[1].unavailable_reason,
  "invalid_return_period",
);

await import("./console_currency_totals_validation.mjs");
await import("./console_currency_totals_ui_validation.mjs");
await import("./console_asset_history_ui_validation.mjs");
import "./console_holdings_source_isolation_validation.mjs";
