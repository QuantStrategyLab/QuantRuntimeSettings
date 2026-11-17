/**
 * Runtime target lifecycle snapshot validation, projection, and read/sync handlers.
 */

import { uniqueStrings } from "../auth/identity_lists.js";
import { runtimeReadbackProjection } from "../console_api/runtime_readback.js";
import {
  controlPlaneSnapshotFreshness,
  earliestControlPlaneTimestamp,
  normalizeControlPlaneIdentifier,
} from "../control_plane/helpers.js";
import { normalizeM0ResearchTimestamp } from "../m0_research/helpers.js";
import {
  EXECUTION_EVIDENCE_PLATFORMS,
  executionEvidenceStaleTtlSeconds,
} from "./execution_evidence_snapshot.js";
import {
  aggregateSnapshotMetrics,
  assertBooleanField,
  assertConstantField,
  cleanChoice,
  cleanSlug,
  normalizeSourceSnapshotEnvelope,
  readIndexedSnapshotSources,
  validateObjectSchema,
} from "./schema_validators.js";
import {
  STRATEGY_HEALTH_DATA_STATUSES,
  normalizeStrategyHealthErrors,
  normalizeStrategyHealthTimestamp,
} from "./strategy_health_snapshot.js";

export const RUNTIME_TARGET_LIFECYCLE_SOURCE_PREFIX = "runtime_target_lifecycle_source:";
export const RUNTIME_TARGET_LIFECYCLE_SOURCE_SCHEMA_VERSION = "qsl_runtime_target_lifecycle_source_snapshot.v1";
export const RUNTIME_TARGET_LIFECYCLE_DASHBOARD_SCHEMA_VERSION = "qsl_runtime_target_lifecycle_dashboard.v1";
export const RUNTIME_TARGET_LIFECYCLE_MAX_SOURCES = 100;
export const RUNTIME_TARGET_LIFECYCLE_MAX_BODY_BYTES = 256 * 1024;
export const RUNTIME_TARGET_LIFECYCLE_CONFIGURED_STATES = ["enabled", "disabled"];
export const RUNTIME_TARGET_LIFECYCLE_EXECUTION_MODES = ["dry_run", "paper", "live"];
export const RUNTIME_TARGET_LIFECYCLE_CHECK_STATUSES = ["pass", "attention", "not_due", "not_applicable", "unavailable"];
export const RUNTIME_TARGET_LIFECYCLE_DISPOSITIONS = ["continue_enabled_monitoring", "continue_disabled_validation", "parked"];
export const RUNTIME_TARGET_LIFECYCLE_EXECUTION_OBSERVATIONS = ["not_due", "monitoring_only", "not_applicable", "attention", "unavailable"];
export const RUNTIME_TARGET_LIFECYCLE_REASON_CODES = [
  "none", "target_intentionally_disabled", "runtime_guard_attention", "execution_heartbeat_attention", "monitoring_unavailable",
];

export function runtimeTargetLifecycleSourceKey(sourceId) {
  return `${RUNTIME_TARGET_LIFECYCLE_SOURCE_PREFIX}${sourceId}`;
}

export function runtimeTargetLifecycleAuditState(source, ttlSeconds, now) {
  if (!source) return null;
  const state = structuredClone(source);
  state.freshness = controlPlaneSnapshotFreshness(source, ttlSeconds, now).data_status;
  delete state.generated_at;
  delete state.computed_at;
  for (const target of state.targets) {
    if (target.deployment?.observed_at) {
      target.deployment.observed_at = controlPlaneSnapshotFreshness({
        data_status: "ready",
        computed_at: target.deployment.observed_at,
      }, ttlSeconds, now).data_status;
    }
  }
  return JSON.stringify(state);
}

export function normalizeRuntimeTargetLifecycleSourceSnapshot(payload, fieldName = "runtime target lifecycle source snapshot") {
  return normalizeSourceSnapshotEnvelope(payload, {
    schemaVersion: RUNTIME_TARGET_LIFECYCLE_SOURCE_SCHEMA_VERSION,
    fieldName,
    itemsKey: "targets",
    itemLabel: "target_id",
    maxItems: 1000,
    normalizeItem: normalizeRuntimeTargetLifecycleTarget,
    uniqueKey: "target_id",
    dataStatuses: STRATEGY_HEALTH_DATA_STATUSES,
    normalizeIdentifier: normalizeControlPlaneIdentifier,
    normalizeTimestamp: normalizeStrategyHealthTimestamp,
    normalizeErrors: normalizeStrategyHealthErrors,
  });
}

