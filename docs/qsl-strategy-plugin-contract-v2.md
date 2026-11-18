# Strategy Plugin Contract V2 (Design Boundary)

English | [简体中文](qsl-strategy-plugin-contract-v2.zh-CN.md)

> Status: `DESIGN_ONLY_NOT_RUNTIME`
> This contract creates no `P4`, `P5`, or `P6` permissions and alters no strategy parameters, data inputs, broker settings, or order capability.

## Why this contract exists

Legacy plugins read `latest_signal.json` by strategy name and auto-mounted into runtime settings without proving which `P1` root produced them, pinning to a `P2` candidate, or allowing `P3` recomputation. They remain historical research artifacts only and cannot serve as mainline runtime inputs.

Long-horizon stress backtests (such as dot-com bust periods) can motivate hypotheses around regime or risk filtering, but synthetic `QQQ` 3x paths prior to `TQQQ`'s 2010 launch represent assumption-bound stress tests rather than observed `TQQQ` performance or runtime authorization.

## Plugins emit signals only

Every plugin is a `research_signal` emitting schema-validated regime, diagnostic, or research features from explicit inputs. It never decides position sizes, alters targets, tunes parameters, schedules runs, or calls brokers.

The strategy itself is the sole consumer: whether to read a signal, which fields apply, thresholds/combination rules, and missing-signal fallback behavior (`PARKED` vs. fixed neutral behavior) must live inside the strategy's frozen `P2` configuration and code revision.

AI black-box outputs are not plugin inputs. They emit `ai_advisory` (structured diagnosis summaries, urgency, and notification hints) for human review only and cannot edit `P2` parameters, select plugins, or affect `paper`/`shadow`/`live`.

## Required identity bindings for a mountable plugin

Every candidate reference must include and digest-bind:

- `contract_schema=strategy_plugin_contract.v2`, `plugin_id`, `kind`, plugin code revision, and config SHA-256.
- Matching `P1` input-root SHA-256, data cutoff timestamp, and candidate ID.
- Explicit `P2` consumer entry point, input/output schemas, and frozen consumption rules.
- Artifact content SHA-256 and validity window (`latest` is for console display only, never `P2`/`P3` evidence).

Any missing field, digest mismatch, cutoff skew, unknown schema, or unauthorized side effect forces `PARKED` without falling back to name-based lookup.

## Lifecycle and recomputation

```text
P1 common input root
  -> research_signal plugin (optional, emits identity-bound artifact)
  -> P2 frozen candidate pins artifact SHA and consumption rules
  -> strategy computes risk budget, targets, and rebalance via frozen logic
  -> P3 recomputes signal and strategy consumption from identical P1/P2 and compares item-by-item
  -> downstream independent P4/P5/P6 gates
```

`P3` must recompute plugin outputs, strategy consumption, and reason summaries rather than checking file presence alone. Downstream `P4`/`P5`/`P6` evidence never retroactively authorizes a plugin.

## Historical validation boundaries

- `synthetic_stress_evidence` and `real_etf_evidence` must stay separated in storage and reporting (e.g., pre-2010 synthetic `QQQ` 3x paths exclude real ETF fee, tracking-error, liquidity, and fill mechanics).
- Signals consume data known at `cutoff` only, accounting for splits/dividends, fees, slippage, financing, turnover, and non-fill rules at the next tradable step.
- Each plugin registers a hypothesis card upfront (mechanism, inputs, pre-registered parameter grid, baseline, expected failure modes, and final unseen test window); changes after inspecting unseen data require a new candidate.
- Experiment ledgers retain all failed parameter sets alongside winners, reporting rolling/expanding walk-forward, unseen OOS, parameter neighborhood stability, and net delta vs. baseline.

## Legacy migration rules

- Legacy `market_regime_control` and `latest_signal.json` artifacts are `legacy_research_only` and never auto-mount.
- `plugin_mode=none` is the safe default; legacy `auto` remains a compatibility alias for `none`.
- Legacy `custom` mounts remain disabled and must fail until a `signal.v2` adapter is wired.
- `TQQQ` `P2` v5 references no plugins; observe-only drafts and AI diagnoses are not live plugin consumption.

## Mainline integration order

1. **Shared skeleton (minimal implementation merged):** `qsl.strategy-plugin-signal.v2` schema/rejection rules and a `QQQ` close-only producer are merged; `TQQQ` v6 recomputes from the verified `P1` root and verifies `P1`/`P2` and target equivalence without runtime wiring or persistent `verified manifest`.
2. **Observe-only candidate first:** `TQQQ` `P2` v6 `plugin-observe` matches core-only `P2` v5 targets identically while logging `QQQ` signals to diagnostics/`P3` evidence without reading legacy resolvers or `latest`.
3. **Consumption only after forward observation:** after sufficient forward observation and bucketed historical checks, create a new `P2` v7 `market-regime-consume` candidate whose frozen rules may reduce risk or shift to defensive assets without adding leverage, re-entry, or orders.
4. **Parallel research, serialized combination:** plugins for `TQQQ` regime, `SOXL`/`SOXX` volatility, or `IBIT` valuation may be developed independently, but combining multiple signals requires a dedicated combo candidate validated serially.

## Pre-wiring acceptance checklist

1. Fixed `P1`/`P2`/`P3` golden vectors pass deterministically with exact `P2`/`P3` plugin identity, artifact SHA, and output parity.
2. Negative tests cover expired artifacts, `latest` pointers, wrong roots, cutoff mismatches, wrong code revisions, unknown schemas, and undeclared consumption fields.
3. Strategy consumption vectors cover signal transitions, missing signals, and neutral/`PARKED` branches with zero position/order/execution fields in plugins.
4. Backtest reports disclose synthetic proxies, costs, slippage, financing/borrow assumptions, search counts, and train/validation/OOS splits; integration starts from one frozen `P2` candidate rather than bulk auto-migration.
