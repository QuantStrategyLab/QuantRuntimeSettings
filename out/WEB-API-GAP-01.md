# WEB-API-GAP-01 网站后端数据缺口（第一批）

结果：**部分完成。后端投影与错误语义已本地修复；真实上游数据补齐、生产部署和业务验收未完成。** 本卡不修改前端、App、Secrets、IAM、生产配置，不交易、不升风险。生产版本未因本卡改变。

基线 `d14ac6c3d5d55f662834c7ddc54e9df06a5b5dab`；实施分支 `codex/web-api-gap-01`。输入为 WEB-GAP-01，只读盘点引用后端 `e2aab576`，不是本轮生产 readback。原盘点是 **14 日窗口内 17 个读取失败格子**，不能写成已确诊连续 17 天后端故障。

CHANGE_PLAN 非作者审查 PASS 后实施；补丁及加法 schema 补核也 PASS，见 [计划](WEB-API-GAP-01-evidence/CHANGE_PLAN.md)、[计划独审](WEB-API-GAP-01-evidence/plan-review.md)、[补丁独审](WEB-API-GAP-01-evidence/patch-review.md)。独审不等于真实数据或生产验收。

## 实际修复

| 项目 | 改动与效果 | 保留的限制 |
| --- | --- | --- |
| facts 读取错误 | account-facts 及 history 的账户配置/绑定读取抛错返回脱敏固定 503：account_options_unreadable / account_facts_bindings_unreadable；不再继续返回假空态 | 真正未配置仍按原契约为空；没有恢复上游认证或绑定 |
| 逐币种现金 | 每账户新增 cash_by_currency，币种来自已验证的 balances/cash。只用 cash.cash_balance 或 balances.total_cash，附 source_field；负值和真实零原样保留 | 缺金额为 null/unknown/cash_balance_not_reported；available_cash 不冒充现金余额；无币种证据则 []；不生成 HKD/SGD，不补 Firstrade 金额，不改原 cash/balances |
| 运行读取分类 | runtime-daily 和 runtime/today 增加 read_status、read_failure_reason、read_error_count、白名单 read_error_codes；区分 coverage_incomplete、source_read_error、unauthorized、daily_binding_mismatch、coverage_unknown | 部分 runs 保留；failed/blocked 执行结果不被读错覆盖；stale 单独保留。read_incomplete 的旧业务状态仍保留，前端可用新字段区分原因；未修复旧生产材料 |
| 无记录与未知 | 无 record 且有读取问题不会显示 no_data；计数缺失为 null/unknown，不假定读取成功；完整性不足时总 runs 为 null | 只有明确无读取问题且无 record 才是 no_data；无记录不代表没运行 |
| 策略健康 | 每策略透传 health_as_of、health_freshness、health_components、固定 health_source、仅 hash 格式的 health_source_revision；逐项 stale 不继承快照 ok。页面 as_of 仍是快照时间 | 分数只透传，缺失仍 null；0–100 是现有归一化范围，不是自行定义评分算法；methodology=not_provided。缺少逐项时间仍 null，未重算或更新评分 |
| live/paper 证据 | configured_accounts 增加 broker_environment、execution_label、mode_unavailable_reason。live/paper 需显式 raw target + dry_run_only=false + 匹配券商环境；dry_run 需显式目标证据 | STRATEGY_PROFILE 按名称推断的 paper 不作为证据；冲突/缺证为 unknown。保留原 execution_mode 配置字段；runtime_observation_status=unknown，不代表近期运行/成交或授权 |
| holdings 错误 | facts 非 2xx 且持仓无可用行时返回 unavailable/stored_records_unreadable，避免误报未接入 | 无关历史/benchmark 失败不抹去有效持仓；trades 继续 fills_not_connected，不编成交数 |

本卡文件：`web/strategy-switch-console/account_facts.js`、`runtime_daily_contract.js`、`worker.js`、`application/account_facts/read.js`、`application/console_api/{operations,performance_routes,strategy_execution}.js`、`contracts/console-api.schema.json`；测试 `tests/web_api_gap_validation.mjs`、`console_api_worker_validation.mjs`、`runtime_daily_worker_validation.mjs`、`console_design_api_validation.mjs`、`console_grouping_runs_validation.mjs`。最后两项只修正测试 fixture 的实际接口字段，没有改前端。

新增字段为加法兼容。前端源码未改，新 cash/health/read/label 字段尚需前端按契约消费；已有 cash_balance/total_cash 已被当前 main 前端消费，不能把真实现金缺失笼统归为前端漏消费。

## 六个 API 的定位

六个 `/api/performance/*` 共用 `application/console_api/performance_routes.js → performance.js`；同时核查其 facts/history、cashflow 和运行/健康依赖。

