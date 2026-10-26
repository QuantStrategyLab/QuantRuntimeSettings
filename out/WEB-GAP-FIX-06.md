# WEB-GAP-FIX-06

状态：代码、逐户缺失原因与本地验证完成；非作者独立复审 **PASS**，PR/auto-merge 待最终回读。**未部署**。本卡接受明确缺失原因，因此不会为了消除 unknown 修改账户配置。9 户的当前实际模式仍不能证实：当前 CLI 的生产目录读取缺少获准会话，不能把仓库目标与当前账户绑定。

## 逐户结果与只读证据

输入为 `out/WEB-DESIGN-REVIEW-01-evidence/inputs/WEB-GAP-01.md:145-153` 的 9 户；LongBridge·模拟不在这 9 户中。输入是历史清单，不冒充当前配置。

目录检查 A：`GET https://qsl-strategy-switch-console.pigbibi.workers.dev/api/config`，curl exit0、HTTP200，但 `accountOptions=null`；检查时点 **2026-10-22T22:45:13.100832+00:00**。源码 `configPayload` 明确在会话未获准时隐藏账户目录；HTTP200不等于已取得目录。见 [live-directory.json](WEB-GAP-FIX-06-evidence/live-directory.json)。未读取会话凭据、未导出返回正文。

| 账户（历史显示名） | 本次已证实模式 | 明确缺失原因 | 来源与时点 | 补充只读观测 |
| --- | --- | --- | --- | --- |
| LongBridge·新加坡 | unknown | 权限不足：当前目录不可见，券商环境与目标绑定无法核验 | 目录检查 A，2026-10-22T22:45:13.100832+00:00 | environment longbridge-sg 的 RUNTIME_TARGET_JSON 读取成功，含 live / false；当前目录绑定不可见 |
| LongBridge·香港 | unknown | 权限不足：当前目录不可见，券商环境与目标绑定无法核验 | 目录检查 A，2026-10-22T22:45:13.100832+00:00 | 候选 environment longbridge-hk 的目标变量不可见（404不能区分不存在与权限隐藏） |
| IBKR·SOXL | unknown | 权限不足：当前目录不可见，券商环境与目标绑定无法核验 | 目录检查 A，2026-10-22T22:45:13.100832+00:00 | 服务目标清单读取成功，4个显式 live / false；当前账户与服务的精确绑定不可见 |
| IBKR·TQQQ | unknown | 权限不足：当前目录不可见，券商环境与目标绑定无法核验 | 目录检查 A，2026-10-22T22:45:13.100832+00:00 | 同上；不从策略名或别名选择4个服务中的任一个 |
| IBKR·Global ETF | unknown | 权限不足：当前目录不可见，券商环境与目标绑定无法核验 | 目录检查 A，2026-10-22T22:45:13.100832+00:00 | 同上；当前账户与服务的精确绑定不可见 |
| IBKR·Russell Top 50 | unknown | 权限不足：当前目录不可见，券商环境与目标绑定无法核验 | 目录检查 A，2026-10-22T22:45:13.100832+00:00 | 同上；当前账户与服务的精确绑定不可见 |
| Schwab·实盘 | unknown | 权限不足：当前目录不可见，券商环境与目标绑定无法核验 | 目录检查 A，2026-10-22T22:45:13.100832+00:00 | RUNTIME_TARGET_JSON 读取成功，含 live / false；当前目录绑定不可见 |
| Firstrade·实盘 | unknown | 权限不足：当前目录不可见，券商环境与目标绑定无法核验 | 目录检查 A，2026-10-22T22:45:13.100832+00:00 | 仓库目标变量不可见（404不能证明配置缺失）；当前目录绑定不可见 |
| Binance·实盘 | unknown | 权限不足：当前目录不可见，券商环境与目标绑定无法核验 | 目录检查 A，2026-10-22T22:45:13.100832+00:00 | RUNTIME_TARGET_JSON 为 live / false，BINANCE_DRY_RUN=false；当前目录绑定不可见 |

逐户结构化结果见 [account-audit.json](WEB-GAP-FIX-06-evidence/account-audit.json)。同一目录读回同时限制9户；表中权限不足指本次执行通道缺少获准会话，不声称 Worker 的 GitHub reader 没权限，也不声称这些账户实际没有配置。

