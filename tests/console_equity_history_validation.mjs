import assert from "node:assert/strict";
import { aggregateEquityHistory, equityHistoryCurve, historyMaxStalenessDays } from "../web/strategy-switch-console/application/console_api/equity_history.js";
import { businessDate, performanceBlocks } from "../web/strategy-switch-console/application/console_api/performance.js";
import { performanceResponse } from "../web/strategy-switch-console/application/console_api/performance_routes.js";
import { aggregateEquity, alignReturns, dateMs, hasGap } from "../web/strategy-switch-console/performance_math.js";

// All identifiers, dates and amounts in this file are synthetic.
const p = (day, value, externalFlow = null) => ({ date: `2026-01-${String(day).padStart(2, "0")}`, value, externalFlow });
const h = (id, points, currency = "USD") => ({ id, currency, points });
const aggregate = (histories, options) => aggregateEquityHistory(histories, "USD", options);
const a = h("synthetic-a", [p(1, 100), p(3, 110)]);
const b = h("synthetic-b", [p(2, 200), p(4, 220)]);
const disjoint = aggregate([a, b]);
assert.deepEqual(disjoint.points.map(p => [p.date, p.value]), [
  ["2026-01-01", 100], ["2026-01-02", 300], ["2026-01-03", 310], ["2026-01-04", 330],
]);
assert.deepEqual(disjoint.points[0].contributing_accounts, ["synthetic-a"]);
assert.deepEqual(disjoint.points[0].missing_accounts, ["synthetic-b"], "never backfill before the first observation");
assert.equal(disjoint.points[0].partial, true);
assert.deepEqual(disjoint.points[1].forward_filled_accounts, ["synthetic-a"]);
assert.equal(disjoint.points[1].breakBefore, true, "a joining account is not an investment gain");
assert.ok(disjoint.points.every(p => p.externalFlow === null));
assert.equal(disjoint.omittedDates, 0);

const overlap = aggregate([
  h("synthetic-a", [p(1, 100, 0), p(2, 110, 0)]),
  h("synthetic-b", [p(1, 200, 0), p(2, 210, 0)]),
]);
assert.deepEqual(overlap.points.map(p => p.value), [300, 320]);
assert.ok(overlap.points.every(p => !p.partial && p.externalFlow === 0));
const qualified = equityHistoryCurve(overlap, { today: "2026-01-02" });
assert.equal(qualified.return_kind, "twr");
assert.ok(Math.abs(qualified.points[1].value - 20 / 3) < 1e-9);

const cutoff = aggregate([
  h("synthetic-a", [p(1, 100), p(6, 120)]),
  h("synthetic-b", [p(4, 200), p(5, 210), p(6, 220)]),
]);
assert.equal(cutoff.maxStalenessDays, 3);
assert.equal(cutoff.points[1].value, 300, "default age limit includes exactly 3 calendar days");
assert.equal(cutoff.points[2].value, 210, "older values are excluded, not zero-filled or retained");
assert.deepEqual(cutoff.points[2].missing_accounts, ["synthetic-a"]);
assert.equal(cutoff.points[2].partial, true);
assert.equal(cutoff.points[2].breakBefore, true);
assert.equal(cutoff.points[3].value, 340, "a new real point re-enables the account");
assert.equal(cutoff.points[3].breakBefore, true);
assert.deepEqual(aggregate([a, b], { maxStalenessDays: 0 }).points.map(p => p.value), [100, 200, 110, 220]);
assert.equal(aggregate([a, b], { maxStalenessDays: "1" }).maxStalenessDays, 1);
for (const invalid of [undefined, null, "", " ", -1, 0.5, Infinity, "not-a-number", true])
  assert.equal(historyMaxStalenessDays(invalid), 3);

