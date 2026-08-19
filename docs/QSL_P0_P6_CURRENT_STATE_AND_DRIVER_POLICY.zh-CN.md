# QuantStrategyLab P0–P6 主线：当前状态与 Driver 政策

> 状态：`CANONICAL_CURRENT_STATE_AND_DRIVER_POLICY`
>
> 适用范围：QuantStrategyLab 的 P0–P6 主线协作；不替代任何策略、券商或部署仓的实时证据。
>
> 已知仓内及只读运行元数据截至：`2026-08-19`。这不是 paper、shadow、live、部署或验收状态的声明。

这是可随仓库携带的 P0–P6 状态与协作政策唯一入口。它取代旧路线图中指向个人机器的绝对路径；运行时、券商和策略事实仍须在操作前从相应事实源重新读取。

## 控制方式

- 同一时刻只保留一个**主控会话**：维护本文件的事实边界、拆分工作、汇总证据和交接结论。
- 主控会话可派出多个有边界的 **driver**。每个 driver 必须有明确的阶段、问题、产物和证据范围；不得擅自扩大到其他阶段、仓库或执行目标。
- 每个当前阶段只指定一个**唯一 driver**。其他 agent 只能提供有边界的核查或实现支持，不能平行地产生第二条同阶段主线。
- driver 可做只读核查、实现自治策略允许的局部变更及产出可复核证据；不得自行把工作标为 promotion、部署或运行授权。
- 主控会话、AI 审计或策略生成不能自行签发、延长或修改自治策略。任何未被当前证据支持的状态一律记为待核实，而非推断完成。
- `NO_DRIVER_PARKED` 表示该阶段没有已定义的可执行任务；主控会话不得为了“连续推进”而臆造工作、数据获取或交易动作。

## P0–P6 当前主线

P1–P3 是一条连续的 **non-live** 研究链，但它们仍分别拥有唯一 driver 和可验证产物。下表只记录当前可携带事实，不把代码、CI 或合并误写为策略收益、运行或交易资格。

| 阶段 | 唯一 driver | 当前可携带状态与证据 | 允许的下一步 |
| --- | --- | --- |
| P0 | `QuantRuntimeSettings` | 自治运行策略 V2、离线验签门和仅 `RECONCILE_ONLY` 的准入代码已经存在。`binancequant`、`charlesschwabquant`、`firstradequant`、`interactivebrokersquant`、`longbridgequant`、`qslresearchquant` 已各自安装并读取核验一把公开 Cloud KMS P-256 root；没有 signer IAM、已签 policy 或接入运行服务。21 个 retired review caller 的本地清理属于独立 housekeeping，不构成 P0 完成或运行资格。 | 仅维护和复核控制面事实；不得从 P0 推导 P1 数据获取、P4–P6 或交易资格。 |
| P1 | `UsEquitySnapshotPipelines` | TQQQ / Alpaca 主线为 **non-live**。`tqqq_core_only_p2_v5` 的日更控制器已在 `main` 通过 CI：它在美股收盘后计划窗口推导最近完整 XNYS session、获取四只 ETF 的候选绑定输入并做完整性/健康检查。此刻尚未有 v5 的计划运行结果；`2026-08-17` 的旧 v1 手动历史根已按短期生命周期到期。 | 只允许按 v5 固定候选产生数据身份、健康记录和短期私有根；缺失/无效输入只能 `DEFERRED`/`QUARANTINED`，不得换源、补洞或改参。 |
| P2 | `UsEquitySnapshotPipelines` | `tqqq_core_only_p2_v5` 是当前唯一可运行的日更研究候选：它固定 `UsEquityStrategies` 的公开 research adapter、revision、运行参数、共同可用资产和成本，并仅让已验证 P1 截止日滚动 252-session OOS 窗口。v4/v3 只保留为 synthetic/历史依据，不能绑定新的日更输入。 | 只允许冻结、复核或替换候选定义；不得把 CI、历史规则或日更结果直接解释为收益验证或调参许可。 |
| P3 | `UsEquitySnapshotPipelines` | v5 的纯 synthetic 端到端证据链及其日更控制器都已通过 CI。计划任务只会对 `ACCEPTED` 的 v5 P1 根运行同一条 offline/no-order replay，并在同一短期前缀写健康与脱敏终态记录；当前尚无计划运行结果。 | 只允许产生同一 non-live 证据；不得变成 paper、shadow、live、部署、promotion 或策略参数变更。 |
| P4 | `QuantRuntimeSettings`（控制契约） | 自动 paper 的风险控制契约已实现；没有已签 policy、独立 paper 身份或 broker adapter。 | 接入独立 Alpaca paper gateway；每周期先验签、验证 P1/P2/P3 绑定与对账，异常自动停车。 |
| P5 | `QuantRuntimeSettings`（控制契约） | 自动 shadow 的风险控制契约已实现；没有已签 policy 或 shadow ledger scheduler。 | 接入无 broker 写权限的 shadow ledger；每周期先验证 P3 绑定与对账，异常自动停车。 |
| P6 | `NO_DRIVER_PARKED` | 没有 live、账户、订单或资金任务定义。 | 任何 live 启用均需用户的明确决定；不得由 driver、主控会话或 AI 自行创建。 |

