import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CONTROL_PLANE_SNAPSHOT_KEY,
  CONTROL_PLANE_SOURCE_PREFIX,
  CONTROL_PLANE_SOURCE_SCHEMA_VERSION,
  CONTROL_PLANE_SOURCE_RETIREMENTS_KEY,
  CONTROL_PLANE_MAX_SOURCES,
  CONTROL_PLANE_MAX_BODY_BYTES,
  CONTROL_PLANE_DEFAULT_STALE_TTL_SECONDS,
  CONTROL_PLANE_CANDIDATE_KINDS,
  CONTROL_PLANE_STAGES,
  CONTROL_PLANE_AUTOMATION_STATES,
  CONTROL_PLANE_DOMAINS,
  CONTROL_PLANE_DATA_STATUSES,
  FORWARD_OBSERVATION_RESEARCH_STAGES,
} from "../web/strategy-switch-console/application/control_plane/constants.js";
import {
  controlPlaneDecisionExpiryAt,
  controlPlaneSourceKey,
  controlPlaneStaleTtlSeconds,
  emptyControlPlanePayload,
  isOwnerDecisionCandidate,
  normalizeControlPlaneIdentifier,
  normalizeControlPlaneSnapshot,
  normalizeControlPlaneSourceSnapshot,
  requireDedicatedControlPlaneSyncToken,
  requireControlPlaneSourceSyncToken,
} from "../web/strategy-switch-console/application/control_plane/helpers.js";
import {
  syncControlPlaneResponse,
  syncControlPlaneSourceResponse,
  controlPlaneResponse,
  currentControlPlanePayload,
  aggregateControlPlaneSources,
  readControlPlaneSources,
} from "../web/strategy-switch-console/application/control_plane/http.js";
import { HttpError } from "../web/strategy-switch-console/application/http_error.js";
import {
  loadWorkerSurface,
  stripComments,
  surfaceDefinesFunction,
  surfaceImportsModule,
} from "./helpers/worker_surface.mjs";

const controlPlaneModules = [
  "application/control_plane/constants.js",
  "application/control_plane/helpers.js",
  "application/control_plane/http.js",
];

const surface = await loadWorkerSurface({
  applicationModules: controlPlaneModules,
});
const { supportSource } = surface;

const constantsSource = await readFile(
  new URL("../web/strategy-switch-console/application/control_plane/constants.js", import.meta.url),
  "utf8",
);
const helpersSource = await readFile(
  new URL("../web/strategy-switch-console/application/control_plane/helpers.js", import.meta.url),
  "utf8",
);
const httpSource = await readFile(
  new URL("../web/strategy-switch-console/application/control_plane/http.js", import.meta.url),
  "utf8",
);

assert.equal(surfaceImportsModule(surface, "control_plane/constants.js"), true);
assert.equal(surfaceImportsModule(surface, "control_plane/helpers.js"), true);
assert.equal(surfaceImportsModule(surface, "control_plane/http.js"), true);

for (const name of [
  "syncControlPlaneResponse",
  "syncControlPlaneSourceResponse",
  "controlPlaneResponse",
  "currentControlPlanePayload",
  "aggregateControlPlaneSources",
  "readControlPlaneSources",
  "normalizeControlPlaneSnapshot",
  "normalizeControlPlaneSourceSnapshot",
  "requireDedicatedControlPlaneSyncToken",
  "requireControlPlaneSourceSyncToken",
  "isOwnerDecisionCandidate",
  "controlPlaneDecisionExpiryAt",
  "controlPlaneSourceKey",
  "emptyControlPlanePayload",
  "controlPlaneStaleTtlSeconds",
]) {
  assert.equal(surfaceDefinesFunction(surface, name), true, name);
}

assert.match(supportSource, /syncControlPlaneResponseImpl/);
assert.match(supportSource, /syncControlPlaneSourceResponseImpl/);
assert.match(supportSource, /controlPlaneResponseImpl/);
assert.match(supportSource, /currentControlPlanePayloadImpl/);
assert.match(supportSource, /aggregateControlPlaneSourcesImpl/);
assert.match(supportSource, /readControlPlaneSourcesImpl/);
assert.match(supportSource, /controlPlaneRuntimeDeps/);

assert.equal(CONTROL_PLANE_SNAPSHOT_KEY, "control_plane_snapshot");
assert.equal(CONTROL_PLANE_SOURCE_PREFIX, "control_plane_source:");
assert.equal(CONTROL_PLANE_SOURCE_SCHEMA_VERSION, "qsl_control_plane_source_snapshot.v1");
assert.equal(CONTROL_PLANE_SOURCE_RETIREMENTS_KEY, "control_plane_source_retirements");
assert.equal(CONTROL_PLANE_MAX_SOURCES, 100);
assert.equal(CONTROL_PLANE_MAX_BODY_BYTES, 256 * 1024);
assert.equal(CONTROL_PLANE_DEFAULT_STALE_TTL_SECONDS, 36 * 60 * 60);
assert.deepEqual(CONTROL_PLANE_CANDIDATE_KINDS, ["individual", "portfolio", "plugin"]);
assert.deepEqual(CONTROL_PLANE_STAGES, ["P1", "P2", "P3", "P4", "P5", "P6"]);
assert.deepEqual(CONTROL_PLANE_AUTOMATION_STATES, ["not_configured", "configured", "active"]);
assert.deepEqual(CONTROL_PLANE_DATA_STATUSES, ["ready", "unavailable", "stale"]);
assert.equal(FORWARD_OBSERVATION_RESEARCH_STAGES.has("P3"), true);
assert.ok(CONTROL_PLANE_DOMAINS.includes("us_equity"));

