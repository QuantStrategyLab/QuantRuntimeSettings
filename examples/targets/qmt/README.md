# QMT (A-share) runtime target architecture

[简体中文](README.zh-CN.md)

Current phase: **dry-run only, no live broker account**. Broker differences (CITIC,
Guojin, etc.) are not modeled at the `platform_id` layer; when live trading is
enabled, add target entries in `account-options` and distinguish miniQMT
deployments on the broker side.

## Layers

| Layer | Repo / ID | Notes |
| --- | --- | --- |
| Strategy | `CnEquityStrategies` / `cn_*` profile | `cn_equity` domain only |
| Platform | `QmtPlatform` / `platform_id=qmt` | Unified miniQMT execution layer |
| Runtime settings | `QuantRuntimeSettings` | Target examples, switch console, `manual-strategy-switch` |
| Variable scope | `variable_scope=repository` | QMT uses repository-level GitHub Variables |

See the Chinese README for workflow wiring, variable names, and operator steps.
