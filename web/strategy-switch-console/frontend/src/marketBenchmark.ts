export const MARKET_BENCHMARK_API_URL = "/api/market-benchmark";
const INCEPTION_DATE = "2026-10-09";
const SERIES_IDS = new Set(["标普500", "纳斯达克100", "道琼斯工业平均指数", "罗素2000"]);

export type LoadedMarketBenchmarkPoint = {
  seriesId: "标普500" | "纳斯达克100" | "道琼斯工业平均指数" | "罗素2000";
  observationDate: string;
  close: string;
};

type MarketBenchmarkReadModel = {
  ok: boolean;
  schema_version?: string;
  inception_date?: string;
  timezone?: string;
  points?: Array<{ seriesId: string; observationDate: string; close: string }>;
  error?: string;
};

/** Same-origin GET; fail closed to an empty point list (no fabricated closes). */
export async function loadMarketBenchmarkPoints(
  fetchImpl: typeof fetch = fetch,
): Promise<readonly LoadedMarketBenchmarkPoint[]> {
  try {
    const response = await fetchImpl(MARKET_BENCHMARK_API_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!response.ok) return [];
    const body = await response.json() as MarketBenchmarkReadModel;
    if (!body || body.ok !== true || !Array.isArray(body.points)) return [];
    if (body.inception_date && body.inception_date !== INCEPTION_DATE) {
      return [];
    }
    const points: LoadedMarketBenchmarkPoint[] = [];
    for (const point of body.points) {
      if (!point || typeof point.seriesId !== "string" || !SERIES_IDS.has(point.seriesId)) continue;
      if (typeof point.observationDate !== "string" || typeof point.close !== "string") continue;
      if (point.observationDate < INCEPTION_DATE) continue;
      if (/^0+(?:\.0+)?$/.test(point.close)) continue;
      points.push({
        seriesId: point.seriesId as LoadedMarketBenchmarkPoint["seriesId"],
        observationDate: point.observationDate,
        close: point.close,
      });
    }
    return points;
  } catch {
    return [];
  }
}
