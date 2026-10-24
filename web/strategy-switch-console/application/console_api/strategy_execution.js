/** Display evidence only. Never grants execution or validates a recovery baseline. */
export function strategyTargetExecution(target = {}) {
  const dryRunOnly = typeof target?.dry_run_only === "boolean" ? target.dry_run_only : null;
  const mode = ["live", "paper", "dry_run"].includes(target?.execution_mode) ? target.execution_mode : "unknown";
  return {
    execution_mode: dryRunOnly === true ? "dry_run" : mode,
    dry_run_only: dryRunOnly,
    continuation_reason: mode === "live" && dryRunOnly === false
      && target?.live_continuity?.baseline_kind === "legacy_authorized" ? "legacy_live_continuation" : null,
  };
}

export function configuredStrategyExecution(current, profile, platform) {
  // New read projections preserve raw target evidence before legacy mode inference.
  const evidence = current.strategy_execution || strategyTargetExecution(current);
  const { execution_mode: mode, dry_run_only: dryRunOnly } = evidence;
  const liveStatus = mode === "live" && dryRunOnly === false ? "configured_live"
    : mode === "paper" || mode === "dry_run" ? "not_live" : "unknown";
  const policy = profile.live_continuity;
  return {
    execution_mode: mode,
    dry_run_only: dryRunOnly,
    live_status: liveStatus,
    continuation_reason: liveStatus === "configured_live" && current.source === "RUNTIME_TARGET_JSON"
      && evidence.continuation_reason === "legacy_live_continuation" && policy?.eligible === true
      && Array.isArray(policy.allowed_platforms) && policy.allowed_platforms.includes(platform)
      ? "legacy_live_continuation" : null,
    mode_source: ["RUNTIME_TARGET_JSON", "CLOUD_RUN_SERVICE_TARGETS_JSON", "STRATEGY_PROFILE"].includes(current.source)
      ? current.source : null,
    runtime_observation_status: "unknown",
  };
}

/** Explicit configuration only; never infer from aliases, defaults or legacy mode projections. */
export function accountExecutionEvidence(option = {}, current = {}, { status = "ok", observedAt = null } = {}) {
  const environment = ["live", "paper"].includes(option.broker_environment) ? option.broker_environment : null;
  const source = ["RUNTIME_TARGET_JSON", "CLOUD_RUN_SERVICE_TARGETS_JSON"].includes(current.source) ? current.source : null;
  const target = source ? current.strategy_execution : null;
  const mode = ["live", "paper", "dry_run"].includes(target?.execution_mode) ? target.execution_mode : null;
  const dry = typeof target?.dry_run_only === "boolean" ? target.dry_run_only : null;
  const reasons = [];
  if (status !== "ok") reasons.push(status);
  if (!environment) reasons.push("broker_environment_missing");
  if (!mode) reasons.push("execution_config_missing");
  if (mode === "live" && dry === null) reasons.push("dry_run_flag_missing");
  if (mode === "paper" && environment === "live") reasons.push("environment_conflict");
  const value = status !== "ok" || reasons.length ? "unknown"
    : dry === true || mode === "dry_run" ? "dry_run"
    : mode === "paper" || environment === "paper" ? "paper" : "live";
  return { value, status: status !== "ok" ? status : value === "unknown" ? "config_missing" : "confirmed",
    reason_codes: reasons, broker_environment: environment, execution_mode: mode, dry_run_only: dry,
    environment_source: environment ? "account_options.broker_environment" : null,
    configuration_source: source, observed_at: observedAt, runtime_observation_status: "unknown" };
}
