# Snapshot completeness

`python/scripts/snapshot_completeness.py` audits private daily archives in a
Cloud Run Job. It checks the requested window independently of stored samples,
so an empty archive, a leading gap and a trailing outage remain visible. It does
not call a trading or runtime-control route. The CLI refuses to run outside a
Cloud Run Job; offline tests inject storage, history and notification clients.

## Date and field contract

Supply a private configuration file through `SNAPSHOT_COMPLETENESS_CONFIG`.
The [synthetic configuration example](../examples/snapshot-completeness.example.json)
shows the shape; its one-day calendar deliberately cannot pass a rolling
production audit. Replace it with verified private configuration before approval.
`window_days` defaults to 30 and is bounded to 366. The end is the previous UTC
date, preserving 30 complete dates rather than counting the unfinished current
day; only dates whose collection deadline has passed are expected. A continuous
UTC calendar is used for crypto. Exchange calendars must include `id`, `source`,
`timezone`, inclusive `start`/`end`, and the authoritative `sessions` list of
`date` and timezone-aware `close_at`. Set `grace_seconds` for the collector's
publication deadline. Published close instants carry holidays, early closes and
DST; the guard never substitutes weekdays for an unavailable exchange calendar.
Calendar coverage must span the requested window or the target is unknown.

Account region does not identify its trading market. Select the calendar from
the broker account's actual covered instruments and collection contract. A
multi-market account needs its explicitly approved combined session calendar.
Session snapshots must be observed on that local session date after close.
Continuous-calendar snapshots retain their original UTC date. Use an actual
broker as-of timestamp for historical statements; do not relabel collection time.

The protected `targets` inventory includes every account/binding to audit.
Platforms are `longbridge`, `firstrade`, `schwab`, `ibkr`, `binance`, `alpaca`,
`qmt` and `ftmo`. `status: active` requires a complete contract; other statuses
produce `not_configured`, never a green result. Omitted platforms are also
reported as `not_configured`. The operator must reconcile this inventory
with the protected account registry before activation.

Each target declares:

- `identity`: dotted payload paths and exact values, including schema, platform,
  target and account/source-binding identity. These values stay out of Git and
  public output.
- `as_of_path`: source observation or broker historical as-of timestamp.
- `archive`: a GCS `prefix` ending in `/`, with `{date}` or `{yyyy}/{mm}/{dd}`.
  The guard lists bounded pages and reads each JSON object at its listed
  generation. `payload_path` optionally selects a nested account snapshot.
- `fields`: rules for all four groups, `cash`, `positions`, `orders`, `fills`.
  Each rule supplies `path`, `complete_path`, `complete_value`, nonempty
  `required` row paths and `numeric` row paths. Missing values, nonfinite numbers,
  unknown completeness and malformed rows fail. Actual broker-reported zero is
  valid; the guard never creates a value.
- `empty_proof`: for a legitimately empty positions/orders/fills list, supply
  `query_ok`, `row_count` and `pagination_complete` payload paths. Their values
  must be exactly `true`, integer `0` and `true`, derived from the broker query.
  An empty list plus a `complete` label alone fails. Empty cash is not a complete
  cash snapshot.

Existing platform archive shapes are selected through these explicit paths;
missing producer fields remain incomplete. Do not map an open-order-only list
to full orders, a strategy-only holding list to the whole account, or a wallet
valuation summary to asset detail. The latest observation is checked, so an old
complete record cannot hide a newer incomplete one. Access/identity failures
stop that target while other targets continue.

## Binance daily detail

The Worker now persists the entire validated `binance_account_facts.v1` report in
`binance_detail_daily`, keyed by account, source binding and UTC observation date.
The latest report for a day wins; older input and conflicting equal timestamps
are rejected. The existing DO transaction validates an immediate SQL readback
before the ingestion response can acknowledge success. This table has no TTL or
automatic deletion. The two-day latest KV cache and 366-day wallet valuation
projection keep their existing contracts.

`GET /api/internal/binance-account-facts/archive?date=YYYY-MM-DD` uses the existing
dedicated Binance facts bearer authorization and trusted binding. It returns
the private raw daily report, `404` for absence, and `503` for unavailable or
invalid data. It is not a public/session API. A guard target uses
`archive: {kind: binance_detail, url: <private archive URL>, token_env: <mounted
environment variable name>}`. Keep this bearer credential within the approved
client. Sharing it with a new job requires a separate secret/access review.
The reader currently selects the active binding; retaining a retired binding
does not automatically authorize a new client to read it.

This preserves only what the collector actually supplied: Spot and Flexible
Earn detail. Funding, Margin, Futures, Locked Earn, full orders and fills are
not invented. Existing expired KV data cannot be reconstructed from wallet
valuation history.

## Backfill and alerts

Backfill defaults off. With `backfill_enabled: true`, only `archive_missing`
may invoke a configured `history` hook. It must have
`kind: broker_readable_history`, an HTTPS `/history` or `/archive` URL,
`token_env` and `payload_path`. The method is always GET with a `date` query;
redirects are refused. Configure only a broker-readable historical statement
endpoint approved for this account. There is no shell hook, order call, current
snapshot fallback, zero fill or interpolation.

The returned payload must pass the same identity, date and four-field checks.
A new `broker-history-backfill.json` is written with generation-match zero,
then independently listed/read and compared. Existing objects are never
overwritten. Nested-envelope backfill needs a producer adapter and remains
blocked; this prevents writing a payload the archive reader cannot consume.
An absent or incomplete historical source leaves the gap unresolved. A limited
recent-order response cannot reconstruct old cash or positions.

Private reports go under `state_prefix`, using create-only writes and readback.
Telegram uses mounted `TELEGRAM_TOKEN` and `GLOBAL_TELEGRAM_CHAT_ID` values, never
Secret Manager discovery or log output. Alerts contain platform, ordinal target
number, dates and fixed reason codes; no account identifiers, resource names or
payload values. A per-day content claim precedes sending. A send with unknown
outcome is not retried automatically. An ACK means Telegram sender acceptance,
not recipient receipt. A configuration or report-storage failure attempts one
fixed failure alert without persistent deduplication; it never retries an
already attempted notification. Read/configuration failures exit nonzero;
Cloud Run job failure monitoring must remain enabled even if storage or Telegram
is down.

## Cloud activation requires owner approval

Build context is the repository root; the container definition is
`python/Dockerfile.snapshot-completeness`. No new Python package is needed.
This change creates no cloud resources, secrets, IAM bindings or schedules.
Do not add a Mac timer or execute a broker backfill during code validation.

Before activation, submit the exact private target/calendar/field mapping,
image digest, configuration mount, archive/state prefixes, service accounts,
secret references and scheduler proposal to the owner. The proposed scheduler
is hourly at minute 17 in UTC, invoking one Cloud Run Job task with no automatic
job retries. Collection grace is per target. A dedicated runtime identity needs
object list/get on source prefixes and create/get on its state prefix; approved
backfill additionally needs create on the selected archive prefix. Scheduler
invocation and mounted-secret access are separate narrowly scoped grants.

After approval, deploy the reviewed Worker and guard image, install the
protected configuration, and activate the cloud schedule. Verify a natural job
execution, private report readback, a known missing-day alert, Binance detail
readback after cache expiry, and a real-history-only recovery when available.
Report deployment, scheduler activation, sender ACK and recipient receipt
separately. Rollback pauses only the new scheduler and restores the prior
Worker/image; retain archived financial records. Any gcloud operator command
must include an explicit `--account` argument.

Storage semantics follow [Cloud Storage generation preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions)
and [Durable Object synchronous transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactions).
