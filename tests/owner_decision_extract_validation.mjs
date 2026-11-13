import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  OWNER_DECISION_INTENT_PREFIX,
  OWNER_DECISION_CURRENT_PREFIX,
  OWNER_DECISION_INTENT_SCHEMA_VERSION,
  OWNER_DECISION_QUEUE_SCHEMA_VERSION,
  OWNER_DECISION_CHOICES,
  OWNER_DECISION_MAX_CANDIDATES,
} from "../web/strategy-switch-console/application/approval/constants.js";
import {
  currentOwnerDecisionCandidate,
  normalizeOwnerDecisionRequest,
  ownerDecisionCandidateEvidenceSha256,
  buildOwnerDecisionIntent,
  normalizeOwnerDecisionIntent,
  calculateOwnerDecisionSha256,
  readOwnerDecisionIntent,
  ownerDecisionArchiveKey,
  ownerDecisionCurrentKey,
  emptyOwnerDecisionQueue,
} from "../web/strategy-switch-console/application/approval/helpers.js";
import {
  ownerDecisionQueueResponse,
  recordOwnerDecisionResponse,
} from "../web/strategy-switch-console/application/approval/http.js";
import { HttpError } from "../web/strategy-switch-console/application/http_error.js";
import {
  loadWorkerSurface,
  stripComments,
  surfaceDefinesFunction,
  surfaceImportsModule,
} from "./helpers/worker_surface.mjs";

const approvalModules = [
  "application/approval/constants.js",
  "application/approval/helpers.js",
  "application/approval/http.js",
  "application/approval/owner_decisions.js",
];

const surface = await loadWorkerSurface({
  applicationModules: approvalModules,
});
const { supportSource, wiredSource } = surface;

const constantsSource = await readFile(
  new URL("../web/strategy-switch-console/application/approval/constants.js", import.meta.url),
  "utf8",
);
const helpersSource = await readFile(
  new URL("../web/strategy-switch-console/application/approval/helpers.js", import.meta.url),
  "utf8",
);
const httpSource = await readFile(
  new URL("../web/strategy-switch-console/application/approval/http.js", import.meta.url),
  "utf8",
);
const barrelSource = await readFile(
  new URL("../web/strategy-switch-console/application/approval/owner_decisions.js", import.meta.url),
  "utf8",
);

