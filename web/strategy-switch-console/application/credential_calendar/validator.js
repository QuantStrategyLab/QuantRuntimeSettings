/**
 * C-SA-26 Multi-Platform Credential Calendar Validator.
 *
 * Pure leaf module under application/credential_calendar/:
 * - Enforces finite registered opaque credential_id and renewal_runbook_ref allowlists.
 * - Enforces strict typed metadata allowlist and rejects extra/free-form/secret-bearing
 *   fields or values BEFORE persistence or log emission.
 * - Rejects raw account IDs (#1220) and private storage locators.
 */

import { PRIVATE_LOCATOR_KEYS } from "../naming_canonical/constants.js";
import {
  isRawAccountIdentifier,
  isUnsafePrivateLocator,
  isValidPlatformSlug,
  parseAccountSlotKey,
} from "../naming_canonical/helpers.js";
import {
  CREDENTIAL_APPLICABILITY_SET,
  CREDENTIAL_CALENDAR_PROJECTION_VERSION,
  CREDENTIAL_ENVIRONMENT_SET,
  CREDENTIAL_EVIDENCE_SOURCE_SET,
  CREDENTIAL_TYPE_SET,
  getRegisteredCredential,
  isRegisteredRunbookRef,
  REGISTERED_RUNBOOK_REFS,
  SUPPRESSION_REASON_SET,
} from "./registry.js";

const ISO_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/;
const ATTESTATION_VERSION_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "credential_id",
  "platform",
  "credential_type",
  "environment",
  "account_slot",
  "renewal_runbook_ref",
  "applicability",
  "suppression_reason",
  "expires_at",
  "observed_at",
  "evaluated_at",
  "evidence_source",
  "attestation_version",
  "metadata_revision",
  "typed_metadata",
]);

const REQUIRED_TOP_LEVEL_KEYS = [
  "credential_id",
  "platform",
  "credential_type",
  "environment",
  "account_slot",
  "renewal_runbook_ref",
  "applicability",
  "expires_at",
  "observed_at",
  "evaluated_at",
  "evidence_source",
];

const ALLOWED_TYPED_METADATA_KEYS = new Set([
  "token_ttl_days",
  "rotation_count",
  "supports_auto_refresh",
  "dormant",
  "last_rotated_at",
  "platform_verified_at",
]);

const FORBIDDEN_KEY_RE = /(?:^|_)(?:token|secret|cookie|password|passwd|private_key|api_key|access_token|refresh_token|client_secret|authorization|bearer|session_id|signature|credential_value|flex_token|hmac|jwt|passphrase|note|notes|comment|comments|memo|description|free_form|raw_payload|extra|debug|trace)(?:$|_)/i;
const SECRET_VALUE_RE = /(?:-----BEGIN|Bearer\s+|Basic\s+|^(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+|^gh[pou]_[A-Za-z0-9]{12,}|^glpat-[A-Za-z0-9_-]{12,}|^xox[baprs]-[A-Za-z0-9-]{10,}|^AKIA[0-9A-Z]{16}|^eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}|(?:api_key|access_token|refresh_token|secret|password|cookie)\s*=)/i;

export class CredentialValidationError extends Error {
  constructor(code, message = code, status = 400) {
    super(message);
    this.name = "CredentialValidationError";
    this.code = code;
    this.status = status;
  }
}

