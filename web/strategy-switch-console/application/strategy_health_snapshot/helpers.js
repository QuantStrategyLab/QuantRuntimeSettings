import { uniqueStrings } from "../auth/identity_lists.js";
import {
  cleanBoundedArray,
  cleanBoundedNumber,
  cleanBoundedText,
  cleanChoice,
  cleanIsoTimestamp,
  cleanSlug,
  containsSecretFragment,
  isPlainObject,
  staleTtlSecondsFromEnv,
  stripAuditCompareFields,
  validateObjectSchema,
} from "../schema_validators.js";
import {
  STRATEGY_HEALTH_DATA_STATUSES,
  STRATEGY_HEALTH_DEFAULT_STALE_TTL_SECONDS,
  STRATEGY_HEALTH_DOMAINS,
  STRATEGY_HEALTH_STATUSES,
} from "./constants.js";

export function normalizeStrategyHealthSnapshot(payload, fieldName = "strategy health snapshot") {
  if (!isPlainObject(payload)) {
    throw new Error(`${fieldName} must be an object`);
  }
  if (payload.schema_version !== "strategy_health_dashboard.v1") {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const status = cleanChoice(
    payload.data_status || "unavailable",
    [...STRATEGY_HEALTH_DATA_STATUSES, "partial"],
    `${fieldName}.data_status`,
  );
  const strategies = status === "unavailable"
    ? []
    : normalizeStrategyHealthStrategies(payload.strategies, fieldName);
  const summary = normalizeStrategyHealthSummary(payload.summary, strategies);
  const errors = normalizeStrategyHealthErrors(payload.errors);
  return {
    schema_version: "strategy_health_dashboard.v1",
    generated_at: normalizeStrategyHealthTimestamp(payload.generated_at, `${fieldName}.generated_at`, true),
    computed_at: normalizeStrategyHealthTimestamp(payload.computed_at, `${fieldName}.computed_at`, true),
    data_status: status,
    summary,
    strategies,
    policy: normalizeStrategyHealthPolicy(payload.policy),
    errors,
  };
}

export function normalizeStrategyHealthStrategies(value, fieldName) {
  return cleanBoundedArray(value, `${fieldName}.strategies`, {
    maxLength: 100,
    lengthMessage: `${fieldName}.strategies must be an array with at most 100 items`,
    uniqueKey: "profile",
    duplicateMessage: `${fieldName}.strategies contains duplicate profile`,
    itemValidator: (item, itemField) => validateObjectSchema(
      item,
      {
        fields: {
          profile: (v, p) => cleanSlug(v, p).toLowerCase(),
          domain: (v, p) => cleanChoice(v, STRATEGY_HEALTH_DOMAINS, p),
          as_of: (v, p) => sanitizeStrategyHealthText(v, p, 64, true),
          status: (v, p) => cleanChoice(v, STRATEGY_HEALTH_STATUSES, p),
          score: (v, p) => normalizeStrategyHealthScore(v, p),
          components: (v, p) => normalizeStrategyHealthComponents(v, p),
          decision: (v, p) => normalizeStrategyHealthDecision(v, p),
          review: (v, p) => normalizeStrategyHealthReview(v, p),
          freshness: (v, p) => normalizeStrategyHealthFreshness(v, p),
          source_revision: (v, p) => sanitizeStrategyHealthText(v, p, 120, true),
        },
      },
      itemField,
    ),
  });
}

export function normalizeStrategyHealthSummary(value, strategies) {
  void value;
  const counts = Object.fromEntries(STRATEGY_HEALTH_STATUSES.map((status) => [status, 0]));
  for (const item of strategies) counts[item.status] += 1;
  return { strategy_count: strategies.length, ...counts };
}

export function normalizeStrategyHealthComponents(value, fieldName) {
  const source = isPlainObject(value) ? value : {};
  return {
    performance: normalizeStrategyHealthScore(source.performance, `${fieldName}.performance`),
    risk: normalizeStrategyHealthScore(source.risk, `${fieldName}.risk`),
    decay: normalizeStrategyHealthScore(source.decay, `${fieldName}.decay`),
    stability: normalizeStrategyHealthScore(source.stability, `${fieldName}.stability`),
    operations: normalizeStrategyHealthScore(source.operations, `${fieldName}.operations`),
  };
}

export function normalizeStrategyHealthDecision(value, fieldName) {
  const source = isPlainObject(value) ? value : {};
  return {
    code: cleanSlug(source.code || "evidence_missing", `${fieldName}.code`).toLowerCase(),
    label: sanitizeStrategyHealthText(source.label, `${fieldName}.label`, 120, false, "证据不足，保持研究态"),
    reason: sanitizeStrategyHealthText(source.reason, `${fieldName}.reason`, 240, false, "没有可用的机器检查结果。"),
  };
}

export function normalizeStrategyHealthReview(value, fieldName) {
  const source = isPlainObject(value) ? value : {};
  return {
    requested_stage: sanitizeStrategyHealthText(source.requested_stage, `${fieldName}.requested_stage`, 80, true),
    evidence_package_id: sanitizeStrategyHealthText(source.evidence_package_id, `${fieldName}.evidence_package_id`, 120, true),
    validation: normalizeStrategyHealthSummaryObject(source.validation),
    risk: normalizeStrategyHealthSummaryObject(source.risk),
    kelly_readiness: normalizeStrategyHealthSummaryObject(source.kelly_readiness),
  };
}

export function normalizeStrategyHealthSummaryObject(value) {
  if (!isPlainObject(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value).slice(0, 12)) {
    if (!/^[A-Za-z0-9_.-]{1,48}$/.test(key)) continue;
    if (/(token|secret|password|cookie|private|path|key)/i.test(key)) continue;
    if (typeof raw === "boolean") result[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) result[key] = raw;
    else if (typeof raw === "string") {
      const safe = sanitizeStrategyHealthText(raw, "summary.value", 120, true);
      if (safe !== null) result[key] = safe;
    }
  }
  return result;
}

export function normalizeStrategyHealthFreshness(value, fieldName) {
  const source = isPlainObject(value) ? value : {};
  return {
    status: cleanChoice(source.status || "unknown", ["fresh", "stale", "unknown"], `${fieldName}.status`),
    age_seconds: normalizeStrategyHealthAge(source.age_seconds, `${fieldName}.age_seconds`),
  };
}

export function normalizeStrategyHealthAge(value, fieldName) {
  return cleanBoundedNumber(value, fieldName, {
    min: 0,
    max: 315360000,
    nullable: true,
    emptyAsNull: true,
    round: true,
    message: `${fieldName} is invalid`,
  });
}

export function normalizeStrategyHealthScore(value, fieldName) {
  return cleanBoundedNumber(value, fieldName, {
    min: 0,
    max: 100,
    nullable: true,
    emptyAsNull: true,
    message: `${fieldName} must be between 0 and 100`,
  });
}

export function normalizeStrategyHealthTimestamp(value, fieldName, nullable = false) {
  return cleanIsoTimestamp(value, fieldName, {
    nullable,
    emptyAsNull: nullable,
    maxLength: 64,
  });
}

export function normalizeStrategyHealthText(value, fieldName, maxLength, nullable = false) {
  return cleanBoundedText(value, fieldName, {
    maxLength,
    nullable,
    emptyAsNull: nullable,
    rejectAngleBracketsOrBackslash: true,
    rejectLocalPaths: true,
    message: `${fieldName} is invalid`,
  });
}

export function sanitizeStrategyHealthText(value, fieldName, maxLength, nullable = false, fallback = null) {
  if (value === null || value === undefined || value === "") return nullable ? null : fallback;
  let text;
  try {
    text = normalizeStrategyHealthText(value, fieldName, maxLength);
  } catch {
    return nullable ? null : fallback;
  }
  if (containsSecretFragment(text)) return nullable ? null : fallback;
  return text;
}

export function normalizeStrategyHealthErrors(value) {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.slice(0, 20).filter((item) => /^[a-z][a-z0-9_.-]{0,63}$/.test(String(item || ""))));
}

