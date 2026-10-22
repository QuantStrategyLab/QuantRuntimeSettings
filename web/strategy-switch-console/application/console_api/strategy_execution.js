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

export function configuredStrategyExecution(current, profile, platform, account = {}) {
  // New read projections preserve raw target evidence before legacy mode inference.
  const evidence = current.strategy_execution || strategyTargetExecution(current);
  const { execution_mode: mode, dry_run_only: dryRunOnly } = evidence;
  const liveStatus = mode === "live" && dryRunOnly === false ? "configured_live"
    : mode === "paper" || mode === "dry_run" ? "not_live" : "unknown";
  const policy = profile.live_continuity;
  const environment = ["live", "paper"].includes(account.broker_environment) ? account.broker_environment : null;
  // STRATEGY_PROFILE can contain legacy mode inference based on an account name.
  // Labels require the preserved raw target projection and a matching environment.
  const explicit = ["RUNTIME_TARGET_JSON", "CLOUD_RUN_SERVICE_TARGETS_JSON"].includes(current.source)
    && current.strategy_execution;
  const label = explicit && (dryRunOnly === true || mode === "dry_run") ? "dry_run"
    : explicit && dryRunOnly === false && environment === mode ? mode : "unknown";
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
    broker_environment: environment,
    execution_label: label,
    mode_unavailable_reason: label !== "unknown" ? null : !explicit || mode === "unknown" || dryRunOnly === null
      ? "explicit_target_mode_missing" : environment === null ? "broker_environment_missing" : "mode_environment_conflict",
    runtime_observation_status: "unknown",
  };
}
