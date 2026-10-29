/** Public display contracts. Opaque bindings are passed back unchanged, never rendered. */
export type Status =
  "ok" | "partial" | "stale" | "no_data" | "not_connected" | "unavailable";
export type Reason =
  | "external_cashflow_required"
  | "fills_not_connected"
  | "execution_coverage_unverified"
  | "avg_cost_missing"
  | "mixed_currency"
  | "snapshot_history_missing"
  | "snapshot_missing"
  | "snapshot_pending"
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
  | "no_closed_trades"
  | "no_cashflow_data"
  | "insufficient_history"
  | "no_snapshot"
  | "snapshot_stale"
  | "valuation_date_mismatch"
  | "incomplete_account_coverage"
  | "invalid_valuation_date"
  | "invalid_balance"
  | "duplicate_currency"
  | "identity_mismatch"
  | "identity_not_bound"
  | "aggregation_duplicate"
  | "aggregation_conflict"
  | "account_facts_disabled"
  | "currency_mismatch";
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
export type InitialEnrollmentSurfaceName =
  | "positions"
  | "cash"
  | "open_orders"
  | "recent_executions"
  | "local_execution_ledger";
export type InitialEnrollmentSurfaceStatus = "complete" | "partial" | "unknown";
/** Facts stay as returned strings, nulls and nested source objects; amounts are never parsed. */
export type InitialEnrollmentFactValue =
  | string
  | number
  | boolean
  | null
  | readonly InitialEnrollmentFactValue[]
  | { readonly [key: string]: InitialEnrollmentFactValue };
