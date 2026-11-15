/**
 * M0 research ledger KV / schema / domain constants.
 * Extracted from runtime_support for Wave5 Strangler.
 */

export const M0_RESEARCH_TRANSPORT_SCHEMA_VERSION = "qsl_m0_research_publisher_envelope.v1";
export const M0_RESEARCH_LEDGER_SCHEMA_VERSION = "qsl_m0_research_ledger.v1";
export const M0_RESEARCH_DASHBOARD_SCHEMA_VERSION = "qsl_m0_research_dashboard.v1";
export const M0_RESEARCH_STORAGE_SCHEMA_VERSION = "qsl_m0_research_ledger_storage.v1";
export const M0_RESEARCH_CURRENT_KEY = "m0_research_ledger_current";
export const M0_RESEARCH_ARCHIVE_PREFIX = "m0_research_ledger_archive:";
export const M0_RESEARCH_MAX_BODY_BYTES = 256 * 1024;
export const M0_RESEARCH_RETENTION_SECONDS = 14 * 24 * 60 * 60;
export const M0_RESEARCH_ALLOWED_SOURCE_REPOSITORY = "QuantStrategyLab/QuantAdvisorResearch";
export const M0_RESEARCH_ALLOWED_PRODUCER_REPOSITORY = "QuantStrategyLab/QuantRuntimeSettings";
export const M0_RESEARCH_SUBJECT_KINDS = ["asset_idea", "theme_context", "strategy_hypothesis", "risk_context"];
export const M0_RESEARCH_HORIZONS = ["short", "medium", "long", "not_applicable"];
export const M0_RESEARCH_STATES = ["candidate", "source_verification_required", "deferred", "context_only"];
export const M0_RESEARCH_CONFIDENCE = ["high", "medium", "low", "mixed", "no_event", "unknown"];
export const M0_RESEARCH_STYLES = ["event_driven", "long_horizon_growth", "value_quality", "macro_context", "mixed_research"];
export const M0_RESEARCH_SUMMARY_FIELDS = [
  "subject_count",
  "observation_count",
  "fresh_observation_count",
  "stale_observation_count",
  "unknown_observation_count",
  "horizon_conflict_count",
  "historical_stale_horizon_drift_count",
];
