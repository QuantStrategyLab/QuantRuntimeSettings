/**
 * Desk API contract types, hand-written from API-CONTRACT.md (draft v1, 2026-11-02).
 * Section numbers point at the contract. Where the contract prose defers to the BE-0
 * schemas in schemas/desk/ (schema_version, unknown variants of Nav/fx/holdings), the
 * schema shape is used. Money and ratios are decimal strings, never numbers; times are
 * ISO-8601 UTC strings with a Z suffix.
 *
 * Fields that encode today's policy as a constant in the schemas (for example
 * `switchable.allowed: false`) are typed as the general contract type here, so the UI
 * keeps working when the policy flips.
 */

/** §1.3 Decimal string such as "412380.55" or "-0.062". */
export type Decimal = string;
/** §1.3 ISO-8601 UTC instant with a Z suffix. */
export type IsoTime = string;
/** §1.3 Calendar date, YYYY-MM-DD. */
export type IsoDate = string;
/** §3.2 UTC wall-clock time, HH:MM. */
export type ClockUtc = string;
/** §1.3 "<platform>/<target_name>", for example "ibkr/tqqq". */
export type TargetId = string;
/** §1.3 ISO 4217 or USDT. */
export type Currency = string;

/** §1.4 Why a value is unknown. */
export type ReadReason = "never_read" | "read_failed" | "source_unavailable" | "identity_unverified" | "not_supported";
/** §3.15 Performance metrics may also be unknown for lack of history. */
export type MetricReadReason = ReadReason | "insufficient_history";

export interface Known<T> {
  status: "known";
  value: T;
  observed_at: IsoTime;
}
export interface Stale<T> {
  status: "stale";
  value: T;
  observed_at: IsoTime;
  age_seconds: number;
}
export interface Unknown<R extends string = ReadReason> {
  status: "unknown";
  reason: R;
  observed_at?: IsoTime | null;
}

/**
 * §1.4 Unknown is first-class. A value that could not be read, verified or trusted is
 * `unknown`; it is never defaulted to false, 0, "stopped" or an empty list.
 */
export type Read<T> = Known<T> | Stale<T> | Unknown;
export type MetricRead<T> = Known<T> | Stale<T> | Unknown<MetricReadReason>;

/** §1.4 "stopped" only when a fresh, identity-verified read affirms it. */
export type RuntimeState = "running" | "stopped" | "unknown";
export type Mode = "dry_run" | "paper" | "live";
/** §1.5 */
export interface Freshness {
  data_status: "ready" | "stale" | "unavailable";
  age_seconds: number | null;
}
export type Severity = "critical" | "warning" | "info";
export type Comparison = "match" | "drift" | "unknown";
export type ConfigState = "synced" | "drift" | "unknown";
export type ReturnBasis = "native_ibkr_twr" | "nav_change_unadjusted" | "unavailable";
export type PortfolioBasis = ReturnBasis | "mixed";
export type DrawdownState = "ok" | "near_limit" | "breached" | "unknown";
export type RunOutcome = "filled" | "orders_submitted" | "no_op" | "drift" | "error" | "skipped";
export type RangeId = "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL";
export type BenchmarkId = "sp500" | "nasdaq100" | "djia" | "russell2000";
/** §3.20 existing CredentialMaintenance vocabulary. */
export type CredentialPhase = "unknown" | "not_due" | "30" | "7" | "1" | "expired";
export type CredentialKind = "oauth_refresh" | "flex_token" | "access_token" | "api_key" | "password" | "session" | "other";
export type NeedKind =
  | "config_drift"
  | "credential_expiring"
  | "decision_pending"
  | "drawdown_near_limit"
  | "run_missed"
  | "data_stale"
  | "other";
export type AlertKind = NeedKind | "digest" | "delivery_failed" | "candidate_ready";

/** §1.2 Error body. */
export interface DeskErrorBody {
  ok: false;
  error: string;
  reason_code?: string;
  reason?: string;
}

/** §6 Every /api/desk/* success body. */
export interface DeskEnvelope<V extends string> {
  ok: true;
  schema_version: V;
  generated_at: IsoTime;
}

export interface StrategyRef {
  profile: string;
  label: string;
}

