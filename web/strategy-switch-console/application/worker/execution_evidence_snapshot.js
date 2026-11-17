/**
 * Execution evidence snapshot validation, aggregation, and sync/read handlers.
 */

import { OBSERVABILITY_PLATFORM_IDS } from "../../platform_registry.js";
import { uniqueStrings } from "../auth/identity_lists.js";
import { CONTROL_PLANE_CANDIDATE_KINDS } from "../control_plane/constants.js";
import {
  controlPlaneSnapshotFreshness,
  earliestControlPlaneTimestamp,
  normalizeControlPlaneIdentifier,
} from "../control_plane/helpers.js";
import { normalizeResearchTaskRevision, normalizeResearchTaskTimestamp } from "../research_task/helpers.js";
import {
  aggregateSnapshotMetrics,
  assertExactObject,
  cleanChoice,
  normalizeSourceSnapshotEnvelope,
  readIndexedSnapshotSources,
  staleTtlSecondsFromEnv,
  stripAuditCompareFields,
  validateObjectSchema,
} from "./schema_validators.js";
import {
  STRATEGY_HEALTH_DATA_STATUSES,
  STRATEGY_HEALTH_DOMAINS,
  normalizeStrategyHealthErrors,
  normalizeStrategyHealthTimestamp,
} from "./strategy_health_snapshot.js";

export const EXECUTION_EVIDENCE_SOURCE_PREFIX = "execution_evidence_source:";
export const EXECUTION_EVIDENCE_SOURCE_SCHEMA_VERSION = "qsl_execution_evidence_source_snapshot.v1";
export const EXECUTION_EVIDENCE_DASHBOARD_SCHEMA_VERSION = "qsl_execution_evidence_dashboard.v1";
export const EXECUTION_EVIDENCE_MAX_SOURCES = 100;
export const EXECUTION_EVIDENCE_MAX_BODY_BYTES = 256 * 1024;
export const EXECUTION_EVIDENCE_DEFAULT_STALE_TTL_SECONDS = 36 * 60 * 60;
export const EXECUTION_EVIDENCE_PLATFORMS = OBSERVABILITY_PLATFORM_IDS;
export const EXECUTION_EVIDENCE_ENVIRONMENTS = ["shadow", "paper", "live"];
export const EXECUTION_EVIDENCE_CAPABILITIES = ["available", "unavailable", "unknown"];
export const EXECUTION_EVIDENCE_STATUSES = ["verified", "pending", "unavailable", "not_applicable"];
export const EXECUTION_RECEIPT_OUTCOMES = [
  "not_due", "no_action", "no_signal", "no_rebalance", "risk_blocked",
  "submitted", "broker_acknowledged", "partially_filled", "filled", "reconciliation_required", "failed",
];
export const EXECUTION_RECEIPT_CONFIRMATIONS = [
  "not_applicable", "not_observed", "acknowledged", "partially_filled", "filled", "reconciliation_required",
];
export const EXECUTION_EVIDENCE_RECOMMENDATIONS = [
  "continue_autonomous_shadow", "run_autonomous_paper", "owner_limited_live_canary_decision", "parked",
];
export const EXECUTION_EVIDENCE_REASON_CODES = [
  "none", "target_execution_evidence_missing", "paper_not_supported", "paper_execution_evidence_needed",
  "policy_not_active", "source_stale", "manual_live_decision_required", "target_execution_receipt_observed",
  "target_execution_reconciliation_required", "target_execution_receipt_failed",
];

const ALLOWED_RECEIPT_CONFIRMATIONS = {
  not_due: ["not_applicable"],
  no_action: ["not_applicable"],
  no_signal: ["not_applicable"],
  no_rebalance: ["not_applicable"],
  risk_blocked: ["not_applicable"],
  submitted: ["not_observed"],
  broker_acknowledged: ["acknowledged"],
  partially_filled: ["partially_filled"],
  filled: ["filled"],
  reconciliation_required: ["reconciliation_required"],
  failed: ["not_applicable", "not_observed", "reconciliation_required"],
};

