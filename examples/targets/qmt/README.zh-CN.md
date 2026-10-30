# QMT（A 股）Runtime Target 架构

[English](README.md)

当前 QMT profile 的新增选择已冻结。本文保留历史接口说明，不改变既有目标、账号绑定或部署。

## 分层

| 层 | 仓库 / ID | 说明 |
| --- | --- | --- |
| 策略 | `CnEquityStrategies` / `cn_*` profile | 仅 `cn_equity` domain |
| 平台 | `QmtPlatform` / `platform_id=qmt` | 统一 miniQMT 执行层，一个 Platform 仓 |
| 运行配置 | `QuantRuntimeSettings` | 切换控制台、`manual-strategy-switch` 接口 |
| 变量作用域 | `variable_scope=repository` | QMT 使用仓库级 GitHub Variables |

## 新增选择状态

已移除冻结策略的 QMT target 示例；当前没有可供新增选择的 QMT profile。
历史策略 catalog 和接口继续保留，用于解析既有基线。

## 账号路由（`account-options`）

既有 QMT 账号项可包含以下字段；这些字段不构成新增选择授权：

- `target_name`：既有目标名称
- `variable_scope`：`repository`
- `deployment_selector` / `account_selector`：`qmt`
- `account_scope`：`CN`
- `service_name`：`qmt-quant-service`
- `cash_currency`：`CNY`
- `supported_domains`：`["cn_equity"]`
- 策略 profile 通过 GitHub 变量 `RUNTIME_TARGET_JSON.strategy_profile` 管理，不存储在账号配置中

**不要**在账号配置里放 miniQMT 密码、券商 token 或本机路径；fixture 路径走 QmtPlatform 仓库变量（如 `QMT_MARKET_HISTORY_PATH`）。

## 执行模式

- 控制台 QMT tab **锁定 paper（dry-run）**，Worker 拒绝 `execution_mode=live`。
- `QMT_DRY_RUN_ONLY=true` 为默认；live 上线前需单独评审并扩展 workflow / sync。

## 与美股平台的差异

- 美股：一个券商一个 Platform 仓（IBKR、Schwab…），同一策略可跨平台。
- A 股：仅 **QMT 一个 Platform 仓**；多策略、多 dry-run target，但无「中信 Platform / 国金 Platform」拆分。

恢复新增选择须经所有者明确决定和既有审批；本次清理不更新运行中的消费者或部署。
