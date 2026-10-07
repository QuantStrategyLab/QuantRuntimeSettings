import assert from "node:assert/strict";
import {
  accountEnvironmentSourceDetail, accountRuntimeLinkDetail, accountSettingDraftBody, buildSwitchInputs, canResumeBinance, currentResearchPreview, defaultSwitchDraft,
  createHumanDecisionController, humanDecisionDigest, humanDecisionExpectation, matchingHumanDecisionReceipt, promotionDecisionReady, applicationRetryAllowed, buildConfirmationFingerprint, ownerDecisionBinding, recoveryBinding,
  confirmationAccepted, createRequestLock, pageFromWorkspace, buildHomeAttention, diagnosisUserSummary, accountMatchesStatusFilter, presentAccountState, promotionSuggestion,
  summarizeExternalResearchSubject,
  diagnosisStatusKey, diagnosisConclusionKey, diagnosisNextStepKey,
  hkStopInitialView, hkStopReadFailed, hkStopSubmitAllowed, createHkStopController,
} from "../web/strategy-switch-console/frontend/src/operations.ts";
import { formatAccountCount, translate } from "../web/strategy-switch-console/frontend/src/locales.ts";
assert.equal(translate("账户资产快照尚未接入；未知不等于零。", "zh"), "账户资产快照尚未接入；未知不等于零。");
assert.equal(translate("缺少可信账户估值序列和完整资金流，收益率与回撤暂不可计算。", "en").includes("cannot be calculated"), true);

const account = {
  key: "synthetic-account", target_name: "synthetic-target", broker_environment: "paper",
  default_strategy_profile: "synthetic-profile", supported_domains: ["us_equity"],
};
const config = { supported_execution_modes: ["live", "dry_run"], margin_policy: true, income_layer: false, option_overlay: false };
const platformSettings = { longbridge: config };
// The helper imports the real platform registry, so this fixture exercises the actual account mapping.
const form = defaultSwitchDraft(account, null, "longbridge");
const inputs = buildSwitchInputs("longbridge", account, form);
assert.equal(form.executionMode, "live", "execution_mode comes from account/config settings, not broker_environment=paper");
assert.equal(inputs.execution_mode, "live");
assert.equal(inputs.cash_only_execution_mode, "current", "untouched cash policy must preserve current instead of Worker default enabled");
assert.equal(inputs.runtime_target_enabled_mode, "current");
assert.equal(inputs.extra_variables_json, undefined);

const cashOnly = { ...form, cashOnlyMode: "enabled", touched: { cashOnly: true } };
assert.equal(buildSwitchInputs("longbridge", account, cashOnly).cash_only_execution_mode, "enabled",
  "enabled is the Worker value for cash_only_execution=true");
const allowMargin = { ...form, cashOnlyMode: "disabled", touched: { cashOnly: true } };
assert.equal(buildSwitchInputs("longbridge", account, allowMargin).cash_only_execution_mode, "disabled");

const digest = "a".repeat(64);
const ownerEntry = { candidate: { candidate_id: "candidate-a" }, candidate_evidence_sha256: digest };
assert.deepEqual(ownerDecisionBinding({ ...ownerEntry.candidate, candidate_evidence_sha256: ownerEntry.candidate_evidence_sha256 }, "keep_parked"),
  { candidate_id: "candidate-a", candidate_evidence_sha256: digest, decision: "keep_parked" });
assert.equal(ownerDecisionBinding({ candidate_id: "candidate-a" }, "keep_parked"), null,
  "owner decision must fail closed without the queue's matching evidence digest");

const recovery = { freshness: { data_status: "ready" }, recovery: {
  recovery_id: "recovery-a", readiness: "awaiting_human_confirmation", blocker_codes: [],
  candidate_sha256: digest, dual_review: { evidence_binding_sha256: digest },
} };
assert.equal(recoveryBinding(recovery).candidate_sha256, digest);
assert.equal(recoveryBinding({ ...recovery, freshness: { data_status: "stale" } }), null);
assert.equal(recoveryBinding({ ...recovery, recovery: { ...recovery.recovery, dual_review: { evidence_binding_sha256: "b".repeat(64) } } }), null);

const preview = { preview_stale: false, preview: { status: "computed" }, job: { status: "succeeded" } };
assert.equal(currentResearchPreview(preview), true);
assert.equal(currentResearchPreview({ ...preview, preview_stale: true }), false);
assert.equal(currentResearchPreview({ ...preview, job: { status: "unknown" } }), false);
assert.equal(canResumeBinance("binance", account, { runtime_target_enabled: false, binance_resume_target_sha256: digest }), true);
assert.equal(canResumeBinance("binance", account, { runtime_target_enabled: null, binance_resume_target_sha256: digest }), false);

