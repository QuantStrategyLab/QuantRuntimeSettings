# WEB-GAP-FIX-05

状态：前端空列表 partial 提示修复完成，非作者独审 **PASS**；PR 发布和远端 CI 待执行。**不部署**。

## 结果与改动

基于 WEB-GAP-FIX-04 合并提交 `cd38c10e2b25f5d8150b1cf84426b128dc226536`，在独立 worktree `.worktrees/web-gap-fix-05`、分支 `codex/web-gap-fix-05` 实施。原 checkout 的其他未提交修改未动。输入与范围见 [input.json](WEB-GAP-FIX-05-evidence/input.json)，6 个实现/测试文件 SHA256 见 [implementation-hashes.json](WEB-GAP-FIX-05-evidence/implementation-hashes.json)。

通知组件为 `web/strategy-switch-console/frontend/src/pages/health/HealthPage.tsx` 的 `NotificationsCard`；调用 `frontend/src/api/endpoints.ts:loadNotificationLog`，读取 `GET /api/notifications/send-log`。后端 `application/console_api/notification_receipts.js` 已提供 `status`、`read_status`、`read_reason_codes`、`truncated` 和 `items`。原组件在空 items 时提前返回普通空态，绕过 partial 提示。

- `frontend/src/pages/health/HealthPage.tsx`：空列表也展示覆盖警告；识别旧 `status=partial`、新 `read_status=partial/unknown` 和 `truncated=true`。读取失败、未接入保持各自展示和重试行为；非空列表保留已有记录及覆盖警告。空态同时说明仅覆盖最近最多 5 次主分支日报流程公开回执。
- `frontend/src/i18n/pages/health.ts`：中英文明确提示“回执覆盖不完整或未知”“当前没有可展示的回执，不能据此确认没有通知”。确认空列表仍显示普通“暂无通知回执”。
- `frontend/src/api/contracts.ts`：声明后端已有的可选 `read_status` / `read_reason_codes`，兼容没有新字段的旧输入。
- `tests/console_notification_receipts_ui_validation.mjs`：6 个中英文 SSR 回归测试，使用实际后端 reader 的合成空/partial/unknown/403/未接入输出，渲染实际私有组件；另测独立 read_status、旧 status、truncated、传输错误、loading 和非空记录。测试只在 bundle 内暴露私有组件，不增加产品导出。断言警告、空态、重试与来源记录，深比较输入，确认不合成行、不补发送时间/送达值。
- `frontend/package.json`：把新增测试纳入已有 `test:operations`，由既有 CI 执行。
- `web/strategy-switch-console/v2_asset_map.js`：按既有 build + sync 命令重新生成供 Worker 使用的前端资源；没有部署。

上述 frontend 路径均位于 `web/strategy-switch-console/`。API、发送者、存储、权限、账户配置和 workflow 均未修改。不补 0、不插值、不补点、不合成通知回执；本次只改变前端展示，不证明 API 覆盖增加、当前业务日通知完整或真实送达。

## 验证与限制

先补 SSR 测试，修改前 exit **1**（实际 partial 空列表缺警告）；实现后 exit **0**，6/6 通过。见 [red-green.json](WEB-GAP-FIX-05-evidence/red-green.json)。原始日志仅本地保留，不随 PR 提交。

| 实际命令 | 退出码 / 结果 |
| --- | --- |
| `node --test tests/console_notification_receipts_ui_validation.mjs` | 0，6 个中英文 SSR 测试 |
| `npm run test:operations --prefix web/strategy-switch-console/frontend` | 0，含新 SSR、既有 operations/回归/偏好账户/UI/performance |
| `npm run build --prefix web/strategy-switch-console/frontend` | 0，tsc / Vite / 资源预算 |
| `npm run sync:v2-assets --prefix web/strategy-switch-console/frontend` | 0，生成 26 项资源 |
| `node tests/console_v2_i18n_validation.mjs` | 0，1415 locale entries |
| `node tests/console_v2_assets_validation.mjs` | 0，70 references / 26 assets |
| `node tests/console_notification_receipts_validation.mjs` | 0，API 读取状态回归 |
| `node tests/console_design_api_validation.mjs` | 0，含既有通知 SSR 与 API 投影 |
| `node tests/console_api_worker_validation.mjs` | 0，本地 Worker 路由/鉴权/只读边界 |
| `node tests/console_api_contract_validation.mjs` | 0 |
| `node --check tests/console_notification_receipts_ui_validation.mjs` | 0 |
| `node --check web/strategy-switch-console/application/console_api/notification_receipts.js` | 0 |
| `git diff --check` | 0 |
| `python3 python/scripts/runtime_settings.py validate` | 0 |
| `python3 -m unittest discover -s python/tests -v` | 1，873 tests / 11 failures / 10 skipped |

