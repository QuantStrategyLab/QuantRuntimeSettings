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
assert.equal(on.calendar.cells.find(cell => cell.date === "2026-01-02").amount, 15);
assert.equal(on.calendar.cells.find(cell => cell.date === "2026-01-02").return_percent, 7.5);
assert.equal(on.calendar.value_kind, "pnl");
assert.equal(on.returns.return_kind, "twr");
if (on.summary.metric_reasons) assert.equal(on.summary.metric_reasons.twr, null);
if (on.summary.per_currency) assert.equal(on.summary.per_currency[0].max_drawdown.percent, 0);
const change = fn => { const x = structuredClone(input); fn(x); return cashflowCurrencyResult(x.histories, x); };
for (const fn of [
  x => { x.histories[0].externalFlow = null; },
  x => { x.histories[0].externalFlow.windows[0].coverage = "incomplete"; },
  x => { x.histories[0].points[1].forwardFilled = true; },
  x => { x.histories[0].points[1].forward_filled_accounts = ["synthetic"]; },
  x => { x.histories[0].points[1].observed_at = null; },
  x => { x.failed = ["missing"]; },
  x => { x.histories.push({ id: "missing", currency: "USD", points: [] }); },
  x => { x.histories[0].points.push({ ...x.histories[0].points[1], value: 999 }); },
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
const endFlow = change(x => {
  x.histories[0].externalFlow.windows[0].records[0].effective_at = end;
  x.histories[0].points[1].value = 200;
});
assert.equal(endFlow.twr_return_percent, 0, "end-flow weight is zero");
assert.equal(change(x => {
  x.histories[0].externalFlow.windows[0].records[0] = { ...record, type: "withdrawal", amount: "-300" };
}).unavailable_reason, "invalid_return_period");
const linked = change(x => {
  x.histories[0].points.push({ date: "2026-01-03", value: 193.5, observed_at: "2026-01-03T12:00:00.000Z", externalFlow: null });
  x.histories[0].externalFlow.windows.push({ ...window, date: "2026-01-03", period_start: end,
    period_end: "2026-01-03T12:00:00.000Z", records: [] });
});
assert.ok(Math.abs(linked.twr_return_percent + 1) < 1e-10, "chain 10% then -10% gives -1%");
assert.ok(Math.abs(linked.max_drawdown.percent - 10) < 1e-10);
const singleTransfer = change(x => { x.histories[0].externalFlow.windows[0].records[0].type = "transfer_in"; });
assert.ok(Math.abs(singleTransfer.twr_return_percent - 10) < 1e-10);
const two = structuredClone(input);
two.histories.push({ ...structuredClone(two.histories[0]), id: "second", currency: "USDT", externalFlow: payload({ ...window, currency: "USDT", records: [] }) });
assert.equal(applyCashflowPerformance(performanceBlocks(two), two, env).summary.twr_return_percent, null, "no cross-currency total");
two.histories[1].currency = "USD";
two.histories[1].points[1].observed_at = "2026-01-02T12:01:00.000Z";
assert.equal(cashflowCurrencyResult(two.histories, two).twr_return_percent, null, "same date alone is not simultaneous NAV");

// A complete source can still have an invalid Dietz denominator. Consumers must
// receive that reason rather than the legacy missing-cashflow placeholder.
const invalidInput = structuredClone(input);
invalidInput.histories[0].externalFlow.windows[0].records[0] = { ...record, type: "withdrawal", amount: "-300" };
const invalidLegacy = performanceBlocks(invalidInput);
const invalidBlocks = applyCashflowPerformance(structuredClone(invalidLegacy), invalidInput, env);
assert.equal(invalidBlocks.summary.cashflow_per_currency[0].unavailable_reason, "invalid_return_period");
assert.equal(invalidBlocks.summary.metric_reasons.twr, "invalid_return_period");
assert.equal(invalidBlocks.summary.unavailable_reason, "invalid_return_period");
assert.equal(invalidBlocks.returns.unavailable_reason, "invalid_return_period");
assert.equal(invalidBlocks.summary.twr_return_percent, null);
assert.equal(invalidBlocks.summary.max_drawdown.percent, null);
assert.equal(invalidBlocks.summary.max_drawdown.unavailable_reason, "invalid_return_period");
assert.deepEqual(invalidBlocks.returns.points, []);
assert.deepEqual(invalidBlocks.assets, invalidLegacy.assets);
assert.deepEqual(invalidBlocks.calendar, invalidLegacy.calendar);
if (invalidBlocks.summary.per_currency.length) {
  assert.equal(invalidBlocks.summary.per_currency[0].max_drawdown.unavailable_reason, "invalid_return_period");
}
const staleInput = { ...invalidInput, today: "2026-02-01" };
const staleBlocks = applyCashflowPerformance(performanceBlocks(staleInput), staleInput, env);
assert.equal(staleBlocks.summary.status, "stale");
assert.equal(staleBlocks.returns.status, "stale");
const incompleteInput = structuredClone(invalidInput);
incompleteInput.histories[0].externalFlow.windows[0].coverage = "incomplete";
const incompleteBlocks = applyCashflowPerformance(performanceBlocks(incompleteInput), incompleteInput, env);
assert.equal(incompleteBlocks.summary.metric_reasons.twr, "external_cashflow_required");
assert.equal(incompleteBlocks.returns.unavailable_reason, "external_cashflow_required");
const mixedInput = structuredClone(invalidInput);
mixedInput.histories.push({ ...structuredClone(input.histories[0]), id: "valid-usdt", currency: "USDT",
  externalFlow: payload({ ...window, currency: "USDT" }) });
const mixedLegacy = performanceBlocks(mixedInput);
const mixedBlocks = applyCashflowPerformance(structuredClone(mixedLegacy), mixedInput, env);
assert.equal(mixedBlocks.summary.unavailable_reason, "mixed_currency");
assert.equal(mixedBlocks.summary.metric_reasons.twr, "mixed_currency");
assert.equal(mixedBlocks.summary.twr_return_percent, null);
assert.equal(mixedBlocks.returns.unavailable_reason, "mixed_currency");
assert.deepEqual(mixedBlocks.returns.points, []);
const invalidCurrency = mixedBlocks.returns.per_currency.find(r => r.currency === "USD");
const validCurrency = mixedBlocks.returns.per_currency.find(r => r.currency === "USDT");
assert.equal(invalidCurrency.unavailable_reason, "invalid_return_period");
assert.deepEqual(invalidCurrency.points, []);
assert.equal(invalidCurrency.max_drawdown.percent, null);
assert.equal(validCurrency.unavailable_reason, null);
assert.ok(Math.abs(validCurrency.twr_return_percent - 10) < 1e-10);
assert.equal(validCurrency.max_drawdown.percent, 0);
assert.deepEqual(mixedBlocks.assets, mixedLegacy.assets);
assert.deepEqual(mixedBlocks.calendar, mixedLegacy.calendar);

// Calculation failures must preserve the existing benchmark date-alignment fact.
// A shared date (or no benchmark) lets the empty curve show the real reason;
// genuinely disjoint benchmark dates must still be reported as such.
for (const [source, reason] of [
  [invalidInput, "invalid_return_period"],
  [incompleteInput, "external_cashflow_required"],
]) {
  for (const [dates, noCommonDate] of [
    [["2026-01-01", "2026-01-02"], false],
    [[], false],
    [["2026-01-03"], true],
  ]) {
    const alignedInput = structuredClone(source);
    alignedInput.benchmarks = dates.length
      ? [{ id: "synthetic-benchmark", points: dates.map(date => ({ date, value: 100 })) }] : [];
    const before = performanceBlocks(alignedInput);
    assert.equal(before.returns.no_common_date, noCommonDate, "fixture has the intended date alignment");
    const after = applyCashflowPerformance(structuredClone(before), alignedInput, env);
    assert.equal(after.returns.no_common_date, noCommonDate, `${reason}: preserve benchmark date alignment`);
    assert.equal(after.returns.unavailable_reason, reason);
    assert.equal(after.summary.twr_return_percent, null);
    assert.equal(after.summary.max_drawdown.percent, null);
    assert.deepEqual(after.returns.points, []);
    assert.deepEqual(after.assets, before.assets);
    assert.deepEqual(after.calendar, before.calendar);
  }
}
// A zero opening NAV empties the legacy return chain even when real observation
// dates intersect. Date facts must survive both kinds of cashflow failure.
for (const reason of ["invalid_return_period", "external_cashflow_required"]) {
  const zeroOpeningInput = structuredClone(input);
  zeroOpeningInput.histories[0].points[0].value = 0;
  zeroOpeningInput.histories[0].points[1].value = 100;
  zeroOpeningInput.histories[0].externalFlow.windows[0].records[0].effective_at = end;
  if (reason === "external_cashflow_required") {
    zeroOpeningInput.histories[0].externalFlow.windows[0].coverage = "incomplete";
  }
  zeroOpeningInput.benchmarks = [{ id: "synthetic-benchmark", points: [
    { date: "2026-01-01", value: 100 }, { date: "2026-01-02", value: 100 },
  ] }];
  const before = performanceBlocks(zeroOpeningInput);
  const after = applyCashflowPerformance(structuredClone(before), zeroOpeningInput, env);
  assert.equal(after.returns.no_common_date, false, `${reason}: zero opening NAV still has shared observation dates`);
  assert.equal(after.returns.unavailable_reason, reason);
  assert.equal(after.summary.metric_reasons.twr, reason);
  assert.equal(after.summary.twr_return_percent, null);
  assert.equal(after.summary.max_drawdown.percent, null);
  assert.deepEqual(after.returns.points, []);
  assert.deepEqual(after.returns.benchmarks, []);
  assert.deepEqual(after.assets, before.assets);
  assert.deepEqual(after.calendar, before.calendar);
}
// Root-required direct core compatibility input: the extra empty history member
// does not represent a selected production account or establish route reachability.
const emptyCompatInput = {
  "accounts": [
    {
      "account_key": "synthetic",
      "platform": "schwab"
    }
  ],
  "histories": [
    {
      "id": "synthetic",
      "currency": "USD",
      "externalFlow": {
        "schema_version": "external_flow.v1",
        "windows": [
          {
            "currency": "USD",
            "date": "2026-10-17",
            "period_start": "2026-10-16T14:06:32.000Z",
            "period_end": "2026-10-17T14:06:32.000Z",
            "source": "schwab_transactions",
            "coverage": "incomplete",
            "records": [
              {
                "source_ref": "9174db243ce072454686a90cd10869c3e24b417f13e67b9d0b642fdc48ac701f",
                "type": "deposit",
                "amount": "100",
                "effective_at": "2026-10-17T02:06:32.000Z",
                "settlement_date": "2026-10-17",
                "transfer_ref": null
              }
            ]
          }
        ]
      },
      "points": [
        {
          "date": "2026-10-16",
          "observed_at": "2026-10-16T14:06:32.000Z",
          "value": 100,
          "externalFlow": null
        },
        {
          "date": "2026-10-17",
          "observed_at": "2026-10-17T14:06:32.000Z",
          "value": 215,
          "externalFlow": null
        }
      ]
    },
    {
      "id": "missing",
      "currency": "USD",
      "points": []
    }
  ],
  "benchmarks": [
    {
      "id": "标普500",
      "points": [
        {
          "date": "2026-10-16",
          "value": 100
        },
        {
          "date": "2026-10-17",
          "value": 100
        }
      ]
    }
  ],
  "range": "ALL",
  "today": "2026-10-17",
  "year": 2026,
  "month": 10,
  "failed": []
};
const emptyCompatCore = cashflowCurrencyResult(emptyCompatInput.histories, emptyCompatInput);
assert.equal(emptyCompatCore.unavailable_reason, "snapshot_history_missing");
assert.equal(emptyCompatCore.twr_return_percent, null);
assert.equal(emptyCompatCore.max_drawdown.percent, null);
assert.equal(emptyCompatCore.max_drawdown.unavailable_reason, "snapshot_history_missing");
assert.deepEqual(emptyCompatCore.points, []);
assert.deepEqual(emptyCompatCore.index, []);
const emptyCompatLegacy = performanceBlocks(emptyCompatInput);
assert.equal(emptyCompatLegacy.returns.no_common_date, false);
const emptyCompatBlocks = applyCashflowPerformance(structuredClone(emptyCompatLegacy), emptyCompatInput, env);
assert.equal(emptyCompatBlocks.returns.no_common_date, false, "root requires historical EMPTY false compatibility");
assert.equal(emptyCompatBlocks.returns.no_common_date, emptyCompatLegacy.returns.no_common_date);
assert.equal(emptyCompatBlocks.summary.metric_reasons.twr, "snapshot_history_missing");
assert.equal(emptyCompatBlocks.summary.twr_return_percent, null);
assert.equal(emptyCompatBlocks.summary.max_drawdown.percent, null);
assert.equal(emptyCompatBlocks.summary.max_drawdown.unavailable_reason, "snapshot_history_missing");
for (const block of [emptyCompatBlocks.summary, emptyCompatBlocks.returns]) {
  assert.equal(block.status, "partial");
  assert.equal(block.unavailable_reason, "snapshot_history_missing");
  assert.equal(block.cashflow_per_currency[0].unavailable_reason, "snapshot_history_missing");
  assert.equal(block.cashflow_per_currency[0].twr_return_percent, null);
  assert.equal(block.cashflow_per_currency[0].max_drawdown.percent, null);
  assert.equal(block.cashflow_per_currency[0].max_drawdown.unavailable_reason, "snapshot_history_missing");
}
assert.deepEqual(emptyCompatBlocks.returns.points, []);
assert.deepEqual(emptyCompatBlocks.returns.benchmarks, []);
assert.equal(emptyCompatBlocks.returns.aligned_start, null);
assert.deepEqual(emptyCompatBlocks.assets, emptyCompatLegacy.assets);
assert.deepEqual(emptyCompatBlocks.calendar, emptyCompatLegacy.calendar);
console.log("console_external_flow_validation: ok (synthetic only)");
