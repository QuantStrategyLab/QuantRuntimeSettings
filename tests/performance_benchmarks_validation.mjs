import assert from "node:assert/strict";
import worker from "../web/strategy-switch-console/worker.js";

const path = "/api/market-benchmark/performance?start=2026-10-12&end=2026-10-14";
const symbols = ["SPY", "QQQ", "IWM", "DIA"];
let points = symbols.flatMap(seriesId => [
  { seriesId, observationDate: "2026-10-12", close: "100", source: "yahoo_chart_v8" },
  { seriesId, observationDate: "2026-10-13", close: "90", source: "yahoo_chart_v8" },
  { seriesId, observationDate: "2026-10-14", close: "110", source: "yahoo_chart_v8" },
]);
let reads = 0;
const env = { STRATEGY_SWITCH_RUNTIME_INSTANCES: {
  idFromName: name => name,
  get: () => ({ fetch: async (_url, init) => {
    const command = JSON.parse(init.body);
    assert.equal(command.action, "market_benchmark_read");
    assert.equal(command.performance, true);
    reads++;
    return Response.json({ ok: true, points });
  } }),
} };
async function read(url = path, environment = env, method = "GET") {
  return worker.fetch(new Request(`https://console.example${url}`, { method }), environment);
}

// Adverse: transport diagnostics must never cross the public boundary.
const diagnostic = "synthetic-private-diagnostic@example.invalid";
const broken = { STRATEGY_SWITCH_RUNTIME_INSTANCES: {
  idFromName: name => name, get: () => ({ fetch: async () => Response.json({ error: diagnostic }, { status: 500 }) }),
} };
let response = await read(path, broken);
assert.equal(response.status, 503, "transport failure must fail closed");
assert.equal((await response.text()).includes(diagnostic), false, "never echo store diagnostics");
console.log("PASS redaction_transport_failure");

response = await read();
assert.equal(response.status, 200);
const body = await response.json();
assert.equal(body.status, "available");
assert.deepEqual(body.series.map(s => s.symbol), symbols);
for (const series of body.series) {
  assert.equal(series.status, "available");
  assert.deepEqual(series.points.map(p => p.date), ["2026-10-12", "2026-10-13", "2026-10-14"]);
  assert.deepEqual(series.points.map(p => p.cumulative_return_ratio), [0, -0.1, 0.1]);
}
console.log("PASS four_etfs_normalized_to_strategy_window");

// Adverse: an updated cache must be read again; no warm-process snapshot.
points = points.filter(p => p.seriesId !== "SPY");
response = await read();
let changed = await response.json();
assert.equal(changed.status, "partial");
assert.equal(changed.series[0].status, "unavailable");
assert.deepEqual(changed.series[0].points, []);
assert.ok(reads >= 2);
console.log("PASS current_cache_reread");

// Adverse: missing anchors, duplicate keys, corrupt closes and index substitutes.
for (const bad of [
  [{ seriesId: "SPY", observationDate: "2026-10-13", close: "100" }],
  [{ seriesId: "SPY", observationDate: "2026-10-12", close: "0" }],
  [{ seriesId: "SPY", observationDate: "2026-10-12", close: "100" }, { seriesId: "SPY", observationDate: "2026-10-12", close: "101" }],
  [{ seriesId: "标普500", observationDate: "2026-10-12", close: "100" }],
]) {
  points = bad;
  response = await read();
  assert.equal(response.status, 200);
  changed = await response.json();
  assert.equal(changed.status, "unavailable");
  assert.equal(changed.series[0].status, "unavailable");
  assert.deepEqual(changed.series[0].points, []);
}
console.log("PASS invalid_missing_conflicting_data_not_success");
for (const query of ["", "?start=2026-02-30&end=2026-10-14", "?start=2026-10-15&end=2026-10-14", "?start=2026-10-12&start=2026-10-13&end=2026-10-14"]) {
  assert.equal((await read(`/api/market-benchmark/performance${query}`)).status, 400);
}
assert.equal((await read(path, {}, "POST")).status, 405);
assert.equal((await read(path, {})).status, 503);
const head = await read(path, env, "HEAD");
assert.equal(head.status, 200);
assert.equal(await head.text(), "");
assert.equal(head.headers.get("Cache-Control"), "no-store");
console.log("PASS query_method_and_store_gates");

