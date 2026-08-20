# QuantStrategyLab P0–P6 主线：当前状态与 Driver 政策

> 状态：`CANONICAL_CURRENT_STATE_AND_DRIVER_POLICY`
>
> 适用范围：QuantStrategyLab 的 P0–P6 主线协作；不替代任何策略、券商或部署仓的实时证据。
>
> 已知仓内及只读运行元数据截至：`2026-08-21`。这不是 paper、shadow、live、部署或验收状态的声明。

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
| P0 | `QuantRuntimeSettings` | 自治运行策略 V2、离线验签门和仅 `RECONCILE_ONLY` 的准入代码已经存在。`binancequant`、`charlesschwabquant`、`firstradequant`、`interactivebrokersquant`、`longbridgequant`、`qslresearchquant` 已各自安装并读取核验一把公开 Cloud KMS P-256 root；没有 signer IAM、已签 policy 或接入运行服务。retired review caller 的本地清理及其受影响仓库的合并已完成；它只退役 GitHub Codex 自动 PR 审查门槛，普通 CI 仍保留，且不构成 P0 完成或运行资格。 | 仅维护和复核控制面事实；不得从 P0 推导 P1 数据获取、P4–P6 或交易资格。 |
| P1 | `UsEquitySnapshotPipelines` | TQQQ / Alpaca 主线为 **non-live**。`tqqq_core_only_p2_v5` 的日更控制器已在 `main` 通过 CI：它在美股收盘后计划窗口推导最近完整 XNYS session、获取四只 ETF 的候选绑定输入并做完整性/健康检查。`2026-08-20` 首次计划任务产生 `DEFERRED`，未形成 v5 P1 root；同次脱敏来源快照已发布。SOXL/SOXX 已有纯三资产 P1 数据身份契约（`SOXL`、`SOXX`、`BOXX`）和本地、注入 provider 的 P1 publisher：它固定 Alpaca SIP、adjustment=all 与 `exchange-calendars 4.13.2/XNYS`，逐资产验证完整 session 覆盖，并仅在本地三文件 root 全部校验后原子发布。它尚未取得真实 SOXL P1 root，也没有 scheduler 或云端持久化。日更即时结果以控制台来源快照为准，而不是本文；`2026-08-17` 的旧 v1 手动历史根已按短期生命周期到期。 | 只允许按 v5 固定候选产生数据身份、健康记录和短期私有根；缺失/无效输入只能 `DEFERRED`/`QUARANTINED`，不得换源、补洞或改参。SOXL 不得复用 TQQQ 或旧九资产 Gateway 输入。 |
| P2 | `UsEquitySnapshotPipelines` | `tqqq_core_only_p2_v5` 是当前唯一可运行的日更研究候选：它固定 `UsEquityStrategies` 的公开 research adapter、revision、运行参数、共同可用资产和成本，并仅让已验证 P1 截止日滚动 252-session OOS 窗口。v4/v3 只保留为 synthetic/历史依据，不能绑定新的日更输入。SOXL/SOXX 的 `soxl_soxx_core_only_p2_v2` 已冻结为独立 research-only/no-order 候选：只保留策略本体的 SOXX 趋势和内部波动降杠杆，显式关闭收益层、期权、AI、外部市场状态和波动保留策略；它还不是日更候选。观察标识 `tqqq_core_only_p2_v6_plugin_observe` 已具备 QQQ close-only 信号生产器及观察契约：固定 v5 基线、P1 身份、QSP 代码/配置 hash 和 `signal.v2` 身份；它不是新的策略候选，不能调用策略或改变目标。 | 只允许冻结、复核或替换候选定义；不得把 CI、历史规则或日更结果直接解释为收益验证或调参许可。 |
| P3 | `UsEquitySnapshotPipelines` | v5 的纯 synthetic 端到端证据链及其日更控制器都已通过 CI。计划任务只会对 `ACCEPTED` 的 v5 P1 根运行同一条 offline/no-order replay，并在同一短期前缀写健康与脱敏终态记录；`2026-08-20` 的 P1 为 `DEFERRED`，因此 P3 正确跳过，尚无 v5 日更完整证据。同日 P3 recovery 控制器只完成一次 metadata-first 规划，因无合格的既有失败根而跳过恢复；它没有重新获取或复制数据。v6 的 strict seam 先验证本地 v5 P1 root，再从同根 QQQ bars 独立重算信号、配置和 QSP 模块 hash；任一不一致即 `PARKED`，并证明 observer targets 与 v5 targets 相同。日更控制器仅在 v5 P3 完成及绑定 forward observation 存在时调用它，成功后只上传 35 天的脱敏 Actions artifact；不写 GCS、不发布控制台。SOXL 已有独立、状态化 P3 replay 基础能力，以及 P1 bars→context materializer、固定三折/252-session OOS/5-10-15 bps evidence plan、指标/哈希摘要和本地离线总入口；它们都在精确冻结的 `UsEquityStrategies` source/runtime 中运行并保持指标/哈希输出。SOXL P1 publisher 已能在发布前验证完整 XNYS 覆盖，但尚未取得真实 P1 root，也没有非交易 scheduler 或脱敏 evidence 持久化；不得把本地链路称为历史表现、paper、shadow 或 live 资格。它必须继续与 TQQQ 的既有锁定运行时隔离。 | 只允许产生同一 non-live 证据；不得变成 paper、shadow、live、部署、promotion 或策略参数变更。 |
| P4 | `QuantRuntimeSettings`（控制契约） | 自动 paper 的风险控制契约已实现；没有已签 policy、独立 paper 身份或 broker adapter。 | 接入独立 Alpaca paper gateway；每周期先验签、验证 P1/P2/P3 绑定与对账，异常自动停车。 |
| P5 | `AlpacaPlatform`（无 broker gateway） | 自动 shadow 的风险控制契约已实现；`AlpacaPlatform` 已有纯 create-only shadow ledger、v2 输入适配器和无副作用的 shadow cycle controller，`UsEquitySnapshotPipelines` 已能从同根 P1/P3 状态生成绑定的 P2 v5 forward observation。controller 在缺少或无效前置条件时只产生结构化 `PARKED`，条件齐全时只在内存返回待持久化的虚拟回执。没有已签 P5 policy、工件读取/写入适配器、真实日更 scheduler 或真实 shadow receipt。 | 由独立 policy gate 验签并生成最小授权输入后，接入无 broker 写权限的受限 scheduler 与 create-only receipt writer；每周期先验证 P1/P2/P3 绑定与前次账本对账，异常自动停车。 |
| P6 | `NO_DRIVER_PARKED` | 没有 live、账户、订单或资金任务定义。 | 任何 live 启用均需用户的明确决定；不得由 driver、主控会话或 AI 自行创建。 |