/** §3.3 / §3.14 NAV in account currency; `usd` is null when FX is unknown. */
export type Nav =
  | { status: "known"; currency: Currency; amount: Decimal; usd: Decimal | null; observed_at: IsoTime }
  | { status: "stale"; currency: Currency; amount: Decimal; usd: Decimal | null; observed_at: IsoTime; age_seconds: number }
  | Unknown;

export interface ConfigSummary {
  state: ConfigState;
  drift_count: number;
  checked_at?: IsoTime | null;
}

export type Benchmark =
  | { id: BenchmarkId; label: string; indexed: Decimal[] }
  | { id: null; label: null; indexed: [] };

// ---------------------------------------------------------------- §3.1 session

export interface DeskSession {
  authenticated: boolean;
  login: string | null;
  allowed: boolean;
  admin: boolean;
  server_time: IsoTime;
}

// ---------------------------------------------------------------- §3.2 ribbon

export type MarketId = "US" | "HK" | "CN";
export type MarketSessionState = "open" | "closed" | "pre" | "post" | "unknown";
export type TapeState = "done" | "running" | "scheduled" | "missed" | "unknown";
export type GatewayState = "all_reachable" | "degraded" | "down";

export interface MarketSession {
  market: MarketId;
  state: MarketSessionState;
  open_utc: ClockUtc | null;
  close_utc: ClockUtc | null;
  next_change_at: IsoTime | null;
  holiday: string | null;
}

export interface TapeEntry {
  id: string;
  at: IsoTime;
  target_id: TargetId;
  label: string;
  kind: string;
  outcome: RunOutcome | null;
  outcome_detail: string | null;
  state: TapeState;
}

export interface Ribbon extends DeskEnvelope<"qsl.desk.ribbon.v1"> {
  date: IsoDate;
  console_state: { mode: Mode; gateways: Read<GatewayState> };
  alert_badge: { open_count: number; critical_count: number };
  sessions: MarketSession[];
  next_run: { target_id: TargetId; kind: string; due_at: IsoTime } | null;
  tape: TapeEntry[];
}

// ---------------------------------------------------------------- §3.3 overview

export type TotalsStatus = "complete" | "partial" | "unavailable";
export type ExcludedReason =
  | "physical_identity_unverified"
  | "coverage_incomplete"
  | "no_non_paper_accounts"
  | "fx_unavailable"
  | "paper_excluded";

export interface OverviewTotals {
  status: TotalsStatus;
  coverage: { included: number; total: number; excluded_reasons: ExcludedReason[] };
  fx: { status: "known"; as_of: IsoTime; source: string } | { status: "unknown"; reason: ReadReason };
  nav: Decimal | null;
  day_change: { amount: Decimal; ratio: Decimal } | null;
  drawdown: { ratio: Decimal; limit_ratio: Decimal; peak_date: IsoDate } | null;
  gross_exposure_ratio: Decimal | null;
  leveraged_etf_exposure_ratio: Decimal | null;
  runs_today: { done: number; expected: number; pending: { target_id: TargetId; due_at: IsoTime }[] };
  config_drift: { count: number; target_ids: TargetId[] };
  data_age_seconds: number | null;
}

export interface BookRow {
  target_id: TargetId;
  platform: string;
  platform_label: string;
  account_ref: string;
  account_suffix: string;
  strategy: Read<StrategyRef>;
  mode: Read<Mode>;
  runtime: Read<RuntimeState>;
  nav: Nav;
  day_change: { ratio: Decimal; amount: Decimal; currency: Currency } | null;
  /** Oldest to newest, same currency as nav.amount; never interpolate across gap_dates. */
  sparkline_30d: { points: Decimal[]; dates_from: IsoDate | null; dates_to: IsoDate | null; gap_dates: IsoDate[] };
  drawdown: { ratio: Decimal | null; limit_ratio: Decimal | null; state: DrawdownState };
  config: ConfigSummary;
  last_run: { at: IsoTime; outcome: RunOutcome | null } | null;
  return_basis: ReturnBasis;
}

export interface NeedsYouItem {
  id: string;
  kind: NeedKind;
  severity: Severity;
  target_id: TargetId | null;
  title: string;
  detail: string;
  action: { label: string; route: string };
}

