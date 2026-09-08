# QSL 偏离触发研究晋级与人工门 V1（冻结口径）

> 状态：`POLICY_FROZEN_LIBRARY_GATES_MERGED`
> 范围：AI 研究晋级自动化边界；不授权 live、不改实盘参数、不部署、不新增定时盲跑优化。
> 确认日：2026-09-07（用户冻结）。
> 口径核对：2026-09-08；本轮仅核对源码与 GitHub 合并状态，未独立核验部署、配置应用或真实 drift 分数。

本文区分 **生产 Policy A** 与 **人工显式调用的有界研究能力**：生产 `REVIEW`/`CRITICAL` 仅禁新增风险，零自动 reopt；QPK `research_promotion_cycle` 库能力不代表生产已开启自动优化。

> **2026-09-08 本轮接续澄清（优先于下文较早的“人工另开研究”描述）：** 用户已明确授权实现“策略/已绑定插件偏离达 REVIEW/CRITICAL → Codex only 根因分析与方案 → 有界 Python 搜参 → 严格 WFA/OOS → paired shadow → 网站 AWAITING_HUMAN”。生产交易链仍不热改参数，低于门槛零优化；API 不作为本研究主链或失败回退，其他 API 场景需单独指定。当前仅完成本地接线与模拟验证，真实候选执行 job、输入/collector 绑定及部署周期尚未验收；下文“零自动 reopt”应限于生产交易侧的确定性响应，不能据此禁止已授权的隔离候选研究。

## 1. 核心原则（不可协商）

### 1.1 生产监测不自动优化

- **默认姿态**：监测 drift / health；所有生产 drift 状态均**不**启动参数搜索或 reopt。`REVIEW`/`CRITICAL` 仅通过 NEW_RISK gate 禁新增风险，不自动缩仓、改参或授 live。
- **禁止**：按日历、固定周期或「到了该优化」盲跑 reopt；把 `scheduled_retest` / `scheduled_research` 当作独立优化触发器。
- **允许**：低频定时任务仅做 **drift/health 评估**（读回指标、对照冻结基准、写脱敏记录）；评估本身不等于优化。

### 1.2 生产响应与人工研究分轨

生产 Policy A 的响应止于禁新增风险与人工处理：

```text
drift(REVIEW|CRITICAL)
  → 禁新增风险（NEW_RISK gate；零 optimize）
  → 等待人工决定是否另开研究
```

仅在另有明确人工研究授权并显式调用库时，才可进入既有有界链路；drift 可行动只是库内条件，不是生产自动调用权限：

