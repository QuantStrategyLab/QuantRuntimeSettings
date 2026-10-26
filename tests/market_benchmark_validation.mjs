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
import { buildUpstreamRevisionPayload, closedSessionPoints, diagnoseBenchmarkPoints, newYorkDate } from "../scripts/sync_market_benchmark_closes.mjs";
import { createHash } from "node:crypto";

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
assert.match(workflow, /30 5 \* \* 2-6/);

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

// Closed-session filter: only dates strictly before the current New York date.
assert.equal(newYorkDate(new Date("2026-10-14T14:25:00Z")), "2026-10-14"); // 10:25 ET, open
assert.equal(newYorkDate(new Date("2026-10-15T03:59:00Z")), "2026-10-14"); // 23:59 ET
assert.equal(newYorkDate(new Date("2026-10-15T04:00:00Z")), "2026-10-15"); // 00:00 ET (EDT)
assert.equal(newYorkDate(new Date("2026-12-15T04:59:00Z")), "2026-12-14"); // EST offset
assert.equal(newYorkDate(new Date("2026-12-15T05:00:00Z")), "2026-12-15");
const sessionPts = ["2026-10-12", "2026-10-13", "2026-10-14"].map((d) => ({ observationDate: d }));
assert.deepEqual(closedSessionPoints(sessionPts, new Date("2026-10-14T14:25:00Z")).map((p) => p.observationDate),
  ["2026-10-12", "2026-10-13"]); // intraday today skipped
assert.deepEqual(closedSessionPoints(sessionPts, new Date("2026-10-14T21:30:00Z")).map((p) => p.observationDate),
  ["2026-10-12", "2026-10-13"]); // even after close, same ET day waits until tomorrow
assert.deepEqual(closedSessionPoints(sessionPts, new Date("2026-10-15T04:00:00Z")).map((p) => p.observationDate),
  ["2026-10-12", "2026-10-13", "2026-10-14"]);
// Friday's close is intentionally withheld on Friday ET. The next scheduled
// Saturday run must collect it, without admitting Saturday or intraday bars.
for (const [friday, saturday, run] of [
  ["2026-10-23", "2026-10-24", "2026-10-24T05:30:00Z"],
  ["2026-12-11", "2026-12-12", "2026-12-12T05:30:00Z"],
]) {
  const bars = [friday, saturday].map(observationDate => ({ observationDate }));
  assert.equal(newYorkDate(new Date(run)), saturday);
  assert.deepEqual(closedSessionPoints(bars, new Date(run)).map(point => point.observationDate), [friday]);
  assert.deepEqual(closedSessionPoints(bars, new Date(`${friday}T21:30:00Z`)), []);
}
console.log("market_benchmark_closed_session_validation ok");

