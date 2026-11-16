# YARDSTICK Batch Y2 — Synthetic 3× Calibration & Validation Report

> **Headline Verdict (`2026-11-16` Review Disposition):** **“Dataset and model construction verified; full matched-overlap carry calibrated in sample. The zero-spread specification and both chronological holdout checks exceed the pre-registered 0.50 pp/yr tolerance. Independent accuracy within that tolerance is not established. Post-switch SOXL is an explicitly mismatched-index comparison.”**

- **Scope & Governance:** Evaluates the modelled synthetic `3×` Nasdaq-100 (`./data/synthetic_3x_ndx_daily.csv`, `1985-01-31`..`2026-11-13`, `10,528` rows) and modelled synthetic `3×` Semiconductor (`./data/synthetic_3x_semi_daily.csv`, `1994-05-04`..`2026-11-13`, `8,189` rows) series against real ETF histories (`./data/tqqq_daily.csv` and `./data/soxl_daily.csv`) using the pre-registered tolerance and comparison protocol locked in [dataset.md](dataset.md) §3 (`docs/quant/definitions-contract.md` §§5.3 & 7.1, `docs/quant/cost-model.md` §§3.1–3.2), as interpreted under the `2026-11-16` independent review disposition ([dataset.md](dataset.md) §5).
- **Publication note (Y3 fix round, 2026-11-17):** Repository copy of the reviewed Y2 validation record; it is not rewritten as a pass. Names such as `prospectus-tqqq.md`, `scripts/` and `validation_results.json` refer to workspace records kept outside Git (see the publication note in [dataset.md](dataset.md)). The workspace source `VALIDATION.md` has SHA-256 `787b84d1d8519bc01c4b589196b888d423c4d098b1519a7644cf21e268aed882`; this copy changes only link targets, this note, and one sentence in §5 that paraphrases five prohibited claims instead of quoting them.
- **Standing `SOXL` Basis Qualification (`R1`):** Every `SOXL` result in this report uses a **`market-close proxy; NAV criterion unverified`** (`api.nasdaq.com` 16:00 ET closes + Direxion cash distributions, reconciled only against two recent sponsor endpoints `2026-09-30` and `2026-10-31`). Daily `SOXL` NAV validation under `cost-model.md` §3.2 and historical SEC `N-CSR` NAV audits remain unavailable.
- **Standing Vintage & Reproducibility Qualification (`R3`):** All pre-TR `Path C` index segments and Stage 2b calibrated synthetic series are an **`as-retrieved reconstruction; not point-in-time inputs`** (upstream feeds retrieved `2026-11-16`, cut-off `2026-11-13`, without archived raw payloads). Pre-TR dividend yields (`1999–2002` `NDX`, `2009–2012` `SOX`) and Stage 2b `c_spread` constants (`2010–2026` `TQQQ`, `2010–2021` `SOXL`) use post-date observations and must never be treated as point-in-time signal inputs or unseen validation evidence.
- **Mandatory Model Labelling Notice:** Every row of `./data/synthetic_3x_ndx_daily.csv` and `./data/synthetic_3x_semi_daily.csv` (`is_synthetic_model=true`) — and every pre-total-return `Path C` index row before `1999-03-04` (`NDX`) and `2009-12-22` (`SOX`) (`is_modelled=true`) — is a **modelled** research instrument, never native exchange total-return history or real ETF fund history. Real fund histories begin only on ETF inception (`2010-02-09` for `TQQQ`; `2010-03-11` for `SOXL`).
- **Live Authority Statement:** **The live `V5` decay monitor remains the sole authority on the real funds' actual decay.** These synthetic `3×` histories calibrate historical carry mechanics and pre-inception boundary behavior; they never override live `V5` decay measurements.
- **Non-Merit Instrument Notice:** This report measures model-to-ETF tracking, carry calibration residuals, and pre-TR splice uncertainty only. It contains zero strategy merit analysis, zero allocation advice, and zero backtest conclusions.

---

## 1. Pre-Registered Tolerance & Calibration Audit Trail

Before generating `./data/synthetic_3x_*.csv` (`./scripts/build_synthetic_3x.py`) or executing comparison diagnostics (`./scripts/validate_synthetic.py`), Section 3 of [dataset.md](dataset.md) was locked with receipt `./scripts/metadata/preregistration_receipt.json`:

- **Receipt Timestamp:** `2026-11-15T19:49:55.128473+00:00` (`2026-11-16 03:49:55.128473+08:00` Singapore local time). Together with `cost-model.md`'s pre-existing `0.50 pp/yr` threshold, the local receipt supports pre-comparison protocol ordering; local timestamps and receipt files are mutable local artifacts and do not turn an in-sample fit into an independent validation.
- **Locked Section 3 SHA-256:** `1a698b96e84f11070e9ff42c3bbf3c9f0dac5c49729ec0c07022c106456469e8` (`5,426` bytes, preserved byte-identical across edits).
- **Pre-Registered Gating Tolerance:** **`|ΔR_ann| = |R_{ann,ETF} - R_{ann,syn}| <= 0.50 percentage points per year` (`<= 50 bps/yr`)**, evaluated on canonical `N_yr = 252` geometric annualized total return (`R_ann = (I_T / I_0)^{252 / N} - 1`) over the matched-underlying post-inception overlap windows (`2010-02-10`..`2026-11-13` for `TQQQ` NAV, `4,217` returns; `2010-03-12`..`2021-08-24` for `SOXL` on native `PHLX SOX`/`XSOX`, `2,884` returns, **`market-close proxy; NAV criterion unverified`**).
- **Canonical Return Formula (`cost-model.md` §3.1, Rule C1):**
  `r_{syn,i,t} = max(-1.0,  3 × r_{idx,i,t} - (2 × r_{f,t} + c_{spread,i} + TER_i) × Δτ_t)`,
  with statutory net expense ratios `TER_TQQQ = 0.78%/yr` (`prospectus-tqqq.md` §3) and `TER_SOXL = 0.75%/yr` (Direxion statutory fund data retrieved `2026-11-16`), and zero separate daily-reset variance charge (Rule C1).