export function parseStrictUtcTimestampMs(value, fieldName = "timestamp", { allowNull = false } = {}) {
  if (value === null) {
    if (allowNull) return null;
    throw new CredentialValidationError("invalid_timestamp", `${fieldName}_must_not_be_null`);
  }
  if (typeof value !== "string") {
    throw new CredentialValidationError("invalid_timestamp", `${fieldName}_must_be_iso_string`);
  }
  if (isUnsafePrivateLocator(value) || SECRET_VALUE_RE.test(value)) {
    throw new CredentialValidationError("secret_or_locator_rejected", `${fieldName}_unsafe_value`);
  }
  const match = ISO_INSTANT_RE.exec(value);
  if (!match) {
    throw new CredentialValidationError("invalid_timestamp", `${fieldName}_invalid_iso_format`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1970 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    throw new CredentialValidationError("invalid_timestamp", `${fieldName}_out_of_range`);
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    throw new CredentialValidationError("invalid_timestamp", `${fieldName}_invalid_calendar_day`);
  }
  if (match[8] !== "Z") {
    const offH = Number(match[9]);
    const offM = Number(match[10]);
    if (offH > 23 || offM > 59) {
      throw new CredentialValidationError("invalid_timestamp", `${fieldName}_invalid_timezone_offset`);
    }
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new CredentialValidationError("invalid_timestamp", `${fieldName}_unparseable`);
  }
  return { ms, iso: new Date(ms).toISOString() };
}

function scanObjectKeysAndStringsForbidden(node, depth = 0, timestampKeys = new Set(), allowedKeys = ALLOWED_TOP_LEVEL_KEYS) {
  if (depth > 4) {
    throw new CredentialValidationError("nested_payload_rejected", "excessive_nesting");
  }
  if (node === null || node === undefined) return;
  if (typeof node === "string") {
    if (SECRET_VALUE_RE.test(node) || isUnsafePrivateLocator(node)) {
      throw new CredentialValidationError("secret_or_locator_rejected", "forbidden_secret_or_locator_value");
    }
    return;
  }
  if (Array.isArray(node)) {
    throw new CredentialValidationError("free_form_array_rejected", "arrays_not_permitted_in_credential_record");
  }
  if (typeof node !== "object") return;

  for (const key of Object.keys(node)) {
    const isAllowlisted = allowedKeys && allowedKeys.has(key);
    if (!isAllowlisted && (PRIVATE_LOCATOR_KEYS.has(key) || FORBIDDEN_KEY_RE.test(key))) {
      throw new CredentialValidationError("secret_or_forbidden_key_rejected", `forbidden_key:${key}`);
    }
    const val = node[key];
    if (typeof val === "string") {
      if (SECRET_VALUE_RE.test(val) || isUnsafePrivateLocator(val)) {
        throw new CredentialValidationError("secret_or_locator_rejected", `unsafe_value_in_${key}`);
      }
      if (!timestampKeys.has(key) && isRawAccountIdentifier(val)) {
        throw new CredentialValidationError("raw_account_id_rejected", `raw_account_id_in_${key}`);
      }
    } else if (val && typeof val === "object") {
      const childAllowed = key === "typed_metadata" ? ALLOWED_TYPED_METADATA_KEYS : null;
      scanObjectKeysAndStringsForbidden(val, depth + 1, timestampKeys, childAllowed);
    }
  }
}

function validateTypedMetadata(rawMeta, evidenceSource, registeredEntry) {
  if (rawMeta === undefined) {
    return {};
  }
  if (!rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) {
    throw new CredentialValidationError("invalid_typed_metadata", "typed_metadata_must_be_object");
  }
  for (const key of Object.keys(rawMeta)) {
    if (!ALLOWED_TYPED_METADATA_KEYS.has(key)) {
      throw new CredentialValidationError("unexpected_typed_metadata_field", `unexpected_typed_metadata_field:${key}`);
    }
  }

  const out = {};
  if (Object.hasOwn(rawMeta, "token_ttl_days") && rawMeta.token_ttl_days !== null) {
    if (!Number.isSafeInteger(rawMeta.token_ttl_days) || rawMeta.token_ttl_days < 1 || rawMeta.token_ttl_days > 3650) {
      throw new CredentialValidationError("invalid_typed_metadata", "invalid_token_ttl_days");
    }
    if (
      registeredEntry.credential_type === "longbridge_paper_access_token_90d"
      && rawMeta.token_ttl_days !== 90
    ) {
      throw new CredentialValidationError("invalid_typed_metadata", "longbridge_paper_token_ttl_must_be_90");
    }
    out.token_ttl_days = rawMeta.token_ttl_days;
  }
  if (Object.hasOwn(rawMeta, "rotation_count") && rawMeta.rotation_count !== null) {
    if (!Number.isSafeInteger(rawMeta.rotation_count) || rawMeta.rotation_count < 0) {
      throw new CredentialValidationError("invalid_typed_metadata", "invalid_rotation_count");
    }
    out.rotation_count = rawMeta.rotation_count;
  }
  if (Object.hasOwn(rawMeta, "supports_auto_refresh") && rawMeta.supports_auto_refresh !== null) {
    if (typeof rawMeta.supports_auto_refresh !== "boolean") {
      throw new CredentialValidationError("invalid_typed_metadata", "supports_auto_refresh_must_be_boolean");
    }
    out.supports_auto_refresh = rawMeta.supports_auto_refresh;
  }
  if (Object.hasOwn(rawMeta, "dormant") && rawMeta.dormant !== null) {
    if (typeof rawMeta.dormant !== "boolean") {
      throw new CredentialValidationError("invalid_typed_metadata", "dormant_must_be_boolean");
    }
    out.dormant = rawMeta.dormant;
  }
  if (Object.hasOwn(rawMeta, "last_rotated_at")) {
    const parsed = parseStrictUtcTimestampMs(rawMeta.last_rotated_at, "last_rotated_at", { allowNull: true });
    out.last_rotated_at = parsed ? parsed.iso : null;
  }
  if (Object.hasOwn(rawMeta, "platform_verified_at")) {
    const parsed = parseStrictUtcTimestampMs(rawMeta.platform_verified_at, "platform_verified_at", { allowNull: true });
    if (parsed !== null && evidenceSource !== "platform_metadata") {
      throw new CredentialValidationError(
        "evidence_source_upgrade_prohibited",
        "cannot_set_platform_verified_at_without_platform_metadata",
      );
    }
    out.platform_verified_at = parsed ? parsed.iso : null;
  }
  return out;
}

/**
 * Validates and normalizes an input credential calendar record against C-SA-26 guards.
 * Throws CredentialValidationError on any unregistered ID, extra field, free-form text,
 * raw account ID, private locator, or secret-bearing payload.
 */
export function validateCredentialRecord(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CredentialValidationError("invalid_credential_record", "credential_record_must_be_object");
  }

  const timestampKeys = new Set(["expires_at", "observed_at", "evaluated_at", "last_rotated_at", "platform_verified_at"]);
  scanObjectKeysAndStringsForbidden(input, 0, timestampKeys);

  for (const key of Object.keys(input)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      throw new CredentialValidationError("unexpected_field", `unexpected_field:${key}`);
    }
  }
  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!Object.hasOwn(input, key)) {
      throw new CredentialValidationError("missing_required_field", `missing_required_field:${key}`);
    }
  }

  const registered = getRegisteredCredential(input.credential_id);
  if (!registered) {
    throw new CredentialValidationError("unregistered_credential_id", `unregistered_credential_id:${String(input.credential_id)}`);
  }

  if (!isValidPlatformSlug(input.platform) || input.platform !== registered.platform) {
    throw new CredentialValidationError("invalid_platform", `platform_mismatch:${String(input.platform)}`);
  }
  if (
    typeof input.credential_type !== "string"
    || !CREDENTIAL_TYPE_SET.has(input.credential_type)
    || input.credential_type !== registered.credential_type
  ) {
    throw new CredentialValidationError("invalid_credential_type", `credential_type_mismatch:${String(input.credential_type)}`);
  }
  if (typeof input.environment !== "string" || !CREDENTIAL_ENVIRONMENT_SET.has(input.environment)) {
    throw new CredentialValidationError("invalid_environment", `invalid_environment:${String(input.environment)}`);
  }

  const parsedSlot = parseAccountSlotKey(input.account_slot);
  if (!parsedSlot.ok || parsedSlot.platform !== input.platform || input.account_slot !== registered.account_slot) {
    throw new CredentialValidationError("invalid_account_slot", `account_slot_mismatch:${String(input.account_slot)}`);
  }

  if (!isRegisteredRunbookRef(input.renewal_runbook_ref)) {
    throw new CredentialValidationError("unregistered_runbook_ref", `unregistered_runbook_ref:${String(input.renewal_runbook_ref)}`);
  }
  const rbMeta = REGISTERED_RUNBOOK_REFS[input.renewal_runbook_ref];
  if (
    rbMeta.platform !== input.platform
    || rbMeta.credential_type !== input.credential_type
    || input.renewal_runbook_ref !== registered.renewal_runbook_ref
  ) {
    throw new CredentialValidationError("runbook_ref_mismatch", "runbook_ref_tuple_mismatch");
  }

  if (typeof input.applicability !== "string" || !CREDENTIAL_APPLICABILITY_SET.has(input.applicability)) {
    throw new CredentialValidationError("invalid_applicability", `invalid_applicability:${String(input.applicability)}`);
  }

  let suppressionReason = null;
  if (Object.hasOwn(input, "suppression_reason") && input.suppression_reason !== null) {
    if (typeof input.suppression_reason !== "string" || !SUPPRESSION_REASON_SET.has(input.suppression_reason)) {
      throw new CredentialValidationError("invalid_suppression_reason", `unregistered_suppression_reason:${String(input.suppression_reason)}`);
    }
    suppressionReason = input.suppression_reason;
  }

  if (typeof input.evidence_source !== "string" || !CREDENTIAL_EVIDENCE_SOURCE_SET.has(input.evidence_source)) {
    throw new CredentialValidationError("invalid_evidence_source", `invalid_evidence_source:${String(input.evidence_source)}`);
  }

  const evaluated = parseStrictUtcTimestampMs(options.evaluated_at ?? input.evaluated_at, "evaluated_at", { allowNull: false });
  const expires = parseStrictUtcTimestampMs(input.expires_at, "expires_at", { allowNull: true });
  const observed = parseStrictUtcTimestampMs(input.observed_at, "observed_at", { allowNull: true });

  if (input.evidence_source === "unobserved" && observed !== null) {
    throw new CredentialValidationError("invalid_observation_for_unobserved", "unobserved_evidence_must_have_null_observed_at");
  }
  if (input.evidence_source !== "unobserved" && observed === null && input.applicability === "applicable" && expires !== null) {
    throw new CredentialValidationError("missing_observed_at", "evidenced_expiry_requires_observed_at");
  }

  const attestationVersion = input.attestation_version ?? CREDENTIAL_CALENDAR_PROJECTION_VERSION;
  if (typeof attestationVersion !== "string" || !ATTESTATION_VERSION_RE.test(attestationVersion)) {
    throw new CredentialValidationError("invalid_attestation_version", "invalid_attestation_version");
  }

  const metadataRevision = input.metadata_revision ?? 0;
  if (!Number.isSafeInteger(metadataRevision) || metadataRevision < 0) {
    throw new CredentialValidationError("invalid_metadata_revision", "metadata_revision_must_be_non_negative_integer");
  }

  const typedMetadata = validateTypedMetadata(input.typed_metadata, input.evidence_source, registered);

  return {
    credential_id: input.credential_id,
    platform: input.platform,
    credential_type: input.credential_type,
    environment: input.environment,
    account_slot: input.account_slot,
    renewal_runbook_ref: input.renewal_runbook_ref,
    applicability: input.applicability,
    suppression_reason: suppressionReason,
    expires_at: expires ? expires.iso : null,
    expires_ms: expires ? expires.ms : null,
    observed_at: observed ? observed.iso : null,
    observed_ms: observed ? observed.ms : null,
    evaluated_at: evaluated.iso,
    evaluated_ms: evaluated.ms,
    evidence_source: input.evidence_source,
    attestation_version: attestationVersion,
    metadata_revision: metadataRevision,
    typed_metadata: typedMetadata,
  };
}
