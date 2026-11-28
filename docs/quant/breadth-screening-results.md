# Phase 11 BREADTH — Empirical Cross-Asset Tail-Correlation Screening

- **Status date:** `2026-11-28`
- **Authorization posture:** Research observation only (`live=OFF`, `paper=OFF`, `no_admission=True`, `no_order=True`, `no_capital=True`). This record authorizes no live/paper changes, no broker edits, and no deployment changes.
- **Related documents:** [breadth-preregistration.md](breadth-preregistration.md) | [experiment-ledger.md](experiment-ledger.md) | [pilot-results.md](pilot-results.md)

---

## 1. Screening Configuration & Dataset Provenance

Evaluated using the offline `QuantPlatformKit` evaluator (`lower_tail_correlation_gate` + `deflated_sharpe_ratio`) against daily adjusted close simple returns across **1,773 aligned trading sessions** (`2019-11-07` through `2026-11-27`, post-126d warm-up):

- **Protected dataset reference:** `BREADTH-DATA-20261128` (exact return-matrix digest retained in the protected identity manifest per [dataset.md](dataset.md) §4; omitted from public docs).
- **Gate parameters:** `seed = 20261128`, `mean_block_length = 5.0`, `n_resamples = 1000`, `tail_quantile = 0.10`, `confidence = 0.95` (one-sided stationary-bootstrap UCB), `max_tail_correlation = 0.50` (strict `< 0.50` vs `QQQ`, `TQQQ`, and `SOXL`).
- **Multiple-testing accounting caveat:** `DSR` values below are **within-family diagnostics** (`K_family = 16` screening candidates evaluated on the aligned matrix) rather than a cumulative `K_trials = 85` admission test (historical `L-001`–`L-054` trial-Sharpe arrays on non-aligned/unrecoverable samples are not included). Passing the `< 0.50` tail bar does **not** constitute a cumulative DSR admission pass.

---

## 2. Empirical Screening Results

| Symbol | Shelf / Class | Ann. Return | Ann. Sharpe | QQQ Tail (95% UCB) | TQQQ Tail (95% UCB) | SOXL Tail (95% UCB) | `DSR` (`K_family=16` diag.) | `< 0.50` Tail Bar |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `GLD` | Gold (`1x`) | `+13.12%` | `0.755` | `0.145` (`0.257`) | `0.161` (`0.262`) | `0.254` (`0.383`) | `0.552` | **PASS** (tail only; DSR diag) |
| `DBMF` | Futures CTA proxy (`1x`) | `+8.48%` | `0.717` | `0.181` (`0.341`) | `0.177` (`0.344`) | `0.264` (`0.395`) | `0.512` | **PASS** (tail only; DSR diag) |
| `IEF` | 7–10Y US Treasury | `-0.25%` | `0.003` | `-0.216` (`0.014`) | `-0.216` (`0.007`) | `-0.174` (`-0.021`) | `0.031` | **PASS** (tail only) |
| `TLT` | 20+Y US Treasury | `-4.40%` | `-0.195` | `-0.260` (`-0.034`) | `-0.265` (`-0.041`) | `-0.127` (`0.026`) | `0.009` | **PASS** (tail only) |
| `TLT_TREND126` | 126d-SMA filtered TLT/SHY | `-3.29%` | `-0.239` | `-0.307` (`-0.035`) | `-0.300` (`-0.033`) | `-0.131` (`0.040`) | `0.006` | **PASS** (tail only) |
| `US_DEF_MN` | `(XLV+XLP+XLU)/3 - QQQ` | `-11.10%` | `-0.455` | `-0.164` (`-0.001`) | `-0.163` (`-0.003`) | `-0.473` (`-0.281`) | `0.001` | **PASS** (tail only) |
| `DBC` | Broad Commodities (`1x`) | `+11.96%` | `0.677` | `0.448` (`0.602`) | `0.453` (`0.600`) | `0.329` (`0.531`) | `0.471` | **FAIL** (UCB >= 0.50) |
| `XLE` | US Energy ETF | `+15.80%` | `0.609` | `0.578` (`0.687`) | `0.579` (`0.685`) | `0.459` (`0.634`) | `0.401` | **FAIL** |
| `XLP` | US Staples ETF | `+8.97%` | `0.609` | `0.625` (`0.741`) | `0.620` (`0.745`) | `0.184` (`0.426`) | `0.400` | **FAIL** (`QQQ`/`TQQQ`) |
| `XLU` | US Utilities ETF | `+8.07%` | `0.470` | `0.637` (`0.781`) | `0.634` (`0.779`) | `0.351` (`0.588`) | `0.267` | **FAIL** |
| `EWH` | Hong Kong Equity proxy | `+2.10%` | `0.204` | `0.585` (`0.744`) | `0.585` (`0.743`) | `0.433` (`0.633`) | `0.092` | **FAIL** |
| `EWJ` | Japan Equity ETF | `+8.15%` | `0.498` | `0.680` (`0.778`) | `0.681` (`0.781`) | `0.647` (`0.733`) | `0.293` | **FAIL** |
| `XLF` | US Financials ETF | `+11.83%` | `0.585` | `0.709` (`0.812`) | `0.701` (`0.810`) | `0.443` (`0.645`) | `0.376` | **FAIL** |
| `XLV` | US Health Care ETF | `+11.89%` | `0.716` | `0.710` (`0.821`) | `0.702` (`0.819`) | `0.291` (`0.525`) | `0.511` | **FAIL** |
| `XLI` | US Industrials ETF | `+12.36%` | `0.641` | `0.760` (`0.837`) | `0.759` (`0.839`) | `0.564` (`0.712`) | `0.433` | **FAIL** |
| `VXUS` | Broad ex-US Equity ETF | `+8.69%` | `0.535` | `0.793` (`0.870`) | `0.795` (`0.870`) | `0.645` (`0.772`) | `0.329` | **FAIL** |