let confirmationPosts = 0;
const submitAfterConfirmation = async (confirmed, opened, current) => {
  if (confirmationAccepted(confirmed, opened, current)) confirmationPosts++;
};
await submitAfterConfirmation(false, "account-a:revision-3", "account-a:revision-3");
assert.equal(confirmationPosts, 0, "cancel and Escape resolve without a POST");
await submitAfterConfirmation(true, "account-a:revision-3", "account-a:revision-4");
assert.equal(confirmationPosts, 0, "confirmation is invalidated when its evidence revision changes");
await submitAfterConfirmation(true, "account-a:revision-4", "account-a:revision-4");
assert.equal(confirmationPosts, 1, "a current explicit confirmation permits exactly one request");
const requestLock = createRequestLock();
assert.equal(requestLock.acquire("stop:account-a"), true);
assert.equal(requestLock.acquire("stop:account-a"), false, "concurrent duplicate stop requests are rejected");
assert.equal(requestLock.isLocked("stop:account-a"), true, "an unknown request outcome remains locked");
requestLock.release("stop:account-a");
assert.equal(requestLock.isLocked("stop:account-a"), false, "only an explicit readback/known outcome can release a lock");
assert.equal(requestLock.hasAny(["stop:other", "stop:account-a"]), false);
requestLock.acquire("apply:ticket-a");
assert.equal(requestLock.hasAny(["apply:ticket-a"]), true, "a protected request lock prevents a reload from losing its dedupe state");
assert.equal(requestLock.hasAnyWithPrefixes(["apply:", "switch:"]), true, "retained locks remain detectable even when current API rows are missing");
assert.equal(diagnosisStatusKey({ status: "succeeded", recheck_status: "passed" }), "诊断完成，监测复核通过");
assert.equal(diagnosisConclusionKey({ status: "succeeded", reason_code: "diagnosis_ready" }), "只读诊断已完成，请查看账户运行资料与监测复核结论。");
assert.equal(diagnosisConclusionKey({ status: "unknown", dispatch_state: "unknown" }), "派发结果需人工核对，暂不重复请求。");
assert.equal(diagnosisConclusionKey({ status: "failed", reason_code: "capacity_unavailable" }), "诊断服务暂不可用；账户运行资料未被更改。");
assert.equal(diagnosisNextStepKey({ status: "succeeded", recheck_status: "passed" }), "只读复核已完成；查看账户运行资料。此结果不代表已修复。");
assert.equal(diagnosisNextStepKey({ status: "succeeded", recheck_status: "attention" }), "复核发现需要关注；请检查账户运行资料并按既有流程处理。");
assert.equal(diagnosisNextStepKey({ status: "succeeded", recheck_status: "unavailable" }), "复核资料暂不可用；刷新账户运行状态后再决定。");
assert.equal(diagnosisNextStepKey({ status: "unknown" }), "派发结果需人工核对，暂不重复请求。");
assert.equal(formatAccountCount(1, "zh"), "1 个账户");
assert.equal(formatAccountCount(1, "en"), "1 account");
assert.equal(formatAccountCount(2, "en"), "2 accounts");
assert.equal(pageFromWorkspace("reports"), "overview", "legacy report links land on the account overview with report details nested there");
assert.equal(pageFromWorkspace("research"), "strategy");
assert.equal(pageFromWorkspace("unknown"), "overview");
const attention = buildHomeAttention({
  control: { value: { data_status: "ready", candidates: [{ candidate_id: "candidate-1", candidate_evidence_sha256: digest, lifecycle: { stage: "P6", status: "owner_decision_required" }, recommendation: { code: "owner_live_decision" } }, { candidate_id: "candidate-1", candidate_evidence_sha256: "b".repeat(64), lifecycle: { stage: "P6", status: "owner_decision_required" }, recommendation: { code: "owner_live_decision" } }] } },
  owners: { value: { data_status: "ready", candidates: [{ candidate: { candidate_id: "candidate-1", candidate_evidence_sha256: digest, lifecycle: { stage: "P6", status: "owner_decision_required" }, recommendation: { code: "owner_live_decision" } }, candidate_evidence_sha256: digest, intent: null }] } },
  promotions: { value: { data_status: "ready", tickets: [{ ticket_id: "ticket-awaiting", state: "awaiting_human" }, { ticket_id: "ticket-ready", state: "ready_for_review" }, { ticket_id: "ticket-review", state: "awaiting_human", source_check_required: true }] } },
  recovery: { value: { data_status: "ready", recoveries: [
    { freshness: { data_status: "ready" }, recovery: { recovery_id: "recovery-awaiting", candidate_sha256: digest, readiness: "awaiting_human_confirmation" } },
    { freshness: { data_status: "ready" }, recovery: { recovery_id: "recovery-done", candidate_sha256: digest, readiness: "confirmed" }, confirmation: { status: "confirmed" } },
    { freshness: { data_status: "stale" }, recovery: { recovery_id: "recovery-stale", candidate_sha256: digest, readiness: "awaiting_human_confirmation" } },
  ] } },
  runtime: { value: { data_status: "ready" } }, config: { value: { accountOptions: {} } },
  accounts: [
    { id: "account-attention", title: "synthetic attention account", tone: "attention" },
    { id: "account-unknown", title: "synthetic unknown account", tone: "unknown" },
    { id: "account-paused", title: "synthetic paused account", tone: "paused" },
  ],
});
assert.equal(attention.decisions.filter(item => item.kind === "owner").length, 1,
  "a candidate in the owner queue is not duplicated from control-plane when evidence digests match");
assert.equal(attention.operations.filter(item => item.kind === "candidate_review").length, 1,
  "same candidate with a changed evidence digest remains a separate review item");
assert.deepEqual(attention.decisions.map(item => item.identity).filter(value => value.startsWith("promotion:")), ["promotion:ticket-awaiting"]);
assert.equal(attention.operations.some(item => item.identity === "promotion-source:ticket-ready"), true,
  "ready_for_review is not yet an actionable accept/reject choice");
assert.equal(attention.operations.some(item => item.identity === "promotion-source:ticket-review"), true,
  "promotion source checks are review status, not a human decision");
assert.equal(attention.decisions.some(item => item.identity.startsWith("recovery:recovery-awaiting:")), true);
assert.equal(attention.decisions.some(item => item.identity.startsWith("recovery:recovery-done:")), false,
  "completed recovery confirmation is not a pending task");
assert.equal(attention.operations.some(item => item.identity.startsWith("recovery-review:recovery-stale:")), true,
  "a stale recovery entry remains visible as information to recheck");
