/**
 * Control-plane normalize / freshness / token helpers.
 *
 * Pure helpers extracted from runtime_support. Field validators used by control
 * plane snapshots are localized here so this module never imports runtime_support.
 */

import { HttpError } from "../http_error.js";
import { uniqueStrings } from "../auth/identity_lists.js";
import {
  CONTROL_PLANE_ATTENTION_STATUSES,
  CONTROL_PLANE_AUTOMATION_STATES,
  CONTROL_PLANE_CANDIDATE_KINDS,
  CONTROL_PLANE_DATA_STATUSES,
  CONTROL_PLANE_DEFAULT_STALE_TTL_SECONDS,
  CONTROL_PLANE_DOMAINS,
  CONTROL_PLANE_LIFECYCLE_STATUSES,
  CONTROL_PLANE_MAX_SOURCES,
  CONTROL_PLANE_RECOMMENDATIONS,
  CONTROL_PLANE_RESEARCH_DELIVERY_GRACE_MS,
  CONTROL_PLANE_RESEARCH_SCHEDULE_UTC_DAYS,
  CONTROL_PLANE_RESEARCH_SCHEDULE_UTC_HOUR,
  CONTROL_PLANE_SOURCE_PREFIX,
  CONTROL_PLANE_SOURCE_RETIREMENTS_KEY,
  CONTROL_PLANE_SOURCE_SCHEMA_VERSION,
  CONTROL_PLANE_STAGES,
  FORWARD_OBSERVATION_RESEARCH_STAGES,
  FORWARD_OBSERVATION_STATES,
} from "./constants.js";

function assertExactFields(value, fields, fieldName) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw new Error(`${fieldName} has invalid fields`);
  }
  return value;
}

function cleanChoice(value, allowed, field) {
  const text = String(value || "").trim();
  if (!allowed.includes(text)) throw new Error(`${field} is invalid`);
  return text;
}

function normalizeStrategyHealthFreshness(value, fieldName) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    status: cleanChoice(source.status || "unknown", ["fresh", "stale", "unknown"], `${fieldName}.status`),
    age_seconds: normalizeStrategyHealthAge(source.age_seconds, `${fieldName}.age_seconds`),
  };
}
function normalizeStrategyHealthAge(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 315360000) throw new Error(`${fieldName} is invalid`);
  return Math.round(number);
}
function normalizeStrategyHealthTimestamp(value, fieldName, nullable = false) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const text = normalizeStrategyHealthText(value, fieldName, 64);
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error(`${fieldName} must be an ISO timestamp`);
  }
  return text;
}
function normalizeStrategyHealthText(value, fieldName, maxLength, nullable = false) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const text = String(value || "").trim();
  if (
    !text ||
    text.length > maxLength ||
    /[<>\\]/.test(text) ||
    text.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(text)
  ) throw new Error(`${fieldName} is invalid`);
  return text;
}
function sanitizeStrategyHealthText(value, fieldName, maxLength, nullable = false, fallback = null) {
  if (value === null || value === undefined || value === "") return nullable ? null : fallback;
  let text;
  try {
    text = normalizeStrategyHealthText(value, fieldName, maxLength);
  } catch {
    return nullable ? null : fallback;
  }
  if (
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i.test(text) ||
    /\b(?:token|secret|password|api[_ -]?key|private[_ -]?key|cookie)\s*[:=]\s*[^\s,;]{8,}/i.test(text) ||
    /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,})\b/.test(text) ||
    /(?:^|[\s(])(?:\/Users\/|\/home\/|[A-Za-z]:[\\/])/.test(text)
  ) return nullable ? null : fallback;
  return text;
}
function normalizeStrategyHealthErrors(value) {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.slice(0, 20).filter((item) => /^[a-z][a-z0-9_.-]{0,63}$/.test(String(item || ""))));
}

