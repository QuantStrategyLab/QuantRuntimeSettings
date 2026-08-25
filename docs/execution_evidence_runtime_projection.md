# Runtime report to execution-evidence projection

`python/scripts/execution_evidence_projection.py` builds the input contract for
the Strategy Switch Console's read-only execution-evidence board. It is shared
across all platform runtimes; it has no broker adapter, trading API, account,
order, position, capital, credential, or network-publishing capability.

Only an eligible `runtime_report.v1` record is projected. Eligibility requires:

- an allowed platform and strategy domain;
- a self-attested `runtime_release_receipt` with a 40-character strategy
  revision;
- an internally consistent target lane (`paper` or `live`) and `dry_run`
  value; and
- a valid report timestamp.

The projection deliberately copies none of `summary`, `diagnostics`,
`artifacts`, or runtime error text. Its deployment identifier is a stable
digest, so service and account-like labels are not exposed in the console.

An eligible report proves only that this runtime loaded the displayed strategy
revision for the configured lane. It does **not** prove market-data quality,
broker acceptance, submitted orders, fills, positions, or capital usage. For
that reason every projected record sets `target_data` and `target_execution` to
`pending` and uses `parked` with
`target_execution_evidence_missing`. The projection never emits an autonomous
paper/shadow recommendation or a live approval.

The script writes a local JSON file only. A future scheduled publisher must use
a distinct `EXECUTION_EVIDENCE_SYNC_TOKEN` and a least-privilege read identity
for the selected runtime-report prefix, then POST that file to
`/api/internal/sync-execution-evidence-source`. Those credentials must remain
in protected secret stores and must never be added to this repository.
