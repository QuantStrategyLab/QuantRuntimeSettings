# Phase 2 YARDSTICK — Canonical Definitions Contract

**Status date:** 2026-11-15
**Phase:** 2 (`YARDSTICK`, batch `Y1`) — documents only. Specifying canonical definitions authorizes no code edits, data reads, deployments, paper orders, or live orders.
**Contract owner:** `coordinator` (`Q1-2`, `Q4-1`)
**Sign-off status:** Proposed — pending the owner's sign-off on this contract prior to `Y3` experiment pre-registration (including resolution of `OQ-1`).
**Related documents:** [cost-model.md](cost-model.md) | [rebase-register.md](rebase-register.md) | [decisions-rebase.md](decisions-rebase.md) | [sizing-unit.md](sizing-unit.md)

## Authorization state

Standing boundaries from Phase 0 `REBASE` ([decisions-rebase.md](decisions-rebase.md), [sizing-unit.md](sizing-unit.md)) remain in force:

- Live trading is fully **OFF**.
- Kelly sizing is **research-only** and **computed-not-applied** in the pilot.
- The stop-loss **return rule** is **OFF**.
- Pre-existing loss/exposure hard breakers (`L0`, `L2–L4`) remain unimplemented/unarmed until built and tested in `FUSE`.

This contract establishes **one canonical mathematical definition per quantity** across Phases 2–4 (`YARDSTICK`, `SUPPLY-A`, `FUSE`, `SUPPLY-B`, `PILOT`, `REPLAY`, `PAPER`) for the single-USD leveraged ETF pilot (`TQQQ`, `SOXL`, USD T-bill collateral; declared `B_0 = US$50,000`). It states definitions, units, annualization factors, edge-case rules, and governing register rows. It contains zero claims, verdicts, parameter recommendations, or return conclusions about strategy merit.

Once signed off, `SUPPLY-B` emitters must freeze and populate `method_version` referencing this contract (console outputs currently emit `method_version: null` per [../console-api.md](../console-api.md)).

> **Register notation note:** [sizing-unit.md](sizing-unit.md) §4.2 cites `Q2-1(a)`, `Q2-2(a)`, `Q3-1(a)`, and `Q5-1(a)`, which correspond to base register rows `Q2-1`, `Q2-2`, `Q3-1`, and `Q5-1` in [rebase-register.md](rebase-register.md) Table A. `decisions-rebase.md` uses `B = E* + H`, synonymous with `W* = E* + H` in [sizing-unit.md](sizing-unit.md), while `B_0 = US$50,000` denotes the initial declared pilot bankroll at `t = 0`.

---

## 1. Global Time, Session, and Moment Conventions

### 1.1 Trading Calendar (`t`) and Annualization Factors (`N_yr`)

- **Session index (`t`):** Discrete regular-session close index on `XNYS`, with canonical annual session count `N_yr = 252` sessions/year (matching `sessions_per_year = 252` and schema upper bound `maximum = 366` in `python/scripts/long_horizon_risk_composer.py`).
- **Calendar-day accrual (`Δτ_t`):** Overnight financing and T-bill collateral accrual between sessions `t - 1` and `t` use actual calendar days divided by `365`: `Δτ_t = calendar_days(t - 1, t) / 365` (defined in [cost-model.md](cost-model.md)).
- **Annualization table:** Trading, risk, and turnover quantities share `N_yr = 252`; never mix `252`, `260`, or `365` across metrics within a run.

| Quantity | Formula from daily observations (`N` sessions) | Factor | Unit |
| --- | --- | --- | --- |
| Geometric annualized log growth | `g_ann = 252 × g_bar` (equity factor `exp(g_ann) - 1`) | `252` (log space) | `1/yr` (or `%/yr`) |
| Geometric annualized TWR | `R_ann = (I_T / I_0)^{252 / N} - 1` | exponent `252 / N` | `%/yr` |
| Arithmetic mean return | **Disallowed** for compounding or policy targets; report `g_ann` | — | — |
| Annualized volatility | `σ_ann = √252 × σ_daily` | `√252` | `%/yr` |
| Annualized Sharpe ratio | `SR_ann = √252 × E[r_t - r_{f,t}^daily] / σ(r_t - r_{f,t}^daily)` | `√252` | `yr^{-1/2}` |
| Annualized 1-way turnover | `TO_ann = 252 × (1 / N) ∑_{t=1}^N TO_{1way,t}` | `252` | `1/yr` (`%/yr`) |
| Annualized breaker trip rate | `λ_trip = 252 × count(new_latch_events) / N` | `252` | `trips/yr` |

### 1.2 Gross vs. Net Returns (`r_t^gross`, `r_t`)

- **Gross return (`r_t^gross`):** Daily mark-to-market return prior to account-level commissions, spread/slippage, and venue fees. For real ETF market series, close-to-close total return already reflects embedded ETF sponsor fees and swap carry; for synthetic `3×` series prior to vehicle friction, gross levered return is `3 × r_{idx,i,t}`.
- **Canonical net return (`r_t`):** Every portfolio headline return, `TWR` series, growth rate `g`, `MDD`, `SR_ann`, and `DSR` uses **net portfolio return after all applicable costs** specified in [cost-model.md](cost-model.md) (broker commissions/regulatory fees, spread/slippage, plus synthetic `TER + swap carry` on synthetic segments, plus earned unallocated USD T-bill yield, with `$0` margin interest). By contrast, the research Kelly ceilings (`x_K^struct`, `x_K^cond`, §4.1 Step 4, `Q2-3`) are estimated strictly on the **underlying-index** excess total-return series over the long history rather than portfolio net return `r_t`.
- **Benchmark total-return basis (`Q1-2`):** All ETF and index benchmarks must use `TOTAL_RETURN_NET_OF_COST` (dividend-, split-, and distribution-adjusted total return net of applicable costs, consistent with [../market-benchmark-revision-policy.md](../market-benchmark-revision-policy.md) and [../qsl-long-horizon-risk-observation-v2.zh-CN.md](../qsl-long-horizon-risk-observation-v2.zh-CN.md)). Split-adjusted price return is disallowed.

### 1.3 Centered Variance vs. Raw Second Moment (`σ²`, `m₂`)

- **Variance (`σ²`):** Centered second moment `σ² = E[(r - μ)²]`. Finite-sample estimator uses Bessel-corrected sample variance `s² = [1 / (N - 1)] ∑_{t=1}^N (r_t - r_bar)²` unless a closed population stress distribution explicitly specifies `1 / N`.
- **Raw second moment (`m₂`):** `m₂ = E[r²] = σ² + μ²`. Never substitute `m₂` for `σ²` in volatility targeting (`v_{i,t}`), Sharpe denominators, variance-drag diagnostics, or structural Kelly (`μ_shrunk / σ_long²`). Any analytical decomposition showing both must label `m₂` separately as non-centered.

---

## 2. Cash Flows, Time-Weighted Return (`TWR`), Drawdown, and Horizon Metrics

### 2.1 External Cash Flows (`F_t`) and Corporate Actions (`α_t`)

- **External flow (`F_t`):** USD capital deposits (`F_t > 0`) and withdrawals (`F_t < 0`) crossing the sizing-unit boundary. Internal ETF trades, dividend distributions received inside the sizing unit, T-bill roll interest, and brokerage fee debits are **not** external flows (`F_t = 0`).
- **Corporate-action factor (`α_t`):** Split factors `α_t` and cash/stock distributions adjust price and share series strictly on ex-dates so corporate actions inject zero artificial return spikes into `r_t`, realized volatility, or `I_t`. Delisted or reorganized instruments require explicit terminal valuation rather than silent truncation.

