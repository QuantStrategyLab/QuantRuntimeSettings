/**
 * Market benchmark daily closes for the overview (additive read model).
 *
 * Inception: 2026-10-09 Asia/Shanghai per QRS #568.
 * Rules: no dates before inception, reject non-positive/zero closes, no backfill.
 */

export const MARKET_BENCHMARK_INCEPTION_DATE = "2026-10-09";
export const MARKET_BENCHMARK_API_PATH = "/api/market-benchmark";
export const MARKET_BENCHMARK_SYNC_PATH = "/api/market-benchmark/sync";
export const MARKET_BENCHMARK_SCHEMA = "qsl.market_benchmark_points.v1";
export const MARKET_BENCHMARK_SERIES_IDS = Object.freeze([
  "标普500",
  "纳斯达克100",
  "道琼斯工业平均指数",
  "罗素2000",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLOSE_RE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SOURCE_RE = /^[A-Za-z0-9._:-]{1,64}$/;

export class MarketBenchmarkError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function isMarketBenchmarkSeriesId(value) {
  return typeof value === "string" && MARKET_BENCHMARK_SERIES_IDS.includes(value);
}

/** Reject zero and non-positive closes; keep decimal text as stored. */
export function normalizeMarketBenchmarkClose(raw) {
  if (typeof raw !== "string" || raw.length > 32 || !CLOSE_RE.test(raw)) {
    throw new MarketBenchmarkError("invalid_market_benchmark_close");
  }
  if (/^0+(?:\.0+)?$/.test(raw)) {
    throw new MarketBenchmarkError("market_benchmark_zero_close_rejected");
  }
  // Strip leading zeros on the integer part without inventing precision.
  const [integer, fraction] = raw.split(".");
  const normalizedInteger = integer.replace(/^0+(?=\d)/, "") || "0";
  if (normalizedInteger === "0" && (!fraction || /^0+$/.test(fraction))) {
    throw new MarketBenchmarkError("market_benchmark_zero_close_rejected");
  }
  return fraction === undefined ? normalizedInteger : `${normalizedInteger}.${fraction}`;
}

export function normalizeMarketBenchmarkPoint(raw, { inceptionDate = MARKET_BENCHMARK_INCEPTION_DATE } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new MarketBenchmarkError("invalid_market_benchmark_point");
  }
  const seriesId = raw.seriesId ?? raw.series_id;
  const observationDate = raw.observationDate ?? raw.observation_date;
  const close = raw.close;
  const source = raw.source;
  if (!isMarketBenchmarkSeriesId(seriesId)) {
    throw new MarketBenchmarkError("invalid_market_benchmark_series");
  }
  if (typeof observationDate !== "string" || !DATE_RE.test(observationDate)) {
    throw new MarketBenchmarkError("invalid_market_benchmark_date");
  }
  if (observationDate < inceptionDate) {
    throw new MarketBenchmarkError("market_benchmark_before_inception");
  }
  const normalizedClose = normalizeMarketBenchmarkClose(close);
  if (source !== undefined && source !== null) {
    if (typeof source !== "string" || !SOURCE_RE.test(source)) {
      throw new MarketBenchmarkError("invalid_market_benchmark_source");
    }
  }
  return {
    seriesId,
    observationDate,
    close: normalizedClose,
    ...(typeof source === "string" ? { source } : {}),
  };
}

/**
 * Normalize a sync body: { schema_version, points: [...] }.
 * Drops pre-inception points only when allowDropBeforeInception is true (producer
 * may send a short Yahoo window); otherwise rejects them.
 */
export function normalizeMarketBenchmarkSyncPayload(raw, {
  inceptionDate = MARKET_BENCHMARK_INCEPTION_DATE,
  allowDropBeforeInception = true,
  maxPoints = 64,
} = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new MarketBenchmarkError("invalid_market_benchmark_payload");
  }
  if (raw.schema_version !== MARKET_BENCHMARK_SCHEMA) {
    throw new MarketBenchmarkError("invalid_market_benchmark_schema");
  }
  if (!Array.isArray(raw.points) || raw.points.length === 0 || raw.points.length > maxPoints) {
    throw new MarketBenchmarkError("invalid_market_benchmark_points");
  }
  const byKey = new Map();
  for (const item of raw.points) {
    let point;
    try {
      point = normalizeMarketBenchmarkPoint(item, { inceptionDate });
    } catch (error) {
      if (
        allowDropBeforeInception
        && error instanceof MarketBenchmarkError
        && error.code === "market_benchmark_before_inception"
      ) {
        continue;
      }
      throw error;
    }
    const key = `${point.seriesId}\0${point.observationDate}`;
    const prior = byKey.get(key);
    if (prior && prior.close !== point.close) {
      throw new MarketBenchmarkError("market_benchmark_point_conflict", 409);
    }
    byKey.set(key, point);
  }
  const points = [...byKey.values()].sort((left, right) => {
    const seriesCmp = left.seriesId.localeCompare(right.seriesId);
    return seriesCmp !== 0 ? seriesCmp : left.observationDate.localeCompare(right.observationDate);
  });
  if (points.length === 0) {
    throw new MarketBenchmarkError("market_benchmark_no_inception_points");
  }
  return {
    schema_version: MARKET_BENCHMARK_SCHEMA,
    inception_date: inceptionDate,
    points,
  };
}

