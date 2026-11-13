/**
 * Reconciliation-recovery KV / schema / bound constants.
 * Extracted from runtime_support for Wave5 Strangler.
 */

import { OBSERVABILITY_PLATFORM_IDS } from "../../platform_registry.js";

export const RECONCILIATION_RECOVERY_SOURCE_PREFIX = "reconciliation_recovery_source:";
export const RECONCILIATION_RECOVERY_CONFIRMATION_PREFIX = "reconciliation_recovery_confirmation:";
export const RECONCILIATION_RECOVERY_CURRENT_PREFIX = "reconciliation_recovery_current:";
export const RECONCILIATION_RECOVERY_SOURCE_SCHEMA_VERSION = "qsl_reconciliation_recovery_source_snapshot.v1";
export const RECONCILIATION_RECOVERY_DASHBOARD_SCHEMA_VERSION = "qsl_reconciliation_recovery_dashboard.v1";
export const RECONCILIATION_RECOVERY_CONFIRMATION_SCHEMA_VERSION = "qsl_reconciliation_recovery_confirmation.v1";
export const RECONCILIATION_RECOVERY_CONTROLLER_READ_SCHEMA_VERSION = "qsl_reconciliation_recovery_controller_read.v1";
export const RECONCILIATION_RECOVERY_MAX_SOURCES = 100;
export const RECONCILIATION_RECOVERY_MAX_BODY_BYTES = 128 * 1024;
export const RECONCILIATION_RECOVERY_DEFAULT_STALE_TTL_SECONDS = 30 * 60;
export const RECONCILIATION_RECOVERY_MAX_SAMPLE_WINDOW_MS = 15 * 60 * 1000;
export const RECONCILIATION_RECOVERY_PLATFORMS = OBSERVABILITY_PLATFORM_IDS;
export const RECONCILIATION_RECOVERY_ENVIRONMENTS = ["live"];
export const RECONCILIATION_RECOVERY_STATES = ["RECONCILE_ONLY"];
export const RECONCILIATION_RECOVERY_READINESS = ["blocked", "awaiting_human_confirmation"];
export const RECONCILIATION_RECOVERY_DUAL_REVIEW_OUTCOMES = ["approved", "rejected", "unavailable"];
export const RECONCILIATION_RECOVERY_MAX_REQUESTS = 100;
export const RECONCILIATION_RECOVERY_DATA_STATUSES = ["ready", "unavailable", "stale"];
