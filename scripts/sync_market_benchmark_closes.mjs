#!/usr/bin/env node
/**
 * Fetch public Yahoo daily closes for the four overview legend series and POST
 * them to the console market-benchmark sync endpoint.
 *
 * Rules (QRS #568): only observation dates >= 2026-10-09; reject zero closes;
 * do not backfill earlier history (Yahoo window may be short; pre-inception
 * rows are dropped by the receiver).
 *
 * Env:
 *   MARKET_BENCHMARK_SYNC_URL  default https://qsl-strategy-switch-console.pigbibi.workers.dev/api/market-benchmark/sync
 *   MARKET_BENCHMARK_SYNC_TOKEN  required bearer
 *   MARKET_BENCHMARK_RANGE     Yahoo range query, default 10d
 *   MARKET_BENCHMARK_DRY_RUN   when "true", compare conflict counts without POST
 */

import { pathToFileURL } from "node:url";
import {
  MARKET_BENCHMARK_SCHEMA,
  MARKET_BENCHMARK_YAHOO_SYMBOLS,
  MARKET_BENCHMARK_INCEPTION_DATE,
  parseYahooChartDailyCloses,
  normalizeMarketBenchmarkPoint,
} from "../web/strategy-switch-console/infrastructure/market_benchmark/market_benchmark.js";

const SYNC_URL = process.env.MARKET_BENCHMARK_SYNC_URL
  || "https://qsl-strategy-switch-console.pigbibi.workers.dev/api/market-benchmark/sync";
const TOKEN = process.env.MARKET_BENCHMARK_SYNC_TOKEN || "";
const RANGE = process.env.MARKET_BENCHMARK_RANGE || "10d";
const DRY_RUN = process.env.MARKET_BENCHMARK_DRY_RUN === "true";