export interface InitialEnrollmentScope {
  kind: string | null;
  currency: string | null;
  window_start: string | null;
  window_end: string | null;
  limit_per_namespace: string | null;
  gateway_availability: string | null;
  truncated: string | null;
}
export interface InitialEnrollmentSurface {
  status: InitialEnrollmentSurfaceStatus;
  items: readonly InitialEnrollmentFactValue[] | null;
  scope: InitialEnrollmentScope | null;
}
export interface InitialEnrollmentFactsData {
  observed_at: string | null;
  surfaces: Partial<Record<InitialEnrollmentSurfaceName, InitialEnrollmentSurface>> | null;
}
/** The inbox projection is display material only; confirmation uses a fresh server read. */
export interface InitialEnrollmentProjection {
  facts: InitialEnrollmentFactsData | null;
  candidate_sha256: string;
  facts_sha256: string;
  readiness?: string | null;
  blocker_codes?: string[] | null;
}
export interface InboxItem extends DecisionFields {
  presentation?: RecoveryMaterialPresentation;
  initial_enrollment?: InitialEnrollmentProjection;
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
export type InboxErrorState = "quota_exhausted" | "unauthorized" | "index_missing"
  | "index_incomplete" | "index_unavailable" | "unknown";
export interface InboxResponse {
  error_state?: InboxErrorState | null;
  directory?: DirectoryStatus | null;
  status: "ok" | "partial" | "read_failed";
  sources: {
    source: string;
    status: "ok" | "stale" | "unavailable" | "read_failed";
    error_state?: InboxErrorState;
    current_reconciliation_observation?: CurrentReconciliationObservation;
    failure_reason?: "unauthorized" | "unknown" | "kv_list_daily_limit_exceeded" | "kv_directory_uninitialized" | "kv_directory_unavailable" | "kv_directory_truncated" | "kv_directory_migration_pending" | "kv_directory_migration_failed" | "kv_directory_record_unavailable";
  }[];
  items: InboxItem[];
  coverage: string;
  no_order: true;
  execution_authority_granted: false;
}
export interface RecoveryMaterialPresentation {
  material_kind: "historical_recovery_approval_material" | "recovery_approval_material" | "initial_enrollment";
  label: { zh: string; en: string };
  decision_status: "approved" | "rejected" | "undecided" | "unknown";
  decision_status_label: { zh: string; en: string };
  strategy_profile: string;
  source_generated_at: string | null;
  source_computed_at: string | null;
  last_observed_at: string | null;
}
export interface CurrentReconciliationObservation {
  label: { zh: string; en: string };
  connection_status: "connected" | "not_connected";
  data_status: "ready" | "stale" | "unavailable" | "unknown";
  comparison_status: "matched" | "mismatched" | "incomparable" | "unknown";
  status_label: { zh: string; en: string };
  generated_at: string | null;
  computed_at: string | null;
  last_observed_at: string | null;
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
  /** Single-account native daily returns: observed days only, gaps are never chained. */
  native_daily_only?: boolean;
}
export interface AccountFreshness {
  platform: string | null;
  account_alias: string;
  account_ref: string | null;
  as_of: string | null;
  freshness: "fresh" | "stale" | "unknown";
  fresh: boolean | null;
  stale: boolean | null;
  unavailable_reason: Reason | null;
}
export interface FreshnessCounts { fresh: number; stale: number; unknown: number; threshold_hours: number }
export interface CurrencyAccountCoverage extends AccountFreshness {
  included: boolean;
  observation_date: string | null;
}
export interface CurrencyTotal {
  /** Present for totals of each account's latest known balance; absent on legacy same-date totals. */
  latest_as_of?: string | null;
  observation_date?: string | null;
  account_coverage?: CurrencyAccountCoverage[];
  currency: string;
  total: number | null;
  account_count: number;
  expected_account_count: number;
  excluded_account_count?: number;
  as_of: string | null;
  stale: boolean | null;
  status: Status;
  unavailable_reason: Reason | null;
}
export interface Drawdown {
  percent: number | null;
  peak_date: string | null;
  trough_date: string | null;
  unavailable_reason: Reason | null;
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
    | { account_alias: string; platform?: string; account_ref?: string; scope: string }[]
    | "fills_not_connected";
  currency?: string | null;
  account_freshness?: AccountFreshness[];
  freshness_summary?: FreshnessCounts;
}
export interface Point {
  date: string;
  value: number;
  /** Native daily TWR percentage (not a ratio); absent when the backend cannot chain a day. */
  daily_return_percent?: number;
  breakBefore?: boolean;
  contributing_accounts?: string[];
  missing_accounts?: string[];
  forward_filled_accounts?: string[];
  partial?: boolean;
  membership_changed?: boolean;
}
export interface HistoryCoverage {
  omitted_dates: number;
  missing_accounts?: string[];
  max_staleness_days?: number;
  partial_points?: number;
  missing_points?: number;
  forward_filled_points?: number;
  truncated?: boolean;
  read_failures?: string[];
  membership_changed?: boolean;
  return_comparison?: "within_contributing_cohort_only" | "fixed_contributing_cohort";
  excluded_accounts?: string[];
  fx?: string;
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
  per_account?: (CalendarResponse & { platform: string; account_alias: string })[];
  year: number;
  month: number | null;
  cells: CalendarCell[];
  available_currencies?: string[];
}
export interface DailyChange {
  date: string;
  amount: number | null;
  return_percent: number | null;
  value_kind: "pnl" | "asset_change";
  status: Status;
  unavailable_reason: Reason | null;
}
/** Optional cash-flow method metadata from the API; absent on older responses. */
export interface CashflowMethodMeta {
  cashflow_method?: "modified_dietz" | string | null;
  approximate?: boolean | null;
}
export interface SummaryResponse extends PerformanceMeta, CashflowMethodMeta {
  per_account?: (SummaryResponse & { platform: string; account_alias: string })[];
  cashflow_per_currency?: CashflowReturnMetrics[];
  metric_reasons?: { twr: Reason | null };
  per_currency?: (CurrencyTotal & { max_drawdown: Drawdown } & CashflowMethodMeta)[];
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
export interface ReturnsResponse extends PerformanceMeta, CashflowMethodMeta {
  per_account?: (ReturnsResponse & { platform: string; account_alias: string })[];
  cashflow_per_currency?: CashflowReturnMetrics[];
  aligned_start: string | null;
  return_kind: "twr" | "unadjusted_asset_ratio";
  points: Point[];
  benchmarks: { id: string; points: Point[] }[];
  no_common_date: boolean;
  per_currency: ({
    currency: string;
    as_of?: string | null;
    coverage?: HistoryCoverage;
    return_kind: string;
    status: Status;
    unavailable_reason: Reason | null;
    aligned_start: string | null;
    points: Point[];
    benchmarks: { id: string; points: Point[] }[];
  } & CashflowMethodMeta)[];
  benchmark_availability: {
    id: string;
    status: Status;
    unavailable_reason: Reason | null;
    as_of: string | null;
  }[];
}
export interface AssetsResponse extends PerformanceMeta {
  curve_status?: Status;
  curve_unavailable_reason?: Reason | null;
  curve_coverage?: HistoryCoverage | null;
  per_currency?: CurrencyTotal[];
  points: Point[];
  history_per_currency?: {
    currency: string;
    as_of: string | null;
    coverage: HistoryCoverage;
    status: Status;
    unavailable_reason: Reason | null;
    points: Point[];
  }[];
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
    broker_cost_price?: string | null;
    broker_cost_method?: "broker_configured" | string | null;
    unrealized_pnl: number | null;
    unavailable_reason: Reason | null;
    coverage: string;
    status: Status;
  }[];
}
/**
 * Broker executions are observed facts, not orders or a complete P/L ledger.
 * quantity/price are decimal strings and commission/taxes are nullable signed
 * decimal strings; they stay strings end-to-end so display never re-rounds them.
 */
export interface ExecutionRow {
  platform: string;
  account_alias: string;
  execution_ref: string;
  report_ref: string;
  trade_date: string;
  local_time: string | null;
  time_zone: string | null;
  symbol: string;
  asset_category: string;
  side: "BUY" | "SELL";
  quantity: string;
  price: string;
  currency: string;
  commission: string | null;
  commission_currency: string | null;
  taxes: string | null;
}
export interface ExecutionsResponse {
  schema_version: "console_api.v1";
  scope: string;
  range: Range;
  status: Status;
  unavailable_reason: Reason | null;
  as_of: string | null;
  coverage: unknown[];
  value_kind: "pnl";
  rows: ExecutionRow[];
  /** Equals rows.length for the current range; never a complete-history count. */
  reported_execution_count: number | null;
  per_currency: {
    currency: string;
    reported_execution_count: number;
    buy_execution_count: number;
    sell_execution_count: number;
  }[];
  win_rate_percent: null;
  realized_pnl: null;
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
export type RunState = "succeeded" | "failed" | "blocked" | "no_data" | "not_connected" | "not_run" | "unknown" | "read_failed" | "incomplete";
export interface TodayRunSummary extends ReadOnlyProjection {
  status: "ok" | "partial" | "read_failed";
  date: string;
  timezone: "America/New_York";
  as_of: string | null;
  coverage: string;
  counts: { configured: number; observed: number; runs: number | null; by_state?: Record<RunState, number> };
  accounts: {
    account_alias: string;
    platform: string;
    status: "ok" | "partial" | "stale" | "no_data" | "not_connected" | "read_failed";
    unavailable_reason: string | null;
    as_of: string | null;
    activity: string | null;
    run_status?: RunState;
    run_status_reason?: string | null;
    /** Optional read-error metadata; absent or null means unreported, not a confirmed clean read. */
    read_error_count?: number | null;
    read_error_codes?: string[] | null;
    freshness?: string;
    fresh?: boolean;
    stale?: boolean;
    completeness: "complete" | "incomplete" | null;
    run_count: number | null;
    runs: { id: string; started_at: string | null; finished_at: string | null;
      activity: string; execution_lane: string; errors_present: boolean | null }[];
  }[];
}
export interface AccountExecutionEvidence {
  value: "live" | "paper" | "dry_run" | "unknown";
  status: "confirmed" | "config_missing" | "not_connected" | "read_failed" | "permission_denied";
  reason_codes: string[];
  broker_environment: "live" | "paper" | null;
  execution_mode: "live" | "paper" | "dry_run" | null;
  dry_run_only: boolean | null;
  environment_source: string | null;
  configuration_source: string | null;
  observed_at: string | null;
  runtime_observation_status: "unknown";
}
export interface StrategySummary extends ReadOnlyProjection {
  status: "ok" | "partial" | "stale" | "not_connected" | "read_failed";
  as_of: string | null;
  coverage: string;
  configured_accounts_source?: "currentStrategies";
  account_assignment_status?: "complete" | "partial" | "unavailable" | "read_failed";
  account_assignment_read_failures?: { platform: string; account_alias: string; status: "read_failed" | "permission_denied" }[];
  strategies: {
    profile: string;
    domain: string;
    allowed_execution_modes: string[];
    configured_accounts: {
      account_alias: string; platform: string; account_ref?: string;
      execution_evidence?: AccountExecutionEvidence;
      execution_mode?: "live" | "paper" | "dry_run" | "unknown";
      dry_run_only?: boolean | null;
      live_status?: "configured_live" | "not_live" | "unknown";
      continuation_reason?: "legacy_live_continuation" | null;
      mode_source?: "RUNTIME_TARGET_JSON" | "CLOUD_RUN_SERVICE_TARGETS_JSON" | "STRATEGY_PROFILE" | null;
      runtime_observation_status?: "unknown";
    }[];
    as_of?: string | null;
    freshness?: { status: "fresh" | "stale" | "unknown"; age_seconds: number | null } | null;
    health_status: StrategyHealthStatus | null;
    health_score: number | null;
    status: "ok" | "stale" | "not_connected" | "read_failed";
    unavailable_reason: string | null;
  }[];
}
export interface NotificationReceiptItem {
  id: string;
  source_run_id: number;
  source_run_attempt: number;
  source_sha: string;
  source_url: string;
  workflow_updated_at: string | null;
  sent_at: string | null;
  channel: "telegram";
  status: string;
  receipt_status: string | null;
  business_day: string | null;
  report_date: string | null;
  delivered: boolean | null;
  dry_run: boolean | null;
  test_message: boolean | null;
  reason_code: string | null;
}
export interface NotificationSendLog extends ReadOnlyProjection {
  status: "ok" | "partial" | "read_failed" | "not_connected";
  read_status?: "complete" | "partial" | "no_data" | "unknown" | "read_failed" | "not_connected";
  read_reason_codes?: string[];
  unavailable_reason: string | null;
  as_of: string | null;
  items: NotificationReceiptItem[];
  next_cursor: null;
  coverage: "no_delivery_source" | "recent_daily_digest_public_receipts_only";
  run_limit?: number;
  truncated?: boolean;
  read_failure_count?: number;
}
export interface RunControlAvailability extends ReadOnlyProjection {
  status: "ok" | "partial";
  account_alias: string;
  platform: string;
  as_of: string;
  actions: Record<"enable" | "stop" | "resume" | "approve_application", {
    enabled: boolean;
    reason: RunControlReason;
    requires_confirmation: true;
  }>;
  resume_binding?: { runtime_target_sha256: string };
  runtime_control?: { request_id: string | null; action: "enable" | "disable" | null;
    phase: "reserved" | "accepted" | "unknown" | "partial" | "applied" | "protected" | "rejected" | null;
    unavailable_reason: string | null; platform_applied: boolean };
}

export type StrategyHealthStatus = "healthy" | "watch" | "review" | "critical";
export type RunControlReason = "available" | "admin_required" | "strategy_application_not_connected"
  | "dispatch_unavailable" | "existing_recovery_not_available" | "profile_draft_required"
  | "stop_pending_or_identity_unavailable" | "stored_records_unreadable" | "runtime_readback_unavailable" | "runtime_control_pending"
  | "runtime_instances_not_bound" | "account_settings_identity_conflict" | "profile_only_required"
  | "profile_not_selectable" | "runtime_target_not_disabled" | "current_profile_conflict" | "profile_application_pending";
export type DirectoryError = "kv_directory_uninitialized" | "kv_directory_unavailable"
  | "kv_directory_migration_pending" | "kv_directory_migration_failed" | "kv_list_daily_limit_exceeded";
/** Epoch milliseconds; null means unrecorded. in_progress means a pagination cursor is pending. */
export interface DirectoryStatus {
  status: "unknown" | "incomplete" | "complete" | "read_failed";
  complete: boolean | null;
  last_success: number | null;
  last_error: { code: DirectoryError; at: number | null } | null;
  retry_at: number | null;
  in_progress: boolean | null;
  data_as_of: number | null;
  unavailable_reason: DirectoryError | null;
}
export type ResearchHorizon = "short" | "medium" | "long" | "not_applicable";
export interface M0ResearchDashboard {
  schema_version: "qsl_m0_research_dashboard.v1";
  source_ledger_sha256: string | null;
  source_generated_at: string | null;
  source_computed_at: string | null;
  viewed_at: string;
  data_status: "ready" | "stale" | "unavailable";
  summary: Record<"subject_count" | "observation_count" | "fresh_observation_count"
    | "stale_observation_count" | "unknown_observation_count" | "horizon_conflict_count"
    | "historical_stale_horizon_drift_count", number>;
  subjects: {
    subject: { kind: "asset_idea" | "theme_context" | "strategy_hypothesis" | "risk_context"; identifier: string };
    observations: {
      source_ids: string[];
      source_report_digest: string;
      source_entry_digest: string;
      hypothesis_id: string;
      as_of: string;
      generated_at: string;
      expires_at: string;
      research_context: {
        state: "candidate" | "source_verification_required" | "deferred" | "context_only";
        primary_horizon: ResearchHorizon;
        suitable_horizons: ResearchHorizon[];
        source_confidence: "high" | "medium" | "low" | "mixed" | "no_event" | "unknown";
        source_style: "event_driven" | "long_horizon_growth" | "value_quality" | "macro_context" | "mixed_research";
        theme_ids: string[];
      };
      freshness: { status: "fresh" | "stale" | "unknown"; age_seconds: number | null };
    }[];
    horizon_conflict: { status: "none" | "conflict"; primary_horizons: ResearchHorizon[] };
    historical_stale_horizon_drift: { status: "none" | "drift" | "unavailable"; primary_horizons: ResearchHorizon[] };
  }[];
  policy: { authority: "research_only"; no_order: true; permitted_next_step: "research_validation_only"; notice: string };
  errors: string[];
}

export interface CashflowReturnMetrics {
  currency: string;
  status: Status;
  unavailable_reason: Reason | null;
  twr_return_percent: number | null;
  max_drawdown: SummaryResponse["max_drawdown"];
  points: Point[];
  return_kind: "twr" | "unadjusted_asset_ratio";
  cashflow_method: "modified_dietz";
  approximate: boolean;
  multi_day_intervals?: boolean;
}

/**
 * Read-only projection of GET /api/account-facts. Broker-reported amounts stay
 * decimal strings exactly as returned; null net_assets means the broker did not
 * report a value, never zero. Per-currency rows are never summed across
 * currencies and cash is never relabeled as buying power or available margin.
 */
export interface AccountFactsBalance {
  currency: string;
  net_assets: string | null;
  total_cash?: string | null;
  source_tag?: string;
  currency_source?: string;
}
export interface AccountFactsCash {
  currency: string;
  cash_balance?: string;
  available_cash?: string;
  frozen_cash?: string;
  settling_cash?: string;
  source_tag?: string;
  currency_source?: string;
}
export interface AccountFactsAccount {
  platform: string;
  account_key: string;
  binding_status: "bound" | "missing" | "duplicate";
  identity_status: "partial_identity" | "missing_identity";
  identity_source?: "protected_configuration";
  identity_mismatch: boolean;
  data_status: "fresh" | "stale" | "unavailable";
  broker_environment: string | null;
  account_scope: string | null;
  broker_account_type?: { value: string; source_tag: string };
  binding_environment?: "live" | "paper";
  /** Operator declaration for display grouping only; never broker-reported. */
  user_declaration?: {
    environment: "live" | "paper" | null;
    account_type: "cash" | "margin" | null;
    source: "user_declared";
  } | null;
  observation_date: string | null;
  observed_started_at: string | null;
  observed_finished_at: string | null;
  /**
   * Authoritative backend aggregation conclusion for this row: only "included"
   * rows have validated physical-account mappings and may join a sum. Missing
   * or unknown values are treated as unverified, never as included.
   */
  aggregation_status?: "included" | "unverified" | "conflict" | "duplicate";
  balances: AccountFactsBalance[];
  cash: AccountFactsCash[];
}
export interface AccountFactsResponse extends ReadOnlyProjection {
  ok: true;
  accounts: AccountFactsAccount[];
  totals: {
    status: "by_currency" | "unavailable";
    reason: string | null;
    by_currency: {
      currency: string;
      net_assets: string;
      available_cash: string | null;
      cash_balance: string | null;
      account_count: number;
    }[];
  };
  account_options_revision: number | null;
  enabled: true;
  configured: boolean;
}

/**
 * Dedicated single-account Binance facts. This wallet valuation is a provider
 * wallet rollup, not a complete account net value: it never joins the generic
 * AccountFactsAccount totals, cash, P/L, or TWR. Amounts stay decimal strings.
 */
export type BinanceWalletValuation =
  | {
      status: "available";
      amount: string;
      currency: "USDT";
      source: string;
      scope: string;
      observed_at: string;
      wallet_count: number;
    }
  | {
      status: "unavailable";
      amount: null;
      currency: null;
      source: string;
      scope: string;
      observed_at: null;
      wallet_count: null;
      reason_code: string;
    };
export interface BinanceAccountFactsAsset {
  asset: string;
  quantity: string;
  spot_free: string;
  spot_locked: string;
  flexible_earn: string;
}
export interface BinanceAccountFactsReport {
  platform: "binance";
  account_key: string;
  scope: "spot+flexible_earn";
  observed_finished_at: string;
  snapshot_atomic: false;
  assets: BinanceAccountFactsAsset[];
  uncovered_scopes: string[];
  wallet_valuation?: BinanceWalletValuation;
}
export type BinanceAccountFactsReportStatus = "available" | "missing" | "expired" | "unavailable";
/** Body of GET /api/binance-account-facts; `report` is present only when the status is available. */
export interface BinanceAccountFactsResponse {
  ok: true;
  report_status: BinanceAccountFactsReportStatus;
  report: BinanceAccountFactsReport | null;
}
