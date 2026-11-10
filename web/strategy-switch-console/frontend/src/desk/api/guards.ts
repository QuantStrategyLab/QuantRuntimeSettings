/**
 * Small runtime guards for desk responses (live and mock alike). They check the shape the
 * UI relies on, not every rule in schemas/desk; a response that fails is rejected instead
 * of being rendered with defaults.
 */
import type {
  Accounts, AlertDelivery, Alerts, Credentials, DeskSession, Logs, Overview, Performance, Read, Ribbon,
  SwitchStrategies, SwitchTargets,
} from "../contract/types";

type Guard<T> = (value: unknown) => value is T;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isIso = (value: unknown): value is string => {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  const instant = new Date(value);
  // Date normalizes impossible days and 24:00; require the original UTC fields.
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 19) === value.slice(0, 19);
};
const isClock = (value: unknown): value is string => isString(value) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const isDecimal = (value: unknown): value is string => isString(value) && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value);
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const oneOf = <T extends string>(...values: T[]) => (value: unknown): value is T => values.includes(value as T);
const nullable = <T,>(guard: Guard<T>) => (value: unknown): value is T | null => value === null || guard(value);

const READ_REASONS = oneOf("never_read", "read_failed", "source_unavailable", "identity_unverified", "not_supported");

/** §1.4: known/stale carry a value and observed_at; unknown carries a reason and no value. */
export function isRead<T>(value: unknown, valueGuard: Guard<T> = (_v): _v is T => true): value is Read<T> {
  if (!isObject(value)) return false;
  if (value.status === "known") return "value" in value && valueGuard(value.value) && isIso(value.observed_at);
  if (value.status === "stale") return "value" in value && valueGuard(value.value) && isIso(value.observed_at) && isCount(value.age_seconds);
  if (value.status === "unknown") return READ_REASONS(value.reason) && !("value" in value) && (value.observed_at == null || isIso(value.observed_at));
  return false;
}

const envelope = (value: unknown, version: string): value is Record<string, unknown> =>
  isObject(value) && value.ok === true && value.schema_version === version && isIso(value.generated_at);

export function isSession(value: unknown): value is DeskSession {
  return isObject(value) && typeof value.authenticated === "boolean" && typeof value.allowed === "boolean" &&
    typeof value.admin === "boolean" && (value.login === null || isString(value.login)) && isIso(value.server_time);
}

const isTapeEntry = (value: unknown) => isObject(value) && isString(value.id) && isIso(value.at) && isString(value.target_id) &&
  isString(value.label) && oneOf("done", "running", "scheduled", "missed", "unknown")(value.state) &&
  (value.outcome === null || oneOf("filled", "orders_submitted", "no_op", "drift", "error", "skipped")(value.outcome));

const isMarketSession = (value: unknown) => isObject(value) && oneOf("US", "HK", "CN")(value.market) &&
  oneOf("open", "closed", "pre", "post", "unknown")(value.state) && nullable(isClock)(value.open_utc) && nullable(isClock)(value.close_utc) && nullable(isIso)(value.next_change_at);

export function isRibbon(value: unknown): value is Ribbon {
  if (!envelope(value, "qsl.desk.ribbon.v1")) return false;
  const state = value.console_state;
  const badge = value.alert_badge;
  return isObject(state) && oneOf("dry_run", "paper", "live")(state.mode) &&
    isRead(state.gateways, oneOf("all_reachable", "degraded", "down")) &&
    isObject(badge) && isCount(badge.open_count) && isCount(badge.critical_count) &&
    Array.isArray(value.sessions) && value.sessions.every(isMarketSession) &&
    (value.next_run === null || (isObject(value.next_run) && isIso(value.next_run.due_at))) &&
    Array.isArray(value.tape) && value.tape.every(isTapeEntry);
}

const isNav = (value: unknown) => {
  if (!isObject(value)) return false;
  if (value.status === "unknown") return READ_REASONS(value.reason) && !("amount" in value);
  return (value.status === "known" || value.status === "stale") && isDecimal(value.amount) && isString(value.currency) &&
    nullable(isDecimal)(value.usd) && isIso(value.observed_at);
};

const isBookRow = (value: unknown) => {
  if (!isObject(value)) return false;
  const spark = value.sparkline_30d;
  const drawdown = value.drawdown;
  const config = value.config;
  return isString(value.target_id) && isString(value.account_ref) && isString(value.account_suffix) &&
    isRead(value.strategy, (v): v is unknown => isObject(v) && isString(v.profile) && isString(v.label)) &&
    isRead(value.mode, oneOf("dry_run", "paper", "live")) &&
    isRead(value.runtime, oneOf("running", "stopped", "unknown")) &&
    isNav(value.nav) &&
    (value.day_change === null || (isObject(value.day_change) && isDecimal(value.day_change.ratio) && isDecimal(value.day_change.amount))) &&
    isObject(spark) && Array.isArray(spark.points) && spark.points.every(isDecimal) && Array.isArray(spark.gap_dates) &&
    isObject(drawdown) && nullable(isDecimal)(drawdown.ratio) && oneOf("ok", "near_limit", "breached", "unknown")(drawdown.state) &&
    isObject(config) && oneOf("synced", "drift", "unknown")(config.state) && isCount(config.drift_count) &&
    oneOf("native_ibkr_twr", "nav_change_unadjusted", "unavailable")(value.return_basis);
};