function yahooUrl(symbol) {
  const encoded = encodeURIComponent(symbol);
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=${encodeURIComponent(RANGE)}`;
}

async function fetchSeries(seriesId, symbol) {
  const response = await fetch(yahooUrl(symbol), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "QuantStrategyLab-market-benchmark/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`yahoo_http_${response.status}:${seriesId}`);
  }
  const payload = await response.json();
  return parseYahooChartDailyCloses(payload, {
    seriesId,
    inceptionDate: MARKET_BENCHMARK_INCEPTION_DATE,
  });
}

export function diagnoseBenchmarkPoints(points, storedPoints) {
  const candidates = new Map();
  const stored = new Map();
  const key = (point) => `${point.seriesId}\0${point.observationDate}`;
  for (const raw of points) {
    const point = normalizeMarketBenchmarkPoint(raw);
    const values = candidates.get(key(point)) || [];
    values.push(point.close);
    candidates.set(key(point), values);
  }
  for (const raw of storedPoints) {
    const point = normalizeMarketBenchmarkPoint(raw);
    if (stored.has(key(point))) throw new Error("benchmark_stored_duplicate_key");
    stored.set(key(point), point.close);
  }
  return {
    dry_run: true,
    post_attempts: 0,
    candidate_points: points.length,
    candidate_keys: candidates.size,
    candidate_duplicate_keys: [...candidates.values()].filter((values) => values.length > 1).length,
    candidate_conflicting_keys: [...candidates.values()].filter((values) => new Set(values).size > 1).length,
    stored_points: stored.size,
    stored_overlap_keys: [...candidates.keys()].filter((value) => stored.has(value)).length,
    stored_differing_keys: [...candidates].filter(([value, closes]) => stored.has(value) && closes.some((close) => close !== stored.get(value))).length,
    unseen_keys: [...candidates.keys()].filter((value) => !stored.has(value)).length,
    // Per differing key: identifiers and relative difference only; never closes.
    differing_keys: [...candidates]
      .filter(([value, closes]) => stored.has(value) && closes.some((close) => close !== stored.get(value)))
      .map(([value, closes]) => {
        const [seriesId, observationDate] = value.split("\0");
        const base = Number(stored.get(value));
        const worst = Math.max(...closes.map((close) => Math.abs(Number(close) - base)));
        const pct = base > 0 && Number.isFinite(worst) ? (worst / base) * 100 : null;
        return {
          series_id: seriesId,
          symbol: MARKET_BENCHMARK_YAHOO_SYMBOLS[seriesId] || null,
          observation_date: observationDate,
          relative_diff_pct: pct === null ? null : Number(pct.toFixed(6)),
        };
      })
      .sort((a, b) => `${a.observation_date}${a.series_id}`.localeCompare(`${b.observation_date}${b.series_id}`)),
  };
}

async function readStoredPoints() {
  const url = new URL(SYNC_URL);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || url.pathname !== "/api/market-benchmark/sync") {
    throw new Error("benchmark_read_url_invalid");
  }
  url.pathname = "/api/market-benchmark";
  const response = await fetch(url, {
    method: "GET", headers: { Accept: "application/json" },
    redirect: "manual", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`benchmark_read_http_${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("benchmark_read_body_missing");
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("benchmark_read_body_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (parsed?.ok !== true || parsed.schema_version !== MARKET_BENCHMARK_SCHEMA
      || parsed.inception_date !== MARKET_BENCHMARK_INCEPTION_DATE
      || !Array.isArray(parsed.points) || parsed.points.length > 4096) {
    throw new Error("benchmark_read_model_invalid");
  }
  return parsed.points;
}

export async function main() {
  if (!DRY_RUN && !TOKEN) {
    console.error("MARKET_BENCHMARK_SYNC_TOKEN is required unless MARKET_BENCHMARK_DRY_RUN=true");
    process.exit(2);
  }
  const points = [];
  for (const [seriesId, symbol] of Object.entries(MARKET_BENCHMARK_YAHOO_SYMBOLS)) {
    const seriesPoints = await fetchSeries(seriesId, symbol);
    console.log(`fetched series=${seriesId} symbol=${symbol} points=${seriesPoints.length}`);
    points.push(...seriesPoints);
  }
  const body = {
    schema_version: MARKET_BENCHMARK_SCHEMA,
    points: points.map((point) => ({
      seriesId: point.seriesId,
      observationDate: point.observationDate,
      close: point.close,
      source: point.source || "yahoo_chart_v8",
    })),
  };
  console.log(`payload_points=${body.points.length} inception=${MARKET_BENCHMARK_INCEPTION_DATE}`);
  if (body.points.length === 0) {
    console.log("no_inception_points_yet");
    // Soft success: schedule may run before the first US close on/after inception.
    process.exit(0);
  }
  if (DRY_RUN) {
    console.log(JSON.stringify(diagnoseBenchmarkPoints(body.points, await readStoredPoints())));
    process.exit(0);
  }
  const response = await fetch(SYNC_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  const text = await response.text();
  console.log(`sync_status=${response.status}`);
  console.log(text.slice(0, 500));
  if (response.status !== 200) process.exit(1);
  let parsed;
  try { parsed = JSON.parse(text); } catch { process.exit(1); }
  if (parsed?.ok !== true || parsed?.stored !== true) process.exit(1);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = String(error && error.message ? error.message : error);
    const fixed = new Set([
      "benchmark_stored_duplicate_key", "benchmark_read_url_invalid", "benchmark_read_body_missing",
      "benchmark_read_body_too_large", "benchmark_read_model_invalid",
      "invalid_market_benchmark_point", "invalid_market_benchmark_series", "invalid_market_benchmark_date",
      "invalid_market_benchmark_close", "invalid_market_benchmark_source", "market_benchmark_zero_close_rejected",
      "market_benchmark_before_inception", "market_benchmark_upstream_invalid",
    ]);
    const yahoo = message.match(/^yahoo_http_([1-5]\d{2}):(.+)$/);
    const readHttp = message.match(/^benchmark_read_http_([1-5]\d{2})$/);
    console.error(fixed.has(message) ? message : readHttp ? `benchmark_read_http_${readHttp[1]}`
      : yahoo && Object.keys(MARKET_BENCHMARK_YAHOO_SYMBOLS).includes(yahoo[2])
        ? `yahoo_http_${yahoo[1]}` : "benchmark_sync_failed");
    process.exit(1);
  });
}
