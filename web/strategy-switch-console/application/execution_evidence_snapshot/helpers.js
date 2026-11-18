import { CONTROL_PLANE_CANDIDATE_KINDS } from "../control_plane/constants.js";
import { normalizeControlPlaneIdentifier } from "../control_plane/helpers.js";
import { normalizeResearchTaskRevision, normalizeResearchTaskTimestamp } from "../research_task/helpers.js";
import {
  assertExactObject,
  cleanChoice,
  normalizeSourceSnapshotEnvelope,
  staleTtlSecondsFromEnv,
  stripAuditCompareFields,
  validateObjectSchema,
} from "../schema_validators.js";
import {
  STRATEGY_HEALTH_DATA_STATUSES,
  STRATEGY_HEALTH_DOMAINS,
} from "../strategy_health_snapshot/constants.js";
import {
  normalizeStrategyHealthErrors,
  normalizeStrategyHealthTimestamp,
} from "../strategy_health_snapshot/helpers.js";
import {
  ALLOWED_RECEIPT_CONFIRMATIONS,
  EXECUTION_EVIDENCE_CAPABILITIES,
  EXECUTION_EVIDENCE_DASHBOARD_SCHEMA_VERSION,
  EXECUTION_EVIDENCE_DEFAULT_STALE_TTL_SECONDS,
  EXECUTION_EVIDENCE_ENVIRONMENTS,
  EXECUTION_EVIDENCE_PLATFORMS,
  EXECUTION_EVIDENCE_REASON_CODES,
  EXECUTION_EVIDENCE_RECOMMENDATIONS,
  EXECUTION_EVIDENCE_SOURCE_PREFIX,
  EXECUTION_EVIDENCE_SOURCE_SCHEMA_VERSION,
  EXECUTION_EVIDENCE_STATUSES,
  EXECUTION_RECEIPT_CONFIRMATIONS,
  EXECUTION_RECEIPT_OUTCOMES,
} from "./constants.js";

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