const isNeed = (value: unknown) => isObject(value) && isString(value.id) && oneOf("critical", "warning", "info")(value.severity) &&
  isString(value.title) && isString(value.detail) && isObject(value.action) && isString(value.action.route);

export function isOverview(value: unknown): value is Overview {
  if (!envelope(value, "qsl.desk.overview.v1")) return false;
  const totals = value.totals;
  const curve = value.equity_curve;
  return isObject(value.freshness) && oneOf("ready", "stale", "unavailable")(value.freshness.data_status) &&
    isObject(totals) && oneOf("complete", "partial", "unavailable")(totals.status) && nullable(isDecimal)(totals.nav) &&
    isObject(totals.coverage) && isCount(totals.coverage.included) && isCount(totals.coverage.total) &&
    Array.isArray(value.book) && value.book.every(isBookRow) &&
    isObject(curve) && isObject(curve.portfolio) && Array.isArray(curve.portfolio.dates) && Array.isArray(curve.portfolio.indexed) &&
    curve.portfolio.dates.length === curve.portfolio.indexed.length && isObject(curve.benchmark) &&
    Array.isArray(value.needs_you) && value.needs_you.length <= 5 && value.needs_you.every(isNeed);
}

/** Performance: the page needs the equity curve; the rest is read defensively by the UI. */
export function isPerformance(value: unknown): value is Performance {
  if (!envelope(value, "qsl.desk.performance.v1")) return false;
  const equity = value.equity;
  return isObject(equity) && Array.isArray(equity.dates) && Array.isArray(equity.portfolio_indexed) &&
    equity.dates.length === equity.portfolio_indexed.length && Array.isArray(equity.gap_dates) && isObject(value.risk);
}

// ---------------------------------------------------------------- accounts / credentials

const CREDENTIAL_PHASES = oneOf("unknown", "not_due", "30", "7", "1", "expired");
const CREDENTIAL_KINDS = oneOf("oauth_refresh", "flex_token", "access_token", "api_key", "password", "session", "other");
const phaseRequiresAction = (phase: string): boolean => phase === "30" || phase === "7" || phase === "1" || phase === "expired";

const isExpiry = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  if (value.status === "known") return isIso(value.at) && isString(value.source);
  if (value.status === "none") return true;
  if (value.status === "unknown") return READ_REASONS(value.reason);
  return false;
};

const isCredentialSummary = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  if (!CREDENTIAL_KINDS(value.kind) || !isExpiry(value.expiry) || !CREDENTIAL_PHASES(value.phase)) return false;
  if (typeof value.requires_action !== "boolean") return false;
  if (value.requires_action !== phaseRequiresAction(String(value.phase))) return false;
  return value.note === undefined || isString(value.note);
};

const isBrokerHealth = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  const targets = value.targets;
  const lastOrder = value.last_order;
  const heartbeat = value.heartbeat;
  return isString(value.platform) && isString(value.label) &&
    Array.isArray(targets) && targets.every(entry => isObject(entry) && isString(entry.target_id) && isString(entry.account_ref)) &&
    isRead(value.connectivity, oneOf("up", "degraded", "down")) &&
    (value.connectivity_detail === null || isString(value.connectivity_detail)) &&
    isRead(heartbeat, (v): v is unknown => isObject(v) && isIso(v.at)) &&
    isObject(value.data_freshness) && oneOf("ready", "stale", "unavailable")(value.data_freshness.data_status) &&
    (value.data_freshness.age_seconds === null || isCount(value.data_freshness.age_seconds)) &&
    isObject(value.config) && oneOf("synced", "drift", "unknown")(value.config.state) && isCount(value.config.drift_count) &&
    isCredentialSummary(value.credential) &&
    isRead(lastOrder, (v): v is unknown => isObject(v) && isIso(v.at) && isCount(v.count));
};

export function isAccounts(value: unknown): value is Accounts {
  return envelope(value, "qsl.desk.accounts.v1") && Array.isArray(value.brokers) && value.brokers.every(isBrokerHealth);
}

