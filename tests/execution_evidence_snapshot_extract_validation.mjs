import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as constants from "../web/strategy-switch-console/application/execution_evidence_snapshot/constants.js";
import * as helpers from "../web/strategy-switch-console/application/execution_evidence_snapshot/helpers.js";
import * as http from "../web/strategy-switch-console/application/execution_evidence_snapshot/http.js";
import * as runtimeSupport from "../web/strategy-switch-console/application/worker/runtime_support.js";
import { loadWorkerSurface, stripComments, surfaceImportsModule } from "./helpers/worker_surface.mjs";

const surface = await loadWorkerSurface();
for (const layer of ["constants.js", "helpers.js", "http.js"]) {
  assert.equal(
    surfaceImportsModule(surface, `execution_evidence_snapshot/${layer}`),
    true,
    `Worker stack imports execution_evidence_snapshot/${layer}`,
  );
  const src = stripComments(
    await readFile(new URL(`../web/strategy-switch-console/application/execution_evidence_snapshot/${layer}`, import.meta.url), "utf8"),
  );
  assert.doesNotMatch(src, /from\s+["'][^"']*(?:runtime_support|worker|application\/worker\/)[^"']*["']/, `${layer} must not import worker modules`);
}

for (const key of [
  "EXECUTION_EVIDENCE_SOURCE_PREFIX",
  "EXECUTION_EVIDENCE_SOURCE_SCHEMA_VERSION",
  "EXECUTION_EVIDENCE_DASHBOARD_SCHEMA_VERSION",
  "EXECUTION_EVIDENCE_MAX_SOURCES",
  "EXECUTION_EVIDENCE_MAX_BODY_BYTES",
  "EXECUTION_EVIDENCE_DEFAULT_STALE_TTL_SECONDS",
  "EXECUTION_EVIDENCE_PLATFORMS",
  "EXECUTION_EVIDENCE_ENVIRONMENTS",
  "EXECUTION_EVIDENCE_CAPABILITIES",
  "EXECUTION_EVIDENCE_STATUSES",
]) {
  assert.equal(runtimeSupport[key], constants[key], `runtime_support re-exports ${key}`);
}
for (const key of [
  "executionEvidenceSourceKey",
  "normalizeExecutionEvidenceSourceSnapshot",
  "normalizeExecutionEvidenceDeployment",
  "normalizeExecutionEvidenceReceipt",
  "normalizeExecutionEvidenceSummary",
  "emptyExecutionEvidenceSourceSnapshot",
  "emptyExecutionEvidencePayload",
  "executionEvidenceStaleTtlSeconds",
]) {
  assert.equal(runtimeSupport[key], helpers[key], `runtime_support re-exports ${key}`);
}
assert.equal(typeof runtimeSupport.syncExecutionEvidenceSourceResponse, "function");
assert.equal(typeof runtimeSupport.executionEvidenceResponse, "function");
assert.equal(typeof runtimeSupport.aggregateExecutionEvidenceSources, "function");
assert.equal(typeof runtimeSupport.readExecutionEvidenceSources, "function");

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const nowIso = new Date().toISOString();
const validSource = {
  schema_version: constants.EXECUTION_EVIDENCE_SOURCE_SCHEMA_VERSION,
  source_id: "src-1",
  generated_at: nowIso,
  computed_at: nowIso,
  data_status: "ready",
  deployments: [],
  errors: [],
};

// Auth & wrapper check
assert.equal((await runtimeSupport.executionEvidenceResponse(new Request("https://example.test/api/execution-evidence"), {})).status, 401);

// Invalid receipt header rejection
assert.equal(
  (await http.syncExecutionEvidenceSourceResponseImpl(
    new Request("https://example.test/sync", { method: "POST", headers: { "X-QSL-Execution-Evidence-Receipt": "bad" } }),
    {},
    {
      requireDedicatedExecutionEvidenceSyncToken: () => {},
      hasConfigStore: () => true,
      json,
    },
  )).status,
  400,
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
    loadAuditLog: async () => [],
    appendAuditLog: async () => { audits += 1; },
  };
  assert.equal((await http.syncExecutionEvidenceSourceResponseImpl(new Request("https://example.test/sync", { method: "POST" }), {}, deps)).status, 200);
  assert.equal((await http.syncExecutionEvidenceSourceResponseImpl(new Request("https://example.test/sync", { method: "POST" }), {}, deps)).status, 200);
  assert.equal(audits, 1);
}

// Corrupt fallback
const corruptAgg = await http.aggregateExecutionEvidenceSourcesImpl({}, {
  configStore: () => ({}),
  directoryList: async () => ({ keys: [{ name: `${constants.EXECUTION_EVIDENCE_SOURCE_PREFIX}s1` }] }),
  readConfigJson: async () => ({ schema_version: "bad" }),
});
assert.equal(corruptAgg.errors.includes("execution_evidence_source_invalid"), true);
