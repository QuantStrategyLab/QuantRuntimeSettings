# 策略切换控制台

[English](README.md)

这是个人量化系统的登录版网页控制台示例，也是统一全局决策平台的演进起点。它用 Cloudflare Worker 提供一个很薄的后端：

- 未登录或不在 allowlist：只能查看公开页面，不能触发切换。
- 已登录且 GitHub 用户名在 allowlist：可以从账号下拉框选择目标，然后点击“一键切换”，由 Worker 服务端触发 GitHub Actions workflow。
- GitHub token 只放在 Worker secret 中，不进入前端、不写入开源代码。

控制台的目标架构见 [QSL 统一决策平台架构 V1](../../docs/qsl_unified_control_console_architecture_v1.zh-CN.md)：人将从这一处查看跨仓健康、候选和需要本人决定的 P6 项；网页不会持有券商凭证或直接下单。现有“策略切换”是历史部署配置工具，不能被视为 P0–P6 运行授权。

## 数据源与交易目标

Alpaca Market Data 是美股研究输入来源；当前没有已配置的 Alpaca 交易目标。`platform-config.json` 中附加的 `alpaca` 观察标识用于兼容历史/研究证据，不生成交易账户或授予启停权限。不要因没有 Alpaca 订单心跳而报告交易故障，也不要删除该标识使已有观察记录无法读取。数据健康应由采集方按授权、时间、覆盖和实际输入结果报告。`AlpacaPlatform` 保留的 shadow/paper 契约并不表示已经部署。

IBKR Gateway 是独立的连接/会话辅助组件；QMT 是尚未配置券商执行目标的 A 股适配器。控制台按实际配置的交易目标显示账户和操作，不按仓库数量补出交易平台。

## 严格停用入口的当前边界

主操作在账号运行状态选择「停用/禁用」时进入 `/api/runtime-stop` 与 `manual-runtime-stop.yml`，不要求当前策略重新上架；登录、同源和精确已配置目标绑定仍必须成立。页面不再提供独立的“仅保存停用配置”按钮。请求只接受平台、目标名与 `STOP_ONLY` 确认，目标身份由服务端配置派生，不接受表单里的策略、风险或账户修改。

工作流仅保存并核对 GitHub 停用配置，不派发平台工作流、不进行云端认证或更新运行服务；CLI 不再提供 `--apply-platform`。`configured=true` 只表示已核对期望配置，`platform_applied=false` 表示未证明实际应用，页面应显示未知而非已停用。不调用 env-sync、不撤单、平仓或保证在途请求结束。既有 `manual-strategy-switch.yml` 的 activation apply 硬拒绝保持不变，不能把它当仅停用通道。

配置读取覆盖完整 repo/environment 分页并按真实消费者优先级选择原变量所属 scope：继承的服务 inventory 不复制到 environment；LongBridge 的 exact-service 顶层开关例外按其实际优先级处理。写入只经 stdin、零自动重试，写前/写后比对不输出变量值。与原 switch 共用平台级 workflow concurrency，避免多个目标同时覆盖共享 inventory；这不是对外部管理员写入的原子 CAS，执行期间其他配置 writer 必须停写。超时/读回不一致须核查原请求，不推断未接受后重试；两个网页入口共享 pending/unknown 锁。

### 保留的 Cloud Run 扩展（已与本配置路径断开）

下述 adapter/action、独立测试和四平台 workflow 草稿作为未发布的后续扩展保留，不属于 G07 配置入口验收前置，也不能随其自动发布。网页、控制工作流与配置 CLI 已不再调用这些文件。保留可执行文件不等于禁止其被单独手工运行；未来采用须另行明确范围和权限。

`actions/stop-cloud-run-runtime` 通过平台自有 workflow 消费既有部署身份产生的临时 access token，不落凭据文件、不额外启动 gcloud 认证。请求从 `GITHUB_EVENT_PATH` 读取，当前配置经受限 GH 客户端进程内读取，不把请求或全量 vars 放到 runner 的 env/with 日志面。云资源由实际配置和精确绑定的目标派生。平台 caller 在认证前验证身份/已保存停用，应用前再读一次；普通 action 默认只检查，写入需 `apply=true` 和 `STOP_ONLY`。

实现只发送一次带当前 etag 的窄字段 PATCH，将现有 `RUNTIME_TARGET_ENABLED` 改为 false；其他环境值、策略、账户、风险与容器配置保留。更新环境会创建新 revision，因此仅接受单容器、固定镜像 digest、数字版本的 secret 引用及全部流量跟随 latest 的稳定服务；分流/tag、活动部署、浮动镜像/secret、身份冲突或不支持的形态都拒绝，不通过广义部署来“修好”前置。保留原只读生命周期 action，不让它获得写权限。

提交后只观察同一 operation，并读回实际承接流量的 revision。冲突、超时、失败或差异保持未验证，不重试 PATCH、不回滚；成功仅说明该时点服务的标准执行开关为 false，不证明在途请求结束、所有特殊执行入口关闭、撤单、平仓或资金对账。此前 caller 贯通有 synthetic 测试，该历史结果不代表当前仅保存配置的网页路径。尚未发布 pin、运行远端 CI 或实测 Cloud Run。

扩展的历史采用前置（不是当前待办，也不是仅保存配置的前置）：
- LongBridge 只复用既有 `longbridge-paper`、`longbridge-hk`、`longbridge-sg` environment；IBKR/Schwab/Firstrade 沿既有 repository/main/WIF 边界，仅支持 repository scope，不创建名为 runtime-stop 的新审批环境。范围不匹配时不进入云端步骤；不能把跳过任务当已停用。
- 若未来另行批准采用，须使用真实已发布的 `QRT_RUNTIME_STOP_REF`，不填占位 SHA；四平台 workflow 不随当前配置入口补丁交付。可选 `RUNTIME_SETTINGS_REPOSITORY` 只供已审核的源仓选择。
- 实际 repo/environment 配置须有匹配部署的 `GCP_PROJECT_ID`、`CLOUD_RUN_REGION`；认证使用相同既有身份的 `GCP_WORKLOAD_IDENTITY_PROVIDER`、`GCP_WORKLOAD_IDENTITY_SERVICE_ACCOUNT`，不自动搬迁配置或扩大 IAM。
- 配置读取使用该平台已有 GitHub token；内置 token 若不具备 Variables/适用 Environment 只读权限，应先确认既有获准客户端，必要时经人工批准配置仅本仓只读的 `RUNTIME_STOP_CONFIG_READ_TOKEN`。不得复制全局配置写 token、错误后换凭据重试或假称权限已验证。
- 当前服务是否满足单容器、固定镜像/secret 版本和流量约束仍需一次获准读回。授权、未决请求、已发布版本及这些直接运行条件齐备后才进行有界真实验证；不借此重跑全组织审计或提前启用策略。

## 平台目录配置

- `platform-config.json` 的 `platforms` 是网站平台目录的来源：名称、标识、颜色、仓库、默认账户与能力在此配置；菜单顺序沿用配置中的平台顺序。
- 只需隐藏已接入平台时，在部署配置中修改 `STRATEGY_SWITCH_HIDDEN_PLATFORMS`（逗号分隔）；例如 `qmt` 隐藏 QMT，空字符串显示全部。隐藏不是停用交易，不删除账户或适配器。
- 修改目录后运行 `python3 python/scripts/build_platform_config.py`，通过测试后部署网站。不要手改生成的 `config.js` / `strategy_profiles_asset.js`。控制台页面是 `frontend/` 里的 React 应用。
- 前后端使用同一发布版本的目录；不再从远端 main 临时拼入平台。全新券商仍须先接入适配器及对应能力，不能只增加菜单就视为可交易。

## 操作台模型

这个页面面向低频人工介入，而不是展示交易、收益或全量运行明细：

界面采用白底、深青色强调和紧凑表格；窄屏将平台菜单横向排列，账户表格可横向滚动，并支持键盘聚焦。

