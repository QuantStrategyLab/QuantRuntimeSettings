# Phase 2 YARDSTICK / Phase 8 PILOT — Pre-Registered Run Results (`Policy v0`)

- **Run date:** `2026-11-27`
- **Registration reference:** `PREREG-R5` ([pilot-preregistration.md](pilot-preregistration.md))
- **Dataset reference:** `Y2-DATA-1` ([dataset.md](dataset.md), [validation.md](validation.md); all 8 CSV SHA-256 checksums verified `OK` prior to execution)
- **Experiment ledger:** [experiment-ledger.md](experiment-ledger.md) (`L-027`–`L-054`; `K_trials`: `41 → 69`)

## 1. Authorization & Safety Posture

- Executed under explicit Owner confirmation of `[P]` bindings (`§1`) and `PILOT` launch approval on `2026-11-27`.
- Standing safety boundaries remain unchanged: `live=OFF`, `kelly=OFF` (research column computed and recorded only), `stop_loss_return=OFF`, zero margin/short/options (`H=0`), zero changes to `FuseControl/goldens/`, and no access to existing personal brokerage accounts.
- Both execution buckets are reported **strictly separately and never pooled**:
  - **Bucket `(a)` Modelled synthetic `3×` history** (`1985-01-31` to `2026-11-13` for Nasdaq-100, `1994-05-04` to `2026-11-13` for semiconductor index).
  - **Bucket `(b)` Real leveraged-ETF overlap** (`2010-03-11` to `2026-11-13`, `TQQQ` NAV + `SOXL` market-close total return proxy).
- Run determinism verified by two independent consecutive passes with identical JSON manifest output (`numpy.random.PCG64`, `es_seed = 20261117` for `§2 ES_0.975` `10k×250d` stress sampling and `pd_seed = 20261127` for `§4 P-D` stationary block bootstrap, static statutory `SEC Section 31 = US$0.00`).

---

## 2. Stress Scenario Calibration `M(c)` (`§6.1–6.4`)

Simulated `M(c)` on grid step `0.01` replacing the un-de-risked pre-`PILOT` approximation `M_0(c)` (`M_half(D/2)` denotes the calibrated maximum exposure under half the drawdown budget `D/2 = 7.5% / 15% / 25%`; because stress loss is non-linear in `M`, `M_half(D/2)` is not simply `M_full / 2`, and `S1_2000_02` is also the binding scenario at `M_half`):

| Tier | `D` | `M_0` (pre-`PILOT`) | Calibrated `M_full(D)` | `M_half(D/2)` | Binding scenario (`M_full` & `M_half`) | `S1 (2000–02)` loss | `S2 (2008)` loss | `S3 (2020)` loss | `S4 (2022)` loss | `ES_0.975` (`10k×250d`) |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Conservative | `15%` | `0.09` | **`0.16`** | `0.11` | `S1_2000_02` | `14.59%` | `9.03%` | `4.52%` | `5.32%` | `9.13%` |
| Balanced | `30%` | `0.20` | **`0.27`** | `0.16` | `S1_2000_02` | `28.97%` | `16.11%` | `7.64%` | `9.17%` | `15.65%` |
| Aggressive | `50%` | `0.39` | **`0.46`** | `0.23` | `S1_2000_02` | `49.40%` | `27.39%` | `12.94%` | `16.14%` | `26.06%` |

---

## 3. Descriptive Kelly Shrinkage & `SOXL` Beta (`§7`, Recorded Only)

Prior centered on `μ_0 = 5.0%`, `s_0 = 3.0%` (`β_fall(XSOX vs XNDX) = 1.0806`, so `β_SOXL = max(β_fall, 1.5) = 1.50` binds at its floor):

| Index | `n` (years) | Sample excess mean | `σ_long` | Shrinkage weight | `s_post` | `μ_shrunk = μ_post - s_post` | `x_K^struct` (`C / B / A`) | `x_K^struct ± 1 SE` (`Balanced`) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `XNDX` | `41.77` | `13.28%/yr` | `25.71%` | `0.3626` | `2.40%` | `5.61%/yr` | `0.106 / 0.212 / 0.424` | `0.122 – 0.303` (`±0.0906`) |
| `XSOX` | `32.49` | `19.76%/yr` | `38.13%` | `0.1674` | `2.74%` | `4.73%/yr` | `0.041 / 0.081 / 0.163` | `0.034 – 0.128` (`±0.0471`) |