const isCredentialItem = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  const rotation = value.rotation;
  return isString(value.id) && isString(value.platform) && isString(value.label) &&
    CREDENTIAL_KINDS(value.kind) && isExpiry(value.expiry) &&
    (value.limit_days === null || isCount(value.limit_days)) &&
    CREDENTIAL_PHASES(value.phase) && typeof value.requires_action === "boolean" &&
    value.requires_action === phaseRequiresAction(String(value.phase)) &&
    isObject(rotation) && typeof rotation.supported === "boolean" && (rotation.route === null || isString(rotation.route)) &&
    (value.runbook === null || isString(value.runbook)) &&
    (value.last_rotated_at === null || isIso(value.last_rotated_at));
};

export function isCredentials(value: unknown): value is Credentials {
  return envelope(value, "qsl.desk.credentials.v1") && Array.isArray(value.items) && value.items.every(isCredentialItem);
}

// ---------------------------------------------------------------- switch targets / catalog

const isSwitchTarget = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  const switchable = value.switchable;
  const stop = value.stop;
  return isString(value.target_id) && isString(value.platform) && isString(value.platform_label) &&
    isString(value.account_ref) && isString(value.account_suffix) &&
    isRead(value.mode, oneOf("dry_run", "paper", "live")) &&
    Array.isArray(value.domains) && value.domains.every(isString) &&
    isRead(value.current_strategy, (v): v is unknown => isObject(v) && isString(v.profile) && isString(v.label)) &&
    Array.isArray(value.execution_modes) && value.execution_modes.every(oneOf("dry_run", "paper", "live")) &&
    isObject(switchable) && typeof switchable.allowed === "boolean" &&
    (switchable.reason_code === null || isString(switchable.reason_code)) &&
    (value.pending_request_id === null || isString(value.pending_request_id)) &&
    isObject(stop) && typeof stop.supported === "boolean" && typeof stop.resume_supported === "boolean";
};

export function isSwitchTargets(value: unknown): value is SwitchTargets {
  return envelope(value, "qsl.desk.switch_targets.v1") && Array.isArray(value.targets) && value.targets.every(isSwitchTarget);
}

const isStrategyOption = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  return isString(value.profile) && isString(value.label) && isString(value.domain) &&
    oneOf("eligible", "no_live", "blocked")(value.eligibility) &&
    (value.reason === null || isString(value.reason)) &&
    Array.isArray(value.allowed_execution_modes) && value.allowed_execution_modes.every(oneOf("dry_run", "paper", "live")) &&
    isString(value.lifecycle_stage) &&
    (value.option_overlay_enabled === undefined || typeof value.option_overlay_enabled === "boolean") &&
    (value.dca_supported === undefined || typeof value.dca_supported === "boolean");
};

export function isSwitchStrategies(value: unknown): value is SwitchStrategies {
  return envelope(value, "qsl.desk.switch_strategies.v1") && isString(value.target_id) && isString(value.domain) &&
    isString(value.catalog_revision) && Array.isArray(value.strategies) && value.strategies.every(isStrategyOption);
}

// ---------------------------------------------------------------- §3.17–§3.19 alerts / delivery / logs

const ALERT_KINDS = oneOf(
  "config_drift", "credential_expiring", "decision_pending", "drawdown_near_limit", "run_missed", "data_stale",
  "other", "digest", "delivery_failed", "candidate_ready",
);
const LOG_LEVELS = oneOf("debug", "info", "warn", "error");
/** Either a target id (`platform/target`) or one of the reserved non-target sources. */
const isLogSource = (value: unknown): value is string =>
  isString(value) && /^(?:[a-z0-9_-]+\/[a-z0-9_-]+|control-plane|account-facts|research|digest)$/.test(value);

const isAlertItem = (value: unknown) => {
  if (!isObject(value)) return false;
  const logRef = value.log_ref;
  return isString(value.id) && oneOf("critical", "warning", "info")(value.severity) &&
    oneOf("open", "resolved")(value.status) && ALERT_KINDS(value.kind) &&
    nullable(isString)(value.target_id) && isString(value.title) && isString(value.detail) &&
    isIso(value.first_seen_at) && isIso(value.last_seen_at) && nullable(isIso)(value.resolved_at) &&
    isString(value.source) && nullable(isString)(value.route) &&
    (logRef === null || (isObject(logRef) && isString(logRef.run_id))) &&
    // Resolved always carries its resolution time; open never does.
    (value.status === "resolved") === (value.resolved_at !== null);
};

export function isAlerts(value: unknown): value is Alerts {
  if (!envelope(value, "qsl.desk.alerts.v1")) return false;
  const counts = value.counts;
  return isObject(counts) && isCount(counts.open) && isCount(counts.critical) && isCount(counts.warning) &&
    isCount(counts.info) && isCount(counts.last_7d_total) &&
    Array.isArray(value.items) && value.items.every(isAlertItem) && nullable(isString)(value.next_cursor);
}