export function normalizeRuntimeTargetLifecycleTarget(value, fieldName) {
  const normalized = validateObjectSchema(
    value,
    {
      required: ["target_id", "target", "monitoring", "disposition", "no_order"],
      optional: ["deployment"],
      fields: {
        target_id: (v, p) => normalizeControlPlaneIdentifier(v, p, false),
        target: (v, p) => validateObjectSchema(
          v,
          {
            exactKeys: ["platform", "configured_state", "execution_mode"],
            fields: {
              platform: (tv, tp) => cleanChoice(tv, EXECUTION_EVIDENCE_PLATFORMS, tp),
              configured_state: (tv, tp) => cleanChoice(tv, RUNTIME_TARGET_LIFECYCLE_CONFIGURED_STATES, tp),
              execution_mode: (tv, tp) => cleanChoice(tv, RUNTIME_TARGET_LIFECYCLE_EXECUTION_MODES, tp),
            },
          },
          p,
        ),
        monitoring: (v, p) => validateObjectSchema(
          v,
          {
            exactKeys: ["runtime_guard", "execution_heartbeat"],
            fields: {
              runtime_guard: (mv, mp) => cleanChoice(mv, RUNTIME_TARGET_LIFECYCLE_CHECK_STATUSES, mp),
              execution_heartbeat: (mv, mp) => cleanChoice(mv, RUNTIME_TARGET_LIFECYCLE_CHECK_STATUSES, mp),
            },
          },
          p,
        ),
        disposition: (v, p) => validateObjectSchema(
          v,
          {
            exactKeys: ["code", "reason_code"],
            fields: {
              code: (dv, dp) => cleanChoice(dv, RUNTIME_TARGET_LIFECYCLE_DISPOSITIONS, dp),
              reason_code: (dv, dp) => cleanChoice(dv, RUNTIME_TARGET_LIFECYCLE_REASON_CODES, dp),
            },
          },
          p,
        ),
        no_order: (v, p) => assertConstantField(v, true, `${p} must be true`),
      },
    },
    fieldName,
  );

  if (value.deployment !== undefined) {
    const observed = validateObjectSchema(
      value.deployment,
      {
        required: ["runtime_enabled", "scheduler_state", "strategy_profile", "execution_mode"],
        optional: ["observed_at"],
        fields: {
          runtime_enabled: (v) => assertBooleanField(v, "deployment.runtime_enabled", {
            nullable: true,
            message: "deployment switch must be boolean or null",
          }),
          scheduler_state: (v) => cleanChoice(v, ["enabled", "paused", "mixed", "missing", "unknown", "not_applicable"], "deployment.scheduler_state"),
          strategy_profile: (v) => (v === null ? null : cleanSlug(v, "deployment.strategy_profile")),
          execution_mode: (v) => (v === null ? null : cleanChoice(v, RUNTIME_TARGET_LIFECYCLE_EXECUTION_MODES, "deployment.execution_mode")),
        },
      },
      `${fieldName}.deployment`,
    );
    normalized.deployment = {
      ...(value.deployment.observed_at === undefined
        ? {}
        : { observed_at: normalizeM0ResearchTimestamp(value.deployment.observed_at, "deployment.observed_at") }),
      ...observed,
    };
  }

  const guardUnavailable = normalized.monitoring.runtime_guard === "unavailable";
  const heartbeatUnavailable = normalized.monitoring.execution_heartbeat === "unavailable";
  const hasAttention = normalized.monitoring.runtime_guard === "attention" || normalized.monitoring.execution_heartbeat === "attention";
  if (normalized.target.configured_state === "disabled") {
    if (normalized.monitoring.execution_heartbeat !== "not_applicable") {
      throw new Error(`${fieldName}.disabled target must not claim an execution heartbeat`);
    }
    if (!hasAttention && !guardUnavailable && normalized.disposition.code !== "continue_disabled_validation") {
      throw new Error(`${fieldName}.disabled target requires continue_disabled_validation`);
    }
  } else if (!hasAttention && !guardUnavailable && !heartbeatUnavailable && normalized.disposition.code !== "continue_enabled_monitoring") {
    throw new Error(`${fieldName}.enabled healthy target requires continue_enabled_monitoring`);
  }
  if (hasAttention || guardUnavailable || heartbeatUnavailable) {
    if (normalized.disposition.code !== "parked") throw new Error(`${fieldName}.unhealthy monitoring requires parked`);
  }
  return normalized;
}

