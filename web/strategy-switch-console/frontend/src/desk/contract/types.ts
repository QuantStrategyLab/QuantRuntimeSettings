/**
 * QSL Desk API contract types, hand-written from API-CONTRACT.md (draft v1).
 * Replaced by types generated from schemas/desk/*.json once BE-0 lands.
 * Section numbers in comments point at the contract. Money and ratios are decimal
 * strings, never numbers; times are ISO-8601 UTC strings.
 */

/** §1.3 Decimal string such as "412380.55" or "-0.062". */
export type Decimal = string;
/** §1.3 ISO-8601 UTC instant with a Z suffix. */
export type IsoTime = string;
/** §1.3 "<platform>/<target_name>", for example "ibkr/tqqq". */
export type TargetId = string;

/** §1.4 Why a value is unknown. Unknown enum values from newer backends are treated as unknown reasons. */
export type ReadReason =
  | "never_read"
  | "read_failed"
  | "source_unavailable"
  | "identity_unverified"
  | "not_supported"
  | "insufficient_history";

/**
 * §1.4 Unknown is first-class: a value that could not be read, verified or trusted is
 * `unknown`. It is never defaulted to false, 0, "stopped" or an empty list.
 */
export type Read<T> =
  | { status: "known"; value: T; observed_at: IsoTime }
  | { status: "stale"; value: T; observed_at: IsoTime; age_seconds: number }
  | { status: "unknown"; reason: ReadReason; observed_at?: IsoTime | null };

/** §1.4 "stopped" only when a fresh, identity-verified read affirms it. */
export type RuntimeState = "running" | "stopped" | "unknown";
export type Mode = "live" | "paper" | "dry_run";
/** §1.5 */
export type Freshness = { data_status: "ready" | "stale" | "unavailable"; age_seconds: number | null };
export type Severity = "critical" | "warning" | "info";
export type ConfigState = "synced" | "drift" | "unknown";
export type ReturnBasis = "native_ibkr_twr" | "nav_change_unadjusted" | "unavailable";
export type DrawdownState = "ok" | "near_limit" | "breached" | "unknown";
export type RunOutcome = "filled" | "orders_submitted" | "no_op" | "drift" | "error" | "skipped";

/** §1.2 Error body. */
export interface DeskError {
  ok: false;
  error: string;
  reason_code?: string;
  reason?: string;
}

/** Every /api/desk/* success body (§6). */
export interface DeskEnvelope {
  ok: true;
  generated_at: IsoTime;
  schema_version?: string;
}

/** §3.1 */
export interface DeskSession {
  authenticated: boolean;
  login: string | null;
  allowed: boolean;
  admin: boolean;
  server_time?: IsoTime;
}

/** §3.2 */
export type SessionState = "open" | "closed" | "pre" | "post" | "unknown";
export type TapeState = "done" | "running" | "scheduled" | "missed" | "unknown";
export type GatewayState = "all_reachable" | "degraded" | "down";
export type Market = "US" | "HK" | "CN";

export interface MarketSession {
  market: Market;
  state: SessionState;
  open_utc: string;
  close_utc: string;
  next_change_at: IsoTime;
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

export interface Ribbon extends DeskEnvelope {
  date: string;
  console_state: { mode: Mode; gateways: Read<GatewayState> };
  alert_badge: { open_count: number; critical_count: number };
  sessions: MarketSession[];
  next_run: { target_id: TargetId; kind: string; due_at: IsoTime } | null;
  tape: TapeEntry[];
}

/** §3.3 */
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
  fx: { status: "known" | "unknown" | "stale"; as_of?: IsoTime; source?: string };
  nav: Decimal | null;
  day_change: { amount: Decimal; ratio: Decimal } | null;
  drawdown: { ratio: Decimal; limit_ratio: Decimal; peak_date: string } | null;
  gross_exposure_ratio: Decimal | null;
  leveraged_etf_exposure_ratio: Decimal | null;
  runs_today: { done: number; expected: number; pending: { target_id: TargetId; due_at: IsoTime }[] } | null;
  config_drift: { count: number; target_ids: TargetId[] } | null;
  data_age_seconds: number | null;
}

