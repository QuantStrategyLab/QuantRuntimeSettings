import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAssetChartGeometry,
  buildBinanceWalletHistoryChartGeometry,
  chartRangeEmptyNote,
  chartUnavailable,
  defaultOverviewChartAccountId,
  filterAssetHistoryByRange,
  formatBinanceNativeQuantity,
  formatBinanceWalletAmount,
  formatLocalChangeTime,
  formatOverviewInstant,
  formatOverviewShortInstant,
  overviewAccountTypeLabel,
  overviewCardStatusDetail,
  parseMoneyForChart,
  presentRuntimeDaily,
  runtimeBusinessDate,
  runtimeDailySelectionEligible,
  resolveOverviewChartAccount,
  verifiedSchwabAccountTypeToken,
} from "../web/strategy-switch-console/frontend/src/presentation.ts";
import { accountFactsDetail, formatAccountFactAmounts, hasNonzeroNegativeAccountFactAmount, totalsUnavailableDetail } from "../web/strategy-switch-console/frontend/src/types.ts";
import { translate } from "../web/strategy-switch-console/frontend/src/locales.ts";
import { RUNTIME_DAILY_TARGET } from "../web/strategy-switch-console/runtime_daily_contract.js";

const root = fileURLToPath(new URL("..", import.meta.url));

assert.equal(parseMoneyForChart("12.5"), 12.5);
assert.equal(parseMoneyForChart("1e9"), null);
assert.equal(parseMoneyForChart("not-a-number"), null);
assert.equal(parseMoneyForChart(`1${"0".repeat(20)}`), null);
assert.equal(formatBinanceWalletAmount("1234.555"), "1234.56", "wallet valuation rounds decimal strings without binary floating point");
assert.equal(formatBinanceWalletAmount(`999999999999999999999999999999.995`), `1${"0".repeat(30)}.00`,
  "large wallet amounts retain exact digits during rounding");
assert.equal(formatBinanceWalletAmount("0.004"), "<0.01", "small positive amount never appears as zero");
assert.equal(formatBinanceWalletAmount("-0.004"), ">-0.01", "small negative amount retains the correct inequality direction");
assert.equal(formatBinanceWalletAmount("-0.005"), "-0.01");
assert.equal(formatBinanceWalletAmount("0"), "0.00");
const originalWalletAmount = "1234.555";
formatBinanceWalletAmount(originalWalletAmount);
assert.equal(originalWalletAmount, "1234.555", "display formatting does not mutate the source amount");
assert.equal(formatBinanceNativeQuantity("1.123456789012"), "1.12345679", "native quantities round to at most eight decimals");
assert.equal(formatBinanceNativeQuantity("12.34000000"), "12.34", "native quantities trim trailing fractional zeroes");
assert.equal(formatBinanceNativeQuantity("0.000000009"), "0.00000001", "quantity rounding keeps a small nonzero value visible");
assert.equal(formatBinanceNativeQuantity("0.000000001"), "<0.00000001", "sub-precision positive quantity never appears as zero");
assert.equal(formatBinanceNativeQuantity("-0.000000001"), ">-0.00000001", "sub-precision negative quantity keeps inequality direction");

const points = [
  { observation_date: "2026-09-01", observed_finished_at: "2026-09-01T10:00:00Z", currency: "USD", net_assets: "10", total_cash: "1" },
  { observation_date: "2026-09-02", observed_finished_at: "2026-09-02T10:00:00Z", currency: "USD", net_assets: "11", total_cash: "1" },
  { observation_date: "2026-09-04", observed_finished_at: "2026-09-04T10:00:00Z", currency: "USD", net_assets: "12", total_cash: "1" },
];
const now = Date.parse("2026-09-04T12:00:00Z");
assert.equal(filterAssetHistoryByRange(points, "all", now).length, 3);
assert.deepEqual(filterAssetHistoryByRange(points, "3m", now).map((row) => row.observation_date), ["2026-09-01", "2026-09-02", "2026-09-04"]);

