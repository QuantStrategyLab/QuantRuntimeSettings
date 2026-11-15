import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as constantsMod from "../web/strategy-switch-console/application/m0_research/constants.js";
import * as helpersMod from "../web/strategy-switch-console/application/m0_research/helpers.js";
import * as httpMod from "../web/strategy-switch-console/application/m0_research/http.js";
import * as runtimeSupport from "../web/strategy-switch-console/application/worker/runtime_support.js";
import { HttpError } from "../web/strategy-switch-console/application/http_error.js";
import {
  loadWorkerSurface,
  stripComments,
  surfaceDefinesFunction,
  surfaceImportsModule,
} from "./helpers/worker_surface.mjs";

const {
  M0_RESEARCH_ALLOWED_PRODUCER_REPOSITORY,
  M0_RESEARCH_ALLOWED_SOURCE_REPOSITORY,
  M0_RESEARCH_CURRENT_KEY,
  M0_RESEARCH_DASHBOARD_SCHEMA_VERSION,
  M0_RESEARCH_LEDGER_SCHEMA_VERSION,
  M0_RESEARCH_RETENTION_SECONDS,
  M0_RESEARCH_TRANSPORT_SCHEMA_VERSION,
} = constantsMod;

const {
  calculateM0ResearchLedgerSha256,
  requireDedicatedM0ResearchSyncToken,
  summarizeM0ResearchSubjects,
  utcTimestampSeconds,
} = helpersMod;

const {
  m0ResearchLedgerArchiveKey,
  m0ResearchLedgerResponse,
  syncM0ResearchLedgerResponse,
} = httpMod;

const m0Modules = [
  "application/m0_research/constants.js",
  "application/m0_research/helpers.js",
  "application/m0_research/http.js",
];

const surface = await loadWorkerSurface({
  includeDurableObject: false,
  applicationModules: m0Modules,
});
const { supportSource } = surface;

const constantsSource = await readFile(
  new URL("../web/strategy-switch-console/application/m0_research/constants.js", import.meta.url),
  "utf8",
);
const helpersSource = await readFile(
  new URL("../web/strategy-switch-console/application/m0_research/helpers.js", import.meta.url),
  "utf8",
);
const httpSource = await readFile(
  new URL("../web/strategy-switch-console/application/m0_research/http.js", import.meta.url),
  "utf8",
);

assert.equal(surfaceImportsModule(surface, "m0_research/constants.js"), true);
assert.equal(surfaceImportsModule(surface, "m0_research/helpers.js"), true);
assert.equal(surfaceImportsModule(surface, "m0_research/http.js"), true);

for (const name of [
  "syncM0ResearchLedgerResponse",
  "m0ResearchLedgerResponse",
  "m0ResearchLedgerReplayError",
  "m0ResearchLedgerArchiveKey",
  "writeM0ResearchLedgerRecord",
  "readCurrentM0ResearchLedgerRecord",
  "requireDedicatedM0ResearchSyncToken",
  "normalizeM0ResearchLedgerTransport",
  "normalizeM0ResearchLedgerStorageRecord",
  "normalizeM0ResearchLedger",
  "normalizeM0ResearchLedgerSummary",
  "m0ResearchSummariesEqual",
  "normalizeM0ResearchLedgerPolicy",
  "normalizeM0ResearchSubject",
  "normalizeM0ResearchObservation",
  "normalizeM0ResearchContext",
  "normalizeM0ResearchFreshness",
  "calculateM0ResearchHorizonViews",
  "projectM0ResearchDashboardForRead",
  "projectM0ResearchObservationFreshness",
  "normalizeM0ResearchHorizonView",
  "summarizeM0ResearchSubjects",
  "normalizeM0ResearchErrorCodes",
  "normalizeM0ResearchRepository",
  "normalizeM0ResearchRevision",
  "normalizeM0ResearchProducer",
  "normalizeM0ResearchSourceArtifact",
  "normalizeM0ResearchArtifactId",
  "normalizeM0ResearchIdentifier",
  "normalizeM0ResearchTimestamp",
  "normalizeM0ResearchDate",
  "normalizeM0ResearchCount",
  "normalizeM0ResearchText",
  "assertM0ResearchUnique",
  "assertM0ResearchSortedUnique",
  "canonicalM0ResearchLedgerJson",
  "calculateM0ResearchLedgerSha256",
  "emptyM0ResearchDashboardPayload",
]) {
  assert.equal(surfaceDefinesFunction(surface, name), true, name);
}