export interface Overview extends DeskEnvelope<"qsl.desk.overview.v1"> {
  snapshot_at: IsoTime | null;
  freshness: Freshness;
  reporting_currency: Currency;
  totals: OverviewTotals;
  /** Backend risk order; the client does not re-rank. */
  book: BookRow[];
  equity_curve: {
    range: RangeId;
    portfolio: { dates: IsoDate[]; indexed: Decimal[] };
    benchmark: Benchmark;
    drawdown: Decimal[];
    history_starts: IsoDate | null;
    return_basis: PortfolioBasis;
  };
  /** At most 5, critical first. */
  needs_you: NeedsYouItem[];
}

// ---------------------------------------------------------------- §3.4 / §3.5 read-back

export type ReadbackKey =
  | "strategy_profile"
  | "broker_environment"
  | "income_layer_enabled"
  | "option_overlay_enabled"
  | "reserved_cash_floor"
  | "reserved_cash_ratio"
  | "dca_mode"
  | "dca_base_investment_usd"
  | "enabled"
  | "account_selector"
  | "cash_currency"
  | "runtime_status_target_id";

export interface ReadbackField {
  /** Rendered generically: the backend may add keys. */
  key: ReadbackKey | (string & {});
  label: string;
  saved: Read<string>;
  platform: Read<string>;
  /** Backend-computed; the frontend never compares values itself. */
  state: Comparison;
}

export interface DeskAction {
  allowed: boolean;
  reason_code: string | null;
}

export interface Readback extends DeskEnvelope<"qsl.desk.readback.v1"> {
  target_id: TargetId;
  readback_id: string;
  read_at: IsoTime;
  saved_revision: number;
  overall: Comparison;
  summary: { match: number; drift: number; unknown: number };
  fields: ReadbackField[];
  identity: {
    account_suffix: string | null;
    broker_environment: Mode | null;
    service: string | null;
    runtime_status_target_id: string | null;
  };
  facts_binding: Read<string>;
  alert_route: string | null;
  actions: { reapply_saved: DeskAction; adopt_platform: DeskAction };
}

export interface ReadbackStart extends DeskEnvelope<"qsl.desk.readback_start.v1"> {
  readback_id: string;
  state: "running";
  started_at: IsoTime;
  retry_after_ms: number;
  no_order: true;
  reused?: boolean;
}

export type ReadbackJobResult =
  | { target_id: TargetId; state: "done"; overall: Comparison; readback_id: string }
  | { target_id: TargetId; state: "failed"; error: string };

export interface ReadbackJob extends DeskEnvelope<"qsl.desk.readback_job.v1"> {
  readback_id: string;
  state: "running" | "done" | "partial" | "failed";
  started_at?: IsoTime;
  retry_after_ms?: number;
  results?: ReadbackJobResult[];
}

// ---------------------------------------------------------------- §3.6 switch

export type SwitchBlockReason = "switch_not_connected" | "request_in_flight" | "no_domain_declared" | "identity_incomplete";

export interface SwitchTarget {
  target_id: TargetId;
  platform: string;
  platform_label: string;
  account_ref: string;
  account_suffix: string;
  mode: Read<Mode>;
  domains: string[];
  current_strategy: Read<StrategyRef>;
  execution_modes: Mode[];
  switchable: { allowed: boolean; reason_code: SwitchBlockReason | (string & {}) | null };
  pending_request_id: string | null;
  /** §3.11 change 1: stop capability per target. */
  stop: { supported: boolean; resume_supported: boolean };
}

export interface SwitchTargets extends DeskEnvelope<"qsl.desk.switch_targets.v1"> {
  targets: SwitchTarget[];
}

export type Eligibility = "eligible" | "no_live" | "blocked";

export interface StrategyOption {
  profile: string;
  label: string;
  domain: string;
  eligibility: Eligibility;
  /** Reason code for blocked rows (wrong_domain, research_only, frozen, …) or a short note. */
  reason: string | null;
  allowed_execution_modes: Mode[];
  lifecycle_stage: string;
  option_overlay_enabled?: boolean;
  dca_supported?: boolean;
}

export interface SwitchStrategies extends DeskEnvelope<"qsl.desk.switch_strategies.v1"> {
  target_id: TargetId;
  domain: string;
  catalog_revision: string;
  strategies: StrategyOption[];
}

export interface SwitchPreviewRequest {
  target_id: TargetId;
  strategy_profile: string;
  execution_mode: Mode;
}

export type PreflightState = "pass" | "warn" | "block" | "unknown";

export interface PreflightRow {
  id: string;
  state: PreflightState;
  /** An unknown on a required row blocks; `unknown` never counts as pass. */
  required: boolean;
  title: string;
  detail: string;
  source: string;
  observed_at: IsoTime | null;
}

