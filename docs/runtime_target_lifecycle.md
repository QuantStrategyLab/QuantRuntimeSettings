# Runtime target lifecycle snapshot

`qsl_runtime_target_lifecycle_source_snapshot.v1` records the operational
state of one exact platform target. It is deliberately separate from
`qsl_execution_evidence_source_snapshot.v1`:

- an **enabled** target continues its runtime guard and execution-heartbeat
  monitoring;
- a deliberately **disabled** target remains visible and continues no-order
  validation, rather than being misreported as an unhealthy execution target;
- either monitoring failure returns `parked`; it never changes a target's
  enabled flag, execution mode, credentials, strategy, or order permissions.

Every target record has `no_order: true`. The Worker stores only platform,
target identity, intended lane, sanitized monitor states, disposition, and
bounded reason codes. It accepts the same protected
`EXECUTION_EVIDENCE_SYNC_TOKEN` as the existing platform execution-evidence
publisher, but stores these snapshots under a separate KV prefix and exposes
them from `GET /api/runtime-target-lifecycle` only to an allowed signed-in
user.

Platform workflows call the reusable
`actions/publish-runtime-target-lifecycle` action after their existing checks.
The action only constructs and posts a sanitized status object; it has no
broker SDK, account material, or command to enable a runtime target.

## Live champion continuity

The P0–P6 lifecycle governs a **new candidate**.  It is not a daily survival
gate for an already authorised live baseline (the *champion*).  A platform
target may therefore carry a separately validated `live_continuity` object:

| State | Standard execution | Required behaviour |
| --- | --- | --- |
| `ACTIVE_LKG` | permitted | Run the frozen last-known-good baseline. |
| `ROLLBACK_LKG` | permitted | Run the previously verified compatible baseline after a rollback. |
| `ACTIVE_REDUCED` | not generically permitted | A platform-specific, pre-validated reduced-risk executor is required. |
| `RECONCILE_ONLY` | not permitted | Read positions and orders, reconcile unknown results, and submit no new standard order. |
| `RISK_REDUCTION_ONLY` | not generically permitted | Only a platform-specific, pre-validated risk-reduction executor may act. |
| `PAUSED` | not permitted | Keep health, reports, read-only monitoring and reconciliation visible; do not submit standard orders. |

`baseline_target_sha256` freezes the exact target identity, while
`baseline_kind` records whether the baseline is a previously authorised
legacy target or a release-attested target.  A changed target must receive a
new, explicitly validated baseline; it cannot silently inherit the former
champion's authority.

The external `RUNTIME_TARGET_ENABLED` control remains a second hard gate.  A
continuity state never turns an explicitly disabled target on.  Conversely,
candidate P0–P6 status does not by itself turn an `ACTIVE_LKG` target off.
This contract does not create broker permission, increase capital or
leverage, reset a hard breaker, or approve a new live target.

### Resume the existing Binance switch

The console offers a separate **Resume current live target** action for the
configured Binance legacy target. It does not use the candidate strategy form.
The authenticated request binds the current target's exact bytes; protected
`manual-binance-resume.yml` re-reads the repository variables and saves only
`RUNTIME_TARGET_ENABLED=true`. It rejects changed identity/configuration,
non-legacy targets, other platforms/scopes, a disabled recovery-control guard,
and strategy or cash edits. Existing stop/switch writers share its concurrency
group in this repository. That group is not a complete cross-workflow or
cross-repository lock. The pre-write comparison detects stale reads; it is not
an atomic CAS against an external administrator. Apply remains limited to
`refs/heads/main`.

This action restores an external setting, **not** private recovery authority.
Binance's `resolve_runtime_target_strategy` still loads and validates the
committed private recovery record and requires `ACTIVE_LKG` before execution.
Neither the console nor this workflow activates that record, changes the
frozen target, calls a trading cycle, or claims business recovery. A missing or
invalid private record still blocks the platform. The final enable submission
is an explicit operator action. For read-only verification, dispatch the same
workflow with `apply=false`; it validates current configuration without writes.

