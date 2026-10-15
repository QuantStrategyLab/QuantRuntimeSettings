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


## Owner-approved revision endpoint (additive, feature-gated)
- Path: `POST /api/market-benchmark/revision`
- Auth: dedicated `MARKET_BENCHMARK_REVISION_TOKEN` only (no fallback to sync/dispatch tokens).
- If the secret is absent, the endpoint returns 503; normal sync keeps working unchanged.
- Body: approved proposal (`qsl.market_benchmark_revision_proposal.v1`) + `approved_proposal_sha256` (must match) + concrete `replacements` whose closes hash to the proposal digests.
- Effect: updates matching stored rows and appends to `market_benchmark_revision_ledger` (append-only; re-applying the same `proposal_sha256` is 409).
- Producer opt-in: `MARKET_BENCHMARK_APPLY_REVISION=true` with `MARKET_BENCHMARK_REVISION_TOKEN` and `MARKET_BENCHMARK_REVISION_PAYLOAD_JSON`. Logs are hash/ratio only.

### Applying an approved proposal from the workflow
Dispatch `Sync Market Benchmark Closes` with `apply_revision=true` and `approved_proposal_sha256=<hash>`.
The job re-fetches Yahoo closes, rebuilds the proposal and replacements in-job, and refuses unless the rebuilt
`proposal_sha256` equals the approved hash. `apply_dry_run=true` (default) logs only hashes and counts
(overwrites, deletes, untouched points) and never reads the revision token; `apply_dry_run=false` exposes
`secrets.MARKET_BENCHMARK_REVISION_TOKEN` to that single step and POSTs once. Scheduled runs keep the frozen sync path.

### Operator next steps (not done by this PR)
1. Create Cloudflare Worker secret `MARKET_BENCHMARK_REVISION_TOKEN` (and optionally a matching GitHub Actions secret for the apply job). Do not reuse sync tokens.
2. After US close on 2026-10-15 evening Asia/Shanghai, run a cloud dry-run diagnostic, generate a revision proposal for the four 2026-10-14 intraday points, and approve the `proposal_sha256`.
3. Deploy the Worker build that includes this endpoint, then submit the approved payload once.
