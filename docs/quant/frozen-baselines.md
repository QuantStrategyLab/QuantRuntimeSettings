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
- This document records **identity, composition and reproduction evidence**. It contains no verdict on either strategy, no parameter recommendation and no return claim. Where a number from a replay appears, it is a reproduction check against a figure the repository already records, and it is not evidence of merit.

## 1. What "frozen baseline" means here

A frozen baseline is the strategy body that `PILOT` tests are paired against (`PART-C.md` §4.2 step 1: "output of the frozen baseline strategy body, with its internal trend and volatility rules"). Its version is fixed by four identifiers, all recorded below:

1. the commit SHA of the strategy repository;
2. the exact file paths that define the strategy body, each with its git blob SHA-1 and file SHA-256 at that commit;
3. the default configuration the body runs with, as a canonical-JSON SHA-256 (the canonicalization is defined in §2.3 and is this document's own definition);
4. the de-risking layers present in that body (`PART-B.md` §2.6 item 5: trend rule, volatility rule, `vol_scale`, `dd_scale` and any risk-reducing plugin act in the same states and must be declared as a stack).

A baseline is never a moving branch. Any later change to a listed file is a new baseline with a new identity, and it does not rewrite this record.

## 2. Source, access and version identity

### 2.1 Source and access

| Item | Value |
| --- | --- |
| Repository | `QuantStrategyLab/UsEquityStrategies` |
| Default branch | `main` |
| Access | Read-only clone into scratch space under `~/workspace/quant-s2/yardstick/y3/ues/`; no write, no worktree inside the `QuantRuntimeSettings` worktree. A `git status --short` of the clone after all runs was empty. |
| Retrieved | `2026-11-17` |
| Commit pinned | `c06e0fd046963829d54a0d9a7c1e83dc01240108` (`chore(governance): centralize PR gate and anti-leak hygiene (#724)`, committed `2026-11-15T19:43:42+08:00`) |
| Release tag at this commit | **None.** `pyproject.toml` declares version `0.7.60`; the highest semantic-version tag is `v0.7.52` (commit `2f033d713c32a63f217c6b166995ebcf1f2f466f`, `2026-06-04`), which is `720` commits behind the pinned commit. `git describe` resolves to `research-m1-r1-reserve-20261022-67-gc06e0fd`, a research tag, not a release. Neither the declared version nor any tag identifies this commit, so the **commit SHA is the version identity**. |
| Python environment for replay | `Python 3.12.3`, `pandas 3.1.1`, `numpy 2.5.5`, `pytest 9.2.0`, `pandas_market_calendars 5.6.1`, `quant-platform-kit` at `52adab68d6109cf93941ae21a39914cfa37e00e3` (the pin in the repository's `pyproject.toml`), in a venv under `~/workspace/quant-s2/yardstick/y3/venv/`. The repository declares `pandas>=2.0`; `3.1.1` satisfies it but is not the version the repository's CI is stated to use (not verified). |

### 2.2 Candidates found and the selection rule

Neither pilot strategy has a single obvious version in the repository. The candidates found, and the rule used, are recorded so that the choice is visible and reversible by the owner.

**Selection rule (this document's own rule, applied identically to both strategies):** the baseline is the strategy body that the legacy `TQQQ` / `SOXL` paths run, taken as the profile flagged `runtime_enabled` for that symbol in `docs/us-equity-strategy-status.md` (and `status="runtime_enabled"` in `src/us_equity_strategies/catalog.py`), with the catalog default configuration. Research candidates, shadow combinations, offline typed baselines, option overlays and plugin sidecars are excluded as the baseline. This rule is chosen because the phase brief's baseline is "the strategy body with its internal trend and volatility rules", and because the owner's boundary describes the legacy bodies as the thing currently OFF.

| Strategy | Candidate | Status in repository | Selected |
| --- | --- | --- | --- |
| `TQQQ` | `tqqq_growth_income` (`strategies/tqqq_growth_income.py`, with the pure decision core `strategies/tqqq_dual_drive_core.py`) | `runtime_enabled`; handbook role "TQQQ growth + income" | **Yes** |
| `TQQQ` | `tqqq_growth_income_research_baseline_v1` (`research/tqqq_typed_baseline_result.py`): fixed `SMA200` rule, controls disabled, `0` transaction cost, typed Yahoo-snapshot input | Research reference | No. It contains no de-risking layers, so it cannot serve as the frozen body of `PART-B.md` §2.6 item 5. It is identified here as a possible **layer-free comparator** only. |
| `TQQQ` | Tag `tqqq-p2-v2-qpk730-source-20260819` (commit `5f0c30cdcaf3ee0f3f1c050acbe172580ea40c81`, "add TQQQ P2 v2 adapter") | Research adapter | No. What this tag freezes was not established in this batch. |
| `TQQQ`+`SOXL` | `us_equity_combo_leveraged_shadow_352045`, `..._402040` | `shadow_candidate`; combined weights, not a per-strategy body | No |
| `SOXL` | `soxl_soxx_trend_income` (`strategies/soxl_soxx_trend_income.py`) | `runtime_enabled`; handbook role "SOXL/SOXX semiconductor trend + income" | **Yes** |
| `SOXL` | `soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve` ("V7", `v7_soxl_profile.py`, recorded config SHA-256 `843ab4e93e81985c2b3becc61a2f0b971508ccf25afa59acf402e75f574514d1`) | `runtime_enabled=false` research/shadow candidate; the repository states it is **not** the live `SOXL` and that the earlier real-data studies (`R6`–`R9`) used V7, "cannot be used as the live SOXL return series" (`docs/research/fractional-kelly-preregistration.zh-CN.md`) | No |
| `SOXL` | `soxl_v7_strict_derisk_only_v1` (candidate commit `0f48d49c8b066b03a47b54c9a6a1d538241eb394`) | Pre-registered 20-session forward observation, collection not activated | No |
| `SOXL` | `soxl_soxx_typed_baseline_result.py` | Offline typed baseline | No (same reason as the `TQQQ` typed baseline; not inspected beyond its header and tests) |

**Ambiguities flagged (also in the summary of this batch):**

1. No release tag identifies the pinned commit; the commit SHA stands in for a version.
2. For `SOXL`, two bodies are both described as the "frozen" `SOXL` in repository records (the live profile and V7). The live profile is selected by the rule above; if the owner reads "the `SOXL` baseline" as V7, §4 must be redone. The two differ in core weights (live `0.70 / 0.65 / 0.20`, redirect to `SOXX`; V7 `0.35 / 0.25 / 0.25`, redirect to `BOXX`), in the income layer (live on, V7 off) and in market-regime handling.
3. The repository's own forward pre-registration states that the **deployed effective configuration** of the live `SOXL` profile, its policy, installed versions and plugin order are not bound to immutable references ("`NOT_COMPARABLE`" until bound; its rebuilt comparator is labelled `REBUILT_FROM_PARTIAL_NON_CANONICAL`). The baselines below are therefore **the repository defaults at the pinned commit**, not a verified copy of what any deployment ran.

### 2.3 Configuration identity

The configuration identity is the SHA-256 of the canonical JSON of `STRATEGY_DEFAULT_CONFIG[<profile>]` in `catalog.py`: keys sorted, separators `,` and `:`, tuples as arrays, no NaN, one trailing line feed. This canonicalization is defined by this document; it is **not** the canonicalization behind the repository's recorded V7 hash. Four plausible serializations of the V7 config were tried and none reproduces the recorded V7 hash (`843ab4e9…`); V7 is not a selected baseline, so this was not pursued (see §6).

## 3. Baseline B-TQQQ: `tqqq_growth_income`

### 3.1 Identity

| Item | Value |
| --- | --- |
| Repository commit | `c06e0fd046963829d54a0d9a7c1e83dc01240108` |
| Profile | `tqqq_growth_income` (display "TQQQ Growth Income"; `module_path = us_equity_strategies.strategies.tqqq_growth_income`) |
| Default configuration SHA-256 (`47` keys) | `ffaa26582d47897de577ce05117dc807026942fad1c3df11ac0ffa1caf695c88` |
| Note | The catalog default has `dual_drive_macro_risk_governor_enabled = True`; the bundled manifest default (`manifests/__init__.py`) omits that key (`46` keys). The strategy function's own default for that parameter is also `True` (`strategies/tqqq_growth_income.py`), so the effective value is identical. Recorded as a catalog/manifest inconsistency, not corrected. |

Defining files (all relative to the repository root; blob SHA-1 from `git rev-parse <commit>:<path>`, SHA-256 of the file bytes):

| Path | Blob SHA-1 | SHA-256 |
| --- | --- | --- |
| `src/us_equity_strategies/strategies/tqqq_growth_income.py` | `93c4f8d8ad79dc0033337fe8a54e84b38639d32f` | `90e8ded53a2e4389f6060d88cfd232046d90e6775dda47379e8d06415b2cbf42` |
| `src/us_equity_strategies/strategies/tqqq_dual_drive_core.py` | `834fa077027389f8313d0b7334419a3ba7e6be7f` | `1868f4298c1228b458b9b4b6904ff6bf3cf1dcacd46fcf4e469a6f968ee6f211` |
| `src/us_equity_strategies/catalog.py` (default configuration, metadata, status) | `ba10ac74bcd0bfb324dd1cbccfc02a7db2745158` | `900e1ebc235bbe191bd7f411ec0899a2e4d578cc9d05cc5b76842144445e0f18` |
| `src/us_equity_strategies/volatility_delever_retention.py` (retention policy `tqqq_step_softzero_0.25_0.50`) | `3dd96193ff926296dadb5229a115d301803148e1` | `148743f0bea5285ec98aca19072c528cb4435c5b52cbc5271b4347ce4fa30aef` |
| `src/us_equity_strategies/income_layer_defaults.py` (income-sleeve defaults) | `5b471b06b91b517d5ab8938161accd1f19ac4781` | `19f31a77c85d9fd1861aad77854de5d19547ba79346908376a69a0da70e7d74a` |

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
| `T-B` | Performance record for the "executable approximation" `video_like_pullback_next_close` over `2017-01-03` to `2026-04-10` at `5` bps one-way: CAGR `33.96%`, maximum drawdown `-31.48%`. The handbook states that the current default adds a dynamic volatility threshold to that approximation, so the figure is "approximate evidence". | `docs/us-equity-strategy-status.zh-CN.md` (evidence table); artifact named there: `InteractiveBrokersPlatform/research/results/video_qqq_tqqq_dual_drive_comparison.csv` (another repository, not in the clone). |

## 4. Baseline B-SOXL: `soxl_soxx_trend_income`

### 4.1 Identity

| Item | Value |
| --- | --- |
| Repository commit | `c06e0fd046963829d54a0d9a7c1e83dc01240108` |
| Profile | `soxl_soxx_trend_income` (display "SOXL/SOXX Semiconductor Trend Income"; `module_path = us_equity_strategies.strategies.soxl_soxx_trend_income`) |
| Default configuration SHA-256 (`50` keys; catalog and manifest defaults agree) | `e03a8ba3bedb81227a0a9c243424518fade62ee8669ca92f2d4260fcc9f9f7de` |

Defining files:

| Path | Blob SHA-1 | SHA-256 |
| --- | --- | --- |
| `src/us_equity_strategies/strategies/soxl_soxx_trend_income.py` | `331ff2f51f1f39351844d3cdd2b7a95790c33410` | `9675f56e9ea0d4be36751b52ec22951ddc29e2546e305a1e5b1aab5c6d60baf4` |
| `src/us_equity_strategies/catalog.py` (default configuration, metadata, status) | `ba10ac74bcd0bfb324dd1cbccfc02a7db2745158` | `900e1ebc235bbe191bd7f411ec0899a2e4d578cc9d05cc5b76842144445e0f18` |
| `src/us_equity_strategies/volatility_delever_retention.py` (retention policy `soxl_step_rebound_0.25_0.50`) | `3dd96193ff926296dadb5229a115d301803148e1` | `148743f0bea5285ec98aca19072c528cb4435c5b52cbc5271b4347ce4fa30aef` |
| `src/us_equity_strategies/income_layer_defaults.py` | `5b471b06b91b517d5ab8938161accd1f19ac4781` | `19f31a77c85d9fd1861aad77854de5d19547ba79346908376a69a0da70e7d74a` |
| `src/us_equity_strategies/backtest/soxl_trend_simulator.py` (the repository's core-only replay harness, used in §5) | `17cd16fd430f575cf89f6179ee973d9182e9171f` | `c82e1bae19981e6472c295fcc67393bf11262be16e5ae857d2f8c94d87588eaf` |

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
| `S-B` | Daily replay of the profile, `100k` initial equity, `5` bps, `2024-01-31` to `2026-05-04`: CAGR `98.03%`, maximum drawdown `-39.29%`; "the income layer participates gradually once equity passes `150k`". | `docs/us-equity-strategy-status.zh-CN.md` (evidence table); artifact named there: `UsEquitySnapshotPipelines/data/output/soxl_soxx_trend_income_archive_2026-05-04/summary.csv` (another repository, not in the clone). |

## 5. Replay evidence

All replay work ran from scripts kept outside the clone, in `~/workspace/quant-s2/yardstick/y3/scripts/`, writing outputs to `~/workspace/quant-s2/yardstick/y3/evidence/`. The clone was not modified (`git status --short` empty after every run; `PYTHONDONTWRITEBYTECODE=1`, `-p no:cacheprovider`).

### 5.1 Research dataset used

The research dataset is the Y2 dataset under `~/workspace/quant-s2/yardstick/y2/data/`. Its version identifier for this batch is the SHA-256 of the sorted per-file hash listing, `19e51a6627c40461fdd80f740798462425769af6ad3cfecad4937003e9320de6` (listing format and file hashes in [experiment-ledger.md](experiment-ledger.md) §4). The files read by the replays:

| File | SHA-256 |
| --- | --- |
| `soxl_daily.csv` | `f5e664a976c45df1166c7c401fbea807d754f1d5b26300d101ae163a38062cdd` |
| `semi_index_daily.csv` | `4ef50831d033711958beff9ee7027d68c361f04e02642a9a19bd436753d7abef` |
| `risk_free_rates_daily.csv` | `211fc1e0f99b6004fbd3f55f0c7a178ed40bee7d72c3a78969c16289a8d5debb` |

Y2 qualifications that apply to anything computed from it are carried unchanged: the `SOXL` series is a `market-close proxy; NAV criterion unverified`; the semiconductor index before `2009-12-22` is a modelled `Path C` segment; the dataset is an as-retrieved reconstruction, not point-in-time inputs. The Y2 documents themselves (`DATASET.md`, `VALIDATION.md`) were **not merged into this repository at the dispatch head**; they are cited from `~/workspace/quant-s2/yardstick/y2/` (`DATASET.md` SHA-256 `b2a615a1ca47116c91686b2130e55b87f6705852a2eb929eb64456cd4568c0c9`, `VALIDATION.md` SHA-256 `787b84d1d8519bc01c4b589196b888d423c4d098b1519a7644cf21e268aed882`).

The Y2 dataset holds no `QQQ`, `QQQM`, `SOXX`, `BOXX` or `TQQQ`/`SOXL` open prices. Any replay that needs them uses the proxies stated per replay.

### 5.2 Replays and results

| ID | What was run | Inputs | Command (from the scratch directory `~/workspace/quant-s2/yardstick/y3`, `PYTHONDONTWRITEBYTECODE=1`) | Output (SHA-256) | Result |
| --- | --- | --- | --- | --- | --- |
| `R1` | The repository tests that encode both baselines' decision logic and identity, at the pin: `test_tqqq_dual_drive_core`, `test_tqqq_preplugin_predicate`, `test_soxl_v7_fixed_profile`, `test_soxl_lifecycle_baseline`, `test_tqqq_typed_baseline_result`, `test_soxl_soxx_typed_baseline_result` | The clone at the pinned commit; synthetic inputs inside the tests | `PYTHONPATH=ues/src:ues ./venv/bin/python -m pytest -p no:cacheprovider -q <the six files>` | `evidence/pytest_baseline_tests.txt` (`8d75c2d5ac9769be4e50ab28c8a03def247f2b6ec7bb6be2868ddb591e4618fe`) | `38 passed`, `11 subtests passed`, `0` failed |
| `R2` | Decision-level target replay: `decide_tqqq_dual_drive` on a risk-on input at `100000` equity with the catalog defaults; `_resolve_tier_allocations` for the three `SOXL` tiers with the catalog defaults | No market data (synthetic decision inputs) | `./venv/bin/python scripts/replay_decision_targets.py $PWD` (script SHA-256 `1a81f0de942ae65872badfdadc6cb128a044b1289a0210ca7f8ac0850923779a`) | `evidence/replay_decision_targets.json` (`6901fa5bccfc097e607104ff8202c5391eb0bf0120fb4aead273adb7b53cb9f6`) | **Reproduces `T-A`** (`TQQQ` `45,000`, unlevered `45,000`, `BOXX` `8,000`, reserve `2,000` of `100,000`) **and `S-A`** (`full` `0.70 / 0.20 / 0.10`; `mid` `0.65 / 0.20 / 0.15`; `defensive` `0 / 0.15 / 0.85`). |
| `R3` | The repository's own core-only `SOXL` replay harness (`run_soxl_core_only_backtest`, `5` bps) over the Y2 data, run twice | Y2 files above, with proxies: `SOXL` = `soxl_daily.tr_mkt_index`; `SOXX` = `semi_index_daily.idx_tr_index`; `BOXX` = `cumprod(1 + tbill_3m_rate × dt_yr)` | `./venv/bin/python scripts/replay_soxl_core.py $PWD ~/workspace/quant-s2/yardstick/y2` (script SHA-256 `cca58937de1f488c69210533b550aa6ff39cd9797965b125d01918ab807311ff`) | `evidence/replay_soxl_core.json` (`f7df5d51d2074d4022fe58626145ade9c3fca80b427d2ee67e37115554f62384`) | Deterministic: both runs give the same daily-return hash (`7c3c86ea1f6945a64a46f713107f540528ad56f3824cac2a9dcf743e7e29f1d9`), `4,197` rows, `2010-03-11` to `2026-11-13`. **Does not reproduce `S-B`** (below). |
| `R4` | Configuration identity digests | The clone | `./venv/bin/python scripts/baseline_identity.py $PWD` (script SHA-256 `95852fd2ccfa778a34f42450800e62cbc49e9ab332b9d3e4d9e3be261b87517e`) | `evidence/baseline_identity.json` (`7ecc3a96e765342adb4fc372d562de3b9cc4caf798e2a1d35675539391847e65`) | Digests as recorded in §3.1 and §4.1. The recorded V7 hash is not reproduced by four serializations (§6). |

### 5.3 Reproduction table

| Target | Reproduced | Evidence | Notes |
| --- | --- | --- | --- |
| `T-A` | **Yes** | `R2`, `R1` | Decision-level; the targets follow from the pinned configuration. |
| `S-A` | **Yes** | `R2`, `R1` | Decision-level. |
| `T-B` | **Not reproducible in this batch** | None | See finding `F1`. |
| `S-B` | **Not reproduced** | `R3` | Window `2024-01-31` to `2026-05-04` (`566` sessions) on the proxy inputs: replayed annualized return `0.7569` and maximum drawdown `-0.5890`, against recorded `0.9803` and `-0.3929`. Reported as a reproduction check; neither number is a statement about the strategy. See finding `F2`. |

### 5.4 Findings (reported, not adjusted)

- **`F1` — `T-B` cannot be replayed from the repository and the Y2 dataset.** The recorded figure comes from an artifact in another repository (`InteractiveBrokersPlatform`), for an *approximation* that the handbook says differs from the current default (it lacks the dynamic volatility threshold). The clone contains no replay harness for the `tqqq_growth_income` profile: `backtest/orchestrator_runner.py` supports only the global rotation, the combo and the `SOXL` profiles. The Y2 dataset has no `QQQ`, `QQQM` or `BOXX`. No substitute simulator was written, because a new simulator would not be the baseline's own replay. Status: **`T-B` unreproduced; open.** Closing it needs the named artifact, or a harness for the profile, plus the missing price series, and a decision on whether proxy inputs are acceptable.
- **`F2` — `S-B` is not reproduced, and the replay is not comparable to it by construction.** The recorded figure is a full-sleeve run (income layer included, real `SOXX`/`BOXX`/`SOXL` prices, `100k` start). The repository's harness is documented as a "lifecycle core-only close-fill proxy, not a live-fidelity claim for the full production sleeve": it switches the income layer, market-regime application and retention off, fills at the prior close, and takes proxy inputs here. The harness also leaves `timing_execution = UNDECLARED` and `cost_bps = None` in its result object although `5` bps is applied. Status: **`S-B` not reproduced; the difference is expected from these inputs and not explained to the figure's last digit.** It is a finding, and the recorded `S-B` is not adjusted. Closing it needs the named `summary.csv` artifact and real `SOXX` and `BOXX` series.
- **`F3` — No frozen baseline here has its performance targets reproduced.** Of the four recorded targets, the two that restate configuration (`T-A`, `S-A`) reproduce; the two that state performance (`T-B`, `S-B`) do not. The `PILOT` brief's acceptance statement "replaying the frozen baseline reproduces its own recorded targets" is therefore **met for allocation targets and not met for performance targets**. This gap is reported to the coordinator rather than resolved here.
- **`F4` — The deployed configuration is unbound** (§2.2, ambiguity 3).
- **`F5` — The Y2 documents are not merged** at the dispatch head (§5.1).

## 6. Limits of this record

- Defining-file lists cover the strategy body, its decision core, its defaults, and the retention and income-sleeve modules named by the defaults. Other modules the body imports (shared helpers, platform-kit contracts) are **not** hashed here; the platform-kit dependency is pinned by the repository at `52adab68d6109cf93941ae21a39914cfa37e00e3`.
- The V7 recorded hash was not reproduced by the four serializations tried (sorted compact and sorted indent-`2`, each with and without a trailing line feed). V7 is outside the selected baselines; its identity is recorded only for the candidate table.
- The retention behaviour with no platform context, the interaction of the income sleeve with a pilot-sized sleeve, and the real deployed configuration were not exercised.
- Nothing here ranks `TQQQ` against `SOXL` or either against any alternative.

## Sources

- `PART-B.md` §2.6 item 5 and §2.3; `PART-C.md` §2.6 / Phase 2 scope item 4, §3.4, §4.2 step 1 (`~/workspace/quant-s2/fable-roadmap/`).
- [definitions-contract.md](definitions-contract.md) (signed 2026-11-16) and [cost-model.md](cost-model.md).
- Y2 `DATASET.md`, `VALIDATION.md` and data files under `~/workspace/quant-s2/yardstick/y2/` (not merged at the dispatch head).
- `QuantStrategyLab/UsEquityStrategies` at `c06e0fd046963829d54a0d9a7c1e83dc01240108`: `docs/us-equity-strategy-status.md`, `docs/us-equity-strategy-status.zh-CN.md`, `docs/research/fractional-kelly-preregistration.zh-CN.md`, `docs/research/soxl-derisk-only-202610-forward-preregistration.md`, and the files in §3.1 and §4.1.