export type ScheduleOption = "now" | "after_us_close";

export interface SwitchPreview extends DeskEnvelope<"qsl.desk.switch_preview.v1"> {
  preview_id: string;
  created_at: IsoTime;
  expires_at: IsoTime;
  target_id: TargetId;
  base: { readback_id: string; saved_revision: number; platform_overall: Comparison };
  diff: { key: string; platform_now: Read<string>; after: string; changed: boolean }[];
  estimates: {
    turnover_ratio: Read<Decimal>;
    orders: Read<number>;
    leveraged_etf_ratio_after: Read<Decimal>;
    backtest_max_drawdown_ratio: Read<Decimal>;
  };
  preflight: PreflightRow[];
  /** The frontend trusts this count and `confirm.allowed`; it does not re-derive them. */
  blocking_count: number;
  unknown_count: number;
  confirm: {
    required: boolean;
    allowed: boolean;
    suffix_length: number;
    account_suffix_hint: string;
    schedule_options: ScheduleOption[];
  };
  no_order: true;
  reused?: boolean;
}

export interface SwitchCreateRequest {
  preview_id: string;
  confirm_account_suffix: string;
  schedule: ScheduleOption;
  idempotency_key: string;
}

export type SwitchState =
  | "scheduled"
  | "dispatched"
  | "applying"
  | "readback_pending"
  | "verified"
  | "mismatch"
  | "unknown"
  | "failed";

export interface SwitchCreated extends DeskEnvelope<"qsl.desk.switch_create.v1"> {
  request_id: string;
  state: "scheduled" | "dispatched";
  created_at: IsoTime;
  reused: boolean;
  no_order: true;
  retry_after_ms: number;
  actions_url: string | null;
}

export type VerifyFieldState = "pending" | "match" | "mismatch" | "unknown";

export interface SwitchRequest extends DeskEnvelope<"qsl.desk.switch_request.v1"> {
  request_id: string;
  /** §3.12: the same ledger serves reconcile requests. */
  kind?: "switch" | "apply_saved" | "adopt_platform";
  target_id: TargetId;
  state: SwitchState;
  /** True iff state is verified, mismatch, unknown or failed. */
  terminal: boolean;
  created_at: IsoTime;
  updated_at: IsoTime;
  retry_after_ms: number;
  timeout_at: IsoTime;
  workflow: { status: string; conclusion: string | null; run_url: string | null } | null;
  expected: { key: string; value: string }[];
  readback: {
    readback_id: string;
    read_at: IsoTime;
    fields: { key: string; expected: string; platform: Read<string>; state: VerifyFieldState }[];
  } | null;
  timeline: { at: IsoTime; step: string; detail: string | null }[];
}

// ---------------------------------------------------------------- §3.11 stop-only

export interface RuntimeStopStatus {
  ok: true;
  configured: boolean;
  platform_applied: boolean;
  request_succeeded: boolean;
  /** The only flag that lets the UI say "stop confirmed". */
  stop_confirmed: boolean;
  in_flight_state: string;
  request_id?: string | null;
  /** "accepted" is not "stopped". */
  phase: string | null;
  dispatch_result?: "accepted" | "rejected" | "unknown" | null;
  requested_at?: IsoTime | null;
  updated_at?: IsoTime | null;
  actions_url?: string;
  runtime_observation:
    | { status: "unknown"; observed_at?: IsoTime | null; reason: ReadReason }
    | { status: "running" | "stopped"; observed_at: IsoTime };
  no_order: true;
  reused?: boolean;
}

// ---------------------------------------------------------------- §3.12 reconcile (gated)

export interface ReconcileRequest {
  target_id: TargetId;
  direction: "apply_saved" | "adopt_platform";
  readback_id: string;
  fields: string[];
  confirm_account_suffix: string;
  idempotency_key: string;
}

// ---------------------------------------------------------------- §3.13 / §3.14 accounts

export interface CredentialSummary {
  kind: CredentialKind;
  expiry: CredentialExpiry;
  phase: CredentialPhase;
  /** Equals phase ∈ {30, 7, 1, expired}; false for unknown. */
  requires_action: boolean;
  note?: string;
}

