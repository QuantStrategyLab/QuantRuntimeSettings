# 机密与账户配置架构（开源说明）

[Security Policy](../SECURITY.md) · 完整设计备忘（维护者）：仓库外 `机密与账户配置架构.md`

本文给 fork / 自建部署者：说明**什么可以进公开 Git**，**什么必须进 Secret Manager / Worker secret / GitHub Environment**，以及前端为何永远看不到 raw secret。

## 分层

| 层 | 放什么 | 不放什么 |
| --- | --- | --- |
| 公开仓 | Schema、适配器、Worker 合同、`*.example.json`、secret **名称**、非机密开关名 | 真实账户路由值、API key、OAuth secret、Flex token、SA JSON、会话 cookie |
| Google Secret Manager | Broker / Flex / OAuth refresh / Gateway 登录 / SA key（按平台 GCP 项目） | — |
| GitHub Environment | Variables＝开关与拓扑；Secrets＝token 与绑定 JSON | 不要把生产账户目录提交进 PR |
| Cloudflare Worker secrets | `SESSION_SECRET`、OAuth、`STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON`、各 sync token | 不要提交 `wrangler.toml` / `.dev.vars` |
| 浏览器 | 脱敏后的账户目录与 `AccountStatus` | 任何 secret 明文 |

账户「期望目录」属于 Desired 配置，经 Worker 读取后只把展示安全的字段交给前端；启用/健康仍以 Observed 证据为准（见 `docs/qsl_lifecycle_truth_v1.zh-CN.md` 与控制台分层实现）。

## 推荐命名

```text
qsl-{platform}-{env}-{purpose}     # Secret Manager 友好名
{PLATFORM}_{PURPOSE}_TOKEN         # Actions / Worker 绑定名
```

公开示例使用 `EXAMPLE_` / `example-` / `synthetic-` 前缀。`runtime_status_target_id` 在 example 里只表示形状（如 `ibkr.soxl`），**不是**生产绑定证明。

## Worker 账户目录

1. 复制 [`web/strategy-switch-console/account-options.example.json`](../web/strategy-switch-console/account-options.example.json) 到**私有**文件。
2. 填入你自己的 target / selector（勿回提交到公开 fork）。
3. `wrangler secret put STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON < /path/to/private.json`
4. 或经管理员写入 KV `account_options`（见控制台 README）。

含真实路由时必须走 secret/KV；不要把生产 JSON 命名为 example 后提交。

## 本机 Gateway vs 云端

- **Mac IBKR Gateway**：登录配置留在本机钥匙串或从 Secret Manager 注入内存；不要提交四套（或任意）Gateway 配置文件。
- **云端**：GCP WIF + Secret Manager；fork 须使用**自己的** project / WIF provider，不要照抄本组织 workflow 里的数字 project 路径当通用默认。

## 轮换

先在提供商侧轮换 → 更新 Secret Manager / Environment / Worker → 验证只读投影 → 再废弃旧版本。若 secret 曾进 Git：先轮换，再考虑历史清理（见 `SECURITY.md`）。

## 本地忽略

仓库 `.gitignore` 已忽略 `.env*`、`wrangler.toml`、`.dev.vars`、本机 `account-options.json`、常见密钥后缀等。新增私有文件时先确认未被跟踪：`git status` / `git check-ignore -v <path>`。

## 运营钉（诊断 run id）

一次性 KV 诊断若需限制允许的 `source_run_id`，把允许值放在 GitHub Environment 的 secret/variable（例如 `BINANCE_ACCOUNT_FACTS_ALLOWED_SOURCE_RUN_ID`），不要把生产运行号写进公开 workflow 的 `default`。若仓库里仍有此类默认值，用具备 `workflow` 权限的凭据另开 PR 清空。

## Telegram / QuantSentinel

跨平台通知统一使用 GCP secret 名 `quant-sentinel-telegram-bot-token`（见 `docs/notifications-quant-sentinel.zh-CN.md`）。GitHub 变量 `TELEGRAM_TOKEN_SECRET_NAME` 与 `STRATEGY_PLUGIN_ALERT_TELEGRAM_BOT_TOKEN_SECRET_NAME` 都应指向该名称。公开仓只写 secret **名**与 chat **路由变量名**，不写 token 或 chat id。

## Telegram 路由解析与别名（P0-06）

运行时解析顺序（名称，不是值）见 `docs/notifications-quant-sentinel.zh-CN.md`：

- token：`TELEGRAM_TOKEN` → `TG_TOKEN` → GCP Secret Manager（合同名 `quant-sentinel-telegram-bot-token`，可由 `TELEGRAM_TOKEN_SECRET_NAME` 覆盖）
- chat：`QSL_GLOBAL_TELEGRAM_CHAT_ID` → `GLOBAL_TELEGRAM_CHAT_ID` → `STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS`（取首个）

Environment 注入的 `TELEGRAM_TOKEN` / `TG_TOKEN` **会遮蔽** GCP Secret Manager 路径（发送器不再调用 gcloud）。组织级与 Environment 级同名 secret 的最终胜出方以 GitHub Actions / Cloud Run 实际注入为准；公开仓只提供 `--route-check` 匹配元数据（`token_source_kind` / `chat_source_kind` / `warnings`），不打印值。

别名退役条件与「重复发送风险待证」清单见通知文档同节；退役前须有 route-check 证据，禁止在聊天中粘贴 token 或 chat id。