- **Deterministic Branch Outcome ([dataset.md](dataset.md) §§3.3, 5):**
  1. **Stage 1 (`c_spread = 0`) — Exceeds Tolerance (`FAIL`):** Failed `<= 0.50 pp/yr` on both matched overlaps (`ΔR_ann = -2.167 pp/yr` on `TQQQ` NAV; `-2.132 pp/yr` on `SOXL` `2010–2021` `SOX`, `market-close proxy; NAV criterion unverified`), leaving an empirical `-2.1` to `-2.2 pp/yr` shortfall relative to `2 × r_f + TER`.
  2. **Stage 2a Chronological Split-Sample Check — Holdout `FAIL`:** Failed held-out out-of-sample (OOS) tolerance in both families (`TQQQ` `2010–2018` train fit `c_train = 0.9811%/yr` yielded OOS `2018–2026` `ΔR_ann = -1.405 pp/yr` and full-overlap `-0.773 pp/yr`; `SOXL` `2010–2015` train fit `c_train = 1.1966%/yr` yielded OOS `2016–2021` `ΔR_ann = -0.945 pp/yr`, `market-close proxy; NAV criterion unverified`).
  3. **Stage 2b Fallback (`selected_rule_branch = stage2_full_matched_overlap`) — In-Sample Calibrated Fit (Not an Independent Validation):** Selected deterministically after Stage 1 and Stage 2a exceeded tolerance, solving **`c_spread,TQQQ = 1.5294%/yr` (`152.94 bps/yr`)** on `2010-02-10`..`2026-11-13` and **`c_spread,SOXL = 1.4564%/yr` (`145.64 bps/yr`)** on `2010-03-12`..`2021-08-24` (`market-close proxy; NAV criterion unverified`; post-`2021-08-25` `ICESEMIT` sessions excluded). Because bisection sets `R_ann,syn = R_ann,ETF` on the exact evaluated sample, `ΔR_ann ≈ 0` is an **in-sample calibrated fit** (`in-sample fitted equality`), **not** an independent validation. Both constants are **effective residual carry estimates conditional on the chosen TER, rate series and return basis** (`as-retrieved reconstruction; not point-in-time inputs`). All three specifications remain reported side by side below.

---

## 2. Synthetic vs Real ETF Overlap Evaluation & In-Sample Fit Diagnostics

### 2.1 Pre-Registered Exceedances, Holdout Failures & In-Sample Calibrated Fits

*(Ordered with Stage 1 / Stage 2a pre-registered exceedance and holdout-failure rows first; `Arith. <= 0.50 pp` reports only the raw arithmetic inequality `|ΔR_ann| <= 0.50 pp/yr`, which is distinct from out-of-sample or independent validation.)*

| Sleeve & Window | Spec / `c_spread` | Return Sessions (`N`) | ETF `R_ann` | Syn `R_ann` | `ΔR_ann` (`ETF - Syn`) | Arith. `<= 0.50 pp` | Status / Interpretation | `Δg_ann` (Log) | Daily `TE` (`√252 SD`) | `δ_60` Median (`[p05, p95]`) |
| --- | --- | ---: | ---: | ---: | ---: | :---: | --- | ---: | ---: | --- |
| **`TQQQ` NAV** `2010-02-10`..`2026-11-13` | Stage 1 (`0.0000%`) | `4,217` | `+40.38%` | `+42.55%` | **`-2.167 pp`** | No | **Exceeds tolerance (`FAIL`)** | `-1.532 pp` | `0.52 pp` | `-0.369 pp` (`[-0.755, -0.115]`) |
| **`TQQQ` NAV OOS** `2018-04-02`..`2026-11-13` | Stage 2a (`c_train = 0.9811%`) | `2,169` | `+30.89%` | `+32.29%` | **`-1.405 pp`** | No | **Holdout `FAIL`** | `-1.068 pp` | `0.53 pp` | `-0.235 pp` (`[-0.549, -0.066]`) |
| **`TQQQ` NAV Full** `2010-02-10`..`2026-11-13` | Stage 2a (`c_train = 0.9811%`) | `4,217` | `+40.38%` | `+41.16%` | **`-0.773 pp`** | No | **Exceeds tolerance (`FAIL`)** | `-0.549 pp` | `0.53 pp` | `-0.118 pp` (`[-0.478, +0.141]`) |
| **`SOXL` Matched `SOX`** `2010-03-12`..`2021-08-24` | Stage 1 (`0.0000%`) | `2,884` | `+45.05%` | `+47.18%` | **`-2.132 pp`** | No | **Exceeds tolerance (`FAIL`); `market-close proxy; NAV criterion unverified`** | `-1.459 pp` | `7.74 pp` | `-0.371 pp` (`[-0.866, +0.054]`) |
| **`SOXL` Matched OOS** `2016-01-04`..`2021-08-24` | Stage 2a (`c_train = 1.1966%`) | `1,421` | `+78.32%` | `+79.26%` | **`-0.945 pp`** | No | **Holdout `FAIL`; `market-close proxy; NAV criterion unverified`** | `-0.528 pp` | `10.11 pp` | `-0.118 pp` (`[-0.522, +0.276]`) |
| **`SOXL` Matched Full** `2010-03-12`..`2021-08-24` | Stage 2a (`c_train = 1.1966%`) | `2,884` | `+45.05%` | `+45.42%` | `-0.378 pp` | Yes | **Full-sample statistic includes training data; does NOT override holdout `FAIL` (`market-close proxy; NAV criterion unverified`)** | `-0.260 pp` | `7.74 pp` | `-0.069 pp` (`[-0.492, +0.409]`) |
| **`TQQQ` NAV Full Fit** `2010-02-10`..`2026-11-13` | **Stage 2b (`1.5294%`)** | `4,217` | `+40.38%` | `+40.38%` | `+0.000 pp` | Yes (by fit) | **In-sample calibrated fit** (`+0.000000012 pp` fitted equality; not a validation pass; `as-retrieved reconstruction; not point-in-time inputs`) | `+0.000 pp` | `0.54 pp` | `+0.033 pp` (`[-0.328, +0.304]`) |
| **`TQQQ` Mkt Close** `2010-02-12`..`2026-11-13` | Secondary (`1.5294%`) | `4,215` | `+40.10%` | `+40.10%` | `-0.000 pp` | Yes (from NAV fit) | **Related-basis diagnostic using in-sample NAV `c_spread` (not an independent temporal holdout)** | `-0.000 pp` | `3.52 pp` | `+0.009 pp` (`[-0.440, +0.468]`) |
| **`SOXL` Matched `SOX` Fit** `2010-03-12`..`2021-08-24` | **Stage 2b (`1.4564%`)** | `2,884` | `+45.05%` | `+45.05%` | `+0.000 pp` | Yes (by fit) | **In-sample calibrated fit** (`+0.000000034 pp` fitted equality; not a validation pass; `market-close proxy; NAV criterion unverified`; `as-retrieved reconstruction; not point-in-time inputs`) | `+0.000 pp` | `7.74 pp` | `-0.000 pp` (`[-0.418, +0.492]`) |
| **`SOXL` Post-Switch (`XSOX` sub)** `2021-08-25`..`2026-11-13` | Sub (`1.4564%`, **index mismatch**) | `1,312` | `+6.31%` | `+11.00%` | **`-4.690 pp`** | No | **Explicitly mismatched underlying index (`XSOX` vs `ICESEMIT`); not matched `SOXL` validation (`market-close proxy; NAV criterion unverified`)** | `-4.318 pp` | `9.02 pp` | `-0.566 pp` (`[-7.999, +8.396]`) |
| **`SOXL` Combined** `2010-03-12`..`2026-11-13` | Combined (`1.4564%`) | `4,196` | `+31.62%` | `+33.40%` | `-1.789 pp` | No | **Includes post-`2021` mismatched index (`market-close proxy; NAV criterion unverified`)** | `-1.350 pp` | `8.16 pp` | `-0.024 pp` (`[-4.566, +2.381]`) |

