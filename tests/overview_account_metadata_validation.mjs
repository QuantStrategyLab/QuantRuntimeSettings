import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { buildAccountFactsReadModel, normalizeAccountFactsHistoryPayload, projectAccountFactsHistorySeries } from "../web/strategy-switch-console/account_facts.js";
import { accountFactsDetail, accountFactsDisplayReady, accountFactsForDisplay, accountHistoryCoverage, summarizeAccountFactsCoverage, summarizeCurrentAccountFacts, totalsUnavailableDetail } from "../web/strategy-switch-console/frontend/src/types.ts";
import { translate } from "../web/strategy-switch-console/frontend/src/locales.ts";

const now = Date.parse("2026-10-07T08:00:00Z");
const bindingId = "a".repeat(64);
const option = { key: "synthetic-paper", target_name: "paper", service_name: "synthetic-service", deployment_selector: "PAPER", account_selector: "PAPER", account_scope: "paper", broker_environment: "paper" };
const binding = { platform: "longbridge", account_key: option.key, target_name: option.target_name, service_name: option.service_name, deployment_selector: option.deployment_selector, account_selector: option.account_selector, account_scope: "paper", target_id: "paper", source_binding: { kind: "deployment_scope_token_version", id: bindingId } };
const payload = {
  schema_version: "longbridge_account_snapshot_history.v1", snapshot_schema_version: "longbridge_account_snapshot.v1", account_scope: "PAPER", target_id: "paper",
  source_binding: { kind: "deployment_scope_token_version", status: "bound", id: bindingId },
  observed_started_at: "2026-10-07T07:58:00Z", observed_finished_at: "2026-10-07T07:59:00Z", observation_date: "2026-10-07", snapshot_atomic: false,
  broker_reported_balances: [{ currency: "USD", net_assets: "101.25", total_cash: "0" }],
  cash: [{ currency: "USD", available_cash: "0", frozen_cash: "0", settling_cash: "0" }],
};
const normalized = normalizeAccountFactsHistoryPayload(payload, { now });
const model = buildAccountFactsReadModel({ accountOptions: { longbridge: [option] }, bindings: { schema_version: "qsl_account_facts_bindings.v1", bindings: [binding] }, storedByAccount: new Map([[`longbridge:${option.key}`, normalized]]), now });
const fresh = model.accounts[0];
assert.equal(fresh.data_status, "fresh", "synthetic native-shaped input crosses the actual receiver validator/read-model");
// Feed the actual receiver/read-model through a config-first refresh race.
const unmarkedPaperOption = { ...option, broker_environment: null };
const unmarkedPaperModel = buildAccountFactsReadModel({
  accountOptions: { longbridge: [unmarkedPaperOption] },
  bindings: { schema_version: "qsl_account_facts_bindings.v1", bindings: [binding] },
  storedByAccount: new Map([[`longbridge:${option.key}`, normalized]]), now,
});
assert.equal(unmarkedPaperModel.accounts[0].account_scope, "paper");
const unmarkedPaperSummary = summarizeCurrentAccountFacts([{
  id: option.key, platform: "longbridge", brokerEnvironment: null, facts: unmarkedPaperModel.accounts[0],
}]);
assert.deepEqual(unmarkedPaperSummary.excludingPaper.assets, []);
assert.deepEqual(unmarkedPaperSummary.paper.assets, [{ currency: "USD", amount: "101.25" }]);
const configFirstRefresh = summarizeCurrentAccountFacts([{
  id: option.key, platform: "longbridge", brokerEnvironment: "live", facts: fresh,
}]);
assert.deepEqual(configFirstRefresh.excludingPaper.assets, [], "new configuration cannot reclassify a previously loaded paper snapshot as real funds");
assert.deepEqual(configFirstRefresh.excludingPaper.availableCash, []);
assert.equal(configFirstRefresh.unknown.missing, 1);

