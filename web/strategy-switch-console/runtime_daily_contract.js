// Fixture targets for tests/docs and producer ingest allowlisting.
// Production console resolution uses the account's bound target_key via
// resolveRuntimeDailyTarget({ accountKey, accountOptions, trustedBindings }).
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

function freezeTarget(target) {
  return Object.freeze({
    platform: target.platform,
    service: target.service,
    strategy_profile: target.strategy_profile,
    account_scope: target.account_scope,
    target_key: target.target_key,
  });
}

export function runtimeDailyTargetKey(service, strategy_profile, account_scope) {
  if (![service, strategy_profile, account_scope].every((value) => typeof value === "string" && value)) return null;
  return `${service}|${strategy_profile}|${account_scope}`;
}

export function parseRuntimeDailyTargetKey(target_key, platform) {
  if (typeof target_key !== "string" || !target_key || typeof platform !== "string" || !platform) return null;
  const parts = target_key.split("|");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  const [service, strategy_profile, account_scope] = parts;
  return freezeTarget({ platform, service, strategy_profile, account_scope, target_key });
}

function accountOptionForKey(accountOptions, platform, accountKey) {
  if (typeof platform !== "string" || typeof accountKey !== "string" || !accountKey) return null;
  const options = Array.isArray(accountOptions?.[platform]) ? accountOptions[platform] : [];
  const matches = options.filter((item) => item?.key === accountKey);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Resolve the daily cadence target for one account.
 * Prefer bound target_key / account option fields; never guess across strategies.
 * Returns null when none or multiple candidates match (fail closed).
 */
export function resolveRuntimeDailyTarget(input = {}) {
  if (input === null || typeof input !== "object") return null;
  const {
    platform,
    accountKey,
    service,
    strategy_profile,
    account_scope,
    target_key,
    accountOptions,
    trustedBindings,
  } = input;

  if (typeof target_key === "string" && target_key) {
    const parsed = parseRuntimeDailyTargetKey(target_key, typeof platform === "string" ? platform : "");
    if (!parsed) return null;
    if (service && service !== parsed.service) return null;
    if (strategy_profile && strategy_profile !== parsed.strategy_profile) return null;
    if (account_scope && account_scope !== parsed.account_scope) return null;
    return parsed;
  }

  if (typeof platform === "string" && platform && typeof accountKey === "string" && accountKey
    && Array.isArray(trustedBindings)) {
    const matches = trustedBindings.filter((item) => item?.platform === platform
      && item?.account_key === accountKey
      && typeof item?.target_key === "string"
      && item.target_key);
    if (matches.length > 1) return null;
    if (matches.length === 1) {
      return parseRuntimeDailyTargetKey(matches[0].target_key, platform);
    }
  }

  if (typeof platform === "string" && platform
    && typeof service === "string" && service
    && typeof strategy_profile === "string" && strategy_profile
    && typeof account_scope === "string" && account_scope) {
    const key = runtimeDailyTargetKey(service, strategy_profile, account_scope);
    return key ? freezeTarget({ platform, service, strategy_profile, account_scope, target_key: key }) : null;
  }

  if (typeof platform === "string" && platform && typeof accountKey === "string" && accountKey && accountOptions) {
    const option = accountOptionForKey(accountOptions, platform, accountKey);
    if (!option) return null;
    const optionService = option.service_name;
    const optionScope = option.account_scope;
    if (typeof optionService !== "string" || !optionService || typeof optionScope !== "string" || !optionScope) {
      return null;
    }
    const fixtureMatches = Object.values(RUNTIME_DAILY_TARGETS).filter((target) => target.platform === platform
      && target.service === optionService
      && target.account_scope === optionScope);
    if (fixtureMatches.length > 1) return null;
    if (fixtureMatches.length === 1) return fixtureMatches[0];
    // Do not invent a target_key from default_strategy_profile alone until producers
    // register that cadence (trustedBindings / ingest allowlist). Fail closed.
    return null;
  }

  // Tests/docs fixture lookup by platform alone when no account context is supplied.
  if (typeof platform === "string" && platform
    && accountKey === undefined && accountOptions === undefined && trustedBindings === undefined
    && service === undefined && strategy_profile === undefined && account_scope === undefined) {
    return Object.prototype.hasOwnProperty.call(RUNTIME_DAILY_TARGETS, platform)
      ? RUNTIME_DAILY_TARGETS[platform]
      : null;
  }

  return null;
}

/** Fixture lookup by platform string for ingest allowlisting and tests. Prefer resolveRuntimeDailyTarget for account-bound cadence. */
export function runtimeDailyTarget(platform) {
  if (typeof platform !== "string") return null;
  return Object.prototype.hasOwnProperty.call(RUNTIME_DAILY_TARGETS, platform)
    ? RUNTIME_DAILY_TARGETS[platform]
    : null;
}

export function runtimeDailyBoundAccountKey(accountOptions, platformOrTarget = RUNTIME_DAILY_TARGET.platform) {
  const target = typeof platformOrTarget === "string"
    ? runtimeDailyTarget(platformOrTarget)
    : platformOrTarget;
  if (!target) return null;
  const options = Array.isArray(accountOptions?.[target.platform]) ? accountOptions[target.platform] : [];
  const matches = options.filter((item) => item?.service_name === target.service
    && item?.account_scope === target.account_scope);
  if (target.account_scope === "live" && matches.length === 1
    && options.filter((item) => item?.key === matches[0]?.key).length !== 1) return null;
  return matches.length === 1 && typeof matches[0]?.key === "string" && matches[0].key
    ? matches[0].key
    : null;
}

function dailyCandidateWithoutTarget(accountOptions, platform, accountKey) {
  const option = accountOptionForKey(accountOptions, platform, accountKey);
  if (!option || typeof option.service_name !== "string" || !option.service_name) return false;
  const fixtures = Object.values(RUNTIME_DAILY_TARGETS).filter((target) => target.platform === platform
    && target.service === option.service_name);
  if (!fixtures.length) return false;
  // Missing scope stays unresolved (e.g. protected live options). A present but
  // non-matching scope is not a candidate — do not infer from case or lane names.
  if (option.account_scope === undefined || option.account_scope === null || option.account_scope === "") {
    return true;
  }
  return fixtures.some((target) => target.account_scope === option.account_scope);
}

/** @returns {"bound" | "unresolved" | "not_applicable"} */
export function runtimeDailySelectionBinding(accountOptions, platform, accountKey, trustedBindings = []) {
  const target = resolveRuntimeDailyTarget({ platform, accountKey, accountOptions, trustedBindings });
  if (!target) {
    return dailyCandidateWithoutTarget(accountOptions, platform, accountKey) ? "unresolved" : "not_applicable";
  }
  const bindings = Array.isArray(trustedBindings)
    ? trustedBindings.filter((item) => item?.platform === platform && item?.target_key === target.target_key)
    : [];
  const uniqueKey = runtimeDailyBoundAccountKey(accountOptions, target);
  // Live / protected cadence requires an explicit bound target_key AND a unique
  // service+scope option match. Binding alone cannot paper over a missing scope.
  if (target.account_scope === "live" || bindings.length > 0) {
    return bindings.length === 1 && bindings[0].status === "bound" && bindings[0].account_key === accountKey
      && uniqueKey === accountKey
      ? "bound"
      : "unresolved";
  }
  return uniqueKey === accountKey ? "bound" : "unresolved";
}

export function runtimeDailyRecordMatchesTarget(record, platformOrTarget = RUNTIME_DAILY_TARGET.platform) {
  const target = typeof platformOrTarget === "string"
    ? runtimeDailyTarget(platformOrTarget)
    : platformOrTarget;
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
    const receiptStatuses = [...statuses, evidence.receipt_broker_confirmation];
    if (errorsPresent === true || receiptStatuses.some((status) => ["failed", "failure", "error", "blocked", "risk_blocked", "cancelled", "canceled", "timed_out"].includes(status))) return "failure";
    if (evidence.receipt_state !== "valid" || receiptStatuses.some((status) => ["pending_reconciliation", "reconciliation_required", "unknown", "unknown_order"].includes(status))) return "unconfirmed";
  }
  if (errorsPresent === true || statuses.some((status) => FAILURE_STATUSES.includes(status))) return "failure";
  if (run?.issue === "unconfirmed") return "unconfirmed";
  if (errorsPresent !== false || !COMPLETE_ACTIVITIES.includes(run?.activity)
    || statuses.slice(1).some((status) => UNCONFIRMED_STATUSES.includes(status))
    || (evidence?.orders_pending_count || 0) > 0) return "unconfirmed";
  return null;
}

/** Expected execution lane from the bound target scope, not a platform name. */
export function runtimeDailyExpectedLane(target) {
  if (!target || typeof target.account_scope !== "string") return null;
  if (target.account_scope === "live") return "live";
  if (target.account_scope === "paper") return "paper";
  return null;
}
