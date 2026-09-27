import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
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
  key: "paper", label: "LongBridge paper", target_name: "paper", runtime_status_target_id: "longbridge.paper",
  account_selector: "PAPER", deployment_selector: "paper", account_scope: "PAPER", service_name: "longbridge-quant-paper-service",
  supported_domains: ["us_equity"], broker_environment: "paper", default_execution_mode: "live",
  default_strategy_profile: "russell_top50_leader_rotation",
};
const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const bindings = {
  SESSION_SECRET: "human-decision-fixture-session",
  ALLOWED_GITHUB_LOGINS: "decision-admin,decision-reader",
  STRATEGY_SWITCH_ADMIN_LOGINS: "decision-admin",
  CONTROL_PLANE_SYNC_TOKEN: "human-decision-control-token",
  RECONCILIATION_RECOVERY_SYNC_TOKEN: "human-decision-recovery-sync",
  RECONCILIATION_RECOVERY_CONTROLLER_TOKEN: "human-decision-recovery-controller",
  RESEARCH_PROMOTION_SYNC_TOKEN: "human-decision-promotion-sync",
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ longbridge: [paperAccount] }),
  STRATEGY_SWITCH_STRATEGY_PROFILES_JSON: JSON.stringify(profiles),
  RUNTIME_SETTINGS_DISPATCH_TOKEN: "human-decision-dispatch-token",
};
const adminCookie = `qsl_switch_session=${await __test.makeSession("decision-admin", [], bindings)}`;
const readerCookie = `qsl_switch_session=${await __test.makeSession("decision-reader", [], bindings)}`;
const persist = await mkdtemp(join(tmpdir(), "qrt-human-decisions-"));
let outbound = 0;
const options = {
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08",
  bindings,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  durableObjectsPersist: persist,
  kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: () => { outbound += 1; return new Response("offline only", { status: 503 }); },
};
let mf = new Miniflare(options);
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
  const text = await response.text();
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  return { status: response.status, body: payload, text };
}
function ownerSnapshot(candidateId, digest = "1".repeat(64)) {
  return {
    schema_version: "qsl_control_plane_dashboard.v1",
    generated_at: now, computed_at: now, data_status: "ready",
    summary: { candidate_count: 1, deferred: 0, parked: 0, owner_decision_required: 1 },
    candidates: [{
      candidate_id: candidateId, candidate_kind: "individual", domain: "us_equity",
      lifecycle: { stage: "P6", status: "owner_decision_required" },
      evidence: { p1_input_digest: digest, p2_config_digest: "2".repeat(64), p3_evidence_id: "3".repeat(64), source_revision: "4".repeat(40) },
      recommendation: { code: "owner_live_decision", reason: "owner decision required" },
      freshness: { status: "fresh", age_seconds: 0 },
    }],
    policy: { p4_p5_automation: "not_configured", p6_owner_decision_required: true, notice: "live remains owner-decided" },
    errors: [],
  };
}
function recoverySource(recoveryId, digest = "a".repeat(64)) {
  return {
    schema_version: "qsl_reconciliation_recovery_source_snapshot.v1",
    source_id: "fixture.recovery", generated_at: now, computed_at: now, data_status: "ready",
    recoveries: [{
      recovery_id: recoveryId, platform: "ibkr", strategy_profile: "soxl_soxx_trend_income", environment: "live",
      reconciliation_state: "RECONCILE_ONLY", readiness: "awaiting_human_confirmation",
      candidate_sha256: digest, evidence_sample_count: 1, first_observed_at: now, last_observed_at: now,
      dual_review: { outcome: "unavailable", reviewer_count: 0, evidence_binding_sha256: digest },
      blocker_codes: [],
    }],
    errors: [],
  };
}
const producerNotes = [
  "frozen_v7_forward_financial_gates_passed_research_only",
  `forward_record_sha256=${"a".repeat(64)}`, `financial_evidence_sha256=${"b".repeat(64)}`,
  `p1_manifest_sha256=${"c".repeat(64)}`, `p4_policy_sha256=${"d".repeat(64)}`, `baseline_p3_evidence_sha256=${"e".repeat(64)}`,
];
function promotionTicket(ticketId, params = { ...v7.research_candidate_identity }) {
  return {
    ticket_id: ticketId, strategy_profile: v7.profile, domain: "us_equity", state: "awaiting_human",
    drift_status: "not_applicable", drift_score: 0, created_at: "2026-09-13T00:00:00Z", updated_at: "2026-09-13T00:00:00Z",
    budget: {}, proposed_params: params, search_iterations: 0, shadow_evidence_kind: "v7_nonlive_shadow_and_simulated_paper",
    shadow_passed: true, notification_subject: "V7", notification_body: "fixture", human_decision: "", human_decided_at: "",
    live_authority_granted: false, suggested_risk_profile: "CAPITAL_PRESERVATION", confirmation_target_platform: "",
    confirmation_execution_mode: "", confirmation_risk_profile: "", notes: [...producerNotes],
  };
}
const syncControl = (body) => call("/api/internal/sync-control-plane", { method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer human-decision-control-token" }, body });
const syncRecovery = (body) => call("/api/internal/sync-reconciliation-recovery-source", { method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer human-decision-recovery-sync" }, body });
const syncPromotion = (body) => call("/api/internal/sync-research-promotion-ticket", { method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer human-decision-promotion-sync" }, body });
function openLatch() {
  let releaseGate = () => {};
  let markEntered = () => {};
  const entered = new Promise((resolve) => { markEntered = resolve; });
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  let seen = false;
  return {
    entered,
    async hold() {
      if (!seen) {
        seen = true;
        markEntered();
      }
      await gate;
    },
    release() { releaseGate(); },
  };
}
function waitFor(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 5000); }),
  ]).finally(() => clearTimeout(timer));
}
function wrapNamespace(namespace, action, latch) {
  return {
    idFromName: (name) => namespace.idFromName(name),
    get(id) {
      const stub = namespace.get(id);
      return {
        async fetch(input, init) {
          let command = null;
          if (typeof init?.body === "string") {
            try { command = JSON.parse(init.body); } catch { command = null; }
          }
          if (command?.action === action) await latch.hold();
          return stub.fetch(input, init);
        },
      };
    },
  };
}

try {
  const missingStore = new Map();
  const missingKv = { async get(key) { return missingStore.get(key) || null; }, async put(key, value) { missingStore.set(key, value); }, async list() { return { keys: [] }; } };
  const missingEnv = { ...bindings, STRATEGY_SWITCH_CONFIG: missingKv };
  const missingSync = await worker.fetch(new Request("https://switch.example/api/internal/sync-control-plane", {
    method: "POST", headers: { Authorization: "Bearer human-decision-control-token", "Content-Type": "application/json" },
    body: JSON.stringify(ownerSnapshot("missing-do-candidate")),
  }), missingEnv);
  assert.equal(missingSync.status, 503);
  assert.equal(missingStore.has("control_plane_snapshot"), false);

  assert.equal((await syncControl(ownerSnapshot("owner-race"))).status, 200);
  const queued = await call("/api/owner-decisions");
  assert.equal(queued.body.candidates[0].intent, null);
  const evidence = queued.body.candidates[0].candidate_evidence_sha256;
  const keep = { candidate_id: "owner-race", decision: "keep_parked", candidate_evidence_sha256: evidence, request_id: "owner-race-1" };
  const approve = { ...keep, decision: "approve_limited_live_canary" };
  const raced = await Promise.all([call("/api/owner-decisions", { method: "POST", body: keep }), call("/api/owner-decisions", { method: "POST", body: approve })]);
  assert.deepEqual(raced.map((item) => item.status).sort(), [200, 409]);
  const winner = raced.find((item) => item.status === 200).body.intent;
  assert.equal(winner.no_order, true);
  assert.equal(winner.execution_authority_granted, false);
  const replay = await call("/api/owner-decisions", { method: "POST", body: { ...keep, decision: winner.decision } });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.intent.decided_at, winner.decided_at);
  assert.equal(replay.body.intent.decided_by, winner.decided_by);
  const afterReplay = await call("/api/owner-decisions");
  assert.equal(afterReplay.body.candidates[0].intent.decision, winner.decision);
  assert.equal(afterReplay.body.candidates[0].intent.decided_at, winner.decided_at);

  assert.equal((await call("/api/owner-decisions", { method: "POST", cookie: readerCookie, body: keep })).status, 403);
  assert.equal((await call("/api/owner-decisions", { method: "POST", body: { ...keep, decision: "retire_candidate" } })).status, 409);

  assert.equal((await syncControl(ownerSnapshot("owner-race", "9".repeat(64)))).status, 200);
  const moved = await call("/api/owner-decisions", { method: "POST", body: keep });
  assert.equal(moved.status, 409);
  const rebound = await call("/api/owner-decisions");
  assert.equal(rebound.body.candidates[0].intent, null);
  assert.equal((await syncControl({ ...ownerSnapshot("owner-race"), candidates: [] , summary: { candidate_count: 0, deferred: 0, parked: 0, owner_decision_required: 0 } })).status, 200);
  assert.equal((await call("/api/owner-decisions", { method: "POST", body: { ...keep, candidate_evidence_sha256: "9".repeat(64) } })).status, 409);

  assert.equal((await syncControl(ownerSnapshot("owner-stable"))).status, 200);
  const stableQueue = await call("/api/owner-decisions");
  const stableEvidence = stableQueue.body.candidates.find((item) => item.candidate.candidate_id === "owner-stable").candidate_evidence_sha256;
  const stable = await call("/api/owner-decisions", { method: "POST", body: { candidate_id: "owner-stable", decision: "keep_parked", candidate_evidence_sha256: stableEvidence } });
  assert.equal(stable.status, 200);
  assert.equal((await syncControl(ownerSnapshot("owner-stable"))).status, 200);
  const stableAgain = await call("/api/owner-decisions");
  const stableIntent = stableAgain.body.candidates.find((item) => item.candidate.candidate_id === "owner-stable").intent;
  assert.equal(stableIntent.decision, "keep_parked");
  assert.equal(stableIntent.decided_at, stable.body.intent.decided_at);
  const stableDecidedAt = stable.body.intent.decided_at;

  assert.equal((await syncRecovery(recoverySource("recovery-reject"))).status, 200);
  const kv = await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG");
  await kv.put("reconciliation_recovery_current:recovery-reject", JSON.stringify({ marker: "OLD_KV_APPROVAL_MARKER", no_order: true, execution_authority_granted: false }));
  const rejected = await call("/api/reconciliation-recovery-confirmations", { method: "POST", body: { recovery_id: "recovery-reject", candidate_sha256: "a".repeat(64), dual_review_binding_sha256: "a".repeat(64), decision: "reject" } });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.confirmation, null);
  assert.equal(rejected.body.rejection.decision, "reject");
  assert.equal(rejected.body.rejection.no_order, true);
  const controller = await call("/api/internal/reconciliation-recovery-confirmation?recovery_id=recovery-reject", { cookie: "", origin: "", headers: { Authorization: "Bearer human-decision-recovery-controller" } });
  assert.equal(controller.status, 404);
  assert.equal(controller.text.includes("OLD_KV_APPROVAL_MARKER"), false);
  const dashboard = await call("/api/reconciliation-recovery");
  assert.equal(dashboard.text.includes("OLD_KV_APPROVAL_MARKER"), false);
  assert.equal(dashboard.body.recoveries[0].confirmation, null);
  assert.equal(dashboard.body.recoveries[0].rejection.decision, "reject");
  assert.equal(dashboard.body.summary.awaiting_human_confirmation, 0);

  const mirrorStore = new Map();
  const mirrorKv = {
    async get(key) { return mirrorStore.get(key) || null; },
    async put(key, value) { if (String(key).startsWith("owner_decision_")) throw new Error("mirror unavailable"); mirrorStore.set(key, value); },
    async list({ prefix = "" } = {}) { return { keys: [...mirrorStore.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })) }; },
  };
  const namespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const mirrorEnv = { ...bindings, STRATEGY_SWITCH_CONFIG: mirrorKv, STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace };
  const mirrorAdmin = { Cookie: adminCookie, Origin: "https://switch.example", "Content-Type": "application/json" };
  const mirrorSync = await worker.fetch(new Request("https://switch.example/api/internal/sync-control-plane", {
    method: "POST", headers: { Authorization: "Bearer human-decision-control-token", "Content-Type": "application/json" },
    body: JSON.stringify(ownerSnapshot("owner-mirror")),
  }), mirrorEnv);
  assert.equal(mirrorSync.status, 200);
  const mirrorQueue = await worker.fetch(new Request("https://switch.example/api/owner-decisions", { headers: { Cookie: adminCookie } }), mirrorEnv);
  const mirrorEvidence = (await mirrorQueue.json()).candidates.find((item) => item.candidate.candidate_id === "owner-mirror").candidate_evidence_sha256;
  const mirrorWrite = await worker.fetch(new Request("https://switch.example/api/owner-decisions", {
    method: "POST", headers: mirrorAdmin,
    body: JSON.stringify({ candidate_id: "owner-mirror", decision: "keep_parked", candidate_evidence_sha256: mirrorEvidence }),
  }), mirrorEnv);
  assert.equal(mirrorWrite.status, 200);
  assert.equal(mirrorStore.has("owner_decision_current:owner-mirror"), false);
  const mirrorRead = await worker.fetch(new Request("https://switch.example/api/owner-decisions", { headers: { Cookie: adminCookie } }), mirrorEnv);
  assert.equal((await mirrorRead.json()).candidates.find((item) => item.candidate.candidate_id === "owner-mirror").intent.decision, "keep_parked");

  const failingNamespace = { idFromName() { return "down"; }, get() { return { async fetch() { throw new Error("durable object down"); } }; } };
  const failingStore = new Map();
  const failingKv = { async get(key) { return failingStore.get(key) || null; }, async put(key, value) { failingStore.set(key, value); }, async list() { return { keys: [] }; } };
  const failingSync = await worker.fetch(new Request("https://switch.example/api/internal/sync-control-plane", {
    method: "POST", headers: { Authorization: "Bearer human-decision-control-token", "Content-Type": "application/json" },
    body: JSON.stringify(ownerSnapshot("owner-down")),
  }), { ...bindings, STRATEGY_SWITCH_CONFIG: failingKv, STRATEGY_SWITCH_RUNTIME_INSTANCES: failingNamespace });
  assert.equal(failingSync.status, 503);
  assert.equal([...failingStore.keys()].some((key) => key.startsWith("owner_decision_")), false);

  await mf.dispose();
  mf = new Miniflare(options);
  assert.equal((await syncControl(ownerSnapshot("owner-stable"))).status, 200);
  const restored = await call("/api/owner-decisions");
  const restoredIntent = restored.body.candidates.find((item) => item.candidate.candidate_id === "owner-stable").intent;
  assert.equal(restoredIntent.decision, "keep_parked");
  assert.equal(restoredIntent.decided_at, stableDecidedAt);

  const dualId = "owner-dual";
  assert.equal((await syncControl(ownerSnapshot(dualId))).status, 200);
  const dualPreflight = await call("/api/owner-decisions");
  const dualQueued = dualPreflight.body.candidates.find((item) => item.candidate.candidate_id === dualId);
  assert.equal(dualQueued.intent, null);
  const dualEvidence = dualQueued.candidate_evidence_sha256;
  const dualSource = await call("/api/internal/sync-control-plane-source", {
    method: "POST", cookie: "", origin: "",
    headers: { Authorization: "Bearer human-decision-control-token" },
    body: {
      schema_version: "qsl_control_plane_source_snapshot.v1",
      source_id: "uesp.owner_dual", generated_at: now, computed_at: now, data_status: "ready",
      candidates: ownerSnapshot(dualId).candidates, errors: [],
    },
  });
  assert.equal(dualSource.status, 200);
  const dualAfterSource = await call("/api/owner-decisions");
  const dualVisible = dualAfterSource.body.candidates.find((item) => item.candidate.candidate_id === dualId);
  assert.equal(dualVisible.candidate_evidence_sha256, dualEvidence);
  assert.equal(dualVisible.intent, null);
  const dualRejected = await call("/api/owner-decisions", { method: "POST", body: { candidate_id: dualId, decision: "keep_parked", candidate_evidence_sha256: dualEvidence } });
  assert.equal(dualRejected.status, 409);
  assert.equal((await call("/api/owner-decisions")).body.candidates.find((item) => item.candidate.candidate_id === dualId).intent, null);
  assert.equal((await syncControl({ ...ownerSnapshot(dualId), candidates: [], summary: { candidate_count: 0, deferred: 0, parked: 0, owner_decision_required: 0 } })).status, 200);
  const dualRemaining = await call("/api/owner-decisions");
  assert.equal(dualRemaining.body.candidates.find((item) => item.candidate.candidate_id === dualId).candidate_evidence_sha256, dualEvidence);
  const dualAccepted = await call("/api/owner-decisions", { method: "POST", body: { candidate_id: dualId, decision: "keep_parked", candidate_evidence_sha256: dualEvidence } });
  assert.equal(dualAccepted.status, 200);
  assert.equal(dualAccepted.body.intent.decision, "keep_parked");

  assert.equal((await call("/api/admin/runtime-instances", { method: "POST", body: { action: "initialize", expected_revision: 0, confirm: "IMPORT_EXISTING_CONFIG" } })).status, 200);
  const ticket = promotionTicket(`rpt_${"8".repeat(64)}`);
  assert.equal((await syncPromotion(ticket)).status, 200);
  const accepted = await call("/api/research-promotion-decisions", { method: "POST", body: {
    ticket_id: ticket.ticket_id, decision: "accept", expected_proposed_params: ticket.proposed_params,
    confirmation: { target_platform: "longbridge", execution_mode: "paper", risk_profile: "CAPITAL_PRESERVATION" },
    selected_account: { platform: "longbridge", key: "paper" },
  } });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.ticket.state, "human_accepted");
  assert.equal(accepted.body.live_authority_granted, false);
  const fetched = await call(`/api/internal/research-promotion-ticket?ticket_id=${ticket.ticket_id}`, { cookie: "", origin: "", headers: { Authorization: "Bearer human-decision-promotion-sync" } });
  assert.equal(fetched.body.ticket.state, "human_accepted");
  const listed = await call("/api/research-promotion-tickets");
  assert.equal(listed.body.applications.find((item) => item.ticket_id === ticket.ticket_id).state, "human_accepted");
  assert.equal((await syncPromotion(ticket)).status, 409);
  assert.equal((await call(`/api/internal/research-promotion-ticket?ticket_id=${ticket.ticket_id}`, { cookie: "", origin: "", headers: { Authorization: "Bearer human-decision-promotion-sync" } })).body.ticket.state, "human_accepted");
  const acceptBody = {
    ticket_id: ticket.ticket_id, decision: "accept", expected_proposed_params: ticket.proposed_params,
    confirmation: { target_platform: "longbridge", execution_mode: "paper", risk_profile: "CAPITAL_PRESERVATION" },
    selected_account: { platform: "longbridge", key: "paper" },
  };
  const replayedAccept = await call("/api/research-promotion-decisions", { method: "POST", body: acceptBody });
  assert.equal(replayedAccept.status, 200);
  assert.equal(replayedAccept.body.replayed, true);
  assert.equal(replayedAccept.body.actor, "decision-admin");
  assert.equal(replayedAccept.body.ticket.human_decided_at, accepted.body.ticket.human_decided_at);
  assert.equal((await call("/api/research-promotion-decisions", { method: "POST", body: { ...acceptBody, decision: "reject" } })).status, 409);
  assert.equal((await call("/api/research-promotion-decisions", { method: "POST", body: { ...acceptBody, selected_account: { platform: "longbridge", key: "other" } } })).status, 409);
  assert.equal((await call(`/api/internal/research-promotion-ticket?ticket_id=${ticket.ticket_id}`, { cookie: "", origin: "", headers: { Authorization: "Bearer human-decision-promotion-sync" } })).body.ticket.state, "human_accepted");

  const revisionTicket = promotionTicket(`rpt_${"6".repeat(64)}`);
  assert.equal((await syncPromotion(revisionTicket)).status, 200);
  const revisionBefore = await call("/api/admin/runtime-instances");
  const observedRevision = revisionBefore.body.revision;
  const draft = await call("/api/admin/runtime-instances", { method: "POST", body: {
    action: "create", expected_revision: observedRevision, platform: "longbridge",
    config: {
      key: "draft-revision", label: "Draft revision", target_name: "draft-revision",
      account_selector: "DRAFT-REVISION", deployment_selector: "draft-revision", account_scope: "draft",
      service_name: "draft-revision-service", supported_domains: ["us_equity"], broker_environment: "paper",
      default_execution_mode: "dry_run", default_strategy_profile: "russell_top50_leader_rotation",
    },
  } });
  assert.equal(draft.status, 200);
  assert.notEqual(draft.body.revision, observedRevision);
  const revisionAccept = {
    ticket_id: revisionTicket.ticket_id, decision: "accept", expected_proposed_params: revisionTicket.proposed_params,
    expected_account_revision: observedRevision,
    confirmation: { target_platform: "longbridge", execution_mode: "paper", risk_profile: "CAPITAL_PRESERVATION" },
    selected_account: { platform: "longbridge", key: "paper" },
  };
  assert.equal((await call("/api/research-promotion-decisions", { method: "POST", body: revisionAccept })).status, 409);
  assert.equal((await call(`/api/internal/research-promotion-ticket?ticket_id=${revisionTicket.ticket_id}`, { cookie: "", origin: "", headers: { Authorization: "Bearer human-decision-promotion-sync" } })).body.ticket.state, "awaiting_human");
  const revisionLive = await call("/api/research-promotion-decisions", { method: "POST", body: { ...revisionAccept, expected_account_revision: draft.body.revision } });
  assert.equal(revisionLive.status, 200);
  assert.equal(revisionLive.body.replayed, false);
  assert.equal(revisionLive.body.ticket.state, "human_accepted");

  const changedTicket = promotionTicket(`rpt_${"9".repeat(64)}`);
  assert.equal((await syncPromotion(changedTicket)).status, 200);
  const changedAccepted = await call("/api/research-promotion-decisions", { method: "POST", body: {
    ticket_id: changedTicket.ticket_id, decision: "accept", expected_proposed_params: changedTicket.proposed_params,
    confirmation: { target_platform: "longbridge", execution_mode: "paper", risk_profile: "CAPITAL_PRESERVATION" },
    selected_account: { platform: "longbridge", key: "paper" },
  } });
  assert.equal(changedAccepted.status, 200);
  const changedState = await call("/api/admin/runtime-instances");
  assert.equal((await syncPromotion({ ...changedTicket, shadow_passed: false })).status, 200);
  const changedBeforeOutbound = outbound;
  assert.equal((await call("/api/research-promotion-applications", { method: "POST", body: { ticket_id: changedTicket.ticket_id, selected_account: { platform: "longbridge", key: "paper" }, expected_revision: changedState.body.revision } })).status, 409);
  assert.equal(outbound, changedBeforeOutbound);
  assert.equal((await call(`/api/research-promotion-applications?ticket_id=${changedTicket.ticket_id}`)).body.application, null);
  const changedListed = await call("/api/research-promotion-tickets");
  assert.notEqual(changedListed.body.applications.find((item) => item.ticket_id === changedTicket.ticket_id)?.state, "human_accepted");

  const legacyId = `rpt_${"5".repeat(64)}`;
  const legacyTicket = {
    ...promotionTicket(legacyId), state: "human_accepted", human_decision: "accept", human_decided_at: "2026-09-13T00:00:00Z",
    confirmation_target_platform: "longbridge", confirmation_execution_mode: "paper", confirmation_risk_profile: "CAPITAL_PRESERVATION",
  };
  const legacyKv = await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG");
  await legacyKv.put(`research_promotion_ticket:${legacyId}`, JSON.stringify(legacyTicket));
  assert.equal((await syncPromotion(promotionTicket(legacyId))).status, 409);
  const legacyFetched = await call(`/api/internal/research-promotion-ticket?ticket_id=${legacyId}`, { cookie: "", origin: "", headers: { Authorization: "Bearer human-decision-promotion-sync" } });
  assert.equal(legacyFetched.body.ticket.state, "awaiting_human");
  assert.equal(legacyFetched.body.ticket.human_decision, "");
  const legacyListed = await call("/api/research-promotion-tickets");
  assert.notEqual(legacyListed.body.applications.find((item) => item.ticket_id === legacyId)?.state, "human_accepted");
  const legacyStored = JSON.parse(await legacyKv.get(`research_promotion_ticket:${legacyId}`));
  assert.equal(legacyStored.state, "human_accepted");

  assert.equal((await syncRecovery(recoverySource("recovery-withdraw"))).status, 200);
  const withdrawalApproved = await call("/api/reconciliation-recovery-confirmations", { method: "POST", body: { recovery_id: "recovery-withdraw", candidate_sha256: "a".repeat(64), dual_review_binding_sha256: "a".repeat(64), decision: "approve" } });
  assert.equal(withdrawalApproved.status, 200);
  assert.equal(withdrawalApproved.body.confirmation.no_order, true);
  const blockedRecovery = recoverySource("recovery-withdraw");
  blockedRecovery.recoveries[0].readiness = "blocked";
  blockedRecovery.recoveries[0].blocker_codes = ["account_unavailable"];
  assert.equal((await syncRecovery(blockedRecovery)).status, 200);
  assert.ok(await legacyKv.get("reconciliation_recovery_current:recovery-withdraw"));
  const withdrawalDashboard = await call("/api/reconciliation-recovery");
  assert.equal(withdrawalDashboard.body.recoveries.find((item) => item.recovery.recovery_id === "recovery-withdraw").confirmation, null);
  const withdrawalController = await call("/api/internal/reconciliation-recovery-confirmation?recovery_id=recovery-withdraw", { cookie: "", origin: "", headers: { Authorization: "Bearer human-decision-recovery-controller" } });
  assert.notEqual(withdrawalController.status, 200);
  assert.equal(withdrawalController.body.confirmation, undefined);
  assert.equal(withdrawalController.text.includes("execution_authority_granted"), false);

  const mirrorPromotionStore = new Map();
  let failPromotionMirror = false;
  const mirrorPromotionKv = {
    async get(key) { return mirrorPromotionStore.get(key) || null; },
    async put(key, value) {
      if (failPromotionMirror && String(key).startsWith("research_promotion_ticket:")) throw new Error("mirror unavailable");
      mirrorPromotionStore.set(key, value);
    },
    async list({ prefix = "" } = {}) { return { keys: [...mirrorPromotionStore.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })) }; },
  };
  const promotionNamespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const promotionMirrorEnv = { ...bindings, STRATEGY_SWITCH_CONFIG: mirrorPromotionKv, STRATEGY_SWITCH_RUNTIME_INSTANCES: promotionNamespace };
  const mirrorTicket = promotionTicket(`rpt_${"7".repeat(64)}`);
  const mirrorPromotionHeaders = { Cookie: adminCookie, Origin: "https://switch.example", "Content-Type": "application/json", Authorization: "Bearer human-decision-promotion-sync" };
  const mirrorPromotionSync = await worker.fetch(new Request("https://switch.example/api/internal/sync-research-promotion-ticket", {
    method: "POST", headers: mirrorPromotionHeaders, body: JSON.stringify(mirrorTicket),
  }), promotionMirrorEnv);
  assert.equal(mirrorPromotionSync.status, 200);
  failPromotionMirror = true;
  const mirrorPromotionBody = {
    ticket_id: mirrorTicket.ticket_id, decision: "accept", expected_proposed_params: mirrorTicket.proposed_params,
    confirmation: { target_platform: "longbridge", execution_mode: "paper", risk_profile: "CAPITAL_PRESERVATION" },
    selected_account: { platform: "longbridge", key: "paper" },
  };
  const mirrorPromotionDecision = await worker.fetch(new Request("https://switch.example/api/research-promotion-decisions", {
    method: "POST", headers: { Cookie: adminCookie, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify(mirrorPromotionBody),
  }), promotionMirrorEnv);
  const mirrorPromotionPayload = await mirrorPromotionDecision.json();
  assert.equal(mirrorPromotionDecision.status, 200);
  assert.equal(mirrorPromotionPayload.replayed, false);
  assert.equal(JSON.parse(mirrorPromotionStore.get(`research_promotion_ticket:${mirrorTicket.ticket_id}`)).state, "awaiting_human");
  const mirrorPromotionReplay = await worker.fetch(new Request("https://switch.example/api/research-promotion-decisions", {
    method: "POST", headers: { Cookie: adminCookie, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify(mirrorPromotionBody),
  }), promotionMirrorEnv);
  const mirrorPromotionReplayPayload = await mirrorPromotionReplay.json();
  assert.equal(mirrorPromotionReplay.status, 200);
  assert.equal(mirrorPromotionReplayPayload.replayed, true);
  assert.equal(mirrorPromotionReplayPayload.actor, mirrorPromotionPayload.actor || "decision-admin");
  assert.equal(mirrorPromotionReplayPayload.ticket.human_decided_at, mirrorPromotionPayload.ticket.human_decided_at);
  assert.equal(JSON.parse(mirrorPromotionStore.get(`research_promotion_ticket:${mirrorTicket.ticket_id}`)).state, "awaiting_human");
  const mirrorPromotionOpposite = await worker.fetch(new Request("https://switch.example/api/research-promotion-decisions", {
    method: "POST", headers: { Cookie: adminCookie, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify({ ...mirrorPromotionBody, decision: "reject" }),
  }), promotionMirrorEnv);
  assert.equal(mirrorPromotionOpposite.status, 409);

  const liveNamespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const liveKv = await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG");
  const accountTicket = promotionTicket(`rpt_${"3".repeat(64)}`);
  const accountStore = new Map();
  let holdProfiles = false;
  const accountLatch = openLatch();
  const accountKv = {
    async get(key) {
      if (holdProfiles && key === "strategy_profiles") await accountLatch.hold();
      return accountStore.get(key) || null;
    },
    async put(key, value) { accountStore.set(key, value); },
    async list({ prefix = "" } = {}) { return { keys: [...accountStore.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })) }; },
  };
  const accountEnv = { ...bindings, STRATEGY_SWITCH_CONFIG: accountKv, STRATEGY_SWITCH_RUNTIME_INSTANCES: liveNamespace };
  const accountSync = await worker.fetch(new Request("https://switch.example/api/internal/sync-research-promotion-ticket", {
    method: "POST",
    headers: { Authorization: "Bearer human-decision-promotion-sync", "Content-Type": "application/json" },
    body: JSON.stringify(accountTicket),
  }), accountEnv);
  assert.equal(accountSync.status, 200);
  holdProfiles = true;
  let accountPending = worker.fetch(new Request("https://switch.example/api/research-promotion-decisions", {
    method: "POST",
    headers: { Cookie: adminCookie, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify({
      ticket_id: accountTicket.ticket_id, decision: "accept", expected_proposed_params: accountTicket.proposed_params,
      confirmation: { target_platform: "longbridge", execution_mode: "paper", risk_profile: "CAPITAL_PRESERVATION" },
      selected_account: { platform: "longbridge", key: "paper" },
    }),
  }), accountEnv);
  try {
    await waitFor(accountLatch.entered, "account qualification");
    const accountBump = await call("/api/admin/runtime-instances", { method: "POST", body: {
      action: "create", expected_revision: (await call("/api/admin/runtime-instances")).body.revision, platform: "longbridge",
      config: {
        key: "draft-latch", label: "Draft latch", target_name: "draft-latch",
        account_selector: "DRAFT-LATCH", deployment_selector: "draft-latch", account_scope: "draft",
        service_name: "draft-latch-service", supported_domains: ["us_equity"], broker_environment: "paper",
        default_execution_mode: "dry_run", default_strategy_profile: "russell_top50_leader_rotation",
      },
    } });
    assert.equal(accountBump.status, 200);
    accountLatch.release();
    const accountRaced = await accountPending;
    accountPending = null;
    const accountRacedBody = await accountRaced.json();
    assert.equal(accountRaced.status, 409);
    assert.equal(accountRacedBody.error, "runtime_instance_revision_conflict");
  } finally {
    holdProfiles = false;
    accountLatch.release();
    if (accountPending) await accountPending.catch(() => {});
  }
  const accountFetched = await worker.fetch(new Request(`https://switch.example/api/internal/research-promotion-ticket?ticket_id=${accountTicket.ticket_id}`, {
    headers: { Authorization: "Bearer human-decision-promotion-sync" },
  }), accountEnv);
  assert.equal((await accountFetched.json()).ticket.state, "awaiting_human");

  const ownerLatchId = "owner-latch";
  assert.equal((await call("/api/internal/sync-control-plane-source", {
    method: "POST", cookie: "", origin: "",
    headers: { Authorization: "Bearer human-decision-control-token" },
    body: {
      schema_version: "qsl_control_plane_source_snapshot.v1",
      source_id: "uesp.owner_latch", generated_at: now, computed_at: now, data_status: "ready",
      candidates: ownerSnapshot(ownerLatchId).candidates, errors: [],
    },
  })).status, 200);
  const ownerLatchQueue = await call("/api/owner-decisions");
  const ownerLatchEvidence = ownerLatchQueue.body.candidates.find((item) => item.candidate.candidate_id === ownerLatchId).candidate_evidence_sha256;
  const ownerLatch = openLatch();
  const ownerEnv = { ...bindings, STRATEGY_SWITCH_CONFIG: liveKv, STRATEGY_SWITCH_RUNTIME_INSTANCES: wrapNamespace(liveNamespace, "owner_decide", ownerLatch) };
  let ownerPending = worker.fetch(new Request("https://switch.example/api/owner-decisions", {
    method: "POST",
    headers: { Cookie: adminCookie, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify({ candidate_id: ownerLatchId, decision: "keep_parked", candidate_evidence_sha256: ownerLatchEvidence }),
  }), ownerEnv);
  try {
    await waitFor(ownerLatch.entered, "owner decision");
    assert.equal((await call("/api/internal/sync-control-plane-source", {
      method: "POST", cookie: "", origin: "",
      headers: { Authorization: "Bearer human-decision-control-token" },
      body: {
        schema_version: "qsl_control_plane_source_snapshot.v1",
        source_id: "uesp.owner_latch_b", generated_at: now, computed_at: now, data_status: "ready",
        candidates: ownerSnapshot(ownerLatchId).candidates, errors: [],
      },
    })).status, 200);
    ownerLatch.release();
    const ownerRaced = await ownerPending;
    ownerPending = null;
    assert.equal(ownerRaced.status, 409);
  } finally {
    ownerLatch.release();
    if (ownerPending) await ownerPending.catch(() => {});
  }
  const ownerAfter = await call("/api/owner-decisions");
  assert.equal(ownerAfter.body.candidates.find((item) => item.candidate.candidate_id === ownerLatchId)?.intent ?? null, null);

  const applicationTicket = promotionTicket(`rpt_${"4".repeat(64)}`);
  assert.equal((await syncPromotion(applicationTicket)).status, 200);
  assert.equal((await call("/api/research-promotion-decisions", { method: "POST", body: {
    ticket_id: applicationTicket.ticket_id, decision: "accept", expected_proposed_params: applicationTicket.proposed_params,
    confirmation: { target_platform: "longbridge", execution_mode: "paper", risk_profile: "CAPITAL_PRESERVATION" },
    selected_account: { platform: "longbridge", key: "paper" },
  } })).status, 200);
  const applicationRevision = (await call("/api/admin/runtime-instances")).body.revision;
  const applicationLatch = openLatch();
  const applicationEnv = { ...bindings, STRATEGY_SWITCH_CONFIG: liveKv, STRATEGY_SWITCH_RUNTIME_INSTANCES: wrapNamespace(liveNamespace, "application_create", applicationLatch) };
  const previousFetch = globalThis.fetch;
  let workflowDispatches = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("api.github.com")) {
      workflowDispatches += 1;
      return new Response("offline", { status: 503 });
    }
    return previousFetch(input, init);
  };
  let applicationPending = worker.fetch(new Request("https://switch.example/api/research-promotion-applications", {
    method: "POST",
    headers: { Cookie: adminCookie, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify({ ticket_id: applicationTicket.ticket_id, selected_account: { platform: "longbridge", key: "paper" }, expected_revision: applicationRevision }),
  }), applicationEnv);
  try {
    await waitFor(applicationLatch.entered, "application create");
    assert.equal((await syncPromotion({ ...applicationTicket, shadow_passed: false })).status, 200);
    applicationLatch.release();
    const applicationRaced = await applicationPending;
    applicationPending = null;
    assert.equal(applicationRaced.status, 409);
    assert.equal(workflowDispatches, 0);
  } finally {
    applicationLatch.release();
    globalThis.fetch = previousFetch;
    if (applicationPending) await applicationPending.catch(() => {});
  }
  assert.equal((await call(`/api/research-promotion-applications?ticket_id=${applicationTicket.ticket_id}`)).body.application, null);

  const recoveryStore = new Map();
  let failRecoverySource = false;
  const recoveryKv = {
    async get(key) { return recoveryStore.get(key) || null; },
    async put(key, value) {
      if (failRecoverySource && String(key).startsWith("reconciliation_recovery_source:")) throw new Error("source mirror unavailable");
      recoveryStore.set(key, value);
    },
    async list({ prefix = "" } = {}) { return { keys: [...recoveryStore.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })) }; },
  };
  const recoveryEnv = { ...bindings, STRATEGY_SWITCH_CONFIG: recoveryKv, STRATEGY_SWITCH_RUNTIME_INSTANCES: liveNamespace };
  const recoveryReady = recoverySource("recovery-latch");
  const recoverySync = await worker.fetch(new Request("https://switch.example/api/internal/sync-reconciliation-recovery-source", {
    method: "POST",
    headers: { Authorization: "Bearer human-decision-recovery-sync", "Content-Type": "application/json" },
    body: JSON.stringify(recoveryReady),
  }), recoveryEnv);
  assert.equal(recoverySync.status, 200);
  const recoveryApproved = await worker.fetch(new Request("https://switch.example/api/reconciliation-recovery-confirmations", {
    method: "POST",
    headers: { Cookie: adminCookie, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify({ recovery_id: "recovery-latch", candidate_sha256: "a".repeat(64), dual_review_binding_sha256: "a".repeat(64), decision: "approve" }),
  }), recoveryEnv);
  assert.equal(recoveryApproved.status, 200);
  const readySource = JSON.parse(recoveryStore.get("reconciliation_recovery_source:fixture.recovery"));
  assert.equal(readySource.recoveries[0].readiness, "awaiting_human_confirmation");
  failRecoverySource = true;
  const blockedLatch = recoverySource("recovery-latch");
  blockedLatch.recoveries[0].readiness = "blocked";
  blockedLatch.recoveries[0].blocker_codes = ["account_unavailable"];
  let recoveryWithdrawalStatus = 0;
  try {
    const recoveryWithdrawal = await worker.fetch(new Request("https://switch.example/api/internal/sync-reconciliation-recovery-source", {
      method: "POST",
      headers: { Authorization: "Bearer human-decision-recovery-sync", "Content-Type": "application/json" },
      body: JSON.stringify(blockedLatch),
    }), recoveryEnv);
    recoveryWithdrawalStatus = recoveryWithdrawal.status;
  } catch {
    recoveryWithdrawalStatus = 500;
  } finally {
    failRecoverySource = false;
  }
  assert.notEqual(recoveryWithdrawalStatus, 200);
  assert.equal(JSON.parse(recoveryStore.get("reconciliation_recovery_source:fixture.recovery")).recoveries[0].readiness, "awaiting_human_confirmation");
  assert.ok(recoveryStore.get("reconciliation_recovery_current:recovery-latch"));
  const recoveryController = await worker.fetch(new Request("https://switch.example/api/internal/reconciliation-recovery-confirmation?recovery_id=recovery-latch", {
    headers: { Authorization: "Bearer human-decision-recovery-controller" },
  }), recoveryEnv);
  const recoveryControllerBody = await recoveryController.json();
  assert.notEqual(recoveryController.status, 200);
  assert.equal(recoveryControllerBody.confirmation, undefined);

  const beforeOutbound = outbound;
  const state = await call("/api/admin/runtime-instances");
  assert.equal((await call("/api/research-promotion-applications", { method: "POST", body: { ticket_id: ticket.ticket_id, selected_account: { platform: "longbridge", key: "other" }, expected_revision: state.body.revision } })).status, 409);
  assert.equal((await call("/api/research-promotion-applications", { method: "POST", body: { ticket_id: ticket.ticket_id, selected_account: { platform: "longbridge", key: "paper" }, expected_revision: state.body.revision + 4 } })).status, 409);
  const bumped = await call("/api/admin/runtime-instances", { method: "POST", body: { action: "set_broker_environment", expected_revision: state.body.revision, platform: "longbridge", key: "paper", broker_environment: "live" } });
  assert.equal(bumped.status, 200);
  assert.equal((await call("/api/research-promotion-applications", { method: "POST", body: { ticket_id: ticket.ticket_id, selected_account: { platform: "longbridge", key: "paper" }, expected_revision: bumped.body.revision } })).status, 409);
  assert.equal((await syncPromotion({ ...ticket, proposed_params: { ...ticket.proposed_params, mutated: true } })).status, 200);
  assert.equal((await call("/api/research-promotion-applications", { method: "POST", body: { ticket_id: ticket.ticket_id, selected_account: { platform: "longbridge", key: "paper" }, expected_revision: bumped.body.revision } })).status, 409);
  assert.equal(outbound, beforeOutbound);
  console.log("human decisions validation passed");
} finally {
  await mf.dispose();
}