## 策略、组合和插件：横向产品层

P0–P6 是每个研究候选从控制、输入、策略、证据到执行的**生命周期**，不是“只允许单策略”的产品目录。单策略、组合策略和策略插件都属于 Quant 的主线，但每一个准备运行的候选都必须有自己的 P1 输入绑定、P2 冻结配置和 P3 证据，不能继承另一个候选已经得到的结论。

- **单策略**：例如当前日更的 `tqqq_core_only_p2_v5`。它是此刻唯一接入日更 P1/P3 控制器的候选。
- **组合策略**：各域已有独立的组合策略仓库和配置目录；运行配置也支持标记 `combo=true`、`combo_mode=dynamic`。但一个组合不是把若干单策略结果相加：它必须单独冻结成“组合候选”，明确成分策略版本、权重/再平衡规则、共同数据截止日、组合级风险和成本，然后从 P1/P2/P3 重新走证据链。
- **策略插件**：运行配置已有版本化 plugin mount（例如市场状态信号）的接口。插件只是候选的受约束输入或保护组件；它必须写进该候选的配置/证据，不能在运行中悄悄改参数、替换策略或绕过 P3。当前 TQQQ 日更链不挂载任何插件，也不执行任何组合策略。

因此，组合与插件在全局规划中是 P2 策略产品层的并行分支，而不是 P4/P5/P6 的捷径。下一条组合/插件研究线应先建立一个独立候选和 synthetic P1/P3 契约；在此之前，`NO_DRIVER_PARKED` 仍适用于它的 paper、shadow 和 live 阶段。

## 自治运行策略是独立门槛

无人值守并不表示没有授权边界。当前 P1/P3 的个人日更研究边界已由 `tqqq_core_only_p2_v5` 的不可变候选配置和日更控制器实现，不要求逐次人工点击。未来 **paper、shadow** 可在各自当前、可验证、精确匹配的 `PREAUTHORIZED_AUTONOMY` 策略实现后无人值守运行；当前尚未实现。**live** 永远还需用户的明确启用决定。driver、主控会话、自动化审计、兼容性检查或本文本身均不能自行签发、扩大、续期或修改这些边界。

AI 只做监测、研究候选生成、证据验证、受限的文本诊断和发布资格评估，不读取或传递凭证、直接提交订单、重置熔断、修改策略根或风险上限。P1 的 GitHub Actions 控制器在受限环境中使用其配置的密钥，但这不把密钥暴露给 AI，也不授予订单能力。任何未来执行服务必须在独立风控边界内运行；当前政策不启用 paper、shadow、账户、订单、资金或 P4–P6。

## 审计控制面

- **AIAuditBridge** 是当前审计控制面；审计输出只构成确定性策略/证据门槛的输入，不构成运行或 promotion 批准，也不能放宽任何控制。
- **CodexAuditBridge** 已退役。不得为它新增工作流、任务、状态入口或授权路径。

## 当前实现登记（防止把设计、草稿和运行混为一谈）

下表是本文件截至 `2026-08-20` 的实现口径。`已接线` 仅表示代码/工作流已合并并具备明确接口，不替代当天运行结果；`草稿` 不得被控制台或其他文档说成已上线。

| 切片 | 状态 | 事实边界 |
| --- | --- | --- |
| P0 授权状态与统一控制台 | 已接线（只读） | Worker 可汇总来源候选快照；它不是执行网关，也不签发 P1–P6 权限。 |
| P1–P3 TQQQ 日更研究 | 已接线，待计划运行证据 | 工作流只做数据身份、冻结研究和 offline/no-order P3；缺失输入只会延期/停车。 |
| 脱敏 P3 绩效观察 | 已接线 | 终态 P3 才发布有限期 artifact；不含 raw bars、账户、订单或凭据。 |
| AI 持续观察与诊断 | 已接线（受限、non-live） | AIAuditBridge 只在两次可比较、已绑定 P1/P2/P3 摘要的观察后创建/更新 Issue 与任务。对每个尚未诊断的 Issue，计划 watcher 每次最多调用一次只读 AI 文本诊断并回写同一 Issue；它不执行实验、不改系统。普通策略退化不通知人；数据/证据不可用、熔断或记录失败才经去重运维通道升级通知。 |
| `qsl.research_task.v1` 与控制台队列 | 已接线（只读），待首份合格真实来源快照 | AIAudit Watcher 以专用 token 向控制台发布来源摘要；来源和控制台会各自复核 SHA、revision、摘要和 no-order authority。空队列不是故障，也不能由 Issue 推断任务。 |
| P2 v2 / P3 v2 候选 | 草稿 | 未合并或未绑定日更 driver 前，当前 P3 仍使用冻结 v1 路径。 |
| P4 / P5 风险控制契约 | 已实现，未接线 | 只校验受限自动运行边界；没有网络、账户、订单或资金能力。 |
| P4 / P5 执行 | 未实现 | 无 paper adapter、shadow ledger、账户、订单或资金任务。 |
| P6 | 未实现 | 无 live、账户、订单或资金任务。 |
| `QuantStrategyLifecycle` 本机目录 | 退役/孤立 | 没有对应的 GitHub 主线仓；其中 autopilot/auto-approve 描述不得作为当前能力或设计依据。 |
| `CodexAuditBridge` 本机目录 | 退役/孤立 | 当前有效审计仓是 `AIAuditBridge`；不得接入任何新工作流。 |