export function controlPlaneDecisionExpiryAt(snapshot, ttlSeconds, now = Date.now()) {
  const timestamps = [snapshot?.generated_at, snapshot?.computed_at]
    .filter(Boolean)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  if (!timestamps.length) return null;
  const observedAt = Math.min(...timestamps);
  if (observedAt > now + 5 * 60 * 1000) return null;
  return observedAt + ttlSeconds * 1000;
}
export function isOwnerDecisionCandidate(candidate) {
  return candidate?.lifecycle?.stage === "P6"
    && candidate.lifecycle.status === "owner_decision_required"
    && candidate.recommendation?.code === "owner_live_decision";
}
export function normalizeControlPlaneSourceRetirements(payload, now) {
  const value = assertExactFields(payload, ["schema_version", "retirements"], CONTROL_PLANE_SOURCE_RETIREMENTS_KEY);
  if (value.schema_version !== "qsl_control_plane_source_retirements.v1"
      || !Array.isArray(value.retirements) || value.retirements.length > CONTROL_PLANE_MAX_SOURCES) {
    throw new Error("invalid control plane source retirements");
  }
  const retirements = new Map();
  for (const entry of value.retirements) {
    const item = assertExactFields(entry, ["source_id", "retired_at", "reason"], "source retirement");
    const sourceId = normalizeControlPlaneIdentifier(item.source_id, "source retirement.source_id", false);
    const retiredAt = normalizeStrategyHealthTimestamp(item.retired_at, "source retirement.retired_at");
    const reason = typeof item.reason === "string"
      ? sanitizeStrategyHealthText(item.reason, "source retirement.reason", 240, false, null) : null;
    // "unavailable" is the diagnostic identity for unreadable source records.
    if (sourceId === "unavailable" || retirements.has(sourceId) || Date.parse(retiredAt) > now || !reason) {
      throw new Error("invalid control plane source retirement");
    }
    retirements.set(sourceId, { source_id: sourceId, retired_at: retiredAt, reason });
  }
  return retirements;
}
export function controlPlaneSourceKey(sourceId) {
  return `${CONTROL_PLANE_SOURCE_PREFIX}${sourceId}`;
}
export function controlPlaneSnapshotFreshness(snapshot, ttlSeconds, now) {
  const timestamps = [snapshot.generated_at, snapshot.computed_at]
    .filter(Boolean)
    .map((value) => Date.parse(value));
  const freshnessAt = timestamps.length ? Math.min(...timestamps) : Number.NaN;
  const futureBeyondClockSkew = Number.isFinite(freshnessAt) && freshnessAt > now + 5 * 60 * 1000;
  const ageSeconds = futureBeyondClockSkew
    ? Number.POSITIVE_INFINITY
    : Number.isFinite(freshnessAt)
      ? Math.max(0, Math.round((now - freshnessAt) / 1000))
      : Number.POSITIVE_INFINITY;
  const dataStatus = snapshot.data_status === "ready" && ageSeconds > ttlSeconds
    ? "stale"
    : snapshot.data_status;
  return { data_status: dataStatus, age_seconds: Number.isFinite(ageSeconds) ? ageSeconds : null };
}
export function controlPlaneResearchSnapshotFreshness(snapshot, ttlSeconds, now) {
  if (snapshot.data_status !== "ready") {
    return controlPlaneSnapshotFreshness(snapshot, ttlSeconds, now);
  }
  const timestamps = [snapshot.generated_at, snapshot.computed_at]
    .filter(Boolean)
    .map((value) => Date.parse(value));
  const freshnessAt = timestamps.length ? Math.min(...timestamps) : Number.NaN;
  const futureBeyondClockSkew = Number.isFinite(freshnessAt) && freshnessAt > now + 5 * 60 * 1000;
  const ageSeconds = futureBeyondClockSkew
    ? Number.POSITIVE_INFINITY
    : Number.isFinite(freshnessAt)
      ? Math.max(0, Math.round((now - freshnessAt) / 1000))
      : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(freshnessAt) || futureBeyondClockSkew) {
    return { data_status: "stale", age_seconds: null };
  }

  const ttlDeadline = freshnessAt + ttlSeconds * 1000;
  const nextScheduledRefresh = nextControlPlaneResearchScheduleAfter(freshnessAt);
  const scheduledDeadline = nextScheduledRefresh + CONTROL_PLANE_RESEARCH_DELIVERY_GRACE_MS;
  const staleDeadline = Math.max(ttlDeadline, scheduledDeadline);
  return {
    data_status: now > staleDeadline ? "stale" : "ready",
    age_seconds: ageSeconds,
  };
}
export function nextControlPlaneResearchScheduleAfter(freshnessAt) {
  const scheduled = new Date(freshnessAt);
  scheduled.setUTCMinutes(0, 0, 0);
  scheduled.setUTCHours(CONTROL_PLANE_RESEARCH_SCHEDULE_UTC_HOUR);
  if (scheduled.getTime() <= freshnessAt) scheduled.setUTCDate(scheduled.getUTCDate() + 1);
  while (!CONTROL_PLANE_RESEARCH_SCHEDULE_UTC_DAYS.has(scheduled.getUTCDay())) {
    scheduled.setUTCDate(scheduled.getUTCDate() + 1);
  }
  return scheduled.getTime();
}
export function mergeControlPlaneFreshness(candidateFreshness, sourceFreshness) {
  const sourceAgeSeconds = sourceFreshness.age_seconds;
  const candidateAge = candidateFreshness.age_seconds;
  const ageSeconds = sourceAgeSeconds === null
    ? candidateAge
    : (candidateAge === null ? sourceAgeSeconds : Math.max(candidateAge, sourceAgeSeconds));
  const status = candidateFreshness.status === "stale" || sourceFreshness.data_status !== "ready"
    ? "stale"
    : candidateFreshness.status;
  return { status, age_seconds: ageSeconds };
}
export function earliestControlPlaneTimestamp(values) {
  const timestamps = values
    .filter(Boolean)
    .map((value) => ({ value, timestamp: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);
  return timestamps[0]?.value || null;
}
export function requireDedicatedControlPlaneSyncToken(request, env) {
  const expected = String(env.CONTROL_PLANE_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("control plane sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("control plane sync token is invalid", 401);
}
export function requireControlPlaneSourceSyncToken(request, env) {
  const validationToken = String(env.AAB_VALIDATION_SYNC_TOKEN || "");
  const token = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  // Check the narrower credential first, including accidental equal bindings.
  if (validationToken && token === validationToken) return true;
  if (validationToken && !env.CONTROL_PLANE_SYNC_TOKEN) {
    throw new HttpError("control plane source sync token is invalid", 401);
  }
  requireDedicatedControlPlaneSyncToken(request, env);
  return false;
}
export function normalizeControlPlaneSnapshot(payload, fieldName = "control plane snapshot") {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
  if (payload.schema_version !== "qsl_control_plane_dashboard.v1") {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  for (const required of ["generated_at", "computed_at", "data_status", "summary", "candidates", "policy", "errors"]) {
    if (!(required in payload)) throw new Error(`${fieldName}.${required} is required`);
  }
  if (!payload.summary || Array.isArray(payload.summary) || typeof payload.summary !== "object") {
    throw new Error(`${fieldName}.summary must be an object`);
  }
  const dataStatus = cleanChoice(payload.data_status || "unavailable", CONTROL_PLANE_DATA_STATUSES, `${fieldName}.data_status`);
  const candidates = dataStatus === "unavailable" ? [] : normalizeControlPlaneCandidates(payload.candidates, fieldName);
  const errors = normalizeStrategyHealthErrors(payload.errors);
  return {
    schema_version: "qsl_control_plane_dashboard.v1",
    generated_at: normalizeStrategyHealthTimestamp(payload.generated_at, `${fieldName}.generated_at`, true),
    computed_at: normalizeStrategyHealthTimestamp(payload.computed_at, `${fieldName}.computed_at`, true),
    data_status: dataStatus,
    summary: normalizeControlPlaneSummary(candidates),
    attention: normalizeControlPlaneAttention({ dataStatus, candidates, errors }),
    candidates,
    policy: normalizeControlPlanePolicy(payload.policy, fieldName),
    errors,
  };
}
export function normalizeControlPlaneSourceSnapshot(payload, fieldName = "control plane source snapshot") {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
  if (payload.schema_version !== CONTROL_PLANE_SOURCE_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  for (const required of ["source_id", "generated_at", "computed_at", "data_status", "candidates", "errors"]) {
    if (!(required in payload)) throw new Error(`${fieldName}.${required} is required`);
  }
  const dataStatus = cleanChoice(payload.data_status || "unavailable", CONTROL_PLANE_DATA_STATUSES, `${fieldName}.data_status`);
  return {
    schema_version: CONTROL_PLANE_SOURCE_SCHEMA_VERSION,
    source_id: normalizeControlPlaneIdentifier(payload.source_id, `${fieldName}.source_id`, false),
    generated_at: normalizeStrategyHealthTimestamp(payload.generated_at, `${fieldName}.generated_at`, true),
    computed_at: normalizeStrategyHealthTimestamp(payload.computed_at, `${fieldName}.computed_at`, true),
    data_status: dataStatus,
    candidates: dataStatus === "unavailable" ? [] : normalizeControlPlaneCandidates(payload.candidates, fieldName),
    errors: normalizeStrategyHealthErrors(payload.errors),
  };
}
export function emptyControlPlaneSourceSnapshot(errorCode) {
  return {
    schema_version: CONTROL_PLANE_SOURCE_SCHEMA_VERSION,
    source_id: "unavailable",
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    candidates: [],
    errors: [errorCode],
  };
}
export function normalizeControlPlaneCandidates(value, fieldName) {
  if (!Array.isArray(value) || value.length > 1000) {
    throw new Error(`${fieldName}.candidates must be an array with at most 1000 items`);
  }
  const seen = new Set();
  return value.map((item, index) => {
    const prefix = `${fieldName}.candidates[${index}]`;
    if (!item || Array.isArray(item) || typeof item !== "object") throw new Error(`${prefix} must be an object`);
    const candidateId = normalizeControlPlaneIdentifier(item.candidate_id, `${prefix}.candidate_id`, false);
    if (seen.has(candidateId)) throw new Error(`${fieldName}.candidates contains duplicate candidate_id`);
    seen.add(candidateId);
    const lifecycle = normalizeControlPlaneLifecycle(item.lifecycle, prefix);
    const recommendation = normalizeControlPlaneRecommendation(item.recommendation, prefix);
    const isOwnerDecision = lifecycle.stage === "P6";
    if (isOwnerDecision && (lifecycle.status !== "owner_decision_required" || recommendation.code !== "owner_live_decision")) {
      throw new Error(`${prefix} P6 must be an owner_live_decision`);
    }
    if (!isOwnerDecision && (lifecycle.status === "owner_decision_required" || recommendation.code === "owner_live_decision")) {
      throw new Error(`${prefix} only P6 can require an owner_live_decision`);
    }
    const forwardObservation = item.forward_observation === undefined
      ? undefined
      : normalizeForwardObservation(item.forward_observation, lifecycle, prefix);
    return {
      candidate_id: candidateId,
      candidate_kind: cleanChoice(item.candidate_kind, CONTROL_PLANE_CANDIDATE_KINDS, `${prefix}.candidate_kind`),
      domain: cleanChoice(item.domain, CONTROL_PLANE_DOMAINS, `${prefix}.domain`),
      lifecycle,
      evidence: normalizeControlPlaneEvidence(item.evidence, prefix),
      recommendation,
      freshness: normalizeStrategyHealthFreshness(item.freshness, `${prefix}.freshness`),
      ...(forwardObservation === undefined ? {} : { forward_observation: forwardObservation }),
    };
  });
}
export function normalizeForwardObservation(value, lifecycle, prefix) {
  if (!FORWARD_OBSERVATION_RESEARCH_STAGES.has(lifecycle.stage)) {
    throw new Error(`${prefix}.forward_observation is only allowed for research stages`);
  }
  const observation = assertExactFields(value, [
    "state", "observations_completed", "required_trading_sessions", "last_observed_session", "observed_at", "no_order", "live_authority_granted",
  ], `${prefix}.forward_observation`);
  const completed = observation.observations_completed;
  const required = observation.required_trading_sessions;
  if (!Number.isSafeInteger(completed) || !Number.isSafeInteger(required) || completed < 0 || required < 1 || completed > required || required > 10000) {
    throw new Error(`${prefix}.forward_observation observation counts are invalid`);
  }
  if (observation.no_order !== true) throw new Error(`${prefix}.forward_observation.no_order must be true`);
  if (observation.live_authority_granted !== false) throw new Error(`${prefix}.forward_observation.live_authority_granted must be false`);
  return {
    state: cleanChoice(observation.state, FORWARD_OBSERVATION_STATES, `${prefix}.forward_observation.state`),
    observations_completed: completed,
    required_trading_sessions: required,
    last_observed_session: normalizeForwardObservationDate(observation.last_observed_session, `${prefix}.forward_observation.last_observed_session`),
    observed_at: normalizeStrategyHealthTimestamp(observation.observed_at, `${prefix}.forward_observation.observed_at`),
    no_order: true,
    live_authority_granted: false,
  };
}
export function normalizeForwardObservationDate(value, fieldName) {
  const text = normalizeStrategyHealthText(value, fieldName, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00.000Z`)) || new Date(`${text}T00:00:00.000Z`).toISOString().slice(0, 10) !== text) {
    throw new Error(`${fieldName} must be an ISO date`);
  }
  return text;
}
export function normalizeControlPlaneIdentifier(value, fieldName, nullable = true) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9._=-]{1,128}$/.test(text)) throw new Error(`${fieldName} is invalid`);
  if (/(token|secret|password|cookie|private|api[_-]?key)/i.test(text)) throw new Error(`${fieldName} is sensitive`);
  return text;
}
export function normalizeControlPlaneLifecycle(value, prefix) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    stage: cleanChoice(source.stage, CONTROL_PLANE_STAGES, `${prefix}.lifecycle.stage`),
    status: cleanChoice(source.status, CONTROL_PLANE_LIFECYCLE_STATUSES, `${prefix}.lifecycle.status`),
  };
}
export function normalizeControlPlaneEvidence(value, prefix) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    p1_input_digest: normalizeControlPlaneIdentifier(source.p1_input_digest, `${prefix}.evidence.p1_input_digest`),
    p2_config_digest: normalizeControlPlaneIdentifier(source.p2_config_digest, `${prefix}.evidence.p2_config_digest`),
    p3_evidence_id: normalizeControlPlaneIdentifier(source.p3_evidence_id, `${prefix}.evidence.p3_evidence_id`),
    source_revision: normalizeControlPlaneIdentifier(source.source_revision, `${prefix}.evidence.source_revision`),
  };
}
export function normalizeControlPlaneRecommendation(value, prefix) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    code: cleanChoice(source.code || "none", CONTROL_PLANE_RECOMMENDATIONS, `${prefix}.recommendation.code`),
    reason: sanitizeStrategyHealthText(source.reason, `${prefix}.recommendation.reason`, 240, false, "没有可用的机器建议。"),
  };
}
export function normalizeControlPlaneSummary(candidates) {
  return {
    candidate_count: candidates.length,
    deferred: candidates.filter((item) => item.lifecycle.status === "deferred").length,
    parked: candidates.filter((item) => item.lifecycle.status === "parked").length,
    owner_decision_required: candidates.filter((item) => item.lifecycle.status === "owner_decision_required").length,
  };
}
export function normalizeControlPlaneAttention({ dataStatus, candidates, errors }) {
  const normalizedCandidates = Array.isArray(candidates) ? candidates : [];
  const normalizedErrors = uniqueStrings(Array.isArray(errors) ? errors : []);
  const reasonCodes = new Set(normalizedErrors);
  if (dataStatus !== "ready") reasonCodes.add("control_plane_source_unavailable");
  if (!normalizedCandidates.length && dataStatus === "ready") reasonCodes.add("control_plane_candidate_missing");
  if (normalizedCandidates.some((item) => item.lifecycle?.status === "deferred")) {
    reasonCodes.add("control_plane_candidate_deferred");
  }
  if (normalizedCandidates.some((item) => item.lifecycle?.status === "parked")) {
    reasonCodes.add("control_plane_candidate_parked");
  }
  const status = dataStatus !== "ready"
    ? "unavailable"
    : (reasonCodes.size ? "attention_required" : "research_only");
  return {
    status: cleanChoice(status, CONTROL_PLANE_ATTENTION_STATUSES, "control plane attention status"),
    reason_codes: [...reasonCodes].sort(),
  };
}
export function normalizeControlPlanePolicy(value, fieldName) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (source.p6_owner_decision_required !== true) {
    throw new Error(`${fieldName}.policy.p6_owner_decision_required must be true`);
  }
  return {
    p4_p5_automation: cleanChoice(
      source.p4_p5_automation || "not_configured",
      CONTROL_PLANE_AUTOMATION_STATES,
      `${fieldName}.policy.p4_p5_automation`,
    ),
    p6_owner_decision_required: true,
    notice: sanitizeStrategyHealthText(source.notice, `${fieldName}.policy.notice`, 240, false, "live 仍需所有者明确决定。"),
  };
}
export function emptyControlPlanePayload(errorCode) {
  return {
    schema_version: "qsl_control_plane_dashboard.v1",
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    summary: { candidate_count: 0, deferred: 0, parked: 0, owner_decision_required: 0 },
    attention: { status: "unavailable", reason_codes: ["control_plane_source_unavailable", errorCode] },
    candidates: [],
    policy: { p4_p5_automation: "not_configured", p6_owner_decision_required: true, notice: "live 仍需所有者明确决定。" },
    errors: [errorCode],
  };
}
export function controlPlaneStaleTtlSeconds(env) {
  const configured = Number(env.CONTROL_PLANE_STALE_TTL_SECONDS);
  if (!Number.isFinite(configured) || configured < 300 || configured > 604800) {
    return CONTROL_PLANE_DEFAULT_STALE_TTL_SECONDS;
  }
  return Math.floor(configured);
}
