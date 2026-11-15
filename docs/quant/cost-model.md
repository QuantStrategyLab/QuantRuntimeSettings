# Phase 2 YARDSTICK — Vehicle and Execution Cost Model

**Status date:** 2026-11-15
**Phase:** 2 (`YARDSTICK`, batch `Y1`) — documents only. Defining the cost model authorizes no code edits, data reads, deployments, paper orders, or live orders.
**Model owner:** `coordinator` (`Q1-1`, `Q1-2`, `Q2-1`, `Q4-2`, `Q5-3`)
**Sign-off status:** Baseline cost structure for `Y2`/`Y3`. Un-sourced numerical parameters are recorded explicitly as Open Items (`OI-COST-1` through `OI-COST-5`) and are not guessed.
**Related documents:** [definitions-contract.md](definitions-contract.md) | [rebase-register.md](rebase-register.md) | [decisions-rebase.md](decisions-rebase.md) | [sizing-unit.md](sizing-unit.md)

## Authorization state

Standing boundaries from Phase 0 `REBASE` apply identically here:

- Live trading is fully **OFF**.
- Kelly sizing is **research-only** and **computed-not-applied** in the pilot.
- The stop-loss **return rule** is **OFF**.

This document defines every vehicle, financing, collateral, execution, and FX cost line for the single-USD leveraged ETF pilot (`TQQQ`, `SOXL`, `≤ 3`-month USD T-bill collateral; declared bankroll `B_0 = US$50,000`). It reports no synthetic calibration numbers before `Y2`, makes no claims on strategy merit, and includes zero private account balances, broker identifiers, or non-pilot symbols.

---

## 1. Non-Double-Counting Rules (Hard Constraints)

### 1.1 Rule C1 — Daily-Reset Volatility Decay Is Excluded as a Cost Line (`R1`, `P1(d)`)

- For a constant `L = 3` daily-reset ETF (`TQQQ`, `SOXL`), finite-horizon variance drag (`-0.5 × L(L - 1) × σ² = -3 σ²`) is a mathematical consequence of compounding daily percentage moves `r_{syn,i,t} = max(-1.0, 3 × r_{idx,i,t} - carry_{i,t})`.
- **Ban on double subtraction:** Because both real ETF close-to-close returns and daily-compounded synthetic `3×` simulations already incur this compounding path effect every session, **never** subtract `-3 σ²` (or `-4.5 σ²`) a second time as an explicit fee, return drag, Sharpe numerator penalty, or Kelly deduction.
- Variance drag appears solely as an analytical ex-post decomposition or when converting an uncompounded single-period expectation into geometric growth.

### 1.2 Rule C2 — No Double Deduction of Embedded Fund Carry on Real ETFs

- Real post-inception ETF total returns (`TQQQ`, `SOXL`) already deduct sponsor management expense ratios (`TER`), swap financing costs, and fund-level tracking expenses inside market NAV and close-to-close total return (`TOTAL_RETURN_NET_OF_COST`).
- Real-ETF evaluations therefore apply **only** investor-level transaction costs (commissions, regulatory/venue fees, bid-ask spread / market impact) and **credit** unallocated T-bill interest — never re-deduct synthetic `TER` or `2 × r_f + c_spread`.

---

## 2. Cost Applicability Matrix Across Evaluation Regimes

