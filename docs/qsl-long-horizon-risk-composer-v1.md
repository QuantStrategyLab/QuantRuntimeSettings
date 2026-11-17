# QSL Long-Horizon Compounding Risk Policy Composer V1

English | [简体中文](qsl-long-horizon-risk-composer-v1.zh-CN.md)

> Status: `PRIVATE_P3_OBSERVATION_INGRESS_IMPLEMENTED_POLICY_WRITE_NOT_WIRED`

`python/scripts/long_horizon_risk_composer.py` is an offline risk-design kernel reusable across strategies, combinations, and plugins. It evaluates frozen, net-of-cost P3 strategy return paths against paired unlevered benchmark paths over the same window to compute a redacted risk-scale frontier. It never reads accounts, funds, brokers, credentials, or networks, never writes risk policies or strategy parameters, starts no schedulers, and grants no P4, P5, or P6 authority.

Between research pipelines and the control plane, `qsl.long_horizon_risk_observation.v1` carries candidate, P1/P2/P3/plugin digests, unlevered benchmarks, and paired net return paths; the control plane must explicitly overlay the owner's risk preference before running Composer. Observations are **private ingress artifacts** that never enter public repositories, Actions summaries, consoles, or AI contexts; only redacted Composer outputs are publishable.

## Human-system division

The human selects only one of three plain preferences:

| Preference | V1 max drawdown ceiling vs. unlevered benchmark | Meaning |
| --- | ---: | --- |
| `CAPITAL_PRESERVATION` | `1.00x` | Across every qualifying scenario, strategy max drawdown may not exceed the benchmark's max drawdown. |
| `BALANCED_COMPOUNDING` | `1.25x` | Allows bounded additional drawdown for higher multi-scenario geometric growth. |
| `GROWTH_COMPOUNDING` | `1.50x` | Allows higher risk scale only when multi-scenario long-horizon compounding gates still pass. |

These multipliers are transparent, versioned policy bounds—not optimal ratios discovered from historical data. The kernel computes actual net-of-cost paths, max drawdown, relative drawdown, underwater duration, and per-session log geometric growth across scales without presenting historical optima as future guarantees.

## Dual basis: Composer MDD ceiling vs. promotion sizing

The same preference name carries two **non-interchangeable** numeric mappings; consoles and docs must never present Composer's `1.50x` as `1.5x` position sizing:

| Preference | Composer: MDD ceiling vs. unlevered benchmark | Promotion `promotion_sizing`: target position scale |
| --- | ---: | ---: |
| `CAPITAL_PRESERVATION` | `1.00` | `0.50` |
| `BALANCED_COMPOUNDING` | `1.25` | `0.75` |
| `GROWTH_COMPOUNDING` | `1.50` | `1.00` |

- **Composer multipliers** constrain drawdown ceilings relative to paired unlevered benchmarks in research/policy recommendations only; they never alter order quantities, recompute live positions, or grant execution authority.
- **Promotion sizing** applies strictly to HITL confirmations for **new promotions or material changes** (`target * profile_scale * plugin_scalar <= 1 -> RiskEngine`), never scaling up running live versions.
- Plugin scalars may only shrink (`<= 1`). Kelly primary sizing, automated policy writes by Composer, AI tier overrides, and weakening `RiskEngine` are forbidden.

Because preferences are account/portfolio-level selections, strategy code, platform adapters, and plugins cannot choose or raise them; new evidence may scale down or `PARKED` automatically, never step up silently. For equity-tiered position/leverage caps, see [Capital Risk Envelope V1](qsl-capital-risk-envelope-v1.md) (not yet runtime-wired). The CLI enforces this separation: owner-bound inputs use `--input`, while private observations require both `--observation` and `--risk-preference`, failing closed if preference is omitted.

## Bounded private ingress port

`python/scripts/long_horizon_risk_observation_ingress.py` defines the sole read primitive: fetching one exact object up to 2 MiB at `long-horizon-risk-observations/v1/<candidate-id>/<p3-evidence-sha256>.json` via an injected `read_exact` callback and verifying content hash, candidate ID, and P3 digest before invoking Composer. It includes no cloud SDK, credentials, network, bucket configuration, listing, "latest" guessing, fallback retries, writes, overwrites, or deletes. Missing storage, read failures, oversized payloads, or digest mismatches fail closed as unavailable without falling back to Actions artifacts, public repos, consoles, or AI contexts.

