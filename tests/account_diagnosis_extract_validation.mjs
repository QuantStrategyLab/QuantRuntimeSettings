import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  requireAccountDiagnosisToken,
  accountDiagnosisRequestId,
  accountDiagnosisChecks,
  accountDiagnosisHasConfirmedAttention,
  accountDiagnosisStateFingerprint,
  accountDiagnosisTargetSpec,
} from "../web/strategy-switch-console/application/account_diagnosis/checks.js";
import {
  accountDiagnosisResponse,
  accountDiagnosisInternalResponse,
} from "../web/strategy-switch-console/application/account_diagnosis/http.js";
import { ACCOUNT_DIAGNOSIS_TARGET_ID } from "../web/strategy-switch-console/application/account_diagnosis/constants.js";
import { loadWorkerSurface, stripComments, surfaceImportsModule } from "./helpers/worker_surface.mjs";

const diagnosisModules = [
  "application/account_diagnosis/constants.js",
  "application/account_diagnosis/helpers.js",
  "application/account_diagnosis/checks.js",
  "application/account_diagnosis/context.js",
  "application/account_diagnosis/native.js",
  "application/account_diagnosis/http.js",
];

const surface = await loadWorkerSurface({
  includeDurableObject: true,
  applicationModules: diagnosisModules,
});
const { supportSource, durableSource, wiredSource } = surface;

const checksSource = await readFile(
  new URL("../web/strategy-switch-console/application/account_diagnosis/checks.js", import.meta.url),
  "utf8",
);
const contextSource = await readFile(
  new URL("../web/strategy-switch-console/application/account_diagnosis/context.js", import.meta.url),
  "utf8",
);
const nativeSource = await readFile(
  new URL("../web/strategy-switch-console/application/account_diagnosis/native.js", import.meta.url),
  "utf8",
);
const httpSource = await readFile(
  new URL("../web/strategy-switch-console/application/account_diagnosis/http.js", import.meta.url),
  "utf8",
);

assert.equal(
  surfaceImportsModule(surface, "account_diagnosis/http.js"),
  true,
  "Worker stack imports account_diagnosis/http.js",
);
assert.equal(
  surfaceImportsModule(surface, "account_diagnosis/native.js"),
  true,
  "Worker stack imports account_diagnosis/native.js",
);
assert.equal(
  surfaceImportsModule(surface, "account_diagnosis/checks.js"),
  true,
  "Worker stack imports account_diagnosis/checks.js",
);
assert.equal(
  surfaceImportsModule(surface, "account_diagnosis/constants.js"),
  true,
  "Worker stack imports account_diagnosis/constants.js",
);