- **决策与账户**是日常主页面：待确认候选、所有者决定和对账恢复事项优先，账户列表紧随其后；已完成项不占据确认区。研究候选队列读取失败明确显示不可用，不把失败当作空队列。
- 账户列表并列显示配置策略、配置开关、实际开关、调度、应用状态、记录时间和一个下一步。缺少或过期读回保持未知；开关一致但调度未知也不显示已应用。
- **策略设置**默认收起；点击账户或“复核设置”只展开并定位该账户，不保存或启用。启用/切换仍走既有主操作，停用走 `STOP_ONLY`；保存配置不证明平台已停止。插件、收入层和期权留在高级设置，选择不授予运行许可。
- 候选确认独立于策略设置：接受/拒绝只记录意向，不绑定账户、不启用 paper/live、不替换正在运行的策略。意向平台明确展示；风险档数值含义与候选编号收在详情。提交结果提示不会随设置折叠而隐藏。
- 日常页面不展示监测详情、策略健康评分或研究诊断；现有 API 与内部展示代码保留，但不向操作者开放入口，也不伪装成 AI 已自动修复。
- 管理员可在账户配置中添加可选 `runtime_status_target_id`，明确关联现有 lifecycle 来源的 `target_id`。必须同时匹配平台且一对一；未关联、重复或过期记录不会显示为正常。该字段仅影响显示，不进入交易工作流。监测通过不代表已下单或成交。
- 策略列表展示账户市场兼容的选项；查看和选择不代表获得运行许可。提交仍检查发布、运行许可和证据门槛；它不会自动改配置，也不会把健康、候选或历史 `live` 元数据解释为订单或实盘授权。

网页只记录经认证管理员提交的不可执行意图，或发起已有的受限配置工作流；它不会直接读写券商、订单、资金或 runtime 授权。

提交计划仍只会触发已有 GitHub Actions 配置流程，并写入审计记录。P4/P5/P6 或任何实盘权限仍须由独立、可验证的阶段契约决定。

## 必要配置

Worker 需要这些环境变量或 secret：

```text
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
SESSION_SECRET
RUNTIME_SETTINGS_DISPATCH_TOKEN
ALLOWED_GITHUB_LOGINS
ALLOWED_GITHUB_ORGS
STRATEGY_SWITCH_ADMIN_LOGINS
STRATEGY_SWITCH_ADMIN_ORGS
STRATEGY_HEALTH_SYNC_TOKEN
CONTROL_PLANE_SYNC_TOKEN
RESEARCH_TASK_SYNC_TOKEN
RESEARCH_PROMOTION_SYNC_TOKEN
M0_RESEARCH_SYNC_TOKEN
RECONCILIATION_RECOVERY_SYNC_TOKEN
RECONCILIATION_RECOVERY_CONTROLLER_TOKEN
```

可选：

```text
RUNTIME_SETTINGS_REPO=QuantStrategyLab/QuantRuntimeSettings
RUNTIME_SETTINGS_WORKFLOW=manual-strategy-switch.yml
RUNTIME_SETTINGS_REF=main
STRATEGY_SWITCH_PLATFORM_REPOSITORIES_JSON={"longbridge":"your-org/LongBridgePlatform","ibkr":"your-org/InteractiveBrokersPlatform","schwab":"your-org/CharlesSchwabPlatform","firstrade":"your-org/FirstradePlatform"}
STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON=<account-options.example.json 的内容>
```

Fork 用户也可以分别设置 `STRATEGY_SWITCH_LONGBRIDGE_REPO`、`STRATEGY_SWITCH_IBKR_REPO`、`STRATEGY_SWITCH_SCHWAB_REPO`、`STRATEGY_SWITCH_FIRSTRADE_REPO`。GitHub Actions workflow 侧也支持同样的映射，变量名是 `RUNTIME_SETTINGS_PLATFORM_REPOSITORIES_JSON` 或 `RUNTIME_SETTINGS_*_REPO`。

`ALLOWED_GITHUB_LOGINS`、`ALLOWED_GITHUB_ORGS`、`STRATEGY_SWITCH_ADMIN_LOGINS` 和 `STRATEGY_SWITCH_ADMIN_ORGS` 用英文逗号分隔。个人系统建议用组织名做管理员入口，例如：

```text
STRATEGY_SWITCH_ADMIN_ORGS=QuantStrategyLab
STRATEGY_SWITCH_ADMIN_LOGINS=your-github-login
```

登录入口是 Worker 域名下的 `/login`，页面顶部保留一个“登录管理”入口。登录成功后访问 `/api/session` 会返回：

```json
{
  "authenticated": true,
  "login": "your-github-login",
  "allowed": true,
  "admin": true
}
```

`admin=true` 表示该账号在 `STRATEGY_SWITCH_ADMIN_LOGINS`、`STRATEGY_SWITCH_ADMIN_ORGS`，或 KV 后台管理员名单/组织中。控制台没有 `/admin` 页面，这个地址与其它无效页面一样返回 404。登录名单、组织和账户路由仍由上述环境变量与 KV 决定。

账号配置可增加 `broker_environment: "live"` 或 `"paper"`。缺少该字段的旧配置继续兼容，但在新的研究候选接受中保持未知且不能选择。`broker_environment` 表示券商账户环境，`default_execution_mode` 仍表示 adapter 模式（`live` 或 `dry_run`）。LongBridge 支持明确的 paper 模拟账户配合 live adapter；IBKR 当前只支持 live。候选选择只记录研究意向，不会激活 adapter。

## 登录管理后台

登录方式使用 GitHub OAuth 2.0，并请求 `read:org` scope 来校验 GitHub 组织成员关系。建议把 `QuantStrategyLab` 放在 `STRATEGY_SWITCH_ADMIN_ORGS`，同时把你自己的 GitHub login 放在 `STRATEGY_SWITCH_ADMIN_LOGINS` 作为兜底管理员。

账户设置、风险偏好和审计仍写入 Cloudflare KV namespace：`STRATEGY_SWITCH_CONFIG`。Worker 会使用这些 key：

```text
auth_config
account_options
strategy_profiles
risk_profile_bindings
audit_log
strategy_health_snapshot
control_plane_snapshot
research_task_source:<source_id>
m0_research_ledger_current
m0_research_ledger_archive:<ledger_sha256>
private_binance_scope_report
```

没有绑定 KV 时，Worker 会回退读取 `ALLOWED_GITHUB_LOGINS`、`ALLOWED_GITHUB_ORGS`、`STRATEGY_SWITCH_ADMIN_LOGINS`、`STRATEGY_SWITCH_ADMIN_ORGS` 和 `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON`。这些值不在控制台页面里修改。

## 组合风险偏好（非执行意图）

管理员可在账户设置里为已配置的平台目标选择“保本优先 / 平衡复利 / 增长复利”。页面调用受同源校验和管理员权限保护的 `GET` / `POST /api/risk-profiles`，并只向 `risk_profile_bindings` 保存自校验的 `qsl.risk_profile_binding.v1` 记录；其中可移植的选择部分与核心风险合成器的 `qsl.risk_profile_selection.v1` 完全一致。

**双口径澄清**：同一偏好名称对应两套数值——Composer 相对无杠杆基准的 MDD 天花板为 `CAPITAL_PRESERVATION` 1.00 / `BALANCED_COMPOUNDING` 1.25 / `GROWTH_COMPOUNDING` 1.50；晋级 `promotion_sizing` 仓位缩放为 0.50 / 0.75 / 1.00，且只用于新晋级或材料变更，不重算旧 live，也不等于把仓位乘以 1.5。本页保存的只是偏好意图，不会自动写生产政策或改 RiskEngine。

此记录固定为 `no_order=true` 和 `execution_authority_granted=false`：它不进入 `RUNTIME_TARGET_JSON`、不改策略参数或仓位、不调度 workflow、不读写券商或云执行资源，也不能启用 paper、shadow 或 live。KV 中记录损坏时接口会返回不可用，绝不会静默回退为默认风险偏好。未来独立的只读控制面适配器只能读取其中的 `profile_selection`，仍需另外验证观察证据和完整的 P4/P5/P6 门槛。

## 只读研究任务索引

`/api/internal/sync-research-task-source` 只接受 `qsl_research_task_source_snapshot.v1`，并要求独立的 `RESEARCH_TASK_SYNC_TOKEN`。每个任务均须是 SHA-256 自校验通过的 `qsl.research_task.v1`，固定为 `research_only=true`、`no_order=true`、`size_zero_required=true`、`p4_p5_p6_authorized=false`。已登录 allowlist 用户可从 `/api/research-tasks` 读取脱敏聚合结果。

