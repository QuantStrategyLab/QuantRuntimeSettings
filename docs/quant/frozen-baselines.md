# Phase 2 YARDSTICK — Frozen Baselines for the Pilot Sleeve

**Status date:** 2026-11-17
**Phase:** 2 (`YARDSTICK`, batch `Y3`) — documents only. Freezing baselines authorizes no code edits, production reads, deployments, paper orders, or live orders.
**Baseline owner:** `coordinator` (`Q4-3`, apparatus; the baselines are identified here, not judged)
**Related documents:** [experiment-ledger.md](experiment-ledger.md) | [pilot-preregistration.md](pilot-preregistration.md) | [definitions-contract.md](definitions-contract.md) | [cost-model.md](cost-model.md) | [rebase-register.md](rebase-register.md) | [decisions-rebase.md](decisions-rebase.md) | [sizing-unit.md](sizing-unit.md)

## Authorization state

Standing boundaries are unchanged:

- Live trading is fully **OFF**, including the legacy `TQQQ` and `SOXL` strategy bodies described here.
- Kelly sizing is **research-only** and **computed-not-applied**.
- The stop-loss **return rule** is **OFF**.
- **Owner exception (2026-11-17):** the owner waived the replay-acceptance requirement for both selected baselines in this PR, on the coordinator's recommendation (PR #1188, comment `6930818496`). Both recorded performance targets (`T-B`, `S-B`) stay **performance-unverified**: neither is reproduced, and neither is a reproduction of the selected body. The exception is bound to the two baseline identities and the current `Y3` scope, and it amends the `Y3` documents-acceptance record only. It does **not** authorize `PILOT`, trading, data collection or deployment; `PILOT` permission remains separate and is not granted by this acceptance.
- This document records **identity, composition and reproduction evidence**. It contains no verdict on either strategy, no parameter recommendation and no return claim. Where a number from a replay appears, it is a reproduction check against a figure the repository already records, and it is not evidence of merit.

## 1. What "frozen baseline" means here

A frozen baseline is the strategy body that `PILOT` tests are paired against (`PART-C.md` §4.2 step 1: "output of the frozen baseline strategy body, with its internal trend and volatility rules"). The exact strategy commit, defining-file identities, canonical default-configuration identities and declared layer composition are frozen in the protected identity manifest for baseline references B-TQQQ and B-SOXL; these public references are opaque labels, not hashes or truncated source identifiers. Changing a referenced object creates a new baseline version. The four identifiers are:

1. the commit SHA of the strategy repository;
2. the exact file paths that define the strategy body, each with its git blob SHA-1 and file SHA-256 at that commit;
3. the default configuration the body runs with, as a canonical-JSON SHA-256 (the canonicalization is defined in §2.3 and is this document's own definition);
4. the de-risking layers present in that body (`PART-B.md` §2.6 item 5: trend rule, volatility rule, `vol_scale`, `dd_scale` and any risk-reducing plugin act in the same states and must be declared as a stack).

A baseline is never a moving branch. Any later change to a listed file is a new baseline with a new identity, and it does not rewrite this record.

## 2. Source, access and version identity

### 2.1 Source and access

| Item | Value |
| --- | --- |
| Repository | Protected strategy-source manifest |
| Default branch | `main` |
| Access | Read-only clone into scratch space under `~/workspace/quant-s2/yardstick/y3/ues/`; no write, no worktree inside the `QuantRuntimeSettings` worktree. A `git status --short` of the clone after all runs was empty. |
| Retrieved | `2026-11-17` |
| Commit pinned | `SRC-C1` (commit subject and commit time are recorded in the protected manifest) |
| Release tag at this commit | **None.** `pyproject.toml` declares version `0.7.60`; the highest semantic-version tag is `SRC-T3` (commit `SRC-C2`, `2026-06-04`), which is `720` commits behind the pinned commit. `git describe` resolves to `SRC-D1`, a research tag, not a release. Neither the declared version nor any tag identifies this commit, so the **commit SHA is the version identity**. |
| Python environment for replay | `Python 3.12.3`, `pandas 3.1.1`, `numpy 2.5.5`, `pytest 9.2.0`, `pandas_market_calendars 5.6.1`, `quant-platform-kit` at `SRC-C3` (the pin in the repository's `pyproject.toml`), in a venv under `~/workspace/quant-s2/yardstick/y3/venv/`. The repository declares `pandas>=2.0`; `3.1.1` satisfies it but is not the version the repository's CI is stated to use (not verified). |

### 2.2 Candidates found and the selection rule

Neither pilot strategy has a single obvious version in the repository. The candidates found, and the rule used, are recorded so that the choice is visible and reversible by the owner.

**Selection rule (this document's own rule, applied identically to both strategies):** the baseline is the strategy body that the legacy `TQQQ` / `SOXL` paths run, taken as the profile flagged `runtime_enabled` for that symbol in `docs/us-equity-strategy-status.md` (and `status="runtime_enabled"` in `src/us_equity_strategies/catalog.py`), with the catalog default configuration. Research candidates, shadow combinations, offline typed baselines, option overlays and plugin sidecars are excluded as the baseline. This rule is chosen because the phase brief's baseline is "the strategy body with its internal trend and volatility rules", and because the owner's boundary describes the legacy bodies as the thing currently OFF.

| Strategy | Candidate | Status in repository | Selected |
| --- | --- | --- | --- |
| `TQQQ` | `tqqq_growth_income` (`strategies/tqqq_growth_income.py`, with the pure decision core `strategies/tqqq_dual_drive_core.py`) | `runtime_enabled`; handbook role "TQQQ growth + income" | **Yes** |
| `TQQQ` | `tqqq_growth_income_research_baseline_v1` (`research/tqqq_typed_baseline_result.py`): fixed `SMA200` rule, controls disabled, `0` transaction cost, typed Yahoo-snapshot input | Research reference | No. It contains no de-risking layers, so it cannot serve as the frozen body of `PART-B.md` §2.6 item 5. It is identified here as a possible **layer-free comparator** only. |
| `TQQQ` | Tag `SRC-T2` (commit `SRC-C4`) | Research adapter | No. What this tag freezes was not established in this batch. |
| `TQQQ`+`SOXL` | `us_equity_combo_leveraged_shadow_352045`, `..._402040` | `shadow_candidate`; combined weights, not a per-strategy body | No |
| `SOXL` | `soxl_soxx_trend_income` (`strategies/soxl_soxx_trend_income.py`) | `runtime_enabled`; handbook role "SOXL/SOXX semiconductor trend + income" | **Yes** |
| `SOXL` | `soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve` ("V7", `v7_soxl_profile.py`, recorded configuration identity `CFG-V7`) | `runtime_enabled=false` research/shadow candidate; the repository states it is **not** the live `SOXL` and that the earlier real-data studies (`R6`–`R9`) used V7, "cannot be used as the live SOXL return series" (`docs/research/fractional-kelly-preregistration.zh-CN.md`) | No |
| `SOXL` | `soxl_v7_strict_derisk_only_v1` (candidate commit `SRC-C5`) | Pre-registered 20-session forward observation, collection not activated | No |
| `SOXL` | `soxl_soxx_typed_baseline_result.py` | Offline typed baseline | No (same reason as the `TQQQ` typed baseline; not inspected beyond its header and tests) |

**Ambiguities flagged (also in the summary of this batch):**

1. No release tag identifies the pinned commit; the commit SHA stands in for a version.
2. For `SOXL`, two bodies are both described as the "frozen" `SOXL` in repository records (the live profile and V7). The live profile is selected by the rule above; if the owner reads "the `SOXL` baseline" as V7, §4 must be redone. The two differ in core weights (live `0.70 / 0.65 / 0.20`, redirect to `SOXX`; V7 `0.35 / 0.25 / 0.25`, redirect to `BOXX`), in the income layer (live on, V7 off) and in market-regime handling.
3. The repository's own forward pre-registration states that the **deployed effective configuration** of the live `SOXL` profile, its policy, installed versions and plugin order are not bound to immutable references ("`NOT_COMPARABLE`" until bound; its rebuilt comparator is labelled `REBUILT_FROM_PARTIAL_NON_CANONICAL`). The baselines below are therefore **the repository defaults at the pinned commit**, not a verified copy of what any deployment ran.

### 2.3 Configuration identity

The configuration identity is the SHA-256 of the canonical JSON of `STRATEGY_DEFAULT_CONFIG[<profile>]` in `catalog.py`: keys sorted, separators `,` and `:`, tuples as arrays, no NaN, one trailing line feed. This canonicalization is defined by this document; it is **not** the canonicalization behind the repository's recorded V7 hash. Four plausible serializations of the V7 config were tried and none reproduces the recorded V7 hash (`CFG-V7`); V7 is not a selected baseline, so this was not pursued (see §6).

## 3. Baseline B-TQQQ: `tqqq_growth_income`

### 3.1 Identity

| Item | Value |
| --- | --- |
| Repository commit | `SRC-C1` |
| Profile | `tqqq_growth_income` (display "TQQQ Growth Income"; `module_path = us_equity_strategies.strategies.tqqq_growth_income`) |
| Default configuration (`47` keys), protected identity reference | `CFG-TQQQ` |
| Note | The catalog default has `dual_drive_macro_risk_governor_enabled = True`; the bundled manifest default (`manifests/__init__.py`) omits that key (`46` keys). The strategy function's own default for that parameter is also `True` (`strategies/tqqq_growth_income.py`), so the effective value is identical. Recorded as a catalog/manifest inconsistency, not corrected. |

Defining files (all relative to the repository root). Each protected identity reference resolves in the protected manifest to the git blob SHA-1 (from `git rev-parse <commit>:<path>`) and the SHA-256 of the file bytes at the pinned commit:

| Path | Protected identity reference |
| --- | --- |
| `src/us_equity_strategies/strategies/tqqq_growth_income.py` | `DF-01` |
| `src/us_equity_strategies/strategies/tqqq_dual_drive_core.py` | `DF-02` |
| `src/us_equity_strategies/catalog.py` (default configuration, metadata, status) | `DF-03` |
| `src/us_equity_strategies/volatility_delever_retention.py` (retention policy `tqqq_step_softzero_0.25_0.50`) | `DF-04` |
| `src/us_equity_strategies/income_layer_defaults.py` (income-sleeve defaults) | `DF-05` |

### 3.2 De-risking layers contained (declared stack for `PART-B.md` §2.6 item 5)

Values are the catalog defaults at the pinned commit.

| Layer | Present | Specification at the pin |
| --- | --- | --- |
| Strategy-internal trend rule | **Yes** | `QQQ` price against its `200`-session average (latched: risk stays active until price falls below it; entry also requires a positive `20`-session-average slope, `dual_drive_require_ma20_slope = True`). A separate pullback re-entry branch is enabled (`dual_drive_allow_pullback = True`, rebound window `20`, volatility-scaled threshold with multiplier `2.0`). |
| Strategy-internal volatility rule | **Yes** | `5`-session realized volatility; rolling-percentile threshold (lookback `252`, percentile `0.90`, minimum periods `126`, floor `0.24`, cap `0.36`); exit threshold `0.28` (hysteresis); a rebound-context veto (`dual_drive_volatility_delever_taco_veto_enabled = True`). On trigger, the leveraged leg is reduced and redirected to the unlevered leg. |
| Retention of the leveraged leg after a volatility trigger | **Yes, context-dependent** | `retention_mode = environment`, policy `tqqq_step_softzero_0.25_0.50`, maximum retention `0.50`, `retention_context_required = True` (read from a `market_regime_control` context supplied by the platform; behaviour with no context was not exercised). |
| Macro risk governor | **Yes (enabled)** | `dual_drive_macro_risk_governor_enabled = True`; routes `delever` and `crisis` scale the leveraged and risk legs when a governor context is supplied. |
| Crisis defense | **Yes (enabled)** | `dual_drive_crisis_defense_enabled = True`; a true-crisis context sends the target to `BOXX` / reserve. |
| Market-regime control | **Yes (enabled)** | `market_regime_control_enabled = True`; position effects (`risk_reduced`, `risk_off` routes) apply only when an authorized position-control context is supplied. |
| Cash reserve | **Yes** | `dual_drive_cash_reserve_ratio = 0.02`; `cash_reserve_ratio = 0.02`. |
| Account-level `vol_scale` / `dd_scale` | **No** | Not in this strategy body. They belong to the sizing stack ([pilot-preregistration.md](pilot-preregistration.md) §4, steps 3 and 5) and to the separate risk composer and envelope; the pilot applies them on top of this baseline. |
| Risk-reducing plugin | **No** | The `crisis_response_shadow` plugin is recorded as defense-only observation with no allocation impact; `ai_extensions` default is `enabled = false`, `mode = off`. Neither is part of the baseline. |
| Additive income sleeve | **Present in the profile defaults; not a de-risking layer** | `income_layer_enabled = True`, ratio mode `log_total_drawdown_budget`, start `250000` USD, maximum ratio `0.55`. It changes exposure above the stated equity and is **inert below it** at the pilot's `B_0 = US$50,000` (the activation threshold is a catalog value, read from the defaults; interaction with a pilot sleeve was not tested). |
| Option overlays | **No** | `option_*` flags are off by default; the `LEAPS` recipes are `research_only` and skipped. |

Instruments in the defaults: leveraged `TQQQ`, unlevered `QQQM`, parking `BOXX`, and the income basket (`SCHD`, `DGRO`, `SGOV`, `SPYI`, `QQQI`).

### 3.3 Recorded targets the baseline claims

| ID | Recorded target | Where recorded |
| --- | --- | --- |
| `T-A` | Default allocation in a risk-on state: `45%` leveraged `TQQQ`, `45%` unlevered `QQQM`, `8%` `BOXX`, `2%` cash. | `docs/us-equity-strategy-status.zh-CN.md` (profile table, row `tqqq_growth_income`); code constants `dual_drive_tqqq_weight = 0.45`, `dual_drive_qqq_weight = 0.45`, `dual_drive_cash_reserve_ratio = 0.02`. |
| `T-B` | Performance record for the "executable approximation" `video_like_pullback_next_close` over `2017-01-03` to `2026-04-10` at `5` bps one-way: CAGR `33.96%`, maximum drawdown `-31.48%`. The handbook states that the current default adds a dynamic volatility threshold to that approximation, so the figure is "approximate evidence". **Status: performance-unverified** (owner exception of `2026-11-17`, finding `F1`). | `docs/us-equity-strategy-status.zh-CN.md` (evidence table); artifact named there: `InteractiveBrokersPlatform/research/results/video_qqq_tqqq_dual_drive_comparison.csv` (another repository, not in the clone). |

## 4. Baseline B-SOXL: `soxl_soxx_trend_income`

### 4.1 Identity

| Item | Value |
| --- | --- |
| Repository commit | `SRC-C1` |
| Profile | `soxl_soxx_trend_income` (display "SOXL/SOXX Semiconductor Trend Income"; `module_path = us_equity_strategies.strategies.soxl_soxx_trend_income`) |
| Default configuration (`50` keys; catalog and manifest defaults agree), protected identity reference | `CFG-SOXL` |

Defining files (protected identity references resolve as in §3.1):

| Path | Protected identity reference |
| --- | --- |
| `src/us_equity_strategies/strategies/soxl_soxx_trend_income.py` | `DF-06` |
| `src/us_equity_strategies/catalog.py` (default configuration, metadata, status) | `DF-03` |
| `src/us_equity_strategies/volatility_delever_retention.py` (retention policy `soxl_step_rebound_0.25_0.50`) | `DF-04` |
| `src/us_equity_strategies/income_layer_defaults.py` | `DF-05` |
| `src/us_equity_strategies/backtest/soxl_trend_simulator.py` (the repository's core-only replay harness, used in §5) | `DF-07` |

### 4.2 De-risking layers contained

| Layer | Present | Specification at the pin |
| --- | --- | --- |
| Strategy-internal trend rule | **Yes** | `SOXX` price against its `140`-session average with buffers: entry `0.08`, mid `0.06`, exit `0.02`; the gate selects one of three tiers (`full`, `mid`, `defensive`). |
| Tiered exposure | **Yes** | `full`: `SOXL 70%`, `SOXX 20%`; `mid`: `SOXL 65%`, `SOXX 20%`; `defensive`: `SOXL 0%`, `SOXX 15%`; the remainder to `BOXX`. Cash reserve `0.03`. |
| Overbought caps | **Yes** | RSI cap (threshold `70`, dynamic threshold enabled), Bollinger cap enabled, overlay stack triggers enabled (a tier is downgraded per trigger). |
| Strategy-internal volatility rule | **Yes** | `SOXX` `10`-session realized volatility; rolling-percentile threshold (lookback `252`, percentile `0.95`, minimum periods `126`, floor `0.50`, cap `0.75`; fixed fallback `0.55` when the sample is short). On trigger the `SOXL` leg is reduced and redirected to `SOXX`. |
| Retention after a volatility trigger | **Yes, context-dependent** | `retention_mode = environment`, policy `soxl_step_rebound_0.25_0.50`, maximum retention `0.50`, `retention_context_required = True`. |
| Market-regime control | **Yes (partial)** | `market_regime_control_enabled = True`, `apply_risk_off = True`, `apply_risk_reduced = False`. |
| Account-level `vol_scale` / `dd_scale` | **No** | As for `TQQQ`. |
| Risk-reducing plugin | **No** | Not part of the baseline. |
| Additive income sleeve | **Present in the profile defaults; not a de-risking layer** | `income_layer_enabled = True`, start `150000` USD, maximum ratio `0.95`. The repository's core-only replay harness switches it off. |
| Option overlays | **No** | Off by default. |

Instruments in the defaults: leveraged `SOXL`, unlevered `SOXX`, parking `BOXX`, and the income basket.

### 4.3 Recorded targets the baseline claims

| ID | Recorded target | Where recorded |
| --- | --- | --- |
| `S-A` | Core tier weights: `SOXL 0.70` (full) / `0.65` (mid), active `SOXX 0.20`, defensive `SOXX 0.15`, reserve `3%`, volatility trigger redirects to `SOXX`. | `docs/research/fractional-kelly-preregistration.zh-CN.md` (live-versus-V7 comparison); code constants in `catalog.py`. |
| `S-B` | Daily replay of the profile, `100k` initial equity, `5` bps, `2024-01-31` to `2026-05-04`: CAGR `98.03%`, maximum drawdown `-39.29%`; "the income layer participates gradually once equity passes `150k`". **Status: performance-unverified** (owner exception of `2026-11-17`, finding `F2`). | `docs/us-equity-strategy-status.zh-CN.md` (evidence table); artifact named there: `UsEquitySnapshotPipelines/data/output/soxl_soxx_trend_income_archive_2026-05-04/summary.csv` (another repository, not in the clone). |

## 5. Replay evidence

All replay work ran from scripts kept outside the clone, in `~/workspace/quant-s2/yardstick/y3/scripts/`, writing outputs to `~/workspace/quant-s2/yardstick/y3/evidence/`. The clone was not modified (`git status --short` empty after every run; `PYTHONDONTWRITEBYTECODE=1`, `-p no:cacheprovider`).

### 5.1 Research dataset used

The research dataset is the Y2 dataset under `~/workspace/quant-s2/yardstick/y2/data/`. Its version identifier for this batch is the dataset-version reference `Y2-DATA-1` (resolution in [experiment-ledger.md](experiment-ledger.md) §4; per-file references in [dataset.md](dataset.md) §4). The files read by the replays:

| File | Protected identity reference |
| --- | --- |
| `soxl_daily.csv` | `Y2-DATA-1/F5` |
| `semi_index_daily.csv` | `Y2-DATA-1/F4` |
| `risk_free_rates_daily.csv` | `Y2-DATA-1/F3` |

Y2 qualifications that apply to anything computed from it are carried unchanged: the `SOXL` series is a `market-close proxy; NAV criterion unverified`; the semiconductor index before `2009-12-22` is a modelled `Path C` segment; the dataset is an as-retrieved reconstruction, not point-in-time inputs. The Y2 dataset and validation records are published in this repository as [dataset.md](dataset.md) and [validation.md](validation.md) (copies of the reviewed workspace `DATASET.md`, protected identity reference `Y2-DOC-DATASET`, and `VALIDATION.md`, protected identity reference `Y2-DOC-VALIDATION`, changing only link targets, a publication note, and one paraphrased sentence in `validation.md`); the data files and construction scripts stay outside Git.

The Y2 dataset holds no `QQQ`, `QQQM`, `SOXX`, `BOXX` or `TQQQ`/`SOXL` open prices. Any replay that needs them uses the proxies stated per replay.

### 5.2 Replays and results

| ID | What was run | Inputs | Command (from the scratch directory `~/workspace/quant-s2/yardstick/y3`, `PYTHONDONTWRITEBYTECODE=1`) | Output (protected identity reference) | Result |
| --- | --- | --- | --- | --- | --- |
| `R1` | The repository tests that encode both baselines' decision logic and identity, at the pin: `test_tqqq_dual_drive_core`, `test_tqqq_preplugin_predicate`, `test_soxl_v7_fixed_profile`, `test_soxl_lifecycle_baseline`, `test_tqqq_typed_baseline_result`, `test_soxl_soxx_typed_baseline_result` | The clone at the pinned commit; synthetic inputs inside the tests | `PYTHONPATH=ues/src:ues ./venv/bin/python -m pytest -p no:cacheprovider -q <the six files>` | `evidence/pytest_baseline_tests.txt` (`Y3-EV-R1-OUT`) | `38 passed`, `11 subtests passed`, `0` failed |
| `R2` | Decision-level target replay: `decide_tqqq_dual_drive` on a risk-on input at `100000` equity with the catalog defaults; `_resolve_tier_allocations` for the three `SOXL` tiers with the catalog defaults | No market data (synthetic decision inputs) | `./venv/bin/python scripts/replay_decision_targets.py $PWD` (script protected identity reference `Y3-EV-R2-SCRIPT`) | `evidence/replay_decision_targets.json` (`Y3-EV-R2-OUT`) | **Reproduces `T-A`** (`TQQQ` `45,000`, unlevered `45,000`, `BOXX` `8,000`, reserve `2,000` of `100,000`) **and `S-A`** (`full` `0.70 / 0.20 / 0.10`; `mid` `0.65 / 0.20 / 0.15`; `defensive` `0 / 0.15 / 0.85`). |
| `R3` | The repository's own core-only `SOXL` replay harness (`run_soxl_core_only_backtest`, `5` bps) over the Y2 data, run twice | Y2 files above, with proxies: `SOXL` = `soxl_daily.tr_mkt_index`; `SOXX` = `semi_index_daily.idx_tr_index`; `BOXX` = `cumprod(1 + tbill_3m_rate × dt_yr)` | `./venv/bin/python scripts/replay_soxl_core.py $PWD ~/workspace/quant-s2/yardstick/y2` (script protected identity reference `Y3-EV-R3-SCRIPT`) | `evidence/replay_soxl_core.json` (`Y3-EV-R3-OUT`) | Deterministic: both runs give the same daily-return hash (protected identity reference `Y3-EV-R3-RETURNS`), `4,197` rows, `2010-03-11` to `2026-11-13`. **Does not reproduce `S-B`** (below). |
| `R4` | Configuration identity references | The clone | `./venv/bin/python scripts/baseline_identity.py $PWD` (script protected identity reference `Y3-EV-R4-SCRIPT`) | `evidence/baseline_identity.json` (`Y3-EV-R4-OUT`) | Identity references as recorded in §3.1 and §4.1. The recorded V7 hash is not reproduced by four serializations (§6). |

### 5.3 Reproduction table

| Target | Reproduced | Evidence | Notes |
| --- | --- | --- | --- |
| `T-A` | **Yes** | `R2`, `R1` | Decision-level; the targets follow from the pinned configuration. |
| `S-A` | **Yes** | `R2`, `R1` | Decision-level. |
| `T-B` | **Not reproducible in this batch; performance-unverified** (recorded `33.96%` / `-31.48%`, unchanged) | None | See finding `F1`. Closed by owner exception; not a reproduction. |
| `S-B` | **Not reproduced; performance-unverified** (recorded `98.03%` / `-39.29%`, unchanged) | `R3` | Window `2024-01-31` to `2026-05-04` (`566` sessions) on the proxy inputs: replayed annualized return `0.7569` and maximum drawdown `-0.5890`, against recorded `0.9803` and `-0.3929`. Reported as a reproduction check; neither number is a statement about the strategy. See finding `F2`. Closed by owner exception; not a reproduction. |

### 5.4 Findings (reported, not adjusted)

- **`F1` — `T-B` cannot be replayed from the repository and the Y2 dataset.** The recorded figure comes from an artifact in another repository (`InteractiveBrokersPlatform`), for an *approximation* that the handbook says differs from the current default (it lacks the dynamic volatility threshold). The clone contains no replay harness for the `tqqq_growth_income` profile: `backtest/orchestrator_runner.py` supports only the global rotation, the combo and the `SOXL` profiles. The Y2 dataset has no `QQQ`, `QQQM` or `BOXX`. No substitute simulator was written, because a new simulator would not be the baseline's own replay. Status: **`T-B` unreproduced and performance-unverified; closed by owner exception on `2026-11-17`** (PR #1188, comment `6930818496`; the exception is bound to the baseline identities and the current `Y3` scope, and it does not make the recorded figure a reproduction of the selected body). Closing it needs the named artifact, or a harness for the profile, plus the missing price series, and a decision on whether proxy inputs are acceptable. Fix-round search (`2026-11-17`, bounded): the figure is recorded in `InteractiveBrokersPlatform`'s research results for a `video_like_pullback_next_close` reconstruction, labelled there as an approximate reconstruction whose exact state machine is not public, over `2017-01-03` to `2026-04-10`; that research script and its results were later removed from the repository's main branch. It is therefore a record about a different object than the selected `tqqq_growth_income` body, and no artifact of the selected body with the recorded `33.96%` / `-31.48%` was found. `UsEquitySnapshotPipelines` holds an archive generator for the selected product mix (`QQQM`, `BOXX`, income basket) that downloads prices from a free source; its outputs directory is not under version control. The free price sources tried (Yahoo chart/`yfinance`, Stooq) refused automated access in this environment, so no replay was run. The recorded figure is preserved unchanged as historical evidence, no replacement target is set, and the owner exception of `2026-11-17` closes the finding without any of this changing: the recorded figure is preserved as historical evidence of a different object and marked performance-unverified.
- **`F2` — `S-B` is not reproduced, and the replay is not comparable to it by construction.** The recorded figure is a full-sleeve run (income layer included, real `SOXX`/`BOXX`/`SOXL` prices, `100k` start). The repository's harness is documented as a "lifecycle core-only close-fill proxy, not a live-fidelity claim for the full production sleeve": it switches the income layer, market-regime application and retention off, fills at the prior close, and takes proxy inputs here. The harness also leaves `timing_execution = UNDECLARED` and `cost_bps = None` in its result object although `5` bps is applied. Status: **`S-B` not reproduced and performance-unverified; closed by owner exception on `2026-11-17`** (PR #1188, comment `6930818496`; bound to the baseline identity and the current `Y3` scope). The difference is expected from these inputs and not explained to the figure's last digit. It is a finding, and the recorded `S-B` is not adjusted. Closing it needs the named `summary.csv` artifact and real `SOXX` and `BOXX` series. Fix-round search (`2026-11-17`, bounded): the named output directory is not tracked in `UsEquitySnapshotPipelines` (its `data/output` holds only a placeholder), and no copy exists on this host or in that repository's listed release artifacts. The generator that produced such archives (`live-full` mode, full income layer, real `SOXL`/`SOXX`/`BOXX` prices, `5` bps, `100k`) is in that repository, but it needs freely downloaded price history and the free sources refused automated access here, so the matched-conditions replay and its declared tolerance could not be run. No tolerance was declared or fitted; the recorded `S-B` is unchanged; the gap to the core-only replay is still not decomposed by cause; the owner exception of `2026-11-17` closes the finding without any of this changing, and the recorded figure stays performance-unverified.
- **`F3` — No frozen baseline here has its performance targets reproduced.** Of the four recorded targets, the two that restate configuration (`T-A`, `S-A`) reproduce; the two that state performance (`T-B`, `S-B`) do not. The `PILOT` brief's acceptance statement "replaying the frozen baseline reproduces its own recorded targets" is therefore **met for allocation targets and not met for performance targets**. The gap is not resolved. On `2026-11-17` the owner waived the replay-acceptance requirement for both baselines (`F1`, `F2`): the `Y3` documents are accepted under the owner exception, the performance targets stay unverified, and `PILOT` permission remains separate and is not granted by this acceptance.
- **`F4` — The deployed configuration is unbound** (§2.2, ambiguity 3).
- **`F5` — The Y2 documents** were not merged at the dispatch head; they are now published as [dataset.md](dataset.md) and [validation.md](validation.md) (§5.1). Closed by the fix round of `2026-11-17`.

## 6. Limits of this record

- Defining-file lists cover the strategy body, its decision core, its defaults, and the retention and income-sleeve modules named by the defaults. Other modules the body imports (shared helpers, platform-kit contracts) are **not** hashed here; the platform-kit dependency is pinned by the repository at `SRC-C3`.
- The recorded V7 identity (`CFG-V7`) was not reproduced by the four serializations tried (sorted compact and sorted indent-`2`, each with and without a trailing line feed). V7 is outside the selected baselines; its identity is recorded only for the candidate table.
- The retention behaviour with no platform context, the interaction of the income sleeve with a pilot-sized sleeve, and the real deployed configuration were not exercised.
- Nothing here ranks `TQQQ` against `SOXL` or either against any alternative.

## Sources

- `PART-B.md` §2.6 item 5 and §2.3; `PART-C.md` §2.6 / Phase 2 scope item 4, §3.4, §4.2 step 1 (`~/workspace/quant-s2/fable-roadmap/`).
- [definitions-contract.md](definitions-contract.md) (signed 2026-11-16) and [cost-model.md](cost-model.md).
- [dataset.md](dataset.md), [validation.md](validation.md) and the data files under `~/workspace/quant-s2/yardstick/y2/` (data stay outside Git).
- Protected strategy-source manifest, entry `SRC-C1`: `docs/us-equity-strategy-status.md`, `docs/us-equity-strategy-status.zh-CN.md`, `docs/research/fractional-kelly-preregistration.zh-CN.md`, `docs/research/soxl-derisk-only-202610-forward-preregistration.md`, and the files in §3.1 and §4.1.
