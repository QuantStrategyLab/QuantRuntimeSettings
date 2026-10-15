/** Public display contracts. Opaque bindings are passed back unchanged, never rendered. */
export type Status =
  "ok" | "partial" | "stale" | "no_data" | "not_connected" | "unavailable";
export type Reason =
  | "external_cashflow_required"
  | "fills_not_connected"
  | "avg_cost_missing"
  | "mixed_currency"
  | "snapshot_history_missing"
  | "snapshot_missing"
  | "previous_snapshot_missing"
  | "non_trading_weekend"
  | "incomplete_month"
  | "insufficient_observations"
  | "invalid_return_period"
  | "positions_partial_coverage"
  | "positions_not_connected"
  | "positions_stale"
  | "benchmark_history_unreadable"
  | "position_value_missing"
  | "no_common_date"
  | "benchmark_history_missing"
  | "stored_records_unreadable"
  | "effect_verification_not_recorded"
  | "bounded_audit_log"
  | "no_closed_trades";
export type Scalar = string | number | boolean | null;
export type Category =
  | "reconciliation_recovery"
  | "strategy_promotion"
  | "owner_decision"
  | "credential_maintenance"
  | "paper_account_application";
export interface DecisionDiff {
  field: string;
  label_key: string;
  before: Scalar;
  after: Scalar;
  affects_live: boolean;
}
export interface DecisionFields {
  category: Category;
  priority: "high" | "medium" | "normal";
  created_at: string | null;
  expires_at: string | null;
  evidence_freshness: { status: string; as_of: string | null };
  status: "pending" | "decided" | "expired";
  affects_live: boolean;
  diff: DecisionDiff[];
}
export interface InboxItem extends DecisionFields {
  id: string;
  short_id: string;
  application_status?: string | null;
  title_key: string;
  account_alias: string | null;
  platform: string | null;
  decision_binding: {
    kind: string;
    subject_id: string;
    material_sha256: string;
    review_binding?: unknown;
  } | null;
}
export interface InboxResponse {
  status: "ok" | "partial" | "read_failed";
  sources: {
    source: string;
    status: "ok" | "stale" | "unavailable" | "read_failed";
  }[];
  items: InboxItem[];
  coverage: string;
  no_order: true;
  execution_authority_granted: false;
}
export interface DecisionHistoryItem {
  id: string;
  short_id: string;
  item_id: string;
  item_short_id: string;
  category: Category;
  actor_alias: string | null;
  time: string;
  action: "adopt_intent" | "decline_intent";
  evidence_sha256: string;
}
export interface DecisionHistoryResponse {
  status: "ok";
  items: DecisionHistoryItem[];
  next_cursor: string | null;
  coverage: string;
}
export interface ReadFailed {
  status: "read_failed";
  unavailable_reason: "stored_records_unreadable";
}
export type SettingsSection =
  "strategy" | "dca" | "cash_reserve" | "income_layer" | "options_layer";
export type DraftField =
  | "strategy_profile"
  | "dca_mode"
  | "dca_base_investment_usd"
  | "reserved_cash_floor"
  | "reserved_cash_ratio"
  | "income_layer_enabled"
  | "option_overlay_enabled";