export interface BookNav {
  currency: string;
  amount: Decimal;
  /** null when FX is unknown. */
  usd: Decimal | null;
  status: "known" | "stale" | "unknown";
  observed_at: IsoTime | null;
}

export interface BookRow {
  target_id: TargetId;
  platform: string;
  platform_label: string;
  account_ref: string;
  account_suffix: string;
  strategy: Read<{ profile: string; label: string }>;
  mode: Read<Mode>;
  runtime: Read<RuntimeState>;
  nav: BookNav;
  day_change: { ratio: Decimal; amount: Decimal; currency: string } | null;
  sparkline_30d: { points: Decimal[]; dates_from: string; dates_to: string; gap_dates: string[] };
  drawdown: { ratio: Decimal; limit_ratio: Decimal; state: DrawdownState };
  config: { state: ConfigState; drift_count: number; checked_at: IsoTime | null };
  last_run: { at: IsoTime; outcome: RunOutcome } | null;
  return_basis: ReturnBasis;
}

export type NeedsKind =
  | "config_drift"
  | "credential_expiring"
  | "decision_pending"
  | "drawdown_near_limit"
  | "run_missed"
  | "data_stale"
  | "other";

export interface NeedsYouItem {
  id: string;
  kind: NeedsKind;
  severity: Severity;
  target_id: TargetId | null;
  title: string;
  detail: string;
  action: { label: string; route: string } | null;
}

export interface EquityCurve {
  range: string;
  portfolio: { dates: string[]; indexed: Decimal[] };
  benchmark: { id: string | null; label: string | null; indexed: Decimal[] };
  drawdown: Decimal[];
  history_starts: string;
  return_basis: ReturnBasis | "mixed";
}

export interface Overview extends DeskEnvelope {
  snapshot_at: IsoTime | null;
  freshness: Freshness;
  reporting_currency: string;
  totals: OverviewTotals;
  book: BookRow[];
  equity_curve: EquityCurve | null;
  needs_you: NeedsYouItem[];
}

/** §3.4 */
export type FieldState = "match" | "drift" | "unknown";

export interface ReadbackField {
  key: string;
  label: string;
  saved: Read<string>;
  platform: Read<string>;
  state: FieldState;
}

export interface ActionGate {
  allowed: boolean;
  reason_code: string | null;
}

export interface Readback extends DeskEnvelope {
  target_id: TargetId;
  readback_id: string;
  read_at: IsoTime;
  saved_revision: number;
  overall: FieldState;
  summary: { match: number; drift: number; unknown: number };
  fields: ReadbackField[];
  identity: { account_suffix: string; broker_environment: string; service: string; runtime_status_target_id: string };
  facts_binding: Read<string>;
  alert_route: string | null;
  actions: { reapply_saved: ActionGate; adopt_platform: ActionGate };
}

/** §3.5 */
export interface ReadbackJob {
  ok: true;
  readback_id: string;
  state: "running" | "done" | "partial" | "failed";
  started_at?: IsoTime;
  retry_after_ms?: number;
  results?: { target_id: TargetId; state: "done" | "failed"; overall?: FieldState; readback_id?: string; error?: string }[];
}

/** §3.6 step 1 */
export interface SwitchTarget {
  target_id: TargetId;
  platform: string;
  platform_label: string;
  account_ref: string;
  account_suffix: string;
  mode: Read<Mode>;
  domains: string[];
  current_strategy: Read<{ profile: string; label: string }>;
  execution_modes: Mode[];
  switchable: { allowed: boolean; reason_code: string | null };
  pending_request_id: string | null;
  stop?: { supported: boolean; resume_supported: boolean };
}
export interface SwitchTargets extends DeskEnvelope {
  targets: SwitchTarget[];
}

/** §3.6 step 2 */
export type Eligibility = "eligible" | "no_live" | "blocked";
export interface StrategyOption {
  profile: string;
  label: string;
  domain: string;
  eligibility: Eligibility;
  reason: string | null;
  allowed_execution_modes: Mode[];
  lifecycle_stage: string;
  option_overlay_enabled?: boolean;
  dca_supported?: boolean;
}
export interface StrategyOptions extends DeskEnvelope {
  target_id: TargetId;
  domain: string;
  catalog_revision: string;
  strategies: StrategyOption[];
}

