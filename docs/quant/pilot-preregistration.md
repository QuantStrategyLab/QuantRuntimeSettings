# Phase 2 YARDSTICK — PILOT Pre-Registration (Policy v0 Research Study)

**Status date:** 2026-11-17
**Pre-registration date:** 2026-11-17 (no `PILOT` run, `PILOT` output or `PILOT` data pull exists at this date; the `PILOT` prerequisites `FUSE` batch 1 and `SHADOW` stage `N` have not run)
**SHA-256 (self-excluding):** `bf40919539cf792919713e2e5518d4e1818dd4b0b74ee06f4b366d0b4055b4aa`
**Amendment (2026-11-17, before any `PILOT` run):** document links to the published Y2 records [dataset.md](dataset.md) and [validation.md](validation.md) added, and the baseline-reproduction caveat in the residuals reworded; no constant, threshold, window or `[P]` value changed. Earlier self-excluding hash of the first version: `c3c2885df3eb1a63464ed65007a960eb603ac2208293f5e9044e5ef6d2eeeed3`.
**Phase:** 2 (`YARDSTICK`, batch `Y3`) — documents only. Pre-registering a study authorizes no code edits, data reads, deployments, paper orders, live orders, or `PILOT` runs; `PILOT` has its own owner approval.
**Registration owner:** `coordinator`
**Related documents:** [frozen-baselines.md](frozen-baselines.md) | [experiment-ledger.md](experiment-ledger.md) | [definitions-contract.md](definitions-contract.md) | [cost-model.md](cost-model.md) | [dataset.md](dataset.md) | [validation.md](validation.md) | [sizing-unit.md](sizing-unit.md) | [rebase-register.md](rebase-register.md) | [decisions-rebase.md](decisions-rebase.md)

## Authorization state

Standing boundaries are unchanged:

- Live trading is fully **OFF**, including the legacy `TQQQ` and `SOXL` strategy bodies.
- Kelly sizing is **research-only**: it is **computed and recorded in every decision and sizes nothing** until a separate Kelly card is signed.
- The stop-loss **return rule** is **OFF**. Loss-based controls (`L0`, `L2`–`L4`) are computed and recorded, and armed nowhere.
- `B_0 = US$50,000` is a notional accounting unit; no funds move.

This file fixes tests, bars and constants **before** any result exists. It states no result, no verdict and no recommendation.

## 1. Provenance marks used in this file

Every constant below carries one mark:

- **`[S]`** — taken from a signed or decided source: the owner decisions (`OWNER-INPUT-C.md`), the signed [definitions-contract.md](definitions-contract.md), [sizing-unit.md](sizing-unit.md) (the `PART-C.md` §4.3 starting values), or `PART-B.md` §2.4 / `PART-C.md` §4.5.
- **`[P]`** — a value this batch had to supply to make a specification complete, because the contract names it as a `Y3` prerequisite or because the source states a rule without its number. These are **executor-proposed** and are put to the coordinator for confirmation. If any `[P]` value is changed before the first `PILOT` run, the change is an amendment under §2 (new version, new hash); the original stays on record.

## 2. Registration, hash and amendment rules

1. **Hash convention.** The SHA-256 in the header is computed over the exact bytes of this file with the 64-character value on the `**SHA-256 (self-excluding):**` line replaced by 64 ASCII zeros (the value it carries in the line above before it is filled in). The recorded date is the pre-registration date in the header.
2. **Verification command** (run from the repository root; prints the recomputed digest, which must equal the header value):

   ```
   python3 -c "import hashlib,re,sys;t=open('docs/quant/pilot-preregistration.md','rb').read();print(hashlib.sha256(re.sub(rb'(\*\*SHA-256 \(self-excluding\):\*\* \`)[0-9a-f]{64}',rb'\g<1>'+b'0'*64,t,count=1)).hexdigest())"
   ```

