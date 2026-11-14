# Console API

The console exposes stored data and draft preferences for authenticated readers.
TypeScript contracts are in
[`contracts.ts`](../web/strategy-switch-console/frontend/src/api/contracts.ts).
JSON Schemas are in
[`console-api.schema.json`](../web/strategy-switch-console/contracts/console-api.schema.json)
under `$defs`. Types and schemas describe successful reads, unavailable reads,
draft saves and conflicts. All responses use `Cache-Control: no-store`.

The proposed QSL Desk response contracts are documented in
[`schemas/desk/README.md`](../schemas/desk/README.md). BE-0 adds schemas,
synthetic fixtures and validation only; it does not connect new routes or
enable switching.

## Endpoints

| Method and path | Parameters or body | Response contract |
|---|---|---|
| GET `/api/decisions-inbox` | none | `InboxResponse` / `inbox` |
| GET `/api/admin/kv-directory` | none; allowed reader session | `DirectoryStatus` / `directory_status` |
| GET `/api/owner-decisions/history` | `limit`, `cursor` | `DecisionHistoryResponse` / `decision_history` |
| GET `/api/accounts` | none | `AccountsResponse` / `accounts` |
| GET `/api/account-settings/diff` | `account`, optional `platform` | `SettingsDiffResponse` / `settings_diff` |
| GET `/api/account-settings/history` | `account`, optional `platform`, `limit`, `cursor` | `SettingsHistoryResponse` / `settings_history` |
| POST `/api/account-settings/draft` | `CombinedDraftRequest` | `CombinedDraftResponse` / `draft` |
| GET `/api/runtime/today` | none | `TodayRunSummary` / `today_runs` |
| GET `/api/runtime/readback` | required `scope=platform:account-alias` | `runtime_readback` |
| GET `/api/audit-events` | optional `limit` (1–100, default 25), opaque `cursor` | `audit_events` |
| GET `/api/strategies/summary` | none | `StrategySummary` / `strategy_summary` |
| GET `/api/notifications/send-log` | `limit`, `cursor` | `NotificationSendLog` / `notification_log` |
| GET `/api/accounts/run-controls` | `account`, optional `platform` | `RunControlAvailability` / `run_controls` |
| GET `/api/performance/calendar` | `scope`, `range`, `year`, optional `month`, `platform`, `currency` | `CalendarResponse` / `calendar` |
| GET `/api/performance/summary` | `scope`, `range`, optional `platform` | `SummaryResponse` / `summary` |
| GET `/api/performance/returns` | `scope`, `range`, optional `platform` | `ReturnsResponse` / `returns` |
| GET `/api/performance/assets` | `scope`, `range`, optional `platform` | `AssetsResponse` / `assets` |
| GET `/api/performance/holdings` | `scope`, `range`, optional `platform` | `HoldingsResponse` / `holdings` |
| GET `/api/performance/trades` | `scope`, `range`, optional `platform` | `TradeStatsResponse` / `trades` |

`account` and `scope` are configured account aliases, never broker account numbers.

Compatibility note (2026-11-14): `account_alias` remains the internal technical
account key in every request and response; it is not renamed or re-semanticised.
Authenticated console surfaces display an IBKR account by the validated
`account_selector` of the matched account option, its native broker ID, or by a
localized "Account ID unavailable" text when that selector is missing or invalid.
The strategy stays a separate field. Clients must not derive request identity
from displayed names.
The runtime readback route uses the explicit `platform:account-alias` pair and
does not accept `all`. It returns only saved deployment observations for the
uniquely bound runtime target. `server_time` is the response clock;
`observed_at` is the producer's deployment observation time. Missing, future,
stale, conflicting or incomplete evidence never yields a known runtime switch.
Stale observations retain their timestamp with `runtime_enabled: null` and
`scheduler_state: unknown`. Missing evidence returns `unavailable`; storage or
source discovery failures return HTTP 503. A missing scope returns 404, invalid
parameters 400, and an ambiguous configured scope 409. The endpoint makes no
external calls, dispatches no operations, and grants no trading authority.

Audit pages are ordered by observation time descending and event ID ascending.
Pass `next_cursor` unchanged; `null` ends the available traversal. The cursor
contains a versioned position and the first page's time ceiling. Newer events
cannot shift later pages. Refresh starts a new traversal. Numeric offset
cursors from the preliminary API are no longer accepted; clients must restart
from the first page after upgrading. Duplicate or unknown query parameters,
invalid cursors and out-of-range limits return 400. Unreadable sources return
503 rather than an apparently complete empty page. Both routes require an
allowed reader session and reject non-GET methods.

Audit coverage includes durable decisions, current application records, and the
existing bounded activity log. Durable records are paged at the database;
there is no fixed 1,000-record export ceiling. Application updates and activity
log retention can change what remains available between requests: this is a
read projection, not an immutable historical export. The server preserves the
`id`, `actor_alias`, structured `subject`, nullable string `revision`,
`next_cursor` and `coverage` fields for typed clients. It never includes raw
decision payloads or account configuration.

`scope=all` reuses the overview cohort: it excludes known paper accounts and
conflicting or duplicate facts. An unspecified environment remains eligible,
as in the existing charts; this does not certify a live identity. Single-account
reads also allow configured paper accounts.
An ambiguous alias requires `platform`. Settings reads also accept the existing
`platform` and `key` parameter pair.

For a uniquely bound account, the existing authenticated account-facts history
route accepts `projection=currencies` with `platform` and `account_key` and
returns currencies actually present in qualified retained observations. It
returns no balances. Performance history uses the union of these currencies and
the latest snapshot currencies; discovery failures remain read failures rather
than being treated as empty history. The existing single-currency route is unchanged.

`range` is `1M|3M|YTD|1Y|ALL`, default `ALL`. The server's Asia/Shanghai date
ends the range. The calendar uses its explicit `year` and `month`, independently
of the range. `year` defaults to the current year. Omitting `month` returns twelve
monthly cells; setting `month=1..12` returns every date in that month. Holdings are
current unrealized holdings, independent of the selected range.

