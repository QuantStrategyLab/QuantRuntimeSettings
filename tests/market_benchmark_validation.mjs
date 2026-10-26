import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  MARKET_BENCHMARK_MAX_POINTS,
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
import { MARKET_BENCHMARK_API_URL, loadMarketBenchmarkPoints } from "../web/strategy-switch-console/frontend/src/marketBenchmark.ts";
import worker, { __test } from "../web/strategy-switch-console/worker.js";
import { benchmarkHistoryWindow, buildUpstreamRevisionPayload, closedSessionPoints, diagnoseBenchmarkPoints, newYorkDate } from "../scripts/sync_market_benchmark_closes.mjs";
import { createHash } from "node:crypto";

assert.equal(MARKET_BENCHMARK_MAX_POINTS, 64);
assert.equal(MARKET_BENCHMARK_API_URL, "/api/market-benchmark");
assert.equal(__test.MARKET_BENCHMARK_API_PATH, "/api/market-benchmark");
assert.equal(__test.MARKET_BENCHMARK_SYNC_PATH, "/api/market-benchmark/sync");
// Cloudflare reports the published object's properties as named handlers. Keep
// its old shape without reintroducing the launch-date data filter tested below.
assert.equal(__test.MARKET_BENCHMARK_INCEPTION_DATE_CONST, "2026-10-09");
assert.deepEqual([...MARKET_BENCHMARK_SERIES_IDS], Object.keys(MARKET_BENCHMARK_YAHOO_SYMBOLS));

assert.equal(normalizeMarketBenchmarkClose("5710.25"), "5710.25");
assert.throws(() => normalizeMarketBenchmarkClose("0"), (error) => error instanceof MarketBenchmarkError && error.code === "market_benchmark_zero_close_rejected");
assert.throws(() => normalizeMarketBenchmarkClose("0.0"), (error) => error.code === "market_benchmark_zero_close_rejected");
assert.throws(() => normalizeMarketBenchmarkClose("-1"), (error) => error instanceof MarketBenchmarkError);