*(Annualization Convention Note (`R5`): Canonical `N_yr = 252` geometric annualized return **levels** (`R_ann`) differ from `365.25`-day calendar `CAGR` **levels** by **`0.0689 pp/yr`** on full `TQQQ` (`40.3846%` vs `40.3157%`) and **`0.0505 pp/yr`** on matched `SOXL` (`45.0451%` vs `44.9946%`). By contrast, the **ETF-minus-synthetic return differences** (`ΔR_ann` vs `ΔCAGR_cal`) agree closely across both annualization conventions — differing by `0.0005–0.0042 pp/yr` on Stage 1 / Stage 2a branches and `< 1e-10 pp/yr` around `+1.19e-8` / `+3.39e-8 pp/yr` on the Stage 2b in-sample fits.)*

### 2.2 Sub-Period, Volatility, Drawdown & Episode Diagnostics (Stage 2b In-Sample Calibrated Fits)

*(Every sub-period below sits inside the Stage 2b full fitting window except the `2022` `SOXL` `XSOX`-substitution row. `SOXL` rows carry **`market-close proxy; NAV criterion unverified`**; all Stage 2b series carry **`as-retrieved reconstruction; not point-in-time inputs`**.)*

| Window | `N` | ETF `R_ann` | Syn `R_ann` | `ΔR_ann` | ETF `Vol` | Syn `Vol` | ETF `MDD` | Syn `MDD` | Daily `MAE` (`bps`) | Min / Max `δ_t` (`bps`) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| **`TQQQ` NAV Full (`2010-02-10`..`2026-11-13`, in-sample fit)** | `4,217` | `+40.38%` | `+40.38%` | `+0.000 pp` | `62.66%` | `62.68%` | `81.67%` | `81.47%` | `1.90` | `-48.4` / `+37.7` |
| `TQQQ` Sub `2010-02-10`..`2017-12-29` (inside fit) | `1,987` | `+52.41%` | `+51.54%` | **`+0.868 pp`** | `49.70%` | `49.72%` | `44.62%` | `44.72%` | `1.68` | `-48.4` / `+37.7` |
| `TQQQ` Sub `2018-01-02`..`2021-12-31` (inside fit) | `1,008` | `+63.76%` | `+63.98%` | `-0.220 pp` | `74.22%` | `74.25%` | `69.97%` | `69.88%` | `1.20` | `-15.5` / `+7.1` |
| `TQQQ` Sub `2022-01-03`..`2026-11-13` (inside fit) | `1,222` | `+8.18%` | `+9.06%` | **`-0.889 pp`** | `70.67%` | `70.67%` | `81.05%` | `80.85%` | `2.85` | `-14.1` / `+10.3` |
| `TQQQ` COVID Stress `2020-02-20`..`2020-03-23` | `23` | `-100.00%*` | `-100.00%*` | `-0.000 pp` | `245.02%` | `245.27%` | `69.97%` | `69.88%` | `2.43` | `-15.5` / `+6.3` |
| `TQQQ` `2022` Bear (`2022-01-03`..`2022-12-30`) | `251` | `-79.16%` | `-78.91%` | `-0.249 pp` | `97.47%` | `97.48%` | `81.05%` | `80.85%` | `1.84` | `-14.1` / `+8.3` |
| **`SOXL` Matched `SOX` (`2010-03-12`..`2021-08-24`, mkt-close fit)** | `2,884` | `+45.05%` | `+45.05%` | `+0.000 pp` | `80.02%` | `82.17%` | `80.38%` | `80.77%` | `16.22` | `-1,955.7` / `+911.9` |
| `SOXL` Sub `2010-03-12`..`2017-12-29` (inside fit) | `1,966` | `+40.99%` | `+40.79%` | `+0.193 pp` | `68.87%` | `69.77%` | `72.61%` | `72.61%` | `16.14` | `-244.5` / `+244.0` |
| `SOXL` Sub `2018-01-02`..`2021-08-24` (inside fit) | `918` | `+54.13%` | `+54.59%` | `-0.453 pp` | `99.83%` | `103.87%` | `80.38%` | `80.77%` | `16.38` | `-1,955.7` / `+911.9` |
| `SOXL` COVID Stress `2020-02-20`..`2020-03-23` | `23` | `-100.00%*` | `-100.00%*` | `-0.000 pp` | `262.79%` | `312.63%` | `80.38%` | `80.77%` | `216.32` | `-1,955.7` / `+911.9` |
| `SOXL` `2022` Bear (`XSOX` sub, `2022`) | `251` | `-85.77%` | `-85.43%` | `-0.342 pp` | `129.73%` | `131.28%` | `90.34%` | `90.31%` | `26.24` | `-171.7` / `+123.3` |

