# Offline reconciliation split preview

This companion consumer accepts the synthetic observation envelope emitted by
BinancePlatform. It runs on loopback with Node.js 22 or later and built-in modules
only. It does not import or change production Worker routing, embedded console
assets, account configuration, recovery schemas, or decision handlers. Its files
are outside the production console deployment path filter. Only ordinary test CI
is needed; no deployment, credentials, IAM or cloud resources are part of it.

## Open the split page

From this repository:

```sh
node scripts/offline_reconciliation_console.mjs \
  --mode mock \
  --observation tests/fixtures/reconciliation_observation/matched.json \
  --historical tests/fixtures/reconciliation_observation/historical-recovery.json \
  --now 2000-01-01T00:02:00Z
```

Open `http://127.0.0.1:4185/`. The page shows **当前观察** (current observation)
and **历史恢复审批材料** (historical recovery approval materials) separately.
Each section loads independently and has its own status. Expand the JSON views
to inspect the exact payload. There are no approve, prepare or activate actions.

Use `--observation /path/to/observation.json` to consume output from the producer
instead of the checked-in golden fixture. Paths are local synthetic files only;
do not download real account data or September production records to this mock.
For additional scenarios replace `matched.json` with `mismatched.json`,
`missing-ledger.json`, `missing-reference.json` or `busy.json`.
Missing ledger/reference displays **无法比较** (not comparable), never invented
balances. All examples are fictional, including the September 1999 recovery.
The actual September production pack is never read or modified.

Read APIs:

| Local route | Response |
| --- | --- |
| `GET /api/reconciliation-observations` | Validated synthetic observation; independent read-time freshness. |
| `GET /api/reconciliation-recovery` | Historical fixture unchanged, including timestamps, decision, errors and stale status. |
| `GET /api/reconciliation-overview` | `current_observation` and `historical_recovery_approval_materials` as separate fields. |

Omit either input to simulate an unavailable section. Its individual route returns
503; the combined route still returns the other section. All POST/other mutation
methods return 405, including proposed publisher and existing trading/recovery
paths. Unknown routes return 404. Host/origin checks reject external embedding
and cross-origin reads; this is a loopback development preview, not an
authenticated production service. Stop it with Ctrl+C when finished.

The simulated clock is explicit. Without `--now`, current UTC is used and old
observations become stale; timestamps are never refreshed. This mock consumer
uses a 1,800-second age budget, 300-second acquisition window and 300-second
future-clock allowance. Historical status is never recomputed or auto-cleared.
These constants neither inspect nor change deployed recovery TTL settings.

## Contract and fixture provenance

`qsl_reconciliation_observation_source_snapshot.v1` has exact envelope fields
`schema_version`, `source_id`, `generated_at`, `computed_at`, `data_status`,
`observations`, `errors` and `policy`. This slice permits only
`binance.reconciliation_observation.mock`, one `binance` / `synthetic` observation,
synthetic scope/profile/version labels and opaque fixture observation/report IDs.
Unknown fields, reason codes, timestamps, executable policy and live environment
are rejected. Maximum input size is 128 KiB. It accepts no inbound publisher writes.

The fixed policy is `purpose=observation_only`, `no_order=true`,
`execution_authority_granted=false`. A comparable result requires complete
coverage, one sample, acquisition timestamps, a reference version and durable
report ID. `incomparable` requires partial/no coverage, zero complete samples and
an explicit reason; missing reference, report or observation dates may be null.
Both matched and mismatched results can be ready, and either can age to stale.
An observation is never a recovery candidate or human decision material.

Golden observation fixtures were generated from BinancePlatform's corresponding
input fixtures using `collect_mock_observation` and the explicit simulated clock
above. Regenerate them with the producer CLI and fresh temporary report
directories, then copy only its redacted synthetic stdout into the corresponding
fixture. No external data, production identity, hashes or account aliases are used.

```sh
node tests/offline_reconciliation_console_validation.mjs
```

The validation job runs this test. It exercises strict contract rejection,
freshness, UI rendering, the split API, preserved historical JSON, unavailable
sections and rejected mutation paths. Existing production recovery tests continue
unchanged in the normal repository CI.

## Replace mock with live later

`--mode live` is rejected. This server is not a deployment or authentication
template. A later approved implementation must configure a distinct live source,
target/environment and private account binding, dedicated source-bound publisher
credential, observation-only atomic storage, and target-authorized read API.
Only then should the production console use that authenticated observation read
alongside its existing recovery read. Keep their statuses independent and retain
the historical pack's original stale hint under the current user decision.

The producer additionally needs the approved cloud environment/egress, dedicated
Binance read-only key and permission verification, exact reference/ledger scope,
retention and cost cap. Confirm effective deployed TTL before choosing cadence;
start with one separately approved manual cloud execution and a disabled schedule.
Approval for that work is separate from this mock PR. No prepare/live workflow,
shared trading state, recovery publisher or control writes may be reused.