3. **Ordering.** The hash and date precede every `PILOT` run. A `PILOT` run records this file's hash as an input; a run whose recorded hash differs from the registered one is invalid.
4. **Amendments.** An amendment is a new version of this file with a new hash and date, and a change table at the end. Old versions are kept. An amendment made after the first `PILOT` run started cannot apply to that run.
5. **Trials.** Every variant in §9 is entered in [experiment-ledger.md](experiment-ledger.md) before it runs; the trial count then rises per that ledger's rule. No search beyond the grid in §9 is permitted; no Bayesian optimization.
6. **One calibration step.** The owner chooses tier constants once, from tables computed on the §9 grid. That choice is in-sample and labelled so; its out-of-sample test is the forward shadow record. A later change to any constant is a new policy version with a new clock.

## 3. Constants

### 3.1 Owner decisions and pilot scope

| Constant | Value | Mark | Source |
| --- | --- | --- | --- |
| Notional bankroll `B_0` | `US$50,000` | `[S]` | Owner, decided `2026-11-15` (delegated; changeable by her word) |
| External committed reserve `H` | `0` (undeclared); maximum `3 × E*` if ever declared | `[S]` | Owner decision; [definitions-contract.md](definitions-contract.md) §3.3 |
| Loss budgets `D` | `15%` / `30%` / `50%` | `[S]` | `PART-C.md` §4.3 line 4 |
| Kelly fractions `k` | `1/8` / `1/4` / `1/2` | `[S]` | Line 1; never above one half |
| Pre-`PILOT` maximum-loss caps `M_0(c)` at full cushion | `0.09` / `0.20` / `0.39` | `[S]` | Line 10; `M_0(c) = ln(1 − c) ÷ ln(1 − 0.83)` |
| Pilot instruments | `TQQQ`, `SOXL`, a bill vehicle; long only; no margin, shorts or options | `[S]` | Lines 7–8; `PART-C.md` §4.4 `O5` |
| Decision and trade timing | Decide on the prior close; trade in the regular session only; no extended hours; next-session execution in all simulations | `[S]` | `PART-C.md` §5.1 item 4; [definitions-contract.md](definitions-contract.md) §4.1 |
| Baselines | As frozen in [frozen-baselines.md](frozen-baselines.md) | `[S]` | Y3 deliverable 1 |
| Dataset | Y2 dataset, version hash `19e51a6627c40461fdd80f740798462425769af6ad3cfecad4937003e9320de6` | `[S]` | [experiment-ledger.md](experiment-ledger.md) §4; [dataset.md](dataset.md) |

### 3.2 Tier constants (starting values to be measured at `PILOT`)

Tier names: `CAPITAL_PRESERVATION` / `BALANCED_COMPOUNDING` / `GROWTH_COMPOUNDING`. All values `[S]` from [sizing-unit.md](sizing-unit.md) (`PART-C.md` §4.3). They are starting values, not validated, not recommended, and not optimal. Percentages are of the bankroll unless stated.

