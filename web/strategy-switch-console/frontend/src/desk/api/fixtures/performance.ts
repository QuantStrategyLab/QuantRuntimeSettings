import type { Performance } from "../../contract/types";
import { NOW, navPath } from "./shared.ts";

/** Synthetic weekly (Friday) observations, 2025-11-07 .. 2026-10-30. No real account or price data. */
export const PERF_DATES: string[] = Array.from({ length: 52 }, (_, i) =>
  new Date(Date.parse("2025-11-07T00:00:00Z") + i * 7 * 86400000).toISOString().slice(0, 10));

const portfolio = navPath(100, 131.4, PERF_DATES.length, 1.6, 0.3);
let peak = 0;
const drawdown = portfolio.map(value => {
  peak = Math.max(peak, Number(value));
  return (Number(value) / peak - 1).toFixed(4);
});
const ret = (Number(portfolio[portfolio.length - 1]) / Number(portfolio[0]) - 1).toFixed(4);
const mdd = String(Math.min(...drawdown.map(Number)).toFixed(4));
const known = <T,>(value: T) => ({ status: "known" as const, value, observed_at: "2026-11-02T14:26:00Z" });
const unknown = { status: "unknown" as const, reason: "never_read" as const };

export const ok = {
  ok: true,
  schema_version: "qsl.desk.performance.v1",
  generated_at: NOW,
  range: "1Y",
  scope: "all",
  history: { first_date: PERF_DATES[0], requested_from: PERF_DATES[0], truncated_by: null, retention_days: 3650 },
  return_basis: { kind: "mixed", per_target: {} },
  equity: {
    dates: PERF_DATES,
    portfolio_indexed: portfolio,
    benchmark: { id: null, label: null, indexed: [] },
    drawdown_ratio: drawdown,
    gap_dates: [],
  },
  risk: {
    return_ratio: known(ret), vs_benchmark_pts: unknown, volatility_ann_ratio: unknown, sharpe: unknown, sortino: unknown,
    max_drawdown_ratio: known(mdd), time_under_water_days: unknown, best_day_ratio: unknown, worst_day_ratio: unknown,
  },
  scorecard: [],
  contribution: { period: "1Y", unit: "pts_of_nav", rows: [] },
  monthly: { unit: "ratio", rows: [] },
} satisfies Performance;

/** Same data with the portfolio risk reads unknown, so the page computes its own stats. */
export const degraded = {
  ...ok,
  risk: { ...ok.risk, return_ratio: unknown, max_drawdown_ratio: unknown },
} satisfies Performance;

const drift: Record<string, [number, number, number]> = { SPY: [100, 118.2, 0.9], QQQ: [100, 126.5, 1.4], IWM: [100, 109.3, 1.7], DIA: [100, 112.8, 0.8] };
const NAMES: Record<string, [string, string, string]> = {
  SPY: ["sp500", "S&P 500", "标普 500"], QQQ: ["nasdaq100", "Nasdaq-100", "纳斯达克 100"],
  IWM: ["russell2000", "Russell 2000", "罗素 2000"], DIA: ["djia", "Dow Jones", "道琼斯"],
};

/**
 * Mock `qsl.performance_benchmarks.v1` body for the requested window. Like the merged API it serves
 * only SPY/QQQ/IWM/DIA (never the optional SOXX/URTH/EEM). The degraded scenario makes IWM start late
 * and DIA unavailable so the partial and unavailable states can be reviewed.
 */
export function benchmarkResponse(start: string, end: string, scenario: "ok" | "degraded" = "ok"): unknown {
  const series = Object.entries(drift).map(([symbol, [from, to, wobble]], index) => {
    const [id, label_en, label_zh] = NAMES[symbol];
    const dates = PERF_DATES.filter(date => date >= start && date <= end);
    const levels = navPath(from, to, PERF_DATES.length, wobble, index + 1);
    const base = { id, symbol, label_en, label_zh };
    if (scenario === "degraded" && symbol === "DIA") {
      return { ...base, status: "unavailable", unavailable_reason: "benchmark_history_missing", base_date: null, last_date: null, points: [] };
    }
    const first = scenario === "degraded" && symbol === "IWM" ? Math.min(12, dates.length - 1) : 0;
    const used = dates.slice(first);
    const baseLevel = Number(levels[PERF_DATES.indexOf(used[0])]);
    const status = first ? "partial" : "available";
    return {
      ...base, status, unavailable_reason: first ? "window_anchor_missing" : null, base_date: used[0], last_date: used[used.length - 1],
      points: used.map(date => ({ date, cumulative_return_ratio: Number((Number(levels[PERF_DATES.indexOf(date)]) / baseLevel - 1).toFixed(5)) })),
    };
  });
  return {
    ok: true, schema_version: "qsl.performance_benchmarks.v1", status: "available", window: { start, end },
    return_basis: "etf_close_price_return", currency: "USD", timezone: "America/New_York",
    calendar_coverage: "not_verified", missing_date_policy: "omit_without_fill", series,
  };
}