assert.deepEqual(attention.operations.filter(item => item.kind === "account").map(item => item.targetId), ["account-attention", "account-unknown"]);
const mixedSources = buildHomeAttention({
  control: { value: { data_status: "ready", candidates: [{ candidate_id: "candidate-stale-owner", lifecycle: { stage: "P6", status: "owner_decision_required" }, recommendation: { code: "owner_live_decision" } }] } },
  owners: { value: { data_status: "stale", candidates: [{ candidate: { candidate_id: "candidate-stale-owner" }, candidate_evidence_sha256: digest }] } },
  promotions: { error: true }, recovery: { value: { data_status: "unavailable" } }, runtime: undefined,
});
assert.equal(mixedSources.operations.some(item => item.kind === "candidate_review"), true,
  "stale owner data cannot suppress an actionable review from a ready source");
assert.deepEqual(mixedSources.sourceWarnings.map(item => item.source), ["所有者决定", "候选晋级", "恢复确认", "账户运行", "账户配置"]);
assert.deepEqual(diagnosisUserSummary(undefined), { status: "尚未检查", reason: "可以发起一次只读账户检查。", action: "check" });
assert.deepEqual(diagnosisUserSummary({ available: true, task: { status: "running" } }), { status: "正在检查", reason: "检查仍在处理，无需重复操作。", action: "refresh" });
assert.deepEqual(diagnosisUserSummary({ available: true, task: { status: "unknown" } }), { status: "结果暂未确认", reason: "请查看技术详情或联系维护人员；暂不重复请求。", action: "refresh" });
assert.deepEqual(diagnosisUserSummary({ available: true, task: { status: "queued", dispatch_state: "unknown" } }), { status: "结果暂未确认", reason: "请查看技术详情或联系维护人员；暂不重复请求。", action: "refresh" });
assert.deepEqual(diagnosisUserSummary({ available: true, task: { status: "running", dispatch_state: "unknown" } }), { status: "结果暂未确认", reason: "请查看技术详情或联系维护人员；暂不重复请求。", action: "refresh" });
assert.deepEqual(diagnosisUserSummary({ available: true, task: { status: "unknown", recheck_status: "sent" } }), { status: "结果暂未确认", reason: "请查看技术详情或联系维护人员；暂不重复请求。", action: "refresh" });
assert.equal(presentAccountState(undefined).label, "—");
assert.equal(presentAccountState(undefined).tone, "unknown");
assert.notEqual(presentAccountState({ execution_observation: { code: "monitoring_only" } }).label, "监测可用");
const projectedNormal = presentAccountState({ scope: "monitoring_only", limit: "not_trading_or_books", health: "normal", activation: "enabled", reason: "monitoring_agrees" });
assert.equal(projectedNormal.label, "正常");
assert.equal(projectedNormal.tone, "healthy");
const savedDisabledStillOn = presentAccountState({ scope: "monitoring_only", limit: "not_trading_or_books", health: "abnormal", activation: "enabled", reason: "config_inconsistent" });
assert.equal(savedDisabledStillOn.label, "异常");
assert.equal(savedDisabledStillOn.detail, "设置尚未生效");
assert.equal(presentAccountState({ scope: "monitoring_only", limit: "not_trading_or_books", health: "abnormal", activation: "disabled", reason: "config_inconsistent" }).detail, "设置尚未生效");
assert.equal(projectedNormal.detail, "运行监测正常，已启用。");
assert.equal(presentAccountState({ scope: "monitoring_only", limit: "not_trading_or_books", health: "normal", activation: "disabled", reason: "monitoring_agrees" }).detail, "运行监测正常，已停用。");
assert.equal(presentAccountState({ scope: "monitoring_only", limit: "not_trading_or_books", health: "abnormal", activation: "disabled", reason: "retained_attention" }).detail, "账户运行异常");
assert.equal(presentAccountState({ scope: "monitoring_only", limit: "not_trading_or_books", health: "unknown", activation: "unknown", reason: "source_not_fresh" }).detail, "运行状态来源已过期或不可用");
assert.equal(presentAccountState({ scope: "monitoring_only", limit: "not_trading_or_books", health: "unknown", activation: "unknown", reason: "source_not_fresh" }, "stale").detail, "运行状态来源已过期");
assert.equal(presentAccountState({ scope: "monitoring_only", limit: "not_trading_or_books", health: "unknown", activation: "unknown", reason: "source_not_fresh" }, "unavailable").detail, "运行状态来源暂不可用");
assert.equal(presentAccountState({ scope: "monitoring_only", limit: "not_trading_or_books", health: "unknown", activation: "unknown", reason: "deployment_missing" }).detail, "尚未取得该目标的部署读回");
assert.equal(presentAccountState({ scope: "monitoring_only", limit: "not_trading_or_books", health: "unknown", activation: "unknown", reason: "deployment_not_fresh" }).detail, "部署状态读回已过期");
assert.equal(presentAccountState({ scope: "monitoring_only", limit: "not_trading_or_books", health: "unknown", activation: "unknown", reason: "activation_unconfirmed" }).detail, "运行启用状态尚未确认");
assert.equal(presentAccountState({ scope: "monitoring_only", limit: "not_trading_or_books", health: "unknown", activation: "unknown", reason: "evidence_insufficient" }).detail, "现有证据不足以确认运行状态");
assert.equal(accountRuntimeLinkDetail({}), "账户尚未绑定运行目标");
assert.equal(accountRuntimeLinkDetail({ reference: "target-a", referenceUseCount: 2, runtimeError: "request_failed" }), "运行目标映射重复，无法唯一匹配");
assert.equal(accountRuntimeLinkDetail({ reference: "target-a", referenceUseCount: 1, runtimeError: "request_failed" }), "运行状态接口读取失败");
assert.equal(accountRuntimeLinkDetail({ reference: "target-a", referenceUseCount: 1, runtimeDataStatus: "stale", targetMatchCount: 0 }), "运行状态来源已过期");
assert.equal(accountRuntimeLinkDetail({ reference: "target-a", referenceUseCount: 1, runtimeDataStatus: "ready", targetMatchCount: 0 }), "未取得对应运行目标记录");
assert.equal(accountRuntimeLinkDetail({ reference: "target-a", referenceUseCount: 1, runtimeDataStatus: "ready", targetMatchCount: 2 }), "来源包含重复运行目标");
assert.equal(accountRuntimeLinkDetail({ reference: "target-a", referenceUseCount: 1, runtimeDataStatus: "ready", targetMatchCount: 1 }), null);
assert.equal(accountEnvironmentSourceDetail("paper"), "配置环境来自账户设置，未由券商原生核实");
assert.equal(accountEnvironmentSourceDetail(undefined), "账户设置未提供配置环境，券商身份尚未核实");
assert.equal(presentAccountState({ scope: "monitoring_only", limit: "not_trading_or_books", health: "normal", activation: "unknown", reason: "monitoring_agrees" }).label, "—");
const normalDisabled = { scope: "monitoring_only", limit: "not_trading_or_books", health: "normal", activation: "disabled", reason: "monitoring_agrees" };
const activationUnknown = { scope: "monitoring_only", limit: "not_trading_or_books", health: "unknown", activation: "unknown", reason: "deployment_missing" };
const desiredOffStillOn = { scope: "monitoring_only", limit: "not_trading_or_books", health: "abnormal", activation: "enabled", reason: "config_inconsistent" };
assert.equal(accountMatchesStatusFilter("paused", normalDisabled), true);
assert.equal(accountMatchesStatusFilter("paused", activationUnknown), false);
assert.equal(accountMatchesStatusFilter("paused", desiredOffStillOn), false);
assert.equal(accountMatchesStatusFilter("paused", undefined), false);
assert.deepEqual(diagnosisUserSummary({ available: true, task: { status: "failed" } }), { status: "暂时无法检查", reason: "本次检查未完成，可以重新检查。", action: "check" });
assert.equal(diagnosisUserSummary({ available: true, task: { status: "succeeded", recheck_status: "passed" } }).status, "检查已完成，未发现监测异常");
const suggestionLocales = {
  "zh-CN": {
    question: "该候选与基线在固定窗口下是否接近？",
    basis: "比较来自同一窗口与同一成本条件。",
    limits: "这只是候选建议，尚未选定账户。",
    suggestion: "请人工审阅，不构成执行授权。",
  },
  en: {
    question: "Does this candidate stay close to the baseline?",
    basis: "The comparison uses one fixed window and one cost model.",
    limits: "This is candidate advice before any account is selected.",
    suggestion: "Ask a human to review it without execution authority.",
  },
};
const suggestionComparison = {
  status: "comparable", start_date: "2025-01-01", end_date: "2025-12-31", cost_model: "cost-v1",
  baseline: { cagr: 0.1, max_drawdown: -0.2 }, candidate: { cagr: 0.1, max_drawdown: -0.2 },
};
const suggestionTicket = {
  ticket_id: "synthetic-ai-ticket", strategy_profile: "demo_strategy", domain: "us_equity",
  proposed_params: { a: 2 }, shadow_evidence_kind: "paired_shadow", shadow_passed: true, notes: [],
  research_summary: {
    comparison: suggestionComparison,
    ai_explanation: {
      status: "available", provider: "codex", model: "synthetic-summary-model", scope: "candidate",
      locales: suggestionLocales,
      binding: {
        ticket_id: "synthetic-ai-ticket", strategy_profile: "demo_strategy", domain: "us_equity",
        proposed_params: { a: 2 }, comparison: suggestionComparison,
        shadow_evidence_kind: "paired_shadow", shadow_passed: true, notes: [],
      },
    },
  },
};
const historicalTicket = {
  ticket_id: "synthetic-ai-ticket", strategy_profile: "synthetic-strategy", domain: "us_equity",
  proposed_params: { lookback: 20 },
  research_summary: {
    identity: { strategy_profile: "synthetic-strategy", domain: "us_equity", proposed_params: { lookback: 20 } },
    ai_explanation: { status: "available", provider: "codex", model: "synthetic-model", text: "Synthetic factual explanation only." },
  },
};
assert.equal(promotionSuggestion(historicalTicket, "zh"), null);
assert.equal(promotionSuggestion(historicalTicket, "en"), null, "saved single-language text is not shown as the bilingual suggestion");
assert.equal(promotionSuggestion({ ...suggestionTicket, research_summary: { ...suggestionTicket.research_summary, ai_explanation: { status: "unavailable", provider: "", model: "", text: "" } } }, "zh"), null);
const chineseSuggestion = promotionSuggestion(suggestionTicket, "zh");
const englishSuggestion = promotionSuggestion(suggestionTicket, "en");
assert.equal(chineseSuggestion.question, suggestionLocales["zh-CN"].question);
assert.equal(englishSuggestion.question, suggestionLocales.en.question);
assert.equal(JSON.stringify(englishSuggestion).includes(suggestionLocales["zh-CN"].question), false, "English does not fall back to the Chinese suggestion");
assert.equal(promotionSuggestion({ ...suggestionTicket, research_summary: { ...suggestionTicket.research_summary, ai_explanation: { ...suggestionTicket.research_summary.ai_explanation, locales: { "zh-CN": suggestionLocales["zh-CN"] } } } }, "en"), null);
assert.equal(promotionSuggestion({ ...suggestionTicket, research_summary: { ...suggestionTicket.research_summary, ai_explanation: { ...suggestionTicket.research_summary.ai_explanation, binding: { ...suggestionTicket.research_summary.ai_explanation.binding, proposed_params: { a: 9 } } } } }, "zh"), null);
assert.equal(translate("AI分析说明", "en"), "AI research explanation");
assert.equal(translate("尚无与当前候选绑定的AI说明。", "en"), "No AI explanation is available for this candidate yet.");
assert.equal(translate("来源状态：{status}", "en", { status: translate("暂不可用", "en") }), "Source status: Currently unavailable",
  "unavailable report sources use the active locale for both label and status");
