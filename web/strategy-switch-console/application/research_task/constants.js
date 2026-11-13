/**
 * Research-task source / dashboard constants.
 * Extracted from runtime_support for Wave5 Strangler.
 */

// Research tasks are a separate, immutable and no-order index.  They do not
// share storage or a sync credential with candidate lifecycle snapshots.
export const RESEARCH_TASK_SOURCE_PREFIX = "research_task_source:";
export const RESEARCH_TASK_SOURCE_SCHEMA_VERSION = "qsl_research_task_source_snapshot.v1";
export const RESEARCH_TASK_SCHEMA_VERSION = "qsl.research_task.v1";
export const RESEARCH_TASK_DASHBOARD_SCHEMA_VERSION = "qsl_research_task_dashboard.v1";
export const RESEARCH_TASK_MAX_SOURCES = 100;
export const RESEARCH_TASK_MAX_BODY_BYTES = 256 * 1024;
export const RESEARCH_TASK_DEFAULT_STALE_TTL_SECONDS = 36 * 60 * 60;
export const RESEARCH_TASK_TYPES = Object.freeze([
  "strategy_diagnosis",
  "hypothesis_evaluation",
  "parameter_challenge",
  "strategy_candidate",
  "portfolio_candidate",
  "plugin_candidate",
]);
export const RESEARCH_TASK_OBJECTIVES = Object.freeze([
  "diagnose_degradation",
  "test_hypothesis",
  "challenge_parameters",
  "evaluate_candidate",
]);