| Line | Constant | Conservative | Balanced | Aggressive |
| --- | --- | --- | --- | --- |
| 1 | Kelly fraction `k` (recorded, sizes nothing) | `1/8` | `1/4` | `1/2` |
| 2 | Hard cap on sleeve exposure, × Nasdaq-100 (`x_cap`) | `0.20` | `0.40` | `0.80` |
| 3 | Joint cap, `TQQQ` + `SOXL`, beta-adjusted (`x_joint`) | `0.20` | `0.40` | `0.80` |
| 3a | `SOXL` share of the joint cap, at most | `1/3` | `1/3` | `1/3` |
| 3b | `SOXL` beta `β_SOXL = max(β_fall, 1.5)`; `1.5` is a placeholder to be measured | `1.5` floor | `1.5` floor | `1.5` floor |
| 4 | Loss budget `D` from the flow-adjusted high-water mark | `15%` | `30%` | `50%` |
| 4a | Amber at `D/3`: notify and lock parameters against loosening | `5%` | `10%` | `16.7%` |
| 4b | Red at `2D/3`: no new risk, latched | `10%` | `20%` | `33.3%` |
| 4c | Exhausted at `D`: sleeve to zero, latched | `15%` | `30%` | `50%` |
| 5 | One-session loss that halts new risk (`D/10`) | `1.5%` | `3%` | `5%` |
| 6 | No-trade band; one-way turnover budget a year | `20%`; `50%` | `20%`; `100%` | `20%`; `200%` |
| 7 | Unallocated capital | Bills of three months or less, or a bill fund; no credit or duration risk | same | same |
| 8 | Margin, shorts, options | never | never | never |
| 9 | Bankroll | One sizing unit, US dollars; `H = 0` | same | same |
| 10 | Maximum-loss cap at full cushion, before `PILOT` (`M_0`) | `0.09` | `0.20` | `0.39` |
| 11 | Kelly ceiling, illustrative, recorded only | `0.11` | `0.23` | `0.46` |
| 12 | Maximum combined fund weight in the account (binds only if `H > 0`) | `15%` | `35%` | `60%` |
| 13 | Volatility target `σ_target`, annualized | `5%` | `10%` | `19%` |
| 14 | Growth a class `K` item may cost (`π_K` ceiling) | `20%` | `15%` | `10%` |
| 15 | Latched trips a year accepted (`λ_trip` ceiling) | `1` | `2` | `3` |

Checks of the arithmetic carried from the sources: `M_0(0.15) = 0.092`, `M_0(0.30) = 0.201`, `M_0(0.50) = 0.391`, which round to line 10.

## 4. The sizing stack as pre-registered

The stack is the one signed in [definitions-contract.md](definitions-contract.md) §4 and is not restated in full. What this file fixes for `PILOT`:

| Step | Quantity | `PILOT` treatment |
| --- | --- | --- |
| 1 | Strategy target `s ∈ [0, 1]` per fund | Output of the frozen baseline, with its internal trend and volatility layers ([frozen-baselines.md](frozen-baselines.md)) |
| 2 | Hard cap `x_cap` | Line 2; applied |
| 3 | Maximum-loss cap `x_ML(c) = min(3c, 2c, M(c))` | Applied. `M` starts as `M_0`; `PILOT` replaces it with the measured `M` per §6, granting de-risking credit **only** to rules adopted at the class `K` bar. `M` can never exceed bounds `(a)` and `(b)`. |
| 4 | Kelly ceiling `x_K^struct`, `x_K^cond` | **Computed and recorded in every decision, with a would-have-bound flag and the exposure that would have resulted. Sizes nothing.** The shrinkage rule is §7. |
| 5 | Volatility scalar `v` | Applied **only if** adopted at the class `K` bar in `PILOT`; otherwise recorded. Two shapes tested (§9). Missing volatility data fails closed as in the contract (§4.1 step 5). |
| 6–7 | Fund exposure and joint cap | As signed, including the combined-sleeve reading of `OQ-1` (effective joint cap `min(x_joint, x_ML(c))`) |
| 8–9 | Translation, band, whole shares, fee check | Next-session execution, whole shares, cost model of [cost-model.md](cost-model.md). A reduction demanded by steps 2, 3 or 7, or by a breaker, is never delayed by the band. |
| 10 | Control layer | Computed as "would have" states; armed nowhere |

Daily-reset decay is an outcome of the return series and is never charged as a separate cost line ([cost-model.md](cost-model.md) §1).

## 5. Class bars

Bars follow `PART-B.md` §2.4. Numeric values are `[S]` where `PART-C.md` §4.5 gives them and `[P]` otherwise.