assert.deepEqual(summarizeExternalResearchSubject({
  subject: { kind: "theme_context", identifier: "semiconductors" },
  observations: [
    { as_of: "2026-09-20", generated_at: "2026-09-20T08:00:00Z", freshness: { status: "stale" } },
    { as_of: "2026-09-26", generated_at: "2026-09-26T08:00:00Z", freshness: { status: "fresh" } },
  ],
}, "未知"), { title: "semiconductors", status: "ready", asOf: "2026-09-26" },
"M0 research subjects render their identifier and newest observation fields");
assert.deepEqual(summarizeExternalResearchSubject({
  subject: { kind: "theme_context", identifier: { label: "must not stringify" } },
  observations: [{ generated_at: "2026-09-26T08:00:00Z", freshness: { status: "unrecognized" } }],
}, "未知"), { title: "未知", status: "unknown", asOf: null },
"missing or non-string subject identifiers and unrecognized freshness remain localized unknowns");
assert.equal(summarizeExternalResearchSubject({ subject_id: "synthetic-fallback" }, "未知").title, "synthetic-fallback",
  "legacy string subject_id remains a safe title fallback");
assert.equal(applicationRetryAllowed(null), true);
assert.equal(applicationRetryAllowed({ status: "rejected", dispatch_state: "sent" }), true,
  "only a persisted explicit rejection may permit application retry");
