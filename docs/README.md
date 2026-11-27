# Documentation index

[English README](../README.md) · [中文 README](../README.zh-CN.md)

## Architecture and applicability

| Document | Scope and reading order |
| --- | --- |
| [Package architecture](ARCHITECTURE.md) | Primary entry for the configuration package, generated targets, tooling, web application and runtime-authority boundary. Read against the revision you consume; this is not deployed-state evidence. |
| [Organization architecture](qsl-org-architecture.md) | Complementary repository governance: compatibility bundles, tiers/rings, dependency checks and release boundaries. It does not replace the package architecture or certify runtime health. |
| [ADR 0002: observation and identity boundaries](adr/0002-observation-and-identity-boundaries.md) | Accepted rules R1–R5 for console reads, account identity and projection scope, with the finite exception register and what the decision does not change. It changes no request behaviour and certifies no current path as compliant. |
| [Configuration-driven design, 2026-06-29](architecture-config-driven.md) | Dated Chinese design rationale and migration phases. Its file lists, deployment examples and proposed phases describe that design baseline; use the package architecture and current tooling for present interfaces. English overview below. |

### English overview of the dated configuration design

The June 2026 design proposed one `platform-config.json` source for platform metadata, capabilities and domains, with build-time Python generation feeding the frontend/Worker. Strategy catalog features govern which controls are shown. The purpose was to remove repeated platform/strategy constants and derive generated assets from configuration. Its extraction, frontend refactor and generation phases are a plan, not proof that each phase or example is current or deployed.