export function normalizeStrategyHealthPolicy(value) {
  const source = isPlainObject(value) ? value : {};
  const list = (raw) => Array.isArray(raw)
    ? raw.slice(0, 20).map((item) => sanitizeStrategyHealthText(item, "policy.item", 120, true)).filter(Boolean)
    : [];
  return {
    mode: sanitizeStrategyHealthText(source.mode, "policy.mode", 40, false, "read_only"),
    automatic_stages: list(source.automatic_stages),
    automatic_modes: list(source.automatic_modes),
    human_gate_stages: list(source.human_gate_stages),
    canary_requirements: list(source.canary_requirements),
    human_actions: list(source.human_actions),
    machine_checks: list(source.machine_checks),
    notice: sanitizeStrategyHealthText(source.notice, "policy.notice", 240, false, "健康不等于已批准 live。"),
  };
}

export function emptyStrategyHealthPayload(errorCode) {
  return {
    schema_version: "strategy_health_dashboard.v1",
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    summary: { strategy_count: 0, healthy: 0, watch: 0, review: 0, critical: 0 },
    strategies: [],
    policy: normalizeStrategyHealthPolicy({}),
    errors: [errorCode],
  };
}

export function strategyHealthStaleTtlSeconds(env) {
  return staleTtlSecondsFromEnv(
    env.STRATEGY_HEALTH_STALE_TTL_SECONDS,
    STRATEGY_HEALTH_DEFAULT_STALE_TTL_SECONDS,
  );
}

export function strategyHealthAuditSignature(snapshot) {
  const clone = stripAuditCompareFields(snapshot, ["generated_at", "computed_at"]);
  if (Array.isArray(clone?.strategies)) {
    clone.strategies = clone.strategies.map((item) => {
      if (!isPlainObject(item) || !isPlainObject(item.freshness)) return item;
      const freshness = { ...item.freshness };
      delete freshness.age_seconds;
      return { ...item, freshness };
    });
  }
  return JSON.stringify(clone);
}
