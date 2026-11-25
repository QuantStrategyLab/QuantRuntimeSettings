/**
 * C-SA-26 Multi-Platform Credential Calendar Registry.
 *
 * Pure zero-external-side-effect leaf module under application/credential_calendar/:
 * - Imports only inward from application/naming_canonical/.
 * - Defines the closed 5-platform universe (#1220), finite opaque credential_id
 *   allowlist, finite opaque renewal_runbook_ref allowlist, and closed suppression
 *   reasons. Contains ZERO raw account IDs, ZERO secrets, and ZERO private locators.
 */

import {
  CANONICAL_PLATFORM_SLUGS,
  PLATFORM_SLUG_SET,
} from "../naming_canonical/constants.js";
import {
  isRawAccountIdentifier,
  isUnsafePrivateLocator,
  isValidPlatformSlug,
  parseAccountSlotKey,
} from "../naming_canonical/helpers.js";

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return Object.freeze(value);
}

export const CREDENTIAL_CALENDAR_SCHEMA = "qsl.credential_calendar.v1";
export const CREDENTIAL_CALENDAR_PROJECTION_VERSION = "c-sa-26-v1";

export const CANONICAL_CREDENTIAL_PLATFORMS = CANONICAL_PLATFORM_SLUGS;
export const CREDENTIAL_PLATFORM_SET = PLATFORM_SLUG_SET;

export const CREDENTIAL_ENVIRONMENTS = Object.freeze(["paper", "live", "read_only"]);
export const CREDENTIAL_ENVIRONMENT_SET = new Set(CREDENTIAL_ENVIRONMENTS);

export const CREDENTIAL_TYPES = Object.freeze([
  "ibkr_flex_token",
  "longbridge_paper_access_token_90d",
  "longbridge_live_access_token",
  "schwab_oauth_refresh_token",
  "binance_api_key_dormant",
  "firstrade_session_credential",
]);
export const CREDENTIAL_TYPE_SET = new Set(CREDENTIAL_TYPES);

export const CREDENTIAL_APPLICABILITIES = Object.freeze([
  "applicable",
  "not_applicable",
  "unsupported",
  "undetermined",
]);
export const CREDENTIAL_APPLICABILITY_SET = new Set(CREDENTIAL_APPLICABILITIES);

export const CREDENTIAL_EVIDENCE_SOURCES = Object.freeze([
  "operator_declared",
  "platform_metadata",
  "unobserved",
]);
export const CREDENTIAL_EVIDENCE_SOURCE_SET = new Set(CREDENTIAL_EVIDENCE_SOURCES);

export const CREDENTIAL_PHASES = Object.freeze([
  "expired",
  "due_7d",
  "due_14d",
  "due_30d",
  "not_due",
  "unknown",
  "not_applicable",
  "unsupported",
]);

export const SUPPRESSION_REASONS = Object.freeze([
  "platform_dormant_under_v2",
  "no_automated_credential_api",
  "environment_disabled",
  "feature_not_provisioned",
]);
export const SUPPRESSION_REASON_SET = new Set(SUPPRESSION_REASONS);

export const REGISTERED_RUNBOOK_REFS = deepFreeze({
  "runbook:cred:ibkr-flex-token:v1": {
    platform: "ibkr",
    credential_type: "ibkr_flex_token",
  },
  "runbook:cred:longbridge-paper-token-90d:v1": {
    platform: "longbridge",
    credential_type: "longbridge_paper_access_token_90d",
  },
  "runbook:cred:longbridge-live-token:v1": {
    platform: "longbridge",
    credential_type: "longbridge_live_access_token",
  },
  "runbook:cred:schwab-oauth-refresh:v1": {
    platform: "schwab",
    credential_type: "schwab_oauth_refresh_token",
  },
  "runbook:cred:binance-dormant-review:v1": {
    platform: "binance",
    credential_type: "binance_api_key_dormant",
  },
  "runbook:cred:firstrade-manual-review:v1": {
    platform: "firstrade",
    credential_type: "firstrade_session_credential",
  },
});

