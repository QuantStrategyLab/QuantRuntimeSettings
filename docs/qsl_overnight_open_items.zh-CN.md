# QSL 隔夜残留清单（收尾盘点）

> 盘点日：2026-09-07 晚。用户已授权工程收尾与费用清理；**不**自动新开 live、**不**在无凭据时调券商。
> 2026-09-08 校正：本轮核对源码与 GitHub 合并状态；保留的历史部署、费用清理和变量配置报告不作为本轮独立运行核验。

## 1. 已合代码与历史交接结果（分层记录）

| 项 | 结果 |
| --- | --- |
| 平台 W1 代码 + Cloud Run 部署 + QPK pin `d4e86f1` | 历史报告：Schwab/IBKR/LB 禁买/禁新增风险已接线；本轮未重验运行 |
| QPK D1–D3 / W2 / HITL 门 / drift 评估器+探针 | #576–#582 |
| QPK `production_drift_new_risk` → NEW_RISK gate | 已合 [#589](https://github.com/QuantStrategyLab/QuantPlatformKit/pull/589) → `d5f3723`；Policy A 仅禁新增风险 |
| 平台 NEW_RISK drift 初次注入 | 历史记录：Schwab [#390](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/390)、LB [#456](https://github.com/QuantStrategyLab/LongBridgePlatform/pull/456)；后续 store 接线见下一行，不作当前 pin 声明 |
| store → NEW_RISK 注入残差（代码） | QPK [#590](https://github.com/QuantStrategyLab/QuantPlatformKit/pull/590) `d51bb79`、Schwab [#391](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/391) `74109a2`、LB [#457](https://github.com/QuantStrategyLab/LongBridgePlatform/pull/457) `16f0299` |
| lifecycle bucket 配置同步支持（代码） | 已合 Schwab [#393](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/393)、LB [#459](https://github.com/QuantStrategyLab/LongBridgePlatform/pull/459)；不等于 Cloud Run 已应用 |
| SOXL core-only baseline / history 支持（代码） | 已合 UES [#468](https://github.com/QuantStrategyLab/UsEquityStrategies/pull/468)、UESP [#478](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines/pull/478)；本轮未运行真实采集、回放或 baseline 验证 |
| GCP 费用：revision/AR 压到 keep=2；Firstrade 删 `*/5` monitor | 历史报告已执行；本轮未重验 |
| HITL 库与 accept→apply | 人工显式调用的库能力；不代表生产自动优化开启，接受不授 live |

## 2. Drift 监测口径

| 能力 | 状态 |
| --- | --- |
| `evaluate_production_drift_health` / probe CLI | 已合 |
| `probe_production_drift_health_from_store` | 已合 #583；缺分 → `parked`，不编造 0.0 |
| 平台 `production_drift_health_observe.py` | lifecycle cron 只读；包括 REVIEW/CRITICAL 在内均零 optimize；生产 Policy A 仅禁新增风险 |
| 生产 metrics → `drift_score` 读回 | store 消费代码已接线；真实分数、交易 profile 与同源性本轮未核验 |
| `LIFECYCLE_PERFORMANCE_BUCKET` | 历史报告平台与 UES GitHub vars 已配置共享桶；不证明 Cloud Run 配置已应用 |

交接报告称 inject 已部署，本轮未独立读回生产。交易 store 查询使用 `RUNTIME_TARGET_JSON` 的 profile；observe profile override 不证明交易闭环，也不替换交易配置。

## 3. 仍 PARK

| 项 | 原因 |
| --- | --- |
| 真下单 / 新开 live | 既有 `ACTIVE_LKG` ≠ 新授权 |
| 本机直读 IBKR/LB GSM | 继续用 Cloud Run 挂载 |
| Console D3 聚合视图 | 可选；信封 trio 已够运维 |
| 生产自动 reopt / promotion runner | Policy A 不启用；库内有界研究需另有人工显式授权，不作为生产待补接线 |
| `combined_scale` 平台缩仓 | W1 禁买已接；缩仓 sizing 尚未闭合 |
| store → NEW_RISK 端到端验收 | 注入及同步代码已合，历史报告 inject 已部署；本轮未核验 Cloud Run 配置应用、交易 profile 对应真实 `drift_score` 与 NEW_RISK 消费结果，不据此宣称闭环 |

## 4. 明确不做

- 日历盲跑 reopt；改 public ingress；共账户 allocator；AI 升档/授 live

## 5. 交叉引用

- [资金风险信封 V1](qsl_capital_risk_envelope_v1.zh-CN.md)
- [偏离触发 HITL V1](qsl_drift_triggered_research_hitl_v1.zh-CN.md)
- [多策略组合 A→B V1](qsl_multi_strategy_combo_ab_v1.zh-CN.md)

<a id="six-track-audit-20261006"></a>

## 6. 2026-10-06 六主线接续审计

本节接续原清单，保留上文 2026-09-07/08 的历史日期和边界；不是重新验收旧部署。源码盘点基线为 QRS `d35b2f83f4ebb7bc1c78fdad054534b4dfd1d3f9`。除明确列出的证据外，本次没有真实行情重采、模型调用、券商操作或生产配置变更。

六主线是工作管理分类，**不替代每个冻结候选的 P0–P6 生命周期**。表中“高/中/低”是任务优先级，不是候选阶段。每仓仅一个 writer；独立只读或离线工作可并行，公共契约、共享环境及同账户资金操作串行。

2026-10-06 20:08 UTC 复审：6.2–6.8 保留当日先前快照；当前阶段、依赖与下一步以[6.9 依赖复审](#dependency-review-20261006)为准。旧快照里的“当前 main”“仍缺口”不覆盖后续有日期的更新。原六主线和任务 ID 不变，汇报中的七个工作分组只用于拆分展示，不新增第七主线。

### 6.1 使用方法与逐阶段维护

- 任务 ID 保持稳定。按任务指定前置、边界和完成证据推进；“可立即实施”仅指具备有界离线下一步，不额外授权 Git 发布、真实数据/模型调用、部署、通知、账户或资金动作。
- 层级状态按“设计 / 实现 / 采用 / 业务”记录。实现可包含合成测试；采用要说明合并、消费者、部署各自证据；业务必须是相应真实来源/周期验收。CI 不能填满其余层级。
- 每完成一个阶段、定向验证或审计复查，更新同一任务的结果、证据日期、剩余项和下一步，再进入后续阶段。失败、负结果与未运行项一并保留。
- 新 finding 先核是否同根因、同目标或已有任务，归入原 ID；需要新范围时先写理由、涉及边界、前置与完成标准。不能以无限增加检查、追 pin、框架或 receipt/hash 链代替解决原问题。
- 已完成项关闭；等待输入项列具体缺什么；观察期列外部完成条件，不用重复重跑制造进展。明确非目标不自动成为待开发事项。

以下状态截至 2026-10-06。任务的“完成证据”是关闭条件，不表示已经取得。

### 6.2 看板配置体验

| ID / 优先级 / 下一步类型 | 分层事实与剩余项 | 前置与完成证据 |
| --- | --- | --- |
| `UI-01` 高；已合并/自动部署，有限线上验收，未关闭 | [QRS #531](https://github.com/QuantStrategyLab/QuantRuntimeSettings/pull/531) merge `da70d9e` 与复核tree一致；[main CI37452298421](https://github.com/QuantStrategyLab/QuantRuntimeSettings/actions/runs/37452298421)三job及[原自动部署37452298369](https://github.com/QuantStrategyLab/QuantRuntimeSettings/actions/runs/37452298369)成功。27项映射/4对标签与现有consumer统一展示已发布；既有线上会话核到资源文件名匹配、一个真实决策的身份默认折叠可展开、分轴及缺失字段Unknown | 详情见[有限验收记录](console_information_design.zh-CN.md)。JS直读被ERR_BLOCKED_BY_CLIENT后停止，未绕过；线上响应字节/hash、四标签全覆盖、中英切换、手机与真实V7记录未验。V2历史研究UI仍缺失，未新增。ID/冻结hash/权限不变，展示更新不代表实际策略采用 |
| `UI-02` 高；展示核查可立即实施，真实账户能力等输入 | 设计/实现：QRS 与 LB registry 支持美股和港股；采用/业务：逐账户权限未核。香港实体不等于只能港股 | 可选项取平台×账户权限×策略域×标的×执行通道交集，记录来源/时间；实体、市场、币种、日历各自显示。真实账户权限、fractional/lot、paper/live差异有证据后才关闭 |
| `UI-03` 中；等受限应用路径输入 | 实现：一般账户设置可保存 draft/risk，`apply_strategy/activation/adopted=false`；独立 profile-only 确认路径不等于本页面已消费。采用/业务：保存到实际应用未验 | 不把安全 false 当 UI bug。按现有授权接消费路径，分别验收草案、确认应用、runtime读回与业务周期；隔离测试不能触发实盘 |
| `UI-04` 高；producer覆盖审计可立即实施 | 实现：最近90天日期控件；现有daily feed只绑定 LongBridge paper/Russell目标。采用/业务：不支持“全部账户90天已齐”的结论 | 逐目标列producer、账号绑定、市场时区/日历、保留、首末记录、缺口及原因。取得真实周期，区分no-order/dry-run/real；not_due与心跳不算。先补覆盖事实再决定最小consumer改动 |
| `UI-05` 中；可立即实施覆盖展示，恢复验收观察中 | 实现/采用：QRS #529 修同时间戳历史请求失败后的可见刷新，新bundle已核；业务：生产503恢复未复现。资产历史最多366天，界面仍有3/5/10年选项 | 显示first_sample/truncated/retention；不补历史。定向验证失败重试、切换/晚到请求与截断空态；自然出现同类故障再核真实恢复，不人为制造线上故障 |

### 6.3 账户取数、资金流与收益

| ID / 优先级 / 下一步类型 | 分层事实与剩余项 | 前置与完成证据 |
| --- | --- | --- |
| `DATA-01` 高；等原生来源样本 | 实现：已有权益/现金快照与QPK supplied-interval合同；QRS账户收益未接通。原生账户TWR、完整出入金/费用/FX资格未核；净资产变化不是收益 | 优先核指定IBKR已导出Activity Flex的Change in NAV真实编码/百分比/账户/期间/币种，再做纯文件import→receiver→UI完整路径。月度值不拆日线，账户TWR不冒充策略归因；Schwab日损失facts和LB现金快照不能直接改名ROI |
| `DATA-02` 中；等基准口径与合格源 | 实现：S&P500/Nasdaq/Dow/Russell只有四图例；FRED独立价格iframe不是四序列比较；业务：缺实际可比收益 | 明确准确index/series、price或total-return、许可、币种、窗口及方法。四条真实序列逐项资格验证；缺一个独立标缺，不填零、不静默换ETF代理或混用回报口径 |
| `DATA-03` 高；可立即实施有界离线兼容验证 | 实现/合并：QPK647 `28675796cabbe137a1fa3970b70d1aa98e952c88`阻止research修补live；AAB仍需自身采用验证。086166→286757的12commit/26file只读比较确认research API兼容，不证明runtime兼容 | 等最终AAB日报writer冻结后测：Binance interval唯一来源、7日sync/10有效日收益warmup、跨sync保留积累、重复不增数、断点后新连续段、partial-domain缺profile在health/daily/告警一致。不能降阈值或借CSV凑够；pin/部署另记，不将整看板统一标research |

### 6.4 SOXL/TQQQ、组合复利、仓位与熔断

| ID / 优先级 / 下一步类型 | 分层事实与剩余项 | 前置与完成证据 |
| --- | --- | --- |
| `STRAT-01` 高；冻结索引已随QRS531合并/部署，真实覆盖待验，未关闭 | V7实际3%现金保留的source-correctness语义、V6预注册参数、V5/V7/V9精确ID/config索引与R6独立study分轴已实现并通过本地/SSR回归；工程发布证据同UI-01。线上只观察了一条真实决策的身份分列与Unknown，未验真实V7或其冻结版本区 | 冻结研究索引不代表实际部署source；UES07b164d、QPKf30e7、config843ab4不变，材料缺失不补猜。线上JS响应hash、真实V7/R6材料及历史UI覆盖仍未验；AI标签仍需对应trial/输入/模型/输出来源，版本号和AI扩展关闭都不能证明AI参与情况 |
| `STRAT-02` 高；离线审查可立即实施，真实重算等合格输入 | 设计/实现：原双源P1/P3、R5与R6存在不同输入/会计边界；R6单源结构覆盖不等于原双源或历史PIT。原8月历史P3结果不能当今日重验 | 分轨核费用/滑点5/10/15bps、next-session成交、现金腿与half-L1换手、股息/FX适用性、已见窗口、锁定OOS、future/late-row不变及全部trial。保留负结果，真实重算需原授权/合格输入，不能移用另轨结论 |
| `STRAT-03` 中；观察期/生产绑定待核 | 实现：V7 nonlive forward与9月11日252-session后固定金融评价/可选研究票据接线；实际开关、存储/运行身份、完整进度本轮未核 | 核每XNYS有效观察与缺口；252计数完成仍须5/10/15bps金融评价。模拟Paper不是券商paper，nonlive观察不是paired shadow；票据接受只是研究意图，无live权限。未完成窗口正常等待，不重置窗口/自动调参 |
| `STRAT-04` 中；等共同合法真实输入 | 设计/实现：组合冻结、共同P1 binding与synthetic OOS已有；真实共同root/净成本OOS/组合证据未闭合 | 冻结成分revision、共同cutoff、权重/再平衡、费用、相关性与组合风险；单策略指标不能相加冒充组合。完整真实P3/所需后续证据到位才关闭；不顺带建立共账户allocator |
| `STRAT-05` 高；逐平台只读/合成审查可立即实施，运行验收等证据 | 实现：资金信封与禁新增风险库/平台代码已有；旧W1部署为历史报告；`combined_scale`平台sizing仍未闭合。UES cooldown/release-state为研究/合成规范，不是全平台熔断完成 | 按平台×账户×市场×session核权益/持仓/挂单、阈值/锁存、日历/缺前驱/中断重启/重复/数据过期。数据停车≠市场压力，禁新风险≠已减仓。AI/插件放行或冷却结束不产生新alpha intent或补仓权；复位/减仓/新信封采用保持原独立授权 |

### 6.5 市场插件与数据质量

| ID / 优先级 / 下一步类型 | 分层事实与剩余项 | 前置与完成证据 |
| --- | --- | --- |
| `MARKET-01` 中；合成/来源合同审查可立即实施，真实采用等数据 | 实现/合并：QSP77半导体三轴、78利率背景纯观察；均UNVALIDATED_RESEARCH。利率PIT/backtest/position-control均未获资格，宽表CSV会丢逐行发布时间/修订 | 真源许可、available/received/revision、session/复权/因果投影、过期/unknown和冻结consumer绑定；需要实际来源覆盖、经济消融/OOS与获批消费。QQQ不得充SOXX；近似yield spread不当独立第二票；插件/AI不得加仓 |
| `MARKET-02` 低；等独立数据契约，非当前阻塞 | 已识别breadth历史membership/prices及NDX参与结构缺口；QSP78不实现它们，不能将缺数据写成已验证市场判断 | 先确认有界研究目标、来源许可/历史成分与实际可得性，再决定是否实施。不得为填满插件列表造代理、补值或扩大当前取数范围 |

### 6.6 AI 自动化

原设计已覆盖参数优化、策略重写、新策略、插件修订及联网研究，状态是 **Accepted policy / implementation staged**，不是本次才提出，也不是任意自主生成已经上线。设计/源码依据见第6.8节。下面两个长ID是本次审计finding登记项，不表示已经创建GitHub Issue。

| ID / 优先级 / 下一步类型 | 分层事实与剩余项 | 前置与完成证据 |
| --- | --- | --- |
| `AI-01` 中；已有诊断链持续观察 | 实现：AAB watcher有结构化诊断、幂等/额度/时间/Issue回执机制；诊断Issue不代表实验或修复完成。真实模型/部署闭环按现有finding合并，勿重复开项 | 核具体入口→绑定输入→有界模型→同Issue结果的实际证据；参数优化/行为等价重构/新alpha候选分别走原设计。诊断不会直接加风险、改live参或授live |
| `AI-SOXL-CODEGEN-IDEMPOTENCY` 高；可继续离线契约/测试，运行接线待持久落点 | 只读复核：SOXL codegen临时根带run/attempt且结束已清理，本地claim不构成跨dispatch持久性；当前没有已配置的持久state入口，WIF仅可读P1，不能借原bucket写状态。gateway禁止跨run读取旧job，结果未知保持停放。原执行后保存与跨dispatch/崩溃窗缺口仍在；CN/GlobalETF已有独立机制，不泛化为全部入口无去重 | 先确定受控持久执行落点及既有权限，再讨论运行接线；不能宣称当前可直接上线闭环。离线固定请求身份、先claim后调用与成功/失败/未知恢复合同，并用合成测试覆盖并发dispatch、调用后落盘前崩溃/重启。不得真实调模型、借权限写bucket或新增治理框架；未知结果不自动重试 |
| `AI-LB-FROZEN-REGRESSION` 高；已合并/主CI通过，新增真实演练与采用待验 | [AAB #313](https://github.com/QuantStrategyLab/AIAuditBridge/pull/313)离线复核175pass/1skip，[exact PR CI37452976196](https://github.com/QuantStrategyLab/AIAuditBridge/actions/runs/37452976196)与[main CI37453537171](https://github.com/QuantStrategyLab/AIAuditBridge/actions/runs/37453537171)均五job全通过；正常合并为 `ddd85c80413ee0c1bd0d663fc80e607692c58ef9`，tree与复核候选一致，任务分支已清理。既有LongBridge历史fixture实际通过；保留原source CI和两文件/一次授权/不自动merge边界 | 新增LongBridge两阶段真实Docker场景与runtime采用仍未证明；既有LongBridge历史fixture及Global/SOXL Docker fixture不替代新增场景演练。冻结基线独立检查资金/订单/风险/通知不变量，AI修改候选测试不修改基线；工程合并与CI通过不表示运行采用或任意自动修复授权 |
| `AI-02` 中；设计已定，分阶段等输入/授权 | 原ADR定义联网研究/策略重写；当前AAB新研究入口主要是固定SOXL模板、固定公开引文和有界目标，不是开放检索任意发明。重构需区分等价实现与新信号候选 | 按既有Fetcher/隔离语料/无网络Planner/Publisher边界，保留来源权利/全trial与失败trial、严格WFA/OOS、paired shadow及原定策略/权限下的采纳。P1–P5原预授权不新增手动gate，P6等明确授权要求不变。无该任务所需真实输入/权限时停车；不自动merge live可执行变更/加杠杆/换源 |
| `AI-03` 高；工程阶段已合并/CI通过，部署与自然周期待验 | AAB日报[PR311](https://github.com/QuantStrategyLab/AIAuditBridge/pull/311)已补齐exact helper hash并同步main，新head `3511c39` 的[CI37449922299](https://github.com/QuantStrategyLab/AIAuditBridge/actions/runs/37449922299)五jobs通过，strict required checks满足；正常合并为 `2369aa3394ebb1c13b61b0bfea0992afd9cb5aa2`，[main CI37450483168](https://github.com/QuantStrategyLab/AIAuditBridge/actions/runs/37450483168)五jobs全部通过，任务分支已清理。99项离线检查通过。旧head CI失败及10:24 UTC的405 required-check阻塞为已解决历史 | 生产部署采用与日报自然周期尚未验收；与DATA-03协调最终caller。区分成功/无样本/缺profile/失败/投递未知，已有结果不重调模型；合并与CI通过不等于部署或真实周期成功 |

### 6.7 统一通知降噪

| ID / 优先级 / 下一步类型 | 分层事实与剩余项 | 前置与完成证据 |
| --- | --- | --- |
| `NOTIFY-01` 高；等受控有效路由投影 | 设计：单bot入口是当前目标；旧文档平台独立bot为历史。实际bot/chat/topic同一性及共享dedup采用未知，同名env/secret不能证明相同 | 按[通知验收合同](notifications-quant-sentinel.zh-CN.md)逐runtime/startup/scanner/plugin/drill/daily提供equality-only证据与观察时间；不读/披露secret。samebot不等于跨服务exactly-once；先复用现有机制 |
| `NOTIFY-02` 中；LongBridge runtime局部修复可立即实施 | 实现：LB scanner已alerts-only；runtime健康无单仍可发送，是独立源码缺口。不要再改scanner或泛称整个通知链未降噪 | 最小通知分类与合成测试：健康无单/dry-run静默；真实submitted/pending/filled及blocked/rejected/unknown、数据/插件/持久化异常保留。不改交易/风险判定、数量或状态 |
| `NOTIFY-03` 中；合并后采用/业务观察期 | 实现/合并：Binance345零关闭状态间隔、IBKR576/Firstrade361/Schwab468 quiet补丁已合；采用/业务：部署、生效配置与真实投递本轮未核 | 核准确source/consumer/生效版本后观察自然周期；健康静默、真实订单/异常可达、重复异常抑制与恢复不漏新事件。CI、not_due或一次没有消息都不等于通过 |

### 6.8 固定来源与已完成阶段

下面只记录已经取得的特定证据，不替代任务关闭条件。

- **QRS #529**：[合并记录](https://github.com/QuantStrategyLab/QuantRuntimeSettings/pull/529)，main `d35b2f83f4ebb7bc1c78fdad054534b4dfd1d3f9`；定向回归、TypeScript/Vite、asset map与CI通过，线上新bundle读回已核。生产503恢复未实测，收益/四基准/其余UI任务不随本修复完成
- **当前配置/记录范围**：[市场与展示配置](https://github.com/QuantStrategyLab/QuantRuntimeSettings/blob/d35b2f83f4ebb7bc1c78fdad054534b4dfd1d3f9/platform-config.json)、[唯一daily target](https://github.com/QuantStrategyLab/QuantRuntimeSettings/blob/d35b2f83f4ebb7bc1c78fdad054534b4dfd1d3f9/web/strategy-switch-console/runtime_daily_contract.js)、[显示名/日期范围实现](https://github.com/QuantStrategyLab/QuantRuntimeSettings/blob/d35b2f83f4ebb7bc1c78fdad054534b4dfd1d3f9/web/strategy-switch-console/frontend/src/presentation.ts)
- **V7与研究分轨**：UESP `842ae78eb8f7c9eb1912e44b433cf7e59ba786d1`的[冻结P2](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines/blob/842ae78eb8f7c9eb1912e44b433cf7e59ba786d1/config/soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve.json)、[nonlive forward](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines/blob/842ae78eb8f7c9eb1912e44b433cf7e59ba786d1/docs/soxl_v7_nonlive_forward_observation.zh-CN.md)、[R6单源开发研究](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines/blob/842ae78eb8f7c9eb1912e44b433cf7e59ba786d1/docs/soxl_v7_r6_twelve_single_source.md)。R5双源blocked与联合账户NOT_ADMITTED不因R6计算完成改变
- **QPK #647**：[live isolation合并](https://github.com/QuantStrategyLab/QuantPlatformKit/pull/647)，main `28675796cabbe137a1fa3970b70d1aa98e952c88`；[supplied interval coverage](https://github.com/QuantStrategyLab/QuantPlatformKit/blob/28675796cabbe137a1fa3970b70d1aa98e952c88/docs/interval_return_coverage.md)。代码/CI证明不包含AAB当前运行pin采用、native账户资金流或QRS收益consumer
- **QSP #77/#78**：[半导体合同](https://github.com/QuantStrategyLab/QuantStrategyPlugins/blob/ccd2db0514070d85fd0ed907816f78e9bf365abd/docs/semiconductor-regime-observer-research.zh-CN.md)、[利率合同](https://github.com/QuantStrategyLab/QuantStrategyPlugins/blob/ccd2db0514070d85fd0ed907816f78e9bf365abd/docs/rates-context-observer-research.zh-CN.md)，当前main `ccd2db0514070d85fd0ed907816f78e9bf365abd`；纯研究合成验收，不是真实源/PIT或runtime采用
- **风险状态与仓位**：[UES研究/合成stateful controls](https://github.com/QuantStrategyLab/UsEquityStrategies/blob/c3e488ea5d13ee1be1ff2295774e328abdc6a05b/docs/strategy_risk_stateful_controls.md)、[QRS资金信封分期](qsl_capital_risk_envelope_v1.zh-CN.md)。后者W1部署字样是历史报告，本轮未独立读回；combined_scale sizing仍未闭合
- **AI设计与实现**：[QPK ADR0005](https://github.com/QuantStrategyLab/QuantPlatformKit/blob/28675796cabbe137a1fa3970b70d1aa98e952c88/docs/adr/0005-research-control-plane.md)；AAB `16f5d6d037b38c7e417f1aeb88b4b60b9d9dcd1c`的[README](https://github.com/QuantStrategyLab/AIAuditBridge/blob/16f5d6d037b38c7e417f1aeb88b4b60b9d9dcd1c/README.md)、[bounded diagnosis](https://github.com/QuantStrategyLab/AIAuditBridge/blob/16f5d6d037b38c7e417f1aeb88b4b60b9d9dcd1c/docs/bounded_research_diagnosis.md)
- **AI两项新finding**：SOXL的[调用后保存顺序](https://github.com/QuantStrategyLab/AIAuditBridge/blob/16f5d6d037b38c7e417f1aeb88b4b60b9d9dcd1c/scripts/run_new_research.py#L1489-L1524)、[run/attempt临时根](https://github.com/QuantStrategyLab/AIAuditBridge/blob/16f5d6d037b38c7e417f1aeb88b4b60b9d9dcd1c/.github/workflows/strategy_optimization_watcher.yml#L1032-L1054)、[最终清理](https://github.com/QuantStrategyLab/AIAuditBridge/blob/16f5d6d037b38c7e417f1aeb88b4b60b9d9dcd1c/.github/workflows/strategy_optimization_watcher.yml#L1167-L1179)、[gateway dedupe](https://github.com/QuantStrategyLab/AIAuditBridge/blob/16f5d6d037b38c7e417f1aeb88b4b60b9d9dcd1c/service/ai_gateway_service.py#L1823-L1845)；LB的[patch复制与局部验证](https://github.com/QuantStrategyLab/AIAuditBridge/blob/16f5d6d037b38c7e417f1aeb88b4b60b9d9dcd1c/scripts/run_monthly_codex_audit.py#L1541-L1655)。边界不扩大到CN/GlobalETF、其他已存在幂等链或全部source CI/merge控制
- **通知合并**：[Binance345](https://github.com/QuantStrategyLab/BinancePlatform/pull/345)、[IBKR576](https://github.com/QuantStrategyLab/InteractiveBrokersPlatform/pull/576)、[Firstrade361](https://github.com/QuantStrategyLab/FirstradePlatform/pull/361)、[Schwab468](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/468)。它们不证明统一bot、全路径dedup或实际Telegram送达

English summary: Six workstreams organize the audit; P0–P6 remains the per-candidate lifecycle. Every stage and review updates the existing task with dated evidence, remaining work and the next bounded step. Design, implementation, consumer adoption and real business acceptance are separate. Preserve historical snapshots and immutable identities; close completed work and leave blocked/observing work bounded by explicit conditions.

<a id="dependency-review-20261006"></a>

### 6.9 2026-10-06 20:08 UTC 当前阶段与依赖复审

本次文档基线是 QRS `efcbc0108c70f5134c4881f2f3f8ef65110742e8`，不把先前 CI、合并或局部真运行扩大为全线业务通过。**Opus 前端美化已由用户确认完成，保留现有样式、布局及组件结构；后续仅补必要的数据、合同和状态接线。** 本节只更新清单，不执行表中开发、取数、发布、配置或交易动作。

“可现在做”表示有界下一步，并非所有项已经启动。owner 是对应阶段的责任写集边界，不新增权限；每仓仍只有一个 writer。同仓不同子题可以并行只读，但写入、公共合同冻结与合并接续必须由该仓 writer 协调。原 P1–P5 预授权不增加手动 gate，原 P6、真实数据/模型、发布、部署及账户操作边界不变。

#### 6.9.1 看板配置体验

19:46 UTC 既有线上会话只读结果：bundle 为 `index-Dn2yBYiw.js`；10 个账户 ROI 均 unavailable，4 条 benchmark 均未取得；PAPER 资产图覆盖 10 月 2–6 日。America/New_York 业务日 10 月 6 日，PAPER 日报无记录，其余 9 个账户未接日报来源。**缺日报来源或当天无记录不能推断策略没有执行。** 当前 `runtime_daily_contract.js` 仍仅绑定 LongBridge PAPER/Russell，`account_facts.js` 提供权益快照并以 `external_cashflow_required` 保持收益 unavailable。

UI-04/NOTIFY-02 共用说明（20:16 UTC 源码补核）：20:02 的 PAPER 运行是 `runtime-target-lifecycle.yml`，只 POST lifecycle；真正的 daily publisher 位于 [execution-report-heartbeat.yml 的日报步骤](https://github.com/QuantStrategyLab/LongBridgePlatform/blob/045be05d47d8c3dff58bd2a4925451d9fcc172af/.github/workflows/execution-report-heartbeat.yml)，原定时为 22:20 UTC，要求 PAPER 及显式开关。因而 19:46/20:02 未见日报不证明程序已坏或报告不存在，实际依赖仍是 publisher/sync 开关、生产报告、是否达到原调度条件及接收 ACK，不能把源码计划当成已发布。

| 原任务 / 当前阶段 | 可现在做 | 真正依赖 | 必须串行步骤 | 结束证据 | owner / 写集 |
| --- | --- | --- | --- | --- | --- |
| `UI-01`：QRS #531 的命名/分轴展示已发布且有限线上验收，未关闭 | 复核 27 项映射/4 对标签在现有 consumer 的一致展示及缺失值 Unknown；不重做美化 | 线上响应字节/hash、四标签全覆盖、中英切换、手机和真实 V7 场景尚缺验收；旧 JS 直读受阻不绕过；V2 历史研究 UI 仍缺 | 当前展示来源确认 → 可得真实场景只读/定向验收 → 仅修必要数据/状态接线 → 回归 | 四标签/双语/手机/真实 V7 各自有证据；默认折叠可展开、分轴与 Unknown 保持；ID/冻结 hash/权限不变，展示不冒充采用 | QRS 单 writer：现有命名/身份数据与状态消费；保留 Opus 样式/布局 |
| `UI-02`：实体/市场展示已有；账户权限仍待核 | 复核账户能力来源合同及 unknown 状态 | 各账户真实市场权限、lot/fractional、paper/live 能力证据 | 权限来源核实 → 冻结能力交集 → 绑定现有页面 | 平台×账户×策略域×标的×通道交集可逐项溯源；实体不充当权限 | 平台 writer：能力来源；QRS writer：能力数据绑定，不改布局 |
| `UI-03`：draft/risk 保存已有；实际应用未验 | 审查既有受限应用合同和合成失败路径 | 原受支持应用入口、当前授权与 runtime 读回 | 草案 → 确认应用 → runtime 读回 → 对应业务周期 | 四步分别有证据；`adopted=false` 不被当成前端故障改掉 | QRS writer：既有受限应用消费路径；平台 writer：原接收端 |
| `UI-04`：真实日报覆盖不足，已定位单目标绑定 | producer 覆盖表与 receiver 合同可并行准备，不等收益或基准 | 各目标已有 producer、账户绑定、业务日/时区/日历及可用真实记录 | 冻结 producer/receiver 合同 → 逐目标接入 → 真实周期验收 | 逐目标首末记录、缺口原因、保留期及 no-order/dry-run/real 区分；not_due/心跳不代替执行回执 | 各平台 writer：已有 producer；QRS 单 writer：receiver 与现有日报数据接线 |
| `UI-05`：历史请求刷新修复已发布；真实恢复仍观察 | 补 first_sample/truncated/retention 状态的合同与回归 | 真实历史保留及自然同类故障；不等多年历史补齐 | 覆盖元数据 → 现有图表状态 → 自然恢复验证 | 10/02–10/06 已观察范围如实显示；366 天上限不冒充 3/5/10 年；失败/切换/晚到结果不串线 | QRS writer：历史数据状态与测试；不补历史、不改样式 |

#### 6.9.2 账户取数、资金流与收益

| 原任务 / 当前阶段 | 可现在做 | 真正依赖 | 必须串行步骤 | 结束证据 | owner / 写集 |
| --- | --- | --- | --- | --- | --- |
| `DATA-01`：真实 ROI 仍不可用；离线合同与导入不必全停 | 原生账本纯文件 import、receiver 与页面数据接线可分工准备，复用 supplied-interval；先核既有 IBKR Activity Flex 样本资格 | 真收益验收等已核账户/期间/币种的出入金、费用、FX 或合格原生 TWR；不能用资产涨幅替代 | 原生字段/会计口径确认 → importer/receiver 合同冻结 → 真实样本对账 → 页面读回 | 区间与现金流可重算、费用/FX覆盖明确、来源与 unavailable 原因可追溯；月度值不拆日线，账户 TWR 不冒充策略归因 | 原生来源平台/QPK writer：既有 import/收益合同；QRS 单 writer：receiver 与数据接线 |
| `DATA-02`：四 benchmark 仍缺真实可比序列 | 四个准确指数/series 的口径、许可与映射核查，可和账本/日报独立推进 | 每序列 price/total-return、币种、窗口、合法可得来源；真实覆盖验收等合格数据 | 明确口径与许可 → 锁定映射 → 消费真实序列 → 同窗口比较 | 四条逐一验证；缺项显式缺失，不填零、不默换 ETF、不混用回报类型 | 数据源责任 writer：映射/资格；QRS writer：现有基准数据消费 |
| `DATA-03`：QPK research/live 隔离已合，AAB consumer 采用未验；新 venv 成功但固定应用未安装；独立 imports-only 已排期 | 固定 `35ac71176127f07e00fe04dbc793777f3c595bc0` checkout + 新 venv 的离线 import/consumer 验证不必等 /opt；冻结日报 caller 后复用既有夹具 | /opt 安装等原受支持且有权限操作器/用户；当前 runner 无写权限，不自动 chmod/chown/sudo；真实 warmup 等有效样本，research API 兼容不证明 runtime 兼容 | 离线独立；运行采用依次取得安装成功、确切来源/import 解析、健康回滚保障，再服务采用与真实周期 | Binance interval 唯一来源；7 日 sync/10 有效日收益、跨 sync 保留、幂等、断点新连续段及 partial-domain 缺 profile 的 health/daily/告警一致；不降阈值/借 CSV 凑数，不将整看板标 research | AAB 单 writer：固定 consumer/日报与现有测试；受支持运维操作器：安装/服务；QPK 仅明确兼容缺口时介入 |

AAB [#322](https://github.com/QuantStrategyLab/AIAuditBridge/pull/322)/[#323](https://github.com/QuantStrategyLab/AIAuditBridge/pull/323) 已合，当前复审 main 为 `b7651526b6d03cc9cb0d25055326763f20939d78`。[新 venv 37504798174](https://github.com/QuantStrategyLab/AIAuditBridge/actions/runs/37504798174) 真运行成功；[应用安装 37516689700](https://github.com/QuantStrategyLab/AIAuditBridge/actions/runs/37516689700) 失败，wrapper 丢失的 installer child exit 仍未知。[19:51 UTC 只读 37521955303](https://github.com/QuantStrategyLab/AIAuditBridge/actions/runs/37521955303) 证明当前 release parent 为 0755、read/execute=true、write=false，固定 35ac target absent，旧 health/daily 仍 failed。它证明当前安装阻塞，不还原此前失败根因；不把旧 failed roots 记为健康 LKG，也不把只读 job 成功当服务恢复。

#### 6.9.3 SOXL/TQQQ、组合复利、仓位与熔断

已有 SOXL RSI2/趋势、TQQQ 因果选择、组合账本、风险预算、Kelly v2 与状态存储；下一步复用这些实现，不从零重建框架。以下研究工作与 AAB 安装、QAR/publisher、通知路由互不等待。

| 原任务 / 当前阶段 | 可现在做 | 真正依赖 | 必须串行步骤 | 结束证据 | owner / 写集 |
| --- | --- | --- | --- | --- | --- |
| `STRAT-01`：QRS #531 冻结命名索引/版本分轴已实现并发布；真实 V7/冻结版本与历史 UI 覆盖仍待验，未关闭 | 核 V5/V7/V9 精确 ID/config、V6 预注册参数、V7 实际 3% 现金保留语义及 R6 独立 study 身份展示；R6 材料只用于此项身份来源核对 | 当前线上响应 hash、真实 V7/R6 身份材料与实际部署 source；旧 ID/冻结 hash 不改，缺材料不补猜；R6 数值研究验收归 STRAT-02 | 定位冻结索引与实际 source → 分别核真实身份/版本区 → 现有页面数据/状态接线 → 定向回归 | 冻结研究索引不冒充部署来源；真实版本区/历史覆盖可追溯；AI 标签对应 trial/输入/模型/输出，不能由版本号或扩展关闭推断 AI 参与 | QRS 单 writer：原冻结命名索引/版本数据展示；UES/UESP：提供原身份来源，不在此任务验 R6 金融结果 |
| `STRAT-02`：原双源 P1/P3、R5/R6 的输入/会计边界仍须分轨；R6 真实 inputs/15 组数值未定位。TQQQ foundation 已有，真实会话桥接/跨轮 trial 留痕未齐 | 定位原 R6 inputs/15 组结果；离线核费用/成交/现金腿会计、session_asof/available_at 夹具及 trial 留痕，复用 `tqqq_qqq_guard_cash_research` journal | 各轨合格真实输入、完整会话与逐行 available_at；当前 `_trial_manifest` 仅本次 12 槽，跨轮采用须明确持久落点；不等 V7 的 252 XNYS 窗口 | 各轨先冻结输入/因果/会计合同 → 同一 UES writer 桥接输入与已有 journal → 合成回归 → 按原授权真实重算 | 分轨核 5/10/15bps、next-session、现金腿/half-L1、股息/FX、已见窗口/锁定 OOS、future/late-row 不变及全 trial/失败 trial；15 组结果可溯源；R6 单源不代原双源/PIT，8 月 P3 不冒充今日重验，负结果保留 | UES 单 writer：既有会计/session_asof、`src/us_equity_strategies/research/tqqq_core_optimization.py` 与 journal/测试；UESP writer：各轨既有输入桥接 |
| `STRAT-03`：原 V7 P4 首个 252 XNYS 有效观察窗口仍须真实积累 | 只读核当前进度、缺口和原冻结绑定 | 252 个真实有效 XNYS 观察及后续固定金融评价；这是确需等待的窗口 | 保留原窗口逐期积累 → 252 门 → 固定 5/10/15bps 评价 → 原后续资格流程 | 原窗口连续可解释、缺口明确、冻结候选一致且评价完成；nonlive 不冒充 broker paper/paired shadow | UESP writer：既有 forward 观察证据；不重置窗口、不自动调参 |
| `STRAT-04`：组合账本/冻结/合成验证已有，真实组合证据未闭合 | 复核既有成分、共同 cutoff、费用与相关性合同，不等其他系统安装 | 共同合法真实 root、净成本 OOS 和各成分资格 | 共同输入与权重/再平衡冻结 → 净成本组合回放 → 原 P3/后续资格 | 组合账户级会计与风险可复算；单策略指标不相加冒充组合收益 | UES/UESP 各单 writer：原组合研究及输入；不建共账户 allocator |
| `STRAT-05`：资金信封/禁新增风险与 Kelly/状态库已有；旧 W1 部署仍仅历史报告，`combined_scale` 平台 sizing 未闭合，真实风控未验 | 按平台×账户×市场×session 核既有风控合同；并核 Kelly exposure API 对 UES pin `62bcd5f6`、UESP pin `5c916917` 旧 sizing blob 的兼容性 | 实际 consumer/运行版本、状态契约与真实权益/持仓/挂单；UES 研究/合成 cooldown/release-state 不证明全平台采用 | 先核既有行为与兼容性 → 必要最小 adapter/各仓定向验证 → 原授权运行采用；复位/减仓/新信封保持独立边界 | 阈值/锁存、日历/缺前驱、中断重启/重复/过期可复核；数据停车不等于市场压力，禁新风险不等于减仓，AI/插件放行或冷却结束不产生新 alpha intent/补仓权 | 平台单 writer：原信封/禁新风险/sizing 消费；UES/UESP 各单 writer：现有风险/Kelly 接口；QPK 只核必要兼容缺口，不盲追 pin |

旧 SOXL SMA/volatility v1 的 F1/F2 静态赢家选择是非因果路径，[原资格文档](https://github.com/QuantStrategyLab/UsEquityStrategies/blob/16a973f817deb58c40b630e84ffe177eeb02e721/docs/research/soxl_v1_static_selection_qualification.md) 已判 FAIL。该负结果保留，不等待新数据来改写资格；如另做因果候选，必须是独立候选与证据，不覆盖旧失败。

#### 6.9.4 市场插件与数据质量

| 原任务 / 当前阶段 | 可现在做 | 真正依赖 | 必须串行步骤 | 结束证据 | owner / 写集 |
| --- | --- | --- | --- | --- | --- |
| `MARKET-01`：QSP #77 半导体三轴/#78 利率观察仍 UNVALIDATED_RESEARCH，PIT/backtest/position-control 未获资格；新增三文件组合 research-only 候选实施中，未测试/发布 | 继续既有来源/时间因果合同与夹具；完成 DESIGN_ONLY 组合 helper 的同维约束测试，保留按优先级取 0.5 的 legacy，不替换为 min=0.1 | 真源许可、available/received/revision、session/复权/因果投影及实际覆盖；真实资格另等经济消融/OOS和获批消费，宽表 CSV 不补逐行发布时间/修订 | 先冻结来源与维度语义 → 纯研究合成验证 → 固定 consumer 绑定 → 真源/经济验收 → 原批准采用 | 来源/PIT/过期/unknown 与冻结绑定可核；QQQ 不充 SOXX、近似 yield spread 不当独立第二票；组合覆盖 0.5/0.1 与维度隔离，legacy 不变，插件/AI 不加仓 | QSP 单 writer：既有半导体/利率来源合同及组合 research helper/测试；不改 legacy arbiter 或平台接线 |
| `MARKET-02`：breadth/NDX 历史结构缺口仍为有界待定项 | 只核既有目标和来源可得性；未选择实施范围前不造新工程 | 历史 membership/prices、许可和实际覆盖 | 先确认独立目标/数据合同，再决定最小实现 | 所选目标可用真源支撑；不以代理/补值填满插件列表 | QSP/数据来源责任 writer：仅获选范围；非上述 helper 的前置 |

组合设计来源：[market-regime-composition-candidate](https://github.com/QuantStrategyLab/QuantStrategyPlugins/blob/5671fa45c6ab373bff79141dab1a9d7b18f59f97/docs/market-regime-composition-candidate.zh-CN.md)。本轮研究固定 SHA：UES `16a973f817deb58c40b630e84ffe177eeb02e721`、UESP `842ae78eb8f7c9eb1912e44b433cf7e59ba786d1`、QSP `5671fa45c6ab373bff79141dab1a9d7b18f59f97`；QPK 指实际仓库 QuantPlatformKit `08ba7a05e15fea31e39641f3ce140edc8f971784`，不代表消费者已经采用该 SHA。

#### 6.9.5 AI 自动化

QAR #79 schedule、RSCP #55 一次 theme/#56 pair gate/#57 身份源代码、PETR #64 身份源代码均已合；两个真实身份检查 [37516981775](https://github.com/QuantStrategyLab/ResearchSignalContextPipelines/actions/runs/37516981775)/[37517264884](https://github.com/QuantStrategyLab/PoliticalEventTrackingResearch/actions/runs/37517264884) 单仓 scope 通过且 token 已撤销。QAR [Weekly 37515064136](https://github.com/QuantStrategyLab/QuantAdvisorResearch/actions/runs/37515064136) 核准五输入 digest、43 条 direct 行情、4 个研究候选与 4 个观察项；AI 仍 untrusted、11 个事件未接受，站点未发布。QAR #80 文档已合；这些证据不证明全部上游恢复或下一周期新数据已具备。

| 原任务 / 当前阶段 | 可现在做 | 真正依赖 | 必须串行步骤 | 结束证据 | owner / 写集 |
| --- | --- | --- | --- | --- | --- |
| `AI-01`：有界诊断链已有；真实闭环按具体入口验收 | 复用既有 finding/Issue 做输入与故障诊断，不重复开项 | 对应失败入口的原始证据与原调用授权 | 固定输入 → 有界诊断 → 同 Issue 结果；未知结果不盲重调 | 特定入口的诊断来源、模型/结果及原失败面解除证据；诊断不等于实验成功 | AAB 单 writer：既有诊断链与测试；和 DATA-03/AI-03 协调同仓写入 |
| `AI-SOXL-CODEGEN-IDEMPOTENCY`：跨 dispatch 持久落点仍未证明 | 可继续纯 claim/调用/崩溃恢复合同与合成测试 | 受控持久执行落点及既有写权限；原 WIF 只读 P1 不能借来写状态 | 落点与权限明确 → 先 claim 后调用接线 → 合成并发/崩溃验证 → 原授权真实验收 | 跨 dispatch 并发、调用后落盘前崩溃、成功/失败/未知恢复可复核；未知停车 | AAB 单 writer：原 SOXL codegen/gateway 边界，不泛化 CN/GlobalETF、不建新框架 |
| `AI-LB-FROZEN-REGRESSION`：#313 工程合并已完成；新增真实场景未验 | 核已有冻结 fixture 的边界与缺失场景 | 两阶段真实 Docker 场景及原运行授权；已有 fixture 不替代 | 固定资金/订单/风险/通知基线 → 候选隔离测试 → 新场景演练 → 原采用流程 | 候选不改冻结基线；新增场景与 runtime 采用分别有证据 | AAB 单 writer：既有两阶段冻结回归，维持原两文件/一次授权/不自动 merge 边界 |
| `AI-02`：联网研究/策略重写设计已接受、实现分阶段；AAB 当前主要为固定 SOXL 模板/公开引文/有界目标，开放检索与任意候选生成未闭环 | 对照原设计核固定入口与开放研究缺口；独立推进 Fetcher/隔离语料/无网络 Planner/Publisher 的纯合同、夹具与有界实现，区分等价重构和新 alpha 候选，不等 QAR 子项目 | 对应任务的合法来源/真实输入、已有工具与模型权限；无输入/权限的真实阶段停车，不能由离线合同推定可上线 | 按既有四边界分批实现 → 来源权利与全 trial 留痕 → 严格 WFA/OOS → paired shadow → 原策略/权限下采纳；P1–P5 不新增手动 gate，P6 原要求不变 | 全 trial/失败 trial、输入/模型/输出来源、WFA/OOS与 paired shadow 有证据；不把固定模板称开放自治，不自动 merge live 可执行变更/加杠杆/换源 | AAB 单 writer：原研究入口与分阶段实现；QPK 仅既有控制面契约的必要兼容，不新建通用框架；QAR/PETR/RSCP 另见下方子项目 |
| `AI-03`：日报源码已合；旧服务仍失败，业务未关闭 | 对固定 caller 做离线 import 与 outcome 合同验证，可和其他仓研究并行 | 与 DATA-03 共用确切应用来源/安装/运行采用条件；自然日报周期 | 离线验证独立；受支持安装/来源/回滚保障 → 服务采用 → 自然日报验收 | 成功/无样本/缺 profile/失败/投递未知各态可信，已有结果不重调模型；CI 不替代日报 | AAB 单 writer：既有日报与 consumer；安装/服务由原受支持操作器负责 |

RSCP [#58](https://github.com/QuantStrategyLab/ResearchSignalContextPipelines/pull/58) 七文件受限 publisher 已合并为 `85e4394384dcfef2dc0fcbf2af7a9efc02e283bb`；source-only、独立禁网复核 452 tests 通过，[main CI 37523498279](https://github.com/QuantStrategyLab/ResearchSignalContextPipelines/actions/runs/37523498279) 已成功且 tree 匹配，source 接线阶段闭合；仍没有真实新 data PR。默认 `publish=false`、内容许可硬 gate 为 false。离线故障诊断、公司证据和 publisher 代码可推进；代码通过不能绕过来源许可、披露 PETR 全文或自动发布站点。

QAR 相关子项目另在本节跟踪，**不替代 AI-02 的开放联网研究/策略重写任务，也不另增主线或稳定 ID**：

- AI 生成故障诊断：当前输入仍 untrusted。可现在核原失败入口、输入/模型/输出来源并做离线诊断；真正依赖是该入口的合法可信来源及原真实调用权限。先明确故障/来源合同，再修最小生成链，取得可信产物后才由 QAR 消费；结束证据是原故障解除与 provenance 可验证。owner 为 RSCP 单 writer，与同仓 publisher 写入串行；不等 PETR 公司证据或站点发布
- PETR 公司证据：当前 11 个事件未接受。可现在核公司归属、证据字段和已有合法来源；真正依赖是可核公司证据及来源权利。先核证据再形成最小派生输入，冻结后交 QAR 验收；结束证据是具体事件通过原接收条件，不能以字段代码已合代替。owner 为 PETR 单 writer；与 RSCP 可并行，禁止公开 PETR 全文
- RSCP 受限 publisher：source 接线阶段已闭合，真实发布仍关闭。可现在核既有候选的诊断结果和下一批派生内容资格；真正依赖是新公开内容的来源许可、可信身份与 pair gate。许可核验 → 按原授权发布真实新 data PR → 冻结新输入 → QAR 新周期消费；结束证据是实际 data PR 与对应消费结果，不能用 #58/CI 替代。owner 为 RSCP 单 writer；QAR 单 writer 只消费冻结输入，公开站点另按原授权处理

#### 6.9.6 统一通知降噪

| 原任务 / 当前阶段 | 可现在做 | 真正依赖 | 必须串行步骤 | 结束证据 | owner / 写集 |
| --- | --- | --- | --- | --- | --- |
| `NOTIFY-01`：统一路由身份仍待 equality-only 验收 | 核现有受保护入口和比较合同，不读取 token | 各 runtime/startup/scanner/plugin/drill/daily 的有效 bot/chat/topic 等同性投影 | 原受保护入口输出脱敏等同性 → 逐目标核同一性 → 原 dedup 采用检查 | 带观察时间的 equality-only 结果；同名变量不等于同 bot，同 bot 不等于跨服务 exactly-once | 原受保护路由操作器；各仓单 writer 只补已有比较/消费缺口 |
| `NOTIFY-02`：LongBridge runtime 健康无单降噪源码已合；自然通知行为未完整验收，PAPER 唯一定向 run 只得 not_due 心跳 | 核 runtime 实际生效版本及最小通知分类；复用已有合成测试和真实周期证据，不重改已 alerts-only 的 scanner | 正确来源/采用版本与对应真实周期；PAPER 本次在读取业务 report 前返回，需有效 cron/到期条件，不能推断报告缺失 | 先核 runtime 分类/采用 → 原受支持到期消费 → 分别核静默与订单/异常通知；不盲重触发 | 健康无单/dry-run 静默；submitted/pending/filled、blocked/rejected/unknown 及数据/插件/持久化异常保留；不改交易/风险判定、数量或状态；HK/SG disabled 非故障 | LongBridge 单 writer：原 runtime 通知分类/测试与受支持验证入口；不改 scanner、禁用目标或交易状态 |
| `NOTIFY-03`：Binance/IBKR/Firstrade/Schwab quiet 代码已合；跨平台采用与真实投递仍未完整验收，仅 IBKR 找到真实 suppressed | 各平台独立核 source/consumer/生效配置并观察自然周期；Binance 阻塞及 NO-GO 实验见下段，不能替代原降噪任务 | 各平台准确采用版本及真实订单/异常/恢复事件；Binance 另等安全的调度/采集处理方案，旧 waiting 不自动批准/拒绝/取消 | 来源/配置核实 → 自然周期 → 健康静默/可达事件/抑制与恢复分别验收；Binance 运行阻塞另按原边界处理 | 健康静默、真实订单/异常可达、重复异常抑制、恢复不漏新事件；CI、not_due、一次无消息或单条 suppressed 均不等于全链通过 | 各平台单 writer：各自既有 quiet 消费/测试与真实证据；Binance 三文件锁迁移实验 NO-GO、不可部署，新方案仅评估 |

已找到的真实抑制证据是 IBKR 02:20 UTC [37403612188](https://github.com/QuantStrategyLab/InteractiveBrokersPlatform/actions/runs/37403612188) 的 `notification_suppressed`，不能外推到全部平台或真实 Telegram 送达。配置事实：Schwab 今日 13:46 业务报告 pass；IBKR 1 enabled/not_due、3 disabled；Firstrade 每月 25–29 日；LB HK/SG disabled、PAPER 经具体确认创建的唯一 [lifecycle 37523397478](https://github.com/QuantStrategyLab/LongBridgePlatform/actions/runs/37523397478) 已 success 并 POST 同一 QRS，但 execution heartbeat 为 not_due，在读取业务 report 前返回；production drift 为 input_source=missing、status=parked、reason=drift_score_unavailable。这不证明今日业务完成，也不证明报告缺失；此前被拒绝的尝试没有创建 run。代码的 30 分钟 publication grace 与 24 小时回看不能代替尚未披露的有效 cron，不能据此承诺 20:15 到期。`not_due`/`disabled` 本身不是故障。

Binance 09:00 UTC [37439913563](https://github.com/QuantStrategyLab/BinancePlatform/actions/runs/37439913563) 主 job success，但后置 native 取数等待 binance-runtime；19:00 UTC [37515617501](https://github.com/QuantStrategyLab/BinancePlatform/actions/runs/37515617501) 先前 pending，20:06 UTC 只读更新为 completed/cancelled，10–18 时的 9 个 run 已取消，[37515052834 watchdog](https://github.com/QuantStrategyLab/BinancePlatform/actions/runs/37515052834) 所见心跳停在 09:01。审批、拒绝或取消旧 run 可能放行后继交易，因此不自动处理，也不重复盲触发。

Binance 精确 runtime-production `66d705f` 的三文件本地实验曾尝试把整 run 锁移到 deploy job，现已判 **NO-GO**：真实 `e46bda` reusable 的最后 source recheck 与独立 POST 之间有 TOCTOU；QRS `binance_account_facts` 只绑定 revision/scope/hash，没有 run/attempt/session epoch，POST 时不核当前 runtime。新 deploy 可在最后检查后开始，旧 snapshot 仍可能被接收；原整 run 锁保护了这一窗口。因此不能发布这版锁迁移，不能以 19 时 run 取消推断恢复。重新设计受保护的 read→POST，或拆出可选采集的方案及代价，均尚未实施。

**接续顺序：** QRS producer/receiver、原生账本 import/数据接线、指数口径映射可以独立准备；QSP research-only 组合 helper、UES 会话合同/夹具及 trial 留痕可按仓分工推进；AI 诊断、PETR 公司证据、RSCP publisher 可并行研究。共享仓写集与公共合同接续必须串行。真正等待的是各任务指定的真实来源/许可/权限或原 V7 观察窗口，不是所有工程都等数据、AAB /opt 或 252 天。未启动事项保持“可做”，负结果、未运行与未验收状态保留。

English update: The six workstreams and existing task IDs are unchanged; seven presentation groups are not a seventh workstream. Preserve the completed Opus styling and layout. Contract/fixture/import work can proceed independently of real-data qualification, the AAB installation blocker and V7's original 252-session observation window. Serialize shared-repository writes, contract handoffs and authorized runtime adoption. Only task-specific real evidence closes business acceptance; source tests, CI and one successful run do not establish full recovery. RSCP publisher source wiring is merged with passing CI, while content permission and real publication remain gated. LongBridge returned not_due before reading its business report. The Binance deploy-only lock experiment is NO-GO because it leaves a read-to-POST race; replacement designs have not been implemented.
