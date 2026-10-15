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
| GET `/api/owner-decisions/history` | `limit`, `cursor` | `DecisionHistoryResponse` / `decision_history` |
| GET `/api/accounts` | none | `AccountsResponse` / `accounts` |
| GET `/api/account-settings/diff` | `account`, optional `platform` | `SettingsDiffResponse` / `settings_diff` |
| GET `/api/account-settings/history` | `account`, optional `platform`, `limit`, `cursor` | `SettingsHistoryResponse` / `settings_history` |
| POST `/api/account-settings/draft` | `CombinedDraftRequest` | `CombinedDraftResponse` / `draft` |
| GET `/api/performance/calendar` | `scope`, `range`, `year`, optional `month`, `platform` | `CalendarResponse` / `calendar` |
| GET `/api/performance/summary` | `scope`, `range`, optional `platform` | `SummaryResponse` / `summary` |
| GET `/api/performance/returns` | `scope`, `range`, optional `platform` | `ReturnsResponse` / `returns` |
| GET `/api/performance/assets` | `scope`, `range`, optional `platform` | `AssetsResponse` / `assets` |
| GET `/api/performance/holdings` | `scope`, `range`, optional `platform` | `HoldingsResponse` / `holdings` |
| GET `/api/performance/trades` | `scope`, `range`, optional `platform` | `TradeStatsResponse` / `trades` |

`account` and `scope` are configured account aliases, never broker account numbers.
`scope=all` selects accounts explicitly configured as live and excludes conflicting
or duplicate facts. Single-account reads also allow configured paper accounts.
An ambiguous alias requires `platform`. Settings reads also accept the existing
`platform` and `key` parameter pair.

`range` is `1M|3M|YTD|1Y|ALL`, default `ALL`. The server's Asia/Shanghai date
ends the range. The calendar uses its explicit `year` and `month`, independently
of the range. `year` defaults to the current year. Omitting `month` returns twelve
monthly cells; setting `month=1..12` returns every date in that month. Holdings are
current unrealized holdings, independent of the selected range.

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