它与 `/api/internal/sync-control-plane-source` 的候选快照、策略切换 token、策略根和券商凭据完全分离。该索引只显示任务，不会运行任务、调优参数、改代码、创建/合并 PR、部署、进入 paper/shadow/live 或触碰账户与订单。

## M0 顾投研究台账入口

`POST /api/internal/sync-m0-research-ledger` 与 `GET /api/m0-research` 是顾投研究台账的
只读边界；读取端仍要求已登录的 allowlist 用户。写入端只接受专用
`M0_RESEARCH_SYNC_TOKEN`，不能复用 OAuth、策略切换、控制面、M1 Shadow、研究任务、
平台或任何券商凭据。

请求体必须是字段闭合的 `qsl_m0_research_publisher_envelope.v1`：root 固定为
`schema_version`、`producer`、`source_artifact`、`ledger_sha256` 和嵌入的
`qsl_m0_research_ledger.v1`。`producer` 固定为仓库/revision；`source_artifact` 固定为
仓库、40 位 revision、run ID、artifact ID 与 artifact SHA-256。Worker 重新以 canonical
JSON 计算并验证 `ledger_sha256`；`source_artifact.sha256` 是已认证的原始顾投 artifact
声明，故意不与派生 ledger 的 SHA-256 混为同一个值。来源仓库目前固定为
`QuantStrategyLab/QuantAdvisorResearch`，生产者仓库固定为
`QuantStrategyLab/QuantRuntimeSettings`。任何额外字段、错误摘要、未来时间、损坏台账或
越界语义都会在写入前被拒绝。发布构建器自 #310 起已经在生成端约束紧凑 UTF-8 envelope
不超过 262,144 bytes；Worker 保留同一请求体上限作为接收端边界，不另行转换或放宽该契约。

Worker 固定使用 `m0_research_ledger_current` 和由已校验 digest 派生的
`m0_research_ledger_archive:<ledger_sha256>`；调用方不能传入 KV key。若来件的
`source_artifact.sha256` 与当前记录完全相同，Worker 返回 `200` 与 `replayed: true`，且不写入
KV，用于网络重试或重复人工触发。不同 source artifact 的相同 source run ID、不同来源的重复
ledger 或时间回退仍会返回 `409`。这是基于 KV
当前记录的 **best-effort** 重放/回退保护：Cloudflare KV 不是线性一致的比较并交换存储，
并发写入仍不能被表述为强原子顺序保证。本接口不为此新增 Durable Object 或其他绑定；它的
职责仍限于 no-order 研究资料接收。current 与 archive 均使用 Cloudflare KV 的 14 天物理
TTL；KV 缺失、过期、损坏或校验失败时，读取接口只返回空的 `unavailable` no-order 结构，
绝不猜测旧研究结论。

`GET /api/m0-research` 返回字段闭合的 **`qsl_m0_research_dashboard.v1`**，而不是
`qsl_m0_research_ledger.v1`。dashboard 固定携带原始 `source_ledger_sha256`、source 的
`generated_at` / `computed_at` 和 `viewed_at`，再给出派生的 `data_status`、summary、subjects、
policy 与 errors。无可用记录时也返回同一 dashboard schema 的 `unavailable` 空结构。

dashboard 不会直接复用已存储的 `freshness`：它会在每次读取时按照每条 observation 的
`expires_at` 派生新的 `fresh/stale` 状态，并重新计算 subject 冲突、summary 和 `data_status`。
这份只读投影不会写回 KV，也不会修改 hash-bound 原始 ledger；也**不声称**仍可通过原 ledger
validator。来源已标为 stale 的观测不会因读取而被提升为 fresh。

该入口**不**调用 selector、策略目录、平台配置、dispatch、runtime、插件或券商，也不创建
研究任务。输出永远固定为 `authority=research_only`、`no_order=true` 和
`permitted_next_step=research_validation_only`；将 M0 线索转为 P1--P3 研究任务仍需独立的
证据绑定与准入流程。

管理台会在“今日待处理 / 只读”页将 M0 放在默认折叠的“研究观察”区域；它只请求
`GET /api/m0-research`。区域最多显示 100 条观察，并仅展示研究对象、状态、新鲜度、观察期、
来源置信/风格、当前周期分歧、历史失效漂移、来源摘要和本次查看时间。接口不可用、来源缺失或
数据过期时保持安全空态或历史提示，不补造结论。该区域没有写入、切换或运行控制，也不会显示
买卖、权重、策略、平台或账户信息；固定边界仍是“仅研究、无订单”。

## 文件结构

```text
frontend/
worker.js
v2_asset_map.js
wrangler.toml.example
```

`worker.js` 发布 React 控制台（`v2_asset_map.js`），并通过 `strategy_profiles_asset.js` 提供策略目录。目录由 `python3 python/scripts/build_platform_config.py` 生成。

`runtime-catalog-projection.json` 同样由 `platform-config.json` 生成，并用来源 SHA-256
防止已提交的目录资产陈旧。登录后的 `GET /api/runtime-catalog` 只返回这个**配置门禁**
投影；它不代表真实部署或交易状态。页面显示候选状态和目标执行状态时，必须分别使用
`/api/control-plane`、`/api/execution-evidence` 与 `/api/runtime-target-lifecycle`，不得回退到历史
`lifecycle-matrix.json`。其中平台运行状态仅显示已接入来源；没有实际运行入口或未发布快照的平台必须
保持“待接入”，不能被界面推断为正常或已停用。

## 每日运行读模型

`POST /api/runtime-daily/sync` 与 `GET /api/runtime-daily?date=YYYY-MM-DD` 默认关闭。只有
`RUNTIME_DAILY_READ_MODEL_ENABLED` 精确等于 `true` 才受理。POST 复用既有
`EXECUTION_EVIDENCE_SYNC_TOKEN`，普通登录会话不能写入。GET 要求登录会话，并且只读请求的那一天，
不列出历史索引。

Schwab POST 另须提供 `X-QSL-Source-Binding-ID`，直接复用受保护 account-facts binding 的
64位小写十六进制 `source_binding.id`。每次请求均与当前解析的 registry 核对，包括新业务日首次写入和
幂等请求；缺失/格式错误返回400，不匹配返回409，错误不回显期望或实收ID。重复合并header拒绝；
body自报字段或旧缓存fingerprint不能替代。LongBridge协议不变。该header是有界publisher声明，
不是新凭据，也不能单独证明raw report的实体账户；未来caller必须先独立核对configured account与
每份report，再派生现有ID。已通过的桌面空日报界面验收不等于该来源账户证明已通过。

只接受两个固定目标的 `America/New_York` 日投影：
- `longbridge-quant-paper-service|russell_top50_leader_rotation|paper`
- `charles-schwab-quant-service|soxl_soxx_trend_income|live`

新 GET 显式传 `date`、`platform`、`account_key`；旧 date-only GET 始终指向 LongBridge PAPER，
不会选择第一个账户或回退到 Schwab。重复或不完整的选择参数拒绝。对象仍按固定目标和业务日期写入既有
`STRATEGY_SWITCH_CONFIG`。LongBridge 保持原格式；Schwab 同项附服务端生成的私有绑定指纹，绑定漂移后
拒绝把历史记录归给新账户。这是读模型缓存，不是原子账务，也不保证严格恰好一次；保留期沿用现有 KV 策略。

账户键只在受保护账户配置里 `service_name` 与 `account_scope` 同时明确匹配且唯一时返回。没有映射、
映射重复，或 POST 调用方自己传入账户键，都拒绝，不按策略名或执行通道兜底。Schwab 还必须与受保护的
既有 `account_facts_bindings` 跨全部账户身份字段精确且唯一匹配；缺 scope、身份冲突或无绑定均保持 unresolved。
登录态 `/api/config` 只返回 `runtimeDailyBindings` 的目标、账户键和绑定状态摘要，不返回券商 hash 或源绑定。
页面按平台、账户、业务日期隔离日报、加载及错误状态；今日健康证据与所选历史日期分别读取，晚到响应不能串账户。

