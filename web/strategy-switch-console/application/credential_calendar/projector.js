/**
 * C-SA-26 Multi-Platform Credential Calendar Projector.
 *
 * Pure leaf module under application/credential_calendar/:
 * - Evaluates exact UTC millisecond thresholds (<= 0 -> expired, 7d, 14d, 30d, > 30d).
 * - Flags unknown (undetermined or missing/unobserved expiry on applicable credentials)
 *   as requires_action = true & investigation_required = true.
 * - Suppresses reminders ONLY for evidenced not_applicable / unsupported records with
 *   explicit suppression_reason while keeping unsupported coverage visible.
 * - Never upgrades operator_declared evidence to platform verification.
 */

import {
  CANONICAL_CREDENTIAL_PLATFORMS,
  CREDENTIAL_CALENDAR_PROJECTION_VERSION,
  CREDENTIAL_CALENDAR_SCHEMA,
} from "./registry.js";
import { parseStrictUtcTimestampMs, validateCredentialRecord } from "./validator.js";

export const DAY_MS = 86_400_000;
export const BAND_7D_MS = 7 * DAY_MS;
export const BAND_14D_MS = 14 * DAY_MS;
export const BAND_30D_MS = 30 * DAY_MS;

export function classifyUtcRemainingPhase(remainingMs) {
  if (typeof remainingMs !== "number" || !Number.isFinite(remainingMs)) {
    return "unknown";
  }
  if (remainingMs <= 0) return "expired";
  if (remainingMs <= BAND_7D_MS) return "due_7d";
  if (remainingMs <= BAND_14D_MS) return "due_14d";
  if (remainingMs <= BAND_30D_MS) return "due_30d";
  return "not_due";
}

/**
 * Validates and projects a single C-SA-26 credential record against exact UTC evaluated_at.
 */
export function projectCredentialRecord(rawRecord, options = {}) {
  const rec = validateCredentialRecord(rawRecord, options);
  const platformVerified = rec.evidence_source === "platform_metadata";

  const base = {
    credential_id: rec.credential_id,
    platform: rec.platform,
    credential_type: rec.credential_type,
    environment: rec.environment,
    account_slot: rec.account_slot,
    renewal_runbook_ref: rec.renewal_runbook_ref,
    applicability: rec.applicability,
    evidence_source: rec.evidence_source,
    platform_verified: platformVerified,
    observed_at: rec.observed_at,
    evaluated_at: rec.evaluated_at,
    expires_at: rec.expires_at,
    attestation_version: rec.attestation_version,
    metadata_revision: rec.metadata_revision,
    typed_metadata: rec.typed_metadata,
  };

  if (rec.applicability === "not_applicable" || rec.applicability === "unsupported") {
    const evidenced = rec.evidence_source !== "unobserved" && rec.suppression_reason !== null;
    if (evidenced) {
      return {
        ...base,
        phase: rec.applicability,
        remaining_ms: null,
        days_remaining: null,
        requires_action: false,
        investigation_required: false,
        reminder_suppressed: true,
        suppression_reason: rec.suppression_reason,
        unsupported_visible: rec.applicability === "unsupported",
        status_reason: rec.suppression_reason,
      };
    }
    return {
      ...base,
      phase: "unknown",
      remaining_ms: null,
      days_remaining: null,
      requires_action: true,
      investigation_required: true,
      reminder_suppressed: false,
      suppression_reason: null,
      unsupported_visible: rec.applicability === "unsupported",
      status_reason: rec.suppression_reason === null ? "missing_suppression_reason" : "unevidenced_suppression",
    };
  }

  if (rec.applicability === "undetermined" || rec.expires_ms === null || rec.evidence_source === "unobserved") {
    const statusReason = rec.applicability === "undetermined"
      ? "applicability_undetermined"
      : rec.evidence_source === "unobserved"
      ? "unobserved_credential"
      : "missing_expiry";
    return {
      ...base,
      phase: "unknown",
      remaining_ms: null,
      days_remaining: null,
      requires_action: true,
      investigation_required: true,
      reminder_suppressed: false,
      suppression_reason: null,
      unsupported_visible: false,
      status_reason: statusReason,
    };
  }

  const remainingMs = rec.expires_ms - rec.evaluated_ms;
  const phase = classifyUtcRemainingPhase(remainingMs);
  const daysRemaining = remainingMs <= 0 ? 0 : Math.ceil(remainingMs / DAY_MS);
  const requiresAction = phase !== "not_due";

  return {
    ...base,
    phase,
    remaining_ms: remainingMs,
    days_remaining: daysRemaining,
    requires_action: requiresAction,
    investigation_required: false,
    reminder_suppressed: false,
    suppression_reason: null,
    unsupported_visible: false,
    status_reason: phase === "not_due" ? "within_validity_window" : `credential_${phase}`,
  };
}

/**
 * Projects a validated multi-platform credential collection into versioned qsl.credential_calendar.v1.
 */
export function projectCredentialCalendar(rawRecords, options = {}) {
  if (!Array.isArray(rawRecords)) {
    throw new TypeError("credential records must be an array");
  }
  const evaluatedAtParsed = options.evaluated_at !== undefined
    ? parseStrictUtcTimestampMs(options.evaluated_at, "evaluated_at", { allowNull: false })
    : null;
  const evaluatedAtIso = evaluatedAtParsed
    ? evaluatedAtParsed.iso
    : rawRecords.length > 0 && typeof rawRecords[0]?.evaluated_at === "string"
    ? parseStrictUtcTimestampMs(rawRecords[0].evaluated_at, "evaluated_at", { allowNull: false }).iso
    : new Date().toISOString();

  const projected = rawRecords.map((rec) =>
    projectCredentialRecord(rec, { evaluated_at: evaluatedAtIso }),
  );

  const counts = {
    total: projected.length,
    expired: 0,
    due_7d: 0,
    due_14d: 0,
    due_30d: 0,
    not_due: 0,
    unknown: 0,
    not_applicable: 0,
    unsupported: 0,
    action_required: 0,
    investigation_required: 0,
  };
  const presentPlatforms = new Set();
  for (const row of projected) {
    counts[row.phase] += 1;
    if (row.requires_action) counts.action_required += 1;
    if (row.investigation_required) counts.investigation_required += 1;
    presentPlatforms.add(row.platform);
  }

  return {
    schema_version: CREDENTIAL_CALENDAR_SCHEMA,
    projection_version: CREDENTIAL_CALENDAR_PROJECTION_VERSION,
    evaluated_at: evaluatedAtIso,
    platforms_supported: [...CANONICAL_CREDENTIAL_PLATFORMS],
    platforms_present: CANONICAL_CREDENTIAL_PLATFORMS.filter((p) => presentPlatforms.has(p)),
    counts,
    records: projected,
  };
}