const single = aggregate([a]);
assert.deepEqual(single.points.map(p => p.value), [100, 110]);
assert.ok(single.points.every(p => !p.partial));
assert.deepEqual(aggregate([]).points, []);
assert.deepEqual(aggregate([h("synthetic-empty", [])]).missingAccounts, ["synthetic-empty"]);
const missing = aggregate([a, h("synthetic-empty", [])]);
assert.ok(missing.points.every(p => p.partial && p.missing_accounts.includes("synthetic-empty")));
const separate = aggregate([a, h("synthetic-wallet", [p(1, 9999)], "USDT")]);
assert.deepEqual(separate.points, single.points, "USD excludes USDT; no peg assumption or FX");
assert.equal(aggregateEquityHistory([a, h("synthetic-wallet", [p(1, 9999)], "USDT")], "USDT").points[0].value, 9999);
assert.deepEqual(aggregate([h("synthetic-invalid", [p(1, 100), p(1, 101), { date: "invalid", value: 10 }])]).points, []);

const curve = equityHistoryCurve(disjoint, { today: "2026-01-04", benchmarks: [{ id: "synthetic-benchmark", points: [p(1, 1), p(2, 2)] }] });
assert.equal(curve.status, "partial");
assert.equal(curve.return_kind, "unadjusted_asset_ratio");
assert.equal(curve.points.length, 4);
assert.equal(curve.points[1].value, 0, "a new membership starts its own percentage segment");
assert.equal(curve.points[1].breakBefore, true);
assert.deepEqual(curve.points[1].contributing_accounts, disjoint.points[1].contributing_accounts);
assert.deepEqual(curve.benchmarks, [], "no benchmark comparison across changing cohorts");
assert.equal(curve.coverage.membership_changed, true);
assert.equal(equityHistoryCurve(aggregate([]), { today: "2026-01-04" }).unavailable_reason, "snapshot_history_missing");
assert.equal(equityHistoryCurve(aggregate([]), { today: "2026-01-04" }).return_kind, "unadjusted_asset_ratio");
assert.equal(equityHistoryCurve(aggregate([h("synthetic-single", [p(1, 100)])]), { today: "2026-01-01" }).unavailable_reason, "insufficient_observations");
assert.equal(equityHistoryCurve(single, { today: "2026-01-10" }).status, "stale");

const sliced = equityHistoryCurve(aggregate([
  h("synthetic-a", [{ date: "2025-12-31", value: 100 }]),
  h("synthetic-b", [p(1, 200)]),
]), { range: "YTD", today: "2026-01-01" });
assert.equal(sliced.asset_points[0].value, 300, "range slicing occurs after bounded carry-forward");
assert.deepEqual(sliced.asset_points.map(p => p.date), ["2026-01-01"], "no fabricated dates");

const input = { accounts: [], histories: [a, b], today: "2026-01-04", year: 2026, month: 1 };
const blocks = performanceBlocks(input);
assert.equal(blocks.assets.points.length, 4, "single-currency asset endpoint uses the date union");
assert.equal(blocks.returns.points.length, 0, "unknown cash flows never become a return curve");
assert.equal(blocks.summary.twr_return_percent, null, "summary retains the fixed-cohort qualification");
assert.equal(blocks.summary.max_drawdown.percent, null);
assert.equal(blocks.summary.amount, null, "changing account subtotals do not become P/L");
const mixed = performanceBlocks({ ...input, histories: [...input.histories, h("synthetic-wallet", [p(1, 9999), p(4, 9999)], "USDT")] });
assert.deepEqual(mixed.assets.points, [], "no combined USD/USDT curve");
assert.equal(mixed.returns.per_currency.find(g => g.currency === "USD").points.length, 0);
assert.deepEqual(mixed.assets.history_per_currency.find(g => g.currency === "USD").points.map(p => p.value), [100, 300, 310, 330]);
assert.equal(mixed.assets.history_per_currency.find(g => g.currency === "USDT").points[0].value, 9999);
assert.equal(mixed.returns.per_currency.find(g => g.currency === "USDT").asset_points, undefined);
assert.equal(mixed.summary.amount, null);
const snapshotIndependent = performanceBlocks({ ...input,
  now: Date.parse("2026-01-04T13:00:00Z"),
  accounts: [1000, 2000].map((value, i) => ({ platform: "ibkr", account_key: `synthetic-${i}`,
    observation_date: "2026-01-04", observed_finished_at: "2026-01-04T12:00:00Z",
    balances: [{ currency: "USD", net_assets: String(value) }],
  })),
});
assert.equal(snapshotIndependent.assets.per_currency[0].total, 3000, "current totals stay independent of history subtotals");
assert.equal(snapshotIndependent.assets.points.at(-1).value, 330);
assert.equal(snapshotIndependent.assets.status, "ok");
assert.equal(snapshotIndependent.assets.curve_status, "partial");
assert.equal(snapshotIndependent.assets.curve_coverage.partial_points, 4);
assert.equal(snapshotIndependent.assets.curve_coverage.missing_points, 1);
assert.equal(snapshotIndependent.assets.curve_coverage.forward_filled_points, 3);
assert.deepEqual(snapshotIndependent.assets.curve_coverage, snapshotIndependent.assets.history_per_currency[0].coverage);
assert.equal(mixed.assets.curve_coverage, null, "mixed currencies retain independent per-currency coverage");
assert.equal(mixed.assets.history_per_currency.find(g => g.currency === "USD").coverage.forward_filled_points, 3);