const geometry = buildAssetChartGeometry(points);
assert.equal(geometry.dots.length, 3);
assert.equal(geometry.segments.length, 1);
assert.match(geometry.segments[0], /^M/);
assert.equal(geometry.segments[0].includes(" L"), true);
const walletPoints = [
  { observation_date: "2026-09-28", observed_at: "2026-09-28T10:00:00Z", amount: "100.25" },
  { observation_date: "2026-09-30", observed_at: "2026-09-30T10:00:00Z", amount: "125.75" },
];
const walletSingle = buildBinanceWalletHistoryChartGeometry([walletPoints[0]]);
assert.equal(walletSingle.dots.length, 1, "one genuine Binance observation renders as one dot");
assert.equal(walletSingle.segments.length, 0, "one wallet observation does not create a synthetic line");
const walletGap = buildBinanceWalletHistoryChartGeometry(walletPoints);
assert.equal(walletGap.dots.length, 2);
assert.equal(walletGap.segments.length, 0, "missing UTC date keeps wallet observations disconnected");
const readerTransition = buildBinanceWalletHistoryChartGeometry([
  { ...walletPoints[0], observation_date: "2026-09-29" },
  { ...walletPoints[1], observation_date: "2026-09-30", break_before: true },
]);
assert.equal(readerTransition.dots.length, 2);
assert.equal(readerTransition.segments.length, 0, "reader transitions remain disconnected even on consecutive days");
assert.deepEqual(filterAssetHistoryByRange(walletPoints, "all", now).map((row) => row.amount), ["100.25", "125.75"]);
assert.equal(geometry.dots[2].date, "2026-09-04");
assert.equal(geometry.dots[2].x > geometry.dots[1].x, true);
assert.equal(geometry.segments[0].includes(geometry.dots[2].x.toFixed(2)), false, "missing history day must remain a line gap");
assert.equal(geometry.minLabel, "10");
assert.equal(geometry.maxLabel, "12");

const single = buildAssetChartGeometry([points[0]]);
assert.equal(single.segments.length, 0);
assert.equal(single.dots.length, 1);

const chartAccounts = [
  { id: "paper", brokerEnvironment: "paper", facts: { binding_status: "bound", data_status: "fresh", balances: [{ currency: "USD", net_assets: "50" }] } },
  { id: "unknown", brokerEnvironment: null, facts: { binding_status: "bound", data_status: "fresh", balances: [{ currency: "USD", net_assets: "50" }] } },
  { id: "no-currency", brokerEnvironment: "live", facts: { binding_status: "bound", data_status: "fresh", balances: [] } },
  { id: "stale", brokerEnvironment: "live", facts: { binding_status: "bound", data_status: "stale", balances: [{ currency: "USD", net_assets: "50" }] } },
  { id: "unbound", brokerEnvironment: "live", facts: { binding_status: "missing", data_status: "fresh", balances: [{ currency: "USD", net_assets: "50" }] } },
  { id: "identity-mismatch", brokerEnvironment: "live", facts: { binding_status: "bound", identity_mismatch: true, data_status: "fresh", balances: [{ currency: "USD", net_assets: "50" }] } },
  { id: "facts-paper", brokerEnvironment: "live", facts: { binding_status: "bound", broker_environment: "paper", data_status: "fresh", balances: [{ currency: "USD", net_assets: "50" }] } },
  { id: "scope-paper", brokerEnvironment: "live", facts: { binding_status: "bound", account_scope: "paper", data_status: "fresh", balances: [{ currency: "USD", net_assets: "50" }] } },
  { id: "no-net-assets", brokerEnvironment: "live", facts: { binding_status: "bound", data_status: "fresh", balances: [{ currency: "USD", net_assets: null }] } },
  { id: "qualified", brokerEnvironment: "live", facts: { binding_status: "bound", data_status: "fresh", balances: [{ currency: "USDT", net_assets: "50" }] } },
  { id: "qualified-later", brokerEnvironment: "live", facts: { binding_status: "bound", data_status: "fresh", balances: [{ currency: "USD", net_assets: "75" }] } },
];
const originalAccountCount = chartAccounts.length;
assert.equal(defaultOverviewChartAccountId(chartAccounts), "unknown");
assert.equal(defaultOverviewChartAccountId([chartAccounts[1]]), "unknown", "fresh bound facts may provide a single-account graph when account mode is unknown");
assert.equal(chartAccounts.length, originalAccountCount, "chart default must not filter overview cards");
assert.equal(defaultOverviewChartAccountId(chartAccounts.filter((account) => !["unknown", "qualified", "qualified-later"].includes(account.id))), null, "no candidate qualifies when bindings, identity, paper scope, or valuation are invalid");
assert.equal(chartAccounts[1].brokerEnvironment, null, "selecting an unknown-environment chart does not classify the account");
assert.equal(chartAccounts[1].facts.binding_status, "bound");
assert.equal(chartAccounts[1].facts.data_status, "fresh");
assert.equal(resolveOverviewChartAccount(chartAccounts, "all", "qualified-later")?.id, "qualified-later", "graph-only user selection remains stable");
assert.equal(resolveOverviewChartAccount(chartAccounts, "paper", "qualified-later")?.id, "paper", "specific primary filter overrides chart-only selection");
assert.equal(resolveOverviewChartAccount(chartAccounts, "all", "missing"), null, "no matching graph selection must stay empty until a qualified default is applied");

