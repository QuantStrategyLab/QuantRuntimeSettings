# Phase 0 REBASE — Item Register (v1)

**Status date:** 2026-11-15  
**Phase:** 0 (`REBASE`) — documents only. This register authorizes no code edits, data reads, deployments, paper orders, or live orders.  
**Related documents:** [decisions-2026-11-15.md](decisions-2026-11-15.md) | [sizing-unit.md](sizing-unit.md)

## Authorization state

The premise corrections R1–R3, this rebuilt register, the tier constants of §4.3 as starting values, the stop-loss split, the plugin rule, and the redefinitions of "unattended" and "institutional-grade" were endorsed by the coordinator on 2026-11-15 under the owner's standing delegation (owner: "if there are no problems, advance automatically").

Standing boundaries are unchanged:

- Live trading is fully **OFF** (no real orders anywhere, including legacy TQQQ/SOXL strategy bodies).
- Kelly sizing is **research-only** and **computed-not-applied** in the pilot.
- The stop-loss **return rule** is **OFF**.

## Historical tally (recorded as history only)

Before REBASE, the closeout records carried a single tally across the 17 items:

- **Adopt:** `0`
- **Reject:** `1` — `B5` (inside owner item 12a), closed as a **terminal reject** (the first historical run was rejected; the cost-adjusted redo `b5-rebaseline-r2` returned insufficient evidence with 56 of 76 tests passing and `DSR`/`PBO` null; the historical reject stands, a third baseline run is excluded, and no forward comparison is proposed)
- **Insufficient evidence:** `16`

This tally is recorded strictly as historical fact and is retired as the register's state model. It applied one return-seeking statistical question across seventeen heterogeneous items, whereas at most three items on the owner's reference list claim a higher return (items 12, 13, and the return side of 10). The remainder are measurement apparatus (1, 3, 4, 5, 16), accounting (2), preference (14), control (15), or governance (17).

## Class taxonomy, state model, and ID prefixes

Each row in the rebuilt register carries a unique `Q-ID`, a claim class (`PART-B.md` §2.4, `PART-C.md` §3.3), a current state, a disposition, and a target phase.

| Class | Claim type | Evidence bar and terminal/active states |
| --- | --- | --- |
| `M` | Measurement or accounting | Correctness bar: named owner, written definition, synthetic matrix, and broker reconciliation within tolerance where applicable. States: `open — prerequisite`, `open — unverified`, `specified`, `adopted / verified`, or terminal `insufficient — named missing data`. |
| `C` | Control or hard limit | Engineering bar: independent of strategy process, deterministic, exact pass on synthetic trip matrix, fail-closed, persistent readable state, human re-arm for latched breakers. States: `open — unverified`, `open — specified, unarmed`, `specified and verified offline`, `wired and armed`. |
| `S` | Sizing rule | Boundedness (can only shrink exposure relative to hard caps), input-uncertainty stability, turnover within budget, defined bankroll. States: `research-only — OFF (computed, not applied)`, `parked`, `insufficient — dated milestone`, `recommend-adopt`, `reject`. |
| `K` | Risk-reducing scalar (can only shrink exposure) | Pre-registered stress-loss reduction in stress scenarios and at least two-thirds of walk-forward windows (*proposal*), plus non-inferiority within tier class-K growth-cost premium and trip/turnover budgets. States: `open — pre-registration pending`, `recommend-adopt`, `reject`, `insufficient — named missing data`. |
| `R` | Return-seeking rule or signal | Pre-registered paired net log growth increment against frozen baseline on identical data/costs, corrected for full trial count in the experiment ledger, same sign in synthetic and real-fund buckets, drawdown inside tier ceiling, and at least 12 months of forward shadow agreement (*proposal*). States: `OFF`, `terminal reject`, `insufficient — dated milestone`, `recommend-adopt`, `reject`. |
| `P` | Preference template | Encodes owner risk appetite; chosen once from published outcome ranges. States: `starting values — to be measured at PILOT`, `frozen`. |

**Default under insufficient evidence:** class `R` and `S` items stay OFF; class `K` items are decided by the non-inferiority test; class `C` items are required regardless.

