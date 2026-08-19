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
- driver 可做只读核查、实现自治策略允许的局部变更及产出可复核证据；不得自行把工作标为 promotion、部署或运行授权。
- 主控会话、AI 审计或策略生成不能自行签发、延长或修改自治策略。任何未被当前证据支持的状态一律记为待核实，而非推断完成。

## P0–P6 当前主线

| 阶段 | 当前可携带状态 | 边界 |
| --- | --- | --- |
| P0 | 已完成 21 个 retired review caller 的本地清理，待各仓独立提交、CI 与合并；自治运行策略 V2 已有外部签名策略的验签门。`binancequant`、`charlesschwabquant`、`firstradequant`、`interactivebrokersquant`、`longbridgequant` 已各自安装并读取核验一把公开 Cloud KMS P-256 root；没有 signer IAM、已签 policy 或接入运行服务。 | 仅清理、复核和记录可验证的控制面后续项；不因此推导运行资格。 |
| P1–P3 | TQQQ / Alpaca 主线为 **non-live**；`2026-08-17` 的一次手动历史链路中，P1 输入获取与私有上传成功，P3 在验证下载后 `PARKED`。 | 这只说明一次历史研究链路的技术结果，不是策略通过、paper、shadow、live、部署或 promotion 授权。后续工作只能继续准备、核查或产生 non-live 证据。 |
| P4–P6 | 待核定。 | 本文不臆造其具体范围、顺序、目标、验收条件或完成度；主控会话须先取得新的可复核任务定义。 |

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
- `2026-08-19`：5 个已计费的券商运行 GCP 项目各创建一把 `EC_SIGN_P256_SHA256` 的 software-protected 公共 P0 root，逐把重新读取 key version 与 PEM 后校验通过；没有授予 signer IAM、没有签发 active policy，也没有修改运行服务。`qslresearchquant` 未关联 billing account，保持未初始化。详见下方部署记录。
- `2026-08-12`：`docs/QUANT_ROADMAP.md` 被标记为历史指针，历史正文应从 Git history 读取。
- 上述仓内记录只支撑文档、兼容性和协作边界；不支撑账户、密钥、私有位置或任何未重新读取的部署状态。

相关仓内资料：[自治运行策略 V2](qsl_autonomous_operating_policy_v2.zh-CN.md)、[确定性执行网关 V1 设计](qsl_deterministic_execution_gateway_v1.zh-CN.md)、[GCP P0 控制根部署记录](qsl_gcp_p0_control_root_deployment_v1.zh-CN.md)、[组织架构与检查口径](qsl_org_architecture.md)、[内部依赖 pin 政策](internal_dependency_pin_policy.zh-CN.md)、[2026.08.0 compatibility bundle](../compat/bundles/2026.08.0.toml)。