assert.equal(chartUnavailable("return"), "暂不可用");
assert.equal(chartUnavailable("assets"), "暂无资产记录");
assert.equal(chartRangeEmptyNote("all").key, "暂无资产记录");
assert.equal(runtimeBusinessDate(Date.parse("2026-09-29T01:00:00Z")), "2026-09-28");
assert.equal(runtimeBusinessDate(Date.parse("2026-09-29T12:00:00Z")), "2026-09-29");

assert.equal(totalsUnavailableDetail("physical_identity_unverified"), "实物账户尚未完成去重，暂不合计");
assert.equal(formatAccountFactAmounts([
  { currency: "USD", net_assets: "0", available_cash: "-0.000" },
  { currency: "HKD", net_assets: "-0.00000001", available_cash: "0" },
  { currency: "JPY", net_assets: "0.00000001", available_cash: "0.00000001" },
  { currency: "EUR", net_assets: "0.00000000", available_cash: "12.5" },
], "net_assets"), "HKD -0.00000001 · JPY 0.00000001");
assert.equal(formatAccountFactAmounts([
  { currency: "USD", available_cash: "-0.00000001" },
  { currency: "HKD", available_cash: "0" },
  { currency: "JPY", available_cash: "0.00000001" },
  { currency: "EUR", available_cash: "12.5" },
], "available_cash"), "USD -0.00000001 · JPY 0.00000001 · EUR 12.5");
assert.equal(hasNonzeroNegativeAccountFactAmount([{ available_cash: "-0.00000001" }], "available_cash"), true);
assert.equal(hasNonzeroNegativeAccountFactAmount([{ available_cash: "-0.000" }], "available_cash"), false);
assert.equal(hasNonzeroNegativeAccountFactAmount([{ available_cash: "-0.01" }], "cash_balance"), false);
assert.equal(formatAccountFactAmounts([
  { currency: "USD", net_assets: "0" },
  { currency: "HKD", net_assets: "-0.000" },
], "net_assets"), "0");
assert.equal(formatAccountFactAmounts([], "net_assets"), null);
assert.equal(accountFactsDetail(null), "尚未取得账户资产资料");
assert.equal(accountFactsDetail({
  platform: "longbridge",
  account_key: "lb-paper",
  binding_status: "bound",
  identity_status: "partial_identity",
  data_status: "stale",
  target_id: "paper",
  source_binding_id: "a".repeat(64),
  observation_date: "2026-09-28",
  observed_started_at: "2026-09-28T10:00:00Z",
  observed_finished_at: "2026-09-28T10:01:00Z",
  balances: [],
  cash: [],
  return: { status: "unavailable", reason: "external_cashflow_required" },
}), "账户资产资料已过期");

const longbridgePaperSnapshot = {
  ok: true,
  date: "2026-09-29",
  timezone: "America/New_York",
  account_key: "paper",
  data_status: "fresh",
  record: {
    ...RUNTIME_DAILY_TARGET,
    status: "submitted",
    kind: "run",
    execution_lane: "paper",
    business_date: "2026-09-29",
    observed_at: "2026-09-29T10:00:00Z",
    schedule: { state: "due", expected_window: "inside" },
    runs: [{ run_id: "r1", started_at: "2026-09-29T09:00:00Z", finished_at: "2026-09-29T09:05:00Z", activity: "submitted", execution_lane: "paper", errors_present: false }],
  },
  fills: { source: "not_connected", records: [], count: null },
};

const unmatched = presentRuntimeDaily(longbridgePaperSnapshot, {
  platform: "longbridge",
  accountKey: "other-account",
  dailyBinding: "not_applicable",
});
assert.equal(unmatched.accountMatched, false);
assert.equal(unmatched.fillsLabel, "未接入");
assert.doesNotMatch(unmatched.statusDetails.join(" "), /LongBridge|not_connected|source-binding/);

