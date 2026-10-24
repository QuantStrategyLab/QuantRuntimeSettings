import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadMarketBenchmarkPoints } from "../web/strategy-switch-console/frontend/src/marketBenchmark.ts";
import { buildAccountFactsReadModel, normalizeAccountFactsHistoryPayload, projectAccountFactsHistorySeries } from "../web/strategy-switch-console/account_facts.js";

// Synthetic native-shaped responses only. A successful read must reach the
// rendered homepage, rather than disappearing behind the legacy layout guard.
const now = Date.parse("2026-10-15T08:00:00Z");
const option = { key: "synthetic-live", target_name: "synthetic-target", service_name: "synthetic-service", deployment_selector: "HK", account_selector: "HK", account_scope: "HK", broker_environment: "live" };
const binding = { platform: "longbridge", account_key: option.key, target_name: option.target_name, service_name: option.service_name, deployment_selector: option.deployment_selector, account_selector: option.account_selector, account_scope: "HK", target_id: "synthetic-target", source_binding: { kind: "deployment_scope_token_version", id: "a".repeat(64) } };
const payload = normalizeAccountFactsHistoryPayload({
  schema_version: "longbridge_account_snapshot_history.v1", snapshot_schema_version: "longbridge_account_snapshot.v1", account_scope: "HK", target_id: binding.target_id,
  source_binding: { ...binding.source_binding, status: "bound" }, observed_started_at: "2026-10-15T07:58:00Z", observed_finished_at: "2026-10-15T07:59:00Z", observation_date: "2026-10-15", snapshot_atomic: false,
  broker_reported_balances: [{ currency: "USD", net_assets: "101.25", total_cash: "5" }], cash: [{ currency: "USD", available_cash: "5", frozen_cash: "0", settling_cash: "0" }],
}, { now });
const model = buildAccountFactsReadModel({ accountOptions: { longbridge: [option] }, bindings: { schema_version: "qsl_account_facts_bindings.v1", bindings: [binding] }, storedByAccount: new Map([[`longbridge:${option.key}`, payload]]), now });
const previous = { ...payload, observation_date: "2026-10-14", observed_started_at: "2026-10-14T07:58:00Z", observed_finished_at: "2026-10-14T07:59:00Z" };
const series = projectAccountFactsHistorySeries({ binding, currency: "USD", days: [previous, payload].map(payload => ({ target_id: binding.target_id, source_binding_id: binding.source_binding.id, account_scope: binding.account_scope, observation_date: payload.observation_date, payload })) });
assert.equal(series.points.length, 2);
const history = { ok: true, platform: binding.platform, account_key: option.key, identity_mismatch: false, series };
const seriesIds = ["标普500", "纳斯达克100", "道琼斯工业平均指数", "罗素2000"];
const points = await loadMarketBenchmarkPoints(async (path, init) => {
  assert.equal(path, "/api/market-benchmark");
  assert.equal(init.method, "GET");
  assert.equal(init.credentials, "same-origin");
  return Response.json({ ok: true, inception_date: "2026-10-09", points: seriesIds.flatMap(seriesId => [
    { seriesId, observationDate: "2026-10-14", close: "100" },
    { seriesId, observationDate: "2026-10-15", close: "102" },
  ]) });
});
assert.equal(points.length, 8);
const frontend = fileURLToPath(new URL("../web/strategy-switch-console/frontend/", import.meta.url));
const require = createRequire(join(frontend, "package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { buildSync } = require("esbuild");
const bundled = buildSync({ stdin: { contents: 'export { OverviewPage } from "./OverviewPage"; export { PerformanceCharts } from "./PerformanceCharts"; export { LocaleContext } from "./locales"; export { prepareChartSeries } from "./charts/LineChart";', resolveDir: join(frontend, "src"), loader: "tsx" }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react-dom", "react/jsx-runtime"], write: false, logLevel: "silent" }).outputFiles[0].text;
const component = { exports: {} };
new Function("require", "module", "exports", bundled)(require, component, component.exports);
const { OverviewPage, PerformanceCharts, LocaleContext, prepareChartSeries } = component.exports;

// Native TWR percentages are already cumulative: +10% then -5% must plot as 10% → 4.5%,
// keeping the first observation and the final compounded value instead of rebasing to 0.
const syntheticReturns = [
  { date: "2026-10-01", value: 10 },
  { date: "2026-10-02", value: 4.5 },
];
const syntheticSeries = [{ id: "main", label: "Synthetic", color: "#000", points: syntheticReturns, primary: true }];
const cumulative = prepareChartSeries(syntheticSeries, "cumulative", "2026-10-01");
assert.deepEqual(cumulative.series[0].points.map(point => [point.date, point.value]), [
  ["2026-10-01", 10],
  ["2026-10-02", 4.5],
], "cumulative percentages stay exactly as the server chained them");
const daily = prepareChartSeries(syntheticSeries, "daily", "2026-10-01");
assert.equal(daily.series[0].points.length, 1, "no fabricated first-day daily return");
assert.equal(daily.series[0].points[0].date, "2026-10-02");
assert.ok(Math.abs(daily.series[0].points[0].value + 5) < 1e-9, "daily return compounds back to -5%");
const filtered = prepareChartSeries(syntheticSeries, "cumulative", "2026-10-02");
assert.deepEqual(filtered.series[0].points.map(point => point.value), [4.5], "alignStart filters without rebasing");
const gapped = prepareChartSeries(
  [{ ...syntheticSeries[0], points: [{ date: "2026-10-01", value: 10 }, { date: "2026-10-02", value: 4.5, breakBefore: true }] }],
  "cumulative",
  "2026-10-01",
);
assert.deepEqual(gapped.series[0].points.map(point => [point.value, point.breakBefore]), [[10, false], [4.5, true]],
  "backend gap flags are preserved and never bridged");
const dailyGap = prepareChartSeries(
  [{ ...syntheticSeries[0], points: [{ date: "2026-10-01", value: 10 }, { date: "2026-10-02", value: 4.5, breakBefore: true }] }],
  "daily",
  "2026-10-01",
);
assert.deepEqual(dailyGap.series[0].points, [], "a flagged break never manufactures a daily return");
const account = { id: "synthetic", platformKey: binding.platform, accountKey: option.key, runtimeDailyBinding: "not_applicable", title: "Synthetic live", platform: "LongBridge", environment: "Live", brokerEnvironment: "live", environmentSource: "config", strategy: "Synthetic strategy", statusLabel: "", statusDetail: "", activation: "待确认", preference: null, facts: model.accounts[0], runtime: null };
const initialData = { accounts: [{ id: account.id, points: series.points.map(p => ({ date: p.observation_date, value: Number(p.net_assets), externalFlow: null })) }], failed: [], omittedCurrencies: [], truncated: false, referenceFx: false, incompleteDates: 0 };
const render = (Component, props, language = "zh") => renderToStaticMarkup(React.createElement(LocaleContext.Provider, { value: language }, React.createElement(Component, props)));
const originalNow = Date.now;
Date.now = () => now;
try {
  const home = render(OverviewPage, { accounts: [account], accountFacts: model, marketBenchmarkPoints: points, onOpenAccount() {} });
  assert.match(home, /performance-panel/, "the unified chart panel must be reachable from the actual homepage");
  assert.match(home, /累计收益/);
  assert.doesNotMatch(home, /benchmark-chart-grid|benchmark-chart-line/, "old separate benchmark charts are removed");
  const props = { accounts: [account], accountId: "synthetic", onSelectAccount() {}, benchmarks: points, rates: {}, refreshVersion: 0, now, initialData };
  const html = render(PerformanceCharts, props);
  assert.equal((html.match(/<svg /g) || []).length, 2, "exactly one return plot and one total-assets plot");
  assert.match(html, /<svg[^>]+aria-label="累计收益"/);
  assert.match(html, /<svg[^>]+aria-label="总资产"/);
  const returns = html.slice(html.indexOf('data-testid="returns-plot"'), html.indexOf('data-testid="assets-plot"'));
  const assets = html.slice(html.indexOf('data-testid="assets-plot"'));
  for (const id of seriesIds) {
    assert.match(returns, new RegExp(`data-series="${id}"`));
    assert.doesNotMatch(assets, new RegExp(`data-series="${id}"`));
  }
  assert.match(html, /现金流未知/);
  assert.match(html, /0\.00%/);
  assert.match(html, /console-performance-charts\.md/);
  assert.equal((html.match(/aria-pressed="(?:true|false)"/g) || []).length, 9, "five shared ranges and four benchmark toggles");
  const en = render(PerformanceCharts, props, "en");
  assert.match(en, /Partial data: cash flows are unknown/);
  assert.doesNotMatch(en, /Information unavailable/);
  const empty = render(PerformanceCharts, { ...props, initialData: { ...initialData, accounts: [] } });
  assert.match(empty, /所选范围暂无数据/);
  assert.doesNotMatch(empty, /<svg/);
  const partial = render(PerformanceCharts, { ...props, now: now + 10 * 86400000, initialData: { ...initialData, failed: ['missing'], referenceFx: true, truncated: true } });
  assert.match(partial, /数据已过期/);
  assert.match(partial, /部分覆盖/);
  assert.match(partial, /非历史汇率/);
  const noCommon = render(PerformanceCharts, { ...props, benchmarks: points.map(p=>({...p,observationDate:'2026-10-10'})) });
  assert.match(noCommon, /比较数据不足或没有共同日期/);
} finally { Date.now = originalNow; }
console.log("console_chart_visibility_validation: PASS (receiver history → unified return/asset SVG, native cumulative 10%→4.5% preserved, daily −5% without a fabricated first day, four overlaid benchmarks, partial/empty/stale, English; synthetic only)");
