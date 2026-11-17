# QuantStrategyLab P0–P6 Architecture and Operational Boundaries

English | [简体中文](qsl-p0-p6-current-state-and-driver-policy.zh-CN.md)

> Status: `ARCHITECTURE_AND_DATED_EVIDENCE_REFERENCE`
>
> Scope: P0–P6 candidate lifecycle and operational boundaries across `QuantStrategyLab`; does not replace live facts from strategy, broker, or deployment repositories.
>
> Boundary update: `2026-09-06`; candidate and runtime snapshots below reflect historical observations through `2026-08-27` and are not re-verified declarations of `paper`, `shadow`, `live`, deployment, or acceptance state.

This document defines the P0–P6 candidate lifecycle, component ownership, and dated evidence boundaries.
Runtime, broker, and strategy facts must always be re-read from authoritative sources before acting.

Documentation updates do not alter strategy IDs, parameters, risk caps, champions, or trading permissions.
Code, CI, merges, deployments, consumer adoption, and real business acceptance are tracked separately.

## Change and authorization boundaries

- Keep one writer per repository; serialize public contract updates, shared environments, and same-account capital operations.
- Every driver must stay strictly within its assigned phase, artifact, and evidence scope without expanding into other stages, repositories, or execution targets.
- Model choice and parallelism are engineering settings only and never alter trading strategies, runtime inference routing, or trading gates.
- Drivers may perform read-only checks, policy-permitted local edits, and verifiable offline evidence, and must never self-label work as promotion, deployment, or runtime authorization.
- Coordinator sessions, AI audits, and strategy generators cannot issue, extend, or mutate autonomy policies; unverified facts remain unverified.
- `NO_DRIVER_PARKED` indicates no executable task is defined for that stage; never fabricate tasks, data fetches, or trading actions.

## Post-recovery remediation rules

- When resuming authorized work, inspect the current workspace and latest code/deployment records directly; stale open PRs or worktrees do not block independent offline work unless an active conflicting writer exists.
- Deduplicate findings and separate code fixes, consumer adoption, and live operational verification; do not rewrite already-merged fixes or re-classify unknown live state as a new code bug.
- Prioritize finishing pending adoption and real duplicate-submission/reconciliation gaps before research accounting, PIT/OOS hardening, AI evals, and compatibility cleanup—without halting unrelated authorized live runs.
- Avoid adding parallel hash chains or org-wide re-pinning when existing keys, transactions, constraints, and tests suffice, while preserving existing safety, funds, and evidence protections.
- Releases, live data/model calls, credential maintenance, and deployments require explicit per-action authorization; CI green never equals fills or reconciliation.
- Apply bounded diagnosis and minimal fixes per root cause; if the same target fails again after a fix, halt on that failure surface and report external conditions.

## P0–P6 candidate lifecycle snapshot (through 2026-08-27)

P1–P3 form a continuous **non-live** research chain producing verifiable artifacts at each stage.
Authorized production champions run on an independent `live_continuity` axis so candidate stops never disrupt live champions:

```text
Authorized champion (frozen LKG baseline) -> normal operation, health monitoring, reconciliation
                                                |
New challenger -> P1 -> P2 -> P3 -> paper/shadow -> canary -> replace champion only on explicit authorization
```

- Only `ACTIVE_LKG` / `ROLLBACK_LKG` permit ordinary execution within the target hash's frozen baseline and risk caps.
- `PAUSED`, `RECONCILE_ONLY`, `ACTIVE_REDUCED`, and `RISK_REDUCTION_ONLY` reject ordinary new orders while retaining health, reporting, monitoring, and reconciliation; position reduction requires dedicated platform executors.
- `RUNTIME_TARGET_ENABLED=false` remains a hard gate that continuity states cannot bypass, and passing P0–P6 never overwrites a champion or raises capital/leverage automatically.
- Before real recovery on any platform, inspect positions, open orders, last receipts, and deployment configuration directly and restore only an exact matching authorized baseline.