| Class | Item rows in `PILOT` | Adopt requires | Reject on | Marks |
| --- | --- | --- | --- | --- |
| **K** — risk-reducing scalar | `Q2-4` volatility scaling; `Q2-5` drawdown-scaling shape; `Q3-1(a)` credit question | (1) The stress-loss measures (maximum drawdown and worst `20`-session loss, [definitions-contract.md](definitions-contract.md) §2.5) are lower than the matched baseline in **every** stress scenario of §6 and in **at least two thirds** of walk-forward windows `[S]`; the reduction must be at least `10%` relative to the baseline's value in each scenario `[P]`. (2) Non-inferiority: class `K` growth cost `π_K` inside line 14 `[S]`; where `g_ann^{base} ≤ 0`, the raw difference `Δg_ann` is reported instead ([definitions-contract.md](definitions-contract.md) §5.2). (3) Latched trips inside line 15 and turnover inside line 6 `[S]`. Walk-forward windows: non-overlapping blocks of `252` sessions, the last block dropped if shorter `[P]`. | No stress-loss reduction; growth cost above the premium; trips above the budget | Mixed |
| **C** — control | `Q5-1`, `Q5-3` (specified in `FUSE`, not decided here); `L0`, `J1` as limits | Independent of the strategy process; deterministic; passes the synthetic trip matrix; fails closed; read-back; human re-arm. No statistical bar. | Cannot be made independent, or trips falsely on flows or corporate actions in a way that cannot be cured | `[S]` |
| **S** — sizing | `Q2-3` Kelly ceiling with shrinkage | `PILOT` **reports** how often the ceiling would bind and how far it moves when its inputs move by one standard error; month-to-month stability needs a forward record. Expected end state at this stage: insufficient. Research-only whatever the result. | It never binds, or its output is dominated by estimation noise | `[S]` |
| **M** — measurement | `Q3-2` expected shortfall as the loss measure | One written definition (§6.3), reproduced by an independent reviewer from the dataset; labelled an estimate and tied to its scenario set | Not rejected on merit; ends as insufficient with named missing data | `[S]` |
| **P** — preference | `Q2-6` no-trade band; `Q2-7` tiers and glide path | `Q2-6`: the narrowest of the three widths whose annual cost is inside the tier's budget `[S]`. `Q2-7`: an owner decision, published with its expected range of outcomes. | Not applicable | `[S]` |
| **R** — return-seeking | **None in `PILOT`.** Plugins (`Q6-1`) follow after `PILOT`. | Reserved for later: one pre-registered test against the frozen baseline on the same data and costs; paired net-log-growth difference positive and clearing a bar corrected for `K_trials` from the ledger; synthetic and real-fund buckets reported separately with the same sign; drawdown inside the tier ceiling; twelve months of forward record with the same sign | Net difference not positive in either bucket; positive only before costs; sign reverses when any single crisis is removed; unstable across neighbouring parameters | `[S]` |

**End states.** Each `PILOT` item ends as one of: recommend-adopt, reject, insufficient with named missing data. Nothing is switched on. Each adoption recommendation needs its own owner card and admits the item to the next shadow policy version only.

**Reporting rule.** Every result table reports net log growth, maximum drawdown and time to recover, with ranges, in two separate buckets: the modelled synthetic history and real-fund history ([definitions-contract.md](definitions-contract.md) §2.4–2.5). The probability of breaching `D` within ten years is stated by simulation, with its horizon. The smallest workable bankroll per tier is stated as the bankroll at which annual fixed trading costs are below one tenth of the tier's expected excess growth in dollars `[S]`.

## 6. Stress scenario set

The set defines `M(c)` and is the same for every item. All scenarios are run with the full policy, next-session execution and full model costs.

### 6.1 Historical crisis paths on the synthetic `3×` history

Each window is fixed by rule on the Y2 index total-return series (`idx_tr_index`): the peak is the maximum inside the peak-search range; the trough is the minimum between the peak and the trough-search end. The rule is `[S]` as to the four named crises and `[P]` as to the search ranges. The windows below were computed by that rule from the dataset of version hash `19e51a66…320de6` (descriptive output of the rule; it involves no strategy and is not a trial):

