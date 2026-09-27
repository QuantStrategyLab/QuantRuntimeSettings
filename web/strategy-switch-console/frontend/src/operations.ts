import {
  DCA_SUPPORTED_PLATFORMS, PLATFORM_CONFIG,
  PLATFORM_MIN_RESERVED_CASH_VARIABLES, PLATFORM_RESERVED_CASH_RATIO_VARIABLES,
} from "../../config.js";
import type { AccountOption, AccountStateProjection, CurrentStrategy } from "./api";

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

export type AccountSettingOverridePatch = {
  strategy_profile?: string | null;
  income_layer_enabled?: boolean | null;
  reserved_cash_floor?: string | null;
};

export type HkStopPhase = "loading" | "unavailable" | "empty" | "reserved" | "unknown" | "accepted" | "rejected";

export type HkStopView = {
  phase: HkStopPhase;
  request_id: string | null;
  dispatch_result: string | null;
  request_succeeded: false;
  platform_applied: false;
  notice: "none" | "read_failed" | "unknown" | "accepted" | "rejected";
};

const HK_STOP_LOCKED = new Set<HkStopPhase>(["reserved", "unknown", "accepted"]);

export function hkStopInitialView(): HkStopView {
  return {
    phase: "loading", request_id: null, dispatch_result: null,
    request_succeeded: false, platform_applied: false, notice: "none",
  };
}

export function hkStopSubmitAllowed(record: { phase?: string | null } | null | undefined): boolean {
  return record?.phase === "empty" || record?.phase === "rejected";
}

export function hkStopLockForSubmit(current: HkStopView | null | undefined, requestId: string): HkStopView {
  return {
    ...(current?.phase ? current : hkStopInitialView()),
    phase: "reserved",
    request_id: requestId,
    request_succeeded: false,
    platform_applied: false,
    notice: "unknown",
  };
}

export function hkStopReadFailed(current: HkStopView | null | undefined): HkStopView {
  if (current && HK_STOP_LOCKED.has(current.phase)) {
    return { ...current, request_succeeded: false, platform_applied: false, notice: "read_failed" };
  }
  return { ...hkStopInitialView(), phase: "unavailable", notice: "read_failed" };
}

function hkStopServerView(phase: "rejected" | "accepted" | "unknown" | "reserved", payload: {
  request_id?: string | null;
  dispatch_result?: string | null;
}): HkStopView {
  return {
    phase,
    request_id: payload.request_id ?? null,
    dispatch_result: payload.dispatch_result ?? null,
    request_succeeded: false,
    platform_applied: false,
    notice: phase === "rejected" ? "rejected" : phase === "accepted" ? "accepted" : "unknown",
  };
}

export function hkStopApplyServer(current: HkStopView | null | undefined, payload: {
  phase?: string | null;
  request_id?: string | null;
  dispatch_result?: string | null;
} | null | undefined): HkStopView {
  const phase = payload?.phase;
  const incomingId = payload?.request_id ?? null;
  const locked = Boolean(current && HK_STOP_LOCKED.has(current.phase));
  if (locked) {
    if (!incomingId || incomingId !== current?.request_id) return current?.phase ? current : hkStopInitialView();
    if (phase === "rejected" || phase === "accepted" || phase === "unknown" || phase === "reserved") {
      return hkStopServerView(phase, payload || {});
    }
    return current?.phase ? current : hkStopInitialView();
  }
  if (phase === "rejected" || phase === "accepted" || phase === "unknown" || phase === "reserved") {
    return hkStopServerView(phase, payload || {});
  }
  if (payload && (phase === null || phase === undefined)) {
    return { ...hkStopInitialView(), phase: "empty" };
  }
  return hkStopReadFailed(current);
}

export function createHkStopController() {
  let generation = 0;
  let view = hkStopInitialView();
  return {
    snapshot() { return view; },
    beginRead() {
      generation += 1;
      return generation;
    },
    beginSubmit() {
      generation += 1;
      const requestId = crypto.randomUUID();
      view = hkStopLockForSubmit(view, requestId);
      return requestId;
    },
    completeRead(token: number, payload: {
      phase?: string | null;
      request_id?: string | null;
      dispatch_result?: string | null;
    } | null | undefined) {
      if (token !== generation) return view;
      view = hkStopApplyServer(view, payload);
      return view;
    },
    failRead(token: number) {
      if (token !== generation) return view;
      view = hkStopReadFailed(view);
      return view;
    },
    completePost(payload: {
      phase?: string | null;
      request_id?: string | null;
      dispatch_result?: string | null;
    } | null | undefined) {
      if (!payload?.request_id || payload.request_id !== view.request_id) return view;
      view = hkStopApplyServer(view, payload);
      return view;
    },
  };
}