**ID prefixes by question answered:** `Q0` architecture read-path and account identity; `Q1` data trustworthiness, definitions, provenance, and observability; `Q2` deployment size and loss budget; `Q3` concentration and joint risk; `Q4` scorecard, costs, ledgers, and reconciliation; `Q5` stopping controls, vehicle integrity, and recovery; `Q6` optional signals and plugins.

## Rebuilt item register

### Table A — Rebuilt 17-item register (with split sub-rows)

| Q-ID | Owner item | Class | State (2026-11-15) | Disposition | Target phase | Evidence path / terminal state |
| --- | --- | --- | --- | --- | --- | --- |
| `Q4-1` | Item 1: Long-run compounding as the yardstick | `M` | `Open — prerequisite (owner: coordinator)` | **Keep, promote** to the objective and scorecard: net log growth, maximum drawdown, time to recover | `YARDSTICK` | Present in every pre-registered test and calibration table |
| `Q2-1` | Item 2(a): Deployable capital and order quantity | `M` | `Open — unverified` | **Split (a)** from item 2 as sizing input (reserved cash, pending orders, whole shares, minimum commission, smallest workable bankroll) | `SUPPLY-A; PAPER` (synthetic cases in `YARDSTICK`) | Exact pass on synthetic cases (`YARDSTICK`); measured on venue facts (`PAPER`) |
| `Q4-2` | Item 2(b): Expected against actual fees | `M` | `Open — missing real fills` | **Split (b)** from item 2 as fill-cost measurement | `PAPER` | Compare fee model vs reported venue schedule/fills; stays `insufficient — named missing data (real fills)` until `LIVE-GATE` unless legacy fills are recovered via `#17` and `#25` |
| `Q1-1` | Item 3: Point-in-time history | `M` | `Open — unverified` | **Keep, add** long synthetic 3× history rebuilt from underlying Nasdaq-100 and semiconductor indices with fee and financing model | `YARDSTICK` | Annual difference within 0.5 percentage points (*proposal*) vs real fund over common life with residual explained; no post-decision inputs |
| `Q4-3` | Item 4: Overfitting checks (`DSR`, `PBO`) | `M` | `Open — apparatus unseeded` | **Keep, reclassify** as measurement apparatus (experiment ledger, walk-forward, trial counting) | `YARDSTICK` (active in `PILOT`) | Seeded with both `B5` runs and the 21 SOXL scenarios; every `PILOT` variant entered before execution (not judged on merit) |
| `Q1-2` | Item 5: Unified definitions | `M` | `Open — prerequisite (owner: coordinator)` | **Keep, move first** as prerequisite definitions contract (units, periods, annualization, gross vs net, variance vs raw second moment, daily-linked TWR primary with monthly Modified Dietz as labelled fallback, flow/split-adjusted HWM) | `YARDSTICK; SUPPLY-A` | Written contract with named owner (`coordinator`) and exact pass on synthetic matrix (`YARDSTICK`); `method_version` registration in `SUPPLY-B` |
| `Q2-3` | Items 6 & 7: Kelly + Bayesian updating and shrinkage | `S` | `Research-only — OFF (computed, not applied)` | **Merge, reorder** after loss constraint; compute underlying-index Kelly ceiling shrunk by posterior uncertainty from broad-equity prior; record monthly win rate and payoff ratio with Bayesian interval as diagnostic only | `YARDSTICK → PILOT → SHADOW` | Sensitivity and bind frequency reported in `PILOT`; expected `insufficient — dated milestone (~6 months SHADOW stability)` |
| `Q3-1` | Item 8(a): Joint cap and look-through (TQQQ + SOXL) | `C` | `Starting values set — unmeasured` | **Split (a)** from item 8: beta-adjusted joint exposure cap using falling-market beta (placeholder `max(measured, 1.5)`) | `PILOT` | Measure index co-movement in full sample and worst tenth of Nasdaq months; diversification credit granted only if tail correlation upper bound < `0.7` (*proposal*) |
| `Q3-3` | Item 8(b): Multi-strategy allocation | `S` | `Parked — awaits second sleeve` | **Split (b)** from item 8: shared loss-budget allocation and risk contributions across admitted sleeves | `BOOK` | Offline comparison and risk-reducing bar at book level once at least two admitted sleeves have 250+ shadow sessions (*proposal*) |
| `Q3-2` | Item 9: CVaR / expected shortfall | `M` (feeding `C`) | `Open — unverified` | **Keep, pull forward, redefine** as scenario measure of maximum loss feeding `Q2-2`; portfolio optimization stays in `BOOK` | `PILOT; BOOK` | Written reproducible definition including 97.5% expected shortfall (*proposal*) of 250-session block-bootstrap bankroll losses re-centred on shrunk mean |
| `Q2-4` | Item 10: Volatility-based scaling | `K` | `Open — parked in library, unverified` | **Keep**: paired comparison of linear (`1/σ`) and squared (`1/σ²`) scalars against frozen baseline; missing volatility data fails closed | `PILOT` | Lower max drawdown and worst 20-session loss in stress scenarios and ≥ 2/3 of walk-forward windows; growth cost ≤ tier class-K premium; turnover ≤ line 6 |
| `Q2-2` | Item 11(a): Cushion-proportional exposure limit | `C` | `Open — specified, unarmed` | **Split (a)** from item 11 (paired with audit maximum-loss constraint): `x_ML(c) = min(3c, 2c, M(c))` (`2c` one-day 25% gap bound is a *proposal*) | `FUSE; PILOT` | Trip matrix for `L0`–`L4` (`FUSE` batch 1); calibrated `M(c)` per tier inside `D` across stress set and 10-year breach simulation (`PILOT`); separate card before arming |
| `Q2-5` | Item 11(b): Drawdown-scaling shape | `K` | `Open — pre-registration pending` | **Split (b)** from item 11: paired comparison of proportional cushion rule vs draft step brake | `PILOT` | Class-K bar plus latched trips inside line 15 and time to recover reported |
| `Q5-1(c)` | Items 11(c) & 12(c): Loss memory and emergency bypass | `C` | `Open — unverified` | **Split (c)**: loss memory survives deposits, withdrawals, restarts, and tier changes; hard-cap, `x_ML`, joint-cap, and breaker reductions never delayed by no-trade band | `FUSE; PILOT` | Verified inside `Q5-1` synthetic trip matrix (`FUSE` batch 1) |
| `B5` (item 12a) | Item 12(a): `B5` rebalancing rule | `R` | `Terminal reject (closed)` | **Split (a)**: existing `B5` not-adopt conclusion kept as terminal reject; no third baseline run and no forward comparison proposed | `—` (terminal) | Terminal reject; closed |
| `Q2-6` | Item 12(b): Minimum no-trade band | `P/M` | `Starting value — to be measured at PILOT` | **Split (b)**: cost parameter set from fees, share rounding, and turnover budget (starting value `20%` of target weight) | `PILOT` | Pre-registered grid (`10%`, `20%`, `30%` of target weight, *proposal*); narrowest band with annual cost inside tier budget |
| `Q6-1` | Item 13: Plugins (replaceable and provable) | `Signal` (`K` if risk-reducing only; `R` otherwise) | `Deferred — OFF (plugin_mode=none)` | **Keep, defer** behind frozen baseline; tiers select frozen strategy-plus-signal bundles with no run-time toggling; 21 SOXL scenarios count in trial ledger | `SHADOW (observe-only); after PILOT` | Hypothesis card, separately authorized observe-only shadow columns, then paired consumption test against frozen baseline |
| `Q2-7` | Item 14: Three tiers as account-level arrangement | `P` | `Starting values — to be measured at PILOT` | **Merge** existing tier names (`CAPITAL_PRESERVATION`, `BALANCED_COMPOUNDING`, `GROWTH_COMPOUNDING`) with equity scale and `B = E* + H` glide path | `PILOT` | Published outcome ranges per tier plus trip-matrix cases for HWM keying, 30-day cooling-off, and `D/3` no-loosening lock; owner selection of frozen constants |
| `Q5-1` | Item 15(a): Control states and pre-trade limits (incl. 11c, 12c) | `C` | `Open — specified, unarmed` | **Split (a)**: four states (`NO-NEW-RISK`, `DE-RISK`, `HALT`, `ORDER-UNKNOWN`), interlocks vs human-re-armed breakers, pre-trade limits; existing unverified 3-platform gate read back in `FUSE` batch 2 | `FUSE; PAPER` | Exact pass on synthetic trip matrix, fail-closed, persistent state read-back, human re-arm (`FUSE` batch 1); separate control-arming card for loss-triggered rows `L0`, `L2`–`L4` |
| `Q5-2` | Item 15(b): Uncertain-order recovery | `C` | `Open — unverified` | **Split (b)**: enter `ORDER-UNKNOWN`, block symbol orders, query original order before sending anything | `FUSE; PAPER` | Induced unknown-order recovery test in `PAPER` |
| `15(c)` | Item 15(c): Stop-loss as a return rule | `R` | `OFF (terminal — no test planned)` | **Split (c)**: stop-loss return rule stays OFF; no price stops on 3× funds | `—` (terminal) | Terminal OFF; no test planned |
| `Q1-3` | Item 16: Research results used by runtime | `M` | `Open — unverified` | **Keep, merge** record format with shadow ledger (provenance and wiring item, not a signal plugin) | `SHADOW; PAPER` | Policy, config, and data hashes recorded and replayed identically (`SHADOW` research half); loaded platform hash equals registered hash (`PAPER` platform half) |
| `Governance` | Item 17: AI assistance; Bayesian optimization | `Governance` | `Active governance rule (Bayesian optimization dropped)` | **Reclassify** AI boundary (no trading authority, no limit/budget changes, outside control loop) as governance and **drop** from adopt/reject register; **drop** Bayesian optimization for pilot | `—` (governance) | Enforced by governance and CI/runtime policy (`O9`); no parameter search in pilot |
| `Parked` | Later directions (risk parity, distributionally robust Kelly, income funds, option overlays, scheduled investing) | `Parked` | `Parked` | **Stay parked**: robust Kelly covered by `Q2-3` shrinkage; risk parity deferred to `BOOK`; income/options/scheduled investing deferred to `BREADTH` | `BOOK; BREADTH` | Same-underlying overlays fail `BREADTH` admission by construction (*inference*) |

