# Desk response contracts

These draft 2020-12 schemas implement **BE-0** of the coordinator's
`API-CONTRACT.md`, draft v1 dated 2026-11-02. That document is the source of
truth. No routes, broker reads, dispatchers or execution permissions are added.

[`manifest.json`](manifest.json) maps each response to its contract section,
method/path and fixture scenarios. The optional recent-switch list has no
specified response and is deferred. Unchanged dependency endpoints listed at
the end of contract §2 are outside this inventory.

`common.json` publishes reusable `$defs`, including `Read`, enums, formats,
freshness and flat NAV variants. Typed Reads intersect `Read` with a `value`
schema. Every object closes additional properties; `Read.value` alone is
generic. Register schemas by `$id` before compilation. The example.invalid
IDs are identifiers, not remote fetch locations; no network lookup is needed.

Fixtures live in `tests/fixtures/desk/<name>.<scenario>.json`. All identities,
times and values are synthetic. `ok` describes a successful response that can
contain honest unknowns. `degraded` illustrates unavailable/stale reads,
partial jobs or reduced information. Acknowledgements and legacy envelopes
without a degraded-success shape may share their success shape; HTTP failures
use `error.json`. `empty` means a verified empty collection, never a substituted
read failure. Successful switch/reconcile request fixtures describe future
response shapes only; those operations remain disabled.

Run from the repository root:

```bash
npm ci --prefix web/strategy-switch-console
npm run test:contracts --prefix web/strategy-switch-console
```

Existing `test:operations` also runs the harness through
`tests/console_v2_operations_validation.mjs`. Frontend files are unchanged.
Ajv and ajv-formats are development dependencies only, providing complete
2020-12 reference/composition support and calendar-aware format validation.

## Coordinator defaults

| Question | Default used by fixtures and contract policy |
|---|---|
| Q1 | Re-apply saved and Adopt platform ship disabled (`not_enabled`). |
| Q2 | An unavailable broker open-orders read is `unknown`, required, and counted as blocking. |
| Q3 | Retain stored index benchmarks and legacy Chinese series IDs; no QQQ ETF source. |
| Q4 | Expiry stays `unknown/never_read` without a source. IBKR and Schwab are first priorities; these fixtures have only synthetic IBKR metadata. |
| Q5 | All preview estimates stay `unknown/not_supported`. |
| Q6 | Alerts and logs retain 90 days. Only logs expose a retention field; no alerts field is invented. Ingestion remains BE-12/BE-13 work. |
| Q7 | No unapproved holdings quotes. Last/Day stay `unknown/not_supported`; CASH keeps the contract's explicit nulls. |

Switch activation stays disconnected (409) until BE-7/BE-8 are reviewed.
Fixture targets and confirmations remain disabled. zh-CN is required as the
primary UI language at cutover, en secondary. This PR adds no UI copy or
localization system; examples keep the contract's display vocabulary.

## Compatibility notes for contract review

- Prose takes precedence over abbreviated examples: every desk success gets
  `ok`, `generated_at` and `schema_version`; known/stale Reads require
  `observed_at`. Actions include `no_order:true`. New write acknowledgements
  allow the documented idempotent `reused` field.
- Previews require `preflight[].required` and `confirm.allowed`. The example's
  unavailable open-orders read contributes one blocker rather than zero.
- `ReadReason` stays exactly the five values in §1.4. `MetricRead` adds
  `insufficient_history` only for performance metrics required by §3.15.
- NAV and holdings keep the flat example shapes with known/stale/unknown
  variants: stale carries age, unknown a reason without fabricated amounts or
  rows. Unavailable plain aggregate decimals, dates and last-run records are
  nullable. Benchmarks use §3.15's `{id:null,label:null,indexed:[]}` fallback.
- Proposed absence encodings where examples lack degraded shapes: null
  calendar times/next-run and null delivery/digest records with an unknown
  channel status. Review these choices before BE-3/BE-4/BE-12 connects them.
- `equity_by_target` is a target-ID-keyed map of equity objects for
  `scope=strategy`, requested but not illustrated in §3.15. Review its shape
  before BE-11 connects it. The map is required for strategy scope; map keys
  reject undeclared non-target keys. A `strategy` fixture covers this variant.
- New desk credential records and broker summaries enforce
  `requires_action === phase in [30,7,1,expired]`, including false for unknown.
- §3.14 illustrates `financing:[]` without an item contract. Only the empty
  array is accepted until BE-5 defines financing rows; this does not establish
  that financing is absent in a real account.
- Legacy session, market-benchmark, runtime-control and credential-maintenance
  envelopes keep their distinct shapes. The desk envelope is not imposed on
  them. These schemas describe requested/example payloads, not every existing
  Worker projection.
- Current credential-maintenance code has a `14` day phase, additional
  presentation fields and `requires_action:true` for unknown expiry. The new
  desk list specifies `1` instead of `14`, and false for unknown. BE-6 must
  resolve adapter/legacy compatibility without silently changing the existing
  API. BE-0 changes neither interface.