export interface SettingsDiffRow {
  section: SettingsSection;
  field: DraftField;
  label_key: string;
  current: Scalar;
  draft: Scalar;
  affects_live: boolean;
  current_status: "known" | "unknown";
  overridden: boolean;
  changed: boolean;
}
export interface SettingsDiffResponse {
  status: "ok" | "partial";
  account_alias: string;
  platform: string;
  draft_revision: number;
  identity_status: string;
  rows: SettingsDiffRow[];
  no_order: true;
  execution_authority_granted: false;
}
export interface CombinedDraftRequest {
  platform: string;
  key: string;
  identity: Record<string, unknown>;
  expected_draft_revision: number;
  acknowledge_identity_conflict?: boolean;
  overrides: Partial<Record<DraftField, string | boolean | null>>;
}
/** Same response as the legacy POST /api/account-settings. Retain the whole payload for conflict checks. */
export interface CombinedDraftResponse {
  ok: true;
  platform: string;
  key: string;
  instance_revision: number;
  identity: Record<string, unknown>;
  draft: {
    status: string;
    revision: number;
    identity: unknown;
    current_identity: unknown;
    overrides: Partial<Record<DraftField, Scalar>>;
  };
  effective: Record<string, { status: string; value?: Scalar }>;
  adopted: false;
  no_order: true;
  execution_authority_granted: false;
  [key: string]: unknown;
}
export interface SettingsHistoryResponse {
  status: "partial";
  account_alias: string;
  platform: string;
  items: {
    id: string;
    short_id: string;
    event: "draft_saved" | "approved";
    time: string;
    actor_alias: string | null;
    draft_revision: number | null;
    source: string;
  }[];
  next_cursor: string | null;
  coverage: string;
  availability: Record<
    "draft_saved" | "approved" | "effect_verification",
    { status: Status; unavailable_reason: Reason | null }
  >;
}
export interface AccountsResponse {
  status: "ok" | "partial";
  coverage: string;
  unassigned_decision_count: number;
  accounts: {
    account_alias: string;
    platform: string;
    pending_draft_count: number;
    pending_decision_count: number | null;
    last_change_at: string | null;
  }[];
}
export type Range = "1M" | "3M" | "YTD" | "1Y" | "ALL";
export interface PerformanceCoverage {
  account_aliases: string[];
  currencies?: string[];
  excluded_accounts?: string[];
  omitted_dates?: number;
  cashflows?: "unknown" | "complete";
  fx?: "not_applied" | "native_currency";
  trading_dates?: string;
  truncated?: boolean;
  read_failures?: string[];
}
export interface PerformanceMeta {
  schema_version: "console_api.v1";
  scope: string;
  range: Range;
  status: Status;
  unavailable_reason: Reason | null;
  as_of: string | null;
  value_kind: "pnl" | "asset_change";
  coverage:
    | PerformanceCoverage
    | { account_alias: string; scope: string }[]
    | "fills_not_connected";
  currency?: string | null;
}
export interface Point {
  date: string;
  value: number;
  breakBefore?: boolean;
}
export interface CalendarCell {
  date?: string;
  month?: string;
  amount: number | null;
  return_percent: number | null;
  currency: string | null;
  status: Status;
  value_kind: "pnl" | "asset_change";
  unavailable_reason: Reason | null;
  observed_amount?: number | null;
  coverage?: { observed_days: number; expected_weekdays: number };
}
export interface CalendarResponse extends PerformanceMeta {
  year: number;
  month: number | null;
  cells: CalendarCell[];
}
export interface DailyChange {
  date: string;
  amount: number | null;
  return_percent: number | null;
  value_kind: "pnl" | "asset_change";
  status: Status;
  unavailable_reason: Reason | null;
}
export interface SummaryResponse extends PerformanceMeta {
  twr_return_percent: number | null;
  amount: number | null;
  simple_weighted_return_percent: number | null;
  max_drawdown: {
    percent: number | null;
    peak_date: string | null;
    trough_date: string | null;
    unavailable_reason: Reason | null;
  };
  best_day: DailyChange | null;
  worst_day: DailyChange | null;
  excess_returns: {
    benchmark: string;
    start: string;
    end: string | null;
    percentage_points: number | null;
    unavailable_reason: Reason | null;
  }[];
}
export interface ReturnsResponse extends PerformanceMeta {
  aligned_start: string | null;
  return_kind: "twr" | "unadjusted_asset_ratio";
  points: Point[];
  benchmarks: { id: string; points: Point[] }[];
  no_common_date: boolean;
  per_currency: {
    currency: string;
    return_kind: string;
    status: Status;
    unavailable_reason: Reason | null;
    aligned_start: string | null;
    points: Point[];
    benchmarks: { id: string; points: Point[] }[];
  }[];
  benchmark_availability: {
    id: string;
    status: Status;
    unavailable_reason: Reason | null;
    as_of: string | null;
  }[];
}
export interface AssetsResponse extends PerformanceMeta {
  points: Point[];
}
export interface HoldingsResponse extends PerformanceMeta {
  label_key: "performance.current_holdings_unrealized";
  rows: {
    account_alias: string;
    platform: string;
    symbol: string;
    quantity: number | null;
    market_value: number | null;
    currency: string;
    avg_cost: number | null;
    unrealized_pnl: number | null;
    unavailable_reason: Reason | null;
    coverage: string;
    status: Status;
  }[];
}
export interface TradeStatsResponse extends PerformanceMeta {
  status: "not_connected";
  unavailable_reason: "fills_not_connected";
}
export interface ApiError {
  ok: false;
  error: string;
  no_order?: true;
  execution_authority_granted?: false;
}

export interface PerformanceUnavailable extends PerformanceMeta {
  status: "unavailable";
}

export interface ReadOnlyProjection {
  no_order: true;
  execution_authority_granted: false;
}
export interface TodayRunSummary extends ReadOnlyProjection {
  status: "ok" | "partial" | "read_failed";
  date: string;
  timezone: "Asia/Shanghai";
  as_of: string | null;
  coverage: string;
  counts: { configured: number; observed: number; runs: number | null };
  accounts: {
    account_alias: string;
    platform: string;
    status: "ok" | "stale" | "no_data" | "not_connected" | "read_failed";
    unavailable_reason: string | null;
    as_of: string | null;
    activity: string | null;
    run_count: number | null;
    runs: { id: string; started_at: string | null; finished_at: string | null;
      activity: string; execution_lane: string; errors_present: boolean | null }[];
  }[];
}
export interface StrategySummary extends ReadOnlyProjection {
  status: "ok" | "partial" | "stale" | "not_connected" | "read_failed";
  as_of: string | null;
  coverage: string;
  strategies: {
    profile: string;
    domain: string;
    allowed_execution_modes: string[];
    configured_accounts: { account_alias: string; platform: string }[];
    health_status: string | null;
    health_score: number | null;
    status: "ok" | "stale" | "not_connected" | "read_failed";
    unavailable_reason: string | null;
  }[];
}
export interface NotificationSendLog extends ReadOnlyProjection {
  status: "not_connected";
  unavailable_reason: "notification_log_not_connected";
  as_of: null;
  items: never[];
  next_cursor: null;
  coverage: "no_delivery_source";
}
export interface RunControlAvailability extends ReadOnlyProjection {
  status: "ok" | "partial";
  account_alias: string;
  platform: string;
  as_of: string;
  actions: Record<"enable" | "stop" | "resume" | "approve_application", {
    enabled: boolean;
    reason: string;
    requires_confirmation: true;
  }>;
  resume_binding?: { runtime_target_sha256: string };
}
