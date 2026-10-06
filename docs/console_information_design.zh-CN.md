# 日常管理控制台

本次只调整信息组织和操作呈现，保留现有账户、策略权限及确认流程，不增加服务、依赖或费用。

## 日常需要回答的问题

| 页面 | 主要内容 | 次级内容 |
| --- | --- | --- |
| 运行总览（默认） | 全部已配置账户、配置开关、实际读回、记录时间；明确待确认和不一致 | 筛选、搜索、进入指定账户；确实需要人工处理的事项 |
| 账户管理 | 选择平台和账户；查看当前策略、配置开关、最近运行检查及其记录时间 | 实际开关、调度和应用状态折叠展示；需要调整时再展开策略设置 |
| 研究与确认 | 选择接受候选时的意向平台，先查看待确认候选或明确空状态 | 风险解释、旧票据和历史研究记录按需展开 |

不把研究时间当作页面刷新时间；不把“配置启用”当作“运行正常”。读回缺失、过期或未明确关联账户时，保持待确认。记录时间明确表示读回时间，不冒充成交时间或最新成功周期。首页不展示原始 ticket、SHA、JSON、设计预览风险数据，也不伪造收益、余额或健康状态。

账户页不根据正在编辑的运行环境生成“实盘就绪”结论。正常浏览不显示表单字段的伪就绪清单；编辑错误继续通过具体字段说明和主操作提示显示，未保存变更继续显示在变更摘要中。

总览只在确有材料完整、等待人工确认的候选时显示研究入口。旧票据和待核实材料仍留在研究页的折叠历史中，不冒充当前待办。研究材料过期与读取失败分开显示；材料过期时不能断言当前没有新的决策事项，也不用其他来源的较新时间冒充整组研究材料的更新时间。

研究数据仍保留，移到单独页面；现有实盘恢复、停用、策略切换和研究确认保持各自的权限与提交保护。查看、搜索、筛选、刷新均为只读操作。

## 布局与文案

- 电脑：固定窄侧栏，主区域约 1120 px；四项配置统计、紧凑状态提示、账户列表。
- 手机：顶部三项导航；统计为两列；账户列表变为纵向信息块，不依赖横向滚动；账户详情同样纵向排列。
- 导航固定为“运行总览 / 账户管理 / 研究与确认”。首页标题“运行总览”，说明“查看已保存的配置、实际读回与最近运行记录。”。
- 状态与操作均有中英文；每项操作使用语义化按钮和清晰焦点。主要触控目标至少 44 px。
- 配色：背景 `#f6f7f9`、正文 `#172d35`、辅助文字 `#667680`、主色 `#10766a`、边线 `#dfe6ea`；待确认用中性色，不自动标成故障；配置不一致用浅琥珀色。
- 字体沿用系统无衬线字体；主标题约 32 px，正文 14–15 px；手机主标题 26 px。间距以 8 px 为基本单位，圆角约 8 px，不使用装饰图表。

## 交互与验证

验证默认总览、准确定位账户、配置/实际状态分离、不同编辑运行环境不改变实际状态文案、当前可审候选入口、研究空状态、过期与读取失败分流、研究历史折叠、搜索和筛选、刷新时间、语言切换以及电脑/手机布局。线上仅检查读取和导航；提交类操作在隔离测试数据中验证，不能为了页面测试触发实盘。

## KV 用量与心跳审计

运行目标心跳每次仍保存完整最新快照，包括来源时间和实际读回时间；不通过停止刷新或延长有效期节省额度。只有时间更新、其他归一化状态不变时，不再向可选的滚动审计列表追加重复同步记录。首次同步、启停或策略变化、运行异常及恢复、过期读回恢复、调度读回变化仍追加审计。人工操作和其他类型的审计不受此规则影响。

这使状态不变的单次心跳同步从两次 KV 写入降为一次。以十个目标每小时各同步一次估算，这一路径每天从 480 次降为 240 次写入；这不是整个 Cloudflare 账户的实际用量。实际告警类别及总量须查看账户统计，不能从测试计数推断。

