import {
  controlPlaneSnapshotFreshness,
  normalizeControlPlaneIdentifier,
} from "../control_plane/helpers.js";
import { EXECUTION_EVIDENCE_PLATFORMS } from "../execution_evidence_snapshot/constants.js";
import { normalizeM0ResearchTimestamp } from "../m0_research/helpers.js";
import {
  assertBooleanField,
  assertConstantField,
  cleanChoice,
  cleanSlug,
  normalizeSourceSnapshotEnvelope,
  validateObjectSchema,
} from "../schema_validators.js";
import { STRATEGY_HEALTH_DATA_STATUSES } from "../strategy_health_snapshot/constants.js";
import {
  normalizeStrategyHealthErrors,
  normalizeStrategyHealthTimestamp,
} from "../strategy_health_snapshot/helpers.js";
import {
  RUNTIME_TARGET_LIFECYCLE_CHECK_STATUSES,
  RUNTIME_TARGET_LIFECYCLE_CONFIGURED_STATES,
  RUNTIME_TARGET_LIFECYCLE_DASHBOARD_SCHEMA_VERSION,
  RUNTIME_TARGET_LIFECYCLE_DISPOSITIONS,
  RUNTIME_TARGET_LIFECYCLE_EXECUTION_MODES,
  RUNTIME_TARGET_LIFECYCLE_EXECUTION_OBSERVATIONS,
  RUNTIME_TARGET_LIFECYCLE_REASON_CODES,
  RUNTIME_TARGET_LIFECYCLE_SOURCE_PREFIX,
  RUNTIME_TARGET_LIFECYCLE_SOURCE_SCHEMA_VERSION,
} from "./constants.js";

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
