// The connected daily feed belongs to this exact target, independently of any
// account's chosen strategy, broker environment label, or observed run lane.
export const RUNTIME_DAILY_TARGET = Object.freeze({
  platform: "longbridge",
  service: "longbridge-quant-paper-service",
  strategy_profile: "russell_top50_leader_rotation",
  account_scope: "paper",
  target_key: "longbridge-quant-paper-service|russell_top50_leader_rotation|paper",
});

export function runtimeDailyBoundAccountKey(accountOptions) {
  const options = Array.isArray(accountOptions?.longbridge) ? accountOptions.longbridge : [];
  const matches = options.filter(item => item?.service_name === RUNTIME_DAILY_TARGET.service
    && item?.account_scope === RUNTIME_DAILY_TARGET.account_scope);
  return matches.length === 1 && typeof matches[0]?.key === "string" && matches[0].key
    ? matches[0].key : null;
}

/** @returns {"bound" | "unresolved" | "not_applicable"} */
export function runtimeDailySelectionBinding(accountOptions, platform, accountKey) {
  if (platform !== RUNTIME_DAILY_TARGET.platform) return "not_applicable";
  const options = Array.isArray(accountOptions?.longbridge) ? accountOptions.longbridge : [];
  const candidate = options.some(item => item?.key === accountKey
    && item?.service_name === RUNTIME_DAILY_TARGET.service
    && item?.account_scope === RUNTIME_DAILY_TARGET.account_scope);
  if (!candidate) return "not_applicable";
  return runtimeDailyBoundAccountKey(accountOptions) === accountKey ? "bound" : "unresolved";
}

export function runtimeDailyRecordMatchesTarget(record) {
  return record?.target_key === RUNTIME_DAILY_TARGET.target_key
    && record?.service === RUNTIME_DAILY_TARGET.service
    && record?.strategy_profile === RUNTIME_DAILY_TARGET.strategy_profile
    && record?.account_scope === RUNTIME_DAILY_TARGET.account_scope;
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
  if (errorsPresent === true || statuses.some(status => FAILURE_STATUSES.includes(status))) return "failure";
  if (errorsPresent !== false || !COMPLETE_ACTIVITIES.includes(run?.activity)
    || statuses.slice(1).some(status => UNCONFIRMED_STATUSES.includes(status))
    || (evidence?.orders_pending_count || 0) > 0) return "unconfirmed";
  return null;
}
