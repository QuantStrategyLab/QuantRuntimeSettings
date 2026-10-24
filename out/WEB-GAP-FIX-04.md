# WEB-GAP-FIX-04

状态：后端 NOTIFICATION-RECEIPT 读取状态实现完成，非作者独审 **PASS**；PR/auto-merge 与远端CI待发布回读。未部署。

## 结果与改动

选择 WEB-GAP-01 §11 **NOTIFICATION-RECEIPT** 的后端读取完整性子项；排除 FACT-COVERAGE / RUNTIME-READ / SETTINGS-UNKNOWN。CASH-FIELDS 已在开放 PR #758 中，避免重复实现；AUTH-READ 需要浏览器，KV-READ 需要生产只读身份核实。本项用已有 reader 和合成公开回执独立验收，无需新权限或设计评审。具体范围见 [CHANGE_PLAN](WEB-GAP-FIX-04-evidence/CHANGE_PLAN.md)，输入定位与 SHA256 见 [input.json](WEB-GAP-FIX-04-evidence/input.json)。

独立 worktree `/Users/lisiyi/Projects/QuantRuntimeSettings/.worktrees/web-gap-fix-04`，分支 `codex/web-gap-fix-04`，基线 `193b2d7f56ae5141ebf21ab79eeb89873ec4c9f8`。原 checkout 其他未提交产品改动保持原样。

- `application/console_api/notification_receipts.js`：增加 read_status / 固定 read_reason_codes；区分完整、部分、已证空列表、覆盖未知、读失败、未接入。旧 status 在缺回执、过期、sender skipped、列表截断/缺行/覆盖未知时也为 partial。保留已有可读条目，非法运行不丢弃其他条目，403/读取错误不变成成功空态。
- `application/console_api/operations.js`：未接入 fallback 同步元数据。
- `contracts/console-api.schema.json`：可选加法字段，兼容旧输入。
- `tests/console_notification_receipts_validation.mjs`：补合成 Actions/ZIP/HTTP路由覆盖，已由既有 design API 测试入口纳入CI。`tests/console_api_worker_validation.mjs` 断言真实Worker未接入状态、保留401/405与只读标记。
- Worker双语 README：解释范围与时间语义。7个源码/测试/文档文件哈希见 [implementation-hashes.json](WEB-GAP-FIX-04-evidence/implementation-hashes.json)。

`complete` 只证明最近最多5次已完成 main 分支日报运行的列表未截断、且这些运行都有可读公开回执；即便送达失败或 dry_run，读取仍可完整。它不证明全通知覆盖、当前业务日覆盖或真实送达。`no_data` 仅在 total_count=0 且空列表时成立，不表示今天没有通知。列表未知/截断与读取失败分别编码，read_failure_count 保留实际读取失败计数，不把缺回执计成访问错误。

逐条业务日、报告日、送达布尔值和流程时间保留来源；公开回执无发送时间时 sent_at=null，不用 as_of/流程时间代替。不补0、不插值、不补点、不合成回执或金额。既有部分条目、缓存、鉴权、来源SHA校验、ZIP白名单及GET边界保留。没有前端、发送者、存储、采集、账户设置或执行权限变更。

## 验证与限制

先RED：新增read_status断言得到undefined，退出1；实现后GREEN。见 [red-green.json](WEB-GAP-FIX-04-evidence/red-green.json)。定向命令与退出码见 [integration-validation.json](WEB-GAP-FIX-04-evidence/integration-validation.json)。

| 命令 | 退出码 / 结果 |
| --- | --- |
| `node tests/console_notification_receipts_validation.mjs` | 0，覆盖完整/空/未知/截断/缺行/过期/skipped/部分或全部403/非法运行/缓存/脱敏/路由鉴权 |
| `node tests/console_design_api_validation.mjs` | 0，包含通知回归及旧 API 投影 |
| `node tests/console_api_worker_validation.mjs` | 0，真实 Worker 路由/401/405/未接入/只读标记 |
| `node tests/console_api_contract_validation.mjs` | 0 |
| `node --check web/strategy-switch-console/application/console_api/notification_receipts.js` | 0 |
| `node --check web/strategy-switch-console/application/console_api/operations.js` | 0 |
| `git diff --check` | 0 |
| `python3 python/scripts/runtime_settings.py validate` | 0 |
| `python3 -m unittest discover -s python/tests -v` | 1，873 tests，11 failures，10 skipped；系统Bash缺少mapfile，精确基线同样11 failures |