// Same key on Binance must not consume LongBridge runtime-daily.
const crossPlatform = presentRuntimeDaily(longbridgePaperSnapshot, {
  platform: "binance",
  accountKey: "paper",
  dailyBinding: "not_applicable",
});
assert.equal(runtimeDailySelectionEligible({ platform: "binance", accountKey: "paper" }), false);
assert.equal(crossPlatform.accountMatched, false);
assert.equal(crossPlatform.statusLabel, "未接入");
assert.equal(crossPlatform.fillsLabel, "未接入");
assert.equal(crossPlatform.runStartedAt, null);
assert.equal(crossPlatform.dataStatusLabel, "—");

// Missing platform must not default to LongBridge and allow the snapshot through.
const missingPlatform = presentRuntimeDaily(longbridgePaperSnapshot, {
  platform: null,
  accountKey: "paper",
  dailyBinding: "not_applicable",
});
assert.equal(runtimeDailySelectionEligible({ platform: null, accountKey: "paper" }), false);
assert.equal(missingPlatform.accountMatched, false);
assert.equal(missingPlatform.statusLabel, "待确认");
assert.equal(missingPlatform.fillsLabel, "暂无数据");

const submitted = presentRuntimeDaily({
  ...longbridgePaperSnapshot,
  account_key: "lb-paper",
}, { platform: "longbridge", accountKey: "lb-paper", dailyBinding: "bound" });
assert.equal(submitted.accountMatched, true);
assert.equal(submitted.statusLabel, "已提交");
assert.deepEqual(submitted.statusDetails, []);
assert.equal(submitted.dryRun, false);
assert.equal(submitted.fillsLabel, "未接入");

const dryRun = presentRuntimeDaily({
  ok: true,
  date: "2026-09-29",
  timezone: "America/New_York",
  account_key: "lb-paper",
  data_status: "historical",
  record: {
    ...RUNTIME_DAILY_TARGET,
    status: "dry_run",
    kind: "run",
    execution_lane: "dry_run",
    business_date: "2026-09-29",
    observed_at: "2026-09-29T10:00:00Z",
    runs: [{ run_id: "r2", started_at: "2026-09-29T09:00:00Z", finished_at: null, activity: "no_action", execution_lane: "dry_run", errors_present: false }],
  },
  fills: { source: "not_connected", records: [], count: null },
}, { platform: "longbridge", accountKey: "lb-paper", dailyBinding: "bound" });
assert.equal(dryRun.dryRun, true);
assert.equal(dryRun.statusLabel, "只读演练");
assert.deepEqual(dryRun.statusDetails, []);
assert.equal(dryRun.runStartedAt, "2026-09-29T09:00:00Z");
assert.equal(dryRun.runFinishedAt, null);

// Stale LongBridge payload must not surface after selecting another platform with the same key.
const staleAfterSwitch = presentRuntimeDaily(longbridgePaperSnapshot, {
  platform: "binance",
  accountKey: "paper",
  dailyBinding: "not_applicable",
});
assert.equal(staleAfterSwitch.accountMatched, false);
assert.equal(staleAfterSwitch.statusLabel, "未接入");
assert.equal(staleAfterSwitch.runStartedAt, null);

assert.equal(overviewAccountTypeLabel(), "账户类型待确认");
const schwabNativeType = { value: "MARGIN", source_tag: "securitiesAccount.type" };
assert.equal(verifiedSchwabAccountTypeToken("schwab", "fresh", schwabNativeType), "MARGIN");
assert.equal(verifiedSchwabAccountTypeToken("schwab", "stale", schwabNativeType), null);
assert.equal(verifiedSchwabAccountTypeToken("schwab", "fresh", undefined), null);
assert.equal(verifiedSchwabAccountTypeToken("ibkr", "fresh", schwabNativeType), null);
assert.equal(verifiedSchwabAccountTypeToken("schwab", "fresh", { ...schwabNativeType, raw: "extra" }), null);
for (const invalidToken of ["MARGIN\n", "CASH\r\n", "CASH\u2028", "CASH\u2029"]) {
  assert.equal(verifiedSchwabAccountTypeToken("schwab", "fresh", {
    value: invalidToken,
    source_tag: "securitiesAccount.type",
  }), null);
}
assert.equal(formatAccountFactAmounts([{ currency: "USD", cash_balance: "250.75" }], "cash_balance"), "USD 250.75");
assert.equal(overviewCardStatusDetail("运行目标映射重复，无法唯一匹配"), null);
assert.equal(overviewCardStatusDetail("账户类型为账户设置标记，未由券商原生核实"), null);
assert.equal(overviewCardStatusDetail("账户运行异常"), "账户运行异常");
assert.equal(formatOverviewInstant("2026-09-29T01:00:00.123Z", "zh", "America/New_York"), formatLocalChangeTime(Date.parse("2026-09-29T01:00:00.123Z"), "zh", "America/New_York"));
assert.doesNotMatch(formatOverviewInstant("2026-09-29T01:00:00.123Z", "zh", "America/New_York") || "", /\.\d{3}Z/);
const shortObserved = formatOverviewShortInstant("2026-09-29T01:00:00Z", "en", "America/New_York");
assert.match(shortObserved || "", /09\/28/);
assert.match(shortObserved || "", /21:00/);
assert.doesNotMatch(shortObserved || "", /2026|America\/New_York/,
  "compact time uses the existing timezone without leaving the long IANA name on the card");