points = symbols.flatMap(seriesId => [
  { seriesId, observationDate: "2026-10-11", close: "999" },
  { seriesId, observationDate: "2026-10-12", close: "100" },
  { seriesId, observationDate: "2026-10-14", close: "110" },
  { seriesId, observationDate: "2026-10-15", close: "999" },
]);
const sparse = await (await read()).json();
assert.equal(sparse.calendar_coverage, "not_verified");
assert.deepEqual(sparse.series[0].points.map(p => p.date), ["2026-10-12", "2026-10-14"]);
assert.equal(sparse.series[0].points[0].cumulative_return_ratio, 0);
console.log("PASS clipping_and_missing_interior_dates_without_fill");


// Production parser and cache admission accept ETF symbols, independently of indices.
const { benchmarkSymbolsForSet, normalizeMarketBenchmarkSyncPayload, parseYahooChartDailyCloses } =
  await import("../web/strategy-switch-console/infrastructure/market_benchmark/market_benchmark.js");
assert.deepEqual(Object.keys(benchmarkSymbolsForSet("performance")), symbols);
assert.throws(() => benchmarkSymbolsForSet("unknown"));
const bars = symbols.flatMap(seriesId => parseYahooChartDailyCloses({ chart: { result: [{
  timestamp: [Date.parse("2026-10-12T20:00:00Z") / 1000, Date.parse("2026-10-14T20:00:00Z") / 1000],
  indicators: { quote: [{ close: [100, 110] }] },
}] } }, { seriesId }));
assert.equal(normalizeMarketBenchmarkSyncPayload({ schema_version: "qsl.market_benchmark_points.v1", points: bars }).points.length, 8);
const { createRequire } = await import("node:module");
const { fileURLToPath } = await import("node:url");
const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");
const mf = new Miniflare({ modules: true, modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08",
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  outboundService: () => { throw Error("outbound_forbidden"); },
});
try {
  const namespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const stub = namespace.get(namespace.idFromName("runtime-instances"));
  const put = await stub.fetch("https://runtime-instances/", { method: "POST", body: JSON.stringify({
    action: "market_benchmark_put", payload: { schema_version: "qsl.market_benchmark_points.v1", points: bars },
  }) });
  assert.equal(put.status, 200);
  const cached = await read(path, { STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace });
  assert.equal(cached.status, 200);
  const model = await cached.json();
  assert.equal(model.status, "available");
  assert.equal(model.series[0].points.at(-1).cumulative_return_ratio, 0.1);
  const second = await read(path, { STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace });
  assert.deepEqual(await second.json(), model);
} finally { await mf.dispose(); }
console.log("PASS etf_parser_and_real_sqlite_cache_roundtrip_no_egress");

// Run the existing producer with synthetic Yahoo and receiver responses only.
const { spawnSync } = await import("node:child_process");
const producerUrl = new URL("../scripts/sync_market_benchmark_closes.mjs", import.meta.url);
const harness = `
  const requested = [], posted = [];
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'query1.finance.yahoo.com') {
      requested.push(decodeURIComponent(parsed.pathname.split('/').at(-1)));
      return Response.json({chart:{result:[{timestamp:[Date.parse('2026-10-12T20:00:00Z')/1000],indicators:{quote:[{close:[100]}]}}]}});
    }
    if (options.method === 'POST') {
      posted.push(...JSON.parse(options.body).points.map(p=>p.seriesId));
      return Response.json({ok:true,stored:true});
    }
    return Response.json({ok:true,schema_version:'qsl.market_benchmark_points.v1',inception_date:null,points:[]});
  };
  process.on('exit',()=>console.log('RESULT='+JSON.stringify({requested,posted})));
  process.argv[1]=${JSON.stringify(fileURLToPath(producerUrl))};
  await import(${JSON.stringify(producerUrl.href)});
`;
const result = spawnSync(process.execPath, ["--input-type=module", "--eval", harness], {
  encoding: "utf8", env: { ...process.env, MARKET_BENCHMARK_SERIES_SET: "performance",
    MARKET_BENCHMARK_SYNC_URL: "https://console.example/api/market-benchmark/sync",
    MARKET_BENCHMARK_SYNC_TOKEN: "synthetic-test-only", MARKET_BENCHMARK_DRY_RUN: "false",
    MARKET_BENCHMARK_APPLY_REVISION: "false", MARKET_BENCHMARK_FROM_DATE: "", MARKET_BENCHMARK_THROUGH_DATE: "" },
});
assert.equal(result.status, 0, "synthetic ETF producer must finish successfully");
const receipt = JSON.parse(result.stdout.split("\n").find(line => line.startsWith("RESULT=")).slice(7));
assert.deepEqual(receipt.requested, symbols);
assert.deepEqual(receipt.posted, symbols);
console.log("PASS existing_producer_performance_mode_synthetic_only");
