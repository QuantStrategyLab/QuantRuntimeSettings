# WEB-API-GAP-01 CHANGE_PLAN

状态：非作者独立审查 PASS；见 plan-review.md。

基线：`origin/main=d14ac6c3d5d55f662834c7ddc54e9df06a5b5dab`，实施分支 `codex/web-api-gap-01`（原 checkout 遇实际并发写入后隔离）。输入：`out/WEB-DESIGN-REVIEW-01-evidence/inputs/WEB-GAP-01.md`。该盘点引用的线上后端为 `e2aab576`，不能把 main 的已有修复当作已上线。本轮未读取生产业务正文或凭据。

## 路由和已确认问题

- 六个 performance API：`/api/performance/{calendar,summary,returns,assets,holdings,trades}`，入口 `application/console_api/performance_routes.js`，聚合 `performance.js`。前三类收益依赖真实历史/现金流，持仓依赖 facts.positions，成交固定 `fills_not_connected`。
- `/api/account-facts`、`/api/account-facts/history`：`application/account_facts/read.js` 在账户配置/绑定读取抛错后吞错并继续返回空数据，是可复现的错误语义缺陷。
- `account_facts.js` 已保留 LongBridge `balances[].total_cash`、`cash[].available_cash/frozen_cash/settling_cash`，IBKR/Schwab/Firstrade `cash[].cash_balance`；前端当前已消费 total_cash/cash_balance。真实 HKD/SGD/Firstrade 缺数根因未确定，不能声称只是投影遗漏。
- `/api/runtime-daily`：worker.js 已投影 read_error_codes 和部分 runs，但未给出独立于业务执行状态的读取完整性分类。`/api/runtime/today` 在无 record 时不看读取错误，且吞掉原因代码；HTTP/载荷读取失败与无记录混淆。
- `/api/strategies/summary`：`operations.js` 丢弃已规范化的逐策略 `as_of`、`freshness`、components 和 source_revision，仅返回 score/status 和页面快照时间。
- live/paper：`strategy_execution.js` 已保留 raw target 证据，但摘要缺少账户 broker_environment 与标签证据完备性；不得根据别名、catalog allowed modes 或历史 run 推断环境。

## 最小改动（只读、加法兼容）

1. `application/account_facts/read.js`：配置/绑定读取异常返回固定脱敏 503（不抛原始 provider 文本），停止该读路径，不返回假空态。真实未配置仍保留现有空态；history 同步修复。
2. `account_facts.js`：在每账户增加 `cash_by_currency` 只读投影，币种仅来自已验证 balances/cash；金额仅取已有 cash_balance 或 total_cash，各自记录来源字段。available_cash 不冒充余额。缺值为 null + 固定原因；保留原 cash/balances 不变，无新币种猜测、求和或换汇。
3. `worker.js` 的 runtimeDailyReadStatus（共用 runtime_daily_contract.js 诊断函数） + `operations.js` todaySummary：增加独立 `read_status`（complete/partial/read_failed/unknown/no_data/not_connected）及固定原因代码；coverage_unconfirmed/truncation/unmatched/conflicts 属不完整，实际读取错误属错误。保留部分 runs、stale 与业务结果；无记录且有读取错误不能标 no_data。不得回写生产记录，不能宣称修复历史 17 格的上游读取。
4. `operations.js`：逐策略透传已规范化的 as_of、freshness、components、受限 source_revision，并标注固定快照来源和 score 范围 0–100。快照 computed_at 单独保留，不替代逐项时间。缺失策略保持 null/unknown。单项 freshness=stale 时行状态不能 ok；不生成评分或计算权重。
5. `strategy_execution.js` + 调用点：摘要附 broker_environment 和展示 `execution_label`/缺失原因；只有明确 target mode/dry_run_only 与明确 broker_environment 一致时给 live/paper；冲突/缺证为 unknown，dry_run_only=true 保留 dry_run。原 execution_mode 作为配置证据保留，不授予运行权限。
6. performance_routes.js：facts 非 2xx 且 holdings 无 rows 时返回 unavailable/stored_records_unreadable；无关历史/benchmark 失败不改持仓语义，trades 保持 fills_not_connected。
7. 如现有 backend JSON schema 需要，给上述加法字段补定义（不改 frontend contracts/源码）；在现有 tests 中挂入一份聚焦回归，确保既有 CI 执行。无生产依赖变更。

## 测试

先做回归 RED，再实现：facts config/binding 抛错不成功空态、不泄漏异常；HKD/SGD/负现金/真实零现金/缺失 Firstrade 的合成 fixture；runtime 无记录读错、部分 runs、纯覆盖未知、传输失败/401/403、日期/绑定不符；health 逐项旧时间/缺时/缺分/缺策略；live/paper/dry_run/环境冲突/无证据。六个 performance API 定向验证错误与部分数据契约、保留 holdings 未接入/fills 未接入和现金流开关。

运行相关既有账户事实、runtime daily、health/summary、performance、contract 和 Worker 集成测试；记录每条命令退出码及输出。CI 使用仓库既有 Validate，不改 workflow。验证只使用合成数据，无 broker/生产 KV 请求。

## NEED_USER / owner（只报告，不实施）

IBKR 旧快照需逐账户最新生产者成功时点、接收时点、绑定一致性和固定错误码的只读证据；持仓需已有 `broker_reported_positions`/scope 的真实源覆盖；成交需新的只读 fill 契约（账户、成交 id、时间、币种、数量、金额及窗口 coverage）；出入金需现有 externalFlow 契约的真实窗口完整性与只读来源。现金缺失需逐币种原生余额字段及 source_tag，不可用购买力代替。日历源/未绑定 runtime/评分方法和缺失模式证据均由相应 owner 提供。新权限、绑定、开关、采集及部署需要另行明确授权；本卡不修改。

## 审查与 Git

用户明确要求非作者审查：由独立只读 reviewer 检查此计划、准确基线与范围，保存 verdict/findings；PASS 后作者实现。同一 reviewer 可按实际补丁检查相关风险，无固定循环。

已核对部署 workflow 仅 workflow_dispatch；push/PR/auto-merge 不触发该部署。发布前再次检查 workflow 触发器；如出现合并即生产部署则停止 auto-merge。只提交本卡后端/测试、`out/WEB-API-GAP-01.md` 及本卡证据；保留其他既有 out 文件不提交。PR/auto-merge 获本次任务授权；不触发部署、不改 App/Secrets/IAM/生产配置、不交易。

Chrome：不适用。最终分别报告 API 代码修复、真实数据接入、PR/CI/合并和未部署状态。
