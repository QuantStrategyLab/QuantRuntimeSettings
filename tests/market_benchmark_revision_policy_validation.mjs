import assert from "node:assert/strict";
import {
  DEFAULT_REVISION_POLICY, PRIMARY_SOURCE, RELATIVE_TOLERANCE, planBenchmarkRevision,
  resolveRevisionPolicy, withinRelativeTolerance,
} from "../scripts/market_benchmark_revision_policy.mjs";

const pt = (date, close, seriesId = "S1") => ({ seriesId, observationDate: date, close, source: "synthetic" });
const AT = "2026-10-14T00:00:00Z";

// Default is frozen and off.
assert.equal(DEFAULT_REVISION_POLICY, "frozen");
assert.equal(resolveRevisionPolicy(undefined), "frozen");
assert.equal(resolveRevisionPolicy(""), "frozen");
assert.throws(() => resolveRevisionPolicy("overwrite"), /benchmark_revision_policy_invalid/);
assert.throws(() => resolveRevisionPolicy("delete"), /benchmark_revision_policy_invalid/);

// Counterexample 1: shape of run 38566351201 (12 keys, 4 overlap, 2 differ, 8 new).
const stored = [pt("2026-10-09", "100"), pt("2026-10-10", "101"), pt("2026-10-13", "102"), pt("2026-10-14", "103")];
const cands = [
  pt("2026-10-09", "100"), pt("2026-10-10", "101"), pt("2026-10-13", "102.5"), pt("2026-10-14", "103.5"),
  ...["S2", "S3"].flatMap((s) => ["2026-10-09", "2026-10-10", "2026-10-13", "2026-10-14"].map((d) => pt(d, "1", s))),
];
const frozen = planBenchmarkRevision(cands, stored);
assert.deepEqual({ ...frozen, revision_proposal: undefined }, {
  policy: "frozen", post_allowed: false, post_points: 0, identical_keys: 2, unseen_keys: 8, tolerated_keys: 0,
  differing_keys: 2, deletes: 0, overwrites: 0, block_reason: "frozen_history_conflict", revision_proposal: undefined,
});
assert.equal(frozen.revision_proposal, null);

// Counterexample 2: no partial POST of new keys when any conflict exists (no filtering to go green).
assert.equal(planBenchmarkRevision([pt("2026-10-09", "100.01"), pt("2026-10-15", "5")], [pt("2026-10-09", "100")]).post_points, 0);

// Counterexample 3: string-exact comparison; "100" vs "100.0" is a conflict, not silently equal.
assert.equal(planBenchmarkRevision([pt("2026-10-09", "100.0")], [pt("2026-10-09", "100")]).post_allowed, false);

// Clean idempotent replay and pure append are allowed.
const clean = planBenchmarkRevision([pt("2026-10-09", "100"), pt("2026-10-15", "5")], [pt("2026-10-09", "100")]);
assert.equal(clean.post_allowed, true);
assert.equal(clean.post_points, 2);

// Internal duplicates fail closed.
assert.throws(() => planBenchmarkRevision([pt("2026-10-09", "1"), pt("2026-10-09", "2")], []), /benchmark_candidate_conflicting_key/);
assert.throws(() => planBenchmarkRevision([], [pt("2026-10-09", "1"), pt("2026-10-09", "1")]), /benchmark_stored_duplicate_key/);

// Opt-in proposal: still blocked, never applied, hashes not prices, deterministic.
assert.throws(() => planBenchmarkRevision(cands, stored, { policy: "revision_proposal" }), /detected_at_required/);
const prop = planBenchmarkRevision(cands, stored, { policy: "revision_proposal", detectedAt: AT });
assert.equal(prop.post_allowed, false);
assert.equal(prop.post_points, 0);
assert.equal(prop.overwrites, 0);
assert.equal(prop.deletes, 0);
assert.equal(prop.revision_proposal.applied, false);
assert.equal(prop.revision_proposal.status, "pending_owner_review");
assert.equal(prop.revision_proposal.entries.length, 2);
const serialized = JSON.stringify(prop);
for (const price of ["102.5", "103.5", "\"102\"", "\"103\""]) assert.equal(serialized.includes(price), false);
const again = planBenchmarkRevision([...cands].reverse(), [...stored].reverse(), { policy: "revision_proposal", detectedAt: AT });
assert.equal(again.revision_proposal.proposal_sha256, prop.revision_proposal.proposal_sha256);