for (const application of [
  { status: "approved", dispatch_state: "unknown" },
  { status: "approved", dispatch_state: "claimed" },
  { status: "approved", dispatch_state: "pending" },
  { status: "approved", dispatch_state: "sent" },
  { status: "unknown", dispatch_state: "unknown" },
]) assert.equal(applicationRetryAllowed(application), false, "unknown, claimed, or active application state stays locked after reload");
const snapshotBase = {
  session: { allowed: true, admin: true },
  selectedId: "longbridge:paper",
  recoveries: [{ freshness: { data_status: "ready" }, recovery: { recovery_id: "r1", readiness: "awaiting_human_confirmation", candidate_sha256: digest, blocker_codes: [], dual_review: { evidence_binding_sha256: digest } } }],
  promotionTickets: [{ ticket_id: "ticket-1", state: "human_accepted", proposed_params: { risk: "low" }, source_check_required: false }],
  promotionApplications: [{ ticket_id: "ticket-1", application_preparation: { preflight_status: "ready", blocker_codes: [], preview_request: { platform_id: "longbridge" } }, application: { application_id: "application-1", status: "approved", dispatch_state: "unknown", expected_revision: 7 } }],
};
const snapshotFingerprint = buildConfirmationFingerprint(snapshotBase);
assert.notEqual(buildConfirmationFingerprint({ ...snapshotBase, recoveries: [{ ...snapshotBase.recoveries[0], freshness: { data_status: "stale" } }] }), snapshotFingerprint,
  "recovery freshness invalidates the actual confirmation fingerprint");
assert.notEqual(buildConfirmationFingerprint({ ...snapshotBase, recoveries: [{ ...snapshotBase.recoveries[0], recovery: { ...snapshotBase.recoveries[0].recovery, dual_review: { evidence_binding_sha256: "b".repeat(64) } } }] }), snapshotFingerprint,
  "the exact recovery evidence binding participates in confirmation fingerprint");
assert.notEqual(buildConfirmationFingerprint({ ...snapshotBase, promotionApplications: [{ ...snapshotBase.promotionApplications[0], application: { ...snapshotBase.promotionApplications[0].application, dispatch_state: "claimed" } }] }), snapshotFingerprint,
  "promotion application readback state invalidates a confirmation");
assert.notEqual(buildConfirmationFingerprint({ ...snapshotBase, promotionTickets: [{ ...snapshotBase.promotionTickets[0], proposed_params: { risk: "high" } }] }), snapshotFingerprint,
  "candidate parameter changes invalidate a confirmation");
const draftBody = accountSettingDraftBody({
  expectedDraftRevision: 3,
  identity: { platform: "longbridge", key: "hk" },
  overrides: { income_layer_enabled: false, reserved_cash_floor: "0", option_overlay_enabled: false },
});
assert.equal(draftBody.overrides.income_layer_enabled, false);
assert.equal(draftBody.overrides.option_overlay_enabled, false);
assert.equal(draftBody.overrides.reserved_cash_floor, "0");
const ratioDraft = accountSettingDraftBody({
  expectedDraftRevision: 4,
  identity: { platform: "longbridge", key: "hk" },
  overrides: { reserved_cash_floor: "0", reserved_cash_ratio: "0.25" },
});
assert.equal(ratioDraft.overrides.reserved_cash_ratio, "0.25");
assert.equal(ratioDraft.overrides.reserved_cash_floor, "0");
assert.equal(Object.hasOwn(draftBody.overrides, "strategy_profile"), false, "unedited draft fields stay omitted");
const clearedDraft = accountSettingDraftBody({
  expectedDraftRevision: 3,
  identity: { platform: "longbridge", key: "hk" },
  overrides: { reserved_cash_floor: null },
});
assert.equal(clearedDraft.overrides.reserved_cash_floor, null);
assert.equal(Object.hasOwn(clearedDraft.overrides, "income_layer_enabled"), false);
const dcaDraft = accountSettingDraftBody({
  expectedDraftRevision: 5,
  identity: { platform: "longbridge", key: "hk" },
  overrides: { strategy_profile: "nasdaq_sp500_smart_dca", dca_mode: "smart", dca_base_investment_usd: "75.25" },
});
assert.deepEqual(dcaDraft.overrides, { strategy_profile: "nasdaq_sp500_smart_dca", dca_mode: "smart", dca_base_investment_usd: "75.25" });
const clearDcaDraft = accountSettingDraftBody({
  expectedDraftRevision: 6,
  identity: { platform: "longbridge", key: "hk" },
  overrides: { strategy_profile: null, dca_mode: null, dca_base_investment_usd: null },
});
assert.deepEqual(clearDcaDraft.overrides, { strategy_profile: null, dca_mode: null, dca_base_investment_usd: null });
assert.equal(hkStopSubmitAllowed(null), false);
assert.equal(hkStopSubmitAllowed(undefined), false);
assert.equal(hkStopSubmitAllowed({ phase: null }), false);
assert.equal(hkStopSubmitAllowed(hkStopInitialView()), false);
const initialFailure = createHkStopController();
const failedRead = initialFailure.beginRead();
initialFailure.failRead(failedRead);
assert.equal(initialFailure.snapshot().phase, "unavailable");
assert.equal(hkStopSubmitAllowed(initialFailure.snapshot()), false);

