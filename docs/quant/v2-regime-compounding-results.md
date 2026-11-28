# V2 Zero-3x Multi-Asset Regime & Compounding Audit (`SMA200` Hysteresis + Half-Kelly + Matched-Cashflow DCA)

- **Status date:** `2026-11-29`
- **Authorization posture:** Research observation only (`live=OFF`, `paper=OFF`, `no_admission=True`, `no_order=True`, `no_capital=True`). Grants no live, paper, order, or capital allocation authority.
- **Related documents:** [pilot-results.md](pilot-results.md) | [breadth-screening-results.md](breadth-screening-results.md) | [experiment-ledger.md](experiment-ledger.md) | [paper-readiness.md](paper-readiness.md)

---

## 1. Strategic Motivation & Legacy Reversals

Following `PREREG-R5` (`L-051`/`L-052`, where `US$1,500` `policy v0 Balanced` with 73% zero-yield cash returned `+2.05%` whole-share / `+3.80%` fractional real growth) and Phase 11 `BREADTH` sensitivity diagnostics (`L-056`), we evaluated whether moving away from `3x`-leveraged `TQQQ`/`SOXL` cores to a **`1x` Core (`QQQ`/`SPY`) + `GLD` + `1x` Dual Momentum + Conditional `2x` (`QLD`) Regime Switch** could simultaneously beat matched-cashflow `SPY`/`QQQ` DCA while capping drawdowns and staying strictly within Half-Kelly geometric compounding limits.

Two legacy or textbook candidates were explicitly evaluated and **REJECTED** on empirical out-of-sample evidence:

1. **Pure `1x` Static Core + Ballast (`GLD`/`DBMF`) without active alpha:** Slashes MaxDD (`-20.1%` to `-23.4%` in `2019–2026`), beats `SPY` DCA (`+2.1%` to `+5.7%`), but structurally trails `QQQ` DCA (`-3.2%` to `-6.4%`) on raw equity accumulation.
2. **Classic Keller `BAA-Agg` (`L-057`, `S1_Keller_BAA_Agg`):** Over `20` real-ETF years (`2006-01-03`–`2026-11-27`, `3x` cost = `15 bps` one-way), `BAA-Agg` achieved `+11.64%` CAGR in `2006–2016` IS, then collapsed to **`+5.93%` CAGR (`-29.70%` MaxDD, `776.9%` annual turnover)** in `2017–2026` OOS, trailing `SPY` DCA by **`-42.5%`** and `QQQ` DCA by **`-53.0%`** on real whole-share `IBKR Pro Tiered` (`$1,500 + $300/month`) DCA.

---

## 2. 20-Year Real-ETF Evaluation (`2007-01-03` – `2026-11-27`) & 10-Year OOS Whole-Share DCA

Evaluated over **5,008 aligned trading sessions** using pre-2007 real ETFs only (`SPY`, `QQQ`, `QLD`, `XLK`, `GLD`, `IEF`, `SHY`; `100%` actual market data, zero synthetic ETF splicing) at **`3x` conservative turnover cost (`15 bps` one-way / `30 bps` two-way)**, with strictly causal end-of-month execution (`next_day` attribution):

| Portfolio (`3x` cost = `15 bps` one-way) | ~20y CAGR | Sharpe | ~20y MaxDD | `2008 GFC` DD | `2020 COVID` DD | `2022 RateHike` DD | `2017–2026` OOS CAGR / DD | 10y OOS Real DCA End (`$36,900` in, Tiered Fee) | vs `SPY` DCA | vs `QQQ` DCA |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `B1_SPY_Hold` (`100% SPY`) | `+10.57%` | `0.611` | `-55.19%` | `-55.2%` | `-33.7%` | `-24.5%` | `+14.36%` / `-33.72%` | `$79,142` (`2.14x`, `$32.20`) | Benchmark | `-18.2%` |
| `B2_QQQ_Hold` (`100% QQQ`) | `+15.52%` | `0.758` | `-53.40%` | `-53.4%` | `-28.6%` | `-34.8%` | `+19.49%` / `-35.12%` | `$96,777` (`2.62x`, `$35.00`) | `+22.3%` | Benchmark |
| `V2_1x_Static` (`45% QQQ + 20% GLD + 35% DualMom`) | `+12.98%` | `0.863` | `-30.58%` | `-30.6%` | `-24.7%` | `-25.9%` | `+15.96%` / `-26.26%` | `$83,093` (`2.25x`, `$168.93`) | `+5.0%` | `-14.1%` |
| `Mod125_Static` (`25% QLD + 20% QQQ + 20% GLD + 35% DM`) | `+15.58%` | `0.811` | `-42.94%` | `-42.9%` | `-31.3%` | `-34.3%` | `+19.21%` / `-34.69%` | `$96,844` (`2.62x`, `$232.13`) | `+22.4%` | `+0.1%` |
| `Mod135_Static` (`35% QLD + 10% QQQ + 20% GLD + 35% DM`) | `+16.55%` | `0.795` | `-47.39%` | `-47.4%` | `-33.9%` | `-37.5%` | `+20.45%` / `-37.92%` | `$102,454` (`2.78x`, `$228.88`) | `+29.5%` | `+5.9%` |
| **`Regime_SPYSMA200_Mod135`** (`SPY SMA200 ±2%` -> `SHY`) | **`+15.73%`** | **`0.876`** | **`-29.36%`** | **`-21.0%`** | **`-23.0%`** | `-28.8%` | `+18.75%` / `-29.36%` | `$94,320` (`2.56x`, `$235.74`) | `+19.2%` | `-2.5%` |
| `Regime_VolCap22_Mod135` (`63d` realized vol cap `22%`) | `+15.81%` | `0.794` | `-38.91%` | `-38.9%` | `-33.9%` | `-36.7%` | `+18.54%` / `-37.22%` | `$92,465` (`2.51x`, `$232.50`) | `+16.8%` | `-4.5%` |
| `Regime_Combo_Mod135` (`SPY SMA200` + `VolCap` stacked) | `+14.53%` | `0.829` | `-29.36%` | `-21.0%` | `-23.0%` | `-28.8%` | `+17.03%` / `-29.36%` | `$84,796` (`2.30x`, `$231.34`) | `+7.1%` | `-12.4%` |