export interface BrokerHealth {
  platform: string;
  label: string;
  targets: { target_id: TargetId; account_ref: string }[];
  /** Missing heartbeat with nothing proving "down" is unknown, never down. */
  connectivity: Read<"up" | "degraded" | "down">;
  connectivity_detail: string | null;
  heartbeat: Read<{ at: IsoTime }>;
  data_freshness: Freshness;
  config: ConfigSummary;
  credential: CredentialSummary;
  last_order: Read<{ at: IsoTime; count: number }>;
}

export interface Accounts extends DeskEnvelope<"qsl.desk.accounts.v1"> {
  brokers: BrokerHealth[];
}

export type PositionsScope = "stocks_only" | "strategy_symbols_only";

export interface HoldingRow {
  symbol: string;
  name: string;
  /** null for cash rows. */
  quantity: Decimal | null;
  last_price: Read<Decimal> | null;
  day_change_ratio: Read<Decimal> | null;
  market_value: Decimal;
  currency: Currency;
  /** null when NAV is unknown. */
  weight_ratio: Decimal | null;
}

export type Holdings =
  | { status: "known"; scope: PositionsScope; rows: HoldingRow[]; observed_at: IsoTime }
  | { status: "stale"; scope: PositionsScope; rows: HoldingRow[]; observed_at: IsoTime; age_seconds: number }
  | Unknown;

export interface AccountDetail extends DeskEnvelope<"qsl.desk.account_detail.v1"> {
  target_id: TargetId;
  platform: string;
  account_ref: string;
  mode: Read<Mode>;
  nav: Nav;
  holdings: Holdings;
  facts: {
    environment: Mode | null;
    strategy_domains: string[];
    facts_binding: Read<string>;
    service: string | null;
    alert_route: string | null;
    cash: { currency: Currency; available_cash: Decimal; frozen_cash: Decimal; settling_cash: Decimal }[];
    /** No item contract yet (BE-5); an empty list does not prove there is no financing. */
    financing: unknown[];
  };
}

// ---------------------------------------------------------------- §3.15 / §3.16 performance

export interface EquitySeries {
  dates: IsoDate[];
  portfolio_indexed: Decimal[];
  benchmark: Benchmark;
  drawdown_ratio: Decimal[];
  gap_dates: IsoDate[];
}

export interface ScorecardRow {
  target_id: TargetId;
  strategy_label: string;
  since: IsoDate | null;
  days: number;
  cagr_ratio: MetricRead<Decimal>;
  max_dd_ratio: MetricRead<Decimal>;
  sharpe: MetricRead<Decimal>;
  vol_ratio: MetricRead<Decimal>;
  capital_share_ratio: Decimal | null;
  return_basis: ReturnBasis;
}

export interface Performance extends DeskEnvelope<"qsl.desk.performance.v1"> {
  range: RangeId;
  scope: "all" | "strategy";
  history: {
    first_date: IsoDate | null;
    requested_from: IsoDate | null;
    truncated_by: string | null;
    retention_days: number;
  };
  return_basis: { kind: PortfolioBasis; per_target: Record<TargetId, ReturnBasis> };
  equity: EquitySeries;
  /** Present for scope=strategy, keyed by target id. */
  equity_by_target?: Record<TargetId, EquitySeries>;
  risk: {
    return_ratio: MetricRead<Decimal>;
    vs_benchmark_pts: MetricRead<Decimal>;
    volatility_ann_ratio: MetricRead<Decimal>;
    sharpe: MetricRead<Decimal>;
    sortino: MetricRead<Decimal>;
    max_drawdown_ratio: MetricRead<Decimal>;
    time_under_water_days: MetricRead<number>;
    best_day_ratio: MetricRead<Decimal>;
    worst_day_ratio: MetricRead<Decimal>;
  };
  scorecard: ScorecardRow[];
  contribution: { period: string; unit: "pts_of_nav"; rows: { target_id: TargetId; label: string; points: Decimal }[] };
  /** 12 entries per year; null = no data, which is not 0. */
  monthly: { unit: "ratio"; rows: { year: number; months: (Decimal | null)[]; ytd: Decimal | null }[] };
}

export interface MarketBenchmark {
  ok: true;
  schema_version: "qsl.market_benchmark_points.v1";
  inception_date: IsoDate;
  timezone: string;
  series: { id: BenchmarkId; legacy_id: string; label_en: string; label_zh: string; kind: "index" }[];
  points: { seriesId: string; observationDate: IsoDate; close: Decimal; source: string }[];
}