assert.match(supportSource, /m0ResearchRuntimeDeps/);
assert.match(supportSource, /syncM0ResearchLedgerResponseImpl/);
assert.match(supportSource, /m0ResearchLedgerResponseImpl/);

// Re-export parity between runtime_support and application/m0_research/*
for (const [name, value] of Object.entries(constantsMod)) {
  assert.deepEqual(runtimeSupport[name], value, `constant parity mismatch: ${name}`);
}
for (const [name, value] of Object.entries(helpersMod)) {
  if (name === "utcTimestampSeconds") {
    assert.equal(typeof runtimeSupport.utcTimestampSeconds, "function");
    continue;
  }
  assert.strictEqual(runtimeSupport[name], value, `helper parity mismatch: ${name}`);
}
for (const name of [
  "m0ResearchLedgerReplayError",
  "m0ResearchLedgerArchiveKey",
  "writeM0ResearchLedgerRecord",
  "readCurrentM0ResearchLedgerRecord",
]) {
  assert.strictEqual(runtimeSupport[name], httpMod[name], `http export parity mismatch: ${name}`);
}
assert.equal(typeof runtimeSupport.syncM0ResearchLedgerResponse, "function");
assert.equal(typeof runtimeSupport.m0ResearchLedgerResponse, "function");

// Cycle freedom & boundary constraints
for (const source of [constantsSource, helpersSource, httpSource]) {
  const noComments = stripComments(source);
  assert.equal(
    /from\s+["'][^"']*(?:runtime_support|worker)\.js["']/.test(noComments),
    false,
    "m0_research modules must not import runtime_support.js or worker.js",
  );
}
assert.match(httpSource, /readBoundedJson/, "http.js injects readBoundedJson via deps");
assert.match(httpSource, /appendAuditLog/, "http.js injects appendAuditLog via deps");
assert.match(supportSource, /export async function syncAdaptiveSelectionSourceResponse/);
assert.equal(
  /(?:export )?(?:async )?function syncAdaptiveSelectionSourceResponse\(/.test(stripComments(httpSource + helpersSource)),
  false,
  "extract must leave adaptive selection cluster in runtime_support",
);

// Token validation behavior
assert.throws(
  () => requireDedicatedM0ResearchSyncToken(new Request("https://example.invalid/sync"), {}),
  (err) => err instanceof HttpError && err.status === 500,
);
assert.throws(
  () => requireDedicatedM0ResearchSyncToken(
    new Request("https://example.invalid/sync", { headers: { Authorization: "Bearer wrong" } }),
    { M0_RESEARCH_SYNC_TOKEN: "expected-secret" },
  ),
  (err) => err instanceof HttpError && err.status === 401,
);
requireDedicatedM0ResearchSyncToken(
  new Request("https://example.invalid/sync", { headers: { Authorization: "Bearer expected-secret" } }),
  { M0_RESEARCH_SYNC_TOKEN: "expected-secret" },
);

function createMemoryKv() {
  const store = new Map();
  const puts = [];
  return {
    store,
    puts,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value, options) {
      store.set(key, value);
      puts.push({ key, options });
    },
  };
}

