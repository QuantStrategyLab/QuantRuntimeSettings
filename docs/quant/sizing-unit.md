# Phase 0 REBASE — Pilot Sizing Unit and Tier Starting Values

**Status date:** 2026-11-27 (amended from 2026-11-15 via `PREREG-R4`)
**Phase:** 0 (`REBASE`) — documents only. Specifying the sizing unit and starting tier constants authorizes no code edits, data reads, deployments, paper orders, or live orders.
**Related documents:** [rebase-register.md](rebase-register.md) | [decisions-rebase.md](decisions-rebase.md)

## Authorization state

The premise corrections R1–R3, the rebuilt register ([rebase-register.md](rebase-register.md)), the tier constants of §4.3 as starting values, the stop-loss split, the plugin rule, and the redefinitions of "unattended" and "institutional-grade" were endorsed by the coordinator on 2026-11-15 under the owner's standing delegation (owner: "if there are no problems, advance automatically").

Standing boundaries are unchanged:

- Live trading is fully **OFF**.
- Kelly sizing is **research-only** and **computed-not-applied** in the pilot.
- The stop-loss **return rule** is **OFF**.

---

## Pilot sizing unit and notional bankroll (`B₀`)

- **Sizing unit:** One single-account **US-dollar (`USD`)** unit (single currency; the pilot does not wait for multi-account `IDENTITY` migration).
- **Notional pilot bankroll:** **`B₀ = US$50,000`**, declared on **2026-11-15** by the coordinator under the owner's standing delegation (owner's words: *"you decide, following Fable's and your recommendation"*):
  - **Notional only:** No funds move, and no paper or live trading authority is granted.
  - **Scale rationale:** Set at the design's `$50,000` scale anchor so that all three tiers' starting positions are whole-share tradeable with non-dominant fixed trading costs.
  - **Scope of use:** Used identically across all three tiers in target T1 (`SHADOW` stage N and `PILOT`), with `PREREG-R4` adding a side-by-side minimum-account viability check at **`US$1,500`** comparing whole shares vs fractional shares execution. In target T2 (`PAPER`), **IBKR** paper is selected (amended from Longbridge by `PREREG-R4` so `PAPER` and `LIVE-GATE` share the same broker venue). The live sleeve account must be named before `SUPPLY-B` is scheduled; this does not block T1.

---

## Account snapshot (declared context only)

As declared by the owner on 2026-11-15 (`14:36` and `14:38` SGT; broker-side read-back is **not verified** in REBASE):

- **System accounts:** All system accounts are flat: there are no legacy TQQQ/SOXL positions, and the pilot starts from zero.
- **Outside accounts and positions:** The owner also holds accounts and positions outside the system boundary. Their details are kept in the coordinator's private record and are deliberately not reproduced in tracked documents.

**Explicit isolation rule:** Outside holdings are declared context only. **The system does not read, size against, hedge, net, or trade them, and they do not count as external capital `H`.** Equity-correlated or volatile outside assets are not safe collateral in a Nasdaq drawdown. Consequently, "controlled drawdown" applies strictly to the US-dollar sizing unit and says nothing about total household wealth.

---

## Sizing definitions and stack (`PART-C.md` §4.2)

### Variables and exposure unit

- **Exposure unit `x`:** Index-equivalent dollars of underlying exposure per dollar of bankroll (`x = 3w` on the Nasdaq-100 for a TQQQ weight `w`).
- **`E`:** Current equity of the US-dollar sizing unit.
- **`E*`:** High-water mark of sizing-unit equity **including** deposits/flows.
- **`H`:** Owner-declared external at-risk capital (`H = 0` by default; *proposal*: capped at `3 × E*` in the pilot, declared with its basis, reviewed annually, and restricted to capital that does not fall when the Nasdaq falls). Changed only by an owner card with a 30-day cooling-off period; never loosened while drawdown reaches or exceeds `D/3`.
- **`W = E + H`:** Current bankroll.
- **`W* = E* + H`** (written **`B = E* + H`** in §3.2 Q2): Bankroll high-water mark.
- **`L`:** Flow-adjusted and split-adjusted dollar loss from the high-water mark.
- **`D`:** Tier long-run loss budget (dollar budget `D × W*`; account-level budget share `min(100%, D × (1 + H / E*))`, flat at `D` when `H = 0`).
- **Cushion `c`:** Unspent loss budget as a share of current bankroll:

```text
c = (D * W* - L) / (W* - L)   for L < D * W*
c = 0                         once L >= D * W*
```

### The ten-step sizing stack

Each step may only lower the exposure permitted by the step before it (`PART-C.md` §4.2):

| Step | Quantity | Rule | Register row, class | Policy v0 state |
| --- | --- | --- | --- | --- |
| 1 | Strategy target `s` (`0` to `1`, per fund) | Output of the frozen baseline strategy body, with its internal trend and volatility rules (`1` = take full exposure permitted below) | Baseline (`YARDSTICK`) | Applied |
| 2 | Hard cap `x_cap` | Tier constant (line 2); depends on no estimate | `Q5-1(a)`, `C` | Applied |
| 3 | Maximum-loss cap `x_ML(c)` | Smallest of bounds `(a)`, `(b)`, `(c)` below, recomputed every session from cushion `c` | `Q2-2(a)`, `C`; `Q3-2`, `M` | Applied |
| 4 | Kelly ceiling `x_K` | Tier fraction × shrunk excess return ÷ variance on the underlying index (structural and conditional figures) | `Q2-3`, `S` | **Recorded, not applied** |
| 5 | Volatility scalar `v` (`≤ 1`) | `min(1, reference volatility ÷ forecast volatility)`; missing data fails closed | `Q2-4`, `K` | Applied only if adopted at class-K bar in `PILOT`; otherwise recorded |
| 6 | Fund exposure | `s × min(x_cap, x_ML) × v` | `—` | Derived |
| 7 | Joint cap | Beta-adjusted sum over TQQQ and SOXL must not exceed tier joint cap; if exceeded, both scale down in proportion | `Q3-1(a)`, `C` | Applied |
| 8 | Translation to account | Account fund weight `w = x × W ÷ (3 × E)`, capped at tier maximum combined fund weight (line 12) and never above `100%`; no margin | `Q2-7`, `P` | Applied |
| 9 | Order conversion | No-trade band, whole shares, fee check; reductions from steps 2, 3, 7, or breakers are never delayed by the band | `Q2-6`, `P/M`; `Q2-1`, `M` | Applied |
| 10 | Control layer | Independent pre-trade checks (`NO-NEW-RISK`, `DE-RISK`, `HALT`, `ORDER-UNKNOWN`) | `Q5-1`, `C` | Shadow: `"would have"` states; Paper: armed by separate card |

### Step 3 bounds and Step 4 Kelly record

- **Step 3(a) Absolute bound:** `x ≤ 3c` (combined fund weight `≤ c`; rests solely on the absence of margin).
- **Step 3(b) One-day gap bound *(proposal)*:** `x ≤ 2c` (a 25% one-session index fall consumes at most half of `c`; set above the 20% S&P 500 Level 3 trading halt because Nasdaq-100 can fall further on the same day).
- **Step 3(c) Scenario bound `x ≤ M(c)`:** Largest exposure holding policy loss inside `c` across the pre-registered stress set (*proposal*: synthetic 3× history through 2000–02, 2008, February–March 2020, and 2022; one-day gap; and 97.5% expected shortfall of 250-session block-bootstrap bankroll losses re-centred on shrunk mean, `Q3-2`). Multi-day maximum loss is an estimate for a stated policy on a stated scenario set, not a path-independent guarantee (`PART-C.md` §3.2 `Q1`). Before `PILOT`, `M` takes the first-order constant-index-exposure approximation (`PART-C.md` §3.2 `Q1`, `1 − (1 − d)^x`, carried forward in `PART-C.md` §4.2 as a position held without any de-risking through the worst `2000–02`-class `−83%` index fall scenario): `M₀(c) = ln(1 − c) ÷ ln(1 − 0.83)` (`0.09`, `0.20`, and `0.39` at full cushion for budgets of `15%`, `30%`, and `50%`). `PILOT` replaces `M₀` with `M` simulated for the policy on the long synthetic history (with next-session execution, costs, and only de-risking rules adopted at the class-`K` bar), and `M` can never exceed bounds (a) or (b).