```text
人工显式调用 + drift(REVIEW|CRITICAL)
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
- 已在跑版本遵守既有资金侧响应授权；Policy A 本身只禁新增风险，不新增自动降仓权限。必要时经人工决定另开**新候选**研究，不在原 ticket 上「就地改参上线」。

### 1.4 对照成熟做法

| 阶段 | 成熟系统 | QSL 冻结口径 |
| --- | --- | --- |
| 常态 | 监测 KPI、回撤、执行偏差、数据/证据新鲜度 | 低频 drift/health 读回；零自动优化 |
| 轻度偏离 | 告警、解释、可选降仓 | `DriftStatus` 低于 REVIEW：记录 + 运维去重；**不** reopt |
| 中度偏离 | 停新单、shadow 对照 | `REVIEW`：仅禁新增风险；零自动 reopt，研究须另有人工授权 |
| 重度偏离 | 熔断、人工接管 | `CRITICAL`：同样仅禁新增风险；不自动缩仓、复位熔断或 live |
| 禁止 | 每日/每周日历重构参数 | 任何 cron **不得** 独立触发 reopt |

资金侧的「监测 → 降档 → 禁新风险」见 [资金风险信封 V1](qsl_capital_risk_envelope_v1.zh-CN.md)；组合证据预演见 [多策略组合 A→B V1](qsl_multi_strategy_combo_ab_v1.zh-CN.md)。研究晋级与资金信封 **分轨**：信封管账户层 `combined_scale`；本文管候选参数与晋级证据。

## 2. Drift 分级与触发（与代码对齐）

生产 `production_drift_new_risk` 与人工显式调用的 `research_promotion_cycle` 不可混写：

| `DriftStatus` | 生产 Policy A | 人工显式调用的研究库 |
| --- | --- | --- |
| 低于 `REVIEW`（含 OK、观察级） | 不因该状态追加 drift 禁新风险；零 optimize，其他风控仍适用 | `PARKED`，`drift_not_actionable`；不调用 `optimize` |
| `REVIEW` | 仅禁新增风险；零 optimize | 可进入 `BOUNDED_REOPT` → 严回测门 → shadow → `AWAITING_HUMAN` |
| `CRITICAL` | 同上，权限不扩大 | 同上，不授 live |

生产侧已有只读评估与 store 消费代码；真实分数和目标配置是否已生效仍需运行证据：

- 读回源：shadow 分歧、绩效衰减、证据过期、数据/身份不可用、Composer/信封降级信号等（只读、脱敏）。
- 评估频率：可日/周 **检查**，但检查脚本输出只能是 drift 报告；包括 `REVIEW`/`CRITICAL` 在内，生产检查均必须零 reopt。
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

**能力边界**：上述门属于人工显式调用的库研究链，不是生产自动 reopt 的待补接线。当前生产待核验的是交易 profile 对应的 store 分数、配置应用与 NEW_RISK 消费结果；不以新增 promotion runner 或优化 cron 补齐。

## 4. 人机分工（与自治策略一致）

与 [自治运行策略 V2](qsl_autonomous_operating_policy_v2.zh-CN.md)、[研究任务契约 V1](qsl_research_task_v1.zh-CN.md) 一致：

| 角色 | 可做 | 不可做 |
| --- | --- | --- |
| **监测 / 定时 health** | 读回指标、写 drift 报告、去重告警 | 触发 reopt、改参、开 PR 合并晋级 |
| **AI** | 解释 drift、起草研究任务、验证证据格式 | 授 live、改信封/风控根、复位熔断、改 BUY/SELL |
| **人工显式调用的有界 reopt** | 在授权与预算内搜索候选参数 | 由生产 drift 自动启动、超预算、扩标的、绕过 WFA/OOS |
| **人** | 接受/拒绝 ticket、选平台与风险偏好名、授权新晋级 | 被 cron 代替的「例行改参」 |

控制台与 Issue 只呈现 **状态 + 下一人工动作**；内部 SHA、ticket id、fold 细节折叠在详情。

## 5. 实现对照（2026-09-08 源码与合并状态核对）

| 层 | 状态 | 说明 |
| --- | --- | --- |
| QPK `run_research_promotion_cycle` | **库能力已合** | 人工显式调用后的有界研究链；不代表生产自动启用 |
| QPK `ResearchPromotionBudget` | **已合** | `allow_live_enablement` 构造即拒绝 True |
| QPK `enforce_promotion_backtest_gates` | **已合**（#580） | reopt 后、shadow 前 fail-closed；缺/失败证据 → `PARK` |
| QPK `evaluate_production_drift_health` | **已合**（#581） | 版本化阈值 + 只读 metrics → `DriftResult`；cron 只可评估 |
| QPK `production_drift_health_probe` | **已合**（#582/#583） | CLI + `from-store`；缺分 PARK；**零** optimize |
| QPK `production_drift_new_risk` → NEW_RISK gate | **已合**（#589） | Policy A：`REVIEW`/`CRITICAL` 仅禁新增风险；**零** optimize；该 PR 合并版本 `d5f3723` |
| store → NEW_RISK helper 与平台注入 | **代码已合** | QPK [#590](https://github.com/QuantStrategyLab/QuantPlatformKit/pull/590)、Schwab [#391](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/391)、LB [#457](https://github.com/QuantStrategyLab/LongBridgePlatform/pull/457)；交易 profile 来自 `RUNTIME_TARGET_JSON` |
| lifecycle bucket 配置同步支持 | **代码已合** | Schwab [#393](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/393)、LB [#459](https://github.com/QuantStrategyLab/LongBridgePlatform/pull/459)；GitHub vars 不证明 Cloud Run 已应用 |
| SOXL core-only baseline / history 支持 | **代码已合** | UES [#468](https://github.com/QuantStrategyLab/UsEquityStrategies/pull/468)、UESP [#478](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines/pull/478)；未在本轮采集、回放或验证真实 baseline / 分数 |
| 定时 cron 独立 reopt | **禁止** | 不得新增；既有 health 检查须保持零优化副作用 |
| `build_config` `scheduled_*` 触发器文案 | **已澄清** | 语义为「lane 允许响应 drift/人工复测」，非日历优化 |

生产分数只以 lifecycle store 为来源，不从平台日志或 UES 另算第二份分数。平台 lifecycle observe 与 UES `drift-check` 是双轨消费者；UES 必须写入同一 `gs://qsl-runtime-logs-shared/strategy-lifecycle/v1`，避免来源分叉。

交接报告称 inject 已部署；这是历史运行报告，不是本轮独立核验。observe profile override 不改变交易 `RUNTIME_TARGET_JSON` 的 profile，也不证明交易 store → NEW_RISK 闭环。共享桶 GitHub vars 的历史配置、同步代码已合、Cloud Run 已应用和真实 `drift_score` 可用须分别说明；本轮后两者未核验。

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

1. ~~生产观测 → `evaluate_production_drift_health` 的脱敏 metrics 注入~~（平台 lifecycle observe + QPK #583）；**残留**：生产 metrics → `drift_score` 持续读回与校验（非 gate 再造）
2. 平台 NEW_RISK 注入及 bucket 同步支持已合（见 §5）；按交易 profile 验证实际部署配置与 store 消费仍未在本轮完成，不因 observe 成功视为闭环
3. 健康检查保持零 reopt；共享 lifecycle bucket 的 GitHub vars 是历史配置报告，仍须区分 Cloud Run 应用与 UES `drift-check` 的真实同源分数
4. 控制台 `AWAITING_HUMAN` 摘要已有；保持无默认 live 按钮
5. W3 / 云端部署开闸需单独账户清单 + 凭据 + 明确 enable 授权

验收（政策层）：读者能复述「生产偏离仅禁新增风险、零自动优化；人工显式研究才走有界链，接受不授 live」；能区分库能力、已合代码与未核验的运行事实。