export function publicMarketBenchmarkReadModel(points, {
  inceptionDate = MARKET_BENCHMARK_INCEPTION_DATE,
} = {}) {
  const filtered = [];
  for (const point of points || []) {
    try {
      filtered.push(normalizeMarketBenchmarkPoint(point, { inceptionDate }));
    } catch {
      // Stored rows that fail closed stay out of the public read model.
    }
  }
  filtered.sort((left, right) => {
    const seriesCmp = left.seriesId.localeCompare(right.seriesId);
    return seriesCmp !== 0 ? seriesCmp : left.observationDate.localeCompare(right.observationDate);
  });
  return {
    ok: true,
    schema_version: MARKET_BENCHMARK_SCHEMA,
    inception_date: inceptionDate,
    timezone: "Asia/Shanghai",
    points: filtered.map(({ seriesId, observationDate, close }) => ({
      seriesId,
      observationDate,
      close,
    })),
  };
}

/** Yahoo chart symbol map for the four legend series (price index, not total return). */
export const MARKET_BENCHMARK_YAHOO_SYMBOLS = Object.freeze({
  "标普500": "^GSPC",
  "纳斯达克100": "^NDX",
  "道琼斯工业平均指数": "^DJI",
  "罗素2000": "^RUT",
});

/**
 * Parse a Yahoo v8 finance chart payload into { observationDate, close } using
 * America/New_York session calendar dates (exchange trading day).
 */
export function parseYahooChartDailyCloses(payload, { seriesId, inceptionDate = MARKET_BENCHMARK_INCEPTION_DATE } = {}) {
  if (!isMarketBenchmarkSeriesId(seriesId)) {
    throw new MarketBenchmarkError("invalid_market_benchmark_series");
  }
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length !== closes.length) {
    throw new MarketBenchmarkError("market_benchmark_upstream_invalid");
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const points = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const ts = timestamps[index];
    const closeNum = closes[index];
    if (!Number.isFinite(ts) || closeNum === null || closeNum === undefined) continue;
    if (typeof closeNum !== "number" || !Number.isFinite(closeNum) || closeNum <= 0) continue;
    const observationDate = formatter.format(new Date(ts * 1000));
    if (!DATE_RE.test(observationDate) || observationDate < inceptionDate) continue;
    // Keep up to 6 decimal places as decimal text; trim trailing zeros carefully.
    const close = String(closeNum);
    try {
      points.push(normalizeMarketBenchmarkPoint({
        seriesId,
        observationDate,
        close,
        source: "yahoo_chart_v8",
      }, { inceptionDate }));
    } catch {
      // Skip malformed closes rather than inventing values.
    }
  }
  return points;
}