## 策略、组合和插件：横向产品层

P0–P6 是每个研究候选从控制、输入、策略、证据到执行的**生命周期**，不是“只允许单策略”的产品目录。单策略、组合策略和策略插件都属于 Quant 的主线，但每一个准备运行的候选都必须有自己的 P1 输入绑定、P2 冻结配置和 P3 证据，不能继承另一个候选已经得到的结论。

为避免把“可复用流程”误写成“共用策略”，`UsEquitySnapshotPipelines` 的多策略研究 Driver 目录只登记每条路线自己的 P1 输入契约、P2 配置摘要、P3 入口和迁移状态：TQQQ 是已接日更研究的样板，SOXL/SOXX 已有新的 P2 v2、P1 数据身份契约、完整 XNYS 覆盖的本地 P1 publisher、P1 bars→context materializer、固定 evidence plan、指标/哈希摘要和离线 P3 总入口，但仍是待取得真实 P1 root、日更证据持久化与 scheduler 的迁移路线。这个目录不调用任何路线，也不让 SOXL 继承 TQQQ 的数据、参数、证据或权限。

- **单策略**：例如当前日更的 `tqqq_core_only_p2_v5`。它是此刻唯一接入日更 P1/P3 控制器的候选。
- **组合策略**：各域已有独立的组合策略仓库和配置目录；运行配置也支持标记 `combo=true`、`combo_mode=dynamic`。但一个组合不是把若干单策略结果相加：它必须单独冻结成“组合候选”，明确成分策略版本、权重/再平衡规则、共同数据截止日、组合级风险和成本，然后从 P1/P2/P3 重新走证据链。`UsEquityStrategies` 的纯组合风险预算，以及 `MarketSignalSources` 的时点成分股和历史价格面板契约已经存在；组合 P1 的只读元数据绑定、P2 的冻结候选描述符和 P3 的脱敏证据索引契约也已经合入。它们仍只是防幸存者偏差、复权/成本假设和组合敞口的研究地基：尚没有已验证的组合 P1 原始输入、真实组合 P3 replay 或任何 P4–P6 资格。
- **策略插件**：运行配置的旧 plugin mount 已退役；新插件只能是候选受约束、可复算信号。策略在冻结配置中决定如何消费，插件不能在运行中悄悄改参数、替换策略、改写仓位或绕过 P3。AI 黑盒结论仅可走人工通知/研究建议路径，不能作为插件或策略输入。`QuantStrategyPlugins` 已有 `qsl.strategy-plugin-signal.v2` envelope 和 QQQ close-only 观察生产器；UESP 的 TQQQ v6 会从同一已验证 P1 root 重算该信号，并在 v5 P3 完成时保留 35 天脱敏观察 artifact。它仍没有日更候选注册、策略调用或任何 P4–P6 资格。当前 TQQQ 日更链不挂载任何插件，也不执行任何组合策略；这里的 v6 仅是验证后记录，绝不构成策略消费。

