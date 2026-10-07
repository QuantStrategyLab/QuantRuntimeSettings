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
both reads and writes. There is no production admission initializer, setter,
caller-supplied `verified` flag, or self-registration endpoint in this batch.
Only test subclasses seed synthetic admission. Provisioning the real serving
source, configuration, binding and baseline remains a separately authorized
prerequisite before transport or dashboard adoption.

`computed_at = generated_at = coverage.through` preserves original collection
time. Canonical UTC instants use seconds or exactly six nonzero microseconds,
matching Python `datetime.isoformat()` and cycle-ID hashing. Millisecond-only,
offset, impossible-calendar and rounded representations are rejected. The
existing 36-hour observation age gate and independent five-minute future-skew
allowance govern reception/read freshness; they do not define cadence, deadline
or retention. A fresh observation may report a late-discovered older fault.
Read completeness requires a terminal page, no cap, no errors, equal bounded
listed/read counts, and coverage of the independent required origin. A cap
remains incomplete even if counts happen to match.

Normalization and hashing happen before the synchronous DO transaction. That
transaction rechecks authority revision, protected fingerprint, configuration
and coverage origin, then commits the source observation watermark and the
target/binding checkpoint together. Older observations fail; equal instants
with different canonical content conflict; equal identical replay returns
`unchanged` without renewing the original receipt/freshness timestamp. POST's
`qsl_runtime_cycle_health_ack.v1` response is returned only after commit, with
`result=stored|unchanged`, source/target, observation digest, original observation
time, receipt time, and authority/checkpoint revisions. GET requires exactly
`source_id` and `target_id` query parameters plus the same authentication/binding
and returns the same durable digest, revisions and checkpoint in
`qsl_runtime_cycle_health_checkpoint.v1`.

Incomplete scans, closed sessions, no-due/empty packets and later success never
clear old faults. Each incident retains stable receipt attempts, highest
severity, independent latest-fault watermark and unresolved status. Exact fault
replays preserve existing proof associations; newly discovered old faults stay
unresolved. Same-binding configuration changes keep old attempt provenance and
leave the first new configuration observation's coverage baseline unestablished.
Binding changes preserve the exact old partition and expose `prior_partitions`
with `continuity=unconfirmed` and `status=blocked`, including when the new
partition is empty. Twenty incidents/attempts are the bounded checkpoint limit;
overflow rejects the entire transaction and requests history capacity support,
without eviction. Read status is explicit (`uninitialized`, `incomplete`,
`complete`, `blocked`, or `stale`); it is never a production health label.

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
configuration/binding history and capacity. Integration uses the existing
offline host guard, `cf:false`, disabled metadata fetching and a rejecting Worker
outbound hook; local workerd loopback is the only allowed network communication.

```sh
node tests/runtime_cycle_health_validation.mjs
node tests/runtime_cycle_health_worker_validation.mjs
```