*Notes: `x_K^cond` evaluated at the baseline `σ_long` equals `x_K^struct` by construction (diverging only when conditional rolling volatility differs from `σ_long`), so only `x_K^struct` is tabulated. Class `S` remains **computed-and-recorded-only** (`insufficient` for live sizing without multi-month forward stability).*

---

## 4. `P-D` Tail-Correlation Test (`L-048`, Stationary Block Bootstrap `b=20`, `10,000` Reps)

| Bucket (unpooled) | Paired series | `N` total / tail (`q_{0.10}`) | Point `ρ_tail` | Bootstrap median | `95%` 1-sided UCB | Rule (`< 0.70`) |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Bucket `(a)` Synthetic underlying | `XNDX`–`XSOX` | `8,188 / 819` | `0.5594` | `0.5553` | `0.6385` | `< 0.70` (passes leg a) |
| Bucket `(b)` Real ETF overlap | `TQQQ`–`SOXL` | `4,196 / 420` | **`0.7162`** | `0.7138` | `0.7848` | **`≥ 0.70` (fails leg b)** |

- **Verdict (`L-048`):** **`REJECT`**. Diversification credit remains **`0.0`**. Non-pooled real leveraged ETFs exhibit lower-tail correlation `0.7162 ≥ 0.70`, confirming the safety of keeping zero diversification credit.

---

## 5. `P-A`, `P-B`, `P-C` Results (`B_0 = US$50,000`, `§4.1` IBKR Research Costs)

### 5.1 Matched Frozen Baselines vs. Candidate Stack Variants

| Tier | Configuration | Syn `g_ann` | Syn `SR` | Syn `MDD` | Syn `TTR` (med) | Syn `w20` | Syn `TO/yr` | Syn `λ_trip/yr` | Syn `10y D-breach` | Real `g_ann` | Real `SR` | Real `MDD` | Real `TTR` (med) | Real `TO/yr` |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Conservative | **Matched Baseline** (`x_cap=0.20`) | `6.06%` | `1.35` | `14.58%` | `4.0` | `4.68%` | `1.45` | `0.20` | `0%` | `5.91%` | `1.29` | `5.50%` | `3.0` | `1.48` |
| Conservative | `P-A` `vol=linear` (`L-027`) | `3.73%` | `4.09` | `1.28%` | `3.0` | `0.82%` | `0.34` | `0.00` | `0%` | `2.50%` | `2.47` | `1.13%` | `3.0` | `0.44` |
| Conservative | `P-A` `vol=squared` (`L-028`) | `3.31%` | `8.57` | `0.56%` | `2.0` | `0.33%` | `0.17` | `0.00` | `0%` | `1.89%` | `4.51` | `0.63%` | `3.0` | `0.26` |
| Conservative | `P-B` `dd=prop+vol=lin` (`L-033`) | `3.72%` | `4.14` | `1.16%` | `3.0` | `0.78%` | `0.33` | `0.00` | `0%` | `2.45%` | `2.49` | `1.12%` | `3.0` | `0.42` |
| Conservative | `P-B` `dd=step+vol=lin` (`L-034`) | `3.73%` | `4.09` | `1.28%` | `3.0` | `0.82%` | `0.34` | `0.00` | `0%` | `2.50%` | `2.47` | `1.13%` | `3.0` | `0.44` |
| Balanced | **Matched Baseline** (`x_cap=0.40`) | `8.82%` | `1.00` | **`34.10%`** | `4.0` | `9.16%` | `2.85` | `0.20` | `25%` | `9.81%` | `1.10` | `11.99%` | `4.0` | `2.83` |
| Balanced | `P-A` `vol=linear` (`L-029`) | `4.91%` | `1.86` | `3.78%` | `4.0` | `2.50%` | `0.90` | `0.00` | `0%` | `4.04%` | `1.47` | `3.57%` | `4.0` | `0.97` |
| Balanced | `P-A` `vol=squared` (`L-030`) | `4.18%` | `2.32` | `3.02%` | `3.0` | `1.76%` | `0.70` | `0.00` | `0%` | `3.16%` | `1.56` | `3.24%` | `3.0` | `0.85` |
| Balanced | `P-B` `dd=prop+vol=lin` (`L-035`) | `4.83%` | `1.88` | **`3.40%`** | `4.0` | `2.41%` | `0.86` | `0.00` | `0%` | `3.91%` | `1.46` | `3.24%` | `4.0` | `0.93` |
| Balanced | `P-B` `dd=step+vol=lin` (`L-036`) | `4.91%` | `1.86` | `3.78%` | `4.0` | `2.50%` | `0.90` | `0.00` | `0%` | `4.04%` | `1.47` | `3.57%` | `4.0` | `0.97` |
| Aggressive | **Matched Baseline** (`x_cap=0.80`) | `13.55%` | `0.83` | **`63.45%`** | `4.0` | `18.33%` | `5.60` | `0.71` | `30%` | `17.30%` | `1.01` | `24.64%` | `4.0` | `5.46` |
| Aggressive | `P-A` `vol=linear` (`L-031`) | `6.73%` | `1.17` | `13.00%` | `4.0` | `6.37%` | `2.17` | `0.00` | `0%` | `6.19%` | `1.12` | `9.33%` | `4.0` | `2.16` |
| Aggressive | `P-A` `vol=squared` (`L-032`) | `6.72%` | `1.23` | `8.77%` | `4.0` | `6.06%` | `2.02` | `0.00` | `0%` | `6.05%` | `1.13` | `8.49%` | `4.0` | `2.11` |
| Aggressive | `P-B` `dd=prop+vol=lin` (`L-037`) | `6.55%` | `1.19` | **`10.35%`** | `4.0` | `5.87%` | `1.93` | `0.00` | `0%` | `6.07%` | `1.14` | `8.19%` | `4.0` | `1.96` |
| Aggressive | `P-B` `dd=step+vol=lin` (`L-038`) | `6.71%` | `1.16` | `12.71%` | `4.0` | `6.37%` | `2.16` | `0.00` | `0%` | `6.19%` | `1.12` | `9.33%` | `4.0` | `2.16` |

