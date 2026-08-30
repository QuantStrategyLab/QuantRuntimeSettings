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
