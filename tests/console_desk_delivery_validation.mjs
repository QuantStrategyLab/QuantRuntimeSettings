// Regression coverage for the actual embedded Worker and target-specific mock callers.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../web/strategy-switch-console/worker.js";
import { V2_ASSETS, V2_PAGE_HTML } from "../web/strategy-switch-console/v2_asset_map.js";
import { createDeskApi } from "../web/strategy-switch-console/frontend/src/desk/api/endpoints.ts";
import { catalogCounts, INITIAL_STRATEGY_FLOW, strategyFlowReducer } from "../web/strategy-switch-console/frontend/src/desk/strategies/model.ts";

const origin = "https://console.invalid";
test("Worker serves every clean-build resource with identical bytes", async () => {
  const dist = new URL("../web/strategy-switch-console/frontend/dist/", import.meta.url);
  const files = (await readdir(dist, { recursive: true, withFileTypes: true })).filter(f => f.isFile());
  const paths = [];
  for (const file of files) {
    const path = join(file.parentPath, file.name);
    const name = relative(fileURLToPath(dist), path);
    if (name === "index.html") continue;
    const route = `/v2/assets/${name.replace(/^assets\//, "")}`;
    paths.push(route);
    const response = await worker.fetch(new Request(origin + route), {});
    assert.equal(response.status, 200, `built resource must be embedded: ${route}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(path), route);
  }
  assert.deepEqual(paths.sort(), Object.keys(V2_ASSETS).sort(), "no stale embedded resources");
  const html = await readFile(new URL("index.html", dist), "utf8");
  assert.equal(V2_PAGE_HTML.replace(/<meta name="qsl-console-build" content="[a-f0-9]+" \/>\n  /, ""), html);
});

for (const scenario of ["ok", "degraded"]) {
  for (const [target, domain, profile, eligibility, modes, counts] of [
    ["binance/spot", "crypto", "crypto_btc_dca", "no_live", ["paper", "dry_run"], { all: 1, eligible: 0, paper: 1, blocked: 0 }],
    ["longbridge/hk", "hk_equity", "hk_global_etf_tactical_rotation", "blocked", ["dry_run"], { all: 1, eligible: 0, paper: 0, blocked: 1 }],
  ]) {
    test(`${scenario}: ${target} exposes only its domain and preserves research restrictions`, async () => {
      const api = createDeskApi({ forcedScenario: scenario, delayMs: 0,
        fetchJson: async () => { throw new Error("mock catalog must not fetch"); } });
      const { data } = await api.switchStrategies(target);
      assert.equal(data.target_id, target);
      assert.equal(data.domain, domain);
      assert.ok(data.strategies.length > 0);
      for (const entry of data.strategies) assert.equal(entry.domain, domain, "no US catalog inherited");
      const entry = data.strategies.find(entry => entry.profile === profile);
      assert.ok(entry, "existing target strategy is represented");
      assert.equal(entry.eligibility, eligibility);
      assert.deepEqual(entry.allowed_execution_modes, modes);
      assert.deepEqual(catalogCounts(data.strategies), counts);
      const state = strategyFlowReducer(INITIAL_STRATEGY_FLOW, { type: "select_target", targetId: target });
      assert.equal(strategyFlowReducer(state, { type: "select_strategy", ...entry }).step,
        eligibility === "blocked" ? "strategy" : "preview");
    });
  }
}

test("offered credential rotation links reach the existing Health route through the Worker", async () => {
  const api = createDeskApi({ forcedScenario: "ok", delayMs: 0 });
  const { data } = await api.credentials();
  const supported = data.items.filter(item => item.rotation.supported);
  assert.ok(supported.length > 0);
  for (const item of supported) {
    const url = new URL(item.rotation.route, origin);
    const response = await worker.fetch(new Request(url), {});
    assert.equal(response.status, 200, "offered route must be served");
    assert.equal(url.searchParams.get("page"), "health", "select the existing Health page");
    assert.equal(await response.text(), V2_PAGE_HTML);
  }
});
