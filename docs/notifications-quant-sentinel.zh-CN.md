# 量化哨兵（QuantSentinel）通知架构

真源：`QuantRuntimeSettings/platform-config.json` → `notifications.quant_sentinel`

## GCP Secret（统一 bot）

| 名称 | 用途 |
|------|------|
| `quant-sentinel-telegram-bot-token` | **唯一**组织哨兵 bot（监控、收盘日报、插件告警、执行路径） |
| `crisis-alert-telegram-bot-token` | **已弃用**，保留只作回滚 |

各平台 GCP 项目均应有 sentinel secret **同名副本**（同一 bot）：`firstradequant`、`longbridgequant`、`charlesschwabquant`、`interactivebrokersquant`（以及加密侧若走 GCP 的项目）。

历史平台独立 bot secret **不得再作为执行日报入口**：

| 遗留 secret 名 | 状态 |
|----------------|------|
| `longbridge-telegram-token` | 遗留；GH 变量应改指 sentinel |
| `interactive-brokers-telegram-token` | 遗留 |
| `firstrade-telegram-token` | 遗留 |
| `charles-schwab-telegram-token` | 遗留 |

Binance 历史 GH secret 名 `TG_TOKEN` 应与 sentinel **同一 bot**；公开仓只记录名称，不写 token。

## GitHub 变量契约（名称，不是值）

| 变量名 | 期望值 |
|--------|--------|
| `TELEGRAM_TOKEN_SECRET_NAME` | `quant-sentinel-telegram-bot-token` |
| `STRATEGY_PLUGIN_ALERT_TELEGRAM_BOT_TOKEN_SECRET_NAME` | `quant-sentinel-telegram-bot-token` |
| `NOTIFY_LANG` / `QSL_NOTIFY_LANG` | `zh` 或 `en`（默认 zh） |

Chat 目标仍只通过运行时注入：`QSL_GLOBAL_TELEGRAM_CHAT_ID`（首选）→ `GLOBAL_TELEGRAM_CHAT_ID` → `STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS`。公开配置只有 `telegram_chat_id_ref`，禁止字面量 chat id。

## 环境变量（运行时）

| 变量 | 说明 |
|------|------|
| `TELEGRAM_TOKEN` | bot token（Cloud Run / preview 由 secret ref 注入；VPS 由 `load_telegram_env.sh`） |
| `QSL_GLOBAL_TELEGRAM_CHAT_ID` | 首选跨平台路由变量 |
| `GLOBAL_TELEGRAM_CHAT_ID` | 兼容回退 |
| `QSL_NOTIFY_LANG` / `NOTIFY_LANG` | 日报与预览文案语言 |

## 收盘跨平台日报（daily digest）

配置块：`notifications.quant_sentinel.daily_digest`（schema `qsl.daily_digest.v1`）。

### 行为

- **一条消息**，统一走 QuantSentinel bot，不按平台各发一只 bot。
- **只收录当日实际运行**的平台/策略：加密小时级有周期才出现；月末 DCA 仅在运行日出现；未运行的省略。
- **无运行或无成交**：发心跳-only 通知（短文案）；有成交则发完整日报列表。
- **不改交易/风控判定**；纯聚合展示。金额与账户标识不得写入公开 CI 日志。

### 调度（合同默认）

- 时区：`Asia/Shanghai`
- Cron：`0 6 * * 2-6`（周二至周六 06:00，覆盖前一美股 RTH 收盘）
- 加密按同一窗口并入；若当日 UTC 有周期则出现在列表中

### 文案与 i18n

实现参考：`python/scripts/daily_digest_notify.py`（纯渲染，不读 secret、不发网络）。

| locale | 有成交标题 | 无运行/无成交 |
|--------|------------|----------------|
| `zh` | 量化哨兵 · 收盘日报 | 量化哨兵 · 心跳 |
| `en` | QuantSentinel · Daily digest | QuantSentinel · Heartbeat |

语言解析：`QSL_NOTIFY_LANG` → `NOTIFY_LANG` → 默认 `zh`。

消息结构（示意，非真实数据）：

