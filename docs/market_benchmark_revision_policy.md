# Market benchmark history revision policy

Status: wired into the sync producer with the owner-approved 0.01% tolerance.

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

## Owner-approved tolerance
- Primary source: `yahoo_chart_v8`. Relative tolerance: `0.0001` (0.01%), inclusive, exact decimal math.
- Same-source candidate within tolerance of a stored close is consistent: the stored close is KEPT,
  the candidate is not posted (no overwrite), and it is not a conflict.
- Beyond tolerance (or a different source) is still a conflict that blocks the whole batch.
- Diagnostics (run 38579381998): the 2 differing 10/09 keys were 0.000006% (^NDX) and 0.000052% (^RUT).

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
