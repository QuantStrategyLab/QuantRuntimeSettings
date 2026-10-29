# QMT (A-share) runtime target architecture

[简体中文](README.zh-CN.md)

QMT profile selection is frozen. This document describes the retained interface;
it does not change existing targets, account bindings, or deployments.

## Targets

The retired QMT target examples have been removed. No QMT profile is currently
offered for new selection; the historical strategy catalog and interfaces remain
available for existing baseline resolution.

## Layers

| Layer | Repo / ID | Notes |
| --- | --- | --- |
| Strategy | `CnEquityStrategies` / `cn_*` profile | `cn_equity` domain |
| Combo | `CnEquityStrategies` / `cn_equity_combo` | Combo profile in the domain strategy package |
| Platform | `QmtPlatform` / `platform_id=qmt` | Unified miniQMT execution layer |
| Runtime settings | `QuantRuntimeSettings` | Switch console and `manual-strategy-switch` interfaces |
| Variable scope | `variable_scope=repository` | QMT uses repository-level GitHub Variables |

See the Chinese README for historical interface details.