| ID | Crisis (`[S]`) | Peak-search range `[P]` | Trough-search end `[P]` | Nasdaq-100 peak → trough (sessions) | Semiconductor index peak → trough (sessions) |
| --- | --- | --- | --- | --- | --- |
| `S1` | `2000–02` | `1999-01-01` to `2000-12-31` | `2002-12-31` | `2000-03-27` → `2002-10-07` (`634`) | `2000-03-10` → `2002-10-09` (`647`) |
| `S2` | `2008` | `2007-01-01` to `2008-06-30` | `2009-06-30` | `2007-10-31` → `2008-11-20` (`267`) | `2007-07-17` → `2008-11-20` (`342`) |
| `S3` | `February–March 2020` | `2020-01-01` to `2020-03-31` | `2020-04-30` | `2020-02-19` → `2020-03-20` (`22`) | `2020-02-19` → `2020-03-18` (`20`) |
| `S4` | `2022` | `2021-07-01` to `2022-03-31` | `2022-12-31` | `2021-12-27` → `2022-10-14` (`202`) | `2021-12-27` → `2022-10-14` (`202`) |

Pass criterion per scenario: the policy's bankroll loss over the window is no larger than the current cushion `c`. Qualifications that apply to results: `S1` and the early part of `S2` for the semiconductor index fall inside the modelled `Path C` segment (before `2009-12-22`), the Nasdaq-100 `S1` window starts after its native total-return series begins (`1999-03-04`); the `3×` series are modelled; the dataset is an as-retrieved reconstruction, not point-in-time inputs. A result built on these windows is not real-fund evidence.

### 6.2 One-day gap

A single-session fall of `25%` in the underlying index (`−75%` in a `3×` fund) `[S]`, applied from the policy's position at the start of the session. Pass criterion: loss no larger than `c`. `M` can never exceed the bound `x ≤ 2c` that this scenario encodes at half the cushion.

### 6.3 Expected shortfall on bootstrap paths

- Paths of `250` sessions `[S]`, built by a circular block bootstrap of daily underlying-index excess returns from the full Y2 index series with block length `20` sessions `[P]`, `10,000` paths `[P]`, random seed `20261117` `[P]`.
- Each path is re-centred so that its annualized mean excess return equals the shrunk mean `μ_shrunk` of §7 `[S]`, by subtracting a constant from every daily return in the sample before resampling `[P]`.
- The path loss is the maximum drawdown of the policy's bankroll over the path, measured from the running high-water mark starting at the initial bankroll `[P]`.
- `ES_0.975` is the mean of the worst `2.5%` of path losses `[S]` (rounded up to a whole number of paths). Pass criterion: `ES_0.975 ≤ c`.

### 6.4 How `M` is obtained

`M(c)` is the largest index-equivalent exposure on a grid of `0.01` steps at which all of `S1`–`S4`, the gap and the `ES_0.975` criterion hold `[P]`. `M(c)` replaces `M_0(c)`, can never exceed bounds `(a)` and `(b)`, and is computed per tier at full cushion and at the cushion levels used in the published tables.

## 7. Shrinkage rule

The structural Kelly ceiling is `x_K^struct = k × max(0, μ_shrunk ÷ σ_long²)`, computed on the **underlying-index** excess total-return series, never on `3×` fund returns or portfolio returns ([definitions-contract.md](definitions-contract.md) §4.1 step 4). The conditional form multiplies by `min(1, (σ_long ÷ σ_forecast)²)` and is never larger.

The contract names the prior, the shrinkage weight and the volatility-forecast estimator as prerequisites settled in this file. They are:

| Item | Specification | Mark |
| --- | --- | --- |
| Shrunk mean | `μ_shrunk = μ_post − s_post`: the posterior mean less one posterior standard deviation of the annualized excess return of the underlying index over the risk-free bill rate | `[S]` |
| Model | Normal prior, normal likelihood for the annualized mean daily excess return; unknown variance replaced by the long-run sample variance | `[P]` |
| Prior | Centred on a broad-equity premium of `5.0%` a year with prior standard deviation `3.0%` a year, **not** centred on the Nasdaq's own history | centring `[S]`; values `[P]` |
| Shrinkage weight | Implied by the prior and the data: weight on the sample mean `= (n ÷ σ²) ÷ (n ÷ σ² + 1 ÷ s_0²)`, with `n` the sample length in years, `σ` the long-run annualized volatility and `s_0 = 3.0%`. The weight is reported with every estimate. | `[P]` |
| Sample for the likelihood | The full Y2 series for the relevant index, using only data up to the decision date in any shadow or forward use | `[P]` |
| Not fitted | Prior values are fixed here, before any `PILOT` computation, and are not tuned to the dataset | `[S]` |
| Reference haircut | The simpler one-standard-error haircut of `PART-C.md` §3.2 is also computed and recorded beside it (illustrative `μ ≈ 5.25%` a year at `σ ≈ 24%` giving `0.11 / 0.23 / 0.46`); it is a recorded comparison, not a second rule | `[S]` |
| `σ_long` | Annualized centred standard deviation of daily index returns over the full series, `√252 × s_daily` ([definitions-contract.md](definitions-contract.md) §1.3) | `[S]` |
| `σ_forecast` | Exponentially weighted estimate of the daily index variance, decay `0.94`, seeded with the sample variance of the first `20` sessions, annualized by `√252`; a missing, `NaN` or stale value is replaced by the larger of the last valid value and the stress default, and increases are blocked (`O1`) | `[P]` |
| Sensitivity | `PILOT` reports how far each ceiling moves when `μ` moves by one standard error | `[S]` |
| Diagnostics | Win rate (with a Bayesian interval) and payoff ratio are recorded monthly; **no sizing step reads them** | `[S]` |

## 8. Trip-frequency table: specification

`PILOT` publishes one table, per tier and per row, of how often each breaker would latch. It is a calibration table against line 15, not a performance claim.

- **Rows.** The loss and vehicle rows of `PART-C.md` §4.4 that can be simulated from the dataset: `L1`, `L2`, `L3`, `L4`, `L5`, `L6`, `V1`, `V2`, `V4`, and `L0` and `J1` as limits (reported as the share of sessions in which they bind). `V5` and `V6` are diagnostics (counted, not latched). `V3`, `V7` and `O1`–`O9` depend on issuer notices, quotes, operations and the broker; they are **not measurable** on this dataset and are verified by the synthetic trip matrix instead, with the expected state written down in advance and exact agreement as the pass criterion.
- **Unit.** Latch transitions per year on a `252`-session basis; consecutive sessions inside an active latch do not add ([definitions-contract.md](definitions-contract.md) §5.2). Interlocks are counted separately from breakers and are not charged against line 15.
- **Buckets, reported separately and never pooled:** (a) the modelled synthetic history (`1985-01-31` onward for the Nasdaq-100, `1994-05-04` onward for the semiconductor index, to `2026-11-13`); (b) real-fund history (`TQQQ` from `2010-02-09`, `SOXL` from `2010-03-11`, to `2026-11-13`). `V1` and `V2` use bucket (b) only, because they compare a real fund with its index or replay its actual splits.
- **Statistics per cell:** count, mean trips a year over the bucket, the yearly minimum and maximum, and the trips inside each scenario of §6.1.
- **Comparison.** Each tier's total breaker rate is compared with line 15 (`1 / 2 / 3` a year). The result is reported as inside or outside, with the cells that drive it; no constant is changed by this comparison inside `PILOT` (§2 item 6).
- **Policy states.** Rows are computed for the full policy and for the baseline alone, so that a trip caused by the stack can be told apart from one caused by the strategy body.

