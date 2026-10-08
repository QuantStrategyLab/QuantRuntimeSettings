import assert from "node:assert/strict";
import "./account_native_display_validation.mjs";
import { readFileSync } from "node:fs";
import { confirmationAccepted, recoveryBinding } from "../web/strategy-switch-console/frontend/src/operations.ts";
import { translate } from "../web/strategy-switch-console/frontend/src/locales.ts";
import { longBridgeCashDetails } from "../web/strategy-switch-console/frontend/src/types.ts";
import { nextExplicitTheme, resolveTheme } from "../web/strategy-switch-console/frontend/src/theme.js";
import { CHART_RANGE_OPTIONS, DEFAULT_CHART_RANGE, RETURN_INDEX_LEGEND, accountDisplayTitle, accountIdentity, accountStatusView, activationFromProjection, adminDirectoryTitle, brokerAccountType, cashDraftDirty, chartRangeNote, chartUnavailable, dcaSettingsReadout, decisionActionState, environmentEditState, formatAccountIdentity, formatLocalChangeTime, knownAccountLabel, humanDecisionQueue, listDailyDecisions, mergeAdminFields, overviewFigures, overviewRuntimeStatusLabel, paperApplicationAccounts, paperApplicationActionable, paperApplicationReady, paperApplicationUnresolved, changeAccountName, decimalUnitRatio, percentTextToRatio, preferenceDirty, ratioTextToPercent, readOnlyLayerState, recentUserChanges, reservedCashAmount, reservedCashEditor, routeAfterDirtyPrompt, safeActionVisibility, strategyDisplayName, strategyNote, strategyOccupiedNames, unnamedDecisionOrdinal } from "../web/strategy-switch-console/frontend/src/presentation.ts";

const monitored = { scope: "monitoring_only", limit: "not_trading_or_books", health: "normal", activation: "enabled", reason: "monitoring_agrees" };
const longBridgeFixture = {
  platform: "longbridge", account_key: "synthetic-account", binding_status: "bound", identity_status: "partial_identity",
  data_status: "fresh", identity_mismatch: false, observed_finished_at: "2026-10-03T01:02:03Z",
  balances: [{ currency: "HKD", net_assets: null, total_cash: "100.00000001" }],
  cash: [{ currency: "HKD", available_cash: "-0.125", frozen_cash: "0.00000003", settling_cash: "2.5" }],
};
assert.deepEqual(longBridgeCashDetails(longBridgeFixture), [{ currency: "HKD", total_cash: "100.00000001", available_cash: "-0.125", frozen_cash: "0.00000003", settling_cash: "2.5" }]);
assert.deepEqual(longBridgeCashDetails({ ...longBridgeFixture, balances: [], cash: [{ currency: "HKD", frozen_cash: "2" }] }), [{ currency: "HKD", frozen_cash: "2" }], "missing cash fields are omitted without hiding present fields");
assert.deepEqual(longBridgeCashDetails({ ...longBridgeFixture, balances: [{ currency: "HKD", net_assets: null, total_cash: "7.25" }], cash: [] }), [{ currency: "HKD", total_cash: "7.25" }]);
assert.deepEqual(longBridgeCashDetails({ ...longBridgeFixture, balances: [], cash: [{ currency: "HKD", settling_cash: "3.5" }] }), [{ currency: "HKD", settling_cash: "3.5" }]);
assert.deepEqual(longBridgeCashDetails({ ...longBridgeFixture, cash: [{ currency: "HKD", available_cash: "-0.00000001" }] }), [{ currency: "HKD", total_cash: "100.00000001", available_cash: "-0.00000001" }]);
for (const rejected of [
  { ...longBridgeFixture, data_status: "stale" },
  { ...longBridgeFixture, binding_status: "missing" },
  { ...longBridgeFixture, binding_status: "duplicate" },
  { ...longBridgeFixture, identity_mismatch: true },
  { ...longBridgeFixture, observed_finished_at: "not-a-date" },
  { ...longBridgeFixture, platform: "ibkr" },
  { ...longBridgeFixture, cash: [...longBridgeFixture.cash, ...longBridgeFixture.cash] },
  { ...longBridgeFixture, balances: [...longBridgeFixture.balances, ...longBridgeFixture.balances] },
]) assert.equal(longBridgeCashDetails(rejected), null);
assert.equal(activationFromProjection(monitored), "已启用");
assert.equal(translate("API账户类型：现货", "en"), "API account type: Spot");
assert.equal(translate("账户类型来源详情", "en"), "Account type source details");
assert.equal(activationFromProjection({ ...monitored, activation: "disabled" }), "已停用");
assert.equal(activationFromProjection({ configured_state: "disabled" }), "—");
assert.equal(activationFromProjection(null), "—");
assert.equal(activationFromProjection({ activation: null }), "—");
assert.equal(activationFromProjection({ activation: false }), "—");
assert.equal(activationFromProjection({ activation: 0 }), "—");
assert.equal(accountStatusView(null).label, "—");
assert.deepEqual(accountStatusView({ configured_state: "disabled" }), { label: "—", detail: "暂未取得状态" });
assert.deepEqual(accountStatusView({ scope: "monitoring_only", limit: "not_trading_or_books", health: "unknown", activation: "unknown", reason: "source_not_fresh" }, "stale"), { label: "—", detail: "运行状态来源已过期" });
assert.notEqual(activationFromProjection(monitored), "—");
const waitingCycle = { ...monitored, health: "unknown", reason: "check_not_due" };
assert.equal(overviewRuntimeStatusLabel(waitingCycle, "ready"), "等待周期");
assert.equal(accountStatusView(waitingCycle, "ready").label, "等待周期", "settings distinguishes an explicit not-due check from missing evidence without promoting health to normal");
for (const freshness of [undefined, null, "stale", "unavailable"]) {
  assert.equal(overviewRuntimeStatusLabel(waitingCycle, freshness), "待确认");
  assert.notEqual(accountStatusView(waitingCycle, freshness).label, "等待周期");
}
for (const override of [{ activation: "unknown" }, { activation: "disabled" }, { reason: "evidence_insufficient" }, { scope: "invalid" }, { limit: "invalid" }]) {
  assert.equal(overviewRuntimeStatusLabel({ ...waitingCycle, ...override }, "ready"), "待确认");
  assert.notEqual(accountStatusView({ ...waitingCycle, ...override }, "ready").label, "等待周期");
}
assert.equal(overviewRuntimeStatusLabel({ ...waitingCycle, health: "abnormal", reason: "retained_attention" }, "ready"), "异常");
assert.equal(overviewRuntimeStatusLabel(monitored, "ready"), "监测正常");
assert.equal(overviewRuntimeStatusLabel({ ...monitored, activation: "disabled" }, "ready"), "已停用");