export function projectRuntimeAccountState(entry) {
  const base = { scope: "monitoring_only", limit: "not_trading_or_books" };
  const target = entry?.target || {};
  const monitoring = target.monitoring || {};
  const disposition = target.disposition || {};
  const deployment = target.deployment;
  const sourceFresh = entry?.freshness?.data_status === "ready";
  const deploymentFresh = Boolean(deployment?.observed_at) && entry?.deployment_freshness?.data_status === "ready";
  let activation = "unknown";
  if (deploymentFresh && deployment.runtime_enabled === true && deployment.scheduler_state === "enabled") activation = "enabled";
  else if (deploymentFresh && deployment.runtime_enabled === false && deployment.scheduler_state === "paused") activation = "disabled";
  const configured = target.target?.configured_state;
  const retainedFault = monitoring.runtime_guard === "attention"
    || monitoring.execution_heartbeat === "attention"
    || disposition.code === "parked";
  if (retainedFault) return { ...base, health: "abnormal", activation, reason: "retained_attention" };
  if ((configured === "enabled" && activation === "disabled") || (configured === "disabled" && activation === "enabled")) {
    return { ...base, health: "abnormal", activation, reason: "config_inconsistent" };
  }
  if (monitoring.execution_heartbeat === "not_due") {
    return { ...base, health: "unknown", activation, reason: "check_not_due" };
  }
  const enabledAgrees = configured === "enabled"
    && activation === "enabled"
    && monitoring.runtime_guard === "pass"
    && monitoring.execution_heartbeat === "pass"
    && disposition.code === "continue_enabled_monitoring";
  const disabledAgrees = configured === "disabled"
    && activation === "disabled"
    && monitoring.runtime_guard === "pass"
    && monitoring.execution_heartbeat === "not_applicable"
    && disposition.code === "continue_disabled_validation";
  if (sourceFresh && (enabledAgrees || disabledAgrees)) {
    return { ...base, health: "normal", activation, reason: "monitoring_agrees" };
  }
  let reason = "evidence_insufficient";
  if (!sourceFresh) reason = "source_not_fresh";
  else if (!deployment) reason = "deployment_missing";
  else if (!deploymentFresh) reason = "deployment_not_fresh";
  else if (activation === "unknown") reason = "activation_unconfirmed";
  return { ...base, health: "unknown", activation, reason };
}

export function runtimeTargetLifecycleExecutionObservation(target) {
  const monitoring = target?.monitoring || {};
  const configuredState = target?.target?.configured_state;
  let code = "unavailable";
  if (monitoring.runtime_guard === "attention" || monitoring.execution_heartbeat === "attention") {
    code = "attention";
  } else if (monitoring.runtime_guard === "unavailable" || monitoring.execution_heartbeat === "unavailable") {
    code = "unavailable";
  } else if (configuredState === "disabled") {
    code = "not_applicable";
  } else if (monitoring.execution_heartbeat === "not_due") {
    code = "not_due";
  } else if (monitoring.execution_heartbeat === "pass") {
    code = "monitoring_only";
  }
  return {
    code: cleanChoice(code, RUNTIME_TARGET_LIFECYCLE_EXECUTION_OBSERVATIONS, "runtime target lifecycle execution observation"),
    order_or_fill_evidence: "not_collected",
  };
}

export function emptyRuntimeTargetLifecycleSourceSnapshot(errorCode) {
  return {
    schema_version: RUNTIME_TARGET_LIFECYCLE_SOURCE_SCHEMA_VERSION,
    source_id: "unavailable",
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    targets: [],
    errors: [errorCode],
  };
}

