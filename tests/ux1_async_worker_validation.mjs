import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { __test } from "../web/strategy-switch-console/worker.js";
import { canonicalJson, defaultUx1Draft } from "../web/strategy-switch-console/ux1_research_contract.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");

const repository = "QuantStrategyLab/UsEquityStrategies";
const workflowPath = ".github/workflows/ux1-research-preview.yml";
const ues = "ab".repeat(20);
const nextUes = "cd".repeat(20);
const epoch = "12".repeat(16);
const nextEpoch = "34".repeat(16);
const jobToken = "synthetic-only-job-token";
const dispatchToken = "synthetic-only-dispatch-token";
const providerSentinel = "PROVIDER_BODY_SENTINEL";
const hashes = {
  r7_policy_sha256: "a".repeat(64),
  r8_policy_sha256: "b".repeat(64),
  capital_policy_sha256: "c".repeat(64),
  settlement_policy_sha256: "d".repeat(64),
  raw_manifest_sha256: "e".repeat(64),
  r6_manifest_sha256: "f".repeat(64),
  r6_materialized_file_sha256: "1".repeat(64),
};
const otherHashes = { ...hashes, r7_policy_sha256: "9".repeat(64) };
const asyncEnv = {
  UX1_PREVIEW_MODE: "github_actions",
  UX1_UES_REVISION: ues,
  UX1_RUNTIME_EPOCH: epoch,
  UX1_EXPECTED_EVIDENCE_HASHES: JSON.stringify(hashes),
  UX1_RESEARCH_JOB_TOKEN: jobToken,
};

const createdAt = Date.parse("2026-09-27T00:00:00.000Z");
const storedJob = {
  request_id: "11111111-1111-4111-8111-111111111111",
  status: "queued",
  dispatch_state: "dispatched",
  revision: 1,
  runtime_epoch: epoch,
  ues_revision: ues,
  evidence: hashes,
  created_at: new Date(createdAt).toISOString(),
  updated_at: new Date(createdAt).toISOString(),
  reason: null,
  request: { schema: "qsl.ux1.preview_request.v1", private_path: "must-not-project" },
};
const waiting = __test.projectUx1Job(storedJob, createdAt + __test.ux1JobUnknownAfterMs, 1, asyncEnv);
assert.equal(waiting.status, "unknown");
assert.equal(waiting.reason, "check_required");
assert.equal(storedJob.status, "queued");
assert.equal(waiting.request, undefined);
assert.equal(waiting.evidence, undefined);
assert.equal(waiting.private_path, undefined);
const stillQueued = __test.projectUx1Job(storedJob, createdAt + __test.ux1JobUnknownAfterMs - 1, 1, asyncEnv);
assert.equal(stillQueued.status, "queued");
const activeAfterConfigChange = __test.projectUx1Job(storedJob, createdAt + 1000, 2, { ...asyncEnv, UX1_RUNTIME_EPOCH: nextEpoch });
assert.equal(activeAfterConfigChange.status, "queued");
const superseded = __test.projectUx1Job({ ...storedJob, status: "succeeded" }, createdAt + 1000, 1, { ...asyncEnv, UX1_EXPECTED_EVIDENCE_HASHES: JSON.stringify(otherHashes) });
assert.equal(superseded.status, "superseded");
assert.equal(superseded.reason, "config_changed");
const forgedRun = {
  id: 4242,
  event: "workflow_dispatch",
  path: workflowPath,
  head_sha: ues,
  display_title: "UX1 preview 11111111-1111-4111-8111-111111111111",
  run_attempt: 1,
  head_branch: "main",
  repository: { full_name: repository, fork: false },
  head_repository: { full_name: repository, fork: false },
};
assert.equal(__test.ux1RunMatches(forgedRun, { request_id: storedJob.request_id, ues_revision: ues }, "4242", "1"), true);
for (const mutate of [
  (run) => { run.event = "pull_request"; },
  (run) => { run.path = ".github/workflows/other.yml"; },
  (run) => { run.head_sha = nextUes; },
  (run) => { run.display_title = "UX1 preview other"; },
  (run) => { run.run_attempt = 2; },
  (run) => { run.head_branch = "feature"; },
  (run) => { run.repository.full_name = "evil/UsEquityStrategies"; },
  (run) => { run.head_repository.full_name = "fork/UsEquityStrategies"; },
  (run) => { run.head_repository.fork = true; },
  (run) => { run.repository.fork = true; },
  (run) => { run.id = 999; },
  (run) => { delete run.display_title; },
  (run) => { delete run.head_repository; },
  (run) => { delete run.repository; },
]) {
  const copy = structuredClone(forgedRun);
  mutate(copy);
  assert.equal(__test.ux1RunMatches(copy, { request_id: storedJob.request_id, ues_revision: ues }, "4242", "1"), false);
}

