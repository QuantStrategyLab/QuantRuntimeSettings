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
    { seriesId, observationDate: "2026-10-12", close: "100" },
    { seriesId, observationDate: "2026-10-13", close: "102" },
  ]) });
});
assert.equal(points.length, 8);
const frontend = fileURLToPath(new URL("../web/strategy-switch-console/frontend/", import.meta.url));
const require = createRequire(join(frontend, "package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { buildSync } = require("esbuild");
const bundled = buildSync({ stdin: { contents: 'export { OverviewPage } from "./OverviewPage"; export { LocaleContext } from "./locales";', resolveDir: join(frontend, "src"), loader: "tsx" }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react-dom", "react/jsx-runtime"], write: false, logLevel: "silent" }).outputFiles[0].text;
let selected = "all";
let chart = "assets";
let nullIndex = 0;
const hookedReact = { ...React, useState(initial) {
  const value = initial === "all" ? selected : initial === "assets" ? chart
    : initial === "" && selected !== "all" ? `${selected}:USD:${payload.observed_finished_at}:`
    : initial === null && ++nullIndex === 1 && selected !== "all" ? history : initial;
  return React.useState(value);
} };
const component = { exports: {} };
new Function("require", "module", "exports", bundled)((name) => name === "react" ? hookedReact : require(name), component, component.exports);
const { OverviewPage, LocaleContext } = component.exports;
const account = { id: "synthetic", platformKey: binding.platform, accountKey: option.key, runtimeDailyBinding: "not_applicable", title: "Synthetic live", platform: "LongBridge", environment: "Live", brokerEnvironment: "live", environmentSource: "config", strategy: "Synthetic strategy", statusLabel: "", statusDetail: "", activation: "待确认", preference: null, facts: model.accounts[0], runtime: null };
const originalNow = Date.now;
Date.now = () => now;
function render(marketBenchmarkPoints = points, accounts = [account]) {
  nullIndex = 0;
  return renderToStaticMarkup(React.createElement(LocaleContext.Provider, { value: "zh" }, React.createElement(OverviewPage, { accounts, accountFacts: model, marketBenchmarkPoints, onOpenAccount() {} })));
}
try {
  const home = render();
  assert.match(home, /<svg[^>]+aria-label="总资产"/, "homepage_asset_chart_visible: HTTP 200 account facts must reach a visible chart");
  assert.match(home, /role="tablist" aria-label="图表"/, "read-only chart navigation must be reachable");
  for (const name of seriesIds) assert.match(home, new RegExp(`<svg[^>]+aria-label="${name}"`), "homepage_benchmarks_visible: each successful synthetic series renders");
  assert.equal((home.match(/class="benchmark-chart-line"/g) || []).length, 4, "consecutive stored closes produce four visible line segments");
  assert.match(home, /市场基准不是账户收益/);
  selected = "synthetic";
  assert.match(render([]), /2026-10-15 · USD 101.25/, "selected_account_history_visible: the receiver-projected history reaches SVG");
  assert.match(render([]), /class="asset-chart-line"/, "consecutive stored account observations produce a visible line segment");
  chart = "return";
  const returns = render();
  assert.doesNotMatch(returns, /class="asset-chart-line"/, "asset values must never be plotted as account returns");
  assert.match(returns, /暂无合格期间收益记录/);
  selected = "all";
  assert.doesNotMatch(render([], [{ ...account, brokerEnvironment: "paper", facts: { ...account.facts, account_scope: "paper", broker_environment: "paper" } }]), /<svg/, "missing benchmarks and paper-only accounts must not fabricate charts");
} finally { Date.now = originalNow; }
console.log("console_chart_visibility_validation: PASS (homepage_asset_chart_visible, homepage_benchmarks_visible, selected_account_history_visible; synthetic only)");
