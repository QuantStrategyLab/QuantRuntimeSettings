# WEB-GAP-FIX-06 独立复审

结论：**PASS**。复审者为非作者子智能体 `/root/web_gap_fix_06_independent_review`。比较基线为 `a97a4a5cce956428fd2fc24ee42ce5103bc08cc1`，审查对象为本工作树当前改动及新增源码、测试、契约文档和脱敏只读证据。复审者未修改产品、测试或配置，未 commit、push、调用远端写入或部署。

## 已发现并修正的问题

1. 旧响应缺少 `execution_evidence` 时，策略卡曾继续使用 legacy `execution_mode=paper` 等字段展示确定值；该字段可能来自既有别名推断。当前 `frontend/src/lib/accountExecution.ts:7` 在缺新对象时统一返回 unknown；`frontend/src/pages/strategies/StrategiesPage.tsx:57` 统一使用共享来源组件。独立复核了旧 paper/live/dry_run 响应均为 unknown 的回归。
2. 检查时点原先通过 DateText 仅显示日期，丢失时分和时区。当前 `frontend/src/components/ExecutionEvidence.tsx:10`、`:20` 使用含年份的 formatDateTime，显示时分和时区，并保留完整 ISO time 属性。双语 SSR 回归覆盖时分、GMT 与 ISO 属性。

以上路径相对 `web/strategy-switch-console/`；未发现剩余需要阻止本卡合并的实质问题。

## 实质检查

- 新对象仅接受明确账户目录券商环境，以及已有账户匹配后来自 RUNTIME_TARGET_JSON / CLOUD_RUN_SERVICE_TARGETS_JSON 的执行配置；别名、默认值和 STRATEGY_PROFILE 的旧投影不补新确定值。
- 缺源、缺字段、冲突、403、500、分页后页失败保留 unknown 与原因；失败的 scoped 读取丢弃部分结果。新对象不含凭据、上游正文或内部账户标识。
- 新字段可选，旧策略、启停、执行字段保留。仅来源说明的 currentStrategies 记录允许存在，其旧策略/启停值仍缺省；契约文档与回归说明此变化。
- summary 透传检查时点，健康数据时点不替代配置检查时点；runtime_observation_status 始终 unknown。页面明确配置读取不能证明运行或成交。
- 已检查脱敏只读来源文件：实时目录会话不可见，GitHub Variables 的部分明确配置不能可靠绑定指定九户。保持 unknown + 权限/来源缺失原因符合本卡边界；本复审没有把这些配置认定为九户已确认配置，也未读取 Secret 值。

## 独立执行验证

| 命令 | 最终退出码 | 结果 |
| --- | --- | --- |
| `node --test tests/console_execution_evidence_validation.mjs` | 0 | 5 项通过，覆盖明确配置、缺来源、失败、分页、summary、双语 SSR 与时间 |
| `node --test tests/console_runtime_state_validation.mjs` | 0 | 108 项通过 |
| `node tests/console_strategy_execution_validation.mjs` | 0 | PASS，含旧响应未知回归 |
| `node --test tests/fe8b_fix03_ui_validation.mjs` | 0 | 3 项通过 |
| `node tests/console_v2_assets_validation.mjs` | 0 | 76 references，27 assets served |
| `git diff --check` | 0 | 无空白错误 |

修正时间展示后曾有一次新 SSR 测试退出 1：React 静态渲染输出 `dateTime`，断言仅接受 `datetime`；按实际输出改为大小写不敏感断言后，本复审再次独立执行该测试，5 项全部通过。产品语义未因该断言修正改变。

## 范围与限制

实际读取 Skill：`requesting-code-review`（`/Users/lisiyi/.codex/skills/requesting-code-review/SKILL.md`）与 `verification-before-completion`（`/Users/lisiyi/.codex/skills/verification-before-completion/SKILL.md`）。

Chrome 不适用：本复审进行源码与服务器静态渲染验证，没有声称真实浏览器页面验收。前端构建、operations 汇总与 Python 全量失败归因由作者另行记录，不能由本报告的定向测试替代。远端 CI、PR、auto-merge、部署及生产实际效果不属于本次复审者执行结果；本卡禁止部署。本 PASS 支持当前代码改动，不代表九户实际运行模式或成交已获验证。

复审完成时点（UTC）：2026-10-22T22:49:16.734011+00:00
