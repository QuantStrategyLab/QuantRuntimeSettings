# QSL Drift-Triggered Research Promotion and HITL Gate V1 (Frozen Policy)

English | [简体中文](qsl-drift-triggered-research-hitl-v1.zh-CN.md)

> Status: `POLICY_FROZEN_LIBRARY_GATES_MERGED`
> Scope: bounded AI research promotion automation; does not authorize `live`, edit live parameters, deploy, or add unprompted scheduled re-optimization.

This policy distinguishes **Production Policy A** from **explicitly invoked bounded research**: production `REVIEW` and `CRITICAL` drift states prohibit new risk only with zero automatic re-optimization; `QuantPlatformKit`'s `research_promotion_cycle` library capability does not mean automatic optimization is active in production.

Under explicit owner authorization for the isolated research track, when a strategy or bound plugin reaches `REVIEW`/`CRITICAL` drift, Codex root-cause analysis, bounded Python parameter search, strict WFA/OOS gates, paired shadow evidence, and website `AWAITING_HUMAN` review run in isolation without hot-patching production trading parameters or calling external APIs as a fallback. Local wiring and synthetic tests exist; real candidate jobs, collector bindings, and deployment cycles remain unverified, and production trading paths continue with zero automatic re-optimization.

## 1. Non-negotiable principles

### 1.1 Production monitoring never auto-optimizes

- **Default posture:** monitor drift and health; no production drift state launches parameter search or re-optimization. `REVIEW` and `CRITICAL` prohibit new risk via the `NEW_RISK` gate without scaling positions, editing parameters, or granting live authority.
- **Forbidden:** calendar-driven or periodic blind re-optimization; treating `scheduled_retest` or `scheduled_research` as autonomous optimization triggers.
- **Permitted:** low-frequency scheduled **drift/health evaluation** (reading metrics, comparing against frozen baselines, writing redacted records).

### 1.2 Separate production response and manual research tracks

Production Policy A stops at blocking new risk and waiting for human action:

```text
drift(REVIEW|CRITICAL)
  -> prohibit new risk (NEW_RISK gate; zero optimize)
  -> await human decision on launching research
```

Only with explicit human research authorization and explicit library invocation may the bounded research pipeline run:

```text
Explicit human invocation + drift(REVIEW|CRITICAL)
  -> bounded reopt (hard iteration and parameter-key budgets)
  -> strict WFA / OOS / backtest gates (BacktestOrchestrator + promotion standard)
  -> paired shadow evidence
  -> AWAITING_HUMAN (human gate)
```

AI never grants live authority, modifies live parameters on running versions, or bypasses `RiskEngine`. Human confirmation records target platform, `paper`|`live` intent, and risk preference name only—confirmation never equals live authority.

### 1.3 New strategies and plugins use independent promotion lanes

New strategy profiles, plugin revisions, and material changes (instruments, risk budgets, logic) follow separate `learning -> promotion -> shadow -> HITL` tracks. Never overwrite or hot-swap an already-running runtime version with re-optimization results; Policy A restricts new risk only without adding automatic de-risking authority beyond existing capital-envelope controls.

### 1.4 Comparison with standard practice

| Phase | Industry practice | QSL frozen rule |
| --- | --- | --- |
| Normal | Monitor KPIs, drawdown, slippage, data/evidence freshness | Low-frequency drift/health readback; zero auto-optimization |
| Mild drift | Alert, explain, optional scale-down | `DriftStatus` below `REVIEW`: record + ops deduplication; no reopt |
| Moderate drift | Halt new risk, paired shadow comparison | `REVIEW`: prohibit new risk only; zero auto-reopt; research needs explicit authorization |
| Severe drift | Circuit breaker, human takeover | `CRITICAL`: prohibit new risk only; no auto-de-risking, breaker reset, or live |
| Forbidden | Daily/weekly calendar parameter refits | No cron may independently trigger re-optimization |

Capital-side de-risking (`monitor -> downgrade -> prohibit new risk`) lives in [Capital Risk Envelope V1](qsl-capital-risk-envelope-v1.md); portfolio evidence previews live in [Multi-Strategy Combo A→B V1](qsl-multi-strategy-combo-ab-v1.md). Capital envelopes govern account `combined_scale`; this document governs candidate parameters and promotion evidence.

## 2. Drift levels and triggers

Production `production_drift_new_risk` and explicitly invoked `research_promotion_cycle` must remain separate:

| `DriftStatus` | Production Policy A | Explicitly invoked research library |
| --- | --- | --- |
| Below `REVIEW` (OK / watch) | No extra drift new-risk block; zero optimize; other risk controls apply | `PARKED` (`drift_not_actionable`); `optimize` not called |
| `REVIEW` | Prohibit new risk only; zero optimize | Eligible for `BOUNDED_REOPT` -> backtest gates -> shadow -> `AWAITING_HUMAN` |
| `CRITICAL` | Same; no expanded permissions | Same; no live authority |

Readback sources include shadow divergence, performance decay, stale evidence, missing data/identity, and Composer/envelope downgrade signals (read-only, redacted). Daily or weekly checks emit drift reports only with zero reopt even on `REVIEW`/`CRITICAL`. In `platform-config.json`, `scheduled_retest` / `scheduled_research` under `automation_policy.triggers` denote lane eligibility for human- or drift-triggered retests, not autonomous optimization crons.

## 3. Strict backtest gates (after reopt, before shadow)

Any `OptimizationProposal` from bounded reopt must pass the full promotion chain rather than a single in-sample optimum:

| Gate | Requirement | Reference |
| --- | --- | --- |
| Orchestrator | `BacktestOrchestrator` + `purged_walk_forward.v1` | [strategy-promotion-risk-standard.zh-CN.md](https://github.com/QuantStrategyLab/QuantPlatformKit/blob/main/docs/strategy-promotion-risk-standard.zh-CN.md) |
| WFA | `>= 3` ordered folds with positive purge/embargo | Same |
| OOS | Locked and independent `>= 12` calendar months | Same + `evidence_package_template` |
| Budget | `max_search_iterations`, `max_param_keys`; `allow_live_enablement=False` | `ResearchPromotionBudget` |
| Shadow | Paired evidence required when `require_paired_shadow`; `shadow_passed` else `PARK` | `research_promotion_cycle` |
| Human | Stops at `AWAITING_HUMAN`; `apply_human_promotion_decision` never grants live | Same |

These gates belong to the explicitly invoked library research flow, not an autonomous production re-optimizer.

## 4. Role boundaries

Aligned with [Autonomous Operating Policy V2](qsl-autonomous-operating-policy-v2.md) and [Research Task Contract V1](qsl-research-task-v1.md):

| Role | Permitted | Forbidden |
| --- | --- | --- |
| **Monitoring / health schedule** | Read metrics, write drift reports, deduplicate alerts | Triggering reopt, editing parameters, opening/merging promotion PRs |
| **AI** | Explain drift, draft research tasks, validate evidence schemas | Granting live, editing envelopes/roots, resetting breakers, changing `BUY`/`SELL` |
| **Explicitly invoked bounded reopt** | Search candidate parameters within authorized budgets | Auto-starting from production drift, exceeding budgets, changing symbols, bypassing WFA/OOS |
| **Human** | Accept/reject tickets, choose platform and risk preference, authorize new promotions | Routine calendar parameter tweaking via cron |

Consoles and issues display **status + next human action**; internal SHAs, ticket IDs, and fold details collapse into details.

## 5. Implementation reference (2026-09-08 source check)

| Layer | Status | Notes |
| --- | --- | --- |
| `QuantPlatformKit` `run_research_promotion_cycle` | Library merged | Bounded research chain on explicit invocation; not production auto-enablement |
| `QuantPlatformKit` `ResearchPromotionBudget` | Merged | Rejects `allow_live_enablement=True` at construction |
| `QuantPlatformKit` `enforce_promotion_backtest_gates` | Merged | Fail-closed between reopt and shadow (`PARK` on missing/failed evidence) |
| `QuantPlatformKit` `evaluate_production_drift_health` | Merged | Versioned thresholds + read-only metrics -> `DriftResult`; evaluation only |
| `QuantPlatformKit` `production_drift_health_probe` | Merged | CLI + `from-store`; missing score -> `PARK`; zero optimize |
| `QuantPlatformKit` `production_drift_new_risk` -> `NEW_RISK` | Merged (`d5f3723`) | Policy A: `REVIEW`/`CRITICAL` prohibit new risk with zero optimize |
| Store -> `NEW_RISK` helper & platform injection | Code merged | QPK, Schwab, LongBridge merged; trading profile read from `RUNTIME_TARGET_JSON` |
| Lifecycle bucket config sync | Code merged | Schwab/LongBridge merged; GitHub vars alone do not attest Cloud Run adoption |
| SOXL core-only baseline / history support | Code merged | `UsEquityStrategies` / `UsEquitySnapshotPipelines` merged; live baseline scores unverified |
| Scheduled cron autonomous reopt | Forbidden | Must never be added; health checks remain zero-optimization |
| `build_config` `scheduled_*` trigger copy | Clarified | Means lane eligibility for drift/manual retests, not calendar optimization |

Production scores come solely from the lifecycle store (`gs://<shared-bucket>/strategy-lifecycle/v1`) rather than being recomputed from platform logs or UES; platform lifecycle observation and UES `drift-check` read/write that single prefix. Historical inject reports and GitHub vars do not substitute for checking Cloud Run deployment adoption and live `drift_score` availability per trading profile.

In the broader P0–P6 matrix, daily P1–P3 runs, portfolio readiness checks, and AIAudit diagnostics sit on the **observation/recording** track (see [P0–P6 Current State and Driver Policy](qsl-p0-p6-current-state-and-driver-policy.md)) rather than auto-tuning or auto-trading.

## 6. Non-goals and cross-references

Excluded: calendar-driven parameter refits, AI or cron edits to live parameters/tiers/P4–P6, synthetic metrics bypassing WFA/OOS, overwriting active runtime versions from new plugins, and parallel promotion frameworks outside `research_promotion_cycle` + `BacktestOrchestrator`.

- `QuantPlatformKit/src/quant_platform_kit/strategy_lifecycle/research_promotion_cycle.py`
- `QuantPlatformKit/src/quant_platform_kit/strategy_lifecycle/production_drift_evaluator.py`
- `QuantPlatformKit/src/quant_platform_kit/strategy_lifecycle/production_drift_health_probe.py`
- [Promotion risk standard](https://github.com/QuantStrategyLab/QuantPlatformKit/blob/main/docs/strategy-promotion-risk-standard.zh-CN.md)
- [Capital Risk Envelope V1](qsl-capital-risk-envelope-v1.md)
- [Multi-Strategy Combo A→B V1](qsl-multi-strategy-combo-ab-v1.md)
- [Research Task Contract V1](qsl-research-task-v1.md)

## 7. Remaining operational verification

1. Ongoing readback and validation from production metrics to `drift_score` (not gate reinvention).
2. Per-trading-profile verification of Cloud Run deployment config and store consumption for `NEW_RISK`.
3. Keep health checks zero-reopt and confirm shared lifecycle bucket alignment between Cloud Run and UES `drift-check`.
4. Keep console `AWAITING_HUMAN` summaries free of default live-enable buttons; W3/cloud enablement still requires separate account inventory, credentials, and explicit enable authorization.
