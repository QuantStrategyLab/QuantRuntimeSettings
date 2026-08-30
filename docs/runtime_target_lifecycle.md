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