| Stage | Owning component | Historical state & evidence boundary | Permitted next step |
| --- | --- | --- | --- |
| P0 | `QuantRuntimeSettings` | Autonomy Policy V2, offline signature gates, and `RECONCILE_ONLY` admission code exist. Six GCP projects (`<binance-project-id>`, `<schwab-project-id>`, `<firstrade-project-id>`, `<ibkr-project-id>`, `<longbridge-project-id>`, `<research-project-id>`) hold read-verified Cloud KMS P-256 public roots without signer IAM or active policies; the separate `<alpaca-shadow-project-id>` (`AlpacaShadowControl`) P5 root was retired and removed. Automated GitHub Codex PR review callers were retired while CI and branch protections remain. | Maintain/audit control-plane facts only; never infer P1, P4–P6, or trading eligibility from P0. |
| P1 | `UsEquitySnapshotPipelines` | TQQQ/Alpaca track is **non-live**. `tqqq_core_only_p2_v5` daily controller passed CI (`DEFERRED` on 2026-08-20; create-only P1 root accepted on 2026-08-21, followed by P3 `PARKED`). `tqqq_core_only_p2_v9_benchmark_drawdown_guard` remains `PARKED / FREE_SOURCE_UNAVAILABLE`. SOXL/SOXX three-asset P1 (`SOXL`, `SOXX`, `BOXX`) and `soxl_soxx_core_only_p2_v3` daily research schedule landed with Alpaca SIP, `adjustment=all`, `exchange-calendars 4.13.2/XNYS`, bounded single 60 s HTTP `403` retry (`NOT_TRIGGERED` / `SIP_403_RECOVERED` / `SIP_403_EXHAUSTED`), and 35-day redacted Actions terminal artifacts. Schedule watchdog checks workflow run presence read-only. | Emit candidate-specific data identities, health records, and short-lived private roots without cross-strategy reuse or gap-filling. |
| P2 | `UsEquitySnapshotPipelines` | `tqqq_core_only_p2_v5` is wired to daily research; `tqqq_core_only_p2_v9_benchmark_drawdown_guard` freezes QQQ drawdown bounds without inputs; `soxl_soxx_core_only_p2_v3` freezes trend + internal vol de-leveraging; `soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve` freezes 3% cash reserve and `SOXX` benchmark; `tqqq_core_only_p2_v6_plugin_observe` records close-only QQQ signals without strategy invocation. | Freeze, verify, or supersede candidate specs only; never interpret CI or daily research as return proof or parameter tuning permission. |
| P3 | `UsEquitySnapshotPipelines` | TQQQ v5 synthetic chain passed CI; 2026-08-21 run yielded `PARKED`. TQQQ v9 stays `PARKED`. SOXL has independent P3 replay, 3-fold / 252-session OOS / 5-10-15 bps evidence plan; V7 cash-reserve replay passed historical P3 gates (`PASS_PENDING_FORWARD_CONFIRMATION`) and opened a 252-session forward window from `2026-08-26` (`PARKED / p4_forward_window_not_complete`). Combo candidates have P1/P3 preflight contracts, `MarketSignalSources` local create-only root sealing, synthetic OOS replay contracts, and read-only readiness issue tracking without active combo P1/P3 roots. | Generate matching non-live evidence only; never promote into paper, shadow, live, or parameter edits. |
| P4 | `QuantRuntimeSettings` (contract) | Automated paper risk-control contract implemented; no signed policy, paper identity, or broker adapter exists. | Connect an isolated Alpaca paper gateway verifying policy signatures, P1–P3 bindings, and reconciliation per cycle. |
| P5 | `AlpacaPlatform` (no-broker) | Shadow risk-control contract, create-only shadow ledger, v2 input adapter, controller, risk-bound receipt admission, single-cycle parked orchestration, and injected-client GCS artifact adapter exist; zero cloud buckets, deployed schedulers, active policies, or real shadow receipts exist. | Wire restricted no-broker scheduler + atomic create-only writer once independent policy-gate and reconciled snapshots are supplied. |
| P6 | `NO_DRIVER_PARKED` | No live, account, order, or funding tasks defined. | Any live enablement requires explicit owner authorization; never self-created by drivers or AI. |

## Strategies, combinations, and plugins: horizontal product layer

P0–P6 applies uniformly across single strategies, combinations, and plugins—each candidate requires its own P1 input binding, P2 frozen config, and P3 evidence without inheriting conclusions across candidates.
`UsEquitySnapshotPipelines`'s multi-strategy driver registry records per-route readiness (`DAILY_RESEARCH_WIRED` for TQQQ v5 and SOXL/SOXX v3; `MANUAL_RESEARCH_WIRED` for TQQQ v9 and SOXL v7) without scheduling or granting P4–P6 authority.

