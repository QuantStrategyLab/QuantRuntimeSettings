# C2：新候选 NONE → enable 的独立路径设计

状态：**DESIGN_ONLY / OWNER_APPROVAL_REQUIRED**。基于 C1 PR #628 的签名
promotion 控制面，提出新候选的独立启用设计；仅新增文档，没有新 endpoint、
命令、schema、writer 或运行行为。本文不连接 live enabled、不执行变量
写入、签名、消费、部署或平台同步。设计获批后仍需独立实现及非 live 验证，
真实启用须取得绑定目标与版本的明确授权。

English scope: this is a proposal for first activation of a fresh candidate,
not legacy resume. It implements no enable path and grants no live authority.
Configuration readback, platform observation and execution evidence remain
separate; unknown identity or outcomes block further action.

## 现有合同：NONE 不是已授权基线

[builder](../python/scripts/build_runtime_switch.py) 对空状态或 `NONE` 不加入
`live_continuity` 对象。
[schema](../schemas/runtime-target.schema.json) 的 continuity 状态枚举没有
`NONE`；不能写入 `{"state":"NONE"}` 来伪装合法 continuity。
已有 baseline_kind 枚举 `legacy_authorized`、`release_attested`；后者只是
schema 允许的标签，不证明平台验证器或授权已经就绪。

[Binance resume](../python/scripts/resume_binance_runtime.py) 和
[LongBridge resume](../python/scripts/resume_longbridge_runtime.py) 验证既有
`legacy_authorized` 基线及 `RECONCILE_ONLY` / `ACTIVE_LKG`，新候选不得进入
这两个入口。保持其现有拒绝行为；绝不为绕过校验生成 legacy 基线、
`ACTIVE_LKG`、`ROLLBACK_LKG` 或借用别的目标的授权。

现有[签名控制面说明](promotion-activation-control-plane.zh-CN.md) 的新 target
段落是后续平台授权对接的起点。其签名与消费证明的是批准的配置动作，
不能在缺少平台侧校验、部署回执和目标证据时被解释为已经具备 live
执行权限。本文要求这些缺口在启用前单独补齐，不更改现有工作流。
[运行生命周期](runtime-target-lifecycle.md) 继续把目标配置、平台观察和
`execution_evidence` 分开，continuity 不会自行打开 disabled 目标。

## 审查输入与身份绑定

以下是未来独立 enable plan 所需的**设计项**，不是向现有 sealed manifest
追加字段的建议；现有校验器要求字段完全一致。新合同须另行版本化审定。
验收包只存非秘密标识/摘要；不得包含凭证、真实订单请求或私有账户明文。

| 证据 | 必须绑定或确认的内容 |
| --- | --- |
| 新候选前态 | authoritative target 当前明确 disabled，且没有 continuity；不能只读缓存或 UI 标签 |
| 配置与目标 | `target_id`、`platform_id`、`deployment_selector`、`account_selector`、`account_scope`、`service_name` 和准确 GitHub 写入 scope |
| 版本与风险 | 源码 SHA、依赖/锁文件摘要、实际部署 artifact 与配置/风险摘要、批准的既有上限；不以新的启用理由提高预算 |
| 研究验收 | 绑定同一候选的独立验收、预注册和净成本/风险证据；报告 PASS 不等于授权 |
| 账户状态 | 经授权的只读 reconciliation 证明目标账户/策略归属、持仓与未完成订单及冲突 writer 已核对；缺失须停在设计态 |
| 授权 | owner 批准的阶段、目标、版本、限额、有效期、签发人和独立执行人身份；不允许浮动目标别名 |
| 平台能力 | 目标平台验证消费记录与部署/授权绑定的能力、非 live 拒绝场景验证及回执合同 |

现有 promotion 的 `candidate` 字段为 `strategy_profile`、`source_revision`、
`artifact_sha256`、`config_sha256`、`risk_sha256`；`target` 为 `platform`、
`target_name`、`execution_mode`。见
[builder](../python/scripts/build_promotion_manifest.py) 和
[validator](../python/scripts/activation_contract.py)。其中现有约定的
`artifact_sha256` 是该源码版本 `uv.lock` 的摘要，**不是容器镜像 digest**。
`config_sha256` 绑定预览 target 文件的精确字节；不能与 runtime target
fingerprint 混用，后者排除 continuity 并使用规范化 JSON。

现有 promotion execution_mode 只允许 `paper` / `live`；activation 中的
`SHADOW` stage 是 contract-only 合同值，不证明已有 shadow executor。
本文不会把新阶段写进现有 manifest，也不把 paper 或 dry-run 默认当成
可获订单权限的测试环境。有效期、签名和单次消费仍按既有合同校验。

## 独立入口与单写者要求

未来入口必须明确是 `fresh NONE enable`，与 legacy resume 隔离；当前
没有此入口实现。首先在不写外部系统的预览中完成身份、前态、限额、
批准证据、签名/有效期和平台能力审查。任一项未知或不匹配则拒绝。