const expiry = Date.parse(fresh.observed_finished_at) + 36 * 60 * 60 * 1000;
assert.equal(accountFactsForDisplay(fresh, expiry), fresh, "current evidence is unchanged through the exact cutoff");
assert.equal(accountFactsForDisplay(fresh, expiry + 1).data_status, "stale");
assert.equal(fresh.data_status, "fresh", "local expiry must not mutate the loaded model");
assert.equal(accountFactsForDisplay(fresh, expiry + 1).balances, fresh.balances, "historical/native arrays are preserved");
for (const timestamp of [null, "", "not-a-time", new Date(now + 5 * 60 * 1000 + 1).toISOString()]) {
  const projected = accountFactsForDisplay({ ...fresh, observed_finished_at: timestamp }, now);
  assert.equal(projected.data_status, "unavailable", "missing, invalid and out-of-tolerance future times cannot be current");
  assert.equal(accountFactsDisplayReady(projected), false);
}
assert.equal(accountFactsForDisplay({ ...fresh, observed_finished_at: new Date(now + 5 * 60 * 1000).toISOString() }, now).data_status, "fresh");
assert.equal(accountFactsDisplayReady(fresh), true);
assert.equal(accountFactsDetail(fresh), "");
for (const [patch, expected] of [
  [{ identity_mismatch: true }, "账户身份不匹配"],
  [{ binding_status: "duplicate" }, "账户资料绑定重复"],
  [{ binding_status: "missing" }, "账户资料尚未绑定"],
  [{ data_status: "stale" }, "账户资产资料已过期"],
  [{ data_status: "unavailable" }, "尚未取得账户资产资料"],
  [{ identity_status: "missing_identity" }, "账户身份待核实"],
]) {
  const item = { ...fresh, ...patch };
  assert.equal(accountFactsDisplayReady(item), false);
  assert.equal(accountFactsDetail(item), expected);
}
assert.equal(accountFactsDetail(null), "尚未取得账户资产资料");
assert.equal(totalsUnavailableDetail("physical_identity_unverified"), "实物账户尚未完成去重，暂不合计");
assert.equal(totalsUnavailableDetail("PRIVATE_SOURCE_URI"), "全部账户总额暂不可用", "unknown reasons never echo upstream strings");

const liveFacts = { ...fresh, account_scope: "HK", broker_environment: "live" };
const rows = [
  { id: "paper", brokerEnvironment: "paper", facts: fresh },
  { id: "stale", brokerEnvironment: "live", facts: { ...liveFacts, data_status: "stale" } },
  { id: "zero", brokerEnvironment: "live", facts: { ...liveFacts, balances: [{ currency: "USD", net_assets: "0" }] } },
  { id: "missing", brokerEnvironment: "live", facts: { ...liveFacts, balances: [{ currency: "USD", net_assets: null }] } },
  { id: "duplicate", brokerEnvironment: "live", facts: { ...liveFacts, binding_status: "duplicate" } },
  { id: "wallet", brokerEnvironment: "live", facts: null },
];
assert.deepEqual(summarizeAccountFactsCoverage(rows, "wallet"), { total: 6, covered: 3, paper: 1, wallet: 1 });
assert.deepEqual(summarizeAccountFactsCoverage(rows, "not-present"), { total: 6, covered: 2, paper: 1, wallet: 0 });
assert.deepEqual(summarizeAccountFactsCoverage([], null), { total: 0, covered: 0, paper: 0, wallet: 0 });
assert.deepEqual(accountHistoryCoverage({ first_sample_date: "2026-09-01", retention_days: 366, truncated: false, gap_dates: ["2026-09-02"], points: [{ observation_date: "2026-09-03" }, { observation_date: "2026-09-01" }] }), { firstSampleDate: "2026-09-01", lastSampleDate: "2026-09-03", gapCount: 1, retentionDays: 366, truncated: false });
assert.equal(accountHistoryCoverage(null), null);
assert.deepEqual(accountHistoryCoverage({ first_sample_date: "PRIVATE_TEXT", retention_days: -1, gap_dates: ["bad-date"], points: [] }), { firstSampleDate: null, lastSampleDate: null, gapCount: 0, retentionDays: null, truncated: false });
assert.equal(accountHistoryCoverage({ first_sample_date: "2026-02-30", gap_dates: ["2026-02-30"] }).firstSampleDate, null);
assert.equal(accountHistoryCoverage({ truncated: true }).truncated, true);

const schwabOption = { ...option, key: "synthetic-schwab", account_scope: "live", account_selector: "live", broker_environment: "live" };
const schwabBinding = { ...binding, platform: "schwab", account_key: schwabOption.key, account_scope: "live", account_selector: "live", broker_account_hash: "SYNTHETIC_PRIVATE_HASH", source_binding: { kind: "deployment_runtime_account", id: "b".repeat(64) } };
const schwabPayload = { ...payload, schema_version: "schwab_account_snapshot_history.v1", snapshot_schema_version: "schwab_account_snapshot.v1", account_scope: "live", source_binding: { ...schwabBinding.source_binding, status: "bound" }, account_hash: schwabBinding.broker_account_hash,
  broker_reported_balances: [{ currency: "USD", net_assets: "208.5", source_tag: "liquidationValue", currency_source: "owner_confirmed" }],
  cash: [{ currency: "USD", cash_balance: "-2", source_tag: "cashBalance", currency_source: "owner_confirmed" }], broker_account_type: { value: "CASH", source_tag: "securitiesAccount.type" } };
const schwabModel = buildAccountFactsReadModel({ accountOptions: { schwab: [schwabOption] }, bindings: { schema_version: "qsl_account_facts_bindings.v1", bindings: [schwabBinding] }, storedByAccount: new Map([[`schwab:${schwabOption.key}`, schwabPayload]]), now });
assert.equal(schwabModel.accounts[0].data_status, "fresh");
const historySeries = projectAccountFactsHistorySeries({ binding, currency: "USD", days: [{ target_id: binding.target_id, source_binding_id: binding.source_binding.id, account_scope: binding.account_scope, observation_date: payload.observation_date, payload }] });
assert.equal(historySeries.points.length, 1);

