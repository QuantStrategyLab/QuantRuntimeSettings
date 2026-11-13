import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RECONCILIATION_RECOVERY_SOURCE_PREFIX,
  RECONCILIATION_RECOVERY_CONFIRMATION_PREFIX,
  RECONCILIATION_RECOVERY_CURRENT_PREFIX,
  RECONCILIATION_RECOVERY_SOURCE_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_DASHBOARD_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_CONFIRMATION_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_CONTROLLER_READ_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_MAX_SOURCES,
  RECONCILIATION_RECOVERY_MAX_BODY_BYTES,
  RECONCILIATION_RECOVERY_DEFAULT_STALE_TTL_SECONDS,
  RECONCILIATION_RECOVERY_MAX_SAMPLE_WINDOW_MS,
  RECONCILIATION_RECOVERY_ENVIRONMENTS,
  RECONCILIATION_RECOVERY_STATES,
  RECONCILIATION_RECOVERY_READINESS,
  RECONCILIATION_RECOVERY_DUAL_REVIEW_OUTCOMES,
  RECONCILIATION_RECOVERY_MAX_REQUESTS,
} from "../web/strategy-switch-console/application/reconciliation_recovery/constants.js";
import {
  requireDedicatedReconciliationRecoverySyncToken,
  requireDedicatedReconciliationRecoveryControllerToken,
  reconciliationRecoverySourceKey,
  reconciliationRecoveryConfirmationArchiveKey,
  reconciliationRecoveryConfirmationCurrentKey,
  reconciliationRecoveryStaleTtlSeconds,
  reconciliationRecoveryEvidenceFreshness,
  reconciliationRecoveryDecisionExpiryAt,
  emptyReconciliationRecoveryPayload,
  emptyReconciliationRecoverySourceSnapshot,
  normalizeReconciliationRecoverySourceSnapshot,
  normalizeReconciliationRecoveryRequest,
} from "../web/strategy-switch-console/application/reconciliation_recovery/helpers.js";
import {
  syncReconciliationRecoverySourceResponse,
  reconciliationRecoveryResponse,
  reconciliationRecoveryControllerReadResponse,
  readReconciliationRecoveryConfirmation,
  recordReconciliationRecoveryConfirmationResponse,
  aggregateReconciliationRecoverySources,
  readReconciliationRecoverySources,
} from "../web/strategy-switch-console/application/reconciliation_recovery/http.js";
import { HttpError } from "../web/strategy-switch-console/application/http_error.js";
import {
  loadWorkerSurface,
  stripComments,
  surfaceDefinesFunction,
  surfaceImportsModule,
} from "./helpers/worker_surface.mjs";

const recoveryModules = [
  "application/reconciliation_recovery/constants.js",
  "application/reconciliation_recovery/helpers.js",
  "application/reconciliation_recovery/http.js",
];

const surface = await loadWorkerSurface({
  applicationModules: recoveryModules,
});
const { supportSource } = surface;

const constantsSource = await readFile(
  new URL("../web/strategy-switch-console/application/reconciliation_recovery/constants.js", import.meta.url),
  "utf8",
);
const helpersSource = await readFile(
  new URL("../web/strategy-switch-console/application/reconciliation_recovery/helpers.js", import.meta.url),
  "utf8",
);
const httpSource = await readFile(
  new URL("../web/strategy-switch-console/application/reconciliation_recovery/http.js", import.meta.url),
  "utf8",
);

assert.equal(surfaceImportsModule(surface, "reconciliation_recovery/constants.js"), true);
assert.equal(surfaceImportsModule(surface, "reconciliation_recovery/helpers.js"), true);
assert.equal(surfaceImportsModule(surface, "reconciliation_recovery/http.js"), true);

for (const name of [
  "requireDedicatedReconciliationRecoverySyncToken",
  "requireDedicatedReconciliationRecoveryControllerToken",
  "reconciliationRecoverySourceKey",
  "reconciliationRecoveryConfirmationArchiveKey",
  "reconciliationRecoveryConfirmationCurrentKey",
  "reconciliationRecoveryStaleTtlSeconds",
  "reconciliationRecoveryEvidenceFreshness",
  "reconciliationRecoveryDecisionExpiryAt",
  "normalizeReconciliationRecoverySourceSnapshot",
  "normalizeReconciliationRecoveryRequest",
  "emptyReconciliationRecoveryPayload",
  "emptyReconciliationRecoverySourceSnapshot",
  "syncReconciliationRecoverySourceResponse",
  "reconciliationRecoveryResponse",
  "reconciliationRecoveryControllerReadResponse",
  "readReconciliationRecoveryConfirmation",
  "recordReconciliationRecoveryConfirmationResponse",
  "aggregateReconciliationRecoverySources",
  "readReconciliationRecoverySources",
]) {
  assert.equal(surfaceDefinesFunction(surface, name), true, name);
}