- **Key empirical finding (`Regime_VolCap` / `Regime_Combo` vs single `SMA200 ±2%` hysteresis):** Pure volatility scaling and stacked `SMA+Vol` filters underperformed out-of-sample (consistent with Cederburg et al. 2020, *Journal of Financial Economics*): elevated post-crash volatility delayed equity re-entry during recoveries, costing `-$9,524` on 10y DCA (`$84,796` vs `$94,320`) without reducing MaxDD below `-29.36%`.

---

## 3. 27-Year Dot-Com Peak Stress Test (`2000-03-24` – `2026-11-27`)

Evaluated across **6,710 aligned sessions** starting on the exact NASDAQ Dot-Com peak (`3x` cost = `15 bps` one-way). **Explicit pre-ETF data splicing disclosure:** `SHY`/`IEF` prior to `2002-07-30` use `^IRX` T-bill daily yield; `GLD` uses `GC=F` gold futures from `2000-08-31`–`2004-11-18` (and `CASH` prior to `2000-08-31`); `QLD` prior to `2006-06-22` uses synthetic `2 * r_QQQ - (0.0095 + r_IRX)/252`.

| Portfolio (from `2000-03-24` Peak) | 27y CAGR | Sharpe | 27y MaxDD | `2000` Recovery | `DotCom 00–02` Return (DD) | `Lost Decade 00–09` | `2008 GFC` DD | `2022` DD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `B1_SPY_Hold` | `+7.92%` | `0.493` | `-55.19%` | `6.6 yr` | `-47.5%` (`-47.5%`) | `-13.8%` | `-55.2%` | `-24.5%` |
| `B2_QQQ_Hold` | `+7.38%` | `0.402` | `-82.96%` | `14.9 yr` | `-82.9%` (`-83.0%`) | `-60.0%` | `-53.4%` | `-34.8%` |
| `V2_1x_Static` | `+8.86%` | `0.595` | `-55.02%` | `7.5 yr` | `-54.9%` (`-55.0%`) | `+10.9%` | `-30.6%` | `-25.9%` |
| `Mod135_Static` | `+9.27%` | `0.482` | `-78.24%` | `12.0 yr` | `-78.2%` (`-78.2%`) | `-38.0%` | `-47.4%` | `-37.5%` |
| `Regime_SPYSMA200_Mod135` (`SPY` gate) | **`+11.35%`** | **`0.651`** | `-49.90%` | `6.8 yr` | `-48.5%` (`-49.9%`) | `+44.0%` | **`-21.0%`** | `-28.8%` |
| **`Regime_QQQSMA200_Mod135` (`QQQ` own gate)** | `+10.75%` | `0.615` | **`-39.64%`** | **`3.6 yr`** | **`-34.7%` (`-39.6%`)** | **`+58.6%`** | `-26.4%` | **`-24.0%`** |

- Gating `QLD` on its **own underlying (`QQQ` `SMA200 ±2%`)** per Gayed & Bilello (2016) cut Dot-Com MaxDD by `10.3` percentage points vs `SPY` gating (`-39.64%` vs `-49.90%`, and `-82.96%` for unhedged `QQQ`), cut `2000` peak recovery time to **`3.6` years** (vs `14.9` years for `QQQ`), and delivered **`+58.6%`** across the `2000–2009` Lost Decade.

---

## 4. 12-Cell Parameter Plateau & `QuantPlatformKit` PBO / DSR Audit (`L-058`)

Tested `SMA ∈ {150, 175, 200, 225}` × `hysteresis ∈ {1%, 2%, 3%}` (`12` cells, `K_trials` `115 -> 127`) on `Regime_QQQSMA_Mod135` (`3x` cost = `15 bps` one-way):

