import assert from "node:assert/strict";
import {
  DEFAULT_REVISION_POLICY, planBenchmarkRevision, resolveRevisionPolicy,
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
  policy: "frozen", post_allowed: false, post_points: 0, identical_keys: 2, unseen_keys: 8,
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

console.log("market_benchmark_revision_policy_validation ok");