assert.match(supportSource, /syncReconciliationRecoverySourceResponseImpl/);
assert.match(supportSource, /reconciliationRecoveryResponseImpl/);
assert.match(supportSource, /reconciliationRecoveryControllerReadResponseImpl/);
assert.match(supportSource, /readReconciliationRecoveryConfirmationImpl/);
assert.match(supportSource, /recordReconciliationRecoveryConfirmationResponseImpl/);
assert.match(supportSource, /aggregateReconciliationRecoverySourcesImpl/);
assert.match(supportSource, /readReconciliationRecoverySourcesImpl/);
assert.match(supportSource, /reconciliationRecoveryRuntimeDeps/);

assert.equal(RECONCILIATION_RECOVERY_SOURCE_PREFIX, "reconciliation_recovery_source:");
assert.equal(RECONCILIATION_RECOVERY_CONFIRMATION_PREFIX, "reconciliation_recovery_confirmation:");
assert.equal(RECONCILIATION_RECOVERY_CURRENT_PREFIX, "reconciliation_recovery_current:");
assert.equal(RECONCILIATION_RECOVERY_SOURCE_SCHEMA_VERSION, "qsl_reconciliation_recovery_source_snapshot.v1");
assert.equal(RECONCILIATION_RECOVERY_DASHBOARD_SCHEMA_VERSION, "qsl_reconciliation_recovery_dashboard.v1");
assert.equal(RECONCILIATION_RECOVERY_CONFIRMATION_SCHEMA_VERSION, "qsl_reconciliation_recovery_confirmation.v1");
assert.equal(RECONCILIATION_RECOVERY_CONTROLLER_READ_SCHEMA_VERSION, "qsl_reconciliation_recovery_controller_read.v1");
assert.equal(RECONCILIATION_RECOVERY_MAX_SOURCES, 100);
assert.equal(RECONCILIATION_RECOVERY_MAX_BODY_BYTES, 128 * 1024);
assert.equal(RECONCILIATION_RECOVERY_DEFAULT_STALE_TTL_SECONDS, 30 * 60);
assert.equal(RECONCILIATION_RECOVERY_MAX_SAMPLE_WINDOW_MS, 15 * 60 * 1000);
assert.deepEqual(RECONCILIATION_RECOVERY_ENVIRONMENTS, ["live"]);
assert.deepEqual(RECONCILIATION_RECOVERY_STATES, ["RECONCILE_ONLY"]);
assert.deepEqual(RECONCILIATION_RECOVERY_READINESS, ["blocked", "awaiting_human_confirmation"]);
assert.deepEqual(RECONCILIATION_RECOVERY_DUAL_REVIEW_OUTCOMES, ["approved", "rejected", "unavailable"]);
assert.equal(RECONCILIATION_RECOVERY_MAX_REQUESTS, 100);

assert.equal(reconciliationRecoverySourceKey("aiaudit.demo"), "reconciliation_recovery_source:aiaudit.demo");
assert.equal(
  reconciliationRecoveryConfirmationArchiveKey("rec-1", "a".repeat(64)),
  `reconciliation_recovery_confirmation:rec-1:${"a".repeat(64)}`,
);
assert.equal(reconciliationRecoveryConfirmationCurrentKey("rec-1"), "reconciliation_recovery_current:rec-1");
assert.equal(reconciliationRecoveryStaleTtlSeconds({}), RECONCILIATION_RECOVERY_DEFAULT_STALE_TTL_SECONDS);
assert.equal(reconciliationRecoveryStaleTtlSeconds({ RECONCILIATION_RECOVERY_STALE_TTL_SECONDS: "900" }), 900);

const empty = emptyReconciliationRecoveryPayload("snapshot_unavailable");
assert.equal(empty.schema_version, RECONCILIATION_RECOVERY_DASHBOARD_SCHEMA_VERSION);
assert.equal(empty.data_status, "unavailable");
assert.equal(empty.policy.no_order, true);
assert.equal(emptyReconciliationRecoverySourceSnapshot("x").source_id, "unavailable");

const now = Date.parse("2026-11-14T12:00:00.000Z");
const recovery = normalizeReconciliationRecoveryRequest({
  recovery_id: "demo_recovery",
  platform: "binance",
  strategy_profile: "soxl_soxx_trend_income",
  environment: "live",
  reconciliation_state: "RECONCILE_ONLY",
  readiness: "awaiting_human_confirmation",
  candidate_sha256: "a".repeat(64),
  evidence_sample_count: 2,
  first_observed_at: "2026-11-14T11:50:00Z",
  last_observed_at: "2026-11-14T11:55:00Z",
  dual_review: {
    outcome: "approved",
    reviewer_count: 2,
    evidence_binding_sha256: "a".repeat(64),
  },
  blocker_codes: [],
}, "extract recovery");
assert.equal(recovery.recovery_id, "demo_recovery");
assert.equal(recovery.readiness, "awaiting_human_confirmation");

