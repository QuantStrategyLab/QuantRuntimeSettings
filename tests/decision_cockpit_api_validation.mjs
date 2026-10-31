import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { __test } from "./helpers/directory_worker.mjs";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profiles = JSON.parse(readFileSync(resolve(root, "web/strategy-switch-console/strategy-profiles.example.json"), "utf8"));
const paperAccount = {
  key: "paper", label: "LongBridge paper", target_name: "paper", runtime_status_target_id: "longbridge.paper",
  account_selector: "PAPER", deployment_selector: "paper", account_scope: "PAPER", service_name: "longbridge-quant-paper-service",
  supported_domains: ["us_equity"], broker_environment: "paper", default_execution_mode: "live",
  default_strategy_profile: "russell_top50_leader_rotation",
};
const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const bindings = {
  SESSION_SECRET: "decision-cockpit-fixture-session",
  ALLOWED_GITHUB_LOGINS: "cockpit-admin,cockpit-reader",
  STRATEGY_SWITCH_ADMIN_LOGINS: "cockpit-admin",
  CONTROL_PLANE_SYNC_TOKEN: "cockpit-control-token",
  RECONCILIATION_RECOVERY_SYNC_TOKEN: "cockpit-recovery-sync",
  RESEARCH_PROMOTION_SYNC_TOKEN: "cockpit-promotion-sync",
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ longbridge: [paperAccount] }),
  STRATEGY_SWITCH_STRATEGY_PROFILES_JSON: JSON.stringify(profiles),
};
const adminCookie = `qsl_switch_session=${await __test.makeSession("cockpit-admin", [], bindings)}`;
const options = {
  cf: false,
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08",
  bindings,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  durableObjectsPersist: await mkdtemp(join(tmpdir(), "qrt-cockpit-do-")),
  kvPersist: await mkdtemp(join(tmpdir(), "qrt-cockpit-kv-")),
  kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: () => new Response("offline only", { status: 503 }),
};
const mf = new Miniflare(options);
async function initializeDirectory(runtime) {
  const namespace = await runtime.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const response = await namespace.get(namespace.idFromName("console-kv-directory-v1")).fetch("https://fixture.invalid/kv-directory", {
    method: "POST", body: JSON.stringify({ action: "maintain" }),
  });
  assert.equal(response.status, 200);
}
await initializeDirectory(mf);
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
  return { status: response.status, body: payload, text, headers: response.headers };
}
function ownerSnapshot(candidateId, generatedAt = now) {
  return {
    schema_version: "qsl_control_plane_dashboard.v1",
    generated_at: generatedAt, computed_at: generatedAt, data_status: "ready",
    summary: { candidate_count: 1, deferred: 0, parked: 0, owner_decision_required: 1 },
    candidates: [{
      candidate_id: candidateId, candidate_kind: "individual", domain: "us_equity",
      lifecycle: { stage: "P6", status: "owner_decision_required" },
      evidence: { p1_input_digest: "1".repeat(64), p2_config_digest: "2".repeat(64), p3_evidence_id: "3".repeat(64), source_revision: "4".repeat(40) },
      recommendation: { code: "owner_live_decision", reason: "owner decision required" },
      freshness: { status: "fresh", age_seconds: 0 },
    }],
    policy: { p4_p5_automation: "not_configured", p6_owner_decision_required: true, notice: "live remains owner-decided" },
    errors: [],
  };
}
function recoverySource(recoveryId, generatedAt) {
  return {
    schema_version: "qsl_reconciliation_recovery_source_snapshot.v1",
    source_id: "fixture.recovery", generated_at: generatedAt, computed_at: generatedAt, data_status: "ready",
    recoveries: [{
      recovery_id: recoveryId, platform: "ibkr", strategy_profile: "soxl_soxx_trend_income", environment: "live",
      reconciliation_state: "RECONCILE_ONLY", readiness: "awaiting_human_confirmation",
      candidate_sha256: "a".repeat(64), evidence_sample_count: 1,
      first_observed_at: generatedAt, last_observed_at: generatedAt,
      dual_review: { outcome: "unavailable", reviewer_count: 0, evidence_binding_sha256: "a".repeat(64) },
      blocker_codes: [],
    }],
    errors: [],
  };
}
const syncControl = (body) => call("/api/internal/sync-control-plane", {
  method: "POST", cookie: "", origin: "",
  headers: { Authorization: "Bearer cockpit-control-token" }, body,
});
const syncRecovery = (body) => call("/api/internal/sync-reconciliation-recovery-source", {
  method: "POST", cookie: "", origin: "",
  headers: { Authorization: "Bearer cockpit-recovery-sync" }, body,
});
const syncPromotion = (body) => call("/api/internal/sync-research-promotion-ticket", {
  method: "POST", cookie: "", origin: "",
  headers: { Authorization: "Bearer cockpit-promotion-sync" }, body,
});

