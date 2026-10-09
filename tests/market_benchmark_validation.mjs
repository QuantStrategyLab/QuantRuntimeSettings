import assert from "node:assert/strict";
import {
  MARKET_BENCHMARK_INCEPTION_DATE,
  MARKET_BENCHMARK_SCHEMA,
  MARKET_BENCHMARK_SERIES_IDS,
  MARKET_BENCHMARK_YAHOO_SYMBOLS,
  MarketBenchmarkError,
  normalizeMarketBenchmarkClose,
  normalizeMarketBenchmarkPoint,
  normalizeMarketBenchmarkSyncPayload,
  parseYahooChartDailyCloses,
  publicMarketBenchmarkReadModel,
} from "../web/strategy-switch-console/infrastructure/market_benchmark/market_benchmark.js";
import { MARKET_BENCHMARK_INCEPTION_DATE as UI_INCEPTION } from "../web/strategy-switch-console/frontend/src/presentation.ts";
import { MARKET_BENCHMARK_API_URL, loadMarketBenchmarkPoints } from "../web/strategy-switch-console/frontend/src/marketBenchmark.ts";
import worker, { __test } from "../web/strategy-switch-console/worker.js";

assert.equal(MARKET_BENCHMARK_INCEPTION_DATE, "2026-10-09");
assert.equal(UI_INCEPTION, MARKET_BENCHMARK_INCEPTION_DATE);
assert.equal(MARKET_BENCHMARK_API_URL, "/api/market-benchmark");
assert.equal(__test.MARKET_BENCHMARK_API_PATH, "/api/market-benchmark");
assert.equal(__test.MARKET_BENCHMARK_SYNC_PATH, "/api/market-benchmark/sync");
assert.deepEqual([...MARKET_BENCHMARK_SERIES_IDS], Object.keys(MARKET_BENCHMARK_YAHOO_SYMBOLS));

assert.equal(normalizeMarketBenchmarkClose("5710.25"), "5710.25");
assert.throws(() => normalizeMarketBenchmarkClose("0"), (error) => error instanceof MarketBenchmarkError && error.code === "market_benchmark_zero_close_rejected");
assert.throws(() => normalizeMarketBenchmarkClose("0.0"), (error) => error.code === "market_benchmark_zero_close_rejected");
assert.throws(() => normalizeMarketBenchmarkClose("-1"), (error) => error instanceof MarketBenchmarkError);

assert.throws(() => normalizeMarketBenchmarkPoint({
  seriesId: "标普500", observationDate: "2026-10-08", close: "5700",
}), (error) => error.code === "market_benchmark_before_inception");

const okPoint = normalizeMarketBenchmarkPoint({
  seriesId: "标普500", observationDate: "2026-10-09", close: "5710.1", source: "yahoo_chart_v8",
});
assert.equal(okPoint.close, "5710.1");

const dropped = normalizeMarketBenchmarkSyncPayload({
  schema_version: MARKET_BENCHMARK_SCHEMA,
  points: [
    { seriesId: "标普500", observationDate: "2026-10-08", close: "5700" },
    { seriesId: "标普500", observationDate: "2026-10-09", close: "5710" },
    { seriesId: "纳斯达克100", observationDate: "2026-10-09", close: "20000" },
  ],
}, { allowDropBeforeInception: true });
assert.equal(dropped.points.length, 2);
assert.equal(dropped.points.every((point) => point.observationDate >= "2026-10-09"), true);

assert.throws(() => normalizeMarketBenchmarkSyncPayload({
  schema_version: MARKET_BENCHMARK_SCHEMA,
  points: [
    { seriesId: "标普500", observationDate: "2026-10-09", close: "5710" },
    { seriesId: "标普500", observationDate: "2026-10-09", close: "5711" },
  ],
}), (error) => error.code === "market_benchmark_point_conflict");

const publicModel = publicMarketBenchmarkReadModel([
  { seriesId: "标普500", observationDate: "2026-10-09", close: "5710" },
  { seriesId: "标普500", observationDate: "2026-10-08", close: "5700" },
  { seriesId: "标普500", observationDate: "2026-10-10", close: "0" },
]);
assert.deepEqual(publicModel.points.map((point) => point.observationDate), ["2026-10-09"]);

const yahoo = {
  chart: {
    result: [{
      timestamp: [1791466200, 1791552600],
      indicators: { quote: [{ close: [7765.35, 0, null] }] },
    }],
  },
};
// Force equal length by trimming - fix fixture
yahoo.chart.result[0].indicators.quote[0].close = [7765.35, 0];
const parsed = parseYahooChartDailyCloses(yahoo, { seriesId: "标普500" });
// 1791466200 = 2026-10-08 ET session -> before inception, dropped; zero close dropped
assert.equal(parsed.length, 0);

const yahooInception = {
  chart: {
    result: [{
      timestamp: [Date.parse("2026-10-09T20:00:00Z") / 1000],
      indicators: { quote: [{ close: [5800.5] }] },
    }],
  },
};
const parsedInception = parseYahooChartDailyCloses(yahooInception, { seriesId: "标普500" });
assert.equal(parsedInception.length, 1);
assert.equal(parsedInception[0].observationDate >= "2026-10-09", true);
assert.equal(parsedInception[0].close.includes("5800"), true);

const emptyLoad = await loadMarketBenchmarkPoints(async () => new Response("nope", { status: 503 }));
assert.deepEqual(emptyLoad, []);

const okLoad = await loadMarketBenchmarkPoints(async () => new Response(JSON.stringify({
  ok: true,
  inception_date: "2026-10-09",
  points: [{ seriesId: "标普500", observationDate: "2026-10-09", close: "5710" }],
}), { status: 200 }));
assert.equal(okLoad.length, 1);

const routedGet = await worker.fetch(new Request("https://console.example/api/market-benchmark"), {});
assert.notEqual(routedGet.status, 404);
assert.notEqual(routedGet.status, 405);

const routedPost = await worker.fetch(new Request("https://console.example/api/market-benchmark/sync", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
}), {});
assert.notEqual(routedPost.status, 404);
assert.ok([401, 503].includes(routedPost.status), `expected auth/store failure, got ${routedPost.status}`);

const fs = await import("node:fs/promises");
const overview = await fs.readFile(new URL("../web/strategy-switch-console/frontend/src/OverviewPage.tsx", import.meta.url), "utf8");
assert.match(overview, /loadMarketBenchmarkPoints/);
assert.match(overview, /loadedBenchmarkPoints/);

const workflow = await fs.readFile(new URL("../.github/workflows/sync-market-benchmark.yml", import.meta.url), "utf8");
assert.match(workflow, /sync_market_benchmark_closes\.mjs/);
assert.match(workflow, /30 21 \* \* 1-5/);

console.log("market_benchmark_validation ok");
