/** Synthetic replacements for the 2026-10-16 read-contract gaps; no captured account data. */
import type { M0ResearchDashboard, ReturnsResponse, StrategySummary, InboxResponse,
  DirectoryStatus, RunControlReason, RunControlAvailability } from "../../web/strategy-switch-console/frontend/src/api/contracts.ts";
import type { RuntimeDailySnapshot } from "../../web/strategy-switch-console/frontend/src/api/endpoints.ts";

const observed = "2026-10-16T05:00:00Z";
const readonly = { no_order: true, execution_authority_granted: false } as const;
export const m0Subjects: M0ResearchDashboard = {
  schema_version: "qsl_m0_research_dashboard.v1",
  source_ledger_sha256: "a".repeat(64), source_generated_at: observed, source_computed_at: observed,
  viewed_at: "2026-10-16T06:00:00Z", data_status: "ready",
  summary: { subject_count: 12, observation_count: 12, fresh_observation_count: 12,
    stale_observation_count: 0, unknown_observation_count: 0, horizon_conflict_count: 0,
    historical_stale_horizon_drift_count: 0 },
  subjects: Array.from({ length: 12 }, (_, i) => ({
    subject: { kind: "theme_context", identifier: `synthetic-subject-${i + 1}` },
    observations: [{ source_ids: ["synthetic-source"], source_report_digest: "b".repeat(64),
      source_entry_digest: (i + 1).toString(16).padStart(64, "0"), hypothesis_id: `synthetic-hypothesis-${i + 1}`,
      as_of: "2026-10-16", generated_at: observed, expires_at: "2026-10-17T05:00:00Z",
      research_context: { state: "context_only", primary_horizon: "not_applicable",
        suitable_horizons: ["not_applicable"], source_confidence: "no_event", source_style: "macro_context",
        theme_ids: ["synthetic-theme"] }, freshness: { status: "fresh", age_seconds: 3600 } }],
    horizon_conflict: { status: "none", primary_horizons: ["not_applicable"] },
    historical_stale_horizon_drift: { status: "none", primary_horizons: [] },
  })),
  policy: { authority: "research_only", no_order: true, permitted_next_step: "research_validation_only",
    notice: "Research context only" }, errors: [],
};

export const mixedReturns: ReturnsResponse = {
  schema_version: "console_api.v1", scope: "all", range: "ALL", status: "unavailable",
  unavailable_reason: "mixed_currency", as_of: null, value_kind: "asset_change", currency: null,
  coverage: { account_aliases: ["synthetic-usd", "synthetic-usdt"], currencies: ["USD", "USDT"],
    cashflows: "unknown", fx: "not_applied" }, aligned_start: null, return_kind: "unadjusted_asset_ratio",
  points: [], benchmarks: [], no_common_date: true, benchmark_availability: [],
  per_currency: [
    { currency: "USD", return_kind: "unadjusted_asset_ratio", status: "no_data",
      unavailable_reason: "external_cashflow_required", as_of: null, coverage: { omitted_dates: 2 },
      aligned_start: null, points: [], benchmarks: [] },
    { currency: "USDT", return_kind: "unadjusted_asset_ratio", status: "partial",
      unavailable_reason: "external_cashflow_required", as_of: "2026-10-15", coverage: { omitted_dates: 0 }, aligned_start: "2026-10-09",
      points: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${String(i + 9).padStart(2, "0")}`, value: i * 0.25 })),
      benchmarks: [] },
  ],
};

export const healthStates: StrategySummary = {
  status: "ok", as_of: observed, coverage: "configured_catalog_and_stored_health_not_runtime_deployment",
  strategies: (["healthy", "review", "watch", "critical"] as const).map((health_status, i) => ({
    profile: `synthetic-profile-${i}`, domain: "us_equity", allowed_execution_modes: ["paper"],
    configured_accounts: [], health_status, health_score: 70 - i * 10, status: "ok", unavailable_reason: null,
  })), ...readonly,
};

export const controlReasons = ["available", "admin_required", "strategy_application_not_connected", "dispatch_unavailable",
  "existing_recovery_not_available", "profile_draft_required", "stop_pending_or_identity_unavailable",
  "stored_records_unreadable", "runtime_readback_unavailable", "runtime_instances_not_bound",
  "account_settings_identity_conflict", "profile_only_required", "profile_not_selectable",
  "runtime_target_not_disabled", "current_profile_conflict", "profile_application_pending"] as const satisfies readonly RunControlReason[];
export const controls: RunControlAvailability = {
  status: "ok", account_alias: "synthetic-paper", platform: "longbridge", as_of: observed,
  actions: {
    enable: { enabled: false, reason: "strategy_application_not_connected", requires_confirmation: true },
    stop: { enabled: true, reason: "available", requires_confirmation: true },
    resume: { enabled: false, reason: "existing_recovery_not_available", requires_confirmation: true },
    approve_application: { enabled: false, reason: "profile_draft_required", requires_confirmation: true },
  }, ...readonly,
};

export const quotaDirectory: DirectoryStatus = {
  status: "incomplete", complete: false, last_success: null,
  last_error: { code: "kv_list_daily_limit_exceeded", at: Date.parse(observed) },
  retry_at: Date.parse("2026-10-17T00:01:00Z"), in_progress: false, data_as_of: null,
  unavailable_reason: "kv_list_daily_limit_exceeded",
};
export const quotaInbox: InboxResponse = {
  status: "read_failed", items: [], coverage: "existing_decision_sources",
  sources: ["owner", "promotion", "recovery"].map(source => ({ source, status: "read_failed",
    failure_reason: "kv_list_daily_limit_exceeded" })), ...readonly,
};

/** Record status and run activity are distinct; HTTP 200 need not mean complete data. */
export const runtimeRecords: RuntimeDailySnapshot[] = ["blocked", "read_incomplete"].map(status => ({
  ok: true, timezone: "America/New_York", platform: "schwab", account_key: "synthetic-live",
  date: "2026-10-15", data_status: "fresh", read_error_count: 1, unmatched_count: 0,
  read_error_codes: ["source_read_error"], history: null,
  record: { business_date: "2026-10-15", target_key: "synthetic-target", observed_at: "2026-10-15T21:00:00Z",
    status, completeness: "incomplete", conflict_count: 0,
    runs: [{ run_id: `synthetic-${status}`, started_at: "2026-10-15T21:00:00Z", finished_at: "2026-10-15T21:00:00Z",
      activity: status === "blocked" ? "blocked" : "insufficient", execution_lane: "live", errors_present: true }] },
}));
