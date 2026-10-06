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

历史架构允许平台执行日报使用各平台 `TELEGRAM_TOKEN_SECRET_NAME` 的独立 bot。2026-10-06 的目标改为统一 bot 入口；目前不能据 secret 名称、环境变量键名或代码已合并，认定所有运行路径已迁移到同一个有效 bot/chat。

## 2026-10-06 单入口与降噪验收

任务状态与证据日期见[六主线清单](qsl_overnight_open_items.zh-CN.md#six-track-audit-20261006)的 `NOTIFY-01` 至 `NOTIFY-03`。本次只更新目标与验收要求，不读取/复制 secret，不改变 bot、收件人、环境变量或生产配置。

### 有效路由同一性（NOTIFY-01）

沿现有 runtime cycle、启动异常、scanner 异常、plugin 人工复核、drill 异常与 daily briefing 路径逐项核对实际解析后的路由。保留既有变量优先级/alias/fallback事实，不把不同项目的同名 secret 当作同一身份。

受控核验只需返回每条路径的源 revision、观察时间、配置级或已启动进程级证据、目标数量，以及与已确认入口相同的 bot/chat/topic 布尔结果或不可逆相等性标记。报告不得包含原 token、chat/account ID、webhook URL、消息正文或账户金额。未经授权不得为验证调用 Telegram 身份接口、读取凭证或发送试探消息。

单 bot 同路由不等于跨服务去重完成。先核现有 dedup namespace、claim/写入语义、异常重复和恢复行为；有具体复现再补最小缺口，不新建统一通知平台或为格式一致性全组织追 pin。

### 正常静默与异常可达（NOTIFY-02、NOTIFY-03）

- 健康、没有真实订单的周期与成功 dry-run preview 不单独发成功通知；preview 中的拟下单列表不算成交。
- 真实 submitted/pending/filled 以及 rejected/blocked/unknown、待对账、数据/插件/持久化异常仍可达。已存在的重复资金阻断抑制不能吞掉新提交订单或新异常。
- Binance 的 `0` 关闭周期状态通知代码修复和 IBKR/Firstrade/Schwab 的正常无单静默补丁已经合并；这些合并不证明部署采用或实际 Telegram 投递。
- LongBridge scanner 已是 alerts-only；其 runtime 健康无单通知是独立待修项，不能重复修 scanner 或泛称整个 LongBridge 通知系统未降噪。

每项代码阶段、采用验证或通知审计后更新原任务的证据日期、剩余路径与下一步。自然周期尚无合格观察时保持等待，不用 CI/health/not_due 关闭业务验收。

English summary: A single effective bot route is the target; actual route equality and adoption remain unverified. Quiet healthy no-order and dry-run success while retaining real-order activity and actionable failures. This document authorizes no credential read, route migration or test message.