GitHub 补充读取在 `2026-10-22T22:41:48Z` 至 `22:42:46Z` 之间完成，源为各平台仓库的 Actions/Environment Variables，具体来源路径、时点、变量更新时间和每次退出码见 [github-configuration.json](WEB-GAP-FIX-06-evidence/github-configuration.json)。成功读取仅确认候选目标明确含 `execution_mode=live`、`dry_run_only=false`，不自动确定券商环境或当前目录绑定。内部服务/账户标识已转为摘要，不导出账户正文；404记为不存在或不可见，未偷换成确定缺配置。没有采用账户名“实盘”、策略名、scope别名、默认值、余额或风险档位来推断模式。

GitHub 插件没有 Variables 读取能力，本项使用已登录 `gh api` 只读访问指定非 Secret 变量；未访问 Secrets API。Google Cloud 仅查询当前 project 名称，没有读取或变更云服务。

## 改动与契约

基线 `a97a4a5cce956428fd2fc24ee42ce5103bc08cc1`，分支 `codex/web-gap-fix-06`，隔离 worktree `.worktrees/web-gap-fix-06`。原 checkout 的其他未提交修改未动。

- `worker.js`：当前配置 reader 记录每个账户的来源、检查时间和失败状态；权限不足、网络/解析/分页失败、未配置 reader 都明确保留 unknown。分页失败丢弃该次 scoped read 的所有值，不新增外部请求。保留现有账户匹配逻辑和旧配置字段。
- `application/console_api/strategy_execution.js`：新增纯只读 `accountExecutionEvidence`，只采纳明确目录环境与已匹配目标的原始执行投影；不使用默认值、别名或旧 STRATEGY_PROFILE 的 paper 推断。`operations.js` 将同一对象传到策略摘要。
- `frontend/src/api/contracts.ts`、`lib/accountDirectory.ts`：声明可选 `execution_evidence`。对象含 `value/status/reason_codes`、券商环境、执行配置、演练限制、两种来源和 `observed_at`；`runtime_observation_status` 固定 unknown。
- `frontend/src/components/ExecutionEvidence.tsx`、`AccountGroups.tsx`、`pages/strategies/StrategiesPage.tsx`、`lib/accountExecution.ts`、`i18n/pages/accounts.ts`：总览/账户卡与策略卡使用相同展示，unknown 显示具体原因；缺新字段的旧响应/旧缓存也保持 unknown。检查时间显示年月日、时分和时区，缺时点显示破折号。页面说明仅为配置读取，不表示当前运行/成交。
- `docs/console_execution_evidence.md`：中英契约、来源与时间语义。未解析账户可新增仅含证据字段的记录；旧策略/执行模式/启停字段仍缺省，不补0或默认值。缓存保留原检查时间，不拿页面刷新时间冒充源时点。
- `tests/console_execution_evidence_validation.mjs`：正例、缺字段、未知不补值、冲突、旧paper推断、未接入、403、500、分页失败、摘要透传、双语真实组件SSR与完整时点断言；另更新 `console_runtime_state_validation.mjs`、`console_strategy_execution_validation.mjs`、`fe8b_fix03_ui_validation.mjs` 的相关契约/旧响应回归。
- `frontend/package.json`：新回归纳入既有 CI 的 `test:operations`；`v2_asset_map.js` 按现有 build/sync 生成27项资源。没有升级依赖或修改锁文件。

上述路径除 docs/tests 外均位于 `web/strategy-switch-console/`。不触及风险 API、风险档位、高级设置、账户参数、IAM、Secret 或业务配置；没有新增写 API。

`observed_at` 是检查尝试时间，包括失败，不是配置修改、部署或业务运行时间。unknown 的显示不代表生效配置。实盘提交到明确模拟券商显示模拟；明确 paper 与 live 券商冲突时 unknown；live 缺明确演练限制时 unknown。

## 验证

