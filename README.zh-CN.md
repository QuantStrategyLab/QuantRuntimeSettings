# QuantRuntimeSettings

[文档索引](docs/README.md)：架构适用范围、早期设计英文概要与控制台操作入口。

[English README](README.md)

> 投资有风险。本项目不构成投资建议，仅用于学习、研究和工程审阅。

## 这个仓库是什么

QuantRuntimeSettings 是 QuantStrategyLab 的运行配置包。为 QuantStrategyLab 平台提供版本化运行配置 schema 和工具。

它支撑系统运行，但不决定哪个策略应该 live。策略资格由策略仓和 snapshot 仓负责；券商执行由平台仓负责。

## 配置

Set these non-secret repository variables before running the affected workflows. Export the same names for standalone scripts. Promotion root records and externally pinned root digests remain authoritative.

| Variable | Purpose | Required | Default |
|---|---|---|---|
| `MARKET_BENCHMARK_SYNC_URL` | Complete benchmark sync endpoint | Benchmark sync | none |
| `STRATEGY_SWITCH_CONSOLE_URL` | HTTPS console origin | Review credential check and Firstrade preparation | none |
| `DIGEST_GCP_PROJECT_ID` | Digest cloud project | Digest workflow | none |
| `DIGEST_GCP_WORKLOAD_IDENTITY_SERVICE_ACCOUNT` | Digest cloud identity | Digest workflow | none |
| `DIGEST_CANDIDATES_READER_SERVICE_ACCOUNT` | Candidate store reader identity | Optional | `DIGEST_GCP_WORKLOAD_IDENTITY_SERVICE_ACCOUNT` |
| `DIGEST_CANDIDATES_GCS_URI` | Candidate store prefix | Store preflight; optional otherwise | empty |
| `QSL_PROMOTION_ROOT_PROJECTS_JSON` | JSON object mapping platform IDs to their existing trust-root project IDs | Strategy switch and signature verification | none |


## QSL 架构角色

- **层级**：`运行配置控制面`。
- **职责**：中央 runtime settings 与兼容性控制面。
- **事实源/归属**：platform-config.json、compat bundles、dependency matrix、switch tooling。
- **消费对象**：所有 runtime platforms 和内部依赖消费者。
- **禁止事项**：提交券商订单或替代策略证据门禁。

## 设计边界

- 下游仓库依赖的契约要保持稳定，必要时做版本化。
- 除非有协同迁移计划，否则优先保持向后兼容。
- 密钥和环境专属配置不要写进共享库代码。
- 会影响多个平台或策略包的改动，需要在文档中说明。

## 状态

实验性项目。本仓库保存各平台共用的版本化运行配置，不提交订单，也不授予实盘交易权限。`default_execution_mode`、`live_configured`、策略生命周期标签与 CI 绿灯仅描述配置状态；详情见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

