import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
import { diagnoseBenchmarkPoints } from "../scripts/sync_market_benchmark_closes.mjs";

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

// Diagnose the two distinct 409 causes without overwriting or logging prices.
const diagnosticPoint = (date, close) => ({ seriesId: "标普500", observationDate: date, close });
const conflictCounts = diagnoseBenchmarkPoints([
  diagnosticPoint("2026-10-09", "1234.5"),
  diagnosticPoint("2026-10-09", "1235.5"),
  diagnosticPoint("2026-10-12", "1236.5"),
], [diagnosticPoint("2026-10-09", "1234.5")]);
assert.deepEqual(conflictCounts, {
  dry_run: true, post_attempts: 0, candidate_points: 3, candidate_keys: 2,
  candidate_duplicate_keys: 1, candidate_conflicting_keys: 1, stored_points: 1,
  stored_overlap_keys: 1, stored_differing_keys: 1, unseen_keys: 1,
  differing_keys: [{
    series_id: "标普500", symbol: MARKET_BENCHMARK_YAHOO_SYMBOLS["标普500"],
    observation_date: "2026-10-09", relative_diff_pct: 0.081004,
  }],
});
assert.equal(JSON.stringify(conflictCounts).includes("1234.5"), false);
assert.equal(JSON.stringify(conflictCounts).includes("1235.5"), false);
assert.equal(diagnoseBenchmarkPoints([
  diagnosticPoint("2026-10-09", "1234.5"), diagnosticPoint("2026-10-09", "1234.5"),
], [diagnosticPoint("2026-10-09", "1234.5")]).candidate_conflicting_keys, 0);
assert.throws(() => diagnoseBenchmarkPoints([], [
  diagnosticPoint("2026-10-09", "1234.5"), diagnosticPoint("2026-10-09", "1234.5"),
]), /benchmark_stored_duplicate_key/);

const producerUrl = new URL("../scripts/sync_market_benchmark_closes.mjs", import.meta.url);
for (const scenario of ["counts", "read_denied", "malformed_read", "allowed_prefix_secret", "allowed_prefix_price"]) {
  const harness = `
    const scenario = ${JSON.stringify(scenario)};
    globalThis.fetch = async (url, options) => {
      if (scenario === 'allowed_prefix_secret') throw new Error('yahoo_http_403:synthetic_secret_marker');
      if (scenario === 'allowed_prefix_price') throw new Error('yahoo_http_403:2345.987');
      if (options.method !== 'GET' || options.headers.Authorization) throw new Error('unexpected_authenticated_or_mutating_request');
      if (String(url).startsWith('https://query1.finance.yahoo.com/v8/finance/chart/')) {
        return new Response(JSON.stringify({chart:{result:[{timestamp:[Date.parse('2026-10-09T20:00:00Z')/1000],indicators:{quote:[{close:[2345.987]}]}}]}}));
      }
      if (String(url) !== 'https://console.example/api/market-benchmark' || options.redirect !== 'manual') throw new Error('unexpected_read_destination');
      if (scenario === 'read_denied') return new Response('private_response_marker', {status:403});
      if (scenario === 'malformed_read') return new Response('private_response_marker');
      return new Response(JSON.stringify({ok:true,schema_version:'qsl.market_benchmark_points.v1',inception_date:'2026-10-09',points:[{seriesId:'标普500',observationDate:'2026-10-09',close:'2345.986'}]}));
    };
    process.argv[1] = ${JSON.stringify(fileURLToPath(producerUrl))};
    await import(${JSON.stringify(producerUrl.href)});
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", harness], {
    encoding: "utf8",
    env: { ...process.env, MARKET_BENCHMARK_DRY_RUN: "true", MARKET_BENCHMARK_SYNC_URL: "https://console.example/api/market-benchmark/sync", MARKET_BENCHMARK_SYNC_TOKEN: "synthetic_secret_marker" },
  });
  const output = result.stdout + result.stderr;
  assert.equal(output.includes("synthetic_secret_marker"), false);
  assert.equal(output.includes("private_response_marker"), false);
  assert.equal(output.includes("2345.987"), false);
  if (scenario === "counts") {
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trim().split("\n");
    const counts = JSON.parse(lines.at(-2));
    const revisionPlan = JSON.parse(lines.at(-1)).revision_plan;
    assert.equal(revisionPlan.tolerated_keys, 1);
    assert.equal(revisionPlan.differing_keys, 0);
    assert.equal(revisionPlan.overwrites, 0);
    assert.equal(counts.post_attempts, 0);
    assert.equal(counts.stored_differing_keys, 1);
    assert.equal(counts.unseen_keys, 3);
    assert.equal(counts.differing_keys.length, 1);
    assert.equal(counts.differing_keys[0].observation_date, "2026-10-09");
    assert.equal(counts.differing_keys[0].relative_diff_pct, 0.000043);
    assert.equal(result.stdout.includes("2345.986"), false);
  } else {
    assert.equal(result.status, 1);
    assert.match(result.stderr, scenario === "read_denied" ? /benchmark_read_http_403/ : /benchmark_sync_failed/);
  }
}
console.log("market_benchmark_producer_dry_run_validation ok");

// Non-dry-run sync path: within-tolerance stored key is kept (not posted); beyond tolerance blocks with no POST.
for (const scenario of ["within", "beyond"]) {
  const harness = `
    const scenario = ${JSON.stringify(scenario)};
    globalThis.fetch = async (url, options) => {
      if (String(url).startsWith('https://query1.finance.yahoo.com/v8/finance/chart/')) {
        return new Response(JSON.stringify({chart:{result:[{timestamp:[Date.parse('2026-10-09T20:00:00Z')/1000, Date.parse('2026-10-12T20:00:00Z')/1000],indicators:{quote:[{close:[scenario === 'within' ? 2345.987 : 2400.5, 2350.25]}]}}]}}));
      }
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        console.log('POSTED=' + body.points.map((p) => p.observationDate).join(','));
        return new Response(JSON.stringify({ok:true,stored:true}));
      }
      return new Response(JSON.stringify({ok:true,schema_version:'qsl.market_benchmark_points.v1',inception_date:'2026-10-09',points:${JSON.stringify(Object.keys(MARKET_BENCHMARK_YAHOO_SYMBOLS))}.map((s)=>({seriesId:s,observationDate:'2026-10-09',close:'2345.986',source:'yahoo_chart_v8'}))}));
    };
    process.argv[1] = ${JSON.stringify(fileURLToPath(producerUrl))};
    await import(${JSON.stringify(producerUrl.href)});
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", harness], {
    encoding: "utf8",
    env: { ...process.env, MARKET_BENCHMARK_DRY_RUN: "false", MARKET_BENCHMARK_SYNC_URL: "https://console.example/api/market-benchmark/sync", MARKET_BENCHMARK_SYNC_TOKEN: "synthetic_secret_marker" },
  });
  const output = result.stdout + result.stderr;
  assert.equal(output.includes("synthetic_secret_marker"), false);
  if (scenario === "within") {
    assert.equal(result.status, 0, output);
    const posted = output.split("\n").filter((line) => line.startsWith("POSTED="));
    assert.equal(posted.length, 1);
    assert.equal(posted[0], "POSTED=" + Array(4).fill("2026-10-12").join(","));
  } else {
    assert.equal(result.status, 1, output);
    assert.equal(output.includes("POSTED="), false);
    assert.match(result.stderr, /frozen_history_conflict/);
  }
}
console.log("market_benchmark_producer_tolerance_validation ok");
