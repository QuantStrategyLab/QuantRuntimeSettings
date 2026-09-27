import {
  DCA_SUPPORTED_PLATFORMS, PLATFORM_CONFIG,
  PLATFORM_MIN_RESERVED_CASH_VARIABLES, PLATFORM_RESERVED_CASH_RATIO_VARIABLES,
} from "../../config.js";
import type { AccountOption, CurrentStrategy } from "./api";

const platformSettings = PLATFORM_CONFIG as Record<string, any>;
const minimumVariables = PLATFORM_MIN_RESERVED_CASH_VARIABLES as Record<string, string>;
const ratioVariables = PLATFORM_RESERVED_CASH_RATIO_VARIABLES as Record<string, string>;

export type SwitchDraft = {
  strategy: string; executionMode: string; runtimeMode: "current" | "enabled" | "disabled";
  pluginMode: "current" | "none" | "auto"; incomeMode: "current" | "enabled" | "disabled";
  incomeStart: string; incomeRatio: string; optionMode: "current" | "enabled" | "disabled";
  reserveMode: "current" | "none" | "ratio" | "floor" | "max"; reserveFloor: string; reserveRatio: string;
  cashOnlyMode: "current" | "enabled" | "disabled"; dcaMode: "fixed" | "smart"; dcaBase: string;
  touched: Record<string, boolean>;
};

export function defaultSwitchDraft(account: AccountOption, current: CurrentStrategy | null, platform: string): SwitchDraft {
  return {
    strategy: current?.strategy_profile || String(account.default_strategy_profile || ""),
    executionMode: String(current?.execution_mode || account.default_execution_mode || platformSettings[platform]?.default_execution_mode || "dry_run"),
    runtimeMode: "current", pluginMode: "current", incomeMode: "current", incomeStart: "", incomeRatio: "",
    optionMode: "current", reserveMode: "current", reserveFloor: "", reserveRatio: "", cashOnlyMode: "current",
    dcaMode: "fixed", dcaBase: "", touched: {},
  };
}

export function numericText(value: string, max: number, positive = false): string | null {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max || (positive && number <= 0)) return null;
  return String(number);
}

