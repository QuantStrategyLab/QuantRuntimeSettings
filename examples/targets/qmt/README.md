# QMT (A-share) runtime target architecture

[简体中文](README.zh-CN.md)

Current phase: **dry-run only, no live broker account**. Broker differences (CITIC,
Guojin, etc.) are not modeled at the `platform_id` layer; when live trading is
enabled, add target entries in `account-options` and distinguish miniQMT
deployments on the broker side.

## Targets

| Target JSON | Profile | Description |
| --- | --- | --- |
| `industry_etf_dry_run.example.json` | `cn_industry_etf_rotation` | Conservative ETF rotation (research only) |
| `industry_etf_aggressive_dry_run.example.json` | `cn_industry_etf_rotation_aggressive` | Aggressive ETF rotation (vol25%) |
| `dividend_quality_dry_run.example.json` | `cn_dividend_quality_snapshot` | Dividend quality snapshot |
| `cn_combo.example.json` | `cn_equity_combo` | Combo: 30/50/20 ETF/stock/dividend (dynamic) |

## Layers

| Layer | Repo / ID | Notes |
| --- | --- | --- |
| Strategy | `CnEquityStrategies` / `cn_*` profile | `cn_equity` domain |
| Combo | `QuantCnComboStrategies` / `cn_equity_combo` | Combo profile combining sub-strategies |
| Platform | `QmtPlatform` / `platform_id=qmt` | Unified miniQMT execution layer |
| Runtime settings | `QuantRuntimeSettings` | Target examples, switch console, `manual-strategy-switch` |
| Variable scope | `variable_scope=repository` | QMT uses repository-level GitHub Variables |

See the Chinese README for workflow wiring, variable names, and operator steps.
