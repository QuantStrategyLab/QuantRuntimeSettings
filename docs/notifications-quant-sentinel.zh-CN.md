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
- **无运行**：真空虚心跳（短文案）。**有运行但无成交**：心跳标题；若候选证据带有观察字段则按旧版分平台 bot 风格展开策略块。
- **有成交**：收盘日报标题；同样优先展开观察块。
- **观察字段（有证据才写，禁止编造）**：`strategy_label`、`equity`、`holdings[]`（symbol/value/qty）、`signal_summary`、`rebalance_kind` / `rebalance_conclusion`、可选 `tips` / `account_hint`。GitHub workflow 成功结论只证明「跑过」，不填金额/持仓。
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

消息结构（示意；金额仅在候选证据存在时出现；**不**再渲染「窗口」与「通道」行）：

薄列表（无观察字段时仍可用）：

```
📡 量化哨兵 · 收盘日报
业务日: 2026-10-08
【当日已运行】
· ibkr / soxl_soxx_trend_income · 订单 2 · 成交 2 · 正常
· binance / crypto_equity_combo · 周期 4 · 成交 1 · 正常
```

观察块心跳（对齐旧版嘉信风格；字段来自 producer 候选，非编造）：

```
📡 量化哨兵 · 心跳
业务日: 2026-10-08
💓 【心跳检测】
🧭 策略: 半导体趋势收益
💰 账户总权益: USD 990.06
💼 持仓
- SOXL: $635.92 / 4股
- 🎯 信号: SOXX 站上 140 日门槛线，持有 SOXL 70.0% + SOXX 20.0%
- 小账户提示: 净值 $990 低于建议 $1,000；…
✅ 无需调仓
平台: schwab
```

多平台观察块（空行分隔；各自保留策略 / 权益 / 平台）：

```
📡 量化哨兵 · 心跳
业务日: 2026-10-09
💓 【心跳检测】
🧭 策略: 半导体趋势收益
💰 账户总权益: USD 989.34
✅ 无需调仓
平台: schwab

[U16608560] 💓 【心跳检测】
🧭 策略: 纳斯达克增长收益
💰 账户总权益: USD 569.16
💼 持仓
- TQQQ: $312.40 / 4股
✅ 无需调仓
平台: ibkr
```

真空虚心跳需区分三种语义（P0）：

- **已验证无运行**：配置的证据源已成功查询且无匹配 →「今日已验证无平台/策略实际运行。」
- **证据未知/读取失败**：候选未注入或 GitHub API 失败 →「今日运行证据未知或读取失败，不能判定为链路正常。」（不得写「链路正常」）
- **已验证零成交**：生产者明确给出 `fill_count=0` →「无成交」；GitHub 存在性 stub 的成交数为**未知**，不得写成 0。

```
📡 量化哨兵 · 心跳
业务日: 2026-10-08
今日运行证据未知或读取失败，不能判定为链路正常。
```

### 聚合与发送（平台侧）

1. 各平台在业务日结束后写出「是否实际运行 / 订单数 / 成交数」摘要（已有 execution report / heartbeat 证据优先复用）。
2. 中央或指定 aggregator 调用 `filter_runs_for_digest` + `render_daily_digest`。
3. 使用 **同一** `quant-sentinel-telegram-bot-token` 与全局 chat 路由发送。
4. 平台独立 bot 的执行日报路径应关闭或改指 sentinel，避免昨天那种「分平台 bot 各发一条」。

### Aggregator（本仓已落地）