## Deployment readback (optional, backwards compatible)

A target can include `deployment` with exactly `runtime_enabled` (boolean/null),
`scheduler_state` (`enabled`, `paused`, `mixed`, `missing`, `unknown`, `not_applicable`),
`strategy_profile` (identifier/null), and `execution_mode` (existing mode/null).
Old sources remain accepted and do **not** imply an observed deployment.

The existing publisher's optional GCP adapter requires explicit project, service,
region and Scheduler location. It reads the service's single serving revision,
not a pending template, then matches Scheduler HTTP `/run` jobs to that service URL.
Multiple serving revisions, missing binding, failed reads and unknown values never
become enabled/disabled guesses. Zero matching jobs is `missing`, not paused.
Raw provider responses stay in memory. No resource, service endpoint or order is changed.
Non-GCP adapters can supply the same sanitized `deployment-json`; they must observe
the actual host process/configuration, not relabel GitHub intent as host state.

Platform lifecycle workflows refresh after the existing deployment workflow completes,
including failures. A workflow completion only triggers observation; it is not proof
that configuration was applied. The website shows desired configuration, actual switch,
Scheduler state and record time separately. This does not prove a fill or broker health.

References: [Cloud Run describe](https://docs.cloud.google.com/sdk/gcloud/reference/run/services/describe),
[Scheduler list](https://docs.cloud.google.com/sdk/gcloud/reference/scheduler/jobs/list),
[workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).

A non-GCP adapter projecting an older execution report must also include optional
`deployment.observed_at` (UTC). The server computes its freshness independently
of publication time; a newly published source cannot freshen an old runtime report.

## Dormant PAPER cycle-health companion

`POST` and `GET /api/internal/runtime-cycle-health-source` provide an isolated,
authenticated compact-evidence checkpoint in the existing `RuntimeInstances`
SQLite DO. This receiver is preparation only: every response carries
`adopted=false`, `no_order=true`, and `execution_authority_granted=false`.
It does not update the dashboard, legacy lifecycle KV, account facts, audit,
automatic diagnosis, schedules, or orders. Existing lifecycle publishers and
their endpoint continue to reject the companion member.

POST keeps the lifecycle v1 outer envelope, with exactly one `longbridge.paper`
target in `paper` mode and one additional `targets[0].cycle_health` object.
That object has exactly six members: `schema_version`, `configuration_sha256`,
`schedule`, `coverage`, `cycles`, and `resolutions`. Nonempty `resolutions` are
rejected, including digest-only reconciliation claims. QRS checks the protected
source attestation's identity, shape, chronology and completeness; it does not
collect or verify raw broker pages, evaluate cron, or grant recovery authority.

Authentication uses the existing LongBridge `ACCOUNT_FACTS_SYNC_TOKEN` verifier.
Tokens shared with another supported platform or the legacy lifecycle token
are rejected. `X-QSL-Source-Binding-ID` must match the existing protected PAPER
account-facts binding. The lifecycle ID resolves through exactly one protected
account option's `runtime_status_target_id`, across all platforms, then joins to
that option's facts binding. The facts `target_id` is a separate identifier; it
is never inferred from or equated with `longbridge.paper`. Console account keys
are resolved from configuration and are never supplied by the caller.

The independent `runtime_cycle_health_source` admission row binds a single
source ID to the lifecycle target, SHA-256 of the normalized protected binding
plus lifecycle ID, exact configuration digest, positive authority revision,
and canonical `required_from` coverage origin. Absence or conflict rejects
both reads and writes. A narrow `POST /api/internal/runtime-cycle-health-admission`
provisioning operation now uses the existing internal sync credential, and
rejects it if it aliases an account-facts or execution-evidence source token.
The operation resolves the requested binding from protected account options
and account-facts bindings; the source endpoint cannot call it with its own
account-facts token. It requires an expected authority revision, creates the
first row at revision 1, treats an exact retry as unchanged, and performs
updates with a transactionally checked revision. It never accepts an
`admitted` or `verified` request flag and never marks a source healthy.
Its response status describes only the provisioning operation (`admission_configured`
or `admission_unchanged`), not the runtime checkpoint.

The provision request contains exactly `source_id`, `target_id`,
`configuration_sha256`, `required_from`, and `expected_authority_revision`; the
binding ID is supplied in the existing `X-QSL-Source-Binding-ID` header and
must match the protected LongBridge PAPER binding. The operator must obtain
the source configuration digest and baseline origin from independently
reviewed, protected serving/job configuration before this privileged call;
the Worker cannot inspect the LB deployment. A baseline can only stay the
same or expand earlier after provisioning, never move later to clip old
history. Binding changes reset only that binding's observation watermark and
keep the prior checkpoint partition visible with unconfirmed continuity.
Reusing a previously retained binding partition is rejected until a reviewed
history migration can safely restore its matching watermark and checkpoint.
Source IDs remain stable; replacing one is rejected until a reviewed history
migration exists. The first complete source observation, not provisioning,
establishes the coverage baseline. These operations remain production-blocked
until the real source, configuration, binding and baseline are read back and
independently authorized.

The lifecycle publisher action now has a default-off `publish-cycle-health`
option for this one prepared transport. It accepts a path to an already
source-validated six-member package and the exact existing PAPER
`source_binding.id`, which must come only from protected secret storage or
private workflow configuration. Never expose it as a `workflow_dispatch`
input or log value. It does not collect source data, create admission, or
fall back to the legacy lifecycle endpoint if opted-in publishing fails. The
opt-in path uses LongBridge `ACCOUNT_FACTS_SYNC_TOKEN`, POSTs to the companion,
validates the durable ACK against the exact request digest and identity, then
GETs and checks the returned source, target, digest, observation time, and
revisions against that ACK. Tokens are carried in a permission-restricted
temporary header file. The receiver rejects production writes until the
independent serving source, configuration, binding and baseline are admitted.
Companion HTTP calls have 10-second connect and 30-second total time limits;
POST and GET bodies are each capped at 1 MiB before being written to the
temporary response file.

`generated_at = computed_at` records when this source snapshot was actually
collected and generated; it does not move back to the historical page cutoff.
The existing 36-hour observation age gate and independent five-minute
future-skew allowance continue to govern freshness. `coverage.from` and
`coverage.through` describe the historical interval queried in this packet:
the interval must be ordered, `through` cannot be after `computed_at`, and cycle
schedule/completion evidence cannot extend beyond `through`. Schedule timing
and observation ordering still use `computed_at`. Canonical UTC instants use
seconds or exactly six nonzero microseconds, matching Python
`datetime.isoformat()` and cycle-ID hashing; millisecond-only, offset,
impossible-calendar and rounded representations are rejected. This allows a
fresh source to deliver a bounded historical page without presenting an old
coverage cutoff as a current observation.
An individual source scan is complete only with a terminal page, no cap, no
errors, equal bounded listed/read counts, and coverage of the admitted origin.
The receiver separately maintains `covered_through`, the latest continuously
acknowledged coverage boundary. The first complete scan must cover
`required_from`; later complete scans must start at or before the previous
`covered_through` and reach at least that boundary. Partial scans and gaps keep
the previous watermark and return `coverage_complete=false` with a fixed
`coverage_incomplete_reason`. `observed_at` remains the source packet time and
never acts as a coverage cursor. A configuration, baseline or binding change
cannot inherit the previous coverage watermark; a new complete scan must
re-establish it.

Normalization and hashing happen before the synchronous DO transaction. That
transaction rechecks authority revision, protected fingerprint, configuration
and coverage origin, then commits the source observation watermark and the
target/binding checkpoint together. Older observations fail; equal instants
with different canonical content conflict; equal identical replay returns
`unchanged` without renewing the original receipt/freshness timestamp. POST's
`qsl_runtime_cycle_health_ack.v1` response is returned only after commit, with
`result=stored|unchanged`, source/target, observation digest, original observation
time, receipt time, authority/checkpoint revisions, and the three coverage
fields (`covered_through`, `coverage_complete`, `coverage_incomplete_reason`).
Both ACK and GET also return the admitted `configuration_sha256` and the
authenticated `source_binding_id` at top level, including while the checkpoint
is still uninitialized; clients can verify the first request before a baseline
has been established.
An incomplete coverage result is still a committed observation; callers must
not advance their collection cursor unless `coverage_complete=true`. GET
requires `source_id` and `target_id` query parameters, optionally accepts one
`history_cursor`, and uses the same authentication/binding. It returns the same
durable digest, revisions and coverage fields in
`qsl_runtime_cycle_health_checkpoint.v2`.

Incomplete scans, closed sessions, no-due/empty packets and later success never
clear old faults. Each incident retains stable receipt attempts, highest
severity, independent latest-fault watermark and unresolved status. Exact fault
replays preserve existing proof associations; newly discovered old faults stay
unresolved. Same-binding configuration changes keep old attempt provenance;
the new configuration starts without inherited coverage and can establish a
new baseline only from a complete scan of its admitted origin.
Binding changes preserve the exact old partition and expose `prior_partitions`
with `continuity=unconfirmed` and `status=blocked`, including when the new
partition is empty. The summary checkpoint stores counts and the latest fault
watermark; detailed fault attempts live in append-only
`runtime_cycle_health_attempt` rows grouped by
`runtime_cycle_health_incident`. New packets remain limited to 20 cycles, while
the lifetime archive has no incident/attempt cap and never evicts a fault.
Legacy JSON checkpoints migrate every attempt in the same SQLite transaction
as the read; malformed legacy state rejects the read and rolls back the whole
migration. A valid legacy checkpoint without independently provable coverage
starts with `covered_through=null` and `coverage_complete=false`.

GET v2 returns a summary and one bounded history page (at most 50 attempts),
not a truncated reducer checkpoint. The page has a fixed
`snapshot_through_id`; `next_cursor` advances by stable keyset order within
that high-water snapshot. Pass it as `history_cursor` to fetch the next page.
Each page item includes its binding fingerprint and continuity label so a
retained prior binding remains `unconfirmed`; callers must not merge it into a
current binding as if identity continuity were proven. `history_page.complete`
means only that this page walk reached its snapshot high-water. It does not
mean the health checkpoint is complete or faults are resolved. Read status is
explicit (`uninitialized`, `incomplete`, `complete`, `blocked`, or `stale`); it
is never a production health label.

`tests/fixtures/runtime_cycle_health.v1.synthetic.json` is newly regenerated
synthetic evidence, **not** the unavailable earlier frozen fixture. Its real
generator was LongBridgePlatform `scripts/runtime_cycle_health.py` at
`3e16a31a6d9f5bab50075aa957ac61bcd3627c41`, with the locked QPK source
`d38627002345fb0e90adc83422c553d3299567d2`. Provenance, helper hash, generation
method and review/freeze state are recorded in the fixture. No real account,
credentials, broker, cloud metadata or financial data were read. The fixture
includes actual Python projections, reference reducer results and second/six
microsecond cycle-ID vectors. The focused validators are imported by the
existing Worker validation suite; they cover strict negative cases, concurrent
ordering, receipt replay, commit-only ACK, real SQLite abort/rollback, restart,
configuration/binding history, >20-attempt archival, stable snapshot paging,
continuous-coverage gaps/resumption, exact migration of the former 20-by-20
checkpoint envelope and rollback of malformed legacy migrations. Integration uses the existing
offline host guard, `cf:false`, disabled metadata fetching and a rejecting Worker
outbound hook; local workerd loopback is the only allowed network communication.

```sh
node tests/runtime_cycle_health_validation.mjs
node tests/runtime_cycle_health_worker_validation.mjs
```