const overview = readFileSync(join(root, "web/strategy-switch-console/frontend/src/OverviewPage.tsx"), "utf8");
const apiSource = readFileSync(join(root, "web/strategy-switch-console/frontend/src/api.ts"), "utf8");
const overviewStyles = readFileSync(join(root, "web/strategy-switch-console/frontend/src/styles.css"), "utf8");
assert.match(overview, /historyEpoch/);
assert.match(overview, /useState\("all"\)/);
assert.match(overview, /const visible = accountId === "all" \? displayAccounts : displayAccounts\.filter/);
assert.match(overview, /facts: accountFactsForDisplay\(account\.facts, factsNow\)/, "all visible amount/type/detail reads share the local expiry projection");
assert.match(overview, /const totalAssets = accountId === "all"/);
assert.match(overview, /const totalCash = accountId === "all"/);
assert.doesNotMatch(overview, /chartAccountId|图表账户/);
assert.match(overview, /const chartAccount = selectedAccount/);
assert.match(overview, /loadAccountFactsHistory\(chartAccount\.platformKey, chartAccount\.accountKey, currency\)/);
assert.match(overview, /loadBinanceWalletHistory\(chartAccount\.accountKey\)/);
assert.match(overview, /buildBinanceWalletHistoryChartGeometry/);
assert.match(overview, /钱包总资产变化（USDT）/);
assert.match(overview, /按 Binance 返回的钱包范围/);
assert.match(overview, /walletChartSelected\s*\? <details className="overview-wallet-details"><summary>\{t\("数据范围"\)\}/,
  "wallet chart scope is accessible in a disclosure instead of repeating permanent copy");
assert.match(overview, /binanceFacts\?\.value\?\.report\?\.observed_finished_at/);
const walletHistoryLoadStart = overview.indexOf("setHistory(null);\n    setWalletHistory(null);\n    setHistoryError(null);\n    setHistoryLoading(true);");
const walletHistoryRequest = overview.indexOf("loadBinanceWalletHistory(chartAccount.accountKey)");
assert.ok(walletHistoryLoadStart >= 0 && walletHistoryLoadStart < walletHistoryRequest,
  "switching/refetching chart history clears the previous wallet points before awaiting new data");
assert.match(apiSource, /\/api\/binance-account-facts\/history\?account_key=/);
assert.doesNotMatch(overview, /walletHistory\.points[\s\S]{0,160}net_assets/,
  "Binance wallet amounts stay separate from the account NAV field");
assert.match(overview, /formatBinanceWalletAmount\(walletCardValuation\.amount\)/);
assert.match(overview, /selectedWalletValuation\s*\?\s*formatBinanceWalletAmount\(selectedWalletValuation\.amount\)/,
  "a qualified selected Binance wallet valuation supplies the main asset metric");
assert.match(overview, /showSelectedCashMetric = !selectedWalletValuation \|\| totalCash !== null/,
  "the Binance cash metric stays visible only when an actual cash value exists");
assert.match(overview, /showWallet && !walletValuation[\s\S]{0,140}id="binance-account-facts-board"/,
  "the native-quantity panel remains only when the wallet valuation is unavailable");