assert.equal(normalizeMarketBenchmarkPoint({
  seriesId: "标普500", observationDate: "2026-10-08", close: "5700",
}).observationDate, "2026-10-08");
for (const date of ["2026-02-30", "2026-13-01", "0000-01-01", "2026-10-1", "not-a-date"]) {
  assert.throws(() => normalizeMarketBenchmarkPoint({ seriesId: "标普500", observationDate: date, close: "1" }),
    error => error.code === "invalid_market_benchmark_date");
}

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
});
assert.equal(dropped.points.length, 3);
assert.equal(dropped.inception_date, "2026-10-08");

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
assert.deepEqual(publicModel.points.map((point) => point.observationDate), ["2026-10-08", "2026-10-09"]);
assert.equal(publicModel.inception_date, "2026-10-08");
assert.equal(publicMarketBenchmarkReadModel([]).inception_date, null);
assert.equal(publicMarketBenchmarkReadModel([{ seriesId: "标普500", observationDate: "2026-01-01", close: "0" }]).inception_date, null);

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
// Historical positive closes survive; zero closes still do not.
assert.equal(parsed.length, 1);
assert.ok(parsed[0].observationDate < "2026-10-09");

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
  const revisionDates = [];
  for (let time = Date.parse("2026-09-17T00:00:00Z"); time <= Date.parse("2026-10-14T00:00:00Z"); time += 86400000) {
    if (![0, 6].includes(new Date(time).getUTCDay())) revisionDates.push(new Date(time).toISOString().slice(0, 10));
  }
  assert.equal(revisionDates.length, 20);
  const storedPts = seriesIds.flatMap(s => revisionDates.map(observationDate => ({ seriesId: s, observationDate,
    close: observationDate === "2026-10-14" ? "200.0" : "100.0", source: "yahoo_chart_v8" })));
  const candidatePts = seriesIds.flatMap(s => revisionDates.map(observationDate => ({ seriesId: s, observationDate,
    close: observationDate === "2026-10-14" ? "203.5" : "100.0", source: "yahoo_chart_v8" })));
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
  assert.equal(payload.summary.identical_keys, 76);
  assert.equal(payload.summary.differing_keys, 4);
  assert.ok(payload.replacements.every((p) => p.observationDate === "2026-10-14" && p.close === "203.5"));
  // Detection time does not change the approved hash.
  assert.equal(buildUpstreamRevisionPayload(candidatePts, storedPts, approved, "2026-10-16T00:00:00Z").proposal.proposal_sha256, approved);

  // End-to-end apply dry run: no POST, no token required, logs hashes/counts only.
  const yahooDay = (d) => Date.parse(`${d}T20:00:00Z`) / 1000;
  const harness = `
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).startsWith('https://query1.finance.yahoo.com/v8/finance/chart/')) {
        return new Response(JSON.stringify({chart:{result:[{timestamp:${JSON.stringify(revisionDates.map(yahooDay))},indicators:{quote:[{close:${JSON.stringify(revisionDates.map(d => d === "2026-10-14" ? 203.5 : 100))}}]}}]}}));
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
      assert.match(output, /"untouched_points":76/);
    } else {
      assert.equal(result.status, 1, output);
      assert.match(result.stderr, /benchmark_revision_approval_mismatch/);
    }
  }
}
console.log("market_benchmark_apply_from_upstream_validation ok");

// Paired explicit historical windows use finite Yahoo periods, then clip by the
// actual New York session date. Default scheduled fetches retain range=10d.
assert.deepEqual(benchmarkHistoryWindow("2026-09-24", "2026-10-08", new Date("2026-10-26T12:00:00Z")),
  { from: "2026-09-24", through: "2026-10-08" });
assert.equal(benchmarkHistoryWindow("", ""), null);
for (const pair of [["2026-09-24", ""], ["", "2026-10-08"], ["2026-02-30", "2026-10-08"], ["2026-10-08", "2026-09-24"]]) {
  assert.throws(() => benchmarkHistoryWindow(...pair), /benchmark_history_window_invalid/);
}
assert.throws(() => benchmarkHistoryWindow("2026-10-25", "2026-10-26", new Date("2026-10-26T21:30:00Z")),
  /benchmark_history_window_not_closed/);
const earlierDates = [];
for (let time = Date.parse("2026-09-24T00:00:00Z"); time <= Date.parse("2026-10-08T00:00:00Z"); time += 86400000) {
  if (![0, 6].includes(new Date(time).getUTCDay())) earlierDates.push(new Date(time).toISOString().slice(0, 10));
}
assert.equal(earlierDates.length, 11);
for (const scenario of ["historical", "historical_dry", "historical_empty", "scheduled_empty", "partial_pair", "future", "revision", "oversize", "conflict"]) {
  const env = { ...process.env, MARKET_BENCHMARK_SYNC_URL: "https://console.example/api/market-benchmark/sync",
    MARKET_BENCHMARK_SYNC_TOKEN: "synthetic_secret_marker", MARKET_BENCHMARK_APPLY_REVISION: scenario === "revision" ? "true" : "false",
    MARKET_BENCHMARK_DRY_RUN: scenario === "historical_dry" ? "true" : "false", MARKET_BENCHMARK_RANGE: "10d",
    MARKET_BENCHMARK_FROM_DATE: scenario === "scheduled_empty" ? "" : scenario === "oversize" ? "2026-08-01" : "2026-09-24",
    MARKET_BENCHMARK_THROUGH_DATE: scenario === "scheduled_empty" || scenario === "partial_pair" ? ""
      : scenario === "future" ? "9999-12-31" : "2026-10-08" };
  const harness = `
    const scenario = ${JSON.stringify(scenario)};
    let yahoo = 0, reads = 0, posts = 0, postedDates = [];
    process.on('exit', () => console.log('SUMMARY=' + JSON.stringify({yahoo,reads,posts,postedDates})));
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(url);
      if (parsed.hostname === 'query1.finance.yahoo.com') {
        yahoo++;
        if (options.headers.Authorization) throw new Error('unexpected_upstream_auth');
        if (scenario === 'scheduled_empty') {
          if (parsed.searchParams.get('range') !== '10d' || parsed.searchParams.has('period1')) throw new Error('cron_range_changed');
        } else {
          if (parsed.searchParams.has('range') || !parsed.searchParams.has('period1') || !parsed.searchParams.has('period2')) throw new Error('historical_period_missing');
          const from = Date.parse(${JSON.stringify(env.MARKET_BENCHMARK_FROM_DATE)} + 'T00:00:00Z') / 1000;
          const through = Date.parse('2026-10-08T00:00:00Z') / 1000;
          if (+parsed.searchParams.get('period1') !== from || +parsed.searchParams.get('period2') !== through + 2*86400) throw new Error('historical_period_wrong');
        }
        let dates = ${JSON.stringify(earlierDates)}.map(d => Date.parse(d+'T20:00:00Z')/1000);
        // This timestamp's UTC date is 9/24 but its NY date is 9/23: exclude it.
        dates.unshift(Date.parse('2026-09-24T03:00:00Z')/1000);
        dates.push(Date.parse('2026-10-09T20:00:00Z')/1000);
        if (scenario.endsWith('empty')) dates = [];
        if (scenario === 'oversize') dates = Array.from({length:17},(_,i)=>Date.parse('2026-08-03T20:00:00Z')/1000+i*86400);
        return new Response(JSON.stringify({chart:{result:[{timestamp:dates,indicators:{quote:[{close:dates.map(()=>9876.54321)}]}}]}}));
      }
      if (options.method === 'POST') {
        posts++;
        if (options.redirect !== 'manual') throw new Error('post_redirect_enabled');
        const body = JSON.parse(options.body);
        if (body.points.length !== 44) throw new Error('wrong_historical_batch');
        postedDates = [...new Set(body.points.map(p=>p.observationDate))].sort();
        if (postedDates[0] !== '2026-09-24' || postedDates.at(-1) !== '2026-10-08') throw new Error('ny_window_not_clipped');
        return new Response(JSON.stringify({ok:true,stored:true,inception_date:'2026-09-24',written:44}));
      }
      if (String(url) !== 'https://console.example/api/market-benchmark' || options.method !== 'GET' || options.headers.Authorization) throw new Error('unexpected_request');
      reads++;
      const points = scenario === 'conflict' ? [{seriesId:'标普500',observationDate:'2026-09-24',close:'1',source:'yahoo_chart_v8'}] : [];
      return new Response(JSON.stringify({ok:true,schema_version:'qsl.market_benchmark_points.v1',inception_date:points.length?'2026-09-24':null,points}));
    };
    process.argv[1] = ${JSON.stringify(fileURLToPath(producerUrl))};
    await import(${JSON.stringify(producerUrl.href)});
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", harness], { encoding: "utf8", env });
  const output = result.stdout + result.stderr;
  assert.equal(output.includes("synthetic_secret_marker"), false);
  assert.equal(output.includes("9876.54321"), false);
  const summary = JSON.parse(result.stdout.split("\n").find(line => line.startsWith("SUMMARY=")).slice(8));
  if (["historical", "historical_dry", "scheduled_empty"].includes(scenario)) {
    assert.equal(result.status, 0, output);
    assert.equal(summary.posts, scenario === "historical" ? 1 : 0);
    assert.equal(summary.yahoo, 4);
    if (scenario !== "scheduled_empty") assert.match(output, /points=11 skipped_open_session=0 skipped_outside_window=2/);
  } else {
    assert.equal(result.status, 1, output);
    assert.equal(summary.posts, 0);
    const expected = { historical_empty: "benchmark_history_no_points", partial_pair: "benchmark_history_window_invalid",
      future: "benchmark_history_window_not_closed", revision: "benchmark_history_revision_exclusive",
      oversize: "market_benchmark_points_limit", conflict: "frozen_history_conflict" }[scenario];
    assert.ok(output.includes(expected), output);
    if (["partial_pair", "future", "revision"].includes(scenario)) assert.equal(summary.yahoo + summary.reads, 0);
  }
}
assert.match(workflow, /MARKET_BENCHMARK_FROM_DATE:[^\n]*inputs\.from_date/);
assert.match(workflow, /MARKET_BENCHMARK_THROUGH_DATE:[^\n]*inputs\.through_date/);
console.log("market_benchmark_historical_producer_validation ok");