async function buildEnvelope({ computedAtMs, generatedAtMs = computedAtMs, runId = "run-1", artifactSha = "b".repeat(64) }) {
  const computedAt = utcTimestampSeconds(new Date(computedAtMs));
  const generatedAt = utcTimestampSeconds(new Date(generatedAtMs));
  const expiresAt = utcTimestampSeconds(new Date(generatedAtMs + 7 * 24 * 60 * 60 * 1000));
  const subjects = [
    {
      subject: { kind: "asset_idea", identifier: "sym-alpha" },
      observations: [
        {
          source_ids: ["src-1"],
          source_report_digest: "c".repeat(64),
          source_entry_digest: "d".repeat(64),
          hypothesis_id: "hyp-1",
          as_of: generatedAt.slice(0, 10),
          generated_at: generatedAt,
          expires_at: expiresAt,
          research_context: {
            state: "candidate",
            primary_horizon: "medium",
            suitable_horizons: ["medium"],
            source_confidence: "medium",
            source_style: "macro_context",
            theme_ids: ["theme-1"],
          },
          freshness: {
            status: "fresh",
            age_seconds: Math.max(0, Math.floor((computedAtMs - generatedAtMs) / 1000)),
          },
        },
      ],
      horizon_conflict: { status: "none", primary_horizons: ["medium"] },
      historical_stale_horizon_drift: { status: "none", primary_horizons: [] },
    },
  ];
  const ledger = {
    schema_version: M0_RESEARCH_LEDGER_SCHEMA_VERSION,
    generated_at: computedAt,
    computed_at: computedAt,
    data_status: "ready",
    summary: summarizeM0ResearchSubjects(subjects),
    subjects,
    policy: {
      authority: "research_only",
      no_order: true,
      permitted_next_step: "research_validation_only",
      notice: "M0 ledger for research inspection only.",
    },
    errors: [],
  };
  const ledgerSha256 = await calculateM0ResearchLedgerSha256(ledger);
  return {
    schema_version: M0_RESEARCH_TRANSPORT_SCHEMA_VERSION,
    producer: { repository: M0_RESEARCH_ALLOWED_PRODUCER_REPOSITORY, revision: "a".repeat(40) },
    source_artifact: {
      repository: M0_RESEARCH_ALLOWED_SOURCE_REPOSITORY,
      revision: "1".repeat(40),
      run_id: runId,
      artifact_id: "m0-ledger-json",
      sha256: artifactSha,
    },
    ledger_sha256: ledgerSha256,
    ledger,
  };
}

// Sync, idempotent replay, conflict/rollback rejection, and read projection behavior
const kv = createMemoryKv();
const audits = [];
const env = {
  M0_RESEARCH_SYNC_TOKEN: "sync-token",
  STRATEGY_SWITCH_CONFIG: kv,
};
const deps = {
  readBoundedJson: async (req) => req.json(),
  appendAuditLog: async (_env, entry) => {
    audits.push(entry);
  },
};

