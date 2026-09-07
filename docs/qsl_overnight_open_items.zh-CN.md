# QSL 隔夜残留清单（收尾盘点）

> 盘点日：2026-09-07 下午。用户已授权工程收尾；**不**自动启 live、**不**在无凭据时调券商。

## 1. 本轮已闭合

| 项 | 结果 |
| --- | --- |
| 平台 W1 fail-closed 新风险门 | Schwab #379、IBKR #487、LB #444 已合；LB #445 pin→`f5d2bb9` |
| QPK D1–D3 / W2 库 | #576–#580（含 HITL 严回测门 enforce + 多账户信封视图） |
| HITL 政策 | QRT #388；严门 #580；生产 drift 评估器 #581 |
| 治理/可选 PR | QRT #357、QPK #551/#561 已合；LB #440（旧 pin 回退）已关 |
| 控制台晋级空状态 | QRT #386 已合 |

## 2. 仍 PARK / 待外部条件

| 项 | 原因 | 下一动作 |
| --- | --- | --- |
| **W3 实盘 enable / 云端部署开闸** | 本机/会话无 Schwab/IBKR/LB 凭据；未做生产部署验收 | 提供隔离凭据 + 明确账户清单后，只读读回 → 再单独确认 enable |
| **Schwab 纸面真账户读回** | 无 `.env` / secret | 同上；此前不得宣称信封已真账户验收 |
| **生产 drift 读回源接线** | `evaluate_production_drift_health` 已合；缺观测注入 | 健康检查只调用评估；达 REVIEW/CRITICAL 才入 promotion cycle |
| **平台 Cloud Run 已部署 W1** | 代码在 main ≠ 已部署 | 部署流水线有授权后再验 |

## 3. 明确不做（仍冻结）

- 日历驱动盲跑 reopt；`scheduled_retest` / `scheduled_research` ≠ 优化 cron
- 共账户 allocator（路径 C）
- AI 升档 / 授 live / 复位熔断 / 改 BUY/SELL

## 4. 交叉引用

- [资金风险信封 V1](qsl_capital_risk_envelope_v1.zh-CN.md)
- [偏离触发 HITL V1](qsl_drift_triggered_research_hitl_v1.zh-CN.md)
- [多策略组合 A→B V1](qsl_multi_strategy_combo_ab_v1.zh-CN.md)