export function buildSwitchInputs(platform: string, account: AccountOption, form: SwitchDraft): Record<string, string> {
  const config = platformSettings[platform];
  if (!account || !form.strategy) throw new Error("请选择账户和策略。");
  if (!config?.supported_execution_modes?.includes(form.executionMode)) throw new Error("此平台不支持所选执行方式。");
  const inputs: Record<string, string> = {
    platform, target_name: account.target_name || account.key, strategy_profile: form.strategy,
    execution_mode: form.executionMode, variable_scope: String(account.variable_scope || "default"),
    plugin_mode: form.touched.pluginMode ? form.pluginMode : "current", service_targets_mode: "auto",
    apply: "true", trigger_platform_sync: "true", confirm_apply: "APPLY_AND_SYNC",
    platform_sync_workflow: "sync-cloud-run-env.yml",
    runtime_target_enabled_mode: form.runtimeMode,
    income_layer_mode: form.touched.income ? form.incomeMode : "current",
    option_overlay_mode: form.touched.option ? form.optionMode : "current",
  };
  for (const field of ["github_environment", "deployment_selector", "account_selector", "account_scope", "service_name"] as const) {
    const value = account[field]; if (typeof value === "string" && value) inputs[field] = value;
  }
  const extra: Record<string, string> = {};
  if (form.runtimeMode !== "current") extra.RUNTIME_TARGET_ENABLED = form.runtimeMode === "enabled" ? "true" : "false";
  if (form.touched.pluginMode && form.pluginMode === "auto") inputs.plugin_mode = "auto";
  if (form.touched.income && config.income_layer) {
    if (form.incomeMode === "disabled") {
      extra.INCOME_LAYER_ENABLED = "false"; extra.INCOME_LAYER_START_USD = ""; extra.INCOME_LAYER_MAX_RATIO = "";
    } else if (form.incomeMode === "enabled") {
      const start = numericText(form.incomeStart, Number.MAX_SAFE_INTEGER, true);
      const ratio = numericText(form.incomeRatio, 1, true);
      if (!start || !ratio) throw new Error("收入层需要有效的起始金额与 0–1 比例。");
      inputs.income_layer_start_usd = start; inputs.income_layer_max_ratio = ratio;
      extra.INCOME_LAYER_ENABLED = "true"; extra.INCOME_LAYER_START_USD = start; extra.INCOME_LAYER_MAX_RATIO = ratio;
    }
  }
  if (form.touched.option && config.option_overlay) inputs.option_overlay_mode = form.optionMode;
  if (config.margin_policy) inputs.cash_only_execution_mode = form.touched.cashOnly ? form.cashOnlyMode : "current";
  if (form.touched.reserve && config.reserved_cash) {
    inputs.reserved_cash_policy_mode = form.reserveMode;
    const floor = numericText(form.reserveFloor, Number.MAX_SAFE_INTEGER);
    const ratio = numericText(form.reserveRatio, 1);
    if (["floor", "max"].includes(form.reserveMode) && !floor) throw new Error("预留金额必须为非负数字。");
    if (["ratio", "max"].includes(form.reserveMode) && !ratio) throw new Error("预留比例必须在 0–1 之间。");
    const floorKey = minimumVariables[platform];
    const ratioKey = ratioVariables[platform];
    if (form.reserveMode === "none") { if (floorKey) extra[floorKey] = ""; if (ratioKey) extra[ratioKey] = ""; }
    if (form.reserveMode === "ratio") { inputs.reserved_cash_ratio = ratio!; if (floorKey) extra[floorKey] = ""; }
    if (form.reserveMode === "floor") { inputs.min_reserved_cash_usd = floor!; if (ratioKey) extra[ratioKey] = ""; }
    if (form.reserveMode === "max") { inputs.min_reserved_cash_usd = floor!; inputs.reserved_cash_ratio = ratio!; }
  }
  if (form.touched.dca && config.dca && DCA_SUPPORTED_PLATFORMS.has(platform)) {
    const base = numericText(form.dcaBase, Number.MAX_SAFE_INTEGER, true);
    if (!base) throw new Error("定投金额需大于零。");
    inputs.dca_mode = form.dcaMode; inputs.dca_base_investment_usd = base;
  }
  if (Object.keys(extra).length) inputs.extra_variables_json = JSON.stringify(extra);
  return inputs;
}

export function canResumeBinance(platform: string, account: AccountOption | null, current: CurrentStrategy | null): boolean {
  return platform === "binance" && Boolean(account?.target_name)
    && current?.runtime_target_enabled === false
    && typeof current.binance_resume_target_sha256 === "string"
    && /^[a-f0-9]{64}$/.test(current.binance_resume_target_sha256);
}

export function ownerDecisionBinding(candidate: Record<string, any>, decision: string) {
  const evidence = candidate.candidate_evidence_sha256 || candidate.owner_decision?.candidate_evidence_sha256;
  if (!candidate.candidate_id || !/^[a-f0-9]{64}$/.test(String(evidence || ""))) return null;
  if (!["approve_limited_live_canary", "keep_parked", "retire_candidate"].includes(decision)) return null;
  return { candidate_id: candidate.candidate_id, candidate_evidence_sha256: evidence, decision };
}

export function recoveryBinding(entry: Record<string, any>) {
  const recovery = entry.recovery || {};
  if (entry.freshness?.data_status !== "ready" || entry.confirmation
    || recovery.readiness !== "awaiting_human_confirmation"
    || !Array.isArray(recovery.blocker_codes) || recovery.blocker_codes.length
    || !/^[a-f0-9]{64}$/.test(String(recovery.candidate_sha256 || ""))
    || recovery.dual_review?.evidence_binding_sha256 !== recovery.candidate_sha256) return null;
  return {
    recovery_id: recovery.recovery_id,
    candidate_sha256: recovery.candidate_sha256,
    dual_review_binding_sha256: recovery.dual_review.evidence_binding_sha256,
  };
}

