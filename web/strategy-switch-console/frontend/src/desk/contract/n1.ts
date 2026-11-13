/**
 * N1 local read projection types (docs/desk-n1-read-projection-contract.md).
 *
 * Five Desk reads use `qsl.desk.{ribbon,overview,accounts,switch_strategies,performance}.v2`.
 * These types are local to those five responses: the global v1 Read, Mode and
 * response types in ./types.ts are unchanged and keep serving the v1 fixtures
 * and every non-N1 endpoint. The same types are the page view model; a v1
 * fixture is normalised into them only for `source=mock` (see api/n1.ts).
 */
import type {
  Benchmark, BookRow, CredentialSummary, Decimal, Freshness, GatewayState, IsoDate, IsoTime, MarketSession, Mode,
  NeedsYouItem, OverviewTotals, PortfolioBasis, RangeId, Read, ReturnBasis, RunOutcome, ScorecardRow, StrategyRef,
  TapeState, TargetId, Currency, Performance,
} from "./types";

export type N1Reason =
  | "never_read" | "read_failed" | "source_unavailable" | "identity_unverified" | "not_supported"
  | "insufficient_history" | "coverage_incomplete" | "mixed_currency" | "time_basis_unavailable";

/** Evidenced source/identity counts; an unknown total stays null. */
export interface N1Coverage {
  state: "complete" | "partial" | "unavailable" | "verified_empty";
  included: number;
  total: number | null;
  reasons: N1Reason[];
}

export type N1Read<T> =
  | { status: "known"; value: T; observed_at: IsoTime; coverage: N1Coverage }
  | { status: "stale"; value: T; observed_at: IsoTime; age_seconds: number; coverage: N1Coverage }
  /** `value` is only the verified subset; unknown members are null, never zero. */
  | { status: "partial"; value: T; observed_at: IsoTime; coverage: N1Coverage }
  | { status: "unknown"; reason: N1Reason; observed_at?: IsoTime | null; coverage: N1Coverage };

export interface N1TimeBasis {
  view_timezone: string;
  source_domains: { source_key: string; timezone: string }[];
}

interface N1Envelope<V extends string> {
  ok: true;
  schema_version: V;
  generated_at: IsoTime;
  time_basis: N1TimeBasis;
}

// ---------------------------------------------------------------- ribbon

export interface N1TapeEntry {
  id: string;
  at: IsoTime;
  target_id: TargetId;
  label: string;
  kind: string;
  outcome: RunOutcome | null;
  outcome_detail: string | null;
  state: TapeState;
  source_business_date: IsoDate;
  source_timezone: string;
}

export interface N1Ribbon extends N1Envelope<"qsl.desk.ribbon.v2"> {
  /** A UTC day: a Desk display slice, not a source business day. */
  date: IsoDate;
  date_basis: "utc_day";
  freshness: Freshness;
  console_state: { mode: N1Read<Mode>; gateways: Read<GatewayState> };
  /** No alerts store yet: unknown, rendered "?" and never 0. */
  alert_badge: N1Read<{ open_count: number; critical_count: number }>;
  sessions: MarketSession[];
  next_run: N1Read<{ target_id: TargetId; kind: string; due_at: IsoTime } | null>;
  tape: N1Read<N1TapeEntry[]>;
}

// ---------------------------------------------------------------- overview

export interface N1BookRow extends Omit<BookRow, "config"> {
  config: { state: BookRow["config"]["state"]; drift_count: N1Read<number>; checked_at: IsoTime | null };
}

export interface N1RunsToday {
  done: number | null;
  expected: number | null;
  pending: OverviewTotals["runs_today"]["pending"] | null;
  source_business_date: IsoDate;
  source_timezone: string;
}

export interface N1OverviewTotals extends Omit<OverviewTotals, "coverage" | "runs_today" | "config_drift"> {
  excluded_reasons: OverviewTotals["coverage"]["excluded_reasons"];
  coverage: N1Coverage;
  runs_today: N1Read<N1RunsToday>;
  config_drift: N1Read<{ count: number | null; target_ids: TargetId[] | null }>;
}

