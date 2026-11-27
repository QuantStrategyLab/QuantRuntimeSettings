# Phase 2 YARDSTICK — Experiment Ledger (Q4-3)

**Status date:** 2026-11-27 (`PREREG-R5` `PILOT` 28-slot study recorded)
**Phase:** 2 (`YARDSTICK`, batch `Y3` / `PILOT`) — documents and empirical ledger record only (`live=OFF`, `kelly=OFF`, `stop_loss_return=OFF`).
**Ledger owner:** `coordinator` (`Q4-3`, apparatus; outcomes reflect pre-registered bars verbatim)
**Related documents:** [frozen-baselines.md](frozen-baselines.md) | [pilot-preregistration.md](pilot-preregistration.md) | [pilot-results.md](pilot-results.md) | [definitions-contract.md](definitions-contract.md) | [cost-model.md](cost-model.md) | [rebase-register.md](rebase-register.md) | [decisions-rebase.md](decisions-rebase.md) | [sizing-unit.md](sizing-unit.md)

## Authorization state

Standing boundaries are unchanged: live trading is **OFF**, Kelly is **research-only** and **computed-not-applied**, and the stop-loss **return rule** is **OFF**.

No new trial was run in this batch. There was no parameter search, no rerun of the `SOXL` exploration and no third `B5` run. The two replays recorded in [frozen-baselines.md](frozen-baselines.md) §5 are reproduction checks of recorded baseline targets; they are not hypothesis trials and are not entered here (see §6 for the rule that decides this).

## 1. Purpose and counting rule

Multiple-testing correction needs a denominator. [definitions-contract.md](definitions-contract.md) §5.1 defines `K_trials` as the cumulative count of distinct hypothesis, parameter or variant evaluations run against overlapping sample histories, seeded at `K_trials ≥ 23` (`2` `B5` + `21` `SOXL`), with no decrement permitted. This ledger is the record behind that number.

