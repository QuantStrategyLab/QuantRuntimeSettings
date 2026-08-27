# QuantRuntimeSettings


## QSL 架构角色

- **层级**：`运行配置控制面`。
- **职责**：中央 runtime settings 与兼容性控制面。
- **事实源/归属**：platform-config.json、compat bundles、dependency matrix、switch tooling。
- **消费对象**：所有 runtime platforms 和内部依赖消费者。
- **禁止事项**：提交券商订单或替代策略证据门禁。

[English README](README.md)

> 投资有风险。本项目不构成投资建议，仅用于学习、研究和工程审阅。

## 这个仓库是什么

QuantRuntimeSettings 是 QuantStrategyLab 的运行配置包。为 QuantStrategyLab 平台提供版本化运行配置 schema 和工具。

它支撑系统运行，但不决定哪个策略应该 live。策略资格由策略仓和 snapshot 仓负责；券商执行由平台仓负责。

## 设计边界

- 下游仓库依赖的契约要保持稳定，必要时做版本化。
- 除非有协同迁移计划，否则优先保持向后兼容。
- 密钥和环境专属配置不要写进共享库代码。
- 会影响多个平台或策略包的改动，需要在文档中说明。

## P0–P6 运行授权状态

`platform-config.json.meta.runtime_authority` 是 P0–P6 控制面的机器可读状态。当前 `P0_CONTROL_PLANE_NOT_RUNTIME_WIRED` 表示本仓没有 active 的预授权自治策略，也没有已接入 runtime 的 P0 执行网关。