// Inbox contract: actionable owner decisions carry revision, expiry, actions, evidence and operation.
const owner = ownerSnapshot("cockpit-owner");
assert.equal((await syncControl(owner)).status, 200);
let inbox = await call("/api/decisions-inbox");
assert.equal(inbox.status, 200);
assert.equal(typeof inbox.body.server_time, "string");
const ownerItem = inbox.body.items.find((item) => item.decision_id === "owner_decision:cockpit-owner");
assert.ok(ownerItem, "owner decision item is present");
assert.match(ownerItem.revision, /^rev1-[0-9a-f]{16}$/);
assert.equal(ownerItem.actionable, true);
assert.ok(ownerItem.expires_at, "actionable decisions must carry expiry");
assert.ok(ownerItem.allowed_actions.some((entry) => entry.action === "keep_parked"));
assert.equal(ownerItem.request_id_required, true);
assert.match(ownerItem.evidence_summary.material_sha256, /^[0-9a-f]{64}$/);
assert.equal(ownerItem.operation_reference.id, "operation:owner_decision:cockpit-owner");
assert.equal(ownerItem.transition.pending_to, "small_live_intent");
assert.equal(ownerItem.decision_authority.expires_at, ownerItem.expires_at);

// GET /api/decisions/:id returns one authoritative review with server time and eligibility.
const review = await call(`/api/decisions/${encodeURIComponent(ownerItem.decision_id)}`);
assert.equal(review.status, 200);
assert.equal(review.body.schema_version, "qsl.decision_review.v1");
assert.equal(typeof review.body.server_time, "string");
assert.equal(review.body.decision_id, ownerItem.decision_id);
assert.equal(review.body.current_eligibility.eligible, true);
assert.equal(review.body.current_eligibility.expired, false);
assert.equal(review.body.decision.decision_id, ownerItem.decision_id);
assert.equal((await call("/api/decisions/owner_decision:missing")).status, 404);
assert.equal((await call("/api/decisions/not-a-decision")).status, 400);

// POST /api/decisions/:id/actions delegates to the durable owner command.
const actionUrl = `/api/decisions/${encodeURIComponent(ownerItem.decision_id)}/actions`;
const wrongRevision = await call(actionUrl, { method: "POST", body: {
  action: "keep_parked", expected_revision: "rev1-0000000000000000", request_id: "cockpit-request-1",
} });
assert.equal(wrongRevision.status, 409);
assert.equal(wrongRevision.body.error, "decision_revision_conflict");
const missingSelectionAction = await call(actionUrl, { method: "POST", body: {
  action: "not_an_action", expected_revision: ownerItem.revision, request_id: "cockpit-request-1",
} });
assert.equal(missingSelectionAction.status, 400);
assert.equal(missingSelectionAction.body.error, "decision_action_invalid");
const decided = await call(actionUrl, { method: "POST", body: {
  action: "keep_parked", expected_revision: ownerItem.revision,
  expected_expires_at: ownerItem.expires_at, request_id: "cockpit-request-1",
} });
assert.equal(decided.status, 200);
assert.equal(decided.body.ok, true);
assert.equal(decided.body.decision_id, ownerItem.decision_id);
assert.equal(decided.body.decision_state.status, "decided");
assert.match(decided.body.decision_receipt.receipt_sha256, /^[0-9a-f]{64}$/);
assert.equal(decided.body.policy.no_order, true);
const replayed = await call(actionUrl, { method: "POST", body: {
  action: "keep_parked", expected_revision: ownerItem.revision, request_id: "cockpit-request-1",
} });
assert.equal(replayed.status, 200);
assert.equal(replayed.body.replayed, true);
assert.equal(replayed.body.decision_receipt.receipt_sha256, decided.body.decision_receipt.receipt_sha256);
const conflictingAction = await call(actionUrl, { method: "POST", body: {
  action: "approve_limited_live_canary", expected_revision: ownerItem.revision, request_id: "cockpit-request-2",
} });
assert.equal(conflictingAction.status, 409);
assert.equal(conflictingAction.body.error, "human_decision_conflict");
const decidedReview = await call(`/api/decisions/${encodeURIComponent(ownerItem.decision_id)}`);
assert.equal(decidedReview.body.current_eligibility.eligible, false);
assert.equal(decidedReview.body.decision.allowed_actions.length, 0);
assert.equal(decidedReview.body.decision.decision_state.status, "decided");

