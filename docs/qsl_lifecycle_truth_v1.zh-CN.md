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