因此目前唯一的自动闭环是“观察 → 记录/告警 → 受限研究任务 → 一次只读研究诊断”，不是“观察 → 自动调参/自动改代码/自动交易”。诊断失败只保留现有 Issue 作为下一次计划运行的审计起点，不能触发替代动作。任何文档若与本表相冲突，应标记为历史或草稿，而不是扩大当前系统能力。

## 内部依赖：必须分开报告的两种口径

| 口径 | 要回答的问题 | 不能说明什么 |
| --- | --- | --- |
| **matrix current** | 当前已检出的 consumer manifests 是否与 `internal_dependency_matrix.json` 的 tracked pins 一致，是否有 ref 漂移或未追踪内部依赖。 | 不证明仓库选择的兼容 bundle 正确，也不证明运行或 promotion 合格。 |
| **qslctl bundle drift** | consumer 的声明 bundle、tier/ring 与 manifests 是否符合 `compat/bundles/` 定义的兼容性契约。 | 不替代 matrix 的当前快照/生成检查，也不证明运行或 promotion 合格。 |

两种检查不能互相替代或合并成一个“健康”结论：matrix current 通过时仍可能偏离选定 bundle；bundle drift 通过时仍应单独确认 matrix 是否反映当前 manifests。报告必须分别记录命令、工作区完整性、结果和证据日期。

常用只读检查示例：

```bash
python3 python/scripts/check_internal_dependency_matrix.py --projects-root /path/to/prepared-workspace --strict
python3 python/scripts/qslctl.py check --repo-root /path/to/consumer-repo
```

`/path/to/...` 只是可移植占位符，不表示本地路径、已检出工作区或已部署目标。

## 已知证据边界

- `2026-08-03`：旧历史指针曾引用一次 P0–P6 canonical 文档日期；其个人机器路径已废弃，不能据此证明当前运行或授权状态。
- `2026-08-15`：`compat/bundles/2026.08.0.toml` 记录该 compatibility bundle 的创建日期。
- `2026-08-17`：`UsEquitySnapshotPipelines` 合并 TQQQ P1–P3 non-live workflow；同日一次手动运行的 P1 历史输入获取、完整性验证和私有上传成功，P3 验证下载后 `PARKED`。该历史技术结果不表示策略验收或任何 promotion 已获批准。
- `2026-08-19`：只读复核确认上述 P1 根的原始数据按既有短期保留规则自动到期；未复制、延长或删除该数据。P3 停车时的精确内部原因未被持久化，因此不得事后臆造为策略结论。
- `2026-08-19`：`UsEquitySnapshotPipelines` 合入 P2 v4 / P3 pure-synthetic 证据链；其 PR 与 main CI 均通过。该结果只证明冻结候选的离线链路可重复验证，不是使用真实行情的 P3 成功，也不是策略表现、paper、shadow 或 live 资格。
- `2026-08-19`：`UsEquitySnapshotPipelines` 合入 P2 v5 滚动输入/证据契约（PR #320）及收盘后日更 P1/P3 non-live 控制器（PR #321）；两者 PR 与 main CI 均通过。日更控制器已就绪但尚无计划运行结果，因此不据此声称已读到新的 Alpaca 数据、P3 表现结论、paper、shadow 或 live 资格。
- `2026-08-19`：6 个 Quant GCP 项目各创建一把 `EC_SIGN_P256_SHA256` 的 software-protected 公共 P0 root，逐把重新读取 key version 与 PEM 后校验通过；没有授予 signer IAM、没有签发 active policy，也没有修改运行服务。详见下方部署记录。
- `2026-08-12`：`docs/QUANT_ROADMAP.md` 被标记为历史指针，历史正文应从 Git history 读取。
- 上述仓内记录只支撑文档、兼容性和协作边界；不支撑账户、密钥、私有位置或任何未重新读取的部署状态。

相关仓内资料：[统一决策平台架构 V1](qsl_unified_control_console_architecture_v1.zh-CN.md)、[自治运行策略 V2](qsl_autonomous_operating_policy_v2.zh-CN.md)、[确定性执行网关 V1 设计](qsl_deterministic_execution_gateway_v1.zh-CN.md)、[GCP P0 控制根部署记录](qsl_gcp_p0_control_root_deployment_v1.zh-CN.md)、[组织架构与检查口径](qsl_org_architecture.md)、[内部依赖 pin 政策](internal_dependency_pin_policy.zh-CN.md)、[2026.08.0 compatibility bundle](../compat/bundles/2026.08.0.toml)。