### Table B — Audit-added rows

| Q-ID | Addition | Class | State (2026-11-15) | Why added | Target phase | Evidence path |
| --- | --- | --- | --- | --- | --- | --- |
| `Q0-1` | Read-path integrity and account identity | `C / M` | `Open — exceptions active (first window 2026-12-14); Option B not authorized` | Dated architecture commitments (`R1`–`R5`, `B0`–`B7`) and canonical identity migration | `GATE; IDENTITY` | CI enforcement blocking violations and zero lapsed exceptions (`GATE`); Option B migration verification when authorized (`IDENTITY`) |
| `Q1-4` | Account-facts supply for the sizing unit | `M` | `Open — binding constraint` | Data supply is not delivering flow-adjusted facts for the sizing unit | `SUPPLY-A; SUPPLY-B` | Source contracts and synthetic matrix (`SUPPLY-A`); 10 clean production sessions < 1 session old and broker-reconciled (`SUPPLY-B`) |
| `Q1-5` | Run observability | `M / C` | `Open — unreadable without a person` | Runs, schedules, logs, and notifications cannot currently be read automatically | `WATCH` | 5 consecutive no-submit scheduled runs traced schedule → log → notification, plus induced failure test |
| `Q2-2` | Maximum-loss constraint | `C` | `Open — specified, unarmed` | Owner objective requires explicit maximum-loss sizing (`x_ML(c)`) | `FUSE; PILOT` | Paired with item 11(a) in Table A |
| `Q4-4` | Shadow decision ledger | `M` | `Open — not running` | Only source of new out-of-sample forward evidence | `SHADOW` | Append-only hash-chained daily records with external timestamp; 20 sessions (`SHADOW` acceptance), 60 sessions (T1 acceptance), 6-month and 12-month milestones |
| `Q4-5` | Daily reconciliation against the broker | `M` | `Open — unverified` | Institutional-grade property 2 | `PAPER` | Every-session reconciliation of orders, fills, positions, and cash with zero unreconciled breaks |
| `Q5-3` | Vehicle integrity (`V1`–`V7`) | `C` | `Open — unverified` | Risks specific to 3× daily-reset ETFs (tracking, splits, issuer/exchange events, extreme vol, decay/cost, quotes) | `FUSE` | Synthetic cases for `V1`–`V7` and zero false drawdowns/trips across historical splits |
| `Q5-4` | Dead-man's switch (`O7`) | `C` | `Open — unverified` | Institutional-grade property 5 | `WATCH; FUSE` | Independent alarm channel; silent-death test raises alarm and blocks exposure increases |