首次 design API 运行 exit1：独立 worktree 尚未安装 frontend/esbuild。按已有锁文件 npm ci 后重跑通过。Worker/frontend npm ci 均exit0，未改依赖或锁文件；已有audit项未升级。详见 [首轮检查](WEB-GAP-FIX-04-evidence/focused-validation.json)、[依赖安装](WEB-GAP-FIX-04-evidence/dependency-install.json)。原始合成测试/安装日志保留本地，不提交日志正文。

Python失败均在未改的 checkout consumer 脚本/测试。精确基线导出后运行 `python3 -m unittest discover -s python/tests -p test_checkout_internal_dependency_consumers.py -v`，exit1，13tests同样11fail；未改脚本、解释器或断言。见 [Python结果](WEB-GAP-FIX-04-evidence/python-validation.json)、[基线复现](WEB-GAP-FIX-04-evidence/baseline-validation.json)。远端Linux CI另行验收。

## 独审与PR

非作者 `/root/web_gap_fix_04_independent_review` 对精确基线、7个变更文件与SHA256只读审查，最终 **PASS**。独立运行通知、design API、Worker集成、语法与diff检查均exit0，回执见 [independent-review.md](WEB-GAP-FIX-04-evidence/independent-review.md)。未参与作者实现；独审后的产品/测试文件不再改动。

调用方既有限制：`frontend/src/pages/health/HealthPage.tsx:234` 对空items提前返回普通空态，所以API的unknown/partial空列表尚未分别渲染；非空partial仍显示既有警告。本卡只验收后端来源/状态，不声称页面展示完整性已修复。前端修复属于独立后续项，不影响本卡API读取状态验收，不自动扩大本卡范围。

PR/auto-merge、必需CI和最终状态待发布回读；不绕过保护，不删除分支/worktree。PR中本报告为发布前快照，发布后状态只补本地报告和证据。

## 权限与部署

无需新权限/凭据，无 NEED_USER。没有读取生产KV、真实回执、账户材料或改变IAM/token/Secret/绑定。测试仅合成fetch/本地Worker；GitHub发布使用已有认证。部署workflow仅workflow_dispatch，本次workflow未改，不dispatch、不部署、不重发通知。代码测试、远端CI和生产业务恢复分别报告；生产真实数据未验，本卡不承诺已补齐。Chrome：不适用，未使用。TASK_CHECKLIST最终更新一行。

## 实际读取并采用的Skill

- plan-and-patch：`/Users/lisiyi/.codex/skills/plan-and-patch/SKILL.md`
- using-git-worktrees：`/Users/lisiyi/.codex/skills/using-git-worktrees/SKILL.md`
- test-driven-development：`/Users/lisiyi/.codex/skills/test-driven-development/SKILL.md`
- requesting-code-review：`/Users/lisiyi/.codex/skills/requesting-code-review/SKILL.md`
- verification-before-completion：`/Users/lisiyi/.codex/skills/verification-before-completion/SKILL.md`
- finishing-a-development-branch：`/Users/lisiyi/.codex/skills/finishing-a-development-branch/SKILL.md`

只读参考（为判断前端限制而实际读取，最终未修改前端、未执行浏览器流程）：

- build-web-apps:react-best-practices：`/Users/lisiyi/.codex/plugins/cache/openai-curated-remote/build-web-apps/0.1.2/skills/react-best-practices/SKILL.md`
- build-web-apps:frontend-testing-debugging：`/Users/lisiyi/.codex/plugins/cache/openai-curated-remote/build-web-apps/0.1.2/skills/frontend-testing-debugging/SKILL.md`
