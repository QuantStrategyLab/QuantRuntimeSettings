# Market benchmark history revision policy

Status: proposal, default-off, not wired into the scheduled sync.

## Background
QRS#646 diagnostics (run 38566351201): 12 candidate keys, 0 internal duplicates or
conflicts, 4 keys already stored (2 with different closes), 8 new keys, 0 POSTs.
The 409 responses are caused by historical conflicts. Scheduled sync is not restored;
a successful read-only diagnostic does not mean natural sync is restored.

## Rule (default: `frozen`)
1. A stored `(seriesId, observationDate)` close is immutable. Comparison is exact on the normalized close string.
2. Identical replays are idempotent and allowed; brand-new keys are appended.
3. If any candidate differs from stored history, the whole batch is blocked
   (`post_points = 0`). New keys are NOT posted separately; conflicts are never
   filtered out to make CI green.
4. No deletes, no overwrites. The receiver's 409 protection is unchanged.

## Opt-in: `revision_proposal`
Still writes nothing. Emits an append-only proposal (`qsl.market_benchmark_revision_proposal.v1`)
with series/close SHA-256 digests (no prices), observation date, candidate source,
`detected_at`, `status: pending_owner_review`, `applied: false`, and a deterministic
`proposal_sha256`. Applying a revision requires a separate owner-approved,
append-only revision endpoint that does not exist yet.

## Owner decisions still required
- Keep history frozen permanently, or allow traceable revisions.
- If revisions: authority source of truth, tolerance (if any), who approves, and the revision ledger/endpoint design.
- How to resolve the 2 currently differing stored keys before re-enabling the schedule.
