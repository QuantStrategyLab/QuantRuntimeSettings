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
- **Canonical net return (`r_t`):** Every headline return, `TWR` series, growth rate `g`, `MDD`, `SR_ann`, and Kelly input uses **net return after all applicable costs** specified in [cost-model.md](cost-model.md) (broker commissions/regulatory fees, spread/slippage, plus synthetic `TER + swap carry` on synthetic segments, plus earned unallocated USD T-bill yield, with `$0` margin interest).
- **Benchmark total-return basis (`Q1-2`):** All ETF and index benchmarks must use `TOTAL_RETURN_NET_OF_COST` (dividend-, split-, and distribution-adjusted total return net of applicable costs, consistent with [../market-benchmark-revision-policy.md](../market-benchmark-revision-policy.md) and [../qsl-long-horizon-risk-observation-v2.zh-CN.md](../qsl-long-horizon-risk-observation-v2.zh-CN.md)). Split-adjusted price return is disallowed.

### 1.3 Centered Variance vs. Raw Second Moment (`σ²`, `m₂`)

- **Variance (`σ²`):** Centered second moment `σ² = E[(r - μ)²]`. Finite-sample estimator uses Bessel-corrected sample variance `s² = [1 / (N - 1)] ∑_{t=1}^N (r_t - r_bar)²` unless a closed population stress distribution explicitly specifies `1 / N`.
- **Raw second moment (`m₂`):** `m₂ = E[r²] = σ² + μ²`. Never substitute `m₂` for `σ²` in volatility targeting (`v_{i,t}`), Sharpe denominators, variance-drag diagnostics, or structural Kelly (`μ_ex / σ²`). Any analytical decomposition showing both must label `m₂` separately as non-centered.

---

## 2. Cash Flows, Time-Weighted Return (`TWR`), Drawdown, and Horizon Metrics

### 2.1 External Cash Flows (`F_t`) and Corporate Actions (`α_t`)

- **External flow (`F_t`):** USD capital deposits (`F_t > 0`) and withdrawals (`F_t < 0`) crossing the sizing-unit boundary. Internal ETF trades, dividend distributions received inside the sizing unit, T-bill roll interest, and brokerage fee debits are **not** external flows (`F_t = 0`).
- **Corporate-action factor (`α_t`):** Split factors `α_t` and cash/stock distributions adjust price and share series strictly on ex-dates so corporate actions inject zero artificial return spikes into `r_t`, realized volatility, or `I_t`. Delisted or reorganized instruments require explicit terminal valuation rather than silent truncation.

### 2.2 Primary Return Definition: Daily-Linked Time-Weighted Return (`TWR`, `Q1-2`)

- **Primary formula (daily valuation with flow-boundary discipline):** Given sizing-unit equity `E_t` and external flow `F_t` settled before or at the session `t` valuation snapshot (matching `web/strategy-switch-console/application/console_api/cashflow_performance.js`):
  `r_t = (E_t - F_t) / E_{t-1} - 1`
  When multiple timestamped flows `τ_j` occur inside session `t` with exact pre-flow sub-valuations `E_{t,m}`, subperiods chain multiplicatively:
  `1 + r_t = ∏_m [E_{t,m}^pre / (E_{t,m-1}^post)]` with `E_{t,m}^post = E_{t,m}^pre + F_{t,m}`.
- **Wealth / performance index (`I_t`):** Initialized at `I_0 = 1.0`, chained daily as `I_t = I_{t-1} × (1 + r_t)`. Cumulative `TWR` across `[a, b]` is `R_{a,b}^TWR = I_b / I_a - 1`.
- **Native IBKR TWR (`native_ibkr_twr`):** Accepted strictly for IBKR-custodied segments when `ChangeInNAV.twr` passes ratio validation (`percent / 100 = ratio` per [../ibkr-period-return.md](../ibkr-period-return.md)), exact interval matching, and external-flow consistency. Synthetic paths and cross-account blends never use `native_ibkr_twr`.

### 2.3 Fallback Return Definition: Modified Dietz (`R_MD`, `Q1-2`)

