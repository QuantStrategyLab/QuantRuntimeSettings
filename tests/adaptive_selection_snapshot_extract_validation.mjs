import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as constants from "../web/strategy-switch-console/application/adaptive_selection_snapshot/constants.js";
import * as helpers from "../web/strategy-switch-console/application/adaptive_selection_snapshot/helpers.js";
import * as http from "../web/strategy-switch-console/application/adaptive_selection_snapshot/http.js";
import * as runtimeSupport from "../web/strategy-switch-console/application/worker/runtime_support.js";
import { loadWorkerSurface, stripComments, surfaceImportsModule } from "./helpers/worker_surface.mjs";

const surface = await loadWorkerSurface();
for (const layer of ["constants.js", "helpers.js", "http.js"]) {
  assert.equal(
    surfaceImportsModule(surface, `adaptive_selection_snapshot/${layer}`),
    true,
    `Worker stack imports adaptive_selection_snapshot/${layer}`,
  );
  const src = stripComments(
    await readFile(new URL(`../web/strategy-switch-console/application/adaptive_selection_snapshot/${layer}`, import.meta.url), "utf8"),
  );
  assert.doesNotMatch(src, /from\s+["'][^"']*(?:runtime_support|worker|application\/worker\/)[^"']*["']/, `${layer} must not import worker modules`);
}

for (const key of Object.keys(constants)) {
  assert.equal(runtimeSupport[key], constants[key], `runtime_support re-exports ${key}`);
}
for (const key of Object.keys(helpers)) {
  assert.equal(runtimeSupport[key], helpers[key], `runtime_support re-exports ${key}`);
}
assert.equal(typeof runtimeSupport.readAdaptiveSelectionSources, "function");
assert.equal(typeof runtimeSupport.aggregateAdaptiveSelectionSources, "function");
assert.equal(typeof runtimeSupport.syncAdaptiveSelectionSourceResponse, "function");
assert.equal(typeof runtimeSupport.adaptiveSelectionResponse, "function");

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Auth & wrapper check
assert.equal((await runtimeSupport.adaptiveSelectionResponse(new Request("https://example.test/api/adaptive-selection"), {})).status, 401);
assert.equal(
  (await http.adaptiveSelectionResponseImpl(new Request("https://example.test/api/adaptive-selection"), {}, {
    readSession: async () => null,
    hasConfigStore: () => false,
    json,
  })).status,
  401,
);

// Validation rejection
assert.equal(
  (await http.syncAdaptiveSelectionSourceResponseImpl(new Request("https://example.test/sync", { method: "POST" }), {}, {
    requireDedicatedAdaptiveSelectionSyncToken: () => {},
    hasConfigStore: () => true,
    json,
    readBoundedJson: async () => ({ schema_version: "bad" }),
    writeConfigJson: async () => {},
    appendAuditLog: async () => {},
  })).status,
  400,
);

// Unavailable fallback
const unavailable = await http.adaptiveSelectionResponseImpl(new Request("https://example.test/api/adaptive-selection"), {}, {
  readSession: async () => ({ allowed: true }),
  hasConfigStore: () => false,
  json,
});
assert.equal((await unavailable.json()).errors[0], "adaptive_selection_source_unavailable");

// Corrupt source fallback
const corruptAgg = await http.aggregateAdaptiveSelectionSourcesImpl({}, {
  configStore: () => ({}),
  directoryList: async () => ({ keys: [{ name: `${constants.ADAPTIVE_SELECTION_SOURCE_PREFIX}s1` }] }),
  readConfigJson: async () => ({ schema_version: "bad" }),
});
assert.equal(corruptAgg.errors.includes("adaptive_selection_source_invalid"), true);