## Required evidence and calculation method

Inputs must bind candidate revision and P1/P2/P3/plugin digests and include at least one complete `>= 252`-session path per scenario family:

1. `WALK_FORWARD`: rolling or expanding out-of-sample validation.
2. `BOOTSTRAP`: block/time-correlated stress resamples.
3. `STRESS`: pre-registered crisis or adverse scenarios.

Missing families or insufficient lengths return `PARKED` without extrapolating drawdowns. At each 10% risk scale, the kernel compounds returns in integer bps and retains redacted summaries only: lower-median log geometric growth per scenario family, worst absolute and relative drawdown, worst benchmark drawdown, and longest underwater duration. Each strategy path is checked strictly against its **own paired same-window benchmark path**; an extreme stress benchmark never loosens walk-forward or bootstrap ceilings. Within each family, the kernel computes lower-median growth and positive-growth hit rate, then weights the three families equally; a scale qualifies only when at least two families achieve a two-thirds positive-growth rate and every path satisfies its paired drawdown ceiling.

Every scenario states `session_count`, matching `len(returns) + 1` (e.g., 252 `XNYS` sessions yield 251 adjacent returns), preventing valid one-year forward windows from miscounting or return arrays from inflating session counts. Among qualifying scales, Composer selects the highest equal-weighted lower-median log geometric growth (breaking ties toward lower risk scale). Output `recommended_max_drawdown_bps` reports the worst observed drawdown along the frozen paired P3 paths at that scale—never an order threshold, single-scenario cap, or active policy.

## Using SOXL and TQQQ

SOXL must supply paired unlevered `SOXX` paths and TQQQ must supply paired unlevered `QQQ` paths so Composer measures incremental leverage drawdown and recovery duration rather than standalone levered history. Combinations and plugins must supply their own same-cutoff, same-net-cost frozen benchmarks without borrowing recommendations across candidates.

## Extending to all strategies, combinations, and plugins

V1 already accepts `individual`, `combo`, and `plugin` candidate categories; missing evidence for any new P3 producer returns `PARKED`:

| Candidate type | Required paired benchmark and evidence | Forbidden shortcuts |
| --- | --- | --- |
| Leveraged ETF / directional spot | Matching unlevered total-return benchmark; daily reset, financing, and gap stress paths | Substituting nominal leverage or another ETF's history |
| Rotation / multi-asset portfolio | Pre-registered policy blend benchmark; portfolio-level net returns, rebalancing, and correlation evidence | Summing single-strategy returns or drawdowns |
| DCA / external cashflows | Cashflow-matched benchmark, time-weighted returns, and net-cost paths | Letting deposits, withdrawals, or balances distort scale selection |
| Options, income, or margin | Benchmark plus gap, volatility, assignment, margin, and liquidity stress evidence | Ignoring unobserved tail risk from low historical drawdown |
| Market-neutral / absolute return | Cash or T-bill plus hurdle benchmark; leverage and liquidity stress evidence | Applying equity drawdown multipliers mechanically |
| Plugin | Only a "strategy + plugin bundle" changing return paths forms a new candidate through P1/P2/P3 | Signal/observation plugins submitting risk advice or bypassing P3 |

Future extensions introduce `risk_observation.v2` in parallel (never mutating v1 hashes), declaring `risk_capability`, `benchmark_policy`, `risk_factor_coverage`, `scenario_family`, and `portfolio_scope`. See [Universal Long-Horizon Risk Observation V2](qsl-long-horizon-risk-observation-v2.md); until specialized math lands, portfolio, cashflow, and nonlinear candidates close to `PARKED`.

## Non-automatic boundaries

Composer emits recommendations only and never invokes `deterministic_risk_gate` or overwrites signed policies. Any future integration requires new replayable policy versions where evidence degradation may scale down or `PARKED`, any scale/multiplier/benchmark expansion or P4/P5/P6 transition requires new P1/P2/P3 bindings and policy-gate receipts, P6 `live` always requires explicit owner confirmation, and raw observation paths never enter AI or console contexts.
