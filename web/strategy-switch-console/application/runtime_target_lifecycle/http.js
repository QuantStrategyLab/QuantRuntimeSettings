import { uniqueStrings } from "../auth/identity_lists.js";
import { runtimeReadbackProjection } from "../console_api/runtime_readback.js";
import {
  controlPlaneSnapshotFreshness,
  earliestControlPlaneTimestamp,
} from "../control_plane/helpers.js";
import { executionEvidenceStaleTtlSeconds } from "../execution_evidence_snapshot/helpers.js";
import {
  aggregateSnapshotMetrics,
  readIndexedSnapshotSources,
} from "../schema_validators.js";
import {
  RUNTIME_TARGET_LIFECYCLE_DASHBOARD_SCHEMA_VERSION,
  RUNTIME_TARGET_LIFECYCLE_MAX_BODY_BYTES,
  RUNTIME_TARGET_LIFECYCLE_MAX_SOURCES,
  RUNTIME_TARGET_LIFECYCLE_SOURCE_PREFIX,
} from "./constants.js";
import {
  emptyRuntimeTargetLifecyclePayload,
  emptyRuntimeTargetLifecycleSourceSnapshot,
  normalizeRuntimeTargetLifecycleSourceSnapshot,
  projectRuntimeAccountState,
  runtimeTargetLifecycleAuditState,
  runtimeTargetLifecycleExecutionObservation,
  runtimeTargetLifecycleSourceKey,
} from "./helpers.js";

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
