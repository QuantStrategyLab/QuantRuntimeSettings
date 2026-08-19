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
| P1 | `UsEquitySnapshotPipelines` | TQQQ / Alpaca 主线为 **non-live**。`2026-08-17` 的一次手动历史链路中，P1 输入获取与私有上传成功；该短期输入已按既有生命周期到期。P2 v4 现有新的不可变输入绑定，但未获取新的观察市场数据。 | 仅生成或核查 P1 数据身份和完整性契约；任何观察市场数据获取都必须来自单独、当期的范围配置，本文不触发它。 |
| P2 | `UsEquitySnapshotPipelines` | `tqqq_core_only_p2_v4` 是唯一可运行的研究候选：它固定 `UsEquityStrategies` 的公开 research adapter 与 revision，并从所有资产共同可用的日期开始。v3 仅保留为提交历史和 v4 配置中的替代依据，不能再绑定新输入或执行回放。 | 只允许冻结、复核或替换候选定义；不得把 synthetic CI 或历史规则直接解释为收益验证。 |
| P3 | `UsEquitySnapshotPipelines` | v4 的纯 synthetic 端到端证据链已合入 `main` 并通过 CI：它验证 source/config/input 绑定、时间外窗口和证据包结构。它不包含真实行情，因而是链路验证，不是策略表现结论。历史 P3 在验证下载后 `PARKED`。 | 只允许在已有 P1 根上产生相同的 non-live 证据；不得变成 paper、shadow、live、部署或 promotion。 |
| P4 | `NO_DRIVER_PARKED` | 待核定。没有 paper 或 forward-observation 任务定义。 | 仅在出现新的、可复核的任务定义后再指定 driver。 |
| P5 | `NO_DRIVER_PARKED` | 待核定。没有 shadow 或执行服务任务定义。 | 不得由 P3、CI 或控制面配置自动推进。 |
| P6 | `NO_DRIVER_PARKED` | 待核定。没有 live、账户、订单或资金任务定义。 | 不得由任何 driver、主控会话或 AI 自行创建。 |

## 自治运行策略是独立门槛

无人值守并不表示没有授权边界。每一个 **paper、shadow、live** 运行及每一次 stage 变更，都必须处于一份当前、可验证、与该阶段精确匹配的 `PREAUTHORIZED_AUTONOMY` 策略内，并基于当次的新鲜证据。该策略是部署前设置的运行边界，不要求逐次人工点击；但 driver、主控会话、自动化审计、兼容性检查、配置存在或本文本身均不能自行签发、扩大、续期或修改它。

自治策略只允许 AI 做只读监测、研究候选生成、证据验证和发布资格评估；它禁止 AI 读取凭证、直接提交订单、重置熔断、修改策略根或修改风险上限。执行服务必须在独立风控边界内运行；此政策合约本身不启用任何账户、订单、资金或 P4–P6。

## 审计控制面

- **AIAuditBridge** 是当前审计控制面；审计输出只构成确定性策略/证据门槛的输入，不构成运行或 promotion 批准，也不能放宽任何控制。
- **CodexAuditBridge** 已退役。不得为它新增工作流、任务、状态入口或授权路径。

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
- `2026-08-19`：6 个 Quant GCP 项目各创建一把 `EC_SIGN_P256_SHA256` 的 software-protected 公共 P0 root，逐把重新读取 key version 与 PEM 后校验通过；没有授予 signer IAM、没有签发 active policy，也没有修改运行服务。详见下方部署记录。
- `2026-08-12`：`docs/QUANT_ROADMAP.md` 被标记为历史指针，历史正文应从 Git history 读取。
- 上述仓内记录只支撑文档、兼容性和协作边界；不支撑账户、密钥、私有位置或任何未重新读取的部署状态。

相关仓内资料：[自治运行策略 V2](qsl_autonomous_operating_policy_v2.zh-CN.md)、[确定性执行网关 V1 设计](qsl_deterministic_execution_gateway_v1.zh-CN.md)、[GCP P0 控制根部署记录](qsl_gcp_p0_control_root_deployment_v1.zh-CN.md)、[组织架构与检查口径](qsl_org_architecture.md)、[内部依赖 pin 政策](internal_dependency_pin_policy.zh-CN.md)、[2026.08.0 compatibility bundle](../compat/bundles/2026.08.0.toml)。