assert.equal(knownAccountLabel({ longbridge: [{ key: "hk", target_name: "hk", label: "港股账户" }] }, "longbridge", "hk"), "港股账户");
assert.equal(knownAccountLabel({ longbridge: [{ key: "hk", target_name: "hk" }] }, "longbridge", "hk"), "");
assert.equal(knownAccountLabel({ longbridge: [{ key: "hk", label: "甲" }, { key: "other", target_name: "hk", label: "乙" }] }, "longbridge", "hk"), "");
assert.equal(knownAccountLabel(null, "longbridge", "hk"), "");

const mixed = overviewFigures(2, ["CAPITAL_PRESERVATION", "GROWTH_COMPOUNDING", false, 0, null, ""]);
assert.equal(mixed.assets, null);
assert.equal(mixed.cash, null);
assert.equal(mixed.annualReturn, null);
assert.equal(mixed.maxDrawdown, null);
assert.equal(mixed.series, null);
assert.equal(mixed.riskPreference, null);
assert.equal(overviewFigures(0, []).accountCount, 0);
assert.equal(overviewFigures(null, []).accountCount, null);
assert.equal(overviewFigures(1, ["BALANCED_COMPOUNDING"]).riskPreference, "BALANCED_COMPOUNDING");
assert.equal(overviewFigures(2, ["CAPITAL_PRESERVATION", null]).riskPreference, null);
assert.equal(overviewFigures(2, ["GROWTH_COMPOUNDING", ""]).riskPreference, null);
const accountsPage = readFileSync(new URL("../web/strategy-switch-console/frontend/src/AccountsPage.tsx", import.meta.url), "utf8");
assert.match(accountsPage, /dcaSettingsReadout\(settings\?\.effective\)/);
assert.equal(accountsPage.includes("保存定投"), false);
assert.match(accountsPage, /item\.dca_supported === true/);
assert.match(accountsPage, /t\("定投设置"\)/);
assert.match(accountsPage, /saveScoped\("strategy"/);
assert.match(accountsPage, /maxLength=\{32\}/);
assert.equal(dcaSettingsReadout(null), null);
assert.equal(dcaSettingsReadout({ strategy_profile: { status: "known", value: "russell_top50_leader_rotation" } }), null);
assert.equal(dcaSettingsReadout({ strategy_profile: { status: "known", value: "crypto_btc_dca" } }), null);
assert.deepEqual(dcaSettingsReadout({
  dca_mode: { status: "known", value: "smart" },
  dca_base_investment_usd: { status: "known", value: "250" },
}), { label: "当前设置", mode: "智能定投", amount: "250" });
assert.deepEqual(dcaSettingsReadout({
  dca_mode: { status: "known", value: "fixed" },
  dca_base_investment_usd: { status: "known", value: "80" },
}), { label: "当前设置", mode: "定额定投", amount: "80" });
assert.deepEqual(dcaSettingsReadout({
  dca_mode: { status: "unknown" },
  dca_base_investment_usd: { status: "unknown", value: "1000" },
}), { label: "当前设置", mode: "未核实", amount: "未核实" });
assert.deepEqual(dcaSettingsReadout({
  dca_mode: { status: "known", value: "weekly" },
  dca_base_investment_usd: { status: "known", value: "0" },
}), { label: "当前设置", mode: "未核实", amount: "未核实" });
assert.equal(chartUnavailable("return"), "暂不可用");
assert.equal(chartUnavailable("assets"), "暂无资产记录");
assert.deepEqual([...RETURN_INDEX_LEGEND], ["标普500", "纳斯达克100", "道琼斯工业平均指数", "罗素2000"]);
const overviewPage = readFileSync(new URL("../web/strategy-switch-console/frontend/src/OverviewPage.tsx", import.meta.url), "utf8");
assert.doesNotMatch(overviewPage, /fred\.stlouisfed\.org/);
assert.match(overviewPage, /市场基准不是账户收益。/);
assert.match(overviewPage, /MARKET_BENCHMARK_INCEPTION_DATE/);
assert.match(overviewPage, /className="benchmark-chart-line"/);
assert.ok(overviewPage.indexOf("市场基准") < overviewPage.indexOf("账户收益覆盖"), "the benchmark chart is drawn before account returns");
const overviewStyles = readFileSync(new URL("../web/strategy-switch-console/frontend/src/styles.css", import.meta.url), "utf8");
assert.match(overviewStyles, /\.benchmark-chart-start[^\{]*\{[^}]*height: 72px/);
assert.match(overviewPage, /<details className="overview-benchmark-source">/);
assert.match(overviewPage, /同窗口基准比较暂不可用/);
assert.match(overviewPage, /券商原生时间加权收益率/);
assert.match(overviewPage, /暂无合格期间收益记录/);
assert.match(overviewPage, /RETURN_INDEX_LEGEND\.map/);
assert.doesNotMatch(overviewPage, /数据来源与网站使用权限待核/);
assert.match(overviewPage, /aria-label=\{chart === "return" \? t\("收益率"\) : t\("总资产"\)\}/);
assert.match(overviewPage, /<option value="all">\{t\("全部账户"\)\}<\/option>/);
assert.doesNotMatch(overviewPage, /overview-stats|chartAccountId/);
assert.match(overviewPage, /chart === "assets" \? <div className="chart-range"/);
assert.equal(overviewPage.includes('id: "cash"'), false);
assert.equal(overviewPage.includes("account.platform} · {account.title}"), false);
assert.equal(overviewPage.includes("QQQ"), false);
assert.equal(overviewPage.includes("Top50"), false);
assert.equal(accountDisplayTitle({ label: "  ", key: "internal-key" }, "Longbridge", "模拟账户环境"), "账户");
assert.equal(accountDisplayTitle({ label: "我的港股" }, "Longbridge", "模拟账户环境").includes("internal"), false);
assert.equal(accountDisplayTitle({ label: "我的港股" }, "Longbridge", "模拟账户环境"), "我的港股");
const occupied = strategyOccupiedNames([{ profile: "soxl", label: "SOXL", label_zh: "SOXL 策略", label_en: "SOXL strategy" }, { profile: "global", label: "GlobalETF", label_zh: "全球ETF", label_en: "Global ETF" }], "tqqq", "TQQQ");
assert.equal(accountDisplayTitle({ label: "SOXL", key: "live" }, "Binance", "", occupied), "账户 · live");
assert.equal(accountDisplayTitle({ label: "GlobalETF", key: "paper" }, "IBKR", "", occupied), "账户 · paper");
assert.equal(accountDisplayTitle({ label: "Binance", key: "default" }, "Binance", "", occupied), "账户");
assert.equal(accountDisplayTitle({ label: "SG", key: "sg" }, "Longbridge", "", occupied), "账户 · SG");
assert.equal(accountDisplayTitle({ key: "hk" }, "Longbridge", "", occupied), "账户 · hk");
assert.equal(accountDisplayTitle({ key: "firstrade" }, "Firstrade", "", occupied), "账户 · firstrade");
const binanceRoute = { key: "crypto_combo", target_name: "crypto_combo" };
assert.equal(accountDisplayTitle(binanceRoute, "Binance", "", occupied), "账户 · live");
assert.equal(binanceRoute.key, "crypto_combo");
assert.equal(binanceRoute.target_name, "crypto_combo");
assert.equal(accountDisplayTitle({ key: "crypto_combo" }, "Firstrade", "", occupied), "账户 · crypto_combo");
assert.equal(accountDisplayTitle({ label: "soxl", account_selector: "U12345678" }, "IBKR", "", occupied), "U12345678");
assert.equal(accountDisplayTitle({ label: "soxl", key: "hk", account_selector: "" }, "IBKR", "", occupied), "账户 · hk");
assert.equal(accountDisplayTitle({ label: "soxl", key: "hk", account_selector: "U12345678, U87654321" }, "IBKR", "", occupied), "账户 · hk");
assert.equal(accountDisplayTitle({ account_selector: "U12345678, U87654321" }, "IBKR", "").includes("5678"), false);
assert.equal(accountIdentity({ account_selector: "U12345678, U87654321" }, "IBKR", "").kind, "generic");
const english = (key, values) => translate(key, "en", values || {});
assert.equal(formatAccountIdentity(accountIdentity({ label: "SOXL", key: "live" }, "Binance", "", occupied), english), "Account · live");
assert.equal(formatAccountIdentity(accountIdentity({ account_selector: "U12345678", label: "soxl" }, "IBKR", "", occupied), english), "U12345678");
assert.equal(formatAccountIdentity(accountIdentity({ label: "我的港股" }, "Longbridge", "", occupied), english), "我的港股");
assert.equal(formatAccountIdentity(accountIdentity({ key: "internal-key" }, "Longbridge", "", occupied), english), "Account");
const catalogWithoutShortNames = strategyOccupiedNames([
  { profile: "soxl_soxx_trend_income", label: "半导体趋势收益", label_zh: "半导体趋势收益", label_en: "Semiconductor Trend Income" },
  { profile: "tqqq_growth_income", label: "纳斯达克增长收益", label_zh: "纳斯达克增长收益", label_en: "NASDAQ Growth Income" },
  { profile: "global_etf_rotation", label: "全球ETF轮动", label_zh: "全球ETF轮动", label_en: "Global ETF Rotation" },
  { profile: "russell_top_50", label: "罗素前50", label_zh: "罗素前50", label_en: "Russell Leaders" },
]);
assert.equal(catalogWithoutShortNames.some(name => ["soxl", "tqqq", "global etf", "russell top 50"].includes(name.toLowerCase())), false);
for (const label of ["soxl", "tqqq", "Global ETF", "Russell Top 50"]) {
  assert.equal(accountDisplayTitle({ label, account_selector: "U12345678" }, "IBKR", "", catalogWithoutShortNames), "U12345678");
  assert.equal(accountDisplayTitle({ label, account_selector: "U12345678" }, "IBKR", "", catalogWithoutShortNames).includes("U12345678"), true);
}
assert.equal(accountDisplayTitle({ label: "退休账户", account_selector: "U12345678" }, "IBKR", "", catalogWithoutShortNames), "退休账户");
assert.equal(accountDisplayTitle({ label: "Global ETF Rotation", account_selector: "U12345678" }, "IBKR", "", []), "Global ETF Rotation");
assert.equal(accountDisplayTitle({ label: "soxl" }, "IBKR", "", catalogWithoutShortNames), "soxl");
assert.equal(accountDisplayTitle({ label: "退休账户", account_selector: "U12345678" }, "IBKR", ""), "退休账户");
assert.equal(formatAccountIdentity(accountIdentity({ label: "退休账户", account_selector: "U12345678" }, "IBKR", ""), english), "退休账户");
assert.equal(accountDisplayTitle({ label: "soxl", account_selector: "U12345678" }, "Binance", "", occupied), "账户");
assert.equal(accountDisplayTitle({ label: "U12345678", account_selector: "U12345678" }, "IBKR", ""), "U12345678");
assert.equal(accountDisplayTitle({ label: "U12345678" }, "IBKR", "").includes("U12345678"), false);
assert.equal(accountDisplayTitle({ label: "U12345678", account_selector: "U12345678" }, "Longbridge", ""), "账户");
assert.equal(accountDisplayTitle({ label: "U12345678", account_selector: "U12345678" }, "Longbridge", "").includes("12345678"), false);
assert.equal(accountDisplayTitle({ label: "U12345678", account_selector: "U12345678, U87654321" }, "IBKR", "").includes("5678"), false);
assert.deepEqual(CHART_RANGE_OPTIONS.map(item => item.id), ["3m", "6m", "1y", "3y", "5y", "10y", "all"]);
assert.deepEqual(CHART_RANGE_OPTIONS.map(item => item.label), ["3个月", "半年", "1年", "3年", "5年", "10年", "至今"]);
assert.equal(DEFAULT_CHART_RANGE, "1y");
assert.equal(chartRangeNote("1y").rangeLabel, "1年");
assert.equal(chartRangeNote("all").key, "暂无资产记录");
assert.equal(chartRangeNote("3m").key, "{range}内暂无资产记录");
assert.equal(chartRangeNote("6m").rangeLabel, "半年");
for (const option of CHART_RANGE_OPTIONS) {
  const note = chartRangeNote(option.id);
  assert.equal(/\d{4}-\d{2}-\d{2}|series|\[/.test(`${note.key} ${note.rangeLabel}`), false);
}
assert.equal(overviewFigures(1, ["BALANCED_COMPOUNDING"]).series, null);
assert.equal(resolveTheme("system", false), "light");
assert.equal(resolveTheme("system", true), "dark");
assert.equal(nextExplicitTheme(resolveTheme("system", false)), "dark");
assert.equal(nextExplicitTheme(resolveTheme("system", true)), "light");
assert.equal(nextExplicitTheme("dark"), "light");
assert.equal(unnamedDecisionOrdinal([{ id: "a", title: "未命名策略" }, { id: "b", title: "未命名策略" }], { id: "b", title: "未命名策略" }), 2);
assert.equal(unnamedDecisionOrdinal([{ id: "a", title: "未命名策略" }], { id: "a", title: "未命名策略" }), 0);

assert.equal(preferenceDirty(null, ""), false);
assert.equal(preferenceDirty(false, ""), false);
assert.equal(preferenceDirty(0, ""), false);
assert.equal(preferenceDirty("CAPITAL_PRESERVATION", "CAPITAL_PRESERVATION"), false);
assert.equal(preferenceDirty("CAPITAL_PRESERVATION", "GROWTH_COMPOUNDING"), true);
assert.equal(cashDraftDirty({ floorTouched: false, clearFloor: false }), false);
assert.equal(cashDraftDirty({ floorTouched: true, clearFloor: false }), true);
assert.equal(cashDraftDirty({ floorTouched: false, clearFloor: true }), true);
assert.equal(readOnlyLayerState(undefined), "unknown");
assert.equal(readOnlyLayerState({ status: "unknown" }), "unknown");
assert.equal(readOnlyLayerState({ status: "known", value: false }), "off");
assert.equal(readOnlyLayerState({ status: "known", value: true }), "on");
assert.equal(readOnlyLayerState(false), "unknown");
assert.equal(reservedCashAmount({ status: "unknown" }), null);
assert.equal(reservedCashAmount({ status: "known", value: "0" }), "0");
assert.equal(reservedCashAmount({ status: "known", value: "0.10" }), "0.10");

const ready = (value) => ({ error: null, value: { data_status: "ready", ...value } });
const blocked = listDailyDecisions({ language: "zh", profiles: [], promotions: { error: new Error("down") }, owners: ready({ candidates: [] }), recovery: ready({ recoveries: [] }), accountsFor: () => [] });
assert.equal(blocked.blocked, true);
assert.deepEqual(blocked.items, []);
const empty = listDailyDecisions({ language: "zh", profiles: [], promotions: ready({ tickets: [] }), owners: ready({ candidates: [] }), recovery: ready({ recoveries: [] }), accountsFor: () => [] });
assert.equal(empty.blocked, false);
assert.deepEqual(empty.items, []);

assert.equal(humanDecisionQueue([{ kind: "promotion", title: "未命名策略", reference: "a", proposedName: "未命名策略", comparisonReady: true, shadowReady: true }]).length, 0);
assert.equal(humanDecisionQueue([{ kind: "promotion", title: "方案", reference: "smoke-4", proposedName: "方案", shadowReady: true }]).length, 0);
assert.equal(humanDecisionQueue([{ kind: "promotion", title: "方案", reference: "promo", proposedName: "方案" }]).length, 0);
assert.equal(humanDecisionQueue([{ kind: "promotion", title: "方案", reference: "promo", proposedName: "方案", shadowReady: true }]).length, 1);
assert.equal(humanDecisionQueue([{ kind: "recovery", title: "恢复核对", reference: "r", proposedName: "确认材料" }]).length, 1);

const comparison = { status: "unavailable", start_date: null, end_date: null, cost_model: "", baseline: null, candidate: null };
const ticket = {
  decision_binding: { kind: "promotion", subject_id: "promo-1", material_sha256: "a".repeat(64), review_binding: { schema_version: "qsl_promotion_review_binding.v2", review_sha256: "b".repeat(64) } },
  ticket_id: "promo-1", strategy_profile: "demo", domain: "us_equity", state: "awaiting_human",
  proposed_params: { a: 2 }, shadow_evidence_kind: "paired_shadow", shadow_passed: true, notes: [],
  research_summary: {
    strategy_profile: "demo", comparison, limitations: ["限制在材料里"],
    ai_explanation: {
      status: "available", provider: "codex", model: "gpt", scope: "candidate",
      locales: { "zh-CN": { question: "中文问题", basis: "依据", limits: "限制", suggestion: "建议" }, en: { question: "English question", basis: "basis", limits: "limits", suggestion: "suggestion" } },
      binding: { ticket_id: "promo-1", strategy_profile: "demo", domain: "us_equity", proposed_params: { a: 2 }, comparison, shadow_evidence_kind: "paired_shadow", shadow_passed: true, notes: [] },
    },
  },
};
const catalogProfile = { profile: "demo", label: "均衡配置", label_zh: "均衡配置", label_en: "Balanced allocation", description_zh: "中文说明", description_en: "English note" };
assert.equal(strategyDisplayName(catalogProfile, "en"), "Balanced allocation");
assert.equal(strategyDisplayName(catalogProfile, "zh"), "均衡配置");
assert.equal(strategyDisplayName({ label: "均衡配置", label_zh: "均衡配置" }, "en"), "未命名策略");
assert.equal(strategyDisplayName({ label_en: "Balanced allocation" }, "zh"), "未命名策略");
assert.equal(strategyNote(catalogProfile, "en"), "English note");
assert.equal(strategyNote(catalogProfile, "zh"), "中文说明");
assert.equal(strategyNote({ description: "raw limitations", limitations: ["限制在材料里"] }, "en"), "");
assert.equal(strategyNote({ description_zh: "中文说明" }, "en"), "");

const decisions = listDailyDecisions({
  language: "en", profiles: [catalogProfile],
  promotions: ready({ tickets: [ticket, { ...ticket, ticket_id: "legacy", research_summary: { ...ticket.research_summary, ai_explanation: { status: "available", provider: "codex", model: "gpt", text: "历史中文" } } }] }),
  owners: ready({ candidates: [{ candidate: { candidate_id: "owner-1", recommendation: { code: "owner_live_decision", reason: "owner decision required" } }, candidate_evidence_sha256: "a".repeat(64), intent: null }] }),
  recovery: ready({ recoveries: [{ freshness: { data_status: "ready" }, confirmation: null, recovery: { recovery_id: "r1", readiness: "awaiting_human_confirmation", blocker_codes: [], candidate_sha256: "b".repeat(64), dual_review: { evidence_binding_sha256: "b".repeat(64) }, platform: "ibkr" } }] }),
  accountsFor: (item) => item.ticket_id === "promo-1" ? [{ platform: "longbridge", key: "hk", label: "港股模拟" }] : [],
});
assert.equal(decisions.blocked, false);
const promotion = decisions.items.find(item => item.kind === "promotion" && item.id === "promotion:promo-1");
const legacy = decisions.items.find(item => item.id === "promotion:legacy");
const owner = decisions.items.find(item => item.kind === "owner_observation");
const recovery = decisions.items.find(item => item.kind === "recovery");
assert.equal(promotion.explanationKind, "ai");
assert.equal(promotion.explanation.question, "English question");
assert.equal(JSON.stringify(promotion.explanation).includes("中文问题"), false);
assert.equal(promotion.canAdopt, true);
assert.equal(promotion.canReject, true);
assert.equal(promotion.title, "Balanced allocation");
assert.equal(JSON.stringify(promotion.reasons).includes("限制在材料里"), false);
assert.equal(promotion.technical.includes("限制在材料里"), true);
assert.equal(legacy.explanationKind, "system");
assert.equal(legacy.explanation, null);
assert.equal(JSON.stringify(legacy).includes("历史中文"), false);
assert.equal(owner.rejectDecision, "keep_parked");
assert.equal(owner.adoptDecision, "approve_limited_live_canary");
assert.equal(JSON.stringify(owner.reasons).includes("owner decision required"), false);
assert.equal(JSON.stringify(owner).includes("retire_candidate"), false);
assert.equal(recovery.impact.includes("b".repeat(64)), false);
assert.equal(recovery.technical.includes("b".repeat(64)), true);
assert.equal(recovery.technical.includes("candidate_sha256"), true);
assert.equal(recovery.technical.includes("dual_review_binding_sha256"), true);
assert.equal(recovery.canReject, true);
assert.equal(recovery.canAdopt, true);
assert.equal(recovery.rejectDecision, "reject");
assert.equal(recovery.adoptDecision, "approve");

const rejectedRecovery = { ...decisions.items.find(item => item.kind === "recovery") };
const hidden = listDailyDecisions({
  language: "zh", profiles: [],
  promotions: ready({ tickets: [] }),
  owners: ready({ candidates: [] }),
  recovery: ready({ recoveries: [{ freshness: { data_status: "ready" }, confirmation: null, rejection: { decision: "reject" }, recovery: { recovery_id: "r1", readiness: "awaiting_human_confirmation", blocker_codes: [], candidate_sha256: "b".repeat(64), dual_review: { evidence_binding_sha256: "b".repeat(64) } } }] }),
  accountsFor: () => [],
});
assert.equal(hidden.items.some(item => item.kind === "recovery"), false);
assert.equal(recoveryBinding({ freshness: { data_status: "ready" }, confirmation: null, recovery: { recovery_id: "r1", readiness: "awaiting_human_confirmation", blocker_codes: [], candidate_sha256: "b".repeat(64), dual_review: { evidence_binding_sha256: "b".repeat(64) } } }, "reject").decision, "reject");
assert.equal(recoveryBinding({ freshness: { data_status: "ready" }, confirmation: null, rejection: { decision: "reject" }, recovery: { recovery_id: "r1", readiness: "awaiting_human_confirmation", blocker_codes: [], candidate_sha256: "b".repeat(64), dual_review: { evidence_binding_sha256: "b".repeat(64) } } }, "approve"), null);

const multi = { canAdopt: true, canReject: true, accountChoices: [{ id: "longbridge:a" }, { id: "longbridge:b" }] };
assert.deepEqual(decisionActionState(multi, { admin: true, busy: false, selectedAccountId: "" }), { adoptEnabled: false, rejectEnabled: true });
assert.deepEqual(decisionActionState(multi, { admin: true, busy: false, selectedAccountId: "longbridge:a" }), { adoptEnabled: true, rejectEnabled: true });
assert.deepEqual(decisionActionState({ canAdopt: true, canReject: true, accountChoices: [{ id: "longbridge:a" }] }, { admin: false, busy: false, selectedAccountId: "" }), { adoptEnabled: false, rejectEnabled: false });
assert.deepEqual(decisionActionState(multi, { admin: true, busy: true, selectedAccountId: "longbridge:a" }), { adoptEnabled: false, rejectEnabled: false });
assert.equal(confirmationAccepted(false, "same", "same"), false);
assert.equal(confirmationAccepted(true, "opened", "changed"), false);
assert.equal(confirmationAccepted(true, "same", "same"), true);
assert.equal(routeAfterDirtyPrompt(true, false), "stay");
assert.equal(routeAfterDirtyPrompt(true, true), "leave");
assert.equal(routeAfterDirtyPrompt(false, false), "leave");
assert.equal(safeActionVisibility({ settingsUnavailable: true, activation: "—", refreshSupported: true, resumeSupported: false }).stop, true);
assert.equal(safeActionVisibility({ settingsUnavailable: true, activation: "已启用", refreshSupported: false, resumeSupported: false }).refresh, false);

const application = { application: null, application_preparation: { preflight_status: "ready", preview_request: { ok: true }, account_options: [{ platform: "longbridge", key: "paper-a", label: "模拟甲", broker_environment: "paper" }, { platform: "ibkr", key: "live-a", label: "实盘", broker_environment: "live" }] } };
assert.deepEqual(paperApplicationAccounts(application).map(account => account.id), ["longbridge:paper-a"]);
assert.equal(paperApplicationReady(application, ""), false);
assert.equal(paperApplicationReady(application, "longbridge:paper-a"), true);
assert.equal(paperApplicationReady({ ...application, application: { status: "submitted" } }, "longbridge:paper-a"), false);
assert.equal(paperApplicationReady({ ...application, application: { status: "rejected" } }, "longbridge:paper-a"), true);
assert.equal(paperApplicationReady({ ...application, application_preparation: { ...application.application_preparation, blocker_codes: ["account_not_ready"] } }, "longbridge:paper-a"), false);
assert.equal(paperApplicationReady({ ...application, application_preparation: { ...application.application_preparation, blocker_codes: [] } }, "longbridge:paper-a"), true);
const paperOption = application.application_preparation.account_options[0];
const readyPrep = application.application_preparation;
const blockedQueue = [
  { ticket_id: "blocked-unknown", application: null, application_preparation: { preflight_status: "unknown", account_options: [paperOption] } },
  { ticket_id: "blocked-code", application: null, application_preparation: { preflight_status: "unknown", blocker_codes: ["missing_account"], account_options: [paperOption] } },
  { ticket_id: "blocked-ready-code", application: null, application_preparation: { ...readyPrep, blocker_codes: ["preview_blocked"] } },
  { ticket_id: "blocked-not-ready", application: null, application_preparation: { preflight_status: "unknown", blocker_codes: [], preview_request: { ok: true }, account_options: [paperOption] } },
];
assert.equal(blockedQueue.filter(paperApplicationActionable).length, 0);
assert.equal(blockedQueue.filter(paperApplicationUnresolved).length, 0);
assert.equal(paperApplicationActionable(application), true);
assert.equal(paperApplicationUnresolved(application), false);
for (const status of ["approved", "claimed", "uncertain", "unknown", "submitted"]) {
  const submitted = { ...application, application: { status } };
  assert.equal(paperApplicationActionable(submitted), false, status);
  assert.equal(paperApplicationUnresolved(submitted), true, status);
  assert.equal(paperApplicationReady(submitted, "longbridge:paper-a"), false, status);
}
const completed = { ...application, application: { status: "applied_paused" } };
assert.equal(paperApplicationActionable(completed), false);
assert.equal(paperApplicationUnresolved(completed), false);
const rejectedNotReady = { ...application, application: { status: "rejected" }, application_preparation: { ...readyPrep, preflight_status: "unknown" } };
assert.equal(paperApplicationActionable(rejectedNotReady), false);
assert.equal(paperApplicationUnresolved(rejectedNotReady), false);
const rejectedReady = { ...application, application: { status: "rejected" } };
assert.equal(paperApplicationActionable(rejectedReady), true);
assert.equal(paperApplicationUnresolved(rejectedReady), false);
const adminProfiles = [{ profile: "soxl_trend", label: "SOXL趋势", label_zh: "SOXL趋势", label_en: "SOXL Trend" }];
const adminOccupied = strategyOccupiedNames(adminProfiles, "soxl_trend");
const maskedAdmin = formatAccountIdentity(accountIdentity({ label: "SOXL趋势", key: "internal-key", account_selector: "U12345678" }, "IBKR", "", adminOccupied), english);
assert.equal(maskedAdmin, "U12345678");
assert.equal(maskedAdmin.includes("internal-key"), false);
assert.deepEqual(environmentEditState("paper", "paper", "live"), { value: "live", conflict: false });
assert.deepEqual(environmentEditState("paper", "live", "paper"), { value: "live", conflict: false });
assert.deepEqual(environmentEditState("paper", "live", ""), { value: "live", conflict: true });
const merged = mergeAdminFields(
  { allowed_logins: "edited", account_options: "old-json" },
  { allowed_logins: "server", account_options: "new-json" },
  { allowed_logins: true, account_options: true },
  ["account_options"],
);
assert.equal(merged.kept, true);
assert.equal(merged.text.allowed_logins, "edited");
assert.equal(merged.text.account_options, "new-json");
const genericAdmin = formatAccountIdentity(accountIdentity({ label: "SOXL趋势", key: "internal-key" }, "LongBridge", "", adminOccupied), english);
assert.equal(genericAdmin, "Account");
assert.equal(genericAdmin.includes("internal-key"), false);
assert.equal(genericAdmin.includes("SOXL"), false);
assert.equal(formatAccountIdentity(accountIdentity({ label: "我的模拟", key: "internal-key" }, "LongBridge", "", adminOccupied), english), "我的模拟");
assert.equal(rejectedRecovery.kind, "recovery");

const decisionsPage = readFileSync(new URL("../web/strategy-switch-console/frontend/src/DecisionsPage.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../web/strategy-switch-console/frontend/src/App.tsx", import.meta.url), "utf8");
assert.match(app, /const accountTitle = \([\s\S]*?\) => adminDirectoryTitle\(/);
assert.equal(app.includes("formatAccountIdentity"), false);
const recoveryFn = app.slice(app.indexOf("const confirmRecovery"), app.indexOf("async function submitPromotion"));
assert.equal(decisionsPage.split("selected.impact").length - 1, 2);
assert.equal(decisionsPage.includes("你需要决定"), false);
assert.equal(recoveryFn.includes("candidate_sha256"), false);
assert.equal(recoveryFn.includes("dual_review_binding_sha256"), false);
assert.match(recoveryFn, /不采用这份恢复方案，账户不会因此启用/);
assert.match(recoveryFn, /knownAccountLabel/);
assert.match(app, /dialog\.consequence !== dialog\.summary/);
assert.match(app, /pendingApplications > 0 \|\| unresolvedApplications > 0/);
assert.equal((app.match(/<ApplicationCard/g) || []).length, 1);
assert.equal(app.includes("applicationRetryAllowed(item?.application"), false);
assert.equal(app.includes("item.config?.label || item.key"), false);
assert.equal(app.includes("function AdminPanel"), false);
assert.equal(app.includes("管理设置"), false);
assert.equal(app.includes("这些说明根据已保存记录生成，当前没有接入模型。"), false);
assert.match(app, /paperApplicationActionable\(item\) \|\| paperApplicationUnresolved\(item\)/);
assert.equal(app.includes("新增账户记录"), false);
assert.equal(app.includes("EnvironmentControl"), false);
assert.equal(app.includes("request_retirement"), false);
assert.equal(app.includes("模拟账户应用记录"), false);
const directoryOccupied = strategyOccupiedNames([{ profile: "soxl", label: "SOXL" }], "soxl");
const ibkrNumber = { account_selector: "U12345678", label: "soxl" };
assert.equal(adminDirectoryTitle(ibkrNumber, "IBKR", directoryOccupied), "IBKR · U12345678");
assert.equal(adminDirectoryTitle(ibkrNumber, "IBKR", directoryOccupied).includes("账户 ·"), false);
const severalNumbers = { account_selector: "U12345678, U10000001", label: "主账户" };
assert.equal(adminDirectoryTitle(severalNumbers, "IBKR", []), "IBKR · 主账户");
assert.equal(adminDirectoryTitle(severalNumbers, "IBKR", []).includes("U12345678"), false);
const binance = { key: "crypto_combo", target_name: "crypto_combo" };
assert.equal(adminDirectoryTitle(binance, "Binance", []), "Binance · live");
assert.equal(adminDirectoryTitle(binance, "Binance", []).includes("账户 ·"), false);
assert.equal(binance.key, "crypto_combo");
assert.equal(adminDirectoryTitle({ key: "internal-key" }, "LongBridge", directoryOccupied).includes("账户"), false);
assert.equal(brokerAccountType("paper"), "配置 paper 环境");
assert.equal(brokerAccountType("live"), "配置 live 环境");
assert.equal(brokerAccountType(""), "配置环境待确认");
assert.equal(brokerAccountType("dry_run"), "配置环境待确认");
assert.equal(brokerAccountType("shadow"), "配置环境待确认");
const localTime = formatLocalChangeTime(Date.parse("2026-09-28T07:46:00.000Z"), "zh", "Asia/Shanghai");
const localTimeEn = formatLocalChangeTime(Date.parse("2026-09-28T07:46:00.000Z"), "en", "Asia/Shanghai");
assert.match(localTime, /2026/);
assert.match(localTime, /15:46/);
assert.match(localTime, /Asia\/Shanghai/);
assert.match(localTimeEn, /Asia\/Shanghai/);
const changes = recentUserChanges({
  history: [
    { ts: "2026-09-28T01:00:00.000Z", login: "ada", action: "sync_defaults" },
    { ts: "2026-09-28T03:00:00.000Z", login: "ada", action: "edit", after: { platform: "ibkr", key: "a" } },
    { ts: "2026-09-27T03:00:00.000Z", login: "bea", action: "create", after: { platform: "binance", key: "crypto_combo" } },
  ],
  audit: [
    { ts: "2026-09-28T04:00:00.000Z", login: "ada", action: "sync_strategy_health" },
    { ts: "2026-09-28T02:00:00.000Z", login: "cy", action: "save_config" },
    { ts: "2026-09-28T00:00:00.000Z", login: "dee", action: "mystery_action" },
  ],
  applications: [
    { ticket_id: "no-app", application_preparation: { preflight_status: "unknown" } },
    { ticket_id: "shadow-note", application: { status: "approved", updated_at: "2026-09-28T05:00:00.000Z" }, application_preparation: { account_options: [{ broker_environment: "shadow" }] } },
    { ticket_id: "paper-note", application: { status: "applied_paused", updated_at: "2026-09-28T00:30:00.000Z", login: "ada" }, application_preparation: { account_options: [{ platform: "longbridge", broker_environment: "paper", key: "hk" }] } },
  ],
}, 5);
assert.deepEqual(changes.map(item => item.at), [...changes.map(item => item.at)].sort((left, right) => right - left));
assert.equal(changes.some(item => String(item.action).includes("sync_")), false);
assert.equal(changes.some(item => item.target === "no-app"), false);
assert.equal(changes[0].target, "shadow-note");
assert.equal(changes[0].action, "变更记录");
assert.equal(changes[0].action.includes("已生效"), false);
assert.equal(changes.some(item => item.target === "paper-note"), true);
assert.equal(changes.find(item => item.action === "更新了账户资料")?.target, "ibkr · a");
assert.equal(changes.find(item => item.actor === "dee")?.action, "设置已更新");
assert.equal(changes.some(item => item.action === "新增了账户资料"), false);
const latestSave = recentUserChanges({
  history: [{ ts: "2026-09-28T01:00:00.000Z", login: "ada", action: "sync_defaults", platform: "ibkr", key: "hidden" }],
  audit: [
    { ts: "2026-09-28T06:00:00.000Z", login: "ada", action: "save_account_settings", platform: "ibkr", key: "internal-key", changes: ["cash_draft", "income_draft"], draft_revision: 4 },
    { ts: "2026-09-28T05:30:00.000Z", login: "ada", action: "save_account_settings", platform: "binance", key: "crypto_combo", changes: ["risk_cleared"], risk_revision: 2 },
  ],
}, 1);
assert.equal(latestSave.length, 1);
assert.deepEqual(latestSave[0].actions, ["现金草案已保存", "收入层草案已保存"]);
assert.equal(latestSave[0].actor, "ada");
assert.equal(latestSave[0].platform, "ibkr");
assert.equal(latestSave[0].accountKey, "internal-key");
assert.equal(latestSave[0].target, "账户");
assert.equal(JSON.stringify(latestSave[0]).includes("sync_"), false);
assert.equal(JSON.stringify(latestSave[0]).includes("已应用"), false);
const changeOccupied = strategyOccupiedNames([{ profile: "SOXL_TQQQ", label: "SOXL" }], "SOXL_TQQQ");
assert.equal(changeAccountName({ account_selector: "U12345678", label: "SOXL", key: "ib-key" }, "IBKR", changeOccupied), "U12345678");
assert.equal(changeAccountName({ key: "crypto_combo", target_name: "crypto_combo" }, "Binance", []), "live");
assert.equal(changeAccountName({ key: "internal-key" }, "LongBridge", changeOccupied), "");
assert.equal(changeAccountName(null, "LongBridge", []), "");
assert.equal(percentTextToRatio("0"), "0");
assert.equal(percentTextToRatio("100"), "1");
assert.equal(percentTextToRatio("12.5"), "0.125");
assert.equal(percentTextToRatio("50"), "0.5");
assert.equal(percentTextToRatio("100.1"), null);
assert.equal(percentTextToRatio("1e2"), null);
assert.equal(percentTextToRatio("100.000"), "1");
assert.equal(percentTextToRatio("100.0000000000000000001"), null);
assert.equal(decimalUnitRatio("0"), "0");
assert.equal(decimalUnitRatio("1"), "1");
assert.equal(decimalUnitRatio("1.000"), "1.000");
assert.equal(decimalUnitRatio("1.000000000000000000001"), null);
assert.equal(ratioTextToPercent("0.1"), "10");
assert.equal(ratioTextToPercent("0.125"), "12.5");
assert.equal(ratioTextToPercent("1"), "100");
assert.equal(reservedCashEditor({ reserved_cash_floor: "10" }, {}).mode, "saved");
assert.equal(reservedCashEditor({ reserved_cash_floor: "10" }, {}).ratio, "");
assert.equal(reservedCashEditor({ reserved_cash_floor: "10", reserved_cash_ratio: "0" }, {}).mode, "floor");
assert.equal(reservedCashEditor({}, { cashMode: "both", floor: "10", percent: "25", ratio: "0.25" }).mode, "both");

console.log("console presentation: PASS");
assert.deepEqual(environmentEditState("paper", "live", "live"), { value: "live", conflict: false });
assert.deepEqual(environmentEditState("paper", "", "live"), { value: "", conflict: true });
await import("./overview_refresh_validation.mjs");
await import("./overview_dashboard_validation.mjs");

await import("./promotion_queue_partial_validation.mjs");

// v1 remains supported; malformed advertised v2 bindings do not become v1.
const decisionInput = { language: "en", profiles: [catalogProfile], promotions: ready({ tickets: [ticket] }), owners: ready({ candidates: [] }), recovery: ready({ recoveries: [] }), accountsFor: () => [{ platform: "longbridge", key: "synthetic-paper", label: "Synthetic account" }] };
const noReview = listDailyDecisions({ ...decisionInput, promotions: ready({ tickets: [{ ...ticket, decision_binding: { ...ticket.decision_binding, review_binding: null } }] }) }).items[0];
assert.equal(noReview.canAdopt, true); assert.equal(noReview.canReject, true);
const badReview = listDailyDecisions({ ...decisionInput, promotions: ready({ tickets: [{ ...ticket, decision_binding: { ...ticket.decision_binding, review_binding: { schema_version: "bad", review_sha256: "b".repeat(64) } } }] }) }).items[0];
assert.equal(badReview.canAdopt, false); assert.equal(badReview.canReject, false);
const priorDecision = { expected: { kind: "promotion", subject_id: ticket.ticket_id, material_sha256: "a".repeat(64), action: "reject", target: { selected_account: null, confirmation: null }, review_sha256: "b".repeat(64) }, status: "unresolved", receipt: null, queueConfirmed: false };
const pendingDecision = listDailyDecisions({ ...decisionInput, decisionStates: [priorDecision] }).items[0];
assert.equal(pendingDecision.canAdopt, false); assert.equal(pendingDecision.canReject, false);
assert.equal(listDailyDecisions({ ...decisionInput, decisionStates: [{ ...priorDecision, status: "recorded" }] }).items.length, 0);
assert.equal(listDailyDecisions({ ...decisionInput, promotions: ready({ tickets: [{ ...ticket, decision_binding: { ...ticket.decision_binding, material_sha256: "c".repeat(64) } }] }), decisionStates: [priorDecision] }).items[0].canAdopt, true, "a different original material is not affected by an unrelated receipt");