| 实际命令 | 退出码/结果 |
| --- | --- |
| `node --test tests/console_execution_evidence_validation.mjs` | 0，5项（最终operations内执行） |
| `npm run test:operations --prefix web/strategy-switch-console/frontend` | 0，含双语SSR、旧响应、新证据和performance回归 |
| `node --experimental-strip-types --test tests/console_runtime_state_validation.mjs` | 0，108项 |
| `node tests/strategy_switch_worker_validation.mjs` | 0，含Worker只读/出站边界检查 |
| `node tests/console_strategy_execution_validation.mjs` | 0 |
| `node tests/console_api_contract_validation.mjs` | 0 |
| `node tests/console_api_worker_validation.mjs` | 0，本地路由/鉴权/只读验证 |
| `node tests/console_design_api_validation.mjs` | 0 |
| `node tests/binance_resume_worker_validation.mjs` | 0 |
| `npm run build --prefix web/strategy-switch-console/frontend` | 0，类型/Vite/预算 |
| `npm run sync:v2-assets --prefix web/strategy-switch-console/frontend` | 0，27项 |
| `node tests/console_v2_assets_validation.mjs` | 0，76 references / 27 assets |
| `node tests/console_v2_i18n_validation.mjs` | 0 |
| `git diff --check` | 0 |
| `python3 python/scripts/runtime_settings.py validate` | 0 |
| `python3 -m unittest discover -s python/tests -v` | 1，873 tests / 11 failures / 10 skipped |

首次本地验证发现原来的失败空记录断言和前端禁用内部文案约束，已分别按新增可选字段与现有产品文案规则修正。独审发现旧响应模式回退和页面时点只有日期的问题，均修复并补相关回归。未声称先写测试复现了所有问题。

Python 11项失败均为未修改的 checkout consumer 测试调用系统 Bash 缺 `mapfile`。从精确基线导出 python 树后执行 `python3 -m unittest discover -s python/tests -p test_checkout_internal_dependency_consumers.py -v`，exit1，13项复现同11项失败；见 [baseline-python.json](WEB-GAP-FIX-06-evidence/baseline-python.json)。本卡未改该脚本或测试。

检查回执见 [verification.json](WEB-GAP-FIX-06-evidence/verification.json)；原始测试日志仅存本机临时目录，不提交敏感正文。最终修正后的operations/build/资源回执另记 final-validation.json。

Chrome：**不适用，未使用**。采用真实 HTTP 只读源查询、合成Worker/SSR和构建验证；没有页面交互验收。代码测试通过不等于生产显示更新、真实账户模式确认或业务恢复。

## 权限、独审与发布

已在发现目录访问条件缺失时立即追加 `/Users/lisiyi/codex-jobs/grokbot/NEED_USER.md` 的 WEB-GAP-FIX-06 条目。若要将9户unknown变为确定值，需要当前获准会话的脱敏目录核验；若明确环境字段确实缺失，则需用户确认真实环境并另行授权配置写入。本卡不新增权限、不自行写配置。允许unknown加明确原因的本卡代码/PR工作继续进行。

非作者审查：`/root/web_gap_fix_06_independent_review`；最终结论 **PASS**，独立新测试5项、runtime-state108项、fe8b3项与策略/资源/diff检查均exit0；详情见 [independent-review.md](WEB-GAP-FIX-06-evidence/independent-review.md)。PR和auto-merge须在最终PASS后执行，结果随后回填。部署workflow只有手动触发；本卡不触发。

成果写入本报告及同名证据目录，并更新 `/Users/lisiyi/codex-jobs/TASK_CHECKLIST.md` 中 WEB-GAP-FIX-06 一行。worktree和分支保留。

## 实际读取并采用的 Skill

- plan-and-patch：`/Users/lisiyi/.codex/skills/plan-and-patch/SKILL.md`
- using-git-worktrees：`/Users/lisiyi/.codex/skills/using-git-worktrees/SKILL.md`
- requesting-code-review：`/Users/lisiyi/.codex/skills/requesting-code-review/SKILL.md`
- verification-before-completion：`/Users/lisiyi/.codex/skills/verification-before-completion/SKILL.md`
- finishing-a-development-branch：`/Users/lisiyi/.codex/skills/finishing-a-development-branch/SKILL.md`
