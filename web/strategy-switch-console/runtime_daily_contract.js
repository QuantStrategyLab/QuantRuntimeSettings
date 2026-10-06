// Two fixed report contracts, independent of selected strategies or account labels.
// The legacy export and default arguments deliberately retain LongBridge PAPER.
export const RUNTIME_DAILY_TARGET = Object.freeze({
  platform: "longbridge",
  service: "longbridge-quant-paper-service",
  strategy_profile: "russell_top50_leader_rotation",
  account_scope: "paper",
  target_key: "longbridge-quant-paper-service|russell_top50_leader_rotation|paper",
});

export const RUNTIME_DAILY_TARGETS = Object.freeze({
  longbridge: RUNTIME_DAILY_TARGET,
  schwab: Object.freeze({
    platform: "schwab",
    service: "charles-schwab-quant-service",
    strategy_profile: "soxl_soxx_trend_income",
    account_scope: "live",
    target_key: "charles-schwab-quant-service|soxl_soxx_trend_income|live",
  }),
});

export function runtimeDailyTarget(platform) {
  if (typeof platform !== "string") return null;
  return Object.prototype.hasOwnProperty.call(RUNTIME_DAILY_TARGETS, platform)
    ? RUNTIME_DAILY_TARGETS[platform] : null;
}

export function runtimeDailyBoundAccountKey(accountOptions, platform = RUNTIME_DAILY_TARGET.platform) {
  const target = runtimeDailyTarget(platform);
  if (!target) return null;
  const options = Array.isArray(accountOptions?.[platform]) ? accountOptions[platform] : [];
  const matches = options.filter(item => item?.service_name === target.service
    && item?.account_scope === target.account_scope);
  if (platform === "schwab" && matches.length === 1
    && options.filter(item => item?.key === matches[0]?.key).length !== 1) return null;
  return matches.length === 1 && typeof matches[0]?.key === "string" && matches[0].key
    ? matches[0].key : null;
}

/** @returns {"bound" | "unresolved" | "not_applicable"} */
export function runtimeDailySelectionBinding(accountOptions, platform, accountKey, trustedBindings = []) {
  const target = runtimeDailyTarget(platform);
  if (!target) return "not_applicable";
  if (platform === "schwab") {
    const options = Array.isArray(accountOptions?.schwab) ? accountOptions.schwab : [];
    if (!options.some(item => item?.key === accountKey && item?.service_name === target.service)) return "not_applicable";
    // Service alone, including an option with missing scope, stays unresolved.
    const binding = Array.isArray(trustedBindings)
      ? trustedBindings.filter(item => item?.platform === platform && item?.target_key === target.target_key) : [];
    return runtimeDailyBoundAccountKey(accountOptions, platform) === accountKey && binding.length === 1
      && binding[0].status === "bound" && binding[0].account_key === accountKey ? "bound" : "unresolved";
  }
  const options = Array.isArray(accountOptions?.longbridge) ? accountOptions.longbridge : [];
  const candidate = options.some(item => item?.key === accountKey
    && item?.service_name === RUNTIME_DAILY_TARGET.service
    && item?.account_scope === RUNTIME_DAILY_TARGET.account_scope);
  if (!candidate) return "not_applicable";
  return runtimeDailyBoundAccountKey(accountOptions) === accountKey ? "bound" : "unresolved";
}

export function runtimeDailyRecordMatchesTarget(record, platform = RUNTIME_DAILY_TARGET.platform) {
  const target = runtimeDailyTarget(platform);
  return Boolean(target) && record?.target_key === target.target_key
    && record?.service === target.service
    && record?.strategy_profile === target.strategy_profile
    && record?.account_scope === target.account_scope;
}

const COMPLETE_ACTIVITIES = ["no_submission", "no_signal", "no_rebalance", "filled"];
const FAILURE_STATUSES = ["failed", "blocked", "error"];
const UNCONFIRMED_STATUSES = ["unknown", "reconciliation_required", "submitted", "broker_acknowledged", "partially_filled", "conflict", "insufficient"];

// Raw producer evidence stays private. The public run exposes only activity and
// the errors_present boolean needed to preserve a fault through the read model.
export function runtimeDailyRunIssue(run) {
  const evidence = run?.evidence;
  const errorsPresent = evidence ? evidence.errors_present : run?.errors_present;
  const statuses = [run?.activity, run?.report_status, evidence?.execution_status, evidence?.receipt_outcome];
  if (run?.issue === "failure") return "failure";
  if (evidence && Object.prototype.hasOwnProperty.call(evidence, "receipt_state")) {
    const schwabStatuses = [...statuses, evidence.receipt_broker_confirmation];
    if (errorsPresent === true || schwabStatuses.some(status => ["failed", "failure", "error", "blocked", "risk_blocked", "cancelled", "canceled", "timed_out"].includes(status))) return "failure";
    if (evidence.receipt_state !== "valid" || schwabStatuses.some(status => ["pending_reconciliation", "reconciliation_required", "unknown", "unknown_order"].includes(status))) return "unconfirmed";
  }
  if (errorsPresent === true || statuses.some(status => FAILURE_STATUSES.includes(status))) return "failure";
  if (run?.issue === "unconfirmed") return "unconfirmed";
  if (errorsPresent !== false || !COMPLETE_ACTIVITIES.includes(run?.activity)
    || statuses.slice(1).some(status => UNCONFIRMED_STATUSES.includes(status))
    || (evidence?.orders_pending_count || 0) > 0) return "unconfirmed";
  return null;
}