export const REGISTERED_CREDENTIALS = deepFreeze({
  cred_ibkr_flex_live_a1: {
    credential_id: "cred_ibkr_flex_live_a1",
    platform: "ibkr",
    credential_type: "ibkr_flex_token",
    default_environment: "read_only",
    account_slot: "ibkr:live:a1",
    renewal_runbook_ref: "runbook:cred:ibkr-flex-token:v1",
    expected_ttl_days: 365,
  },
  cred_longbridge_paper_pilot_90d: {
    credential_id: "cred_longbridge_paper_pilot_90d",
    platform: "longbridge",
    credential_type: "longbridge_paper_access_token_90d",
    default_environment: "paper",
    account_slot: "longbridge:paper:pilot",
    renewal_runbook_ref: "runbook:cred:longbridge-paper-token-90d:v1",
    expected_ttl_days: 90,
  },
  cred_longbridge_live_sg: {
    credential_id: "cred_longbridge_live_sg",
    platform: "longbridge",
    credential_type: "longbridge_live_access_token",
    default_environment: "live",
    account_slot: "longbridge:live:sg",
    renewal_runbook_ref: "runbook:cred:longbridge-live-token:v1",
    expected_ttl_days: 90,
  },
  cred_schwab_live_main: {
    credential_id: "cred_schwab_live_main",
    platform: "schwab",
    credential_type: "schwab_oauth_refresh_token",
    default_environment: "live",
    account_slot: "schwab:live:main",
    renewal_runbook_ref: "runbook:cred:schwab-oauth-refresh:v1",
    expected_ttl_days: 7,
  },
  cred_binance_live_dormant: {
    credential_id: "cred_binance_live_dormant",
    platform: "binance",
    credential_type: "binance_api_key_dormant",
    default_environment: "live",
    account_slot: "binance:live:dormant",
    renewal_runbook_ref: "runbook:cred:binance-dormant-review:v1",
    expected_ttl_days: null,
  },
  cred_firstrade_live_main: {
    credential_id: "cred_firstrade_live_main",
    platform: "firstrade",
    credential_type: "firstrade_session_credential",
    default_environment: "live",
    account_slot: "firstrade:live:main",
    renewal_runbook_ref: "runbook:cred:firstrade-manual-review:v1",
    expected_ttl_days: null,
  },
});

export function getRegisteredCredential(credentialId) {
  if (typeof credentialId !== "string" || !Object.hasOwn(REGISTERED_CREDENTIALS, credentialId)) {
    return null;
  }
  return REGISTERED_CREDENTIALS[credentialId];
}

export function isRegisteredCredentialId(credentialId) {
  return getRegisteredCredential(credentialId) !== null;
}

export function isRegisteredRunbookRef(ref) {
  return typeof ref === "string" && Object.hasOwn(REGISTERED_RUNBOOK_REFS, ref);
}

export function verifyRegistrySelfConsistency() {
  for (const [id, entry] of Object.entries(REGISTERED_CREDENTIALS)) {
    if (isRawAccountIdentifier(id) || isUnsafePrivateLocator(id)) return false;
    if (!isValidPlatformSlug(entry.platform)) return false;
    if (!CREDENTIAL_TYPE_SET.has(entry.credential_type)) return false;
    if (!CREDENTIAL_ENVIRONMENT_SET.has(entry.default_environment)) return false;
    const slot = parseAccountSlotKey(entry.account_slot);
    if (!slot.ok || slot.platform !== entry.platform) return false;
    if (!isRegisteredRunbookRef(entry.renewal_runbook_ref)) return false;
    const rb = REGISTERED_RUNBOOK_REFS[entry.renewal_runbook_ref];
    if (rb.platform !== entry.platform || rb.credential_type !== entry.credential_type) return false;
  }
  return true;
}