- **27y (`2000–2026`) plateau spread:** CAGR `+9.46%` to `+11.04%` (`median = +10.71%`, `std = 0.44%`); all `6` cells with `SMA ∈ {200, 225}` recorded identical `-39.64%` MaxDD (`100%` of cells beat both `SPY` `+7.92%` and `QQQ` `+7.38%`).
- **20y real-ETF (`2007–2026`) plateau spread:** CAGR `+13.88%` to `+15.55%` (`median = +14.57%`, `std = 0.48%`); all `12` cells shared `-33.91%` MaxDD (driven by the 3-week Feb–Mar `2020` COVID crash prior to month-end signals).
- **10y OOS (`2017–2026`) plateau spread:** CAGR `+16.95%` to `+19.72%` (`median = +18.25%`, `std = 0.75%`); MaxDD `-33.91%`.
- **Official `QuantPlatformKit` gates (`K_family = 12`):**
  - `20y` real-ETF (`2007–2026`): **CSCV `PBO = 0.0667`**, **`DSR = 0.9992`** (`COMPUTED`).
  - `27y` (`2000–2026`): **CSCV `PBO = 0.7832`**, **`DSR = 0.9985`** (`COMPUTED`). The high `27y` CSCV `PBO` reflects regime-rank inversion across very tight performance spread (`0.44%` std): slower `SMA200–225` dominated `2000–2013` dot-com/GFC recoveries while faster `SMA150` dominated `2014–2026`, confirming `SMA200 ±2%` should **not** be shortened to chase `2014–2026` returns.

---

## 5. Geometric Compounding, Empirical Half-Kelly & 2,000-Path Block-Bootstrap

- **Variance Drain & Half-Kelly Audit (`27y` / `20y`, `3x` cost):**
  - Unhedged `B2_QQQ_Hold` suffered `3.49%/yr` volatility drag (`σ = 26.40%` over `27y`, Empirical Full-Kelly `1.20x`, **Half-Kelly `0.60x`** — holding `1.0x` sits above Half-Kelly).
  - Unhedged `Mod135_Static` suffered `3.07%/yr` drag (Empirical Half-Kelly **`0.79x`** — above safe Half-Kelly).
  - **`Regime_QQQSMA200_Mod135` & `Regime_SPYSMA200_Mod135`** compressed `27y` annualized volatility down to `19.79%` / `19.40%` (`1.96%` / `1.88%` drag, comparable to `1x SPY` `19.18%`), raising Empirical Half-Kelly to **`1.24x` / `1.36x`** over `27y` (`1.60x` / `1.98x` over `20y` real-ETF). Running at **`1.0x`** keeps exposure strictly inside the Half-Kelly compounding safety zone.
- **2,000-Path 10-Year Block-Bootstrap (`block = 21d`, `seed = 20261129`, sampled across `27y` history):**
  - `B1_SPY_Hold`: Median 10y CAGR `+8.31%`, 5th-pct worst `-1.13%`, Median MaxDD `-34.66%`, 95th-pct worst DD `-55.06%`.
  - `B2_QQQ_Hold`: Median 10y CAGR `+8.25%`, 5th-pct worst `-4.25%`, Median MaxDD `-47.09%`, 95th-pct worst DD `-70.50%`, `P(beat SPY 10y) = 49.9%`.
  - `Regime_QQQSMA200_Mod135`: Median 10y CAGR `+11.57%`, **5th-pct worst `+1.87%`**, Median MaxDD `-32.21%`, 95th-pct worst DD `-50.55%`, `P(beat SPY 10y) = 77.0%`.
  - `Regime_SPYSMA200_Mod135`: Median 10y CAGR `+12.26%`, **5th-pct worst `+2.31%`**, Median MaxDD `-31.19%`, 95th-pct worst DD `-49.63%`, `P(beat SPY 10y) = 80.3%`.

---

## 6. Explicit Limitations & Non-Admission Posture

1. **Universe Selection & Data-Snooping Caveat:** Focusing core/ballast exposures on US mega-cap tech (`QQQ`/`QLD`) + gold (`GLD`) reflects ex-post multi-decade asset-class leadership; cumulative ledger count now stands at **`K_trials = 127`**, so cumulative DSR admission over all `127` historical trials remains unverified pending pre-registered OOS tracking.
2. **Flash-Crash & Century-Bubble Boundaries:** Monthly `SMA200` does not exit fast enough inside 3-week shocks (`2020` COVID `-33.91%`), and an immediate Dot-Com peak entry still exhibits `-39.64%` (`QQQ` gate) / `-49.90%` (`SPY` gate) peak-to-trough drawdown.
3. **Single-Stock Alpha (Pillar 3) Excluded Here:** Deliberately omitted until survivorship-bias-free Point-in-Time equity history (including delisted securities) or real-time `SHADOW`/`PAPER` forward evidence is accumulated.