export function executionEvidenceSourceKey(sourceId) {
  return `${EXECUTION_EVIDENCE_SOURCE_PREFIX}${sourceId}`;
}

export function executionEvidenceAuditSignature(snapshot) {
  return JSON.stringify(stripAuditCompareFields(snapshot, ["generated_at", "computed_at"]));
}

export function normalizeExecutionEvidenceSourceSnapshot(payload, fieldName = "execution evidence source snapshot") {
  return normalizeSourceSnapshotEnvelope(payload, {
    schemaVersion: EXECUTION_EVIDENCE_SOURCE_SCHEMA_VERSION,
    fieldName,
    itemsKey: "deployments",
    itemLabel: "deployment_id",
    maxItems: 1000,
    normalizeItem: normalizeExecutionEvidenceDeployment,
    uniqueKey: "deployment_id",
    dataStatuses: STRATEGY_HEALTH_DATA_STATUSES,
    normalizeIdentifier: normalizeControlPlaneIdentifier,
    normalizeTimestamp: normalizeStrategyHealthTimestamp,
    normalizeErrors: normalizeStrategyHealthErrors,
  });
}

export function normalizeExecutionEvidenceDeployment(value, fieldName) {
  const normalized = validateObjectSchema(
    value,
    {
      required: ["deployment_id", "strategy", "target", "capabilities", "evidence", "recommendation"],
      optional: ["execution_receipt"],
      fields: {
        deployment_id: (v, p) => normalizeControlPlaneIdentifier(v, p, false),
        strategy: (v, p) => validateObjectSchema(
          v,
          {
            exactKeys: ["candidate_id", "candidate_kind", "domain", "strategy_revision"],
            fields: {
              candidate_id: (sv, sp) => normalizeControlPlaneIdentifier(sv, sp, false),
              candidate_kind: (sv, sp) => cleanChoice(sv, CONTROL_PLANE_CANDIDATE_KINDS, sp),
              domain: (sv, sp) => cleanChoice(sv, STRATEGY_HEALTH_DOMAINS, sp),
              strategy_revision: (sv, sp) => normalizeResearchTaskRevision(sv, sp),
            },
          },
          p,
        ),
        target: (v, p) => validateObjectSchema(
          v,
          {
            exactKeys: ["platform", "environment"],
            fields: {
              platform: (tv, tp) => cleanChoice(tv, EXECUTION_EVIDENCE_PLATFORMS, tp),
              environment: (tv, tp) => cleanChoice(tv, EXECUTION_EVIDENCE_ENVIRONMENTS, tp),
            },
          },
          p,
        ),
        capabilities: (v, p) => validateObjectSchema(
          v,
          {
            exactKeys: ["shadow", "paper"],
            fields: {
              shadow: (cv, cp) => cleanChoice(cv, EXECUTION_EVIDENCE_CAPABILITIES, cp),
              paper: (cv, cp) => cleanChoice(cv, EXECUTION_EVIDENCE_CAPABILITIES, cp),
            },
          },
          p,
        ),
        evidence: (v, p) => validateObjectSchema(
          v,
          {
            exactKeys: ["strategy", "target_data", "target_execution"],
            fields: {
              strategy: (ev, ep) => cleanChoice(ev, EXECUTION_EVIDENCE_STATUSES, ep),
              target_data: (ev, ep) => cleanChoice(ev, EXECUTION_EVIDENCE_STATUSES, ep),
              target_execution: (ev, ep) => cleanChoice(ev, EXECUTION_EVIDENCE_STATUSES, ep),
            },
          },
          p,
        ),
        recommendation: (v, p) => validateObjectSchema(
          v,
          {
            exactKeys: ["code", "reason_code"],
            fields: {
              code: (rv, rp) => cleanChoice(rv, EXECUTION_EVIDENCE_RECOMMENDATIONS, rp),
              reason_code: (rv, rp) => cleanChoice(rv, EXECUTION_EVIDENCE_REASON_CODES, rp),
            },
          },
          p,
        ),
      },
    },
    fieldName,
  );

  const executionReceipt = value.execution_receipt === undefined
    ? null
    : normalizeExecutionEvidenceReceipt(value.execution_receipt, `${fieldName}.execution_receipt`);

  if (normalized.recommendation.code === "continue_autonomous_shadow" && normalized.capabilities.shadow !== "available") {
    throw new Error(`${fieldName}.recommendation requires an available shadow capability`);
  }
  if (normalized.recommendation.code === "run_autonomous_paper" && normalized.capabilities.paper !== "available") {
    throw new Error(`${fieldName}.recommendation requires an available paper capability`);
  }
  if (normalized.recommendation.code === "owner_limited_live_canary_decision") {
    if (!Object.values(normalized.evidence).every((status) => status === "verified")) {
      throw new Error(`${fieldName}.recommendation requires matching verified strategy, data, and execution evidence`);
    }
  }
  if (executionReceipt !== null) {
    const expectedExecutionStatus = ["failed", "reconciliation_required"].includes(executionReceipt.outcome)
      ? "unavailable"
      : (["no_signal", "no_rebalance"].includes(executionReceipt.outcome) ? "not_applicable" : "verified");
    if (normalized.evidence.target_execution !== expectedExecutionStatus) {
      throw new Error(`${fieldName}.execution_receipt does not match target_execution evidence`);
    }
    normalized.execution_receipt = executionReceipt;
  }
  return normalized;
}