LongBridge 原7字段 evidence 和 unmatched-report 协议保留。Schwab 严格使用9字段 evidence，增加
`receipt_state`、`receipt_id`；未匹配报告仅有固定 `reason`。缺失/无效 receipt 不补造，原始 URI、账户身份和
receipt 内部字段不对 GET 公开，仅保留安全的运行异常分类。64KiB/20 runs/20列表项预算不变，超限拒绝。
缺当日对象是空数据，不是无交易；`fills` 永远为 `not_connected`、空 records、null count。

精确绑定的 Schwab 来源仅公开安全 schedule reason 白名单 `no_cron_on_business_date`、`market_closed`。
既有身份、lifecycle/部署新鲜度、纽约当前业务日、完整性、运行异常及通道检查全部通过后，当前业务日观察到、
日期/时区/原因/时间字段一致的明确无当日后续运行或休市记录，可在 `next_due_at: null` 时显示“健康”。
不会补造未来运行时间，也不声称完成了运行周期；沿用页面时钟和读取刷新，在纽约午夜（含 DST）失效。
缺失/未知 reason、过期/不完整证据、未来观察、身份冲突、pending 或错误不能使用此例外。
普通 `before_schedule` 仍要求未来 next due；LongBridge 原公开结构与 future-due 合同不变，任意诊断原因不外泄。
这只是显示判定，不改变交易授权或风险状态。

本次代码与合成验证不代表真实 Schwab 日报已接通。真实 caller 必须在脱敏前独立核对报告 account hash
派生的现有 source-binding ID 与受保护 expected binding，核实授权 report prefix、schedule 和未截断覆盖。
既有最新 execution-evidence 快照不能反推完整日报，最近100报告也不能证明全天完整。随后还须核 POST ACK、
登录态 GET、对应账户页面和自然周期。无需新增券商查询；代码发布本身不授权新增凭据、IAM、账户绑定或生产开关变更。

`data_status` 只表示这份缓存的读取新鲜度，不改原 `status` 或 `completeness`。纽约今天且 `observed_at`
未超过 36 小时为 `fresh`，其中 `unknown` 或 `failed` 仍是 `fresh`。业务日早于纽约今天为 `historical`。
纽约今天但观察已超过 36 小时为 `stale`。没有对象为 `unavailable`。`schedule.next_due_at` 与
`grace_ends_at` 可以晚于观察时间；`latest_due_at` 仍是已经到达的到期点。run 与 `observed_at` 仍拒绝未来时间。

## 账号下拉配置

Worker 页面内置示例 target 作为兜底。登录后如果没有加载账号配置，“一键切换”仍会保持禁用，Worker 后端也会拒绝 dispatch，避免账号不匹配。复制示例文件后填入你的真实 target/account route：

```bash
cp web/strategy-switch-console/account-options.example.json /tmp/strategy-switch-accounts.json
```

然后把 JSON 作为 Worker secret：

```bash
cd web/strategy-switch-console
wrangler secret put STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON < /tmp/strategy-switch-accounts.json
```

绑定 `STRATEGY_SWITCH_CONFIG` 后，KV 中的账号配置优先级高于 secret；secret 作为兜底配置。控制台页面不编辑这份 JSON。

每个账号项支持这些字段：

```json
{
  "key": "ibkr-primary",
  "label": "ibkr-primary",
  "target_name": "ibkr-primary",
  "account_selector": "DEMO_IBKR_PRIMARY",
  "deployment_selector": "demo-ibkr-tqqq",
  "account_scope": "demo-ibkr-tqqq",
  "service_name": "interactive-brokers-demo-ibkr-tqqq-service",
  "cash_currency": "USD",
  "supported_domains": ["us_equity", "hk_equity"]
}
```

Worker 会校验 dispatch 参数必须匹配这里的某个账号项，也会校验所选策略的 `domain` 是否在该账号的 `supported_domains` 内。只放路由信息，不放 broker 密码、token、API key。

`/api/strategy-profiles` 会返回公开的 live-enabled 策略目录，用于生成策略下拉框。读取优先级是 KV `strategy_profiles`、`STRATEGY_SWITCH_STRATEGY_PROFILES_JSON`、`strategy-profiles.example.json`。

登录用户访问 `/api/config` 时，Worker 还会读取目标平台仓库的当前 GitHub Variables。读取优先级是账号匹配的 `CLOUD_RUN_SERVICE_TARGETS_JSON`、匹配的 `RUNTIME_TARGET_JSON.strategy_profile`、`STRATEGY_PROFILE`。如果 GitHub 变量中未配置策略，页面会显示"未配置"状态，不再使用硬编码回退值。

切换表单也支持可选的预留现金覆盖项：所选账号币种下的最小预留现金和预留现金比例。如果账号现金币种固定，可以在账号配置里把 `cash_currency` 设为 `USD`、`HKD` 或 `CNY`；否则页面会按所选策略推断，A 股策略显示 CNY，港股策略显示 HKD，美股策略显示 USD。沿用当前策略会保留平台现有变量；如果平台没有显式配置预留现金变量，源码默认是不额外预留（账号币种 `0`、比例 `0%`）。填写后，Worker 会把它们传给 `manual-strategy-switch.yml`，由 workflow 写入平台对应变量，例如 `IBKR_MIN_RESERVED_CASH_USD` 和 `IBKR_RESERVED_CASH_RATIO`。

「允许融资」与「预留现金覆盖」在网页上互斥：选「允许融资：是」会禁用预留现金覆盖；设置比例/金额类预留覆盖会禁用「允许融资：是」，并自动切到「否」。QMT（A 股）平台不展示这两项，现金约束在 CnEquityStrategies 策略参数 `execution_cash_reserve_ratio` 内配置。

收入层控件来自 `strategy-profiles.example.json` 里的 live 验证策略元数据。切换页可以沿用当前配置、按 profile 默认起始金额和最高比例开启收入层，或关闭收入层。期权层也来自同一份策略 profile 元数据，但网页只暴露三态策略：沿用当前、启用 profile 默认 recipe 和预算、或关闭并清理期权层变量。手工切换请求仍不能通过 `extra_variables_json` 覆盖直接期权 overlay / LEAPS 字段；Worker 和构建脚本会拒绝这些直接覆盖项。

策略切换成功后会将账号级设置（plugin_mode、option_overlay_mode、cash_only_execution_mode、DCA 模式）同步回 KV 的 `account_options` key。策略 profile 本身仅保存在 GitHub 变量（`RUNTIME_TARGET_JSON` / `STRATEGY_PROFILE`）中，不在 KV 中重复存储。

## 策略健康只读接口

quant-monitor 使用专用 `STRATEGY_HEALTH_SYNC_TOKEN` 调用：

```text
POST /api/internal/sync-strategy-health
GET  /api/strategy-health
```

写入接口只接受专用 token、限制请求体大小，并把规范化的
`strategy_health_dashboard.v1` 快照写入 `strategy_health_snapshot`。读取接口要求已登录且在 allowlist；缺失、无效或超过默认 2 小时 TTL 的快照会返回 `unavailable` / `stale`，不会伪造健康指标。该 token 不复用 workflow dispatch token。

## 全局控制面只读接口

各仓 driver 在完成自己的验证后，可用**独立** `CONTROL_PLANE_SYNC_TOKEN` 调用：

```text
POST /api/internal/sync-control-plane
POST /api/internal/sync-control-plane-source
GET  /api/control-plane
```

新接入应调用 source 路径并提交 `qsl_control_plane_source_snapshot.v1`：Worker 按 `source_id` 分开保存，再聚合为 `qsl_control_plane_dashboard.v1`，所以一个仓库不会覆盖另一个仓库的候选。旧的完整快照路径仅为兼容保留。来源写入仍只保存候选生命周期、脱敏证据标识、新鲜度和机器建议；它会重新计算计数、丢弃未定义字段，并拒绝不一致的 P6 状态。读取仍要求登录 allowlist；日更来源超过默认 36 小时 TTL 时返回 `stale`。

聚合快照的 `data_status=ready` 仅代表快照送达。请同时读取只读 `attention`：任何 `DEFERRED` / `PARKED` 的策略、组合或插件候选、上游错误或空候选都会使其成为 `attention_required`；这用于告警与界面提示，绝不是自动调参、自动修复、paper/shadow/live 或下单授权。

