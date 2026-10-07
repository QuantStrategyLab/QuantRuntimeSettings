// Pure projection tests: no Miniflare, child process, listener or network transport.
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
let externalAttempts = 0;
const denied = () => { externalAttempts += 1; throw new Error("pure_test_network_forbidden"); };
const originals = { fetch: globalThis.fetch, connect: net.Socket.prototype.connect, httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get };
globalThis.fetch = denied; net.Socket.prototype.connect = denied;
http.request = denied; http.get = denied; https.request = denied; https.get = denied; syncBuiltinESMExports();
try {
  const { __test } = await import("../web/strategy-switch-console/worker.js");
  const ticket = __test.normalizeResearchPromotionTicket({ ticket_id: "pure-review", strategy_profile: "synthetic", domain: "us_equity", state: "awaiting_human", proposed_params: { threshold: 2 }, shadow_passed: true, shadow_evidence_kind: "synthetic", notes: ["evidence_sha256=original"], suggested_risk_profile: "CAPITAL_PRESERVATION" });
  ticket.research_summary = { comparison: { status: "comparable", cost_model: "frozen", candidate: { cagr: 0.1 } }, limitations: ["synthetic limitation"], ai_explanation: { provider: "synthetic", model: "fixture", binding: { notes: ["original"] } } };
  const key = await __test.researchPromotionMaterialKey(ticket);
  const review = await __test.researchPromotionReviewBinding(ticket);
  const mutations = [
    t => { t.notes = ["evidence_sha256=changed"]; },
    t => { t.research_summary.comparison.candidate.cagr = 0.2; },
    t => { t.research_summary.comparison.cost_model = "changed"; },
    t => { t.research_summary.limitations.push("new limit"); },
    t => { t.research_summary.ai_explanation.binding.notes = ["changed"]; },
    t => { t.budget = { max_trials: 2 }; }, t => { t.search_iterations += 1; },
    t => { t.drift_score = 0.3; }, t => { t.notification_body = "changed review text"; },
    t => { t.suggested_risk_profile = "BALANCED_COMPOUNDING"; },
  ];
  for (const change of mutations) {
    const changed = structuredClone(ticket); change(changed);
    assert.equal(await __test.researchPromotionMaterialKey(changed), key, "legacy index remains unchanged");
    assert.notEqual((await __test.researchPromotionReviewBinding(changed)).review_sha256, review.review_sha256, "full saved review changes its separate binding");
  }
  assert.deepEqual(await __test.researchPromotionReviewBinding({ ...ticket, updated_at: "later observation", created_at: "earlier observation", state: "human_rejected", human_decided_at: "later decision" }), review, "observation/terminal metadata is not producer review material");
  const target = { selected_account: null, confirmation: null };
  const savedTicket = { ...ticket, human_decision: "reject", human_decided_at: "2026-10-07T00:00:00Z", state: "human_rejected", notes: [...ticket.notes, "human_rejected"] };
  const record = { request_key: "pure", kind: "promotion", subject_id: ticket.ticket_id, material_key: key, action: "reject", actor: "synthetic-admin", decided_at: savedTicket.human_decided_at, target_json: JSON.stringify(target), payload: { ticket: savedTicket, selected_account: null, confirmation: null, review_material: __test.researchPromotionReviewMaterial(ticket), review_binding: review } };
  const expected = { kind: "promotion", subject_id: ticket.ticket_id, material_sha256: key, review_binding: review, action: "reject", target, principal_scope: "a".repeat(64), request_id: "pure", started_at: record.decided_at };
  const receipt = await __test.humanDecisionReceipt(record, expected);
  assert.equal(receipt.schema_version, "qsl_human_decision_receipt.v2"); assert.deepEqual(receipt.review_binding, review);
  assert.equal(receipt.review_binding.review_sha256, review.review_sha256);
  const corrupt = structuredClone(record); corrupt.payload.review_material.notes = ["different persisted material"];
  await assert.rejects(() => __test.humanDecisionReceipt(corrupt, expected), /receipt_unavailable/);
  const historical = structuredClone(record); delete historical.payload.review_binding; delete historical.payload.review_material;
  const oldReceipt = await __test.humanDecisionReceipt(historical, expected);
  assert.equal(oldReceipt.schema_version, "qsl_human_decision_receipt.v1"); assert.equal(oldReceipt.review_binding, undefined);
  assert.equal(historical.material_key, key, "historical material index not rekeyed");
  assert.notDeepEqual(oldReceipt.review_binding, expected.review_binding, "legacy receipt is observable but not v2 qualified");
  assert.equal(externalAttempts, 0);
  console.log("pure decision review material validation passed", { network_attempts: externalAttempts, miniflare_loaded: false });
} finally {
  globalThis.fetch = originals.fetch; net.Socket.prototype.connect = originals.connect;
  http.request = originals.httpRequest; http.get = originals.httpGet; https.request = originals.httpsRequest; https.get = originals.httpsGet; syncBuiltinESMExports();
}