const nowMs = Date.now();
const freshEnvelope = await buildEnvelope({ computedAtMs: nowMs - 60_000, runId: "run-100", artifactSha: "2".repeat(64) });
const makeSyncReq = (body) => new Request("https://example.invalid/api/internal/sync-m0-research-ledger", {
  method: "POST",
  headers: {
    Authorization: "Bearer sync-token",
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const syncRes = await syncM0ResearchLedgerResponse(makeSyncReq(freshEnvelope), env, deps);
assert.equal(syncRes.status, 200);
const syncBody = await syncRes.json();
assert.equal(syncBody.ok, true);
assert.equal(syncBody.replayed, false);
assert.equal(syncBody.no_order, true);
assert.equal(kv.puts.length, 2);
assert.equal(kv.puts[0].key, m0ResearchLedgerArchiveKey(freshEnvelope.ledger_sha256));
assert.equal(kv.puts[1].key, M0_RESEARCH_CURRENT_KEY);
assert.equal(kv.puts[1].options.expirationTtl, M0_RESEARCH_RETENTION_SECONDS);
assert.equal(audits.length, 1);
assert.equal(audits[0].action, "sync_m0_research_ledger");

// Identical source_artifact.sha256 -> idempotent replay with no extra KV or audit writes
const replayRes = await syncM0ResearchLedgerResponse(makeSyncReq(freshEnvelope), env, deps);
assert.equal(replayRes.status, 200);
const replayBody = await replayRes.json();
assert.equal(replayBody.replayed, true);
assert.equal(kv.puts.length, 2);
assert.equal(audits.length, 1);

// Same run_id with different artifact sha -> 409 conflict
const conflictEnvelope = await buildEnvelope({ computedAtMs: nowMs - 30_000, runId: "run-100", artifactSha: "3".repeat(64) });
const conflictRes = await syncM0ResearchLedgerResponse(makeSyncReq(conflictEnvelope), env, deps);
assert.equal(conflictRes.status, 409);

// Timestamp rollback on new run_id -> 409 conflict
const rollbackEnvelope = await buildEnvelope({ computedAtMs: nowMs - 120_000, runId: "run-099", artifactSha: "4".repeat(64) });
const rollbackRes = await syncM0ResearchLedgerResponse(makeSyncReq(rollbackEnvelope), env, deps);
assert.equal(rollbackRes.status, 409);

// Read endpoint checks: unauthenticated -> 401; authenticated -> ready
const readReq = new Request("https://example.invalid/api/m0-research");
const unauthRes = await runtimeSupport.m0ResearchLedgerResponse(readReq, env);
assert.equal(unauthRes.status, 401);

const readyRes = await m0ResearchLedgerResponse(readReq, env, {
  readSession: async () => ({ allowed: true, admin: false, login: "viewer" }),
});
assert.equal(readyRes.status, 200);
const readyBody = await readyRes.json();
assert.equal(readyBody.schema_version, M0_RESEARCH_DASHBOARD_SCHEMA_VERSION);
assert.equal(readyBody.data_status, "ready");
assert.equal(readyBody.summary.fresh_observation_count, 1);
assert.equal(readyBody.summary.stale_observation_count, 0);

// Stale demotion on read when observation expires (>7d old) while ledger retention (<14d) stays valid
const staleKv = createMemoryKv();
const staleEnv = { M0_RESEARCH_SYNC_TOKEN: "sync-token", STRATEGY_SWITCH_CONFIG: staleKv };
const eightDaysAgoMs = nowMs - 8 * 24 * 60 * 60 * 1000;
const staleEligibleEnvelope = await buildEnvelope({
  computedAtMs: eightDaysAgoMs,
  generatedAtMs: eightDaysAgoMs,
  runId: "run-stale",
  artifactSha: "5".repeat(64),
});
const staleSyncRes = await runtimeSupport.syncM0ResearchLedgerResponse(makeSyncReq(staleEligibleEnvelope), staleEnv);
assert.equal(staleSyncRes.status, 200);

const staleReadRes = await m0ResearchLedgerResponse(readReq, staleEnv, {
  readSession: async () => ({ allowed: true, admin: false, login: "viewer" }),
});
assert.equal(staleReadRes.status, 200);
const staleReadBody = await staleReadRes.json();
assert.equal(staleReadBody.data_status, "stale");
assert.equal(staleReadBody.summary.fresh_observation_count, 0);
assert.equal(staleReadBody.summary.stale_observation_count, 1);

// Corrupt KV record fails closed to unavailable dashboard
await staleKv.put(M0_RESEARCH_CURRENT_KEY, "{broken-json");
const corruptReadRes = await m0ResearchLedgerResponse(readReq, staleEnv, {
  readSession: async () => ({ allowed: true, admin: false, login: "viewer" }),
});
assert.equal(corruptReadRes.status, 200);
const corruptReadBody = await corruptReadRes.json();
assert.equal(corruptReadBody.data_status, "unavailable");
assert.deepEqual(corruptReadBody.errors, ["m0_research_ledger_unavailable"]);

console.log("m0_research_extract_validation: ok");