旧运行设置曾按策略名称自动挂载 `latest_signal.json`；该行为现已退役为安全的空操作，不能再把旧插件 artifact 推断为当前候选输入。[策略插件契约 V2](qsl_strategy_plugin_contract_v2.zh-CN.md) 只定义后续实施边界：它不是已接线的 plugin runtime，也不改变当前 TQQQ v5、P4、P5 或 P6 状态。

因此，组合与插件在全局规划中是 P2 策略产品层的并行分支，而不是 P4/P5/P6 的捷径。下一条组合/插件研究线应先建立一个独立候选和 synthetic P1/P3 契约；在此之前，`NO_DRIVER_PARKED` 仍适用于它的 paper、shadow 和 live 阶段。

## 资本、仓位、组合与熔断：当前能力矩阵

成熟量化架构应把“市场信号”“策略目标”“组合分配”“账户级风险约束”和“订单执行”分开。它们的推荐顺序是：

```text
P1 可验证输入 → research signal（可选）→ 单策略 P2 目标
    → 组合 P2 分配 → 独立风险/熔断网关 → 确定性执行服务 → 券商
                                  ↑
                         AI 只能在链外观察、告警和提出研究候选
```

这不是新的运行链路，而是本组织后续接线必须遵守的职责边界。任何层都不能跳过后面的风险层直接写入券商；组合层也不能把一个单策略或插件的回测结论扩大为组合或账户级结论。

| 能力 | 当前可验证状态 | 当前不能做什么 | 后续进入主线的条件 |
| --- | --- | --- | --- |
| 单策略目标仓位 | 各研究策略能在冻结 P2 配置中计算目标权重；例如 TQQQ 的趋势/内部波动降风险属于策略本体。 | 不是账户级仓位管理，不能读取账户、下单或自行改变 P2 配置。 | 对该候选完成自己的 P1 输入绑定与 P3 重算，才可作为 P4/P5 的候选输入。 |
| 组合风险预算 | `UsEquityStrategies` 已有纯计算的 `portfolio_risk_budget`；组合 P1 元数据、P2 描述符和 P3 脱敏索引契约已实现。 | 不读取行情/账户，不生成订单，也没有真实组合 P1 root、P3 replay、paper、shadow 或 live。 | 单独冻结成组合候选，明确成分版本、权重、再平衡、共同截止日、成本和组合级风险；再独立走 P1–P3。 |
| 账户级仓位/敞口上限 | P0 的 `risk_control` 可把不可变风险摘要绑定进许可链；P4/P5 风险控制契约可做离线校验。 | 尚未读取真实账户，也未实际执行总仓位、单标的、杠杆、日损失或订单频率上限。 | 在独立执行风控网关中实现确定性上限和每周期对账；其身份必须与 AI、网页和 GitHub Actions 隔离。 |
| 熔断 | 已有 `RECONCILE_ONLY`（零新增风险）准入和 P4/P5 的 fail-closed 契约；数据、证据、对账或未知执行结果异常时，设计默认 `PARKED`。 | 没有已接券商的真实熔断器，不能声称会自动拦截或平仓。 | 网关接线后，先只实现“停止新增风险”；自动减仓/平仓必须是独立、预先编码且可回放的规则。 |
| 凯利公式 | 当前主线没有启用凯利仓位公式，也没有把它作为组合或账户风险控制。 | 不允许用历史最佳收益、AI 判断或单策略胜率直接放大资金。 | 若研究引入，只能作为一个新的、保守的分数凯利研究候选：须使用 OOS 统计和不确定性折减，并受组合相关性、流动性、最大仓位、回撤与熔断硬上限约束；仍要走 P1–P3，不能绕过风险网关。 |

