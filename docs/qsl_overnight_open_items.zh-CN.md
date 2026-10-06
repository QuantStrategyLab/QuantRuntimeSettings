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
