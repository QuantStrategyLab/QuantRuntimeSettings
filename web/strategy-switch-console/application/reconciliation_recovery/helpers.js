/**
 * Reconciliation-recovery normalize / freshness / confirmation / token helpers.
 *
 * Pure helpers extracted from runtime_support. Strategy-health field normalizers
 * used only by recovery snapshots are localized here so this module never
 * imports runtime_support.
 */

import { HttpError } from "../http_error.js";
import { cleanGithubLogin, uniqueStrings } from "../auth/identity_lists.js";
import { currentReconciliationObservationPresentation } from "../console_api/reconciliation_presentation.js";
import { controlPlaneDecisionExpiryAt, normalizeControlPlaneIdentifier } from "../control_plane/helpers.js";
import {
  assertExactFields,
  assertRequiredAndOptionalFields,
  canonicalResearchTaskJson,
  normalizeResearchTaskDigest,
  normalizeResearchTaskIdentity,
  normalizeResearchTaskTimestamp,
} from "../research_task/helpers.js";
import {
  RECONCILIATION_RECOVERY_CONFIRMATION_PREFIX,
  RECONCILIATION_RECOVERY_CONFIRMATION_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_CURRENT_PREFIX,
  RECONCILIATION_RECOVERY_DASHBOARD_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_DATA_STATUSES,
  RECONCILIATION_RECOVERY_DEFAULT_STALE_TTL_SECONDS,
  RECONCILIATION_RECOVERY_DUAL_REVIEW_OUTCOMES,
  RECONCILIATION_RECOVERY_ENVIRONMENTS,
  RECONCILIATION_RECOVERY_MAX_REQUESTS,
  RECONCILIATION_RECOVERY_MAX_SAMPLE_WINDOW_MS,
  RECONCILIATION_RECOVERY_PLATFORMS,
  RECONCILIATION_RECOVERY_READINESS,
  RECONCILIATION_RECOVERY_SOURCE_PREFIX,
  RECONCILIATION_RECOVERY_SOURCE_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_STATES,
} from "./constants.js";

function cleanChoice(value, allowed, field) {
  const text = String(value || "").trim();
  if (!allowed.includes(text)) throw new Error(`${field} is invalid`);
  return text;
}

function normalizeStrategyHealthText(value, fieldName, maxLength, nullable = false) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const text = String(value || "").trim();
  if (
    !text
    || text.length > maxLength
    || /[<>\\]/.test(text)
    || text.startsWith("/")
    || /^[A-Za-z]:[\\/]/.test(text)
  ) throw new Error(`${fieldName} is invalid`);
  return text;
}

function normalizeStrategyHealthTimestamp(value, fieldName, nullable = false) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const text = normalizeStrategyHealthText(value, fieldName, 64);
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error(`${fieldName} must be an ISO timestamp`);
  }
  return text;
}

function normalizeStrategyHealthErrors(value) {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.slice(0, 20).filter((item) => /^[a-z][a-z0-9_.-]{0,63}$/.test(String(item || ""))));
}

