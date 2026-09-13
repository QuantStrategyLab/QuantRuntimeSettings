import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import worker, { __test } from "../web/strategy-switch-console/worker.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profiles = JSON.parse(readFileSync(resolve(root, "web/strategy-switch-console/strategy-profiles.example.json"), "utf8"));
const v7 = profiles.find((item) => item.profile === "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve");
assert.ok(v7?.research_candidate_identity);

const paperAccount = {
  key: "paper",
  label: "LongBridge paper",
  target_name: "paper",
  runtime_status_target_id: "longbridge.paper",
  account_selector: "PAPER",
  deployment_selector: "paper",
  account_scope: "PAPER",
  service_name: "longbridge-quant-paper-service",
  supported_domains: ["us_equity"],
  broker_environment: "paper",
  default_execution_mode: "live",
  // The application records the selected account's existing default as a
  // guard; it does not silently treat that old strategy as the V7 candidate.
  default_strategy_profile: "russell_top50_leader_rotation",
};
const accountOptions = { longbridge: [paperAccount] };
const bindings = {
  SESSION_SECRET: "application-fixture-session",
  ALLOWED_GITHUB_LOGINS: "application-admin",
  STRATEGY_SWITCH_ADMIN_LOGINS: "application-admin",
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify(accountOptions),
  STRATEGY_SWITCH_STRATEGY_PROFILES_JSON: JSON.stringify(profiles),
  RUNTIME_SETTINGS_DISPATCH_TOKEN: "application-dispatch-token",
  EXECUTION_EVIDENCE_SYNC_TOKEN: "application-execution-evidence-token",
  RESEARCH_PROMOTION_SYNC_TOKEN: "application-research-sync-token",
};
const adminCookie = `qsl_switch_session=${await __test.makeSession("application-admin", [], bindings)}`;
const persist = await mkdtemp(join(tmpdir(), "qrt-paper-application-"));
const dispatches = [];
let failDispatch = false;
const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08",
  bindings,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  durableObjectsPersist: persist,
  kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: async (request) => {
    dispatches.push({ url: request.url, body: await request.text() });
    if (failDispatch) return new Response(null, { status: 503 });
    return new Response(null, { status: 204 });
  },
});

