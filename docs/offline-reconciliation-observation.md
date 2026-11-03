# Offline reconciliation Observation Ledger preview

This companion consumer serves the **Observation Ledger** page: a read-only,
forward-only view of `accounts[].forward_reconciliation` from the account facts
read model. It also validates the synthetic observation envelope emitted by
BinancePlatform, exposed through separate split API routes. It runs on loopback
with Node.js 22 or later and built-in modules only. It does not import or change
production Worker routing, embedded console assets, account configuration,
recovery schemas, or decision handlers. Its files are outside the production
console deployment path filter. Only ordinary test CI is needed; no deployment,
credentials, IAM or cloud resources are part of it.

## Open the Observation Ledger

The page is `scripts/offline_reconciliation/index.html`; it loads external
`/offline-reconciliation.css` and `/offline-reconciliation.js` so it satisfies
the loopback server's CSP (`script-src 'self'; style-src 'self'`). It is
bilingual (zh-CN primary, en alongside) and supports light and dark themes via
`?lang=zh-CN|en`, `?theme=light|dark`, or the on-page toggles, which persist in
`localStorage` (`ol-lang`, `ol-theme`).

Its only data source is the existing `GET /api/account-facts` response field
`accounts[].forward_reconciliation` (`qsl.forward_reconciliation_read.v1`).
Rows come from the response, never from hard-coded account data. Account
identifiers are never rendered: rows show the platform and a neutral ordinal
(`Account 1`, `账户 1`) because no shared masking helper exists under `scripts/`.
Only known platform names are displayed; unrecognized platform values use a dash.

For a design review without a running account-facts service, use the inline
synthetic fixture:

```sh
node scripts/offline_reconciliation_console.mjs --mode mock
```

Open `http://127.0.0.1:4185/?sample=1`. The loopback server serves the page but
not `/api/account-facts` (and only the page, its CSS and its JS), so without
`?sample=1` the page shows its read-failure banner and clears any tally and
tables. With a static server that serves the checked-in fixture, use a
same-origin relative override against the page instead:

```text
/?source=tests/fixtures/forward_reconciliation/sample-account-facts.json
```

`?source=` accepts only same-origin relative paths; absolute URLs, protocol
relative paths, backslashes, control characters and any URI scheme are rejected
before a fetch is attempted.
There are no approve, prepare, activate or other mutating controls. Unknown and
missing values stay visibly unknown or missing, and a stale source stays stale
even when the wrapper `generated_at` is fresh.

## Split API preview

The same loopback server keeps the earlier synthetic observation preview as API
routes. The Observation Ledger page does not render these routes; they remain
for contract validation:

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

Use `--observation /path/to/observation.json` to consume output from the producer
instead of the checked-in golden fixture. Paths are local synthetic files only;
do not download real account data or September production records to this mock.
For additional scenarios replace `matched.json` with `mismatched.json`,
`missing-ledger.json`, `missing-reference.json` or `busy.json`.
Missing ledger/reference displays **无法比较** (not comparable), never invented
balances. All examples are fictional, including the September 1999 recovery.
The actual September production pack is never read or modified.

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

The validation job runs this command. It also imports
`tests/observation_ledger_validation.mjs`, so both suites run in the same CI
step; run `node tests/observation_ledger_validation.mjs` alone for a faster
loop. The ledger suite exercises honest cell mapping (missing stays
Unreconciled, unprovable stays Not proven), the four-state tally identity,
locale key parity and non-empty copy, read-only page markup with no form or
mutating control, fixture account ordinals instead of `account_key`, sample
rendering, theme/language persistence, browser defaults, the relative
`?source=` override, rejection of absolute sources, and the page-level error
banner that clears stale tallies and tables. The console suite retains strict
contract rejection, freshness, the split API, preserved historical JSON,
unavailable sections and rejected mutation paths. Existing production recovery
tests continue unchanged in the normal repository CI.

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