const legacy = { key: "existing", label: "Existing fixture", target_name: "existing", account_selector: "existing-account", deployment_selector: "existing-deployment", service_name: "existing-service", supported_domains: ["us_equity"] };
const baseBindings = {
  SESSION_SECRET: "synthetic-only-session-key",
  STRATEGY_SWITCH_ADMIN_LOGINS: "fixture-admin",
  ALLOWED_GITHUB_LOGINS: "fixture-reader,fixture-other,fixture-admin",
  RUNTIME_SETTINGS_DISPATCH_TOKEN: dispatchToken,
  UX1_EXPECTED_EVIDENCE_HASHES: JSON.stringify(hashes),
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ ibkr: [legacy] }),
  STRATEGY_SWITCH_STRATEGY_PROFILES_JSON: JSON.stringify([{ profile: "fixture-strategy", label: "Fixture strategy", domain: "us_equity", allowed_execution_modes: ["dry_run"], runtime_enabled: false }]),
};
const readerCookie = `qsl_switch_session=${await __test.makeSession("fixture-reader", [], baseBindings)}`;
const otherCookie = `qsl_switch_session=${await __test.makeSession("fixture-other", [], baseBindings)}`;
const githubCalls = [];
let calculatorCalls = 0;
const github = { mode: "ok", run: null };

function calculatorResult(request, hashSet = hashes) {
  const { schema, ...business } = request;
  assert.equal(schema, "qsl.ux1.preview_request.v1");
  const fingerprint = createHash("sha256").update(canonicalJson(business)).digest("hex");
  const nested = (value) => ({ outer: { QQQM: value, BOXX: 0 }, tqqq: { TQQQ: 0 }, soxl: { SOXL: 0, SOXX: 0, BOXX: 0 } });
  return {
    schema: "qsl.ux1.preview_result.v1",
    status: "ok",
    request_fingerprint: fingerprint,
    advanced_settings: request.advanced_settings,
    research_only: true,
    no_order: true,
    execution_authority_granted: false,
    native_observed: false,
    paper_authorized: false,
    shadow_authorized: false,
    live_authorized: false,
    original_full_v2_mapped: false,
    original_full_v2_features_silently_disabled: false,
    advanced_null_asserts_original_full_v2_toggles: false,
    source_class: request.source_class,
    source_assurance: "synthetic_test_only",
    model_id: "paired_60_executable_one_session_log_v1",
    optimality_scope: "best_score_among_feasible_B0_B3_only",
    research_case_id: request.research_case_id,
    candidate_id: request.candidate_id,
    objective: request.objective,
    candidate_set_id: request.candidate_set_id,
    capital_variant: request.capital_variant,
    cost_bps: request.cost_bps,
    initial_research_nav_usd: 10000,
    development: true,
    strict_point_in_time_certified: false,
    limitations: ["synthetic_test_only"],
    ...hashSet,
    capital_policy_id: "test_capital_policy_v1",
    settlement_policy_id: "test_settlement_policy_v1",
    decision_preview: {
      decision_date: "2023-03-29",
      scenarios_observed_through: "2023-03-29",
      scenario_count: 60,
      selected_action: "B1",
      previous_action: "B0",
      previous_action_retained: true,
      scores: { B0: 0.01, B1: 0.02, B2: 0.005, B3: 0.004 },
      score_gain_over_previous_action: 0.01,
      tie_log_tolerance: 1e-8,
      no_advantage: false,
      member_budgets_usd: { tqqq: 250, soxl: 250 },
      asset_targets_usd: nested(100),
      outer_cash_target_usd: 100,
      curve_ratio: 0.03,
      wealth_reference_usd: 10000,
      aggregate_member_cap_usd: 300,
    },
    historical_execution_check: {
      trade_date: "2023-03-30",
      decision_date: "2023-03-29",
      feeds_back_into_decision: false,
      trade_shares: nested(2),
      fees_usd: nested(1.5),
      total_fees_usd: 1.5,
      settled_cash_usd: 8000,
      pending_sale_usd: 0,
      receivable_usd: 0,
      shortages: [],
      no_action: false,
    },
  };
}

