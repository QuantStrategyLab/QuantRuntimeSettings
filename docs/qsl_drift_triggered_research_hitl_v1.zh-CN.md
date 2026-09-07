# QSL 偏离触发研究晋级与人工门 V1（冻结口径）

> 状态：`POLICY_FROZEN_LIBRARY_GATES_MERGED`
> 范围：AI 研究晋级自动化边界；不授权 live、不改实盘参数、不部署、不新增定时盲跑优化。
> 确认日：2026-09-07（用户冻结）。

本文冻结 **「监测偏离才优化」** 的组织口径。它与 QuantPlatformKit 已实现的 `research_promotion_cycle` 控制面一致；缺口在**生产监测门槛与严回测门绑定**，而不是再加日历驱动的 cron 优化。

## 1. 核心原则（不可协商）

### 1.1 监测偏离才优化

- **默认姿态**：只读监测 drift / health；未达门槛 → `PARKED`，**不**启动参数搜索或 reopt。
- **禁止**：按日历、固定周期或「到了该优化」盲跑 reopt；把 `scheduled_retest` / `scheduled_research` 当作独立优化触发器。
- **允许**：低频定时任务仅做 **drift/health 评估**（读回指标、对照冻结基准、写脱敏记录）；评估本身不等于优化。

### 1.2 达门槛后的有界链路

仅当 drift 达到可行动级别（见 §2）时，才进入：

```text
drift(REVIEW|CRITICAL)
  → bounded reopt（硬预算：迭代次数、参数键数）
  → 严格 WFA / OOS / 回测门（BacktestOrchestrator + 晋级标准）
  → paired shadow 证据
  → AWAITING_HUMAN（人工门）
```

- AI **不**授 live、**不**改已在跑版本的实盘参数、**不**绕过 `RiskEngine`。
- 人工接受只记录平台 / paper|live 意图与风险偏好名；**接受 ≠ live 权限**（与 QPK `PromotionConfirmation` 一致）。

### 1.3 新策略 / 新插件 = 独立晋级线

- 新策略 profile、新插件 revision、材料变更（标的、风险预算、逻辑）走 **独立** learning → promotion → shadow → HITL 线。
- **禁止**自动把 reopt 结果写回、热替换或静默覆盖**已在跑**的 runtime 版本。
- 已在跑版本仅允许：监测 → 分级响应（告警 / 降仓 / 停新单）→ 必要时再开**新候选**研究；不在原 ticket 上「就地改参上线」。

### 1.4 对照成熟做法

| 阶段 | 成熟系统 | QSL 冻结口径 |
| --- | --- | --- |
| 常态 | 监测 KPI、回撤、执行偏差、数据/证据新鲜度 | 低频 drift/health 读回；未达门槛 `PARK` |
| 轻度偏离 | 告警、解释、可选降仓 | `DriftStatus` 低于 REVIEW：记录 + 运维去重；**不** reopt |
| 中度偏离 | 停新单、shadow 对照 | `REVIEW`：有界 reopt + 严门 + shadow → 等人 |
| 重度偏离 | 熔断、人工接管 | `CRITICAL`：同上，优先级更高；仍 **不** 自动 live |
| 禁止 | 每日/每周日历重构参数 | 任何 cron **不得** 独立触发 reopt |

资金侧的「监测 → 降档 → 禁新风险」见 [资金风险信封 V1](qsl_capital_risk_envelope_v1.zh-CN.md)；组合证据预演见 [多策略组合 A→B V1](qsl_multi_strategy_combo_ab_v1.zh-CN.md)。研究晋级与资金信封 **分轨**：信封管账户层 `combined_scale`；本文管候选参数与晋级证据。

## 2. Drift 分级与触发（与代码对齐）

QPK `quant_platform_kit.strategy_lifecycle.research_promotion_cycle` 已将可行动 drift 定义为：