const hkStop = createHkStopController();
const opened = hkStop.beginRead();
hkStop.completeRead(opened, { phase: null });
assert.equal(hkStop.snapshot().phase, "empty");
assert.equal(hkStopSubmitAllowed(hkStop.snapshot()), true, "a current read of no request can submit once");

const lateEmpty = hkStop.beginRead();
const submitted = hkStop.beginSubmit();
assert.equal(hkStop.snapshot().phase, "reserved");
assert.equal(hkStop.snapshot().request_id, submitted);
hkStop.completeRead(lateEmpty, { phase: null });
assert.equal(hkStop.snapshot().phase, "reserved");
assert.equal(hkStopSubmitAllowed(hkStop.snapshot()), false, "a late empty read cannot unlock a submit");

const priorRejection = createHkStopController();
const priorRead = priorRejection.beginRead();
priorRejection.completeRead(priorRead, { phase: "rejected", request_id: "request-a" });
assert.equal(hkStopSubmitAllowed(priorRejection.snapshot()), true);
const staleRejection = priorRejection.beginRead();
const requestB = priorRejection.beginSubmit();
priorRejection.completeRead(staleRejection, { phase: "rejected", request_id: "request-a" });
assert.equal(priorRejection.snapshot().request_id, requestB);
assert.equal(priorRejection.snapshot().phase, "reserved");
assert.equal(hkStopSubmitAllowed(priorRejection.snapshot()), false, "an older rejection cannot unlock the new request");
const currentOldRejection = priorRejection.beginRead();
priorRejection.completeRead(currentOldRejection, { phase: "rejected", request_id: "request-a" });
assert.equal(hkStopSubmitAllowed(priorRejection.snapshot()), false);

priorRejection.completePost({ phase: "unknown", request_id: requestB, request_succeeded: true });
assert.equal(priorRejection.snapshot().phase, "unknown");
assert.equal(priorRejection.snapshot().request_succeeded, false);
const emptyWhilePending = priorRejection.beginRead();
priorRejection.completeRead(emptyWhilePending, { phase: null });
assert.equal(priorRejection.snapshot().phase, "unknown");
assert.equal(hkStopSubmitAllowed(priorRejection.snapshot()), false, "an empty read cannot retry while the post may still be unsettled");
const failedRefresh = priorRejection.beginRead();
priorRejection.failRead(failedRefresh);
assert.equal(priorRejection.snapshot().phase, "unknown");
assert.equal(hkStopSubmitAllowed(priorRejection.snapshot()), false, "a failed refresh keeps the lock");
priorRejection.completePost({ phase: "rejected", request_id: requestB });
assert.equal(priorRejection.snapshot().phase, "rejected");
assert.equal(hkStopSubmitAllowed(priorRejection.snapshot()), true, "rejection of the same request can submit again");
const accepted = priorRejection.beginSubmit();
priorRejection.completePost({ phase: "accepted", request_id: accepted });
assert.equal(priorRejection.snapshot().phase, "accepted");
assert.equal(hkStopSubmitAllowed(priorRejection.snapshot()), false);
const confirmedStop = createHkStopController();
const confirmedRead = confirmedStop.beginRead();
confirmedStop.completeRead(confirmedRead, { phase: "stopped", request_id: "request-stopped" });
assert.equal(confirmedStop.snapshot().phase, "stopped");
assert.equal(hkStopSubmitAllowed(confirmedStop.snapshot()), false, "a confirmed stop cannot be submitted again");
const lateAccepted = confirmedStop.beginRead();
confirmedStop.completeRead(lateAccepted, { phase: "accepted", request_id: "request-stopped" });
assert.equal(confirmedStop.snapshot().phase, "stopped");
const lateUnknown = confirmedStop.beginRead();
confirmedStop.completeRead(lateUnknown, { phase: "unknown", request_id: "request-stopped" });
assert.equal(confirmedStop.snapshot().phase, "stopped", "a later unknown read cannot replace a confirmed stop");
confirmedStop.completePost({ phase: "accepted", request_id: "request-stopped" });
assert.equal(confirmedStop.snapshot().phase, "stopped");
console.log("console_v2_operations_validation: PASS");

