# YARDSTICK Batch Y2 — As-Retrieved Research Dataset & Pre-Registered Tolerance

- **Scope:** Phase 2 `YARDSTICK` Batch `Y2` as-retrieved research dataset reconstruction under `./data/` and deterministic construction scripts under `./scripts/`, governed by `SURVEY.md`, `prospectus-tqqq.md`, and the signed `QuantRuntimeSettings` contracts (`docs/quant/definitions-contract.md` including the 2026-11-16 §7.1 `Path C` amendment, and `docs/quant/cost-model.md`).
- **Publication note (Y3 fix round, 2026-11-17):** Repository copy of the reviewed Y2 dataset record. Link targets that are not published here (`SURVEY.md`, `prospectus-tqqq.md`, `BRIEF-Y2-BUILD.md`, `scripts/`, `data/`, the review report) are workspace records kept outside Git; raw data and construction code are never committed. The workspace `SURVEY.md` has SHA-256 `0ef5abd74a2ae0552071dcb6a56b81b0cbc342703d1cf62f964095754c38faa0`, `prospectus-tqqq.md` `e66d80daef628917f8b27f57c6e64a0315ed1f307fa66985f66fc54e769c8f6c`, and `scripts/metadata/preregistration_receipt.json` `d3ba10fd8db9f20596a9b4da3068030e8371f1e2b79bde25e9dbd047738dcf59`. The workspace source `DATASET.md` has SHA-256 `b2a615a1ca47116c91686b2130e55b87f6705852a2eb929eb64456cd4568c0c9`; this copy changes only link targets and this note, and leaves §3 byte-identical.
- **Retrieval & Cut-Off Dates:** All primary public feeds were retrieved on `2026-11-16` with sample end cut-off `2026-11-13` (last complete Friday `XNYS` regular-session close prior to retrieval).
- **Non-Merit Instrument Notice:** This dataset and its modelled `3×` series are measurement and calibration instruments only. They contain zero strategy merit evaluations, zero parameter recommendations, and zero return claims.
- **Model Labelling & Live Monitor Authority:**
  - All pre-total-return `Path C` index segments (`1985-01-31` through `1999-03-03` for Nasdaq-100; `1994-05-04` through `2009-12-21` for Semiconductor) and the entire synthetic `3×` fund histories (`./data/synthetic_3x_ndx_daily.csv` and `./data/synthetic_3x_semi_daily.csv`) are **modelled** series (`is_modelled=true` / `is_synthetic_model=true`), never native publisher total-return index data or real fund history.
  - Real `TQQQ` and `SOXL` history starts at ETF inception (`2010-02-09` and `2010-03-11`).
  - **The live `V5` decay monitor remains the sole authority on the real funds' actual decay**; the synthetic `3×` histories never replace it (`BRIEF-Y2-BUILD.md`, `cost-model.md` §3.2).
- **Standing Vintage, Basis & Calibration Qualifications (see §5 for `2026-11-16` Review Disposition):**
  - **`as-retrieved reconstruction; not point-in-time inputs` (`R3`):** Upstream feeds were retrieved `2026-11-16` (cut-off `2026-11-13`) without archiving raw upstream payloads. Pre-TR `Path C` dividend yields (`1999–2002` `NDX`, `2009–2012` `SOX`) and Stage 2b full-overlap `c_spread` constants (`2010–2026` `TQQQ`, `2010–2021` `SOXL`) use later observations, were not known at each historical date, and must not be treated as point-in-time signal inputs or unseen validation evidence.
  - **`market-close proxy; NAV criterion unverified` (`R1`):** `./data/soxl_daily.csv` uses split- and distribution-adjusted secondary-market closes (`api.nasdaq.com` + Direxion distributions) checked against two recent sponsor checkpoints (`2026-09-30`, `2026-10-31`); daily historical `SOXL` NAV validation under `cost-model.md` §3.2 and historical `N-CSR` NAV audits remain unavailable.
  - **In-sample calibration status (`B1`, `B2`):** Stage 2b `c_spread` constants in `./data/synthetic_3x_*.csv` are **in-sample calibrated fits** (effective residual carry estimates conditional on the chosen TER, rate series, and return basis), not an independent out-of-sample validation; Stage 1 (`c_spread = 0`) and both Stage 2a chronological holdouts exceed the `0.50 pp/yr` tolerance.

---

## 1. Restart Inspection & Verification Audit

A prior interrupted build run stopped after writing five partial/candidate CSVs at `2026-11-16 03:23`. Every pre-existing file was inspected, re-hashed, and checked for range and calendar integrity before reuse:

