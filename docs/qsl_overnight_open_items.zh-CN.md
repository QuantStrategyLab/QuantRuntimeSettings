# QSL 隔夜残留清单（收尾盘点）

> 盘点日：2026-09-07 下午（部署跟进）。用户已授权工程收尾；**不**自动新开 live、**不**在无凭据时调券商。

## 1. 本轮已闭合

| 项 | 结果 |
| --- | --- |
| 平台 W1 代码 | Schwab #379、IBKR #487、LB #444/#445 已合 main |
| QPK D1–D3 / W2 / HITL 门 / drift 评估器 | #576–#581 |
| HITL 政策 + 状态文档 | QRT #388/#389 |
| 治理 PR | QRT #357、QPK #551/#561；LB #440 已关 |
| **Schwab Cloud Run W1 部署** | Deploy [#34102174739](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/actions/runs/34102174739) → commit `25bb77a`，admission PASS，continuity GH=RUN=`ACTIVE_LKG` |
| **IBKR Cloud Run W1 部署** | Deploy [#34102891125](https://github.com/QuantStrategyLab/InteractiveBrokersPlatform/actions/runs/34102891125) → 全服务 commit `3f1722e` |
| **LongBridge Cloud Run W1 部署** | Deploy [#34102896886](https://github.com/QuantStrategyLab/LongBridgePlatform/actions/runs/34102896886) → PAPER/HK/SG commit `e35dac7` |
| Schwab `/health` 外网 404 | **非缺陷**：`ingress=internal`（仅内网/调度可探）；不改为外网开放 |

## 2. 部署结果（2026-09-07）

| 平台 | 部署前 | 部署后 | 状态 |
| --- | --- | --- | --- |
| Schwab | `1f0ce32` | `25bb77a`（W1） | **完成** |
| IBKR（5 服务） | `cebf5d7` | `3f1722e`（W1） | **完成** |
| LongBridge PAPER/HK/SG | `39d4b57` | `e35dac7`（W1+#445） | **完成** |

## 3. 仍 PARK / 待外部条件

| 项 | 原因 | 下一动作 |
| --- | --- | --- |
| 生产 drift **观测读回源**接线 | 评估器已合；缺平台 metrics 注入 | health 只评估、达阈值才入 promotion cycle |
| IBKR/LB GSM 本地直读 | secret 不在 `charlesschwabquant`；运行时由各项目 Cloud Run 挂载 | 优先用部署读回，不落盘密钥 |
| 真下单 / 新开 live | 未授权本会话执行 | 需单独账户清单 + enable 确认 |

## 4. 明确不做（仍冻结）

- 日历盲跑 reopt；`scheduled_*` ≠ 优化 cron
- 共账户 allocator（路径 C）
- AI 升档 / 授 live / 复位熔断 / 改 BUY/SELL
- 为探测 `/health` 而把 Cloud Run 改为 public ingress

## 5. 交叉引用

- [资金风险信封 V1](qsl_capital_risk_envelope_v1.zh-CN.md)
- [偏离触发 HITL V1](qsl_drift_triggered_research_hitl_v1.zh-CN.md)
- [多策略组合 A→B V1](qsl_multi_strategy_combo_ab_v1.zh-CN.md)