export function requireDedicatedReconciliationRecoverySyncToken(request, env) {
  const expected = String(env.RECONCILIATION_RECOVERY_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("reconciliation recovery sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("reconciliation recovery sync token is invalid", 401);
}

export function requireDedicatedReconciliationRecoveryControllerToken(request, env) {
  const expected = String(env.RECONCILIATION_RECOVERY_CONTROLLER_TOKEN || "");
  if (!expected) throw new HttpError("reconciliation recovery controller token is not configured", 500);
  if (expected === String(env.RECONCILIATION_RECOVERY_SYNC_TOKEN || "")) {
    throw new HttpError("reconciliation recovery controller token must differ from the source sync token", 500);
  }
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("reconciliation recovery controller token is invalid", 401);
}

export function reconciliationRecoverySourceKey(sourceId) {
  return `${RECONCILIATION_RECOVERY_SOURCE_PREFIX}${sourceId}`;
}

export function reconciliationRecoveryConfirmationArchiveKey(recoveryId, confirmationSha256) {
  return `${RECONCILIATION_RECOVERY_CONFIRMATION_PREFIX}${recoveryId}:${confirmationSha256}`;
}

export function reconciliationRecoveryConfirmationCurrentKey(recoveryId) {
  return `${RECONCILIATION_RECOVERY_CURRENT_PREFIX}${recoveryId}`;
}

export function reconciliationRecoveryStaleTtlSeconds(env) {
  const configured = Number(env.RECONCILIATION_RECOVERY_STALE_TTL_SECONDS);
  if (!Number.isFinite(configured) || configured < 300 || configured > 3600) {
    return RECONCILIATION_RECOVERY_DEFAULT_STALE_TTL_SECONDS;
  }
  return Math.floor(configured);
}

// A recently published source must not be able to re-advertise an old
// reconciliation candidate as current.  The private controller independently
// verifies raw receipts, but the human console also fails closed here.
export function reconciliationRecoveryEvidenceFreshness(recovery, sourceFreshness, ttlSeconds, now) {
  const observedAt = Date.parse(recovery.mode === "initial_enrollment" ? recovery.candidate.last_observed_at : recovery.last_observed_at);
  const futureBeyondClockSkew = Number.isFinite(observedAt) && observedAt > now + 5 * 60 * 1000;
  const evidenceAgeSeconds = futureBeyondClockSkew
    ? Number.POSITIVE_INFINITY
    : Number.isFinite(observedAt)
      ? Math.max(0, Math.round((now - observedAt) / 1000))
      : Number.POSITIVE_INFINITY;
  const ageSeconds = sourceFreshness.age_seconds === null
    ? evidenceAgeSeconds
    : Math.max(sourceFreshness.age_seconds, evidenceAgeSeconds);
  const dataStatus = sourceFreshness.data_status === "ready" && evidenceAgeSeconds <= ttlSeconds
    ? "ready"
    : "stale";
  return { data_status: dataStatus, age_seconds: Number.isFinite(ageSeconds) ? ageSeconds : null };
}

export function reconciliationRecoveryDecisionExpiryAt(recovery, source, ttlSeconds, now = Date.now()) {
  const sourceExpiry = controlPlaneDecisionExpiryAt(source, ttlSeconds, now);
  if (sourceExpiry == null) return null;
  const observedAt = Date.parse(recovery.mode === "initial_enrollment"
    ? recovery.candidate?.last_observed_at
    : recovery.last_observed_at);
  if (!Number.isFinite(observedAt) || observedAt > now + 5 * 60 * 1000) return null;
  return Math.min(sourceExpiry, observedAt + ttlSeconds * 1000);
}

export function currentReconciliationRecoveryRequest(dashboard, recoveryId) {
  const entry = dashboard?.recoveries?.find((item) => item.recovery?.recovery_id === recoveryId);
  if (entry?.recovery?.mode !== "initial_enrollment" && dashboard?.data_status !== "ready") {
    throw new HttpError("current reconciliation recovery evidence is not ready", 409);
  }
  if (!entry || entry.freshness?.data_status !== "ready") {
    throw new HttpError("reconciliation recovery request is not fresh", 409);
  }
  const recovery = entry.recovery;
  if (recovery.mode === "initial_enrollment") {
    if (recovery.readiness !== "awaiting_human_confirmation" || recovery.blocker_codes.length) {
      throw new HttpError("initial_enrollment_incomplete", 409);
    }
    return recovery;
  }
  if (
    recovery.readiness !== "awaiting_human_confirmation"
    || recovery.reconciliation_state !== "RECONCILE_ONLY"
    || recovery.blocker_codes.length
    || recovery.dual_review.evidence_binding_sha256 !== recovery.candidate_sha256
    || recovery.evidence_sample_count < 1
  ) {
    throw new HttpError("reconciliation recovery request is not eligible for confirmation", 409);
  }
  return recovery;
}

export function normalizeReconciliationRecoveryConfirmationRequest(payload) {
  if (payload?.mode === "initial_enrollment") {
    const value = assertRequiredAndOptionalFields(
      payload,
      ["mode", "recovery_id", "candidate_sha256", "facts_sha256"],
      ["decision", "request_id"],
      "initial enrollment confirmation request",
    );
    const decision = value.decision ?? "approve";
    if (!["approve", "reject"].includes(decision)) throw new Error("initial enrollment decision unsupported");
    return {
      mode: "initial_enrollment",
      recovery_id: normalizeControlPlaneIdentifier(value.recovery_id, "recovery_id", false),
      candidate_sha256: normalizeResearchTaskDigest(value.candidate_sha256, "candidate_sha256"),
      facts_sha256: normalizeResearchTaskDigest(value.facts_sha256, "facts_sha256"),
      decision,
      request_id: value.request_id,
    };
  }
  const value = assertRequiredAndOptionalFields(payload, [
    "recovery_id", "candidate_sha256", "dual_review_binding_sha256",
  ], ["decision", "request_id"], "reconciliation recovery confirmation request");
  const decision = Object.prototype.hasOwnProperty.call(value, "decision") ? value.decision : "approve";
  if (decision !== "approve" && decision !== "reject") {
    throw new Error("reconciliation recovery confirmation request.decision is unsupported");
  }
  return {
    recovery_id: normalizeControlPlaneIdentifier(value.recovery_id, "reconciliation recovery confirmation request.recovery_id", false),
    candidate_sha256: normalizeResearchTaskDigest(
      value.candidate_sha256,
      "reconciliation recovery confirmation request.candidate_sha256",
    ),
    dual_review_binding_sha256: normalizeResearchTaskDigest(
      value.dual_review_binding_sha256,
      "reconciliation recovery confirmation request.dual_review_binding_sha256",
    ),
    decision,
    request_id: value.request_id,
  };
}

export async function calculateReconciliationRecoveryConfirmationSha256(payload) {
  const material = { ...payload };
  delete material.confirmation_sha256;
  const raw = new TextEncoder().encode(canonicalResearchTaskJson(material));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildReconciliationRecoveryConfirmation({ recovery, confirmedBy, confirmedAt }) {
  const confirmation = {
    schema_version: RECONCILIATION_RECOVERY_CONFIRMATION_SCHEMA_VERSION,
    recovery_id: recovery.recovery_id,
    candidate_sha256: recovery.candidate_sha256,
    dual_review_binding_sha256: recovery.dual_review.evidence_binding_sha256,
    confirmed_at: confirmedAt,
    confirmed_by: confirmedBy,
    no_order: true,
    execution_authority_granted: false,
    confirmation_sha256: "",
  };
  confirmation.confirmation_sha256 = await calculateReconciliationRecoveryConfirmationSha256(confirmation);
  return await normalizeReconciliationRecoveryConfirmation(confirmation, "reconciliation recovery confirmation");
}

export async function normalizeReconciliationRecoveryConfirmation(payload, fieldName) {
  const value = assertExactFields(payload, [
    "schema_version", "recovery_id", "candidate_sha256", "dual_review_binding_sha256", "confirmed_at", "confirmed_by",
    "no_order", "execution_authority_granted", "confirmation_sha256",
  ], fieldName);
  if (value.schema_version !== RECONCILIATION_RECOVERY_CONFIRMATION_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const confirmation = {
    schema_version: RECONCILIATION_RECOVERY_CONFIRMATION_SCHEMA_VERSION,
    recovery_id: normalizeControlPlaneIdentifier(value.recovery_id, `${fieldName}.recovery_id`, false),
    candidate_sha256: normalizeResearchTaskDigest(value.candidate_sha256, `${fieldName}.candidate_sha256`),
    dual_review_binding_sha256: normalizeResearchTaskDigest(
      value.dual_review_binding_sha256,
      `${fieldName}.dual_review_binding_sha256`,
    ),
    confirmed_at: normalizeResearchTaskTimestamp(value.confirmed_at, `${fieldName}.confirmed_at`),
    confirmed_by: cleanGithubLogin(value.confirmed_by, `${fieldName}.confirmed_by`),
    no_order: value.no_order,
    execution_authority_granted: value.execution_authority_granted,
    confirmation_sha256: normalizeResearchTaskDigest(value.confirmation_sha256, `${fieldName}.confirmation_sha256`),
  };
  if (confirmation.no_order !== true || confirmation.execution_authority_granted !== false) {
    throw new Error(`${fieldName} must remain no-order and non-executable`);
  }
  if (confirmation.confirmation_sha256 !== await calculateReconciliationRecoveryConfirmationSha256(confirmation)) {
    throw new Error(`${fieldName}.confirmation_sha256 mismatch`);
  }
  return confirmation;
}

export function normalizeReconciliationRecoverySourceSnapshot(payload, fieldName = "reconciliation recovery source snapshot") {
  const source = assertExactFields(payload, [
    "schema_version", "source_id", "generated_at", "computed_at", "data_status", "recoveries", "errors",
  ], fieldName);
  if (source.schema_version !== RECONCILIATION_RECOVERY_SOURCE_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const dataStatus = cleanChoice(source.data_status, RECONCILIATION_RECOVERY_DATA_STATUSES, `${fieldName}.data_status`);
  if (!Array.isArray(source.recoveries) || source.recoveries.length > RECONCILIATION_RECOVERY_MAX_REQUESTS) {
    throw new Error(`${fieldName}.recoveries must be an array with at most ${RECONCILIATION_RECOVERY_MAX_REQUESTS} items`);
  }
  const recoveries = [];
  const seen = new Set();
  for (const [index, value] of source.recoveries.entries()) {
    const recovery = normalizeReconciliationRecoveryRequest(value, `${fieldName}.recoveries[${index}]`);
    if (seen.has(recovery.recovery_id)) {
      throw new Error(`${fieldName}.recoveries contains duplicate recovery_id`);
    }
    seen.add(recovery.recovery_id);
    recoveries.push(recovery);
  }
  if (dataStatus === "unavailable" && recoveries.length) {
    throw new Error(`${fieldName}.recoveries must be empty when unavailable`);
  }
  return {
    schema_version: RECONCILIATION_RECOVERY_SOURCE_SCHEMA_VERSION,
    source_id: normalizeControlPlaneIdentifier(source.source_id, `${fieldName}.source_id`, false),
    generated_at: normalizeStrategyHealthTimestamp(source.generated_at, `${fieldName}.generated_at`, true),
    computed_at: normalizeStrategyHealthTimestamp(source.computed_at, `${fieldName}.computed_at`, true),
    data_status: dataStatus,
    recoveries,
    errors: normalizeStrategyHealthErrors(source.errors),
  };
}

export function normalizeReconciliationRecoveryRequest(value, fieldName) {
  if (value?.mode === "initial_enrollment") {
    const item = assertExactFields(value, ["mode", "recovery_id", "target_id", "candidate", "facts"], fieldName);
    return {
      mode: "initial_enrollment",
      recovery_id: normalizeControlPlaneIdentifier(item.recovery_id, `${fieldName}.recovery_id`, false),
      target_id: normalizeControlPlaneIdentifier(item.target_id, `${fieldName}.target_id`, false),
      candidate: item.candidate,
      facts: item.facts,
    };
  }
  const item = assertExactFields(value, [
    "recovery_id", "platform", "strategy_profile", "environment", "reconciliation_state", "readiness",
    "candidate_sha256", "evidence_sample_count", "first_observed_at", "last_observed_at", "dual_review", "blocker_codes",
  ], fieldName);
  const dualReview = assertExactFields(item.dual_review, [
    "outcome", "reviewer_count", "evidence_binding_sha256",
  ], `${fieldName}.dual_review`);
  const evidenceSampleCount = Number(item.evidence_sample_count);
  const reviewerCount = Number(dualReview.reviewer_count);
  if (!Number.isInteger(evidenceSampleCount) || evidenceSampleCount < 0 || evidenceSampleCount > 100) {
    throw new Error(`${fieldName}.evidence_sample_count must be a bounded integer`);
  }
  if (!Number.isInteger(reviewerCount) || reviewerCount < 0 || reviewerCount > 10) {
    throw new Error(`${fieldName}.dual_review.reviewer_count must be a bounded integer`);
  }
  const firstObservedAt = normalizeResearchTaskTimestamp(item.first_observed_at, `${fieldName}.first_observed_at`);
  const lastObservedAt = normalizeResearchTaskTimestamp(item.last_observed_at, `${fieldName}.last_observed_at`);
  const observationWindowMs = Date.parse(lastObservedAt) - Date.parse(firstObservedAt);
  if (observationWindowMs < 0) {
    throw new Error(`${fieldName}.first_observed_at must not be after last_observed_at`);
  }
  if (!Array.isArray(item.blocker_codes) || item.blocker_codes.length > 20) {
    throw new Error(`${fieldName}.blocker_codes must be an array with at most 20 items`);
  }
  const blockerCodes = normalizeStrategyHealthErrors(item.blocker_codes);
  if (blockerCodes.length !== item.blocker_codes.length) {
    throw new Error(`${fieldName}.blocker_codes must be unique stable codes`);
  }
  const recovery = {
    recovery_id: normalizeControlPlaneIdentifier(item.recovery_id, `${fieldName}.recovery_id`, false),
    platform: cleanChoice(item.platform, RECONCILIATION_RECOVERY_PLATFORMS, `${fieldName}.platform`),
    strategy_profile: normalizeResearchTaskIdentity(item.strategy_profile, `${fieldName}.strategy_profile`),
    environment: cleanChoice(item.environment, RECONCILIATION_RECOVERY_ENVIRONMENTS, `${fieldName}.environment`),
    reconciliation_state: cleanChoice(
      item.reconciliation_state,
      RECONCILIATION_RECOVERY_STATES,
      `${fieldName}.reconciliation_state`,
    ),
    readiness: cleanChoice(item.readiness, RECONCILIATION_RECOVERY_READINESS, `${fieldName}.readiness`),
    candidate_sha256: normalizeResearchTaskDigest(item.candidate_sha256, `${fieldName}.candidate_sha256`),
    evidence_sample_count: evidenceSampleCount,
    first_observed_at: firstObservedAt,
    last_observed_at: lastObservedAt,
    dual_review: {
      outcome: cleanChoice(
        dualReview.outcome,
        RECONCILIATION_RECOVERY_DUAL_REVIEW_OUTCOMES,
        `${fieldName}.dual_review.outcome`,
      ),
      reviewer_count: reviewerCount,
      evidence_binding_sha256: normalizeResearchTaskDigest(
        dualReview.evidence_binding_sha256,
        `${fieldName}.dual_review.evidence_binding_sha256`,
      ),
    },
    blocker_codes: blockerCodes,
  };
  if (recovery.readiness === "awaiting_human_confirmation") {
    if (
      recovery.evidence_sample_count < 1
      || observationWindowMs > RECONCILIATION_RECOVERY_MAX_SAMPLE_WINDOW_MS
      || recovery.dual_review.evidence_binding_sha256 !== recovery.candidate_sha256
      || recovery.blocker_codes.length
    ) {
      throw new Error(`${fieldName}.readiness requires at least one observation within a 15-minute window, bound candidate, and no blockers`);
    }
  }
  return recovery;
}

export function emptyReconciliationRecoverySourceSnapshot(errorCode) {
  return {
    schema_version: RECONCILIATION_RECOVERY_SOURCE_SCHEMA_VERSION,
    source_id: "unavailable",
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    recoveries: [],
    errors: [errorCode],
  };
}

export function emptyReconciliationRecoveryPayload(errorCode) {
  return {
    schema_version: RECONCILIATION_RECOVERY_DASHBOARD_SCHEMA_VERSION,
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    summary: { recovery_count: 0, awaiting_human_confirmation: 0, blocked: 0, confirmed: 0 },
    recoveries: [],
    current_reconciliation_observation: currentReconciliationObservationPresentation(),
    policy: {
      human_confirmation_required: true,
      current_evidence_required: true,
      no_order: true,
      execution_authority_granted: false,
      notice: "恢复核验尚不可用；控制台不会推断已恢复或已启用。",
    },
    errors: [errorCode],
  };
}