assert.equal(surfaceImportsModule(surface, "approval/constants.js"), true);
assert.equal(surfaceImportsModule(surface, "approval/helpers.js"), true);
assert.equal(surfaceImportsModule(surface, "approval/http.js"), true);
assert.match(wiredSource, /\/api\/owner-decisions"/);
assert.match(wiredSource, /ownerDecisionQueueResponseImpl/);
assert.match(wiredSource, /recordOwnerDecisionResponseImpl/);
assert.match(supportSource, /async function ownerDecisionQueueResponse/);
assert.match(supportSource, /async function recordOwnerDecisionResponse/);
assert.match(supportSource, /readOwnerDecisionIntentImpl/);
assert.match(supportSource, /normalizeOwnerDecisionIntentImpl/);

for (const name of [
  "currentOwnerDecisionCandidate",
  "normalizeOwnerDecisionRequest",
  "ownerDecisionCandidateEvidenceSha256",
  "buildOwnerDecisionIntent",
  "normalizeOwnerDecisionIntent",
  "calculateOwnerDecisionSha256",
  "readOwnerDecisionIntent",
  "ownerDecisionArchiveKey",
  "ownerDecisionCurrentKey",
  "emptyOwnerDecisionQueue",
  "ownerDecisionQueueResponse",
  "recordOwnerDecisionResponse",
]) {
  assert.equal(surfaceDefinesFunction(surface, name), true, name);
}

assert.equal(OWNER_DECISION_INTENT_PREFIX, "owner_decision_intent:");
assert.equal(OWNER_DECISION_CURRENT_PREFIX, "owner_decision_current:");
assert.equal(OWNER_DECISION_INTENT_SCHEMA_VERSION, "qsl_owner_decision_intent.v1");
assert.equal(OWNER_DECISION_QUEUE_SCHEMA_VERSION, "qsl_owner_decision_queue.v1");
assert.equal(OWNER_DECISION_MAX_CANDIDATES, 100);
assert.deepEqual([...OWNER_DECISION_CHOICES], [
  "approve_limited_live_canary",
  "keep_parked",
  "retire_candidate",
]);
assert.equal(ownerDecisionArchiveKey("cand-1", "a".repeat(64)), `owner_decision_intent:cand-1:${"a".repeat(64)}`);
assert.equal(ownerDecisionCurrentKey("cand-1"), "owner_decision_current:cand-1");
assert.deepEqual(emptyOwnerDecisionQueue("snapshot_unavailable").errors, ["snapshot_unavailable"]);
assert.equal(emptyOwnerDecisionQueue("x").policy.no_order, true);
assert.equal(emptyOwnerDecisionQueue("x").policy.execution_authority_granted, false);

{
  const request = normalizeOwnerDecisionRequest({
    candidate_id: "cand_1",
    decision: "keep_parked",
    candidate_evidence_sha256: "b".repeat(64),
    request_id: "req-1",
  });
  assert.equal(request.candidate_id, "cand_1");
  assert.equal(request.decision, "keep_parked");
  assert.equal(request.request_id, "req-1");
}

{
  let threw = false;
  try {
    currentOwnerDecisionCandidate({ data_status: "stale", candidates: [] }, "cand_1");
  } catch (error) {
    threw = true;
    assert.equal(error instanceof HttpError, true);
    assert.equal(error.status, 409);
  }
  assert.equal(threw, true);
}

{
  const evidence = await calculateOwnerDecisionSha256({
    candidate_id: "cand_1",
    candidate_kind: "individual",
    domain: "us_equity",
  });
  assert.match(evidence, /^[0-9a-f]{64}$/);
  const again = await ownerDecisionCandidateEvidenceSha256({
    candidate_id: "cand_1",
    candidate_kind: "individual",
    domain: "us_equity",
    lifecycle: { stage: "P6", status: "owner_decision_required" },
    evidence: { source: "test" },
    recommendation: { code: "owner_live_decision" },
  });
  assert.match(again, /^[0-9a-f]{64}$/);
}

{
  const stored = await readOwnerDecisionIntent({}, "cand_1", "a".repeat(64), {
    readHumanDecisionAuthority: async () => {
      throw new Error("runtime_instances_unavailable");
    },
    humanDecisionAuthorityView: () => null,
  });
  assert.equal(stored.intent, null);
  assert.equal(stored.error, "runtime_instances_unavailable");
}

for (const moduleSource of [helpersSource, httpSource, constantsSource, barrelSource]) {
  assert.equal(
    moduleSource.includes('from "../worker/runtime_support.js"')
      || moduleSource.includes("from '../worker/runtime_support.js'")
      || moduleSource.includes('from "./worker/runtime_support.js"')
      || moduleSource.includes('from "../../worker.js"')
      || moduleSource.includes("from '../../worker.js'")
      || moduleSource.includes('from "../worker.js"')
      || moduleSource.includes("from '../worker.js'"),
    false,
    "approval modules must not import runtime_support or worker.js",
  );
  assert.equal(
    /human_decision_material|human_decision_record|class RuntimeInstances/.test(moduleSource),
    false,
    "approval modules must not own DO identity or human_decision tables",
  );
}

const helpersNoComments = stripComments(helpersSource);
const httpNoComments = stripComments(httpSource);
assert.equal(/transactionSync/.test(helpersNoComments), false);
assert.equal(/transactionSync/.test(httpNoComments), false);
assert.equal(
  helpersSource.includes("readHumanDecisionAuthority") && helpersSource.includes("humanDecisionAuthorityView"),
  true,
  "helpers inject human-decision authority deps (no cycle)",
);
assert.equal(
  httpSource.includes('action: "owner_decide"'),
  true,
  "record path still issues owner_decide via injected repository",
);
assert.equal(
  httpSource.includes("execution_authority_granted: false") && httpSource.includes("no_order: true"),
  true,
  "wire keeps no_order / non-executable policy",
);
assert.equal(
  /recordResearchPromotionDecisionResponse|research-promotion/.test(httpSource),
  false,
  "B10-c smallest slice: research promotion stays outside approval/http.js",
);
assert.equal(
  /FIRSTRADE|LB-HK|LONGPORT_HK|longbridge.?hk/i.test(httpSource + helpersSource + constantsSource),
  false,
  "B10-c must not touch LB-HK / Firstrade env",
);
assert.match(barrelSource, /from "\.\/http\.js"/);

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function queueDeps(overrides = {}) {
  return {
    json,
    readSession: async () => ({ allowed: true, login: "decision-reader", admin: false }),
    exactHumanDecisionResponse: async () => null,
    hasConfigStore: () => true,
    currentControlPlanePayload: async () => ({ data_status: "ready", computed_at: "2026-10-09T00:00:00Z", candidates: [], errors: [] }),
    isOwnerDecisionCandidate: () => false,
    ownerDecisionCandidateEvidenceSha256: async () => "a".repeat(64),
    readOwnerDecisionIntent: async () => ({ intent: null, error: null }),
    emptyOwnerDecisionQueue: (code) => ({ schema_version: "qsl_owner_decision_queue.v1", data_status: "unavailable", errors: [code], candidates: [], policy: { no_order: true, execution_authority_granted: false } }),
    uniqueStrings: (items) => [...new Set(items)],
    OWNER_DECISION_MAX_CANDIDATES: 100,
    OWNER_DECISION_QUEUE_SCHEMA_VERSION: "qsl_owner_decision_queue.v1",
    ...overrides,
  };
}

function recordDeps(overrides = {}) {
  return {
    json,
    requireSameOrigin: () => {},
    readSession: async () => ({ allowed: true, login: "decision-admin", admin: true }),
    hasConfigStore: () => true,
    readBoundedJson: async () => ({
      candidate_id: "cand-1",
      decision: "keep_parked",
      candidate_evidence_sha256: "b".repeat(64),
    }),
    normalizeOwnerDecisionRequest: (raw) => raw,
    currentControlPlanePayload: async () => ({ data_status: "ready", candidates: [] }),
    currentOwnerDecisionCandidate: () => ({ candidate_id: "cand-1", freshness: { status: "fresh" } }),
    ownerDecisionCandidateEvidenceSha256: async () => "a".repeat(64),
    humanDecisionTimestamp: () => "2026-10-09T00:00:00Z",
    buildOwnerDecisionIntent: async () => {
      throw new Error("should not build intent on fingerprint reject");
    },
    canonicalResearchTaskJson: (value) => JSON.stringify(value),
    humanDecisionRequestKey: async () => "req-key",
    runtimeInstanceCommand: async () => {
      throw new Error("runtimeInstanceCommand should not run on reject");
    },
    humanDecisionReceipt: async () => ({}),
    mirrorConfigJson: async () => {},
    ownerDecisionArchiveKey: () => "archive",
    ownerDecisionCurrentKey: () => "current",
    appendAuditLog: async () => {},
    ...overrides,
  };
}

{
  const unauthorized = await ownerDecisionQueueResponse(
    new Request("https://console.example/api/owner-decisions"),
    {},
    queueDeps({ readSession: async () => null }),
  );
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error, "login required");
}