// Operations resolve a recorded decision without resubmitting it.
const operation = await call(`/api/operations/${encodeURIComponent("operation:owner_decision:cockpit-owner")}`);
assert.equal(operation.status, 200);
assert.equal(operation.body.schema_version, "qsl.operation.v1");
assert.equal(operation.body.operation.status, "accepted");
assert.equal(operation.body.operation.activation_status, "not_connected");
assert.equal(operation.body.decision.action, "keep_parked");
assert.equal((await call("/api/operations/operation:not_a_kind:x")).status, 404);

// Audit projection correlates the durable decision and the bounded log.
const audit = await call("/api/audit-events");
assert.equal(audit.status, 200);
assert.equal(audit.body.schema_version, "qsl.audit_events.v1");
assert.ok(audit.body.events.some((event) => event.source === "durable_human_decision"
  && event.subject.id === "cockpit-owner" && event.outcome === "decided"));
assert.ok(audit.body.events.every((event) => !("login" in event) && "actor_alias" in event));
const auditPage = await call("/api/audit-events?limit=1");
assert.equal(auditPage.body.events.length, 1);
assert.equal(auditPage.body.next_cursor, "1");
assert.equal((await call("/api/audit-events?cursor=bad")).status, 400);

// Expired material is visible but never actionable, and the action route fails closed.
const expiredAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
assert.equal((await syncRecovery(recoverySource("cockpit-expired-recovery", expiredAt))).status, 200);
inbox = await call("/api/decisions-inbox");
const expiredItem = inbox.body.items.find((item) => item.id === "reconciliation_recovery:cockpit-expired-recovery");
assert.ok(expiredItem);
assert.equal(expiredItem.actionable, false);
assert.ok(expiredItem.blocking_reason_codes.includes("decision_expired"));
assert.equal(expiredItem.allowed_actions.length, 0);
const expiredReview = await call(`/api/decisions/${encodeURIComponent(expiredItem.decision_id)}`);
assert.equal(expiredReview.body.current_eligibility.expired, true);
assert.equal(expiredReview.body.current_eligibility.eligible, false);
const expiredAction = await call(`/api/decisions/${encodeURIComponent(expiredItem.decision_id)}/actions`, { method: "POST", body: {
  action: "approve", expected_revision: expiredItem.revision,
  expected_expires_at: expiredItem.expires_at, request_id: "cockpit-request-expired",
} });
assert.equal(expiredAction.status, 409);
assert.equal(expiredAction.body.error, "decision_expired");

