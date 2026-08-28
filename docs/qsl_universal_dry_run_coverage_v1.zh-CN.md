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

每个策略的 `allowed_execution_modes` 必须包含 `dry_run`。健康报告同时检查策略域与平台支持域的交集，但把覆盖分为两个层次：

| 层次 | 含义 | 当前结果 |
| --- | --- | --- |
| 已声明路径 | 策略域、策略许可和平台 `dry_run` 许可匹配 | 59 条 |
| 默认可构建路径 | 不需要临时人工补充制品，即可生成通过 runtime policy 校验的不下单目标 | 59 条 |

如果策略依赖 `runtime_artifacts.feature_snapshot.required=true`，默认可构建路径还必须配置成对的、`gs://` 开头的快照和 manifest URI。缺失时策略会被标成 **PARKED**，健康检查 `strategy_platform_dry_run_coverage` 以 critical failure 失败，执行保持关闭；这不是允许自动补一个猜测的 URI。

当前受此规则约束的是 `global_etf_rotation`、`russell_top50_leader_rotation` 与 `hk_low_vol_dividend_quality_snapshot`。前两者由 [UsEquitySnapshotPipelines](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines) 发布，港股由 [HkEquitySnapshotPipelines](https://github.com/QuantStrategyLab/HkEquitySnapshotPipelines) 发布；三者都必须先通过各自来源、回测和人工审阅边界，才可成为默认可构建路线。自动修复只能发现、暂停、提示和复验，绝不伪造数据制品或提高生命周期。

### 只读制品证据门

`Runtime Artifact Evidence Gate` 从同一份 `platform-config.json` 生成全部必需制品清单，并以专用只读身份逐项验证：对象可读、manifest 的策略身份、SHA-256 与快照文件一致、以及 `snapshot_as_of` 没有超过策略声明的时效预算。当前预算由发布节奏决定：日更全球 ETF 保留 5 个自然日以覆盖周末与一个市场假日；月更 Russell 与港股保留 40 个自然日。

该门只会生成回执和待处理事项。它不会发布数据、修改 URI、改变运行目标、提升生命周期或提交订单；异常路线必须继续保持 **PARKED**，直到制品所属流水线重新发布并通过验证。

## 插件边界

插件 mount 的 `expected_mode` 只能是 `dry_run`、`paper` 或 `shadow`，不得请求 `live`。这只是拒绝插件借配置获得实盘权限；它并不自动挂载插件。旧 custom mount 继续停用，未来插件仍必须由冻结的 P1/P2/P3 `strategy_plugin_signal.v2` 适配器绑定并可复算。

## 操作与验证

控制台和 `Manual Strategy Switch` 都提供 `dry_run`。选择它会写入 `dry_run_only=true`；为兼容现有平台同步适配器，当前生成的运行目标仍使用 `execution_mode=paper` 加 `dry_run_only=true` 这个不下单载荷，控制面一律把它按 `dry_run` 校验。`paper` workflow 输入只为旧调用兼容保留，且仍受策略原有 `paper` 许可约束；它不能绕过策略许可，也不能当作 P4 paper 交易使用。

提交任何策略、平台或插件配置变更前后运行：

```bash
python3 python/scripts/build_config.py --check
python3 python/scripts/runtime_settings.py validate
python3 python/scripts/build_config.py --platform-health-report
python3 python/scripts/build_config.py --runtime-artifact-evidence-registry > /tmp/runtime-artifact-registry.json
python3 python/scripts/verify_runtime_artifact_evidence.py --registry /tmp/runtime-artifact-registry.json
node tests/strategy_switch_worker_validation.mjs
```

完整 Python、生成物一致性、Worker 与安全检查由 GitHub-hosted CI 执行。通过这些检查只说明配置和不下单控制链完整；真实平台连通、数据质量、P4/P5 receipt 与 P6 实盘资格仍由各自独立的运行证据和策略门槛决定。

健康报告的 `declared_dry_run_route_count`、`buildable_dry_run_route_count`、`artifact_blocked_strategy_count` 会持续暴露这类差异。`recommended_action=supply_verified_runtime_artifact` 表示需要由制品拥有流水线提供可验证输入，而非由中控、插件或 AI 直接绕过门槛。

`Platform Health Monitor` 会读取 `codex_repair_context.safe_to_attempt`：可由配置/代码修复的问题才标记 `codex-repair-ready`；缺外部证据的问题改标 `external-evidence-required`，保留失败告警和 PARKED 状态。这样自动监测不会把“发现问题”误当成“有权创造数据、凭据或实盘资格”。
