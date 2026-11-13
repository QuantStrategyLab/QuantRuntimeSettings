/**
 * Research-task source sync / dashboard HTTP use cases.
 *
 * Inject runtime_support-owned helpers (bounded JSON, audit, freshness,
 * strategy-health normalizers) so this module never imports runtime_support
 * and cannot form a cycle.
 */

import { directoryList } from "../../kv_directory.js";
import { uniqueStrings } from "../auth/identity_lists.js";
import { readSession } from "../auth/session.js";
import { configStore, hasConfigStore, readConfigJson, writeConfigJson } from "../config_kv.js";
import { json } from "../http_response.js";
import {
  RESEARCH_TASK_DASHBOARD_SCHEMA_VERSION,
  RESEARCH_TASK_MAX_BODY_BYTES,
  RESEARCH_TASK_MAX_SOURCES,
  RESEARCH_TASK_SOURCE_PREFIX,
} from "./constants.js";
import {
  emptyResearchTaskPayload,
  emptyResearchTaskSourceSnapshot,
  researchTaskSourceKey,
  researchTaskStaleTtlSeconds,
  requireDedicatedResearchTaskSyncToken,
} from "./helpers.js";

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   readBoundedJson: Function,
 *   appendAuditLog: Function,
 *   normalizeResearchTaskSourceSnapshot: Function,
 * }} deps
 */
export async function syncResearchTaskSourceResponse(request, env, deps) {
  const { readBoundedJson, appendAuditLog, normalizeResearchTaskSourceSnapshot } = deps;
  requireDedicatedResearchTaskSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "research task KV is not configured" }, 503);
  }

  let raw;
  try {
    raw = await readBoundedJson(request, RESEARCH_TASK_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid research task source payload" }, error.status || 400);
  }

  let source;
  try {
    source = await normalizeResearchTaskSourceSnapshot(raw, "research task source snapshot");
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid research task source payload" }, 400);
  }

  await writeConfigJson(env, researchTaskSourceKey(source.source_id), source);
  try {
    await appendAuditLog(env, {
      ts: new Date().toISOString(),
      login: "research-task-source-sync",
      action: "sync_research_task_source",
      source_id: source.source_id,
      schema_version: source.schema_version,
      task_count: source.tasks.length,
      data_status: source.data_status,
    });
  } catch {
    // A valid no-order task index does not depend on optional audit retention.
  }
  return json({
    ok: true,
    source_id: source.source_id,
    schema_version: source.schema_version,
    task_count: source.tasks.length,
    generated_at: source.generated_at,
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   aggregateResearchTaskSources: Function,
 * }} deps
 */
export async function researchTaskResponse(request, env, deps) {
  const { aggregateResearchTaskSources } = deps;
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyResearchTaskPayload("snapshot_unavailable"));
  return json(await aggregateResearchTaskSources(env));
}

/**
 * @param {any} env
 * @param {{
 *   readResearchTaskSources: Function,
 *   controlPlaneSnapshotFreshness: Function,
 *   earliestControlPlaneTimestamp: Function,
 * }} deps
 */
export async function aggregateResearchTaskSources(env, deps) {
  const {
    readResearchTaskSources,
    controlPlaneSnapshotFreshness,
    earliestControlPlaneTimestamp,
  } = deps;
  const sources = await readResearchTaskSources(env);
  if (!sources.length) return emptyResearchTaskPayload("snapshot_unavailable");

  const ttlSeconds = researchTaskStaleTtlSeconds(env);
  const now = Date.now();
  const taskIds = new Set();
  const duplicateTaskIds = new Set();
  const tasks = [];
  const errors = [];
  const timestamps = [];
  let hasReadySource = false;
  let hasStaleSource = false;

  for (const source of sources) {
    const freshness = controlPlaneSnapshotFreshness(source, ttlSeconds, now);
    if (source.generated_at) timestamps.push(source.generated_at);
    if (source.computed_at) timestamps.push(source.computed_at);
    if (freshness.data_status === "ready") hasReadySource = true;
    if (freshness.data_status === "stale") {
      hasStaleSource = true;
      errors.push("research_task_source_stale");
    }
    for (const task of source.tasks) {
      if (taskIds.has(task.task_id)) {
        duplicateTaskIds.add(task.task_id);
        errors.push("research_task_duplicate_task");
        continue;
      }
      taskIds.add(task.task_id);
      tasks.push({ source_id: source.source_id, freshness, task });
    }
    errors.push(...source.errors);
  }

  const uniqueTasks = tasks.filter((entry) => !duplicateTaskIds.has(entry.task.task_id));
  const dataStatus = hasStaleSource ? "stale" : (hasReadySource ? "ready" : "unavailable");
  return {
    schema_version: RESEARCH_TASK_DASHBOARD_SCHEMA_VERSION,
    generated_at: earliestControlPlaneTimestamp(timestamps),
    computed_at: earliestControlPlaneTimestamp(timestamps),
    data_status: dataStatus,
    summary: { task_count: uniqueTasks.length },
    tasks: uniqueTasks,
    policy: {
      research_only: true,
      no_order: true,
      size_zero_required: true,
      p4_p5_p6_authorized: false,
      notice: "研究任务只用于离线、零仓位实验；不会调参、改代码、部署或下单。",
    },
    errors: uniqueStrings(errors),
  };
}

/**
 * @param {any} env
 * @param {{
 *   normalizeResearchTaskSourceSnapshot: Function,
 * }} deps
 */
export async function readResearchTaskSources(env, deps) {
  const { normalizeResearchTaskSourceSnapshot } = deps;
  const store = configStore(env);
  if (!store) return [];
  let listing;
  try {
    listing = await directoryList(env, RESEARCH_TASK_SOURCE_PREFIX, RESEARCH_TASK_MAX_SOURCES);
  } catch {
    return [emptyResearchTaskSourceSnapshot("research_task_source_list_unavailable")];
  }
  const keys = Array.isArray(listing?.keys) ? listing.keys : [];
  const sources = [];
  for (const entry of keys.slice(0, RESEARCH_TASK_MAX_SOURCES)) {
    const key = typeof entry?.name === "string" ? entry.name : "";
    if (!key.startsWith(RESEARCH_TASK_SOURCE_PREFIX)) continue;
    try {
      const stored = await readConfigJson(env, key);
      if (!stored) throw new Error("indexed_record_unavailable");
      sources.push(await normalizeResearchTaskSourceSnapshot(stored, key));
    } catch {
      sources.push(emptyResearchTaskSourceSnapshot("research_task_source_invalid"));
    }
  }
  return sources;
}
