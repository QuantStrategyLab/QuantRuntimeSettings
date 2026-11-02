import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadReadModel } from "../web/strategy-switch-console/frontend/src/api.ts";
import { overviewRuntimeStatusLabel } from "../web/strategy-switch-console/frontend/src/presentation.ts";
import { loadOverviewUsdRates, resetOverviewUsdRatesCache } from "../web/strategy-switch-console/frontend/src/overviewUsd.ts";

const monitored = {
  scope: "monitoring_only",
  limit: "not_trading_or_books",
  health: "normal",
  activation: "enabled",
  reason: "monitoring_agrees",
};
assert.equal(overviewRuntimeStatusLabel(monitored, "ready"), "健康");
assert.equal(overviewRuntimeStatusLabel({ ...monitored, activation: "disabled" }, "ready"), "健康");
assert.equal(overviewRuntimeStatusLabel({ ...monitored, health: "unknown", activation: "disabled" }, "ready"), "异常");
assert.equal(overviewRuntimeStatusLabel({ ...monitored, health: "abnormal", activation: "enabled" }, "ready"), "异常");
assert.equal(overviewRuntimeStatusLabel({ ...monitored, health: "unknown", activation: "unknown", reason: "source_not_fresh" }, "stale"), "异常");

const originalFetch = globalThis.fetch;
const denyNetwork = async () => { throw new Error("external network is forbidden in overview refresh validation"); };
const requestedPaths = [];
globalThis.fetch = async (path, options) => {
  const unused = ["/api/strategy-health", "/api/execution-evidence", "/api/research-tasks", "/api/runtime-catalog", "/api/m0-research", "/api/adaptive-selection"];
  assert.ok(!unused.includes(path), `${path} has no overview consumer and must not delay loading`);
  assert.ok(["/api/session", "/api/config", "/api/runtime-target-lifecycle", "/api/control-plane", "/api/ux1/draft", "/api/owner-decisions", "/api/reconciliation-recovery", "/api/research-promotion-tickets", "/api/account-facts", "/api/binance-account-facts"].includes(path), "only current read-model sources are mocked");
  assert.equal(options.method, "GET");
  requestedPaths.push([path, options.method, options.cache]);
  const payload = path === "/api/session" ? { allowed: true, admin: false } : path === "/api/runtime-target-lifecycle" ? { data_status: "ready" } : { data_status: "fresh" };
  return { status: 200, ok: true, json: async () => payload };
};
try {
  const model = await loadReadModel();
  assert.deepEqual(requestedPaths.map(([path]) => path), ["/api/session", "/api/config", "/api/runtime-target-lifecycle", "/api/control-plane", "/api/ux1/draft", "/api/owner-decisions", "/api/reconciliation-recovery", "/api/research-promotion-tickets", "/api/account-facts", "/api/binance-account-facts"]);
  assert.equal(model.runtime.value.data_status, "ready");
  assert.equal(model.accountFacts.value.data_status, "fresh");
  assert.equal("health" in model, false);
  assert.equal("evidence" in model, false);
  assert.equal("tasks" in model, false);
  assert.equal("catalog" in model, false);
  assert.equal("market" in model, false);
  assert.equal("adaptive" in model, false);
} finally {
  globalThis.fetch = denyNetwork;
}

const liveRoot = new URL("../web/strategy-switch-console/frontend/src/", import.meta.url);
for (const file of ["app/App.tsx", "app/AppShell.tsx"]) {
  const shell = readFileSync(new URL(file, liveRoot), "utf8");
  assert.doesNotMatch(shell, /startVisibleRefreshLoop|window\.setInterval/, `${file} must not install background or focus-driven network refreshes`);
}
// Live data hook: only the latest request commits and unmount cancels (stale-response protection).
const hooks = readFileSync(new URL("lib/hooks.ts", liveRoot), "utf8");
assert.match(hooks, /const token = gate\.current\.begin\(\)/);
assert.match(hooks, /!cancelled && gate\.current\.isCurrent\(token\)/);
assert.match(hooks, /return \(\) => \{\s*cancelled = true;/);
assert.match(hooks, /\[\.\.\.deps, epoch\]/, "explicit reload restarts the read without polling");

const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

console.log("overview refresh validation: PASS");

// The production FX loader: a failed initial request must recover on the next explicit call without polling.
const fxPending = [];
globalThis.fetch = (path, options) => {
  assert.equal(path, "/api/overview-fx", "FX refresh reads only the existing same-origin endpoint");
  assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store");
  return new Promise(resolve => fxPending.push(resolve));
};
resetOverviewUsdRatesCache();
try {
  const first = loadOverviewUsdRates();
  assert.equal(fxPending.length, 1);
  fxPending[0](new Response(JSON.stringify({ ok: false, error: "overview_fx_upstream_unavailable" }), { status: 502 }));
  assert.deepEqual({ ...(await first) }, {}, "failed FX never manufactures conversion rates");
  const retry = loadOverviewUsdRates();
  assert.equal(fxPending.length, 2, "an explicit later call retries FX after its initial failure");
  const duplicate = loadOverviewUsdRates();
  assert.equal(fxPending.length, 2, "concurrent calls do not duplicate an in-flight FX read");
  fxPending[1](new Response(JSON.stringify({ base: "USD", rates: { HKD: 8, SGD: 2 } }), { status: 200 }));
  assert.deepEqual({ ...(await retry) }, { HKD: "0.125", SGD: "0.5" }, "recovered reference rates are inverted for USD conversion");
  assert.deepEqual({ ...(await duplicate) }, { HKD: "0.125", SGD: "0.5" });
  await loadOverviewUsdRates();
  assert.equal(fxPending.length, 2, "the production loader caches a successful read");
  console.log("FX loader recovery: PASS");
} finally {
  resetOverviewUsdRatesCache(); globalThis.fetch = originalFetch;
}

await import("./console_load_lifecycle_validation.mjs");