- **Single strategies:** TQQQ v5 and SOXL/SOXX v3 run non-live daily P1/P3 research workflows; SOXL v7 runs manual historical P3 plus forward window observation; TQQQ v9 remains parked on unavailable dual-source data.
- **Portfolio combinations:** require freezing a dedicated combo candidate with member revisions, weights/rebalancing, common cutoff, portfolio risk, and costs across P1–P3. Pure portfolio risk budgeting, virtual target construction, P1/P2/P3 schemas, `MarketSignalSources` create-only P1 root sealing, synthetic OOS replay, and `portfolio-candidate-readiness` (emitting `AI_RESEARCH_PROPOSAL_READY` only when TQQQ v5 and SOXL v3 P1/P3 artifacts match on cutoff) exist without real combo P1 roots or P4–P6 eligibility.
- **Strategy plugins:** legacy `latest_signal.json` auto-mounting is retired to a safe no-op; `qsl.strategy-plugin-signal.v2` (see [Strategy Plugin Contract V2](qsl-strategy-plugin-contract-v2.md)) defines future P1/P2/P3-recomputable signals only. TQQQ daily chains mount no plugins.

## Capital, sizing, portfolio, and breaker capability matrix

```text
P1 verifiable input -> research signal (optional) -> single-strategy P2 target
    -> portfolio P2 allocation -> independent risk/breaker gateway -> deterministic execution -> broker
                                                ^
                        AI observes, alerts, and proposes candidates out-of-band only
```

| Capability | Current verifiable state | What it cannot do | Prerequisite to enter mainline |
| --- | --- | --- | --- |
| Single-strategy target sizing | Research strategies compute target weights in frozen P2 configs (e.g., TQQQ trend + internal vol de-leveraging). | Not account-level sizing; cannot read accounts, submit orders, or mutate P2. | Complete candidate's own P1 binding and P3 recomputation. |
| Portfolio risk budget | `UsEquityStrategies` pure `portfolio_risk_budget`, combo P1/P2/P3 contracts, and `MarketSignalSources` local create-only root sealing. | Reads no market/account data; generates no orders; no real combo P1 root or P3 replay. | Acquire licensed common history, freeze combo candidate, complete P1–P3. |
| Account position/exposure caps | P0 `risk_control` digests, P4/P5 offline risk contracts, and in-memory [Deterministic Risk Gate Kernel V1](qsl-deterministic-risk-gate-kernel-v1.md). | Reads no real accounts; `ALLOW_NEW_RISK` is not order permission. | Wire isolated execution gateway injecting reconciled snapshots and persisting redacted receipts. |
| Circuit breakers | `RECONCILE_ONLY` admission and fail-closed P4/P5 contracts; risk kernel returns `NEW_RISK_PROHIBITED` + `OPEN` on breaches. | No broker-wired breaker; cannot claim auto-blocking, persistence, or liquidation. | Wire "halt new risk" first; manual/pre-encoded recovery rules only. |
| Dual-basis risk preference | Composer MDD ceilings (`1.00` / `1.25` / `1.50`) vs. promotion sizing (`0.50` / `0.75` / `1.00` for new promotions/material changes). | Never treat `1.50x` as `1.5x` sizing or resize legacy live positions. | Keep separate in UI/docs; sizing still passes `RiskEngine`. |
| Kelly sizing | Disabled across mainline, portfolio, and account risk controls. | Cannot scale capital from historical wins or AI judgment. | Future fractional-Kelly research candidate must pass OOS, uncertainty haircuts, hard caps, and P1–P3. |

External design references (non-operational evidence):

