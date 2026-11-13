/**
 * Control-plane snapshot / source / retirement constants.
 * Extracted from runtime_support for Wave5 Strangler.
 */

import { PLATFORM_CONFIG } from "../../config.js";

export const CONTROL_PLANE_SNAPSHOT_KEY = "control_plane_snapshot";
export const CONTROL_PLANE_SOURCE_PREFIX = "control_plane_source:";
export const CONTROL_PLANE_SOURCE_SCHEMA_VERSION = "qsl_control_plane_source_snapshot.v1";
export const CONTROL_PLANE_SOURCE_RETIREMENTS_KEY = "control_plane_source_retirements";
export const CONTROL_PLANE_ATTENTION_STATUSES = ["research_only", "attention_required", "unavailable"];
export const CONTROL_PLANE_MAX_SOURCES = 100;
export const CONTROL_PLANE_MAX_BODY_BYTES = 256 * 1024;
// The current source is a once-per-trading-day P1/P3 lane, rather than a live
// execution heartbeat. Freshness therefore preserves the normal TTL, but also
// waits for the next scheduled research window across the weekend before it
// calls an otherwise usable Friday/Saturday snapshot stale.
export const CONTROL_PLANE_DEFAULT_STALE_TTL_SECONDS = 36 * 60 * 60;
export const CONTROL_PLANE_RESEARCH_SCHEDULE_UTC_DAYS = new Set([2, 3, 4, 5, 6]);
export const CONTROL_PLANE_RESEARCH_SCHEDULE_UTC_HOUR = 3;
export const CONTROL_PLANE_RESEARCH_DELIVERY_GRACE_MS = 4 * 60 * 60 * 1000;
export const CONTROL_PLANE_CANDIDATE_KINDS = ["individual", "portfolio", "plugin"];
export const CONTROL_PLANE_STAGES = ["P1", "P2", "P3", "P4", "P5", "P6"];
export const CONTROL_PLANE_LIFECYCLE_STATUSES = [
  "research", "evidence_pending", "verified", "deferred", "parked", "paper", "shadow", "owner_decision_required",
];
export const CONTROL_PLANE_RECOMMENDATIONS = [
  "none", "keep_research", "defer", "park", "auto_paper_evaluation", "auto_shadow_evaluation", "owner_live_decision",
];
export const CONTROL_PLANE_AUTOMATION_STATES = ["not_configured", "configured", "active"];
export const FORWARD_OBSERVATION_STATES = [
  "PARKED", "FORWARD_ACTIVE", "PAUSED", "FORWARD_COMPLETE_HUMAN_REVIEW", "MANUAL_HOLD", "IDENTITY_MISMATCH", "RISK_BLOCKED", "REVOKED", "SUPERSEDED",
];
export const FORWARD_OBSERVATION_RESEARCH_STAGES = new Set(["P1", "P2", "P3", "P4"]);

// Same domain set strategy_health uses; derived once from platform config.
export const CONTROL_PLANE_DOMAINS = Object.freeze([
  ...new Set(Object.values(PLATFORM_CONFIG).flatMap((platform) => platform.supported_domains || [])),
]);
export const CONTROL_PLANE_DATA_STATUSES = ["ready", "unavailable", "stale"];
