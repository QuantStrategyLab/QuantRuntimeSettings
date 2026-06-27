# QMT（A 股）Runtime Target 架构

[English](README.md)

当前阶段：**仅 dry-run，无 live 券商账号**。中信 / 国金等券商差异不在 `platform_id` 层建模，将来 live 时在 `account-options` 增加 target 项并在对应 miniQMT 部署侧区分即可。

## 分层

| 层 | 仓库 / ID | 说明 |
| --- | --- | --- |
| 策略 | `CnEquityStrategies` / `cn_*` profile | 仅 `cn_equity` domain |
| 平台 | `QmtPlatform` / `platform_id=qmt` | 统一 miniQMT 执行层，一个 Platform 仓 |
| 运行配置 | `QuantRuntimeSettings` | target 示例、切换控制台、`manual-strategy-switch` |
| 变量作用域 | `variable_scope=repository` | QMT 使用仓库级 GitHub Variables |

## Runtime-enabled 策略（切换页可选）

| Profile | 输入 | 示例 target |
| --- | --- | --- |
| `cn_industry_etf_rotation` | `market_history` | `industry_etf_dry_run.example.json`（**主轨**） |
| `cn_industry_etf_rotation_aggressive` | `market_history` | `industry_etf_aggressive_dry_run.example.json`（**optional，vol25%**） |
| `cn_dividend_quality_snapshot` | `feature_snapshot` | `dividend_quality_dry_run.example.json` |

`cn_index_etf_tactical_rotation` 在策略 catalog 中为 **research_backtest_only**，不要放进 `strategy-profiles.example.json` 的 runtime 列表。

## 账号路由（`account-options`）

每个 **dry-run target** 对应控制台一条 QMT 账号项，字段对齐示例 JSON：

- `target_name`：与 `examples/targets/qmt/*.example.json` 的 target 名一致
- `variable_scope`：`repository`
- `deployment_selector` / `account_selector`：`qmt`
- `account_scope`：`CN`
- `service_name`：`qmt-quant-service`
- `cash_currency`：`CNY`
- `supported_domains`：`["cn_equity"]`
- `default_strategy_profile`：与该 target 默认策略一致

**不要**在账号配置里放 miniQMT 密码、券商 token 或本机路径；fixture 路径走 QmtPlatform 仓库变量（如 `QMT_MARKET_HISTORY_PATH`）。

## 执行模式

- 控制台 QMT tab **锁定 paper（dry-run）**，Worker 拒绝 `execution_mode=live`。
- `QMT_DRY_RUN_ONLY=true` 为默认；live 上线前需单独评审并扩展 workflow / sync。

## 与美股平台的差异

- 美股：一个券商一个 Platform 仓（IBKR、Schwab…），同一策略可跨平台。
- A 股：仅 **QMT 一个 Platform 仓**；多策略、多 dry-run target，但无「中信 Platform / 国金 Platform」拆分。

## 部署 checklist（当前）

1. `strategy-profiles.example.json` 登记 runtime-enabled 的 `cn_*` profile
2. `account-options.example.json` 配置 QMT dry-run 账号项
3. 同步 KV：`strategy_profiles`、`account_options`
4. 触发 `manual-strategy-switch`（platform=`qmt`）— Cloud Run env sync 仍会 skip，属预期