async function receiptFor(expected, changes = {}) {
  const content = { schema_version: expected.review_sha256 ? "qsl_human_decision_receipt.v2" : "qsl_human_decision_receipt.v1",
    ...(expected.review_sha256 ? { review_binding: { schema_version: "qsl_promotion_review_binding.v2", review_sha256: expected.review_sha256 } } : {}),
    kind: expected.kind, subject_id: expected.subject_id, material_sha256: expected.material_sha256, action: expected.action, target: expected.target,
    decided_at: "2026-10-07T06:00:00.123456Z", decided_by: "synthetic-original-actor", no_order: true, execution_authority_granted: false, ...changes };
  return { ...content, receipt_sha256: await humanDecisionDigest(content) };
}
const fullTicket = { ticket_id: "synthetic-promotion", strategy_profile: "demo", domain: "us_equity", proposed_params: { x: 1 }, shadow_passed: true, shadow_evidence_kind: "paired_shadow", drift_status: "stable", drift_score: 0, budget: 2, search_iterations: 1, suggested_risk_profile: "CAPITAL_PRESERVATION", notification_subject: "synthetic", notification_body: "synthetic only", notes: [], research_summary: null };
const six = Object.fromEntries(["ticket_id", "strategy_profile", "domain", "proposed_params", "shadow_passed", "shadow_evidence_kind"].map(k => [k, fullTicket[k]]));
const fullMaterial = { schema_version: "qsl_promotion_review_material.v2", ...fullTicket };
fullTicket.decision_binding = { kind: "promotion", subject_id: fullTicket.ticket_id, material_sha256: await humanDecisionDigest(six), review_binding: { schema_version: "qsl_promotion_review_binding.v2", review_sha256: await humanDecisionDigest(fullMaterial) } };
const promotionBody = { ticket_id: fullTicket.ticket_id, decision: "accept", selected_account: { platform: "longbridge", key: "synthetic-paper" }, confirmation: { target_platform: "longbridge", execution_mode: "paper", risk_profile: "CAPITAL_PRESERVATION" } };
const pExpected = await humanDecisionExpectation("promotion", fullTicket, promotionBody);
assert.ok(pExpected); assert.equal(promotionDecisionReady(fullTicket), true);
assert.equal(await humanDecisionExpectation("promotion", { ...fullTicket, notification_body: "changed reviewed content" }, promotionBody), null);
const v1PromotionExpectation = await humanDecisionExpectation("promotion", { ...fullTicket, decision_binding: { ...fullTicket.decision_binding, review_binding: null } }, promotionBody);
assert.ok(v1PromotionExpectation); assert.equal(v1PromotionExpectation.review_sha256, null);
assert.equal(await matchingHumanDecisionReceipt(v1PromotionExpectation, await receiptFor(v1PromotionExpectation)), true);
assert.equal(await humanDecisionExpectation("promotion", { ...fullTicket, decision_binding: { ...fullTicket.decision_binding, review_binding: {} } }, promotionBody), null);
const pReceipt = await receiptFor(pExpected);
assert.equal(await matchingHumanDecisionReceipt(pExpected, pReceipt), true);
for (const changes of [{ action: "reject" }, { material_sha256: "f".repeat(64) }, { target: { ...pExpected.target, selected_account: { platform: "longbridge", key: "other-account" } } }, { target: { ...pExpected.target, confirmation: { ...promotionBody.confirmation, execution_mode: "live" } } }, { no_order: false }, { execution_authority_granted: true }, { decided_by: "bad\nactor" }, { decided_at: "not-time" }, { extra: true }, { review_binding: { schema_version: "qsl_promotion_review_binding.v2", review_sha256: "f".repeat(64) } }]) {
  assert.equal(await matchingHumanDecisionReceipt(pExpected, await receiptFor(pExpected, changes)), false, JSON.stringify(changes));
}
assert.equal(await matchingHumanDecisionReceipt(pExpected, { ...pReceipt, receipt_sha256: "0".repeat(64) }), false);
const rejectedExpected = await humanDecisionExpectation("promotion", fullTicket, { ticket_id: fullTicket.ticket_id, decision: "reject", confirmation: null });
assert.ok(rejectedExpected); assert.deepEqual(rejectedExpected.target, { selected_account: null, confirmation: null });
const rejectedReceipt = await receiptFor(rejectedExpected);
const ownerSource = { candidate: { candidate_id: "synthetic-owner" }, candidate_evidence_sha256: "a".repeat(64), decision_binding: { kind: "owner", subject_id: "synthetic-owner", material_sha256: "a".repeat(64) } };
const oExpected = await humanDecisionExpectation("owner", ownerSource, { candidate_id: "synthetic-owner", candidate_evidence_sha256: "a".repeat(64), decision: "keep_parked" });
const oReceipt = await receiptFor(oExpected);
assert.equal(await matchingHumanDecisionReceipt(oExpected, oReceipt), true, "legacy v1 owner receipts remain readable");
const recoveryMaterial = { recovery_id: "synthetic-recovery", candidate_sha256: "b".repeat(64), dual_review_binding_sha256: "b".repeat(64) };
const rExpected = await humanDecisionExpectation("recovery", { recovery: { ...recoveryMaterial, dual_review: { evidence_binding_sha256: "b".repeat(64) } }, decision_binding: { kind: "recovery", subject_id: recoveryMaterial.recovery_id, material_sha256: await humanDecisionDigest(recoveryMaterial) } }, { ...recoveryMaterial, decision: "reject" });
assert.ok(rExpected); assert.notEqual(rExpected.material_sha256, recoveryMaterial.candidate_sha256);
assert.equal(await matchingHumanDecisionReceipt(rExpected, await receiptFor(rExpected)), true);
const oldPromotion = { ...rejectedExpected, review_sha256: null };
assert.equal(await matchingHumanDecisionReceipt(oldPromotion, await receiptFor(oldPromotion)), true, "historical v1 promotion receipt supports its original v1 expectation");
assert.equal(await matchingHumanDecisionReceipt(rejectedExpected, await receiptFor(oldPromotion)), false, "v1 cannot substitute full v2 review binding");
const decisionController = createHumanDecisionController();
const submit = decisionController.start(rejectedExpected);
assert.ok(submit); assert.equal(decisionController.start({ ...rejectedExpected, action: "accept", target: pExpected.target }), null);
assert.equal(await decisionController.receive(submit, rejectedReceipt), true);
assert.equal(decisionController.entries()[0].status, "unresolved", "POST receipt and queue refresh are independent facts");
const readback = receipt => ({ ok: true, decision_readback: { schema_version: "qsl_human_decision_readback.v1", source: "durable_human_decision_record", kind: rejectedExpected.kind, subject_id: rejectedExpected.subject_id, requested_material_sha256: rejectedExpected.material_sha256, observed_at: "2026-10-07T07:00:00Z", lookup_status: "found", receipt, current_material: { status: "not_current" } } });
let probe = decisionController.beginRead(rejectedExpected);
assert.equal(await decisionController.readback(probe, readback(rejectedReceipt), true), true);
assert.equal(decisionController.entries()[0].status, "recorded", "rejected historical receipt does not depend on a current queue item");
probe = decisionController.beginRead(rejectedExpected); decisionController.readFailed(probe);
assert.equal(decisionController.entries()[0].status, "unresolved");
assert.deepEqual(decisionController.entries()[0].receipt, rejectedReceipt, "refresh failure keeps original verified receipt/time");
assert.equal(decisionController.start(rejectedExpected), null);
const olderProbe = decisionController.beginRead(rejectedExpected), newProbe = decisionController.beginRead(rejectedExpected);
assert.equal(await decisionController.readback(olderProbe, readback(await receiptFor(rejectedExpected, { decided_at: "2026-10-07T08:00:00Z" })), true), false);
assert.equal(await decisionController.readback(newProbe, readback(rejectedReceipt), true), true);
assert.equal(decisionController.entries()[0].receipt.decided_at, rejectedReceipt.decided_at);
assert.equal(await decisionController.receive(submit, await receiptFor(rejectedExpected, { decided_at: "2026-10-07T08:00:00Z" }), true), false, "same material conflicting original receipt remains unresolved");
assert.equal(decisionController.entries()[0].receipt.decided_at, rejectedReceipt.decided_at);
probe = decisionController.beginRead(rejectedExpected);
assert.equal(await decisionController.readback(probe, { ...readback(null), decision_readback: { ...readback(null).decision_readback, lookup_status: "not_found" } }, true), false);
assert.equal(decisionController.entries()[0].receipt.decided_at, rejectedReceipt.decided_at);
assert.equal(await decisionController.readback(decisionController.beginRead(rejectedExpected), readback(rejectedReceipt), true), true);
decisionController.clear();
assert.equal(await decisionController.receive(submit, rejectedReceipt, true), false, "late receipt cannot enter a new private session");
assert.deepEqual(decisionController.entries(), []);
assert.notEqual(buildConfirmationFingerprint({ promotionTickets: [fullTicket] }), buildConfirmationFingerprint({ promotionTickets: [{ ...fullTicket, decision_binding: { ...fullTicket.decision_binding, review_binding: { schema_version: "qsl_promotion_review_binding.v2", review_sha256: "f".repeat(64) } } }] }));
assert.equal(translate("决定已记录：{time}。{detail}", "en", { time: rejectedReceipt.decided_at, detail: "readback pending" }).includes(rejectedReceipt.decided_at), true);
console.log("human decision client receipt validation: PASS");