export const DELIVERY_READ_STATUSES = ["complete", "partial", "no_data", "unknown", "read_failed", "not_connected"] as const;
export const DELIVERY_READ_REASONS = [
  "run_listing_coverage_unknown", "run_listing_truncated", "run_listing_incomplete",
  "notification_receipts_read_failed", "receipt_missing", "receipt_expired", "sender_skipped",
  "no_completed_workflow_runs", "notification_log_not_connected", "invalid_notification_log",
] as const;
export const DELIVERY_SENDER_STATUSES = [
  "route_check", "dry_run", "blocked_missing_secrets", "delivered", "send_failed",
  "skipped_duplicate", "blocked_resend_guard", "business_digest_failed", "skipped_empty",
  "receipt_missing", "receipt_expired", "sender_skipped", "read_failed", "unknown",
] as const;
/** Exactly the schema's read_error_code enum: six receipt codes plus stage × failure family. */
const isReadErrorCode = (value: unknown): value is string => isString(value) && (
  /^(?:receipt_read_timeout|receipt_too_large|receipt_body_missing|invalid_receipt_archive|public_receipt_missing|invalid_public_receipt)$/.test(value) ||
  /^(?:run_listing|artifact_listing|artifact_archive|artifact_download|receipt_decode|receipt_projection|sender_jobs)_(?:failed|transport_failed|http_(?:other|401|403|404|429|500|502|503|504))$/.test(value));
const isRunNumber = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1;
const isDate = (value: unknown): value is string => isString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && isIso(`${value}T00:00:00Z`);
const isNullableBool = (value: unknown): value is boolean | null => value === null || typeof value === "boolean";
const DELIVERY_ITEM_KEYS = ["business_day", "dry_run", "read_error_code", "receiver_ack", "report_date", "sender_accepted",
  "sender_status", "source_run_attempt", "source_run_id", "test_message", "workflow_updated_at"].join();

const isDeliverySourceItem = (value: unknown): boolean => isObject(value) &&
  Object.keys(value).sort().join() === DELIVERY_ITEM_KEYS &&
  nullable(isRunNumber)(value.source_run_id) && nullable(isRunNumber)(value.source_run_attempt) &&
  nullable(isIso)(value.workflow_updated_at) && nullable(isDate)(value.business_day) && nullable(isDate)(value.report_date) &&
  oneOf(...DELIVERY_SENDER_STATUSES)(value.sender_status) &&
  isNullableBool(value.sender_accepted) && isNullableBool(value.dry_run) && isNullableBool(value.test_message) &&
  // The only receiver fact this source may carry is "unknown".
  value.receiver_ack === "unknown" && nullable(isReadErrorCode)(value.read_error_code);

/** The v1 `source` block, validated in full before any of it is rendered. */
export function isDeliverySource(value: unknown): boolean {
  if (!isObject(value) || Object.keys(value).sort().join() !== "as_of,items,read_reason_codes,read_status") return false;
  const reasons = value.read_reason_codes;
  return oneOf(...DELIVERY_READ_STATUSES)(value.read_status) &&
    Array.isArray(reasons) && reasons.every(oneOf(...DELIVERY_READ_REASONS)) && new Set(reasons).size === reasons.length &&
    nullable(isIso)(value.as_of) &&
    Array.isArray(value.items) && value.items.length <= 5 && value.items.every(isDeliverySourceItem);
}

export function isAlertDelivery(value: unknown): value is AlertDelivery {
  if (!envelope(value, "qsl.desk.alert_delivery.v1")) return false;
  const channel = value.channel;
  const last = value.last_delivery;
  const digest = value.digest;
  return isObject(channel) && isString(channel.name) && isRead(channel.status, oneOf("ok", "failing")) &&
    (last === null || (isObject(last) && isIso(last.at) && oneOf("ok", "failed")(last.outcome) && isCount(last.recipients))) &&
    (digest === null || (isObject(digest) && isClock(digest.schedule_utc) && isIso(digest.last_composed_at) &&
      isCount(digest.targets) && isCount(digest.runs))) &&
    // Optional for older fixtures; when present it must be valid, never partially rendered.
    (!("source" in value) || isDeliverySource(value.source));
}

const isLogLine = (value: unknown) => isObject(value) && isString(value.id) && isIso(value.at) &&
  LOG_LEVELS(value.level) && isLogSource(value.source) && nullable(isString)(value.run_id) &&
  isString(value.message) && value.message.length <= 400;

export function isLogs(value: unknown): value is Logs {
  if (!envelope(value, "qsl.desk.logs.v1")) return false;
  const retention = value.retention;
  return Array.isArray(value.items) && value.items.every(isLogLine) && nullable(isString)(value.next_cursor) &&
    isObject(retention) && retention.days === 90 && typeof retention.truncated === "boolean" &&
    value.redaction === "applied";
}
