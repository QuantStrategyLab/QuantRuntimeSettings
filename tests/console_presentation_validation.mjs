import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { confirmationAccepted, recoveryBinding } from "../web/strategy-switch-console/frontend/src/operations.ts";
import { accountDisplayTitle, accountStatusView, activationFromProjection, chartUnavailable, decisionActionState, knownAccountLabel, listDailyDecisions, overviewFigures, paperApplicationAccounts, paperApplicationReady, preferenceDirty, routeAfterDirtyPrompt, safeActionVisibility, strategyDisplayName, strategyNote } from "../web/strategy-switch-console/frontend/src/presentation.ts";

const monitored = { scope: "monitoring_only", limit: "not_trading_or_books", health: "normal", activation: "enabled", reason: "monitoring_agrees" };
assert.equal(activationFromProjection(monitored), "已启用");
assert.equal(activationFromProjection({ ...monitored, activation: "disabled" }), "已停用");
assert.equal(activationFromProjection({ configured_state: "disabled" }), "—");
assert.equal(activationFromProjection(null), "—");
assert.equal(activationFromProjection({ activation: null }), "—");
assert.equal(activationFromProjection({ activation: false }), "—");
assert.equal(activationFromProjection({ activation: 0 }), "—");
assert.equal(accountStatusView(null).label, "—");
assert.deepEqual(accountStatusView({ configured_state: "disabled" }), { label: "—", detail: "暂未取得状态" });
assert.notEqual(activationFromProjection(monitored), "—");
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
assert.equal(chartUnavailable("return"), "收益数据积累中");
assert.equal(chartUnavailable("assets"), "资产数据暂不可用");
assert.equal(chartUnavailable("cash"), "资产数据暂不可用");
assert.equal(accountDisplayTitle({ label: "  ", key: "internal-key" }, "Longbridge", "模拟账户环境"), "Longbridge · 模拟账户环境");
assert.equal(accountDisplayTitle({ label: "我的港股" }, "Longbridge", "模拟账户环境").includes("internal"), false);

assert.equal(preferenceDirty(null, ""), false);
assert.equal(preferenceDirty(false, ""), false);
assert.equal(preferenceDirty(0, ""), false);
assert.equal(preferenceDirty("CAPITAL_PRESERVATION", "CAPITAL_PRESERVATION"), false);
assert.equal(preferenceDirty("CAPITAL_PRESERVATION", "GROWTH_COMPOUNDING"), true);

const ready = (value) => ({ error: null, value: { data_status: "ready", ...value } });
const blocked = listDailyDecisions({ language: "zh", profiles: [], promotions: { error: new Error("down") }, owners: ready({ candidates: [] }), recovery: ready({ recoveries: [] }), accountsFor: () => [] });
assert.equal(blocked.blocked, true);
assert.deepEqual(blocked.items, []);
const empty = listDailyDecisions({ language: "zh", profiles: [], promotions: ready({ tickets: [] }), owners: ready({ candidates: [] }), recovery: ready({ recoveries: [] }), accountsFor: () => [] });
assert.equal(empty.blocked, false);
assert.deepEqual(empty.items, []);

const comparison = { status: "unavailable", start_date: null, end_date: null, cost_model: "", baseline: null, candidate: null };
const ticket = {
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
assert.equal(rejectedRecovery.kind, "recovery");

const decisionsPage = readFileSync(new URL("../web/strategy-switch-console/frontend/src/DecisionsPage.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../web/strategy-switch-console/frontend/src/App.tsx", import.meta.url), "utf8");
const recoveryFn = app.slice(app.indexOf("const confirmRecovery"), app.indexOf("async function submitPromotion"));
assert.equal(decisionsPage.split("selected.impact").length - 1, 2);
assert.equal(decisionsPage.includes("你需要决定"), false);
assert.equal(recoveryFn.includes("candidate_sha256"), false);
assert.equal(recoveryFn.includes("dual_review_binding_sha256"), false);
assert.match(recoveryFn, /不采用这份恢复方案，账户不会因此启用/);
assert.match(recoveryFn, /knownAccountLabel/);
assert.match(app, /dialog\.consequence !== dialog\.summary/);

console.log("console presentation: PASS");
