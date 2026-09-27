# 手动策略切换权限控制方案

[English](manual_strategy_switch_permission_control.md)

这是个人量化系统的简化权限方案，保留必要的防误触和防泄密边界。

**当前候选状态（2026-09-27）：策略激活尚未接通。** 网页端在 dispatch 前拒绝切换；workflow 即使通过 Promotion Manifest 校验，也会在写变量及同步步骤前拒绝 `apply=true`。尚缺持久化的一次性授权消费与不可变的跨平台激活绑定，不能通过打开开关、增加 token 权限或省略校验绕过。此处描述本仓候选源码，不代表生产部署状态已读回。

## 默认方案：个人单人模式

只需要这几条：

1. 只有你自己的 GitHub 账号有这个仓库的 write/admin 权限。
2. 在 GitHub secret 里配置 `RUNTIME_SETTINGS_GH_TOKEN`。
3. token 只给目标平台仓库需要的 variables/workflow 权限，不给 `contents: write`。
4. 第一次运行 workflow 用 `apply=false` 看 preview。
5. 当前停在 preview；确认词和 token 均不能使尚未接通的 `apply=true` 生效。
6. 不把 broker、email、cloud、API token 等密钥放进 `extra_variables_json`。

这个模式不要求 required reviewers。workflow 绑定了 `runtime-strategy-switch` Environment，但这个 Environment 可以不配置审批人；它主要用于隔离 secret 和保留 Actions 审计。

## 最简 GitHub 设置

在 `QuantRuntimeSettings` 仓库配置：

- Environment：`runtime-strategy-switch`
- Secret：`RUNTIME_SETTINGS_GH_TOKEN`
- Required reviewers：不配置
- Deployment branches：建议只允许 `main`，如果觉得麻烦可以先不配

如果你只想更省事，也可以把 `RUNTIME_SETTINGS_GH_TOKEN` 放在 repository secret。更推荐 Environment secret，因为它只给绑定该 Environment 的 job 用，安全边界更清楚。

## Token 权限

优先用 fine-grained PAT，只授权你实际使用的目标平台仓库。QuantStrategyLab 默认仓库是：

- `QuantStrategyLab/LongBridgePlatform`
- `QuantStrategyLab/InteractiveBrokersPlatform`
- `QuantStrategyLab/CharlesSchwabPlatform`
- `QuantStrategyLab/FirstradePlatform`

如果你 fork 到自己的组织，把这些替换成你的平台仓库，并在本仓 repository variables 里配置 `RUNTIME_SETTINGS_PLATFORM_REPOSITORIES_JSON` 或 `RUNTIME_SETTINGS_LONGBRIDGE_REPO`、`RUNTIME_SETTINGS_IBKR_REPO`、`RUNTIME_SETTINGS_SCHWAB_REPO`、`RUNTIME_SETTINGS_FIRSTRADE_REPO`。完整步骤见 [策略切换控制台 Fork 指南](strategy_switch_fork_guide.zh-CN.md)。

需要的能力只有：

- 读取和写入 GitHub Actions variables。
- 对已接入的 Cloud Run 平台，允许 dispatch 目标平台环境同步 workflow。

不需要：

- `contents: write`
- issue/PR/release/packages 权限
- organization admin 权限

## 日常切换流程

1. 打开 Actions 里的 `Manual Strategy Switch`。
2. 填 `platform`、`target_name`、`strategy_profile`。
3. 先保持 `apply=false` 跑一次，检查 preview。
4. 当前仅审阅 preview；不要将它记录为策略已采用或运行配置已更新。

后续激活接线须消费绑定候选、目标和风险范围的有效人工授权，并通过一次性消费及执行端采用验收。个人单人模式不要求额外团队审批人，但新策略采用、风险提高和大额资金变化仍须由本人决定。

`dry_run` 是所有平台共用的“不下单演练”选项。它不等同于 P4 paper 账户，也不会启用订单或实盘资格；`paper` 仅为旧调用兼容，会按 `dry_run` 处理。每个策略必须保持至少一条按市场域匹配的平台 `dry_run` 路线，健康报告会在配置漂移时失败。

## 保留的安全门

这些防线不会增加太多操作成本，但能挡住常见误操作：

- `apply=false` 默认只预览，不改远端。
- 当前 `apply=true` 在写入前安全拒绝；确认词只是已有校验之一，不是投资授权或解除拒绝的手段。
- 没有 `RUNTIME_SETTINGS_GH_TOKEN` 时不能真实写入。
- 多服务平台按 `service_name` 精确 patch target；`account_scope` 即使重复也不会覆盖其他策略服务。
- LongBridge 会同时维护环境级运行目标和仓库级多服务清单，避免页面状态与实际部署输入分叉。
- `extra_variables_json` 不能覆盖系统自动生成的核心变量。
- `extra_variables_json` 会拒绝疑似 secret 的变量名，例如 `PASSWORD`、`TOKEN`、`API_KEY`、`ACCESS_KEY`、`CLIENT_SECRET`、`SECRET`。

## 网页端权限模型

网页端保留登录与 allowlist 边界；当前候选登录后也不能执行策略激活：

- 未登录或不在 allowlist：只能看页面、填参数、复制 preview，不能执行切换。
- 已登录且 GitHub 用户名在 allowlist：可使用获准的配置／研究预览；切换请求通过其他校验后仍返回409及 `workflow_dispatched=false`。
- 前端不保存 GitHub token，不保存 broker secret，不把敏感值写进 localStorage、URL 或日志。
- 后端只做登录校验、allowlist 校验和 workflow dispatch，不直接写平台仓 variables，也不直接改 Cloud Run 或 Oracle/VPS。
- 后端使用 `RUNTIME_SETTINGS_DISPATCH_TOKEN` 触发 workflow；GitHub Actions 内部再使用 `RUNTIME_SETTINGS_GH_TOKEN` 写目标平台 variables。
- 跨平台变量写入保留在 `Manual Strategy Switch` workflow 的既有职责中，但当前 `Reject unconnected activation apply and sync` 步骤阻止写入／同步路径到达；不直接调用其后续脚本绕过。

仓库内提供了 Cloudflare Worker 示例：`web/strategy-switch-console/worker.js`。`ALLOWED_GITHUB_LOGINS` 限定可访问受保护操作的 GitHub 账号；配置 allowlist 不会解除当前激活阻断。

不建议做一个“网页密码 + 前端 token”或“网页密码 + 后端直接改配置”的方案。它看起来简单，但权限边界更差，也更容易在开源项目里泄漏高权限入口。

## 回滚

当前不能用尚未接通的 `apply=true` 路径执行回滚。已有生产恢复／版本回退须沿目标平台已批准入口，核对当前运行版本、账户身份和未决订单，并遵守相应授权与对账条件。代码回退不等于资金或在途订单回退；本说明不授予恢复执行权限。

## 可选增强

以后资金规模变大，或者多人一起维护，再打开这些：

- `runtime-strategy-switch` Environment required reviewers
- deployment branch 限制只允许 `main`
- token 90 天轮换
- 独立记录每次切换的 Actions run URL