---

## 3. Research Conclusions & Next Marketplace Steps

1. **Long-only US sectors and broad non-US equities fail tail diversification:** Every unhedged long-only equity sleeve (`XLV`, `XLP`, `XLU`, `XLE`, `XLF`, `XLI`, `VXUS`, `EWJ`, `EWH`) exhibits `0.58–0.79` lower-tail correlation (`0.68–0.87` 95% UCB) against `QQQ` and `TQQQ` drawdowns.
2. **True orthogonal anchors verified on tail correlation:** Only **Physical Gold (`GLD`)**, **Managed Futures CTA (`DBMF`)**, **US Treasuries (`IEF`/`TLT`/`TLT_TREND126`)**, and **Market-Neutral Defensive Equity (`US_DEF_MN`)** satisfy the `< 0.50` lower-tail point + `95%` UCB bar across `QQQ`, `TQQQ`, and `SOXL` (while broad commodities `DBC` fails on `95%` UCB `>= 0.50`).
3. **Standalone vs admission requirements:** `GLD` and `DBMF` show positive standalone Sharpe (`0.755` / `0.717`) alongside tail diversification, whereas static short-QQQ (`US_DEF_MN`) and 2022-era Treasuries require conditional/regime gating. None of these sleeves is admitted here: cumulative `K_trials = 85` DSR (with registered effective-independence accounting), `PBO`, and full `OI-COST-*` checks remain mandatory before any future admission proposal.

---

## 4. Robustness Diagnostics: CSCV PBO, Rebalance Sensitivity & Crisis Stress (`2026-11-28`)

Evaluated on the same `1,773`-session aligned `BREADTH-DATA-20261128` matrix (`2019-11-07`–`2026-11-27`) under **`live=OFF`, `paper=OFF`, `no_admission=True`** (`Core` = `50% TQQQ + 50% SOXL`, fixed target sleeves `GLD` and `DBMF`). The `12` allocation/rebalance schedule variants below are logged in [experiment-ledger.md](experiment-ledger.md) (`L-056`, advancing running `K_trials` from `85` to `97`), while the fixed-date crisis stress windows remain §6 descriptive checks:

1. **CSCV Probability of Backtest Overfitting (`PBO`):** Selecting across all `16` unfiltered candidates yields `PBO = 0.873`, whereas restricting selection to sleeves passing the `< 0.50` lower-tail correlation bar cuts `PBO` to `0.079` (`6` eligible sleeves).
2. **Rebalance Frequency & Drift-Band Sensitivity (`3x` cost = `15 bps` one-way / `30 bps` two-way per unit turnover):**

