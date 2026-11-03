import {
  isMarketBenchmarkDate, normalizeMarketBenchmarkPoint, PERFORMANCE_BENCHMARK_SYMBOLS,
} from "../../infrastructure/market_benchmark/market_benchmark.js";

const DEFINITIONS = [
  { id: "sp500", symbol: "SPY", label_en: "S&P 500", label_zh: "标普500" },
  { id: "nasdaq100", symbol: "QQQ", label_en: "Nasdaq-100", label_zh: "纳斯达克100" },
  { id: "russell2000", symbol: "IWM", label_en: "Russell 2000", label_zh: "罗素2000" },
  { id: "djia", symbol: "DIA", label_en: "Dow Jones Industrial Average", label_zh: "道琼斯工业平均指数" },
];

/** No resampling, interpolation, calendar guessing, or shifted inception. */
export function performanceBenchmarkModel(points, start, end) {
  const series = DEFINITIONS.map(definition => {
    const unavailable = reason => ({ ...definition, status: "unavailable", unavailable_reason: reason,
      base_date: null, last_date: null, points: [] });
    const rows = [], seen = new Set();
    for (const raw of points) {
      if (raw?.seriesId !== definition.symbol) continue;
      // A corrupt date cannot be safely classified as inside/outside the window.
      if (!isMarketBenchmarkDate(raw.observationDate)) return unavailable("invalid_cached_price");
      if (raw.observationDate < start || raw.observationDate > end) continue;
      try {
        const point = normalizeMarketBenchmarkPoint(raw);
        const close = Number(point.close);
        if (!Number.isFinite(close) || close <= 0 || seen.has(point.observationDate)) {
          return unavailable("invalid_cached_price");
        }
        seen.add(point.observationDate);
        rows.push({ date: point.observationDate, close });
      } catch { return unavailable("invalid_cached_price"); }
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) return unavailable("benchmark_history_missing");
    if (rows[0].date !== start || rows.at(-1).date !== end) return unavailable("window_anchor_missing");
    const base = rows[0].close;
    const normalized = rows.map(row => ({ date: row.date,
      cumulative_return_ratio: Number(((row.close - base) / base).toPrecision(15)) }));
    if (normalized.some(row => !Number.isFinite(row.cumulative_return_ratio))) return unavailable("invalid_cached_price");
    return { ...definition, status: "available", unavailable_reason: null,
      base_date: start, last_date: end, points: normalized };
  });
  const count = series.filter(row => row.status === "available").length;
  return { ok: true, schema_version: "qsl.performance_benchmarks.v1",
    status: count === 4 ? "available" : count ? "partial" : "unavailable",
    window: { start, end }, timezone: "America/New_York", currency: "USD",
    return_basis: "etf_close_price_return", unit: "ratio", normalization: "close/base_close-1",
    calendar_coverage: "not_verified", missing_date_policy: "omit_without_fill",
    series };
}

/** Public market-only read, matching the existing benchmark endpoint's access. */
export async function performanceBenchmarkResponse(request, env, { command }) {
  const respond = (body, status) => new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
  if (!["GET", "HEAD"].includes(request.method)) return respond({ ok: false, error: "method_not_allowed" }, 405);
  const params = new URL(request.url).searchParams;
  const start = params.get("start"), end = params.get("end");
  if (params.getAll("start").length !== 1 || params.getAll("end").length !== 1
      || !isMarketBenchmarkDate(start) || !isMarketBenchmarkDate(end) || start > end) {
    return respond({ ok: false, error: "invalid_benchmark_window" }, 400);
  }
  try {
    const stored = await command(env, { action: "market_benchmark_read", performance: true });
    if (stored?.ok !== true || !Array.isArray(stored.points)) throw Error("unavailable");
    // Only known market identities reach the projection; account data is never used.
    const points = stored.points.filter(row => Object.hasOwn(PERFORMANCE_BENCHMARK_SYMBOLS, row?.seriesId ?? ""));
    return respond(performanceBenchmarkModel(points, start, end), 200);
  } catch {
    // Store/transport diagnostics are untrusted and must not enter the response.
    return respond({ ok: false, error: "performance_benchmark_unavailable" }, 503);
  }
}