function draftBody(revision, overrides = {}) {
  const draft = defaultUx1Draft();
  if (Object.hasOwn(overrides, "objective")) draft.objective = overrides.objective;
  if (Object.hasOwn(overrides, "research_case_id")) draft.research_case_id = overrides.research_case_id;
  Object.assign(draft.advanced_settings, overrides.advanced_settings || {});
  return { expected_revision: revision, ...draft };
}

function validRun(requestId, runId = "4242", attempt = "1", sha = ues) {
  return {
    id: Number(runId),
    event: "workflow_dispatch",
    path: workflowPath,
    head_sha: sha,
    display_title: `UX1 preview ${requestId}`,
    run_attempt: Number(attempt),
    head_branch: "main",
    repository: { full_name: repository, fork: false },
    head_repository: { full_name: repository, fork: false },
  };
}

async function outbound(request) {
  let body = "";
  if (request.method !== "GET") {
    try {
      body = new TextDecoder().decode(await request.arrayBuffer());
    } catch {
      body = "";
    }
  }
  githubCalls.push({
    url: request.url,
    method: request.method,
    body,
    authorization: request.headers.get("authorization"),
  });
  if (request.url.endsWith("/dispatches")) {
    if (github.mode === "reject") return new Response(providerSentinel, { status: 400 });
    if (github.mode === "unknown") return new Response(providerSentinel, { status: 500 });
    if (github.mode === "redirect") return new Response(providerSentinel, { status: 302, headers: { location: "https://evil.example/secret" } });
    return new Response(null, { status: 204 });
  }
  if (github.mode === "huge-run") return new Response("y".repeat(70_000), { status: 200 });
  return new Response(JSON.stringify(github.run), { headers: { "content-type": "application/json" } });
}

const persist = await mkdtemp(join(tmpdir(), "qrt-ux1-async-"));
let mf;
function start(extra) {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
    compatibilityDate: "2026-06-08",
    bindings: { ...baseBindings, ...extra },
    durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
    durableObjectsPersist: persist,
    outboundService: outbound,
    serviceBindings: {
      UX1_RESEARCH_CALCULATOR: async () => {
        calculatorCalls += 1;
        return new Response("calculator-should-not-be-called", { status: 500 });
      },
    },
  });
}