| `DriftStatus` | 自动化 |
| --- | --- |
| 低于 `REVIEW`（含 OK、观察级） | `PARKED`，`drift_not_actionable`；**不**调用 `optimize` |
| `REVIEW` | 进入 `BOUNDED_REOPT` → shadow → `AWAITING_HUMAN` |
| `CRITICAL` | 同上；通知与运维优先级更高，**权限不扩大** |

生产侧待接线的是 **谁算 drift、阈值从哪来、多久读一次**：

- 读回源：shadow 分歧、绩效衰减、证据过期、数据/身份不可用、Composer/信封降级信号等（只读、脱敏）。
- 评估频率：可日/周 **检查**，但检查脚本输出只能是 drift 报告；`drift.status not in {REVIEW, CRITICAL}` 时必须零 reopt。
- `platform-config.json` 衍生的 `automation_policy.triggers` 中的 `scheduled_retest` / `scheduled_research` 仅表示「允许在该 lane 下响应人工或 drift 触发的复测」，**不是**独立优化 cron（实现清理见 §5）。

## 3. 严回测门（reopt 之后、shadow 之前）

有界 reopt 产出 `OptimizationProposal` 后，必须通过既有晋级链，不得用单次 in-sample 最优替代：

| 门 | 要求 | 引用 |
| --- | --- | --- |
| 编排器 | `BacktestOrchestrator` + `purged_walk_forward.v1` | [QPK 晋级标准](https://github.com/QuantStrategyLab/QuantPlatformKit/blob/main/docs/strategy_promotion_risk_standard.zh-CN.md) |
| WFA | ≥3 个有序 folds，正数 purge/embargo | 同上 |
| OOS | 锁定且独立 ≥12 日历月 | 同上、`evidence_package_template` |
| 预算 | `max_search_iterations`、`max_param_keys`；`allow_live_enablement=False` | `ResearchPromotionBudget` |
| Shadow | `require_paired_shadow` 时须 paired 证据；`shadow_passed` 否则 `PARK` | `research_promotion_cycle` |
| 人工 | `AWAITING_HUMAN` 止；`apply_human_promotion_decision` 不授 live | 同上 |

**当前缺口**：QPK 循环已接 drift→reopt→shadow→HITL；生产 runner 尚未把 **监测阈值** 与 **BacktestOrchestrator 硬门** 在同一条 ticket 上闭合。文档与后续工程 PR 应补绑定与 fail-closed 测试，而不是新建「定时优化」工作流。

## 4. 人机分工（与自治策略一致）

与 [自治运行策略 V2](qsl_autonomous_operating_policy_v2.zh-CN.md)、[研究任务契约 V1](qsl_research_task_v1.zh-CN.md) 一致：

| 角色 | 可做 | 不可做 |
| --- | --- | --- |
| **监测 / 定时 health** | 读回指标、写 drift 报告、去重告警 | 触发 reopt、改参、开 PR 合并晋级 |
| **AI** | 解释 drift、起草研究任务、验证证据格式 | 授 live、改信封/风控根、复位熔断、改 BUY/SELL |
| **有界 reopt** | 在预算内搜索候选参数 | 超预算、扩标的、绕过 WFA/OOS |
| **人** | 接受/拒绝 ticket、选平台与风险偏好名、授权新晋级 | 被 cron 代替的「例行改参」 |

控制台与 Issue 只呈现 **状态 + 下一人工动作**；内部 SHA、ticket id、fold 细节折叠在详情。

## 5. 实现对照（2026-09-07 收尾）

| 层 | 状态 | 说明 |
| --- | --- | --- |
| QPK `run_research_promotion_cycle` | **已合** | `REVIEW`/`CRITICAL` → bounded reopt → 严回测门 → shadow → `AWAITING_HUMAN` |
| QPK `ResearchPromotionBudget` | **已合** | `allow_live_enablement` 构造即拒绝 True |
| QPK `enforce_promotion_backtest_gates` | **已合**（#580） | reopt 后、shadow 前 fail-closed；缺/失败证据 → `PARK` |
| QPK `evaluate_production_drift_health` | **已合**（#581） | 版本化阈值 + 只读 metrics → `DriftResult`；cron 只可评估 |
| QPK `production_drift_health_probe` | **已合**（#582/#583） | CLI + `from-store`；缺分 PARK；**零** optimize |
| 生产 drift **观测读回源** | **已接线** | 三平台 lifecycle observe 统一读取 lifecycle store 中的 `drift_score`；`LIFECYCLE_PERFORMANCE_BUCKET` 已指向共享桶 |
| 三平台 QPK pin | **PR 中** | pin `020a1ee`（Schwab #381 / IBKR #489 / LB #447） |
| 定时 cron 独立 reopt | **禁止** | 不得新增；既有 health 检查须保持零优化副作用 |
| `build_config` `scheduled_*` 触发器文案 | **已澄清** | 语义为「lane 允许响应 drift/人工复测」，非日历优化 |

生产分数只以 lifecycle store 为来源，不从平台日志或 UES 另算第二份分数。平台 lifecycle observe 与 UES `drift-check` 是双轨消费者；UES 必须写入同一 `gs://qsl-runtime-logs-shared/strategy-lifecycle/v1`，避免来源分叉。

与 P0–P6 总表关系：日更 P1–P3、组合就绪度复评、AIAudit 诊断均为 **观察/记录** 轨，见 [P0–P6 当前状态](QSL_P0_P6_CURRENT_STATE_AND_DRIVER_POLICY.zh-CN.md) §当前实现登记。本文不扩大为「观察 → 自动调参/自动交易」。

## 6. 非目标

- 日历驱动每日/每周参数重构或「例行 reopt」
- AI 或 cron 直接改 live 参数、升资金档、授 P4–P6
- 用合成/单次样本指标绕过 WFA/OOS
- 新插件结果自动覆盖已在跑 runtime 版本
- 新建平行晋级框架（复用 QPK `research_promotion_cycle` + `BacktestOrchestrator`）

## 7. 交叉引用

- QPK 实现：`QuantPlatformKit/src/quant_platform_kit/strategy_lifecycle/research_promotion_cycle.py`
- QPK 生产 drift：`QuantPlatformKit/src/quant_platform_kit/strategy_lifecycle/production_drift_evaluator.py`
- QPK drift 探针：`QuantPlatformKit/src/quant_platform_kit/strategy_lifecycle/production_drift_health_probe.py`
- 晋级标准：[strategy_promotion_risk_standard.zh-CN.md](https://github.com/QuantStrategyLab/QuantPlatformKit/blob/main/docs/strategy_promotion_risk_standard.zh-CN.md)
- 资金信封：[qsl_capital_risk_envelope_v1.zh-CN.md](qsl_capital_risk_envelope_v1.zh-CN.md)
- 组合 A→B：[qsl_multi_strategy_combo_ab_v1.zh-CN.md](qsl_multi_strategy_combo_ab_v1.zh-CN.md)
- 研究任务（只读队列）：[qsl_research_task_v1.zh-CN.md](qsl_research_task_v1.zh-CN.md)
- 隔夜清单：[qsl_overnight_open_items.zh-CN.md](qsl_overnight_open_items.zh-CN.md)

## 8. 残留工程（读回与部署，非再造框架）

1. ~~生产观测 → `evaluate_production_drift_health` 的脱敏 metrics 注入~~（平台 lifecycle observe + QPK #583）
2. 健康检查工作流：lifecycle 已含零 reopt drift 步骤；平台与 UES GitHub vars 已配置共享 lifecycle bucket，UES `drift-check` 必须持续写同一桶
3. 控制台 `AWAITING_HUMAN` 摘要已有；保持无默认 live 按钮
4. W3 / 云端部署开闸需单独账户清单 + 凭据 + 明确 enable 授权

验收（政策层）：读者能复述「未偏离不优化、偏离后有界链、人工门前不 live」；能指出严门与 drift 评估器已在 QPK，平台 cron 只读评估。
