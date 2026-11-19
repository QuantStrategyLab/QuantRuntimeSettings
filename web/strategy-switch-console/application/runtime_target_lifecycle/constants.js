export const RUNTIME_TARGET_LIFECYCLE_SOURCE_PREFIX = "runtime_target_lifecycle_source:";
export const RUNTIME_TARGET_LIFECYCLE_SOURCE_SCHEMA_VERSION = "qsl_runtime_target_lifecycle_source_snapshot.v1";
export const RUNTIME_TARGET_LIFECYCLE_DASHBOARD_SCHEMA_VERSION = "qsl_runtime_target_lifecycle_dashboard.v1";
export const RUNTIME_TARGET_LIFECYCLE_MAX_SOURCES = 100;
export const RUNTIME_TARGET_LIFECYCLE_MAX_BODY_BYTES = 256 * 1024;
export const RUNTIME_TARGET_LIFECYCLE_CONFIGURED_STATES = ["enabled", "disabled"];
export const RUNTIME_TARGET_LIFECYCLE_EXECUTION_MODES = ["dry_run", "paper", "live"];
export const RUNTIME_TARGET_LIFECYCLE_CHECK_STATUSES = ["pass", "attention", "not_due", "not_applicable", "unavailable"];
export const RUNTIME_TARGET_LIFECYCLE_DISPOSITIONS = ["continue_enabled_monitoring", "continue_disabled_validation", "parked"];
export const RUNTIME_TARGET_LIFECYCLE_EXECUTION_OBSERVATIONS = ["not_due", "monitoring_only", "not_applicable", "attention", "unavailable"];
export const RUNTIME_TARGET_LIFECYCLE_REASON_CODES = [
  "none", "target_intentionally_disabled", "runtime_guard_attention", "execution_heartbeat_attention", "monitoring_unavailable",
];