const walletCardSource = overview.slice(overview.lastIndexOf("visible.map(account => {"));
assert.match(walletCardSource, /<\/button>[\s\S]*?\{walletCardValuation \? <BinanceWalletDetails/,
  "keyboard-operable details stay outside the account navigation button");
assert.match(walletCardSource, /amount=\{walletCardValuation\.amount\}[\s\S]{0,220}observedAt=\{walletCardValuation\.observed_at\}/,
  "full source amount and observation timestamp remain available in details");
assert.match(overview, /function BinanceQuantity[\s\S]{0,260}<summary title=\{amount\}[\s\S]{0,120}\{display\}[\s\S]{0,100}<span><em>\{originalLabel\}<\/em>\{amount\}/,
  "native quantity details expose both the compact value and the original precision");
assert.match(overview, /overview-figures-wallet/);
assert.match(overview, /!walletCardValuation \? <span>[\s\S]{0,180}amountOrDash\(cash\)/,
  "cash column shows the plain cash amount without financing classification tip");
assert.match(overview, /<BinanceQuantity amount=\{item\.spot_free\} originalLabel=\{t\("原始值"\)\}/);
assert.match(overview, /account\.facts\.binding_status === "bound" && account\.facts\.identity_mismatch !== true/,
  "cash negative styling stays gated on fresh, uniquely bound identity");
assert.match(overview, /const verifiedFreshCashRows = account\.facts\?\.data_status === "fresh"[\s\S]{0,150}identity_mismatch !== true/);
assert.doesNotMatch(overview, /融资占用（已核实）|负现金未核实|可能是借的钱|融资状态待确认|cashSignText|classifyAccountCashSign|cashSignNote/,
  "overview cash shows amount only; financing classification stays off the page");
assert.match(overviewStyles, /\.overview-figures-wallet \{ grid-template-columns: minmax\(0, 1fr\); \}/);
assert.match(overviewStyles, /\.wallet-card-valuation strong \{ white-space: nowrap; overflow-wrap: normal;/,
  "wallet total gets a full-width non-wrapping amount instead of sharing a narrow cash column");
// Daily response isolation is exercised by overview_refresh_validation.mjs;
// presentation checks do not require a particular cancellation implementation.
assert.match(overview, /runtimeDateBounds/);
const runtimeDateLabel = "业务日期（纽约业务日，America/New_York）";
assert.equal(translate(runtimeDateLabel, "zh"), runtimeDateLabel);
assert.equal(translate(runtimeDateLabel, "en"), "Business date (New York business day, America/New_York)");
assert.equal(translate("运行计划资料未确认", "en"), "Run schedule evidence is unconfirmed");
assert.equal(translate("周期记录不完整，结果待确认", "en"), "Cycle record is incomplete; result is unconfirmed");
assert.equal(translate("重复账户配置键 {count} 组已去重；资料冲突的 {conflicts} 组不计金额。", "en", { count: 2, conflicts: 1 }),
  "Repeated account configuration keys (2 groups) are counted once; conflicting groups excluded from amounts: 1.");
assert.match(overview, /const runtimeDateLabel = "业务日期（纽约业务日，America\/New_York）"/);
assert.match(overview, /<span>\{t\(runtimeDateLabel\)\}<\/span>\s*<input type="date" aria-label=\{t\(runtimeDateLabel\)\}/,
  "the daily runtime date picker and its accessible name both identify the New York business day");
assert.match(overview, /runtimeDailySelectionEligible/);
assert.match(overview, /platform:\s*account\.platformKey/);
assert.match(overview, /accountNativeReadout/);
assert.match(overview, /overviewRuntimeHealth/);
assert.doesNotMatch(walletCardSource.slice(walletCardSource.indexOf("<button"), walletCardSource.indexOf("</button>")), /<details/, "disclosures stay outside the navigation button");
assert.match(overview, /formatOverviewInstant/);
assert.match(overview, /setHistory\(null\)/);
assert.match(overview, /setRuntimeDaily\(\{\}\)/, "invalid or unbound selections clear every account/date slot");
assert.doesNotMatch(overview, /only_cash|假比较|forged_return/);
assert.doesNotMatch(overview, /t\(account\.environmentSource\)|account\.environmentSource/);
assert.doesNotMatch(overview, /t\(account\.environment\)|t\(account\.statusDetail\)/);
assert.doesNotMatch(overview, /source-binding|partial_identity|not_connected|未知不等于零|尚未接通|外部资金流未接入|原金额保留字符串|不保留旧|未由券商原生核实|映射重复/);
assert.match(overview, /已取得资产合计（不含已标记模拟账户）/);
assert.match(overview, /汇总自 \{date\}（Asia\/Shanghai）起计算/);
assert.doesNotMatch(overview, /全部账户只显示最新分币种估值；历史变化需选择单个账户。/);
assert.match(overview, /暂无资产记录|chartUnavailable/);

console.log("account_history_presentation_validation ok");

// The same CI entry now checks real React output with the existing source validators.
await import("./overview_account_metadata_validation.mjs");