// ---------------------------------------------------------------- §3.17 – §3.19 alerts, delivery, logs

export interface AlertItem {
  id: string;
  severity: Severity;
  status: "open" | "resolved";
  kind: AlertKind;
  target_id: TargetId | null;
  title: string;
  detail: string;
  first_seen_at: IsoTime;
  last_seen_at: IsoTime;
  resolved_at: IsoTime | null;
  source: string;
  route: string | null;
  log_ref: { run_id: string } | null;
}

export interface Alerts extends DeskEnvelope<"qsl.desk.alerts.v1"> {
  counts: { open: number; critical: number; warning: number; info: number; last_7d_total: number };
  items: AlertItem[];
  next_cursor: string | null;
}

export interface AlertDelivery extends DeskEnvelope<"qsl.desk.alert_delivery.v1"> {
  channel: { name: string; status: Read<"ok" | "failing"> };
  last_delivery: { at: IsoTime; outcome: "ok" | "failed"; recipients: number } | null;
  digest: { schedule_utc: ClockUtc; last_composed_at: IsoTime; targets: number; runs: number } | null;
  /** v1 additive sender-log evidence (schemas/desk/alert-delivery.json). Optional for older
      fixtures; read coverage and sender acceptance never establish receiver acknowledgement. */
  source?: AlertDeliverySource;
}

export type DeliveryReadStatus = "complete" | "partial" | "no_data" | "unknown" | "read_failed" | "not_connected";

export type DeliveryReadReason =
  | "run_listing_coverage_unknown" | "run_listing_truncated" | "run_listing_incomplete"
  | "notification_receipts_read_failed" | "receipt_missing" | "receipt_expired" | "sender_skipped"
  | "no_completed_workflow_runs" | "notification_log_not_connected" | "invalid_notification_log";

export type DeliverySenderStatus =
  | "route_check" | "dry_run" | "blocked_missing_secrets" | "delivered" | "send_failed"
  | "skipped_duplicate" | "blocked_resend_guard" | "business_digest_failed" | "skipped_empty"
  | "receipt_missing" | "receipt_expired" | "sender_skipped" | "read_failed" | "unknown";

export interface AlertDeliverySourceItem {
  source_run_id: number | null;
  source_run_attempt: number | null;
  /** Workflow metadata only; never a send time or freshness proof. */
  workflow_updated_at: IsoTime | null;
  business_day: IsoDate | null;
  report_date: IsoDate | null;
  sender_status: DeliverySenderStatus;
  /** Sender-side acceptance. Never a receiver delivery. */
  sender_accepted: boolean | null;
  dry_run: boolean | null;
  test_message: boolean | null;
  /** This source has no receiver receipt; always unknown. */
  receiver_ack: "unknown";
  /** Fixed allowlisted code from the shared receipt reader, or null. */
  read_error_code: string | null;
}

export interface AlertDeliverySource {
  read_status: DeliveryReadStatus;
  read_reason_codes: DeliveryReadReason[];
  /** Read time; never a send, composition or ACK time. */
  as_of: IsoTime | null;
  items: AlertDeliverySourceItem[];
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogLine {
  id: string;
  at: IsoTime;
  level: LogLevel;
  /** A target id or control-plane | account-facts | research | digest. */
  source: string;
  run_id: string | null;
  /** Plain text, redacted by the backend. Render as text, never as HTML. */
  message: string;
}

export interface Logs extends DeskEnvelope<"qsl.desk.logs.v1"> {
  items: LogLine[];
  next_cursor: string | null;
  retention: { days: number; truncated: boolean };
  redaction: "applied";
}

// ---------------------------------------------------------------- §3.20 / §3.21 credentials

export type CredentialExpiry =
  | { status: "known"; at: IsoTime; source: string }
  /** The credential does not expire: a fact, not an unknown. */
  | { status: "none" }
  | { status: "unknown"; reason: ReadReason };

export interface CredentialItem {
  id: string;
  platform: string;
  label: string;
  kind: CredentialKind;
  expiry: CredentialExpiry;
  limit_days: number | null;
  phase: CredentialPhase;
  requires_action: boolean;
  rotation: { supported: boolean; route: string | null };
  runbook: string | null;
  last_rotated_at: IsoTime | null;
}

export interface Credentials extends DeskEnvelope<"qsl.desk.credentials.v1"> {
  items: CredentialItem[];
}
