# QSL 通用不下单演练覆盖 V1

> 状态：已接入 `QuantRuntimeSettings` 配置校验、健康报告与策略切换控制台。

## 要解决的问题

策略档案原本可以声明 `allowed_execution_modes: ["dry_run"]`，但手动切换器会把该请求写成 `execution_mode=paper` 与 `dry_run_only=true`。这样虽然多数旧平台仍不会下单，却会在控制平面的策略许可校验中被误判为“策略不允许 paper”，使本该可用的安全演练路径无法使用。

本规范把三件事分开：

| 名称 | 当前含义 | 是否会下单 |
| --- | --- | --- |
| `dry_run` | 所有注册策略和平台必须提供的安全演练路径 | 否 |
| 旧 `paper + dry_run_only=true` | 已有运行目标的兼容表示；按策略政策等价于 `dry_run` | 否 |
| P4 `PAPER_BROKER` | 独立 paper 账户、凭据、订单适配器、对账与签名 policy 的未来能力 | 仅在其独立接线后 |

因此，控制台的“演练（不下单）”不是 P4，也不是实盘开关。它不会赋予 broker、订单、资金、P4/P5/P6 或自动晋级权限。

## 通用契约

`platform-config.json` 的每个平台 deployment 必须声明：

```json
{
  "default_execution_mode": "live",
  "supported_execution_modes": ["live", "dry_run"]
}
```

其中 `supported_execution_modes` 是**当前控制面可安全提交的模式**，而不是券商产品或凭据能力表。P4 尚未接线，所以不得在这里声明 `paper`。未配置实盘的平台只能声明：

```json
{
  "default_execution_mode": "dry_run",
  "supported_execution_modes": ["dry_run"],
  "dry_run_only": true
}
```

每个策略的 `allowed_execution_modes` 必须包含 `dry_run`。健康报告同时检查策略域与平台支持域的交集：任何策略没有至少一条 `dry_run` 路径时，`strategy_platform_dry_run_coverage` 会以 critical failure 失败，自动修复流程只能修复配置/生成物，不能启用订单或提高生命周期。

## 插件边界

插件 mount 的 `expected_mode` 只能是 `dry_run`、`paper` 或 `shadow`，不得请求 `live`。这只是拒绝插件借配置获得实盘权限；它并不自动挂载插件。旧 custom mount 继续停用，未来插件仍必须由冻结的 P1/P2/P3 `strategy_plugin_signal.v2` 适配器绑定并可复算。

## 操作与验证

控制台和 `Manual Strategy Switch` 都提供 `dry_run`。选择它会写入 `dry_run_only=true`；为兼容现有平台同步适配器，当前生成的运行目标仍使用 `execution_mode=paper` 加 `dry_run_only=true` 这个不下单载荷，控制面一律把它按 `dry_run` 校验。`paper` workflow 输入也只为旧调用兼容保留，不能当作 P4 paper 交易使用。

提交任何策略、平台或插件配置变更前后运行：

```bash
python3 python/scripts/build_config.py --check
python3 python/scripts/runtime_settings.py validate
python3 python/scripts/build_config.py --platform-health-report
node tests/strategy_switch_worker_validation.mjs
```

完整 Python、生成物一致性、Worker 与安全检查由 GitHub-hosted CI 执行。通过这些检查只说明配置和不下单控制链完整；真实平台连通、数据质量、P4/P5 receipt 与 P6 实盘资格仍由各自独立的运行证据和策略门槛决定。