这个接口不是订单、paper、shadow 或 live API。`CONTROL_PLANE_SYNC_TOKEN` 必须与 OAuth、workflow dispatch、策略 root 和任何券商凭证完全分离。部署 workflow 会在 `runtime-strategy-switch` environment 提供该 secret 时，把它同步为 Worker secret；每个来源仓库需要保存同一值到其专用 GitHub Environment，URL 使用只读控制台的 `/api/internal/sync-control-plane-source`。

## 旧实盘恢复核验（仅意图）

已经获授权、但因异常进入 `RECONCILE_ONLY` 的**既有**实盘目标，不走 P6 新策略上线队列。平台私有运行时用独立的 `RECONCILIATION_RECOVERY_SYNC_TOKEN` 发布最小快照：

```text
POST /api/internal/sync-reconciliation-recovery-source
GET  /api/reconciliation-recovery
POST /api/reconciliation-recovery-confirmations
GET  /api/internal/reconciliation-recovery-confirmation?recovery_id=<opaque-id>
```

来源契约是 `qsl_reconciliation_recovery_source_snapshot.v1`。每项只允许携带不含账户或 broker 状态的：不透明恢复 ID、平台/策略、`RECONCILE_ONLY`、QPK 候选 SHA-256、一个或多个受来源绑定的只读样本时间窗与数量、模型审计结果/绑定 SHA-256，以及稳定阻断码。`awaiting_human_confirmation` 只有在“样本时间顺序正确且窗口不超过 15 分钟、候选与发布行绑定、无阻断项”同时满足时才会被接受；模型审计结果和审计人数保持可见的 advisory 信息，不会授予或否决确认。来源和最后一次候选观测均默认 30 分钟后过期。任何已过期来源或候选都会使确认入口保持关闭。

控制台管理员确认后，Worker 只保存 `qsl_reconciliation_recovery_confirmation.v1` 的不可执行意图，固定 `no_order=true`、`execution_authority_granted=false`。它不会调用 workflow、读取券商凭证、改账户、下单或启用目标。私有恢复控制器只能以**另一枚** `RECONCILIATION_RECOVERY_CONTROLLER_TOKEN` 调用内部只读路径，读取当前候选绑定与确认摘要；Worker 会拒绝该 token 与来源同步 token 相同。控制器仍必须在同一目标上重新验证受保护来源，原子写入五项预期状态摘要并切换到 `ACTIVE_LKG`；任一条件不成立就保持 `RECONCILE_ONLY`。旧 `manual-strategy-switch.yml` 明确拒绝任何 `live_continuity_state != NONE`，避免绕开这条链路。

## Binance 私密资产清单

Oracle 上的受限采集流程可用既有 `RECONCILIATION_RECOVERY_SYNC_TOKEN` 将 Binance 当前账户的最小资产清单提交到 `POST /api/internal/binance-private-scope`。Worker 只写固定 KV key `private_binance_scope_report`，物理 TTL 为 24 小时；请求观测时间必须在过去 10 分钟内，未来偏差最多 60 秒。成功响应只含观测时间、来源 run ID 和资产行数，不回传资产明细，也不写入普通审计、健康、恢复或管理员聚合。

`GET /api/binance-private-scope` 同时要求有效 allowlist 会话和管理员权限，匿名返回 401，非管理员返回 403。超过 24 小时、缺失或损坏的记录统一返回 `report: null`。管理台只在选择 Binance 时显示这个独立区域，使用文本节点呈现定点数量；退出登录、权限失去或读取失败会立即清空。它不在浏览器持久化清单，不采集券商数据，也不提供处置、确认或下单入口。

## 平台运行状态只读接口

已接入的券商/平台仓在自身运行监测完成后，使用与执行证据同样受限的专用同步凭据提交**脱敏状态**：

```text
POST /api/internal/sync-runtime-target-lifecycle-source
GET  /api/runtime-target-lifecycle
```

来源契约为 `qsl_runtime_target_lifecycle_source_snapshot.v1`；每个目标固定为 `no_order=true`，只包含平台、
启用/停用状态、通道、运行监测、执行心跳及停车结论。Worker 按 `source_id` 保存并聚合，重复目标会被
拒绝而不是覆盖。读取接口要求登录 allowlist，来源超过默认新鲜度窗口即标为 `stale`。管理台把该信息放在
“待处理”页默认折叠的“平台运行状态”中，且只读：它不能启用目标、变更策略、访问账户或提交订单。

## M1 Shadow 建议只读接口

M1 把 P0 已生成的 `qsl.selection_decision.v1` 呈现给人工；它不创建策略、不会开始
Shadow runtime，也不会修改仓位。每个来源使用单独凭据提交：

```text
POST /api/internal/sync-adaptive-selection-source
GET  /api/adaptive-selection
```

写入的外层契约是 `qsl.adaptive_selection_source_snapshot.v1`，其中的 decision 必须仍是
`authority=shadow_only`、`no_order=true`，且每个 `proposed_weight=0`。`qsl.selection_decision.v1`
还必须携带 QPK `canonical_sha256` 计算的 `decision_digest`：Worker 会重新计算它，并因此将
`input_digest` 与全部展示字段一并绑定。Worker 会拒绝摘要不匹配、非零权重、非 Shadow
authority、非 no-order、缺少完整摘要或格式不安全的字段。读取接口要求已登录 allowlist；默认
36 小时后快照标为 `stale`，不会被当作当前结论。

兼容策略是**显式拒绝旧的无 `decision_digest` 投影**：这类 pre-digest 记录不能证明它们的
`input_digest` 与显示内容仍然一致，因此不会被当作 `v1` 的安全等价物，也不会被自动补摘要或
迁移。来源必须使用带摘要的 QPK `qsl.selection_decision.v1` 重新导出；重导出不会创建
Shadow、修改 runtime 或产生订单。

`ADAPTIVE_SELECTION_SYNC_TOKEN` 必须专用，不能复用 OAuth、策略切换、控制面、执行证据、
顾投、券商或账户凭据。顾投研究与 M1 的卡片也必须保持分开：顾投只能提出研究假设，不能
直接成为市场因子、策略基础分、插件风险缩放、平台健康、目标权重或订单输入。

## 网页人工审批（P6 决策意图）

当且仅当候选仍是**新鲜**的 P6 `owner_decision_required`、机器建议仍为 `owner_live_decision` 时，控制台会在“全局概览”显示人工决定区。只有管理员可以记录受限试运行意图或保持暂停；退役需要其独立提案路径。

提交到 `POST /api/owner-decisions` 的是 `qsl_owner_decision_intent.v1`：它绑定当前候选的 P1/P2/P3/版本证据指纹，持久权威为既有 RuntimeInstances 的 `human_decision_record`；KV 索引和审计日志只是便利镜像。证据、候选或阶段变化后，旧材料收据不能完成新材料，任何新决定均须重新审阅。

固定边界：该记录始终是 `no_order=true`、`execution_authority_granted=false`。它不会调用 workflow、平台 API、券商、资金或订单，也不会自动启用 Live。未来只有独立的确定性执行网关验证所有当前 P4/P5/P6 条件后，才可能消费这种意图；在那之前它只是网页人工审核记录。

## 人工决定收据与精确读回

Owner、recovery、promotion 三类决定仅从已验证的持久终态记录附加 `decision_receipt`。有界 `qsl_human_decision_receipt.v1`（具备完整 promotion 审阅资格时为 `.v2`）固定返回类型、事项、原材料 SHA-256、动作、原记录者/时间、逻辑目标及稳定收据摘要。Promotion 保留原选择的逻辑账户；拒绝后即使票据退出当前队列，仍能读其历史收据。不返回原 request key、完整 payload、券商原生账户号或凭据；不新增表、执行权限或 workflow。

既有 `/api/owner-decisions`、`/api/reconciliation-recovery`、`/api/research-promotion-tickets` GET 同时提供 `decision_subject_id` 与 `decision_material_sha256` 时，返回单笔 exact-material `qsl_human_decision_readback.v1`。此分支要求 allowed/admin，拒绝显式跨 Origin，允许正常同源 GET 不带 Origin，并保持 `Cache-Control: no-store`。它直接查询既有 DO 索引，不因来源移除、过期、失去资格或材料换版而抹除历史事实。`not_found` 仅描述本次完整查询，不是重新提交许可；DO 缺失/不可读为 unavailable，不从 legacy KV 拼出成功。当前材料诊断标志也不赋予历史收据任何执行权限。

