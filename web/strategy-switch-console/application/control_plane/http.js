/**
 * Control-plane sync / read / aggregate use cases.
 *
 * Inject runtime_support-owned helpers (bounded JSON, owner materials, audit)
 * so this module never imports runtime_support and cannot form a cycle.
 */

import { directoryList } from "../../kv_directory.js";
import { sourceListFailure } from "../console_api/read_failures.js";
import { hasConfigStore, configStore, readConfigJson, writeConfigJson } from "../config_kv.js";
import { json } from "../http_response.js";
import { readSession } from "../auth/session.js";
import { uniqueStrings } from "../auth/identity_lists.js";
import {
  CONTROL_PLANE_MAX_BODY_BYTES,
  CONTROL_PLANE_MAX_SOURCES,
  CONTROL_PLANE_SNAPSHOT_KEY,
  CONTROL_PLANE_SOURCE_PREFIX,
  CONTROL_PLANE_SOURCE_RETIREMENTS_KEY,
} from "./constants.js";
import {
  controlPlaneResearchSnapshotFreshness,
  controlPlaneSourceKey,
  controlPlaneStaleTtlSeconds,
  earliestControlPlaneTimestamp,
  emptyControlPlanePayload,
  emptyControlPlaneSourceSnapshot,
  mergeControlPlaneFreshness,
  normalizeControlPlaneAttention,
  normalizeControlPlanePolicy,
  normalizeControlPlaneSnapshot,
  normalizeControlPlaneSourceRetirements,
  normalizeControlPlaneSourceSnapshot,
  normalizeControlPlaneSummary,
  requireControlPlaneSourceSyncToken,
  requireDedicatedControlPlaneSyncToken,
} from "./helpers.js";

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   readBoundedJson: Function,
 *   publishHumanOwnerMaterials: Function,
 *   appendAuditLog: Function,
 * }} deps
 */
export async function syncControlPlaneResponse(request, env, deps) {
  const { readBoundedJson, publishHumanOwnerMaterials, appendAuditLog } = deps;
  requireDedicatedControlPlaneSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "control plane KV is not configured" }, 503);
  }

  let raw;
  try {
    raw = await readBoundedJson(request, CONTROL_PLANE_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid control plane payload" }, error.status || 400);
  }

  let snapshot;
  try {
    snapshot = normalizeControlPlaneSnapshot(raw, "control plane snapshot");
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid control plane payload" }, 400);
  }
  try {
    await publishHumanOwnerMaterials(env, snapshot, "control-plane-snapshot");
  } catch (error) {
    return json({ ok: false, error: error.message || "owner decision material unavailable" }, error.status || 503);
  }

  await writeConfigJson(env, CONTROL_PLANE_SNAPSHOT_KEY, snapshot);
  try {
    await appendAuditLog(env, {
      ts: new Date().toISOString(),
      login: "control-plane-sync",
      action: "sync_control_plane",
      schema_version: snapshot.schema_version,
      candidate_count: snapshot.summary.candidate_count,
      data_status: snapshot.data_status,
    });
  } catch {
    // A successful snapshot must not expose its payload through audit failures.
  }
  return json({
    ok: true,
    schema_version: snapshot.schema_version,
    candidate_count: snapshot.summary.candidate_count,
    generated_at: snapshot.generated_at,
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   readBoundedJson: Function,
 *   publishHumanOwnerMaterials: Function,
 *   appendAuditLog: Function,
 * }} deps
 */
export async function syncControlPlaneSourceResponse(request, env, deps) {
  const { readBoundedJson, publishHumanOwnerMaterials, appendAuditLog } = deps;
  const validationOnly = requireControlPlaneSourceSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "control plane KV is not configured" }, 503);
  }

  let raw;
  try {
    raw = await readBoundedJson(request, CONTROL_PLANE_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid control plane source payload" }, error.status || 400);
  }

  let source;
  try {
    source = normalizeControlPlaneSourceSnapshot(raw, "control plane source snapshot");
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid control plane source payload" }, 400);
  }

  if (validationOnly) {
    const candidate = source.candidates[0];
    const runId = candidate?.candidate_id?.match(/^soxl_three_asset_mid_weight_validation_([1-9][0-9]*)$/)?.[1];
    if (
      source.source_id !== "aiaudit.soxl_manual_validation" ||
      source.candidates.length !== 1 || !runId ||
      candidate.candidate_kind !== "individual" || candidate.domain !== "us_equity" ||
      candidate.lifecycle.stage !== "P3" || candidate.lifecycle.status !== "parked" ||
      candidate.recommendation.code !== "park" || candidate.evidence.p3_evidence_id !== runId
    ) {
      return json({ ok: false, error: "validation publisher scope mismatch" }, 403);
    }
  }
  try {
    await publishHumanOwnerMaterials(env, source, source.source_id);
  } catch (error) {
    return json({ ok: false, error: error.message || "owner decision material unavailable" }, error.status || 503);
  }

  await writeConfigJson(env, controlPlaneSourceKey(source.source_id), source);
  try {
    await appendAuditLog(env, {
      ts: new Date().toISOString(),
      login: "control-plane-source-sync",
      action: "sync_control_plane_source",
      source_id: source.source_id,
      schema_version: source.schema_version,
      candidate_count: source.candidates.length,
      data_status: source.data_status,
    });
  } catch {
    // The source snapshot is accepted independently of an optional audit write.
  }
  return json({
    ok: true,
    source_id: source.source_id,
    schema_version: source.schema_version,
    candidate_count: source.candidates.length,
    generated_at: source.generated_at,
  });
}

