import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHumanDecisionController, humanDecisionExpectation, humanDecisionDigest } from "../web/strategy-switch-console/frontend/src/operations.ts";
import { createRequestGate } from "../web/strategy-switch-console/frontend/src/lib/hooks.ts";

// The live shell (src/app/App.tsx) and the decisions page share the same
// request gate and human-decision controller. This validator exercises those
// pieces directly with synthetic values and pins the shell's load boundary in
// source. It is not DOM rendering or browser evidence.
const frontend = "../web/strategy-switch-console/frontend/src/";
const app = readFileSync(new URL(`${frontend}app/App.tsx`, import.meta.url), "utf8");
const decisions = readFileSync(new URL(`${frontend}pages/decisions/DecisionsPage.tsx`, import.meta.url), "utf8");

// Load boundary: the shell never schedules autonomous network loads and boot reads the session only.
assert.doesNotMatch(app, /startVisibleRefreshLoop|setInterval|visibilitychange|addEventListener\("focus"/, "App must not schedule autonomous network loads");
assert.match(app, /const next = await loadSession\(\)/);
for (const path of ["/api/strategy-health", "/api/execution-evidence", "/api/research-tasks", "/api/runtime-catalog", "/api/m0-research", "/api/adaptive-selection"])
  assert.equal(app.includes(path), false, `${path} is not part of the shell read model`);
// Private session invalidation (401/403) drops the shell to the denied state, which unmounts the
// decisions page and with it the in-memory decision controller; an in-flight page also ignores the signal.
assert.match(app, /error instanceof AccessError && error\.status === 401\) setBoot\("denied"\)/);
assert.match(app, /addEventListener\("qsl-private-session-invalid", onInvalid\)/);
assert.match(app, /setSession\(null\);\s*setBoot\("denied"\)/);
assert.match(decisions, /useRef\(createHumanDecisionController\(\)\)/);
assert.match(decisions, /"session_invalidated"/);

// Request gate: a late response for an old generation cannot be applied.
{
  const gate = createRequestGate();
  const first = gate.begin(); const second = gate.begin();
  assert.equal(gate.isCurrent(first), false, "newer request supersedes the older one");
  assert.equal(gate.isCurrent(second), true);
}

const response = payload => ({ ok: true, ...payload });
const readback = (expected, receipt, found = true) => response({ decision_readback: {
  schema_version: "qsl_human_decision_readback.v1", source: "durable_human_decision_record", kind: expected.kind, subject_id: expected.subject_id,
  requested_material_sha256: expected.material_sha256, observed_at: "2026-10-07T09:00:00Z", lookup_status: found ? "found" : "not_found",
  receipt: found ? receipt : null, current_material: { status: "not_current" } } });

// Owner decision: one start per exact material, lost response stays unresolved, readback records the original receipt.
{
  const owner = { candidate: { candidate_id: "synthetic-history" }, candidate_evidence_sha256: "d".repeat(64), decision_binding: { kind: "owner", subject_id: "synthetic-history", material_sha256: "d".repeat(64) } };
  const body = { candidate_id: owner.candidate.candidate_id, candidate_evidence_sha256: owner.candidate_evidence_sha256, decision: "keep_parked" };
  const expected = await humanDecisionExpectation("owner", owner, body);
  assert.ok(expected);
  const material = { schema_version: "qsl_human_decision_receipt.v1", kind: "owner", subject_id: expected.subject_id, material_sha256: expected.material_sha256, action: expected.action, target: expected.target, decided_at: "2026-10-07T06:00:00.123456Z", decided_by: "synthetic-original-actor", no_order: true, execution_authority_granted: false };
  const receipt = { ...material, receipt_sha256: await humanDecisionDigest(material) };
  const controller = createHumanDecisionController();

  const op = controller.start(expected);
  assert.ok(op);
  assert.equal(controller.start(expected), null, "the same material cannot be submitted twice while unresolved");
  assert.equal(controller.entries()[0].status, "unresolved");
  // Lost POST response: durable queue not confirmed, so the entry stays unresolved and keeps blocking another POST.
  assert.equal(await controller.receive(op, receipt, false), true);
  assert.equal(controller.entries()[0].status, "unresolved");
  assert.equal(controller.entries()[0].receipt.decided_at, receipt.decided_at);
  assert.equal(controller.start(expected), null);
  // Read failure keeps it unresolved; HTTP 200 with not_found does too.
  const failedRead = controller.beginRead(expected);
  assert.equal(controller.readFailed(failedRead), true);
  assert.equal(controller.entries()[0].status, "unresolved");
  const missing = controller.beginRead(expected);
  assert.equal(await controller.readback(missing, readback(expected, receipt, false), true), false);
  assert.equal(controller.entries()[0].status, "unresolved");
  // A later exact readback records the original receipt and actor.
  const found = controller.beginRead(expected);
  assert.equal(await controller.readback(found, readback(expected, receipt), true), true);
  assert.equal(controller.entries()[0].status, "recorded");
  assert.equal(controller.entries()[0].receipt.decided_by, "synthetic-original-actor");
  assert.equal(controller.entries()[0].receipt.execution_authority_granted, false);
  // A superseded read cannot overwrite the newer result.
  const stale = controller.beginRead(expected); controller.beginRead(expected);
  assert.equal(await controller.readback(stale, readback(expected, receipt, false), false), false);
  assert.equal(controller.entries()[0].status, "recorded");

  // Session invalidation: a late POST result after clear() is discarded.
  controller.clear();
  assert.deepEqual(controller.entries(), []);
  const late = controller.start(expected);
  const epoch = controller.epoch();
  controller.clear();
  assert.notEqual(epoch, controller.epoch());
  assert.equal(await controller.receive(late, receipt, true), false, "late response cannot restore data after private-session invalidation");
  assert.deepEqual(controller.entries(), []);
}