### Table C — Frozen and legacy-boundary records outside the 17-item list

| Identifier | Subject | Class | State (2026-11-15) | Disposition | Target phase |
| --- | --- | --- | --- | --- | --- |
| `D12` | Historical code `D12` | `—` | **Frozen (undefined)** | Named once in historical closeout records as frozen with no recoverable definition; remains frozen and untouched | `—` (frozen) |
| `M02b` | Existing 7.5% inverse-peak sizing boundary (IBKR issue 958, 3 known failures) | `S / C` | `Standing Option A (unchanged; exact rule behaviour not verified in this worktree)` | Existing algorithm unchanged; three known boundary cases stay on their own card; rule behaviour and place in §4.2 stack documented before sizing code is written | Before sizing code |

## Colliding labels glossary

REBASE enforces unique naming across colliding historical labels:

- **Item `B5` vs. Exception `B5`:** **Item `B5`** is the historical research rule inside register item 12(a), closed as a terminal reject. **Exception `B5`** is an entry in the `B0`–`B7` architecture read-path exception register tracked for closure or re-dating in `GATE` before 2026-12-14.
- **Register item `5` vs. Desk issue `5`:** **Register item `5`** (`Q1-2`) is the unified mathematical definitions and TWR/Modified Dietz contract (prerequisite, owner = `coordinator`). **Desk issue `5`** is a separate console/data-supply backlog item in the engineering track.

