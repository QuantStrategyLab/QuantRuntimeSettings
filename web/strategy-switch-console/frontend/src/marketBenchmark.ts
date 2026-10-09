export const MARKET_BENCHMARK_API_URL = "/api/market-benchmark";
/** Keep aligned with presentation.MARKET_BENCHMARK_INCEPTION_DATE / QRS #568. */
const INCEPTION_DATE = "2026-10-09";

export type MarketBenchmarkPoint = {
  seriesId: string;
  observationDate: string;
  close: string;
};

export type MarketBenchmarkReadModel = {
  ok: boolean;
  schema_version?: string;
  inception_date?: string;
  timezone?: string;
  points?: MarketBenchmarkPoint[];
  error?: string;
};

/** Same-origin GET; fail closed to an empty point list (no fabricated closes). */
export async function loadMarketBenchmarkPoints(
  fetchImpl: typeof fetch = fetch,
): Promise<readonly MarketBenchmarkPoint[]> {
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
    return body.points.filter((point) => (
      point
      && typeof point.seriesId === "string"
      && typeof point.observationDate === "string"
      && typeof point.close === "string"
      && point.observationDate >= INCEPTION_DATE
      && !/^0+(?:\.0+)?$/.test(point.close)
    ));
  } catch {
    return [];
  }
}