| 路由 | 既有字段/聚合 | 本卡结论 |
| --- | --- | --- |
| calendar | cells、coverage、现金流/交易日原因 | 不补空日期；失败 facts 不能成为成功空数据，已回归验证 |
| summary | 分币种当前余额、TWR、max_drawdown、coverage | 保留估值日期/多币种/现金流限制，不用资产变化冒充收益 |
| returns | points、per_currency、unavailable_reason | 保留原计算与来源约束；本卡不新增插值、补点或历史数据 |
| assets | history_per_currency、per_currency、account_freshness | 原生余额与历史覆盖分开；不把旧快照改成新鲜 |
| holdings | rows、coverage、positions_scope、account_freshness | 有效 positions 可投影；facts 读取失败语义已修；缺成本的盈亏仍 null |
| trades | not_connected / fills_not_connected | 没有已接入 fill 契约；不返回假 0 交易或胜率 |

## WEB-GAP-01 逐项归属

“权限缺失”只在有证据时确认。本轮无生产授权会话读回、provider/KV 原始错误或真实金融正文，所以下表不会把原因 unknown 升格成已确认权限故障。

| 原因代码 | 层/分类 | 本轮结果或后继 |
| --- | --- | --- |
| AUTH | 权限/会话待确认 | 历史 401、匿名 403 与浏览器 200 不能互相覆盖；本卡不恢复登录，NEED_USER |
| KV | 权限/绑定/读取链待确认 | 历史 Wrangler 401 不足以定位 token scope；NEED_USER，只读诊断后另定 |
| SNAP | 上游时效缺口，具体链路 unknown | IBKR 旧时点保留 stale；NEED_USER，未恢复采集 |
| IDENT | 身份/纳入条件不足 | 保留现有身份和重复账户保护；NEED_USER，不改绑定 |
| CASH | 已有原生字段已返回；真实缺值层 unknown | 加明细缺失语义；HKD/SGD/Firstrade 真值仍 NEED_USER |
| FLOW | 上游现金流窗口覆盖未证明 | 保留 unknown；NEED_USER，未启用采集 |
| SWITCH | 生产配置当前值未读回 | 不改 CONSOLE_EXTERNAL_FLOW_ENABLED，NEED_USER |
| CAL | 上游交易所节假日日历未接入 | 仍 holidays_unknown；NEED_USER，不选新数据源 |
| MIX | 聚合口径限制 | 保留 mixed_currency/valuation_date_mismatch 与原生币种，不自行换汇 |
| HISTORY | 上游历史覆盖不足 | 缺失日期需真实 history 只读证据；NEED_USER，不回填 |
| POS | 契约已有、生产覆盖未证明 | positions 只从验证过且 fresh 的 broker_reported_positions 投影；缺源仍未接入，NEED_USER |
| FILL | 上游未接入 | 固定 not_connected；新 fill 契约与只读源 NEED_USER |
| RUN_BIND | 每日源未绑定/未覆盖 | 保持 not_connected，不改生产绑定，NEED_USER |
| RUN_TODAY | 无今日材料 | no_data 与读取失败分开；无材料不等于未运行，生产者 NEED_USER |
| RUN_READ | 接口投影/错误语义 + 上游完整性 | 增加独立分类并保留部分 runs；17 格原始原因仍 NEED_USER |
| PARAM | 接口仅 known 才给值 | 原七字段 unknown 保持 null，不顺带调整参数；源有效值待 owner 核对 |
| DECISION | 上游材料/绑定/时效不足 | 不改决策或 before 值；显示名/文案属于前端后继 |
| NOTICE | 通知生产者/覆盖 unknown | 未发送通知；原 send-log 部分/错误语义不变，生产覆盖 NEED_USER |
| HEALTH | 接口未返回逐项元数据 + 前端未消费 | 本卡补 API；缺 15 项评分及算法/逐项时点仍 NEED_USER；前端未改 |
| MODE | 明确执行证据不足 + 接口投影 | 本卡补 evidence label；9 户未知不按名称猜，源证据 NEED_USER |
| RESEARCH | 前端未消费/上游摘要是否存在 unknown | 不生成研究结论；owner 先确认原摘要契约，本批未修 |
| RISK | 当前六页未接入风险字段 | 独立范围，未改前端、risk authority 或实际风险；NEED_USER/对应卡 |
| COPY | 前端文案 | 本批写集外，未改 |
| UNKNOWN | 缺证 | 保留 unknown，不伪造分类 |

## NEED_USER：最小证据与权限/契约建议

以下只列缺口，没有申请或实施新权限。真实映射和金融原文应留在受保护存储，公开材料只保留不可关联占位符、时间和固定状态码。