`default_execution_mode`、`live_configured`、策略生命周期标签、本仓切换 workflow 与 CI 绿灯都只是配置或历史元数据，不是运行、订单、资金或阶段升级授权。P1–P3 的 non-live 数据获取必须有独立、精确的契约，不能从 P0 隐含推导；P4–P6 仍未定义。详见[架构边界](docs/ARCHITECTURE.md#p0p6-runtime-authority-boundary)。

AI 与监测系统只能创建不可变、无订单的 `qsl.research_task.v1` 离线研究请求。该请求绑定证据摘要和受限实验，但不会激活候选，也不会授予 P4–P6 权限。详见[研究任务契约](docs/qsl_research_task_v1.zh-CN.md)。

## 仓库结构

- `python/`：Python 工具链（脚本、测试、pyproject.toml）— 校验、代码生成、部署工具。
- `web/`：JavaScript Web 应用（Cloudflare Workers 策略切换控制台）。
- `schemas/`：JSON Schema 文件，Python 和 JS 共享。
- `tests/`：JavaScript 单元测试和集成测试。
- `.github/workflows/`：CI、定时任务、发布或部署 workflow。
- `docs/ARCHITECTURE.md`：详细架构文档。

## 快速开始

```bash
python3 python/scripts/runtime_settings.py validate
python3 -m unittest discover -s python/tests -v
```

## 一键切换策略

`.github/workflows/manual-strategy-switch.yml` 提供手动触发的中控切换入口。它会根据表单参数生成运行目标，复用 `python/scripts/runtime_settings.py` 校验并写入目标平台仓库的 GitHub variables。当前支持 `longbridge`、`ibkr`、`schwab`、`firstrade`、`qmt`、`binance`。

这是遗留设置变更路径，不会创建或扩大 P0–P6 运行授权；当上面的状态仍是未接入 runtime 时，不能把它当作任何运行许可。

推荐流程：

1. 第一次运行保持 `apply=false`，只看 preview。
2. 确认 `repository`、`environment`、`strategy_profile`、`service_name`、`execution_mode`，以及由 `strategy_profile` 派生的 `scheduler` / 插件挂载正确。
3. 再运行 `apply=true`，并填写 `confirm_apply=APPLY`，写入目标仓库变量。
4. 对 Cloud Run 平台，如需同步运行环境，额外设置 `trigger_platform_sync=true`，并填写 `confirm_apply=APPLY_AND_SYNC`。

常用例子：

```text
platform=longbridge
target_name=sg
strategy_profile=tqqq_growth_income
execution_mode=live
plugin_mode=none
apply=true
trigger_platform_sync=true
confirm_apply=APPLY_AND_SYNC
```

注意：

- 这是 GitHub Actions 的 `workflow_dispatch` 手动表单，不是公开网页。默认 `apply=false` 只生成预览，不写任何远端变量。
- LongBridge 默认写入 environment variables，例如 `target_name=sg` 会落到 `longbridge-sg`；如果仓库已有多服务目标清单，同一次切换也会更新其 repository-level 精确服务条目。
- Schwab 默认写入 repository variables。
- Firstrade 默认写入 repository variables，`target_name=live` 会使用 `firstrade-quant-service` 和 `account_scope=US`。
- 多服务目标以 `service_name` 为唯一主标识；同一 `account_scope` 可以有多个策略服务，切换只更新精确服务，不会覆盖兄弟目标。
- `CLOUD_RUN_SERVICE_TARGETS_JSON` 同时支持数组和 `{targets:[...]}`；新增服务必须显式选择 `service_targets_mode=allow_create`。
- 跨仓写 variables 和触发 workflow 必须在本仓配置 `RUNTIME_SETTINGS_GH_TOKEN` secret，token 至少需要目标仓库的 variables/workflow 写权限；不会回退到默认 `github.token` 写远端变量。
- LongBridge、IBKR、Schwab、Firstrade 的 `service_targets_mode=auto` 会检查目标仓库是否已有多服务清单，因此即使只做 preview 也需要 `RUNTIME_SETTINGS_GH_TOKEN`。
- Binance 运行在 Oracle Cloud VPS 的 self-hosted runner。仓库变量会在外部调度器下一次触发 `main.yml` 时被读取；中控不会自动触发该运行 workflow，因为它可能直接执行实盘。切换到不同运行频率的策略时，还必须单独复核 VPS 外部调度器。
- QMT 当前仅支持 dry-run，尚无实盘部署配置；可以生成目标并暂存仓库变量，但会拒绝 `trigger_platform_sync=true`。
- 所有策略都必须有至少一条按策略域匹配的平台 `dry_run`（不下单）路径；健康报告会分别验证“已声明”和“默认可构建”的路径，缺少必需运行时制品的策略会被受控暂停而不会伪造输入。它不等同于 P4 paper 交易，详见[通用不下单演练覆盖 V1](docs/qsl_universal_dry_run_coverage_v1.zh-CN.md)。
- 当前 `plugin_mode=none` 是安全默认值。`auto` 仅为兼容旧请求而保留，实际等同于 `none`；不得再按策略名称自动挂载 `latest_signal.json`。旧 `custom` mount 已禁用，不能借由手动表单绕过 P1/P2/P3 绑定。未来只有被冻结的 P2 候选明确引用、并可在 P3 复算的插件 artifact 才能接入运行时，详见[策略插件契约 V2](docs/qsl_strategy_plugin_contract_v2.zh-CN.md)。
- workflow 绑定 GitHub Environment `runtime-strategy-switch`。个人系统默认不需要 required reviewers；建议把 `RUNTIME_SETTINGS_GH_TOKEN` 配成这个 Environment 的 secret，真实写入靠 preview、确认词和 token 最小权限控制。
- 启用真实切换前请按 [手动策略切换权限控制方案](docs/manual_strategy_switch_permission_control.zh-CN.md) 完成最简 secret、token 权限和回滚准备。

## 延伸文档

- [内部依赖 pin 政策](docs/internal_dependency_pin_policy.zh-CN.md)
- [策略切换控制台 Fork 指南](docs/strategy_switch_fork_guide.zh-CN.md)
- [策略切换控制台 Worker](web/strategy-switch-console/README.zh-CN.md)
- [策略切换登录权限后台方案](docs/strategy_switch_admin_backend.zh-CN.md)
- [手动策略切换权限控制方案](docs/manual_strategy_switch_permission_control.zh-CN.md)

## 社区和安全

- 贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，确认 PR 范围、本地校验和文档要求。
- 讨论、issue 和 review 请遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
- 涉及密钥、自动化、券商/交易所或云资源的漏洞请按 [SECURITY.md](SECURITY.md) 私密报告；不要为 secret 或实盘风险开公开 issue。

## 许可证

详见 [LICENSE](LICENSE)。
