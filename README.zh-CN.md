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

`.github/workflows/manual-strategy-switch.yml` 提供手动触发的中控切换入口。它会根据表单参数生成运行目标，复用 `python/scripts/runtime_settings.py` 校验并写入目标平台仓库的 GitHub variables。当前支持 `longbridge`、`ibkr`、`schwab`、`firstrade`。

推荐流程：

1. 第一次运行保持 `apply=false`，只看 preview。
2. 确认 `repository`、`environment`、`strategy_profile`、`service_name`、`execution_mode`，以及由 `strategy_profile` 派生的 `scheduler` / 插件挂载正确。
3. 再运行 `apply=true`，并填写 `confirm_apply=APPLY`，写入目标仓库变量。
4. 如果要让平台仓同步 Cloud Run 环境，额外设置 `trigger_platform_sync=true`，并填写 `confirm_apply=APPLY_AND_SYNC`。

常用例子：

```text
platform=longbridge
target_name=sg
strategy_profile=tqqq_growth_income
execution_mode=live
plugin_mode=auto
apply=true
trigger_platform_sync=true
confirm_apply=APPLY_AND_SYNC
```

注意：

- 这是 GitHub Actions 的 `workflow_dispatch` 手动表单，不是公开网页。默认 `apply=false` 只生成预览，不写任何远端变量。
- LongBridge 默认写入 environment variables，例如 `target_name=sg` 会落到 `longbridge-sg`。
- Schwab 默认写入 repository variables。
- Firstrade 默认写入 repository variables，`target_name=live` 会使用 `firstrade-quant-service` 和 `account_scope=US`。
- IBKR 如果目标仓库已有 `CLOUD_RUN_SERVICE_TARGETS_JSON`，workflow 会 patch 指定 service/account_scope 的 target entry，避免覆盖其他 IBKR 服务。
- 跨仓写 variables 和触发 workflow 必须在本仓配置 `RUNTIME_SETTINGS_GH_TOKEN` secret，token 至少需要目标仓库的 variables/workflow 写权限；不会回退到默认 `github.token` 写远端变量。
- IBKR 的 `service_targets_mode=auto` 需要读取并 patch 目标仓库的 `CLOUD_RUN_SERVICE_TARGETS_JSON`，因此即使只做 preview 也需要 `RUNTIME_SETTINGS_GH_TOKEN`。
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