// Cross-check the real server receipt constructor/canonical hashes, not just a
// locally generated expected shape. These helpers are pure and use synthetic data.
const { __test: serverContract } = await import("../web/strategy-switch-console/worker.js");
assert.equal(await serverContract.researchPromotionMaterialKey(fullTicket), pExpected.material_sha256);
assert.deepEqual(await serverContract.researchPromotionReviewBinding(fullTicket), fullTicket.decision_binding.review_binding);
const decided_at = pReceipt.decided_at, actor = pReceipt.decided_by;
for (const expected of [pExpected, v1PromotionExpectation]) {
  const payload = { ticket: { ...fullTicket, human_decision: expected.action, human_decided_at: decided_at, live_authority_granted: false },
    selected_account: expected.target.selected_account, confirmation: expected.target.confirmation,
    ...(expected.review_sha256 ? { review_binding: fullTicket.decision_binding.review_binding, review_material: serverContract.researchPromotionReviewMaterial(fullTicket) } : {}) };
  const actual = await serverContract.humanDecisionReceipt({ kind: "promotion", subject_id: expected.subject_id, material_key: expected.material_sha256,
    action: expected.action, actor, decided_at, target_json: JSON.stringify(expected.target), payload }, expected);
  assert.equal(await matchingHumanDecisionReceipt(expected, actual), true);
}
const ownerPayload = { schema_version: "qsl_owner_decision_intent.v1", candidate_id: oExpected.subject_id, candidate_evidence_sha256: oExpected.material_sha256,
  decision: oExpected.action, decided_at, decided_by: actor, no_order: true, execution_authority_granted: false };
ownerPayload.decision_sha256 = await humanDecisionDigest(ownerPayload);
assert.equal(await matchingHumanDecisionReceipt(oExpected, await serverContract.humanDecisionReceipt({ kind: "owner", subject_id: oExpected.subject_id, material_key: oExpected.material_sha256,
  action: oExpected.action, actor, decided_at, target_json: JSON.stringify(oExpected.target), payload: ownerPayload }, oExpected)), true);
const recoveryPayload = { schema_version: "qsl_reconciliation_recovery_rejection.v1", ...recoveryMaterial, decision: "reject", decided_at, decided_by: actor, no_order: true, execution_authority_granted: false };
assert.equal(await matchingHumanDecisionReceipt(rExpected, await serverContract.humanDecisionReceipt({ kind: "recovery", subject_id: rExpected.subject_id, material_key: rExpected.material_sha256,
  action: rExpected.action, actor, decided_at, target_json: JSON.stringify(rExpected.target), payload: recoveryPayload }, rExpected)), true);
console.log("actual server/client receipt parity: PASS (owner, recovery, promotion v1/v2)");
