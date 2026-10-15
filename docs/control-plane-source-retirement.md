# Retiring a control-plane research source

A one-shot or discontinued producer can be explicitly retired without renewing
its evidence or extending any freshness deadline. The trusted
`STRATEGY_SWITCH_CONFIG` KV key `control_plane_source_retirements` selects exact
source IDs. Source publishers cannot set this configuration through the sync API.
There is no default retirement list or source-specific exception in the Worker.

The configuration follows
[`qsl-control-plane-source-retirements.v1`](../schemas/qsl-control-plane-source-retirements.v1.schema.json):

```json
{
  "schema_version": "qsl_control_plane_source_retirements.v1",
  "retirements": [
    {
      "source_id": "example.one_shot_validation",
      "retired_at": "2026-01-01T00:00:00Z",
      "reason": "One-shot producer removed; retained as historical evidence by owner decision."
    }
  ]
}
```

This is a synthetic example. Use the actual approved source ID, recorded decision
time and a non-sensitive reason. `retired_at` records the retirement decision;
it never replaces `generated_at`, `computed_at` or an observation time. Wildcards,
duplicate IDs, future retirement times, empty reasons and malformed configuration
are rejected. Invalid or unreadable configuration makes the aggregate unavailable.

After an authorized receiver deployment, use the existing protected KV
administration path to read the current retirement list, preserve its existing
entries, and add the approved retirement. Read back the exact resulting document.
Keep `control_plane_source:<source_id>` and all decision receipts unchanged.
Receiver support must be deployed before this configuration can take effect.

`GET /api/control-plane` retains each retired source under `historical_sources`:
each entry contains the retirement metadata, the normalized original `snapshot`,
and independently computed `freshness`. A stale historical source remains stale.
Its candidates, errors and timestamps no longer enter the active aggregate, and
its candidates cannot enter the owner-decision queue. The original KV snapshot and
the existing exact-material decision receipt lookup remain available for audit.
No separate history page is added; the authenticated API exposes the history.

Active sources retain their existing TTL, schedule grace, clock-skew, candidate
freshness, duplicate detection and owner-decision protections. With no active
ready sources, the aggregate is unavailable. Once retirements are configured, an
unattributed legacy aggregate cannot be used as fallback to resurrect retired
evidence. Removing the key or using an empty retirement list restores the original
aggregation and fallback behavior, including stale results for old sources.

To verify after deployment and configuration, use the existing console login and
open these same-origin GET URLs without exporting the session:

1. `/api/control-plane`: the retired source appears only in `historical_sources`,
   with the recorded reason and unchanged evidence timestamps. Its
   `freshness.data_status` can remain `stale`. If all active sources are fresh,
   aggregate `data_status` is `ready` and aggregate times come from active sources.
2. `/api/owner-decisions`: `data_status` is `ready` when active sources are ready;
   `control_plane_not_ready` and `control_plane_source_stale` must not be caused
   by the retired source. An empty queue is valid when no current P6 decision is due.
3. Reload the console's pending decisions page. Any independent source warnings
   remain independently actionable; this change does not refresh other sources.

`node tests/owner_decision_extract_validation.mjs` includes the offline Worker API
regression. It reproduces one 35-day-old source dragging three fresh sources,
then verifies explicit retirement, retained history, active expiry/future-time
rejection, invalid configuration and the all-retired/legacy fallback cases. The
test denies external network calls and asserts zero KV writes.
