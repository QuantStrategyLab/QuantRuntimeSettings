import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as constants from "../web/strategy-switch-console/application/binance_private_scope/constants.js";
import * as helpers from "../web/strategy-switch-console/application/binance_private_scope/helpers.js";
import * as http from "../web/strategy-switch-console/application/binance_private_scope/http.js";
import * as runtimeSupport from "../web/strategy-switch-console/application/worker/runtime_support.js";
import { loadWorkerSurface, stripComments, surfaceImportsModule } from "./helpers/worker_surface.mjs";

const surface = await loadWorkerSurface();
for (const layer of ["constants.js", "helpers.js", "http.js"]) {
  assert.equal(
    surfaceImportsModule(surface, `binance_private_scope/${layer}`),
    true,
    `Worker stack imports binance_private_scope/${layer}`,
  );
  const src = stripComments(
    await readFile(new URL(`../web/strategy-switch-console/application/binance_private_scope/${layer}`, import.meta.url), "utf8"),
  );
  assert.doesNotMatch(src, /from\s+["'][^"']*(?:runtime_support|worker|application\/worker\/)[^"']*["']/, `${layer} must not import worker modules`);
}

for (const key of [
  "BINANCE_PRIVATE_SCOPE_KEY",
  "BINANCE_PRIVATE_SCOPE_MAX_BODY_BYTES",
  "BINANCE_PRIVATE_SCOPE_MAX_ASSETS",
  "BINANCE_PRIVATE_SCOPE_WRITE_TTL_SECONDS",
  "BINANCE_PRIVATE_SCOPE_INGEST_MAX_AGE_MS",
  "BINANCE_PRIVATE_SCOPE_FUTURE_SKEW_MS",
  "BINANCE_PRIVATE_SCOPE_READ_MAX_AGE_MS",
]) {
  assert.equal(runtimeSupport[key], constants[key], `runtime_support re-exports ${key}`);
}
for (const key of Object.keys(helpers)) {
  assert.equal(runtimeSupport[key], helpers[key], `runtime_support re-exports ${key}`);
}
assert.equal(typeof runtimeSupport.syncBinancePrivateScopeResponse, "function");
assert.equal(typeof runtimeSupport.binancePrivateScopeResponse, "function");

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Auth checks (401 & 403)
assert.equal((await runtimeSupport.binancePrivateScopeResponse(new Request("https://example.test/api/binance-private-scope"), {})).status, 401);
assert.equal(
  (await http.binancePrivateScopeResponseImpl(new Request("https://example.test/api/binance-private-scope"), {}, {
    readSession: async () => ({ allowed: true, admin: false }),
    hasConfigStore: () => false,
    readConfigJson: async () => null,
    json,
  })).status,
  403,
);

// Validation failure (400) & storage unavailable (503)
assert.equal(
  (await http.syncBinancePrivateScopeResponseImpl(new Request("https://example.test/sync", { method: "POST" }), {}, {
    requireDedicatedReconciliationRecoverySyncToken: () => {},
    configStore: () => null,
    json,
    readBoundedJson: async () => ({}),
  })).status,
  503,
);
assert.equal(
  (await http.syncBinancePrivateScopeResponseImpl(new Request("https://example.test/sync", { method: "POST" }), {}, {
    requireDedicatedReconciliationRecoverySyncToken: () => {},
    configStore: () => ({ put: async () => {} }),
    json,
    readBoundedJson: async () => ({ platform: "ibkr" }),
  })).status,
  400,
);

// Valid sync + stale/corrupt fallback
const validReport = {
  platform: "binance",
  observed_at: new Date().toISOString(),
  source_run_id: "12345",
  source_sha: "a".repeat(40),
  account_scope_sha256: "b".repeat(64),
  assets: [{ asset: "USDT", free: "100.5", locked: "0" }],
  historical_difference_unresolved: true,
  no_order: true,
  execution_authority_granted: false,
};
let stored = null;
const syncRes = await http.syncBinancePrivateScopeResponseImpl(new Request("https://example.test/sync", { method: "POST" }), {}, {
  requireDedicatedReconciliationRecoverySyncToken: () => {},
  configStore: () => ({ put: async (_k, v) => { stored = JSON.parse(v); } }),
  json,
  readBoundedJson: async () => validReport,
});
assert.equal(syncRes.status, 200);
assert.equal(stored.assets.length, 1);

const staleRes = await http.binancePrivateScopeResponseImpl(new Request("https://example.test/api/binance-private-scope"), {}, {
  readSession: async () => ({ allowed: true, admin: true }),
  hasConfigStore: () => true,
  readConfigJson: async () => ({ ...validReport, observed_at: "2020-01-01T00:00:00Z" }),
  json,
});
assert.deepEqual(await staleRes.json(), { ok: true, report: null });
