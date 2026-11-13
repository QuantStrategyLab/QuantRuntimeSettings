/**
 * Account-diagnosis identity / lifecycle context helpers.
 * Inject runtime_support leaf deps; do not import runtime_support.js.
 */

import { accountDiagnosisConflict } from "./helpers.js";
import {
  accountDiagnosisChecks,
  accountDiagnosisHasConfirmedAttention,
  accountDiagnosisStateFingerprint,
  accountDiagnosisTargetSpec,
} from "./checks.js";

export async function accountDiagnosisAccount(env, platform, key, deps) {
  const {
    loadAccountOptionsConfig,
  } = deps;
  let config;
  try {
    config = await loadAccountOptionsConfig(env);
  } catch {
    throw accountDiagnosisConflict("account_diagnosis_config_unavailable");
  }
  const options = Array.isArray(config.options?.[platform])
    ? config.options[platform].filter(item => item?.key === key) : [];
  if (options.length === 0) throw accountDiagnosisConflict("account_diagnosis_account_not_found");
  if (options.length !== 1) throw accountDiagnosisConflict("account_diagnosis_account_not_unique");
  const account = options[0];
  const targetId = String(account.runtime_status_target_id || "").trim();
  if (!accountDiagnosisTargetSpec(platform, targetId)) throw accountDiagnosisConflict("account_diagnosis_target_not_admitted");
  const allIdentityMatches = Object.entries(config.options || {}).flatMap(([itemPlatform, items]) =>
    (Array.isArray(items) ? items : []).filter(item => String(item?.runtime_status_target_id || "").trim() === targetId)
      .map(item => ({ platform: itemPlatform, key: item.key })));
  if (allIdentityMatches.length !== 1 || allIdentityMatches[0].platform !== platform || allIdentityMatches[0].key !== key) {
    throw accountDiagnosisConflict("account_diagnosis_identity_conflict");
  }
  return { platform, key, account, targetId, config };
}

export async function accountDiagnosisContext(env, platform, key, deps) {
  const {
    hasConfigStore,
    readRuntimeTargetLifecycleSources,
    executionEvidenceStaleTtlSeconds,
    controlPlaneSnapshotFreshness,
  } = deps;
  const identity = await accountDiagnosisAccount(env, platform, key, deps);
  if (!hasConfigStore(env)) throw accountDiagnosisConflict("account_diagnosis_lifecycle_store_unavailable");
  const sources = await readRuntimeTargetLifecycleSources(env);
  const ttlSeconds = executionEvidenceStaleTtlSeconds(env);
  const matches = [];
  for (const source of sources) {
    const freshness = controlPlaneSnapshotFreshness(source, ttlSeconds, Date.now());
    for (const target of source.targets) {
      if (target.target_id === identity.targetId && target.target.platform === identity.platform) {
        matches.push({ target, freshness, observedAt: source.computed_at || source.generated_at });
      }
    }
  }
  if (matches.length === 0) {
    throw accountDiagnosisConflict("account_diagnosis_lifecycle_match_missing");
  }
  if (matches.length !== 1) {
    throw accountDiagnosisConflict("account_diagnosis_lifecycle_match_ambiguous");
  }
  const entry = matches[0];
  let checks;
  try {
    checks = accountDiagnosisChecks(entry, entry.freshness.data_status);
  } catch {
    throw accountDiagnosisConflict("account_diagnosis_schema_incompatible");
  }
  if (!checks || typeof checks !== "object") {
    throw accountDiagnosisConflict("account_diagnosis_schema_incompatible");
  }
  if (!["ready", "stale"].includes(checks.freshness)) throw accountDiagnosisConflict("account_diagnosis_source_unavailable");
  const observedAt = entry.observedAt;
  if (!observedAt) throw accountDiagnosisConflict("account_diagnosis_observation_missing");
  return {
    platform, key, targetId: identity.targetId, checks, observedAt,
    stateFingerprint: accountDiagnosisStateFingerprint(identity.targetId, checks),
    attention: accountDiagnosisHasConfirmedAttention(checks),
  };
}

export async function accountDiagnosisRecheckStatus(env, task, deps) {
  const {
    readRuntimeTargetLifecycleSources,
    executionEvidenceStaleTtlSeconds,
    controlPlaneSnapshotFreshness,
  } = deps;
  if (!task || task.status !== "succeeded" || task.recheck_dispatch_state !== "sent") {
    return task?.recheck_dispatch_state || "not_requested";
  }
  const resultAt = Date.parse(task.updated_at);
  if (!Number.isFinite(resultAt)) return "sent";
  try {
    const sources = await readRuntimeTargetLifecycleSources(env);
    const ttlSeconds = executionEvidenceStaleTtlSeconds(env);
    const matches = [];
    for (const source of sources) {
      const freshness = controlPlaneSnapshotFreshness(source, ttlSeconds, Date.now());
      const observedAt = source.computed_at || source.generated_at;
      if (freshness.data_status !== "ready" || !observedAt || Date.parse(observedAt) <= resultAt) continue;
      for (const target of source.targets) {
        if (target.target_id === task.target_id && target.target.platform === task.platform) {
          matches.push({ target, freshness, observedAt });
        }
      }
    }
    if (matches.length !== 1) return "sent";
    const checks = accountDiagnosisChecks(matches[0], matches[0].freshness.data_status);
    if (checks.freshness !== "ready" || checks.runtime_guard === "unavailable" || checks.execution_heartbeat === "unavailable"
      || checks.runtime_enabled === null || checks.scheduler_state === "unknown") return "unavailable";
    if (checks.configured_state === "enabled") {
      return checks.runtime_enabled === true && checks.scheduler_state === "enabled"
        && checks.runtime_guard === "pass" && ["pass", "not_due"].includes(checks.execution_heartbeat) ? "passed" : "attention";
    }
    if (checks.configured_state === "disabled") {
      return checks.runtime_enabled === false && checks.scheduler_state === "paused"
        && checks.runtime_guard === "pass" && checks.execution_heartbeat === "not_applicable" ? "passed" : "attention";
    }
    return "unavailable";
  } catch {
    return "sent";
  }
}

export async function accountDiagnosisIdentityForTarget(env, targetId, deps) {
  const {
    loadAccountOptionsConfig,
  } = deps;
  const spec = accountDiagnosisTargetSpec(null, targetId);
  if (!spec) return null;
  let config;
  try {
    config = await loadAccountOptionsConfig(env);
  } catch {
    return null;
  }
  const matches = Object.entries(config.options || {}).flatMap(([platform, items]) =>
    (Array.isArray(items) ? items : [])
      .filter(item => String(item?.runtime_status_target_id || "").trim() === targetId)
      .map(item => ({ platform, key: item.key })));
  if (matches.length !== 1 || matches[0].platform !== spec.platform) return null;
  try {
    return await accountDiagnosisAccount(env, matches[0].platform, matches[0].key, deps);
  } catch {
    return null;
  }
}