// Apply-revision path is opt-in and must not run without the dedicated token.
{
  const harness = `
    process.argv[1] = ${JSON.stringify(fileURLToPath(producerUrl))};
    await import(${JSON.stringify(producerUrl.href)});
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", harness], {
    encoding: "utf8",
    env: {
      ...process.env,
      MARKET_BENCHMARK_APPLY_REVISION: "true",
      MARKET_BENCHMARK_DRY_RUN: "false",
      MARKET_BENCHMARK_SYNC_URL: "https://console.example/api/market-benchmark/sync",
      MARKET_BENCHMARK_REVISION_PAYLOAD_JSON: "{}",
      MARKET_BENCHMARK_REVISION_TOKEN: "",
    },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr + result.stdout, /MARKET_BENCHMARK_REVISION_TOKEN/);
  assert.equal((result.stdout + result.stderr).includes("POSTED="), false);
}
console.log("market_benchmark_apply_revision_gate_validation ok");

// Apply-from-upstream: the job rebuilds proposal + replacements and refuses on hash mismatch.
{
  const seriesIds = Object.keys(MARKET_BENCHMARK_YAHOO_SYMBOLS);
  const storedPts = seriesIds.flatMap((s) => [
    { seriesId: s, observationDate: "2026-10-13", close: "100.0", source: "yahoo_chart_v8" },
    { seriesId: s, observationDate: "2026-10-14", close: "200.0", source: "yahoo_chart_v8" },
  ]);
  const candidatePts = seriesIds.flatMap((s) => [
    { seriesId: s, observationDate: "2026-10-13", close: "100.0", source: "yahoo_chart_v8" },
    { seriesId: s, observationDate: "2026-10-14", close: "203.5", source: "yahoo_chart_v8" },
  ]);
  assert.throws(() => buildUpstreamRevisionPayload(candidatePts, storedPts, "0".repeat(64), "2026-10-15T12:00:00Z"),
    /benchmark_revision_approval_mismatch/);
  assert.throws(() => buildUpstreamRevisionPayload(candidatePts, storedPts, "", "2026-10-15T12:00:00Z"),
    /benchmark_revision_approval_required/);
  assert.throws(() => buildUpstreamRevisionPayload(storedPts, storedPts, "a".repeat(64), "2026-10-15T12:00:00Z"),
    /benchmark_revision_nothing_to_apply/);
  // Derive the hash the owner would have approved from a dry-run proposal (hash covers entries only).
  const sha = (v) => createHash("sha256").update(String(v)).digest("hex");
  const entries = seriesIds.map((s) => ({
    series_id_sha256: sha(s), observation_date: "2026-10-14", prior_close_sha256: sha("200.0"),
    candidate_close_sha256: sha("203.5"), candidate_source: "yahoo_chart_v8", reason: "upstream_revision_unverified",
  })).sort((a, b) => (a.series_id_sha256 + a.observation_date).localeCompare(b.series_id_sha256 + b.observation_date));
  const approved = sha(JSON.stringify(entries));
  const payload = buildUpstreamRevisionPayload(candidatePts, storedPts, approved, "2026-10-15T13:00:00Z");
  assert.equal(payload.proposal.proposal_sha256, approved);
  assert.equal(payload.replacements.length, 4);
  assert.equal(payload.summary.identical_keys, 4);
  assert.equal(payload.summary.differing_keys, 4);
  assert.ok(payload.replacements.every((p) => p.observationDate === "2026-10-14" && p.close === "203.5"));
  // Detection time does not change the approved hash.
  assert.equal(buildUpstreamRevisionPayload(candidatePts, storedPts, approved, "2026-10-16T00:00:00Z").proposal.proposal_sha256, approved);

  // End-to-end apply dry run: no POST, no token required, logs hashes/counts only.
  const yahooDay = (d) => Date.parse(`${d}T20:00:00Z`) / 1000;
  const harness = `
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).startsWith('https://query1.finance.yahoo.com/v8/finance/chart/')) {
        return new Response(JSON.stringify({chart:{result:[{timestamp:[${yahooDay("2026-10-13")}, ${yahooDay("2026-10-14")}],indicators:{quote:[{close:[100.0, 203.5]}]}}]}}));
      }
      if (options.method === 'POST') { console.log('POSTED=1'); return new Response('{}'); }
      return new Response(JSON.stringify({ok:true,schema_version:'qsl.market_benchmark_points.v1',inception_date:'2026-10-09',points:${JSON.stringify(storedPts)}}));
    };
    process.argv[1] = ${JSON.stringify(fileURLToPath(producerUrl))};
    await import(${JSON.stringify(producerUrl.href)});
  `;
  for (const [hash, expectOk] of [[approved, true], ["e".repeat(64), false]]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", harness], {
      encoding: "utf8",
      env: {
        ...process.env,
        MARKET_BENCHMARK_APPLY_REVISION: "true",
        MARKET_BENCHMARK_DRY_RUN: "true",
        MARKET_BENCHMARK_SYNC_URL: "https://console.example/api/market-benchmark/sync",
        MARKET_BENCHMARK_APPROVED_PROPOSAL_SHA256: hash,
        MARKET_BENCHMARK_REVISION_TOKEN: "",
        MARKET_BENCHMARK_REVISION_PAYLOAD_JSON: "",
      },
    });
    const output = result.stdout + result.stderr;
    assert.equal(output.includes("POSTED="), false, output);
    assert.equal(output.includes("203.5"), false, output);
    assert.equal(output.includes("200.0"), false, output);
    if (expectOk) {
      assert.equal(result.status, 0, output);
      assert.match(output, /"approved_proposal_sha256_match":true/);
      assert.match(output, /"overwrites":4/);
      assert.match(output, /"deletes":0/);
      assert.match(output, /"untouched_points":4/);
    } else {
      assert.equal(result.status, 1, output);
      assert.match(result.stderr, /benchmark_revision_approval_mismatch/);
    }
  }
}
console.log("market_benchmark_apply_from_upstream_validation ok");
