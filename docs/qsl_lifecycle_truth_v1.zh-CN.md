# QSL 生命周期唯一语义 v1

策略 catalog、跨资产 inventory 和 evidence package 只描述策略所处阶段，
不产生 paper 或 live 权限。规范状态由 QuantPlatformKit 定义：

```text
research_active -> shadow_active -> paper_active（平台支持时）
                -> live_candidate -> live_enabled
```

旧状态按只读 catalog 语义保守映射：

| 旧状态 | 规范状态 |
| --- | --- |
| `research_backtest_only` | `research_active` |
| `ai_monitored_candidate` | `research_active` |
| `shadow_candidate` | `shadow_active` |
| `runtime_enabled` | `live_candidate` |

`runtime_enabled` 是旧策略包的“runtime 可选择”字段，不能单独证明真实下单已获批。
旧 live 策略可以继续运行，但 QuantRuntimeSettings 只在以下部署字段全部明确成立时
接受 live 请求：

```text
runtime_enabled == true
can_switch_live == true
lifecycle_stage in {live_enabled, runtime_enabled}
allowed_execution_modes contains live
blocked_live_reason is empty
```

其中 `runtime_enabled` lifecycle 名仅为旧部署兼容。新部署应写
`live_enabled`，并继续经过当前 Risk Gate、broker/account 权限和部署授权检查。

缺少任意字段时都 fail closed。设置网站、Worker、配置生成器和后端验证不得从
catalog 名称、默认值或 inventory 状态推导 live 权限。

## 控制台读取优先级与陈旧资料保护

`web/strategy-switch-console/runtime-catalog-projection.json` 由
`platform-config.json` 生成，并带来源内容 SHA-256。它只显示目录门禁（例如策略是否
可被切换流程考虑），`data_status=catalog_only`；它不观察 Cloud Run、Gateway、账户、
订单、资金或 P4–P6 收据，因此不能用作“正在运行”或“已可升级”的事实。

控制台必须按用途读取独立来源：

1. 候选 P1–P3 生命周期与新鲜度：`GET /api/control-plane`；
2. 精确策略 × 平台 × 通道的执行证据：`GET /api/execution-evidence`；
3. 配置目录门禁：登录后的 `GET /api/runtime-catalog`。

`web/strategy-switch-console/lifecycle-matrix.json` 只保留为 2026-08-23 的历史参考，
已标记 `historical_reference_only`。任何界面、自动化或人工审阅都不得把它作为当前
运行、升级或下单依据；缺少新鲜快照时应显示 `unavailable` / `stale`，不能回退到该
历史矩阵填充“正常”状态。

## 一次性迁移规则

- `platform-config.json`、设置网站 fallback 和生成的 profile asset 只写规范状态。
- Worker 可以在同步入口读取旧状态一次，但写入 KV 前必须转换为规范状态。
- 旧 `runtime_enabled` 只有同时带齐已有部署的显式 live 字段时才转换为
  `live_enabled`；否则转换为 `live_candidate`。
- Python 后端暂时只读兼容旧 live stage，供未迁移 runtime 回滚；新配置生成器
  不再产生旧值。
- 当前 QuantRuntimeSettings 的权威 `platform-config.json` 没有旧
  `runtime_enabled` live entry，因此没有伪造迁移授权。此前设置页中的两个陈旧
  fallback live 标记已按权威配置 fail closed 对齐为 `research_active`。

待所有 broker runtime 消费规范字段并完成回滚验证后，删除后端最后一层
`runtime_enabled` 只读兼容。