export function emptyRuntimeTargetLifecyclePayload(errorCode) {
  return {
    schema_version: RUNTIME_TARGET_LIFECYCLE_DASHBOARD_SCHEMA_VERSION,
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    summary: { target_count: 0, enabled: 0, disabled: 0, attention: 0 },
    targets: [],
    policy: {
      lifecycle_status_read_only: true,
      execution_observation_read_only: true,
      no_order: true,
      order_or_fill_evidence: "not_collected",
      notice: "运行目标生命周期快照尚不可用；页面不会推断目标已启用或存在订单/成交。",
    },
    errors: [errorCode],
  };
}

export async function readRuntimeTargetLifecycleSourcesImpl(env, deps) {
  const { configStore, directoryList, readConfigJson } = deps;
  return readIndexedSnapshotSources(env, {
    configStore,
    directoryList,
    readConfigJson,
    prefix: RUNTIME_TARGET_LIFECYCLE_SOURCE_PREFIX,
    maxSources: RUNTIME_TARGET_LIFECYCLE_MAX_SOURCES,
    normalizeSource: normalizeRuntimeTargetLifecycleSourceSnapshot,
    emptySource: emptyRuntimeTargetLifecycleSourceSnapshot,
    listUnavailableCode: "runtime_target_lifecycle_source_list_unavailable",
    invalidSourceCode: "runtime_target_lifecycle_source_invalid",
  });
}

export async function aggregateRuntimeTargetLifecycleSourcesImpl(env, deps) {
  const sources = await readRuntimeTargetLifecycleSourcesImpl(env, deps);
  if (!sources.length) return emptyRuntimeTargetLifecyclePayload("snapshot_unavailable");
  const ttlSeconds = executionEvidenceStaleTtlSeconds(env);
  const now = Date.now();
  const targets = [];
  const targetIds = new Set();
  const duplicateTargetIds = new Set();

  const summaryMeta = aggregateSnapshotMetrics(sources, {
    ttlSeconds,
    now,
    freshnessFn: controlPlaneSnapshotFreshness,
    earliestTimestampFn: earliestControlPlaneTimestamp,
    staleErrorCode: "runtime_target_lifecycle_source_stale",
    uniqueStrings,
    onSource: (source, freshness, errors) => {
      for (const target of source.targets) {
        if (targetIds.has(target.target_id)) {
          duplicateTargetIds.add(target.target_id);
          errors.push("runtime_target_lifecycle_duplicate_target");
          continue;
        }
        targetIds.add(target.target_id);
        const entry = {
          source_id: source.source_id,
          observed_at: earliestControlPlaneTimestamp([source.generated_at, source.computed_at].filter(Boolean)),
          evidence_valid_for_seconds: ttlSeconds,
          freshness,
          target,
          execution_observation: runtimeTargetLifecycleExecutionObservation(target),
          ...(target.deployment ? {
            deployment_freshness: target.deployment.observed_at
              ? controlPlaneSnapshotFreshness({ data_status: "ready", computed_at: target.deployment.observed_at }, ttlSeconds, now)
              : freshness,
          } : {}),
        };
        entry.account_state = projectRuntimeAccountState(entry);
        targets.push(entry);
      }
    },
  });

  const uniqueTargets = targets.filter((entry) => !duplicateTargetIds.has(entry.target.target_id));
  return {
    schema_version: RUNTIME_TARGET_LIFECYCLE_DASHBOARD_SCHEMA_VERSION,
    generated_at: summaryMeta.generated_at,
    computed_at: summaryMeta.computed_at,
    data_status: summaryMeta.data_status,
    summary: {
      target_count: uniqueTargets.length,
      enabled: uniqueTargets.filter((entry) => entry.target.target.configured_state === "enabled").length,
      disabled: uniqueTargets.filter((entry) => entry.target.target.configured_state === "disabled").length,
      attention: uniqueTargets.filter((entry) => entry.target.disposition.code === "parked").length,
    },
    targets: uniqueTargets,
    policy: {
      lifecycle_status_read_only: true,
      execution_observation_read_only: true,
      no_order: true,
      order_or_fill_evidence: "not_collected",
      notice: "已启用目标持续监控；已停用目标持续进行无执行验证。运行或心跳通过只说明监测正常，不代表已提交订单或已成交。",
    },
    errors: summaryMeta.errors,
  };
}