// The legacy OverviewPage/AccountsPage (props-driven) were removed with the dead UI tree. The live
// pages load their own data through useApi, so the account-facts display is exercised through the
// live AccountFactsAmounts component, fed by the actual receiver/read-model output above.
// Dropped with the legacy renders (no live counterpart): the all-accounts return panel
// ("暂无合格收益", benchmark names), the first-screen paper/coverage-copy negatives, the Binance wallet
// card valuation (covered by binance_account_facts_validation), the native-return no-curve check,
// the AccountsPage settings copy negatives, and the render-time 36h expiry (accountFactsForDisplay above).
const frontend = fileURLToPath(new URL("../web/strategy-switch-console/frontend/", import.meta.url));
const require = createRequire(join(frontend, "package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { buildSync } = require("esbuild");
const bundled = buildSync({ stdin: { contents: 'export { AccountFactsAmounts } from "./components/AccountFactsAmounts"; export { I18nProvider } from "./i18n";', resolveDir: join(frontend, "src"), loader: "tsx" }, bundle: true, platform: "node", format: "cjs", write: false, loader: { ".css": "empty" }, external: ["react", "react-dom"], jsx: "automatic", logLevel: "silent" }).outputFiles[0].text;
const component = { exports: {} };
new Function("require", "module", "exports", bundled)(require, component, component.exports);
const { AccountFactsAmounts, I18nProvider } = component.exports;
const originalFetch = globalThis.fetch;
let externalAttempts = 0;
globalThis.fetch = async () => { externalAttempts += 1; throw new Error("external fetch forbidden"); };
function render(fact, props = {}, language = "zh") {
  return renderToStaticMarkup(React.createElement(I18nProvider, { language }, React.createElement(AccountFactsAmounts, { fact, phase: "ready", ...props })));
}
try {
  const html = render(fresh);
  assert.match(html, /101\.25/);
  assert.doesNotMatch(html, new RegExp(bindingId), "private source identity is not rendered");
  assert.match(render({ ...fresh, data_status: "stale" }), /101\.25/, "stale evidence keeps its amount but is marked stale");
  assert.match(render({ ...fresh, data_status: "stale" }), /account-facts-freshness/);
  for (const patch of [{ binding_status: "duplicate" }, { binding_status: "missing" }, { identity_mismatch: true }, { data_status: "unavailable" }, { data_status: "mystery" }]) {
    assert.doesNotMatch(render({ ...fresh, ...patch }), /101\.25/, JSON.stringify(patch));
    assert.match(render({ ...fresh, ...patch }), /data-state="state\.|data-state="facts\./, JSON.stringify(patch));
  }
  assert.doesNotMatch(render(null), /\d/, "no fact renders no amount");
  const schwabFact = schwabModel.accounts[0];
  const schwabHtml = render(schwabFact);
  assert.match(schwabHtml, /208\.5/);
  assert.match(schwabHtml, /-2/);
  assert.doesNotMatch(schwabHtml, /SYNTHETIC_PRIVATE_HASH|账户类型: CASH|负现金未核实|可能是借的钱/);
  const zeroHtml = render({ ...schwabFact, balances: [{ currency: "USD", net_assets: "0" }], cash: [{ currency: "USD", cash_balance: null }] });
  assert.match(zeroHtml, /account-facts-assets[\s\S]*USD 0\.00/, "a reported zero is a real zero");
  assert.doesNotMatch(zeroHtml, /208\.5/);
  const missingHtml = render({ ...schwabFact, balances: [{ currency: "USD", net_assets: null }], cash: [] });
  assert.match(missingHtml, /—/, "a missing amount is an em dash, never zero");
  assert.doesNotMatch(missingHtml, /208\.5|USD 0\.00/);
  assert.match(render(schwabFact, { phase: "error" }), /data-state="state\.read_failed"/);
  assert.doesNotMatch(render(schwabFact, { phase: "error" }), /208\.5/);
  assert.doesNotMatch(render(schwabFact, { conflict: true }), /208\.5/);
  assert.doesNotMatch(render(schwabFact, { ambiguous: true }), /208\.5/);
  const english = render(schwabFact, {}, "en");
  assert.match(english, /Assets/);
  assert.doesNotMatch(english, /Information unavailable|资产/);
} finally { globalThis.fetch = originalFetch; }
for (const key of ["账户身份不匹配", "账户资料绑定重复", "账户资料尚未绑定", "账户资产资料已过期", "尚未取得账户资产资料", "账户身份待核实", "纳斯达克100", "道琼斯工业平均指数", "罗素2000"]) assert.notEqual(translate(key, "en"), "Information unavailable");
assert.equal(externalAttempts, 0);
console.log("overview_account_metadata_validation: PASS (actual validators/read-model → React render, synthetic only, external_attempts=0)");