前端与 API 组合命令回执见 [frontend.json](WEB-GAP-FIX-05-evidence/frontend.json)、[api.json](WEB-GAP-FIX-05-evidence/api.json)；静态检查见 [static-validation.json](WEB-GAP-FIX-05-evidence/static-validation.json)。Worker 与 frontend 依赖均按既有锁文件 `npm ci` 安装，exit0，未改依赖或锁文件；安装报告已有 audit 项，本卡未做依赖升级。

Python 失败均位于未修改的 checkout consumer 测试，系统 Bash 报 `mapfile: command not found`。导出精确基线 python 后执行 `python3 -m unittest discover -s python/tests -p test_checkout_internal_dependency_consumers.py -v`，exit1，13 tests 复现相同 11 failures；python 树 diff 为空。见 [python.json](WEB-GAP-FIX-05-evidence/python.json)、[baseline-python.json](WEB-GAP-FIX-05-evidence/baseline-python.json)。没有修改 Bash、脚本或测试来回避失败。CONTRIBUTING 的旧 Python 路径已迁移，本卡采用当前 CI 中的实际 `python/` 路径。

本次采用合成 API + SSR、本地 Worker 和构建验证；Chrome：**不适用，未使用**。未验证生产真实回执、浏览器交互或部署后的页面。代码测试、API 回归与生产业务恢复分别说明。

## 独审与 PR

非作者 `/root/web_gap_fix_05_independent_review` 只读独审，结论 **PASS**，未发现需修改的缺陷。独立执行双语 SSR、通知 API、资源/i18n/类型/diff 检查均 exit0，核对 26 项生成资源与 dist、build ID 和 HTML 一致；完整回执见 [independent-review.md](WEB-GAP-FIX-05-evidence/independent-review.md)。独审后产品/测试文件未改。PR 与 auto-merge 将在独审通过后执行，远端必需 CI 仍须通过，不绕过保护。

## 权限与交付

无需用户拍板/输入，未出现 NEED_USER 条件。没有申请新权限、读取生产 KV/真实回执或改变 IAM/Secret/token；没有发送通知、dispatch workflow 或部署。部署 workflow 仅 workflow_dispatch，本次不修改、不触发。

成果为本报告和 `out/WEB-GAP-FIX-05-evidence/`；发布完成后同步原 checkout，并更新 `/Users/lisiyi/codex-jobs/TASK_CHECKLIST.md` 中 WEB-GAP-FIX-05 一行。当前待完成：PR 发布、auto-merge 与远端结果回读。

## 实际读取并采用的 Skill

- plan-and-patch：`/Users/lisiyi/.codex/skills/plan-and-patch/SKILL.md`
- using-git-worktrees：`/Users/lisiyi/.codex/skills/using-git-worktrees/SKILL.md`
- test-driven-development：`/Users/lisiyi/.codex/skills/test-driven-development/SKILL.md`
- build-web-apps:react-best-practices：`/Users/lisiyi/.codex/plugins/cache/openai-curated-remote/build-web-apps/0.1.2/skills/react-best-practices/SKILL.md`
- requesting-code-review：`/Users/lisiyi/.codex/skills/requesting-code-review/SKILL.md`
- verification-before-completion：`/Users/lisiyi/.codex/skills/verification-before-completion/SKILL.md`
- finishing-a-development-branch：`/Users/lisiyi/.codex/skills/finishing-a-development-branch/SKILL.md`