No live Worker, source availability, account binding or stored retention is
verified here. Auth, headers, idempotency, redaction and execution gating need
route tests in the later tasks.

## BE-1 shared backend helpers

`application/desk/read.js` provides constructors and `readSource`, which wraps
each dependency independently. It uses the existing account-facts 36-hour TTL
by default and five-minute future-skew limit. `classifyAge` returns a status
classification; invalid timestamps or excessive future skew return
`unknown/read_failed`. Exactly at the TTL remains known. Callers supply an
explicit TTL for sources with another established freshness policy.

`application/desk/http.js` builds desk envelopes, no-store JSON and safe errors.
Only `DeskError` codes are exposed; unexpected exception text is discarded.
Auth helpers wrap the Worker's existing session and same-origin checks. The
contract's explicit login/admin error text is retained. The legacy session
envelope gains only `server_time`; its schema and synthetic fixtures already
describe this additive field.

`application/desk/idempotency.js` uses **Durable Object storage transactions**,
intended for the existing `RuntimeInstances` object. KV is not a safe concurrent
claim store. Future desk handlers call `withIdempotency(ctx.storage, ...)` inside
that object, with a server-derived scope of authenticated actor, method and
route, a parsed JSON body and a callback returning a public `{status, body}`
success response. The callback receives the stable request ID and puts it in
the route's documented ID field (`request_id`, `readback_id` or `preview_id`);
the helper does not add undocumented fields to the original response. No new public
route or generic command that executes callbacks is exposed by BE-1.

The helper hashes the scope/key and canonical JSON body; object-key order is
ignored, while array order and types matter. It reserves the key transactionally
before invoking the callback, persists the original status/envelope/request ID,
and replays that response with `reused:true`. Different content conflicts with
409 `idempotency_key_conflict`. Concurrent or uncertain incomplete requests
return 409 `request_in_progress` and never rerun the callback. Records have no
automatic expiry: later request-ledger work must define recovery/retention
without silently repeating an uncertain operation. Callbacks must return only
public read-model/request data, never credentials or private raw source bodies.

Run `npm run test:operations --prefix web/strategy-switch-console` for these
helpers and the existing operations suite. The helper tests use a synthetic
SQLite-backed Miniflare Durable Object, plus real Worker session/auth checks.
They verify local behavior, not production persistence or live broker reads.

## BE-2 saved/platform readback and refresh

Contract §3.4–§3.5 now have backend routes. An allowed session can read a
configured target and start/poll a refresh job. The existing ACL is shared
across configured platforms; unknown or absent targets return 404. POST also
requires same-origin JSON, at most 8 KiB and 1–20 unique targets (omission means
all configured targets). No frontend files or execution gates change.

Saved values come from the durable account configuration and identity-current
saved draft overrides. An identity-conflicting draft makes saved fields unknown.
Platform values come from fresh, scoped GitHub variable reads through the
existing strategy resolver, bypassing current-strategies caches. Identity fields
require a matched runtime record; saved identity is never used as platform
readback. Missing sources and failed reads remain unknown. Facts binding stays
`unknown/identity_unverified` and alert routing stays null until those sources
are connected. Re-apply and Adopt remain disabled.

Only the twelve §3.4 keys are projected and schema-accepted. Booleans become
`true`/`false` strings; decimals are validated (ratios also use `cleanCurrentRatio`)
and canonicalized without floating-point rounding; strings are trimmed.
Selectors are compared privately and returned as masked suffixes. Drift outranks
unknown. `observed_at` is the time this configuration was read, not evidence of
a live broker/runtime observation. `saved_revision` uses the known integer
account-options revision even when detailed saved settings fail. An unavailable
or uninitialized revision store returns 503 rather than inventing revision zero.
Fixtures use `reserved_cash_ratio`, the
canonical field name in §3.4's field list, instead of the example's alias.

The existing RuntimeInstances Durable Object stores snapshots and jobs for
24 hours, with alarm-based physical expiry. Cookie fingerprints scope jobs,
snapshots and BE-1 idempotency records; raw cookies are never stored.
Every fresh GET and POST refresh claims the same durable admission slot for
its authenticated, case-insensitive GitHub login, across sessions and targets.
An active read/job returns 429 `readback_in_progress`; after completion (including
source failure), a 30-second cooldown returns 429 `readback_rate_limited`.
GET source reads execute inside the DO after claiming admission. POST claims
join the idempotency reservation transaction through the local `reserve`
callback; rejected requests create neither snapshots nor ledger reservations.
Idempotent replays and snapshot/job polling remain available during cooldown.
Admission records expire physically after 24 hours; interrupted reads fail closed
until that expiry. A job reads at most 20 configured targets. Alarms read one
target at a time and re-arm before source I/O, so interrupted reads are safe to
retry. Each target succeeds independently; all-unreadable platform results are
listed as failed. Polling another session's ID returns 404. Snapshot IDs can
also be read back through the polling route during their TTL. BE-1 idempotency
records retain its existing indefinite retention and fail-closed handling of
incomplete reservations.