Calendar responses list `available_currencies` from the selected accounts' stored
history. `currency` selects one native-currency cohort; if omitted, the first
currency in sorted order is used. Unknown selections return 400. The calendar
uses that cohort's existing cashflow or broker-native return calculation; it
does not sum currencies, convert asset changes into returns, or treat missing
cashflows as zero. Crypto observation dates remain calendar days, including
weekends. Other performance endpoints retain their existing multi-currency
response and do not inherit the calendar selection.

Daily calendar cells actually replaced by the timed-flow or qualified native
calculation include `return_method` (`modified_dietz` or `native_ibkr_twr`),
`method_version: null`, `return_unit: "percent"` (10 means 10%) and
`amount_unit: "native_currency"` (the cell's `currency`). The null version means
that no estimator version is registered or verified; it is not the API envelope
or input schema version. These units describe fields even when their value is
null and do not establish amount availability or cost inclusion.
Dietz cells also include `cashflow_method: "modified_dietz"` and an explicit
`approximate` boolean, true only when a contributing interval contains a flow
before its end. Stock daily groups can include weekend intervals; the boolean
covers those contributing intervals, not the whole return chain. Calendar cells
replaced by native TWR carry the same method and unit fields at both daily and
monthly granularity and omit Dietz flags. Incomplete native months retain null
values and their coverage reason. Legacy cells retain their existing fields.

`limit` defaults to 25 and accepts 1–100. `next_cursor` is an opaque string or
`null`. Pass it unchanged as `cursor`. Histories sort newest first. Decision
history uses timestamp and a stored key as a tie-breaker. These are offset pages;
new records can shift pages, so refresh from the beginning for a current view.
Settings history is bounded by existing record retention.

## Decisions

The unified inbox returns display-safe fields only. The old owner, promotion,
recovery and credential reads remain available. Their pending entries also carry
additive `DecisionFields`. Exact evidence-receipt reads keep their existing shape.

| Category | Priority | `affects_live` |
|---|---|---|
| `reconciliation_recovery` | `high` | true: a later controller action can affect execution |
| `credential_maintenance` | `medium` at 30/14/7 days or expired; otherwise `normal` | false |
| `strategy_promotion` | `normal` | true only for a stored live confirmation mode; intent remains non-executable |
| `owner_decision` | `normal` | true for a stored live-decision recommendation; intent remains non-executable |
| `paper_account_application` | `normal` | false; existing paper qualification and application controls still apply |

Paper application requests are entries in this inbox. Explicit paper promotion
tickets, accepted requests with an existing paper application, and qualified
paper preview preparations use `paper_account_application`. Duplicate ticket
entries are collapsed. Their original `promotion` decision binding is retained;
there is no new decision writer, paper trading endpoint, or execution authority.
Accepted requests are `decided`; `application_status` separately reports the
stored application outcome, including `uncertain`. An uncertain outcome must
never be treated as permission to submit another application.

Inbox entries include `id` and `short_id`. Decision history adds a full event
`id`, `short_id` and `item_short_id` alongside the existing full `item_id`.
Settings change history also adds `id` and `short_id`. Inbox references use
`IN-` and change references use `CH-`, followed by a stable 13-character base-36
checksum of the full ID (FNV-1a 64-bit). These are display references, not unique
database keys or evidence digests. Always retain the full ID for selection,
lookups and writes. Legacy rows without a stored event ID use a deterministic
full reference built from their existing identity, revision and timestamp.

A stored decision produces `decided`. Expired evidence or an elapsed recorded
expiry produces `expired`; otherwise the item is `pending`. Unknown dates are
`null`. `evidence_freshness` reports only existing freshness metadata. A ticket's
record update time does not certify research freshness. Credential items have
one stable `credential:<id>` identity in the unified inbox, and the old credential
endpoint is retained.

A `credential_maintenance` inbox item also carries `credential_expiry`, an object
with exactly three display fields. It is present only for that category and is
not required on other categories:

| Field | Contract |
|---|---|
| `expires_at` | Canonical UTC ISO instant from the registered expiry, or `null` when unknown. |
| `days_remaining` | Server-computed `max(0, ceil((expires_at - server_now) / 86400000))`, or `null` when unknown. Expired returns `0`. |
| `severity` | `none`, `unknown`, `notice`, `warning`, `urgent` or `expired`. |

The server computes phase, days and severity once per response. Exactly 30, 14
and 7 days belong to `notice`, `warning` and `urgent`; a fraction above a
boundary stays in the preceding phase; reaching the expiry instant yields
`expired`. More than 30 days is `not_due` with severity `none` and creates no
pending item. Unknown or invalid registered metadata is `unknown` with a null
expiry and null days. A credential-source read failure remains `read_failed`; it
is not converted into an unknown expiry or a healthy state. The object never
contains a token, query ID, private Flex configuration, credential fingerprint or
watchdog payload.

`GET /api/credential-maintenance` exposes the same `days_remaining` and
`severity` fields alongside its current phase. Its due phases are
`30/14/7/expired`; `1` is retired, and consumers that validate the phase enum
must accept `14`.

`diff` contains scalar before/after values for available strategy, version,
parameter and shadow metrics. A missing old value is `null`, not an inferred
baseline. Unsupported or unrecorded facts are omitted. `affects_live` on a diff
row describes the effect of eventually applying that field, not permission to
apply it. Parameters use `decisions.parameters`; shadow metrics use
`decisions.shadow`. The field identifier distinguishes individual metrics.

History comes from durable `human_decision_record` rows across owner, promotion
and recovery categories. `action` records `adopt_intent` or `decline_intent`.
`evidence_sha256` is the exact stored material fingerprint. Actor aliases are
stable pseudonyms derived from the stored actor; raw logins are not returned.
There are no batch actions.

A source failure remains visible in `sources` and produces inbox
`status=read_failed`, even if other sources returned items. An unreadable history
returns HTTP 503 with `ReadFailed`, never an empty success.

## Today, strategies and notification context

`/api/runtime/today` chooses today's date on the server in `America/New_York`,
matching the existing daily read model. It covers every configured account,
using only existing trusted daily bindings and validated stored records. It
does not fetch broker data, dispatch a run or infer execution from the schedule.
Each row separates observation availability (`status`) from the recorded
`activity`. A fresh observation of `failed`, `unknown` or `no_signal` is still
that activity, never a successful trade. Run counts count reports, not fills.

Unbound or disabled sources return `not_connected/runtime_daily_not_connected`;
a bound account without today's record returns `no_data/today_record_missing`.
Expired observations return `stale/runtime_daily_stale`. Read or identity
validation failures return `read_failed/stored_records_unreadable` on the row
and summary, retaining other rows. Incomplete records, conflicts or reported
source read errors return `partial/runtime_daily_incomplete` while preserving
the observed reports and their `completeness`. Unknown or incomplete totals are
null. `counts.runs` is null whenever any account lacks a complete usable record;
`counts.observed` discloses coverage. No records from another business day are
silently substituted.

Multiple matching bindings return `partial/runtime_daily_binding_conflict` for
the account; no target is selected and its run state stays unknown. A missing
binding remains `not_connected/runtime_daily_not_connected`.

The account-bound multi-target read contract uses the protected
`runtime_daily_bindings` registry (`qsl_runtime_daily_bindings.v1`): each entry
contains `account_key`, `target_id`, `source_binding_id`, `strategy_profile`,
`target_key`, and optionally `platform` (omitted for existing IBKR entries).
IBKR target keys use `service|strategy_profile|scope|opaque`, with a random
32-character lowercase hexadecimal suffix. Entries must uniquely match their
existing protected account option and source binding. Binance uses its existing
wallet binding; the protected registration must be established only after its
runtime target and wallet identity are independently matched. Missing registration is `not_connected`; collisions
or mismatches are `partial/runtime_daily_binding_conflict`, and unreadable
registration or bindings are `read_failed`. Stored records are checked against
the registration and binding fingerprint, so a change cannot reattribute history.
Registration alone does not grant access to a publisher. IBKR ingestion on the
existing sync route additionally requires an independently configured
`IBKR_RUNTIME_DAILY_SYNC_TOKEN` and an explicitly authorized
`IBKR_RUNTIME_DAILY_TARGET_KEY`: either one target key, a JSON array of IBKR
target keys, or an object with distinct `ibkr` and `execution` arrays for the
two existing token identities. Registration alone cannot grant access. The
source-binding header must match that
target's unique registered account-facts binding. The token must differ from
the existing execution-evidence and account-facts tokens. Stored IBKR records
carry the registration fingerprint; binding changes cannot reattribute them.
Successful IBKR acknowledgements include the original `observed_at` for
correlation. These settings and the registration are not provisioned by code.

The protected IBKR binding inspection can calculate a nonce-bound comparison
digest for the fixed primary account. It does not register a target or write
data. Its output and the corresponding IBKR workflow result compare existing
configuration only; a public nonce does not make the digest confidential.

The one-time primary daily setup workflow defaults to a read-only preflight.
The explicit execute mode creates a version pinned to the fixed active Worker,
adds the two dedicated bindings, registers the matched primary target and sets
the corresponding producer secrets. It reports attempted stages without secret
values and stops without retrying if a write outcome is unknown. The workflow
does not schedule or send a daily projection.

The internal Durable Object command `account_daily_native_return_research_read`
is limited to one IBKR account, one currency and an inclusive range of at most
366 days. It returns validated stored rows with their actual source binding,
rejects unqualified or invalid rows and exact-decimal conflicts, and reports
dates without records without interpreting the trading calendar. The caller
must independently verify account and current/historical source authorization;
this command is not exposed through a website session or publisher token and
does not itself provide a research access identity or export destination.

In `/api/config`, `runtimeDailyBindings` uses `unresolved` for a missing or
ambiguous binding and `read_failed` when its source cannot be read; a failure
affects the corresponding platform's `/api/runtime/today` rows and summary.
Binding or stored-record read failures on `/api/runtime-daily` return HTTP 503
with `runtime_daily_read_failed`; an account-directory read failure returns
HTTP 503 with `read_failed` from `/api/runtime/today`.

The summary window is exactly `date` in its returned `timezone`, including New
York daylight-saving changes. It is not a rolling 24-hour or 14-day failure
statistic. `counts.observed` counts accounts with a record, including incomplete
ones; it does not certify successful execution. `counts.runs=null` means the
configured cohort is incomplete, not zero runs or zero failures. `blocked` is a
reported runtime activity; `read_incomplete` concerns evidence coverage. Keep
both the record activity and each run's activity. Do not derive a green failure
counter from an empty, missing, unbound or incomplete daily row. Historical
statistics require the explicit dates and coverage of those separate reads.
Runtime dates must not be substituted with performance dates: performance range
boundaries remain **Asia/Shanghai**, and stored observation-date labels retain
their producer's date. Neither API shifts yesterday's record into today.

`/api/strategies/summary` joins the configured strategy catalog with the existing
stored health snapshot. It exposes profile, domain, allowed modes, configured
account aliases and available health status/score. `configured_accounts` joins
the same `currentStrategies[platform][alias].strategy_profile` source and bounded
cache used by `/api/config`, preserving platform, alias and additive
`account_ref=platform:alias`. It describes observed configuration, not a verified
runtime deployment. `configured_accounts_source=currentStrategies` and
`account_assignment_status=complete|partial|unavailable|read_failed` describe whether every
configured account has a current profile. Each configured account includes
`execution_evidence` for its explicitly observed configuration; it does not
prove a runtime observation or grant execution authority. Permission and read
failures are listed in `account_assignment_read_failures` rather than treated
as missing configuration. Missing current assignments stay
unassigned; declared defaults never fill the gap. Missing
health remains null with `strategy_health_not_connected`; invalid stored health
returns `read_failed/stored_records_unreadable`; stale health stays stale. It
does not generate research or change strategy state. A cache miss or expiry uses
the existing bounded GitHub configuration reader; cache TTLs are unchanged.
Health values are `healthy|review|watch|critical`, independently of the read
availability status. Missing health is null; a valid `review` or `watch` is not
unknown. Holdings coverage also supports optional `platform` and `account_ref`;
older coverage entries containing only `account_alias` and `scope` remain valid.

`/api/notifications/send-log` reads bounded public receipts from the earlier
GitHub daily-digest workflow when its configured source is available. It may
return `not_connected`, incomplete or failed reads; receipt status only describes
the earlier workflow and cannot establish whether a current Cloud Run/GCS
notification was accepted or delivered. This read does not send notifications.

`/api/performance/holdings` may include nullable `unrealized_pnl_percent` per
row: unrealized P/L divided by positive finite cost basis, in percent, only when
the inputs and currency are available. Zero is valid; null or an absent field
means unavailable, including older responses. Existing P/L and ranking order
are unchanged. Return points may carry nullable `daily_return_percent`; a value
is supplied only for a qualified original daily interval, and null or absence
is unknown, not a zero return. Existing native daily values retain their own
coverage semantics; cashflow-adjusted approximations retain their method label.

### Alert delivery v1 source compatibility

`/api/desk/alerts/delivery` keeps the schema identifier
`qsl.desk.alert_delivery.v1`
([`alert-delivery.json`](../schemas/desk/alert-delivery.json)), but its
optional `source` object now requires `source.read_error_code`. The value is
never null: it is one of the fixed receipt-reader allowlist codes, otherwise
the literal `unknown`. Item-level `read_error_code` nullability is unchanged.

Mixed generations are not compatible when `source` is present:

- An older producer with a newer consumer: the newer guard rejects a `source`
  object without `read_error_code`.
- A newer producer with an older consumer: the older guard checks the exact
  `source` keys and rejects the added key.
- A producer and consumer from the same generation work, subject to normal
  validation. Older fixtures that omit the optional `source` do not show that
  mixed versions work for real responses that carry it.

Upgrade the bundled producer (`console_api/desk_delivery.js`) together with the
frontend contract types, guards and built assets (`v2_asset_map.js`) as one
matched generation. A stale cached frontend or an independently deployed
consumer is unsupported; reload onto the matching assets before using the
source view. There is no compatibility shim: no silent field stripping, no
default injection, no relaxed guard and no new schema version.

Roll back the producer and the frontend assets together to the matching
previous generation. Frontend-only or backend-only rollback is not supported.
These are compatibility constraints only; they do not show that a deployment
was atomic and do not authorize a deployment or rollback.

`unknown` reports diagnostic uncertainty. It is never a successful delivery
and never a root-cause determination.

## Native Binance account-card reads

Account cards and account details read the existing authenticated
`GET /api/binance-account-facts` independently of `/api/account-facts`.
Match the report to the directory by exact `platform` and `account_key`; a
different account's report must not supply its amount, timestamp or asset count.
Refresh uses the same explicit page refresh as the other account sources.

`report_status=available` covers the reported Spot + Flexible Earn quantities.
The optional `wallet_valuation` has its own scope,
`provider_returned_wallet_rows`, and its own observation time. Display a valid
decimal-string USDT amount as **Wallet valuation**, preserving its precision
and the amount-visibility preference. It is not account NAV, cash, cost basis,
profit or TWR and does not join the generic live-account total. Funding, margin,
futures and locked Earn remain outside the quantity inventory's coverage.

Missing or unavailable valuation does not erase valid scoped quantities.
A successful empty inventory is distinct from missing reports, expired reports,
unavailable sources and HTTP read failures. None of these states supplies zero
or implies that a previously connected source was never connected. Keep scope
and diagnostic state in accessible titles and machine-readable attributes
without adding persistent audit prose to the account cards.

## Run-control availability

`/api/accounts/run-controls` is the backend authority for button availability.
Each of `enable`, `stop`, `resume` and `approve_application` has `enabled`,
`reason`, and `requires_confirmation=true`. Frontends must not turn a backend
false into true. They must still disable pending local submissions and retain
the existing unknown-result locks; this read cannot clear a browser's unresolved
request. Every existing POST revalidates its own identity, revision, origin,
permissions and execution guards. A preflight is not authorization or a promise
that the later request will succeed.

The display API requires admin for action buttons, while legacy POST permissions
remain unchanged. Generic enable stays false with
`strategy_application_not_connected`. Stop uses configured target identity and
existing durable HK pending/unknown state. Resume is offered only after the
existing Binance source validator accepts a fresh backend read; its opaque
`resume_binding.runtime_target_sha256` is passed to the existing controller.
Profile approval requires a current identity-bound, profile-only draft, a
selectable non-DCA profile, a fresh readback of a disabled runtime target and
no active application. This API never approves, dispatches or changes anything.
Source readback uses existing backend clients and permissions; no credentials
are returned.

Reasons include `available`, `admin_required`, `dispatch_unavailable`,
`stop_pending_or_identity_unavailable`, `existing_recovery_not_available`,
`runtime_instances_not_bound`, `account_settings_identity_conflict`,
`profile_draft_required`, `profile_only_required`, `profile_not_selectable`,
`runtime_readback_unavailable`, `runtime_target_not_disabled`,
`current_profile_conflict`, `profile_application_pending`, and
`stored_records_unreadable`. Readback failures disable the affected action.

## Draft settings

The diff returns seven supported fields across strategy, DCA, cash reserve,
income and options. `current_status=unknown` distinguishes a missing effective
value from a known null. `overridden` and `changed` distinguish inherited fields,
explicit overrides and actual differences. `identity_status=identity_conflict`
means the draft is bound to an older identity and must be reconciled through the
existing flow before saving.

The combined draft request uses the same identity and revision returned by
`GET /api/account-settings`:

```json
{
  "platform": "longbridge",
  "key": "synthetic-alpha",
  "identity": { "use": "the complete identity from the settings response" },
  "expected_draft_revision": 2,
  "overrides": {
    "reserved_cash_floor": "10",
    "reserved_cash_ratio": "0.15",
    "income_layer_enabled": false
  }
}
```

Submit the whole edited override set in one request. Omitted fields retain their
saved overrides; `null` removes an override and inherits the effective setting.
Amounts and ratios remain decimal strings. DCA mode and amount must be supplied
together and explicitly bound to a supported strategy, as on the legacy route.
The identity object above is illustrative; clients must use the actual complete
identity, not reconstruct it from this example.

All fields are validated before a single durable transaction commits. Origin,
admin, identity, strategy compatibility, revision and conflict checks are shared
with the legacy save. A stale revision returns HTTP 409 with the same error code
as the legacy route, including `account_settings_draft_revision_conflict` and
`account_settings_identity_conflict`. Reload and review the fresh diff before
retrying. A timeout or unknown result requires the existing readback procedure;
clients must not blindly resend.

The combined endpoint rejects risk preferences, activation flags and controller
fields. Saving creates a draft only: `adopted=false`, `no_order=true`,
`execution_authority_granted=false`. Strategy applications, options activation,
enable/resume and recovery retain their existing controllers and confirmation
requirements. The existing four UI saves and legacy POST remain supported.

History returns existing draft-save audit entries and profile-application
approvals. The save log is bounded and can be incomplete. Risk-only audit entries
are excluded. No stored effect-verification event source exists, so
`availability.effect_verification` is unavailable with
`effect_verification_not_recorded`. An approval or claim is not proof of effect.

Account-list draft counts count sections with stored overrides, not verified
runtime changes. Decision counts cover explicit account bindings; global items
are counted separately in `unassigned_decision_count`. A failed source makes the
per-account decision count `null`. `last_change_at` is the latest stored draft,
profile approval or runtime-instance update, or `null` when none is available.

## Performance data and statuses

See [performance methods](console-performance-charts.md) for formulas, calendar
dates, return alignment, cash flows and data coverage. The API uses the same
shared range, rebasing, fixed-cohort aggregation and TWR helpers as the charts.
The shared implementation is
[`performance_math.js`](../web/strategy-switch-console/performance_math.js).
The frontend's former helper import path remains a typed re-export.

| Status | Meaning |
|---|---|
| `ok` | Data support the stated calculation |
| `partial` | Missing flows, observations or coverage limit interpretation |
| `stale` | Last series date is more than three calendar days old |
| `no_data` | No usable observations in the requested block |
| `not_connected` | The record source is not connected |
| `unavailable` | The calculation cannot be supported |

Every performance block includes `as_of`, `coverage`, `value_kind` and
`unavailable_reason`. `pnl` requires known external cash flows; otherwise amounts
are `asset_change`. Return curves with unknown flows are explicitly
`unadjusted_asset_ratio`, and qualified TWR and drawdown remain null. One point
provides a zero baseline only, not an earned return. Missing cells remain null.

Native currencies are not added together. Mixed scopes return no aggregate
amount or aggregate asset curve and report `mixed_currency`. Returns include
`per_currency` percentage curves, each aggregated and aligned independently.
These do not represent an average or a combined portfolio return. This API does
not fetch FX quotes or claim historical FX returns.

Stable reasons include:

| Reason | Meaning |
|---|---|
| `external_cashflow_required` | Flows do not qualify P/L or TWR |
| `mixed_currency` | No aggregate native-currency amount |
| `snapshot_history_missing`, `snapshot_missing`, `previous_snapshot_missing` | History or a required endpoint is absent |
| `non_trading_weekend`, `incomplete_month` | Non-trading cell or incomplete calendar coverage |
| `insufficient_observations`, `invalid_return_period` | Return calculation lacks valid endpoints |
| `benchmark_history_missing`, `no_common_date` | Comparison cannot align |
| `benchmark_history_unreadable` | Stored benchmark read failed |
| `positions_not_connected`, `positions_partial_coverage` | Holdings are absent or scoped |
| `positions_stale` | Existing position source is stale |
| `avg_cost_missing`, `position_value_missing` | Unrealized P/L lacks required fields |
| `fills_not_connected` | No console fill source; no trade statistics are emitted |
| `stored_records_unreadable` | A required store read failed |

`coverage.excluded_accounts` and `omitted_dates` disclose incomplete cohorts.
A missing currency excludes that account's full history rather than understating
its assets. Benchmark availability is independent of account data availability.

## Directory status and frontend fixtures

`GET /api/admin/kv-directory` accepts any allowed reader session, returns private
`no-store` metadata, and never calls `list`, writes a manifest or starts
maintenance. The existing same-origin admin POST and five-minute cron remain
the maintenance paths. The GET returns only `status`, `complete`, `last_success`,
`last_error`, `retry_at`, `in_progress`, `data_as_of`, `unavailable_reason` and an
optional transport `ok` flag. Times are epoch milliseconds or null.
`complete=null/status=unknown` means no recorded manifest; `complete=false` is
incomplete coverage. Neither state implies an empty successful inbox. A quota
failure remains `kv_list_daily_limit_exceeded`, with its existing retry time.
`in_progress` means pagination is pending, not that a cron is executing now.
`data_as_of` and `last_success` are the last complete scan time, not freshness of
the underlying business records or proof that every cron succeeded.
`last_error` retains the latest recorded failure `{code, at}` after recovery.
Old metadata without an error time returns `at=null`; it does not invent a time.
An unreadable directory returns HTTP 503 with `status=read_failed` and unknown
metadata. Errors are fixed public codes; no keys, cursors, identities or raw
provider exceptions are returned. The exact legacy receiver may read its existing
KV mirror without scanning. See [directory details](../web/strategy-switch-console/kv-directory.md).

The small typed [gap fixtures](../tests/fixtures/console-gaps.ts) use synthetic
identities, timestamps, values and digests in the existing response shapes.
`m0Subjects` is `qsl_m0_research_dashboard.v1`: twelve `subjects`, each with
nested `observations`, freshness, source references and `research_context`.
There is no top-level `items` or `observations` list. `context_only` remains
research context with no execution authority; unavailable data, an HTTP read
failure and a known empty list need separate display states.
`mixedReturns` has an unavailable mixed aggregate and an independent partial
seven-point USDT curve; the empty USD group does not erase it. Unknown cashflows
keep the curve an unadjusted asset ratio, never qualified TWR. Health fixtures
cover review/watch; runtime fixtures retain blocked/read_incomplete separately
from run activity; `controlReasons` covers the current reasons without changing
button authority. Unknown future states must have a translated unknown fallback,
not raw `state.*` keys or guessed permissions. `existing_recovery_not_available`
means no available existing recovery; it does not assert a pending recovery.

Settings `current_status=unknown` means the effective value was not supplied.
Keep current/inherited draft null, including when an unknown observation happens
to carry `0` or `false`. Known zero and known false remain actual values.
Unknown does not mean not applicable; this contract has no source for that claim.
Empty settings history describes only the returned bounded audit/application
scope, not an account that has never changed. Its effect-verification source
remains unavailable; drafts and approvals do not prove runtime adoption.

## Authentication and errors

Reads use the existing allowed session. Combined saves also require the existing
admin role and same-origin header. No login, trading or infrastructure permission
is added. HTTP 401 means login is required; 403 means access or origin is denied;
400 means invalid input; 405 means unsupported method; 409 means a conflict; 503
means a stored source could not be read. No production verification should POST
to these endpoints.

Use `label_key` and `title_key` through the frontend locale system. Identifiers,
evidence bindings and fingerprints are opaque references, not display prose.
Legacy payloads retain evidence notes, research explanations and technical
metadata for compatibility; treat those legacy fields as internal and do not
render them in the rewritten UI. The unified inbox never includes that prose.

## Synthetic development

Run `npm run dev:synthetic --prefix web/strategy-switch-console/frontend` and open
`http://127.0.0.1:4173/v2/?qa=api-ready`. Fixtures are defined in
[`console-api-synthetic.mjs`](../web/strategy-switch-console/frontend/scripts/console-api-synthetic.mjs).
Every new endpoint is served locally. The combined-save endpoint is a local mock;
it does not persist or dispatch anything. The existing demo remains available.

Use `qa=api-empty`, `api-partial`, `api-stale`, `api-not-connected`,
`api-read-failed` or `api-conflict`. The last scenario returns 409 for the mock
combined POST. Trade stats are not connected in every scenario. No provider,
production session or real account data are used.


### Candidate routing and list quota

The Kimi console is the default at `/` for every session. Page navigation uses
`?page=overview|performance|decisions|accounts|strategies|health`; old `/v2`,
`/v2/` and `/v2/index.html` links redirect to `/` with their query preserved.
There is no cookie or feature flag selecting the old interface. HTML is served
with `Cache-Control: no-store`; content-hashed assets are immutable. An already
open tab keeps its loaded application until refreshed. The new shell checks its
build on return to a visible tab using a static HEAD request, at most once per
minute and without an interval. When an update is available, its refresh button
uses the existing unsaved-edit guard. API contracts and permissions are unchanged.

`include_history=false` on `/api/runtime-daily` skips directory discovery and returns
`history: null`. It still reads and validates the selected stored record, account
binding, date and all source evidence. Default reads retain the existing coverage.
The date grid and today summary do not consume coverage and use this option.
Concurrent inbox consumers share only their in-flight request, never settled data.
`read_error_codes` contains only fixed public producer diagnostics; unknown legacy
text is returned as `source_read_error`, with the original error count and record
state preserved. The known producer reason `runtime_target_disabled` is exposed as
`target_disabled` and remains incomplete; it does not establish full-day inactivity
or a successful run. Actual read failures remain failures. It never exposes object
paths or exception text.
A provider daily list quota failure remains `read_failed`; inbox source metadata
reports `failure_reason=kv_list_daily_limit_exceeded`. No cached successful queue
is substituted for a failed read. Reducing requests cannot restore exhausted quota
or repair producer records.

The generated shell and asset responses identify their exact asset set with
`X-Console-Build`. After staging a candidate at 0%, run:

```sh
node scripts/console_candidate_readiness.mjs "$CONSOLE_ORIGIN" "$WORKER_NAME" "$CANDIDATE_VERSION"
```

The configurable probe waits for three consecutive complete HEAD rounds with
matching build IDs for the HTML and every asset. Deployment acknowledgements and
request override headers alone are insufficient because routers can still serve
the old version during propagation. Use the same browser transport/region for the
probe and acceptance. Then verify GET bytes once and run the six-page acceptance;
keep every failure and do not retry failed acceptance into a pass. A timeout stops
acceptance/promotion. This guard does not claim global propagation is atomic and
does not remove transient platform responses before readiness.

### Historical positions

Authenticated `GET /api/account-facts/history?platform=…&account_key=…&projection=positions`
returns account-bound daily observations from verified history. Optional `from` and
`to` are inclusive ISO dates. Each observation contains the actual
`observed_finished_at`, `positions`, `positions_scope` and `positions_complete`.
Position entries carry the stored symbol, quantity, market value and currency.
They include `currency_source` when the stored observation specifies one.
A null `positions` means the source did not report positions; an empty array with
`positions_complete: true` is a reported empty inventory within its stated scope.
A null completeness value does not establish a complete inventory. Observation
instants do not assert end-of-day holdings. Only existing observations within the
history retention limit are returned; missing days are not interpolated.

### External-flow coverage inspection

Authenticated `GET /api/account-facts/history?platform=…&account_key=…&projection=external-flow-coverage`
uses the existing unique account binding and reads only the stored flow row. It
returns `computation_enabled` (the calculation flag, not an eligibility decision),
`read_status` (`stored`, `absent`, `identity_mismatch`, or `read_error`),
`precision` (`date`, `instant`, `mixed`, or null), window and deduplicated record
counts, and groups by precision and source coverage. `observed_from` and
`observed_to` are window boundaries, not proof of continuous coverage; mixed
precision has null overall boundaries and retains boundaries per group. Date-only
v2 windows report `reported`, never complete coverage. `absent` gives zero counts
only after a successful empty row read. Identity mismatch and read failure give
null counts; read failure returns HTTP 503. No amounts, account identity, record
references or raw rows are returned. The projection reads v1 and v2 metadata even
when computation is disabled and does not enable it or change history calculations.

## Write-only credential rotation

Only `ibkr_flex` is supported. All responses are JSON with `Cache-Control:
no-store`. A valid console session may read metadata; only the separately
configured exact owner with an admin session can mutate. Every mutation also
requires the exact same Origin and a fresh, single-use TOTP or recovery code.
Unknown fields and bodies over 4 KiB are rejected. Values are 1–1024 UTF-8 bytes,
without trimming. No value, version identifier, fingerprint, or provider response
is returned. See `contracts/console-api.schema.json` for strict schemas.

| Method | Path | Request |
| --- | --- | --- |
| GET | `/api/credential-rotation/ibkr_flex` | None |
| POST | `/api/credential-rotation/ibkr_flex/stage` | `request_id`, `new_value`, `expires_at`, `step_up` |
| GET | `/api/credential-rotation/ibkr_flex/operations/{operation_id}` | None |
| POST | `/api/credential-rotation/ibkr_flex/operations/{operation_id}/finalize` | `request_id`, `downstream_verified: true`, `step_up` |
| POST | `/api/credential-rotation/ibkr_flex/operations/{operation_id}/cancel` | `request_id`, `step_up` |

`step_up` is `{method: "totp" | "recovery", code: string}`. IDs are 8–128
characters from the existing bounded opaque-ID alphabet. Expiry must be a strict
timezone-aware instant later than stage time and is stored in UTC. Readers see
only `name`, `last_rotated_at`, and `expires_at` as credential metadata. Operations
contain `operation_id`, `state`, `requested_expires_at`, `created_at`, `updated_at`,
`allowed_actions`, and a fixed `reason_code`. The envelope has
`schema_version: "qsl.credential_rotation.v1"`, `ok`, `server_time`, `metadata`,
`operation`, `allowed_actions`, and optional `replayed`.

Stage creates `adding_version`, then `staged` or `add_unknown`. It preserves the
old version and maintenance metadata. Finalize requires the owner's downstream
attestation and becomes `finalizing`, then `finalized` or `finalize_unknown`.
Only confirmed finalize updates expiry and last-rotated in the same SQLite
transaction as the operation, using the captured maintenance revision. Cancel
becomes `canceling`, then `canceled` or `cancel_unknown`, and preserves metadata.
A confirmed pre-write rejection can become `failed`. Unknown results block all
new writes. GET performs metadata-only reconciliation; it never repeats a
mutation or infers stage success from a version count. If add succeeded but its
version reference could not be persisted, the result remains unknown for manual
operational investigation. A maintenance revision conflict after remote finalize
also remains unknown; newer maintenance data is never overwritten.

Identical request-ID/body replays return the recorded result before checking a
consumed factor. Changed bodies conflict. Five failed factors within five
minutes throttle the exact owner. TOTP uses six digits, 30-second steps and a
one-step clock window; all matching steps are consumed atomically. Recovery
verifiers use HMAC-SHA-256 over `recovery:` followed by the code, keyed by the
separate fingerprint key. Provisioning factors and keys is a separate owner
operation, with no enrollment or reset API here.

Failures contain only `{ok: false, error: <fixed code>}`: 400
`invalid_credential_rotation_request` or `invalid_credential_expiry`; 401 existing
`login required`; 403 `origin_required`, `cross_origin_rejected`,
`rotation_owner_required`, or `step_up_invalid`; 404
`credential_rotation_operation_not_found`; 409
`credential_rotation_request_conflict`, `credential_rotation_state_conflict`, or
`credential_maintenance_revision_conflict`; 429 `step_up_rate_limited`; 503
`credential_rotation_unavailable`. Recorded unknown outcomes return HTTP 200,
with the state indicating uncertainty. Reason codes are `proxy_unconfirmed`,
`maintenance_revision_conflict`, `provider_failed`, or null.

The browser API adapter in `frontend/src/api/endpoints.ts` distinguishes
operation reason codes from HTTP error codes and uses the same bounded ID and
calendar validation as the backend. It rejects unexpected response fields and
preserves unknown outcomes. A `403 step_up_invalid` on these fixed POST routes
is a request error, so the owner can correct the factor without losing login;
401 and other permission failures still invalidate the private session. This
backend PR includes those adapter types/functions only. A separately developed
rotation page must use them rather than restore its older adapter definitions.

Rotation audit events join the existing sorted pagination stream. Their exact
fields are `event_id`, `occurred_at`, `actor_alias`, `action`, `subject`,
`operation_id`, and `outcome`; denied events may have a null operation ID. The
subject is `{kind: "credential", id: "ibkr_flex"}`. Actions use
`credential_rotation_stage`, `credential_rotation_finalize`,
`credential_rotation_cancel`, and `credential_rotation_denied`. Outcomes use the
corresponding confirmed/unknown state, `failed`, or `denied`. The frontend
explicitly retains `event_id` and `operation_id` for this variant alongside the
legacy `id`/`ref` event parser. Internal denial reasons are not projected. No notification is sent by these endpoints; any later
notification integration must occur after audit commit and use only these fixed
fields, without retrying the secret mutation.


## Performance benchmark ETF curves

`GET /api/market-benchmark/performance?start=2026-10-12&end=2026-10-14`
(and `HEAD`) reads the existing Durable Object market-price cache. This public
market-only endpoint requires no account identifier or strategy credential.
Supply the actual first and last observation dates of the selected strategy's
performance curve, after range selection, rather than a nominal range boundary.
Dates must be valid ISO dates, occur once each, and satisfy `start <= end`.

The additive `qsl.performance_benchmarks.v1` response contains:

| Field | Meaning |
| --- | --- |
| `window.start`, `window.end` | Requested strategy observation window |
| `status` | `available` for four usable series, `partial` for one to three, otherwise `unavailable` |
| `series[].id` / `symbol` | `sp500` / `SPY`, `nasdaq100` / `QQQ`, `russell2000` / `IWM`, `djia` / `DIA` |
| `series[].label_en`, `label_zh` | Display names for each language |
| `series[].status`, `unavailable_reason` | Independent coverage for each ETF |
| `series[].base_date`, `last_date` | Exact requested anchors, or null when unavailable |
| `series[].points[]` | `{date, cumulative_return_ratio}`; first value is 0; 0.10 means 10% |
| `return_basis` | `etf_close_price_return`: unadjusted daily close, excludes dividend reinvestment |
| `currency`, `timezone` | USD, America/New_York exchange observation dates |
| `calendar_coverage`, `missing_date_policy` | `not_verified`, `omit_without_fill` |

Each usable series is sorted, clipped inclusively and rebased with
`close / base_close - 1`. Both exact anchors must exist; missing anchors never
shift the comparison window. No in-range prices gives `benchmark_history_missing`;
an absent anchor gives `window_anchor_missing`. Invalid prices or duplicate
in-range keys give `invalid_cached_price`. Unavailable series have empty points,
not zero returns. Missing interior observations remain absent; calendar completeness
is not asserted without an exchange-calendar source. Clients must preserve gaps
and must not infer an observation or return from an absent date.

Invalid queries return HTTP 400; unsupported methods return 405. Store, transport
and response-integrity failures return 503 with a fixed error code. A successful
cache read with incomplete coverage returns HTTP 200 and explicit coverage status.
Responses use `Cache-Control: no-store`; every request re-reads the existing cache.
No request fetches external prices, creates history, or changes execution state.

The existing Yahoo acquisition script accepts
`MARKET_BENCHMARK_SERIES_SET=performance` for SPY/QQQ/IWM/DIA; its default remains
`overview` (the four price indices). Both modes share the existing source, frozen
cache keys, 64-point batch limit, completed-session filtering and conflict policy.
Use existing paired history date options for bounded approved acquisition.
An ETF is stored under its ticker; index levels never substitute for it.
The new set cannot use the owner-approved index revision operation. The shared
apply planner validates every replacement against the four index identities at
both the Worker receiver and producer payload boundary, including explicit
payloads in default overview mode. Any ETF or unknown target rejects the entire
batch with `benchmark_revision_series_unsupported` before writes.
This patch does not schedule or run ETF acquisition; an empty cache remains
unavailable until the existing producer is operated under its normal authorization.

Compatibility: `/api/market-benchmark` may add ETF rows to its existing points
array; `inception_date` remains the earliest valid index observation (null when
there are no index rows), independently of ETF history. Existing index consumers
select the original index identities. The legacy
performance routes remain index-only. Meridian's existing `EquitySeries.benchmark`
is unchanged: the frontend implementer consumes this separate contract for four
series, using the actual strategy window. Frontend types, mock fixtures and page
wiring are separate frontend ownership; this endpoint does not prove their adoption.

## Informational forward reconciliation

`GET /api/account-facts` adds `accounts[].forward_reconciliation`, described by
[`qsl-forward-reconciliation-read.v1.schema.json`](../schemas/qsl-forward-reconciliation-read.v1.schema.json).
This additive field is independent of `qsl.reconciliation_record.v2`, which stays
a MISSING-only deployment-identity contract. Existing consumers may ignore the new
field; there is no frontend change or new route, writer, service or storage.

The existing pure account read projection supplies null evidence. Account facts
have no independently qualified native source timestamp, opening baseline or
notification receipt. Their observation date, collection finish, balances and
recovery decisions cannot fill these gaps. Each account therefore returns
`source_status=unknown`, null source/baseline/later anchor, a missing input baseline
(`opening_snapshot_missing`), unknown notification and UNRECONCILED positions,
cash and events. Missing means the baseline evidence was not supplied, not proof
that no baseline exists at the broker. All values are informational only.

The pure `projectForwardReconciliation(evidence, {now})` contract accepts a closed
metadata object with `source`, `baseline`, `later_anchor` and `notification`, each
nullable. A snapshot retains `source_as_of`, its explicit native offset and IANA
`timezone`, and `capture_started_at` / `capture_finished_at` independently.
Supported native zones are UTC, America/New_York, Asia/Hong_Kong and Asia/Singapore.
Dates must be possible and offsets must agree with the named timezone. Source
as-of cannot exceed capture finish; capture start cannot exceed finish; no evidence
may be in the future. Native source dates before November 3, 2026 are rejected.
A baseline must have an actual November 3 native date; a later anchor keeps its
own timestamp and must follow a supplied baseline. Neither anchor can exceed a
supplied current source. Missing baseline never gets filled from the later anchor.
No midnight, atomic capture or full accounting coverage is inferred.

`generated_at` is evaluation time only; it is null when no financial evidence
object is supplied, so repeated unknown reads do not manufacture a financial
report timestamp. Current source age above 1,800 seconds is
`stale` even with a fresh generated wrapper. Historical baseline/anchor timestamps
are preserved without applying current-source TTL. `present` describes metadata,
not verified authenticity, complete coverage or a financial match. This contract
cannot prove an upstream claim is genuine. Connecting evidence requires a
separately authenticated, source-bound existing reader; no such reader is wired
by this patch. Unbound extensions in account storage are ignored.

Notification metadata is independent: `unknown` has null timestamps; `pending`
has `requested_at` and no `confirmed_at`; `confirmed` requires an authentic receiver
receipt timestamp at or after the request. Times must not exceed evaluation time.
A timestamp supplied to a pure validator is not runtime delivery proof. No sender,
retry queue, recipient, receipt identifier or raw error is exposed or added.
Malformed/extra metadata throws the fixed `invalid_forward_reconciliation_evidence`
error, never raw source content. Callers must treat that error as a failed read;
it must not authorize an action or be converted to a successful financial result.
Temporal rules are enforced by the projection in addition to structural schema
validation. There are no account identifiers, financial values or free-text fields
in this sub-contract. All dimensions remain UNRECONCILED even with source or notice
evidence. It grants no readiness, recovery, halt, approval or execution permission.

Frontend ownership remains with the existing planner (Claude), implementer (Qwen
via Qoder) and reviewer (Claude). The frozen handoff is the additive account field
above: display native source/capture/generated times separately; missing opening
and later anchor separately; pending/confirmed/unknown notices separately from
UNRECONCILED dimensions. Render unknown fields without zeros or inferred dates,
in zh-CN/en and light/dark. Backend/schema/tests remain owned by the backend
maintainer; frontend files, actions, task-list workflows and assets are outside
this patch. Runtime collection, deployed adoption and delivery remain NOT_PROVEN.

### Broker execution report intervals

Execution coverage remains partial and does not establish a complete trading history.
Each `reports` entry with `period_status=observed_report` identifies a received
report period. Repeated periods are deduplicated, retaining the latest observation.
At most 512 distinct periods per source binding are retained; `reports_truncated`
indicates older intervals were omitted. Existing stored aggregates predate interval
tracking: their `period_status=legacy_aggregate_bounds_unknown` marks bounds only,
not an individual report or proof of coverage within the bounds. New observations
are recorded alongside that legacy marker. If a rollback writes a changed
aggregate without recording intervals, the bounds are marked unknown again
while the previously observed intervals remain visible.