assert.match(wiredSource, /\/api\/account-diagnosis"/);
assert.match(wiredSource, /\/api\/internal\/account-diagnosis\//);
assert.match(wiredSource, /accountDiagnosisResponseImpl/);
assert.match(wiredSource, /accountDiagnosisInternalResponseImpl/);
assert.match(wiredSource, /maybeAutoDispatchAccountDiagnosisImpl/);
assert.match(supportSource, /async function accountDiagnosisResponse/);
assert.match(supportSource, /async function accountDiagnosisInternalResponse/);
assert.match(supportSource, /async function dispatchAccountDiagnosis/);
assert.match(supportSource, /async function maybeAutoDispatchAccountDiagnosis/);
assert.match(durableSource, /CREATE TABLE IF NOT EXISTS account_diagnosis_tasks/);
assert.match(durableSource, /from "\.\.\/account_diagnosis\/constants\.js"/);

for (const source of [checksSource, contextSource, nativeSource, httpSource]) {
  const noComments = stripComments(source);
  assert.equal(
    /transactionSync/.test(noComments),
    false,
    "account_diagnosis modules must not open Durable Object transactions",
  );
  assert.equal(
    /class RuntimeInstances|DURABLE_OBJECT|CREATE TABLE/.test(source),
    false,
    "account_diagnosis modules must not own DO identity or tables",
  );
  assert.equal(
    source.includes('from "../worker/runtime_support.js"')
      || source.includes("from '../worker/runtime_support.js'")
      || source.includes('from "./worker.js"')
      || source.includes("from '../worker.js'")
      || source.includes('from "../../worker.js"'),
    false,
    "account_diagnosis modules must not import runtime_support.js or worker.js",
  );
}

assert.match(httpSource, /login required/);
assert.match(httpSource, /requireSameOrigin/);
assert.match(httpSource, /requireAccountDiagnosisToken/);
assert.match(nativeSource, /diagnosis_native_intent|diagnosis_native_save/);
assert.match(nativeSource, /maybeAutoDispatchAccountDiagnosis/);
assert.match(contextSource, /account_diagnosis_identity_conflict/);
assert.match(checksSource, /accountDiagnosisChecks/);

{
  assert.throws(
    () => requireAccountDiagnosisToken(new Request("https://example/"), {}),
    /account diagnosis sync token is not configured/,
  );
  assert.throws(
    () => requireAccountDiagnosisToken(
      new Request("https://example/", { headers: { Authorization: "Bearer wrong" } }),
      { ACCOUNT_DIAGNOSIS_SYNC_TOKEN: "expected" },
    ),
    /account diagnosis sync token is invalid/,
  );
  requireAccountDiagnosisToken(
    new Request("https://example/", { headers: { Authorization: "Bearer expected" } }),
    { ACCOUNT_DIAGNOSIS_SYNC_TOKEN: "expected" },
  );
}

{
  assert.equal(
    accountDiagnosisRequestId("11111111-1111-4111-8111-111111111111"),
    "11111111-1111-4111-8111-111111111111",
  );
  assert.throws(() => accountDiagnosisRequestId("not-a-uuid"), /invalid_account_diagnosis_request_id/);
}

{
  const checks = accountDiagnosisChecks({
    target: {
      target: { configured_state: "enabled" },
      monitoring: { runtime_guard: "attention", execution_heartbeat: "pass" },
      deployment: { runtime_enabled: true, scheduler_state: "enabled" },
    },
    freshness: { data_status: "ready" },
  }, "ready");
  assert.equal(checks.runtime_guard, "attention");
  assert.equal(accountDiagnosisHasConfirmedAttention(checks), true);
  assert.equal(
    accountDiagnosisStateFingerprint(ACCOUNT_DIAGNOSIS_TARGET_ID, checks),
    `${ACCOUNT_DIAGNOSIS_TARGET_ID}:${JSON.stringify(checks)}`,
  );
  assert.ok(accountDiagnosisTargetSpec("binance", ACCOUNT_DIAGNOSIS_TARGET_ID));
  assert.equal(accountDiagnosisTargetSpec("longbridge", ACCOUNT_DIAGNOSIS_TARGET_ID), null);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function baseDeps(overrides = {}) {
  return {
    json,
    readSession: async () => ({ allowed: true, login: "fixture-admin" }),
    hasRuntimeInstanceStore: () => true,
    requireSameOrigin: () => {},
    readBoundedJson: async () => ({ platform: "binance", key: "default", trigger: "manual_check" }),
    runtimeInstanceCommand: async () => {
      throw new Error("runtimeInstanceCommand should not run in this case");
    },
    loadAccountOptionsConfig: async () => ({ options: {} }),
    hasConfigStore: () => true,
    readRuntimeTargetLifecycleSources: async () => [],
    executionEvidenceStaleTtlSeconds: () => 3600,
    controlPlaneSnapshotFreshness: () => ({ data_status: "ready" }),
    canonicalResearchTaskJson: (value) => JSON.stringify(value),
    sha256Hex: async () => "a".repeat(64),
    fetchWithTimeout: async () => new Response(null, { status: 204 }),
    githubHeaders: () => ({}),
    ...overrides,
  };
}

{
  const unauthorized = await accountDiagnosisResponse(
    new Request("https://console.example/api/account-diagnosis?platform=binance&key=default"),
    {},
    new URL("https://console.example/api/account-diagnosis?platform=binance&key=default"),
    baseDeps({ readSession: async () => null }),
  );
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error, "login required");
}

{
  const storageMissing = await accountDiagnosisResponse(
    new Request("https://console.example/api/account-diagnosis?platform=binance&key=default"),
    {},
    new URL("https://console.example/api/account-diagnosis?platform=binance&key=default"),
    baseDeps({ hasRuntimeInstanceStore: () => false }),
  );
  assert.equal(storageMissing.status, 503);
  assert.equal((await storageMissing.json()).error, "account_diagnosis_storage_unavailable");
}

{
  const tokenReject = await accountDiagnosisInternalResponse(
    new Request("https://console.example/api/internal/account-diagnosis/11111111-1111-4111-8111-111111111111"),
    {},
    new URL("https://console.example/api/internal/account-diagnosis/11111111-1111-4111-8111-111111111111"),
    baseDeps(),
  );
  assert.equal(tokenReject.status, 500);
  assert.match((await tokenReject.json()).error, /account diagnosis sync token is not configured/);
}

{
  const badId = await accountDiagnosisInternalResponse(
    new Request("https://console.example/api/internal/account-diagnosis/not-a-uuid", {
      headers: { Authorization: "Bearer diagnosis-token" },
    }),
    { ACCOUNT_DIAGNOSIS_SYNC_TOKEN: "diagnosis-token" },
    new URL("https://console.example/api/internal/account-diagnosis/not-a-uuid"),
    baseDeps(),
  );
  assert.equal(badId.status, 400);
  assert.equal((await badId.json()).error, "invalid_account_diagnosis_request_id");
}

console.log("account_diagnosis_extract_validation: ok");
