import { normalizeControlPlaneIdentifier } from "../control_plane/helpers.js";
import {
  assertBooleanField,
  assertConstantField,
  assertExactObject,
  cleanBoundedArray,
  cleanBoundedNumber,
  cleanBoundedText,
  cleanChoice,
  cleanHexDigest,
  isPlainObject,
  staleTtlSecondsFromEnv,
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
  ADAPTIVE_SELECTION_AUTHORITY,
  ADAPTIVE_SELECTION_DASHBOARD_SCHEMA_VERSION,
  ADAPTIVE_SELECTION_DECISION_SCHEMA_VERSION,
  ADAPTIVE_SELECTION_DEFAULT_STALE_TTL_SECONDS,
  ADAPTIVE_SELECTION_SOURCE_PREFIX,
  ADAPTIVE_SELECTION_SOURCE_SCHEMA_VERSION,
} from "./constants.js";

export function adaptiveSelectionSourceKey(sourceId) {
  return `${ADAPTIVE_SELECTION_SOURCE_PREFIX}${sourceId}`;
}

export async function normalizeAdaptiveSelectionSourceSnapshot(payload, fieldName = "adaptive selection source snapshot") {
  const source = assertExactObject(
    payload,
    ["schema_version", "source_id", "generated_at", "computed_at", "data_status", "decision", "errors"],
    fieldName,
  );
  assertConstantField(
    source.schema_version,
    ADAPTIVE_SELECTION_SOURCE_SCHEMA_VERSION,
    `${fieldName}.schema_version is unsupported`,
  );
  const dataStatus = cleanChoice(source.data_status, STRATEGY_HEALTH_DATA_STATUSES, `${fieldName}.data_status`);
  const generatedAt = normalizeStrategyHealthTimestamp(source.generated_at, `${fieldName}.generated_at`, true);
  const computedAt = normalizeStrategyHealthTimestamp(source.computed_at, `${fieldName}.computed_at`, true);
  const decision = source.decision === null
    ? null
    : await normalizeAdaptiveSelectionDecision(source.decision, `${fieldName}.decision`);
  if (dataStatus === "unavailable" && decision !== null) {
    throw new Error(`${fieldName}.decision must be null when unavailable`);
  }
  if (dataStatus !== "unavailable" && (!decision || !generatedAt || !computedAt)) {
    throw new Error(`${fieldName} requires decision and timestamps when available`);
  }
  return {
    schema_version: ADAPTIVE_SELECTION_SOURCE_SCHEMA_VERSION,
    source_id: normalizeControlPlaneIdentifier(source.source_id, `${fieldName}.source_id`, false),
    generated_at: generatedAt,
    computed_at: computedAt,
    data_status: dataStatus,
    decision,
    errors: normalizeStrategyHealthErrors(source.errors),
  };
}

