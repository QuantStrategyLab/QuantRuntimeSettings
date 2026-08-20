# QSL 确定性风险判定内核 V1

> 状态：`DETERMINISTIC_CORE_IMPLEMENTED_NOT_WIRED`
>
> 本文和 `python/scripts/deterministic_risk_gate.py` 只实现一个纯内存、无副作用的判定内核。它不读取任何账户或凭据，不连接网络或券商，不提交订单，不写入账本，也不启动 workflow/scheduler；因此不构成 P4、P5、P6 或真实执行能力。

## 作用与边界

既有 `qsl.forward_observation_risk_control.v1` 负责把 P4/P5 候选、P1/P2/P3 证据和粗粒度上限固定为一个可签名对象。它有意不接收仓位快照。该内核不修改、也不替代该契约；新的 `qsl.deterministic_risk_gate_policy.v1` 仅以精确的 id、版本和 SHA-256 引用它，并补充以下账户级**判定规则**：

- 总敞口、单标的敞口、单策略敞口；
- 杠杆（gross/equity，以整数 bps 上取整）；
- 当日损失（达到上限即禁止新增风险）与每 session 决策频率；
- 观测完整性、对账状态和已持久化的熔断状态。

调用方把一个脱敏的、注入式 `portfolio snapshot` 和一笔“新增风险”请求交给 `evaluate_new_risk`。内核只返回：

| 决定 | 含义 |
| --- | --- |
| `ALLOW_NEW_RISK` | 本次输入中的全部健康状态和硬上限都通过。它不是订单许可。 |
| `NEW_RISK_PROHIBITED` | 任一健康状态或硬上限不通过；建议下一熔断状态为 `OPEN`。 |

任何结构、摘要、字段、数值或策略引用不合法都会抛出 `DeterministicRiskGateError`。未来 P4/P5 网关必须把该异常同样视为 `NEW_RISK_PROHIBITED`，并保持其自身持久化的熔断器为 `OPEN`。该 fail-closed 行为不能由调用方降级为“继续尝试”。

## 不可变输入与可复算输出

### Policy

`qsl.deterministic_risk_gate_policy.v1` 使用闭合字段集、canonical JSON 与 SHA-256。它要求：

- 精确引用一个 `qsl.forward_observation_risk_control.v1` 风险策略摘要；
- 全部金额为非浮点的正整数 cents，杠杆为整数 bps；
- `manual_reset_required=true`。不接受自动重置熔断器的策略；
- 不含账户标识、券商 endpoint、凭据、订单 payload 或 URL。

### Evaluation input

`qsl.deterministic_risk_gate_input.v1` 包含政策摘要、一个受限的组合快照和一笔新增风险请求。快照内的标的/策略总额必须各自精确加总为 gross 总敞口，避免调用方用互相矛盾的数字绕过限制。它只能是未来网关内存中的输入投影，不是账户读取实现，也不应直接进入控制台或 AI 上下文。

### Decision output

`qsl.deterministic_risk_gate_decision.v1` 输出固定的原因码、投影后的限制指标、下一熔断状态建议和 SHA-256。它不包含账户、券商、订单、成交或凭据字段。若未来需要留存审计记录，应由独立 writer 再产生最小化、脱敏的 receipt，而不是把此内核当作 writer。

## 熔断规则

内核只**消费** `CLOSED`/`OPEN` 状态，永远不提供 reset 方法：

```text
CLOSED + 全部条件通过      -> ALLOW_NEW_RISK, next=CLOSED
CLOSED + 任一异常/越界      -> NEW_RISK_PROHIBITED, next=OPEN
OPEN   + 任意新风险请求     -> NEW_RISK_PROHIBITED, next=OPEN
```

未来独立网关可在受控存储中把 `next=OPEN` 作为状态变更；恢复必须经过其预先定义的人工/外部操作流程，不能由 AI、GitHub Actions、网页、策略代码或本模块自动完成。减仓/平仓也不在本 V1 的请求模型中，日后必须单独定义为预编码、可回放的规则。

## 后续接线（尚未实现）

1. 在独立 P5 shadow adapter 中，先读取/验证 P1–P3、现有 forward-observation 风险控制、policy-gate receipt 与前一最小化 shadow receipt，再把其受限快照注入此内核；保存结果前再次确认摘要一致。
2. 在独立 P4 paper gateway 中复用相同内核，但由只具 paper 权限的身份产生受限快照、幂等键和对账记录；该身份与 AI、网页、Actions 和策略研究隔离。
3. 接线前要为每个策略或组合候选分别冻结 policy，建立 deterministic replay fixture，并先只允许“停止新增风险”。没有这些条件时，P4/P5 继续是 `PARKED`。

该顺序沿用 [确定性执行网关 V1](qsl_deterministic_execution_gateway_v1.zh-CN.md) 的分层：策略/组合只能提出目标，风险内核只判定，未来执行服务才可能持有受限外部身份。任何一层都不能绕过风险内核直接写入券商。