### 2.2 Primary Return Definition: Daily-Linked Time-Weighted Return (`TWR`, `Q1-2`)

Across session interval `(τ_{t-1}, τ_t]` with opening post-flow sizing-unit equity `E_{t-1}` at `τ_{t-1}` and ending post-flow sizing-unit equity `E_t` at `τ_t`:

1. **No-flow or ending-boundary-only flow (`F_t = 0`, or every external flow in `(τ_{t-1}, τ_t]` settles at exact `τ_t` after session `t`'s investment performance, matching `instant(effective_at) === instant(end)` in `web/strategy-switch-console/application/console_api/cashflow_performance.js`):**
   `r_t = (E_t - F_t) / E_{t-1} - 1`
   where `E_t^pre = E_t - F_t` is exact post-return, pre-boundary-flow equity at `τ_t`.
2. **Any earlier intraday / inter-snapshot flow (`M ≥ 1` ordered flow timestamps `τ_{t-1} < τ_{t,1} < … < τ_{t,M} < τ_t`, including a single earlier flow `M = 1`, plus optional ending-boundary flow `F_{t,end}` at `τ_t`):**
   Exact `daily_linked_twr` requires complete pre-flow sub-valuations `E_{t,m}^pre` at every flow timestamp `τ_{t,m}` (`E_{t,m}^post = E_{t,m}^pre + F_{t,m}`, `E_{t,0}^post = E_{t-1}`) chained through the terminal pre-end-flow valuation `E_t - F_{t,end}` at `τ_t`:
   `1 + r_t = [ ∏_{m=1}^M (E_{t,m}^pre / E_{t,m-1}^post) ] × [ (E_t - F_{t,end}) / E_{t,M}^post ]`.
3. **Missing intraday pre-flow valuation(s):** Whenever any flow (including a single flow) settles at `τ_{t,m} < τ_t` without complete pre-flow sub-valuations, `(E_t - F_t) / E_{t-1} - 1` **must not** be used and exact `daily_linked_twr` is unavailable. Unless qualified `native_ibkr_twr` covers `(τ_{t-1}, τ_t]`, use **only** the labelled Modified Dietz display fallback (§2.3, `return_method: "modified_dietz"`, `approximate: true`, matching `cashflow_performance.js:83–103`), or emit an **unavailable status** (`status: "partial"`, `return = null`, explicit `unavailable_reason`) where Modified Dietz is itself disqualified (§2.3).
- **Wealth / performance index (`I_t`):** Initialized at `I_0 = 1.0`, chained daily as `I_t = I_{t-1} × (1 + r_t)`. Cumulative `TWR` across `[a, b]` is `R_{a,b}^TWR = I_b / I_a - 1`.
- **Native IBKR TWR (`native_ibkr_twr`):** Accepted strictly for IBKR-custodied segments when `ChangeInNAV.twr` passes ratio validation (`percent / 100 = ratio` per [../ibkr-period-return.md](../ibkr-period-return.md)), exact interval matching, and external-flow consistency. Synthetic paths and cross-account blends never use `native_ibkr_twr`.

### 2.3 Fallback Return Definition: Modified Dietz (`R_MD`, `Q1-2`)

- **Formula:** Across an interval `(a, b]` with starting equity `V_0`, ending equity `V_1`, external flows `F_j` at timestamps `τ_j ∈ (a, b]`, and net flow `F_net = ∑_j F_j`:
  `R_MD = (V_1 - V_0 - F_net) / (V_0 + ∑_j w_j F_j)`, where `w_j = (b - τ_j) / (b - a)`.
- **Granularity reconciliation:** `PART-B.md` §2.3 describes monthly Modified Dietz as a reporting fallback, while `cashflow_performance.js` implements the same weighted formula on daily timed-flow intervals. Under this contract, `Modified Dietz` is governed uniformly across daily and monthly display cells whenever intraday pre-flow valuations and qualified native TWR are absent.
- **Disqualification and hard usage bans:**
  1. Missing intraday flow timestamp (`time_precision: "date"` in console records) **disqualifies** Modified Dietz (`status: "partial"`, `return = null`, explicit `unavailable_reason`; never assign midpoint weight `w_j = 0.5`).
  2. Every Modified Dietz return must carry `return_method: "modified_dietz"` and `approximate: true`.
  3. **Hard ban:** Modified Dietz never feeds sizing (`c_t`, `E_t*`, `x_K`), drawdown/risk breakers (`dd_t`, `L_t`), statistical tests (`g`, `SR_ann`, `DSR`), or Phase 4 verdicts.

| Field (`console-api.md` / `performance.js`) | Allowed canonical values under this contract |
| --- | --- |
| `return_method` | `"daily_linked_twr"` \| `"native_ibkr_twr"` \| `"modified_dietz"` (display fallback only; `return = null` with `status: "partial"` and explicit `unavailable_reason` when both exact TWR and Modified Dietz are disqualified) |
| `cashflow_method` | `"exact_subperiod"` \| `"end_of_day_boundary"` \| `"timed_dietz_denominator"` |
| `approximate` | `false` for exact daily-linked / qualified native TWR; `true` for Modified Dietz |
| `method_version` | Contract tag populated in `SUPPLY-B` after owner sign-off (`null` prior to sign-off) |

### 2.4 Objective Function: Net Log Growth (`g`, `g_ann`, `log_growth_ppm`, `Q1-2`)

- **Daily net log growth:** `g_t = ln(1 + r_t)` for `r_t > -1.0` (`g_t = -∞` on ruin `r_t ≤ -1.0`). Unit: nats per session.
- **Sample mean and annualized log growth:** `g_bar = (1 / N) ∑_{t=1}^N g_t`, `g_ann = 252 × g_bar`.
- **Integer ledger encoding (`long_horizon_risk_composer.py`, `m0_research_ledger.py`):** Research ledger records emit integer `log_growth_ppm = floor(ln(I_T / I_0) × 10^6 / N)` (parts-per-million per session, floored). Reports must state whether continuous `g_ann` or floored `log_growth_ppm` is shown.

### 2.5 Flow-Adjusted Drawdown (`dd_t`, `MDD`), Rolling Drop (`L_20`), and Horizon (`u_t`, `TTR`)

- **Running TWR high-water mark (`I_t*`):** `I_t* = max_{0 ≤ u ≤ t} I_u`.
- **TWR drawdown (`dd_t`):** `dd_t = 1 - I_t / I_t* ∈ [0, 1]` (loss fraction; percentage display `100 × dd_t` matches `web/strategy-switch-console/performance_math.js`; integer research ledger emits `max_drawdown_bps = ceil(MDD × 10000)` via `ROUND_CEILING` in `long_horizon_risk_composer.py`).
- **Maximum drawdown (`MDD`):** `MDD = max_{0 ≤ t ≤ T} dd_t`.
- **Single-session loss and 20-session drop (`L_1`, `L_20`):**
  - Single-session TWR drop on sizing-unit equity (`E`): `L_{1,t} = max(0, 1 - I_t / I_{t-1}) = max(0, -r_t)` (equity-level display metric only; does not substitute for the bankroll breaker loss `L_{1,t}^B` defined in §3.4 when `H > 0`).
  - 20-session window drop: `L_{20,t} = max(0, 1 - I_t / I_{t-20})`.
- **Underwater streak (`u_t`, `underwater_sessions`):** Consecutive closed `XNYS` sessions since the last strict peak (`u_0 = 0`; `u_t = 0` iff `I_t ≥ I_{t-1}*`, else `u_t = u_{t-1} + 1`).
- **Time-to-recovery (`TTR`):** Closed `XNYS` sessions elapsed from a drawdown episode's trough `t_trough` (`argmin` inside an underwater spell) to the first session `t_rec > t_trough` with `I_{t_rec} ≥ I_{t_peak}*`; marked `right-censored` if unrecovered at sample end `T`. Strictly isolated from deposits/withdrawals via `I_t`.

---

## 3. Sizing Unit, High-Water Equity (`E*`), Bankroll (`W*`), and Cushion (`c`)

### 3.1 Sizing-Unit Equity (`E_t`) and Declared Bankroll (`B_0`, `Q4-1`, `Q2-4`)

- **Sizing unit:** One USD account unit for the pilot; declared initial bankroll `B_0 = US$50,000` (separate from outside brokerage holdings, [sizing-unit.md](sizing-unit.md)).
- **Current sizing-unit equity (`E_t`):** Mark-to-market USD net liquidation value inside the unit (`settled USD cash + T-bill / bill-fund NAV + long ETF market value - accrued unpaid execution fees`; `$0` margin debt).
- **Initial values at `t = 0`:** `E_0 = B_0 = US$50,000`, `E_0* = B_0 = US$50,000`.

### 3.2 High-Water Sizing Equity (`E_t*`) and Cash-Flow Rules ([decisions-rebase.md](decisions-rebase.md) R3, `Q2-2`, `Q5-1(c)`)

Flow timing follows §2.2 strictly: `E_t^pre = E_t - F_t` denotes post-return, pre-flow equity at session `t` **only** when flow `F_t` settles at the ending valuation boundary `τ_t`. Any earlier flow at `τ_{t,m} ∈ (τ_{t-1}, τ_t)` must be processed sequentially at its exact pre/post-flow sub-valuation `(E_{t,m}^pre, E_{t,m}^post = E_{t,m}^pre + F_{t,m})` before subsequent returns; if an intraday flow lacks timestamped pre-flow sub-valuations so exact flow-adjusted separation is unavailable, sizing and loss controls fail closed (`O1` `NO-NEW-RISK`, never consuming Modified Dietz per §2.3).

1. **Mechanical upward ratchet (`F_t = 0` or `F_t > 0`):** `E_t* = max(E_{t-1}*, E_t)`. External deposits enter `E_t` on settlement at the valuation boundary and update dollar capacity once via upward ratcheting without fabricating multiple risk budgets.
2. **External withdrawal (`F_t < 0`):** Under [decisions-rebase.md](decisions-rebase.md) R3 rules 2–4, governed recorded `E_t*` **never** resets, scales downward, or re-bases automatically on withdrawals or losses. Because a withdrawal reduces `E_t` below `E_{t-1}*`, `E_t* = E_{t-1}*` remains unchanged, keeping `W_t* = E_t* + H` and the governed account-level loss budget share `min(100%, D × (1 + H / E_t*))` strictly non-loosening. *(Automatic proportional downward scaling of `E*` on withdrawals is omitted because it conflicts with R3's ban on automatic `E*` resets/re-basing and loosens `D × (1 + H / E*)` whenever `H > 0`.)*
3. **Owner governance downward reset ([decisions-rebase.md](decisions-rebase.md) R3 rules 3–4):** Any downward reset or re-basing of recorded `E_t*`, or any change to `H` or the tier, is allowed at most once per **30 calendar days** cooling-off, is strictly prohibited whenever flow-adjusted bankroll drawdown reaches or exceeds the Amber threshold (`dd_t^B ≥ D / 3`, `L1` interlock), and requires an explicit owner governance card. Any unrecorded change to `E_t*`, `H`, or tier halts execution (`O9` `HALT`).
4. **Explicitly recorded mid-drawdown deposit tension (`PART-C.md` §3.2 Q2 vs. [decisions-rebase.md](decisions-rebase.md) R3):** `decisions-rebase.md` R3 states both that `E*` includes deposits/flows and that `E*` updates only when drawdown is zero (which holds whenever `F_t = 0`). When a large mid-drawdown deposit (`dd_t^B > 0`) pushes `E_t > E_{t-1}*`, rule (1) ratchets `E_t*` up to `E_t` — slightly tightening `D × (1 + H / E_t*)` when `H > 0` (never loosening it) while leaving flow-adjusted `dd_t^B` and `c_t` invariant on the flow session — and must emit an explicit `SUPPLY-A`/`FUSE` flow-audit event.

### 3.3 External Committed Reserve (`H`) and Governed Bankroll (`W_t`, `W_t*`)

- **Committed liquid reserve (`H`, USD, `H ≥ 0`):** Pre-committed liquid cash or `≤ 3`-month Treasury bills held outside the unit explicitly dedicated to absorb unit drawdowns (`decisions-rebase.md`). Never adjusted automatically by the system; changed only by owner card with a 30-day cooling-off period and locked against loosening while `dd_t^B ≥ D / 3` (`L1`). Excluded: speculative holdings, illiquid assets, or uncommitted balances.
- **Default and ceiling:** Default **`H = 0`**; ceiling proposal **`H ≤ 3 × E_t*`** (so `W_t* ≤ 4 × E_t*`), pending `PILOT` calibration and owner sign-off.
- **Current bankroll (`W_t`) and governed high-water bankroll (`W_t*`):** `W_t = E_t + H`, and **governed bankroll high-water mark** `W_t* = E_t* + H` (`W_t* ≡ B_t` in [decisions-rebase.md](decisions-rebase.md)), which governs `H ≤ 3 × E_t*`, the account-level budget share `min(100%, D × (1 + H / E_t*))`, and governance locks (`L1`, `O9`).

### 3.4 Flow-Adjusted Bankroll Reference (`W_t^{ref}`), Loss (`L_t`), `L_{1,t}^B`, and Cushion (`c_t`)

- **Flow-adjusted bankroll return (`r_t^B`) and bankroll TWR index (`I_t^B`):**
  - On a no-flow or ending-boundary-flow session `(τ_{t-1}, τ_t]` (where `F_t` settles at `τ_t`), with opening bankroll `W_{t-1} = E_{t-1} + H` and pre-end-flow bankroll `W_t^pre = (E_t - F_t) + H`:
    `r_t^B = W_t^pre / W_{t-1} - 1 = [ E_{t-1} / (E_{t-1} + H) ] × r_t`.
  - When `M ≥ 1` earlier flows occur at `τ_{t-1} < τ_{t,1} < … < τ_{t,M} < τ_t` with complete pre-flow equity valuations `E_{t,m}^pre` (`E_{t,m}^post = E_{t,m}^pre + F_{t,m}`, `E_{t,0}^post = E_{t-1}`), subperiods chain with `+ H` through the terminal valuation:
    `1 + r_t^B = [ ∏_{m=1}^M (E_{t,m}^pre + H) / (E_{t,m-1}^post + H) ] × [ (E_t - F_{t,end} + H) / (E_{t,M}^post + H) ]`.
  - Any governed owner-card update to `H` takes effect strictly between sessions (after session `t`'s `r_t^B` closes) so `H` updates inject zero artificial return into `I_t^B`.
  - Initialized at `I_0^B = 1.0`, chained daily as `I_t^B = I_{t-1}^B × (1 + r_t^B)`, with running peak `I_t^{B*} = max_{0 ≤ u ≤ t} I_u^B` (`I_t^B ≡ I_t` identically whenever `H = 0`).
- **Flow-adjusted bankroll drawdown (`dd_t^B`):**
  `dd_t^B = 1 - I_t^B / I_t^{B*} ∈ [0, 1]` (`= dd_t` when `H = 0`). Invariant to external deposits and withdrawals at exact valuation boundaries, keeping loss memory intact (`Q5-1(c)`).
- **Flow-adjusted performance peak bankroll reference (`W_t^{ref}`) and accumulated dollar loss (`L_t`, USD, `≥ 0`):**
  - Distinct from the governed high-water mark `W_t* = E_t* + H`, define the flow-adjusted performance peak bankroll reference (for `I_t^B > 0`, i.e., `dd_t^B < 1`):
    `W_t^{ref} = W_t / (1 - dd_t^B) = W_t × (I_t^{B*} / I_t^B)`
    and current-scale accumulated dollar loss:
    `L_t = W_t^{ref} × dd_t^B = W_t^{ref} - W_t`
    (at total ruin `I_t^B = 0`, `dd_t^B = 1 ≥ D` and `c_t = 0`).
  - Whenever zero external flows have occurred since the bankroll peak, `W_t^{ref} = W_t* = E_t* + H` and `L_t = W_t* - W_t = E_t* - E_t` identically. Across external deposits or withdrawals, `W_t^{ref}` scales coherently with current bankroll `W_t`, preserving both `L_t / W_t^{ref} = dd_t^B` and the exact identity **`W_t^{ref} - L_t = W_t`** while keeping governed `E_t*` and `W_t*` free of automatic downward resets.
- **Tier drawdown limit (`D ∈ (0, 1]`):** Pre-`PILOT` tier starting values (`Line 4` in [sizing-unit.md](sizing-unit.md) §4.3): `15%` (`CAPITAL_PRESERVATION`), `30%` (`BALANCED_COMPOUNDING`), `50%` (`GROWTH_COMPOUNDING`). Governed high-water dollar budget = `D × W_t*`; performance-scaled reference budget = `D × W_t^{ref}`.
- **Policy loss thresholds (pre-`PILOT` lines 4a–4c, 5; `PART-C.md` §4.4 `L1–L4`, measured on flow-adjusted bankroll; `FUSE` implements latch mechanics):**
  - Amber interlock (`L1`, `dd_t^B = L_t / W_t^{ref} ≥ D / 3`): `5% | 10% | 16.7%` of bankroll (notifies and locks tier, `H`, and `E_t*` against loosening).
  - Red breaker (`L2`, `dd_t^B = L_t / W_t^{ref} ≥ 2D / 3`): `10% | 20% | 33.3%` of bankroll (`NO-NEW-RISK`, latched).
  - Budget exhausted (`L3`, `dd_t^B = L_t / W_t^{ref} ≥ D`): `15% | 30% | 50%` of bankroll (`DE-RISK` to zero, latched; 30-day owner card, loss record not cleared).
  - **One-session flow-adjusted bankroll-loss fraction (`L_{1,t}^B`, `Line 5` / `L4`):**
    `L_{1,t}^B = max(0, 1 - I_t^B / I_{t-1}^B) = max(0, -r_t^B)`
    On no-flow or ending-boundary-flow sessions `(τ_{t-1}, τ_t]`, `L_{1,t}^B = max(0, -(E_t - F_t - E_{t-1}) / (E_{t-1} + H)) = [ E_{t-1} / (E_{t-1} + H) ] × L_{1,t}`, measured against opening bankroll `W_{t-1} = E_{t-1} + H` (and chained with `+ H` across intraday subperiods when `M ≥ 1`). `L4` triggers `NO-NEW-RISK` at `L_{1,t}^B ≥ D / 10` (`1.5% | 3% | 5%` of bankroll). Account-equity single-session drop `L_{1,t} = max(0, -r_t)` (§2.5) is an equity-level display metric only and differs from `L_{1,t}^B` whenever `H > 0` (e.g., at `E_{t-1} = H`, a `5%` account loss `L_{1,t} = 5%` is `L_{1,t}^B = 2.5%` on the bankroll).
- **Remaining cushion (`c_t`, dimensionless, `Q2-2`):**
  - `c_t = (D × W_t^{ref} - L_t) / (W_t^{ref} - L_t) = (D × W_t^{ref} - L_t) / W_t = (D - dd_t^B) / (1 - dd_t^B)` for `dd_t^B < D` (`L_t < D × W_t^{ref}`)
  - `c_t = 0` for `dd_t^B ≥ D` (`L_t ≥ D × W_t^{ref}`)
  - Bounds: `c_t ∈ [0, D]`; at `dd_t^B = 0`, `c_t = D`. Because `W_t^{ref} - L_t = W_t` holds identically across all sessions, the cushion denominator is always current bankroll `W_t`, and `c_t` remains invariant to both deposits and withdrawals (`Q5-1(c)`).
- **Explicitly flagged source conflict ([sizing-unit.md](sizing-unit.md) §4.2 / `PART-C.md` §4.2 vs. [decisions-rebase.md](decisions-rebase.md) R3):** `PART-C.md` §4.2 and [sizing-unit.md](sizing-unit.md) write a single symbol `W* = E* + H` inside `(D × W* - L) / (W* - L)` while calling the denominator current bankroll `W = E + H`. Under external flows, one symbol cannot serve both roles: after a withdrawal (`F_t < 0`), governed `E_t*` cannot shrink (`decisions-rebase.md` R3), so `W_t* - L` diverges from `W_t` unless withdrawals are falsely counted as losses; after a mid-drawdown deposit (`F_t > 0`, e.g., `E: 80 → 120` at `dd = 20%`), `W_t* = 120` cannot satisfy `W_t* - L = W_t = 120` without erasing loss memory (`L = 0`). Separating governed `W_t* = E_t* + H` from performance peak reference `W_t^{ref} = W_t / (1 - dd_t^B)` resolves this arithmetic conflict without introducing automatic `H` changes or automatic `E_t*` resets, and is isolated here within the `Y1` contract sign-off.

---

## 4. Ten-Step Sizing Chain and Resolution of `OQ-1`

Index-equivalent exposure `x_{i,t}` measures dimensionless `1×` equity-index exposure relative to bankroll (`1.0` equals `100%` of conversion bankroll invested in `1×` index exposure, i.e., `33.3%` in a `3×` ETF when `H = 0`).

### 4.1 Steps 1–5 (Per-Sleeve Signal, Bounds, Kelly Benchmark, Volatility Scale)

1. **Step 1 — Raw signal (`s_{i,t} ∈ [0, 1]`):** Nonnegative long-only signal weight (`0` flat/inactive, `1` full signal; short/margin/options prohibited by `Line 8`).
2. **Step 2 — Tier sleeve cap (`x_cap`):** Dimensionless index-equivalent ceiling per fund (`0.20 | 0.40 | 0.80` pre-`PILOT` starting values; equivalent to `6.7% | 13% | 27%` in a `3×` ETF when `H = 0`, `Line 2`).
3. **Step 3 — Drawdown-budget / tail-loss ceiling (`x_ML(c_t)`, `Q2-2`, `Q3-2`):**
   `x_ML(c_t) = min(3 × c_t,  2 × c_t [proposal],  M(c_t))` (recomputed every session from current cushion `c_t`):
   - `(a)` **Absolute bound (`x ≤ 3 × c_t`):** Combined `3×` fund weight may not exceed `c_t` (`x = 3w ≤ 3 c_t`): if the `3×` fund(s) went to zero (`-100%`), loss stays inside `c_t`. Rests solely on the absence of margin (`Line 8`). *(Whether `x_ML(c_t)` binds per fund or across the combined sleeve is specified separately under `OQ-1` in §4.2, keeping sleeve aggregation distinct from these stress assumptions.)*
   - `(b)` **One-day gap bound (`x ≤ 2 × c_t`, *proposal*):** Proposal that a **`25%` one-session underlying-index gap** (`-75%` in a `3×` fund, consuming `(x / 3) × 0.75 = x / 4` of bankroll) consume **at most half the cushion** (`x / 4 ≤ c_t / 2 ⇔ x ≤ 2 × c_t`). Set above the `20%` S&P 500 Level 3 market-wide trading halt because the Nasdaq-100 or semiconductor index can fall further on the same day (`PART-C.md` §4.2, [sizing-unit.md](sizing-unit.md)).
   - `(c)` **Scenario bound (`x ≤ M(c_t)`, *estimate on a proposed scenario set*, `Q2-2`, `Q3-2`):** `M(c_t)` is the largest index-equivalent exposure at which the policy's simulated bankroll loss stays **`≤ c_t` in every prescribed scenario** of the pre-registered stress set (*proposal*, frozen in `Y3` pre-registration):
     1. Individual crisis paths on the long synthetic `3×` history (`Q1-1`): **`2000–02`**, **`2008`**, **`February–March 2020`**, and **`2022`** (policy loss `≤ c_t` in each scenario individually);
     2. The prescribed **one-day gap** scenario (policy loss `≤ c_t`); and
     3. The **`97.5%` Expected Shortfall (`ES_0.975`)** of `250`-session block-bootstrap bankroll losses re-centered on the shrunk mean (`Q3-2`) `≤ c_t`.
   - **Estimation status, execution/cost simulation, and class-`K` credit (`PART-C.md` §3.2 `Q1`, §4.2; [sizing-unit.md](sizing-unit.md)):** Multi-day maximum loss is an **estimate for a stated policy on a stated scenario set**, not a path-independent guarantee. Before `PILOT`, `M(c_t)` uses the conservative un-de-risked first-order approximation `M_0(c_t) = ln(1 - c_t) ÷ ln(1 - 0.83)` (`-83%` `2000–02`-class index fall held without de-risking; `0.09 | 0.20 | 0.39` at full cushion `15% | 30% | 50%`, `Line 10`, illustrative pre-`PILOT` values). `PILOT` replaces `M_0(c_t)` with `M(c_t)` simulated on the long synthetic history **with next-session execution and full model costs**, granting de-risking credit **only to de-risking rules adopted at the class-`K` bar**; `M(c_t)` can never exceed bounds `(a)` or `(b)`.
4. **Step 4 — Kelly research benchmark (`x_K^struct`, `x_K^cond`, `Q2-3`, Class `S`, COMPUTED-AND-RECORDED-ONLY):**
   - **Structural Kelly ceiling (`x_K^struct`):**
     `x_K^struct = k × max(0, μ_shrunk / σ_long²)`
     computed strictly on the **underlying-index** excess total-return series over the long synthetic history (`Y2`/`Q1-1`, never on `3×` ETF returns or portfolio `r_t`), where `k` is tier Kelly fraction (`1/8 | 1/4 | 1/2`, `Line 1`), `μ_shrunk = μ_post - s_post` (`1/yr`) is the **posterior mean minus one posterior standard deviation** of annualized underlying-index excess return over the risk-free bill rate updated from a **pre-registered broad-equity prior**, and `σ_long²` (`1/yr`, `= 252 × σ_{idx,daily}²`) is annualized centered long-run underlying-index variance (`σ_long` long-run annualized index volatility). *(Illustrative reference in [sizing-unit.md](sizing-unit.md) `Line 11`: `μ_shrunk ≈ 5.25%/yr` at `σ_long ≈ 24%/yr` gives `0.11 | 0.23 | 0.46`, illustrative only.)*
   - **`Y3` prerequisite:** Exact broad-equity prior parameters, shrinkage weight, and `σ_forecast` estimator specification are **named prerequisites settled in the `Y3` `PILOT` pre-registration file** prior to any `PILOT` run.
   - **Conditional Kelly ceiling (`x_K^cond`):**
     `x_K^cond = x_K^struct × min(1, (σ_long / σ_forecast)²)`
     where `σ_forecast` is annualized forecast underlying-index volatility (`x_K^cond ≤ x_K^struct` always).
   - **Pilot status (`Q2-3`, [decisions-rebase.md](decisions-rebase.md) R1):** Computed and recorded in every shadow and paper ledger entry (alongside a boolean would-have-bound flag and implied exposure); **never applied** to position sizing until a separate Kelly card is signed.
   - **Separate monthly diagnostics (never sizing inputs):** Empirical win rate (`p_win`, with a Bayesian credible interval) and payoff ratio (`b_payoff = mean_win / mean_loss`) are recorded **monthly** in the shadow ledger strictly as review diagnostics; the two-outcome formula `p - (1 - p) / b` is rejected for `3×` ETFs and **no sizing step ever reads `p_win` or `b_payoff`**.
5. **Step 5 — Volatility-target multiplier (`v_{i,t}`):**
   - Ratio against tier annualized volatility target `σ_target` (`5% | 10% | 19%`, `Line 13`): linear `v_{i,t} = min(1, σ_target / σ_{i,t})` vs squared `min(1, (σ_target / σ_{i,t})²)`, subject to `PILOT` grid comparison.
   - **Fail-closed missing-data override (`Q4-1`, `PART-C.md` §4.4 rule 5):** Overrides legacy `vol_scale` missing-data default `1` in [../qsl-capital-risk-envelope-v1.zh-CN.md](../qsl-capital-risk-envelope-v1.zh-CN.md). If `σ_{i,t}` is missing, NaN, or stale, substitute `max(last_valid_σ_i, σ_stress_default)` and latch `O1` `NO-NEW-RISK`.

### 4.2 Steps 6–7 and Resolution of `OQ-1` (**Proposed — Pending Owner Sign-Off**)

- **Beta adjustment for `SOXL` (`β_SOXL`, `Line 3a`):**
  `β_SOXL = max(β_fall, 1.5)`
  where `β_fall` is measured falling-market beta of `SOXL`'s underlying index vs `NDX`, with placeholder floor `1.5` until empirical calibration in `SUPPLY-A`/`PILOT` (`β_TQQQ ≡ 1.0`).
- **Per-sleeve pre-cap index-equivalent allocation (Step 6):**
  `x_{TQQQ,t}^{pre} = s_{TQQQ,t} × min(x_cap, x_ML(c_t)) × v_{TQQQ,t}`
  `x_{SOXL,t}^{pre} = (s_{SOXL,t} × min(x_cap, x_ML(c_t)) × v_{SOXL,t}) / β_SOXL` (so raw beta-equivalent contribution starts at `β_SOXL × x_{SOXL,t}^{pre} ≤ x_ML(c_t)` prior to joint caps).
- **Source conflict (`OQ-1`):** `PART-C.md` §4.2 Step 3(a) writes `x ≤ 3c` on combined fund weight (`"If both funds went to zero the loss would still be inside the budget"`), and Step 3(c) defines `M(c)` as the largest exposure holding total policy loss inside `c`. However, Step 6 writes `s × min(x_cap, x_ML) × v` per fund, and Step 7 mentions only the static `x_joint` (`0.20 / 0.40 / 0.80`), leaving open whether `x_ML(c_t)` binds per fund or across the combined sleeve (`OPEN-QUESTIONS.md`).
- **Arithmetic under per-fund-only interpretation (Balanced tier, full cushion `c = D = 0.30`):** `x_joint = 0.40`, `M_0(0.30) = 0.20`, `Line 3a` SOXL share cap `1/3`, `β_SOXL = 1.5`. With `s = 1, v = 1` on both sleeves, per-fund `x_ML` permits `x_TQQQ = 0.20` (`6.67%` ETF weight) alongside `β_SOXL × x_SOXL = min(0.20, 0.40 / 3) = 0.1333` (`x_SOXL = 0.0889`, `2.96%` ETF weight), yielding combined beta-adjusted exposure `0.3333` (or `0.40` without the `1/3` sub-cap). Under `M_0`'s `-83%` index shock formula (`1 - 0.17^x`), policy loss reaches `1 - 0.17^{0.3333} ≈ 44.6%` (or `50.8%` at `0.40`), exceeding `D = 30%` and contradicting `R2` zero-diversification-credit (`Line 3`).
- **Adopted resolution of `OQ-1` (Proposed — pending owner sign-off):** Enforce `x_ML(c_t)` on the **combined sleeve in Step 7** as well as per fund in Step 6, keeping the combined-budget decision cleanly separated from §4.1's stress assumptions:
  1. Effective joint cap at `t`: `x_eff_joint(c_t) = min(x_joint, x_ML(c_t))`, where `x_joint` is tier `Line 3` (`0.20 | 0.40 | 0.80`).
  2. Apply `Line 3a` SOXL sub-cap (`1/3`): cap `β_SOXL × x_{SOXL,t}^{mid} = min(β_SOXL × x_{SOXL,t}^{pre},  x_eff_joint(c_t) / 3)`.
  3. Compute unscaled joint beta-adjusted demand: `x_joint_beta = x_{TQQQ,t}^{pre} + β_SOXL × x_{SOXL,t}^{mid}`.
  4. **Total piecewise Step 7 allocation across all `x_joint_beta ≥ 0`:**
     - **Identity / no-scaling branch (`0 ≤ x_joint_beta ≤ x_eff_joint(c_t)`, including zero demand `x_joint_beta = 0` and `x_eff_joint(c_t) = 0`):** `α_joint = 1`, so `x_{TQQQ,t} = x_{TQQQ,t}^{pre}` and `x_{SOXL,t} = x_{SOXL,t}^{mid}` (yielding `0` on zero demand without `0 / 0` division).
     - **Proportional scaling branch (`x_joint_beta > x_eff_joint(c_t) ≥ 0`, where `x_joint_beta > 0` strictly):** `α_joint = x_eff_joint(c_t) / x_joint_beta ∈ [0, 1)`, so `x_{TQQQ,t} = α_joint × x_{TQQQ,t}^{pre}` and `x_{SOXL,t} = α_joint × x_{SOXL,t}^{mid}` (with `J1` cross-sleeve enforcement applied on top when active).
- **Additional conservative allocation choices (distinct from combined-budget necessity):** Requiring combined beta-adjusted exposure `x_{TQQQ,t} + β_SOXL × x_{SOXL,t} ≤ x_eff_joint(c_t)` does not uniquely force two further conservative choices in Steps 6–7 above: (i) dividing `SOXL`'s preliminary Step 6 per-fund demand by `β_SOXL`, and (ii) taking `Line 3a`'s one-third `SOXL` ceiling from `x_eff_joint(c_t) / 3` rather than from static `x_joint / 3`. Both are additional conservative allocation choices explicitly included here as **proposed** conventions pending owner sign-off on this contract.

### 4.3 Steps 8–10 (Fund Weight, Deployable Capital, Whole Shares, No-Trade Band, Turnover, Independent Pre-Trade Control Layer)

8. **Step 8 — Sizing-unit ETF target weight (`w_{i,t}^{target}`, `Q2-7`):**
   Define conversion bankroll `W_t^{conv} = min(W_t,  E_t × (W_t* / E_t*)) = E_t × (1 + H / E_t*)` (since `E_t ≤ E_t*` always; **identical** to `W_t = E_t + H` at the pilot default `H = 0` and whenever `E_t = E_t*`):
   `w_{i,t}^{target} = x_{i,t} × W_t^{conv} ÷ (3 × E_t) = (x_{i,t} / 3) × (1 + H / E_t*)`
   Subject to hard constraints:
   - `w_{i,t}^{target} ≥ 0` (long-only; `Line 8` margin/short/options `never`)
   - `∑_i w_{i,t}^{target} ≤ min(w_max, 1.00)`, where `w_max` is tier `Line 12` max combined fund weight (`15% | 35% | 60%` starting values; binds only when `H > 0`; never `> 100%` cash).
   - Unallocated fraction `w_{cash,t}^{target} = 1 - ∑_i w_{i,t}^{target} ∈ [0, 1]` resides in `≤ 3`-month USD T-bills / bill fund (`Line 7`).
   - **Disclosed nonzero-`H` conversion conflict ([sizing-unit.md](sizing-unit.md) §4.2 / `PART-C.md` §4.2 vs. [decisions-rebase.md](decisions-rebase.md) R3):** [sizing-unit.md](sizing-unit.md) §4.2 writes `w = x × W ÷ (3 × E)` with `W = E + H`. Whenever `H > 0` and `E_t < E_t*` (after a drawdown or withdrawal), `W_t / E_t = 1 + H / E_t > 1 + H / E_t*`, which scales account weight upward above the `E*`-keyed budget share and lets `c_t × W_t` exceed the `W_t^{conv}` budget implied by `E_t*`, conflicting with `decisions-rebase.md` R3 (`"Keyed strictly to E*, never current equity E"` and `"withdrawals never loosen the budget automatically"`). Capping Step 8 conversion at `W_t^{conv} = min(W_t, E_t × (W_t* / E_t*))` (*proposed reconciliation pending owner sign-off; inactive when `H = 0`*) keeps `w_{i,t}^{target}` invariant under withdrawals and ensures `-100%` fund loss inside Step 3(a) never exceeds remaining bankroll loss budget `D × W_t^{ref} - L_t`.
9. **Step 9 — Invested vs. deployable capital, fee-aware buyable shares, no-trade band, turnover, `B_{min,tier}`:**
   - **Invested ETF market value (`C_{inv,t}`, USD):** `∑_i q_{i,t} × P_{i,t}` (`= E_t ∑_i w_{i,t} ≤ E_t`, long-only; actual held notional, distinct from buying power).
   - **Deployable / available cash for new buy orders (`C_{avail,t}`, USD, `≥ 0`, `Q2-1`, `O5`):**
     `C_{avail,t} = max(0,  Cash_{settled,t} + Proceeds_{eligible,t} - R_{cash,t} - K_{pend,t})`
     where:
     - `Cash_{settled,t}` is settled USD cash inside the unit (`$0` margin credit; unsettled external deposits excluded);
     - `Proceeds_{eligible,t}` is same-session T-bill redemption or ETF sell proceeds **only where venue settlement rules permit settled-cash offset without margin** (`0` otherwise);
     - `R_{cash,t}` (`USD ≥ 0`) is mandatory **cash reservation** (accrued unpaid execution/regulatory fees + broker minimum cash buffer + locked collateral);
     - `K_{pend,t}` (`USD ≥ 0`) is **pending-order commitment** (worst-case notional plus estimated fees reserved for open/working or `ORDER-UNKNOWN` buy orders; `O4`/`Q5-2` additionally blocks new orders on any `ORDER-UNKNOWN` symbol).
   - **Ideal NAV target vs. fee-and-collar-aware buyable integer shares (`q_{i,t}^{ideal}`, `Δq_{i,t}^{buy}`, `Q2-1`, `O5`):**
     - Ideal whole-share target: `q_{i,t}^{ideal} = floor(w_{i,t}^{target} × E_t / P_{i,t}^{ref})` (whole shares by default; fractional shares disallowed unless venue explicitly audits them).
     - Reductions (`q_{i,t}^{ideal} < q_{i,t}^{pre}`): sell quantity `Δq_{i,t} = q_{i,t}^{ideal} - q_{i,t}^{pre} < 0` (`|Δq_{i,t}| ≤ q_{i,t}^{pre}`, long-only) is never blocked by `C_{avail,t} = 0`.
     - Increases (`Δq_{i,t}^{raw} = q_{i,t}^{ideal} - q_{i,t}^{pre} > 0`, when permitted by `b_band` and Step 10): executable integer buy quantities `Δq_{i,t}^{buy} ∈ {0, 1, …, Δq_{i,t}^{raw}}` must satisfy the **fee-and-collar-aware settled-cash boundary**:
       `∑_{i : Δq_i > 0} [ Δq_{i,t}^{buy} × P_{i,t}^{lim} + C_{comm,i,t}^{est}(Δq_{i,t}^{buy}, P_{i,t}^{lim}) + B_{exec,i,t}(Δq_{i,t}^{buy}) ] ≤ C_{avail,t}`
       where `P_{i,t}^{lim}` is the `O5` limit / price-collar worst-case buy price, `C_{comm,i,t}^{est}` is estimated commission plus regulatory fee ([cost-model.md](cost-model.md) §5.1), and `B_{exec,i,t}` is required execution/spread buffer (taking the largest integer `Δq_{i,t}^{buy}` satisfying the bound after proportional `C_{avail,t}` allocation across concurrent sleeve buys; `0` if `1` share plus minimum fee exceeds `C_{avail,t}`; resulting post-bound target `q_{i,t}^{target} = q_{i,t}^{pre} + Δq_{i,t}^{buy}`).
     - **Unresolved venue input contracts and settling gates (`Q1-4`, `Q2-1`, `Q4-2`):** Broker-specific `Cash_{settled,t}`, `Proceeds_{eligible,t}`, `R_{cash,t}`, and `K_{pend,t}` field contracts and same-session settlement rules on Longbridge paper vs. the unnamed live venue remain unresolved input contracts settled across Batch `Y2` (Longbridge SDK documentation review), `SUPPLY-A`/`SUPPLY-B` (`Q1-4`), naming the live venue prior to `SUPPLY-B`, and `OI-COST-3` / `PAPER` (`Q2-1`, `Q4-2`). Synthetic `YARDSTICK`/`PILOT` studies use pre-registered deterministic synthetic ledger state (`Y3`).
   - **No-trade band (`b_band`, `Line 6`, `Q2-6`, `Q5-1(c)`):** Starting value `20%` of target weight (`PILOT` pre-registered grid `10%, 20%, 30%`, *proposal*). Discretionary rebalance for fund `i` is suppressed when `|w_{i,t}^{cur} - w_{i,t}^{target}| ≤ b_band × w_{i,t}^{target}` (`w_{i,t}^{cur}` is drift-adjusted pre-trade weight). **Mandatory bypass rule:** **Every reduction** required by the **hard cap (`x_cap`, Step 2)**, the **maximum-loss cap (`x_ML(c_t)` / `L0`, Step 3)**, the **joint cap (`x_eff_joint(c_t)` / `x_joint` / `Line 3a` / `J1`, Step 7)**, Step 8's combined-weight ceiling (`min(w_max, 1.00)`), or **any control interlock or breaker (`L0–L6`, `V1–V7`, `O1–O9`, `J1`, Step 10)** **bypasses `b_band` unconditionally and is never delayed by the band**.
   - **1-way daily turnover (`TO_{1way,t}`):**
     `TO_{1way,t} = 0.5 × (|w_{cash,t}^{post} - w_{cash,t}^{pre}| + ∑_i |w_{i,t}^{post} - w_{i,t}^{pre}|)`
     Including the cash/T-bill balancing leg ensures rotating between `TQQQ` and `SOXL` counts the rotation once (`10%` sell + `10%` buy = `10%` 1-way), while investing `10%` cash into ETFs counts `10%` 1-way (`0.5 × (|-0.10| + |+0.10|) = 10%`). Annualized `TO_ann` must respect tier `Line 6` budget (`50% | 100% | 200%` starting values).
   - **Smallest workable bankroll (`B_{min,tier}`, `PART-C.md` §4.3, `Q2-1`, `Q2-7`):** Defined strictly as the smallest bankroll `W` at which **annual fixed trading costs** `C_{fixed,ann}(W)` (annualized minimum ticket commissions `c_{min}`, fixed pass-through fees, and whole-share rounding friction) remain **below one tenth (`< 10%`) of the tier's expected annual excess growth in dollars** (`C_{fixed,ann}(W) < 0.10 × ΔG_{ex,ann}^$(W)`). Stated here strictly as a **definition only** — `Y1` neither calculates nor asserts expected strategy growth; broker fee schedules await `OI-COST-3` and tier growth estimates await `PILOT`.
   - **Per-order affordability diagnostic (`ρ_{order,i,t}`, *proposed / threshold unset*, `Q2-1`):** Commission `C_{comm,i,t}` plus whole-share rounding distortion divided by target order/position notional is tracked as a separate diagnostic; any numeric affordability cutoff remains explicitly proposed / unset pending `Y3`/`PILOT` and `OI-COST-3`.
10. **Step 10 — Independent pre-trade control layer (`PART-C.md` §4.2 Step 10, §4.4; [sizing-unit.md](sizing-unit.md); [decisions-rebase.md](decisions-rebase.md) §(c), `Q5-1`, Class `C`):** Independent pre-trade enforcement executed **outside the strategy process** across `L0–L6`, `V1–V7` (`Q5-3`), and `O1–O9`, `J1` (`Q5-2`, `Q5-4`), issuing canonical control states (`NO-NEW-RISK`, `DE-RISK`, `HALT`, `ORDER-UNKNOWN`). Controls can only block exposure increases, force reductions, or halt, failing closed on missing/stale data (`O1`) or uncertain order outcomes (`O4`/`Q5-2`) and requiring human re-arming for latched breakers.
    - **Authorization state:** In `SHADOW` (`T1`), Step 10 computes and records `"would have tripped"` states only; in `PAPER` (`T2`), arming the control layer requires a **separate explicit control-arming card** (with loss-triggered rows `L0` and `L2–L4` remaining unarmed until that card is authorized); production arming belongs to `LIVE-GATE`.
    - **Subordinate output (`SUPPLY-B` -> `PAPER`):** Target/order emission (`q_{i,t}^{target}`, `Δq_{i,t}`, active or would-have breaker/no-trade state flags, `return_method`, `method_version`) is emitted strictly as a subordinate output gated by Step 10.

### 4.4 Tier Starting Values & Legacy Reconciliations

- Canonical pre-`PILOT` tier starting values (15 rows for `CAPITAL_PRESERVATION`, `BALANCED_COMPOUNDING`, `GROWTH_COMPOUNDING`) live in [sizing-unit.md](sizing-unit.md) §4.3. They are **starting/illustrative inputs only**, not validated or recommended optimal parameters.
- Upon owner sign-off of Phase 0 `REBASE` and this contract, the tier `D` + `H` drawdown-budget glide path supersedes both fixed unscaled equity bands in [../qsl-capital-risk-envelope-v1.zh-CN.md](../qsl-capital-risk-envelope-v1.zh-CN.md) and relative drawdown multipliers (`1.00× / 1.25× / 1.50×`) in [../qsl-long-horizon-risk-composer-v1.zh-CN.md](../qsl-long-horizon-risk-composer-v1.zh-CN.md).

---

## 5. Multiple Testing, Class-K Governance Cost, and Basis Tracking

### 5.1 Multiple Testing (`K_trials`, `DSR`, `PBO`, `Q4-1`)

- **Audited trial count (`K_trials`):** Cumulative count of distinct hypothesis, parameter, or variant evaluations run against overlapping sample histories, initialized with mandatory prior seed **`K_trials ≥ 23`** (`2 B5 + 21 SOXL` existing trials recorded in [rebase-register.md](rebase-register.md) Table C). Zero decrement permitted.
- **Deflated Sharpe Ratio (`DSR`):** Probability that observed annualized Sharpe `SR_ann` exceeds the expected maximum spurious Sharpe across `K_trials` effective independent variants, adjusted for return skewness and excess kurtosis (evaluated exclusively on net returns `r_t`, never gross).
- **Probability of Backtest Overfitting (`PBO`):** Out-of-sample rank degradation share computed via Combinatorially Symmetric Cross-Validation (`CSCV`) over partitioned blocks without overlap leakage.

### 5.2 Class-K Growth Cost and Trip Rate (`π_K`, `λ_trip`, `Q1-3`)

- **Class-K growth cost (`π_K`, `Line 14`):** Fractional reduction in annualized net log growth of a governed/hedged configuration relative to its matched un-gated baseline over a positive-growth comparison period (`g_ann^{base} > 0`):
  `π_K = (g_ann^{base} - g_ann^{gov}) / g_ann^{base}`
  Ceiling starting values: `20% | 15% | 10%`. When `g_ann^{base} ≤ 0`, ratio `π_K` is undefined; report raw difference `Δg_ann = g_ann^{gov} - g_ann^{base}` directly.
- **Latched trip rate (`λ_trip`, `Line 15`):** Annualized count of new latch transitions (`trips/yr` on `252`-session year basis; consecutive sessions held inside an active latch do not increment `count`). Accepted ceiling starting values: `1 | 2 | 3` trips/year.

### 5.3 Tracking Difference, Rolling Basis, and Synthetic Carry (`δ_track`, `δ_60`, `c_carry`, `Q1-1`)

- **Daily synthetic-vs-ETF tracking difference (`δ_{i,t}`):** `r_{ETF,i,t} - r_{syn,i,t}`, where `r_{syn,i,t}` is defined in [cost-model.md](cost-model.md) §3 (`1/session`).
- **60-session cumulative basis (`δ_{60,i,t}`):** `∏_{u=t-59}^t (1 + r_{ETF,i,u}) - ∏_{u=t-59}^t (1 + r_{syn,i,u})` (monitored by breaker `V6`).
- **Synthetic annual carry rate (`c_{carry,i,t}`):** `2 × r_{f,t} + c_{spread,i,t} + TER_i` (`1/yr`). Matched-history calibration in `Y2`/`Q1-1` requires annualized cumulative tracking error `≤ 0.5 pp/yr` (`50 bps/yr`).

---

## 6. Master Cross-Reference Table

| Quantity | Symbol | Unit | Annualization / Cadence | Governing Register Rows |
| --- | --- | --- | --- | --- |
| Regular-session count | `N_yr` | `sessions/yr` | `252` (`XNYS`) | `Q1-2`, `Q4-1` |
| Calendar day fraction | `Δτ_t` | `yr` | `days / 365` | `Q1-1`, `Q1-2` |
| Daily net portfolio return | `r_t` | `1/session` | Daily | `Q1-2`, `Q2-1`, `Q4-2` |
| Centered variance / Raw 2nd moment | `σ²`, `m₂` | `1/session` | `252 × σ²_daily` for vol² | `Q1-2`, `Q4-1` |
| External cash flow / Split factor | `F_t`, `α_t` | `USD`, `ratio` | Event timestamped | `Q1-2`, `Q2-2`, `Q5-1(c)` |
| Time-weighted return index | `I_t` | `dimensionless` | Daily chain (`I_0 = 1`) | `Q1-2`, `Q2-2` |
| Modified Dietz fallback | `R_MD` | `1/interval` | Fallback display only | `Q1-2` |
| Net log growth / Integer ppm | `g`, `g_ann`, `log_growth_ppm` | `nats`, `ppm/session` | `252 × g_bar` | `Q1-2`, `Q2-1` |
| Equity drawdown & drops (display) | `dd_t`, `MDD`, `L_{1,t}`, `L_{20,t}` | `ratio` (`bps`) | Continuous `I_t` HWM | `Q1-2`, `Q2-2` |
| Bankroll TWR, drawdown & 1d loss | `I_t^B`, `dd_t^B`, `L_{1,t}^B` | `ratio` | Daily chain (`I_0^B = 1`) | `Q1-2`, `Q2-2`, `Q5-1` |
| Underwater / Recovery duration | `u_t`, `TTR` | `sessions` | `XNYS` closed count | `Q1-2` |
| Declared bankroll / Unit equity / HWM | `B_0`, `E_t`, `E_t*` | `USD` | Daily + ratchet/governance | `Q2-7`, `Q4-1`, `Q5-1(c)` |
| Reserve, bankroll & conversion basis | `H`, `W_t`, `W_t*`, `W_t^{conv}` | `USD` | Daily + governance | `Q2-2`, `Q2-7`, `Q4-1` |
| Perf peak ref / Loss / Drawdown limit | `W_t^{ref}`, `L_t`, `D` | `USD`, `ratio` | Daily (`W_t^{ref} - W_t`) | `Q2-2`, `Q2-7`, `Q4-1`, `Q5-1(c)` |
| Remaining cushion | `c_t` | `ratio ∈ [0, D]` | Daily (`(D W_t^{ref} - L_t) / W_t`) | `Q2-2`, `Q4-1` |
| Index-equiv exposure & caps | `x_i,t`, `x_cap`, `x_ML`, `x_joint`, `x_eff_joint` | `ratio` (`1×` eqv) | Daily | `Q2-2`, `Q3-1`, `Q3-2`, `Q5-1`, `OQ-1` |
| Pre-PILOT worst-case ceiling | `M_0(c_t)`, `M(c_t)` | `ratio` (`1×` eqv) | Full stress set + `ES_0.975` | `Q2-2`, `Q3-2` |
| Research Kelly (non-applied) + monthly diag | `x_K^struct`, `x_K^cond`; `p_win`, `b_payoff` | `ratio` (`1×` eqv) | Research/monthly log only | `Q2-3`, `Q4-1` |
| Volatility scale / `SOXL` falling beta | `v_i,t`, `β_SOXL` | `ratio` | Daily (`σ_target √252`) | `Q2-1`, `Q4-1` |
| Fund weights & no-trade band | `w_{i,t}^{target}`, `w_max`, `b_band` | `ratio` | Daily (`≤ 100%` cash) | `Q2-6`, `Q2-7`, `Q5-1(c)` |
| Deployable capital & buyable shares | `C_{inv,t}`, `C_{avail,t}`, `R_{cash,t}`, `K_{pend,t}`, `q_{i,t}^{ideal}`, `Δq_{i,t}^{buy}` | `USD`, `shares` | Daily + venue gate | `Q1-4`, `Q2-1`, `O5` |
| 1-way turnover / Workable bankroll / Diag | `TO_1way`, `TO_ann`, `B_{min,tier}`, `ρ_{order,i,t}` | `ratio`, `USD` | `252 × daily mean` / defn | `Q2-1`, `Q2-6`, `Q2-7`, `Q4-2` |
| Pre-trade control states (Step 10) | `NO-NEW-RISK`, `DE-RISK`, `HALT`, `ORDER-UNKNOWN` | `state` | Pre-trade gate | `Q5-1`, `Q5-2`, `Q5-3`, `Q5-4` |
| Audited trials / Overfitting | `K_trials ≥ 23`, `DSR`, `PBO` | `count`, `prob` | Experiment cumulative | `Q4-1`, Table C |
| Class-K growth cost / Trip rate | `π_K`, `λ_trip` | `ratio`, `trips/yr` | `252 × count / N` | `Q1-3` |
| Tracking diff / 60d basis / Carry | `δ_track`, `δ_60`, `c_carry` | `ratio`, `1/yr` | Daily / 60d / `365d` | `Q1-1` |