| Portfolio | Schedule / Band | Rebalances | Ann. Turnover | `1x` Net CAGR | `3x` Net CAGR | `3x` Sharpe | Max Drawdown |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `Core_100` (`50/50 TQQQ/SOXL`) | `monthly` | `84` | `39.0%` | `+27.02%` | `+26.92%` | `0.724` | `-85.64%` |
| `Core_100` (`50/50 TQQQ/SOXL`) | `quarterly` | `28` | `22.0%` | `+28.49%` | `+28.43%` | `0.737` | `-85.90%` |
| `Core_100` (`50/50 TQQQ/SOXL`) | `band_5pct` | `52` | `42.9%` | `+27.31%` | `+27.20%` | `0.728` | `-85.70%` |
| `Core_100` (`50/50 TQQQ/SOXL`) | `band_10pct` | `13` | `20.9%` | `+27.16%` | `+27.11%` | `0.727` | `-85.54%` |
| `Blend_70_15_15` (`70% Core + 15% GLD + 15% DBMF`) | `monthly` | `84` | `56.8%` | `+31.36%` | `+31.21%` | `0.746` | `-70.12%` |
| `Blend_70_15_15` (`70% Core + 15% GLD + 15% DBMF`) | `quarterly` | `28` | `35.3%` | `+35.76%` | `+35.67%` | `0.798` | `-69.40%` |
| `Blend_70_15_15` (`70% Core + 15% GLD + 15% DBMF`) | `band_5pct` | `72` | `65.0%` | `+31.90%` | `+31.72%` | `0.749` | `-70.73%` |
| `Blend_70_15_15` (`70% Core + 15% GLD + 15% DBMF`) | `band_10pct` | `22` | `37.5%` | `+33.12%` | `+33.02%` | `0.764` | `-68.64%` |
| `Blend_50_25_25` (`50% Core + 25% GLD + 25% DBMF`) | `monthly` | `84` | `58.9%` | `+29.66%` | `+29.51%` | `0.791` | `-54.30%` |
| `Blend_50_25_25` (`50% Core + 25% GLD + 25% DBMF`) | `quarterly` | `28` | `37.4%` | `+34.48%` | `+34.38%` | `0.859` | `-53.40%` |
| `Blend_50_25_25` (`50% Core + 25% GLD + 25% DBMF`) | `band_5pct` | `72` | `69.6%` | `+30.76%` | `+30.58%` | `0.794` | `-54.68%` |
| `Blend_50_25_25` (`50% Core + 25% GLD + 25% DBMF`) | `band_10pct` | `18` | `34.2%` | `+31.05%` | `+30.96%` | `0.802` | `-54.31%` |

3. **Crisis Stress Windows (`monthly` rebalance, `3x` cost):**

| Stress Window | `Core_100` Return (`Window MaxDD`) | `Blend_70_15_15` Return (`Window MaxDD`) | `Blend_50_25_25` Return (`Window MaxDD`) |
| --- | ---: | ---: | ---: |
| `COVID_2020` (`2020-02-19`..`2020-04-30`) | `-50.73%` (`-75.25%`) | `-35.82%` (`-59.64%`) | `-25.56%` (`-47.27%`) |
| `RateHike_2022` (`2022-01-03`..`2022-12-30`) | `-82.69%` (`-85.46%`) | `-65.25%` (`-69.86%`) | `-48.60%` (`-54.05%`) |
| `Tariff_2025` (`2025-02-19`..`2025-05-15`) | `-31.37%` (`-65.97%`) | `-20.29%` (`-51.50%`) | `-13.17%` (`-39.88%`) |

4. **Diagnostic takeaway:** Quarterly and `10%` drift-band rebalancing cut turnover by ~36–42% relative to monthly rebalancing while improving `3x`-cost CAGR and Sharpe across both blends, and orthogonal `GLD` + `DBMF` ballast materially compresses crisis drawdowns (`-14.5` to `-31.4` percentage points across all three stress windows) without requiring admission before `PAPER` stabilizes.
