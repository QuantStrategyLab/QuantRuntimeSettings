/**
 * Owner-decision intent / queue constants.
 * Extracted from runtime_support for Wave5 Strangler.
 */

// Owner decisions are recorded as no-order intent only — never an
// execution permit. They remain separate from workflow dispatch credentials,
// broker credentials, and any future deterministic execution gateway.
export const OWNER_DECISION_INTENT_PREFIX = "owner_decision_intent:";
export const OWNER_DECISION_CURRENT_PREFIX = "owner_decision_current:";
export const OWNER_DECISION_INTENT_SCHEMA_VERSION = "qsl_owner_decision_intent.v1";
export const OWNER_DECISION_QUEUE_SCHEMA_VERSION = "qsl_owner_decision_queue.v1";
export const OWNER_DECISION_CHOICES = Object.freeze([
  "approve_limited_live_canary",
  "keep_parked",
  "retire_candidate",
]);
export const OWNER_DECISION_MAX_CANDIDATES = 100;