| Owner / 项目 | 精确缺口与最小后继 |
| --- | --- |
| IBKR 生产者 + receiver owner | 每个受保护绑定的 latest_success_at、latest_received_at、binding_matches、固定 error_code；用现有只读报告核对“生产者→接收→投影”哪步中断。确实缺权限时仅授该来源/账户/时间窗的日志或快照读取，不新增执行权限；修复/部署另批 |
| 现金源 owner | 指定缺失原生币种余额字段、观察时点及 source_tag；LongBridge total_cash、IBKR/Schwab/Firstrade cash_balance；不得以 available_cash、购买力、净资产倒推。当前不能确认是否权限故障 |
| 持仓源 owner | 现有 broker_reported_positions + broker_reported_positions_scope，逐行 symbol/quantity/market_value/currency，按账户绑定与观察时间验证；没有成本就保留盈亏 unknown；新增读取/采集/部署另批 |
| 成交源 owner | 新的只读契约至少：绑定账户、稳定成交 id、成交时间、标的、方向、数量、价格/金额、币种、覆盖窗口/分页终止证据与重复处理；明确空窗口和未接入。只读成交权限不能授予订单权限；本批不新增实现 |
| 出入金源 owner | 沿用 external_flow.v1：windows 的 currency/date/period_start/period_end/coverage/source/records；记录 source_ref/type/amount/effective_at/settlement_date/transfer_ref。真实 complete 窗口及去重/转账证据缺失；空列表不能自行证明 complete。Firstrade 不在当前 SOURCES allowlist，需另定契约，不冒用其他平台 source |
| 配置 owner | 先读回现金流非秘密开关状态。只有真实数据验收、独审、变更卡及用户明确批准后才讨论修改生产开关；本卡不提出直接开启 |
| runtime 生产者 | 17 个具体日期/绑定的 fixed read_error_codes、count、completeness、现有 runs 数、最新 observed_at；无需提供对象路径/日志正文。分类代码不能修复旧错误记录；缺失/未绑定账户需源及绑定 owner 单独处理 |
| health 生产者 | 每策略 as_of、freshness、不可变 revision、component/score、评分方法和阈值说明；缺值原样缺失。本卡尺度不证明评分有效或可交易 |
| 模式/账户配置 owner | 明确 broker_environment、raw target execution_mode、dry_run_only、可信 mode_source 及绑定一致性；缺失或冲突维持 unknown。任何账户配置修改/风险变化另批 |
| 日历/历史/通知/研究/有效设置 owner | 指定现有只读源与覆盖范围，先证实缺在哪层；缺新源、新权限或生产发布时停止，不在本批顺带实施 |

## 验证与限制

全部本地测试使用合成数据和 mock/Miniflare；没有 broker、生产 KV、生产 API 业务正文或真实订单请求。Chrome：**不适用**。未导出浏览器会话、未读或打印 Secret。

- 先写 11 项聚焦回归，RED 退出 1；第一版有一处 binding fixture 缺 schema，随后修正并保留两份 RED 日志。有效 fixture 的失败证据覆盖原假空态/读取错误/元数据缺失/持仓语义，部分新增字段在旧代码不存在。
- GREEN 退出 0，覆盖两 facts 路由的配置/绑定异常、现金负数/真实零/缺值、部分运行/无记录/401/403/503/绑定不符、健康逐项 stale/null、显式模式与六 performance API。
- 既有账户事实、runtime daily（含 health 集成）、API/Worker/schema、策略模式、gap contract、performance 数据/数学/现金流/分币种测试通过；tsc 与 git diff --check 通过。具体命令与退出码见 [初轮检查](WEB-API-GAP-01-evidence/validation-checks.json)、[返修检查](WEB-API-GAP-01-evidence/validation-followup.json)。初轮两失败保留，最后 design 验证见 validation-design-final.log（退出 0）；其导入的 grouping fixture 也补齐真实读取计数。
- 并发写入出现后按 using-git-worktrees 隔离，本卡补丁迁至 `~/codex-jobs/worktrees/web-api-gap-01-qrs`；他人前端/risk 改动未带入。原地只精确撤回本卡 tracked hunks，不覆盖他人工作；迁移 patch 留作证据。
- 未运行全仓 Python 套件：本批不改 Python，远端既有 Validate 将按仓库配置执行。PR、CI、合并与生产部署各自记录，不互相替代。

## PR 与远端状态

PR：待创建。只提交本卡后端/测试、此报告和本卡证据；不提交原有 out、依赖目录或其他任务。auto-merge 仅沿用既有规则，不用 admin 绕过检查；部署 workflow 仅 workflow_dispatch，不触发它。

## 实际使用 Skill

| Skill | 实际读取的 SKILL.md |
| --- | --- |
| plan-and-patch | ~/.codex/skills/plan-and-patch/SKILL.md |
| requesting-code-review | ~/.codex/skills/requesting-code-review/SKILL.md |
| verification-before-completion | ~/.codex/skills/verification-before-completion/SKILL.md |
| finishing-a-development-branch | ~/.codex/skills/finishing-a-development-branch/SKILL.md |
| test-driven-development | ~/.codex/skills/test-driven-development/SKILL.md |
| using-git-worktrees | ~/.codex/skills/using-git-worktrees/SKILL.md |
