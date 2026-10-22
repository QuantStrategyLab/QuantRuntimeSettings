# WEB-GAP-FIX-01

状态：实现及定向验证完成，待非作者独审与 PR/auto-merge。不部署。

## 结果与改动

选择 WEB-GAP-01 §11 的 **FACT-COVERAGE**。输入定位与 SHA256 见 [input.json](WEB-GAP-FIX-01-evidence/input.json)，字段、来源及缺失语义见 [CHANGE_PLAN](WEB-GAP-FIX-01-evidence/CHANGE_PLAN.md)。独立 worktree：`/Users/lisiyi/Projects/QuantRuntimeSettings/.worktrees/web-gap-fix-01`；分支 `codex/web-gap-fix-01`；基线 `d14ac6c3d5d55f662834c7ddc54e9df06a5b5dab`。未包含原 checkout 的其他未提交改动。

- `web/strategy-switch-console/account_facts.js`：为 `/api/account-facts` 增加 `asset_coverage`，逐配置别名说明资产是否实际纳入、排除或受阻，以及估值日、观察结束时间。范围仅现有 account-facts totals，不冒充收益、持仓、现金流或 Binance 钱包历史覆盖；不改原汇总。
- `web/strategy-switch-console/application/account_facts/read.js`：snapshot GET 的配置/绑定读取失败返回固定脱敏 503，不再成功返回空清单。history 无改动。
- `tests/account_facts_totals_validation.mjs`、`tests/account_facts_readonly_extract_validation.mjs`：沿现有 CI 测试入口，覆盖真实零、缺现金、缺失/非法/过旧快照、身份不符、模拟/重复/冲突/独立源、全局受阻、HTTP 投影与配置读取错误。
- Worker `README.md` / `README.zh-CN.md`：同步 API 字段与语义。

只读投影包含配置别名、状态、固定原因和源日期，不新增金额或券商身份。只有实际参与可用汇总的账户为 included；单户合格但汇总受阻为 blocked。缺失不补0、不插值、不用旧值代当前；旧快照只保留原日期并明确 stale。LongBridge 的渠道身份不能证明物理账户，保留 physical_identity_unverified。

## 实际验证

命令逐项退出码见 [初轮记录](WEB-GAP-FIX-01-evidence/validation.json) 与 [最终定向记录](WEB-GAP-FIX-01-evidence/final-validation.json)。原始日志保留在本机同一 evidence 目录（未全部提交）。

| 命令 | 退出码 / 结果 |
| --- | --- |
| `node --experimental-strip-types tests/account_facts_totals_validation.mjs` | 最终 0 |
| `node tests/account_facts_readonly_extract_validation.mjs` | 最终 0 |
| `node tests/account_facts_validation.mjs` | 最终 0，含本地 Worker/DO 集成 |
| `node tests/account_facts_sync_extract_validation.mjs` | 0 |
| `node tests/console_api_worker_validation.mjs` | 0 |
| `node tests/console_design_api_validation.mjs` | 安装锁定前端依赖后 0 |
| `node --check web/strategy-switch-console/account_facts.js` | 0 |
| `node --check web/strategy-switch-console/application/account_facts/read.js` | 0 |
| `python3 python/scripts/runtime_settings.py validate` | 0 |
| `python3 -m unittest discover -s python/tests -v` | 1：873 tests，11 failures，10 skipped；11 failures 全部来自 macOS `/bin/bash` 无 mapfile，相关 Python/脚本与 base 无差异 |
| `git diff --check` | 0 |

新增覆盖用例在实现前 RED（无 asset_coverage）；读取错误用例 RED（200 而非 503）。初轮另有新合成 fixture 字段不符合已有严格契约、缺 esbuild 的失败，已修正 fixture 并 `npm ci` 安装锁定依赖，最终定向检查全过。没有修改校验器或放宽断言来跳过失败。`npm ci` Worker/frontend 均退出 0，分别提示 3/1 个已有 high 漏洞；本卡未修改依赖或锁文件。CONTRIBUTING 的旧 scripts/tests 路径已迁移，实际按 README 与 CI 的 python/scripts、python/tests 执行。

## 独审与集成

待非作者只读 reviewer 对准确实现提交及测试证据给出结论；独审 PASS 后才发布 PR/auto-merge。现有必需检查为 js/python、要求跟上 main；不绕过保护。PR #758 有相邻加法修复，本卡从 main 独立实施，不吸收其未合并写集。

部署工作流 `.github/workflows/deploy-strategy-switch-console.yml` 仅 `workflow_dispatch`，本卡未修改任何 workflow，且不 dispatch。本机测试和 CI 不等于生产数据已补齐或已上线。

## 权限、部署和未验证项

无需新权限或凭据，未创建 NEED_USER。没有访问券商、生产 KV、真实账户正文，没有改身份、开关、IAM、Secret、采集任务或账户参数；没有部署或交易。真实数据的旧快照、未接入源、未核验身份继续如实报告，本卡没有证明生产数据恢复。Chrome：不适用。

## 实际读取并采用的 Skill

- plan-and-patch：`/Users/lisiyi/.codex/skills/plan-and-patch/SKILL.md`
- using-git-worktrees：`/Users/lisiyi/.codex/skills/using-git-worktrees/SKILL.md`
- test-driven-development：`/Users/lisiyi/.codex/skills/test-driven-development/SKILL.md`
- requesting-code-review：`/Users/lisiyi/.codex/skills/requesting-code-review/SKILL.md`
- verification-before-completion：`/Users/lisiyi/.codex/skills/verification-before-completion/SKILL.md`
- finishing-a-development-branch：`/Users/lisiyi/.codex/skills/finishing-a-development-branch/SKILL.md`
