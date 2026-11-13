import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RESEARCH_TASK_SOURCE_PREFIX,
  RESEARCH_TASK_SOURCE_SCHEMA_VERSION,
  RESEARCH_TASK_SCHEMA_VERSION,
  RESEARCH_TASK_DASHBOARD_SCHEMA_VERSION,
  RESEARCH_TASK_MAX_SOURCES,
  RESEARCH_TASK_MAX_BODY_BYTES,
  RESEARCH_TASK_DEFAULT_STALE_TTL_SECONDS,
  RESEARCH_TASK_OBJECTIVES,
  RESEARCH_TASK_TYPES,
} from "../web/strategy-switch-console/application/research_task/constants.js";
import {
  requireDedicatedResearchTaskSyncToken,
  researchTaskSourceKey,
  assertExactFields,
  canonicalResearchTaskJson,
  calculateResearchTaskSha256,
  emptyResearchTaskPayload,
  emptyResearchTaskSourceSnapshot,
  normalizeResearchTask,
  normalizeResearchTaskSourceSnapshot,
  researchTaskStaleTtlSeconds,
  sha256Hex,
} from "../web/strategy-switch-console/application/research_task/helpers.js";
import {
  syncResearchTaskSourceResponse,
  researchTaskResponse,
  aggregateResearchTaskSources,
  readResearchTaskSources,
} from "../web/strategy-switch-console/application/research_task/http.js";
import { HttpError } from "../web/strategy-switch-console/application/http_error.js";
import {
  loadWorkerSurface,
  stripComments,
  surfaceDefinesFunction,
  surfaceImportsModule,
} from "./helpers/worker_surface.mjs";

const researchTaskModules = [
  "application/research_task/constants.js",
  "application/research_task/helpers.js",
  "application/research_task/http.js",
];

const surface = await loadWorkerSurface({
  applicationModules: researchTaskModules,
});
const { supportSource } = surface;

const constantsSource = await readFile(
  new URL("../web/strategy-switch-console/application/research_task/constants.js", import.meta.url),
  "utf8",
);
const helpersSource = await readFile(
  new URL("../web/strategy-switch-console/application/research_task/helpers.js", import.meta.url),
  "utf8",
);
const httpSource = await readFile(
  new URL("../web/strategy-switch-console/application/research_task/http.js", import.meta.url),
  "utf8",
);

assert.equal(surfaceImportsModule(surface, "research_task/constants.js"), true);
assert.equal(surfaceImportsModule(surface, "research_task/helpers.js"), true);
assert.equal(surfaceImportsModule(surface, "research_task/http.js"), true);

for (const name of [
  "requireDedicatedResearchTaskSyncToken",
  "researchTaskSourceKey",
  "assertExactFields",
  "canonicalResearchTaskJson",
  "sha256Hex",
  "calculateResearchTaskSha256",
  "normalizeResearchTask",
  "normalizeResearchTaskSourceSnapshot",
  "emptyResearchTaskPayload",
  "emptyResearchTaskSourceSnapshot",
  "researchTaskStaleTtlSeconds",
  "syncResearchTaskSourceResponse",
  "researchTaskResponse",
  "aggregateResearchTaskSources",
  "readResearchTaskSources",
]) {
  assert.equal(surfaceDefinesFunction(surface, name), true, name);
}

assert.match(supportSource, /syncResearchTaskSourceResponseImpl/);
assert.match(supportSource, /researchTaskResponseImpl/);
assert.match(supportSource, /aggregateResearchTaskSourcesImpl/);
assert.match(supportSource, /readResearchTaskSourcesImpl/);
assert.match(supportSource, /normalizeResearchTaskImpl/);
assert.match(supportSource, /normalizeResearchTaskSourceSnapshotImpl/);

assert.equal(RESEARCH_TASK_SOURCE_PREFIX, "research_task_source:");
assert.equal(RESEARCH_TASK_SOURCE_SCHEMA_VERSION, "qsl_research_task_source_snapshot.v1");
assert.equal(RESEARCH_TASK_SCHEMA_VERSION, "qsl.research_task.v1");
assert.equal(RESEARCH_TASK_DASHBOARD_SCHEMA_VERSION, "qsl_research_task_dashboard.v1");
assert.equal(RESEARCH_TASK_MAX_SOURCES, 100);
assert.equal(RESEARCH_TASK_MAX_BODY_BYTES, 256 * 1024);
assert.equal(RESEARCH_TASK_DEFAULT_STALE_TTL_SECONDS, 36 * 60 * 60);
assert.equal(RESEARCH_TASK_TYPES.includes("strategy_diagnosis"), true);
assert.equal(RESEARCH_TASK_OBJECTIVES.includes("diagnose_degradation"), true);

