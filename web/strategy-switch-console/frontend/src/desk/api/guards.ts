/**
 * Small runtime guards for desk responses (live and mock alike). They check the shape the
 * UI relies on, not every rule in schemas/desk; a response that fails is rejected instead
 * of being rendered with defaults.
 */
import type {
  Accounts, Credentials, DeskSession, Overview, Performance, Read, Ribbon, SwitchStrategies, SwitchTargets,
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