## Research code location

What this worktree itself shows about repository layout:

- **Repository role:** `qsl.toml` and `README.md` identify this repository as `QuantRuntimeSettings` (`tier = "ops/tooling"`, `upgrade_ring = "ring_e"`), the central runtime-settings, schema, projection, and compatibility control-plane repository.
- **Top-level layout:**
  - `python/` — `quant-runtime-settings` Python package (`pyproject.toml`), config/projection generators and validators, risk-composer scripts (`long_horizon_risk_composer.py`, `long_horizon_risk_composer_v2.py`), M0 research ledger/task contract modules (`m0_research_ledger.py`, `research_task_contract.py`), `deterministic_risk_gate.py`, `shell/` helpers, and `tests/`.
  - `web/` — `web/strategy-switch-console/` and `web/secret-rotation-proxy/`.
  - `schemas/` — JSON Schemas for runtime targets, Desk projections, reconciliation, research tasks/ledgers, and risk controls.
  - `docs/` — architecture documentation, ADRs, workflows, images, contracts, and `docs/quant/`.
  - `compat/` — CalVer compatibility bundles (`bundles/`) and `compat/repo-tiers.toml` (which assigns strategy libraries and plugins to `strategy-lib` and research/snapshot pipelines to `pipeline`).
  - `authority/` — `candidates/`, `evidence/`, and `receipts/`.
  - `actions/`, `examples/`, `prompts/`, `scripts/`, `tests/`, plus tracked projections and manifests (`platform-config.json`, `display-names.config.json`, `internal_dependency_matrix.json`, `qsl.toml`, `uv.lock`).
- **External code:** Strategy bodies, backtest engines, and standalone offline research pipelines do not live in this worktree; `internal_dependency_matrix.json` pins external repositories (including `QuantPlatformKit`, `CryptoStrategies`, and broker platform repositories), whose contents are **not verified** in this worktree.
- **Coordinator audit workspace:** The coordinator's audit workspace is `~/workspace/quant-s2/` on the coordinator host.
- **Historical ledger cross-check:** t1558/t1568 outputs not locatable on this host; cross-check deferred.