async function call(endpoint, { method = "GET", body, cookie = adminCookie, origin = "https://switch.example", headers = {} } = {}) {
  const response = await mf.dispatchFetch(`https://switch.example${endpoint}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* no body */ }
  return { status: response.status, body: payload };
}

const producerNotes = [
  "frozen_v7_forward_financial_gates_passed_research_only",
  "forward_record_sha256=" + "a".repeat(64),
  "financial_evidence_sha256=" + "b".repeat(64),
  "p1_manifest_sha256=" + "c".repeat(64),
  "p4_policy_sha256=" + "d".repeat(64),
  "baseline_p3_evidence_sha256=" + "e".repeat(64),
];
function ticket(ticketId, overrides = {}) {
  return {
    ticket_id: ticketId,
    strategy_profile: v7.profile,
    domain: "us_equity",
    state: "awaiting_human",
    drift_status: "not_applicable",
    drift_score: 0,
    created_at: "2026-09-13T00:00:00Z",
    updated_at: "2026-09-13T00:00:00Z",
    budget: {},
    proposed_params: { ...v7.research_candidate_identity },
    search_iterations: 0,
    shadow_evidence_kind: "v7_nonlive_shadow_and_simulated_paper",
    shadow_passed: true,
    notification_subject: "V7",
    notification_body: "V7 producer fixture",
    human_decision: "",
    human_decided_at: "",
    live_authority_granted: false,
    suggested_risk_profile: "CAPITAL_PRESERVATION",
    confirmation_target_platform: "",
    confirmation_execution_mode: "",
    confirmation_risk_profile: "",
    notes: [...producerNotes],
    ...overrides,
  };
}
async function syncTicket(value) {
  return call("/api/internal/sync-research-promotion-ticket", {
    method: "POST", cookie: "", origin: "",
    headers: { Authorization: "Bearer application-research-sync-token" }, body: value,
  });
}
async function acceptTicket(ticketId, params = { ...v7.research_candidate_identity }) {
  return call("/api/research-promotion-decisions", {
    method: "POST",
    body: {
      ticket_id: ticketId,
      decision: "accept",
      expected_proposed_params: params,
      confirmation: { target_platform: "longbridge", execution_mode: "paper", risk_profile: "CAPITAL_PRESERVATION" },
      selected_account: { platform: "longbridge", key: "paper" },
    },
  });
}

try {
  const initialized = await call("/api/admin/runtime-instances", {
    method: "POST",
    body: { action: "initialize", expected_revision: 0, confirm: "IMPORT_EXISTING_CONFIG" },
  });
  assert.equal(initialized.status, 200);
  assert.equal(initialized.body.revision, 1);

  const firstTicket = ticket(`rpt_${"1".repeat(64)}`);
  assert.equal((await syncTicket(firstTicket)).status, 200);
  assert.equal((await acceptTicket(firstTicket.ticket_id)).status, 200);

  const stateBeforeApplication = await call("/api/admin/runtime-instances");
  assert.equal(stateBeforeApplication.body.revision, 1);
  const firstApplicationBody = {
    ticket_id: firstTicket.ticket_id,
    selected_account: { platform: "longbridge", key: "paper" },
    expected_revision: stateBeforeApplication.body.revision,
  };
  const concurrent = await Promise.all([
    call("/api/research-promotion-applications", { method: "POST", body: firstApplicationBody }),
    call("/api/research-promotion-applications", { method: "POST", body: firstApplicationBody }),
  ]);
  assert.equal(concurrent.filter((item) => item.status === 202).length, 1);
  assert.equal(concurrent.filter((item) => item.body?.deduplicated === true).length, 1);
  assert.equal(dispatches.length, 1);
  assert.match(dispatches[0].url, /LongBridgePlatform\/actions\/workflows\/apply-paper-candidate\.yml\/dispatches$/);
  const dispatchBody = JSON.parse(dispatches[0].body);
  assert.deepEqual(Object.keys(dispatchBody), ["ref", "inputs"]);
  assert.deepEqual(Object.keys(dispatchBody.inputs), ["application_id"]);
  const applicationId = concurrent.find((item) => item.status === 202).body.application.application_id;
  const internal = await call(`/api/internal/research-promotion-application/${applicationId}`, {
    cookie: "", origin: "", headers: { Authorization: "Bearer application-execution-evidence-token" },
  });
  assert.equal(internal.status, 200);
  await writeFile("/tmp/qsl-v7-paper-application-fixture.json", JSON.stringify({ fixture: "synthetic", ...internal.body }, null, 2));
  assert.deepEqual({
    platform_id: internal.body.application.platform_id,
    account_key: internal.body.application.account_key,
    account_scope: internal.body.application.account_scope,
    account_selector: internal.body.application.account_selector,
    service_name: internal.body.application.service_name,
    broker_environment: internal.body.application.broker_environment,
    desired_state: internal.body.application.desired_state,
  }, {
    platform_id: "longbridge", account_key: "paper", account_scope: "PAPER", account_selector: "PAPER",
    service_name: "longbridge-quant-paper-service", broker_environment: "paper", desired_state: "paused",
  });
  const claimToken = internal.body.application.claim.token;
  const claim = await call(`/api/internal/research-promotion-application/${applicationId}`, {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer application-execution-evidence-token" },
    body: { application_id: applicationId, claim: { token: claimToken, workflow_run_id: "701", workflow_run_attempt: "1" }, status: "claimed" },
  });
  assert.deepEqual(claim.body, { ok: true, claimed: true, reason: "" });
  const duplicateClaim = await call(`/api/internal/research-promotion-application/${applicationId}`, {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer application-execution-evidence-token" },
    body: { application_id: applicationId, claim: { token: claimToken, workflow_run_id: "701", workflow_run_attempt: "1" }, status: "claimed" },
  });
  assert.equal(duplicateClaim.body.claimed, false);
  const readback = {
    application_id: applicationId,
    platform_id: "longbridge",
    account_scope: "PAPER",
    service_name: "longbridge-quant-paper-service",
    strategy_profile: v7.profile,
    candidate_id: v7.research_candidate_identity.candidate_id,
    config_sha256: v7.research_candidate_identity.config_sha256,
    source_commit: "9c72bee16d63f68f4e2397042380e6ef5d880c27",
    ues_revision: "d1ca798d880cd83965f3da5081850ca48a616d19",
    runtime_target_enabled: false,
    revision_name: "longbridge-paper-v7-paused-701",
  };
  const applied = await call(`/api/internal/research-promotion-application/${applicationId}`, {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer application-execution-evidence-token" },
    body: { application_id: applicationId, claim: { token: claimToken, workflow_run_id: "701", workflow_run_attempt: "1" }, status: "applied_paused", readback },
  });
  assert.deepEqual(applied.body, { ok: true, replayed: false, status: "applied_paused" });
  const publicRead = await call(`/api/research-promotion-applications?ticket_id=${firstTicket.ticket_id}`);
  assert.equal(publicRead.body.application.claim_token, undefined);
  assert.equal(publicRead.body.application.status, "applied_paused");
  const appliedState = await call("/api/admin/runtime-instances");
  assert.equal(appliedState.body.revision, 2, "applied paused updates the bound account atomically");
  assert.equal(appliedState.body.instances[0].config.default_strategy_profile, v7.profile);
  assert.equal(appliedState.body.instances[0].enabled, false);
  assert.equal(appliedState.body.instances[0].platform_applied, true);
  assert.equal(appliedState.body.instances[0].application_status, "applied_paused");
  assert.equal(appliedState.body.account_options.longbridge[0].default_strategy_profile, v7.profile, "DO-backed account options expose the applied research-only profile");
  assert.equal(appliedState.body.account_options.longbridge[0].runtime_status_target_id, "longbridge.paper");

  const wrongAccount = await call("/api/research-promotion-applications", {
    method: "POST", body: { ...firstApplicationBody, selected_account: { platform: "ibkr", key: "paper" } },
  });
  assert.equal(wrongAccount.status, 409);
  const staleTicket = ticket(`rpt_${"2".repeat(64)}`);
  assert.equal((await syncTicket(staleTicket)).status, 200);
  assert.equal((await acceptTicket(staleTicket.ticket_id)).status, 200);
  const staleRevision = await call("/api/research-promotion-applications", {
    method: "POST", body: { ...firstApplicationBody, ticket_id: staleTicket.ticket_id, expected_revision: 0 },
  });
  assert.equal(staleRevision.status, 409);

  const malformedEvidence = ticket(`rpt_${"3".repeat(64)}`, { shadow_passed: "true" });
  assert.equal((await syncTicket(malformedEvidence)).status, 200);
  assert.equal((await acceptTicket(malformedEvidence.ticket_id)).status, 200);
  const malformedResult = await call("/api/research-promotion-applications", {
    method: "POST", body: { ...firstApplicationBody, ticket_id: malformedEvidence.ticket_id },
  });
  assert.equal(malformedResult.status, 409);
  assert.match(malformedResult.body.error, /evidence|qualified/);

  const unknownDispatchTicket = ticket(`rpt_${"5".repeat(64)}`);
  assert.equal((await syncTicket(unknownDispatchTicket)).status, 200);
  assert.equal((await acceptTicket(unknownDispatchTicket.ticket_id)).status, 200);
  const currentStateBeforeUnknown = await call("/api/admin/runtime-instances");
  failDispatch = true;
  const unknownDispatch = await call("/api/research-promotion-applications", {
    method: "POST",
    body: { ...firstApplicationBody, ticket_id: unknownDispatchTicket.ticket_id, expected_revision: currentStateBeforeUnknown.body.revision },
  });
  failDispatch = false;
  assert.equal(unknownDispatch.status, 502);
  assert.equal(unknownDispatch.body.application.dispatch_state, "unknown");
  const dispatchCountAfterUnknown = dispatches.length;
  const noRetry = await call("/api/research-promotion-applications", {
    method: "POST",
    body: { ...firstApplicationBody, ticket_id: unknownDispatchTicket.ticket_id, expected_revision: currentStateBeforeUnknown.body.revision },
  });
  assert.equal(noRetry.body.deduplicated, true);
  assert.equal(dispatches.length, dispatchCountAfterUnknown, "unknown dispatch is not retried");

  const mismatchTicket = ticket(`rpt_${"4".repeat(64)}`);
  assert.equal((await syncTicket(mismatchTicket)).status, 200);
  assert.equal((await acceptTicket(mismatchTicket.ticket_id)).status, 200);
  const mismatchCreate = await call("/api/research-promotion-applications", { method: "POST", body: { ...firstApplicationBody, ticket_id: mismatchTicket.ticket_id, expected_revision: appliedState.body.revision } });
  assert.equal(mismatchCreate.status, 202);
  const mismatchId = mismatchCreate.body.application.application_id;
  const mismatchInternal = await call(`/api/internal/research-promotion-application/${mismatchId}`, { cookie: "", origin: "", headers: { Authorization: "Bearer application-execution-evidence-token" } });
  const mismatchToken = mismatchInternal.body.application.claim.token;
  assert.equal((await call(`/api/internal/research-promotion-application/${mismatchId}`, { method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer application-execution-evidence-token" }, body: { application_id: mismatchId, claim: { token: mismatchToken, workflow_run_id: "702", workflow_run_attempt: "1" }, status: "claimed" } })).body.claimed, true);
  const mismatchReadback = { ...readback, application_id: mismatchId, config_sha256: "f".repeat(64) };
  const mismatchResult = await call(`/api/internal/research-promotion-application/${mismatchId}`, { method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer application-execution-evidence-token" }, body: { application_id: mismatchId, claim: { token: mismatchToken, workflow_run_id: "702", workflow_run_attempt: "1" }, status: "applied_paused", readback: mismatchReadback } });
  assert.deepEqual(mismatchResult.body, { ok: true, replayed: false, status: "uncertain" });
  const mismatchPublic = await call(`/api/research-promotion-applications?ticket_id=${mismatchTicket.ticket_id}`);
  assert.equal(mismatchPublic.body.application.status, "uncertain");
  assert.equal(dispatches.length, 3, "unknown/readback mismatch does not redispatch");

  const conflictTicket = ticket(`rpt_${"6".repeat(64)}`);
  assert.equal((await syncTicket(conflictTicket)).status, 200);
  assert.equal((await acceptTicket(conflictTicket.ticket_id)).status, 200);
  const conflictBefore = await call("/api/admin/runtime-instances");
  const conflictCreate = await call("/api/research-promotion-applications", {
    method: "POST",
    body: { ...firstApplicationBody, ticket_id: conflictTicket.ticket_id, expected_revision: conflictBefore.body.revision },
  });
  assert.equal(conflictCreate.status, 202);
  const conflictId = conflictCreate.body.application.application_id;
  const conflictInternal = await call(`/api/internal/research-promotion-application/${conflictId}`, { cookie: "", origin: "", headers: { Authorization: "Bearer application-execution-evidence-token" } });
  const conflictToken = conflictInternal.body.application.claim.token;
  assert.equal((await call(`/api/internal/research-promotion-application/${conflictId}`, { method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer application-execution-evidence-token" }, body: { application_id: conflictId, claim: { token: conflictToken, workflow_run_id: "703", workflow_run_attempt: "1" }, status: "claimed" } })).body.claimed, true);
  const changedEnvironment = await call("/api/admin/runtime-instances", {
    method: "POST",
    body: { action: "set_broker_environment", expected_revision: conflictBefore.body.revision, platform: "longbridge", key: "paper", broker_environment: "live" },
  });
  assert.equal(changedEnvironment.status, 200);
  const conflictReadback = { ...readback, application_id: conflictId };
  const conflictResult = await call(`/api/internal/research-promotion-application/${conflictId}`, { method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer application-execution-evidence-token" }, body: { application_id: conflictId, claim: { token: conflictToken, workflow_run_id: "703", workflow_run_attempt: "1" }, status: "applied_paused", readback: conflictReadback } });
  assert.deepEqual(conflictResult.body, { ok: true, replayed: false, status: "uncertain" });
  const restoredEnvironment = await call("/api/admin/runtime-instances", {
    method: "POST",
    body: { action: "set_broker_environment", expected_revision: changedEnvironment.body.revision, platform: "longbridge", key: "paper", broker_environment: "paper" },
  });
  assert.equal(restoredEnvironment.status, 200);
  assert.equal(restoredEnvironment.body.instances[0].config.default_strategy_profile, v7.profile, "revision conflict does not overwrite the applied strategy");
  assert.equal(restoredEnvironment.body.instances[0].enabled, false, "revision conflict keeps the paused state");

  const badToken = await call(`/api/internal/research-promotion-application/${applicationId}`, { cookie: "", origin: "", headers: { Authorization: "Bearer wrong" } });
  assert.equal(badToken.status, 401);
  console.log("research promotion application validation passed");
} finally {
  await mf.dispose();
}
