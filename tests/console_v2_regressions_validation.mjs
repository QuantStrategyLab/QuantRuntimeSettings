import assert from "node:assert/strict";
import { dailyReturnsFromCumulative } from "../web/strategy-switch-console/frontend/src/charts/returns.ts";
import { latestAssetBalance } from "../web/strategy-switch-console/frontend/src/lib/performance.ts";
import { humanDecisionDigest, humanDecisionExpectation, reviewedDecisionMatches } from "../web/strategy-switch-console/frontend/src/operations.ts";
import { resolveAccountChoice } from "../web/strategy-switch-console/frontend/src/pages/decisions/helpers.ts";
import { cellKind } from "../web/strategy-switch-console/frontend/src/pages/health/status.ts";
import { consoleApiFixture } from "../web/strategy-switch-console/frontend/scripts/console-api-synthetic.mjs";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const points = values => values.map((value, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, value }));

// Daily chart values are compounded returns, with no invented first-day or gap return.
const daily = dailyReturnsFromCumulative(points([0, 10, 21]));
assert.equal(daily.length, 2);
daily.forEach(point => close(point.value, 10));
assert.equal(daily[0].breakBefore, true);
assert.equal(daily[1].breakBefore, false);
close(dailyReturnsFromCumulative(points([21, 10]))[0].value, (1.1 / 1.21 - 1) * 100);
assert.deepEqual(dailyReturnsFromCumulative([]), []);
assert.deepEqual(dailyReturnsFromCumulative(points([10])), []);
const gap = points([0, 10, 21, 33.1]);
gap[1].breakBefore = true;
const afterGap = dailyReturnsFromCumulative(gap);
assert.deepEqual(afterGap.map(p => [p.date, p.breakBefore]), [[gap[2].date, true], [gap[3].date, false]]);
afterGap.forEach(point => close(point.value, 10));
for (const invalid of [NaN, Infinity, -Infinity, -101]) {
  const recovered = dailyReturnsFromCumulative(points([0, invalid, 10, 21]));
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].breakBefore, true);
  close(recovered[0].value, 10);
}
close(dailyReturnsFromCumulative(points([0, -100]))[0].value, -100);
assert.deepEqual(dailyReturnsFromCumulative(points([-100, 0])), [], "zero denominator must not become a return");
assert.deepEqual(dailyReturnsFromCumulative(points([-101, 0])), [], "negative index is invalid");
assert.deepEqual(dailyReturnsFromCumulative(points([-99.99999999999999, Number.MAX_VALUE])), [], "overflow must not enter the SVG");

// Exercise the real existing projection: its latest balance differs from its interval P&L.
const query = new URLSearchParams({ scope: "all", range: "YTD" });
const assets = consoleApiFixture("/api/performance/assets", query).body;
const summary = consoleApiFixture("/api/performance/summary", query).body;
assert.equal(latestAssetBalance(assets), 1570);
assert.equal(summary.amount, 70);
assert.notEqual(latestAssetBalance(assets), summary.amount);
assert.equal(latestAssetBalance({ ...assets, points: [...assets.points].reverse() }), 1570);
assert.equal(latestAssetBalance({ ...assets, currency: "HKD" }), 1570);
assert.equal(latestAssetBalance({ ...assets, points: points([100, 0]) }), 0);
for (const patch of [
  { status: "unknown" }, { status: "unavailable" }, { status: "read_failed" },
  { currency: null }, { unavailable_reason: "mixed_currency" }, { points: [] },
  { points: points([1570, NaN]) }, { points: points([1570, Infinity]) },
]) assert.equal(latestAssetBalance({ ...assets, ...patch }), null);
for (const status of ["partial", "stale"]) assert.equal(latestAssetBalance({ ...assets, status }), 1570);

// Bind all human decision kinds to the displayed subject, material, and optional full review.
const hash = "a".repeat(64);
const owner = { candidate: { candidate_id: "synthetic-owner" }, candidate_evidence_sha256: hash,
  decision_binding: { kind: "owner", subject_id: "synthetic-owner", material_sha256: hash } };
const recoveryMaterial = { recovery_id: "synthetic-recovery", candidate_sha256: hash, dual_review_binding_sha256: hash };
const recovery = { recovery: { recovery_id: recoveryMaterial.recovery_id, candidate_sha256: hash, dual_review: { evidence_binding_sha256: hash } },
  decision_binding: { kind: "recovery", subject_id: recoveryMaterial.recovery_id, material_sha256: await humanDecisionDigest(recoveryMaterial) } };
const promotion = { ticket_id: "synthetic-promotion", strategy_profile: "synthetic-profile", domain: "us_equity", proposed_params: { allocation: 10 },
  shadow_passed: true, shadow_evidence_kind: "paired_shadow", drift_status: "stable", drift_score: 0, budget: 2, search_iterations: 1,
  suggested_risk_profile: "CAPITAL_PRESERVATION", notification_subject: "Synthetic", notification_body: "Synthetic only", notes: [], research_summary: null };
const promotionMaterial = Object.fromEntries(["ticket_id", "strategy_profile", "domain", "proposed_params", "shadow_passed", "shadow_evidence_kind"].map(k => [k, promotion[k]]));
promotion.decision_binding = { kind: "promotion", subject_id: promotion.ticket_id, material_sha256: await humanDecisionDigest(promotionMaterial),
  review_binding: { schema_version: "qsl_promotion_review_binding.v2", review_sha256: await humanDecisionDigest({ schema_version: "qsl_promotion_review_material.v2", ...promotion }) } };