已授权运行的实盘基线使用独立的 `live_continuity` 状态（详见 [runtime target 生命周期](docs/runtime-target-lifecycle.md#live-champion-continuity)），不因新候选验证而连带停机。AI 与监测系统只能创建不可变、无订单的 `qsl.research_task.v1` 离线研究请求（详见[研究任务契约](docs/qsl-research-task-v1.zh-CN.md)）。

## 当前账户资产合计

账户事实读模型使用已与受保护绑定精确核对的 IBKR、Schwab 和 Firstrade 原生身份去重。原生身份只在 Worker 内存中处理；公开账户行仅返回 `aggregation_status`（`included`、`duplicate`、`conflict` 或 `unverified`）。同一物理账户只计最新核实观察；同一观察时点金额冲突或实盘/模拟分类冲突时均不计入。旧快照不阻塞较新的有效观察。LongBridge 的渠道身份仍不足以证明独立物理账户。

只有全部非模拟账户绑定、资料新鲜、物理身份可核实且资产值完整时，`totals.status` 才为 `by_currency`。币种分别合计，不隐含换汇。`cash_balance` 与 `available_cash` 分开且允许为 null；缺现金不否定已知资产，也不补零。看板只有在配置集合相同、快照尚未过期时才使用完整合计，否则继续显示明确标注的部分资产合计。这些投影不授予交易权限，也不证明投资收益。

## 美股交易时段配置

`platform-config.json.domains.us_equity` 定义可配置交易时段。所有时间均使用 `market_timezone`（`America/New_York`）当地时间，随夏令时变化。

| 键 | 用途 | 默认值 |
|---|---|---|
| `trade_date_boundary` | 交易日期的分界时间 | `20:00` |
| `maintenance_pause` | 每日维护暂停的起止时间 | `["20:00", "21:00"]` |
| `sessions` | 每个时段的 `start`、`end` 和布尔值 `enabled` 开关 | `overnight` 21:00–04:00、`pre` 04:00–09:30、`regular` 09:30–16:00、`post` 16:00–20:00 |

默认只有 `regular.enabled=true`，扩展时段均为 `false`；结束时间早于开始时间表示跨午夜。这些键为美股 23x5 准备配置，本改动不接入平台 consumer，不改变现有交易或调度行为，`scheduling.profiles` 保持不变。

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

这是遗留设置变更路径，不会创建或扩大运行时执行授权；当上面的状态仍是未接入 runtime 时，不能把它当作任何运行许可。

推荐流程：

1. 第一次运行保持 `apply=false`，只看 preview。
2. 确认 `repository`、`environment`、`strategy_profile`、`service_name`、`execution_mode`，以及由 `strategy_profile` 派生的 `scheduler` / 插件挂载正确。
3. 再运行 `apply=true`，并填写 `confirm_apply=APPLY`，写入目标仓库变量。
4. 对 Cloud Run 平台，如需同步运行环境，额外设置 `trigger_platform_sync=true`，并填写 `confirm_apply=APPLY_AND_SYNC`。

若是在**恢复已明确授权的旧实盘基线**，可额外填写 `live_continuity_state`、`live_continuity_baseline_id` 和 `live_continuity_captured_at`。工具会用完整 target 自动计算冻结 hash；它只接受 `legacy_authorized` 基线，不能借此创建新的实盘权限、扩大资金/杠杆或把研究候选直接提升为实盘。此类恢复若需要保持既有、同一策略的 shadow/观察插件，选择 `plugin_mode=current`：工作流只读取并原样保留当前挂载；读不到、格式无效或挂载属于其他策略时会失败，不会用空配置覆盖。

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
- `RUNTIME_TARGET_JSON` 与多服务清单 `CLOUD_RUN_SERVICE_TARGETS_JSON` 都是经过 schema 校验的非敏感部署意图，控制台会写入 GitHub Variable；下游平台应优先读取这些 Variable，旧同名 Secret 仅可作为迁移回退。两者都不得包含券商凭据、账户密码或 API key；校验器也会拒绝嵌套的疑似 secret 字段。
- LongBridge、IBKR、Schwab、Firstrade 的 `service_targets_mode=auto` 会检查目标仓库是否已有多服务清单，因此即使只做 preview 也需要 `RUNTIME_SETTINGS_GH_TOKEN`。
- Binance 运行在 Oracle Cloud VPS 的 self-hosted runner。仓库变量会在外部调度器下一次触发 `main.yml` 时被读取；中控不会自动触发该运行 workflow，因为它可能直接执行实盘。切换到不同运行频率的策略时，还必须单独复核 VPS 外部调度器。
- QMT 当前仅支持 dry-run，尚无实盘部署配置；可以生成目标并暂存仓库变量，但会拒绝 `trigger_platform_sync=true`。
- 所有策略都必须有至少一条按策略域匹配的平台 `dry_run`（不下单）路径；健康报告会分别验证“已声明”和“默认可构建”的路径，缺少必需运行时制品的策略会被受控暂停而不会伪造输入。它不等同于 paper 模拟交易，详见[通用不下单演练覆盖 V1](docs/qsl-universal-dry-run-coverage-v1.zh-CN.md)。
- 当前 `plugin_mode=none` 是安全默认值。`auto` 仅为兼容旧请求而保留，实际等同于 `none`；不得再按策略名称自动挂载 `latest_signal.json`。旧 `custom` mount 已禁用，不能借由手动表单绕过策略绑定与候选校验。未来只有被冻结候选明确引用、并可在运行时复算的插件 artifact 才能接入运行时，详见[策略插件契约 V2](docs/qsl-strategy-plugin-contract-v2.zh-CN.md)。
- workflow 绑定 GitHub Environment `runtime-strategy-switch`。个人系统默认不需要 required reviewers；建议把 `RUNTIME_SETTINGS_GH_TOKEN` 配成这个 Environment 的 secret，真实写入靠 preview、确认词和 token 最小权限控制。
- 启用真实切换前请按 [手动策略切换权限控制方案](docs/manual-strategy-switch-permission-control.zh-CN.md) 完成最简 secret、token 权限和回滚准备。

## 延伸文档

- [内部依赖 pin 政策](docs/internal-dependency-pin-policy.zh-CN.md)
- [策略切换控制台 Fork 指南](docs/strategy-switch-fork-guide.zh-CN.md)
- [策略切换控制台 Worker](web/strategy-switch-console/README.zh-CN.md)
- [策略切换登录权限后台方案](docs/strategy-switch-admin-backend.zh-CN.md)
- [手动策略切换权限控制方案](docs/manual-strategy-switch-permission-control.zh-CN.md)

## 社区和安全

- 贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，确认 PR 范围、本地校验和文档要求。
- 讨论、issue 和 review 请遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
- 涉及密钥、自动化、券商/交易所或云资源的漏洞请按 [SECURITY.md](SECURITY.md) 私密报告；不要为 secret 或实盘风险开公开 issue。

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。AI 助手与维护者遵循 [AGENTS.md](AGENTS.md)。

## 许可证

详见 [LICENSE](LICENSE)。

显示与通知名称配置：[说明](docs/display-names.md)。
