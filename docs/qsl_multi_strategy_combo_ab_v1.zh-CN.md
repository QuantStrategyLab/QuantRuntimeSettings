# QSL 多策略组合 A→B V1（设计）

> 状态：`DESIGN_FROZEN_A_LIBRARY_READY_B_VIEW_READY`
> 范围：虚拟 combo 研究与多账户汇总风险的路径选择；不授权 live、不下单、不写券商、不部署真账户。
> 上游：已合资金信封栈见 [资金风险信封 V1](qsl_capital_risk_envelope_v1.zh-CN.md)。

## 1. 结论（一句话）

先做 **A 虚拟 combo 研究**，再做 **B 多账户汇总风险**；**明确不做 C 共账户 allocator**。组合层只能裁切与解释，不能绕过账户闸或 `RiskEngine`。

## 2. 路径 A：虚拟 combo 研究（不碰资金）

目标：把多个成员策略合成一份**研究证据**，回答「一起持有时相关组风险袖是否可接受」，而不是开新账户或共账户写单。

| 做什么 | 不做什么 |
| --- | --- |
| 合成收益/回撤路径（synthetic 或已冻结净成本路径） | 读写真账户、凭据、券商会话 |
| 相关组 correlation haircut（如 TQQQ+SOXL 预算之和封顶） | 共账户权重分配、自动再平衡 |
| 产出 `learning_only` / `promotion_eligible=false` 类 combo 证据 | 授予 live、改 mandate、提杠杆 |
| 对照同一偏好名下的 Composer / 晋级双口径 | 把合成结果当实盘健康或恢复前置 |

A 的完成定义：有可复现的 synthetic combo evidence 契约与单测；证据标明合成假设；缺相关估计时 fail-closed（不假装已做 haircut）。

## 3. 路径 B：多账户汇总风险（共用资金信封）

目标：控制台/诊断用**汇总权益**落入同一张资金分档表，再按各账户 mandate 解释；执行侧仍是 **一账户一 active writer**。

| 做什么 | 不做什么 |
| --- | --- |
| 汇总权益 → 同一 `capital_scale × vol_scale × dd_scale` 表 | 跨账户合并下单、共享 claim |
| 账户视图上标注「组合预算 / 相关组袖」是否超限 | 用汇总视图静默改任一账户仓位 |
| 超限只触发解释与 `NEW_RISK_PROHIBITED` 候选信号 | 自动平仓、跨账户资金调拨 |

B 依赖信封 D2/D3 接线分期；本设计不提前发明第二套账户闸。

## 4. 明确不做 C：共账户 allocator

同一物理账户多个策略同时写资金、共享 allocator、或「组合权重 → 单账户拆单」**不在 V1**。理由与组织约束一致：单账户当前一个 active strategy；缺身份/claim/唯一执行者时禁止并行资金 writer。需要组合时，优先独立账户成员 + 组合级 OOS/cost/stress 证据，而不是共账户拼 PASS。

## 5. 与已合资金信封栈的关系

仓位裁切顺序（与信封文档一致，组合层只插入 haircut 一环）：

```text
策略目标权重
  × 晋级仓位档 0.50 / 0.75 / 1.00
  × 插件 scalar（≤1）
  × capital_scale × vol_scale × dd_scale
      → correlation haircut（相关组总风险袖）
      → NEW_RISK_PROHIBITED（账户硬门）
      → RiskEngine → 执行
```

- **A** 在研究侧预演「promotion × plugin × capital×vol×dd → haircut」后的合成证据；不接线执行。
- **B** 在账户/汇总权益侧消费同一信封表；haircut 与硬门仍按账户落到 writer，不得用组合视图绕过 `REJECT` 零提交。

## 6. 非目标

- HRP / RL / 均值方差 live 优化器当主路径
- Kelly 公式作主仓位
- AI 提杠杆、升档、授 live 或复位熔断
- 真账户部署、券商接线、共账户 allocator（C）
- 新建平行风控框架或削弱 `RiskEngine`

## 7. 实现对照（2026-09-07 收尾）

| 项 | 状态 |
| --- | --- |
| 路径选择 A→B、不做 C | 本文冻结 |
| synthetic combo evidence | **已合**（QPK #578） |
| 多账户汇总视图（路径 B / D3） | **已合**（QPK #580 `evaluate_multi_account_envelope_view`）；只读解释，无执行权 |
| 真账户读回 / live / 部署 | **PARK**；需凭据与单独 enable 授权 |

验收：读者能区分 A/B/C；组合只经 haircut 进入信封→硬门→`RiskEngine`；库侧 A/B 视图已就绪，不等于已启实盘。
