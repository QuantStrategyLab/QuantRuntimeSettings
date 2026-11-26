// A read-only projection of producer observations. Configuration is not evidence.
const EXECUTION_MODES = new Set(["dry_run", "paper", "live"]);

export function runtimeReadbackProjection(account, accounts, snapshot, now = Date.now()) {
  const result = {
    schema_version: "qsl.runtime_readback.v1",
    server_time: new Date(now).toISOString(),
    scope: `${account.platform}:${account.key}`,
    data_status: "unavailable",
    observed_at: null,
    deployment_observed_at: null,
    ttl_seconds: null,
    runtime_enabled: null,
    scheduler_state: "unknown",
    strategy_profile: null,
    execution_mode: null,
    source: "stored_runtime_target_lifecycle",
    reason: "runtime_binding_missing",
    policy: { read_only: true, no_order: true, execution_authority_granted: false },
    semantics: { monitoring_only: true, not_trading_or_books: true },
  };
  const targetId = account.runtime_status_target_id;
  if (!targetId) return result;
  const bindings = accounts.filter(row => row.runtime_status_target_id === targetId);
  if (bindings.length !== 1 || snapshot?.errors?.includes("runtime_target_lifecycle_duplicate_target")) {
    return { ...result, reason: "runtime_binding_conflict" };
  }
  if (!snapshot || !Array.isArray(snapshot.targets)) {
    const readFailed = snapshot?.errors?.includes("runtime_source_read_failed");
    return { ...result, reason: readFailed ? "runtime_source_read_failed" : "runtime_source_incomplete" };
  }
  const matches = snapshot.targets.filter(entry => entry.target.target_id === targetId);
  if (matches.length !== 1) return { ...result, reason: matches.length ? "runtime_binding_conflict" : "runtime_observation_missing" };
  if (snapshot.errors?.some(code => code !== "runtime_target_lifecycle_source_stale")) return { ...result, reason: "runtime_source_incomplete" };
  const entry = matches[0];
  if (entry.target.target.platform !== account.platform) return { ...result, reason: "runtime_binding_conflict" };
  const deployment = entry.target.deployment;
  if (!deployment) return { ...result, reason: "runtime_deployment_missing" };
  const sourceTime = Date.parse(entry.observed_at);
  if (!Number.isFinite(sourceTime) || sourceTime > now) return { ...result, reason: "runtime_observation_time_invalid" };
  const observed = Date.parse(deployment.observed_at);
  // Require the producer's deployment timestamp, not the HTTP response clock or source fallback.
  if (!Number.isFinite(observed) || observed > now) return { ...result, reason: "runtime_observation_time_invalid" };
  const ttlSeconds = Number.isFinite(entry.evidence_valid_for_seconds) && entry.evidence_valid_for_seconds > 0
    ? Math.trunc(entry.evidence_valid_for_seconds)
    : null;
  result.observed_at = deployment.observed_at;
  result.deployment_observed_at = deployment.observed_at;
  result.ttl_seconds = ttlSeconds;
  if (entry.freshness?.data_status === "stale" || entry.deployment_freshness?.data_status === "stale"
    || (ttlSeconds !== null && now - observed > ttlSeconds * 1000)) {
    return { ...result, data_status: "stale", reason: "runtime_observation_stale" };
  }
  if (entry.freshness?.data_status !== "ready" || entry.deployment_freshness?.data_status !== "ready"
    || ttlSeconds === null) {
    return { ...result, reason: "runtime_observation_unavailable" };
  }
  if (typeof deployment.runtime_enabled !== "boolean"
    || !["enabled", "paused", "mixed", "missing", "unknown", "not_applicable"].includes(deployment.scheduler_state)) {
    return { ...result, reason: "runtime_observation_incomplete" };
  }
  const executionMode = typeof deployment.execution_mode === "string" && EXECUTION_MODES.has(deployment.execution_mode)
    ? deployment.execution_mode
    : null;
  return { ...result, data_status: "ready", reason: null,
    runtime_enabled: deployment.runtime_enabled,
    scheduler_state: deployment.scheduler_state,
    strategy_profile: deployment.strategy_profile ?? null,
    execution_mode: executionMode };
}