## 9. Pre-registered trial slots (the grid; nothing beyond it)

Each slot is entered in [experiment-ledger.md](experiment-ledger.md) as `REGISTERED` before it runs and counts from the moment it starts. Tier is part of the slot because the tier changes the constants the evaluation uses.

| Group | Item | Variants | Tiers | Slots |
| --- | --- | --- | --- | ---: |
| `P-A` | `Q2-4` volatility scalar shape | linear `min(1, σ_target ÷ σ)`; squared `min(1, (σ_target ÷ σ)²)` | `3` | `6` |
| `P-B` | `Q2-5` drawdown-scaling shape | proportional cushion rule; the existing step brake (levels to be bound from the envelope document and recorded, with its file hash, before the slot starts) | `3` | `6` |
| `P-C` | `Q2-6` no-trade band width | `10%`, `20%`, `30%` of target weight | `3` | `9` |
| `P-D` | `Q3-1(a)` diversification credit | one test: credit only if the upper bound of the semiconductor-index tail correlation with the Nasdaq-100 is below `0.7`; otherwise refused | — | `1` |
| | **Total planned** | | | **`22`** |

Not counted as trials, per [experiment-ledger.md](experiment-ledger.md) §6: the Kelly ceiling reports (`Q2-3`), the stress-window rule outputs, the measurement of `β_fall` and tail correlation as descriptive inputs, and determinism or reproduction checks. If every slot is started, `K_trials` goes from `23` to `45`.

## 10. Limits and open items

- The `[P]` values (§1) are executor-proposed and await coordinator confirmation. Changing one is an amendment.
- The step-brake levels for `P-B` and the envelope document's hash are not fixed here; they are to be bound and recorded before that slot starts.
- The baselines' recorded performance targets were **not** reproduced in `Y3` ([frozen-baselines.md](frozen-baselines.md) §5.4). The acceptance statement that replay reproduces recorded targets is met for allocation targets only. This permits writing the draft research specification only; it does not make `Y3` accepted or `PILOT` ready to run, and it is reported to the coordinator.
- The Y2 dataset carries the qualifications recorded in [experiment-ledger.md](experiment-ledger.md) §4 and in [dataset.md](dataset.md) and [validation.md](validation.md); the in-sample calibration and failed holdout checks recorded there are not restated as passes. In particular, the `3×` series are models, the `SOXL` series is a market-close proxy with an unverified NAV criterion, and nothing here treats the synthetic history as real fund history.
- `K_trials = 23` is a floor (see [experiment-ledger.md](experiment-ledger.md) §7); related trial records in the strategy repository are not counted.
- Nothing in this file is a verdict on `TQQQ`, `SOXL` or any tier.

## Sources

- `OWNER-INPUT-C.md` (decision of `2026-11-15`: `B_0`; boundary and `H`), `PART-C.md` §3.2, §4.2, §4.3, §4.4, §4.5, §5.1 item 4, and `PART-B.md` §2.4, §2.6 (`~/workspace/quant-s2/fable-roadmap/`).
- [definitions-contract.md](definitions-contract.md) (signed `2026-11-16`) §1.3, §2.4–2.5, §3.3, §4, §5; [cost-model.md](cost-model.md); [sizing-unit.md](sizing-unit.md).
- Y2 dataset under `~/workspace/quant-s2/yardstick/y2/data/` (version hash in [experiment-ledger.md](experiment-ledger.md) §4); stress windows computed by `scripts/stress_windows.py` in `~/workspace/quant-s2/yardstick/y3/` (script SHA-256 `2836446de07f181d91facbd63dbd2920c4715d9358772569f95e108a2821b114`, output SHA-256 `5905d83d9d093b98a8d46945064717300e5b79d9ed347972553e1d7a48e42238`).