*Recovery note: `TTR (med)` reports median sessions to recovery across closed drawdown episodes; full per-episode recovery ranges and right-censored episode flags ([definitions-contract.md](definitions-contract.md) §2.5) are not tabulated in this summary and remain marked missing pending full distribution export.*

### 5.2 Group Findings

- **`P-A` & `P-B` (Class `K`, `L-027`–`L-038`):** Using unrounded run metrics (`mdd` and `g_ann`, which causes minor `0.1` percentage-point display differences relative to the 2-decimal rounded table, e.g., `L-033` `92.1%` unrounded vs `92.0%` from `1.16% / 14.58%`), aggregate synthetic `MDD` drops from a minimum of `79.5%` (`L-031`, `13.00% vs 63.45%`) to a maximum of `96.2%` (`L-028`, `0.56% vs 14.58%`), and the protected `PREREG-R5` run manifest (`PILOT-R5-MANIFEST-1`) records `wf_reduction_frac = 1.0` across 252-session walk-forward windows while eliminating `D`-breaches (`0%` 10-yr probability vs `25%–30%` baseline) with `0.00` trips/yr. Note that `λ_trip` never binds (even the matched baselines at `0.20–0.71` trips/yr already sit below the Class-`K` `λ_trip ≤ 1 / 2 / 3` per-year ceilings). Instead, combined stacking of `Step 3 x_ML(c)` + `Step 5 vol_scale` + `dd_scale` produces synthetic growth cost `gc = (g_base - g_variant) / g_base` of `38.4%–52.6%` (`38.4%` on `L-027` to `52.6%` on `L-030`) exceeding the strict Line 14 `π_K` ceilings (`20% / 15% / 10%`), which binds on all 12 `P-A`/`P-B` slots, while annual turnover `TO > 200%` additionally binds on Aggressive slots `L-031` (`216.8%`) and `L-032` (`202.5%`). Thus **all `P-A`/`P-B` slots record formal Class-`K` `REJECT` on growth cost**; per §2 item 6, proportional cushion + `M(c)` (`x_ML(c)`) captures the budget-preservation goal, while Owner review decides whether `vol_scale` / `dd_scale` stays active as a preference guardrail in `policy v0`.
- **`P-C` (`Q2-6` No-Trade Band, `L-039`–`L-047`):**
  - Conservative: **`10%`** adopted (`L-039`, `TO = 36.6%` syn / `44.9%` real `≤ 50%` budget; `20%`/`30%` superseded).
  - Balanced: **`10%`** adopted (`L-042`, `TO = 93.1%` syn / `99.7%` real `≤ 100%` budget; `20%`/`30%` superseded).
  - Aggressive: `10%` exceeds `200%` turnover (`L-045` rejected at `202.6%/207.7%`); **`20%`** adopted (`L-046`, `TO = 193.4%` syn / `196.0%` real `≤ 200%`; `30%` superseded).

---