/** §3.6 step 3 */
export type PreflightState = "pass" | "warn" | "block" | "unknown";
export interface PreflightRow {
  id: string;
  state: PreflightState;
  title: string;
  detail: string;
  source: string;
  observed_at: IsoTime | null;
  /** An unknown on a required row blocks live execution. */
  required?: boolean;
}
export interface SwitchPreview extends DeskEnvelope {
  preview_id: string;
  created_at: IsoTime;
  expires_at: IsoTime;
  target_id: TargetId;
  base: { readback_id: string; saved_revision: number; platform_overall: FieldState };
  diff: { key: string; platform_now: Read<string>; after: string; changed: boolean }[];
  estimates: Record<string, Read<string>>;
  preflight: PreflightRow[];
  blocking_count: number;
  unknown_count: number;
  confirm: {
    required: boolean;
    allowed?: boolean;
    suffix_length: number;
    account_suffix_hint: string;
    schedule_options: ("now" | "after_us_close")[];
  };
}

/** §3.6 step 4 request and response */
export interface SwitchRequestBody {
  preview_id: string;
  confirm_account_suffix: string;
  schedule: "now" | "after_us_close";
  idempotency_key: string;
}
export interface SwitchRequestAck {
  ok: true;
  request_id: string;
  state: SwitchRequestState;
  created_at: IsoTime;
  reused: boolean;
  no_order: true;
  retry_after_ms?: number;
  actions_url?: string;
}

/** §3.6 step 5, strict state machine. */
export type SwitchRequestState =
  | "scheduled"
  | "dispatched"
  | "applying"
  | "readback_pending"
  | "verified"
  | "mismatch"
  | "unknown"
  | "failed";
export type SwitchTerminalState = "verified" | "mismatch" | "unknown" | "failed";

export interface SwitchRequestStatus extends DeskEnvelope {
  request_id: string;
  kind?: "switch" | "apply_saved" | "adopt_platform";
  target_id: TargetId;
  state: SwitchRequestState;
  terminal: boolean;
  created_at: IsoTime;
  updated_at: IsoTime;
  retry_after_ms?: number;
  timeout_at: IsoTime | null;
  workflow: { status: string; conclusion: string | null; run_url: string | null } | null;
  expected: { key: string; value: string }[];
  readback: {
    readback_id: string;
    read_at: IsoTime;
    fields: { key: string; expected: string; platform: Read<string>; state: "pending" | "match" | "mismatch" | "unknown" }[];
  } | null;
  timeline: { at: IsoTime; step: string; detail: string | null }[];
}

/** §3.11 */
export interface RuntimeStopStatus {
  ok: true;
  configured: boolean;
  platform_applied: boolean;
  request_succeeded: boolean;
  stop_confirmed?: boolean;
  in_flight_state?: string;
  request_id?: string;
  phase: string | null;
  dispatch_result?: string;
  requested_at?: IsoTime;
  updated_at?: IsoTime;
  actions_url?: string;
  runtime_observation: { status: RuntimeState; request_succeeded?: boolean; observed_at?: IsoTime; reason?: ReadReason };
  no_order?: true;
}

/** §3.13 */
export interface BrokerRow {
  platform: string;
  label: string;
  targets: { target_id: TargetId; account_ref: string }[];
  connectivity: Read<"up" | "degraded" | "down">;
  connectivity_detail: string | null;
  heartbeat: Read<{ at: IsoTime }>;
  data_freshness: Freshness;
  config: { state: ConfigState; drift_count: number };
  credential: CredentialSummary;
  last_order: Read<{ at: IsoTime; count: number }>;
}
export interface Accounts extends DeskEnvelope {
  brokers: BrokerRow[];
}

/** §3.20 */
export type CredentialPhase = "unknown" | "not_due" | "30" | "7" | "1" | "expired";
export type CredentialExpiry =
  | { status: "known"; at: IsoTime; source: string }
  | { status: "none" }
  | { status: "unknown"; reason: ReadReason };