- Workflow：`.github/workflows/daily-digest-notify.yml`（文稿同步于 `docs/workflows/daily-digest-notify.yml`）
- 脚本：`python/scripts/daily_digest_aggregator.py` + `python/scripts/send_daily_digest_telegram.py`
- 调度：UTC `0 22 * * 1-5` = **Asia/Shanghai 周二至周六 06:00**（覆盖前一美股 RTH）
- 证据：`DIGEST_CANDIDATES_PATH` / `DIGEST_CANDIDATES_JSON`（优先，见 [digest-candidates-wiring.zh-CN.md](./digest-candidates-wiring.zh-CN.md)）+ 可选 allowlisted GitHub workflow 成功结论（**存在性 only；成交数未知≠0**）
- 聚合键：`platform_id + strategy + opaque_account_uid|unknown + target_id|unknown`；同策略多账户不得混拼
- 发送：Environment `runtime-strategy-switch`；`TELEGRAM_TOKEN` 或 `TELEGRAM_TOKEN_SECRET_NAME`→GCP `quant-sentinel-telegram-bot-token`；chat 走 `QSL_GLOBAL_TELEGRAM_CHAT_ID` / `GLOBAL_TELEGRAM_CHAT_ID`
- 测试：`workflow_dispatch` 默认 `dry_run=true`；生产 schedule 会真实发送
- 接线基线模板：[private-target-wiring-baseline.zh-CN.md](./private-target-wiring-baseline.zh-CN.md)
- Binance：历史 `TG_TOKEN` 仍独立；对齐步骤见 `platform-config.json` → `daily_digest.aggregator.binance_alignment_note_*`（公开仓只记名称）

**secret 名与变量契约以本文为准**；缺失 Environment secret 时 receipt 写明缺项，不在日志打印 token/chat id。

## VPS / Cloud Run

```bash
scripts/load_telegram_env.sh /run/quant-monitor/telegram.env
systemd/quant-monitor.service.example
scripts/daily_briefing_pipeline.sh      # 历史 briefing；收盘日报以 daily_digest 合同为准
```

`STRATEGY_PLUGIN_ALERT_TELEGRAM_BOT_TOKEN_SECRET_NAME=quant-sentinel-telegram-bot-token`

## 路由解析只读诊断（P0-06）

实现：`python/scripts/send_daily_digest_telegram.py` → `diagnose_telegram_route()` / `--route-check`。

只输出**匹配元数据**，禁止打印 token / chat 明文。可选 `--include-chat-fingerprint`（默认关闭）才写 `sha256_12` + `last4`。

| 字段 | 含义 |
|------|------|
| `secret_name_contract` | 合同名，默认 `quant-sentinel-telegram-bot-token` |
| `token_source_kind` | `env:TELEGRAM_TOKEN` / `env:TG_TOKEN` / `gcp_secret_manager` / `gcp_secret_manager_unprobed` / `missing` |
| `chat_source_kind` | `env:QSL_GLOBAL_TELEGRAM_CHAT_ID` / `env:GLOBAL_TELEGRAM_CHAT_ID` / `env:STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS` / `missing` |
| `token_alias_used` / `chat_alias_used` | 是否走了非首选别名 |
| `warnings` | 遮蔽 / 冲突码（如 `token_env_shadowed:TG_TOKEN_…`、`token_gcp_secret_manager_shadowed_by_environment:…`、`chat_env_shadowed:…`） |
| `missing` | 接线名缺失（有默认 secret 合同名时 token 不算 missing；未探测 GCP 时 kind=`gcp_secret_manager_unprobed`） |

```bash
python3 python/scripts/send_daily_digest_telegram.py --route-check --write-receipt /tmp/route-receipt.json
# 需要确认 GCP SM 是否真能取出 token（值立即丢弃、不打印）时：
python3 python/scripts/send_daily_digest_telegram.py --route-check --probe-secret-manager --write-receipt /tmp/route-receipt.json
```

dry-run receipt 同样写入 `token_source_kind` / `chat_source_kind` / `warnings` / `route_diagnosis`。

### 别名退役条件