// Actual GET adapter, with only local in-memory sources. No account or storage requests are sent.
const today = businessDate(Date.now());
const previous = new Date(dateMs(today) - 86_400_000).toISOString().slice(0, 10);
const facts = ["synthetic-a", "synthetic-b"].map(account_key => ({
  platform: "ibkr", account_key, binding_status: "bound", identity_mismatch: false,
  observation_date: today, observed_finished_at: new Date().toISOString(),
  aggregation_status: "included", balances: [{ currency: "USD", net_assets: "100" }],
}));
let failSecond = false;
let truncated = false;
const deps = {
  json: (body, status = 200) => Response.json(body, { status }),
  readSession: async () => ({ allowed: true }),
  accountOptions: async () => ({ options: { ibkr: facts.map(a => ({ key: a.account_key, broker_environment: "live" })) } }),
  facts: async () => Response.json({ accounts: facts }),
  history: async request => {
    assert.equal(request.method, "GET");
    const key = new URL(request.url).searchParams.get("account_key");
    if (new URL(request.url).searchParams.get("projection") === "currencies") {
      return Response.json({ ok: true, platform: "ibkr", account_key: key, projection: "currencies", currencies: ["USD"] });
    }
    if (key === "synthetic-b" && failSecond) return Response.json({}, { status: 503 });
    return Response.json({ platform: "ibkr", account_key: key, ...(new URL(request.url).searchParams.has("include_currencies") ? {currencies: ["USD"]} : {}), series: { currency: "USD", truncated, points: [{
      observation_date: key === "synthetic-a" ? previous : today,
      currency: "USD", net_assets: key === "synthetic-a" ? "100" : "200",
    }] } });
  },
  benchmarks: async () => Response.json({ points: [] }),
};
const request = endpoint => new Request(`https://console.example.invalid/api/performance/${endpoint}`);
const defaultResponse = await performanceResponse(request("assets"), {}, deps);
assert.equal(defaultResponse.status, 200);
const defaultBody = await defaultResponse.json();
assert.equal(defaultBody.points.at(-1).value, 300);
assert.equal(defaultBody.status, "ok");
assert.equal(defaultBody.curve_status, "partial");
assert.equal(defaultBody.curve_coverage.forward_filled_points, 1);
assert.equal(defaultBody.curve_coverage.truncated, false);
// A truncated single-account read would otherwise look complete with no carried points.
truncated = true;
const truncatedBody = await (await performanceResponse(new Request("https://console.example.invalid/api/performance/assets?scope=synthetic-a&platform=ibkr"), {}, deps)).json();
assert.equal(truncatedBody.status, "ok");
assert.equal(truncatedBody.curve_status, "partial");
assert.equal(truncatedBody.history_per_currency[0].status, "partial");
assert.equal(truncatedBody.curve_coverage.truncated, true);
assert.equal(truncatedBody.curve_coverage.partial_points, 0);
truncated = false;
const configured = await performanceResponse(request("assets"), { CONSOLE_HISTORY_MAX_STALENESS_DAYS: "0" }, deps);
assert.equal((await configured.json()).points.at(-1).value, 200, "read-only environment setting reaches aggregation");
failSecond = true;
const failedRead = await performanceResponse(request("assets"), {}, deps);
const failedBody = await failedRead.json();
assert.equal(failedBody.points[0].partial, true);
assert.deepEqual(failedBody.points[0].missing_accounts, ["ibkr:synthetic-b:USD"]);
assert.deepEqual(failedBody.coverage.read_failures, ["synthetic-b"]);
assert.deepEqual(failedBody.curve_coverage.read_failures, ["synthetic-b"]);
assert.equal(failedBody.curve_status, "partial");
assert.equal(failedBody.status, "ok", "history read failure does not overwrite current snapshot health");
console.log("console_equity_history_validation: PASS (synthetic union, overlap, age cutoff, first observation, empty/single, currencies, coverage and return segments)");