- **Formula:** Across an interval `(a, b]` with starting equity `V_0`, ending equity `V_1`, external flows `F_j` at timestamps `τ_j ∈ (a, b]`, and net flow `F_net = ∑_j F_j`:
  `R_MD = (V_1 - V_0 - F_net) / (V_0 + ∑_j w_j F_j)`, where `w_j = (b - τ_j) / (b - a)`.
- **Granularity reconciliation:** `PART-B.md` §2.3 describes monthly Modified Dietz as a reporting fallback, while `cashflow_performance.js` implements the same weighted formula on daily timed-flow intervals. Under this contract, `Modified Dietz` is governed uniformly across daily and monthly display cells whenever intraday pre-flow valuations and qualified native TWR are absent.
- **Disqualification and hard usage bans:**
  1. Missing intraday flow timestamp (`time_precision: "date"` in console records) **disqualifies** Modified Dietz (`return = null`; never assign midpoint weight `w_j = 0.5`).
  2. Every Modified Dietz return must carry `return_method: "modified_dietz"` and `approximate: true`.
  3. **Hard ban:** Modified Dietz never feeds sizing (`c_t`, `E_t*`, `x_K`), drawdown/risk breakers (`dd_t`, `L_t`), statistical tests (`g`, `SR_ann`, `DSR`), or Phase 4 verdicts.

| Field (`console-api.md` / `performance.js`) | Allowed canonical values under this contract |
| --- | --- |
| `return_method` | `"daily_linked_twr"` \| `"native_ibkr_twr"` \| `"modified_dietz"` (display fallback only) |
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
  - Single-session TWR drop: `L_{1,t} = max(0, 1 - I_t / I_{t-1}) = max(0, -r_t)`.
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

Let `E_t^pre = E_t - F_t` denote post-return pre-flow equity at session `t`.

1. **No external flow (`F_t = 0`):** `E_t* = max(E_{t-1}*, E_t)`.
2. **External deposit (`F_t > 0`):** Deposits enter `E_t = E_t^pre + F_t` and ratchet directly via `E_t* = max(E_{t-1}*, E_t)`, so fresh capital updates dollar capacity once without fabricating multiple risk budgets.
   - *Reconciled edge case (`PART-C.md` §3.2 Q2):* `decisions-rebase.md` states `E*` updates only when drawdown is zero, which holds whenever `F_t = 0`. When a large mid-drawdown deposit (`dd_t > 0`) pushes `E_t > E_{t-1}*`, rule (2) updates `E_t*` to `E_t` while `dd_t` from `I_t` stays positive; when `H > 0`, `D × (1 + H / E_t*)` shrinks slightly relative to equity. Any external deposit while `dd_t > 0` must emit an explicit `SUPPLY-A`/`FUSE` flow-audit event.
3. **External withdrawal (`F_t < 0`):** Scale `E_{t-1}*` by the post-withdrawal capital retention ratio:
   `E_t* = max(E_{t-1}* × (E_t^pre + F_t) / E_t^pre,  E_t)`
   Equivalently `E_t* = max(E_{t-1}* × (1 - |F_t| / E_t^pre), E_t)` (for `|F_t| < E_t^pre`; full liquidation sets `E_t* = 0`). Proportional scaling preserves drawdown `dd_t` and cushion `c_t` invariance under withdrawals (`Q5-1(c)`).
4. **Governance downward reset:** Allowed at most once per **30 calendar days** cooling-off, strictly when `L_t < (D / 3) × W_t*` (below Amber threshold), and only via explicit owner governance record (never an automated rule).

### 3.3 External Committed Reserve (`H`) and Effective Bankroll (`W_t`, `W_t*`)

- **Committed liquid reserve (`H`, USD, `H ≥ 0`):** Pre-committed liquid cash or `≤ 3`-month Treasury bills held outside the unit explicitly dedicated to absorb unit drawdowns (`decisions-rebase.md`). Excluded: speculative holdings, illiquid assets, or uncommitted balances.
- **Default and ceiling:** Default **`H = 0`**; ceiling proposal **`H ≤ 3 × E_t*`** (so `W_t* ≤ 4 × E_t*`), pending `PILOT` calibration and owner sign-off.
- **Current and high-water bankroll:** `W_t = E_t + H`, and `W_t* = E_t* + H` (`W_t* ≡ B_t` in [decisions-rebase.md](decisions-rebase.md)).

