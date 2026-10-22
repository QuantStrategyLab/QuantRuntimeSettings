# WEB-GAP-FIX-01 CHANGE_PLAN

选择 WEB-GAP-01 §11 的建议-FACT-COVERAGE；仅实现 `/api/account-facts` 的资产覆盖投影，不依赖设计评审。基线 `d14ac6c3d5d55f662834c7ddc54e9df06a5b5dab`，独立分支 `codex/web-gap-fix-01`。不修改 UI、账户参数、采集、存储或部署。

## 数据来源与字段

复用现有 account options（配置别名清单）、受保护 account-facts bindings、`loadStoredAccountFactsMap` 和 `projectStoredAccountFacts` 已验证快照；复用现有 `aggregateAccountFactsTotals` 的物理账户去重、模拟账户排除和时效规则，不另算资产、不请求券商。新增顶层 `asset_coverage`，明确 scope=`account_facts_totals`、source=`validated_account_facts_snapshot`、totals_status/totals_reason；accounts 对每个现有配置账户输出 platform/account_key（配置别名）、status、reason、observation_date（估值日）、observed_finished_at（采集结束时间）。不输出原生券商身份、绑定 ID、金额或异常正文。

## 失败与缺失语义

- excluded：模拟账户或已去重别名，原因 paper_account / duplicate_account。
- unavailable：当前账户不具备纳入条件，固定原因依序为 source_not_supported（如 Binance 钱包是独立源）、identity_mismatch、duplicate_binding、binding_missing、duplicate_account_mapping、snapshot_missing_or_invalid、snapshot_stale、physical_identity_unverified、net_assets_missing；不从别名猜身份。
- included：该账户满足已有纳入条件且 totals.status=by_currency，确实参与现有汇总。
- blocked：该账户自身具备纳入条件，但整个汇总不可用；reason=`aggregate_` + totals.reason。不得误报已纳入。
- 缺失/无效快照日期为 null；stale 保留原日期并明确不可纳入，不能当作当前值。真实零金额仍可纳入；缺现金不阻断已知资产。不补0、不沿用旧值、不插值、不换汇、不改变已有 totals/accounts。
- snapshot GET 的配置/绑定读取抛错必须返回固定脱敏 503（account_options_unreadable / account_facts_bindings_unreadable），不把读失败变成空清单。真实未配置仍保持既有空态。history 不在本卡写集。独审发现真实 binding loader 内部吞错，snapshot GET 需通过可选 propagateReadErrors 参数传播 KV/JSON 错误，其他调用语义保持；补真实 Worker.fetch 回归。

## 最小写集与验证

产品仅 `account_facts.js`（加法投影）、`application/account_facts/read.js`（snapshot GET 失败语义）、`worker.js`（仅 snapshot binding loader 严格读取）；测试扩展既有 `account_facts_totals_validation.mjs` 、`account_facts_readonly_extract_validation.mjs` 与 `account_facts_validation.mjs`，沿既有 CI 执行；更新 Worker README 中英文 API 说明。先执行新增用例观察 RED，再实现，覆盖成功/零/缺现金、模拟/重复/冲突/旧值/缺失/身份不符/独立源/汇总受阻、脱敏及读取失败。执行相关账户事实与 API 回归、配置校验、Python 套件、git diff --check，记录命令和退出码。

## 交付与边界

实现后交未参与实现的只读 reviewer，以准确 base/head 与实际测试作非作者独审；PASS 后提交 PR 并启用 auto-merge，等待必需 CI，禁止绕过保护。已核对部署 workflow 仅 workflow_dispatch，发布前再核对。本卡不调用部署、不 dispatch workflow、不改凭据/IAM/KV/生产配置、不采集生产数据；如需要新权限/凭据立即停止受影响分支并写 NEED_USER。Chrome 不适用。成果 `out/WEB-GAP-FIX-01.md`，更新现有 `/Users/lisiyi/codex-jobs/TASK_CHECKLIST.md` 一行。
