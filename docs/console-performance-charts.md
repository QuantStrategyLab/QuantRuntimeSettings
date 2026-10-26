# Console performance charts

The overview has one cumulative-return chart (selected scope plus four market
benchmarks) and one USD total-assets chart without benchmarks. Both use the same
1M / 3M / YTD / 1Y / ALL selection. No chart library or runtime dependency was
added: the existing React/SVG rendering approach is reused.

## Returns and external cash flows

For an observed value `V[t]` and signed external flow `F[t]` (deposit positive,
withdrawal negative), the end-of-period flow convention is:

```
r[t] = (V[t] - F[t]) / V[t-1] - 1
I[0] = 1
I[t] = I[t-1] * (1 + r[t])
R[t] = 100 * (I[t] / I[start] - 1)
```

`V[t]` includes the external flow at that endpoint. Flow coverage must cover the
whole interval since the preceding observation; explicit `0` means confirmed
no external flows. A deposit of 100 taking value from 100 to 200 produces 0%,
as does a withdrawal of 40 taking value from 100 to 60. Valuations at every flow
boundary give exact subperiod TWR. Daily data use the stated end-of-day flow
convention; they cannot establish exact intraday TWR for intraday flows. Fees
and dividends remain investment performance, not external capital flows.

**The currently stored account/wallet history APIs do not supply complete
external-flow records.** The adapter therefore explicitly sets coverage to
unknown. It never infers flows from cash balances, trades or valuation changes.
For these intervals the displayed index chain-links `V[t]/V[t-1]`, an
**unadjusted estimate**, and the UI identifies affected accounts and warns that
deposits/withdrawals may appear in returns. This is labelled partial, never
qualified TWR. A broker's independent interval-return record is still shown in
the summary and is not substituted for the selected chart window.

## Accounts, currencies and incomplete data

All accounts excludes paper accounts and known duplicate/conflicting bindings,
using the console's existing admission rule. It does not certify that all
physical account identities have been verified. All currencies reported in an
account's balances are requested from existing history GET APIs. Currency rows
must share a real observation date to form an account value. Accounts without
complete currency history or a usable FX quote are excluded with a partial
coverage notice, never counted as zero. The remaining account cohort is fixed:
only dates shared by every member are summed. Missing dates are counted and
disclosed. Changing account availability does not create a return.

`V_portfolio[t] = sum(V_account[t])` and `F_portfolio[t] = sum(F_account[t])`
then feed the same formula; this weights each subperiod by opening capital,
not by averaging account percentages. A flow is usable only if every member's
flow covers the same interval. If cohort dates were skipped, coverage is unknown.

USD conversion reuses `amountToUsd` and the overview's same-origin
`/api/overview-fx` quotes (Frankfurter ECB latest references). The existing
USD/USDT 1:1 reporting convention is retained. CNH uses the existing CNY reference.
The latest quote is held fixed across the entire displayed history: **these are
not historical FX returns**. When a non-USD conversion is used, the UI marks the
result indicative and states that historical currency effects are excluded.
Missing quotes are never invented. No new FX source or API is introduced.

## Dates, alignment and rebasing

The range ends on today's Asia/Shanghai calendar date, matching stored chart
observation-date labels. 1M/3M/1Y subtract calendar months/one year, clamping to
the last day of the destination month. YTD starts January 1; endpoints are
inclusive. ALL includes all valid stored dates through today. Default is ALL
when the observed history is shorter than one year, otherwise 1Y.

After slicing, choose the **first exact common date on or after range start**
between the selected scope and every benchmark that has valid in-range prices.
Trim every return curve to that date and rebase all to exactly 0.00%. This may
shorten the requested window; the UI shows the actual baseline and coverage.
A benchmark with no in-range prices is explicitly unavailable. If there is no
common date across available benchmarks, comparisons are omitted and the primary
starts at its own first in-range observation. Legend toggles affect visibility
only and never change the baseline. Benchmarks show price returns, excluding
dividends, currency conversion and fees.

No missing dates are interpolated, carried forward or zero-filled. Lines break
at every calendar-day gap (including weekends/holidays); observed multi-day
returns remain valid endpoints. Tooltips show the exact selected date and every
visible series, using “No observation” where that series has no sample that day.
Conflicting duplicates are omitted. A non-positive opening value or impossible
adjusted ending value stops subsequent return calculation with a notice.
One point shows only a 0.00% baseline and establishes no earned return.

Last observation dates are shown for the scope and each benchmark. More than
three calendar days old is labelled stale; this display threshold does not
change any account freshness, identity, auth or trading protection. Empty,
truncated and incomplete histories are stated explicitly. Charts use stored
history only; a current snapshot is not inserted into missing history.

## Verification

`node --experimental-strip-types tests/console_performance_math_validation.mjs`
covers range boundaries (including month-end/leap-year), differing series
starts, missing benchmark days, rebasing, deposits/withdrawals, capital-weighted
multi-account TWR, unknown flows, incomplete cohorts, empty/single observations
and invalid values. All fixtures are synthetic. Loader, render and refresh
tests exercise the production components without live account data.