| 别名 | 可删条件（全部满足） | 删除前 |
|------|----------------------|--------|
| `TG_TOKEN` | 所有消费方已注入 `TELEGRAM_TOKEN`，或仅走 `TELEGRAM_TOKEN_SECRET_NAME`→GCP `quant-sentinel-telegram-bot-token`；Binance / 插件路径不再读 `TG_TOKEN`；连续 ≥1 个业务周 `--route-check` 无 `token_alias_used=true` 且无 `TG_TOKEN` present 警告 | 在 Environment / org secret 清单中标注废弃日；保留只读一周 |
| `GLOBAL_TELEGRAM_CHAT_ID` | 所有消费方已注入 `QSL_GLOBAL_TELEGRAM_CHAT_ID`；平台 heartbeat / canary / Cloud Run sync 不再回退读 `GLOBAL_*`；连续 ≥1 个业务周 route-check 无 `chat_alias_used` 来自 `GLOBAL_*` | 同上 |
| `STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS`（作为日报 chat 回退） | 日报与全局路由只依赖 `QSL_GLOBAL_*`；插件告警若仍要多 chat，应有独立合同，不与日报混用首个 id | 文档化插件专用路由后再删日报回退 |
| 遗留平台 bot secret 名（`longbridge-telegram-token` 等） | GH 变量已全部指向 `quant-sentinel-telegram-bot-token`；平台侧无再 `gcloud secrets access` 旧名；PAPER 预览 equality 核验通过 | 见上文「历史平台独立 bot secret」表 |

退役**不**等于轮换 bot：展示名「QSL资产管家」与内部 QuantSentinel 可并存；技术合同名保持 `quant-sentinel-telegram-bot-token`。

### 重复发送风险待证（公开代码证据，未改它仓）

中央收盘日报由本仓 `daily-digest-notify` → `send_daily_digest_telegram.py` 发送。以下平台路径仍可能对**同一业务事件**另发 Telegram（是否与日报重复 = 待证，取决于 Environment 是否仍启用、文案是否同源）：

| 仓 | 公开文件 | 路径角色 | 风险标注 |
|----|----------|----------|----------|
| LongBridgePlatform | `main.py`（`api.telegram.org/.../sendMessage`） | 运行时策略通知 | 重复发送风险待证 |
| LongBridgePlatform | `scripts/execution_report_heartbeat.py` | 执行报告心跳 | 重复发送风险待证 |
| LongBridgePlatform | `scripts/cloud_run_runtime_guard.py` | Cloud Run 守卫告警 | 重复发送风险待证（异常类，可能与日报正交） |
| LongBridgePlatform | `scripts/send_paper_notification_canary.py` | PAPER 预览 / canary | 预览路径；生产 schedule 勿与正式日报并行误触 |
| QuantRuntimeSettings | `.github/workflows/daily-digest-notify.yml` | 中央跨平台日报 | 唯一合同入口（本仓） |

说明：LongBridge 若干脚本 chat 解析以 `GLOBAL_TELEGRAM_CHAT_ID` 为主、未统一优先 `QSL_GLOBAL_TELEGRAM_CHAT_ID`（公开代码）；与本仓优先级不一致本身会放大「同 bot 不同注入源」排障成本。其它券商仓未在本机克隆核到的发送点标为**未知**，不编造清单。

## 验证（不泄露 secret）

- 允许：`workflow_dispatch` 各平台 `paper-notification-preview`（PAPER 合成预览，不下单）。
- 预览前确认 `TELEGRAM_TOKEN_SECRET_NAME`（或 Binance `TG_TOKEN`）已指向 **同一 sentinel bot**。
- 报告只写：是否送达、路径、revision、观察时间；不得输出 token、chat id、金额。

## 2026-10-06 单入口与降噪验收（仍有效）

任务状态见[六主线清单](qsl_overnight_open_items.zh-CN.md) `NOTIFY-01`–`NOTIFY-03`。

- 同名 env/secret **不等于**已迁移到同一有效 bot；需 equality-only 核验。
- 健康无单 / dry-run 成功不单独刷屏；真实订单与异常仍可达。
- 本文件**不授权**在聊天中粘贴 bot token。

English summary: One QuantSentinel bot secret name for alerts and execution digests; daily digest after the Shanghai 06:00 window includes only strategies that actually ran (crypto/DCA conditional); empty evidence → thin heartbeat; producer observation fields (equity/holdings/signal/rebalance) enrich the message when present and are never invented; zh/en via `daily_digest_notify.py`; no tokens in git or chat.