普通队列新增 server 派生的 `decision_binding`。新 UI 确认绑定登录主体、类型、事项、材料索引、完整 promotion 审阅、动作和精确目标；promotion 的采用/不采用均发送 `expected_material_sha256` 与 `expected_review_sha256`，既有候选/账户守卫不变。原六字段 material SHA-256 仅保留为持久终态索引，并非完整审阅摘要。独立的 `qsl_promotion_review_binding.v2` 覆盖不可变的 producer 已保存审阅投影：候选/shadow 字段、notes/证据摘要、research summary/comparison/limitations/AI binding、drift、budget、search iterations、建议风险及静态审阅说明；排除纯观察时间与决定生成的终态字段。原审阅快照/摘要保存在同一 record payload，DO 写事务原子核对当前 material summary 中的审阅摘要，不 rekey 历史索引、不重写终态。旧调用方未发送 review hash 时保留原合同和 v1 收据，不因此取得 v2 资格。

前端分别保留 ACK 与精确读回事实。同步同材料锁覆盖相反动作及 A/B 账户；坏 ACK 不计成功，旧会话响应不能回写，ACK 后读回失败不撤销已记录事实。未知结果只可重新 GET 核对，绝不自动 POST；最后一项退出待办列表后仍展示结果。决定专用传输 15 秒超时，超时不证明请求被拒绝。

POST 前须成功写入并核验有界 sessionStorage 定位符（最多 24 笔 / 48 KiB），只存 origin、派生登录 namespace、精确逻辑绑定/目标、request ID 与开始时间；不存 token、session 对象、完整材料、原生账号或余额。同标签页重载先认证，再仅 GET 恢复；存储失败或损坏会阻止新提交，不静默丢弃未知请求。容量满时只回收已 exact-GET verified 的项，先成功持久化缩短后的 journal，再移除内存锁；unknown/submitting/ACK-only/conflict/legacy 未资格项均保留。全为未决项时暂停新提交，后续一笔读回验证可恢复容量，无需退出登录。退出清除私有状态和定位符；关闭标签页或清浏览器数据不承诺完整恢复。Replay 或他人已有一致记录展示真实原记录者/时间。

分阶段采用：先发布 receiver/test/docs 组并保留当前已部署前端；即使旧行缺审阅 metadata，旧客户端普通决定路径仍兼容。等待既有 producer 正常同步，通过只读 GET 逐个确认当前 pending promotion 的 v2 摘要匹配后，才采用 client/assets 组。GET 不写入或认证旧行；格式完整的既有 v1 收据可观察但不具 v2 资格；缺失或矛盾的原目标仍为 unavailable。本次不扩展 legacy 导入，也不补造缺失的确认/账户资料。准备度缺失时继续部署旧客户端，不强跑来源、不用真实决定制造准备度。

验证命令：`node tests/human_decisions_worker_validation.mjs` 自带 `cf:false`、既有工作流 CF 取数禁用配置、主机侧外部拒绝/仅 loopback guard，以及独立拒绝的 Worker outbound hook，覆盖六种决定及 DO 重启、历史读回/鉴权；`node --experimental-strip-types tests/decision_readback_ui_validation.mjs` 覆盖合成中断传输、身份隔离、重载、并发锁和真实 React 服务端渲染。`node --experimental-strip-types tests/decision_review_material_pure_validation.mjs` 在禁止所有网络的 guard 下验证纯投影/版本，不加载 Miniflare。原独立复审中被拒绝的调用不记 PASS，新隔离离线 harness 另存证据。这些证据不代替浏览器交互、生产部署或真实人工决定验收。

## 策略 Profile 对齐规范

`strategy_profile` 是切换页、runtime settings 和各平台仓库之间的统一策略 ID。

新增或重命名策略 profile 时，需要同时做这些事：

- 在 `strategy-profiles.example.json` 增加 runtime-enabled profile id 和显示名称。
- 运行 `python3 python/scripts/build_platform_config.py` 重新生成 `strategy_profiles_asset.js` / `config.js`。
- 给每个策略 profile 设置 `domain`。当前支持 `us_equity`、`hk_equity` 和 `cn_equity`。
- 在 `account-options.example.json` 和已部署的 KV 账号配置里更新对应账号的 `supported_domains`。策略 profile 通过 GitHub 变量的策略切换工作流进行管理。
- LongBridge 和 IBKR 账号默认写 `["us_equity", "hk_equity"]`，除非你明确要把某个账号限制成单市场。
- QMT 账号写 `supported_domains: ["cn_equity"]`，`cash_currency: "CNY"`，并指向 `QuantStrategyLab/QmtPlatform` 仓库里的 target（见 `examples/targets/qmt/`）。当前阶段 **仅 dry-run**，无 live 券商账号；控制台会锁定 paper 模式，Worker 拒绝 QMT live 切换。Worker 后端已支持 `qmt`；平台 Cloud Run sync 目前仍会在 workflow 里 skip，切换策略本身可正常触发。
- 架构说明见 `examples/targets/qmt/README.zh-CN.md`。Runtime-enabled 的 A 股策略为 `cn_industry_etf_rotation`（主轨）与 `cn_dividend_quality_snapshot`；`cn_index_etf_tactical_rotation` 为 research-only，不要放进切换页策略目录。
- main 分支部署 workflow 会在 Worker 部署后，用 `strategy-profiles.example.json` 自动更新已部署 KV 的 `strategy_profiles` key。手动部署时，可用 Worker 同步 token 调用 `/api/internal/sync-strategy-profiles`。
- 确认平台仓库当前的 `RUNTIME_TARGET_JSON.strategy_profile` 或账号级 `CLOUD_RUN_SERVICE_TARGETS_JSON` 使用同一个 id。
- 让 `manual-strategy-switch.yml` 统一管理平台 plugin mounts。策略不需要插件时，它会写入空的 `*_STRATEGY_PLUGIN_MOUNTS_JSON`，清掉旧策略留下的插件配置。
- profile id 只使用小写字母、数字、点、下划线、短横线或等号。不要把账号名、密码、token、密钥信息写进 profile id。

切换页只允许选择 runtime-enabled 且 `domain` 属于当前账号 `supported_domains` 的策略。如果从 GitHub Variables 动态读到了未登记 profile，先补进策略目录再切换。

## GitHub OAuth App

创建 GitHub OAuth App：

- Homepage URL：Worker 域名
- Authorization callback URL：`https://你的域名/callback`

把 OAuth App 的 client id 和 client secret 配到 Worker。

## Cloudflare Worker 部署

复制示例配置：

```bash
cp web/strategy-switch-console/wrangler.toml.example web/strategy-switch-console/wrangler.toml
```

进入目录后设置 secrets：

```bash
cd web/strategy-switch-console
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put SESSION_SECRET
wrangler secret put RUNTIME_SETTINGS_DISPATCH_TOKEN
wrangler secret put STRATEGY_SWITCH_SYNC_TOKEN # 可选；默认复用 RUNTIME_SETTINGS_DISPATCH_TOKEN
wrangler secret put STRATEGY_HEALTH_SYNC_TOKEN
wrangler secret put CONTROL_PLANE_SYNC_TOKEN
wrangler secret put M0_RESEARCH_SYNC_TOKEN
wrangler secret put RESEARCH_PROMOTION_SYNC_TOKEN
wrangler secret put RECONCILIATION_RECOVERY_SYNC_TOKEN
wrangler secret put RECONCILIATION_RECOVERY_CONTROLLER_TOKEN
wrangler secret put ALLOWED_GITHUB_LOGINS
wrangler secret put ALLOWED_GITHUB_ORGS
wrangler secret put STRATEGY_SWITCH_ADMIN_LOGINS
wrangler secret put STRATEGY_SWITCH_ADMIN_ORGS
wrangler secret put STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON < /tmp/strategy-switch-accounts.json
```

`RESEARCH_PROMOTION_SYNC_TOKEN` 保护：
- `POST /api/internal/sync-research-promotion-ticket`（QPK soft-sync awaiting ticket）
- `GET /api/internal/research-promotion-ticket?ticket_id=...`（QPK 拉取控制台决定）

QuantPlatformKit 侧需配置同名 token，并把 `RESEARCH_PROMOTION_SYNC_URL` 指到 sync 接口（pull URL 可由它推导）。
soft-sync 不授予 live；控制台上的 accept/reject 只记录人工意图。