export async function syncRuntimeTargetLifecycleSourceResponseImpl(request, env, deps) {
  const {
    requireDedicatedExecutionEvidenceSyncToken,
    hasConfigStore,
    json,
    readBoundedJson,
    readConfigJson,
    writeConfigJson,
    appendAuditLog,
    maybeAutoDispatchAccountDiagnosis,
  } = deps;
  requireDedicatedExecutionEvidenceSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "runtime target lifecycle KV is not configured" }, 503);
  }
  let raw;
  try {
    raw = await readBoundedJson(request, RUNTIME_TARGET_LIFECYCLE_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid runtime target lifecycle payload" }, error.status || 400);
  }
  let source;
  try {
    source = normalizeRuntimeTargetLifecycleSourceSnapshot(raw, "runtime target lifecycle source snapshot");
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid runtime target lifecycle payload" }, 400);
  }
  const sourceKey = runtimeTargetLifecycleSourceKey(source.source_id);
  let previous = null;
  try {
    previous = normalizeRuntimeTargetLifecycleSourceSnapshot(await readConfigJson(env, sourceKey));
  } catch {
    // Missing/unreadable history must not prevent a fresh, valid observation.
  }
  await writeConfigJson(env, sourceKey, source);
  try {
    const ttlSeconds = executionEvidenceStaleTtlSeconds(env);
    const now = Date.now();
    if (runtimeTargetLifecycleAuditState(previous, ttlSeconds, now) !== runtimeTargetLifecycleAuditState(source, ttlSeconds, now)) {
      await appendAuditLog(env, {
        ts: new Date().toISOString(),
        login: "runtime-target-lifecycle-source-sync",
        action: "sync_runtime_target_lifecycle_source",
        source_id: source.source_id,
        schema_version: source.schema_version,
        target_count: source.targets.length,
        data_status: source.data_status,
      });
    }
  } catch {
    // A valid no-order snapshot remains useful when convenience audit retention fails.
  }
  await maybeAutoDispatchAccountDiagnosis(env, source);
  return json({
    ok: true,
    source_id: source.source_id,
    schema_version: source.schema_version,
    target_count: source.targets.length,
    generated_at: source.generated_at,
  });
}

export async function runtimeReadbackResponseImpl(request, env, url, deps) {
  const { readSession, json, loadAccountOptionsConfig, hasConfigStore } = deps;
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required", error_state: "unauthorized" }, 401);
  if ([...url.searchParams.keys()].some((key) => key !== "scope") || url.searchParams.getAll("scope").length !== 1
    || !/^[a-z0-9_-]+:[a-zA-Z0-9_.-]+$/.test(url.searchParams.get("scope") || "")) {
    return json({ ok: false, error: "invalid_runtime_scope" }, 400);
  }
  const scope = url.searchParams.get("scope");
  try {
    const config = await loadAccountOptionsConfig(env);
    const accounts = Object.entries(config.options || {}).flatMap(([platform, rows]) => rows.map((row) => ({ ...row, platform })));
    const matches = accounts.filter((row) => `${row.platform}:${row.key}` === scope);
    if (!matches.length) return json({ ok: false, error: "runtime_scope_not_found" }, 404);
    if (matches.length !== 1) return json({ ok: false, error: "runtime_binding_conflict" }, 409);
    if (!hasConfigStore(env)) return json({ ok: false, error: "runtime_readback_unavailable" }, 503);
    const snapshot = await aggregateRuntimeTargetLifecycleSourcesImpl(env, deps);
    if (snapshot.errors?.some((code) => /source_list_unavailable|source_invalid/.test(code))) {
      return json({ ok: false, error: "runtime_readback_failed" }, 503);
    }
    return json(runtimeReadbackProjection(matches[0], accounts, snapshot));
  } catch {
    return json({ ok: false, error: "runtime_readback_failed" }, 503);
  }
}

export async function runtimeTargetLifecycleResponseImpl(request, env, deps) {
  const { readSession, hasConfigStore, json } = deps;
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyRuntimeTargetLifecyclePayload("snapshot_unavailable"));
  return json(await aggregateRuntimeTargetLifecycleSourcesImpl(env, deps));
}