| Evaluation regime | Underlying return input | Embedded vehicle carry (`TER + 2 r_f + c_spread`) | Account-level execution (`C_comm + C_slip`) | Unallocated cash T-bill yield | Explicit margin borrowing |
| --- | --- | --- | --- | --- | --- |
| **Synthetic `3×` series (`SUPPLY-A` / pre-2010 `Q1-1`)** | Underlying total-return index (`r_{idx,i,t}`) | **Deduct explicitly daily** (`Δτ_t = days/365`) | **Deduct** on every fill/rebalance | **Credit** on `(1 - ∑ w_{i,t}) E_t` | `$0` (prohibited) |
| **Real ETF replay (`PILOT` / `REPLAY`)** | Real ETF total return (`TOTAL_RETURN_NET_OF_COST`) | Already embedded inside ETF return (**do not re-deduct**) | **Deduct** on every fill/rebalance | **Credit** on `(1 - ∑ w_{i,t}) E_t` | `$0` (prohibited) |
| **Paper / Live ledger (`PAPER`, future `LIVE-GATE`)** | Broker valuation & real fills | Already embedded inside ETF fills | **Realized broker commission + implementation shortfall** (`unknown` if broker omits fee) | **Realized T-bill / bill-fund yield** only | `$0` (cash-only; reject margin) |

---

## 3. Vehicle-Level Costs: Sponsor `TER` and `2×` Swap Financing (`Q1-1`)

### 3.1 Canonical Synthetic Daily Return Formula

- **Underlying index requirement:** Both synthetic and benchmark series must consume **total-return** (dividend-, split-, and distribution-reinvested) underlying series (`NDX` total return for `TQQQ`; underlying semiconductor sector total return for `SOXL`), matching [../market-benchmark-revision-policy.md](../market-benchmark-revision-policy.md) and [../qsl-long-horizon-risk-observation-v2.zh-CN.md](../qsl-long-horizon-risk-observation-v2.zh-CN.md). Split-adjusted price return is prohibited.
- **Daily synthetic ETF total return:**
  `r_{syn,i,t} = max(-1.0,  3 × r_{idx,i,t} - (2 × r_{f,t} + c_{spread,i,t} + TER_i) × Δτ_t)`
  where:
  - `r_{idx,i,t}` is session `t` total return of index `i`;
  - `Δτ_t = calendar_days(t - 1, t) / 365` captures weekend and holiday financing accrual over closed calendar intervals;
  - `2 × r_{f,t}` charges overnight USD risk-free funding across the `2×` unfunded notional exposure (`3×` total target minus `1×` fund equity);
  - `c_{spread,i,t}` is the net dealer swap/repo financing spread (calibrated net of any collateral interest offset inside actual fund swaps);
  - `TER_i` is the statutory net prospectus expense ratio of ETF `i` (`1/yr`).
- **Bankruptcy floor:** Clamped at `-100%` (`-1.0`); `r_{syn,i,t} ≤ -1.0` triggers absorbing termination (`g_t = -∞`).

### 3.2 Calibration Tolerance and Breakers (`Q1-1`, `V1`, `V5`, `V6`)

- Pre-inception synthetic series enter research only after Batch `Y2` verifies `TER_i`, fetches `r_{f,t}`, fits/documents `c_{spread,i,t}`, and confirms annualized carry tracking error against post-inception real ETF NAV stays **`≤ 0.5 pp/yr` (`50 bps/yr`)**.
- Once active, breakers `V1`, `V5`, and `V6` monitor synthetic-to-ETF basis `δ_{i,t}` and rolling 60-session cumulative basis `δ_{60,i,t}` defined in [definitions-contract.md](definitions-contract.md) §5.3.

### 3.3 Current Sourcing Status (`OI-COST-1`, `OI-COST-2`)

- **Un-sourced statutory `TER` and spreads (`OI-COST-1`):** `PART-C.md` (`[W-PRO]`) examined only a `2×` sibling summary prospectus; authoritative `TQQQ` and `SOXL` current prospectus expense ratios (`TER_TQQQ`, `TER_SOXL`) and net swap financing spreads (`c_spread`) are **not yet verified** in repository documents and are left blank pending Batch `Y2`.
- **Un-sourced risk-free rate history (`OI-COST-2`):** The stitched historical overnight funding rate series `r_{f,t}` (pre-SOFR and pre-2010 regimes) and `T-bill` collateral net rate series are **not yet fetched**; Batch `Y2` / `SUPPLY-A` resolves data acquisition and stitching rules.

---