// Large ordinary ranges remain useful for read-only diagnostics and tolerance:
// 76 tolerated keys keep their stored closes; only four new points are posted.
const largeDates = Array.from({ length: 20 }, (_, i) => new Date(Date.parse("2026-08-03T00:00:00Z") + i * 86400000).toISOString().slice(0, 10));
for (const scenario of ["deduped", "dry", "oversize_post"]) {
  const stored = scenario === "deduped" ? MARKET_BENCHMARK_SERIES_IDS.flatMap(seriesId => largeDates.slice(0, -1)
    .map(observationDate => ({ seriesId, observationDate, close: "9876.5432", source: "yahoo_chart_v8" }))) : [];
  const harness = `
    let posts = 0;
    process.on('exit', () => console.log('POSTS=' + posts));
    globalThis.fetch = async (url, options = {}) => {
      if (new URL(url).hostname === 'query1.finance.yahoo.com') {
        if (new URL(url).searchParams.get('range') !== '1mo' || new URL(url).searchParams.has('period1')) throw new Error('ordinary_range_changed');
        const dates = ${JSON.stringify(largeDates)};
        return new Response(JSON.stringify({chart:{result:[{timestamp:dates.map(d=>Date.parse(d+'T20:00:00Z')/1000),indicators:{quote:[{close:dates.map(()=>9876.54321)}]}}]}}));
      }
      if (options.method === 'POST') {
        posts++;
        if (JSON.parse(options.body).points.length !== 4) throw new Error('wrong_deduped_batch');
        return new Response(JSON.stringify({ok:true,stored:true,written:4}));
      }
      return new Response(JSON.stringify({ok:true,schema_version:'qsl.market_benchmark_points.v1',inception_date:${stored.length ? "'2026-08-03'" : "null"},points:${JSON.stringify(stored)}}));
    };
    process.argv[1] = ${JSON.stringify(fileURLToPath(producerUrl))};
    await import(${JSON.stringify(producerUrl.href)});
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", harness], { encoding: "utf8", env: {
    ...process.env, MARKET_BENCHMARK_SYNC_URL: "https://console.example/api/market-benchmark/sync",
    MARKET_BENCHMARK_SYNC_TOKEN: "synthetic_secret_marker", MARKET_BENCHMARK_RANGE: "1mo",
    MARKET_BENCHMARK_FROM_DATE: "", MARKET_BENCHMARK_THROUGH_DATE: "", MARKET_BENCHMARK_APPLY_REVISION: "false",
    MARKET_BENCHMARK_DRY_RUN: scenario === "dry" ? "true" : "false",
  } });
  const output = result.stdout + result.stderr;
  assert.equal(result.status, scenario === "oversize_post" ? 1 : 0, output);
  assert.match(output, /payload_points=80/);
  assert.match(output, scenario === "deduped" ? /POSTS=1/ : /POSTS=0/);
  if (scenario === "oversize_post") assert.match(output, /market_benchmark_points_limit/);
  assert.equal(output.includes("synthetic_secret_marker") || output.includes("9876.54321"), false, output);
}
console.log("market_benchmark_large_range_validation ok");

// Actual DO/SQLite stores old dates, reports the earliest valid persisted date,
// and rolls back the whole batch when any existing close conflicts.
const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");
let outbound = 0;
const mf = new Miniflare({ modules: true, modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08", bindings: { MARKET_BENCHMARK_SYNC_TOKEN: "synthetic-benchmark-token" },
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  outboundService: () => { outbound++; throw new Error("outbound forbidden"); } });
try {
  const namespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const env = { MARKET_BENCHMARK_SYNC_TOKEN: "synthetic-benchmark-token", STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace };
  const get = async () => {
    const response = await worker.fetch(new Request("https://synthetic.example/api/market-benchmark"), env);
    assert.equal(response.status, 200);
    return response.json();
  };
  const post = points => worker.fetch(new Request("https://synthetic.example/api/market-benchmark/sync", { method: "POST",
    headers: { Authorization: "Bearer synthetic-benchmark-token", "Content-Type": "application/json" },
    body: JSON.stringify({ schema_version: MARKET_BENCHMARK_SCHEMA, points }) }), env);
  assert.equal((await get()).inception_date, null);
  assert.equal((await post([{ seriesId: "标普500", observationDate: "2026-10-09", close: "200" }])).status, 200);
  const early = MARKET_BENCHMARK_SERIES_IDS.flatMap(seriesId => earlierDates.map(observationDate => ({ seriesId, observationDate, close: "100" })));
  const ackResponse = await post(early);
  assert.equal(ackResponse.status, 200, await ackResponse.clone().text());
  assert.equal((await ackResponse.json()).inception_date, "2026-09-24");
  const before = await get();
  assert.equal(before.inception_date, "2026-09-24");
  assert.equal(before.points.length, 45);
  assert.equal((await (await post(early)).json()).unchanged, 44);
  const conflict = await post([{ seriesId: "标普500", observationDate: "2026-09-23", close: "100" },
    { ...early.find(point => point.seriesId === "标普500"), close: "101" }]);
  assert.equal(conflict.status, 409);
  assert.deepEqual(await get(), before, "a frozen-key conflict rolls back even an earlier insert in the same batch");
  assert.equal((await post(Array(65).fill(early[0]))).status, 400);
  assert.equal((await post([{ ...early[0], observationDate: "2026-02-30" }])).status, 400);
  assert.equal((await post([{ ...early[0], close: "0" }])).status, 400);
  assert.deepEqual(await get(), before);
  assert.equal(outbound, 0);
} finally { await mf.dispose(); }
console.log("market_benchmark_historical_sqlite_validation ok");