配置 writer 的资源身份沿用
[runtime_settings](../python/scripts/runtime_settings.py) 的
`repository|variable_scope|environment-or-empty|name`，执行前重新从权威源
读取前态和精确 target identity。外部账户/部署 writer 的冲突范围不能仅
用 GitHub 变量名界定：跨仓库、跨环境指向同一账户也须互斥。拟议需要
耐久租约/条件写入或等价的可审查单写者机制，其合同及超时处理待批准。
现有工作流 concurrency 和先读后写不是跨仓库原子锁；
`concurrency_complete_lock=False` 不能被 UI 或验收方解释为完整排他保证。

新基线只能在独立批准的实现中，由平台验证绑定的 signed release、
消费记录、准确部署与 target identity 后产生 `release_attested`。
不得调用当前 builder 生成假的 `legacy_authorized` 基线。基线产生时点、
初始非执行状态和转换规则须在平台合同中另审；本文不指定写入
`ACTIVE_LKG`，也不赋予没有验证器的 NONE 目标执行资格。

## 消费、写入、观察与失败语义

[现有 ledger](../python/scripts/promotion_ledger.py) 使用 annotated tag
`qsl-promotion-consumed/<single_use_id>`，在配置写入前原子创建 ref。
记录实际字段 `schema=qsl.promotion_consumption.v1`、`single_use_id`、
`promotion_sha256`、`signature_sha256`、`run_id`、`workflow_sha`。
protected ruleset 须满足完整覆盖、禁止 update/delete 及无 bypass 的
fail-closed 检查；看不到管理员 bypass 全貌不等于已证明不存在，仍需
owner 的授权只读核验。单次消费只能阻止同一个 id 重用，不是账户锁。

| 情况 | 拟议处置与可声称的结果 |
| --- | --- |
| 前态、目标或源码/config/risk 摘要变化；签名无效/过期 | 在消费前拒绝；重审并重新签发，不替换摘要继续执行 |
| ledger 保护或权限未知 | 不消费、不写入，不以 ruleset 名称或 CI 绿色代替核验 |
| 消费结果/读回未知 | 只读核对 exact ref、tag 对象与全部摘要/上下文；禁止同 id 自动重试或删除 tag |
| 消费成功，后续写入失败或结果未知 | id 已作废；标记待 reconciliation，不能当成没有写入，也不能重用 id |
| 配置写入后读回不匹配或未知 | 不报告成功，不自动 resend 或构造 rollback；先核对权威前态，下一次动作另授权 |
| 配置精确读回匹配，缺少平台观测 | 只能报告配置匹配，不能称平台已启用或订单成功 |
| 平台观测匹配，缺少执行证据 | 只能报告平台观测结果；不虚构成交、账户恢复或研究收益 |

读回审计沿用实际字段 `resource_key`、`operator`、`reason`、`related_run`、
`old_value`、`new_value`、`readback`、`concurrency_complete_lock`、`writer_sha`、
`writer_workflow`、`writer_ref`。原始非布尔值使用现有 value audit token 摘要，
不能往公开文档泄露变量内容。当前 resume 的 `configured=True`、
`platform_applied=False` 正是这一区别；不能修改含义来“补成功”。

未来平台 observation 必须独立绑定目标、部署版本和观测时间；
已有 `runtime_enabled` 的 null、`scheduler_state` 的 `unknown` / `missing`
和不明确 revision 保留未知语义，不可当成 false 或 true。平台同步、
scheduler 激活及账户执行不是 GitHub 变量读回。不能自动调用被既有
工作流禁用的 `trigger_platform_sync`，也不能用新的 enable 入口重置
kill switch、绕过风控或撤销消费记录。

## 待批准设计与验收

本设计的审查阶段仅为拟议标签，例如“证据待审”“已批准未应用”
“消费结果未知”“配置匹配但平台待观测”“需 reconciliation”。它们不是
现有 runtime 状态枚举，也不应写入任何现有 target/activation 对象。

owner 需批准独立入口、模式与权限分离、完整 target/account 单写者合同、
release attestation 平台校验、回执合同及失败后的人工 reconciliation。
以后实现 PR 的合成验收至少覆盖：NONE 不进入 legacy resume；基线不可
伪造；身份/scope 混淆和前态漂移拒绝；签名/TTL/摘要不匹配拒绝；消费
竞争与失败后不重用；配置读回不等于平台生效；平台证据未知不算成功。
本次只有设计审阅与 Markdown 链接/字段核对，没有执行这些未来测试。

当前实际 target/账户状态、签发与执行人授权、ledger 保护、部署 artifact、
平台能力和执行回执均 **UNKNOWN / NOT_ATTESTED**。仓库代码可供审阅，
不等于上述外部条件已成立；本补丁的唯一产物是待批准设计文档。