const source = normalizeReconciliationRecoverySourceSnapshot({
  schema_version: RECONCILIATION_RECOVERY_SOURCE_SCHEMA_VERSION,
  source_id: "aiaudit.demo",
  generated_at: "2026-11-14T11:55:00.000Z",
  computed_at: "2026-11-14T11:55:00.000Z",
  data_status: "ready",
  recoveries: [recovery],
  errors: [],
}, "extract source");
assert.equal(source.source_id, "aiaudit.demo");
assert.equal(source.recoveries.length, 1);

const freshness = reconciliationRecoveryEvidenceFreshness(
  recovery,
  { data_status: "ready", age_seconds: 10 },
  1800,
  now,
);
assert.equal(freshness.data_status, "ready");

assert.equal(
  reconciliationRecoveryDecisionExpiryAt(
    recovery,
    { generated_at: "2026-11-14T11:55:00.000Z", computed_at: "2026-11-14T11:55:00.000Z" },
    1800,
    now,
  ),
  Date.parse("2026-11-14T11:55:00.000Z") + 1800 * 1000,
);

{
  const request = new Request("https://console.example/api/internal/sync-reconciliation-recovery-source", {
    method: "POST",
    headers: { Authorization: "Bearer bad" },
  });
  assert.throws(
    () => requireDedicatedReconciliationRecoverySyncToken(request, { RECONCILIATION_RECOVERY_SYNC_TOKEN: "expected" }),
    (error) => error instanceof HttpError && error.status === 401,
  );
}

{
  const request = new Request("https://console.example/api/internal/reconciliation-recovery-confirmation", {
    method: "GET",
    headers: { Authorization: "Bearer same" },
  });
  assert.throws(
    () => requireDedicatedReconciliationRecoveryControllerToken(request, {
      RECONCILIATION_RECOVERY_CONTROLLER_TOKEN: "same",
      RECONCILIATION_RECOVERY_SYNC_TOKEN: "same",
    }),
    (error) => error instanceof HttpError && error.status === 500,
  );
}

assert.equal(typeof syncReconciliationRecoverySourceResponse, "function");
assert.equal(typeof reconciliationRecoveryResponse, "function");
assert.equal(typeof reconciliationRecoveryControllerReadResponse, "function");
assert.equal(typeof readReconciliationRecoveryConfirmation, "function");
assert.equal(typeof recordReconciliationRecoveryConfirmationResponse, "function");
assert.equal(typeof aggregateReconciliationRecoverySources, "function");
assert.equal(typeof readReconciliationRecoverySources, "function");

for (const sourceText of [constantsSource, helpersSource, httpSource]) {
  const noComments = stripComments(sourceText);
  assert.equal(
    /from\s+["'][^"']*runtime_support\.js["']/.test(noComments),
    false,
    "reconciliation_recovery modules must not import runtime_support",
  );
  assert.equal(
    sourceText.includes('from "./worker.js"')
      || sourceText.includes("from '../worker.js'")
      || sourceText.includes('from "../../worker.js"'),
    false,
    "reconciliation_recovery modules must not import worker.js",
  );
}

assert.match(httpSource, /publishHumanRecoveryMaterials/, "sync path injects publishHumanRecoveryMaterials via DI");
assert.match(httpSource, /controlPlaneSnapshotFreshness/, "aggregate injects control-plane freshness via DI");
assert.match(httpSource, /earliestControlPlaneTimestamp/, "aggregate injects earliestControlPlaneTimestamp via DI");
assert.match(httpSource, /exactHumanDecisionResponse/, "dashboard path injects exactHumanDecisionResponse via DI");
assert.match(httpSource, /readHumanDecisionAuthority/, "confirmation read injects human authority via DI");
assert.match(httpSource, /readBoundedJson/, "sync path injects readBoundedJson via DI");
assert.match(httpSource, /appendAuditLog/, "sync path injects appendAuditLog via DI");

assert.equal(
  /STRATEGY_HEALTH_SNAPSHOT_KEY|syncStrategyHealthResponse|normalizeStrategyHealthSnapshot/.test(
    helpersSource + httpSource + constantsSource,
  ),
  false,
  "reconciliation_recovery extract must leave strategy_health in runtime_support",
);

console.log("reconciliation_recovery_extract_validation: ok");