export function currentResearchPreview(draft: Record<string, any> | null): boolean {
  return Boolean(draft && !draft.preview_stale && !draft.preview?.stale
    && !["queued", "running", "unknown"].includes(draft.job?.status)
    && ["computed", "no_advantage", "no_action"].includes(draft.preview?.status));
}

export function confirmationAccepted(confirmed: boolean, openedSnapshot: string, currentSnapshot: string): boolean {
  return confirmed && openedSnapshot === currentSnapshot;
}

export function createRequestLock() {
  const keys = new Set<string>();
  return {
    acquire(key: string): boolean { if (keys.has(key)) return false; keys.add(key); return true; },
    release(key: string): void { keys.delete(key); },
    isLocked(key: string): boolean { return keys.has(key); },
    hasAny(candidates: string[]): boolean { return candidates.some(key => keys.has(key)); },
    hasAnyWithPrefixes(prefixes: string[]): boolean { return [...keys].some(key => prefixes.some(prefix => key.startsWith(prefix))); },
    clear(): void { keys.clear(); },
  };
}

export function hasUnsavedModeEdits(input: { research: boolean; account: boolean; admin: boolean }): boolean {
  return input.research || input.account || input.admin;
}

export function hasChangedSwitchDraft(draft: SwitchDraft | undefined, baseline: SwitchDraft): boolean {
  if (!draft) return false;
  return (Object.keys(baseline) as Array<keyof SwitchDraft>)
    .filter(key => key !== "touched")
    .some(key => draft[key] !== baseline[key])
    || Object.values(draft.touched).some(Boolean);
}

export function shouldBlockModeReload(input: {
  requestBusy: boolean;
  protectedLock: boolean;
}): boolean {
  return input.requestBusy || input.protectedLock;
}

export function diagnosisStatusKey(task: Record<string, any> | null | undefined): string {
  if (!task) return "尚无运行诊断记录";
  if (task.status === "queued") return "诊断排队中";
  if (task.status === "running") return "诊断处理中";
  if (task.status === "unknown") return "诊断结果待确认，请先读回状态";
  if (task.status === "failed") return "诊断未完成";
  if (task.status === "succeeded" && task.recheck_status === "passed") return "诊断完成，监测复核通过";
  if (task.status === "succeeded" && task.recheck_status === "attention") return "诊断完成，复核需要关注";
  if (task.status === "succeeded" && task.recheck_status === "unavailable") return "诊断完成，复核资料不可用";
  if (task.status === "succeeded" && task.recheck_status === "sent") return "诊断已完成，复核仍在进行";
  if (task.status === "succeeded") return "诊断完成，复核状态未知";
  return "诊断状态暂不可用";
}

export function diagnosisConclusionKey(task: Record<string, any> | null | undefined): string {
  if (!task) return "尚无运行诊断记录";
  if (task.status === "unknown" || task.dispatch_state === "unknown") return "派发结果需人工核对，暂不重复请求。";
  if (task.status === "succeeded" && task.reason_code === "diagnosis_ready") return "只读诊断已完成，请查看账户运行资料与监测复核结论。";
  if (task.status === "failed" && ["capacity_unavailable", "codex_unavailable"].includes(String(task.reason_code || ""))) return "诊断服务暂不可用；账户运行资料未被更改。";
  if (task.status === "failed" && task.reason_code === "invalid_response") return "诊断结果未通过校验，需要人工核对账户运行资料。";
  return diagnosisStatusKey(task);
}

export function diagnosisNextStepKey(task: Record<string, any> | null | undefined): string {
  if (!task) return "完成只读诊断后，会在此显示结论和后续核对步骤。";
  if (["queued", "running"].includes(String(task.status || ""))) return "等待诊断与只读复核完成；请勿重复提交。";
  if (task.status === "unknown") return "派发结果需人工核对，暂不重复请求。";
  if (task.status === "failed") return "诊断未完成。核对账户运行资料后，再按需重新请求。";
  if (task.status === "succeeded" && task.recheck_status === "passed") return "只读复核已完成；查看账户运行资料。此结果不代表已修复。";
  if (task.status === "succeeded" && task.recheck_status === "attention") return "复核发现需要关注；请检查账户运行资料并按既有流程处理。";
  if (task.status === "succeeded" && task.recheck_status === "unavailable") return "复核资料暂不可用；刷新账户运行状态后再决定。";
  if (task.status === "succeeded" && task.recheck_status === "sent") return "只读复核仍在处理；等待状态读回后再操作。";
  if (task.status === "succeeded") return "复核状态未确认；刷新资料后再决定是否继续。";
  return "刷新账户运行资料，核对最新状态后再决定。";
}