// A bound facts row can retain historic currencies when current balances are empty or omit one.
{
  let latestBalances = [], discoveryFails = false;
  const seen = [];
  const one = { platform: "ibkr", account_key: "synthetic", binding_status: "bound", identity_mismatch: false,
    aggregation_status: "included", get balances() { return latestBalances; } };
  const testDeps = { ...deps, accountOptions: async () => ({ options: { ibkr: [{ key: "synthetic", broker_environment: "live" }] } }),
    facts: async () => Response.json({ accounts: [one] }), history: async req => {
      const u = new URL(req.url), currency = u.searchParams.get("currency");
      if (u.searchParams.get("projection") === "currencies") return discoveryFails
        ? Response.json({ ok: false }, { status: 503 })
        : Response.json({ ok: true, platform: "ibkr", account_key: "synthetic", projection: "currencies", currencies: ["HKD", "USD"] });
      if (u.searchParams.has("include_currencies") && discoveryFails) return Response.json({}, { status: 503 });
      seen.push(currency);
      return Response.json({ platform: "ibkr", account_key: "synthetic", ...(u.searchParams.has("include_currencies") ? { currencies: ["HKD", "USD"] } : {}), series: { currency, points: [{
        observation_date: previous, currency, net_assets: currency === "HKD" ? "200" : "100" }] } });
    } };
  let body = await (await performanceResponse(new Request("https://console.example.invalid/api/performance/assets?scope=synthetic&platform=ibkr"), {}, testDeps)).json();
  assert.deepEqual([...seen].sort(), ["HKD", "USD"]);
  assert.deepEqual(body.history_per_currency.map(x => x.currency).sort(), ["HKD", "USD"]);
  assert.ok(body.history_per_currency.every(x => x.points.length === 1));
  latestBalances = [{ currency: "USD", net_assets: "123" }]; seen.length = 0;
  body = await (await performanceResponse(new Request("https://console.example.invalid/api/performance/assets?scope=synthetic&platform=ibkr"), {}, testDeps)).json();
  assert.deepEqual([...seen].sort(), ["HKD", "USD"], "historical-only currency is retained with one read per currency");
  assert.deepEqual(body.history_per_currency.map(x => x.currency).sort(), ["HKD", "USD"]);
  discoveryFails = true; seen.length = 0;
  body = await (await performanceResponse(new Request("https://console.example.invalid/api/performance/assets?scope=synthetic&platform=ibkr"), {}, testDeps)).json();
  assert.deepEqual(seen, ["USD"], "known current currency remains readable");
  assert.deepEqual(body.coverage.read_failures, ["synthetic"], "failed currency discovery is not an empty history");
  assert.equal(body.history_per_currency[0].status, "partial");
}


