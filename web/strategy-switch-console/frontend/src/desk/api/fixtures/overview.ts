import type { BookRow, Overview } from "../../contract/types";
import { NOW, days, navPath } from "./shared.ts";

const READ_AT = "2026-11-02T14:31:12Z";
const FACTS_AT = "2026-11-02T14:26:00Z";
const known = <T,>(value: T, observed_at = READ_AT) => ({ status: "known" as const, value, observed_at });

/** 30 calendar days ending today; `gaps` are missing days, so points = days − gaps. */
function spark(start: number, end: number, wobble: number, phase: number, gaps: string[] = []) {
  const span = days("2026-10-04", 30);
  return {
    points: navPath(start, end, span.length - gaps.length, wobble, phase),
    dates_from: span[0],
    dates_to: span[span.length - 1],
    gap_dates: gaps,
  };
}

const soxl = {
  target_id: "ibkr/soxl", platform: "ibkr", platform_label: "IBKR", account_ref: "U•••0002", account_suffix: "0002",
  strategy: known({ profile: "soxl_soxx_trend_income", label: "Semiconductor Trend Income" }),
  mode: known("live"), runtime: known("running", "2026-11-02T14:31:48Z"),
  nav: { status: "known", currency: "USD", amount: "198450.00", usd: "198450.00", observed_at: FACTS_AT },
  day_change: { ratio: "-0.0062", amount: "-1238.00", currency: "USD" },
  sparkline_30d: spark(214800, 198450, 2600, 0.4),
  drawdown: { ratio: "-0.141", limit_ratio: "-0.15", state: "near_limit" },
  config: { state: "synced", drift_count: 0, checked_at: READ_AT },
  last_run: { at: "2026-11-02T13:55:00Z", outcome: "no_op" },
  return_basis: "native_ibkr_twr",
} satisfies BookRow;

const hk = {
  target_id: "longbridge/hk", platform: "longbridge", platform_label: "LongBridge", account_ref: "LB•••0005", account_suffix: "0005",
  strategy: known({ profile: "hk_global_etf_tactical_rotation", label: "HK ETF Tactical Rotation" }),
  mode: known("live"), runtime: { status: "unknown", reason: "identity_unverified" },
  nav: { status: "known", currency: "HKD", amount: "1113000.00", usd: "142700.00", observed_at: "2026-11-02T09:06:00Z" },
  day_change: { ratio: "-0.0088", amount: "-1256.00", currency: "USD" },
  sparkline_30d: spark(145800, 142700, 900, 1.3, ["2026-10-12"]),
  drawdown: { ratio: "-0.059", limit_ratio: "-0.15", state: "ok" },
  config: { state: "drift", drift_count: 2, checked_at: READ_AT },
  last_run: { at: "2026-11-02T09:05:00Z", outcome: "drift" },
  return_basis: "nav_change_unadjusted",
} satisfies BookRow;

const tqqq = {
  target_id: "ibkr/tqqq", platform: "ibkr", platform_label: "IBKR", account_ref: "U•••0001", account_suffix: "0001",
  strategy: known({ profile: "tqqq_growth_income", label: "TQQQ Growth Income" }),
  mode: known("live"), runtime: known("running", "2026-11-02T14:31:48Z"),
  nav: { status: "known", currency: "USD", amount: "412380.00", usd: "412380.00", observed_at: FACTS_AT },
  day_change: { ratio: "0.0184", amount: "7588.00", currency: "USD" },
  sparkline_30d: spark(398100, 412380, 3100, 2.1),
  drawdown: { ratio: "-0.062", limit_ratio: "-0.15", state: "ok" },
  config: { state: "synced", drift_count: 0, checked_at: READ_AT },
  last_run: { at: "2026-11-02T14:25:00Z", outcome: "no_op" },
  return_basis: "native_ibkr_twr",
} satisfies BookRow;

const schwab = {
  target_id: "schwab/core", platform: "schwab", platform_label: "Schwab", account_ref: "S•••0003", account_suffix: "0003",
  strategy: known({ profile: "us_equity_combo_core", label: "US Core Combo" }),
  mode: known("live"), runtime: known("running", "2026-11-02T14:31:48Z"),
  nav: { status: "known", currency: "USD", amount: "236900.00", usd: "236900.00", observed_at: FACTS_AT },
  day_change: { ratio: "0.0042", amount: "991.00", currency: "USD" },
  sparkline_30d: spark(231200, 236900, 1200, 3.3),
  drawdown: { ratio: "-0.033", limit_ratio: "-0.15", state: "ok" },
  config: { state: "synced", drift_count: 0, checked_at: READ_AT },
  last_run: { at: "2026-11-02T06:05:00Z", outcome: "no_op" },
  return_basis: "nav_change_unadjusted",
} satisfies BookRow;

const firstrade = {
  target_id: "firstrade/income", platform: "firstrade", platform_label: "Firstrade", account_ref: "F•••0004", account_suffix: "0004",
  strategy: known({ profile: "russell_top50_leader_rotation", label: "Russell Top 50 Leader Rotation" }),
  mode: known("live"), runtime: known("running", "2026-11-02T14:31:48Z"),
  nav: { status: "known", currency: "USD", amount: "121300.00", usd: "121300.00", observed_at: FACTS_AT },
  day_change: { ratio: "0.0018", amount: "218.00", currency: "USD" },
  sparkline_30d: spark(119900, 121300, 420, 4.2),
  drawdown: { ratio: "-0.018", limit_ratio: "-0.15", state: "ok" },
  config: { state: "synced", drift_count: 0, checked_at: READ_AT },
  last_run: { at: "2026-10-30T19:45:00Z", outcome: "orders_submitted" },
  return_basis: "nav_change_unadjusted",
} satisfies BookRow;

