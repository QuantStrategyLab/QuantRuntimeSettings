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

Reports older than its bounded freshness window (36 hours by default), or more
than five minutes in the future, are discarded. The output's `generated_at`
retains the oldest accepted report timestamp rather than the collector time, so
collection cannot make old evidence appear current.

The script writes a local JSON file only. The reusable composite Action at
`actions/publish-runtime-execution-evidence` performs the optional publishing
step. Its caller must first authenticate with its existing GitHub OIDC
workload identity, and must provide a distinct
`EXECUTION_EVIDENCE_SYNC_TOKEN` through the protected Actions secret store.
The Action lists at most 100 recent report objects, reads no report outside the
configured platform prefix, and POSTs only the generated snapshot to
`/api/internal/sync-execution-evidence-source`. It does not need or create a
long-lived GCP key. Credentials and runtime-report object URLs must never be
added to this repository or emitted to logs.