// The production e2 baseline must retain unqualified observations without a benchmark calendar.
const coreDates = Array.from({ length: 10 }, (_, i) => `2026-10-${String(i + 10).padStart(2, "0")}`);
const coreHistory = flow => [{ id: "synthetic-core", currency: "USD",
  points: coreDates.map((date, i) => ({ date, value: 100 + i, externalFlow: flow })) }];
const coreBench = dates => [{ id: "synthetic-core-benchmark", points: dates.map((date, i) => ({ date, value: 200 + i })) }];
const unqualifiedCore = equityHistoryCurve(aggregateEquityHistory(coreHistory(null), "USD"), {
  today: coreDates.at(-1), benchmarks: coreBench(coreDates.slice(5)),
});
assert.equal(unqualifiedCore.points.length, 10, "an unadjusted asset ratio cannot be clipped by a benchmark");
assert.equal(unqualifiedCore.return_kind, "unadjusted_asset_ratio");
assert.equal(unqualifiedCore.unavailable_reason, "external_cashflow_required");
assert.deepEqual(unqualifiedCore.benchmarks, [], "missing flows do not become qualified return comparisons");
const qualifiedCore = equityHistoryCurve(aggregateEquityHistory(coreHistory(0), "USD"), {
  today: coreDates.at(-1), benchmarks: coreBench(coreDates.slice(5)),
});
assert.equal(qualifiedCore.points.length, 5, "qualified comparisons keep only jointly observed dates");
assert.equal(qualifiedCore.benchmarks.length, 1);
assert.equal(qualifiedCore.return_kind, "twr");
const cutoffCore = performanceBlocks({ accounts: [], histories: coreHistory(0),
  benchmarks: coreBench(coreDates.slice(0, 5)), today: coreDates.at(-1), year: 2026, month: 10, range: "ALL" });
assert.equal(cutoffCore.returns.points.at(-1).date, coreDates[4], "the comparison cannot run beyond its benchmark");
assert.equal(cutoffCore.returns.as_of, coreDates[4]);
assert.equal(cutoffCore.returns.status, "partial");
assert.equal(cutoffCore.returns.unavailable_reason, "benchmark_history_missing");
assert.equal(cutoffCore.assets.history_per_currency[0].as_of, coreDates.at(-1), "asset history keeps its own observation date");
assert.equal(cutoffCore.assets.history_per_currency[0].points.length, 10);
assert.equal(cutoffCore.assets.points.length, 10);
console.log("backend_core_curve_regression: PASS (observation retention, qualified common dates and honest cutoff dates)");

assert.equal(hasGap({ date: "2026-10-16" }, { date: "2026-10-19" }), false, "a weekend is not an unobserved business day");
assert.equal(hasGap({ date: "2026-10-16" }, { date: "2026-10-20" }), true, "a missing Monday stays a real gap");
assert.equal(hasGap({ date: "2026-10-16" }, { date: "2026-10-20", breakBefore: false }), false, "an authoritative false break is preserved");
assert.equal(hasGap({ date: "2026-10-19" }, { date: "2026-10-20", breakBefore: true }), true);
const coreAxis = alignReturns([{ date: "2026-10-16", value: 1 }, { date: "2026-10-17", value: 1.01 },
  { date: "2026-10-19", value: 1.1, breakBefore: true }, { date: "2026-10-20", value: 1.2 }],
  [{ id: "synthetic-gap-benchmark", points: [{ date: "2026-10-16", value: 100 }, { date: "2026-10-19", value: 101 }] }]);
assert.deepEqual(coreAxis.primary.map(point => point.date), ["2026-10-16", "2026-10-19"]);
assert.deepEqual(coreAxis.primary.map(point => point.date), coreAxis.benchmarks[0].points.map(point => point.date));
assert.equal(coreAxis.primary[1].breakBefore, true, "source gaps survive shared-axis filtering");
assert.equal(coreAxis.benchmarks[0].points[1].breakBefore, false);
console.log("backend_core_date_axis_regression: PASS (weekend, missing business day and declared breaks)");

