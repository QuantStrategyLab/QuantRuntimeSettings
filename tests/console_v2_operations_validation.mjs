import assert from "node:assert/strict";
import {
  buildSwitchInputs, canResumeBinance, currentResearchPreview, defaultSwitchDraft,
  applicationRetryAllowed, buildConfirmationFingerprint, ownerDecisionBinding, recoveryBinding,
  confirmationAccepted, createRequestLock, pageFromWorkspace,
  summarizeExternalResearchSubject, hasUnsavedModeEdits, shouldBlockModeReload, hasChangedSwitchDraft,
  diagnosisStatusKey, diagnosisConclusionKey, diagnosisNextStepKey,
} from "../web/strategy-switch-console/frontend/src/operations.ts";
import { formatAccountCount, translate } from "../web/strategy-switch-console/frontend/src/locales.ts";

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
assert.equal(hasUnsavedModeEdits({ research: true, account: false, admin: false }), true);
assert.equal(hasUnsavedModeEdits({ research: false, account: false, admin: false }), false);
assert.equal(shouldBlockModeReload({ requestBusy: false, protectedLock: true }), true);
assert.equal(shouldBlockModeReload({ requestBusy: false, protectedLock: false }), false,
  "server-persisted diagnosis or research states do not prevent a display-only reload");
assert.equal(hasChangedSwitchDraft({ ...form, strategy: "changed" }, form), true);
assert.equal(hasChangedSwitchDraft(form, form), false);
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
assert.equal(pageFromWorkspace("reports"), "reports", "report deep links survive initial load and history navigation");
assert.equal(pageFromWorkspace("research"), "strategy");
assert.equal(pageFromWorkspace("unknown"), "overview");
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
console.log("console_v2_operations_validation: PASS");