export function normalizeExecutionEvidenceReceipt(value, fieldName) {
  const receipt = assertExactObject(value, ["outcome", "broker_confirmation", "observed_at"], fieldName);
  const outcome = cleanChoice(receipt.outcome, EXECUTION_RECEIPT_OUTCOMES, `${fieldName}.outcome`);
  const confirmation = cleanChoice(
    receipt.broker_confirmation,
    EXECUTION_RECEIPT_CONFIRMATIONS,
    `${fieldName}.broker_confirmation`,
  );
  if (!ALLOWED_RECEIPT_CONFIRMATIONS[outcome].includes(confirmation)) {
    throw new Error(`${fieldName}.broker_confirmation does not match outcome`);
  }
  return {
    outcome,
    broker_confirmation: confirmation,
    observed_at: normalizeResearchTaskTimestamp(receipt.observed_at, `${fieldName}.observed_at`),
  };
}

export function normalizeExecutionEvidenceSummary(deployments) {
  return {
    deployment_count: deployments.length,
    autonomous_shadow: deployments.filter((item) => item.recommendation.code === "continue_autonomous_shadow").length,
    autonomous_paper: deployments.filter((item) => item.recommendation.code === "run_autonomous_paper").length,
    owner_canary_decision: deployments.filter((item) => item.recommendation.code === "owner_limited_live_canary_decision").length,
    parked: deployments.filter((item) => item.recommendation.code === "parked").length,
  };
}

export function emptyExecutionEvidenceSourceSnapshot(errorCode) {
  return {
    schema_version: EXECUTION_EVIDENCE_SOURCE_SCHEMA_VERSION,
    source_id: "unavailable",
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    deployments: [],
    errors: [errorCode],
  };
}

export function emptyExecutionEvidencePayload(errorCode) {
  return {
    schema_version: EXECUTION_EVIDENCE_DASHBOARD_SCHEMA_VERSION,
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    summary: { deployment_count: 0, autonomous_shadow: 0, autonomous_paper: 0, owner_canary_decision: 0, parked: 0 },
    deployments: [],
    policy: {
      execution_evidence_read_only: true,
      p6_owner_decision_required: true,
      limited_live_canary_active: false,
      notice: "执行证据尚不可用；控制台不会推断 paper 或 live 状态。",
    },
    errors: [errorCode],
  };
}

export function executionEvidenceStaleTtlSeconds(env) {
  return staleTtlSecondsFromEnv(
    env.EXECUTION_EVIDENCE_STALE_TTL_SECONDS,
    EXECUTION_EVIDENCE_DEFAULT_STALE_TTL_SECONDS,
  );
}

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