因此，P0、P4、P5 的控制契约未来可被多个策略/组合复用；但每个**准备运行的策略或组合候选**仍各自需要 P1 输入、P2 冻结和 P3 证据。可复用的是安全流程，不是收益结论、数据、参数或运行资格。

### 外部成熟设计参考（非运行证据）

- [QuantConnect Algorithm Framework](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/overview) 将 Alpha/信号、组合构建、风险管理和执行明确分层；本主线采用同样的职责切分，但不引入其运行时。
- [QuantConnect Live Reconciliation](https://www.quantconnect.com/docs/v2/writing-algorithms/live-trading/reconciliation) 说明回测与实际执行会因状态、券商能力和成交现实而偏离，因此 P3、paper/shadow 和未来执行网关都必须保留对账边界。
- [Federal Reserve SR 11-7](https://www.federalreserve.gov/boarddocs/srletters/2011/sr1107a1.pdf) 的模型风险管理原则强调概念合理性、结果分析和持续监控；这里将其按个人部署比例化为：冻结候选、独立重算、持续观察和异常停车。
- [Alpaca 对 paper 与 live 差异的说明](https://docs.alpaca.markets/docs/paper-trading) 提醒纸面成交不覆盖市场冲击、延迟滑点和排队位置；所以 paper 是执行通道证据，不是 live 的自动替代授权。

## 自治运行策略是独立门槛

无人值守并不表示没有授权边界。当前 P1/P3 的个人日更研究边界已由 `tqqq_core_only_p2_v5` 的不可变候选配置和日更控制器实现，不要求逐次人工点击。P5 已具备纯账本、前置 forward observation 和无副作用 controller；在其当前、可验证、精确匹配的 `PREAUTHORIZED_AUTONOMY` 策略、受限工件适配器与 scheduler 接线后可无人值守运行。P4 仍未接入；**live** 永远还需用户的明确启用决定。driver、主控会话、自动化审计、兼容性检查或本文本身均不能自行签发、扩大、续期或修改这些边界。

P4 不是跨平台一刀切的必经关卡：paper 是目标平台与独立适配器都存在时的自动证据通道；没有 paper 的目标持续进行 P5 shadow，而不是被误报为失败。同一策略在另一平台已有 paper/live 历史，只能作为该平台的执行证据，不能自动迁移为新目标的授权。未来满足精确策略、数据、目标执行证据时，控制台最多提示 `P6_LIMITED_LIVE_CANARY_DECISION_REQUIRED`；当前没有该 P6 driver、账户、订单或资金实现。

AI 只做监测、研究候选生成、证据验证、受限的文本诊断和发布资格评估，不读取或传递凭证、直接提交订单、重置熔断、修改策略根或风险上限。P1 的 GitHub Actions 控制器在受限环境中使用其配置的密钥，但这不把密钥暴露给 AI，也不授予订单能力。任何未来执行服务必须在独立风控边界内运行；当前政策不启用 paper、shadow、账户、订单、资金或 P4–P6。

## 审计控制面

- **AIAuditBridge** 是当前审计控制面；审计输出只构成确定性策略/证据门槛的输入，不构成运行或 promotion 批准，也不能放宽任何控制。
- **CodexAuditBridge** 已退役。不得为它新增工作流、任务、状态入口或授权路径。
- GitHub 上的 Codex 自动 PR review caller 和对应必经状态已退役；保留普通 CI、分支保护和确定性测试。此项变更不禁用 GitHub 集成，也不把 AI 诊断变成可阻塞的合并审批。

## 当前实现登记（防止把设计、草稿和运行混为一谈）

下表是本文件截至 `2026-08-20` 的实现口径。`已接线` 仅表示代码/工作流已合并并具备明确接口，不替代当天运行结果；`草稿` 不得被控制台或其他文档说成已上线。

| 切片 | 状态 | 事实边界 |
| --- | --- | --- |
| P0 授权状态与统一控制台 | 已接线（只读） | Worker 可汇总来源候选快照；它不是执行网关，也不签发 P1–P6 权限。 |
| P1–P3 TQQQ 日更研究 | 已接线，已有一次 `DEFERRED` 来源记录，待 `ACCEPTED`/P3 完整证据 | 工作流只做数据身份、冻结研究和 offline/no-order P3；缺失输入只会延期/停车；实时状态只从控制台来源快照读取。 |
| TQQQ P2 v6 plugin observe 契约 | 已接线，待首个合格日更记录 | 只在已完成的 v5 P3 与其绑定 forward observation 后，对同一已验证 P1 root 的 QQQ bars 重算 close-only signal、配置和 QSP 模块 hash，并验证 observer targets 与 v5 targets 相同；成功时仅保留 35 天脱敏 Actions artifact。没有 GCS/control-plane 写入、策略调用或 P4–P6 资格。 |
| 多策略 P1–P3 Driver 目录 | 已接线（描述层） | TQQQ 标为已接日更研究；SOXL/SOXX 的新 P2 v2、P1 数据身份契约、完整 XNYS 覆盖的本地 P1 publisher、本地 materializer、固定 evidence plan、隔离 stateful replay、指标/哈希摘要及离线总入口均已登记，仍标为 `MIGRATION_REQUIRED`：尚缺真实 P1 root、非交易 scheduler 和脱敏 evidence 持久化。旧固定截止日/九资产 Gateway 研究只保留为历史上下文，不能接入新路线。目录不调度、不获取数据、不调用插件或策略，且不授予 P4–P6。 |
| 组合 P1 输入元数据契约 | 已实现，未运行 | 只绑定历史输入的摘要、截止日、PIT/成本声明与候选身份；不读取原始行情、不获取数据，也不构成组合 P1 root。 |
| 组合 P2 冻结候选描述符 | 已实现，未运行 | 描述成分策略版本、权重/再平衡、组合风险和 P1 摘要绑定；不调参、不生成交易目标。 |
| 组合 P3 脱敏证据索引 | 已实现，未运行 | 只允许写入与同一短期输入生命周期绑定的摘要索引；没有真实历史 replay、收益结论或 promotion。 |
| 脱敏 P3 绩效观察 | 已接线 | 终态 P3 才发布有限期 artifact；不含 raw bars、账户、订单或凭据。 |
| AI 持续观察与诊断 | 已接线（受限、non-live） | AIAuditBridge 只在两次可比较、已绑定 P1/P2/P3 摘要的观察后创建/更新 Issue 与任务。对每个尚未诊断的 Issue，计划 watcher 每次最多调用一次只读 AI 文本诊断并回写同一 Issue；它不执行实验、不改系统。普通策略退化不通知人；数据/证据不可用、熔断或记录失败才经去重运维通道升级通知。 |
| `qsl.research_task.v1` 与控制台队列 | 已接线（只读），待首份合格真实来源快照 | AIAudit Watcher 以专用 token 向控制台发布来源摘要；来源和控制台会各自复核 SHA、revision、摘要和 no-order authority。空队列不是故障，也不能由 Issue 推断任务。 |
| P5 forward observation、v2 input adapter、shadow ledger 与 pure controller | 已接线，未激活 | UESP 从验证过的同根 P1/P3 状态调用冻结 P2 v5 public adapter，输出只含摘要和虚拟权重的 forward observation；AlpacaPlatform 再将它与相同 bundle、`SHADOW` 风险摘要和未过期的 KMS policy-gate receipt 组成 v2 input，并 create-only 地构造链式虚拟账本 receipt。pure controller 只汇总本地前置条件：缺失时 `PARKED`，完整时返回未持久化回执。没有 broker、账户、订单、资金、云端写入或已部署 scheduler。 |
| P4 / P5 风险控制与 policy-gate receipt 契约 | 已实现，未接线到运行 | 可离线校验受限自动运行边界，并把一次成功的 KMS 验签投影为无敏感字段的短期 receipt；没有网络、账户、订单或资金能力。 |
| P4 执行与 P5 实际调度/回执持久化 | 未实现 | 无 paper adapter、已签 active policy、已签发的运行 receipt、受限工件读取/写入 adapter、已部署 scheduler 或真实日更 shadow receipt。 |
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
- `2026-08-19`：`UsEquitySnapshotPipelines` 合入 P2 v5 滚动输入/证据契约（PR #320）及收盘后日更 P1/P3 non-live 控制器（PR #321）；两者 PR 与 main CI 均通过。
- `2026-08-20`：首次 v5 计划任务完成：P1 如实记录 `DEFERRED`，P3 因无 `ACCEPTED` P1 root 而跳过，控制台来源快照发布成功。这只证明受控延期和状态发布按设计运行；不证明已读到可用数据、P3 表现结论、paper、shadow 或 live 资格。后续每日事实必须从来源快照读取，不能靠更新本文档推断。
- `2026-08-20`：`AlpacaPlatform` 合入纯 P5 shadow ledger（PR #1）及其与冻结 P2 v5 候选名一致性修复（PR #2）；`UsEquitySnapshotPipelines` 合入 P1/P2/P3 到 P5 的纯 forward observation bridge（PR #326）。三者的 CI 均通过。它们只提供可复算、无 broker 的接线组件；没有 P5 policy、scheduler、日更运行、paper 或 live 资格。
- `2026-08-20`：P3 recovery controller 的首次计划 run 成功完成规划，`recover` job 因没有符合“一次既有 runtime 内部失败且 replay 已开始”的 P1 根而跳过；没有重跑、复制或延长任何原始数据。
- `2026-08-20`：`AlpacaPlatform` 合入 P5 v2 policy-receipt 输入适配器（PR #3）、forward-observation 适配（PR #4）与无副作用的 parked shadow-cycle controller（PR #5）。它们只把缺失/无效前置条件收敛为 `PARKED` 或返回未持久化的虚拟回执；没有部署 scheduler、工件写入、paper 或 live 权限。
- `2026-08-20`：组合研究基础合入纯组合风险预算（`UsEquityStrategies` PR #332）以及时点成分股、历史价格面板契约（`MarketSignalSources` PR #24/#25）。这些组件不获取市场数据、不运行回测，也不注册或晋级组合候选。
- `2026-08-20`：组合研究的三个连续契约相继合入：`MarketSignalSources` PR #26 的 P1 历史输入元数据绑定、`UsEquityStrategies` PR #333 的 P2 冻结候选描述符、`UsEquitySnapshotPipelines` PR #330 的 P3 脱敏证据索引。它们只使未来合格、可许可的历史组合输入能够沿同一 P1→P3 链记录证据；没有获取或读取原始数据、运行真实回测，亦不产生 P4–P6 资格。
- `2026-08-20`：`QuantStrategyPlugins` 合入 `qsl.strategy-plugin-signal.v2` 的纯本地 envelope/校验器（PR #52）及 QQQ close-only 观察生产器（PR #53）；`UsEquitySnapshotPipelines` 合入 TQQQ P2 v6 observe-only P2/P3 契约（PR #332）和 P1-root strict recomputation adapter（PR #333）。它们拒绝 `latest`、AI、仓位、订单和授权字段；v6 必须从同一已验证 P1 root 独立重算信号，不一致即 `PARKED`，并证明观察目标不偏离 v5。没有日更候选注册、持久观察记录、策略调用、scheduler 或 P4–P6。
- `2026-08-20`：`UsEquitySnapshotPipelines` 合入 v6 日更观察接线（PR #334），其 CI 全绿。它复用既有日更 P1→v5 P3→forward observation 链，不创建第二个 scheduler；仅在全部前置证据完成时重算 v6 信号并证明目标不变，成功后上传 35 天脱敏 Actions artifact。它不读取/保存额外原始数据、不写 GCS、不发布控制台、不消费策略信号，也不启用 P4–P6。尚未产生真实日更 v6 记录。
- `2026-08-20`：`UsEquitySnapshotPipelines` 合入多策略 P1–P3 Driver 目录（PR #335），其 CI 全绿。它只把 TQQQ 的日更样板和 SOXL/SOXX 的待迁移旧研究放入同一只读目录，显式记录 SOXL 不能直接调度的原因；没有抽象或替换现有策略运行器，没有数据获取、插件消费、策略调用、P4–P6 或交易行为。
- `2026-08-20`：`UsEquityStrategies` 合入 SOXL/SOXX core-only P2 v2 public research adapter（PR #335）；`UsEquitySnapshotPipelines` 随后合入冻结候选（PR #336）和三资产 P1 数据身份/manifest 契约（PR #337），相关 CI 均通过。它们不读取真实行情、凭证或云端对象，也不调度或启用 paper、shadow、live。
- `2026-08-20`：`UsEquitySnapshotPipelines` 合入 SOXL 独立 source/runtime P3 executor（PR #338）、有界多 session replay（PR #339）和状态化 next-session replay（PR #340），相关 CI 均通过。它们精确锁定 SOXL P2 的策略 source/runtime，跨期携带合成持仓并固定 5/10/15 bps 成本情景；没有读取真实行情、P1 publisher、独立 P1 bars→context verifier、固定评估窗口、完整 P3 证据包或 scheduler。它们是后续可复用 P1→P3 模板的执行基础，不是 SOXL 历史表现、paper、shadow 或 live 资格，也不能把依赖升级施加到 TQQQ 既有日更链。
- `2026-08-20`：`UsEquitySnapshotPipelines` 随后合入 SOXL P1 bars→context materializer（PR #342）、固定三折/252-session OOS/5-10-15 bps evidence plan（PR #344）、指标/哈希摘要（PR #345）和本地离线总入口（PR #346），相关 CI 均通过。它们只接收显式本地 P1 文件并复用锁定的隔离 source runtime；不会获取/发布数据、创建 P1 root、持久化证据、调度 workflow 或触及 paper、shadow、live。
- `2026-08-20`：`UsEquitySnapshotPipelines` 合入 SOXL/SOXX core-only P1 publisher（PR #348），其 CI 通过。它固定注入式 Alpaca SIP 三资产日线请求、`exchange-calendars 4.13.2/XNYS` 完整覆盖核验、canonical source/member digest 及本地 create-only root；无注入 provider 时只会 `PARKED`。它没有读取凭证、请求真实行情、写 GCS、调度 workflow 或启用 P3/P4/P5/P6。SOXL 仍缺真实 root、scheduler 和脱敏 evidence 持久化。
- `2026-08-19`：6 个 Quant GCP 项目各创建一把 `EC_SIGN_P256_SHA256` 的 software-protected 公共 P0 root，逐把重新读取 key version 与 PEM 后校验通过；没有授予 signer IAM、没有签发 active policy，也没有修改运行服务。详见下方部署记录。
- `2026-08-12`：`docs/QUANT_ROADMAP.md` 被标记为历史指针，历史正文应从 Git history 读取。
- 上述仓内记录只支撑文档、兼容性和协作边界；不支撑账户、密钥、私有位置或任何未重新读取的部署状态。

相关仓内资料：[统一决策平台架构 V1](qsl_unified_control_console_architecture_v1.zh-CN.md)、[自治运行策略 V2](qsl_autonomous_operating_policy_v2.zh-CN.md)、[确定性执行网关 V1 设计](qsl_deterministic_execution_gateway_v1.zh-CN.md)、[GCP P0 控制根部署记录](qsl_gcp_p0_control_root_deployment_v1.zh-CN.md)、[组织架构与检查口径](qsl_org_architecture.md)、[内部依赖 pin 政策](internal_dependency_pin_policy.zh-CN.md)、[2026.08.0 compatibility bundle](../compat/bundles/2026.08.0.toml)。
