# QSL 隔夜残留清单（收尾盘点）

> 盘点日：2026-09-07 晚。用户已授权工程收尾与费用清理；**不**自动新开 live、**不**在无凭据时调券商。
> 2026-09-08 校正：本轮核对源码与 GitHub 合并状态；保留的历史部署、费用清理和变量配置报告不作为本轮独立运行核验。

## 1. 已合代码与历史交接结果（分层记录）

| 项 | 结果 |
| --- | --- |
| 平台 W1 代码 + Cloud Run 部署 + QPK pin `d4e86f1` | 历史报告：Schwab/IBKR/LB 禁买/禁新增风险已接线；本轮未重验运行 |
| QPK D1–D3 / W2 / HITL 门 / drift 评估器+探针 | #576–#582 |
| QPK `production_drift_new_risk` → NEW_RISK gate | 已合 [#589](https://github.com/QuantStrategyLab/QuantPlatformKit/pull/589) → `d5f3723`；Policy A 仅禁新增风险 |
| 平台 NEW_RISK drift 初次注入 | 历史记录：Schwab [#390](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/390)、LB [#456](https://github.com/QuantStrategyLab/LongBridgePlatform/pull/456)；后续 store 接线见下一行，不作当前 pin 声明 |
| store → NEW_RISK 注入残差（代码） | QPK [#590](https://github.com/QuantStrategyLab/QuantPlatformKit/pull/590) `d51bb79`、Schwab [#391](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/391) `74109a2`、LB [#457](https://github.com/QuantStrategyLab/LongBridgePlatform/pull/457) `16f0299` |
| lifecycle bucket 配置同步支持（代码） | 已合 Schwab [#393](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/393)、LB [#459](https://github.com/QuantStrategyLab/LongBridgePlatform/pull/459)；不等于 Cloud Run 已应用 |
| SOXL core-only baseline / history 支持（代码） | 已合 UES [#468](https://github.com/QuantStrategyLab/UsEquityStrategies/pull/468)、UESP [#478](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines/pull/478)；本轮未运行真实采集、回放或 baseline 验证 |
| GCP 费用：revision/AR 压到 keep=2；Firstrade 删 `*/5` monitor | 历史报告已执行；本轮未重验 |
| HITL 库与 accept→apply | 人工显式调用的库能力；不代表生产自动优化开启，接受不授 live |

## 2. Drift 监测口径

| 能力 | 状态 |
| --- | --- |
| `evaluate_production_drift_health` / probe CLI | 已合 |
| `probe_production_drift_health_from_store` | 已合 #583；缺分 → `parked`，不编造 0.0 |
| 平台 `production_drift_health_observe.py` | lifecycle cron 只读；包括 REVIEW/CRITICAL 在内均零 optimize；生产 Policy A 仅禁新增风险 |
| 生产 metrics → `drift_score` 读回 | store 消费代码已接线；真实分数、交易 profile 与同源性本轮未核验 |
| `LIFECYCLE_PERFORMANCE_BUCKET` | 历史报告平台与 UES GitHub vars 已配置共享桶；不证明 Cloud Run 配置已应用 |

交接报告称 inject 已部署，本轮未独立读回生产。交易 store 查询使用 `RUNTIME_TARGET_JSON` 的 profile；observe profile override 不证明交易闭环，也不替换交易配置。

## 3. 仍 PARK

| 项 | 原因 |
| --- | --- |
| 真下单 / 新开 live | 既有 `ACTIVE_LKG` ≠ 新授权 |
| 本机直读 IBKR/LB GSM | 继续用 Cloud Run 挂载 |
| Console D3 聚合视图 | 可选；信封 trio 已够运维 |
| 生产自动 reopt / promotion runner | Policy A 不启用；库内有界研究需另有人工显式授权，不作为生产待补接线 |
| `combined_scale` 平台缩仓 | W1 禁买已接；缩仓 sizing 尚未闭合 |
| store → NEW_RISK 端到端验收 | 注入及同步代码已合，历史报告 inject 已部署；本轮未核验 Cloud Run 配置应用、交易 profile 对应真实 `drift_score` 与 NEW_RISK 消费结果，不据此宣称闭环 |

## 4. 明确不做

- 日历盲跑 reopt；改 public ingress；共账户 allocator；AI 升档/授 live

## 5. 交叉引用

- [资金风险信封 V1](qsl_capital_risk_envelope_v1.zh-CN.md)
- [偏离触发 HITL V1](qsl_drift_triggered_research_hitl_v1.zh-CN.md)
- [多策略组合 A→B V1](qsl_multi_strategy_combo_ab_v1.zh-CN.md)
