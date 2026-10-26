# Documentation index

[English README](../README.md) · [中文 README](../README.zh-CN.md)

## Architecture and applicability

| Document | Scope and reading order |
| --- | --- |
| [Package architecture](ARCHITECTURE.md) | Primary entry for the configuration package, generated targets, tooling, web application and runtime-authority boundary. Read against the revision you consume; this is not deployed-state evidence. |
| [Organization architecture](qsl_org_architecture.md) | Complementary repository governance: compatibility bundles, tiers/rings, dependency checks and release boundaries. It does not replace the package architecture or certify runtime health. |
| [Configuration-driven design, 2026-06-29](architecture_config_driven_20260629.md) | Dated Chinese design rationale and migration phases. Its file lists, deployment examples and proposed phases describe that design baseline; use the package architecture and current tooling for present interfaces. English overview below. |

### English overview of the dated configuration design

The June 2026 design proposed one `platform-config.json` source for platform metadata, capabilities and domains, with build-time Python generation feeding the frontend/Worker. Strategy catalog features govern which controls are shown. The purpose was to remove repeated platform/strategy constants and derive generated assets from configuration. Its extraction, frontend refactor and generation phases are a plan, not proof that each phase or example is current or deployed.

The current package retains configuration and compatibility ownership. Broker credentials, order execution and strategy logic stay in their owning repositories. `RUNTIME_TARGET_JSON` is desired deployment state; settings, CI, lifecycle labels or workflow dispatch do not grant runtime, fund or stage-change authority. The complete [P0–P6 boundary](ARCHITECTURE.md#p0p6-runtime-authority-boundary) remains applicable.

## Console by task

- [English operator guide](../web/strategy-switch-console/README.md#reading-by-task) · [中文操作入口](../web/strategy-switch-console/README.zh-CN.md#按任务阅读): installation/configuration, interfaces and operations grouped without moving contract text.
- [Console API](console-api.md): interface details.
- [English fork guide](strategy_switch_fork_guide.md) · [中文 Fork 指南](strategy_switch_fork_guide.zh-CN.md): installation in a separately configured environment.
- [English permission model](manual_strategy_switch_permission_control.md) · [中文权限说明](manual_strategy_switch_permission_control.zh-CN.md).

The existing complete documents retain their interfaces and risk controls. Index links and English summaries do not authorize deployment or change data/provider rights. See [LICENSE](../LICENSE).