*\*Note (`R5`): Over the `23`-session COVID window (`2020-02-20`..`2020-03-23`), `-100.00%` is a `252/23` power-annualization rounding display of `-99.9998%` (`-69.97%` `TQQQ` / `-80.38%` `SOXL` drawdown), **not** a bankruptcy-floor ruin event (`ruin_hits = 0` across all daily observations).*

### 2.3 Structural Findings on Tracking Diagnostics

1. **`TQQQ` Daily Tracking Error vs Within-Fit Sub-Period Drift (`0.539 pp/yr` TE):** Daily tracking error relative to official `TQQQ` NAV is `0.539 pp/yr` (`1.90 bps/day` MAE; `δ_60` `p05/p95 = -0.328 / +0.304 pp`), with isolated single-day extrema when ProShares' reported `NAV` reflected fair-value or holiday accrual timing (`2013-07-12` `-48.4 bps` reversing `+37.7 bps` on `2013-07-15`). This daily `TE` is an annualized standard deviation of daily return differences (`√252 × SD`), never a substitute for the registered `ΔR_ann` gate. Moreover, `TQQQ`'s full-fit sub-period errors (`+0.868 pp/yr` in `2010–2017` and `-0.889 pp/yr` in `2022–2026`, both inside the `2010–2026` fit) exceed `0.50 pp/yr`, confirming that full-window fitted equality does not imply stable constant-carry tracking over time. Comparing market close (`4,215` sessions) instead of NAV inflates daily `TE` by `6.5×` (`3.52 pp/yr`, `MAE = 14.10 bps`, extrema `-322.0 / +274.3 bps`) and is a related-basis diagnostic rather than an independent temporal holdout.
2. **`SOXL` Market-Close Proxy Noise & Unverified Daily NAV (`2010–2021`):** Because Direxion publishes no free historical daily NAV CSV, `SOXL` is evaluated on `api.nasdaq.com` 16:00 ET market closes (`market-close proxy; NAV criterion unverified`). This yields daily `TE = 7.743 pp/yr` (`MAE = 16.22 bps`) with large March 2020 liquidity-shock excursions (`2020-03-16`: `SOXL -38.59%` vs `Syn -47.71%`, `+911.9 bps`; `2020-03-17`: `SOXL +9.94%` vs `Syn +29.50%`, `-1,955.7 bps`; also `2020-03-13` `-550.4 bps`, `2020-03-18` `+349.0 bps`, `2020-03-19` `-521.1 bps`). While secondary-market close-vs-NAV premiums/discounts likely contribute, without daily historical `SOXL` NAV those March 2020 excursions cannot be attributed exclusively to market-price premiums/discounts rather than NAV or swap tracking deviations.
3. **`SOXL` Post-`2021-08-25` Index Mismatch (`ICESEMIT` vs `XSOX`):** After `SOXL` switched from `PHLX SOX` to the `ICE/NYSE Semiconductor Index` (`ICESEMIT`) on `2021-08-25`, continuing free `XSOX` yields `-4.690 pp/yr` (`TE = 9.02 pp/yr`; annual gaps `-17.30 pp` in `2024`, `-8.45 pp` in `2025`). `./data/synthetic_3x_semi_daily.csv` is therefore a modelled `3× XSOX` series calibrated in sample to the `2010–2021` `SOXL` `market-close proxy; NAV criterion unverified` (`as-retrieved reconstruction; not point-in-time inputs`), not an independently validated series and not an `ICESEMIT` proxy. While the benchmark index mismatch is established, decomposing the entire `-4.690 pp/yr` divergence specifically into constituent weights vs financing/close basis would require matched `ICESEMIT` and daily `SOXL` NAV data.

---

## 3. Qualified Financing Attribution & Explicit Residual Gap

### 3.1 Observed Snapshot, Computed Fit, Economic Hypotheses & Attribution Gap