// Risk profile reads expose selected/approved/effective tier bindings.
const risk = await call("/api/risk-profiles");
assert.equal(risk.status, 200);
assert.equal(risk.body.no_order, true);
assert.equal(risk.body.execution_authority_granted, false);
assert.ok(Array.isArray(risk.body.tier_bindings));
for (const tierBinding of risk.body.tier_bindings) {
  // Effective tier is an observed readback; with no observation it stays null and says why.
  assert.equal(tierBinding.effective_derived_from_approved, false);
  assert.equal(tierBinding.effective.observed_at, null);
  if (tierBinding.effective.status === "unavailable") {
    assert.equal(tierBinding.effective.tier, null);
    assert.equal(tierBinding.effective.unavailable_reason, "effective_tier_not_observed");
    assert.equal(tierBinding.effective.source, null);
  } else {
    assert.equal(tierBinding.effective.status, "observed");
    assert.ok(tierBinding.effective.tier);
  }
}
const { riskTierBindingView } = await import("../web/strategy-switch-console/application/console_api/risk_tiers.js");
const observedTier = riskTierBindingView({
  binding: { profile_selection: { risk_preference: "BALANCED_COMPOUNDING", profile_id: "balanced_compounding_v1" } },
  observation: { tier: "CAPITAL_PRESERVATION", observed_at: now, source: "runtime_readback" },
});
assert.equal(observedTier.effective.tier, "CAPITAL_PRESERVATION");
assert.equal(observedTier.effective.status, "observed");
assert.equal(observedTier.effective.source, "runtime_readback");
assert.notEqual(observedTier.effective.tier, observedTier.approved.tier);

// Unauthenticated access fails closed.
assert.equal((await call("/api/decisions/owner_decision:cockpit-owner", { cookie: "" })).status, 401);
assert.equal((await call(actionUrl, { method: "POST", cookie: "", body: {
  action: "keep_parked", expected_revision: ownerItem.revision, request_id: "cockpit-request-3",
} })).status, 401);
assert.equal((await call("/api/operations/operation:owner_decision:cockpit-owner", { cookie: "" })).status, 401);
assert.equal((await call("/api/audit-events", { cookie: "" })).status, 401);

// A non-admin cannot record a decision through the adapter.
const reader = `qsl_switch_session=${await __test.makeSession("cockpit-reader", [], bindings)}`;
assert.equal((await call(actionUrl, { method: "POST", cookie: reader, body: {
  action: "keep_parked", expected_revision: ownerItem.revision, request_id: "cockpit-request-4",
} })).status, 403);

// Inbox pagination: bounded limit, opaque cursor, stable order, null on the last page.
assert.equal((await syncRecovery(recoverySource("cockpit-page-recovery", now))).status, 200);
const fullInbox = await call("/api/decisions-inbox?limit=100");
assert.equal(fullInbox.status, 200);
assert.equal(fullInbox.body.next_cursor, null, "the fixture inbox fits in one bounded page");
assert.ok(fullInbox.body.items.length >= 2, "pagination needs at least two items");
const firstPage = await call("/api/decisions-inbox?limit=1");
assert.equal(firstPage.status, 200);
assert.equal(firstPage.body.items.length, 1);
assert.equal(typeof firstPage.body.next_cursor, "string");
assert.match(firstPage.body.next_cursor, /^[A-Za-z0-9_-]+$/, "cursor is opaque, not a raw offset");
const secondPage = await call(`/api/decisions-inbox?limit=1&cursor=${encodeURIComponent(firstPage.body.next_cursor)}`);
assert.equal(secondPage.status, 200);
assert.equal(secondPage.body.items.length, 1);
assert.deepEqual(
  secondPage.body.items.map((item) => item.id),
  fullInbox.body.items.slice(1, 2).map((item) => item.id),
  "the cursor continues the stable full-page order",
);
const repeatedPage = await call("/api/decisions-inbox?limit=1");
assert.deepEqual(
  repeatedPage.body.items.map((item) => item.id),
  firstPage.body.items.map((item) => item.id),
  "ordering is deterministic across identical requests",
);
assert.equal((await call("/api/decisions-inbox?limit=0")).status, 400);
assert.equal((await call("/api/decisions-inbox?limit=101")).status, 400);
assert.equal((await call("/api/decisions-inbox?cursor=not-a-cursor!")).status, 400);

await mf.dispose();
console.log("decision_cockpit_api_validation: PASS");