如果要启用后台保存，先创建 KV：

```bash
wrangler kv namespace create STRATEGY_SWITCH_CONFIG
```

然后把返回的 namespace id 加到 `wrangler.toml`。

GitHub Actions 自动部署需要在 `runtime-strategy-switch` environment 配置 `STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID`、`STRATEGY_SWITCH_CONSOLE_URL`、`STRATEGY_SWITCH_SYNC_TOKEN`、`M0_RESEARCH_SYNC_TOKEN`，以及 `CLOUDFLARE_API_TOKEN` 或 `CLOUDFLARE_WRANGLER_CONFIG_TOML` 二选一（只有当 `RUNTIME_SETTINGS_GH_TOKEN` 与 Worker 同步密钥相同时才复用它）。若要启用 QPK soft-sync 把 awaiting_human ticket 推到控制台，再配置 `RESEARCH_PROMOTION_SYNC_TOKEN`；deploy 仅在该 secret 存在时同步到 Worker。如果 Wrangler 能从 token 推断账号，`CLOUDFLARE_ACCOUNT_ID` 可不配。`M0_RESEARCH_SYNC_TOKEN` 必须与另一个受保护的 `m0-research-publisher` Environment 中的同名 secret 一致；它只会被复制到 Worker binding。缺少该值时，workflow 会在部署前失败，不能静默保留 Worker 的旧密钥。workflow 会先部署 Worker，再把内置策略 profile 目录同步到 KV，避免网站继续使用旧的 profile/plugin 元数据。

部署：

```bash
wrangler deploy
```

完整 fork 清单见 [docs/strategy_switch_fork_guide.zh-CN.md](../../docs/strategy_switch_fork_guide.zh-CN.md)。

## Token 权限

`RUNTIME_SETTINGS_DISPATCH_TOKEN` 只需要能触发 `QuantRuntimeSettings` 仓库的 workflow。实际跨平台 variables 写入仍由 `Manual Strategy Switch` workflow 内部使用 GitHub Actions 环境里的 `RUNTIME_SETTINGS_GH_TOKEN` 执行。

`STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON` 建议作为 secret 配置，这样真实账号下拉项只会在登录且通过 allowlist 后返回给前端。它只放账号路由信息，不要放 broker、email、cloud、API key 等密钥。

## 操作流程

1. 访问控制台页面。
2. 未登录时只能查看公开示例，“一键切换”按钮禁用。
3. 点击“登录管理”，也可以直接访问 `/login`。
4. 如果登录账号在 allowlist 用户/组织或管理员用户/组织中，且账号配置已加载，按钮启用。
5. 顶部保留语言和主题；头像菜单只有用户名和退出。登录权限与组织授权仍由环境变量和 KV 决定。
6. 先查看待确认事项与账户读回；需要修改时点击账户或展开“策略设置”，通过唯一主操作提交启用、切换或停用。
7. 页面返回 GitHub Actions 链接查看配置任务结果；平台是否实际应用仍以有效读回为准。

这个模式适合个人系统：不需要审批人，但能避免公开网页被任何人直接切换。

## UX1 研究草案

运行总览里的研究方案使用同一份 `qsl.ux1.research_draft.v1`。简易模式是默认显示；切到高级模式只写入浏览器偏好 `qsl-ux1-view-mode`，不发请求，也不改 fingerprint。草案存在 RuntimeInstances 绑定里的独立 `ux1_research_slot`，按登录名隔离，并用 revision 做 CAS。它不是 runtime `kind=draft`，也不能提交到 `/api/switch`、runtime-stop 或晋级。

`GET/POST /api/ux1/draft`、`POST /api/ux1/preview` 和 `POST /api/ux1/intent` 都要求 allowlist 会话；写操作还要求同源 Origin。服务端只接受冻结字段，拒绝账户、授权、密钥、URL、路径和未知字段。预览把已保存 revision 的业务字段组装为 UES 原生 `qsl.ux1.preview_request.v1`，送给固定绑定 `UX1_RESEARCH_CALCULATOR`，只接收经白名单核验的 UES `qsl.ux1.preview_result.v1`；草案摘要与 UES request fingerprint 相同。高级金额及比例在请求和摘要中使用规范十进制字符串，避免两端对小浮点数的序列化差异。没有该绑定时返回 `calculator_not_connected`，并清掉已保存预览，不给模拟数字，也不把上一份成功留作当前结果。计算失败、超时、非零退出或结果被拒绝时同样使预览失效；`calculator_busy` 只表示这次没有新计算，可重试。远端绑定这一次调用从 fetch 到读完响应体共用固定 30 秒截止时间，响应体按 UTF-8 实际字节计，上限 65536。超过上限或截止时间到达时先中止调用，再发起取消读取，但不等待取消完成。不以 Content-Length 为准，也不自动重试。fetch 若在中止之后才返回，只取消迟到的 body，不读入这份结果。只有完整读入且未超限的 429，并且 JSON 的 error 正好是 `calculator_busy`，才保留当前预览；过大、挂起或失败的 429 与其它失败一样返回 `calculator_failed`，并用调用开始时的 revision CAS 清掉这次对应的旧预览。revision 已经前进时，迟到失败或迟到响应都不会清掉较新 revision。浏览器和操作员配置都不能改这些限制。每次本地进程有一个非秘密 `runtime_epoch`。预览带上它，草案、revision 和意向收据不带。重启或缺少该字段的旧预览在 GET 中显示为过期，意向写入返回 `ux1_preview_stale`，已有收据保持不变，直到重新计算。决策日 `2023-03-29` 与次日历史执行核对 `2023-03-30` 仍分开。意向收据不可执行，重复保存返回同一收据。

`UX1_PREVIEW_MODE=github_actions` 时，同一次 `POST /api/ux1/preview` 改为异步研究作业；未设置该变量时仍走上面的本地 binding。其他值直接拒绝，不降级。浏览器请求仍然只有 `expected_revision`。任务写在同一个 `ux1_research_slot.job_json`，创建时绑定当时的登录、revision、fingerprint、32 位 `UX1_RUNTIME_EPOCH`、40 位 `UX1_UES_REVISION` 和全部 7 项 `UX1_EXPECTED_EVIDENCE_HASHES`。先落库再向固定仓库 `QuantStrategyLab/UsEquityStrategies`、固定 workflow `ux1-research-preview.yml`、`ref=main` 派发，唯一 input 是 `ux1_request_id`。重复点击返回同一任务，不第二次派发。`queued`、`running` 和 `unknown` 不会因为草案修改被覆盖或重新提交。缺上述配置或专用 `UX1_RESEARCH_JOB_TOKEN` 时返回未连接，且一次都不派发。这个 token 只给 `POST /api/ux1/jobs/claim` 和 `POST /api/ux1/jobs/result`，不能用浏览器会话代替。claim 先读取 GitHub workflow run 的 `event`、`path`、`head_sha`、`display_title`、`run_attempt`、`head_branch`、`repository` 和 `head_repository`，不采用 runner 自述。结果请求最大 80KiB；成功仍用现有投影和创建时绑定的摘要、epoch、revision、fingerprint。配置变更后的旧任务不能按新配置显示为成功。旧 revision 的结果只结束旧任务，不写入新草案。失败只清该旧任务对应的预览和意向。超过 30 分钟仍无终态时，页面显示未确认和检查提示，不自动重发，也不把旧预览当成成功；之后合法终态仍可收口。`workflow_dispatched` 继续表示交易且保持 false；研究作业另用 `research_workflow_dispatched`。页面只在已登录、停留在运行总览且任务未结束时低频轮询，离开、登出或结束后停止，不覆盖正在编辑的草案。

部署 workflow 从 GitHub `runtime-strategy-switch` environment 读取 `UX1_PREVIEW_MODE`、`UX1_UES_REVISION`、`UX1_RUNTIME_EPOCH` 和 `UX1_EXPECTED_EVIDENCE_HASHES` 四个 Variables，并从同一 environment 的 Secrets 读取专用 `UX1_RESEARCH_JOB_TOKEN`。保持 `UX1_PREVIEW_MODE` 为空时，部署继续使用本地 calculator binding；设为 `github_actions` 才启用异步路径。启用时必须提供格式有效的 UES revision、runtime epoch、七项证据 SHA-256 及 16–256 字符 token；部署 workflow 会在部署 Worker 前拒绝缺失或无效配置。Token 通过 Wrangler secret stdin 同步，不进入 Wrangler TOML。该路径仍只执行固定的研究预览 workflow，不授予交易或执行权限。

