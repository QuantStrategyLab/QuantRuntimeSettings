export const RUNTIME_DAILY_KEY_PREFIX = "runtime_daily:";
export const RUNTIME_DAILY_MAX_BODY_BYTES = 64 * 1024;
export const RUNTIME_DAILY_MAX_RUNS = 20;
export const RUNTIME_DAILY_MAX_LIST = 20;
export const RUNTIME_DAILY_HISTORY_PAGE = 100;
export const RUNTIME_DAILY_HISTORY_MAX_PAGES = 10;
export const RUNTIME_DAILY_STALE_MS = 36 * 60 * 60 * 1000;
export const RUNTIME_DAILY_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const RUNTIME_DAILY_STATUSES = [
  "no_submission", "no_signal", "no_rebalance", "submitted", "broker_acknowledged", "partially_filled", "filled",
  "reconciliation_required", "unknown", "failed", "blocked", "dry_run", "shadow", "validation",
  "not_due", "market_closed", "outside_window", "within_grace", "missing_report", "read_incomplete", "insufficient", "conflict",
];
export const RUNTIME_DAILY_SCHEDULE_ONLY = ["not_due", "market_closed", "outside_window", "within_grace"];
export const RUNTIME_DAILY_ANOMALY_STATUSES = [
  "reconciliation_required", "unknown", "failed", "blocked", "conflict", "missing_report", "read_incomplete", "insufficient",
  "dry_run", "shadow", "validation",
];
export const RUNTIME_DAILY_ACTIVITIES = [
  "no_submission", "no_signal", "no_rebalance", "submitted", "broker_acknowledged", "partially_filled", "filled",
  "reconciliation_required", "unknown", "failed", "blocked", "previewed", "insufficient",
];
export const RUNTIME_DAILY_LANES = ["paper", "live", "dry_run", "shadow", "validation", "insufficient"];
export const RUNTIME_DAILY_SCHEDULE_STATES = ["unevaluable", "not_due", "market_closed", "within_grace", "due", "outside_window"];
export const RUNTIME_DAILY_KINDS = ["run", "schedule", "incomplete"];

export const SCHWAB_RUN_ID_RE = /^run\.[0-9a-f]{32}$/;
export const SCHWAB_RECEIPT_ID_RE = /^execution-receipt\.[0-9a-f]{32}$/;
export const SCHWAB_REPORT_STATUSES = ["ok", "skipped", "success", "completed", "no_action", "error", "failed", "failure", "cancelled", "canceled", "timed_out"];
export const SCHWAB_EXECUTION_STATUSES = [
  "no_op", "no_action", "no_signal", "no_rebalance", "skipped", "outside_market_hours", "submitted",
  "pending_reconciliation", "reconciliation_required", "unknown", "unknown_order", "blocked", "risk_blocked",
  "error", "failed", "failure", "dry_run", "previewed", "partial", "partially_filled", "filled", "completed",
];
export const SCHWAB_QUIET_ACTIVITIES = ["no_submission", "no_signal", "no_rebalance"];
export const SCHWAB_RECEIPT_CONFIRMATIONS = {
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
export const SCHWAB_SCHEDULE_REASONS = {
  due: ["publication_grace_ended"],
  within_grace: ["publication_grace_open"],
  not_due: ["before_schedule", "no_cron_on_business_date"],
  market_closed: ["market_closed"],
  outside_window: ["outside_expected_window"],
  unevaluable: ["schedule_missing", "schedule_invalid"],
};
