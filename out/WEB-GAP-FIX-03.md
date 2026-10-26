# WEB-GAP-FIX-03

状态：实现与定向验证完成，非作者独审复核 **PASS**；PR/auto-merge 与远端CI待执行。未部署。

## 结果与改动

选择 WEB-GAP-01 §11 的 **SETTINGS-UNKNOWN**，明确排除 FACT-COVERAGE 与 RUNTIME-READ。选择理由及来源/字段/失败语义见 [CHANGE_PLAN](WEB-GAP-FIX-03-evidence/CHANGE_PLAN.md)，输入路径与SHA256见 [input.json](WEB-GAP-FIX-03-evidence/input.json)。独立 worktree `/Users/lisiyi/Projects/QuantRuntimeSettings/.worktrees/web-gap-fix-03`，分支 `codex/web-gap-fix-03`，基线 `289fec431ea14264ec028207c5c627fa39ecf231`。原 checkout 未提交产品改动保持原样。

- `web/strategy-switch-console/worker.js`：新增独立 effective_read 七字段元数据，逐项返回来源、固定原因、空源时间。区分缺 reader、缺仓库映射、缺账户配置、读取失败、成功读取但字段未解析、DCA不适用及策略未知。变量读取错误报告仅用于有效设置路径，其他调用保持原fallback；分页失败不保留前页值。
- `application/console_api/presentation.js`：settings diff 七行增加 current_source/current_reason/current_source_as_of；旧无元数据输入明确来源/时间未知，不暴露任意上游原因正文。
- `contracts/console-api.schema.json`：增加相应可选字段契约，兼容旧输入。
- `tests/account_settings_worker_validation.mjs`、`tests/console_api_worker_validation.mjs`、`tests/console_design_api_validation.mjs`、`tests/console_presentation_validation.mjs`：沿原CI入口覆盖真实 Worker HTTP读失败、分页失败、配置缺失、未知/不适用、显式0/false、旧输入、投影和脱敏。
- Worker双语README同步接口语义。

source=github_runtime_configuration 只说明已有配置解析路径，不声称字段来自特定变量、当前部署或券商回读。现有 resolver 的匹配、优先级和known值未改；原 effective 值形状不变，DCA不适用时仍省略值字段，原因在独立元数据中明确表达。无法解析的字段原因是 runtime_setting_unresolved，不能区分缺失、非法或未匹配，不伪造更细根因。source_as_of=null；不把请求时间当源时间。unknown无value，diff current=null；显式0/false仍是known值，不补0、不插值、不沿用旧值。

读取失败时HTTP200仍表示已读到状态投影，不表示有效设置已知；原鉴权、DO失败及身份冲突HTTP/status语义保留。broker_environment使用独立身份来源，不被有效设置源失败抹掉。没有改前端、账户参数、配置绑定、生产开关、存储写入或执行权限。

## 实际验证

新增真实Worker用例先RED：源metadata和diff原因均undefined，退出1；实现后GREEN。见 [RED](WEB-GAP-FIX-03-evidence/red-validation.json)、[首轮GREEN](WEB-GAP-FIX-03-evidence/initial-green-validation.json) 和 [定向检查](WEB-GAP-FIX-03-evidence/focused-validation.json)。日志只保留本地，不提交账户正文或凭据。

返修最终命令记录见 [review-fix-validation.json](WEB-GAP-FIX-03-evidence/review-fix-validation.json)。

| 命令 | 退出码 / 结果 |
| --- | --- |
| `node tests/account_settings_worker_validation.mjs` | 0，真实Worker与resolver读取失败/分页/隔离/0/false |
| `node tests/console_api_worker_validation.mjs` | 0，含七行diff/鉴权/草稿权限/DO |
| `node tests/console_design_api_validation.mjs` | 0，旧输入、字段投影、脱敏 |
| `node tests/console_api_contract_validation.mjs` | 0 |
| `node --experimental-strip-types tests/console_presentation_validation.mjs` | 0，含真实后端值形状→原DCA消费函数回归 |
| `node tests/account_settings_state_validation.mjs` | 0 |
| `node --check web/strategy-switch-console/worker.js` | 0 |
| `python3 python/scripts/runtime_settings.py validate` | 0 |
| `python3 -m unittest discover -s python/tests -v` | 1：873 tests，11 failures、10 skipped |
| 精确基线导出后运行 `python3 -m unittest discover -s python/tests -p test_checkout_internal_dependency_consumers.py -v` | 1：13 tests，同样11 failures |
| `git diff --check` | 0 |

Python失败均在未改的checkout consumer脚本：macOS系统Bash缺少mapfile。基线脚本与测试通过git show导出到独立临时目录复现；见 [baseline-validation.json](WEB-GAP-FIX-03-evidence/baseline-validation.json)。python/.github/workflows/frontend与基线diff退出0。未为此修改脚本、解释器或断言；远端Linux CI结果另列。CONTRIBUTING旧scripts/tests路径以当前README/CI的python/scripts、python/tests为准。

Worker/frontend `npm ci --prefix ...` 均退出0，锁文件未改，分别报告已有3/1个high漏洞；本卡未升级依赖。初审DCA兼容问题已修正，首次FAIL保留，非作者已复核PASS。独审者另独立执行 `node tests/strategy_switch_worker_validation.mjs`（exit0），覆盖共享reader原调用者；本机Node26移除了旧 `--experimental-default-type=module` 参数，初次命令exit9，改用原生ESM命令后通过，没有修改实现或断言。

## 独审与PR

非作者 `/root/web_gap_fix_03_independent_review` 初审发现P2：显式新增非DCA对象触发旧页面错误显示未核实的定投设置。已验证并改为独立effective_read元数据，保持原effective值形状，补真实后端解析→旧消费函数回归。原FAIL及复核见 [独审记录](WEB-GAP-FIX-03-evidence/independent-review.md)。最终复核 **PASS**，9个变更产品/测试/文档文件SHA256与 [implementation-hashes.json](WEB-GAP-FIX-03-evidence/implementation-hashes.json) 逐项一致。独审者独立运行HTTP Worker/状态/展示/契约/default-reader回归及非DCA/DCA缺失/403三场景探针全部exit0。独审后产品/测试不再改动。PR/auto-merge与远端CI待执行；仅后续补本地交付证据。

## 权限、部署与限制

无新权限或凭据需求，无NEED_USER。测试只消费合成账号/变量和本地Worker/DO；GitHub只读/PR工作使用已有认证，没有访问真实GitHub配置变量、券商、生产KV或账户正文。未改IAM、Secret、配置、采集、通知或交易。部署工作流仅workflow_dispatch，本卡未修改workflow、不dispatch、不部署。本地测试和CI不代表生产源权限、数据补齐或业务恢复。Chrome：不适用，未使用。

## 实际读取并采用的Skill

- plan-and-patch：`/Users/lisiyi/.codex/skills/plan-and-patch/SKILL.md`
- using-git-worktrees：`/Users/lisiyi/.codex/skills/using-git-worktrees/SKILL.md`
- test-driven-development：`/Users/lisiyi/.codex/skills/test-driven-development/SKILL.md`
- requesting-code-review：`/Users/lisiyi/.codex/skills/requesting-code-review/SKILL.md`
- verification-before-completion：`/Users/lisiyi/.codex/skills/verification-before-completion/SKILL.md`
- finishing-a-development-branch：`/Users/lisiyi/.codex/skills/finishing-a-development-branch/SKILL.md`
