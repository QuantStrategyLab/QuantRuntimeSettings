# Phase 11 BREADTH — Empirical Cross-Asset Tail-Correlation Screening

- **Status date:** `2026-11-28`
- **Authorization posture:** Research observation only (`live=OFF`, `paper=OFF`, `no_admission=True`, `no_order=True`, `no_capital=True`). This record authorizes no live/paper changes, no broker edits, and no deployment changes.
- **Related documents:** [breadth-preregistration.md](breadth-preregistration.md) | [experiment-ledger.md](experiment-ledger.md) | [pilot-results.md](pilot-results.md)

---

## 1. Screening Configuration & Dataset Provenance

Evaluated using the offline `QuantPlatformKit` evaluator (`lower_tail_correlation_gate` + `evaluate_breadth_candidate`) against daily adjusted close simple returns across **1,773 aligned trading sessions** (`2019-11-07` through `2026-11-27`, post-126d warm-up):

- **Canonical return matrix SHA-256:** `f72deeab194f9c9ca9c8f141dfe68084e84e2fffb38cf232e5f340b3c26a6367`
- **Gate parameters:** `seed = 20261128`, `mean_block_length = 5.0`, `n_resamples = 1000`, `tail_quantile = 0.10`, `confidence = 0.95` (one-sided stationary-bootstrap UCB), `max_tail_correlation = 0.50` (strict `< 0.50` vs `QQQ`, `TQQQ`, and `SOXL`), `K_trials = 16` screening family.

---

## 2. Empirical Screening Results

| Symbol | Shelf / Class | Ann. Return | Ann. Sharpe | QQQ Tail (95% UCB) | TQQQ Tail (95% UCB) | SOXL Tail (95% UCB) | DSR (`K=16`) | `< 0.50` Tail Bar |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `GLD` | Gold (`1x`) | `+13.12%` | `0.755` | `0.145` (`0.257`) | `0.161` (`0.262`) | `0.254` (`0.383`) | `0.552` | **PASS** |
| `DBMF` | Futures CTA proxy (`1x`) | `+8.48%` | `0.717` | `0.181` (`0.341`) | `0.177` (`0.344`) | `0.264` (`0.395`) | `0.512` | **PASS** |
| `IEF` | 7–10Y US Treasury | `-0.25%` | `0.003` | `-0.216` (`0.014`) | `-0.216` (`0.007`) | `-0.174` (`-0.021`) | `0.031` | **PASS** (tail) |
| `TLT` | 20+Y US Treasury | `-4.40%` | `-0.195` | `-0.260` (`-0.034`) | `-0.265` (`-0.041`) | `-0.127` (`0.026`) | `0.009` | **PASS** (tail) |
| `TLT_TREND126` | 126d-SMA filtered TLT/SHY | `-3.29%` | `-0.239` | `-0.307` (`-0.035`) | `-0.300` (`-0.033`) | `-0.131` (`0.040`) | `0.006` | **PASS** (tail) |
| `US_DEF_MN` | `(XLV+XLP+XLU)/3 - QQQ` | `-11.10%` | `-0.455` | `-0.164` (`-0.001`) | `-0.163` (`-0.003`) | `-0.473` (`-0.281`) | `0.001` | **PASS** (tail) |
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
2. **True orthogonal anchors verified:** Only **Physical Gold (`GLD`)**, **Managed Futures CTA (`DBMF`)**, **US Treasuries (`IEF`/`TLT`/`TLT_TREND126`)**, and **Market-Neutral Defensive Equity (`US_DEF_MN`)** satisfy the `< 0.50` lower-tail point + `95%` UCB bar across `QQQ`, `TQQQ`, and `SOXL`.
3. **Standalone vs portfolio role:** `GLD` and `DBMF` deliver both standalone positive Sharpe (`0.755` / `0.717`) and crisis diversification; static short-QQQ (`US_DEF_MN`) and 2022-era Treasuries require conditional/regime gating or small crisis-hedge sizing before advancing past `research_active`, and full `OI-COST-*` + `PBO` checks remain required prior to any future admission proposal.