## 4. Collateral Yield and Account Margin (`Line 7`, `Line 8`)

- **Unallocated capital (`Line 7`):** Capital not deployed in `TQQQ` or `SOXL`, namely `w_{cash,t} × E_t = (1 - ∑_i w_{i,t}) × E_t`, is held exclusively in **Treasury bills `≤ 3` months or a T-bill fund** with zero credit or duration risk.
- **Collateral yield credit:** Net daily interest `(r_{tbill,t} - TER_{tbill}) × Δτ_t` is credited to unallocated cash (never credited to committed external reserve `H` inside portfolio return `r_t`, because `r_t` measures returns on sizing-unit equity `E_t`, while `H` serves strictly as drawdown denominator/reserve).
- **Account margin, short selling, and options (`Line 8`):** **`never`**. Portfolio execution enforces `cash_only_execution` (`tests/test_cash_financing.js`): `$0` margin borrowing cost exists because leveraged ETF exposure is bounded strictly inside `∑_i w_{i,t} ≤ min(w_max, 1.00)`. Any order creating negative settled cash fails closed.

---

## 5. Explicit Execution Costs: Commissions, Fees, Spread, and Slippage (`Q1-2`, `Q2-1`, `Q4-2`, `Line 6`)

### 5.1 Brokerage Commissions and Pass-Through Venue/Regulatory Fees (`C_comm`)

- **Structure:** For share trade `Δq_{i,t} = q_{i,t}^post - q_{i,t}^pre` executed at price `P_{i,t}^fill`:
  `C_{comm,i,t} = I_{|Δq| > 0} × max(c_{min}, c_{per\_share} × |Δq_{i,t}|) + C_{reg}(Δq_{i,t}, P_{i,t}^fill)`
  where `c_{min}` is minimum ticket fee, `c_{per\_share}` is per-share commission rate, and `C_{reg}` captures statutory pass-through fees (SEC Section 31 / TAF / clearing fees, non-zero on sells where applicable).
- **Minimum effective balance check (`B_min`, `Line 6` / `B5`):** Tracks the equity threshold below which `C_{comm,i,t}` plus integer-share rounding distortion eats `≥ 10%` of target position cost on a rebalance. Exact USD floor awaits broker commission schedule verification (`OI-COST-3`).
- **Broker omission rule ([../unified-daily-notification.md](../unified-daily-notification.md)):** In `PAPER` and real ledgers, *"Commission and price remain unknown when the broker has not supplied them."* Missing commission fields must stay `unknown` rather than defaulting to `0`.
- **Sourcing gap (`OI-COST-3`):** [decisions-rebase.md](decisions-rebase.md) confirms **Longbridge** as the `PAPER` venue, while the **live sleeve broker remains unnamed** (`PART-C.md` §4.6). Neither Longbridge US ETF fee schedules / paper fee-simulation rules nor live broker schedules are verified in current documents (`OI-COST-3`).

### 5.2 Bid-Ask Spread and Market-Impact Slippage (`C_slip`, `V7`)

- **Session timing discipline:** Rebalance fills are evaluated on regular `XNYS` auction/next-session execution (`market-on-close` or next regular open per `SUPPLY-A`/`FUSE` specification), banning zero-spread synthetic fills and thin outside-hours prints.
- **One-way execution friction model:**
  `C_{slip,i,t} = (s_{half,i,t} + κ_{impact,i} × |ΔV_{i,t}|) × |ΔV_{i,t}|`
  where `ΔV_{i,t} = Δq_{i,t} × P_{i,t}^ref`, `s_{half,i,t}` is one-way effective half-spread (`bps`), and `κ_{impact,i}` measures quadratic size impact (expected near zero at `B_0 = US$50,000` scale in normal `TQQQ`/`SOXL` liquidity, subject to verification).
