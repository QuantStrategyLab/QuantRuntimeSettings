# Console API

The console exposes stored data and draft preferences for authenticated readers.
TypeScript contracts are in
[`contracts.ts`](../web/strategy-switch-console/frontend/src/api/contracts.ts).
JSON Schemas are in
[`console-api.schema.json`](../web/strategy-switch-console/contracts/console-api.schema.json)
under `$defs`. Types and schemas describe successful reads, unavailable reads,
draft saves and conflicts. All responses use `Cache-Control: no-store`.

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
| `credential_maintenance` | `medium` at 30/7/1 days or expired; otherwise `normal` | false |
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

IBKR's local multi-target read contract requires the protected
`runtime_daily_bindings` registry (`qsl_runtime_daily_bindings.v1`): each entry
contains `account_key`, `target_id`, `source_binding_id`, `strategy_profile`
and a stable `target_key` in `service|strategy_profile|scope|opaque` form,
where `opaque` is 32 lowercase hexadecimal characters and contains no account
identifier. Each entry must uniquely match the existing protected account-facts
binding and account option. Missing registration is `not_connected`; collisions
or mismatches are `partial/runtime_daily_binding_conflict`, and unreadable
registration or bindings are `read_failed`. Stored records are checked against
the registration and binding fingerprint, so a change cannot reattribute history.
Registration alone does not grant access to a publisher. IBKR ingestion on the
existing sync route additionally requires an independently configured
`IBKR_RUNTIME_DAILY_SYNC_TOKEN` and a single authorized
`IBKR_RUNTIME_DAILY_TARGET_KEY`. The source-binding header must match that
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

`/api/notifications/send-log` provides a stable read contract for runtime and
preference screens. **No delivery-log store is connected to this console.**
It returns `not_connected/notification_log_not_connected`, null timestamp and
cursor, and an empty item list. It does not report an empty successful history,
convert queued intent into delivery, send notifications or store destinations.
Pagination syntax is validated for compatibility with a future stored source.
Connecting that source requires a separately scoped integration.

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
KV mirror without scanning. See [directory details](../web/strategy-switch-console/KV_DIRECTORY.md).

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
state preserved. It never exposes object paths or exception text.
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