1. **Observed Single-Date SEC Filing Snapshot (`TQQQ` `2026-08-31`, Separate from Prospectus Scope):**
   - Separate from `prospectus-tqqq.md` (whose `2026-09-28` Summary/Statutory/SAI records are verified current through `2026-11-12` only and explicitly leave swap counterparties, reference rates, and spread basis points undisclosed), `validate_synthetic.py` embeds values reported in SEC EDGAR Form `NPORT-P` for ProShares Trust (CIK `0001174610`, Accession `0002071691-26-025355`, filed `2026-10-28`, reporting period date `2026-08-31`; EDGAR index [`0002071691-26-025355-index.htm`](https://www.sec.gov/Archives/edgar/data/1174610/000207169126025355/0002071691-26-025355-index.htm) and XML [`primary_doc.xml`](https://www.sec.gov/Archives/edgar/data/1174610/000207169126025355/primary_doc.xml)).
   - That raw XML payload is not archived locally under `./y2/` and was hardcoded into `validate_synthetic.py` as a single-date `TQQQ` snapshot (`netAssets = $36,114,245,808.21`; `$89,955,724,444` notional across `10` total-return swap counterparties = `2.4909×` NAV at `FEDL01` plus `105`–`135 bps`, notional-weighted `124.18 bps/yr`, plus `$4,569,792,920` futures notional = `0.1265×` NAV). It covers **`TQQQ` on `2026-08-31` only** — it is neither a `2010–2026` `TQQQ` time series nor any filing for `SOXL`.
2. **Computed Fit & Diagnostic Quantities:**
   - The Stage 2b constants **`c_spread,TQQQ = 1.5294%/yr` (`152.94 bps/yr`)** and **`c_spread,SOXL = 1.4564%/yr` (`145.64 bps/yr`; `market-close proxy; NAV criterion unverified`)** are **effective residual carry estimates conditional on the chosen TER (`0.78%`/`0.75%`), rate series (`EFFR`/`SOFR`), and return basis** (`as-retrieved reconstruction; not point-in-time inputs`).
   - Multiplying the single-date `2026-08-31` `TQQQ` snapshot's `124.18 bps/yr` weighted swap spread by `2.4909×` swap notional gives a single-date gross swap-spread figure of `309.33 bps/yr` on `TQQQ` NAV before any offsets. That single-date `TQQQ` gross figure is **not** a derived historical bound on net carry for `TQQQ` (`2010–2026`) or `SOXL` (`2010–2021`).
   - Similarly, `"Imp Spread"` in §3.2 (`g_zero - g_etf`) is a computed annual log-return gap relative to the Stage 1 (`c_spread = 0`) model, not an independently observed dealer financing quote.
3. **Economic Hypotheses (Plausible Drivers, Not Proven Historical Attribution):**
   - Institutional OTC total-return swap spreads above `r_f`, floating-leg exposure differing from `2.00×` (e.g., `2.49×` swaps in the `2026-08-31` `TQQQ` snapshot alongside `~0.38×`–`1.00×` funded equity/cash and Treasury-bill collateral earning `~EFFR` or `3M T-bill`, where `mean(tbill_3m - r_f) = +2.80 bps/yr` across `2010–2026` `TQQQ` and `-3.57 bps/yr` across `2010–2021` `SOXL`), futures implied-repo financing, and potential post-`2018` dealer balance-sheet/capital pricing shifts offer plausible economic context for why `c_spread > 0` and why Stage 1 / Stage 2a residuals grow more negative in `2018–2026` (`TQQQ` Stage 1 annual residuals `-0.62` to `-2.55 pp/yr` in `2010–2016` vs `-1.50` to `-5.93 pp/yr` in `2018–2026`).
   - These remain unverified economic hypotheses rather than an established historical attribution of either `TQQQ` or `SOXL` carry over `2010–2026`.
4. **Explicit Historical Attribution Gap & Unexplained Residuals:**
   - Because multi-year historical SEC `N-CSR`/`N-PORT` swap schedules for `TQQQ` and `SOXL` and daily `SOXL` NAV series were not collected, a constant residual-fitted `c_spread` conflates multiple unseparated terms: (i) time-varying swap spreads, (ii) constant backward application of `2026` net `TER` (`0.78%`/`0.75%`) across `2010–2026`, (iii) switching the model's `r_f` input from `EFFR` to `SOFR` on `2018-04-02` vs actual swap floating legs (`FEDL01`/LIBOR/`OBFR`/`SOFR`), (iv) changing funded-equity, futures, and collateral cash mixes, (v) index-tracking or tax/withholding frictions, and (vi) `SOXL` market-close basis deviations.
   - This attribution gap leaves material unexplained residuals even after Stage 2b calibration: `+0.868 pp/yr` (`2010–2017`) and `-0.889 pp/yr` (`2022–2026`) sub-period residuals on `TQQQ` NAV, and calendar-year Stage 2b residuals spanning `+2.20` to `-1.50 pp/yr` (`TQQQ` NAV) and `+2.97` to `-1.47 pp/yr` (matched `SOXL`, `market-close proxy; NAV criterion unverified`).
   - **Non-Double-Counting Check (Rule C1):** Calibrated `Vol` (`62.68%` vs `62.66%` `TQQQ` NAV; `82.17%` vs `80.02%` `SOXL` close) and `MDD` remain consistent without any extra volatility-drag term, confirming daily-reset variance decay emerges directly from compounding daily returns per `cost-model.md` Rule C1.

### 3.2 Calendar-Year Residual & Log-Gap Diagnostics (`2010–2026`)

Each calendar year reports `ETF` annualized return minus Stage 1 (`c_spread = 0`, `Z Res`) and Stage 2b in-sample fitted `Syn` (`152.94 bps` `TQQQ`; `145.64 bps` `SOXL`, `Cal Res`), plus the approximate annual log-return gap relative to Stage 1 (`Imp Spread = g_zero - g_etf`, not an observed dealer spread). All `SOXL` columns reflect `market-close proxy; NAV criterion unverified`.

| Year | Mean `r_f` | `tbill - r_f` (`bps`) | `2 r_f` (`bps`) | `TQQQ` ETF (`%`) | `TQQQ` `Z` Res (`pp`) | `TQQQ` `Cal` Res (`pp`) | `TQQQ` Log Gap (`bps`) | `SOXL` ETF (`%`) | `SOXL` `Z` Res (`pp`) | `SOXL` `Cal` Res (`pp`) | `SOXL` Note |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `2010` | `0.18%` | `-3.7` | `36.8` | `+97.91%` | `-0.79` | `+2.20` | `+39.8` | `+33.09%` | `-1.75` | `+0.19` | `SOX` match (`N=205`, mkt close) |
| `2011` | `0.10%` | `-4.9` | `20.6` | `-7.77%` | `-0.62` | `+0.78` | `+67.4` | `-48.07%` | `-0.87` | `-0.10` | `SOX` match (mkt close) |
| `2012` | `0.14%` | `-5.5` | `28.5` | `+52.46%` | `-0.86` | `+1.49` | `+56.4` | `+3.61%` | `-1.13` | `+0.41` | `SOX` match (mkt close) |
| `2013` | `0.11%` | `-5.0` | `21.7` | `+139.98%` | `-2.55` | `+1.12` | `+105.7` | `+156.68%` | `-0.74` | `+2.97` | `SOX` match (mkt close) |
| `2014` | `0.09%` | `-5.6` | `17.9` | `+56.82%` | `-1.98` | `+0.42` | `+125.7` | `+95.34%` | `-2.55` | `+0.31` | `SOX` match (mkt close) |
| `2015` | `0.14%` | `-8.0` | `27.0` | `+17.41%` | `-1.47` | `+0.33` | `+124.5` | `-20.58%` | `-1.26` | `-0.10` | `SOX` match (mkt close) |
| `2016` | `0.39%` | `-7.2` | `78.9` | `+11.04%` | `-1.24` | `+0.47` | `+110.7` | `+123.20%` | `-3.95` | `-0.68` | `SOX` match (mkt close) |
| `2017` | `1.00%` | `-5.6` | `200.5` | `+119.33%` | `-2.86` | `+0.51` | `+129.6` | `+142.56%` | `-3.89` | `-0.34` | `SOX` match (mkt close) |
| `2018` | `1.86%` | `+12.1` | `371.0` | `-19.72%` | `-1.50` | `-0.24` | `+184.6` | `-39.18%` | `-1.29` | `-0.38` | `SOX` match (mkt close) |
| `2019` | `2.20%` | `-9.1` | `439.3` | `+133.93%` | `-3.50` | `+0.10` | `+148.5` | `+231.85%` | `-3.33` | `+1.52` | `SOX` match (mkt close) |
| `2020` | `0.36%` | `+0.5` | `72.5` | `+109.24%` | `-3.70` | `-0.47` | `+175.1` | `+69.63%` | `-3.98` | `-1.47` | `SOX` match (`COVID`, mkt close) |
| `2021` | `0.04%` | `+0.7` | `7.9` | `+82.30%` | `-2.91` | `-0.11` | `+158.5` | `+118.84%` | `-0.59` | `+2.58` | Aug 25 switch (`SOX`->`ICESEMIT`) |
| `2022` | `1.64%` | `+45.7` | `328.0` | `-79.16%` | `-0.58` | `-0.25` | `+273.0` | `-85.77%` | `-0.56` | `-0.34` | `XSOX` sub (`ICESEMIT`, mkt close) |
| `2023` | `5.00%` | `+27.9` | `1,000.5` | `+200.81%` | `-5.93` | `-1.27` | `+195.2` | `+230.09%` | `-3.04` | `+1.78` | `XSOX` sub (`ICESEMIT`, mkt close) |
| `2024` | `5.15%` | `+3.5` | `1,029.1` | `+58.22%` | `-3.10` | `-0.64` | `+194.3` | `-12.34%` | `-18.85` | **`-17.30`** | `XSOX` vs `ICESEMIT` basis |
| `2025` | `4.24%` | `-3.7` | `848.8` | `+34.74%` | `-3.21` | `-1.10` | `+235.3` | `+55.41%` | `-10.87` | **`-8.45`** | `XSOX` vs `ICESEMIT` basis |
| `2026` | `3.69%` | `+16.9` | `737.1` | `+11.65%` | `-3.24` | `-1.50` | `+285.9` | `+45.88%` | `+0.22` | `+2.32` | `XSOX` sub (`N=219` thru `11-13`) |

---

## 4. Separate Uncertainty Quantification for Pre-TR Spliced Segments (`§7.1`)

Per `definitions-contract.md` §7.1 and [dataset.md](dataset.md) §3.4, the pre-total-return `Path C` spliced histories (`1985-01-31`..`1999-03-03` Nasdaq-100, `3,558` returns; `1994-05-04`..`2009-12-21` Semiconductor, `3,938` returns) have no real `3×` ETF overlap, are explicitly tagged `is_modelled=true` (`as-retrieved reconstruction; not point-in-time inputs`), and carry independent structural uncertainty:

### 4.1 Five Quantified Uncertainty Sources & Daily-Path Limitations

1. **Adjacent `756`-Session Dividend-Yield Rolling-Block Diagnostic (Native Overlap Sensitivity):** Unlike the `Path C` construction rule (which fits exact `3`-calendar-year adjacent post-launch windows and backcasts them across `14.1`–`15.6` pre-TR years), testing adjacent `756`-session rolling blocks stepped by `252` sessions across native GIW overlaps provides a sensitivity diagnostic (not a calibrated confidence interval for the `14`–`16`-year backcasts):
   - **Nasdaq-100 (`22` rolling `756`-session `3Y->3Y` blocks across `1999–2026`):** `1×` index MAE `23.33 bps/yr` (max `59.37 bps/yr`), corresponding via linear `3×` yield scaling (`3 × err_1x`, a first-order yield sensitivity rather than exact compounded `3×` return error) to **`69.99 bps/yr` MAE** and **`178.12 bps/yr` max** (starting block `1999-03-11`..`2002-03-11` `0.0544%` -> next 3Y `0.2303%`, `-52.76 bps/yr` first-order `3×` diff).
   - **Semiconductor (`11` rolling `756`-session `3Y->3Y` blocks across `2010–2026`):** `1×` index MAE `24.67 bps/yr` (max `52.91 bps/yr`), scaling via `3 × err_1x` to **`74.01 bps/yr` MAE** and **`158.73 bps/yr` max**.
2. **Pre-TR Constant Dividend-Yield Sensitivity & `2005–2006` `SOXX` Check:** Holding Stage 2b `c_spread` fixed (`1.5294%` `NDX`; `1.4564%` `SOX`), sweeping the constant `Path C` yield `y_{adj}` bounds regime shift sensitivity:
   - **`NDX` (`1985-01-31`..`1999-03-03`, `3,558` returns; `1×` Base `+21.32%`, `MDD 39.93%`; `3×` Base `+32.81%`, `MDD 85.46%`):**

     | Assumed `y_{NDX,adj}` | `1× R_ann` (`Δ vs Base`) | `3× R_ann` (`Δ vs Base`) | `3× MDD` |
     | ---: | ---: | ---: | ---: |
     | `0.000%` (Price only) | `+21.26%` (`-0.07 pp`) | `+32.60%` (`-0.22 pp`) | `85.53%` |
     | **`0.055%` (Base `1999–2002`)** | **`+21.32%` (`+0.00 pp`)** | **`+32.81%` (`+0.00 pp`)** | **`85.46%`** |
     | `0.500%` | `+21.86%` (`+0.54 pp`) | `+34.59%` (`+1.78 pp`) | `84.86%` |
     | `1.000%` | `+22.47%` (`+1.14 pp`) | `+36.61%` (`+3.80 pp`) | `84.15%` |
     | `1.500%` | `+23.07%` (`+1.75 pp`) | `+38.65%` (`+5.83 pp`) | `83.67%` |

   - **`SOX` (`1994-05-04`..`2009-12-21`, `3,938` returns; `1×` Base `+8.77%`, `MDD 85.42%`; `3×` Base `-34.64%`, `MDD 99.9995%`):**

     | Assumed `y_{SOX,adj}` | `1× R_ann` (`Δ vs Base`) | `3× R_ann` (`Δ vs Base`) | `3× MDD` |
     | ---: | ---: | ---: | ---: |
     | `0.000%` (Price only) | `+7.20%` (`-1.57 pp`) | `-37.43%` (`-2.80 pp`) | `99.9996%` |
     | `0.500%` | `+7.74%` (`-1.03 pp`) | `-36.49%` (`-1.85 pp`) | `99.9996%` |
     | `1.000%` | `+8.27%` (`-0.49 pp`) | `-35.53%` (`-0.89 pp`) | `99.9995%` |
     | **`1.460%` (Base `2009–2012`)** | **`+8.77%` (`+0.00 pp`)** | **`-34.64%` (`+0.00 pp`)** | **`99.9995%`** |
     | `2.000%` | `+9.35%` (`+0.58 pp`) | `-33.58%` (`+1.05 pp`) | `99.9994%` |
     | `2.500%` | `+9.88%` (`+1.12 pp`) | `-32.60%` (`+2.04 pp`) | `99.9993%` |

   - **External Cross-Check (`SOXX` `2005–2006`):** `api.nasdaq.com` omits `SOXX` dividends in `2001–2004` and `2007–2012`, leaving only `2005` (`0.158%` cash distribution yield; `0.638%` gross after adding `0.48%` expense ratio) and `2006` (`0.177%` net; `0.657%` gross). If `1994–2009` semiconductor constituents paid `~0.65%/yr` gross rather than `1.460%/yr`, pre-`2009` synthetic `3×` returns carry a plausible **`-1.2` to `-1.6 pp/yr` downward bias sensitivity** relative to base (`-34.64%` -> `~-36.0%`), with `3×` drawdown unchanged at `> 99.999%`.
3. **Smooth Calendar Accrual vs Discrete Ex-Date Timing Drag:** Tested directly on native TR overlaps (`1999–2026` `XNDX`, `0.7282%/yr` realized dividend yield; `2009–2026` `XSOX`, `1.4908%/yr`), smooth daily accrual vs actual ex-date dividend timing changes compounded `3×` return by only **`-0.22 bps/yr` (`NDX`)** and **`-0.37 bps/yr` (`SOX`)**, with zero meaningful volatility change (`82.09%` vs `82.09%` `NDX`; `94.69%` vs `94.69%` `SOX`).
4. **Pre-`2010` Unobserved Swap Spread Sensitivity (`c_spread` `[-50, +150] bps/yr` vs Stage 2b Fit):**
   - `NDX` (`1985–1999`): `c_spread` in `[1.0294%, 2.0294%, 2.5294%, 3.0294%]` shifts `3× R_ann` by **`[+0.67, -0.66, -1.32, -1.98] pp/yr`** (`3× MDD` `85.23%`..`86.11%`).
   - `SOX` (`1994–2009`): `c_spread` in `[0.9564%, 1.9564%, 2.4564%, 2.9564%]` shifts `3× R_ann` by **`[+0.33, -0.33, -0.65, -0.98] pp/yr`** (`3× MDD` `99.9995%`).
5. **Early `SOX` Daily-Path Uncertainty (`1996–2002` Stale Freeze & `2004–2009` `6.92063%` Feed Discrepancy):**
   - During the worst `api.nasdaq.com/SOX` vendor freeze (`1996-04-09`..`1996-06-05`, `41` flat `0%` sessions preceding the `+22.52%` `1×` / **`+67.53%`** `3×` catch-up print on `1996-06-06`), preserving the flat run + lump-sum catch-up materially distorts daily-reset compounding; the **`10.32%`** figure (`3 × 41 × σ²_clean,1996`, using surrounding clean `1996` daily vol `2.8970%`) is a **variance-based heuristic**, not a recovered daily path or rigorous error bound. All `200` `1996–2002` affected rows are flagged in `quality_flag`; zero occurrences exist after `2002-01-04`.
   - Across the `2004-09-08`..`2009-12-21` overlap where both `api.nasdaq.com` `SOX` and GIW `SOX` report closes, `dataset_build_metadata.json` records a **maximum daily close discrepancy of `6.92063%`** (`max_2004_2009_overlap_diff_pct = 6.920631%`, despite `0.00000%` agreement on the `2009-12-21` splice date). Neither the `Path C` dividend series nor `quality_flag` markers repair missing, stale, or discrepant daily prices, so unqualified daily-path validity is not established on pre-`2009` `SOX`.

### 4.2 Pre-`2010` Modelled Stress Episodes & Full-Sample Bounds (`0` Ruin Events)

Across the entire synthetic histories — `./data/synthetic_3x_ndx_daily.csv` (`1985-01-31`..`2026-11-13`, `terminal_index = 100.0669` vs zero-spread `189.8683`, `min = -45.37%` on `1987-10-19`, `max = +56.27%` on `2001-01-03`) and `./data/synthetic_3x_semi_daily.csv` (`1994-05-04`..`2026-11-13`, `terminal_index = 0.1554` vs zero-spread `0.2501`, `min = -47.71%` on `2020-03-16`, `max = +67.53%` on `1996-06-06` catch-up) — **`ruin_hits = 0`** (daily return never breached `-100%`):

| Pre-`2010` Stress Episode | `N` | `1×` Min 1D | `1×` Wealth (`R_ann`) | `1× MDD` | **`3×` Model** Min 1D | **`3×` Model** Wealth (`R_ann`) | **`3×` Model** `MDD` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `NDX` Oct `1987` (`1987-10-01`..`1987-10-30`) | `21` | `-15.07%` | `0.7156x` (`-98.20%`) | `39.93%` | `-45.37%` | `0.2743x` (`-100.00%*`) | `83.26%` |
| `NDX` Dot-Com Bust (`2000-03-27`..`2002-10-09`) | `636` | `-9.73%` | `0.1719x` (`-50.23%`) | `82.87%` | `-29.24%` | `0.000450x` (`-95.28%`) | `99.96%` |
| `NDX` `2008` GFC (`2007-10-31`..`2009-03-09`) | `339` | `-10.52%` | `0.4703x` (`-42.92%`) | `53.42%` | `-31.60%` | `0.04915x` (`-89.35%`) | `95.08%` |
| `SOX` Dot-Com Bust (`2000-03-10`..`2002-10-09`) | `647` | `-11.66%` | `0.1667x` (`-50.23%`) | `83.33%` | `-35.02%` | `0.000104x` (`-97.19%`) | `99.99%` |
| `SOX` `2008` GFC (`2007-07-16`..`2008-11-20`) | `343` | `-8.89%` | `0.3291x` (`-55.81%`) | `68.04%` | `-26.69%` | `0.01718x` (`-94.95%`) | `98.42%` |

*\*Note (`R5`): Over `21` sessions in Oct `1987`, `-100.00%` is a `252/21` annualization rounding display of `-99.999982%` on `0.2743x` remaining wealth, distinct from a daily bankruptcy ruin event (`ruin_hits = 0`).*

---

## 5. Summary Judgment, Downstream Quotation & Phase Discipline

1. **Calibration & Validation Disposition (`2026-11-16` Review):** **Dataset and model construction verified; full matched-overlap carry calibrated in sample. The zero-spread specification (`-2.167 pp/yr` `TQQQ` NAV; `-2.132 pp/yr` `SOXL` `market-close proxy; NAV criterion unverified`) and both chronological holdout checks (`-1.405 pp/yr` `TQQQ` `2018–2026`; `-0.945 pp/yr` `SOXL` `2016–2021`, `market-close proxy; NAV criterion unverified`) exceed the pre-registered `0.50 pp/yr` tolerance. Independent accuracy within that tolerance is not established.** Stage 2b (`c_spread = 1.5294%/yr` `TQQQ` NAV; `1.4564%/yr` `SOXL` `market-close proxy; NAV criterion unverified`) is strictly an **in-sample calibrated fit** (`as-retrieved reconstruction; not point-in-time inputs`), not an independent validation, and its fitted constants are **effective residual carry estimates conditional on the chosen TER, rate series and return basis** with an unresolved historical financing attribution gap.
2. **Post-`2021` `SOXL` Mismatched-Index Warning:** Post-switch `SOXL` (`2021-08-25`..`2026-11-13`, `ΔR_ann = -4.690 pp/yr`) is an **explicitly mismatched-index comparison** (`XSOX` vs `ICESEMIT`) on a `market-close proxy; NAV criterion unverified`. Do not represent `synthetic_3x_semi_daily.csv` as an `ICESEMIT` proxy or as matched `SOXL` validation after `2021-08-24`.
3. **Binding Downstream Quotation & Phase Discipline (`Y3` / `PILOT`):**
   - `Y3` may freeze the exact CSV hashes from [dataset.md](dataset.md) §4 as modelled research/calibration inputs while keeping baseline replay verification separate, preserving the failed holdout evidence, and retaining **`market-close proxy; NAV criterion unverified`** (`SOXL`) and **`as-retrieved reconstruction; not point-in-time inputs`**. Approved downstream quotation:
     > “Y2 supplied reproducible modelled histories with full-overlap fitted effective carry of 1.5294%/yr for TQQQ and 1.4564%/yr for the SOX-matched SOXL close proxy. Full fitting-window annualized differences round to zero by calibration. Chronological holdouts fail the 0.50 pp/yr tolerance at −1.405 and −0.945 pp/yr. Early Path C segments carry separate uncertainty, and post-2021-08-25 semiconductor data remain XSOX rather than ICESEMIT.”
   - `Y3` / `PILOT` **must not** state that both funds were validated to the 50 bps tolerance, that tracking error is zero, that pre-inception history is validated, that historical swap spreads were verified, or that `SOXL` was validated through 2026 (the source record quotes these five claims verbatim as prohibited; they are paraphrased here). The `TQQQ` market-close comparison (`4,215` sessions) is a related-basis diagnostic, not a new temporal holdout. Do not finalize a `PILOT` statement that relies on an unqualified `Y2` validation pass; record this as an unresolved instrument-validity limitation, freeze intended usage and exclusions before `PILOT` outcomes, and do not reuse previously inspected windows as fresh unseen evidence without explicit disclosure.
4. **Authority Boundary:** These synthetic series are measurement and research calibration instruments only. **The live `V5` decay monitor remains the sole authority on actual real-fund decay.**
5. **Reproducibility Scope (`R3`):** From the frozen `./data/*.csv` snapshot, `./scripts/build_synthetic_3x.py` reproduces the synthetic CSV hashes byte-for-byte and `./scripts/validate_synthetic.py` reproduces `./scripts/metadata/validation_results.json` deterministically (`PYTHONDONTWRITEBYTECODE=1 python3 ./scripts/validate_synthetic.py`). However, `./scripts/build_dataset.py` queries mutable public upstream feeds (`as-retrieved reconstruction; not point-in-time inputs`) without locally archived raw upstream payloads, so a future end-to-end download is not guaranteed to recreate the frozen base hashes.
