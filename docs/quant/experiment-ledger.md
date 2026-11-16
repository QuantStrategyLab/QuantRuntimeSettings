# Phase 2 YARDSTICK — Experiment Ledger (Q4-3)

**Status date:** 2026-11-17
**Phase:** 2 (`YARDSTICK`, batch `Y3`) — documents only. Seeding the ledger authorizes no code edits, data reads, deployments, paper orders, live orders, or new trials.
**Ledger owner:** `coordinator` (`Q4-3`, apparatus; the ledger is not adopted or rejected on merit)
**Related documents:** [frozen-baselines.md](frozen-baselines.md) | [pilot-preregistration.md](pilot-preregistration.md) | [definitions-contract.md](definitions-contract.md) | [cost-model.md](cost-model.md) | [rebase-register.md](rebase-register.md) | [decisions-rebase.md](decisions-rebase.md) | [sizing-unit.md](sizing-unit.md)

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
| Data version | The Y2 dataset version hash for any trial run on it; for historical trials, `pre-Y2` and the data the record names, if any |
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

Any trial run on the Y2 research dataset carries the dataset version hash. The version hash is the SHA-256 of the listing produced by `sha256sum` over the dataset files in byte order of file name (`LC_ALL=C sort`), one line per file, two spaces between digest and name:

```
91f0c63b386cb2a732acf1f4b33d122b2000767596b729b131013ae12d7b0c1c  nasdaq_giw_implied_dividends.csv
875c6cde908285b536d094181119caf0338e92f358e85798e236b5c5c33d65a5  ndx_index_daily.csv
211fc1e0f99b6004fbd3f55f0c7a178ed40bee7d72c3a78969c16289a8d5debb  risk_free_rates_daily.csv
4ef50831d033711958beff9ee7027d68c361f04e02642a9a19bd436753d7abef  semi_index_daily.csv
f5e664a976c45df1166c7c401fbea807d754f1d5b26300d101ae163a38062cdd  soxl_daily.csv
eba83ae40ffb7eea9468ec437e408774bce703bc362a74e32891fade94ccfd73  synthetic_3x_ndx_daily.csv
e53d899276f1eac99493fd15ff419755395f1f29f13d5ca45dec3f1d8a3da139  synthetic_3x_semi_daily.csv
d770897f3c7df8e0cdd056415e2aea10f83d438939ee77602ad3a295b083fd02  tqqq_daily.csv
```

**Y2 dataset version hash: `19e51a6627c40461fdd80f740798462425769af6ad3cfecad4937003e9320de6`.**

The per-file digests match the registry in [dataset.md](dataset.md) §4 as of `2026-11-17`. The Y2 qualifications travel with the version hash: as-retrieved reconstruction (not point-in-time inputs); `SOXL` market-close proxy with the NAV criterion unverified; modelled `Path C` index segments and modelled synthetic `3×` series; in-sample calibrated `c_spread` constants. A change to any file is a new dataset version and a new hash; trials already recorded keep the hash they ran on.

## 5. Going-forward trials

No going-forward trial exists yet. Slots planned for `PILOT` are registered in [pilot-preregistration.md](pilot-preregistration.md) §9 and enter this ledger as `REGISTERED` rows with their own `ID` before any run. The next free `ID` is `L-024`. The next `K_trials` value after the first started `PILOT` trial is `24`.

| ID | Hypothesis / parameter set | Date | Data version | Pre-registered standard | Outcome | Added | `K_trials` |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| (none) | | | | | | | `23` |

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

Whether these overlap the `Y2` sample, whether they are independent of `L-001` to `L-023`, and whether the Kelly `48` belongs in `K_trials` are open questions for the coordinator and, for the denominator, the owner. Until decided, `K_trials = 23` is a floor and any `DSR` computed from it carries that caveat.

## Sources

- `PART-B.md` §2.3 (`B5`; items 13 and 16), §2.6 item 3 ("Count the trials"), and the `[I36:n]` lines it cites, in `~/workspace/quant-s2/fable-roadmap/` and `~/workspace/quant-s2/closeout/issue36-body-old.md`: line `44`–`54` (`SOXL` exploration, `UESP #587`, unique run), line `193` (do not rerun), line `200` (tally), line `237` (`b5-rebaseline-r2`). `PART-C.md` §3.3 (item 12 split, `B5` stays closed), §3.4 Phase 2 scope item 5, §4.5.
- Supplementary repository metadata, read-only (`gh run view`, `gh pr view`) for the `SOXL` exploration: run `42524630684` in `UsEquitySnapshotPipelines`, conclusion `success`, created `2026-11-08T21:19:36Z`; `PR #587` merged `2026-11-08T21:18:56Z`. These dates are not in `PART-B.md` or `PART-C.md`; they are added here from the repository's own records and are marked as such.
- [definitions-contract.md](definitions-contract.md) §5.1; [rebase-register.md](rebase-register.md) (historical tally and Table C).
- [dataset.md](dataset.md) §4 (file digests; the data files stay under `~/workspace/quant-s2/yardstick/y2/`).