免费 KV 每日读取额度为 100,000 次，写入、删除、列表请求各为 1,000 次，北京时间 08:00 重置。优先核对触发类别并消除重复操作；套餐升级不属于代码优化的隐含步骤。参见 [Cloudflare KV 定价与额度](https://developers.cloudflare.com/kv/platform/pricing/)。

## 2026-10-06 补充验收合同

本节是待实施/待验收要求，不声称以下能力已经上线。任务状态和依赖只在[六主线清单](qsl_overnight_open_items.zh-CN.md#six-track-audit-20261006)维护：`UI-01` 至 `UI-05`、`DATA-01` 与 `DATA-02`。每个阶段或审计结束后更新对应任务，避免另起一套完成状态。

### 策略名称与技术身份分开（UI-01）

- 面向人的主名称放现有中英文 label 字段。已有 `strategyDisplayName` 读取 `label_zh` / `label_en`；技术 profile/key、immutable candidate ID、历史对象路径和证据 digest 不作展示改名。
- 展示名说明标的与方法；候选版本、source revision、参数版本/config hash、角色、运行通道和证据时间分别展示。首层保持简短，详情能定位完整身份。重复展示名必须可区分，旧记录继续可查。
- `candidate` / `challenger` / `champion` 是研究与采用角色；`research` / `shadow` / `paper` / `live` 是不同证据或执行通道。“可选择”“已保存配置”“实际运行”另有各自事实，不能用名称互相推导。
- SOXL V7 冻结合同是实际保留 3% 现金的 source-correctness 候选，保留 V6 预注册参数；`v7` 不是 AI 优化七次的证明。代码是否经 AI 起草也不能由版本号或 `ai_extensions=disabled` 判定。没有对应 trial、输入/模型/输出来源证据时，不标“AI 自动生成”。
- R5 / R6 研究轨道、信号候选、策略源码 revision 与参数 config hash 不混为一个版本。R6 保留 V7 信号但有独立 study/input/evaluation 身份，不能继承原双源 P1/P3 证据。

### UI-01 本地展示映射（2026-10-06）

以下是基于 QRS `74a9d937c929f1c5bc067cb047d2d413df579a1e` 的本地候选，不表示已合并或部署。`platform-config.json` 仍是目录 label 的唯一来源，沿用现有生成器。只调整 V7、两个美股核心组合与加密池轮动的四对标签，其余 23 对保持不变；没有修改参数、账户、策略 ID 或权限。目录整体 `content_sha256` 随标签重算，它不是冻结策略 config hash。

| Stable profile / key（不变） | 中文展示名 | English display name |
| --- | --- | --- |
| `tqqq_growth_income` | 纳斯达克增长收益 | NASDAQ Growth Income |
| `soxl_soxx_trend_income` | 半导体趋势收益 | Semiconductor Trend Income |
| `soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve` | SOXL/SOXX 核心复利（现金保留） | SOXL/SOXX Core Compounding (Cash Reserve) |
| `nasdaq_sp500_smart_dca` | 纳指标普定投 | NASDAQ/S&P 500 DCA |
| `ibit_smart_dca` | IBIT比特币定投 | IBIT Bitcoin DCA |
| `global_etf_rotation` | 全球ETF轮动 | Global ETF Rotation |
| `russell_top50_leader_rotation` | 罗素Top50领涨 | Russell Top50 Leaders |
| `tecl_xlk_trend_income` | TECL/XLK趋势收益 | TECL/XLK Trend Income |
| `us_equity_combo` | 美股核心收益组合 | US Core Income Combo |
| `us_equity_combo_core` | 美股核心组合 | US Core Combo |
| `us_equity_combo_leveraged` | 美股加速组合 | US Alpha Combo |
| `hk_global_etf_tactical_rotation` | 港股ETF战术轮动 | HK ETF Tactical Rotation |
| `hk_low_vol_dividend_quality_snapshot` | 港股红利质量 | HK Dividend Quality |
| `hk_equity_combo` | 港股恒生组合 | HK Core Combo |
| `cn_industry_etf_rotation` | A股行业ETF轮动 | CN Industry ETF Rotation |
| `cn_industry_etf_rotation_aggressive` | A股ETF轮动 | CN ETF Rotation |
| `cn_index_etf_tactical_rotation` | A股宽基ETF战术轮动 | CN Index ETF Tactical Rotation |
| `cn_chinext_tactical_rotation` | 创业板战术轮动 | CN ChiNext Tactical Rotation |
| `cn_chinext_growth_momentum_quality` | 创业板成长动量质量 | CN ChiNext Growth Momentum Quality |
| `cn_dividend_quality_snapshot` | A股红利质量 | CN Dividend Quality |
| `cn_chinext_growth_momentum_quality_snapshot` | 创业板成长质量快照 | CN ChiNext Growth Quality Snapshot |
| `cn_star_growth_momentum_quality` | 科创板成长动量质量 | CN STAR Growth Momentum Quality |
| `cn_equity_combo` | A股进取组合 | CN Alpha Combo |
| `crypto_live_pool_rotation` | 加密池轮动 | Crypto Pool Rotation |
| `crypto_btc_dca` | BTC定投 | BTC DCA |
| `crypto_trend_rotation` | 山寨趋势轮动 | Altcoin Trend |
| `crypto_equity_combo` | 加密动量组合 | Crypto Core Combo |

既有发布门不会因仅 label 变化覆盖私有策略目录，故前端只对上述四个精确 ID 读取同一生成资产中的规范标签；未知 ID 与其余私有标签保持原样。该展示归一化不更新私有目录版本、参数或运行采用状态，也不从规范标签推导 role/source。

美股核心收益组合与核心组合分别保留原有含收益层/不含收益层的目录区分；名称不确认当前启用情况。加密策略采用中性的“池轮动”，避免未验证的实时或 live 能力暗示。重复标签仅在选择项中加完整技术 ID 消歧；首层不追加 source/config hash。

所有 27 个目录 profile 均未提供实际策略 source revision、研究角色或实测运行通道：显示“未知 / Unknown”。V7 的目录 `research_candidate_identity` 只提供 immutable candidate ID 与 `843ab4…514d1` 配置摘要；其余 26 个目录 profile 的 candidate/config 字段同样未知。`lifecycle_stage`、`allowed_execution_modes`、账户环境、配置启用与名称不填补这些字段。

现有账户当前配置、策略选择/草案、研究待办详情与应用卡使用统一展示 helper，并把完整技术身份放入默认折叠的详情。来自具体票据/候选/应用记录的字段独立读取，不用今日目录修补旧记录的 candidate/config/source 缺口；票据创建时间不是证据时间。策略选择值和请求仍提交原始 ID，技术编号与原始方案仍保留。

#### 冻结研究版本索引（STRAT-01）

以下映射只描述固定的研究源码与候选配置，不代表实际部署、采用或运行状态。界面的“冻结研究版本”仅在材料 candidate ID 与 config digest 同时精确匹配时出现；来源资料缺少 source revision 时，其资料字段仍为未知，不从索引补值。候选版本来自精确索引，不解析任意 ID 后缀。

| Immutable candidate ID | 中文 / English 展示名 | 候选版本 | 冻结 UES revision | 冻结 config SHA-256 |
| --- | --- | --- | --- | --- |
| `soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve` | SOXL/SOXX 核心复利（现金保留） / SOXL/SOXX Core Compounding (Cash Reserve) | V7 | `07b164d95f2ab4d4c54fd993f6f2040bd207d664` | `843ab4e93e81985c2b3becc61a2f0b971508ccf25afa59acf402e75f574514d1` |
| `tqqq_core_only_p2_v5` | TQQQ 核心趋势 / TQQQ Core Trend | V5 | `5f0c30cdcaf3ee0f3f1c050acbe172580ea40c81` | `e6422cf7c3819734ec300a7bfa3d936d5273993c0ce865dfe0218d7b7f8426e2` |
| `tqqq_core_only_p2_v9_benchmark_drawdown_guard` | TQQQ 基准回撤防护 / TQQQ Benchmark Drawdown Guard | V9 | `fe5c0377faa11b0010243e3ef32f8b7256d63992` | `c2c3d7ce1333f8f1675f40cd4c45ffa89d83f0dcf99b2a475840d0f87ab64dce` |

V7 冻结 QPK revision 为 `f30e7b1910df8da22fdcedc347ab847df5adcd76`，V5 为 `730ad9f3983bd90cd75adecb67fcf483ffb96736`；V9 本索引未核到独立 QPK pin，保持未知。V7 的 3% 为冻结策略实际保留现金的 source-correctness 语义，不是当前账户现金读回。

R6 的 study ID 为 `soxl_v7_twelve_basic_split_close_development_v1`，input contract 为 `qsl.soxl-v7-twelve-single-source-r6-input.v1`。它沿用同一个 V7 信号和配置，另有单源开发研究输入/评价身份；不继承原双源 P1/P3，不形成 champion、paper、shadow 或 live 结论。当前目录/票据 read model 未提供 study ID 时显示未知，不由 V7 名称推定 R6，也不从 study ID 自动补候选身份。

冻结来源（UESP `842ae78eb8f7c9eb1912e44b433cf7e59ba786d1`）：[SOXL V7 config](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines/blob/842ae78eb8f7c9eb1912e44b433cf7e59ba786d1/config/soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve.json)、[TQQQ V5 config](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines/blob/842ae78eb8f7c9eb1912e44b433cf7e59ba786d1/config/tqqq_core_only_p2_v5.json)、[TQQQ V9 config](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines/blob/842ae78eb8f7c9eb1912e44b433cf7e59ba786d1/config/tqqq_core_only_p2_v9_benchmark_drawdown_guard.json)、[R6 study 合同](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines/blob/842ae78eb8f7c9eb1912e44b433cf7e59ba786d1/docs/soxl_v7_r6_twelve_single_source.md)。

#### 本地验收与剩余限制

- 已运行：新命名/身份回归（中英、重复名、未知字段、V7/R6 分轴、hash 不匹配、不可变请求 ID、真实 React 组件离线 SSR）；现有账户状态/设置/历史、总览刷新、业务表达等定向回归；TypeScript/Vite 构建和现有资产生成
- 未运行：浏览器实际点击、桌面/手机截图；隔离 localhost 页面在云端浏览器被 `net::ERR_BLOCKED_BY_CLIENT` 阻止。SSR 不替代交互、布局或真实业务验收
- 当前 V2 没有已渲染的历史研究折叠区。本补丁不新增历史页面；历史显示仍是 UI-01 的后续验收依赖，保留已有历史 ID、方案字段和绑定，不声称“历史 UI 已验收”
- 本地候选未合并、未部署；实际账户与线上 source/config/role/lane 取证未完成，UI-01 / STRAT-01 不关闭

English summary: Four bilingual catalog labels are refined; 23 remain unchanged. Stable IDs, parameters, permissions and frozen candidate hashes are preserved. Frozen research versions are explicitly separate from observed material fields, and missing fields stay Unknown. Local regression/SSR/build checks do not establish browser, historical-UI, deployment or real-account acceptance.

### 平台能力、账户实体与交易市场（UI-02）

实体/注册地、账户环境、交易市场、币种、交易日历和执行能力独立表达。LongBridge 平台配置与策略 registry 同时支持美股和港股；香港实体不能推导为只支持港股，也不能据平台能力推断某账户已获相同权限。

参数可选项取平台、真实账户权限、策略域、标的和执行通道的已验证交集。逐账户记录能力来源、观察时间及缺失项；权限不明保持待确认。平台的整股/整手、fractional/notional、paper/live 和日历差异须逐项验证，不能用注册地字符串或默认配置补证。

### 配置保存与实际采用（UI-03）

一般账户设置保存当前只生成草案/风险偏好，`apply_strategy=false`、`activation=false`、`adopted=false` 是真实边界。已有单独受限的 profile-only 确认路径不能证明日常设置页已接通。后续按原授权验证保存、确认应用、runtime 读回与实际周期，不以移除安全状态或调用实盘完成 UI 验收。

### 90 天记录与历史覆盖（UI-04、UI-05）

当前日期控件允许美东业务日期的最近 90 个日历日；现有 `runtime_daily_contract.js` 只绑定 LongBridge 的一个 paper/Russell 目标。它不是全部账户的 90 天 producer/留存证明。后续清单须列每个目标的 producer、准确账户绑定、市场时区/日历、首末记录、保留策略、缺口及原因。`not_due`、HTTP 成功、心跳存在和有日期按钮都不能当作真实业务周期完成。

正常无单、dry-run preview、真实提交/待对账/成交和失败分别显示；未知不能刷成绿色。跨目标切换不能复用另一账户的周期记录。美股、港股与 24/7 市场分别使用合适的业务日口径。

账户资产历史当前最多保留 366 天，但图表提供 3/5/10 年范围。必须呈现实际首个样本、截断/保留信息，空窗不补点；短记录不能冒充多年历史。验收包括失败刷新、同时间戳重试、旧请求晚到、卸载、币种/账户切换和缺口提示。QRS #529 已修刷新依赖，不等于线上故障重现与恢复已经验收。

### 真实收益与四条基准（DATA-01、DATA-02）

资产/现金快照不是收益。只在账户、币种、源、期间、方法、费用/外部资金流与覆盖得到资格验证后显示对应收益。券商给出的账户期间 TWR 不自动成为策略收益；月度 TWR 保留为一个期间观察，不拆成日线。缺失值不填零，也不使用研究 CSV 修补实盘来源。

四条图例 S&P 500、Nasdaq、Dow Jones、Russell 不是四条已取得的序列。后续明确各自准确指数/series、价格或总回报方法、来源许可、币种、期间与可比性；独立 FRED 价格 iframe 不等于账户比较。实际收益与基准覆盖不一致时标记缺口，不把价格指数和总回报静默混用。

English summary: These are acceptance requirements, not claims of runtime adoption. Keep display labels separate from immutable strategy/candidate/source/config identities. Account permissions, market coverage, daily-record coverage, qualified account returns and benchmark series require independent evidence.