## 6. `P-E` Minimum-Account Execution Viability (`US$1,500` vs `B_0 = US$50,000`, `L-049`–`L-054`)

| Tier | Mode at `US$1,500` | Syn `g_ann` | Syn `MDD` | Syn `TTR` (med) | Real `g_ann` | Real `MDD` | Real `TTR` (med) | Real annual cost | Annual cost / excess over `2%` bill (real) | Outcome |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Conservative | Whole shares (`L-049`) | `3.10%` | `0.56%` | `3.0` | `1.62%` | `0.10%` | `3.0` | `$4.67` | `n/a` (`g < 2%` bill) | `NOT_MET` |
| Conservative | Fractional shares (`L-050`) | `3.71%` | `1.12%` | `3.0` | `2.39%` | `1.06%` | `3.0` | `$14.63` | `249.4%` | `NOT_MET` |
| Balanced | Whole shares (`L-051`) | `4.18%` | `2.65%` | `4.0` | `2.05%` | `2.13%` | `3.5` | `$19.47` | `2478%` | `NOT_MET` |
| Balanced | Fractional shares (`L-052`) | `4.75%` | `3.46%` | `4.0` | **`3.80%`** | `3.20%` | `4.0` | `$29.98` | `111.1%` | `NOT_MET` |
| Aggressive | Whole shares (`L-053`) | `5.93%` | `7.77%` | `4.0` | `4.05%` | `6.60%` | `3.5` | `$45.97` | `149.2%` | `NOT_MET` |
| Aggressive | Fractional shares (`L-054`) | `6.52%` | `9.28%` | `4.0` | **`5.86%`** | `7.98%` | `3.0` | `$52.96` | `91.5%` | `NOT_MET` |

*Recovery note: `TTR (med)` shows median sessions to recovery; per-episode recovery ranges and right-censored episode flags remain omitted from this summary.*

- **Key operational findings:**
  1. At `US$1,500`, **IBKR fractional shares consistently outperform whole shares** on net growth across every tier (`+175 bps/yr` Balanced real ETF, `+181 bps/yr` Aggressive real ETF), because integer `~$50–60` ETF shares distort `5–10%` target sleeve weights.
  2. The table and ledger govern every `NOT_MET` verdict using the `< 10%` fee-ratio criterion `fee_ratio = annual_cost_usd / (B_0 × (real_g_ann - 0.02))` evaluated at `B_0 = US$1,500` from unrounded run values (e.g., `L-052` records `111.1%` from unrounded cost/excess inputs, failing `< 10%`). **`PAPER` at `US$1,500` should enable IBKR fractional shares** while tracking live slippage/commissions cleanly before scaling capital.

---

## 7. Recommended `Policy v0` Starting Configuration (Candidate for `PAPER`)

| Tier | `D` | `M(D)` | `β_SOXL` | `P-D` credit | Drawdown control | Vol scalar (`σ_target`) | No-trade band | Kelly | `PAPER` broker & execution |
| --- | ---: | ---: | ---: | ---: | --- | --- | ---: | --- | --- |
| Conservative | `15%` | `0.16` | `1.50` | `0.0` (rejected) | Proportional cushion `x_ML(c)` only (`dd_scale` `OFF` by default) | `OFF` by default (Owner opt-in `linear` `5%`) | `10%` | Recorded only (`OFF`) | `IBKR` (fractional at small scale) |
| **Balanced (Starter)** | `30%` | `0.27` | `1.50` | `0.0` (rejected) | Proportional cushion `x_ML(c)` only (`dd_scale` `OFF` by default) | `OFF` by default (Owner opt-in `linear` `10%`) | `10%` | Recorded only (`OFF`) | **`IBKR`** (fractional at `$1,500–$5k`) |
| Aggressive | `50%` | `0.46` | `1.50` | `0.0` (rejected) | Proportional cushion `x_ML(c)` only (`dd_scale` `OFF` by default) | `OFF` by default (Owner opt-in `linear` `19%`) | `20%` | Recorded only (`OFF`) | `IBKR` |

*Traceability: No-trade bands trace directly to ledger `ADOPT` rows `L-039` (`10%`), `L-042` (`10%`), and `L-046` (`20%`); `P-D = 0.0` traces to `REJECT` row `L-048`; `vol_scale` / `dd_scale` have no `ADOPT` row (`L-027`–`L-038` `REJECT`) and remain `OFF` by default unless explicitly opted in by the Owner. No live switches are changed by this document; entering `PAPER` and `SHADOW` promotion remain gated on explicit Owner approvals.*