*Balanced-tier cushion example (`D = 30%`, `H = 0`, `M₀`, illustrative):*

| Drawdown from high-water mark | `0%` | `10%` | `20%` | `25%` |
| --- | --- | --- | --- | --- |
| Cushion `c` | `30.0%` | `22.2%` | `12.5%` | `6.7%` |
| Maximum-loss cap `x_ML(c)` (index-equivalent) | `0.20` | `0.14` | `0.08` | `0.04` |

- **Step 4 recorded Kelly figures:** Every shadow and paper record logs both (1) **structural** `x_K = k × μ ÷ σ²` (using posterior mean minus one posterior standard deviation from a pre-registered broad-equity prior; a one-standard-error haircut gives illustrative `μ ≈ 5.25%` and ceilings `0.11`, `0.23`, `0.46`), (2) **conditional** `structural × min(1, (long-run volatility ÷ forecast volatility)²)`, and (3) whether the ceiling would have bound and its implied exposure.

---

## The three tiers and §4.3 constants

> **Status notice:** Except for the already-declared pilot notional bankroll `B₀ = US$50,000` in line 9 (decided on 2026-11-15; not reopened by tier calibration), every numeric tier constant in the table below is a **proposal — starting value, to be measured at PILOT** (`PART-C.md` §4.3), including the `3 × E*` cap on `H`. Tier constants are calibrated once against pre-registered tables in `PILOT` and frozen only by an owner decision. Percentages are shares of the bankroll unless noted.

| Line | Constant | Conservative (`CAPITAL_PRESERVATION`) | Balanced (`BALANCED_COMPOUNDING`) | Aggressive (`GROWTH_COMPOUNDING`) |
| --- | --- | --- | --- | --- |
| 1 | Kelly fraction `k` (research column only; starting value) | `1/8` | `1/4` | `1/2` |
| 2 | Hard cap on sleeve exposure, × Nasdaq-100 | `0.20` | `0.40` | `0.80` |
| 2a | … equivalent TQQQ-only weight | `6.7%` | `13%` | `27%` |
| 3 | Joint cap, TQQQ + SOXL, beta-adjusted | `0.20` | `0.40` | `0.80` |
| 3a | … SOXL share of joint cap, at most | `one third` | `one third` | `one third` |
| 4 | Loss budget `D`, from flow-adjusted high-water mark (starting value) | `15%` | `30%` | `50%` |
| 4a | … amber, at `D/3`: notify; lock tier, `H`, and `E*` against loosening | drawdown `5%` | drawdown `10%` | drawdown `16.7%` |
| 4b | … red, at `2D/3`: `NO-NEW-RISK`, latched | drawdown `10%` | drawdown `20%` | drawdown `33.3%` |
| 4c | … exhausted, at `D`: sleeve to zero (`DE-RISK`), latched (30-day cooling-off owner card) | drawdown `15%` | drawdown `30%` | drawdown `50%` |
| 5 | One-session loss that halts new risk (`D/10`) | `1.5%` | `3%` | `5%` |
| 6 | No-trade band; annual one-way turnover budget | `20% of target weight; 50%` | `20%; 100%` | `20%; 200%` |
| 7 | Unallocated capital | Treasury bills ≤ 3 months, or a bill fund; no credit or duration risk | same | same |
| 8 | Margin, short positions, options | `never` | `never` | `never` |
| 9 | Bankroll | One USD sizing unit; `H = 0` default, ≤ `3 × E*` (*proposal*); declared `B₀ = US$50,000` in pilot (decided, not a proposal) | same | same |
| 10 | Maximum-loss cap at full cushion, pre-PILOT (`M₀`) | `0.09` | `0.20` | `0.39` |
| 10a | … equivalent TQQQ-only weight | `3%` | `6.7%` | `13%` |
| 11 | Kelly ceiling, illustrative, recorded only | `0.11` | `0.23` | `0.46` |
| 12 | Maximum combined fund weight in account (binds only when `H > 0`) | `15%` | `35%` | `60%` |
| 13 | Volatility target for Step 5 scalar, annualized (`line 2 × 24%` illustrative index vol) | `5%` | `10%` | `19%` |
| 14 | Maximum class-K growth cost, as share of baseline net log growth | `20%` | `15%` | `10%` |
| 15 | Accepted latched trips per year, on average | `1` | `2` | `3` |