## Performance API statistics

The [console API](console-api.md) exposes calendar, summary, return, asset and
current-holdings blocks. Pure statistics are separate from HTTP handlers. Charts
and the Worker share `web/strategy-switch-console/performance_math.js`; the
frontend helper module re-exports its types and functions.

Daily P/L is `V[t] - V[previous close] - F[t]`. Its displayed daily percentage is
`100 * daily P/L / (V[previous close] + F[t])` when the denominator is positive.
The period's simple-weighted percentage is
`100 * period P/L / (V[start] + sum(F))`, only with complete flows. Period and
monthly TWR use the shared end-flow index above. Maximum drawdown is the largest
`100 * (1 - I[trough] / I[peak])` on that index, with the peak before the trough.
It is zero for a monotonic positive index and unavailable for fewer than two
observations. A deposit during a drawdown does not reset its peak.

Excess return is primary minus benchmark return in percentage points. Every
comparison uses the shared aligned start and its last exact shared endpoint.
The endpoint is returned so different histories cannot hide different end dates.
The API never labels an unknown-flow curve as TWR or computes qualified drawdown
from raw assets. Best and worst day are ranked by supported daily return, with
the corresponding amount. They are null when daily returns cannot be supported.

Observation dates retain producer-provided daily labels; the API does not
reinterpret an intraday timestamp as a US session date. Range boundaries use
Asia/Shanghai as above. Stock calendars mark Saturdays and Sundays non-trading.
Binance-only calendars include every calendar day. There is no stored holiday
calendar: an absent weekday is `snapshot_missing`, not a presumed holiday.
The prior stock close must be the immediately preceding weekday; an intervening
missing weekday makes daily change unavailable. No multi-day change is assigned
to a single calendar day. A month with missing required dates has a null total
and return, plus `observed_amount` and observed/expected day counts. The partial
sum is not a full-month result. Positive/negative numeric signs carry no colors;
clients retain the console's existing locale-aware up/down colors.

| Stored source | Assets/history | Current positions | Cash-flow-qualified daily P/L/TWR | Console fills |
|---|---|---|---|---|
| LongBridge | Broker balances and up to 366 daily snapshots | Not carried by this schema | Unavailable: complete flows absent | Not connected |
| IBKR | Broker balances and up to 366 daily snapshots | Optional `stocks_only`, optional average cost | Unavailable: interval-return reports do not provide daily flows | Not connected |
| Schwab | Broker balances and up to 366 daily snapshots | Optional `strategy_symbols_only`, optional average cost | Unavailable: complete flows absent | Not connected |
| Firstrade | Broker balances and up to 366 daily snapshots | Not carried by this schema | Unavailable: complete flows absent | Not connected |
| Binance | Stored USDT wallet-valuation history | Not a stock-position source | Unavailable: complete flows absent | Not connected |
| Other configured platforms | No connected snapshot-history source | Unavailable | Unavailable | Not connected |

This table describes source capabilities, not the presence of data in any specific
account. Holdings use only current broker-reported rows, labelled current,
unrealized. `unrealized_pnl = market_value - avg_cost * quantity`; missing cost
produces null with `avg_cost_missing`. These are not period contributions.
There is no daily position history or closed-trade source for attribution or
win-rate statistics. No trade count, fee estimate or placeholder win rate is
returned. Native-currency API amounts remain separate; see the API contract for
mixed-currency percentage curves.

Definitions are informed by Longbridge's public
[P/L analysis guide](https://longbridge.com/sg/en/support/topics/tradingfaqs/pl-analysis).

## Native date-only cash-flow facts

`POST /api/account-facts/external-flow/sync` uses the existing dedicated platform
credential and server-owned target/source/account bindings. Its
`account_external_flow.v1` envelope contains those identity fields and
`externalFlow`, independently of a current account snapshot. Historical imports
do not update balances, snapshot dates or freshness. The existing external-flow
switch controls ingestion and reads; no new credential or storage service is used.

`external_flow.v2` retains v1 exact-time windows and also accepts native date
windows: `time_precision: "date"`, inclusive ISO `period_start`/`period_end` of at
most 31 days, and `coverage: "reported"`. These records contain `effective_date`
instead of `effective_at`. Their hashed source references derive from stable
broker transaction identifiers, not report order or a fabricated timestamp.
Overlapping reports may repeat the same unchanged event; conflicting facts are
rejected. Reported-empty is not proof of zero external flows.

The existing SQLite account/source context is reused, with direct readback after
write. Session-protected history GET returns the original date precision and
decimal strings. Date-only records cannot satisfy the exact-time coverage used
by Modified Dietz and do not acquire intraday weights. They do not overwrite
qualified native broker TWR, infer transfers, or reclassify dividends, interest,
fees, settlement or FX as external capital.