const expectations = [
  [owner, await humanDecisionExpectation("owner", owner, { candidate_id: owner.candidate.candidate_id, candidate_evidence_sha256: hash, decision: "keep_parked" })],
  [recovery, await humanDecisionExpectation("recovery", recovery, { ...recoveryMaterial, decision: "reject" })],
  [promotion, await humanDecisionExpectation("promotion", promotion, { ticket_id: promotion.ticket_id, decision: "reject", confirmation: null })],
];
for (const [source, expected] of expectations) {
  assert.ok(expected);
  const binding = source.decision_binding;
  assert.equal(reviewedDecisionMatches(binding, expected), true);
  for (const invalid of [null, {}, [], { ...binding, kind: "other" }, { ...binding, subject_id: "other-subject" },
    { ...binding, material_sha256: "b".repeat(64) }, { ...binding, material_sha256: null },
    { ...binding, review_binding: { schema_version: "qsl_promotion_review_binding.v2", review_sha256: "b".repeat(64) } },
  ]) assert.equal(reviewedDecisionMatches(invalid, expected), false, `${expected.kind}: reject changed displayed material`);
}
const promotionExpected = expectations[2][1];
for (const review_binding of [null, {}, [], { schema_version: "v1", review_sha256: promotionExpected.review_sha256 }]) {
  assert.equal(reviewedDecisionMatches({ ...promotion.decision_binding, review_binding }, promotionExpected), false, "no v2 review downgrade");
}
const changedSource = { ...owner, candidate_evidence_sha256: "b".repeat(64), decision_binding: { ...owner.decision_binding, material_sha256: "b".repeat(64) } };
const changedExpected = await humanDecisionExpectation("owner", changedSource, { candidate_id: owner.candidate.candidate_id, candidate_evidence_sha256: "b".repeat(64), decision: "keep_parked" });
assert.ok(changedExpected, "the backend-valid fresh source alone does not establish user review");
assert.equal(reviewedDecisionMatches(owner.decision_binding, changedExpected), false, "the original B1 refresh must be blocked");

const one = [{ id: "longbridge:synthetic-paper", label: "Synthetic paper" }];
assert.equal(resolveAccountChoice(one, undefined), one[0], "rendering and submission resolve the single option identically");
assert.equal(resolveAccountChoice(one, one[0].id), one[0]);
assert.equal(resolveAccountChoice([], null), null);
const many = [...one, { id: "longbridge:other-paper" }];
assert.equal(resolveAccountChoice(many, null), null);
assert.equal(resolveAccountChoice(many, "removed-account"), null);
assert.equal(resolveAccountChoice(many, many[1].id), many[1]);

const snapshot = { data_status: "historical", record: { status: "no_signal", kind: "run", completeness: "complete", runs: [{ activity: "no_signal", errors_present: false }] } };
assert.equal(cellKind(snapshot), "ok");
for (const status of ["no_submission", "no_signal", "no_rebalance", "filled"]) {
  assert.equal(cellKind({ ...snapshot, record: { ...snapshot.record, status, runs: [{ activity: status, errors_present: false }] } }), "ok");
}
for (const status of ["unknown", "submitted", "broker_acknowledged", "partially_filled", "reconciliation_required", "insufficient", "conflict", "dry_run", "shadow", "validation", "future_status"]) {
  assert.equal(cellKind({ ...snapshot, record: { ...snapshot.record, status } }), "unknown", status);
}
for (const status of ["not_due", "market_closed", "outside_window", "within_grace"]) {
  assert.equal(cellKind({ ...snapshot, record: { ...snapshot.record, status, kind: "schedule", runs: [] } }), "not-run");
}
for (const patch of [{ kind: "schedule" }, { kind: undefined }, { runs: [] }, { runs: [{ activity: "unknown", errors_present: false }] }, { runs: [{ activity: "filled" }] }]) {
  assert.notEqual(cellKind({ ...snapshot, record: { ...snapshot.record, ...patch } }), "ok");
}
for (const patch of [{ status: "failed" }, { runs: [{ activity: "no_signal", errors_present: true }] }]) {
  assert.equal(cellKind({ ...snapshot, record: { ...snapshot.record, ...patch } }), "failed");
}
assert.equal(cellKind({ ...snapshot, record: { ...snapshot.record, status: "blocked" } }), "blocked");
assert.equal(cellKind({ ...snapshot, record: null }), "no-record");
assert.equal(cellKind({ ...snapshot, data_status: "unavailable" }), "no-record");
assert.equal(cellKind({ ...snapshot, data_status: "stale" }), "stale");
assert.equal(cellKind({ ...snapshot, record: { ...snapshot.record, completeness: "incomplete" } }), "incomplete");
assert.equal(cellKind({ ...snapshot, record: { ...snapshot.record, status: "missing_report" } }), "incomplete");
assert.equal(cellKind({ ...snapshot, record: { ...snapshot.record, status: "read_incomplete" } }), "read-failed");

console.log("console_v2_regressions_validation: PASS (balances, compounded daily returns, reviewed bindings, account choice, explicit runtime outcomes; synthetic only)");