Counting rules (this document's operational form of the contract definition):

1. **Unit.** One trial is one pre-specified hypothesis and parameter set evaluated once against a sample. Distinct parameter sets are distinct trials. Distinct tiers count separately whenever a tier changes a constant that the evaluation uses.
2. **When it counts.** A trial counts from the moment it **starts**. A trial that is aborted, fails or is discarded still counts. A trial entered but not started does not count and is listed as `REGISTERED`.
3. **Entered before run.** Every `PILOT` variant is entered here, with its pre-registered standard, before it is run ([pilot-preregistration.md](pilot-preregistration.md) §9 lists the planned slots).
4. **No decrement, no rewrite.** Entries are append-only. A correction is a new entry that references the old one.
5. **Lower bounds are stated as lower bounds.** Where the number of variants inside a historical run is not recorded, the entry counts it as `1` and says so.
6. **Same sample.** All entries below draw on overlapping history of the same underlying markets. Dependence between entries is not estimated here; it belongs to the `DSR`/`PBO` computation, not to the count.

## 2. Entry format

| Field | Meaning |
| --- | --- |
| `ID` | `L-nnn`, assigned in order, never reused |
| Hypothesis / parameter set | What was tested, and the exact parameter set or its identifier |
| Date | Date the trial started, with its source; `not recorded` where the sources give none |
| Data version | The Y2 dataset version reference (`Y2-DATA-1`) for any trial run on it; for historical trials, `pre-Y2` and the data the record names, if any |
| Pre-registered standard | The bar fixed before the run, with its source; `none recorded` where nothing was fixed in the sources |
| Outcome | `ADOPT`, `REJECT`, `INSUFFICIENT`, `NOT_MET`, `REGISTERED`, `ABORTED`, as recorded; never reworded to a stronger claim |
| Trials added / running count | The count this entry adds, and `K_trials` after it |

## 3. Seed entries

Running count before the first entry: `0`.

| ID | Hypothesis / parameter set | Date | Data version | Pre-registered standard | Outcome | Added | `K_trials` |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `L-001` | `B5`, historical run: a rebalancing-reduction rule inside register item 12(a) (`half-step` and band rebalancing family). The rule's parameters are **not recoverable** from the records (`PART-B.md` §2.3: "What it is. Not recoverable."). Judged with a deflated Sharpe ratio, a probability of backtest overfitting and a cost adjustment, per the inference recorded there. | `not recorded` (no run identifier or date in the cited records) | `pre-Y2`; data not recorded | `none recorded` | `REJECT` (the standing verdict rests on this run) | `1` (lower bound) | `1` |
| `L-002` | `B5`, cost-adjusted redo, run identifier `b5-rebaseline-r2`. Same item, with a cost adjustment added. | `not recorded` (the record states "DONE (exit 0)" without a date) | `pre-Y2`; data not recorded | `none recorded` (the record reports `56` of `76` tests pass; `DSR` and `PBO` null) | `INSUFFICIENT` ("insufficient evidence; historical `B5` reject unchanged"). The redo neither confirmed nor reversed the first run; it must not be written as "rejected twice". | `1` (lower bound) | `2` |
| `L-003` to `L-023` | `SOXL` exploration, `21` scenarios, a single workflow run titled "RS04 SOXL exploratory research". Two primary pairings were tested against a pre-registered positive-increment standard. Scenario-level parameters are in the run's artifacts, which were not read in this batch. | Run created `2026-11-08` (`21:19:36 UTC`), per repository metadata (see Sources) | `pre-Y2`; data per the run, not recorded here | A **pre-registered positive-increment standard** for the two primary pairings (its numeric form is not reproduced in the cited records) | `NOT_MET` for both primary pairings; independent-split full set, strict point-in-time, forward-looking and production-adoption checks **not passed** | `21` | `23` |

Running count after the seed: **`K_trials = 23`**, matching the contract's `K_trials ≥ 23` seed. The count is a **lower bound** because `L-001` and `L-002` may each contain several variants whose number is not recorded.

### 3.1 Standing status of the seed entries

- **`B5`: terminal reject, recorded as history, never re-run.** A third baseline run is excluded and no forward comparison is proposed (`PART-C.md` §4.5 "Rows with no test"; [rebase-register.md](rebase-register.md)). `B5` is the historical research rule inside register item 12(a); the architecture-register exception also named `B5` is a different object (glossary in [rebase-register.md](rebase-register.md)).
- **`SOXL` exploration: a properly pre-registered negative result.** "Two primary pairings did not meet the pre-registered positive-increment standard", and the independent-split, strict point-in-time, forward-looking and production-adoption checks were not passed. The roadmap forbids rerunning it: "Do not rerun completed `SOXL` exploration or a third `B5` pass." The `21` scenarios count against item 13 (plugins, `Q6-1`) and against any later `SOXL` test; a new `SOXL` hypothesis has to differ in mechanism from what was explored, not in parameters (`PART-B.md` §2.3 items 13 and 16).
- Neither seed result is a verdict on a strategy's merit in this phase. They are history that raises the bar for later results.

## 4. Data version

Any trial run on the Y2 research dataset carries the dataset-version reference `Y2-DATA-1`. Y2-DATA-1 resolves in the protected identity manifest to the immutable dataset version and its eight per-file digests; the byte-order listing and digest convention are preserved there. Every trial records that immutable version; changing any file creates a new version.

The per-file entry references are `Y2-DATA-1/F1` to `Y2-DATA-1/F8`, in byte order of file name; the file-to-reference mapping is the registry in [dataset.md](dataset.md) §4. The Y2 qualifications travel with the version reference: as-retrieved reconstruction (not point-in-time inputs); `SOXL` market-close proxy with the NAV criterion unverified; modelled `Path C` index segments and modelled synthetic `3×` series; in-sample calibrated `c_spread` constants. A change to any file is a new dataset version with a new reference; trials already recorded keep the reference they ran on.

## 5. Going-forward trials

Slots planned for `PILOT` in [pilot-preregistration.md](pilot-preregistration.md) §9 (`PREREG-R5`) were executed on `2026-11-27` under owner §1 confirmation and launch approval (results summarized in [pilot-results.md](pilot-results.md)). Exploratory slots `L-024`–`L-026` (`18` registry entries) preceded `PILOT` outside the grid, advancing the `23` historical `Y3` seed entries to `K_trials = 41`. Executing all `28` `PILOT` slots (`L-027`–`L-054`, `1` registry entry each) advances running **`K_trials` to `69`**. The next free `ID` is `L-055`.

| ID | Hypothesis / parameter set | Date | Data version | Pre-registered standard | Outcome | Added | `K_trials` |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `L-024` | `EXPL-RUN-609`: 3x vs 1x small-account cost comparison (`live_tqqq_dual_drive_45_45_proxy` and `live_soxl_soxx_trend_57_proxy`, each 3x and 1x twin × spread stress `×1/×2/×3`, 12 registry entries). **Exploratory, outside the PILOT grid** (cannot be used for `PILOT` decisions). | `2026-11-26` (workflow run `EXPL-RUN-609`, UTC) | Public daily closes (`non-Y2` ad-hoc sample; not benchmarked against `Y2-DATA-1`) | Research mandate in `UsEquitySnapshotPipelines` (`small-account-cost-comparison`); outside `PILOT` pre-registration | `NOT_MET` (**exploratory, outside the PILOT grid**; 3x proxies exceeded `30%` DD threshold) | `12` | `35` |
| `L-025` | `EXPL-RUN-610`: full `soxl_soxx_trend_income` strict replay (strict x1/x2/x3 spread stress on public daily closes). **Exploratory, outside the PILOT grid** (cannot be used for `PILOT` decisions). | `2026-11-26` (workflow run `EXPL-RUN-610`, UTC) | Public daily closes (`non-Y2` ad-hoc sample) | Research mandate in `UsEquitySnapshotPipelines` (`soxl-strict-replay`); outside `PILOT` pre-registration | `NOT_MET` (**exploratory, outside the PILOT grid**; strict DD beyond balanced budget) | `3` | `38` |
| `L-026` | `EXPL-RUN-611`: full `tqqq_growth_income` strict replay (strict x1/x2/x3 spread stress on public daily closes; executed prior to Section 13 freeze on unplanned runs; formal TQQQ evaluation remains governed by `PILOT`). **Exploratory, outside the PILOT grid** (cannot be used for `PILOT` decisions). | `2026-11-26` (workflow run `EXPL-RUN-611`, UTC) | Public daily closes (`non-Y2` ad-hoc sample) | Research mandate in `UsEquitySnapshotPipelines` (`tqqq-strict-replay`); outside `PILOT` pre-registration | `NOT_MET` (**exploratory, outside the PILOT grid**; strict DD beyond balanced budget) | `3` | `41` |
| `L-027` | `PILOT P-A`: Conservative `vol_scalar=linear` (`B_0=50,000`, `20%` band) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `K`: `≥10%` stress/WF reduction, `π_K ≤ 20%`, `λ_trip ≤ 1/yr`, `TO ≤ 50%` | `REJECT` (`gc=(g_base-g_var)/g_base=38.4% > 20%`, `λ_trip=0.00`) | `1` | `42` |
| `L-028` | `PILOT P-A`: Conservative `vol_scalar=squared` (`B_0=50,000`, `20%` band) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `K` Conservative bar | `REJECT` (`gc=45.3% > 20%`) | `1` | `43` |
| `L-029` | `PILOT P-A`: Balanced `vol_scalar=linear` (`B_0=50,000`, `20%` band) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `K`: `≥10%` stress/WF reduction, `π_K ≤ 15%`, `λ_trip ≤ 2/yr`, `TO ≤ 100%` | `REJECT` (`gc=44.4% > 15%`) | `1` | `44` |
| `L-030` | `PILOT P-A`: Balanced `vol_scalar=squared` (`B_0=50,000`, `20%` band) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `K` Balanced bar | `REJECT` (`gc=52.6% > 15%`) | `1` | `45` |
| `L-031` | `PILOT P-A`: Aggressive `vol_scalar=linear` (`B_0=50,000`, `20%` band) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `K`: `≥10%` stress/WF reduction, `π_K ≤ 10%`, `λ_trip ≤ 3/yr`, `TO ≤ 200%` | `REJECT` (`gc=50.3% > 10%`, `TO=216.8% > 200%`) | `1` | `46` |
| `L-032` | `PILOT P-A`: Aggressive `vol_scalar=squared` (`B_0=50,000`, `20%` band) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `K` Aggressive bar | `REJECT` (`gc=50.4% > 10%`, `TO=202.5% > 200%`) | `1` | `47` |
| `L-033` | `PILOT P-B`: Conservative `dd_rule=prop` + `vol=linear` (`B_0=50,000`) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `K` Conservative bar (unrounded `MDD` reduction `92.1%`) | `REJECT` (`gc=38.6% > 20%`) | `1` | `48` |
| `L-034` | `PILOT P-B`: Conservative `dd_rule=step` (`ENVELOPE-V1-DOC`) + `vol=linear` | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `K` Conservative bar (unrounded `MDD` reduction `91.2%`) | `REJECT` (`gc=38.4% > 20%`) | `1` | `49` |
| `L-035` | `PILOT P-B`: Balanced `dd_rule=prop` + `vol=linear` (`B_0=50,000`) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `K` Balanced bar (unrounded `MDD` reduction `90.0%`) | `REJECT` (`gc=45.2% > 15%`) | `1` | `50` |
| `L-036` | `PILOT P-B`: Balanced `dd_rule=step` (`ENVELOPE-V1-DOC` + `§8.1` 20d `HWM_PB` re-entry) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `K` Balanced bar (unrounded `MDD` reduction `88.9%`) | `REJECT` (`gc=44.4% > 15%`) | `1` | `51` |
| `L-037` | `PILOT P-B`: Aggressive `dd_rule=prop` + `vol=linear` (`B_0=50,000`) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `K` Aggressive bar (unrounded `MDD` reduction `83.7%`) | `REJECT` (`gc=51.7% > 10%`) | `1` | `52` |
| `L-038` | `PILOT P-B`: Aggressive `dd_rule=step` (`ENVELOPE-V1-DOC` + `§8.1` 20d `HWM_PB` re-entry) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `K` Aggressive bar (unrounded `MDD` reduction `80.0%`) | `REJECT` (`gc=50.5% > 10%`) | `1` | `53` |
| `L-039` | `PILOT P-C`: Conservative `no_trade_band=10%` (`B_0=50,000`, `§4.1` IBKR costs) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `P`: narrowest band with annual `TO ≤ 50%` | `ADOPT` (`TO=36.6% syn / 44.9% real`) | `1` | `54` |
| `L-040` | `PILOT P-C`: Conservative `no_trade_band=20%` | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `P` Conservative (`TO ≤ 50%`) | `SUPERSEDED` (`TO=33.1% syn / 41.9% real ≤ 50%`; wider than `L-039`) | `1` | `55` |
| `L-041` | `PILOT P-C`: Conservative `no_trade_band=30%` | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `P` Conservative (`TO ≤ 50%`) | `SUPERSEDED` (`TO=31.1% syn / 38.2% real ≤ 50%`; wider than `L-039`) | `1` | `56` |
| `L-042` | `PILOT P-C`: Balanced `no_trade_band=10%` (`B_0=50,000`, `§4.1` IBKR costs) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `P`: narrowest band with annual `TO ≤ 100%` | `ADOPT` (`TO=93.1% syn / 99.7% real`) | `1` | `57` |
| `L-043` | `PILOT P-C`: Balanced `no_trade_band=20%` | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `P` Balanced (`TO ≤ 100%`) | `SUPERSEDED` (`TO=85.8% syn / 92.6% real ≤ 100%`; wider than `L-042`) | `1` | `58` |
| `L-044` | `PILOT P-C`: Balanced `no_trade_band=30%` | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `P` Balanced (`TO ≤ 100%`) | `SUPERSEDED` (`TO=81.0% syn / 87.7% real ≤ 100%`; wider than `L-042`) | `1` | `59` |
| `L-045` | `PILOT P-C`: Aggressive `no_trade_band=10%` (`B_0=50,000`, `§4.1` IBKR costs) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `P` Aggressive (`TO ≤ 200%`) | `REJECT` (`TO=202.6% syn / 207.7% real > 200%`) | `1` | `60` |
| `L-046` | `PILOT P-C`: Aggressive `no_trade_band=20%` (`B_0=50,000`, `§4.1` IBKR costs) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `P`: narrowest band with annual `TO ≤ 200%` | `ADOPT` (`TO=193.4% syn / 196.0% real`) | `1` | `61` |
| `L-047` | `PILOT P-C`: Aggressive `no_trade_band=30%` | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Class `P` Aggressive (`TO ≤ 200%`) | `SUPERSEDED` (`TO=190.0% syn / 192.5% real ≤ 200%`; wider than `L-046`) | `1` | `62` |
| `L-048` | `PILOT P-D`: `XSOX–XNDX` lower-tail (`q_{0.10}`) correlation & `95%` stationary-bootstrap UCB (`b=20`, `10,000` reps, `PCG64` seed `20261127`) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Both index `95%` UCB `< 0.70` and unpooled real ETF point `< 0.70` | `REJECT` (`syn UCB=0.6385`, `real ETF pt=0.7162 ≥ 0.70`; credit `= 0`) | `1` | `63` |
| `L-049` | `PILOT P-E`: Conservative `US$1,500` whole-share execution (`§4.1` IBKR costs) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Net `g > 0` & annual cost `< 10%` of excess growth | `NOT_MET` (`real g=1.62% < 2%` T-bill; fee ratio `n/a`) | `1` | `64` |
| `L-050` | `PILOT P-E`: Conservative `US$1,500` fractional-share execution (`§4.1` IBKR costs) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Net `g > 0` & annual cost `< 10%` of excess growth | `NOT_MET` (`real fee ratio=249.4%`; `$14.63/yr` cost) | `1` | `65` |
| `L-051` | `PILOT P-E`: Balanced `US$1,500` whole-share execution (`§4.1` IBKR costs) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Net `g > 0` & annual cost `< 10%` of excess growth | `NOT_MET` (`real g=2.05%`, fee ratio `2478%`) | `1` | `66` |
| `L-052` | `PILOT P-E`: Balanced `US$1,500` fractional-share execution (`§4.1` IBKR costs) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Net `g > 0` & annual cost `< 10%` of excess growth | `NOT_MET` (`real g=3.80% > 2.05%` whole, fee ratio `111.1%`) | `1` | `67` |
| `L-053` | `PILOT P-E`: Aggressive `US$1,500` whole-share execution (`§4.1` IBKR costs) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Net `g > 0` & annual cost `< 10%` of excess growth | `NOT_MET` (`real g=4.05%`, fee ratio `149.2%`) | `1` | `68` |
| `L-054` | `PILOT P-E`: Aggressive `US$1,500` fractional-share execution (`§4.1` IBKR costs) | `2026-11-27` (`PREREG-R5`) | `Y2-DATA-1` | Net `g > 0` & annual cost `< 10%` of excess growth | `NOT_MET` (`real g=5.86% > 4.05%` whole, fee ratio `91.5%`) | `1` | `69` |
| `L-055` | `BREADTH` empirical screening (`16` sleeves: US sectors, `US_DEF_MN`, ex-US, gold `GLD`, Treasuries `IEF`/`TLT`/`TLT_TREND126`, CTA `DBMF`, commodities `DBC`; `seed=20261128`, `b=5`, `R=1000`, `q_{0.10}`) | `2026-11-28` (`breadth-screening-results.md`) | `BREADTH-DATA-20261128` (`2019-11-07`–`2026-11-27`, `1,773`d) | Lower-tail corr + `95%` stationary-bootstrap UCB `< 0.50` vs `QQQ`/`TQQQ`/`SOXL` (`DSR` `K_family=16` diagnostic only; no admission gate pass) | `PARTIAL` (`6` sleeves `GLD`, `DBMF`, `IEF`, `TLT`, `TLT_TREND126`, `US_DEF_MN` pass `< 0.50` tail bar only; all `9` long-only equity sleeves + `DBC` fail UCB `< 0.50`; cumulative `K_trials = 85` DSR/PBO pending) | `16` | `85` |

## 6. What is and is not a trial

- **A trial:** a hypothesis test or a parameter-set evaluation whose outcome could change a verdict, a recommendation or a constant, and that is run on history overlapping a sample already used.
- **Not a trial:** a reproduction check of a recorded target (such as the baseline replays), a data-integrity check, a determinism check, a unit test, and descriptive statistics fixed by rule (such as the stress-window dates in [pilot-preregistration.md](pilot-preregistration.md) §6). Where a case is doubtful, it is entered as a trial.

## 7. Related trial records in the strategy repository (not counted)

The `UsEquityStrategies` repository carries its own trial records. They are **not** part of the contract's seed and are **not** included in `K_trials` here; they are listed so that the coordinator can decide whether any of them belongs in the denominator.

| Record (in `UsEquityStrategies` at the commit pinned in [frozen-baselines.md](frozen-baselines.md)) | What it says |
| --- | --- |
| `docs/research/kelly_trial_ledger.json` | Data-free ledger of pre-registered Kelly sizing studies on one development sample; `cumulative_sizing_trials = 48`. |
| `docs/research/trial_registry/r_math_04.json` and its `README.md` | A read-only projection of seven local stores: nine distinct trial identities (`4` success, `2` rejected, `2` aborted, `1` started), `18` ledgers. The record states that these numbers are local inventory, must not be added to the Kelly `48`, and that the cumulative family is not frozen (`status = NEED_USER`). |
| `docs/research/tqqq-sma-trial-journal.md` | A twelve-slot `SMA`-window and cost journal for a frozen `TQQQ` `SMA` study; the entrypoint is synthetic-only and no historical attempts are backfilled. |
| `docs/research/soxl-derisk-only-202610-forward-preregistration.md` | A pre-registered `20`-session forward observation, collection not activated; historical backtests ending `2026-08-25` are marked reference only and contaminated. |

Whether these overlap the `Y2` sample, whether they are independent of `L-001` to `L-055`, and whether the Kelly `48` belongs in `K_trials` are open questions for the coordinator and, for the denominator, the owner. Until decided, `K_trials = 85` (`23` historical `Y3` seed entries + `18` exploratory registry entries across `L-024`–`L-026` + `28` `PILOT` entries across `L-027`–`L-054` + `16` `BREADTH` screening entries in `L-055`) is a running floor and any `DSR` computed from it carries that caveat.

## Sources

- `PART-B.md` §2.3 (`B5`; items 13 and 16), §2.6 item 3 ("Count the trials"), and the `[I36:n]` lines it cites, in `~/workspace/quant-s2/fable-roadmap/` and `~/workspace/quant-s2/closeout/issue36-body-old.md`: line `44`–`54` (`SOXL` exploration, `SRC-PR-1`, unique run), line `193` (do not rerun), line `200` (tally), line `237` (`b5-rebaseline-r2`). `PART-C.md` §3.3 (item 12 split, `B5` stays closed), §3.4 Phase 2 scope item 5, §4.5.
- Supplementary repository metadata, read-only (`gh run view`, `gh pr view`) for the `SOXL` exploration: workflow run `SRC-RUN-1` (locator in the protected identity manifest), conclusion `success`, created `2026-11-08T21:19:36Z`; pull request `SRC-PR-1` merged `2026-11-08T21:18:56Z`. These dates are not in `PART-B.md` or `PART-C.md`; they are added here from the repository's own records and are marked as such.
- [definitions-contract.md](definitions-contract.md) §5.1; [rebase-register.md](rebase-register.md) (historical tally and Table C).
- [dataset.md](dataset.md) §4 (protected per-file entry references; the data files stay under `~/workspace/quant-s2/yardstick/y2/`).