const binance = {
  target_id: "binance/spot", platform: "binance", platform_label: "Binance", account_ref: "BN•••0006", account_suffix: "0006",
  strategy: known({ profile: "btc_dca", label: "BTC DCA" }),
  mode: known("live"), runtime: known("running", "2026-11-02T14:31:48Z"),
  nav: { status: "known", currency: "USDT", amount: "78070.00", usd: "78070.00", observed_at: FACTS_AT },
  day_change: { ratio: "0.0087", amount: "673.00", currency: "USD" },
  sparkline_30d: spark(74100, 78070, 700, 5.1),
  drawdown: { ratio: "-0.045", limit_ratio: "-0.15", state: "ok" },
  config: { state: "synced", drift_count: 0, checked_at: READ_AT },
  last_run: { at: "2026-11-02T14:30:00Z", outcome: "filled" },
  return_basis: "nav_change_unadjusted",
} satisfies BookRow;

const curveDates = days("2026-10-09", 25);
const portfolio = navPath(100, 103.9, curveDates.length, 0.55, 0.7);
let peak = 0;
const drawdown = portfolio.map(value => {
  peak = Math.max(peak, Number(value));
  return (Number(value) / peak - 1).toFixed(4);
});

export const ok = {
  ok: true,
  schema_version: "qsl.desk.overview.v1",
  generated_at: NOW,
  snapshot_at: FACTS_AT,
  freshness: { data_status: "ready", age_seconds: 367 },
  reporting_currency: "USD",
  totals: {
    status: "complete",
    coverage: { included: 6, total: 6, excluded_reasons: [] },
    fx: { status: "known", as_of: "2026-11-02T14:00:00Z", source: "overview_fx" },
    nav: "1189800.00",
    day_change: { amount: "6976.00", ratio: "0.0059" },
    drawdown: { ratio: "-0.049", limit_ratio: "-0.15", peak_date: "2026-09-18" },
    gross_exposure_ratio: "0.964",
    leveraged_etf_exposure_ratio: "0.412",
    runs_today: { done: 11, expected: 12, pending: [{ target_id: "ibkr/tqqq", due_at: "2026-11-02T20:55:00Z" }] },
    config_drift: { count: 1, target_ids: ["longbridge/hk"] },
    data_age_seconds: 367,
  },
  // Backend risk order: near-limit drawdown, drift, then NAV.
  book: [soxl, hk, tqqq, schwab, firstrade, binance],
  equity_curve: {
    range: "1M",
    portfolio: { dates: curveDates, indexed: portfolio },
    benchmark: { id: "nasdaq100", label: "Nasdaq 100", indexed: navPath(100, 102.1, curveDates.length, 0.8, 1.9) },
    drawdown,
    history_starts: "2026-05-04",
    return_basis: "mixed",
  },
  needs_you: [
    { id: "alr_demo_0001", kind: "config_drift", severity: "critical", target_id: "longbridge/hk",
      title: "needs_you.config_drift.title",
      detail: "needs_you.config_drift.detail",
      action: { label: "needs_you.config_drift.action", route: "/accounts?target=longbridge/hk" } },
    { id: "alr_demo_0002", kind: "credential_expiring", severity: "warning", target_id: "schwab/core",
      title: "needs_you.credential_expiring.title",
      detail: "needs_you.credential_expiring.detail",
      action: { label: "needs_you.credential_expiring.action", route: "/accounts?tab=credentials&credential=cred_schwab_oauth" } },
    { id: "alr_demo_0003", kind: "drawdown_near_limit", severity: "warning", target_id: "ibkr/soxl",
      title: "needs_you.drawdown_near_limit.title",
      detail: "needs_you.drawdown_near_limit.detail",
      action: { label: "needs_you.drawdown_near_limit.action", route: "/overview?target=ibkr/soxl" } },
  ],
} satisfies Overview;

/**
 * Stale facts, one account unverified and one unreadable: totals are partial and say so,
 * unknowns stay unknown, the benchmark is unavailable.
 */
export const degraded = {
  ...ok,
  freshness: { data_status: "stale", age_seconds: 140400 },
  snapshot_at: "2026-10-31T23:32:00Z",
  totals: {
    ...ok.totals,
    status: "partial",
    coverage: { included: 4, total: 6, excluded_reasons: ["physical_identity_unverified", "coverage_incomplete"] },
    nav: "969030.00",
    day_change: null,
    gross_exposure_ratio: null,
    leveraged_etf_exposure_ratio: null,
    data_age_seconds: 140400,
  },
  book: [
    soxl,
    { ...hk, nav: { status: "stale", currency: "HKD", amount: "1113000.00", usd: null, observed_at: "2026-10-31T09:06:00Z", age_seconds: 192367 } },
    tqqq, schwab, firstrade,
    { ...binance, nav: { status: "unknown", reason: "read_failed", observed_at: null }, day_change: null,
      sparkline_30d: { points: [], dates_from: null, dates_to: null, gap_dates: [] },
      drawdown: { ratio: null, limit_ratio: "-0.15", state: "unknown" },
      config: { state: "unknown", drift_count: 0, checked_at: null }, last_run: null,
      runtime: { status: "unknown", reason: "read_failed" } },
  ],
  equity_curve: { ...ok.equity_curve, benchmark: { id: null, label: null, indexed: [] } },
  needs_you: [
    ok.needs_you[0],
    { id: "alr_demo_0004", kind: "data_stale", severity: "warning", target_id: null,
      title: "needs_you.data_stale.title", detail: "needs_you.data_stale.detail",
      action: { label: "needs_you.data_stale.action", route: "/accounts" } },
  ],
} satisfies Overview;