export interface CredentialSummary {
  kind: string;
  expiry: CredentialExpiry;
  phase: CredentialPhase;
  requires_action: boolean;
  note?: string;
}
export interface CredentialItem {
  id: string;
  platform: string;
  label: string;
  kind: string;
  expiry: CredentialExpiry;
  limit_days: number | null;
  phase: CredentialPhase;
  requires_action: boolean;
  rotation: { supported: boolean; route: string | null };
  runbook: string | null;
  last_rotated_at: IsoTime | null;
}
export interface Credentials extends DeskEnvelope {
  items: CredentialItem[];
}

/** §3.14 */
export interface HoldingRow {
  symbol: string;
  name: string;
  quantity: Decimal | null;
  last_price: Read<Decimal> | null;
  day_change_ratio: Read<Decimal> | null;
  market_value: Decimal;
  currency: string;
  weight_ratio: Decimal | null;
}
export interface AccountDetail extends DeskEnvelope {
  target_id: TargetId;
  platform: string;
  account_ref: string;
  mode: Read<Mode>;
  nav: BookNav;
  holdings: { status: "known" | "stale" | "unknown"; scope: "stocks_only" | "strategy_symbols_only"; observed_at: IsoTime | null; rows: HoldingRow[] };
  facts: {
    environment: string;
    strategy_domains: string[];
    facts_binding: Read<string>;
    service: string;
    alert_route: string | null;
    cash: { currency: string; available_cash: Decimal; frozen_cash: Decimal; settling_cash: Decimal }[];
    financing: unknown[];
  };
}

/** §3.15 */
export interface PerformanceScorecardRow {
  target_id: TargetId;
  strategy_label: string;
  since: string;
  days: number;
  cagr_ratio: Read<Decimal>;
  max_dd_ratio: Read<Decimal>;
  sharpe: Read<Decimal>;
  vol_ratio: Read<Decimal>;
  capital_share_ratio: Decimal;
  return_basis: ReturnBasis;
}
export interface Performance extends DeskEnvelope {
  range: string;
  scope: "all" | "strategy";
  history: { first_date: string; requested_from: string; truncated_by: string | null; retention_days: number };
  return_basis: { kind: ReturnBasis | "mixed"; per_target: Record<TargetId, ReturnBasis> };
  equity: {
    dates: string[];
    portfolio_indexed: Decimal[];
    benchmark: { id: string | null; label: string | null; indexed: Decimal[] };
    drawdown_ratio: Decimal[];
    gap_dates: string[];
  };
  risk: Record<string, Read<Decimal | number>>;
  scorecard: PerformanceScorecardRow[];
  contribution: { period: string; unit: "pts_of_nav"; rows: { target_id: TargetId; label: string; points: Decimal }[] };
  /** `null` months are no data, not zero. */
  monthly: { unit: "ratio"; rows: { year: number; months: (Decimal | null)[]; ytd: Decimal | null }[] };
}

/** §3.16 */
export interface MarketBenchmarkSeries {
  id: string;
  legacy_id: string;
  label_en: string;
  label_zh: string;
  kind: "index";
}

/** §3.17, §3.18 */
export type AlertKind = NeedsKind | "digest" | "delivery_failed" | "candidate_ready";
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
export interface Alerts extends DeskEnvelope {
  counts: { open: number; critical: number; warning: number; info: number; last_7d_total: number };
  items: AlertItem[];
  next_cursor: string | null;
}
export interface AlertDelivery {
  ok: true;
  channel: { name: string; status: Read<"ok" | "failing"> };
  last_delivery: { at: IsoTime; outcome: string; recipients: number } | null;
  digest: { schedule_utc: string; last_composed_at: IsoTime | null; targets: number; runs: number } | null;
}

/** §3.19 Messages are plain text; render as text, never HTML. */
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface LogItem {
  id: string;
  at: IsoTime;
  level: LogLevel;
  source: string;
  run_id: string | null;
  message: string;
}
export interface Logs {
  ok: true;
  items: LogItem[];
  next_cursor: string | null;
  retention: { days: number; truncated: boolean };
  redaction: "applied";
}
