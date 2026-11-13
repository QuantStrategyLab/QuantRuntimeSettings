# Desk N1 read projection contract (five areas, v2)

Status: approved design delta v1 for the N1 read-only adaptation of five Desk
areas, recorded here as the repository copy of that delta. The v1 Desk API
contract it overrides is frozen byte-identically in
[`desk-api-contract-v1-frozen.md`](desk-api-contract-v1-frozen.md). Only the
five routes below are affected; every v1 schema, fixture, global `Mode`/`Read`
definition and existing `/api/...` route keeps its behaviour.

## 1. Scope and compatibility

- Five new GET routes, each answering a new `qsl.desk.{ribbon,overview,accounts,switch_strategies,performance}.v2`
  payload. These routes did not exist before, so no served API changes shape.
- Schemas: `schemas/desk/n1-*.json` (unique `$id` each; `n1-common.json` is a
  shared helper, not a response). Golden fixtures:
  `tests/fixtures/desk/n1-<area>.<ok|degraded|partial|empty>.json`.
- Frontend: `src/desk/contract/n1.ts` (local N1 types) and `src/desk/api/n1.ts`
  (strict v2 guards plus v1 mock normalisation). Live accepts strict v2 only; a
  v1 live body is a contract mismatch. A v1 fixture is normalised to N1 only
  under `source=mock`, and the page keeps its fixture label.
- The global `Mode = dry_run|paper|live` and the v1 `Read` stay unchanged.

## 2. N1 Read and coverage

`N1Read<T>` is a closed object:

| status | required keys | notes |
| --- | --- | --- |
| `known` | `value`, `observed_at` (UTC `Z`), `coverage` | coverage state `complete` or `verified_empty` |
| `stale` | `value`, `observed_at`, `age_seconds` ≥ 0, `coverage` | shown greyed with its age; never promoted to known |
| `partial` | `value`, `observed_at`, `coverage` | coverage state `partial`; `value` is the verified subset, unknown count members are `null`, never 0 |
| `unknown` | `reason`, `coverage`; optional `observed_at` (null) | carries **no** `value` key |

`coverage = {state: complete|partial|unavailable|verified_empty, included, total|null, reasons[]}`.
`included`/`total` count evidenced sources or identities; an unknown total is
`null`, never a guessed account count.

Reasons: the v1 `ReadReason` set (`never_read`, `read_failed`,
`source_unavailable`, `identity_unverified`, `not_supported`) plus the local
`insufficient_history`, `coverage_incomplete`, `mixed_currency`,
`time_basis_unavailable`. Other interfaces keep their enums.

Verified empty: only when every required source was read successfully, the
identity/filter scope is explicit and zero rows were confirmed. A failed,
unsupported or unimplemented source never yields verified empty. A partial
list with `value: []` still shows incomplete coverage, never "no records".

The UI shows a full count only for known (or explicitly stale) reads. Partial
shows the verified subset with its coverage; `null` renders `?`. Unknown
renders `?` plus the reason. Real observation time comes from the source;
`generated_at` never refreshes stale data. A configuration snapshot read now
claims only that the configuration was read, never a runtime observation.

## 3. Time domains

- `generated_at` and every instant are ISO-8601 UTC `Z`. Offset inputs are
  normalised by their real instant; zone-less or invalid instants are rejected
  or become unknown.
- Every N1 success carries `time_basis: {view_timezone, source_domains:[{source_key, timezone}]}`.
  `source_key` is a fixed, non-sensitive source name. Rows with a business date
  carry `source_business_date` and `source_timezone`.
- Desk ribbon `date` is a **UTC day** (`date_basis: "utc_day"`); `?date=` must be
  a real calendar date not after today, otherwise 400.
- runtime-daily stays America/New_York; legacy performance and account daily
  history stay Asia/Shanghai. Business dates are not mechanically converted.
- Ribbon tape entries are placed by their stored instant. A UTC day overlaps at
  most two New York business days; only those stored records are read.
- Overview `runs_today` uses the runtime-daily New York business day and names
  it; a UTC-day run count is never divided by a New York schedule count.

