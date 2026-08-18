# QSL 自治运行策略 V2

> 状态：`P0_CONTROL_PLANE_ONLY`
>
> 本文与 `qsl.activation.v2` 合约定义无人值守系统的控制边界；不启用 paper、shadow、live、订单、资金或任何部署。

## 目标

系统以预授权的自治策略运行，而不是为每次工作流等待人工点击。策略所有者在部署前设置一份可过期的、特定阶段的策略版本；自动化只可在其范围内产生候选、验证证据和执行已验证的非执行性工作。

`qsl.activation.v2` 只保存该策略的不可变引用和 SHA-256 回执。回执将来必须由独立的控制根验证，例如受保护的策略存储、独立部署 gate 或不可由 AI 修改的签名服务；合约校验本身不构成签发、签名或运行许可。

## 三个权限区

| 区域 | 可做什么 | 明确不能做什么 |
| --- | --- | --- |
| AI 研究区 | 只读监测、研究候选生成、证据验证、发布资格评估。 | 读取生产凭证、直接下单、修改策略或风险控制根。 |
| 确定性控制区 | 校验锁定依赖、数据/证据/策略版本、自治策略回执和 stage。 | 由 LLM 自行放宽规则或把候选当作已批准版本。 |
| 执行与风控区 | 未来仅执行由独立风控网关接受的已发布版本；持续对账并可停止新订单。 | 接受 AI 直连券商、由 AI 重置熔断或扩大风险上限。 |

AI 与券商之间不得存在直接写入路径。任何未来订单都必须通过独立执行服务；该服务应使用独立的最小权限身份，并拒绝未绑定到精确 deployment bundle、Activation 和风控策略的请求。

## V2 合约边界

`operating_authority` 的 `mode` 固定为 `PREAUTHORIZED_AUTONOMY`，并精确绑定一个 `stage`、`policy_id`、`policy_version` 和 `policy_receipt_sha256`。策略可以覆盖该阶段内的重复无人值守运行，但不能被跨阶段复用；stage 升级必须引用新策略版本和新回执。

允许的 AI 动作固定为：

- `monitor_readonly`
- `research_candidate_generation`
- `evidence_validation`
- `release_evaluation`

禁止的 AI 动作固定为：

- `credential_access`
- `direct_order_submission`
- `kill_switch_reset`
- `policy_mutation`
- `risk_limit_mutation`

这两个集合不是提示词，而是合约验证规则。若未来需要改变它们，必须发布新的策略/合约版本并经过独立控制根；不得由运行中的 agent 自改。

## 无人值守的安全默认值

1. 任何数据完整性、证据、策略版本、时钟、连接或对账检查失败时，默认 `PARKED`，并禁止新增动作。
2. 未来执行网关的首个自动动作应是“禁止新开仓”；自动平仓需要独立、预先定义的风险规则，不能由 AI 即时判断。
3. paper 与 live 必须使用不同凭证、不同端点和不同自治策略；paper 结果只能构成证据，不能单独证明 live 表现。
4. 控制根、凭证和熔断恢复权必须与 AI 研究身份隔离，并保留可审计事件链。

## 一次性迁移

本次控制面升级将 `qsl.activation.v1` / `human_authority` 和依赖它的 `qsl.reconciliation_record.v1` 一并替换为 V2。仓内未发现已签发的 activation 工件，因此不保留双协议运行路径。该迁移只改合约和文档；没有 active 自治策略，也没有启用 P4–P6。