The current package retains configuration and compatibility ownership. Broker credentials, order execution and strategy logic stay in their owning repositories. `RUNTIME_TARGET_JSON` is desired deployment state; settings, CI, lifecycle labels or workflow dispatch do not grant runtime, fund or stage-change authority. The complete [P0–P6 boundary](ARCHITECTURE.md#p0p6-runtime-authority-boundary) remains applicable.

## Conventions

| Document | Scope |
| --- | --- |
| [GCP resource naming convention](gcp-resource-naming-convention.md) · [中文](gcp-resource-naming-convention.zh-CN.md) | Names and labels for new GCP resources (buckets, Cloud Run, Scheduler, secrets, service accounts), the Google-managed name allowlist and the tiered policy for existing resources. Convention only; it authorizes no rename, migration or cloud change. |
| [Canonical naming registry](canonical-naming-registry.md) · [中文](canonical-naming-registry.zh-CN.md) | Closed platform slugs (`schwab`, `firstrade`, `ibkr`, `longbridge`, `binance`), `{platform}:{env}:{slot}` account tuples, `{market}_{asset}_{family}_{horizon}` strategy IDs, `obs_*`/`risk_*` plugin prefixes, 1:1 risk-tier mapping, and non-breaking `legacy_aliases`. Convention and registry only; authorizes no rename, migration, or runtime change. |

## Console by task

- [Read-only preflight baseline](console-readonly-baseline.md): pinned repository build, exact reconstruction command and pending live verification.
- [English operator guide](../web/strategy-switch-console/README.md#reading-by-task) · [中文操作入口](../web/strategy-switch-console/README.zh-CN.md#按任务阅读): installation/configuration, interfaces and operations grouped without moving contract text.
- [Console API](console-api.md): interface details.
- [Snapshot completeness](snapshot-completeness.md): cloud archive checks, daily Binance detail, and approval-bound activation.
- [Account-identity inventory](account-identity-inventory.md): no-write enumeration of Durable Object account-identity state, collection runbook and offline assembly. Observation only; it grants no authority.
- [Account mapping authority](account-mapping-authority.md): eligible/display-only classification policy, evidence states, inventory adapter contract and the runtime-instance read projection.
- [English fork guide](strategy-switch-fork-guide.md) · [中文 Fork 指南](strategy-switch-fork-guide.zh-CN.md): installation in a separately configured environment.
- [English permission model](manual-strategy-switch-permission-control.md) · [中文权限说明](manual-strategy-switch-permission-control.zh-CN.md).
- [Unified control console architecture V1](qsl-unified-control-console-architecture-v1.md) · [中文](qsl-unified-control-console-architecture-v1.zh-CN.md): single human control-plane surface, source snapshots, and owner decision boundaries.
- [Console information design](console-information-design.md) · [中文](console-information-design.zh-CN.md): overview/account/research layout, frontend rules, IBKR account naming, KV audit deduplication, and frozen research index.
- [Credential maintenance](credential-maintenance.md) · [中文](credential-maintenance.zh-CN.md): shared `ibkr_flex` expiry registration, reminder deduplication, and write-only rotation endpoints.
- [Secrets and account config architecture](secrets-architecture.md) · [中文](secrets-architecture.zh-CN.md): secret layering, Worker account catalogs, Gateway vs. cloud split, and rotation proxy architecture.

## Control plane, risk, and lifecycle contracts

| Document | Scope |
| --- | --- |
| [P0–P6 current state and driver policy](qsl-p0-p6-current-state-and-driver-policy.md) · [中文](qsl-p0-p6-current-state-and-driver-policy.zh-CN.md) | P0–P6 lifecycle boundaries, component matrix, internal dependency checks, and dated evidence reference. |
| [Autonomous operating policy V2](qsl-autonomous-operating-policy-v2.md) · [中文](qsl-autonomous-operating-policy-v2.zh-CN.md) | `PREAUTHORIZED_AUTONOMY` bounds, privilege zones, and OpenSSH/Cloud KMS verification gate. |
| [GCP P0 control root deployment V1](qsl-gcp-p0-control-root-deployment-v1.md) · [中文](qsl-gcp-p0-control-root-deployment-v1.zh-CN.md) | Per-domain Cloud KMS P-256 public verification roots and retired shadow-control root notes. |
| [Deterministic execution gateway V1](qsl-deterministic-execution-gateway-v1.md) · [中文](qsl-deterministic-execution-gateway-v1.zh-CN.md) | Three-layer isolation, `PARKED` vs. `RECONCILE_ONLY` admission, and gateway acceptance rules. |
| [Deterministic risk gate kernel V1](qsl-deterministic-risk-gate-kernel-v1.md) · [中文](qsl-deterministic-risk-gate-kernel-v1.zh-CN.md) | Pure in-memory `ALLOW_NEW_RISK` / `NEW_RISK_PROHIBITED` decision kernel and breaker semantics. |
| [P4/P5 unattended delivery V1](qsl-p4-p5-autonomy-delivery-v1.md) · [中文](qsl-p4-p5-autonomy-delivery-v1.zh-CN.md) | Paper (`P4`) and shadow (`P5`) forward-observation risk controls and state machine. |
| [Lifecycle truth V1](qsl-lifecycle-truth-v1.md) · [中文](qsl-lifecycle-truth-v1.zh-CN.md) | Canonical lifecycle stages, console read precedence, and monitoring vs. execution evidence. |
| [Promotion activation control plane](promotion-activation-control-plane.md) · [中文](promotion-activation-control-plane.zh-CN.md) | Signed promotion manifest verification, single-use tag ledger, and variable readback. |
| [Universal dry-run coverage V1](qsl-universal-dry-run-coverage-v1.md) · [中文](qsl-universal-dry-run-coverage-v1.zh-CN.md) | Mandatory `dry_run` mode contract, buildable route coverage, and artifact freshness gate. |
| [Capital risk envelope V1](qsl-capital-risk-envelope-v1.md) · [中文](qsl-capital-risk-envelope-v1.zh-CN.md) | Equity-tiered sizing, volatility/drawdown scalars, and `NEW_RISK_PROHIBITED` account gate. |
| [Multi-strategy combo A→B V1](qsl-multi-strategy-combo-ab-v1.md) · [中文](qsl-multi-strategy-combo-ab-v1.zh-CN.md) | Virtual combo research and multi-account aggregate risk path selection. |
| [Long-horizon risk composer V1](qsl-long-horizon-risk-composer-v1.md) · [中文](qsl-long-horizon-risk-composer-v1.zh-CN.md) | Offline Composer V1 calculation, dual-basis risk preference, and bounded private ingress. |
| [Long-horizon risk observation V2](qsl-long-horizon-risk-observation-v2.md) · [中文](qsl-long-horizon-risk-observation-v2.zh-CN.md) | Portable risk profile selection, `risk_capability`, and `benchmark_policy` v2 schema. |
| [Drift-triggered research HITL V1](qsl-drift-triggered-research-hitl-v1.md) · [中文](qsl-drift-triggered-research-hitl-v1.zh-CN.md) | Production Policy A no-auto-reopt boundaries and bounded explicit research promotion gates. |
| [Research task contract V1](qsl-research-task-v1.md) · [中文](qsl-research-task-v1.zh-CN.md) | `qsl.research_task.v1` no-order research requests and dedicated console projection. |
| [Development research review V1](qsl-development-research-review-v1.md) · [中文](qsl-development-research-review-v1.zh-CN.md) | `qsl.development_research_review.v1` read-only consumer validation and receipt persistence. |
| [Strategy plugin contract V2](qsl-strategy-plugin-contract-v2.md) · [中文](qsl-strategy-plugin-contract-v2.zh-CN.md) | Signal-only plugin contract, `P1`/`P2`/`P3` digest binding, and legacy mount retirement. |

## Notifications and daily digest

| Document | Scope |
| --- | --- |
| [QuantSentinel notification architecture](notifications-quant-sentinel.md) · [中文](notifications-quant-sentinel.zh-CN.md) | Unified sentinel bot secret contract, daily digest behavior, `sections_v2`, and route checks. |
| [Daily digest candidates wiring](digest-candidates-wiring.md) · [中文](digest-candidates-wiring.zh-CN.md) | `qsl.digest_candidates.v1` schema, freshness rules, private store intake, and preflight. |
| [Daily digest route diagnosis](digest-route-identity.md) · [中文](digest-route-identity.zh-CN.md) | Read-only `digest-bot-identity.yml` token/chat resolution checks and public projection. |

## Quant YARDSTICK & PILOT

| Document | Scope |
| --- | --- |
| [PILOT pre-registration (`PREREG-R5`)](quant/pilot-preregistration.md) | Pre-registered `28`-slot `PILOT` protocol, stress windows, research cost model, and simulated re-arming rules (`live=OFF`). |
| [PILOT results (`Policy v0`)](quant/pilot-results.md) | Deterministic `PREREG-R5` empirical results across unpooled synthetic and real-fund buckets, `US$1,500` viability, and candidate `policy v0`. |
| [Experiment ledger](quant/experiment-ledger.md) | Append-only `K_trials` registry (`L-001`–`L-054`, `K_trials = 69`). |

The existing complete documents retain their interfaces and risk controls. Index links and English summaries do not authorize deployment or change data/provider rights. See [LICENSE](../LICENSE).
