import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import worker from "../web/strategy-switch-console/worker.js";
import { MARKET_BENCHMARK_SCHEMA, MARKET_BENCHMARK_SERIES_IDS, publicMarketBenchmarkReadModel } from "../web/strategy-switch-console/infrastructure/market_benchmark/market_benchmark.js";
import { loadMarketBenchmarkPoints } from "../web/strategy-switch-console/frontend/src/marketBenchmark.ts";
import { planBenchmarkRevision } from "../scripts/market_benchmark_revision_policy.mjs";

const symbols = ["SPY", "QQQ", "IWM", "DIA"];
const at = "2026-10-15T00:00:00Z";
const point = (seriesId, observationDate = "2026-10-09") => ({ seriesId, observationDate, close: "100", source: "yahoo_chart_v8" });
const indices = MARKET_BENCHMARK_SERIES_IDS.map(id => point(id));
const etfs = symbols.map(id => point(id, "2026-10-08"));
const stored = [...indices, ...etfs];
function payloadFor(targets) {
  const replacements = targets.map(p => ({ ...p, close: "110" }));
  const proposal = planBenchmarkRevision(replacements, targets, { policy: "revision_proposal", detectedAt: at }).revision_proposal;
  return { proposal, approved_proposal_sha256: proposal.proposal_sha256, replacements, applied_at: at };
}

test("mixed_cache_preserves_actual_legacy_loader_and_index_inception", async () => {
  const baseline = publicMarketBenchmarkReadModel(indices);
  const mixed = publicMarketBenchmarkReadModel(stored);
  assert.equal(mixed.inception_date, baseline.inception_date);
  assert.deepEqual(await loadMarketBenchmarkPoints(async () => Response.json(mixed)), indices.map(({source, ...p}) => p).sort((a,b) => a.seriesId.localeCompare(b.seriesId)));
  assert.equal(mixed.points.filter(p => symbols.includes(p.seriesId)).length, 4, "raw additive ETF rows remain available");
  assert.equal(publicMarketBenchmarkReadModel(etfs).inception_date, null);
  assert.equal(publicMarketBenchmarkReadModel([...stored, point(indices[0].seriesId, "2026-10-07")]).inception_date, "2026-10-07", "earlier index semantics remain unchanged");
});

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require("miniflare");
test("receiver_rejects_each_etf_and_mixed_batch_without_writes", async () => {
  const mf = new Miniflare({ rootPath: fileURLToPath(new URL("../", import.meta.url)), modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
    compatibilityDate: "2026-06-08", durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
    outboundService: () => { throw Error("outbound_forbidden"); },
  });
  try {
    const namespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
    const stub = namespace.get(namespace.idFromName("runtime-instances"));
    const command = async body => {
      const response = await stub.fetch("https://runtime-instances/", { method: "POST", body: JSON.stringify(body) });
      assert.equal(response.status, 200);
      return response.json();
    };
    await command({ action: "market_benchmark_put", payload: { schema_version: MARKET_BENCHMARK_SCHEMA, points: stored } });
    const before = await command({ action: "market_benchmark_read", performance: true });
    const env = { STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace, MARKET_BENCHMARK_REVISION_TOKEN: "synthetic-test-only" };
    const revise = targets => worker.fetch(new Request("https://console.example/api/market-benchmark/revision", {
      method: "POST", headers: { Authorization: "Bearer synthetic-test-only", "Content-Type": "application/json" }, body: JSON.stringify(payloadFor(targets)),
    }), env);
    for (const targets of [...etfs.map(p => [p]), [indices[0], etfs[0]]]) {
      const response = await revise(targets);
      assert.equal(response.status, 400, "ETF revision must fail closed");
      assert.deepEqual(await response.json(), { ok: false, error: "benchmark_revision_series_unsupported" });
      assert.deepEqual(await command({ action: "market_benchmark_read", performance: true }), before, "reject whole batch before any write");
    }
    const legacy = await worker.fetch(new Request("https://console.example/api/market-benchmark"), env);
    assert.equal((await loadMarketBenchmarkPoints(async () => legacy)).length, 4);
    const approvedIndex = await revise(indices);
    assert.equal(approvedIndex.status, 200, "existing index revision remains available in mixed cache");
    const after = await command({ action: "market_benchmark_read", performance: true });
    assert.equal(after.points.filter(p => symbols.includes(p.seriesId) && p.close === "100").length, 4);
    assert.equal(after.points.filter(p => MARKET_BENCHMARK_SERIES_IDS.includes(p.seriesId) && p.close === "110").length, 4);
  } finally { await mf.dispose(); }
});

test("producer_explicit_payload_rejects_etfs_before_post_including_default_mode", () => {
  const producerUrl = new URL("../scripts/sync_market_benchmark_closes.mjs", import.meta.url);
  for (const targets of [...etfs.map(p => [p]), [indices[0], etfs[0]], indices]) {
    const allowed = targets === indices;
    const harness = `
      let posts = 0;
      globalThis.fetch = async (_url, options = {}) => {
        if (options.method === 'POST') { posts++; return Response.json({ok:true,applied:true}); }
        return Response.json(${JSON.stringify({ok:true,schema_version:MARKET_BENCHMARK_SCHEMA,inception_date:"2026-10-09",points:stored})});
      };
      process.on('exit',()=>console.log('POSTS='+posts));
      process.argv[1]=${JSON.stringify(fileURLToPath(producerUrl))};
      await import(${JSON.stringify(producerUrl.href)});
    `;
    const environment = { ...process.env, MARKET_BENCHMARK_SYNC_URL: "https://console.example/api/market-benchmark/sync",
      MARKET_BENCHMARK_REVISION_TOKEN: "synthetic-test-only", MARKET_BENCHMARK_APPLY_REVISION: "true",
      MARKET_BENCHMARK_REVISION_PAYLOAD_JSON: JSON.stringify(payloadFor(targets)), MARKET_BENCHMARK_DRY_RUN: "false",
      MARKET_BENCHMARK_FROM_DATE: "", MARKET_BENCHMARK_THROUGH_DATE: "", MARKET_BENCHMARK_APPROVED_PROPOSAL_SHA256: "" };
    delete environment.MARKET_BENCHMARK_SERIES_SET;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", harness], { encoding: "utf8", env: environment });
    assert.equal(result.status === 0, allowed, "default overview mode must validate actual revision targets");
    assert.ok(result.stdout.includes(`POSTS=${allowed ? 1 : 0}`));
    if (!allowed) assert.ok(result.stderr.includes("benchmark_revision_series_unsupported"));
  }
});