| File | Pre-Restart Status | Audit Outcome & Action Taken |
| --- | --- | --- |
| `./scripts/xnys_calendar.py` | Present (`4,445` bytes) | **Reused verified:** Generates exact `10,528` `XNYS` regular trading sessions (`1985-01-31`..`2026-11-13`), matching Nasdaq GIW `NDX`/`XNDX` 1-for-1 after stripping 1 holiday echo. |
| `./data/ndx_index_daily.csv` | Present (`10,528` rows) | **Reused verified:** Recomputed SHA-256 (`875c6cde908285b536d094181119caf0338e92f358e85798e236b5c5c33d65a5`) matches cleanly; zero missing `XNYS` dates or corporate-action discontinuities. |
| `./data/semi_index_daily.csv` | Present (`8,189` rows) | **Reused verified:** Recomputed SHA-256 (`4ef50831d033711958beff9ee7027d68c361f04e02642a9a19bd436753d7abef`) matches cleanly; corrupt pre-`1994-05-04` `479.49` prefix stripped; `200` early vendor stale/catch-up rows explicitly flagged. |
| `./data/tqqq_daily.csv` | Present (`4,218` rows) | **Reused verified:** Recomputed SHA-256 (`d770897f3c7df8e0cdd056415e2aea10f83d438939ee77602ad3a295b083fd02`) matches cleanly; `384:1` splits and ProShares `43.23%`/`41.02%` checkpoints reconciled within `~0.0054` / `~0.0050 pp/yr` (inside the builder's `0.05 pp/yr` check). |
| `./data/risk_free_rates_daily.csv` | Present (`10,528` rows) | **Failed audit & rebuilt:** `91` US bond-holiday rows contained `tbill_3m_rate = -99.990000` from raw Fed H.15 XML `OBS_VALUE="-9999"` (`OBS_STATUS="ND"`). Fixed `fetch_fed_h15_rates()` to skip `ND` observations and carry forward prior business-day rates (`92` bond-holiday carry-forwards logged). |
| `./data/nasdaq_giw_implied_dividends.csv` | Present (`11,219` rows) | **Rebuilt cleanly:** Normalized exact floating-point zero on `SOX` launch row `2009-12-22` (`abs(d_t) < 1e-15` -> `0.0`). |
| `./data/soxl_daily.csv` | Missing (interrupted before Step `7b`) | **Fixed & built:** Fixed `fetch_direxion_soxl_metadata()` JSON casing (`Distributions`, `MMDDYYYY` `ExDate` parsing, `Monthly/QuarterlyMarketPerformance` & `NavPerformance`) and built complete `4,197`-row series reconciled within `~0.0054 pp/yr` (inside the builder's `0.05 pp/yr` check) of Direxion `2026-09-30`/`2026-10-31` market checkpoints (`market-close proxy; NAV criterion unverified`). |
| `./data/synthetic_3x_ndx_daily.csv`, `./data/synthetic_3x_semi_daily.csv` | Missing | Constructed after this specification's pre-registration receipt is written (Step 3). |

---

## 2. Dataset Provenance, Coverage, Corporate Actions, Breaks & Licence Terms

All dates follow `XNYS` regular-session closes (`N_yr = 252` sessions/year) with overnight calendar-day accrual fraction `Δτ_t = calendar_days(t - 1, t) / 365` (`definitions-contract.md` §1.1).

### 2.1 Series Coverage & Provenance Summary

| File | Coverage (`XNYS` Dates) | Rows | Primary Sources (Retrieved `2026-11-16`) | Basis & Model Status |
| --- | --- | ---: | --- | --- |
| `./data/ndx_index_daily.csv` | `1985-01-31` .. `2026-11-13` | `10,528` | Nasdaq GIW `NDX` + `XNDX` + Path C Implied Dividend Series | Pre-`1999-03-04` **modelled** (`3,559` rows; pre-TR Path C: as-retrieved reconstruction; not point-in-time inputs); `1999-03-04`+ native Gross TR (`6,969` rows) |
| `./data/semi_index_daily.csv` | `1994-05-04` .. `2026-11-13` | `8,189` | `api.nasdaq.com` `SOX` (`1994–2009`) + GIW `XSOX` (`2009–2026`) + Path C Implied Dividend Series | Pre-`2009-12-22` **modelled** (`3,939` rows; pre-TR Path C: as-retrieved reconstruction; not point-in-time inputs); `2009-12-22`–`2021-08-24` native `XSOX` (`2,938` rows); `2021-08-25`+ native `XSOX` substituting for commercial `ICESEMIT` (`1,312` rows) |
| `./data/nasdaq_giw_implied_dividends.csv` | `1999-03-04` .. `2026-11-13` | `11,219` | Nasdaq GIW (`XNDX`/`NDX`: `6,969` rows; `XSOX`/`SOX`: `4,250` rows) | Native publisher implied daily dividend ratio |
| `./data/risk_free_rates_daily.csv` | `1985-01-31` .. `2026-11-13` | `10,528` | Federal Reserve Board H.15 (`RIFSPFF_N.B`, `RIFLGFCM03_N.B`) + NY Fed `SOFR` | `EFFR` (`1985-01-31`..`2018-03-29`, `8,359` rows) stitched to `SOFR` (`2018-04-02`+, `2,169` rows) |
| `./data/tqqq_daily.csv` | `2010-02-09` .. `2026-11-13` | `4,218` | ProShares Historical NAV CSV + `api.nasdaq.com` distributions & chart close | Real ETF total return (`384:1` splits + `24` ex-date cash distributions; NAV primary, close secondary) |
| `./data/soxl_daily.csv` | `2010-03-11` .. `2026-11-13` | `4,197` | `api.nasdaq.com` chart close + Direxion official distribution schedule | Real ETF market-close total return (`60:1` splits + `32` ex-date cash distributions; `market-close proxy; NAV criterion unverified`) |
| `./data/synthetic_3x_ndx_daily.csv` | `1985-01-31` .. `2026-11-13` | `10,528` | Model derived from `ndx_index_daily.csv` + `risk_free_rates_daily.csv` | **Modelled** synthetic `3×` Nasdaq-100 (`cost-model.md` §3.1; in-sample calibrated fit; as-retrieved reconstruction; not point-in-time inputs) |
| `./data/synthetic_3x_semi_daily.csv` | `1994-05-04` .. `2026-11-13` | `8,189` | Model derived from `semi_index_daily.csv` + `risk_free_rates_daily.csv` | **Modelled** synthetic `3×` Semiconductor (`cost-model.md` §3.1; in-sample calibrated fit on `SOXL` `market-close proxy; NAV criterion unverified`; as-retrieved reconstruction; not point-in-time inputs) |

### 2.2 Named Pre-TR Dividend Series & Estimation Rule (`Path C`, §7.1)

Because `XNDX` was never calculated before `1999-03-04` and `XSOX` was never calculated before `2009-12-22`, pre-TR total returns follow `definitions-contract.md` §7.1 (`Path C`) strictly:

- **Named Dividend Series:** **`Nasdaq GIW Implied Index Dividend Series`** stored in `./data/nasdaq_giw_implied_dividends.csv`.
- **Source & Provenance:** Derived from Nasdaq Global Index Watch (`https://indexes.nasdaqomx.com/Index/HistoryData`, retrieved `2026-11-16`) over exact `XNYS` regular-session overlaps between Nasdaq Gross Total Return (`XNDX`, `XSOX`) and Nasdaq Price (`NDX`, `SOX`):
  - Daily implied dividend factor on native overlap session `t`:
    `d_{i,t} = (1 + r_{TR,i,t}) / (1 + r_{PR,i,t}) - 1`.
  - On `XSOX` launch day `2009-12-22`, GIW's `NetChange = +2.07` (`354.72 - 352.65`) matches `SOX`'s `2009-12-21` close `352.65` exactly (`0.00000%` difference), confirming `d_{SOX,2009-12-22} = 0`.
- **Estimation Rule (Pre-Splice Boundary Calibration — `as-retrieved reconstruction; not point-in-time inputs`):**
  - Parameterize each pre-TR regime strictly from the **earliest adjacent 3-calendar-year native overlap window** immediately following each TR launch date and backcast into earlier pre-TR history (`as-retrieved reconstruction; not point-in-time inputs`, since post-launch overlap yields were not observable prior to TR inception):
    1. **Nasdaq-100 (`NDX` pre-`1999-03-04`):** Window `1999-03-04` .. `2002-03-04` (`3.0027` accrual years) yields constant annualized dividend rate **`y_{NDX,adj} = 0.00055003` (`0.0550%/yr`)**. *(Later 2010–2026 Nasdaq-100 dividend yields of `0.6%–1.4%/yr` are explicitly excluded because late-1990s Nasdaq-100 constituents paid near-zero dividends.)*
    2. **Semiconductor (`SOX` pre-`2009-12-22`):** Window `2009-12-22` .. `2012-12-21` (`3.0000` accrual years) yields constant annualized dividend rate **`y_{SOX,adj} = 0.01460417` (`1.4604%/yr`)**.
- **Daily Application Rule:**
  - On every pre-TR session (`1985-02-01` .. `1999-03-03` for `NDX`; `1994-05-05` .. `2009-12-21` for `SOX`), accrue calendar-day dividend return `r_{div,i,t} = (1 + y_{i,adj})^{Δτ_t} - 1` and compound `r_{idx,i,t} = (1 + r_{PR,i,t})(1 + r_{div,i,t}) - 1`.
  - From the native TR launch date onward (`1999-03-04` for `XNDX`; `2009-12-22` for `XSOX`), `idx_total_return` switches cleanly to native GIW Gross TR (`r_{idx,i,t} = TR_t / TR_{t-1} - 1`) with `is_modelled=false` and zero modelled dividend additions.
- **Licence Terms:** Nasdaq GIW and `api.nasdaq.com` index histories carry Nasdaq personal/non-commercial research reference terms (`https://www.nasdaq.com/legal`); commercial redistribution requires a Nasdaq index data licence (`./SURVEY.md` §3).

### 2.3 Per-Series Rules, Corporate Actions, Data Defects & Substitutions

1. **`./data/ndx_index_daily.csv` (Nasdaq-100 Underlying TR Series)**
   - **Sources:** GIW `NDX` (`https://indexes.nasdaqomx.com/Index/History/NDX`) + GIW `XNDX` (`https://indexes.nasdaqomx.com/Index/History/XNDX`) + `Nasdaq GIW Implied Index Dividend Series`.
   - **Corporate Actions & Methodology Breaks:** Launch level `125.0` on `1985-01-31` reflects Nasdaq's retroactive `2:1` split/base reset from `250.0` on `1994-01-04` (verified continuous across `1993-12-31..1994-01-05`). Index weighting transitioned from pure market-cap to modified market-cap weighting effective `1998-12-21`. `XNDX` initialized equal to `NDX` (`1933.03`) on `1999-03-04`.
   - **Cleaning:** `1` non-`XNYS` holiday echo stripped from GIW `NDX`; zero missing `XNYS` sessions.

2. **`./data/semi_index_daily.csv` (Semiconductor Underlying TR Series)**
   - **Sources & Substitution:**
     - `1994-05-04` .. `2009-12-21`: `api.nasdaq.com` `SOX` (`https://www.nasdaq.com/market-activity/index/sox/historical`) + `Path C` dividend model (`is_modelled=true`; `as-retrieved reconstruction; not point-in-time inputs`). Substitutes for GIW `SOX` prior to `2009-12-22` because GIW `SOX` starts only on `2004-09-02` and has `127` missing/zero rows in `2004–2008`. While `api.nasdaq.com` and GIW `SOX` match to `0.00000%` (`352.65`) on the `2009-12-21` splice date, across the `2004-09-08`..`2009-12-21` interior overlap where both feeds report values they exhibit a **maximum daily close discrepancy of `6.92063%`** (`dataset_build_metadata.json`: `max_2004_2009_overlap_diff_pct = 6.920631%`, unresolved without a third historical vendor reference).
     - `2009-12-22` .. `2021-08-24`: Native GIW `XSOX` Gross TR (`https://indexes.nasdaqomx.com/Index/History/XSOX`, `is_modelled=false`).
     - `2021-08-25` .. `2026-11-13`: **Source Substitution (`native_xsox_sub_for_icesemit`, `is_modelled=false`)** — `SOXL` changed benchmark from PHLX `SOX`/`XSOX` to the `ICE/NYSE Semiconductor Index` (`ICESEMIT`) on `2021-08-25`, which has zero free/public historical feed (`./SURVEY.md` §§1.2, 4). Under the free/public source rule (`BRIEF-Y2-BUILD.md`), native GIW `XSOX` continues from `2021-08-25` forward and is explicitly tagged `tr_regime=native_xsox_sub_for_icesemit`.
   - **Corrupted Prefix Detection & Handling (`BRIEF-Y2-BUILD.md`, `SURVEY.md` §1.2):**
     - `scripts/build_dataset.py` programmatically inspects leading `api.nasdaq.com/SOX` records for `open == 0.0 and high == 0.0 and low == 0.0 and abs(close - 479.49) < 1e-6`, strips **`348` corrupted placeholder rows (`1993-01-01` .. `1994-05-03`)**, and starts the clean semiconductor series on **`1994-05-04`** (`close = 119.00`). No `1993-12-01`..`1994-05-03` PHLX `SOX` data exists in clean free sources, leaving those `~5` launch months uncovered (`1994-05-04` still covers all of `2000–02`, `2008`, `2020`, and `2022` stress regimes).
   - **Corporate Actions, Breaks & Vendor Stale-Row Flags:**
     - `1995-07-24` PHLX `SOX` `2:1` split is retroactively adjusted across `api.nasdaq.com` (`1995-07-21 -> 1995-07-24` verified continuous). PHLX `SOX` shifted from price-weighted to modified market-cap weighted in Sep `2009`.
     - `158` exchange-holiday echoes were stripped.
     - **`200` early `api.nasdaq.com` vendor quality rows (`1996-01-02` .. `2002-01-04`):** Explicitly preserved on `XNYS` dates and tagged in `quality_flag`: `133` `vendor_zero_ohl_stale` rows (most notably `1996-01-02`..`1996-02-01` and `1996-04-09`..`1996-06-05` where `O=H=L=0` and stale close held flat before a `+22.52%` `1×` catch-up jump on `1996-06-06`), `17` `vendor_missing_carry_forward` rows (`1996` Mondays absent from `api.nasdaq.com`), and `50` `post_stale_catchup` resumption rows. Zero non-clean rows occur after `2002-01-04` (and zero during `2000-02` except `7` isolated 1-day stale prints). Neither the `Path C` dividend series nor `quality_flag` tags repair missing, stale, or discrepant daily prices or establish unqualified daily-path validity (`1996`'s `41`-session flat freeze and `+22.52%` catch-up materially distort daily-reset compounding).

3. **`./data/risk_free_rates_daily.csv` (Overnight Funding & Collateral Rate)**
   - **Sources & Licence:** Federal Reserve Board H.15 Statistical Release (`https://www.federalreserve.gov/datadownload/Output.aspx?rel=H15&filetype=zip`, US Government public domain: `RIFSPFF_N.B` daily Effective Federal Funds Rate `EFFR` and `RIFLGFCM03_N.B` 3-month Treasury Constant Maturity yield `tbill_3m_rate`) stitched on `2018-04-02` to Federal Reserve Bank of New York Markets API `SOFR` (`https://markets.newyorkfed.org/api/rates/secured/sofr/search.json`, FRBNY public reference data terms).
   - **Gap Rule:** US bond holidays (`OBS_STATUS="ND"`, `-9999` sentinel in Fed XML) are skipped and filled by carrying forward the prior business-day observation (`18` `bond_holiday_carry_forward` rows on `rf_rate`; `92` T-bill bond-holiday carry-forwards).

4. **`./data/tqqq_daily.csv` (Real ProShares UltraPro QQQ)**
   - **Sources & Licence:** ProShares primary split-adjusted daily NAV CSV (`https://accounts.profunds.com/etfdata/ByFund/TQQQ-historical_nav.csv`, ProShares Terms `https://www.proshares.com/legal/terms-and-conditions`, personal/internal informational use) paired with `api.nasdaq.com` `TQQQ` ex-date cash distributions (`https://api.nasdaq.com/api/quote/TQQQ/dividends?assetclass=etf`) and unrounded chart closes (`https://api.nasdaq.com/api/quote/TQQQ/chart?assetclass=etf`). Yahoo Finance was bypassed (`HTTP 429` and non-scraping Terms per `./SURVEY.md` §2.2).
   - **Corporate Actions & Quirks:** All `8` forward splits (`384:1` cumulative: `2011-02-25` `2:1`, `2012-05-11` `2:1`, `2014-01-24` `2:1`, `2017-01-12` `2:1`, `2018-05-24` `3:1`, `2021-01-21` `2:1`, `2022-01-13` `2:1`, `2025-11-20` `2:1`) are already divided into ProShares `NAV` and `api.nasdaq.com` chart closes (`nav_only_pre_secondary_trade` on `2010-02-09..2010-02-10` prior to `2010-02-11` exchange trading). All `24` declared cash distributions are scaled strictly by cumulative split factors occurring **strictly after** `ex_date` and reinvested on `ex_date`: `r_t = (NAV_t + div_adj_t) / NAV_{t-1} - 1` (bypassing ProShares' raw `Prior NAV` column typo on `2010-02-16`). Reconciles to ProShares' published `Since Inception` NAV annualized total returns within `~0.0054` / `~0.0050 pp/yr` (`43.2354%` vs `43.23%` as of `2026-09-30`; `41.0250%` vs `41.02%` as of `2026-10-31` — both inside the `0.05 pp/yr` builder check).

5. **`./data/soxl_daily.csv` (Real Direxion Daily Semiconductor Bull 3X Shares — `market-close proxy; NAV criterion unverified`)**
   - **Sources, Substitution & Licence:** Direxion hosts no public daily historical NAV CSV (`./SURVEY.md` §2.2). Daily split-adjusted closes come from `api.nasdaq.com` unrounded `SOXL` chart close (`https://api.nasdaq.com/api/quote/SOXL/chart?assetclass=etf`, Nasdaq personal/non-commercial terms), paired with Direxion's `32` official ex-date cash distributions (`https://www.direxion.com/product/daily-semiconductor-bull-bear-3x-etfs`, `2010-09-22`..`2026-09-22`, Direxion Legal `https://www.direxion.com/legal`).
   - **Corporate Actions & Audit:** Adjusts cleanly across `2` forward splits (`60:1` cumulative: `2015-05-20` `4:1`, `2021-03-02` `15:1`) with `div_adj = div_declared / post_ex_date_split_factor`. Marked `quality_flag=market_close_basis_no_public_daily_nav` (**`market-close proxy; NAV criterion unverified`**). Anchored to SOXL's `$40.00` initial offering NAV (`0.6666666667` split-adjusted vs `2010-03-11` first secondary close `0.660501321`), compounded market-close total returns reconcile to Direxion's published `Since Inception` checkpoints within `~0.0054 pp/yr` (inside the `0.05 pp/yr` builder check: `39.3646%` vs `39.37%` Mkt / `39.34%` NAV on `2026-09-30`; `33.7846%` vs `33.79%` Mkt / `33.78%` NAV on `2026-10-31`). These two recent sponsor endpoints do not establish daily historical NAV path agreement under `cost-model.md` §3.2 or historical SEC `N-CSR` audits across history.

6. **Modelled Synthetic `3×` Series (`./data/synthetic_3x_ndx_daily.csv`, `./data/synthetic_3x_semi_daily.csv`)**
   - **Canonical Equation (`cost-model.md` §3.1):**
     `r_{syn,i,t} = max(-1.0,  3 × r_{idx,i,t} - (2 × r_{f,t} + c_{spread,i,t} + TER_i) × Δτ_t)`
   - **Statutory Net Expense Ratios (`OI-COST-1` closure):**
     - `TER_TQQQ = 0.0078` (`0.78%/yr` after `-0.16%` fee waiver from `0.94%` gross; verified in `prospectus-tqqq.md` §3).
     - `TER_SOXL = 0.0075` (`0.75%/yr` net after fee waiver from `0.91%` gross; verified from Direxion `SOXL` statutory `Monthly/QuarterlyPerformance` `ExpenseRatioNet`/`ExpenseRatioGross` on `2026-11-16`).
   - **Non-Double-Counting (`cost-model.md` Rule C1):** Daily-reset volatility decay (`-3 σ²` variance drag) is strictly an emergent outcome of compounding `r_{syn,i,t}` and is never deducted a second time.
   - **Calibration & Vintage Qualification (`B1`, `B2`, `R1`, `R3`):** The emitted constant `c_spread` values (`1.5294%/yr` `TQQQ`, `1.4564%/yr` `SOXL`) come from Stage 2b full-overlap root-solving after Stage 1 and Stage 2a exceeded `0.50 pp/yr`. They are **in-sample calibrated fits** and **effective residual carry estimates conditional on the chosen TER, rate series and return basis** (`as-retrieved reconstruction; not point-in-time inputs`), with `SOXL` additionally subject to **`market-close proxy; NAV criterion unverified`**.

---

## 3. Pre-Registered Validation Tolerance & Comparison Protocol (Stated Before Comparison)

This section is locked and SHA-256 receipted prior to generating `./data/synthetic_3x_*.csv`, running any synthetic-vs-real comparison script, or writing `./VALIDATION.md`.

### 3.1 Pre-Registered Pass/Fail Tolerance (`definitions-contract.md` §5.3, `cost-model.md` §3.2)

- **Primary Pass/Fail Metric:** Absolute difference in canonical `N_yr = 252` geometric annualized total return (`definitions-contract.md` §1.1):
  `|ΔR_ann| = |R_{ann,ETF} - R_{ann,syn}|`, where `R_ann = (I_T / I_0)^{252 / N} - 1`.
- **Pre-Registered Acceptance Threshold:** **`|ΔR_ann| <= 0.50 percentage points per year` (`<= 50 bps/yr`, `0.0050 1/yr`)** over the matched-underlying post-inception overlap window with the real funds.
- **Auxiliary Diagnostics Reported Alongside (Non-Gating):** Annualized net log growth difference `|Δg_ann| = |252 × (g_bar_ETF - g_bar_syn)|`, calendar-year (`365.25`-day) CAGR difference, daily tracking difference `δ_{i,t} = r_{ETF,i,t} - r_{syn,i,t}` (mean, annualized `252 × mean`, daily SD, annualized tracking error `√252 × SD`, MAE, min/max), and `60`-session rolling cumulative basis `δ_{60,i,t}` (`definitions-contract.md` §5.3).

### 3.2 Pre-Registered Overlap & Chronological Out-of-Sample Windows

1. **Nasdaq-100 / `TQQQ`:**
   - **Primary matched-underlying validation window:** `2010-02-09` .. `2026-11-13` (`4,217` daily return observations over `4,218` `XNYS` sessions) evaluated against official `TQQQ` **NAV total return** (`nav_total_return` in `./data/tqqq_daily.csv`, per `cost-model.md` §3.2). Market-close total return (`2010-02-11` .. `2026-11-13`, `4,215` return observations) is reported as a secondary close-vs-NAV diagnostic.
   - **Chronological split-sample check:** Training window `2010-02-09` .. `2018-03-29` (`EFFR` rate era) vs held-out **out-of-sample (OOS)** validation window `2018-04-02` .. `2026-11-13` (`SOFR` rate era).
2. **Semiconductor / `SOXL`:**
   - **Primary matched-underlying validation window:** `2010-03-11` .. `2021-08-24` (`2,884` daily return observations over `2,885` `XNYS` sessions), where both `SOXL` and `./data/semi_index_daily.csv` track `PHLX SOX`/`XSOX` natively (`cost-model.md` §3.2).
   - **Chronological split-sample check:** Training window `2010-03-11` .. `2015-12-31` vs held-out **OOS** validation window `2016-01-04` .. `2021-08-24`.
   - **Post-Switch Substitution Window (Reported Separately):** `2021-08-25` .. `2026-11-13` (`1,312` return observations where `SOXL` tracks `ICESEMIT` while free data substitutes `XSOX`) and the combined `2010-03-11` .. `2026-11-13` (`4,196` return observations) are reported separately so `XSOX`-for-`ICESEMIT` constituent drift is isolated from swap-financing calibration.

### 3.3 Pre-Registered Two-Stage Carry Calibration & Synthetic CSV Emission Rule

1. **Stage 1 — Zero-Free-Parameter Structural Carry (`c_{spread,i} = 0`):** Evaluate `r_{syn,i,t}^{(0)}` using strictly `2 × r_{f,t} + TER_i` with zero fitted parameters, and decompose the resulting residual against fee, swap financing, and T-bill collateral offset terms.
2. **Stage 2 — Constant Net Swap Spread Calibration (`c_{spread,i}`):** Solve for the unique constant annualized spread `c_{spread,i}` that minimizes `|R_{ann,ETF} - R_{ann,syn}|` (`ΔR_ann = 0`) strictly on: (a) the chronological training split (evaluated out-of-sample on the held-out split against `<= 0.50 pp/yr`), and (b) the full matched-underlying overlap window (`2010-02-09..2026-11-13` for `TQQQ` NAV; `2010-03-11..2021-08-24` for `SOXL` — never fitting `c_{spread,SOXL}` on post-`2021-08-25` `ICESEMIT` sessions).
3. **Deterministic Emission Rule for `syn_total_return` in Synthetic CSVs:** Both synthetic CSVs output both the zero-spread path (`syn_zero_spread_return`, `syn_zero_spread_index`) and the primary modelled path (`syn_total_return`, `syn_tr_index`), where `c_spread_rate` in the primary modelled path is selected deterministically as:
   - `0.0` if Stage 1 (`c_{spread,i} = 0`) already satisfies `|ΔR_ann| <= 0.50 pp/yr` on the primary matched-underlying window;
   - else the chronological training-split `c_{spread,i}` if it satisfies `|ΔR_ann| <= 0.50 pp/yr` on both the held-out OOS window and the full matched-underlying window;
   - else the matched-underlying overlap `c_{spread,i}` (`cost-model.md` §3.2 calibration), with all three specifications (`c_{spread}=0`, train-fit OOS, and full matched-overlap) reported transparently in `VALIDATION.md`.

### 3.4 Separate Uncertainty Scope for Pre-TR Spliced Segments (`§7.1`)

Pre-TR spliced regimes (`1985-01-31`..`1999-03-03` Nasdaq-100; `1994-05-04`..`2009-12-21` Semiconductor) carry no real ETF overlap and are never judged against `<= 0.50 pp/yr`. Instead, `VALIDATION.md` quantifies and reports their uncertainty separately across: (a) rolling 3-year adjacent-block dividend-yield backcast error across native GIW overlaps (`1999–2026` `NDX`, `2010–2026` `SOX`), (b) `[0%, y_upper]` dividend sensitivity bounds and `2005–2006` `SOXX` distribution cross-check (`api.nasdaq.com` `SOXX` table omits `2001–2004` and `2007–2012`), (c) smooth daily dividend accrual vs discrete ex-date variance-drag impact, (d) `1996–2002` `api.nasdaq.com/SOX` vendor stale-freeze jump distortion, and (e) crisis-era swap-spread widening sensitivity (`±50–150 bps/yr`).

---

## 4. File Integrity Registry (SHA-256)

| File | Coverage | Rows | SHA-256 Digest | Status |
| --- | --- | ---: | --- | --- |
| `./data/ndx_index_daily.csv` | `1985-01-31`..`2026-11-13` | `10,528` | `875c6cde908285b536d094181119caf0338e92f358e85798e236b5c5c33d65a5` | Verified |
| `./data/semi_index_daily.csv` | `1994-05-04`..`2026-11-13` | `8,189` | `4ef50831d033711958beff9ee7027d68c361f04e02642a9a19bd436753d7abef` | Verified |
| `./data/nasdaq_giw_implied_dividends.csv` | `1999-03-04`..`2026-11-13` | `11,219` | `91f0c63b386cb2a732acf1f4b33d122b2000767596b729b131013ae12d7b0c1c` | Verified |
| `./data/risk_free_rates_daily.csv` | `1985-01-31`..`2026-11-13` | `10,528` | `211fc1e0f99b6004fbd3f55f0c7a178ed40bee7d72c3a78969c16289a8d5debb` | Verified |
| `./data/tqqq_daily.csv` | `2010-02-09`..`2026-11-13` | `4,218` | `d770897f3c7df8e0cdd056415e2aea10f83d438939ee77602ad3a295b083fd02` | Verified |
| `./data/soxl_daily.csv` | `2010-03-11`..`2026-11-13` | `4,197` | `f5e664a976c45df1166c7c401fbea807d754f1d5b26300d101ae163a38062cdd` | Verified (`market-close proxy; NAV criterion unverified`) |
| `./data/synthetic_3x_ndx_daily.csv` | `1985-01-31`..`2026-11-13` | `10,528` | `eba83ae40ffb7eea9468ec437e408774bce703bc362a74e32891fade94ccfd73` | Verified (Modelled `3×`; in-sample calibrated fit `c_spread=1.5294%/yr`; `as-retrieved reconstruction; not point-in-time inputs`) |
| `./data/synthetic_3x_semi_daily.csv` | `1994-05-04`..`2026-11-13` | `8,189` | `e53d899276f1eac99493fd15ff419755395f1f29f13d5ca45dec3f1d8a3da139` | Verified (Modelled `3×`; in-sample calibrated fit `c_spread=1.4564%/yr` on `SOXL` `market-close proxy; NAV criterion unverified`; `as-retrieved reconstruction; not point-in-time inputs`) |

---

## 5. Review Disposition & Protocol Relabelling (2026-11-16)

Section 3 above (`## 3. Pre-Registered Validation Tolerance & Comparison Protocol` through immediately before `## 4. File Integrity Registry`) is preserved byte-identical (`5,426` bytes, SHA-256 `1a698b96e84f11070e9ff42c3bbf3c9f0dac5c49729ec0c07022c106456469e8`) per `preregistration_receipt.json`. Following the `2026-11-16` independent review (`review-yardstick-y2-build/REPORT.md`), the following binding disposition and relabelling apply to this batch:

- **Honest Headline (`2026-11-16`):** **“Dataset and model construction verified; full matched-overlap carry calibrated in sample. The zero-spread specification and both chronological holdout checks exceed the pre-registered 0.50 pp/yr tolerance. Independent accuracy within that tolerance is not established. Post-switch SOXL is an explicitly mismatched-index comparison.”**
- **Relabelling of §3.3 Stage 2b (`B1`):** The deterministic fallback in §3.3 (`c_spread = 1.5294%/yr` for `TQQQ` NAV; `1.4564%/yr` for `SOXL` matched `SOX`) solves `R_ann,syn = R_ann,ETF` by bisection on the exact full matched overlap being evaluated. That output is an **in-sample calibrated fit** (`in-sample fitted equality`), **not** an independent validation. Fit tolerance on the fitting window is distinct from chronological holdout validation, which failed (`FAIL`) in both Stage 1 (`c_spread = 0`) and Stage 2a (`TQQQ` `2018–2026` `-1.405 pp/yr`; `SOXL` `2016–2021` `-0.945 pp/yr`).
- **Qualified Parameter Meaning (`B2`):** Both Stage 2b constants are **effective residual carry estimates conditional on the chosen TER, rate series and return basis**, absorbing time-varying dealer spreads, constant backcast of current net TER, the `2018-04-02` `EFFR`->`SOFR` stitch, collateral offsets, and basis differences.
- **Standing Scope Qualifications (`R1`, `R3`):** Every citation of `SOXL` results must retain **`market-close proxy; NAV criterion unverified`**, and every use of pre-TR `Path C` or Stage 2b calibrated series must retain **`as-retrieved reconstruction; not point-in-time inputs`**. See [validation.md](validation.md) §5 for the binding downstream `Y3`/`PILOT` quotation and restrictions.
