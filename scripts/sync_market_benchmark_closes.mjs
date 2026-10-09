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
 *   MARKET_BENCHMARK_DRY_RUN   when "true", print payload and exit 0 without POST
 */

import {
  MARKET_BENCHMARK_SCHEMA,
  MARKET_BENCHMARK_YAHOO_SYMBOLS,
  MARKET_BENCHMARK_INCEPTION_DATE,
  parseYahooChartDailyCloses,
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

async function main() {
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
    console.log(JSON.stringify({ dry_run: true, sample: body.points.slice(0, 4) }));
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

main().catch((error) => {
  console.error(String(error && error.message ? error.message : error));
  process.exit(1);
});