## 4. Routes and sources

All routes: existing `deskAuth` allowed session, same-origin client,
`Cache-Control: no-store`; non-GET methods are refused through the existing
`DeskError` path. Exact path matching keeps the existing switch targets,
readbacks, credentials and alert-delivery routes intact.

### A. `GET /api/desk/switch/targets/{id}/strategies`

- Sources: saved account options, strategy profile catalog, supported-domain
  mapping. Unknown target: 404. The path id is decoded exactly once.
- `domain`: known only when exactly one supported domain is proven; none or
  several stay unknown (never "the first one").
- Rows keep profile/label/domain/allowed modes/lifecycle stage. `eligibility`
  (`eligible|no_live|blocked`) is known only where the configuration and catalog
  checks prove it, with a fixed `reason` code; otherwise unknown. Rows are not
  filtered; any unknown row makes the list partial.
- `catalog_revision` = `{kind: projection_fingerprint, algorithm: sha256, value}`:
  SHA-256 of canonical JSON (sorted keys, profiles sorted, modes de-duplicated
  and sorted, no timestamps/selectors/tokens/full config) over the source schema
  id, public target id/platform/domain, supported domains and the row
  projection. It is not a Git commit or runtime version and is unknown when the
  catalog read is incomplete.
- `switchable = {allowed: false, reason_code: "switch_not_connected"}`. All
  switch write routes keep their existing 409 boundary.

### B. `GET /api/desk/ribbon[?date=YYYY-MM-DD]`

- Sources: saved account options and stored runtime-daily records through the
  existing read-only `todaySummary` builder.
- `console_state.mode`: fixed unknown/not_supported (no single trusted global
  runtime mode source). `gateways`: v1 Read unknown/not_supported, no probing.
- `alert_badge`: fixed unknown/not_supported (no alerts store); the UI shows
  `?`, never 0, and hides it behind the lock.
- `sessions`: US/HK/CN slots, every state unknown with null times.
- `next_run`: unknown/source_unavailable (no verified schedule source is read).
- `freshness`: from the oldest displayed stored observation and the source
  stale threshold, never from `generated_at`.
- Tape mapping per stored run: a `finished_at` instant gives `state: done`,
  otherwise `unknown`; `runtimeDailyRunIssue(run) == "failure"` gives outcome
  `error`; unconfirmed runs give outcome `null`; confirmed `filled` gives
  `filled`; confirmed `no_submission|no_signal|no_rebalance` gives `no_op`.
  Transport acceptance is never read as execution success. Tape coverage
  counts configured accounts whose relevant business days were fully read; at
  most 100 entries (truncation makes it partial).

### C. `GET /api/desk/accounts`

- Sources: saved account options, stored account-facts snapshots (existing
  `account_facts_list`), stored credential-maintenance record (existing
  `credential_maintenance_read`).
- Brokers keep platform and masked target references only; a configuration
  key is never presented as an account number.
- `connectivity`, `heartbeat`, `last_order`: unknown/not_supported.
- `config.state` unknown and `drift_count` unknown/not_supported: no stored,
  identity-bound readback comparison is read on this path, so no "synced/0".
- `data_freshness`: oldest bound stored observation; any missing one makes it
  unavailable.

### D. `GET /api/desk/performance[?range=&scope=]`

- `range` ∈ `1M|3M|6M|YTD|1Y|ALL`, Desk default `6M`; `scope` default and only
  value `all`. `scope=strategy` → 422 `scope_not_supported`; any other scope,
  `target_id`, unknown key or invalid range → 400. Legacy `/api/performance/*`
  ranges and their `ALL` default are unchanged.
- Window: end = trusted now as an Asia/Shanghai business date; start steps
  back 1/3/6/12 calendar months with month-end clamping, closed interval;
  `YTD` = Jan 1; `ALL` = first stored qualifying date. Examples:
  2024-08-31 6M → 2024-02-29; 2025-08-31 6M → 2025-02-28; 2025-03-31 1M → 2025-02-28.
- `history.retention_days = 366`; `first_date`/`truncated_by` come from real
  stored coverage. A window before retention/inception is partial.
