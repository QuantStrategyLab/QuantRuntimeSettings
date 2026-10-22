# WEB-GAP-FIX-02

状态：**实现完成、非作者独审 PASS；[PR #760](https://github.com/QuantStrategyLab/QuantRuntimeSettings/pull/760) 已创建，远端CI等待中。未部署。**

## 结果与改动

选择 WEB-GAP-01 §11 的 **RUNTIME-READ**，排除已完成的 FACT-COVERAGE（PR #759）。输入路径/SHA256 见 [input.json](WEB-GAP-FIX-02-evidence/input.json)，字段、来源、失败语义与选择理由见 [CHANGE_PLAN](WEB-GAP-FIX-02-evidence/CHANGE_PLAN.md)。独立 worktree `/Users/lisiyi/Projects/QuantRuntimeSettings/.worktrees/web-gap-fix-02`；分支 `codex/web-gap-fix-02`；基线 `26f161d88eee1c92de1623c11ba1050a99ea117d`。保留原 checkout 的未提交工作。

- `web/strategy-switch-console/worker.js`：只为现有 daily GET 增加 `read_summary`；复用已绑定目标/账户/纽约业务日期与已验证的持久化日投影。
- `tests/runtime_daily_worker_validation.mjs`：通过真实 Worker.fetch 覆盖五条部分运行、各完整性信号、完整零/部分零、缺键、KV/JSON/投影/日期错误、脱敏、旧数据与 GET 无写入。
- `tests/runtime_daily_health_integration_validation.mjs`：沿既有 Schwab producer→接收/存储→GET 集成验证读取完整性与执行失败、待核对、演练、提交及无交易分别表达。
- Worker `README.md` / `README.zh-CN.md`：同步来源、字段、HTTP状态和限制。没有修改前端或设计、依赖锁、工作流、采集、配置、绑定和存储写路径。

`read_summary.source=stored_runtime_daily_projection`。HTTP 200 可以是 partial：保留五条已观察运行，`observed_run_count=5`，`total_run_count=null`，原因 runtime_daily_incomplete。缺键为200/no_data，次数均null；KV/JSON或投影损坏仍503/read_failed，次数均null，原因沿用固定公开错误码，不输出异常正文。完整调度确有零条源运行时才允许0；部分读到零条时只表示已观察0，总数仍null。认证/禁用/选择/绑定原语义保留。

完整性、执行结果、时效和历史目录覆盖分别表达。摘要只能证明当前已保存投影所报告的范围，不能证明生产者发现了全部真实运行；historical/stale与源时间保持，不补0、不补点、不插值。WEB-GAP-01 的线上现象是历史观察，本卡没有读取当前生产数据或断言其根因已确认。

## 实际验证

逐项命令、退出码、耗时与本地日志名见 [focused-validation.json](WEB-GAP-FIX-02-evidence/focused-validation.json)、[python-validation.json](WEB-GAP-FIX-02-evidence/python-validation.json)、[baseline-validation.json](WEB-GAP-FIX-02-evidence/baseline-validation.json)；RED/GREEN见 [red-green.json](WEB-GAP-FIX-02-evidence/red-green.json)。原始日志保留本机 evidence 目录。

| 命令 | 退出码 / 结果 |
| --- | --- |
| `node tests/runtime_daily_worker_validation.mjs` | 0，含健康与Schwab源/绑定/隐私集成 |
| `node tests/console_api_worker_validation.mjs` | 0，含本地 Worker/DO |
| `node tests/console_design_api_validation.mjs` | 0 |
| `node tests/console_runtime_daily_selection_validation.mjs` | 0 |
| `node --check web/strategy-switch-console/worker.js` | 0 |
| `python3 python/scripts/runtime_settings.py validate` | 0 |
| `python3 -m unittest discover -s python/tests -v` | 1：873项，11 failures、10 skipped |
| 基线导出后运行 `python3 -m unittest discover -s python/tests -p test_checkout_internal_dependency_consumers.py -v` | 1：13项，同样11 failures，均因 Bash 缺少 mapfile |
| `git diff --check` | 0 |

Python 的11个失败来自未修改的 checkout consumer 脚本调用系统 Bash，`mapfile: command not found`；已把精确基线的测试与脚本用 git show 导出到临时目录独立复现相同失败。`git diff --exit-code <base> -- python .github/workflows` 退出0。未修改 Bash、脚本或断言绕过失败；远端 Linux Python CI 仍须通过。

Worker/frontend `npm ci --prefix ...` 均退出0，依赖锁无改动；分别报告3/1个已有high漏洞与安装脚本提示，不在本卡升级。CONTRIBUTING 的旧 scripts/tests 路径以现有 README/CI 的 python/scripts、python/tests 为准。新增用例在实现前因缺少 read_summary 失败；初轮另有合成 unmatched fixture 形状不符及conflict fixture状态不符，已按已有契约修正，未放宽生产校验器。

## 独审与PR

非作者 `/root/web_gap_fix_02_independent_review` 已只读独审 **PASS，无需返修**，并独立运行daily/Schwab集成、账户选择回归和diff检查，均exit0。[独审记录](WEB-GAP-FIX-02-evidence/independent-review.md) 与 [实现SHA256](WEB-GAP-FIX-02-evidence/implementation-hashes.json) 已核对一致。[PR #760](https://github.com/QuantStrategyLab/QuantRuntimeSettings/pull/760) 已创建（实现提交 `061ade5c`）。本次文档提交后对精确head启用标准auto-merge，等待现有严格main基线、js/python必需检查；不使用admin或跳过保护。产品文件未在独审后变化。提交/push/PR命令回执见 [git-publication.json](WEB-GAP-FIX-02-evidence/git-publication.json)。

## 权限、部署与未验证项

不需新权限或凭据，无 NEED_USER。没有调用生产 KV、券商、日志或账户正文，没有变更 IAM、Secret、生产配置和开关，没有发通知或交易。GitHub插件缺少link_id而无法读取仓库，使用本机已有 gh/Git 认证完成授权范围内的PR工作。

部署 workflow 仅 workflow_dispatch；push/PR 触发验证与离线契约工作流。本卡不 dispatch、不修改workflow、不部署。本地测试与CI不代表生产数据恢复；页面标签/详情未改，API新增字段要在另行授权部署后才能在线使用。Chrome：**不适用，未使用**。

## 实际读取并采用的 Skill

- plan-and-patch：`/Users/lisiyi/.codex/skills/plan-and-patch/SKILL.md`
- using-git-worktrees：`/Users/lisiyi/.codex/skills/using-git-worktrees/SKILL.md`
- test-driven-development：`/Users/lisiyi/.codex/skills/test-driven-development/SKILL.md`
- requesting-code-review：`/Users/lisiyi/.codex/skills/requesting-code-review/SKILL.md`
- verification-before-completion：`/Users/lisiyi/.codex/skills/verification-before-completion/SKILL.md`
- finishing-a-development-branch：`/Users/lisiyi/.codex/skills/finishing-a-development-branch/SKILL.md`

独审者实际使用的 Skill 和命令以独审回执记录为准。TASK_CHECKLIST 的既有WEB-GAP-FIX-02行将在PR状态确定后更新；其余23张卡不在本次范围。