export async function normalizeAdaptiveSelectionDecision(payload, fieldName) {
  const value = assertExactObject(
    payload,
    [
      "schema", "decision_id", "created_at", "authority", "no_order", "market_context", "policy_id",
      "recommended_strategy_profile", "recommended_platform_id", "candidates", "input_digest", "decision_digest",
    ],
    fieldName,
  );
  assertConstantField(value.schema, ADAPTIVE_SELECTION_DECISION_SCHEMA_VERSION, `${fieldName}.schema is unsupported`);
  if (value.authority !== ADAPTIVE_SELECTION_AUTHORITY || value.no_order !== true) {
    throw new Error(`${fieldName} must remain shadow-only and no-order`);
  }
  const candidates = cleanBoundedArray(value.candidates, `${fieldName}.candidates`, {
    maxLength: 1000,
    lengthMessage: `${fieldName}.candidates must be a bounded array`,
    uniqueKey: "strategy_profile",
    duplicateMessage: `${fieldName}.candidates contains duplicate strategy_profile`,
    itemValidator: (item, itemField) => normalizeAdaptiveSelectionCandidate(item, itemField),
  });
  const recommendedStrategy = normalizeControlPlaneIdentifier(
    value.recommended_strategy_profile,
    `${fieldName}.recommended_strategy_profile`,
    true,
  );
  const recommendedPlatform = normalizeControlPlaneIdentifier(
    value.recommended_platform_id,
    `${fieldName}.recommended_platform_id`,
    true,
  );
  if ((recommendedStrategy === null) !== (recommendedPlatform === null)) {
    throw new Error(`${fieldName}.recommended strategy and platform must be provided together`);
  }
  const recommendedCandidate = candidates.find((item) => item.strategy_profile === recommendedStrategy && item.accepted);
  if (recommendedStrategy && (!recommendedCandidate || recommendedCandidate.selected_platform_id !== recommendedPlatform)) {
    throw new Error(`${fieldName}.recommended candidate is not accepted`);
  }
  const normalized = {
    schema: ADAPTIVE_SELECTION_DECISION_SCHEMA_VERSION,
    decision_id: normalizeControlPlaneIdentifier(value.decision_id, `${fieldName}.decision_id`, false),
    created_at: normalizeStrategyHealthTimestamp(value.created_at, `${fieldName}.created_at`),
    authority: ADAPTIVE_SELECTION_AUTHORITY,
    no_order: true,
    market_context: normalizeAdaptiveSelectionMarketContext(value.market_context, `${fieldName}.market_context`),
    policy_id: normalizeControlPlaneIdentifier(value.policy_id, `${fieldName}.policy_id`, false),
    recommended_strategy_profile: recommendedStrategy,
    recommended_platform_id: recommendedPlatform,
    candidates,
    input_digest: normalizeAdaptiveSelectionDigest(value.input_digest, `${fieldName}.input_digest`),
    decision_digest: normalizeAdaptiveSelectionDigest(value.decision_digest, `${fieldName}.decision_digest`),
  };
  if (normalized.decision_digest !== await calculateAdaptiveSelectionDecisionDigest(normalized)) {
    throw new Error(`${fieldName}.decision_digest mismatch`);
  }
  return normalized;
}

export function normalizeAdaptiveSelectionMarketContext(value, fieldName) {
  return validateObjectSchema(
    value,
    {
      exactKeys: [
        "schema", "as_of", "domain", "data_version", "data_freshness_days", "regime", "regime_confidence", "factors",
      ],
      constants: {
        schema: { value: "qsl.market_context_snapshot.v1", message: `${fieldName}.schema is unsupported` },
      },
      fields: {
        schema: () => "qsl.market_context_snapshot.v1",
        as_of: (v, p) => {
          const asOf = String(v || "");
          if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
            throw new Error(`${p} must be an ISO date`);
          }
          return asOf;
        },
        domain: (v, p) => cleanChoice(v, STRATEGY_HEALTH_DOMAINS, p),
        data_version: (v, p) => normalizeControlPlaneIdentifier(v, p, false),
        data_freshness_days: (v, p) => {
          if (!Number.isInteger(v) || v < 0 || v > 366) throw new Error(`${p} is invalid`);
          return v;
        },
        regime: (v, p) => normalizeControlPlaneIdentifier(v, p, false),
        regime_confidence: (v, p) => cleanBoundedNumber(v, p, { min: 0, max: 1, message: `${p} is invalid` }),
        factors: (rawFactors, p) => {
          if (!isPlainObject(rawFactors) || Object.keys(rawFactors).length > 100) {
            throw new Error(`${p} is invalid`);
          }
          const factors = {};
          for (const [key, raw] of Object.entries(rawFactors)) {
            if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(key)) throw new Error(`${p} key is invalid`);
            factors[key] = cleanBoundedNumber(raw, `${p}.${key}`, {
              absMax: 1_000_000,
              message: `${p}.${key} is invalid`,
            });
          }
          return factors;
        },
      },
    },
    fieldName,
  );
}

export function normalizeAdaptiveSelectionCandidate(value, fieldName) {
  return validateObjectSchema(
    value,
    {
      exactKeys: [
        "strategy_profile", "release_digest", "selected_platform_id", "score", "risk_multiplier", "accepted", "reasons", "proposed_weight",
      ],
      fields: {
        strategy_profile: (v, p) => normalizeControlPlaneIdentifier(v, p, false),
        release_digest: (v, p) => normalizeAdaptiveSelectionReleaseDigest(v, p),
        selected_platform_id: (v, p) => normalizeControlPlaneIdentifier(v, p, true),
        score: (v, p) => cleanBoundedNumber(v, p, { nullable: true, absMax: 1_000_000, message: `${p} is invalid` }),
        risk_multiplier: (v, p) => cleanBoundedNumber(v, p, { min: 0, max: 1, message: `${p} is invalid` }),
        accepted: (v, p) => assertBooleanField(v, p, { message: `${p} must be boolean` }),
        reasons: (v, p) => cleanBoundedArray(v, p, {
          maxLength: 32,
          lengthMessage: `${p} is invalid`,
          itemValidator: (reason) => cleanBoundedText(reason, `${fieldName}.reason`, {
            trim: false,
            pattern: /^[a-z][a-z0-9_.:-]{0,127}$/,
            message: `${fieldName}.reason is invalid`,
          }),
        }),
        proposed_weight: (v, p) => assertConstantField(v, 0, `${p} must remain zero`),
      },
    },
    fieldName,
  );
}