export interface N1EquityCurve {
  range: RangeId;
  portfolio: { dates: IsoDate[]; indexed: Decimal[] };
  drawdown: Decimal[];
  history_starts: IsoDate | null;
  return_basis: PortfolioBasis;
}

export interface N1Overview extends N1Envelope<"qsl.desk.overview.v2"> {
  snapshot_at: IsoTime | null;
  freshness: Freshness;
  reporting_currency: Currency;
  totals: N1OverviewTotals;
  book: N1Read<N1BookRow[]>;
  equity_curve: N1Read<N1EquityCurve>;
  needs_you: N1Read<NeedsYouItem[]>;
}

// ---------------------------------------------------------------- accounts

export interface N1BrokerHealth {
  platform: string;
  label: string;
  targets: { target_id: TargetId; account_ref: string }[];
  connectivity: N1Read<"up" | "degraded" | "down">;
  connectivity_detail: string | null;
  heartbeat: N1Read<{ at: IsoTime }>;
  data_freshness: Freshness;
  config: { state: "synced" | "drift" | "unknown"; drift_count: N1Read<number>; checked_at: IsoTime | null };
  credential: CredentialSummary;
  last_order: N1Read<{ at: IsoTime; count: number }>;
}

export interface N1Accounts extends N1Envelope<"qsl.desk.accounts.v2"> {
  brokers: N1Read<N1BrokerHealth[]>;
}

// ---------------------------------------------------------------- switch strategies

export type N1Eligibility = "eligible" | "no_live" | "blocked";
export type N1EligibilityReason = "domain_not_supported" | "strategy_frozen" | "platform_live_not_supported" | "catalog_not_live_enabled";

export interface N1StrategyRow {
  profile: string;
  label: string;
  domain: string;
  allowed_execution_modes: Mode[];
  lifecycle_stage: string;
  eligibility: N1Read<N1Eligibility>;
  reason: N1EligibilityReason | null;
}

export interface N1SwitchStrategies extends N1Envelope<"qsl.desk.switch_strategies.v2"> {
  target_id: TargetId;
  domain: N1Read<string>;
  /** Configuration compatibility is not runtime switchability. */
  switchable: { allowed: false; reason_code: "switch_not_connected" };
  /** A projection fingerprint, not a Git commit or runtime version. */
  catalog_revision: N1Read<{ kind: "projection_fingerprint"; algorithm: "sha256"; value: string }>;
  strategies: N1Read<N1StrategyRow[]>;
}

// ---------------------------------------------------------------- performance

export interface N1EquitySeries {
  dates: IsoDate[];
  portfolio_indexed: Decimal[];
  drawdown_ratio: Decimal[];
  /** The observation that follows a proven break; never interpolated. */
  gap_dates: IsoDate[];
  gap_semantics: "break_before_observation";
}

export interface N1Performance extends N1Envelope<"qsl.desk.performance.v2"> {
  range: RangeId;
  scope: "all";
  history: { first_date: IsoDate | null; requested_from: IsoDate | null; truncated_by: "retention" | "inception" | null; retention_days: 366 };
  return_basis: { kind: PortfolioBasis; per_target: Record<TargetId, ReturnBasis> };
  equity: N1Read<N1EquitySeries>;
  risk: {
    return_ratio: N1Read<Decimal>;
    vs_benchmark_pts: N1Read<Decimal>;
    volatility_ann_ratio: N1Read<Decimal>;
    sharpe: N1Read<Decimal>;
    sortino: N1Read<Decimal>;
    max_drawdown_ratio: N1Read<Decimal>;
    time_under_water_days: N1Read<number>;
    best_day_ratio: N1Read<Decimal>;
    worst_day_ratio: N1Read<Decimal>;
  };
  scorecard: N1Read<ScorecardRow[]>;
  contribution: N1Read<Performance["contribution"]>;
  monthly: N1Read<Performance["monthly"]>;
}

export type { Benchmark, StrategyRef };
