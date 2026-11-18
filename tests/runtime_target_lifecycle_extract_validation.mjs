import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as constants from "../web/strategy-switch-console/application/runtime_target_lifecycle/constants.js";
import * as helpers from "../web/strategy-switch-console/application/runtime_target_lifecycle/helpers.js";
import * as http from "../web/strategy-switch-console/application/runtime_target_lifecycle/http.js";
import * as runtimeSupport from "../web/strategy-switch-console/application/worker/runtime_support.js";
import { loadWorkerSurface, stripComments, surfaceImportsModule } from "./helpers/worker_surface.mjs";

const surface = await loadWorkerSurface();
for (const layer of ["constants.js", "helpers.js", "http.js"]) {
  assert.equal(
    surfaceImportsModule(surface, `runtime_target_lifecycle/${layer}`),
    true,
    `Worker stack imports runtime_target_lifecycle/${layer}`,
  );
  const src = stripComments(
    await readFile(new URL(`../web/strategy-switch-console/application/runtime_target_lifecycle/${layer}`, import.meta.url), "utf8"),
  );
  assert.doesNotMatch(src, /from\s+["'][^"']*(?:runtime_support|worker|application\/worker\/)[^"']*["']/, `${layer} must not import worker modules`);
}

for (const key of [
  "RUNTIME_TARGET_LIFECYCLE_SOURCE_PREFIX",
  "RUNTIME_TARGET_LIFECYCLE_SOURCE_SCHEMA_VERSION",
  "RUNTIME_TARGET_LIFECYCLE_DASHBOARD_SCHEMA_VERSION",
  "RUNTIME_TARGET_LIFECYCLE_MAX_SOURCES",
  "RUNTIME_TARGET_LIFECYCLE_MAX_BODY_BYTES",
  "RUNTIME_TARGET_LIFECYCLE_CONFIGURED_STATES",
  "RUNTIME_TARGET_LIFECYCLE_EXECUTION_MODES",
  "RUNTIME_TARGET_LIFECYCLE_CHECK_STATUSES",
  "RUNTIME_TARGET_LIFECYCLE_DISPOSITIONS",
  "RUNTIME_TARGET_LIFECYCLE_EXECUTION_OBSERVATIONS",
]) {
  assert.equal(runtimeSupport[key], constants[key], `runtime_support re-exports ${key}`);
}
for (const key of Object.keys(helpers)) {
  assert.equal(runtimeSupport[key], helpers[key], `runtime_support re-exports ${key}`);
}
assert.equal(typeof runtimeSupport.syncRuntimeTargetLifecycleSourceResponse, "function");
assert.equal(typeof runtimeSupport.runtimeReadbackResponse, "function");
assert.equal(typeof runtimeSupport.runtimeTargetLifecycleResponse, "function");
assert.equal(typeof runtimeSupport.aggregateRuntimeTargetLifecycleSources, "function");
assert.equal(typeof runtimeSupport.readRuntimeTargetLifecycleSources, "function");

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const nowIso = new Date().toISOString();
const validSource = {
  schema_version: constants.RUNTIME_TARGET_LIFECYCLE_SOURCE_SCHEMA_VERSION,
  source_id: "src-1",
  generated_at: nowIso,
  computed_at: nowIso,
  data_status: "ready",
  targets: [],
  errors: [],
};

// Auth & wrapper checks
assert.equal((await runtimeSupport.runtimeTargetLifecycleResponse(new Request("https://example.test/api/runtime-target-lifecycle"), {})).status, 401);
assert.equal(
  (await runtimeSupport.runtimeReadbackResponse(
    new Request("https://example.test/api/runtime-readback?scope=ibkr:paper"),
    {},
    new URL("https://example.test/api/runtime-readback?scope=ibkr:paper"),
  )).status,
  401,
);

// Validation & conflict checks on readback
assert.equal(
  (await http.runtimeReadbackResponseImpl(
    new Request("https://example.test/api/runtime-readback?scope=bad!"),
    {},
    new URL("https://example.test/api/runtime-readback?scope=bad!"),
    { readSession: async () => ({ allowed: true }), json },
  )).status,
  400,
);
assert.equal(
  (await http.runtimeReadbackResponseImpl(
    new Request("https://example.test/api/runtime-readback?scope=ibkr:dup"),
    {},
    new URL("https://example.test/api/runtime-readback?scope=ibkr:dup"),
    {
      readSession: async () => ({ allowed: true }),
      json,
      loadAccountOptionsConfig: async () => ({ options: { ibkr: [{ key: "dup" }, { key: "dup" }] } }),
      hasConfigStore: () => true,
    },
  )).status,
  409,
);

// Idempotent replay skips duplicate audit log
{
  let stored = null;
  let audits = 0;
  const deps = {
    requireDedicatedExecutionEvidenceSyncToken: () => {},
    hasConfigStore: () => true,
    json,
    readBoundedJson: async () => validSource,
    readConfigJson: async () => stored,
    writeConfigJson: async (_env, _key, value) => { stored = value; },
    appendAuditLog: async () => { audits += 1; },
    maybeAutoDispatchAccountDiagnosis: async () => {},
  };
  assert.equal((await http.syncRuntimeTargetLifecycleSourceResponseImpl(new Request("https://example.test/sync", { method: "POST" }), {}, deps)).status, 200);
  assert.equal((await http.syncRuntimeTargetLifecycleSourceResponseImpl(new Request("https://example.test/sync", { method: "POST" }), {}, deps)).status, 200);
  assert.equal(audits, 1);
}

// Corrupt source fallback
const corruptAgg = await http.aggregateRuntimeTargetLifecycleSourcesImpl({}, {
  configStore: () => ({}),
  directoryList: async () => ({ keys: [{ name: `${constants.RUNTIME_TARGET_LIFECYCLE_SOURCE_PREFIX}s1` }] }),
  readConfigJson: async () => ({ schema_version: "bad" }),
});
assert.equal(corruptAgg.errors.includes("runtime_target_lifecycle_source_invalid"), true);