assert.equal(controlPlaneSourceKey("aiaudit.demo"), "control_plane_source:aiaudit.demo");
assert.equal(normalizeControlPlaneIdentifier("candidate_1", "id", false), "candidate_1");
assert.equal(isOwnerDecisionCandidate({
  lifecycle: { stage: "P6", status: "owner_decision_required" },
  recommendation: { code: "owner_live_decision" },
}), true);
assert.equal(isOwnerDecisionCandidate({
  lifecycle: { stage: "P3", status: "verified" },
  recommendation: { code: "keep_research" },
}), false);

const empty = emptyControlPlanePayload("snapshot_unavailable");
assert.equal(empty.schema_version, "qsl_control_plane_dashboard.v1");
assert.equal(empty.data_status, "unavailable");
assert.equal(empty.policy.p6_owner_decision_required, true);

assert.equal(controlPlaneStaleTtlSeconds({}), CONTROL_PLANE_DEFAULT_STALE_TTL_SECONDS);
assert.equal(controlPlaneStaleTtlSeconds({ CONTROL_PLANE_STALE_TTL_SECONDS: "7200" }), 7200);

const now = Date.parse("2026-11-14T12:00:00.000Z");
assert.equal(
  controlPlaneDecisionExpiryAt(
    { generated_at: "2026-11-14T10:00:00.000Z", computed_at: "2026-11-14T10:00:00.000Z" },
    3600,
    now,
  ),
  Date.parse("2026-11-14T11:00:00.000Z"),
);

const source = normalizeControlPlaneSourceSnapshot({
  schema_version: CONTROL_PLANE_SOURCE_SCHEMA_VERSION,
  source_id: "aiaudit.demo",
  generated_at: "2026-11-14T10:00:00.000Z",
  computed_at: "2026-11-14T10:00:00.000Z",
  data_status: "ready",
  candidates: [{
    candidate_id: "demo_candidate",
    candidate_kind: "individual",
    domain: "us_equity",
    lifecycle: { stage: "P3", status: "parked" },
    evidence: {
      p1_input_digest: "a".repeat(64),
      p2_config_digest: "b".repeat(64),
      p3_evidence_id: "run-1",
      source_revision: "c".repeat(40),
    },
    recommendation: { code: "park", reason: "Research only" },
    freshness: { status: "fresh", age_seconds: 0 },
  }],
  errors: [],
}, "extract source");
assert.equal(source.source_id, "aiaudit.demo");
assert.equal(source.candidates.length, 1);

const snapshot = normalizeControlPlaneSnapshot({
  schema_version: "qsl_control_plane_dashboard.v1",
  generated_at: "2026-11-14T10:00:00.000Z",
  computed_at: "2026-11-14T10:00:00.000Z",
  data_status: "ready",
  summary: { candidate_count: 1, deferred: 0, parked: 1, owner_decision_required: 0 },
  candidates: source.candidates,
  policy: {
    p4_p5_automation: "not_configured",
    p6_owner_decision_required: true,
    notice: "live 仍需所有者明确决定。",
  },
  errors: [],
}, "extract snapshot");
assert.equal(snapshot.summary.parked, 1);
assert.equal(snapshot.attention.status, "attention_required");

{
  const request = new Request("https://console.example/api/internal/control-plane/sync", {
    method: "POST",
    headers: { Authorization: "Bearer bad" },
  });
  assert.throws(
    () => requireDedicatedControlPlaneSyncToken(request, { CONTROL_PLANE_SYNC_TOKEN: "expected" }),
    (error) => error instanceof HttpError && error.status === 401,
  );
}

{
  const request = new Request("https://console.example/api/internal/control-plane-source/sync", {
    method: "POST",
    headers: { Authorization: "Bearer validation" },
  });
  assert.equal(
    requireControlPlaneSourceSyncToken(request, {
      AAB_VALIDATION_SYNC_TOKEN: "validation",
      CONTROL_PLANE_SYNC_TOKEN: "control",
    }),
    true,
  );
}

assert.equal(typeof syncControlPlaneResponse, "function");
assert.equal(typeof syncControlPlaneSourceResponse, "function");
assert.equal(typeof controlPlaneResponse, "function");
assert.equal(typeof currentControlPlanePayload, "function");
assert.equal(typeof aggregateControlPlaneSources, "function");
assert.equal(typeof readControlPlaneSources, "function");

for (const sourceText of [constantsSource, helpersSource, httpSource]) {
  const noComments = stripComments(sourceText);
  assert.equal(
    /from\s+["'][^"']*runtime_support\.js["']/.test(noComments),
    false,
    "control_plane modules must not import runtime_support",
  );
  assert.equal(
    sourceText.includes('from "./worker.js"')
      || sourceText.includes("from '../worker.js'")
      || sourceText.includes('from "../../worker.js"'),
    false,
    "control_plane modules must not import worker.js",
  );
}

assert.match(httpSource, /publishHumanOwnerMaterials/, "sync path injects publishHumanOwnerMaterials via DI");
assert.match(httpSource, /readBoundedJson/, "sync path injects readBoundedJson via DI");
assert.match(httpSource, /appendAuditLog/, "sync path injects appendAuditLog via DI");

assert.equal(
  /STRATEGY_HEALTH_SNAPSHOT_KEY|syncStrategyHealthResponse|normalizeStrategyHealthSnapshot/.test(
    helpersSource + httpSource + constantsSource,
  ),
  false,
  "control_plane extract must leave strategy_health in runtime_support",
);

console.log("control_plane_extract_validation: ok");