async function call(body, { cookie = readerCookie, origin = "https://console.example", endpoint = "/api/ux1/draft", method = body ? "POST" : "GET", authorization = "" } = {}) {
  const response = await mf.dispatchFetch(`https://console.example${endpoint}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(authorization ? { Authorization: authorization } : {}),
      "content-type": "application/json",
    },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: response.status, text, body: parsed };
}

function dispatchPosts() {
  return githubCalls.filter((callInfo) => callInfo.method === "POST" && callInfo.url.endsWith("/dispatches"));
}

function assertNoSecrets(text) {
  assert.equal(text.includes(jobToken), false);
  assert.equal(text.includes(dispatchToken), false);
  assert.equal(text.includes(providerSentinel), false);
  assert.equal(text.includes("must-not-project"), false);
  assert.equal(text.includes("private_path"), false);
}

try {
  start({ UX1_PREVIEW_MODE: "not_a_mode" });
  assert.equal((await call(undefined, { cookie: "" })).status, 401);
  const saved = await call(draftBody(0));
  assert.equal(saved.status, 200);
  const rejectedMode = await call({ expected_revision: saved.body.revision }, { endpoint: "/api/ux1/preview" });
  assert.equal(rejectedMode.status, 400);
  assert.equal(rejectedMode.body.error, "ux1_preview_mode_rejected");
  assert.equal(dispatchPosts().length, 0);
  assertNoSecrets(rejectedMode.text);
  await mf.dispose();

  start({ ...asyncEnv, UX1_UES_REVISION: "" });
  const disconnected = await call({ expected_revision: saved.body.revision }, { endpoint: "/api/ux1/preview" });
  assert.equal(disconnected.status, 503);
  assert.equal(disconnected.body.error, "ux1_async_not_connected");
  assert.equal(disconnected.body.preview, null);
  assert.equal(dispatchPosts().length, 0);
  assertNoSecrets(disconnected.text);
  await mf.dispose();

  start(asyncEnv);
  const missing = await call(draftBody(saved.body.revision, { objective: null }));
  assert.equal(missing.status, 200);
  const missingPreview = await call({ expected_revision: missing.body.revision }, { endpoint: "/api/ux1/preview" });
  assert.equal(missingPreview.body.preview.status, "missing_input");
  assert.equal(dispatchPosts().length, 0);
  const unsupported = await call(draftBody(missing.body.revision, { objective: "global_optimum" }));
  const unsupportedPreview = await call({ expected_revision: unsupported.body.revision }, { endpoint: "/api/ux1/preview" });
  assert.equal(unsupportedPreview.body.preview.status, "unsupported_scope");
  assert.equal(unsupportedPreview.body.job, null);
  assert.equal(dispatchPosts().length, 0);
  const ready = await call(draftBody(unsupported.body.revision));
  const preview = await call({ expected_revision: ready.body.revision }, { endpoint: "/api/ux1/preview" });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.workflow_dispatched, false);
  assert.equal(preview.body.no_order, true);
  assert.equal(preview.body.execution_authority_granted, false);
  assert.equal(preview.body.research_workflow_dispatched, true);
  assert.equal(preview.body.job.status, "queued");
  assert.equal(preview.body.job.dispatch_state, "dispatched");
  assert.equal(preview.body.preview, null);
  assert.deepEqual(Object.keys(preview.body.job).sort(), ["created_at", "dispatch_state", "reason", "request_id", "status", "updated_at"]);
  assert.equal(dispatchPosts().length, 1);
  const dispatched = dispatchPosts()[0];
  assert.equal(dispatched.url, `https://api.github.com/repos/${repository}/actions/workflows/ux1-research-preview.yml/dispatches`);
  assert.equal(dispatched.authorization, `Bearer ${dispatchToken}`);
  assert.deepEqual(JSON.parse(dispatched.body), { ref: "main", inputs: { ux1_request_id: preview.body.job.request_id } });
  const requestId = preview.body.job.request_id;
  const repeat = await call({ expected_revision: ready.body.revision }, { endpoint: "/api/ux1/preview" });
  assert.equal(repeat.body.job.request_id, requestId);
  assert.equal(dispatchPosts().length, 1);
  const other = await call(undefined, { cookie: otherCookie });
  assert.equal(other.body.job, null);
  assert.equal(other.text.includes(requestId), false);
  const blockedIntent = await call({ expected_revision: ready.body.revision, fingerprint: ready.body.fingerprint }, { endpoint: "/api/ux1/intent" });
  assert.equal(blockedIntent.status, 409);
  assert.equal(blockedIntent.body.error, "ux1_job_active");

  const bearer = `Bearer ${jobToken}`;
  assert.equal((await call({ request_id: requestId, run_id: "4242", run_attempt: "1" }, { endpoint: "/api/ux1/jobs/claim", cookie: "", origin: "" })).status, 401);
  assert.equal((await call({ request_id: requestId, run_id: "4242", run_attempt: "1" }, { endpoint: "/api/ux1/jobs/claim", cookie: readerCookie, origin: "" })).status, 401);
  assert.equal((await call({ request_id: requestId, run_id: "4242", run_attempt: "1" }, { endpoint: "/api/ux1/jobs/claim", cookie: "", origin: "", authorization: `Bearer ${dispatchToken}` })).status, 401);
  assert.equal((await call(undefined, { endpoint: "/api/ux1/jobs/claim", method: "GET", cookie: "", origin: "", authorization: bearer })).status, 405);
  assert.equal((await call({ request_id: requestId, run_id: 4242, run_attempt: "1" }, { endpoint: "/api/ux1/jobs/claim", cookie: "", origin: "", authorization: bearer })).status, 400);
  const beforeOversize = githubCalls.length;
  const oversize = await call(`{"pad":"${"x".repeat(80 * 1024)}"}`, { endpoint: "/api/ux1/jobs/claim", cookie: "", origin: "", authorization: bearer });
  assert.equal(oversize.status, 400);
  assert.equal(oversize.body.error, "ux1_body_too_large");
  assert.equal(githubCalls.length, beforeOversize);
  github.mode = "huge-run";
  github.run = validRun(requestId);
  const hugeRun = await call({ request_id: requestId, run_id: "4242", run_attempt: "1" }, { endpoint: "/api/ux1/jobs/claim", cookie: "", origin: "", authorization: bearer });
  assert.equal(hugeRun.status, 502);
  assert.equal(hugeRun.body.error, "ux1_run_unverified");
  assertNoSecrets(hugeRun.text);
  github.mode = "ok";
  for (const mutate of [
    (run) => { run.event = "pull_request"; },
    (run) => { run.path = ".github/workflows/other.yml"; },
    (run) => { run.head_sha = nextUes; },
    (run) => { run.display_title = "runner says trust me"; },
    (run) => { run.run_attempt = 9; },
    (run) => { run.head_branch = "feature"; },
    (run) => { run.repository.full_name = "evil/UsEquityStrategies"; },
    (run) => { run.head_repository = { full_name: "fork/UsEquityStrategies", fork: false }; },
    (run) => { run.head_repository = { full_name: repository, fork: true }; },
    (run) => { run.id = 999; },
    (run) => { delete run.display_title; },
  ]) {
    github.run = validRun(requestId);
    mutate(github.run);
    const forged = await call({ request_id: requestId, run_id: "4242", run_attempt: "1" }, { endpoint: "/api/ux1/jobs/claim", cookie: "", origin: "", authorization: bearer });
    assert.equal(forged.status, 502, JSON.stringify(github.run));
    assert.equal(forged.body.error, "ux1_run_unverified");
    assert.equal(forged.body.request, undefined);
    assertNoSecrets(forged.text);
  }
  github.run = validRun(requestId);
  const claimed = await call({ request_id: requestId, run_id: "4242", run_attempt: "1" }, { endpoint: "/api/ux1/jobs/claim", cookie: "", origin: "", authorization: bearer });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.claimed, true);
  assert.equal(claimed.body.request.schema, "qsl.ux1.preview_request.v1");
  assert.equal(claimed.body.request.path, undefined);
  assertNoSecrets(claimed.text);
  const runGet = githubCalls.filter((callInfo) => callInfo.method === "GET" && callInfo.url.includes("/actions/runs/4242")).at(-1);
  assert.equal(runGet.authorization, `Bearer ${dispatchToken}`);
  assert.equal(runGet.authorization.includes(jobToken), false);
  const secondClaim = await call({ request_id: requestId, run_id: "4242", run_attempt: "1" }, { endpoint: "/api/ux1/jobs/claim", cookie: "", origin: "", authorization: bearer });
  assert.equal(secondClaim.body.claimed, false);
  assert.equal(secondClaim.body.request, undefined);
  const otherRun = await call({ request_id: requestId, run_id: "4243", run_attempt: "1" }, { endpoint: "/api/ux1/jobs/claim", cookie: "", origin: "", authorization: bearer });
  assert.equal(otherRun.body.claimed, false);
  assert.equal(otherRun.body.request, undefined);
  const running = await call();
  assert.equal(running.body.job.status, "running");
  assert.equal(running.body.job.request_id, requestId);

  const good = calculatorResult(claimed.body.request);
  const poisoned = { ...good, private_path: "PRIVATE_SENTINEL_PATH", execution_authority_granted: true };
  const poisonedResult = await call({ request_id: requestId, run_id: "4242", run_attempt: "1", result: poisoned, error_code: null }, { endpoint: "/api/ux1/jobs/result", cookie: "", origin: "", authorization: bearer });
  assert.equal(poisonedResult.status, 502);
  assert.equal(poisonedResult.body.error, "calculator_result_rejected");
  assert.equal(poisonedResult.text.includes("PRIVATE_SENTINEL_PATH"), false);
  const wrong = calculatorResult(claimed.body.request, otherHashes);
  const wrongResult = await call({ request_id: requestId, run_id: "4242", run_attempt: "1", result: wrong, error_code: null }, { endpoint: "/api/ux1/jobs/result", cookie: "", origin: "", authorization: bearer });
  assert.equal(wrongResult.status, 502);
  assert.equal(wrongResult.body.error, "calculator_result_rejected");
  const accepted = await call({ request_id: requestId, run_id: "4242", run_attempt: "1", result: good, error_code: null }, { endpoint: "/api/ux1/jobs/result", cookie: "", origin: "", authorization: bearer });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.duplicate, false);
  assert.equal(accepted.text.includes("wealth_reference"), false);
  const replay = await call({ request_id: requestId, run_id: "4242", run_attempt: "1", result: good, error_code: null }, { endpoint: "/api/ux1/jobs/result", cookie: "", origin: "", authorization: bearer });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  const conflict = calculatorResult(claimed.body.request);
  conflict.source_assurance = "synthetic_test_only_v2";
  const conflicted = await call({ request_id: requestId, run_id: "4242", run_attempt: "1", result: conflict, error_code: null }, { endpoint: "/api/ux1/jobs/result", cookie: "", origin: "", authorization: bearer });
  assert.equal(conflicted.status, 409);
  assert.equal(conflicted.body.error, "ux1_result_conflict");
  const shown = await call();
  assert.equal(shown.body.preview.status, "computed");
  assert.equal(shown.body.preview.decision_preview.decision_date, "2023-03-29");
  assert.equal(shown.body.preview.no_order, true);
  assert.equal(shown.body.job.status, "succeeded");
  assert.equal(shown.body.job.request_id, requestId);
  const reused = await call({ expected_revision: shown.body.revision }, { endpoint: "/api/ux1/preview" });
  assert.equal(reused.body.job.request_id, requestId);
  assert.equal(dispatchPosts().length, 1);
  await mf.dispose();

  start({ ...asyncEnv, UX1_RUNTIME_EPOCH: nextEpoch, UX1_EXPECTED_EVIDENCE_HASHES: JSON.stringify(otherHashes) });
  const restarted = await call();
  assert.equal(restarted.body.job.request_id, requestId);
  assert.equal(restarted.body.job.status, "superseded");
  assert.equal(restarted.body.preview.status, "stale");
  assert.equal(restarted.body.preview.decision_preview.decision_date, "2023-03-29");
  assert.notEqual(restarted.body.preview.status, "computed");
  const staleIntent = await call({ expected_revision: restarted.body.revision, fingerprint: restarted.body.fingerprint }, { endpoint: "/api/ux1/intent" });
  assert.equal(staleIntent.status, 409);
  assert.equal(staleIntent.body.error, "ux1_preview_stale");
  const postsBeforeNext = dispatchPosts().length;
  const nextPreview = await call({ expected_revision: restarted.body.revision }, { endpoint: "/api/ux1/preview" });
  assert.equal(nextPreview.status, 200);
  assert.notEqual(nextPreview.body.job.request_id, requestId);
  assert.equal(nextPreview.body.job.status, "queued");
  assert.equal(dispatchPosts().length, postsBeforeNext + 1);
  const nextId = nextPreview.body.job.request_id;
  github.run = validRun(nextId, "5252", "1", ues);
  const nextClaim = await call({ request_id: nextId, run_id: "5252", run_attempt: "1" }, { endpoint: "/api/ux1/jobs/claim", cookie: "", origin: "", authorization: bearer });
  assert.equal(nextClaim.body.claimed, true);
  const oldHashResult = await call({ request_id: nextId, run_id: "5252", run_attempt: "1", result: calculatorResult(nextClaim.body.request, hashes), error_code: null }, { endpoint: "/api/ux1/jobs/result", cookie: "", origin: "", authorization: bearer });
  assert.equal(oldHashResult.status, 502);
  const boundResult = await call({ request_id: nextId, run_id: "5252", run_attempt: "1", result: calculatorResult(nextClaim.body.request, otherHashes), error_code: null }, { endpoint: "/api/ux1/jobs/result", cookie: "", origin: "", authorization: bearer });
  assert.equal(boundResult.status, 200);
  const current = await call();
  assert.equal(current.body.preview.status, "computed");
  assert.equal(current.body.job.status, "succeeded");
  const moved = await call(draftBody(current.body.revision, { advanced_settings: { plugin_mode: "none" } }));
  assert.equal(moved.body.draft.advanced_settings.plugin_mode, "none");
  assert.equal(moved.body.preview, null);
  assert.equal(moved.body.job.request_id, nextId);
  const restored = await call(draftBody(moved.body.revision));
  const third = await call({ expected_revision: restored.body.revision }, { endpoint: "/api/ux1/preview" });
  const thirdId = third.body.job.request_id;
  assert.notEqual(thirdId, nextId);
  github.run = validRun(thirdId, "6262");
  const thirdClaim = await call({ request_id: thirdId, run_id: "6262", run_attempt: "1" }, { endpoint: "/api/ux1/jobs/claim", cookie: "", origin: "", authorization: bearer });
  assert.equal(thirdClaim.body.claimed, true);
  const edited = await call(draftBody(restored.body.revision, { advanced_settings: { plugin_mode: "none" } }));
  const late = await call({ request_id: thirdId, run_id: "6262", run_attempt: "1", result: calculatorResult(thirdClaim.body.request, otherHashes), error_code: null }, { endpoint: "/api/ux1/jobs/result", cookie: "", origin: "", authorization: bearer });
  assert.equal(late.status, 200);
  const afterLate = await call();
  assert.equal(afterLate.body.revision, edited.body.revision);
  assert.equal(afterLate.body.draft.advanced_settings.plugin_mode, "none");
  assert.equal(afterLate.body.preview, null);
  assert.equal(afterLate.body.job.status, "superseded");
  const failedDraft = await call(draftBody(afterLate.body.revision));
  const failedJob = await call({ expected_revision: failedDraft.body.revision }, { endpoint: "/api/ux1/preview" });
  const failedId = failedJob.body.job.request_id;
  github.run = validRun(failedId, "7272");
  const failedClaim = await call({ request_id: failedId, run_id: "7272", run_attempt: "1" }, { endpoint: "/api/ux1/jobs/claim", cookie: "", origin: "", authorization: bearer });
  assert.equal(failedClaim.body.claimed, true);
  const failed = await call({ request_id: failedId, run_id: "7272", run_attempt: "1", result: null, error_code: "input_unavailable" }, { endpoint: "/api/ux1/jobs/result", cookie: "", origin: "", authorization: bearer });
  assert.equal(failed.status, 200);
  const afterFailure = await call();
  assert.equal(afterFailure.body.revision, failedDraft.body.revision);
  assert.equal(afterFailure.body.draft.objective, failedDraft.body.draft.objective);
  assert.equal(afterFailure.body.preview, null);
  assert.equal(afterFailure.body.job.status, "failed");
  assert.equal(afterFailure.body.job.reason, "input_unavailable");
  const postsBeforeRetry = dispatchPosts().length;
  const retried = await call({ expected_revision: afterFailure.body.revision }, { endpoint: "/api/ux1/preview" });
  assert.notEqual(retried.body.job.request_id, failedId);
  assert.equal(dispatchPosts().length, postsBeforeRetry + 1);

  github.mode = "unknown";
  const postsBeforeUnknown = dispatchPosts().length;
  const otherSaved = await call(draftBody(0), { cookie: otherCookie });
  const unknownJob = await call({ expected_revision: otherSaved.body.revision }, { endpoint: "/api/ux1/preview", cookie: otherCookie });
  assert.equal(unknownJob.status, 200);
  assert.equal(unknownJob.body.job.status, "unknown");
  assert.equal(unknownJob.body.job.reason, "dispatch_unconfirmed");
  assert.equal(unknownJob.body.research_workflow_dispatched, false);
  assert.equal(unknownJob.body.preview, null);
  assertNoSecrets(unknownJob.text);
  const unknownRepeat = await call({ expected_revision: otherSaved.body.revision }, { endpoint: "/api/ux1/preview", cookie: otherCookie });
  assert.equal(unknownRepeat.body.job.request_id, unknownJob.body.job.request_id);
  assert.equal(dispatchPosts().length, postsBeforeUnknown + 1);
  github.mode = "ok";
  github.run = validRun(unknownJob.body.job.request_id, "8282");
  const lateClaim = await call({ request_id: unknownJob.body.job.request_id, run_id: "8282", run_attempt: "1" }, { endpoint: "/api/ux1/jobs/claim", cookie: "", origin: "", authorization: bearer });
  assert.equal(lateClaim.body.claimed, true);
  const lateFailure = await call({ request_id: unknownJob.body.job.request_id, run_id: "8282", run_attempt: "1", result: null, error_code: "calculator_failed" }, { endpoint: "/api/ux1/jobs/result", cookie: "", origin: "", authorization: bearer });
  assert.equal(lateFailure.status, 200);
  github.mode = "reject";
  const rejected = await call({ expected_revision: otherSaved.body.revision }, { endpoint: "/api/ux1/preview", cookie: otherCookie });
  assert.equal(rejected.body.job.status, "failed");
  assert.equal(rejected.body.job.reason, "dispatch_rejected");
  assertNoSecrets(rejected.text);
  github.mode = "redirect";
  const redirected = await call({ expected_revision: otherSaved.body.revision }, { endpoint: "/api/ux1/preview", cookie: otherCookie });
  assert.equal(redirected.body.job.status, "unknown");
  assertNoSecrets(redirected.text);
  const redirectRepeat = await call({ expected_revision: otherSaved.body.revision }, { endpoint: "/api/ux1/preview", cookie: otherCookie });
  assert.equal(redirectRepeat.body.job.request_id, redirected.body.job.request_id);

  github.mode = "ok";
  const uesJobId = retried.body.job.request_id;
  github.run = validRun(uesJobId, "9292", "1", ues);
  const uesClaim = await call({ request_id: uesJobId, run_id: "9292", run_attempt: "1" }, { endpoint: "/api/ux1/jobs/claim", cookie: "", origin: "", authorization: bearer });
  assert.equal(uesClaim.body.claimed, true);
  const beforeUesChange = await call();
  await mf.dispose();
  start({
    ...asyncEnv,
    UX1_RUNTIME_EPOCH: nextEpoch,
    UX1_EXPECTED_EVIDENCE_HASHES: JSON.stringify(otherHashes),
    UX1_UES_REVISION: nextUes,
  });
  const postsAtUesChange = dispatchPosts().length;
  const lateUes = await call({
    request_id: uesJobId,
    run_id: "9292",
    run_attempt: "1",
    result: calculatorResult(uesClaim.body.request, otherHashes),
    error_code: null,
  }, { endpoint: "/api/ux1/jobs/result", cookie: "", origin: "", authorization: bearer });
  assert.equal(lateUes.status, 200);
  const afterUesChange = await call();
  assert.equal(afterUesChange.body.revision, beforeUesChange.body.revision);
  assert.equal(afterUesChange.body.fingerprint, beforeUesChange.body.fingerprint);
  assert.equal(afterUesChange.body.preview, null);
  assert.equal(afterUesChange.body.job.status, "superseded");
  assert.equal(afterUesChange.body.job.request_id, uesJobId);
  const uesIntent = await call({
    expected_revision: afterUesChange.body.revision,
    fingerprint: afterUesChange.body.fingerprint,
  }, { endpoint: "/api/ux1/intent" });
  assert.equal(uesIntent.status, 409);
  assert.equal(dispatchPosts().length, postsAtUesChange);

  assert.equal(calculatorCalls, 0);
  assert.equal(githubCalls.every((callInfo) => callInfo.url.startsWith(`https://api.github.com/repos/${repository}/actions/`)), true);
  assert.equal(githubCalls.some((callInfo) => callInfo.url.includes("manual-strategy-switch") || callInfo.url.includes("/orders")), false);
  console.log("ux1 async worker validation: PASS");
} finally {
  await mf?.dispose();
  await rm(persist, { recursive: true, force: true });
}
