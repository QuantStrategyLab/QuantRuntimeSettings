import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as constants from "../web/strategy-switch-console/application/strategy_health_snapshot/constants.js";
import * as helpers from "../web/strategy-switch-console/application/strategy_health_snapshot/helpers.js";
import * as http from "../web/strategy-switch-console/application/strategy_health_snapshot/http.js";
import * as runtimeSupport from "../web/strategy-switch-console/application/worker/runtime_support.js";
import { loadWorkerSurface, stripComments, surfaceImportsModule } from "./helpers/worker_surface.mjs";

const surface = await loadWorkerSurface();
for (const layer of ["constants.js", "helpers.js", "http.js"]) {
  assert.equal(
    surfaceImportsModule(surface, `strategy_health_snapshot/${layer}`),
    true,
    `Worker stack imports strategy_health_snapshot/${layer}`,
  );
  const src = stripComments(
    await readFile(new URL(`../web/strategy-switch-console/application/strategy_health_snapshot/${layer}`, import.meta.url), "utf8"),
  );
  assert.doesNotMatch(src, /from\s+["'][^"']*(?:runtime_support|worker|application\/worker\/)[^"']*["']/, `${layer} must not import worker modules`);
}

for (const key of [
  "STRATEGY_HEALTH_SNAPSHOT_KEY",
  "STRATEGY_HEALTH_MAX_BODY_BYTES",
  "STRATEGY_HEALTH_DEFAULT_STALE_TTL_SECONDS",
  "STRATEGY_HEALTH_STATUSES",
  "STRATEGY_HEALTH_DOMAINS",
  "STRATEGY_HEALTH_DATA_STATUSES",
]) {
  assert.equal(runtimeSupport[key], constants[key], `runtime_support re-exports ${key}`);
}
for (const key of [
  "normalizeStrategyHealthSnapshot",
  "normalizeStrategyHealthStrategies",
  "normalizeStrategyHealthSummary",
  "normalizeStrategyHealthComponents",
  "normalizeStrategyHealthDecision",
  "normalizeStrategyHealthReview",
  "normalizeStrategyHealthSummaryObject",
  "normalizeStrategyHealthFreshness",
  "normalizeStrategyHealthAge",
  "normalizeStrategyHealthScore",
  "normalizeStrategyHealthTimestamp",
  "normalizeStrategyHealthText",
  "sanitizeStrategyHealthText",
  "normalizeStrategyHealthErrors",
  "normalizeStrategyHealthPolicy",
  "emptyStrategyHealthPayload",
  "strategyHealthStaleTtlSeconds",
]) {
  assert.equal(runtimeSupport[key], helpers[key], `runtime_support re-exports ${key}`);
}
assert.equal(typeof runtimeSupport.syncStrategyHealthResponse, "function");
assert.equal(typeof runtimeSupport.strategyHealthResponse, "function");

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const nowIso = new Date().toISOString();
const validPayload = {
  schema_version: "strategy_health_dashboard.v1",
  generated_at: nowIso,
  computed_at: nowIso,
  data_status: "ready",
  strategies: [],
  policy: {},
  errors: [],
};

// Auth rejection via injected deps
{
  const res = await http.strategyHealthResponseImpl(new Request("https://example.test/api/strategy-health"), {}, {
    readSession: async () => null,
    json,
    hasConfigStore: () => true,
    readConfigJson: async () => null,
  });
  assert.equal(res.status, 401);
}

// Validation failure via injected deps
{
  const res = await http.syncStrategyHealthResponseImpl(new Request("https://example.test/api/internal/sync-strategy-health", { method: "POST" }), {}, {
    requireDedicatedStrategyHealthSyncToken: () => {},
    hasConfigStore: () => true,
    json,
    readBoundedJson: async () => ({ schema_version: "bad" }),
    readConfigJson: async () => null,
    writeConfigJson: async () => {},
    appendAuditLog: async () => {},
  });
  assert.equal(res.status, 400);
}

// Idempotent replay skips duplicate audit write
{
  let stored = null;
  let audits = 0;
  const deps = {
    requireDedicatedStrategyHealthSyncToken: () => {},
    hasConfigStore: () => true,
    json,
    readBoundedJson: async () => validPayload,
    readConfigJson: async () => stored,
    writeConfigJson: async (_env, _key, value) => { stored = value; },
    appendAuditLog: async () => { audits += 1; },
  };
  const first = await http.syncStrategyHealthResponseImpl(new Request("https://example.test/sync", { method: "POST" }), {}, deps);
  assert.equal(first.status, 200);
  const second = await http.syncStrategyHealthResponseImpl(new Request("https://example.test/sync", { method: "POST" }), {}, deps);
  assert.equal(second.status, 200);
  assert.equal(audits, 1);
}

// Corrupt / stale fallback via wrapper & deps
{
  const kv = new Map([[constants.STRATEGY_HEALTH_SNAPSHOT_KEY, "{bad"]]);
  const res = await runtimeSupport.strategyHealthResponse(
    new Request("https://example.test/api/strategy-health"),
    { STRATEGY_SWITCH_CONFIG: { get: async (k) => kv.get(k) ?? null } },
  );
  assert.equal(res.status, 401);

  const corruptRead = await http.strategyHealthResponseImpl(new Request("https://example.test/api/strategy-health"), {}, {
    readSession: async () => ({ allowed: true }),
    json,
    hasConfigStore: () => true,
    readConfigJson: async () => ({ schema_version: "bad" }),
  });
  assert.equal((await corruptRead.json()).errors[0], "snapshot_invalid");

  const staleRead = await http.strategyHealthResponseImpl(new Request("https://example.test/api/strategy-health"), {}, {
    readSession: async () => ({ allowed: true }),
    json,
    hasConfigStore: () => true,
    readConfigJson: async () => ({
      ...validPayload,
      generated_at: "2020-01-01T00:00:00Z",
      computed_at: "2020-01-01T00:00:00Z",
    }),
  });
  assert.equal((await staleRead.json()).data_status, "stale");
}