// Promotion v1 (historical reject) and v2 (accept with review binding) stay bound to the original account/target.
for (const version of [1, 2]) {
  const source = { ticket_id: `synthetic-promotion-v${version}`, strategy_profile: "demo", domain: "us_equity", proposed_params: { candidate: "synthetic-only" }, shadow_passed: true, shadow_evidence_kind: "synthetic-shadow", drift_status: "stable", drift_score: 0, budget: {}, search_iterations: 1, suggested_risk_profile: "CAPITAL_PRESERVATION", notification_subject: "Synthetic", notification_body: "Synthetic review only", notes: [], research_summary: null };
  const legacy = Object.fromEntries(["ticket_id", "strategy_profile", "domain", "proposed_params", "shadow_passed", "shadow_evidence_kind"].map(k => [k, source[k]]));
  source.decision_binding = { kind: "promotion", subject_id: source.ticket_id, material_sha256: await humanDecisionDigest(legacy), review_binding: version === 2 ? { schema_version: "qsl_promotion_review_binding.v2", review_sha256: await humanDecisionDigest({ schema_version: "qsl_promotion_review_material.v2", ...source }) } : null };
  const body = { ticket_id: source.ticket_id, decision: version === 2 ? "accept" : "reject", confirmation: version === 2 ? { target_platform: "longbridge", execution_mode: "paper", risk_profile: "CAPITAL_PRESERVATION" } : null, ...(version === 2 ? { selected_account: { platform: "longbridge", key: "synthetic-a" } } : {}) };
  const wanted = await humanDecisionExpectation("promotion", source, body);
  assert.ok(wanted);
  const raw = { schema_version: `qsl_human_decision_receipt.v${version}`, ...(version === 2 ? { review_binding: source.decision_binding.review_binding } : {}), kind: "promotion", subject_id: source.ticket_id, material_sha256: wanted.material_sha256, action: wanted.action, target: wanted.target, decided_at: "2026-10-07T06:00:00.123456Z", decided_by: "synthetic-original-actor", no_order: true, execution_authority_granted: false };
  const receipt = { ...raw, receipt_sha256: await humanDecisionDigest(raw) };
  const controller = createHumanDecisionController();
  const op = controller.start(wanted);
  assert.equal(await controller.receive(op, receipt, true), true);
  const result = controller.entries()[0];
  assert.equal(result.status, "recorded");
  assert.deepEqual(result.receipt.target, wanted.target, "decision remains bound to the original selected account/target");
  assert.equal(result.receipt.decided_at, raw.decided_at);
  assert.equal(result.receipt.decided_by, raw.decided_by);
  // A receipt for a different target is rejected.
  const other = createHumanDecisionController();
  const otherOp = other.start(wanted);
  const tampered = { ...raw, target: { ...wanted.target, selected_account: { platform: "longbridge", key: "synthetic-b" } } };
  assert.equal(await other.receive(otherOp, { ...tampered, receipt_sha256: await humanDecisionDigest(tampered) }, true), false);
  assert.equal(other.entries()[0].status, "unresolved");
}
console.log("console load lifecycle: PASS (shell load boundary in source, request gate, decision controller: single start, unresolved/readback, session isolation, v1/v2 promotion target binding)");