assert.equal(researchTaskSourceKey("src_a"), "research_task_source:src_a");
assert.equal(researchTaskStaleTtlSeconds({}), RESEARCH_TASK_DEFAULT_STALE_TTL_SECONDS);
assert.equal(researchTaskStaleTtlSeconds({ RESEARCH_TASK_STALE_TTL_SECONDS: "7200" }), 7200);
assert.deepEqual(emptyResearchTaskPayload("snapshot_unavailable").errors, ["snapshot_unavailable"]);
assert.deepEqual(emptyResearchTaskSourceSnapshot("research_task_source_invalid").tasks, []);
assert.equal(assertExactFields({ a: 1 }, ["a"], "obj").a, 1);
assert.equal(canonicalResearchTaskJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

{
  const request = new Request("https://console.example/api/internal/sync-research-task-source", {
    method: "POST",
    headers: { Authorization: "Bearer bad" },
  });
  assert.throws(
    () => requireDedicatedResearchTaskSyncToken(request, { RESEARCH_TASK_SYNC_TOKEN: "expected" }),
    (error) => error instanceof HttpError && error.status === 401,
  );
}

const cleanChoice = (value, allowed, field) => {
  if (!allowed.includes(value)) throw new Error(`${field} is invalid`);
  return value;
};
const normalizeDeps = {
  cleanChoice,
  CONTROL_PLANE_CANDIDATE_KINDS: ["individual", "portfolio", "plugin"],
  STRATEGY_HEALTH_DOMAINS: ["us_equity"],
  STRATEGY_HEALTH_DATA_STATUSES: ["ready", "unavailable", "stale"],
  normalizeControlPlaneIdentifier: (value) => String(value),
  normalizeStrategyHealthTimestamp: (value, _field, nullable) => {
    if ((value === null || value === undefined || value === "") && nullable) return null;
    return String(value);
  },
  normalizeStrategyHealthErrors: (value) => (Array.isArray(value) ? value : []),
};

const taskDraft = {
  schema: RESEARCH_TASK_SCHEMA_VERSION,
  task_id: "task.example",
  created_at: "2026-01-02T03:04:05Z",
  digest_algorithm: "sha256",
  task_type: "strategy_diagnosis",
  target: {
    candidate_id: "cand.example",
    candidate_kind: "individual",
    domain: "us_equity",
    repository: "QuantStrategyLab/Example",
    strategy_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  evidence: {
    p1_input_digest: null,
    p2_config_digest: null,
    p3_evidence_id: null,
    producer_revision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  },
  experiment: {
    objective: "diagnose_degradation",
    hypothesis: "latency rose after release",
    parameter_bounds_sha256: null,
    max_runs: 3,
    max_wall_seconds: 600,
  },
  authority: {
    research_only: true,
    no_order: true,
    size_zero_required: true,
    p4_p5_p6_authorized: false,
  },
  task_sha256: "0".repeat(64),
};
taskDraft.task_sha256 = await calculateResearchTaskSha256(taskDraft);
const normalizedTask = await normalizeResearchTask(taskDraft, "task", normalizeDeps);
assert.equal(normalizedTask.task_id, "task.example");
assert.equal(normalizedTask.authority.no_order, true);

const source = await normalizeResearchTaskSourceSnapshot({
  schema_version: RESEARCH_TASK_SOURCE_SCHEMA_VERSION,
  source_id: "source-a",
  generated_at: "2026-01-02T03:04:05Z",
  computed_at: "2026-01-02T03:04:05Z",
  data_status: "ready",
  tasks: [normalizedTask],
  errors: [],
}, "source", normalizeDeps);
assert.equal(source.source_id, "source-a");
assert.equal(source.tasks.length, 1);

assert.equal(typeof syncResearchTaskSourceResponse, "function");
assert.equal(typeof researchTaskResponse, "function");
assert.equal(typeof aggregateResearchTaskSources, "function");
assert.equal(typeof readResearchTaskSources, "function");

for (const sourceText of [constantsSource, helpersSource, httpSource]) {
  const noComments = stripComments(sourceText);
  assert.equal(
    /from\s+["'][^"']*runtime_support\.js["']/.test(noComments),
    false,
    "research_task modules must not import runtime_support",
  );
  assert.equal(
    sourceText.includes('from "./worker.js"')
      || sourceText.includes("from '../worker.js'")
      || sourceText.includes('from "../../worker.js"'),
    false,
    "research_task modules must not import worker.js",
  );
}

assert.match(httpSource, /normalizeResearchTaskSourceSnapshot/, "HTTP sync injects snapshot normalizer via DI");
assert.match(httpSource, /controlPlaneSnapshotFreshness/, "aggregate injects freshness via DI");

console.log("research_task_extract_validation: ok");