- Sources: stored account-facts snapshots and stored daily history (existing
  `account_facts_history_read`) through the existing builders.
- `equity` (indexed to 100 at the first qualified point, `drawdown_ratio` from
  the running peak, `gap_semantics: break_before_observation`) is offered only
  for an identity-bound, single-currency, complete cohort with known external
  cash flows. The stored snapshots carry no qualified cash-flow source, so
  asset change is never presented as a return series: the curve and its
  derived risk ratios stay unknown in that case. Mixed currencies are
  `mixed_currency`.
- `sharpe`, `sortino`, `volatility_ann_ratio`, `time_under_water_days`,
  `vs_benchmark_pts`, `scorecard`, `contribution`, `monthly`: unknown/not_supported.
  The UI has no computed fallback; CAGR has no N1 source.

### E. `GET /api/desk/overview`

- Composed in-process from the same projections (no HTTP fan-out): account
  facts, daily history, the current New York runtime-daily day and the
  credential record.
- No server FX: a combined NAV only for a single-currency, identity-verified,
  complete non-paper cohort (`reporting_currency` = that currency). Mixed
  currencies: `status: unavailable`, `nav: null`, `fx` unknown, coverage reason
  `mixed_currency`, `excluded_reasons: [fx_unavailable]`, display-only USD
  convention. Missing accounts make the totals partial.
- A stored daily record counts as covered only when its source coverage is
  complete (fresh or stale alike); a stale, incomplete record is never a
  verified empty tape or a counted run.
- `runs_today`: partial at most (`expected`/`pending` null without a verified
  schedule source); `config_drift`: unknown/not_supported; a known count read
  may not hide a `null` member.
- `book`: per-target masked rows; strategy/mode/runtime are not inferred from
  configuration; NAV only from a bound stored snapshot. `last_run` is an N1
  Read: known `null` only when the stored daily record was read completely and
  holds no finished run; a failed, missing, unbound or incomplete record is
  unknown and never rendered as "no run".
- `needs_you`: credential-maintenance items only; pending decisions are not read,
  so the list is partial and never "nothing needs you".
- `drawdown`, exposures: `null` (no risk thresholds or three-tier runtime).

## 5. Security and read boundary

- Responses carry only masked references and public profile/target ids; no
  broker account, token, environment value, private URL or raw exception.
- Errors: invalid query 400, no session 401, unknown target 404, unsupported
  scope 422. A failed or missing source is normally a 200 with an unknown or
  partial read, never a known empty. Unexpected failures use the fixed
  `read_failed`/502 response.
- The five handlers call no PUT/POST/write/dispatch/scheduler/readback-create or
  provider-collection function. The only Durable Object commands they can
  reach are the existing read-only `account_facts_list`,
  `account_facts_history_read` and `credential_maintenance_read` (existing POST
  RPC transport); the Worker wrapper rejects any other command. Tests inject
  fakes that throw on any write and assert zero such calls.

## 6. Frontend wiring

- `DeskApp` takes source freshness from the ribbon `freshness` field; the
  response time never drives data age.
- Dock badge: unknown shows `?`; TopBar shows a "mode unknown" chip; both are
  hidden behind the lock. Old callers keep their behaviour.
- Overview/Accounts/Strategies/Performance unwrap validated reads: unknown and
  partial are never success-empty; stale is greyed. Logs only adapts the shared
  ribbon tape; it keeps its fixture read.
- Strategy live eligibility is never derived from configuration alone;
  `switchable` stays false.

### Open item: live source flip and strategies page adoption

`DESK_SOURCES` in `src/desk/api/endpoints.ts` still marks the five areas as
`mock`, so the console keeps their fixture labels until a follow-up flips them
to `live`. The strategies page and `api.switchStrategies()` still use the v1
catalog client; the N1 `switch_strategies` guard and mock normalisation exist
in `src/desk/api/n1.ts` but are not wired into that page yet. Both follow-ups
also update the source-pinning assertions in the existing Desk frontend tests.
Alerts and Logs stay fixtures either way.