### 3.4 Accumulated Policy Loss (`L_t`), Loss Limit (`D`), and Cushion (`c_t`)

- **Accumulated dollar loss (`L_t`, USD, `≥ 0`):**
  `L_t = E_t* × dd_t`
  When `F_s = 0` after the last peak, `L_t = E_t* - E_t` identically; multiplying `E_t*` by flow-adjusted `dd_t` generalizes cleanly across mid-drawdown external flows.
- **Bankroll drawdown (`dd_t^B`):** `dd_t^B = L_t / W_t* = (E_t* / W_t*) × dd_t` (`= dd_t` when `H = 0`).
- **Tier drawdown limit (`D ∈ (0, 1]`):** Pre-`PILOT` tier starting values (`Line 4` in [sizing-unit.md](sizing-unit.md) §4.3): `15%` (`CAPITAL_PRESERVATION`), `30%` (`BALANCED_COMPOUNDING`), `50%` (`GROWTH_COMPOUNDING`). Maximum dollar budget = `D × W_t*`.
- **Policy loss thresholds (pre-`PILOT` lines 4a–4c, 5; `FUSE` implements latch mechanics):**
  - Amber band (`L_t / W_t* ≥ D / 3`): `5% | 10% | 16.7%` of `W_t*`.
  - Red band (`L_t / W_t* ≥ 2D / 3`): `10% | 20% | 33.3%` of `W_t*`.
  - Budget exhausted (`L_t / W_t* ≥ D`): `15% | 30% | 50%` of `W_t*`.
  - One-session loss threshold (`−r_t ≥ D / 10` on equity / `L_{1,t}^B ≥ D / 10`): `1.5% | 3% | 5%` (`Line 5`; `FUSE` defines latch transitions).
- **Remaining cushion (`c_t`, dimensionless, `Q2-2`):**
  - `c_t = (D × W_t* - L_t) / (W_t* - L_t)` for `L_t < D × W_t*`
  - `c_t = 0` for `L_t ≥ D × W_t*`
  - Bounds: `c_t ∈ [0, D]`; at `L_t = 0`, `c_t = D`.
  - *Invariance check:* Because `W_t* - L_t = E_t*(1 - dd_t) + H` equals `E_t + H` whenever no external flows disturb `E*`, this formula matches "remaining budget / current bankroll" in steady state while remaining invariant to withdrawals (`Q5-1(c)`).

---

## 4. Ten-Step Sizing Chain and Resolution of `OQ-1`

Index-equivalent exposure `x_{i,t}` measures dimensionless `1×` equity-index exposure relative to `W_t` (`1.0` equals `100%` of effective bankroll `W_t` invested in `1×` index exposure, i.e., `33.3%` in a `3×` ETF when `H = 0`).

### 4.1 Steps 1–5 (Per-Sleeve Signal, Bounds, Kelly Benchmark, Volatility Scale)

1. **Step 1 — Raw signal (`s_{i,t} ∈ [0, 1]`):** Nonnegative long-only signal weight (`0` flat/inactive, `1` full signal; short/margin/options prohibited by `Line 8`).
2. **Step 2 — Tier sleeve cap (`x_cap`):** Dimensionless index-equivalent ceiling per fund (`0.20 | 0.40 | 0.80` pre-`PILOT` starting values; equivalent to `6.7% | 13% | 27%` in a `3×` ETF when `H = 0`, `Line 2`).
3. **Step 3 — Drawdown-budget / tail-loss ceiling (`x_ML(c_t)`):**
   `x_ML(c_t) = min(3 × c_t,  2 × c_t [proposal],  M(c_t))`
   - `(a)` `3 c_t`: ensures a single `-33.3%` index shock (`-100%` in `3×` leverage) keeps loss `≤ c_t`.
   - `(b)` `2 c_t` (*proposal*): ensures a `-50%` overnight/unrebalanced index drop keeps loss `≤ c_t`.
   - `(c)` `M(c_t)`: largest index-equivalent exposure whose worst-case loss on the calibrated stress set (`97.5%` Expected Shortfall over 250-session block-bootstrap paths re-centered on a shrunk mean, `Q3-2`) does not exceed `c_t`.
   - **Pre-`PILOT` approximation (`M_0(c_t)`, `Q1-2`, illustrative only):** `M_0(c_t) = ln(1 - c_t) ÷ ln(1 - 0.83)` (`-83%` historical reference index shock). At full cushion (`c = 15%, 30%, 50%`), `M_0` gives `0.09, 0.20, 0.39` index-equivalent (`3%, 6.7%, 13%` TQQQ-only fund weight). Replaced by calibrated `M(c_t)` once stress runs complete in `PILOT`.
