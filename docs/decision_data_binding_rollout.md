# 决策数据绑定：渐进接入说明

`runtime_target.decision_data` 是策略用于计算目标仓位的**冻结历史数据**的公开安全摘要。它与下单时的报价、券商账户和订单严格分开：不包含 URL、凭据、账户、持仓、原始 bar 或私有工件位置。

## 当前迁移规则

1. 已运行的策略继续沿用既有数据读取路径；没有 `decision_data` 不会改变其行为。
2. 上游 P1/P3 自动化可通过 `build_runtime_switch.py --decision-data-json '<JSON>'` 附加已验证的摘要。控制台不提供人工填写入口，避免人为复制错误的哈希或数据截止日。
3. `artifact_optional` 仅记录可比性和观察信息；运行端尚未读取该工件前不得把它描述为已切换数据源。
4. 只有运行端独立读取、校验工件哈希和 assurance 后，才可逐平台将某个目标升级为 `artifact_required`。缺失、过期、降级或哈希不一致必须停车，不能回退到另一行情源。

## 输入边界

`--decision-data-json` 只接受下列非私密字段：稳定 binding ID、哈希、策略范围、模式、非 URL 的 source IDs、数据日期、调整口径和 assurance 状态。最终由 `runtime-target.schema.json` 与 `runtime_settings.validate_target()` 双重校验。

该选项不授权交易、不创建订单，也不会把 P1/P3 结果提升为 paper、shadow 或 live。它只是为所有平台、策略和插件提供相同的可审计数据身份入口。
