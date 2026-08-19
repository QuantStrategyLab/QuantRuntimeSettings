# QSL 自治运行策略 V2

> 状态：`P0_CONTROL_PLANE_AND_VERIFICATION_GATE`
>
> 本文与 `qsl.activation.v2` 合约定义无人值守系统的控制边界；不启用 paper、shadow、live、订单、资金或任何部署。

## 目标

系统以预授权的自治策略运行，而不是为每次工作流等待人工点击。策略所有者在部署前设置一份可过期的、特定阶段的策略版本；自动化只可在其范围内产生候选、验证证据和执行已验证的非执行性工作。

`qsl.activation.v2` 只保存该策略的不可变引用和 SHA-256 回执。现在有两个离线验签器：`autonomous_policy_gate.py` 验证 OpenSSH SSHSIG，`gcp_kms_policy_gate.py` 验证 Cloud KMS `EC_SIGN_P256_SHA256` 的 PEM 公钥与 DER 签名。两者都不调用签名服务；签名私钥、可信根哈希及运行入口仍必须位于独立控制根中。合约校验本身不构成签发、签名或运行许可。

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

## 外部控制根与验签门

新增的验签门由四个彼此分开的输入组成：

1. 可信根：`qsl.trusted_policy_root.v1`（OpenSSH）或 `qsl.gcp_kms_policy_root.v1`（Cloud KMS P-256）。两者只含公钥、有效期与根哈希；不含私钥或 KMS 凭证。
2. `qsl.autonomous_operating_policy.v1`：绑定一个精确的 deployment bundle、target、stage、AI 权限集合和 `risk_control` 摘要。
3. 独立 detached signature：OpenSSH 根使用 SSHSIG；KMS 根使用 P-256 DER signature。对规范化 policy JSON 验签，策略或签名任何一字节变化都会失败。
4. **仓外固定的 trusted-root SHA-256**：执行服务必须从自己的不可由 AI 改写的配置、部署 gate 或签名服务取得它，不能从 workflow input、PR 内容或本仓文件自行接受。

OpenSSH 根使用 `ssh-keygen -Y verify` 的允许签名者、身份和 namespace 约束；该工具在签名消息、签名 namespace、签名者身份和允许公钥均相符时才返回成功。[OpenSSH 的 `ssh-keygen` 文档](https://man.openbsd.org/OpenBSD-7.3/ssh-keygen.1)也建议自定义 namespace 使用带域名的唯一名称。

Cloud KMS 根固定到一个具体 CryptoKeyVersion，并使用 `EC_SIGN_P256_SHA256`。Google 的官方文档将其列为推荐的椭圆曲线签名算法，并给出以 PEM 公钥、DER signature 和 `openssl dgst -sha256 -verify` 进行离线验证的方式。[KMS 算法说明](https://docs.cloud.google.com/kms/docs/algorithms)与[签名验证说明](https://docs.cloud.google.com/kms/docs/create-validate-signatures)是该适配器的格式依据。KMS 签名身份只需要 KMS 的签名权限；验证服务只需要公开 root 和外部钉住的根哈希。

验签门只有在 policy、根、签名、bundle、Activation target、stage、回执哈希和有效期全部一致时才通过。它不会签发策略，也不会读取私钥。正确接入方式是让**执行风控服务自身**在接触券商前调用它；若仅由一个可改写的 CI workflow 调用，则 CI 可以绕过它，不能算独立控制。

`risk_control` 当前只把风险策略的不可变摘要绑定进许可链。P0 已实现零新增风险的 `RECONCILE_ONLY` 准入：`new_risk_ceiling=0` 且 `write_action_ceiling=0`，不匹配即 `PARKED`。它尚不执行仓位/敞口/损失上限，也不读取账户；实际执行网关仍必须单独实现这些确定性限制。这样不会把“已经签名”误说成“已经具备交易风控”。

## 无人值守的安全默认值

1. 任何数据完整性、证据、策略版本、时钟、连接或对账检查失败时，默认 `PARKED`，并禁止新增动作。
2. 未来执行网关的首个自动动作应是“禁止新开仓”；自动平仓需要独立、预先定义的风险规则，不能由 AI 即时判断。
3. paper 与 live 必须使用不同凭证、不同端点和不同自治策略；paper 结果只能构成证据，不能单独证明 live 表现。
4. 控制根、凭证和熔断恢复权必须与 AI 研究身份隔离，并保留可审计事件链。

## 一次性迁移

本次控制面升级将 `qsl.activation.v1` / `human_authority` 和依赖它的 `qsl.reconciliation_record.v1` 一并替换为 V2。仓内未发现已签发的 activation 工件，因此不保留双协议运行路径。

5 个已计费的券商运行 GCP 项目现已有公开 Cloud KMS root，且 key version 和 PEM 已逐把读取核验；详见 [GCP P0 控制根部署 V1](qsl_gcp_p0_control_root_deployment_v1.zh-CN.md)。这些 root 没有 signer IAM，root digest 也尚未注入任何运行服务。仓内仍没有签名 policy 或已接入该 gate 的执行服务；因此仍然**没有 active 自治策略**，也没有启用 P4–P6、账户、订单或资金动作。下一步只能在独立控制根准备就绪后，把 gate 接到 paper 的确定性执行风控服务；不能把本文件、测试签名或 CI 绿灯当成运行许可。
