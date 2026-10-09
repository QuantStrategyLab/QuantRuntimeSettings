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
const historyResponse = { ok: true, platform: "longbridge", account_key: option.key, identity_mismatch: false, series: historySeries };

const frontend = fileURLToPath(new URL("../web/strategy-switch-console/frontend/", import.meta.url));
const require = createRequire(join(frontend, "package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { buildSync } = require("esbuild");
const bundled = buildSync({ stdin: { contents: 'export { OverviewPage } from "./OverviewPage"; export { AccountsPage } from "./AccountsPage"; export { LocaleContext } from "./locales";', resolveDir: join(frontend, "src"), loader: "tsx" }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react-dom", "react/jsx-runtime"], write: false, logLevel: "silent" }).outputFiles[0].text;
let selected = "all";
let chart = "assets";
let injectedHistory = null;
let historyKey = "";
let nullState = 0;
const hookedReact = { ...React, useState(initial) {
  // Supply the state that normal account/tab selection establishes; effects and
  // HTTP remain disabled in this deterministic server render.
  const value = initial === "all" ? selected : initial === "assets" ? chart
    : initial === "" && historyKey ? historyKey
    : initial === null && ++nullState === 1 && injectedHistory ? injectedHistory : initial;
  return React.useState(value);
} };
const component = { exports: {} };
new Function("require", "module", "exports", bundled)((name) => name === "react" ? hookedReact : require(name), component, component.exports);
const { OverviewPage, AccountsPage, LocaleContext } = component.exports;
const baseAccount = { id: "paper", platformKey: "longbridge", accountKey: option.key, runtimeDailyBinding: "not_applicable", title: "Synthetic paper", platform: "LongBridge", environment: "Paper", brokerEnvironment: "paper", environmentSource: "config", strategy: "Synthetic strategy", statusLabel: "", statusDetail: "", activation: "待确认", preference: null, facts: fresh, runtime: null };
const walletReport = { platform: "binance", account_key: "synthetic-wallet", observed_finished_at: "2026-10-07T07:59:00Z", provider_product_type: { value: "SPOT", source: "GET /api/v3/account.accountType", observed_at: "2026-10-07T07:58:00Z" }, assets: [], wallet_valuation: { status: "available", wallet_count: 1, amount: "44.55", currency: "USDT", observed_at: "2026-10-07T07:58:00Z", scope: "provider_returned_wallet_rows", source: "GET /sapi/v1/asset/wallet/balance" } };
const walletAccount = { ...baseAccount, id: "wallet", platformKey: "binance", accountKey: "synthetic-wallet", title: "Synthetic wallet", brokerEnvironment: "live", environment: "Live", facts: null };
const originalNow = Date.now;
const originalFetch = globalThis.fetch;
export const metadataRenderFixtures = {};
let externalAttempts = 0;
let browserNow = now;
Date.now = () => browserNow;
globalThis.fetch = async () => { externalAttempts += 1; throw new Error("external fetch forbidden"); };
function render(accounts, props = {}, language = "zh") {
  nullState = 0;
  return renderToStaticMarkup(React.createElement(LocaleContext.Provider, { value: language }, React.createElement(OverviewPage, { accounts, accountFacts: model, onOpenAccount() {}, ...props })));
}
try {
  const html = render([baseAccount]);
  metadataRenderFixtures.account = html;
  assert.match(html, /没读到/);
  assert.match(html, /暂无合格收益/);
  assert.match(html, /没有记录/);
  assert.doesNotMatch(html, /USD 101\.25|模拟账户|已取得资产合计|配置为模拟|覆盖按配置条目统计|历史数据范围/,
    "paper accounts and engineering coverage stay off the first screen");
  for (const name of ["你的账户", "标普 500", "纳斯达克综合", "罗素 2000", "道琼斯工业平均"]) assert.match(html, new RegExp(name));
  assert.match(html, /aria-label="收益率"/);
  assert.doesNotMatch(html, /<path |fred\.stlouisfed|暂无组合历史/);
  assert.doesNotMatch(html, new RegExp(bindingId), "private source identity is not rendered");
  assert.doesNotMatch(render([{ ...baseAccount, facts: { ...fresh, data_status: "stale" } }]), /USD 101\.25/);
  for (const patch of [{ binding_status: "duplicate" }, { binding_status: "missing" }, { identity_mismatch: true }, { identity_status: "missing_identity" }]) {
    assert.doesNotMatch(render([{ ...baseAccount, facts: { ...fresh, ...patch } }]), /USD 101\.25/);
  }
  const schwabAccount = { ...baseAccount, id: "schwab", platformKey: "schwab", accountKey: schwabOption.key, brokerEnvironment: "live", facts: schwabModel.accounts[0] };
  const schwabHtml = render([schwabAccount]);
  assert.match(schwabHtml, /真实/);
  assert.match(schwabHtml, /208\.5/);
  assert.match(schwabHtml, /-2/);
  assert.match(schwabHtml, /负现金未核实/);
  assert.doesNotMatch(schwabHtml, /可能是借的钱/);
  assert.doesNotMatch(schwabHtml, /SYNTHETIC_PRIVATE_HASH|账户类型: CASH/);
  const zeroHtml = render([{ ...schwabAccount, facts: { ...schwabAccount.facts, balances: [{ currency: "USD", net_assets: "0" }], cash: [{ currency: "USD", cash_balance: null }] } }]);
  assert.match(zeroHtml, />0<\/td>/);
  assert.doesNotMatch(zeroHtml, /208\.5/);
  const missingHtml = render([{ ...schwabAccount, facts: { ...schwabAccount.facts, balances: [{ currency: "USD", net_assets: null }], cash: [] } }]);
  assert.match(missingHtml, /没读到/);
  assert.doesNotMatch(missingHtml, /208\.5/);
  assert.doesNotMatch(render([{ ...baseAccount, brokerEnvironment: "live", facts: fresh }]), /101\.25/, "a paper snapshot is not relabeled as a real account");
  selected = "paper";
  injectedHistory = historyResponse;
  historyKey = `paper:USD:${fresh.observed_finished_at}:`;
  const historyHtml = render([baseAccount]);
  metadataRenderFixtures.history = historyHtml;
  assert.doesNotMatch(historyHtml, /历史数据范围|2026-10-07 · USD 101\.25|<path /, "stored asset history is not drawn as a return curve");
  browserNow = expiry;
  assert.match(render([schwabAccount]), /208\.5/);
  browserNow = expiry + 1;
  const expiredPage = render([schwabAccount]);
  const expiredCard = expiredPage.slice(expiredPage.indexOf('class="overview-account-entry"'));
  assert.doesNotMatch(expiredCard, /208\.5|现金详情|融资详情/);
  assert.match(expiredCard, /没读到/);
  browserNow = now;
  for (const timestamp of [null, "not-a-time", new Date(now + 5 * 60 * 1000 + 1).toISOString()]) {
    assert.doesNotMatch(render([{ ...schwabAccount, facts: { ...schwabAccount.facts, observed_finished_at: timestamp } }]), /208\.5/);
  }
  selected = "paper";
  injectedHistory = { ...historyResponse, account_key: "other" };
  assert.doesNotMatch(render([baseAccount]), /历史数据范围|101\.25/);
  injectedHistory = { ...historyResponse, identity_mismatch: true };
  assert.doesNotMatch(render([baseAccount]), /101\.25/);
  injectedHistory = historyResponse; historyKey = "old-request";
  assert.doesNotMatch(render([baseAccount]), /101\.25/, "superseded request metadata stays hidden");
  injectedHistory = null; historyKey = "";
  selected = "wallet";
  const walletHtml = render([walletAccount], { binanceFacts: { value: { report: walletReport }, error: null } });
  metadataRenderFixtures.wallet = walletHtml;
  const accountCard = walletHtml.slice(walletHtml.indexOf('class="overview-account-entry"'));
  assert.match(accountCard, /44\.55/);
  assert.match(accountCard, /USDT/);
  assert.match(accountCard, /真实/);
  assert.doesNotMatch(accountCard, /券商账户类别：SPOT|API账户类型：现货/);
  const wrongWallet = render([walletAccount], { binanceFacts: { value: { report: { ...walletReport, account_key: "other" } }, error: null } });
  assert.doesNotMatch(wrongWallet, /44\.55/);
  const staleWallet = render([walletAccount], { binanceFacts: { value: { report: { ...walletReport, observed_finished_at: "2026-10-04T07:59:00Z" } }, error: null } });
  assert.doesNotMatch(staleWallet, /44\.55/);
  assert.match(staleWallet, /没读到/);
  selected = "all"; chart = "return";
  const nativeReturnAccount = { ...baseAccount, platformKey: "ibkr", brokerEnvironment: "live", facts: { ...fresh, account_scope: "live", broker_environment: "live", return: {
    status: "available", method: "native_ibkr_twr", currency: "EUR", period: {from:"2026-09-01",to:"2026-09-30"},
    source_value: "-2.5", source_unit: "percent", value: "-0.025", unit: "ratio", source: "ChangeInNAV.twr", observed_at: "2026-10-08T08:00:00Z",
  } } };
  const nativeReturnHtml = render([nativeReturnAccount]);
  assert.doesNotMatch(nativeReturnHtml, /-2\.5%|USD -2\.5|<path /, "a single broker percent is not drawn as a benchmark curve");
  assert.match(nativeReturnHtml, /暂无合格收益/);
  const returnHtml = render([baseAccount]);
  metadataRenderFixtures.returns = returnHtml;
  assert.doesNotMatch(returnHtml, /数据来源与网站使用权限待核|<path /);
  assert.match(returnHtml, /aria-label="收益率"/);
  assert.match(returnHtml, /暂无合格收益/);
  const settingsRow = { id: "paper", platform: "longbridge", key: option.key, title: "Synthetic paper", platformLabel: "LongBridge", environment: "Paper", facts: fresh, strategy: "Synthetic strategy", strategyNote: "", statusLabel: "待确认", activation: "待确认" };
  const noop = () => {};
  const settingsHtml = renderToStaticMarkup(React.createElement(LocaleContext.Provider, { value: "zh" }, React.createElement(AccountsPage, {
    rows: [settingsRow], selectedId: "paper", detailOpen: true, settingsEpoch: 0, refreshToken: 0,
    stopAllowed: false, stopLabel: "", stopRefreshVisible: false, resumeVisible: false,
    onSelect: noop, onBack: noop, onDirty: noop, onStop: noop, onRefreshStop: noop, onResume: noop, onSettingsRead: noop,
    resolveStrategy: () => ({ name: "Synthetic strategy", note: "" }),
  })));
  metadataRenderFixtures.settings = settingsHtml;
  assert.doesNotMatch(settingsHtml, /当前配置来自设置读回|草案与风险偏好分别保存|运行端生效需另行验证/);
  assert.match(settingsHtml, /账户设置/);
  assert.doesNotMatch(settingsHtml, /选择这个账号跑什么策略，以及要不要开启期权收入层。/);
  assert.doesNotMatch(settingsHtml, /风险偏好|沿用当前/);
  const english = render([schwabAccount], {}, "en");
  assert.doesNotMatch(english, /Information unavailable/);
  assert.match(english, /Nasdaq Composite/);
  assert.match(english, /Not read|Real/);
  assert.doesNotMatch(english, /Asset amounts available:|Coverage counts configured entries|Account data basis|The current source range|Physical accounts have not been deduplicated/);
} finally { Date.now = originalNow; globalThis.fetch = originalFetch; }
for (const key of ["账户身份不匹配", "账户资料绑定重复", "账户资料尚未绑定", "账户资产资料已过期", "尚未取得账户资产资料", "账户身份待核实", "纳斯达克100", "道琼斯工业平均指数", "罗素2000"]) assert.notEqual(translate(key, "en"), "Information unavailable");
assert.equal(externalAttempts, 0);
console.log("overview_account_metadata_validation: PASS (actual validators/read-model → React render, synthetic only, external_attempts=0)");
