# Phase 0 REBASE — Decision Record (2026-11-15)

**Status date:** 2026-11-15
**Phase:** 0 (`REBASE`) — documents only. This record authorizes no code edits, data reads, deployments, paper orders, or live orders.
**Related documents:** [rebase-register.md](rebase-register.md) | [sizing-unit.md](sizing-unit.md)

## Authorization state

The premise corrections R1–R3, the rebuilt register ([rebase-register.md](rebase-register.md)), the tier constants of §4.3 as starting values ([sizing-unit.md](sizing-unit.md)), the stop-loss split, the plugin rule, and the redefinitions of "unattended" and "institutional-grade" were endorsed by the coordinator on 2026-11-15 under the owner's standing delegation (owner: "if there are no problems, advance automatically").

Standing boundaries are unchanged:

- Live trading is fully **OFF**.
- Kelly sizing is **research-only** and **computed-not-applied** in the pilot.
- The stop-loss **return rule** is **OFF**.

**Adopted system objective:** *"maximum long-run compounding under controlled, robust drawdown"*, evaluated across all tests by net log growth, maximum drawdown, and time to recover (`Q4-1`).

---

## (a) Owner's decided items and direction (2026-11-15)

Recorded by the owner on 2026-11-15 and closed as binding inputs:

1. **Live OFF in full (13:42 SGT).** No real orders anywhere, legacy TQQQ/SOXL strategy bodies included, until the upgrade is complete. Re-enabling live trading belongs to `LIVE-GATE` and requires separate owner sign-off.
2. **Account positions (14:36 and 14:38 SGT).**
   - All system accounts are flat: there are no legacy TQQQ/SOXL positions, and no account holds unmanaged legacy exposure of the quant system.
   - The owner also holds accounts and positions outside the system boundary. Their details are kept in the coordinator's private record and are deliberately not reproduced in tracked documents.
   - Outside holdings are declared context only: the system does not read, size against, hedge, net, or trade them, and they do not count as external capital `H`. *(Recorded from the owner's declaration; broker-side balance read-back is not verified.)*
3. **"Upgrade complete" definition (14:36 SGT).** Measured at completion of the TQQQ/SOXL pilot sleeve: the phases through `PAPER` (closing target T2), together with the `LIVE-GATE` checklist (`PAPER` closed; controls armed and tested with broker-side limits; kill switch and dead-man's switch tested; daily reconciliation running; starting account holdings known; tier chosen from published outcome ranges; owner's tax and domicile position reviewed). Settling this measuring point does not open `LIVE-GATE`, which remains separately owner-approved.
4. **PAPER venue = Longbridge paper (14:40 SGT).** Fixes Longbridge paper as the single broker for `PAPER` (T2). Naming the venue authorizes nothing. Protected prerequisites as recorded on 2026-11-10 — the LongBridge P1 pre-mask environment-printing defect and the PAPER IAM names (current state since 2026-11-10: **not verified**) — remain separately gated. Because the owner's outside live accounts share the same Longbridge application key and secret, PAPER requires: P1 fixed and verified under its own card, a runtime secret scope holding only the paper access token, the SDK paper switch enabled, session-start account whitelist verification (`O5`), and the 90-day legacy token expiry (to be confirmed against Longbridge SDK documentation) tracked in the credential calendar (`#26`). *(Decision still open before `SUPPLY-B` is scheduled: name the live account for the sleeve, because PAPER on Longbridge proves the Longbridge adapter and not IBKR's, while live execution at Longbridge would require a separate account distinct from the owner's outside accounts.)*

Decided direction recorded by the owner on 2026-11-15 (`OWNER-INPUT-C.md`):

5. **Open market scope (decided 2026-11-15 17:09 SGT, clarified 17:26 SGT; `OWNER-INPUT-C.md`, `PART-C.md` §5.3 item 6).** Market expansion is not limited to US equities (`BREADTH` / `HORIZON` direction for the next roadmap refresh): Hong Kong stocks, futures, and gold are examples only, not a whitelist and not a limit. Any market enters through the same yardstick — trustworthy point-in-time data supply, exact cost/fee accounting, and verified market-specific risk plumbing before admission — and this direction does not change the TQQQ/SOXL pilot scope.
6. **Legacy strategy/plugin disposition (decided 2026-11-15 17:47 SGT; `OWNER-INPUT-C.md`, `PART-C.md` §5.3 item 7).** At evaluation time, components worth keeping are kept and continue to be optimized; components with clear evidence of no contribution — after exact cost accounting and a `DSR`/`PBO`-style luck adjustment, never on raw returns alone — are removed from the active system (code path and configuration) without per-item approval. Borderline or ambiguous evidence (including insufficient evidence) is escalated to the owner and never auto-removed. Removal is from the active system only; historical records and data are preserved and never erased. **Timing boundary (`PART-C.md` §5.3 item 7 / `Q6-1`):** legacy evaluation happens after `PILOT` (`Q6-1`) and requires the `YARDSTICK` experiment ledger (`Q4-3`) before the `DSR`/`PBO`-style luck adjustment exists.

Recording these rules authorizes nothing by itself: no removal, research run, new market, or production operation is authorized by this document.

---

## (b) Premise corrections R1–R3 and glide-path mechanics

### R1 — Kelly's role

- **Correction:** The two-outcome formula `f = p − (1 − p) / b` (win rate and payoff ratio) is rejected for sizing 3× daily-reset ETFs. It ignores losses worse than the historical average loss, suffers severe small-sample error on ~40 historical round trips, and assumes discrete independent bets rather than daily-scaled correlated exposure.
- **Illustrative counterexample (`PART-C.md` §3.2, *illustrative and unmeasured*):** For a trend strategy on a 3× fund with a `40%` win rate, average win `45%`, and average loss `12%` (payoff ratio `3.75`), the two-outcome formula gives `f = 0.24` (risk `24%` of bankroll per losing trade). Sized on the `12%` average loss, that implies `0.24 / 0.12 = 200%` of capital in the 3× fund (`6×` the index) — recommending borrowing to hold a 3× fund because the formula has never heard of a loss larger than `12%`, illustrating why a loss-sized two-outcome Kelly fraction must not be mistaken for a fund allocation.
- **Approved rule (`Q2-3`):** Kelly is a **ceiling**, not the sizing engine. Compute the growth-optimal ceiling on the full return distribution of the underlying index over the long synthetic history (`x_K = k × μ / σ²`), with `μ` shrunk by one posterior standard deviation from a pre-registered broad-equity prior, alongside a conditional ceiling scaled by `min(1, (σ_long / σ_forecast)²)`. Every honest tier holds 3× funds as a minority of capital.
- **Pilot status:** Computed and recorded in every shadow and paper ledger entry (alongside a flag showing whether it would have bound); **never applied** to position sizes until a separate Kelly card is signed.
- **Diagnostic:** Win rate and payoff ratio (with a Bayesian interval on win rate) are recorded monthly in the shadow ledger strictly as a review diagnostic; no sizing step reads them.

### R2 — Cash is collateral, not idle

- **Correction:** Unallocated dollars held in Treasury bills of three months or less (or a bill fund with no credit or duration risk) are the collateral and rebalancing buffer that make a 3× position survivable and reduce volatility drag. Deployment is measured in **index-equivalent exposure**, not fund dollars. Volatility drag is already inside the growth variance term and is never subtracted again as a separate cost line.
- **Portfolio consequence:** Adding strategies on the same underlyings (extra SOXL, QQQ option overlays, other technology funds) consumes cash without expanding the loss budget. For two equal-quality sleeves, attainable growth scales with `2 / (1 + ρ)`: about `5%` gain at `ρ = 0.9` (TQQQ/SOXL region, to be measured), `33%` at `ρ = 0.5`, and `100%` at `ρ = 0`. Only sleeves whose losses do not coincide with Nasdaq-100 drawdowns (`BREADTH`) expand deployable capital.

### R3 — Risk at small size and glide-path mechanics

- **Correction:** The Kelly fraction does not depend on bankroll size; beyond full Kelly, extra exposure reduces compounding at every account size. Higher account-level risk at small account size is growth-rational only when the account is part of a larger declared bankroll containing external at-risk capital `H`.
- **Bankroll and loss-budget equations:**
  - `B = E* + H` (also denoted `W* = E* + H`), where `E*` is the high-water mark of sizing-unit equity **including** deposits/flows, and `H` is declared external capital.
  - Default **`H = 0`** (flat budget equal to `D` when `H = 0`). Where non-zero `H` is declared, it must be stated with its basis, capped at `3 × E*` in the pilot (*proposal*), reviewed annually, and restricted to capital whose value does not fall when the Nasdaq falls (equity-correlated or volatile outside holdings do not qualify).
  - Dollar loss budget from the high-water mark: `D × B`.
  - Account-level loss budget share: `min(100%, D × (1 + H / E*))`. *(Illustrative example for `D = 30%`, `H = $50,000`: `100%` at `$20,000`, `60%` at `$50,000`, `45%` at `$100,000`, `36%` at `$250,000`, `31.5%` at `$1,000,000`.)*
- **Binding governance and ratchet rules:**
  1. Keyed strictly to `E*`, never current equity `E`: `E*` is the high-water mark by definition and updates automatically whenever account equity `E` reaches a new high. That ratcheting is mechanical, not a parameter change, so the budget tightens at new highs by itself (when drawdown is zero) and never re-risks after losses or tightens mid-drawdown.
  2. Separate flow series: `E*` includes flows, while loss `L` and drawdown are measured on flow-adjusted and split-adjusted returns (`Q1-2`). Deposits, withdrawals, restarts, and tier changes never clear loss memory, and withdrawals never loosen the budget automatically.
  3. **`H`, the tier, and any reset or re-basing of the recorded high-water mark `E*` (for example after a drawdown) require an owner card with a 30-day cooling-off period** (*proposal* endorsed as governance rule), and **none of these may be loosened while drawdown exceeds one third of the loss budget (`D/3`, amber interlock `L1`)**.
  4. **The system never changes `H`, the tier, or — outside mechanical upward ratcheting at new highs — the recorded high-water mark `E*`:** it never resets or re-bases `E*` itself, and any unrecorded parameter change or high-water reset halts execution (`O9` `HALT` breaker).

---

## (c) Stop-loss split

The legacy `"all stop-loss OFF"` switch is split into two distinct mechanisms:

1. **Stop-loss as a return rule (`15(c)`, class `R`):** Exiting on a price loss and re-entering later stays **OFF**. No price stops are placed on 3× funds, and no test is planned.
2. **Control layer (`Q5-1`, class `C`):** Bankroll loss limits (`L0`–`L6`), vehicle-integrity checks (`V1`–`V7`, `Q5-3`), and data/operational checks (`O1`–`O9`, `J1`) are judged strictly on an **engineering standard**:
   - Independent pre-trade enforcement outside the strategy process, with broker-side limits as a second line.
   - Deterministic verification against a synthetic trip matrix covering normal sessions, deposits, withdrawals, splits, reverse splits, stale/missing data, restarts, tier changes, holidays, and half-days.
   - Fail-closed defaults on every missing input or integrity doubt, with persistent, readable trip state.
   - Separation of self-clearing **interlocks** (external observable conditions such as stale data or market halts) from latched **breakers** (losses or integrity faults) that only a person re-arms.
3. **Arming boundary:** Loss-triggered controls (`L0` and `L2`–`L4`) belong to the standing stop-loss restriction and are **not armed, even in paper, before separate approval** via an explicit control-arming card. Until armed, they exist as specifications, reference code, trip-matrix tests, and `"would have tripped"` columns in the shadow ledger. The unverified 3-platform new-risk gate recorded as deployed on 2026-09-07 is read back in `FUSE` batch 2 and either maps to `L2`/`L4` or is retired.

---

## (d) Plugin rule

- Under the plugin contract (`Q6-1`), plugins are research signals only (`plugin_mode = none` by default; legacy plugins are `legacy_research_only`).
- **Frozen bundle selection:** A tier selects among pre-approved, **frozen strategy-plus-signal bundles**. **No run-time plugin toggling** is permitted by the system or by tier selection.
- **Admission path:** Any plugin candidate enters only after `PILOT` freezes the baseline, starting with a hypothesis card and separately authorized observe-only columns in `SHADOW`, followed by a paired consumption test against the frozen baseline (counting the 21 prior SOXL scenarios in the trial ledger). A consuming rule may only reduce risk or move to a defined defensive asset—never add leverage—and becomes active only as a new frozen policy version with its own forward clock.

---

## (e) Redefinitions of "unattended" and "institutional-grade"

1. **"Unattended" → Attention budget:** *"Changes are attended, operation is not."*
   - **Unattended (for a frozen policy):** side-effect-free observation, deterministic signals and sizing on frozen parameters, automatic interlock/breaker tripping with notifications, exception-only monitoring backed by a dead-man's switch (`O7`/`Q5-4`), and scheduled liquid-ETF execution once `#25` and daily reconciliation exist.
   - **Human-only:** run-time policy changes — parameter updates, `H` or tier changes and any reset or re-basing of `E*` (with 30-day cooling-off), and adopting or retiring an active run-time strategy/policy (distinct from the separately governed, post-`PILOT` evidence-backed evaluation and removal of non-contributing legacy strategies and plugins from the active system in item 6 above) — plus re-arming latched breakers and bounded scheduled credential renewals tracked in the credential calendar (`#26`).
   - **AI boundary:** AI holds no trading authority and cannot alter budgets or limits; no scheduled run depends on an active AI session.

2. **"Institutional-grade" → Six checkable properties:**
   1. Pre-trade limits enforced outside the strategy process, plus broker-side limits as a second line.
   2. Daily reconciliation of orders, fills, positions, and cash against the broker's record.
   3. An append-only decision ledger capturing inputs, parameters, and code version for every target position.
   4. Model governance: pre-registered tests, a frozen baseline, and an experiment ledger recording every variant tried.
   5. A kill switch and a dead-man's switch, both tested on a schedule.
   6. Release discipline distinguishing `merged`, `deployed`, and `adopted`.