- **Existing research scenario grid (context only):** [../qsl-p0-p6-current-state-and-driver-policy.zh-CN.md](../qsl-p0-p6-current-state-and-driver-policy.zh-CN.md) (lines 57, 134, 187–188) and SOXL offline `P3` tests evaluate a **`5 / 10 / 15 bps`** cost sensitivity grid. Canonical base half-spread assumptions for `TQQQ` vs `SOXL`, stress-regime multipliers, and the `V7` abnormal-spread collar threshold are not yet calibrated (**`OI-COST-4`**).
- **Portfolio daily cost drag integration:**
  `r_t = r_t^gross - (∑_i (C_{comm,i,t} + C_{slip,i,t})) / E_{t-1}`
  Combined with `r_{tbill,t}` interest on unallocated cash (and vehicle carry subtracted inside `r_{syn,i,t}` when synthetic), ensuring full consistency between `definitions-contract.md` net `r_t` and portfolio accounting.

---

## 6. Currency (`FX`) and Tax / Domicile Assumptions (`PART-A.md` §1.6)

- **Pilot sizing-unit FX cost (`c_FX`):** **`0 / N/A`**. Because `B_0 = US$50,000`, `TQQQ`, `SOXL`, and USD T-bill collateral are all USD-denominated, zero FX conversion occurs inside the single-USD sizing unit.
- **Mixed-currency and indicative-rate prohibition:** Consistent with [../console-api.md](../console-api.md), never invent FX rates (`no invented FX`), never treat `/api/overview-fx` (which is indicative-only) as settlement pricing, and disallow cross-currency valuation mixing without point-in-time executed FX rates.
- **Deferred scope (`OI-COST-5`):** Real currency-conversion costs (if future capital is funded in non-USD currencies) and dividend withholding / domicile tax rates (`PART-A.md` §1.6) are intentionally excluded from this pre-live research cost model; zero assumed tax rate is fabricated here. Both must be settled in owner tax/domicile review prior to `LIVE-GATE` (`decisions-rebase.md`).

---

## 7. Open Items Register (`OI-COST-1` to `OI-COST-5`)

| ID | Un-sourced Cost Parameter | Current Gap in Source Docs | Impacted Quantity / Rule | Settling Gate / Batch |
| --- | --- | --- | --- | --- |
| `OI-COST-1` | Statutory `TER_TQQQ`, `TER_SOXL`, net swap spreads `c_{spread,i,t}` | `[W-PRO]` inspected only a `2×` sibling prospectus | `r_{syn,i,t}`, `Q1-1` `0.5 pp/yr` check, `c_carry` | Phase 2 Batch `Y2` (`Q1-1` prospectus check) |
| `OI-COST-2` | Historical `r_{f,t}` funding & net T-bill rate `r_{tbill,t}` series | Pre-2010 rate stitching and bill-fund fee not yet fetched | `r_{syn,i,t}`, collateral yield `Line 7`, `SR_ann` excess return | Phase 2 Batch `Y2` + `SUPPLY-A` |
| `OI-COST-3` | Longbridge paper fee rules & unnamed live broker `c_min`, `c_{per\_share}`, `C_{reg}` | Longbridge schedules/paper fee mode unverified; live venue unnamed | `C_{comm,i,t}`, `B_min` (`< 10%` floor, `B5`) | Name live venue before `SUPPLY-B`; verify paper schedule before `PAPER` (`Q4-2`) |
| `OI-COST-4` | Canonical per-ETF `s_{half,i}`, impact `κ_i`, stress spread & `V7` collar | SOXL `P3` only defines `5/10/15 bps` test grid; `TQQQ` & `V7` unpinned | `C_{slip,i,t}`, `Q2-1`, `V7` breaker threshold | Batch `Y2` (`Y3` pre-registration) + `FUSE` batch 1 |
| `OI-COST-5` | Non-USD funding FX spreads & domicile/withholding tax | Excluded cleanly from single-USD pilot scope | Real post-tax / multi-currency net performance | Owner tax/domicile review before `LIVE-GATE` |