### Tier notes and reconciliation with legacy design drafts

- **Idealized growth share:** At the `~10%` one-in-ten loss probability pairing (`Q1`), the Kelly fractions `1/8`, `1/4`, and `1/2` correspond to keeping `23%`, `44%`, and `75%` (`k(2 − k)`) of idealized maximum excess growth (`PART-C.md` §3.2).
- **SOXL joint cap:** SOXL's exposure converts to Nasdaq-100 terms via `max(measured falling-market beta, 1.5)` (`1.5` is a placeholder based on *general knowledge*; to be measured in `PILOT`), capping SOXL at roughly `1.5%`, `3%`, and `6%` of the bankroll across the three tiers before `PILOT`.
- **Replacements endorsed on 2026-11-15:**
  1. Absolute loss budget `D` (line 4) binds; legacy risk Composer relative drawdown ceilings (`1.00×`, `1.25×`, `1.50×` benchmark) are reported beside it rather than binding (`PART-C.md` §4.3).
  2. Lines `4a`–`4c` and `5` replace the draft equity-scaled brake levels (`12–15%` under `$50,000` tightening to `5%` above `$1,000,000`).
  3. The `B = E* + H` glide path replaces the draft equity-band scaling (`1.00` under `$50,000` to `0.50` above `$1,000,000`), remaining flat at `D` when `H = 0`.
  4. Line 12 removes the draft `"fully allocated to 3× ETFs"` allowance under `$50,000`.
- **Single calibration rule:** Tier constants are chosen once from `PILOT`'s pre-registered tables (in-sample choice, labelled as such); any later adjustment requires a new policy version and restarts the `SHADOW` clock.

---

## Definitions contract (`Register Item 5 / Q1-2, Q4-1`)

- **Assigned owner:** **`coordinator`** (`BRIEF.md`; satisfies the prerequisite owner requirement for item 5).
- **Contract scope (finalized in `YARDSTICK`, verified in `SUPPLY-A`, registered in `SUPPLY-B`):**
  1. **Scorecard (`Q4-1`):** Net log growth, maximum drawdown, and time to recover, reported across all pre-registered tests.
  2. **Return series (`Q1-2`):** Daily-linked time-weighted return (`TWR`) wherever daily valuations and timed cash flows are qualified (or qualified native broker TWR); monthly Modified Dietz (*proposal*) retained strictly as a labelled `approximate` display fallback and **never** fed to sizing, loss breakers, or item verdicts.
  3. **Flow and split separation:** `E*` includes external deposits/flows for bankroll scale (`B = E* + H`), whereas loss `L` and drawdown are measured on a flow-adjusted and split-adjusted series so deposits, withdrawals, and splits never create false drawdowns or loosen risk limits.
  4. **Mathematical conventions:** Consistent units, return periods, annualization factors, gross vs. net of fees/financing/spreads, and variance vs. raw second moment.
  5. **Method version registration:** Register `method_version` in `SUPPLY-B` so the console API no longer reports `method_version: null` *(noted from `PART-B.md` §2.3)*.
