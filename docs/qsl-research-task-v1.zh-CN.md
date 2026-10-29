# QSL 研究任务契约 V1

`qsl.research_task.v1` 是 AI、Watcher 与策略仓之间的最小实验任务单。它只描述一个有证据绑定、有限次数与有限时长的离线研究请求；它不是激活、部署、paper、shadow 或 live 指令。

任务必须固定绑定候选身份、策略 revision、P1/P2/P3 摘要 digest 和生成该摘要的 producer revision。实验只可写明研究目标、假设、参数边界 digest、最大运行次数和最大时长；不携带原始行情、参数正文、账户、券商、订单、资金、凭证或 URL。

固定 authority 为：

- `research_only=true`
- `no_order=true`
- `size_zero_required=true`
- `p4_p5_p6_authorized=false`

因此 AI 可以创建、诊断和验证研究候选，但不能借任务契约扩大任何运行权限。P4/P5 仍需要各自独立的自动化策略；P6 始终需要所有者明确决定。

实现与 fail-closed 校验见 `python/scripts/research_task_contract.py`；JSON Schema 位于 `schemas/qsl-research-task.v1.schema.json`。

## 统一控制台的只读投影

控制台最终应把研究任务作为**独立于候选生命周期**的只读队列显示。候选由策略/流水线来源拥有；Watcher 只拥有它创建的任务。因此不能把任务伪装成另一条同名候选，也不能让任务来源覆盖 P1/P3 证据来源。

队列摘要只需要显示：`task_id`、任务类型、候选身份和 revision、创建时间、P1/P2/P3 digest 的短摘要、实验上限、固定 authority 与只读审计事件。详情页可比较两个已经验证的脱敏表现观察，但不得复制原始 bars、参数正文、GCS 路径、账户、订单、资金或凭据。

`qsl_control_plane_source_snapshot.v1` 仍只承载候选状态，绝不混入研究任务。控制台改用独立的 `qsl_research_task_source_snapshot.v1` 写入来源快照，并聚合成只读的 `qsl_research_task_dashboard.v1`：

- Worker 在写入前重新核验完整的 `qsl.research_task.v1`、canonical SHA-256、候选 revision、P1/P2/P3 摘要，以及固定的 `research_only/no_order/size_zero_required` authority。
- 任务来源使用专用 `RESEARCH_TASK_SYNC_TOKEN` 和独立 KV 前缀；它不复用控制面、策略切换、OAuth、策略根或任何券商凭据。
- 任务 ID 重复于多个来源时聚合器 fail-closed，不展示冲突任务；来源过期时只显示历史/过期状态，不把它当作当前指令。

控制台 consumer 与 Watcher producer 的代码均已接线；只有 Worker 的 `RESEARCH_TASK_SYNC_TOKEN`，以及 Watcher 的 `QSL_RESEARCH_TASK_SYNC_URL` 与同值专用 secret 都已配置、部署后，Watcher 才会发布来源快照。任一项未配置时它会以 `NOT_CONFIGURED` 安全退出，空队列仍是预期且正确的状态。不能用 GitHub Issue、假数据或运行配置推断任务存在；该索引也不包含任务执行器、自动调参、代码修改、PR 合并、部署、paper、shadow 或 live 功能。