- [QuantConnect Algorithm Framework](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/overview) — separates alpha, portfolio construction, risk management, and execution.
- [QuantConnect Live Reconciliation](https://www.quantconnect.com/docs/v2/writing-algorithms/live-trading/reconciliation) — requires reconciliation across backtest assumptions, broker state, and live fills.
- [Federal Reserve SR 11-7](https://www.federalreserve.gov/boarddocs/srletters/2011/sr1107a1.pdf) — emphasizes conceptual soundness, outcome analysis, and ongoing monitoring.
- [Alpaca Paper Trading](https://docs.alpaca.markets/docs/paper-trading) — paper execution does not cover market impact, latency slippage, or queue position.

## Autonomy policy as an independent gate

Unattended P1/P3 daily research runs within immutable candidate configs without per-run clicks; P5 has pure ledger/controller/ingress pieces awaiting signed `PREAUTHORIZED_AUTONOMY` policies and restricted storage/schedulers; P4 remains unwired; P6 `live` always requires explicit owner enablement.
Automated P4 (`PAPER_BROKER`) is per-platform where supported, while platforms without paper endpoints stay on P5 shadow without false failures; only matching strategy/data/execution evidence surfaces `P6_LIMITED_LIVE_CANARY_DECISION_REQUIRED`.

AI performs monitoring, candidate generation, evidence validation, redacted diagnosis, and release evaluation only—never touching credentials, submitting orders, resetting breakers, or mutating policy roots or caps.
`AIAuditBridge` is the active audit control plane (`CodexAuditBridge` and Codex GitHub PR callers are retired).

## Implementation register (preventing design/runtime confusion)

As of `2026-08-27`, `wired` denotes merged interfaces rather than live execution:

- **P0 console & control plane:** read-only Worker snapshot aggregation (`qsl_control_plane_dashboard.v1`, `qsl_research_task_dashboard.v1`); never issues P1–P6 authority.
- **P1–P3 daily/manual research:** TQQQ v5 daily, TQQQ v9 (`PARKED` on free sources), TQQQ v6 plugin-observe (35-day redacted artifact), SOXL/SOXX v3 daily, SOXL v7 historical P3 + 252-session forward wait, daily schedule watchdog (UTC `11:20` read-only check), `SyntheticLongHistoryStress`, and portfolio readiness issue tracker (`PARKED` unless matched cutoff P1/P3 artifacts exist).
- **AIAuditBridge & Watcher:** creates deduplicated diagnosis issues after two comparable P1/P2/P3 observations and runs bounded single-pass read-only AI diagnosis without touching code or parameters.
- **P5 & Composer pieces:** forward observation, shadow ledger, risk-bound receipt admission, single-cycle orchestration, injected-client GCS adapter, Composer v1/v2 cores and exact ingress ports—all lacking real buckets, workload identities, signed policies, deployed schedulers, or live shadow runs.
- **Retired local directories:** `QuantStrategyLifecycle` and `CodexAuditBridge` are retired/isolated and must not be referenced for current capability or new workflows.

## Internal dependencies: two separate checks

| Check | Question answered | What it does not prove |
| --- | --- | --- |
| **matrix current** | Do checked-out consumer manifests match `internal_dependency_matrix.json` pins without drift or untracked internal deps? | Does not prove the chosen compat bundle is valid or execution-ready. |
| **qslctl bundle drift** | Do consumer bundle, tier/ring, and manifests satisfy `compat/bundles/` compatibility contracts? | Does not replace matrix currency snapshots or prove runtime readiness. |

```bash
python3 python/scripts/check_internal_dependency_matrix.py --projects-root /path/to/prepared-workspace --strict
python3 python/scripts/qslctl.py check --repo-root /path/to/consumer-repo
```

`/path/to/...` is a portable placeholder rather than a local workstation path or deployed target.

## Known dated evidence boundaries

- `2026-08-03`: legacy roadmap pointer date; workstation paths are retired and confer no runtime status.
- `2026-08-12`: `docs/quant-roadmap.md` marked `HISTORICAL_POINTER_ONLY`.
- `2026-08-15`: `compat/bundles/2026.08.0.toml` compatibility bundle creation date.
- `2026-08-17` to `2026-08-19`: initial TQQQ P1–P3 non-live workflow merge and synthetic offline chain CI checks; raw P1 root expired per short retention without implying promotion.
- `2026-08-20`: first v5 scheduled run (`DEFERRED`), Alpaca P5 shadow ledger/v2 adapters/controller merges, portfolio budget/P1–P3 descriptor merges, `qsl.strategy-plugin-signal.v2` merges, SOXL P2/P3 executor and P1 publisher/workflow merges, and `AlpacaPlatform` receipt admission merges.
- `2026-08-21` to `2026-08-27`: TQQQ v5 P1 accepted / P3 `PARKED`, schedule watchdog window fix (`UTC 11:20`), `SyntheticLongHistoryStress` track, combo synthetic OOS replay and readiness tracker, `MarketSignalSources` create-only P1 root sealer, `AlpacaPlatform` single-cycle parked orchestration and GCS artifact adapter, bounded HTTP 403 retry, and P0 KMS root initialization across the six Quant GCP projects.
- `2026-11-01`: standalone `<alpaca-shadow-project-id>` (`AlpacaShadowControl`) P5 root record and test assertions removed from the repository; P0 public roots returned to the six bootstrap projects.

## Related repository references

- [Unified Control Console Architecture V1](qsl-unified-control-console-architecture-v1.md)
- [Autonomous Operating Policy V2](qsl-autonomous-operating-policy-v2.md)
- [Deterministic Execution Gateway V1](qsl-deterministic-execution-gateway-v1.md)
- [GCP P0 Control Root Deployment V1](qsl-gcp-p0-control-root-deployment-v1.md)
- [Organization Architecture](qsl-org-architecture.md)
- [Internal Dependency Pin Policy](internal-dependency-pin-policy.md)
- [2026.08.0 compatibility bundle](../compat/bundles/2026.08.0.toml)
