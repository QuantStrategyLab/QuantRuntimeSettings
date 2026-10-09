import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ownerDecisionQueueResponse,
  recordOwnerDecisionResponse,
} from "../web/strategy-switch-console/application/approval/owner_decisions.js";

const workerSource = await readFile(
  new URL("../web/strategy-switch-console/worker.js", import.meta.url),
  "utf8",
);
const moduleSource = await readFile(
  new URL("../web/strategy-switch-console/application/approval/owner_decisions.js", import.meta.url),
  "utf8",
);

assert.equal(
  workerSource.includes('from "./application/approval/owner_decisions.js"'),
  true,
  "Worker imports the B10-c owner-decision module",
);
assert.match(workerSource, /\/api\/owner-decisions"/);
assert.match(workerSource, /ownerDecisionQueueResponseImpl/);
assert.match(workerSource, /recordOwnerDecisionResponseImpl/);
assert.match(workerSource, /async function ownerDecisionQueueResponse/);
assert.match(workerSource, /async function recordOwnerDecisionResponse/);

const moduleNoComments = moduleSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
assert.equal(
  /transactionSync/.test(moduleNoComments),
  false,
  "approval module must not open Durable Object transactions",
);
assert.equal(
  /class RuntimeInstances|RUNTIME_INSTANCE|DURABLE_OBJECT|human_decision_material|human_decision_record/.test(moduleSource),
  false,
  "approval module must not own DO identity or human_decision tables",
);
assert.equal(
  moduleSource.includes('from "./worker.js"')
    || moduleSource.includes("from '../worker.js'")
    || moduleSource.includes('from "../../worker.js"')
    || moduleSource.includes("from '../../worker.js'"),
  false,
  "application module must not import worker.js",
);
assert.equal(
  moduleSource.includes('action: "owner_decide"'),
  true,
  "record path still issues owner_decide via injected repository",
);
assert.equal(
  moduleSource.includes("execution_authority_granted: false") && moduleSource.includes("no_order: true"),
  true,
  "wire keeps no_order / non-executable policy",
);
assert.equal(
  /recordResearchPromotionDecisionResponse|research-promotion/.test(moduleSource),
  false,
  "B10-c smallest slice: research promotion stays outside approval/owner_decisions.js",
);
assert.equal(
  /FIRSTRADE|LB-HK|LONGPORT_HK|longbridge.?hk/i.test(moduleSource),
  false,
  "B10-c must not touch LB-HK / Firstrade env",
);

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

console.log("owner_decision_extract_validation: ok");
