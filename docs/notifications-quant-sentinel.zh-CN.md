# 量化哨兵（QuantSentinel）通知架构

真源：`QuantRuntimeSettings/platform-config.json` → `notifications.quant_sentinel`

## GCP Secret

| 名称 | 用途 |
|------|------|
| `quant-sentinel-telegram-bot-token` | 组织统一哨兵 bot（监控、简报、插件告警） |
| `crisis-alert-telegram-bot-token` | **已弃用**，保留只作回滚 |

各平台 GCP 项目均应有 sentinel secret 副本：`firstradequant`、`longbridgequant`、`charlesschwabquant`、`interactivebrokersquant`。

## 环境变量（运行时）

| 变量 | 说明 |
|------|------|
| `TELEGRAM_TOKEN` | bot token（Cloud Run 由 secret ref 注入；VPS 由 `load_telegram_env.sh`） |
| `QSL_GLOBAL_TELEGRAM_CHAT_ID` | 首选跨平台路由变量（运行环境注入） |
| `GLOBAL_TELEGRAM_CHAT_ID` | 兼容回退变量（运行环境注入） |

公开 `platform-config.json` 只记录 `notifications.quant_sentinel.telegram_chat_id_ref`，不保存实际通知目标；别名见 `env_aliases`。实际值只能从 GitHub/Cloud 受控运行环境注入。配置校验会对每个带 `telegram_chat_id_ref` 的通知器执行同一规则，新增策略或插件不能绕过该约束。

## VPS

```bash
scripts/load_telegram_env.sh /run/quant-monitor/telegram.env
systemd/quant-monitor.service.example   # ExecStartPre + EnvironmentFile
scripts/daily_briefing_pipeline.sh      # → AIAuditBridge --dispatch
```

## Cloud Run

`STRATEGY_PLUGIN_ALERT_TELEGRAM_BOT_TOKEN_SECRET_NAME=quant-sentinel-telegram-bot-token`
`GLOBAL_TELEGRAM_CHAT_ID` 来自 repo variable。

平台执行日报仍用各平台 `TELEGRAM_TOKEN_SECRET_NAME`（独立 bot）。
