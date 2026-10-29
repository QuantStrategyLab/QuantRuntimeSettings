# QSL P4/P5 无人值守交付 V1

> 状态：`CONTROL_CONTRACT_IMPLEMENTED_EXECUTOR_NOT_WIRED`
>
> 本文把 paper（P4）与 shadow（P5）设计为可连续无人值守运行的两条独立通道；它不启用账户、券商、订单、资金或 P6。

## 目标

正常情况下，人不需要每天批准 paper 或 shadow。系统在已预授权、未过期的精确候选范围内自动运行、记录、对账、重试和停车；只有无法由确定性规则消除的重大风险才升级通知所有者。P6 实盘始终需要所有者明确决定。

P4 与 P5 的含义必须分开：

| 阶段 | 自动动作 | 绝不做什么 |
| --- | --- | --- |
| P4 `PAPER_DRY_RUN` | 向**独立的 paper 账户**提交受限纸面订单、记录回执并自动对账。 | 不使用 live endpoint 或 live 凭据；不把 paper 结果当作 live 资格。 |
| P5 `SHADOW` | 生成并记录假设决策/虚拟账本，与真实市场和独立只读对账比较。 | 不提交任何券商订单，不读取或修改 live 资金。 |

`PAPER_BROKER` 不是所有平台都必须经过的全球关卡，而是目标平台的可选自动能力：同一固定策略可在平台 A 已有 paper 或 live 证据、在平台 B 持续 shadow；A 的结果只作为可审计的参考，不能授予 B 的订单资格。若 B 有独立 paper endpoint 和适配器，系统在已预授权范围内自动运行 P4；若 B 没有 paper 能力，系统不把它报成错误，而是持续 P5 shadow。仅当策略、数据与目标执行证据精确匹配且新鲜时，控制台才可产生一个 `P6_LIMITED_LIVE_CANARY_DECISION_REQUIRED` 的**所有者决定项**。这不是 P6 启用、账户接入或真实订单功能。

Alpaca 官方文档要求 paper 使用独立的 paper endpoint 和不同于 live 的凭据；因此市场数据配置不能被推断为 P4 交易授权或凭据。见 [Paper Trading](https://docs.alpaca.markets/us/v1.4.2/docs/paper-trading) 与 [Authentication](https://docs.alpaca.markets/us/docs/authentication)。

## 已实现的机器门

`qsl.forward_observation_risk_control.v1` 定义 P4/P5 每条自动通道的最小、可签名风险对象；其 Python 校验器位于 `python/scripts/forward_observation_risk_control.py`。它固定：

- 阶段与执行通道的一一对应：P4 只能是 `PAPER_BROKER`，P5 只能是 `SHADOW_LEDGER`；
- 精确候选、策略 revision 和 P1/P2/P3 摘要；
- 允许标的摘要、最大持仓数、单次/总敞口、日换手、每 session 决策数与连续失败上限；
- 数据、证据、对账、执行错误及未知执行结果一律熔断；下一周期前必须先完成对账；
- 最长 31 日有效期、canonical SHA-256 以及闭合字段集。

该校验器没有网络、broker、credential、账户、订单、调度或写入能力。它只有在被已验签的 `qsl.autonomous_operating_policy.v1` 以相同 `risk_policy_id`、version 与 SHA-256 引用，并由独立执行网关消费时，才成为 P4/P5 的一个必要输入；它单独不授予运行资格。

## 自动运行状态机

```text
P3 终态证据 + 已签 P4/P5 policy + 风险控制摘要
                         │ 任一缺失/过期/不匹配
                         ▼
                    PARKED（记录原因，下一窗口重验）
                         │ 全部匹配
                         ▼
              P4 paper gateway / P5 shadow ledger
                         │
        对账成功 ────────┴───────► 写入最小 receipt，等待下一 session
        数据/证据/执行错误 ──────► 熔断、自动重试、去重告警
        未知执行结果 ───────────► 禁止新增动作，先自动对账；未能恢复才紧急通知
```

`PARKED`、`DEFERRED` 和已知可恢复的数据故障只进入自动重试，不因一天数据源异常作废历史或要求日常人工点击。未知的 order 结果、对账无法收敛、风险上限违反或 policy/目标身份漂移会阻止新增动作，并升级为高优先级事件。

## 落地顺序

1. P5：实现独立的 shadow ledger scheduler，消费已验证 P3 结果并每日写最小 receipt；它没有 broker 写权限。
2. P4：实现独立的 Alpaca paper adapter。部署身份只能获得 paper 凭据，endpoint 在代码/部署中固定为 paper，不能由工作流、AI、策略或 policy 指定。
3. 两者都在每个 cycle 前运行既有 policy gate、此风险控制校验和对账门；credential、订单 payload、账户 ID、完整仓位和原始行情不进入控制台或 AI。
4. 把脱敏 P4/P5 receipt 作为统一控制台的来源快照，供 AI 监测和重要事件通知使用；它们仍不能自动把候选推进到 P6。

当前仓内没有已签 P4/P5 policy、专用 paper 身份或已接线 executor；因此当前能力仍不包含 paper/shadow 实际运行。P5 已有仅接受注入 bucket client 的 GCS 传输适配器：它按固定 cycle 读取输入、用 generation-match 仅首次写入回执，且存储异常闭合为 `PARKED`；它不列举、覆盖、删除、读取凭据、创建资源或安装 scheduler。尚无真实 bucket、workload identity、runner 或 scheduler，不能把该代码接口误读为 shadow 已运行。这个明确的 `PARKED` 状态是可恢复的准备缺口，不是把 P1–P3 一同阻塞的全局门槛。