export function pageFromWorkspace(value: string | null): "overview" | "strategy" | "accounts" | "reports" {
  if (value === "research" || value === "strategy") return "strategy";
  if (value === "accounts") return "accounts";
  if (value === "reports") return "reports";
  return "overview";
}

export function summarizeExternalResearchSubject(value: unknown, unknownLabel: string): {
  title: string; status: "ready" | "stale" | "unknown"; asOf: string | null;
} {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
  const subject = item.subject && typeof item.subject === "object" && !Array.isArray(item.subject)
    ? item.subject as Record<string, unknown>
    : {};
  const identifier = typeof subject.identifier === "string" ? subject.identifier.trim() : "";
  const fallbackId = typeof item.subject_id === "string" ? item.subject_id.trim() : "";
  const title = identifier || fallbackId || unknownLabel;
  const observations = Array.isArray(item.observations)
    ? item.observations.filter((observation: unknown) => observation && typeof observation === "object" && !Array.isArray(observation)) as Array<Record<string, any>>
    : [];
  const latest = observations.reduce<Record<string, any> | null>((current, observation) => {
    const currentDate = typeof current?.generated_at === "string" ? current.generated_at : typeof current?.as_of === "string" ? current.as_of : "";
    const observationDate = typeof observation.generated_at === "string" ? observation.generated_at : typeof observation.as_of === "string" ? observation.as_of : "";
    return observationDate > currentDate ? observation : current;
  }, null);
  const status = latest?.freshness?.status === "fresh" ? "ready"
    : latest?.freshness?.status === "stale" ? "stale" : "unknown";
  const asOf = typeof latest?.as_of === "string" && latest.as_of.trim() ? latest.as_of : null;
  return { title, status, asOf };
}

export function applicationRetryAllowed(application: Record<string, any> | null | undefined): boolean {
  if (!application) return true;
  return application.status === "rejected";
}

export function buildConfirmationFingerprint(context: Record<string, any>): string {
  return JSON.stringify({
    session: [context.session?.allowed, context.session?.admin],
    selectedId: context.selectedId,
    selectedAccount: context.selectedAccount,
    currentStrategy: context.currentStrategy,
    runtimeAt: context.runtimeAt,
    controlAt: context.controlAt,
    ownerCandidates: (context.ownerCandidates || []).map((item: any) => [item.candidate?.candidate_id, item.candidate_evidence_sha256, item.intent?.decision]),
    recoveries: (context.recoveries || []).map((item: any) => [item.recovery?.recovery_id, item.recovery?.candidate_sha256, item.recovery?.readiness, item.recovery?.blocker_codes, item.freshness?.data_status, item.recovery?.dual_review?.evidence_binding_sha256]),
    promotionTickets: (context.promotionTickets || []).map((item: any) => [item.ticket_id, item.state, item.proposed_params, item.source_check_required, item.source_identity]),
    promotionApplications: (context.promotionApplications || []).map((item: any) => [item.ticket_id, item.application_preparation?.preflight_status, item.application_preparation?.blocker_codes, item.application_preparation?.preview_request, item.application?.application_id, item.application?.status, item.application?.dispatch_state, item.application?.expected_revision, item.application?.updated_at]),
    switchDrafts: context.switchDrafts,
    uxDraft: context.uxDraft,
    uxDirty: context.uxDirty,
    promotionSelection: [context.promotionTicketId, context.promotionAccountId, context.promotionRisk],
    adminRevision: context.adminRevision,
    adminRisk: context.adminRisk,
    adminText: context.adminText,
    instanceDraft: context.instanceDraft,
    editingInstance: context.editingInstance,
  });
}
