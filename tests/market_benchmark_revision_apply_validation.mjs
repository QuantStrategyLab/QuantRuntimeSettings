import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  planBenchmarkRevision, PRIMARY_SOURCE,
} from "../scripts/market_benchmark_revision_policy.mjs";
import {
  planRevisionApply, revisionApplyLogSummary, MarketBenchmarkRevisionError,
  REVISION_LEDGER_SCHEMA,
} from "../web/strategy-switch-console/infrastructure/market_benchmark/market_benchmark_revision.js";

const digest = (value) => createHash("sha256").update(String(value)).digest("hex");
const AT = "2026-10-15T12:00:00Z";
const pt = (date, close, seriesId = "标普500") => ({
  seriesId, observationDate: date, close, source: PRIMARY_SOURCE,
});

const stored = [pt("2026-10-14", "100.0"), pt("2026-10-14", "200.0", "纳斯达克100")];
const candidates = [pt("2026-10-14", "100.5"), pt("2026-10-14", "201.0", "纳斯达克100")];
const proposalPlan = planBenchmarkRevision(candidates, stored, {
  policy: "revision_proposal", detectedAt: AT,
});
const proposal = proposalPlan.revision_proposal;
assert.equal(proposal.entries.length, 2);

// Reject without approved hash.
assert.throws(() => planRevisionApply({
  proposal, approvedProposalSha256: "", replacements: candidates, storedPoints: stored, digest, appliedAt: AT,
}), (error) => error instanceof MarketBenchmarkRevisionError && error.code === "benchmark_revision_approval_required");
assert.throws(() => planRevisionApply({
  proposal, approvedProposalSha256: "0".repeat(64), replacements: candidates, storedPoints: stored, digest, appliedAt: AT,
}), (error) => error instanceof MarketBenchmarkRevisionError && error.code === "benchmark_revision_approval_mismatch");

// Happy path: ledger is append-only shaped, hashes only.
const applied = planRevisionApply({
  proposal,
  approvedProposalSha256: proposal.proposal_sha256,
  replacements: candidates,
  storedPoints: stored,
  digest,
  appliedAt: AT,
});
assert.equal(applied.overwrites, 2);
assert.equal(applied.deletes, 0);
assert.equal(applied.ledger_entries.length, 2);
assert.equal(applied.ledger_entries[0].schema_version, REVISION_LEDGER_SCHEMA);
assert.equal(applied.ledger_entries[0].proposal_sha256, proposal.proposal_sha256);
for (const entry of applied.ledger_entries) {
  assert.equal("close" in entry, false);
  assert.equal(typeof entry.prior_close_sha256, "string");
  assert.equal(typeof entry.new_close_sha256, "string");
  assert.match(entry.prior_close_sha256, /^[a-f0-9]{64}$/);
}
const summary = revisionApplyLogSummary(applied);
const summaryText = JSON.stringify(summary);
assert.equal(summaryText.includes("100.5"), false);
assert.equal(summaryText.includes("201.0"), false);
assert.equal(summaryText.includes("100.0"), false);
assert.equal(summary.overwrites, 2);

// Re-applying the same proposal is rejected (append-only ledger).
assert.throws(() => planRevisionApply({
  proposal,
  approvedProposalSha256: proposal.proposal_sha256,
  replacements: candidates,
  storedPoints: stored,
  digest,
  appliedAt: AT,
  previouslyAppliedProposalSha256s: [proposal.proposal_sha256],
}), (error) => error instanceof MarketBenchmarkRevisionError && error.code === "benchmark_revision_already_applied");

// Wrong replacement close (hash mismatch) rejected.
assert.throws(() => planRevisionApply({
  proposal,
  approvedProposalSha256: proposal.proposal_sha256,
  replacements: [pt("2026-10-14", "999"), pt("2026-10-14", "201.0", "纳斯达克100")],
  storedPoints: stored,
  digest,
  appliedAt: AT,
}), (error) => error instanceof MarketBenchmarkRevisionError && error.code === "benchmark_revision_candidate_mismatch");

console.log("market_benchmark_revision_apply_validation ok");
