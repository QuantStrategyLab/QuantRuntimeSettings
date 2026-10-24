# WEB-GAP-FIX-04 CHANGE_PLAN

选择 WEB-GAP-01 §11 NOTIFICATION-RECEIPT 的后端读取状态子项。排除已完成 FACT-COVERAGE / RUNTIME-READ / SETTINGS-UNKNOWN。CASH-FIELDS 在开放 PR #758 范围内，不重复修改；AUTH-READ 需要 Chrome（本卡不适用）；KV-READ 需要生产只读身份核实。通知公开回执 reader 已有受限 GET 路径，可通过合成 ZIP、Actions 列表和 API 路由独立验收，无新权限、无设计依赖。

基线 193b2d7f56ae5141ebf21ab79eeb89873ec4c9f8，独立 worktree `.worktrees/web-gap-fix-04`，分支 `codex/web-gap-fix-04`。保留原 checkout 的其他改动。

## 问题与最小修改

现有 reader 对缺回执、回执过期、sender skipped 和 run_limit=5 截断返回 status=ok；空列表不区分列表总数/覆盖未知。源码证明状态投影缺陷，不代表已确认历史或当前生产根因。

1. `application/console_api/notification_receipts.js`：增加独立 read_status 和固定 read_reason_codes，区分 complete / partial / no_data / unknown / read_failed / not_connected。枚举范围仅为最近最多5次已完成 main 分支 daily-digest workflow；截断、列表范围未知/缺行、回执缺失/过期、sender skipped、读取失败分别表达。只有所有枚举运行都有可读公开回执且列表完整时为 complete；不推断今日、全通知覆盖或真实送达。空列表仅在 total_count=0 时为 no_data，无法证明为空时 unknown/partial。非法计数/列表返回固定读失败。保留部分条目，旧 status 在完整性不足时改 partial，让既有消费者看到警告；送达、dry_run、test_message、business_day、report_date、workflow_updated_at 和 sent_at 保持原来源，sent_at=null，不用流程时间替代发送时间。
2. `operations.js` 未接入 fallback 同步新元数据。JSON schema 加法可选字段兼容旧载荷；双语 Worker README 说明范围、字段和失败语义。不改 UI、发送者、采集、权限、缓存策略、存储或部署。
3. 现有 `console_notification_receipts_validation.mjs` 添加回归（已由 console_design_api_validation 纳入CI）：真实空/覆盖未知/缺行/截断/缺失/过期/skipped/部分及全部失败/完整但发送失败/缓存/鉴权/脱敏/时间原值。先 RED 后 GREEN。合成 fetch 必须全部 GET，无外部请求。

## 验证与发布

运行通知回归、console design/API contract/Worker 集成、Worker 语法、git diff --check；按 CONTRIBUTING 当前有效路径运行 python/scripts/runtime_settings.py validate 和 python/tests 单测，环境失败单列。使用已有锁文件安装测试依赖，无新生产依赖。

非作者只读 reviewer 检查精确基线、补丁、哈希、测试及权限边界，修正具体问题并 PASS 后 commit/push/PR，启用标准 auto-merge，等待必需CI，不绕过保护。发布前核对部署 workflow 仅 workflow_dispatch，不 dispatch、不部署、不删除分支/worktree。仅提交本卡源码、测试、文档、报告/非敏感证据。新权限或用户输入必要时立即记录 NEED_USER 并停止受影响操作。

成果 out/WEB-GAP-FIX-04.md，TASK_CHECKLIST 一行；Chrome 不适用。真实通知源/生产权限/生产部署未经本卡验证，不把代码或CI通过写成业务恢复。