`npm run test:operations --prefix web/strategy-switch-console` includes the
BE-2 tests. They use synthetic data, a fixed clock and a real SQLite-backed
Miniflare DO, with manually driven alarms. This verifies local persistence,
concurrency, failures, refresh and expiry; no deployed Worker or broker is used.

## Delivery read mapping

GET `/api/desk/alerts/delivery` uses the existing console session and the same
`notificationLog` adapter as `/api/notifications/send-log`. It performs no send,
collector, dispatch or business-state write. The v1 extension `source` is optional
for existing fixtures and consumers; new responses always include it. Existing
`isAlertDelivery` accepts the unchanged unknown channel and null summaries and
ignores additive fields. F1 must validate `source` before rendering its details;
its endpoint remains explicitly mock until that separate frontend change.

The mapping below is frozen before implementing the adapter.

| Existing log field | Desk projection | Meaning and absent-data rule |
|---|---|---|
| `read_status` | `source.read_status` | Preserve complete/partial/no_data/unknown/read_failed/not_connected; invalid becomes unknown. Complete is bounded read coverage, never delivery. |
| `read_reason_codes` | `source.read_reason_codes` | Fixed allowlist only, including coverage gaps, missing/expired receipts and sender skips. |
| `as_of` | `source.as_of` | Read time, nullable; never send/composition/ACK time. |
| `items[].source_run_id`, `source_run_attempt` | `source.items[]` same fields | Positive safe integers or null. Each row stays independent. |
| `items[].workflow_updated_at` | Same field | Nullable workflow metadata, never send time or freshness proof. |
| `items[].business_day`, `report_date` | Same fields | Nullable date labels; no inferred window boundaries or correlation. |
| `items[].status` | `source.items[].sender_status` | Fixed sender/receipt enum; includes receipt_missing, receipt_expired, sender_skipped, read_failed and unknown. Expiry is stale artifact evidence, not fresh channel health. |
| `items[].delivered`, `dry_run`, `test_message` | `sender_accepted`, `dry_run`, `test_message` | Preserve booleans or null; sender acceptance never proves receiver ACK. Partial reads keep individual results. |
| `items[].read_error_code` | Same field | Existing shared fixed error-code allowlist, otherwise null. Exceptions never appear. |
| No receiver receipt | `source.items[].receiver_ack = "unknown"` | Always unknown for this source, even for delivered or partially accepted senders. |
| No channel-health observation | `channel.status` unknown | read_failed for a failed read, source_unavailable for disconnected/no-data, otherwise not_supported. Never infer current health from historical sends. |
| No verified send time/outcome/recipient count | `last_delivery = null` | All required facts must be supplied by a future reviewed source before populating this object. |
| No schedule/composition time/target or run counts | `digest = null` | Do not use item count, workflow time or date labels as substitutes. |
| `status`, `unavailable_reason`, `coverage`, `next_cursor`, `run_limit`, `truncated`, `read_failure_count`, item `id`, `source_sha`, `source_url`, `channel`, `receipt_status`, `reason_code`, `sent_at` | Not copied | Coverage comes from read_status/reasons; source locators and free text are omitted; the current public receipt has no sent_at. |

`generated_at` is projection time and `channel.name` is the adapter's fixed
`telegram` label. Unknown source shapes are never empty-success: malformed
collections become unknown with an invalid_notification_log reason. Reader
exceptions produce read_failed without provider details. There is no merge or
join across rows, runs, attempts, report dates or business days. There is no
new TTL or relaxed receipt window: receipt_expired is retained verbatim;
workflow age alone cannot establish staleness or current channel health.
A fresh HTTP 200 and ok envelope mean the read projection succeeded, not that
a notification arrived. Source integration and offline tests do not establish
active serving routes, deployed adoption or runtime delivery.

## N1 read projections (v2)

Five additional responses implement the N1 read-only projection delta in
[`docs/desk-n1-read-projection-contract.md`](../../docs/desk-n1-read-projection-contract.md):
`n1-ribbon`, `n1-overview`, `n1-accounts`, `n1-switch-strategies` and
`n1-performance` (`qsl.desk.*.v2`). `n1-common.json` holds their shared `$defs`
(`N1Read`, `N1Coverage`, reasons, time basis) and is a helper, not a response.
The v1 schemas, fixtures and the global `Read`/`Mode` definitions above are
unchanged. Each N1 response has four golden fixtures
(`ok`, `degraded`, `partial`, `empty`); the same payloads are checked by Ajv, the
frontend TypeScript guard and the page render in
`tests/console_desk_n1_validation.mjs`, and against the route handlers in
`tests/desk_n1_projection_validation.mjs`. Both run inside `test:operations`.