// Proposal mode with no conflicts produces no proposal.
assert.equal(planBenchmarkRevision([pt("2026-10-09", "100")], [pt("2026-10-09", "100")], { policy: "revision_proposal", detectedAt: AT }).revision_proposal, null);

// Owner-approved 0.01% tolerance (exact decimal math, inclusive boundary).
assert.equal(PRIMARY_SOURCE, "yahoo_chart_v8");
assert.equal(RELATIVE_TOLERANCE, "0.0001");
assert.equal(withinRelativeTolerance("100", "100.01"), true); // exactly +0.01%
assert.equal(withinRelativeTolerance("100", "99.99"), true); // exactly -0.01%
assert.equal(withinRelativeTolerance("100", "100.0100000001"), false); // just above
assert.equal(withinRelativeTolerance("100", "99.9899999999"), false); // just below
assert.equal(withinRelativeTolerance("20000", "20002"), true);
assert.equal(withinRelativeTolerance("20000", "20002.000001"), false);
assert.equal(withinRelativeTolerance("100", "100.0"), true);
assert.throws(() => withinRelativeTolerance("1e2", "100"), /benchmark_close_not_decimal/);

const ypt = (date, close, seriesId = "S1") => ({ seriesId, observationDate: date, close, source: PRIMARY_SOURCE });
const tol = { relativeTolerance: RELATIVE_TOLERANCE };
// Within tolerance: consistent, stored value kept, tolerated key NOT posted.
const tolPlan = planBenchmarkRevision(
  [ypt("2026-10-09", "100.01"), ypt("2026-10-09", "100", "S2"), ypt("2026-10-12", "7")],
  [ypt("2026-10-09", "100"), ypt("2026-10-09", "100", "S2")], tol);
assert.equal(tolPlan.post_allowed, true);
assert.equal(tolPlan.tolerated_keys, 1);
assert.equal(tolPlan.differing_keys, 0);
assert.equal(tolPlan.overwrites, 0);
assert.equal(tolPlan.block_reason, null);
assert.deepEqual(tolPlan.post_candidates.map((p) => `${p.seriesId}|${p.observationDate}|${p.close}`).sort(),
  ["S1|2026-10-12|7", "S2|2026-10-09|100"]);
assert.equal(Object.keys(tolPlan).includes("post_candidates"), false);
// Beyond tolerance: still blocks the whole batch (no partial POST).
const overPlan = planBenchmarkRevision([ypt("2026-10-09", "100.0100001"), ypt("2026-10-12", "7")], [ypt("2026-10-09", "100")], tol);
assert.equal(overPlan.post_allowed, false);
assert.equal(overPlan.post_points, 0);
assert.equal(overPlan.post_candidates.length, 0);
assert.equal(overPlan.block_reason, "frozen_history_conflict");
assert.equal(planBenchmarkRevision([ypt("2026-10-09", "100.0100001")], [ypt("2026-10-09", "100")],
  { ...tol, policy: "revision_proposal", detectedAt: AT }).revision_proposal.entries.length, 1);
// Tolerance only applies to the primary source.
assert.equal(planBenchmarkRevision([pt("2026-10-09", "100.001")], [pt("2026-10-09", "100")], tol).post_allowed, false);
// Default (no tolerance option) stays exact.
assert.equal(planBenchmarkRevision([ypt("2026-10-09", "100.001")], [ypt("2026-10-09", "100")]).post_allowed, false);

console.log("market_benchmark_revision_policy_validation ok");
