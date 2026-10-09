# 私有 target 接线基线（模板，无密钥）

审计基准日：2026-10-09  
仓库：QuantRuntimeSettings（控制面）  
用途：登记每个运行目标的身份、Environment、revision、schema、producer、摄入路径与 ACK/读回；**禁止**写入密钥、真实账户号、资产金额。

## 审计日已知（勿回退）

| 项 | 状态 |
| --- | --- |
| FX 同源代理 | QRS #585 已上线 `/api/overview-fx`；勿再当 CSP 未修 |
| 日报渲染字段 | #584 已支持权益/持仓/信号/调仓；缺的是各平台 DIGEST_CANDIDATES 管道 |
| LongBridge HK | 勿改 `independent_get` / Cloud Run ingress；已回 `scheduler_archive`；与 SG 对齐由 quant 负责 |
| Firstrade facts sync | 关闭待 quant；本基线不改 Firstrade sync |

## 接线表（占位）

说明：`opaque_account_uid` 仅填不透明占位符；`revision` / schema 未核到则写「未知」，禁止编造。

| target_id | platform | opaque_account_uid | Environment | revision | schema | producer | ingest path | ACK / 读回 | 未知项 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `schwab/待填` | schwab | `待填` | 待填 | 未知 | 未知 | CharlesSchwabPlatform runtime daily / facts（文档路径待核） | 控制台 account-facts 绑定 + 可选 DIGEST_CANDIDATES → 中央日报 | 未知 | Environment 名、binding、日报候选是否已注入 |
| `ibkr/待填` | ibkr | `待填` | 待填 | 未知 | 未知 | InteractiveBrokersPlatform facts / period-return（文档路径待核） | 同上 | 未知 | target 与 account_scope 是否唯一 |
| `longbridge/sg`（占位名） | longbridge | `待填` | 待填 | 未知 | 未知 | LongBridgePlatform SG | facts + DIGEST_CANDIDATES（待接） | 未知 | 与 HK 隔离；勿改 HK ingress |
| `longbridge/hk`（占位名） | longbridge | `待填` | 待填 | 未知 | 未知 | LongBridgePlatform HK（scheduler_archive） | **本任务不改** | 未知 | quant 对齐 SG PAUSED resume |
| `binance/待填` | binance | `待填` | 待填 | 未知 | 未知 | BinancePlatform（Oracle VPS / self-hosted，非 Cloud Run） | facts 可发布≠现金/钱包已读回 | 未知 | 资产字段覆盖、通知 TG_TOKEN 对齐 |
| `firstrade/待填` | firstrade | `待填` | 待填 | 未知 | 未知 | FirstradePlatform | facts sync **关闭**（quant） | 未知 | sync 开关与专用 token |

## 中央日报消费（QRS）

| 项 | 值 |
| --- | --- |
| Workflow | `.github/workflows/daily-digest-notify.yml` |
| Environment | `runtime-strategy-switch` |
| 候选注入 | `DIGEST_CANDIDATES_JSON`（secret）或 `DIGEST_CANDIDATES_PATH`（var） |
| 接线说明 | [digest-candidates-wiring.zh-CN.md](./digest-candidates-wiring.zh-CN.md) |
| 聚合键 | `platform_id + strategy_profile + opaque_account_uid\|unknown + target_id\|unknown` |
| receipt | `source_coverage` / `failures` / 每条 run 的 identity + field provenance |

## 填写规则

1. 只填已核到的 Environment 名、schema 名、文档化 producer 路径；未核到写「未知」或「待填」。
2. ACK/读回须区分：facts 可发布 ≠ 摄入成功 ≠ 控制台读回 ≠ 日报已消费。
3. 换生产策略、风险预算、研究版发布、SOXL 上生产仍为人闸；本表不授权变更。
4. 与 quant 冲突（LB-HK / Firstrade / ingress）时停改，先对齐用户。

## 修订记录

| 日期 | 说明 |
| --- | --- |
| 2026-10-09 | rebuild P0-01 初稿：模板 + 审计日已知项；平台行均为待填/未知 |
