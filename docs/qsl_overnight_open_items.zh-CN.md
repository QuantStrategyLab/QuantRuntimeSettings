# QSL 隔夜残留清单（收尾盘点）

> 盘点日：2026-09-07 傍晚。用户已授权工程收尾；**不**自动新开 live、**不**在无凭据时调券商。

## 1. 本轮已闭合

| 项 | 结果 |
| --- | --- |
| 平台 W1 代码 + 首轮 Cloud Run 部署 | Schwab/IBKR/LB 均已上 W1 |
| QPK D1–D3 / W2 / HITL 门 / drift 评估器+探针 | #576–#582 |
| 三平台 QPK pin → `d4e86f1` | LB [#446](https://github.com/QuantStrategyLab/LongBridgePlatform/pull/446)、IBKR [#488](https://github.com/QuantStrategyLab/InteractiveBrokersPlatform/pull/488)、Schwab [#380](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/380) |
| pin 镜像再部署 | Schwab [#34106478634](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/actions/runs/34106478634)、IBKR [#34106490081](https://github.com/QuantStrategyLab/InteractiveBrokersPlatform/actions/runs/34106490081)、LB [#34106495767](https://github.com/QuantStrategyLab/LongBridgePlatform/actions/runs/34106495767) |
| HITL 政策 / 状态文档 | QRT #388/#389/#390 |
| IBKR/LB admission 只读复验 | 部署后 PASS（enabled 账户按原配置） |
| Schwab `/health` 外网 404 | **非缺陷**：`ingress=internal` |

## 2. Drift 监测口径

| 能力 | 状态 |
| --- | --- |
| `evaluate_production_drift_health` | 已合 #581 |
| `production_drift_health_probe` CLI | 已合 #582；只读、零 reopt |
| 示例 | `python -m quant_platform_kit.strategy_lifecycle.production_drift_health_probe --strategy-profile … --domain … --as-of YYYY-MM-DD --drift-score 0.2` |
| 平台观测 metrics 自动注入 | **仍待**：需各平台从既有证据/生命周期快照注入脱敏 `drift_score`；未达 REVIEW/CRITICAL 不得 optimize |

## 3. 仍 PARK

| 项 | 原因 |
| --- | --- |
| 真下单 / 新开 live | 本会话不执行；既有 `ACTIVE_LKG` 延续 ≠ 新授权 |
| 本机直读 IBKR/LB GSM | 不在本地 schwab 项目；继续用 Cloud Run 挂载 |
| 观测 → drift_score 生产管道 | 探针就绪；读回源绑定另开 |

## 4. 明确不做

- 日历盲跑 reopt；改 public ingress；共账户 allocator；AI 升档/授 live

## 5. 交叉引用

- [资金风险信封 V1](qsl_capital_risk_envelope_v1.zh-CN.md)
- [偏离触发 HITL V1](qsl_drift_triggered_research_hitl_v1.zh-CN.md)
- [多策略组合 A→B V1](qsl_multi_strategy_combo_ab_v1.zh-CN.md)