```
📡 量化哨兵 · 收盘日报
业务日: 2026-10-08
窗口: Asia/Shanghai 06:00
【当日已运行】
· ibkr / soxl_soxx_trend_income · 订单 2 · 成交 2 · 正常
· binance / crypto_equity_combo · 周期 4 · 成交 1 · 正常
通道：QuantSentinel（统一 bot）· 仅含当日实际运行项
```

心跳（无运行）：

```
📡 量化哨兵 · 心跳
业务日: 2026-10-08
今日无平台/策略实际运行。监测链路心跳正常。
通道：QuantSentinel（统一 bot）· 仅含当日实际运行项
```

### 聚合与发送（平台侧）

1. 各平台在业务日结束后写出「是否实际运行 / 订单数 / 成交数」摘要（已有 execution report / heartbeat 证据优先复用）。
2. 中央或指定 aggregator 调用 `filter_runs_for_digest` + `render_daily_digest`。
3. 使用 **同一** `quant-sentinel-telegram-bot-token` 与全局 chat 路由发送。
4. 平台独立 bot 的执行日报路径应关闭或改指 sentinel，避免昨天那种「分平台 bot 各发一条」。

### Aggregator（本仓已落地）

- Workflow 文稿：`docs/workflows/daily-digest-notify.yml`（需拷贝到 `.github/workflows/daily-digest-notify.yml` 后才会被 Actions 调度；当前推送 OAuth 无 `workflow` scope）
- 脚本：`python/scripts/daily_digest_aggregator.py` + `python/scripts/send_daily_digest_telegram.py`
- 调度：UTC `0 22 * * 1-5` = **Asia/Shanghai 周二至周六 06:00**（覆盖前一美股 RTH）
- 证据：`DIGEST_CANDIDATES_PATH` / JSON（优先）+ 可选 allowlisted GitHub workflow 成功结论（**不编造成交数**）
- 发送：Environment `runtime-strategy-switch`；`TELEGRAM_TOKEN` 或 `TELEGRAM_TOKEN_SECRET_NAME`→GCP `quant-sentinel-telegram-bot-token`；chat 走 `QSL_GLOBAL_TELEGRAM_CHAT_ID` / `GLOBAL_TELEGRAM_CHAT_ID`
- 测试：`workflow_dispatch` 默认 `dry_run=true`；生产 schedule 会真实发送
- Binance：历史 `TG_TOKEN` 仍独立；对齐步骤见 `platform-config.json` → `daily_digest.aggregator.binance_alignment_note_*`（公开仓只记名称）

**secret 名与变量契约以本文为准**；缺失 Environment secret 时 receipt 写明缺项，不在日志打印 token/chat id。

## VPS / Cloud Run

```bash
scripts/load_telegram_env.sh /run/quant-monitor/telegram.env
systemd/quant-monitor.service.example
scripts/daily_briefing_pipeline.sh      # 历史 briefing；收盘日报以 daily_digest 合同为准
```

`STRATEGY_PLUGIN_ALERT_TELEGRAM_BOT_TOKEN_SECRET_NAME=quant-sentinel-telegram-bot-token`

## 验证（不泄露 secret）

- 允许：`workflow_dispatch` 各平台 `paper-notification-preview`（PAPER 合成预览，不下单）。
- 预览前确认 `TELEGRAM_TOKEN_SECRET_NAME`（或 Binance `TG_TOKEN`）已指向 **同一 sentinel bot**。
- 报告只写：是否送达、路径、revision、观察时间；不得输出 token、chat id、金额。

## 2026-10-06 单入口与降噪验收（仍有效）

任务状态见[六主线清单](qsl_overnight_open_items.zh-CN.md) `NOTIFY-01`–`NOTIFY-03`。

- 同名 env/secret **不等于**已迁移到同一有效 bot；需 equality-only 核验。
- 健康无单 / dry-run 成功不单独刷屏；真实订单与异常仍可达。
- 本文件**不授权**在聊天中粘贴 bot token。

English summary: One QuantSentinel bot secret name for alerts and execution digests; daily digest after the Shanghai 06:00 window includes only strategies that actually ran (crypto/DCA conditional); otherwise heartbeat-only; zh/en via `daily_digest_notify.py`; no tokens in git or chat.
