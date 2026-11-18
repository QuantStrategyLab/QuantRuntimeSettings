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
  EXECUTION_EVIDENCE_DASHBOARD_SCHEMA_VERSION,
  EXECUTION_EVIDENCE_MAX_BODY_BYTES,
  EXECUTION_EVIDENCE_MAX_SOURCES,
  EXECUTION_EVIDENCE_SOURCE_PREFIX,
} from "./constants.js";
import {
  emptyExecutionEvidencePayload,
  emptyExecutionEvidenceSourceSnapshot,
  executionEvidenceAuditSignature,
  executionEvidenceSourceKey,
  executionEvidenceStaleTtlSeconds,
  normalizeExecutionEvidenceSourceSnapshot,
  normalizeExecutionEvidenceSummary,
} from "./helpers.js";

export async function readExecutionEvidenceSourcesImpl(env, deps) {
  const { configStore, directoryList, readConfigJson } = deps;
  return readIndexedSnapshotSources(env, {
    configStore,
    directoryList,
    readConfigJson,
    prefix: EXECUTION_EVIDENCE_SOURCE_PREFIX,
    maxSources: EXECUTION_EVIDENCE_MAX_SOURCES,
    normalizeSource: normalizeExecutionEvidenceSourceSnapshot,
    emptySource: emptyExecutionEvidenceSourceSnapshot,
    listUnavailableCode: "execution_evidence_source_list_unavailable",
    invalidSourceCode: "execution_evidence_source_invalid",
  });
}

export async function aggregateExecutionEvidenceSourcesImpl(env, deps) {
  const sources = await readExecutionEvidenceSourcesImpl(env, deps);
  if (!sources.length) return emptyExecutionEvidencePayload("snapshot_unavailable");

  const ttlSeconds = executionEvidenceStaleTtlSeconds(env);
  const deployments = [];
  const deploymentIds = new Set();
  const duplicateDeploymentIds = new Set();

  const summaryMeta = aggregateSnapshotMetrics(sources, {
    ttlSeconds,
    freshnessFn: controlPlaneSnapshotFreshness,
    earliestTimestampFn: earliestControlPlaneTimestamp,
    staleErrorCode: "execution_evidence_source_stale",
    uniqueStrings,
    onSource: (source, freshness, errors) => {
      for (const deployment of source.deployments) {
        if (deploymentIds.has(deployment.deployment_id)) {
          duplicateDeploymentIds.add(deployment.deployment_id);
          errors.push("execution_evidence_duplicate_deployment");
          continue;
        }
        deploymentIds.add(deployment.deployment_id);
        deployments.push({ source_id: source.source_id, freshness, deployment });
      }
    },
  });

  const uniqueDeployments = deployments.filter((entry) => !duplicateDeploymentIds.has(entry.deployment.deployment_id));
  return {
    schema_version: EXECUTION_EVIDENCE_DASHBOARD_SCHEMA_VERSION,
    generated_at: summaryMeta.generated_at,
    computed_at: summaryMeta.computed_at,
    data_status: summaryMeta.data_status,
    summary: normalizeExecutionEvidenceSummary(uniqueDeployments.map((entry) => entry.deployment)),
    deployments: uniqueDeployments,
    policy: {
      execution_evidence_read_only: true,
      p6_owner_decision_required: true,
      limited_live_canary_active: false,
      notice: "执行证据按策略、平台和执行通道分别记录；它不授权订单或实盘。",
    },
    errors: summaryMeta.errors,
  };
}

export async function syncExecutionEvidenceSourceResponseImpl(request, env, deps) {
  const {
    requireDedicatedExecutionEvidenceSyncToken,
    hasConfigStore,
    json,
    readBoundedJson,
    readConfigJson,
    writeConfigJson,
    loadAuditLog,
    appendAuditLog,
  } = deps;
  requireDedicatedExecutionEvidenceSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "execution evidence KV is not configured" }, 503);
  }

  const receiptId = request.headers.get("X-QSL-Execution-Evidence-Receipt");
  if (receiptId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(receiptId)) {
    return json({ ok: false, error: "invalid execution evidence receipt identifier" }, 400);
  }

  let raw;
  try {
    raw = await readBoundedJson(request, EXECUTION_EVIDENCE_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid execution evidence payload" }, error.status || 400);
  }

  let source;
  try {
    source = normalizeExecutionEvidenceSourceSnapshot(raw, "execution evidence source snapshot");
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid execution evidence payload" }, 400);
  }

  const sourceKey = executionEvidenceSourceKey(source.source_id);
  let materialChanged = true;
  try {
    const stored = await readConfigJson(env, sourceKey);
    if (stored) {
      const normalizedPrev = normalizeExecutionEvidenceSourceSnapshot(stored, sourceKey);
      materialChanged = executionEvidenceAuditSignature(normalizedPrev) !== executionEvidenceAuditSignature(source);
    }
  } catch {
    materialChanged = true;
  }

  await writeConfigJson(env, sourceKey, source);

  let shouldLogAudit = materialChanged;
  if (!shouldLogAudit && receiptId !== null) {
    try {
      const existingAudit = await loadAuditLog(env);
      const latestForSource = existingAudit.find(
        (entry) => entry.action === "sync_execution_evidence_source" && entry.source_id === source.source_id,
      );
      shouldLogAudit = typeof latestForSource?.receipt_id !== "string" || !latestForSource.receipt_id;
    } catch {
      shouldLogAudit = true;
    }
  }

  if (shouldLogAudit) {
    try {
      await appendAuditLog(env, {
        ts: new Date().toISOString(),
        login: "execution-evidence-source-sync",
        action: "sync_execution_evidence_source",
        source_id: source.source_id,
        schema_version: source.schema_version,
        deployment_count: source.deployments.length,
        data_status: source.data_status,
        ...(receiptId === null ? {} : { receipt_id: receiptId }),
      });
    } catch {
      // The source snapshot is accepted independently of optional audit retention.
    }
  }
  return json({
    ok: true,
    source_id: source.source_id,
    schema_version: source.schema_version,
    deployment_count: source.deployments.length,
    generated_at: source.generated_at,
    ...(receiptId === null ? {} : { receipt_id: receiptId }),
  });
}

export async function executionEvidenceResponseImpl(request, env, deps) {
  const { readSession, hasConfigStore, json } = deps;
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyExecutionEvidencePayload("snapshot_unavailable"));
  return json(await aggregateExecutionEvidenceSourcesImpl(env, deps));
}
