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
| `GLOBAL_TELEGRAM_CHAT_ID` | org/repo variable 或 VPS systemd（勿写入公开仓库） |

别名见 `platform-config.json` → `notifications.quant_sentinel.env_aliases`。

## VPS

```bash
# AIAuditBridge/ops/quant-monitor
scripts/load_telegram_env.sh /run/quant-monitor/telegram.env
systemd/codex-quant.service.example     # ExecStartPre + EnvironmentFile
scripts/daily_briefing_pipeline.sh      # → AIAuditBridge --dispatch
```

## Cloud Run

`STRATEGY_PLUGIN_ALERT_TELEGRAM_BOT_TOKEN_SECRET_NAME=quant-sentinel-telegram-bot-token`
`GLOBAL_TELEGRAM_CHAT_ID` 来自 repo variable。

平台执行日报仍用各平台 `TELEGRAM_TOKEN_SECRET_NAME`（独立 bot）。