export async function controlPlaneResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  return json(await currentControlPlanePayload(env));
}

export async function currentControlPlanePayload(env) {
  if (!hasConfigStore(env)) return emptyControlPlanePayload("snapshot_unavailable");

  const sourceSnapshot = await aggregateControlPlaneSources(env);
  if (sourceSnapshot) return sourceSnapshot;

  let snapshot;
  try {
    const stored = await readConfigJson(env, CONTROL_PLANE_SNAPSHOT_KEY);
    if (!stored) return emptyControlPlanePayload("snapshot_unavailable");
    snapshot = normalizeControlPlaneSnapshot(stored, CONTROL_PLANE_SNAPSHOT_KEY);
  } catch {
    return emptyControlPlanePayload("snapshot_invalid");
  }

  const freshness = controlPlaneResearchSnapshotFreshness(
    snapshot,
    controlPlaneStaleTtlSeconds(env),
    Date.now(),
  );
  snapshot.data_status = freshness.data_status;
  return snapshot;
}

export async function aggregateControlPlaneSources(env) {
  const now = Date.now();
  let retirements;
  try {
    const stored = await configStore(env).get(CONTROL_PLANE_SOURCE_RETIREMENTS_KEY);
    retirements = stored === null || stored === undefined
      ? new Map()
      : normalizeControlPlaneSourceRetirements(JSON.parse(stored), now);
  } catch {
    return emptyControlPlanePayload("control_plane_source_retirements_invalid");
  }
  const sources = await readControlPlaneSources(env);
  // A legacy aggregate has no source identity and cannot honor a retirement.
  if (!sources?.length && !retirements.size) return null;

  const ttlSeconds = controlPlaneStaleTtlSeconds(env);
  const candidates = [];
  const historicalSources = [];
  const candidateIds = new Set();
  const duplicateCandidateIds = new Set();
  const errors = [];
  const timestamps = [];
  let hasReadySource = false;
  let hasStaleSource = false;

  for (const source of sources || []) {
    const sourceFreshness = controlPlaneResearchSnapshotFreshness(source, ttlSeconds, now);
    const retirement = retirements.get(source.source_id);
    if (retirement) {
      historicalSources.push({ retirement, snapshot: source, freshness: sourceFreshness });
      continue;
    }
    if (source.generated_at) timestamps.push(source.generated_at);
    if (source.computed_at) timestamps.push(source.computed_at);
    if (sourceFreshness.data_status === "ready") hasReadySource = true;
    if (sourceFreshness.data_status === "stale") {
      hasStaleSource = true;
      errors.push("control_plane_source_stale");
    }
    for (const candidate of source.candidates) {
      if (candidateIds.has(candidate.candidate_id)) {
        duplicateCandidateIds.add(candidate.candidate_id);
        errors.push("control_plane_duplicate_candidate");
        continue;
      }
      candidateIds.add(candidate.candidate_id);
      candidates.push({
        ...candidate,
        source_id: source.source_id,
        freshness: mergeControlPlaneFreshness(candidate.freshness, sourceFreshness),
      });
    }
    errors.push(...source.errors);
  }

  const dataStatus = hasStaleSource ? "stale" : (hasReadySource ? "ready" : "unavailable");
  const uniqueCandidates = candidates.filter((candidate) => !duplicateCandidateIds.has(candidate.candidate_id));
  const uniqueErrors = uniqueStrings(errors);
  return {
    schema_version: "qsl_control_plane_dashboard.v1",
    generated_at: earliestControlPlaneTimestamp(timestamps),
    computed_at: earliestControlPlaneTimestamp(timestamps),
    data_status: dataStatus,
    summary: normalizeControlPlaneSummary(uniqueCandidates),
    attention: normalizeControlPlaneAttention({
      dataStatus,
      candidates: uniqueCandidates,
      errors: uniqueErrors,
    }),
    candidates: uniqueCandidates,
    ...(retirements.size ? { historical_sources: historicalSources } : {}),
    policy: normalizeControlPlanePolicy({
      p4_p5_automation: "not_configured",
      p6_owner_decision_required: true,
      notice: "P1–P3 自动研究已接入；P4/P5 尚未配置，live 仍需所有者明确决定。",
    }, "aggregated control plane policy"),
    errors: uniqueErrors,
  };
}

export async function readControlPlaneSources(env) {
  const store = configStore(env);
  if (!store) return null;
  let listing;
  try {
    listing = await directoryList(env, CONTROL_PLANE_SOURCE_PREFIX, CONTROL_PLANE_MAX_SOURCES);
  } catch (error) {
    return [emptyControlPlaneSourceSnapshot(sourceListFailure(error, "control_plane_source_list_unavailable"))];
  }
  const keys = Array.isArray(listing?.keys) ? listing.keys : [];
  const sources = [];
  for (const entry of keys.slice(0, CONTROL_PLANE_MAX_SOURCES)) {
    const key = typeof entry?.name === "string" ? entry.name : "";
    if (!key.startsWith(CONTROL_PLANE_SOURCE_PREFIX)) continue;
    try {
      const stored = await readConfigJson(env, key);
      if (!stored) throw new Error("indexed_record_unavailable");
      const source = normalizeControlPlaneSourceSnapshot(stored, key);
      if (key !== controlPlaneSourceKey(source.source_id)) throw new Error("control plane source identity mismatch");
      sources.push(source);
    } catch {
      sources.push(emptyControlPlaneSourceSnapshot("control_plane_source_invalid"));
    }
  }
  return sources;
}
