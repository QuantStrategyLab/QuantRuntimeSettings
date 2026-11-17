# QSL Universal Long-Horizon Risk Observation V2

English | [简体中文](qsl-long-horizon-risk-observation-v2.zh-CN.md)

> Status: `CORE_AND_EXACT_INGRESS_PORT_IMPLEMENTED_NO_RUNTIME_OR_POLICY_WRITE`

`python/scripts/long_horizon_risk_composer_v2.py` defines the parallel v2 contract for the long-horizon risk Composer, separating three independent concerns:

```text
Owner / control-plane selected risk preference
        +
Strategy, portfolio, or plugin candidate's frozen P3 risk capability & benchmark policy
        ↓
Emit redacted recommendation only when math assumptions are backed by evidence; else PARKED
```

It is a pure offline function with zero account, broker, fund, credential, network, object-store, scheduler, policy-write, or trading capability. V2 does not replace `qsl.long_horizon_risk_observation.v1` and leaves existing v1 objects, private ingress ports, and runtime configs untouched.

`python/scripts/long_horizon_risk_observation_ingress_v2.py` provides the matching bounded private ingress port: accepting an injected `read_exact` function, fetching one exact object up to 2 MiB at `long-horizon-risk-observations/v2/<candidate-id>/<p3-evidence-sha256>.json`, and verifying its candidate and P3 digests. It never lists objects, guesses "latest", retries alternate paths, writes, overwrites, or deletes. Profile selection comes separately from the control plane and cannot be discovered or swapped from storage; no live cloud adapter, runtime identity, or scheduler is wired.

## One human selection reused across candidates

The control plane stores portable `qsl.risk_profile_selection.v1` with fields immune to per-candidate overfitting:

| Field | Meaning |
| --- | --- |
| `profile_id` | Versioned identifier mapping 1-to-1 to a preference (e.g., `balanced_compounding_v1`) |
| `risk_preference` | `CAPITAL_PRESERVATION`, `BALANCED_COMPOUNDING`, or `GROWTH_COMPOUNDING` |
| `selection_sha256` | Prevents swapping a different tier behind the same display name |

This artifact holds no accounts, platforms, funds, or live authority. The control plane records which selection digest applies per account or portfolio scope, and candidate P3 observations only reference that digest; strategies, plugins, and platform adapters cannot create, edit, or relax profiles.

## V2 private observation

`qsl.long_horizon_risk_observation.v2` preserves candidate, P1/P2/P3/plugin digest bindings, paired net return paths, and hashes while expanding v1's single benchmark descriptor into two frozen declarations.

### `risk_capability`

| Field | Allowed values | Purpose |
| --- | --- | --- |
| `portfolio_scope` | `SINGLE_CANDIDATE` / `PORTFOLIO` | Distinguishes single strategies from multi-member portfolios |
| `return_evaluation` | `LINEAR_NET_RETURN` / `REPLAY_REQUIRED` | States whether returns scale linearly or require per-scale P3 replay |
| `cashflow_treatment` | `NOT_APPLICABLE` / `TIME_WEIGHTED` / `CASHFLOW_MATCHED` | Keeps DCA deposits and withdrawals separate from return paths |
| `risk_factor_coverage` | Ordered, deduplicated factor set | Declares P3 coverage across concentration, liquidity, leverage, gaps, margin, correlation |

Portfolio candidates must declare `PORTFOLIO` and cover `CORRELATION`; P1/P2/P3 digests remain the binding points for replayable evidence.

### `benchmark_policy`

`benchmark_policy` binds `benchmark_id`, category, trading calendar, currency, return basis, pre-registered definition digest, and annual session count across reserved categories: `UNLEVERED_REFERENCE` (directional candidates such as `SOXL`/`SOXX` or `TQQQ`/`QQQ`), `POLICY_BLEND` (pre-registered rotation/multi-asset mixes), and `CASH_EQUIVALENT` / `ABSOLUTE_RETURN_HURDLE` (market-neutral / absolute-return candidates), keeping benchmark choice auditable instead of ad hoc.

## Currently composable scope and fail-closed behavior

V2 reuses the verified v1 calculator and emits `ADVISORY_RECOMMENDATION_READY` **only** when all four hold:

1. `SINGLE_CANDIDATE`
2. `LINEAR_NET_RETURN`
3. `NOT_APPLICABLE` cashflow treatment
4. `UNLEVERED_REFERENCE` with `TOTAL_RETURN_NET_OF_COST` benchmark basis

Other categories are already expressible in the schema but must return `PARKED` until specialized Composers land:

| Declared condition | Fixed reason code | Why linear scaling cannot be applied |
| --- | --- | --- |
| Nonlinear sizing, options, or dynamic vol control | `RETURN_SCALE_REPLAY_REQUIRED` | Must replay P3 per risk scale rather than scaling returns linearly |
| Multi-strategy portfolio | `PORTFOLIO_COMPOSER_REQUIRED` | Must recompute correlation, marginal risk contributions, and portfolio net returns |
| DCA or external cashflows | `CASHFLOW_COMPOSER_REQUIRED` | Requires cashflow-matched, time-consistent return paths |
| Blend, cash, or absolute-return benchmark | `BENCHMARK_POLICY_COMPOSER_REQUIRED` | Cannot pretend to be an unlevered equity benchmark |
| Non-net-of-cost total-return basis (including `SPLIT_ADJUSTED_PRICE_RETURN`) | `BENCHMARK_RETURN_BASIS_COMPOSER_REQUIRED` | Drawdowns are incomparable; split-adjusted prices never substitute for total return |

`PARKED` carries zero scale, max drawdown, or frontier and never enables fallback execution or live trading.

## Plugin and platform boundaries

- Observation/signal plugins carry no independent return path and cannot submit v2 observations or obtain risk recommendations.
- Plugins altering orders, rebalancing, or holdings must form a new `strategy + plugin bundle` candidate and complete P1/P2/P3.
- Platforms consume signed, authorized downstream policies only; they may reduce risk further for liquidity, controls, or health, but cannot change profiles, benchmarks, or expand scales.
- Every platform, account, or strategy must supply its own P3 producer and private ingress rather than substituting SOXL results for TQQQ, combos, DCA, or plugins.

## Migration order

1. Keep v1 operational while single-strategy P3 producers emit and validate v2 observations alongside v1.
2. Connect directional single-strategy v2 advisories and compare redacted outputs against v1 (advisory only).
3. Implement specialized portfolio, cashflow, and replay Composers alongside matching P3 producers.
4. Wire bounded private ingress, policy authoring, and approval flows separately; risk advisories never flow directly into P4/P5/P6. Any scale expansion or profile, benchmark, capability, or P3 change requires new candidate/P1/P2/P3 bindings and independent authorization.
