import { OBSERVABILITY_PLATFORM_IDS } from "../../platform_registry.js";

export const EXECUTION_EVIDENCE_SOURCE_PREFIX = "execution_evidence_source:";
export const EXECUTION_EVIDENCE_SOURCE_SCHEMA_VERSION = "qsl_execution_evidence_source_snapshot.v1";
export const EXECUTION_EVIDENCE_DASHBOARD_SCHEMA_VERSION = "qsl_execution_evidence_dashboard.v1";
export const EXECUTION_EVIDENCE_MAX_SOURCES = 100;
export const EXECUTION_EVIDENCE_MAX_BODY_BYTES = 256 * 1024;
export const EXECUTION_EVIDENCE_DEFAULT_STALE_TTL_SECONDS = 36 * 60 * 60;
export const EXECUTION_EVIDENCE_PLATFORMS = OBSERVABILITY_PLATFORM_IDS;
export const EXECUTION_EVIDENCE_ENVIRONMENTS = ["shadow", "paper", "live"];
export const EXECUTION_EVIDENCE_CAPABILITIES = ["available", "unavailable", "unknown"];
export const EXECUTION_EVIDENCE_STATUSES = ["verified", "pending", "unavailable", "not_applicable"];
export const EXECUTION_RECEIPT_OUTCOMES = [
  "not_due", "no_action", "no_signal", "no_rebalance", "risk_blocked",
  "submitted", "broker_acknowledged", "partially_filled", "filled", "reconciliation_required", "failed",
];
export const EXECUTION_RECEIPT_CONFIRMATIONS = [
  "not_applicable", "not_observed", "acknowledged", "partially_filled", "filled", "reconciliation_required",
];
export const EXECUTION_EVIDENCE_RECOMMENDATIONS = [
  "continue_autonomous_shadow", "run_autonomous_paper", "owner_limited_live_canary_decision", "parked",
];
export const EXECUTION_EVIDENCE_REASON_CODES = [
  "none", "target_execution_evidence_missing", "paper_not_supported", "paper_execution_evidence_needed",
  "policy_not_active", "source_stale", "manual_live_decision_required", "target_execution_receipt_observed",
  "target_execution_reconciliation_required", "target_execution_receipt_failed",
];

export const ALLOWED_RECEIPT_CONFIRMATIONS = {
  not_due: ["not_applicable"],
  no_action: ["not_applicable"],
  no_signal: ["not_applicable"],
  no_rebalance: ["not_applicable"],
  risk_blocked: ["not_applicable"],
  submitted: ["not_observed"],
  broker_acknowledged: ["acknowledged"],
  partially_filled: ["partially_filled"],
  filled: ["filled"],
  reconciliation_required: ["reconciliation_required"],
  failed: ["not_applicable", "not_observed", "reconciliation_required"],
};