export function accountSettingDraftBody(input: {
  expectedDraftRevision: number;
  identity: Record<string, unknown>;
  overrides: AccountSettingOverridePatch;
  acknowledgeIdentityConflict?: boolean;
}): Record<string, unknown> {
  const overrides: Record<string, string | boolean | null> = {};
  if (Object.prototype.hasOwnProperty.call(input.overrides, "strategy_profile")) overrides.strategy_profile = input.overrides.strategy_profile ?? null;
  if (Object.prototype.hasOwnProperty.call(input.overrides, "income_layer_enabled")) overrides.income_layer_enabled = input.overrides.income_layer_enabled ?? null;
  if (Object.prototype.hasOwnProperty.call(input.overrides, "reserved_cash_floor")) overrides.reserved_cash_floor = input.overrides.reserved_cash_floor ?? null;
  const body: Record<string, unknown> = {
    expected_draft_revision: input.expectedDraftRevision,
    identity: input.identity,
    overrides,
  };
  if (input.acknowledgeIdentityConflict) body.acknowledge_identity_conflict = true;
  return body;
}

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
  if (!["approve_limited_live_canary", "keep_parked"].includes(decision)) return null;
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
    decision: "approve",
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

function stableIdentity(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableIdentity).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableIdentity(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function candidateIdentity(candidate: Record<string, any>): string | null {
  if (typeof candidate.candidate_id !== "string" || !candidate.candidate_id) return null;
  return `${candidate.candidate_id}:${stableIdentity({
    candidate_kind: candidate.candidate_kind,
    domain: candidate.domain,
    lifecycle: candidate.lifecycle,
    evidence: candidate.evidence,
    recommendation: { code: candidate.recommendation?.code || "none" },
  })}`;
}

type HomeAttentionItem = {
  identity: string;
  kind: "owner" | "candidate_review" | "promotion" | "promotion_source" | "recovery" | "recovery_blocked" | "account";
  title: string;
  detail: string;
  source: "control" | "owners" | "promotions" | "recovery" | "runtime";
  target: "strategy" | "accounts";
  targetId?: string;
};

function readySource(source: any): boolean {
  return Boolean(!source?.error && source?.value && source.value.data_status === "ready");
}

function sourceIssue(source: any): "读取失败" | "资料已过期" | "暂不可用" | "状态未知" | null {
  if (source?.error) return "读取失败";
  if (!source?.value) return "状态未知";
  const status = source.value.data_status;
  if (status === "ready") return null;
  if (status === "stale") return "资料已过期";
  if (status === "unavailable") return "暂不可用";
  return "状态未知";
}

/** Builds a read-only home attention summary. Source errors remain explicit and never become an empty queue. */
export function buildHomeAttention(input: {
  control?: any; owners?: any; promotions?: any; recovery?: any; runtime?: any; config?: any;
  accounts?: Array<{ id: string; title: string; tone: string; label: string; detail: string }>;
}): { decisions: HomeAttentionItem[]; operations: HomeAttentionItem[]; sourceWarnings: Array<{ source: string; status: string }> } {
  const decisions: HomeAttentionItem[] = [];
  const operations: HomeAttentionItem[] = [];
  const sourceWarnings: Array<{ source: string; status: string }> = [];
  const sources: Array<[string, any]> = [
    ["控制平面", input.control], ["所有者决定", input.owners], ["候选晋级", input.promotions],
    ["恢复确认", input.recovery], ["账户运行", input.runtime],
  ];
  for (const [name, source] of sources) {
    const issue = sourceIssue(source);
    if (issue) sourceWarnings.push({ source: name, status: issue });
  }
  const configIssue = input.config?.error ? "读取失败" : input.config?.value?.accountOptions ? null : "状态未知";
  if (configIssue) sourceWarnings.push({ source: "账户配置", status: configIssue });

  const ownedCandidates = new Map<string, any>();
  if (readySource(input.owners)) {
    for (const entry of input.owners.value.candidates || []) {
      const candidate = entry?.candidate;
      const identity = candidate && candidateIdentity(candidate);
      if (!identity || !candidate) continue;
      ownedCandidates.set(identity, { entry, digest: entry?.candidate_evidence_sha256 });
      if (entry.intent) continue;
      decisions.push({ identity: `owner:${identity}`, kind: "owner", title: "策略去留待决定", detail: String(candidate.candidate_id), source: "owners", target: "strategy", targetId: String(candidate.candidate_id) });
    }
  }
  if (readySource(input.control)) {
    for (const candidate of input.control.value.candidates || []) {
      if (candidate?.lifecycle?.stage !== "P6" || candidate?.lifecycle?.status !== "owner_decision_required"
        || candidate?.recommendation?.code !== "owner_live_decision") continue;
      const identity = candidateIdentity(candidate);
      const owner = identity ? ownedCandidates.get(identity) : null;
      if (!identity || (owner && (!candidate.candidate_evidence_sha256 || !owner.digest || candidate.candidate_evidence_sha256 === owner.digest))) continue;
      // Control-plane items are review-only: the owner queue carries the current confirmation digest.
      operations.push({ identity: `candidate-review:${identity}`, kind: "candidate_review", title: "所有者决定资料需核对", detail: String(candidate.candidate_id), source: "control", target: "strategy", targetId: String(candidate.candidate_id) });
    }
  }

  if (readySource(input.promotions)) {
    for (const ticket of input.promotions.value.tickets || []) {
      if (!ticket?.ticket_id || !["awaiting_human", "ready_for_review"].includes(ticket.state)) continue;
      if (ticket.source_check_required || ticket.state !== "awaiting_human") {
        operations.push({ identity: `promotion-source:${ticket.ticket_id}`, kind: "promotion_source", title: "候选来源需核对", detail: String(ticket.ticket_id), source: "promotions", target: "strategy", targetId: String(ticket.ticket_id) });
      } else {
        decisions.push({ identity: `promotion:${ticket.ticket_id}`, kind: "promotion", title: "新策略方案待选择", detail: String(ticket.ticket_id), source: "promotions", target: "strategy", targetId: String(ticket.ticket_id) });
      }
    }
  }

  if (readySource(input.recovery)) {
    for (const entry of input.recovery.value.recoveries || []) {
      const recovery = entry?.recovery;
      if (!recovery?.recovery_id) continue;
      if (entry.freshness?.data_status !== "ready") {
        operations.push({ identity: `recovery-review:${recovery.recovery_id}:${recovery.candidate_sha256 || "unknown"}`, kind: "recovery_blocked", title: "恢复资料需重新核对", detail: `${recovery.platform || ""} ${recovery.target_name || recovery.recovery_id}`.trim(), source: "recovery", target: "strategy", targetId: String(recovery.recovery_id) });
        continue;
      }
      if (recovery.readiness === "awaiting_human_confirmation" && !entry.confirmation) {
        decisions.push({ identity: `recovery:${recovery.recovery_id}:${recovery.candidate_sha256 || "unknown"}`, kind: "recovery", title: "恢复账户运行前确认", detail: `${recovery.platform || ""} ${recovery.target_name || recovery.recovery_id}`.trim(), source: "recovery", target: "strategy", targetId: String(recovery.recovery_id) });
      } else if (recovery.readiness === "blocked" && !entry.confirmation) {
        operations.push({ identity: `recovery-blocked:${recovery.recovery_id}:${recovery.candidate_sha256 || "unknown"}`, kind: "recovery_blocked", title: "恢复资料存在阻断", detail: `${recovery.platform || ""} ${recovery.target_name || recovery.recovery_id}`.trim(), source: "recovery", target: "strategy", targetId: String(recovery.recovery_id) });
      }
    }
  }

  if (readySource(input.runtime)) {
    for (const account of input.accounts || []) {
      if (!["attention", "unknown"].includes(account.tone)) continue;
      operations.push({ identity: `account:${account.id}`, kind: "account", title: account.tone === "attention" ? "账户需要核对" : "账户状态未核实", detail: account.title, source: "runtime", target: "accounts", targetId: account.id });
    }
  }
  return { decisions, operations, sourceWarnings };
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

const ACCOUNT_STATE_DETAILS: Record<string, string> = {
  "monitoring_agrees:enabled": "运行监测正常，已启用。",
  "monitoring_agrees:disabled": "运行监测正常，已停用。",
  retained_attention: "账户运行异常",
  config_inconsistent: "设置尚未生效",
  source_not_fresh: "状态暂未更新",
  deployment_missing: "状态暂未更新",
  deployment_not_fresh: "状态暂未更新",
  activation_unconfirmed: "状态暂未更新",
  check_not_due: "尚未到检查时间",
  evidence_insufficient: "状态暂未更新",
};

export function presentAccountState(projection: AccountStateProjection | null | undefined): {
  label: string; detail: string; tone: "healthy" | "attention" | "unknown";
} {
  const unknown = { label: "—", detail: "暂未取得状态", tone: "unknown" as const };
  if (!projection || projection.scope !== "monitoring_only" || projection.limit !== "not_trading_or_books") return unknown;
  if (!["normal", "abnormal", "unknown"].includes(projection.health)) return unknown;
  if (!["enabled", "disabled", "unknown"].includes(projection.activation)) return unknown;
  const detail = ACCOUNT_STATE_DETAILS[projection.reason === "monitoring_agrees" ? `monitoring_agrees:${projection.activation}` : projection.reason];
  if (!detail || (projection.health === "normal" && (projection.reason !== "monitoring_agrees" || projection.activation === "unknown"))) return unknown;
  return {
    label: projection.health === "normal" ? "正常" : projection.health === "abnormal" ? "异常" : "—",
    detail,
    tone: projection.health === "normal" ? "healthy" : projection.health === "abnormal" ? "attention" : "unknown",
  };
}

export function accountMatchesStatusFilter(filter: string, projection: AccountStateProjection | null | undefined): boolean {
  const view = presentAccountState(projection);
  if (filter === "all") return true;
  if (filter === "normal") return view.tone === "healthy";
  if (filter === "paused") return projection?.activation === "disabled";
  if (filter === "abnormal") return view.tone === "attention" || view.tone === "unknown";
  return false;
}

export function diagnosisUserSummary(input: { available?: boolean; task?: Record<string, any> | null } | null | undefined): {
  status: string; reason: string; action: "check" | "refresh";
} {
  if (!input || input.available === undefined) return { status: "尚未检查", reason: "可以发起一次只读账户检查。", action: "check" };
  if (input.available === false) return { status: "暂时无法检查", reason: "检查服务暂时不可用；刷新状态后再试。", action: "refresh" };
  const task = input.task;
  if (!task) return { status: "尚未检查", reason: "可以发起一次只读账户检查。", action: "check" };
  if (task.status === "unknown" || task.dispatch_state === "unknown") {
    return { status: "结果暂未确认", reason: "请查看技术详情或联系维护人员；暂不重复请求。", action: "refresh" };
  }
  if (["queued", "running"].includes(String(task.status || "")) || task.recheck_status === "sent") {
    return { status: "正在检查", reason: "检查仍在处理，无需重复操作。", action: "refresh" };
  }
  if (task.status === "failed") {
    return { status: "暂时无法检查", reason: "本次检查未完成，可以重新检查。", action: "check" };
  }
  if (task.status === "succeeded" && task.recheck_status === "attention") {
    return { status: "需要你处理", reason: "监测复核发现需要关注，请查看账户状态并按既有流程处理。", action: "check" };
  }
  if (task.status === "succeeded" && task.recheck_status === "unavailable") {
    return { status: "暂时无法检查", reason: "监测复核资料暂不可用；刷新状态后再决定。", action: "refresh" };
  }
  if (task.status === "succeeded" && task.recheck_status === "passed") {
    return { status: "检查已完成，未发现监测异常", reason: "仅表示本次监测复核结果，不代表账户、订单或账务已全面核实。", action: "check" };
  }
  return { status: "结果暂未确认", reason: "请刷新状态并查看技术详情；暂不重复请求。", action: "refresh" };
}

export function promotionAiExplanation(ticket: Record<string, any> | null | undefined): { text: string; model: string } | null {
  const summary = ticket?.research_summary;
  const identity = summary?.identity;
  const ai = summary?.ai_explanation;
  if (!summary || !identity || !ai || ai.status !== "available" || ai.provider !== "codex"
    || typeof ai.text !== "string" || !ai.text.trim() || typeof ai.model !== "string" || !ai.model.trim()
    || identity.strategy_profile !== ticket?.strategy_profile || identity.domain !== ticket?.domain
    || stableIdentity(identity.proposed_params || {}) !== stableIdentity(ticket?.proposed_params || {})) return null;
  return { text: ai.text.trim(), model: ai.model.trim() };
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

export function pageFromWorkspace(value: string | null): "overview" | "strategy" | "accounts" {
  if (value === "research" || value === "strategy") return "strategy";
  if (value === "accounts" || value === "settings") return "accounts";
  if (value === "reports") return "overview";
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