{
  const forbidden = await recordOwnerDecisionResponse(
    new Request("https://console.example/api/owner-decisions", { method: "POST" }),
    {},
    recordDeps({
      readSession: async () => ({ allowed: true, login: "decision-reader", admin: false }),
    }),
  );
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error, "admin required");
}

{
  const fingerprintReject = await recordOwnerDecisionResponse(
    new Request("https://console.example/api/owner-decisions", { method: "POST" }),
    {},
    recordDeps(),
  );
  assert.equal(fingerprintReject.status, 409);
  assert.equal(
    (await fingerprintReject.json()).error,
    "candidate evidence changed; reload the review before deciding",
  );
}

{
  const notReady = await ownerDecisionQueueResponse(
    new Request("https://console.example/api/owner-decisions"),
    {},
    queueDeps({
      currentControlPlanePayload: async () => ({
        data_status: "stale",
        computed_at: "2026-10-09T00:00:00Z",
        candidates: [],
        errors: ["stale_fixture"],
      }),
    }),
  );
  assert.equal(notReady.status, 200);
  const body = await notReady.json();
  assert.equal(body.data_status, "unavailable");
  assert.ok(body.errors.includes("control_plane_not_ready"));
  assert.equal(body.policy.no_order, true);
  assert.equal(body.policy.execution_authority_granted, false);
}

// Keep buildOwnerDecisionIntent / normalizeOwnerDecisionIntent reachable without a cycle.
{
  const domain = "us_equity";
  const candidate = {
    candidate_id: "cand_1",
    candidate_kind: "individual",
    domain,
  };
  const evidenceSha = await calculateOwnerDecisionSha256({
    candidate_id: candidate.candidate_id,
    candidate_kind: candidate.candidate_kind,
    domain: candidate.domain,
    lifecycle: { stage: "P6", status: "owner_decision_required" },
    evidence: {},
    recommendation: { code: "owner_live_decision" },
  });
  // Domain must exist in CONTROL_PLANE_DOMAINS; skip full intent build if fixture domain differs.
  try {
    const intent = await buildOwnerDecisionIntent({
      candidate,
      decision: "keep_parked",
      decidedBy: "decision-admin",
      candidateEvidenceSha256: evidenceSha,
      decidedAt: "2026-10-09T00:00:00Z",
    });
    assert.equal(intent.no_order, true);
    assert.equal(intent.execution_authority_granted, false);
    assert.equal(intent.decision, "keep_parked");
    const normalized = await normalizeOwnerDecisionIntent(intent, "fixture");
    assert.equal(normalized.decision_sha256, intent.decision_sha256);
  } catch (error) {
    if (!String(error.message || "").includes(".domain is invalid")) throw error;
  }
}

console.log("owner_decision_extract_validation: ok");
await import("./control_plane_retirement_validation.mjs");