export function normalizeAdaptiveSelectionReleaseDigest(value, fieldName) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9._:=+-]{1,160}$/.test(text) || /(token|secret|password|cookie|private|api[_-]?key)/i.test(text)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return text;
}

export function normalizeAdaptiveSelectionDigest(value, fieldName) {
  return cleanHexDigest(value, fieldName, { length: 64, message: `${fieldName} is invalid` });
}

export function isAdaptiveSelectionFloatPath(path) {
  if (path[0] === "market_context") {
    return path[1] === "regime_confidence" || path[1] === "factors";
  }
  return path[0] === "candidates"
    && ["score", "risk_multiplier", "proposed_weight"].includes(path[2]);
}

export function canonicalAdaptiveSelectionNumber(value, forceFloat) {
  if (!Number.isFinite(value)) throw new Error("adaptive selection decision must use finite JSON values");
  if (Object.is(value, -0)) return forceFloat ? "-0.0" : "0";
  let text = String(value);
  const exponent = text.match(/^(.*)e([+-]?)(\d+)$/i);
  if (exponent) {
    const [, mantissa, sign, rawExponent] = exponent;
    text = `${mantissa}e${sign || "+"}${sign === "-" ? rawExponent.padStart(2, "0") : rawExponent}`;
  }
  if (forceFloat && !/[.eE]/.test(text)) return `${text}.0`;
  return text;
}

export function canonicalAdaptiveSelectionDecisionJson(value, path = []) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return canonicalAdaptiveSelectionNumber(value, isAdaptiveSelectionFloatPath(path));
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalAdaptiveSelectionDecisionJson(item, [...path, "*"])).join(",")}]`;
  }
  if (!value || typeof value !== "object") throw new Error("adaptive selection decision must use JSON values");
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalAdaptiveSelectionDecisionJson(value[key], [...path, key])}`
  )).join(",")}}`;
}

export async function calculateAdaptiveSelectionDecisionDigest(payload) {
  const material = { ...payload };
  delete material.decision_digest;
  const raw = new TextEncoder().encode(canonicalAdaptiveSelectionDecisionJson(material));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeAdaptiveSelectionSummary(selections) {
  const entries = Array.isArray(selections) ? selections : [];
  const decisions = entries.map((item) => item.decision).filter(Boolean);
  const candidates = decisions.flatMap((item) => item.candidates);
  return {
    source_count: entries.length,
    decision_count: decisions.length,
    candidate_count: candidates.length,
    recommended_count: decisions.filter((item) => item.recommended_strategy_profile).length,
    rejected_candidate_count: candidates.filter((item) => !item.accepted).length,
  };
}

export function emptyAdaptiveSelectionSourceSnapshot(errorCode) {
  return {
    schema_version: ADAPTIVE_SELECTION_SOURCE_SCHEMA_VERSION,
    source_id: "unavailable",
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    decision: null,
    errors: [errorCode],
  };
}

export function emptyAdaptiveSelectionPayload(errorCode) {
  return {
    schema_version: ADAPTIVE_SELECTION_DASHBOARD_SCHEMA_VERSION,
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    summary: { source_count: 0, decision_count: 0, candidate_count: 0, recommended_count: 0, rejected_candidate_count: 0 },
    selections: [],
    policy: {
      authority: ADAPTIVE_SELECTION_AUTHORITY,
      no_order: true,
      execution_authority_granted: false,
      notice: "M1 Shadow 建议尚不可用；控制台不会推断策略、平台或订单。",
    },
    errors: [errorCode],
  };
}

export function adaptiveSelectionStaleTtlSeconds(env) {
  return staleTtlSecondsFromEnv(
    env.ADAPTIVE_SELECTION_STALE_TTL_SECONDS,
    ADAPTIVE_SELECTION_DEFAULT_STALE_TTL_SECONDS,
  );
}