持久研究使用操作员私有配置，不写入仓库。配置只含固定解释器、已安装的 UES JSON stdin/stdout 程序路径、批准的输入根、七项已核验的输入/政策 SHA-256、稳定 state 根、回环端口和登录名。七项摘要须从同一获准历史案例的原始计算证据取得；计算返回的摘要与配置不一致时拒绝结果并使旧预览失效。浏览器不能提交路径或命令。

```bash
node web/strategy-switch-console/ux1_local_demo.mjs start --config /绝对路径/ux1-local.json
node web/strategy-switch-console/ux1_local_demo.mjs status --config /绝对路径/ux1-local.json
node web/strategy-switch-console/ux1_local_demo.mjs stop --config /绝对路径/ux1-local.json
```

```json
{
  "interpreter": "/绝对路径/python",
  "executable": "/绝对路径/已安装的UES入口",
  "input_roots": {
    "raw": "/绝对路径/raw",
    "r6": "/绝对路径/r6",
    "materialized": "/绝对路径/materialized.json"
  },
  "expected_hashes": {
    "r7_policy_sha256": "填写64位小写十六进制摘要",
    "r8_policy_sha256": "填写64位小写十六进制摘要",
    "capital_policy_sha256": "填写64位小写十六进制摘要",
    "settlement_policy_sha256": "填写64位小写十六进制摘要",
    "raw_manifest_sha256": "填写64位小写十六进制摘要",
    "r6_manifest_sha256": "填写64位小写十六进制摘要",
    "r6_materialized_file_sha256": "填写64位小写十六进制摘要"
  },
  "state_root": "/绝对路径/稳定状态目录",
  "port": 8787,
  "login": "ux1-local-operator"
}
```

`start` 只监听 `127.0.0.1`，`state_root` 必须仅限当前用户访问。`state_root/durable` 是 Miniflare Durable Objects 持久目录，保存草案、revision 和意向。`state_root/session` 是本次进程的 0600 会话令牌；重启会换新令牌，需要重新认证，令牌和认证 secret 都不进入 Durable Objects，也不打印到 stdout。`stop` 只向该配置记录的、命令行仍是本入口的进程发信号，不扫描无关 PID。`status` 只打印 running/stopped、监听地址和 state 根。

临时会话仍可用旧参数，每次使用新的临时目录，重启后找不到上次草案：

```bash
node web/strategy-switch-console/ux1_local_demo.mjs --interpreter <绝对路径> --adapter <绝对路径> --raw-root <绝对路径> --r6-root <绝对路径> --materialized <绝对路径> --session-file <私有绝对路径>
```

计算子进程 `shell` 为 false，30 秒超时，stdout 超过 65536 字节即失败，同时只允许一个计算，超出返回 `calculator_busy`。子进程只继承 `PATH`、`HOME`、`LANG`、`LC_ALL`、`LC_CTYPE`、`TMPDIR`、`TZ` 以及三个批准输入路径，不继承调用方环境里的券商凭据。这不是生产 service binding。

页面与预览 JSON 分别标出 `decision_as_of`、`known_through`、`calculated_at` 和 `historical_execution_date`。后一天的历史费用只留在执行核对，不作为决策日已知输入。

## 账户事实与资产历史（默认关闭）

`ACCOUNT_FACTS_READ_MODEL_ENABLED=true` 才开放账户事实接口；现有 `runtime-strategy-switch` GitHub Environment 的同名非 secret variable 会被部署工作流写入 Wrangler 配置，空值按 `false` 处理，其他值在部署前拒绝。设置为 `true` 时还要求专用 `ACCOUNT_FACTS_SYNC_TOKEN` secret 非空、无首尾空白且不含 HTTP 控制字符，否则部署前拒绝。LongBridge POST 使用此 token；IBKR POST 只接受独立可选 `IBKR_ACCOUNT_FACTS_SYNC_TOKEN`，若配置则必须无首尾空白且不含 HTTP 控制字符。两 token 必须不同；缺少 IBKR token 时 IBKR 同步拒绝，不能回退到 LongBridge token。GET `/api/account-facts` 和 `/api/account-facts/history?platform=longbridge&account_key=…&currency=USD` 使用既有登录授权。需要现有配置存储和 `STRATEGY_SWITCH_RUNTIME_INSTANCES` Durable Object；缺失时不回退为 KV 写入。token 仅用于部署前检查和 Worker secret 同步，不写入 Wrangler TOML。启用开关或配置 token 均不代表读模型已获准生产来源。

配置存储中的 `account_facts_bindings` 使用 `qsl_account_facts_bindings.v1`。LongBridge binding 使用 `platform=longbridge`、现有 `deployment_scope_token_version` 来源及精确账户选项；IBKR binding 使用 `platform=ibkr`、`source_binding.kind=deployment_runtime_account`，并将 `account_scope` 与 `account_selector` 分别绑定到准确选项。IBKR 历史合同为 `ibkr_account_snapshot_history.v1` / `ibkr_account_snapshot.v1`；服务端从schema及专用 token 确定平台，调用方不能提供 platform 或 account_key。`account_ids` 必须是唯一的单项 native ID，且与服务器 binding 的 `account_selector` 完全一致。IBKR 仅接受逐币种 `net_assets`（可为 null）和带允许 source tag 的 `cash_balance`，不合成 total cash；null 净值不画图、不当作零。字段和来源需来自可信部署/账户材料，身份变化后旧观察不可使用。binding 不证明已核实的物理账户所有权或实盘授权；跨账户总额仍不可用。

接收 LongBridge 已持久化的 `longbridge_account_snapshot_history.v1`，保留原观察时间和分币种金额；首次接收限定原观察开始后15分钟，不提供历史回填入口。最新观察与每日最后观察在同一事务保存，历史最多保留366个UTC观察日；缺日/缺币种留空，历史曲线不代表收益。完整外部资金流未提供时不计算收益；物理账户未去重时不汇总全部账户金额。

每日运行区域读取既有 `/api/runtime-daily`，业务日期使用 `America/New_York`，与资产历史的UTC观察日分开。数据未取得时页面使用普通缺省显示；具体工程原因保留在接口与运维报告，订单已提交不等于已成交。真实发布、页面采用与自然周期仍须分别核验。

### 晋级审阅材料逐项隔离（2026-10-07）

普通 promotion GET 仅隔离确定的 canonical 审阅材料验证错误。旧 JSON 数字字符串可通过原 normalizer，却归一成非有限数字，不能因此让正常票据整队列读取失败。响应保持 `data_status: partial`，仅含固定错误 `research_promotion_review_material_invalid`、1–100 的 `summary.invalid_review_count` 及数量一致的 `invalid_tickets`。坏项明确 `decision_material.eligible: false`、`blocked: true`、固定 blocker，且无 `decision_binding`；不把坏数字伪造成0/null。正常票据及应用保留原合同；crypto、DO 权威等基础设施故障不转成该 partial。带或不带 v2 审阅 hash 的坏决定 POST，以及坏来源 sync，仍在任何写入前拒绝。

只有现有 promotion adapter 接受此精确 partial 的有效子集，并核 schema、单一错误、数量上限、诊断旗标、身份唯一性及材料 binding。来源仍非 ready，既有“部分待办暂时无法读取”警告继续出现；未知 partial、多余错误、stale/unavailable 或 transport error 不放行，owner/recovery 消费不变。这只是数据消费修复，不采用旧完整 v2 决定客户端，不改页面文字、布局、样式或刷新行为。部署、正常 producer 准备度和真实业务验收仍须分别证明。

新增 `tests/promotion_queue_partial_validation.mjs` 接入既有 presentation 校验入口，使用可表示 JSON、假 KV/DO 和全部网络拒绝守卫，覆盖混合/全坏队列、诊断上限、v1/v2 坏 POST 与 sync 零写入、基础设施错误、adapter 负例及未改 React 页面的真实 SSR：正常项可见且原警告保留。合成复现不证明生产 partial 警告由该坏数据引起。