4. **Step 4 — Kelly research benchmark (`x_K^struct`, `x_K^cond`, COMPUTED-NOT-APPLIED):**
   - `x_K^struct = k × max(0, μ_ex / σ²)`, where `μ_ex` is daily excess net mean over T-bill yield, `σ²` is centered variance, and `k` is tier Kelly fraction (`1/8 | 1/4 | 1/2`, `Line 1`).
   - `x_K^cond`: regime-conditional Kelly evaluated inside `s > 0` windows using win probability `p_win`, payoff ratio `b_payoff = mean_win / mean_loss`, or shrunk conditional `μ_ex|s / σ²|s`, floored at `0`. Printed strictly for research logs; **never** enters live or paper sizing in the pilot (`Q2-6`, `decisions-rebase.md`).
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
- **Adopted resolution of `OQ-1` (Proposed — pending owner sign-off):** Enforce `x_ML(c_t)` on the **combined sleeve in Step 7** as well as per fund in Step 6:
  1. Effective joint cap at `t`: `x_eff_joint(c_t) = min(x_joint, x_ML(c_t))`, where `x_joint` is tier `Line 3` (`0.20 | 0.40 | 0.80`).
  2. Apply `Line 3a` SOXL sub-cap (`1/3`): cap `β_SOXL × x_{SOXL,t}^{mid} = min(β_SOXL × x_{SOXL,t}^{pre},  x_eff_joint(c_t) / 3)`.
  3. Compute unscaled joint beta-adjusted demand: `x_joint_beta = x_{TQQQ,t}^{pre} + β_SOXL × x_{SOXL,t}^{mid}`.
  4. If `x_joint_beta > x_eff_joint(c_t)`, scale proportionally: `α_joint = x_eff_joint(c_t) / x_joint_beta`; set `x_{TQQQ,t} = α_joint × x_{TQQQ,t}^{pre}` and `x_{SOXL,t} = α_joint × x_{SOXL,t}^{mid}` (with `J1` cross-sleeve correlation override applied on top when active).

### 4.3 Steps 8–10 (Fund Weight, Whole Shares, No-Trade Band, Turnover)

8. **Step 8 — Sizing-unit ETF target weight (`w_{i,t}`):**
   `w_{i,t} = x_{i,t} × W_t ÷ (3 × E_t)`
   Subject to hard constraints:
   - `w_{i,t} ≥ 0` (long-only; `Line 8` margin/short/options `never`)
   - `∑_i w_{i,t} ≤ min(w_max, 1.00)`, where `w_max` is tier `Line 12` max combined fund weight (`15% | 35% | 60%` starting values; binds only when `H > 0`; never `> 100%` cash).
   - Unallocated fraction `w_{cash,t} = 1 - ∑_i w_{i,t} ∈ [0, 1]` resides in `≤ 3`-month USD T-bills / bill fund (`Line 7`).
