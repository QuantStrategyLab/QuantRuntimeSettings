import { uniqueStrings } from "../auth/identity_lists.js";
import {
  controlPlaneSnapshotFreshness,
  earliestControlPlaneTimestamp,
} from "../control_plane/helpers.js";
import {
  aggregateSnapshotMetrics,
  readIndexedSnapshotSources,
} from "../schema_validators.js";
import {
  ADAPTIVE_SELECTION_AUTHORITY,
  ADAPTIVE_SELECTION_DASHBOARD_SCHEMA_VERSION,
  ADAPTIVE_SELECTION_MAX_BODY_BYTES,
  ADAPTIVE_SELECTION_MAX_SOURCES,
  ADAPTIVE_SELECTION_SOURCE_PREFIX,
} from "./constants.js";
import {
  adaptiveSelectionSourceKey,
  adaptiveSelectionStaleTtlSeconds,
  emptyAdaptiveSelectionPayload,
  emptyAdaptiveSelectionSourceSnapshot,
  normalizeAdaptiveSelectionSourceSnapshot,
  normalizeAdaptiveSelectionSummary,
} from "./helpers.js";

export async function readAdaptiveSelectionSourcesImpl(env, deps) {
  const { configStore, directoryList, readConfigJson } = deps;
  return readIndexedSnapshotSources(env, {
    configStore,
    directoryList,
    readConfigJson,
    prefix: ADAPTIVE_SELECTION_SOURCE_PREFIX,
    maxSources: ADAPTIVE_SELECTION_MAX_SOURCES,
    normalizeSource: normalizeAdaptiveSelectionSourceSnapshot,
    emptySource: emptyAdaptiveSelectionSourceSnapshot,
    listUnavailableCode: "adaptive_selection_source_list_unavailable",
    invalidSourceCode: "adaptive_selection_source_invalid",
  });
}

export async function aggregateAdaptiveSelectionSourcesImpl(env, deps) {
  const sources = await readAdaptiveSelectionSourcesImpl(env, deps);
  if (!sources.length) return emptyAdaptiveSelectionPayload("adaptive_selection_source_unavailable");

  const ttlSeconds = adaptiveSelectionStaleTtlSeconds(env);
  const selections = [];
  const summaryMeta = aggregateSnapshotMetrics(sources, {
    ttlSeconds,
    freshnessFn: controlPlaneSnapshotFreshness,
    earliestTimestampFn: earliestControlPlaneTimestamp,
    staleErrorCode: "adaptive_selection_source_stale",
    uniqueStrings,
    onSource: (source, freshness) => {
      if (source.decision) selections.push({ source_id: source.source_id, freshness, decision: source.decision });
    },
  });

  return {
    schema_version: ADAPTIVE_SELECTION_DASHBOARD_SCHEMA_VERSION,
    generated_at: summaryMeta.generated_at,
    computed_at: summaryMeta.computed_at,
    data_status: summaryMeta.data_status,
    summary: normalizeAdaptiveSelectionSummary(selections),
    selections: selections.sort((left, right) => left.source_id.localeCompare(right.source_id)),
    policy: {
      authority: ADAPTIVE_SELECTION_AUTHORITY,
      no_order: true,
      execution_authority_granted: false,
      notice: "M1 仅展示 Shadow 建议和拒绝原因；不会修改策略、平台、资金、运行状态或订单。",
    },
    errors: summaryMeta.errors,
  };
}

export async function syncAdaptiveSelectionSourceResponseImpl(request, env, deps) {
  const {
    requireDedicatedAdaptiveSelectionSyncToken,
    hasConfigStore,
    json,
    readBoundedJson,
    writeConfigJson,
    appendAuditLog,
  } = deps;
  requireDedicatedAdaptiveSelectionSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "adaptive selection KV is not configured" }, 503);
  }

  let raw;
  try {
    raw = await readBoundedJson(request, ADAPTIVE_SELECTION_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid adaptive selection payload" }, error.status || 400);
  }

  let source;
  try {
    source = await normalizeAdaptiveSelectionSourceSnapshot(raw, "adaptive selection source snapshot");
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid adaptive selection payload" }, 400);
  }

  await writeConfigJson(env, adaptiveSelectionSourceKey(source.source_id), source);
  try {
    await appendAuditLog(env, {
      ts: new Date().toISOString(),
      login: "adaptive-selection-source-sync",
      action: "sync_adaptive_selection_source",
      source_id: source.source_id,
      schema_version: source.schema_version,
      candidate_count: source.decision?.candidates.length || 0,
      data_status: source.data_status,
      no_order: true,
    });
  } catch {
    // This source remains safe and usable if the rolling convenience log fails.
  }
  return json({
    ok: true,
    source_id: source.source_id,
    schema_version: source.schema_version,
    candidate_count: source.decision?.candidates.length || 0,
    generated_at: source.generated_at,
    no_order: true,
  });
}

export async function adaptiveSelectionResponseImpl(request, env, deps) {
  const { readSession, hasConfigStore, json } = deps;
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyAdaptiveSelectionPayload("adaptive_selection_source_unavailable"));
  return json(await aggregateAdaptiveSelectionSourcesImpl(env, deps));
}
