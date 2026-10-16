import assert from "node:assert/strict";
import { normalizeExternalFlow, mergeExternalFlow, externalFlowEnabled } from "../web/strategy-switch-console/application/account_facts/external_flow.js";
import { cashflowCurrencyResult, applyCashflowPerformance, intervalFlows } from "../web/strategy-switch-console/application/console_api/cashflow_performance.js";
import { performanceBlocks } from "../web/strategy-switch-console/application/console_api/performance.js";

const env = { CONSOLE_EXTERNAL_FLOW_ENABLED: "true" };
const start = "2026-01-01T12:00:00.000Z", end = "2026-01-02T12:00:00.000Z";
const record = { source_ref: "a".repeat(64), type: "deposit", amount: "100", effective_at: "2026-01-02T00:00:00.000Z", settlement_date: "2026-01-02", transfer_ref: null };
const window = { currency: "USD", date: "2026-01-02", period_start: start, period_end: end, source: "schwab_transactions", coverage: "complete", records: [record] };
const payload = w => ({ schema_version: "external_flow.v1", windows: Array.isArray(w) ? w : [w] });
const flow = normalizeExternalFlow(payload(window));
assert.equal(externalFlowEnabled({}), false);
for (const value of [true, "1", "TRUE", "false"]) assert.equal(externalFlowEnabled({ CONSOLE_EXTERNAL_FLOW_ENABLED: value }), false);
assert.equal(normalizeExternalFlow(payload({ ...window, records: [record, record] })).windows[0].records.length, 1);
assert.deepEqual(mergeExternalFlow(flow, flow), flow);
const mutate = fn => { const copy = structuredClone(flow); fn(copy.windows[0]); return copy; };
for (const invalid of [
  mutate(w => { w.records[0].amount = "NaN"; }),
  mutate(w => { w.records[0].amount = "-1"; }),
  mutate(w => { w.records[0].amount = true; }),
  mutate(w => { w.records[0].amount = "0"; }),
  mutate(w => { w.records[0].source_ref = "private-native-id"; }),
  mutate(w => { w.records[0].effective_at = start; }),
  mutate(w => { w.records[0].effective_at = "2026-01-02T13:00:00Z"; }),
  mutate(w => { w.records[0].effective_at = null; }),
  mutate(w => { w.records[0].settlement_date = "2026-02-30"; }),
  mutate(w => { w.date = "2026-01-03"; }),
  mutate(w => { w.extra = "forbidden"; }),
  payload(Array.from({ length: 32 }, () => window)),
  mutate(w => { w.records = Array.from({ length: 257 }, () => record); }),
]) assert.throws(() => normalizeExternalFlow(invalid));
assert.throws(() => mergeExternalFlow(flow, mutate(w => { w.records[0].amount = "101"; })), /conflict/);
assert.throws(() => normalizeExternalFlow(payload([window, { ...window, period_start: "2026-01-01T13:00:00Z" }])), /overlap/);
const incomplete = normalizeExternalFlow(mutate(w => { w.coverage = "incomplete"; w.records = []; }));
assert.deepEqual(mergeExternalFlow(incomplete, flow), flow);
assert.equal(intervalFlows(incomplete, "USD", start, end), null);
assert.equal(intervalFlows(flow, "USDT", start, end), null);
assert.equal(intervalFlows(flow, "USD", start, end)[0].weight, .5);
assert.equal(intervalFlows(flow, "USD", "2026-01-01T11:00:00Z", end), null);

const input = {
  accounts: [{ account_key: "synthetic", platform: "schwab" }],
  histories: [{ id: "synthetic", currency: "USD", externalFlow: flow,
    points: [{ date: "2026-01-01", value: 100, observed_at: start, externalFlow: null },
      { date: "2026-01-02", value: 215, observed_at: end, externalFlow: null }] }],
  range: "ALL", today: "2026-01-03", year: 2026, month: 1, benchmarks: [], failed: [],
};
const result = cashflowCurrencyResult(input.histories, input);
assert.ok(Math.abs(result.twr_return_percent - 10) < 1e-10, "midperiod deposit: 15/(100+0.5*100)");
assert.equal(result.approximate, true);
assert.equal(result.max_drawdown.percent, 0);
const legacy = performanceBlocks(input);
assert.equal(legacy.summary.twr_return_percent, null, "reproduces missing-flow main");
assert.deepEqual(applyCashflowPerformance(structuredClone(legacy), input, {}), legacy, "OFF preserves complete old response");
const none = { ...input, histories: input.histories.map(({ externalFlow, ...h }) => h) };
assert.deepEqual(applyCashflowPerformance(performanceBlocks(none), none, env), performanceBlocks(none), "ON with no source preserves complete old response");
const on = applyCashflowPerformance(structuredClone(legacy), input, env);
assert.ok(Math.abs(on.summary.twr_return_percent - 10) < 1e-10);
assert.deepEqual(on.assets, legacy.assets);
assert.deepEqual(on.calendar, legacy.calendar);
assert.equal(on.returns.return_kind, "twr");
const change = fn => { const x = structuredClone(input); fn(x); return cashflowCurrencyResult(x.histories, x); };
for (const fn of [
  x => { x.histories[0].externalFlow = null; },
  x => { x.histories[0].externalFlow.windows[0].coverage = "incomplete"; },
  x => { x.histories[0].points[1].forwardFilled = true; },
  x => { x.histories[0].points[1].forward_filled_accounts = ["synthetic"]; },
  x => { x.histories[0].points[1].observed_at = null; },
  x => { x.failed = ["missing"]; },
  x => { x.histories.push({ id: "missing", currency: "USD", points: [] }); },
]) assert.equal(change(fn).twr_return_percent, null);
assert.equal(change(x => { x.histories[0].points[0].value = 0; }).unavailable_reason, "invalid_return_period");
const withdrawal = change(x => {
  x.histories[0].externalFlow.windows[0].records[0] = { ...record, type: "withdrawal", amount: "-50" };
  x.histories[0].points[1].value = 42.5;
});
assert.ok(Math.abs(withdrawal.twr_return_percent + 10) < 1e-10);
assert.ok(Math.abs(withdrawal.max_drawdown.percent - 10) < 1e-10);
const zero = change(x => {
  x.histories[0].externalFlow.windows[0].records = [];
  x.histories[0].points[1].value = 110;
});
assert.ok(Math.abs(zero.twr_return_percent - 10) < 1e-10, "only explicit complete zero is zero");
const terminal = change(x => { x.histories[0].points[1].value = 0; x.histories[0].externalFlow.windows[0].records = []; });
assert.equal(terminal.twr_return_percent, -100);
assert.equal(terminal.max_drawdown.percent, 100);
const two = structuredClone(input);
two.histories.push({ ...structuredClone(two.histories[0]), id: "second", currency: "USDT", externalFlow: payload({ ...window, currency: "USDT", records: [] }) });
assert.equal(applyCashflowPerformance(performanceBlocks(two), two, env).summary.twr_return_percent, null, "no cross-currency total");
two.histories[1].currency = "USD";
two.histories[1].points[1].observed_at = "2026-01-02T12:01:00.000Z";
assert.equal(cashflowCurrencyResult(two.histories, two).twr_return_percent, null, "same date alone is not simultaneous NAV");
console.log("console_external_flow_validation: ok (synthetic only)");
