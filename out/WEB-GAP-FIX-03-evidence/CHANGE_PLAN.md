# WEB-GAP-FIX-03 CHANGE_PLAN

选择 WEB-GAP-01 §11 SETTINGS-UNKNOWN。FACT-COVERAGE / RUNTIME-READ 已由 #759 / #760 完成，明确排除。通知、研究摘要需要跨前端或材料契约；现金流、持仓、成交、时效定位需要真实源证据。七字段有效设置的来源/失败语义可用现有 reader 和合成 Worker 验收，是剩余卡中范围小且可独立验收的一项。

## 来源与字段

现有 `effectiveAccountSettings` → `resolveCurrentStrategyForAccount` → 账号作用域 GitHub Variables 列表，沿用原解析优先级、账户匹配与字段验证；不读取生产源或新增权限。七字段为 strategy_profile、dca_mode、dca_base_investment_usd、reserved_cash_floor、reserved_cash_ratio、income_layer_enabled、option_overlay_enabled。

新增独立 `effective_read` 七字段元数据，每项加 `status`、 `source=github_runtime_configuration`、固定 `reason` 和 `source_as_of=null`。source 表示现有配置解析路径，不声称字段来自某个具体变量、当前部署或券商；源没有可靠时间戳，因此不把请求时间当源时间。原 `effective` 值形状及 known 值不变；不支持/非 DCA 的两个值字段仍省略，metadata明确unknown与dca_not_applicable。broker_environment 沿用原身份来源，不受本卡读取失败覆盖。

`/api/account-settings/diff` 七行增加 current_source / current_reason / current_source_as_of；known/unknown、current/draft、身份冲突及写入权限保持原语义。无 metadata 的旧输入以明确 effective_field_unavailable 回退，不能伪造来源。

## 失败语义

- 缺 reader token / 仓库映射 / 账户配置：七字段元数据 unknown，分别 reader_not_configured / repository_not_configured / account_config_unavailable。
- GitHub HTTP、网络、JSON 或变量列表形状读取失败：七字段元数据 unknown，runtime_configuration_read_failed；不保留前次值，不回退为已确认空配置。GET 仍为200的可读状态投影，固定原因不暴露异常正文；认证、DO失败等HTTP语义不改。
- 读取成功但解析器未解析出字段：runtime_setting_unresolved；它包括缺失、非法、未匹配，不能据此断言原始字段不存在或根因。
- DCA 平台不支持，或已知策略不支持 DCA：dca_not_applicable；策略未知时 strategy_profile_unresolved。读取失败优先，不把失败当不适用。
- known：reason=null；显式0/false保持原值。unknown无value，diff current=null。不补0、不插值、不拼接旧值、不猜默认值。

共享变量 reader 仅为有效设置路径增加错误报告选项，其余调用维持旧行为。本卡不改解析优先级、账户参数、存储写路径、前端、工作流、依赖或配置。

## 验收与交付

沿现有 account_settings_worker_validation 和 console_api_worker_validation CI 入口增加真实 Worker GET 回归，覆盖缺连接、HTTP/JSON/结构/分页失败、成功空列表、未解析字段、DCA适用性、真实0/false、脱敏及diff投影。先RED再GREEN；运行相关账户/API/契约验证、必要repo检查。独立非作者只读审查PASS后才提交/push/PR并启用标准auto-merge，保留GitHub保护，不部署。需新权限或用户输入立即停止受影响操作并写NEED_USER。

## 独审返修依据

初审P2确认：在effective增加非DCA unknown对象会触发旧dcaSettingsReadout显示“未核实”的定投计划。最终方案改为独立effective_read元数据，不更改原effective值形状；七行diff消费metadata。补充真实后端解析结果→未改动旧UI消费函数的回归，无前端产品修改。初审FAIL原文保留于independent-review.md。
