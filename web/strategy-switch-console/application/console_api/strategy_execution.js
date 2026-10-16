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