9. **Step 9 — Deployed capital, integer shares, no-trade band, turnover:**
   - **Deployed capital (`C_{dep,t}`):** `∑_i |V_{i,t}| = E_t ∑_i w_{i,t}` (`≤ E_t`, long-only).
   - **Target share count (`q_{i,t}^target`):** `floor(w_{i,t} × E_t / P_{i,t})` (whole-share rounding by default; residual stays in T-bill cash; fractional shares disallowed unless venue explicitly audits them).
   - **No-trade band (`b_band`, `Line 6`):** Starting value `20%` of target weight (`PILOT` ablation grid `10%, 20%, 30%` proposal). Discretionary rebalance for fund `i` is suppressed when `|w_{i,t}^{cur} - w_{i,t}^{target}| ≤ b_band × w_{i,t}^{target}` (`w_{i,t}^{cur}` is drift-adjusted pre-trade weight). Hard safety exits (`L1–L5`, `V1–V7`, `O1–O9`, `J1`) bypass `b_band`.
   - **1-way daily turnover (`TO_{1way,t}`):**
     `TO_{1way,t} = 0.5 × (|w_{cash,t}^{post} - w_{cash,t}^{pre}| + ∑_i |w_{i,t}^{post} - w_{i,t}^{pre}|)`
     Including the cash/T-bill balancing leg ensures rotating between `TQQQ` and `SOXL` counts the rotation once (`10%` sell + `10%` buy = `10%` 1-way), while investing `10%` cash into ETFs counts `10%` 1-way (`0.5 × (|-0.10| + |+0.10|) = 10%`). Annualized `TO_ann` must respect tier `Line 6` budget (`50% | 100% | 200%` starting values).
   - **Minimum effective balance (`B_min`, `Line 6` / `B5`):** Equity below which fixed per-order minimum commissions plus whole-share rounding eat `≥ 10%` of position budget (coupled to `OI-COST-3` in [cost-model.md](cost-model.md)).
10. **Step 10 — Paper execution / simulation emission (`SUPPLY-B` -> `PAPER`):** Emits integer `q_{i,t}^target`, `Δq_{i,t}`, active breaker/no-trade state flags, `return_method`, and `method_version`.

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
| Drawdown, MDD, L_20 | `dd_t`, `MDD`, `L_20` | `ratio` (`bps`) | Continuous HWM | `Q1-2`, `Q2-2` |
| Underwater / Recovery duration | `u_t`, `TTR` | `sessions` | `XNYS` closed count | `Q1-2` |
| Declared bankroll / Unit equity / HWM | `B_0`, `E_t`, `E_t*` | `USD` | Daily + flow rules | `Q2-4`, `Q4-1`, `Q5-1(c)` |
| External reserve / Effective bankroll | `H`, `W_t`, `W_t*` | `USD` | Daily + governance | `Q2-2`, `Q2-4`, `Q4-1` |
| Accumulated loss / Drawdown limit | `L_t`, `D` | `USD`, `ratio` | Daily (`E* × dd_t`) | `Q2-2`, `Q4-1` |
| Remaining cushion | `c_t` | `ratio ∈ [0, D]` | Daily | `Q2-2`, `Q4-1` |
| Index-equiv exposure & caps | `x_i,t`, `x_cap`, `x_ML`, `x_joint` | `ratio` (`1×` eqv) | Daily | `Q2-1`, `Q2-2`, `Q3-2`, `OQ-1` |
| Pre-PILOT worst-case ceiling | `M_0(c_t)`, `M(c_t)` | `ratio` (`1×` eqv) | Stress `ES_0.975` | `Q1-2`, `Q3-2` |
| Research Kelly (non-applied) | `x_K^struct`, `x_K^cond` | `ratio` (`1×` eqv) | Research log only | `Q2-6`, `Q4-1` |
| Volatility scale / `SOXL` falling beta | `v_i,t`, `β_SOXL` | `ratio` | Daily (`σ_target √252`) | `Q2-1`, `Q4-1` |
| Fund weights & no-trade band | `w_i,t`, `w_max`, `b_band` | `ratio` | Daily (`≤ 100%` cash) | `Q2-1`, `Q4-1`, `B5` |
| 1-way turnover / Min balance | `TO_1way`, `TO_ann`, `B_min` | `ratio`, `USD` | `252 × daily mean` | `Q2-1`, `Q4-2`, `B5` |
| Audited trials / Overfitting | `K_trials ≥ 23`, `DSR`, `PBO` | `count`, `prob` | Experiment cumulative | `Q4-1`, Table C |
| Class-K growth cost / Trip rate | `π_K`, `λ_trip` | `ratio`, `trips/yr` | `252 × count / N` | `Q1-3` |
| Tracking diff / 60d basis / Carry | `δ_track`, `δ_60`, `c_carry` | `ratio`, `1/yr` | Daily / 60d / `365d` | `Q1-1` |