// Synthetic calendar cases: benchmark observations alone never certify a holiday.
assert.equal(hasGap({ date: "2026-10-16" }, { date: "2026-10-19" }, { crypto: true }), true,
  "a 24x7 series cannot silently skip a missing weekend");
assert.equal(hasGap({ date: "2026-10-16" }, { date: "2026-10-17" }, { crypto: true }), false);
const declaredClosure = alignReturns([{ date: "2026-10-14", value: 1 },
  { date: "2026-10-16", value: 1.1, breakBefore: false }], []);
assert.equal(declaredClosure.primary[1].breakBefore, false,
  "an authoritative declared interval can connect without inserting a holiday point");
const unclassifiedInterval = alignReturns([{ date: "2026-10-14", value: 1 },
  { date: "2026-10-16", value: 1.1 }], [{ id: "synthetic-stock-benchmark", points: [
  { date: "2026-10-14", value: 100 }, { date: "2026-10-16", value: 101 }] }]);
assert.equal(unclassifiedInterval.primary[1].breakBefore, true,
  "missing both an account observation and a benchmark close is not proof of a holiday");
const cryptoPoints = ["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"]
  .map((date, i) => ({ date, value: 100 + i, externalFlow: 0 }));
const cryptoHistory = { id: "binance:synthetic-crypto", currency: "USDT", crypto: true, points: cryptoPoints };
const cryptoGap = { ...cryptoHistory, points: [cryptoPoints[0], cryptoPoints[3]] };
assert.equal(aggregateEquity([cryptoGap]).points[1].breakBefore, true);
assert.equal(aggregateEquityHistory([cryptoGap], "USDT").points[1].breakBefore, true);
const cryptoBlocks = performanceBlocks({ accounts: [{ platform: "binance", account_key: "synthetic-crypto" }],
  histories: [cryptoHistory], today: cryptoPoints.at(-1).date, year: 2026, month: 10,
  benchmarks: [{ id: "synthetic-us-stock-index", points: [
    { date: "2026-10-16", value: 100 }, { date: "2026-10-19", value: 101 }] }] });
assert.deepEqual(cryptoBlocks.returns.points.map(p => p.date), cryptoPoints.map(p => p.date),
  "a qualified crypto curve retains Saturday and Sunday instead of adopting a stock benchmark calendar");
assert.deepEqual(cryptoBlocks.returns.benchmarks, []);
assert.equal(cryptoBlocks.returns.coverage.trading_dates, "calendar_days");
const cryptoRoute = await performanceResponse(new Request(
  "https://synthetic.invalid/api/performance/assets?scope=synthetic-crypto&platform=binance"), {}, {
  json: (body, status = 200) => Response.json(body, { status }),
  readSession: async () => ({ allowed: true }),
  accountOptions: async () => ({ options: { binance: [{ key: "synthetic-crypto", broker_environment: "live" }] } }),
  facts: async () => Response.json({ accounts: [] }),
  wallet: async () => Response.json({ currency: "USDT", points: cryptoGap.points.map(p => ({
    observation_date: p.date, observed_at: `${p.date}T12:00:00Z`, amount: String(p.value) })) }),
  history: async () => { throw Error("broker history must not be used for crypto"); },
  benchmarks: async () => Response.json({ points: [] }),
});
assert.equal(cryptoRoute.status, 200);
const cryptoRouteBody = await cryptoRoute.json();
assert.deepEqual(cryptoRouteBody.points.map(p => p.date), cryptoGap.points.map(p => p.date));
assert.equal(cryptoRouteBody.points[1].breakBefore, true,
  "the wallet route carries 24x7 semantics to the published asset curve");
console.log("backend_core_market_calendar_regression: PASS (stock weekends, declared/unknown closures, crypto 24x7 and untrimmed observations)");

await import("./native_daily_returns_validation.mjs");
