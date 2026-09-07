# QSL 隔夜残留清单（收尾盘点）

> 盘点日：2026-09-07 晚。用户已授权工程收尾与费用清理；**不**自动新开 live、**不**在无凭据时调券商。

## 1. 本轮已闭合

| 项 | 结果 |
| --- | --- |
| 平台 W1 代码 + Cloud Run 部署 + QPK pin `d4e86f1` | Schwab/IBKR/LB；禁买/禁新增风险已接线 |
| QPK D1–D3 / W2 / HITL 门 / drift 评估器+探针 | #576–#582 |
| QPK store 注入 `drift_score` | [#583](https://github.com/QuantStrategyLab/QuantPlatformKit/pull/583) → `020a1ee` |
| 三平台 lifecycle 只读 drift observe + pin `020a1ee` | Schwab [#381](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/381)、IBKR [#489](https://github.com/QuantStrategyLab/InteractiveBrokersPlatform/pull/489)、LB [#447](https://github.com/QuantStrategyLab/LongBridgePlatform/pull/447) |
| GCP 费用：revision/AR 压到 keep=2；Firstrade 删 `*/5` monitor | 已执行；月投不需要 session 轮询 |
| HITL 库与 accept→apply | 库侧已就绪；既有 `test_research_promotion_cycle` 覆盖；无日历 reopt |

## 2. Drift 监测口径

| 能力 | 状态 |
| --- | --- |
| `evaluate_production_drift_health` / probe CLI | 已合 |
| `probe_production_drift_health_from_store` | 已合 #583；缺分 → `parked`，不编造 0.0 |
| 平台 `production_drift_health_observe.py` | lifecycle cron 只读；未达 REVIEW/CRITICAL 不得 optimize |
| `LIFECYCLE_PERFORMANCE_BUCKET` | 平台与 UES GitHub vars 已配置为 `gs://qsl-runtime-logs-shared/strategy-lifecycle/v1` |

## 3. 仍 PARK

| 项 | 原因 |
| --- | --- |
| 真下单 / 新开 live | 既有 `ACTIVE_LKG` ≠ 新授权 |
| 本机直读 IBKR/LB GSM | 继续用 Cloud Run 挂载 |
| Console D3 聚合视图 | 可选；信封 trio 已够运维 |
| 生产 promotion runner | 待本方案落地后再接；不得由日历触发 reopt |
| `combined_scale` 平台缩仓 | W1 禁买已接；缩仓 sizing 尚未闭合 |

## 4. 明确不做

- 日历盲跑 reopt；改 public ingress；共账户 allocator；AI 升档/授 live

## 5. 交叉引用

- [资金风险信封 V1](qsl_capital_risk_envelope_v1.zh-CN.md)
- [偏离触发 HITL V1](qsl_drift_triggered_research_hitl_v1.zh-CN.md)
- [多策略组合 A→B V1](qsl_multi_strategy_combo_ab_v1.zh-CN.md)
