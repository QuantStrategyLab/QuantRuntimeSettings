# 手动策略切换权限控制方案

[English](manual_strategy_switch_permission_control.md)

这是个人量化系统的简化权限方案。默认目标不是做团队审批，而是让你自己能像让 Codex 切换一样直接操作，同时保留必要的防误触和防泄密边界。

## 默认方案：个人单人模式

只需要这几条：

1. 只有你自己的 GitHub 账号有这个仓库的 write/admin 权限。
2. 在 GitHub secret 里配置 `RUNTIME_SETTINGS_GH_TOKEN`。
3. token 只给目标平台仓库需要的 variables/workflow 权限，不给 `contents: write`。
4. 第一次运行 workflow 用 `apply=false` 看 preview。
5. 确认后再运行 `apply=true`，填写 `confirm_apply=APPLY` 或 `APPLY_AND_SYNC`。
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
- 如果要自动同步 Cloud Run，允许 dispatch 目标平台 workflow。

不需要：

- `contents: write`
- issue/PR/release/packages 权限
- organization admin 权限

## 日常切换流程

1. 打开 Actions 里的 `Manual Strategy Switch`。
2. 填 `platform`、`target_name`、`strategy_profile`。
3. 先保持 `apply=false` 跑一次，检查 preview。
4. 没问题后再跑一次：
   - 只写变量：`apply=true`，`confirm_apply=APPLY`
   - 写变量并同步平台：`apply=true`，`trigger_platform_sync=true`，`confirm_apply=APPLY_AND_SYNC`

这就是个人模式下的一键切换。不需要找 Codex，也不需要人工审批。

## 保留的安全门

这些防线不会增加太多操作成本，但能挡住常见误操作：

- `apply=false` 默认只预览，不改远端。
- `apply=true` 必须写确认词。
- 没有 `RUNTIME_SETTINGS_GH_TOKEN` 时不能真实写入。
- IBKR 会 patch 指定 target，不覆盖其他 IBKR 服务。
- `extra_variables_json` 不能覆盖系统自动生成的核心变量。
- `extra_variables_json` 会拒绝疑似 secret 的变量名，例如 `PASSWORD`、`TOKEN`、`API_KEY`、`ACCESS_KEY`、`CLIENT_SECRET`、`SECRET`。

## 网页端权限模型

网页端按个人模式做成“公开只读，登录可执行”：

- 未登录或不在 allowlist：只能看页面、填参数、复制 preview，不能执行切换。
- 已登录且 GitHub 用户名在 allowlist：页面启用“一键执行”，由后端触发 GitHub workflow。
- 前端不保存 GitHub token，不保存 broker secret，不把敏感值写进 localStorage、URL 或日志。
- 后端只做登录校验、allowlist 校验和 workflow dispatch，不直接写平台仓 variables，也不直接改 Cloud Run。
- 后端使用 `RUNTIME_SETTINGS_DISPATCH_TOKEN` 触发 workflow；GitHub Actions 内部再使用 `RUNTIME_SETTINGS_GH_TOKEN` 写目标平台 variables。
- 真正跨平台变量写入仍由 `Manual Strategy Switch` workflow 执行，继续复用 preview、确认词和 secret 变量名校验。

仓库内提供了 Cloudflare Worker 示例：`web/strategy-switch-console/worker.js`。部署后配置 `ALLOWED_GITHUB_LOGINS`，只有白名单里的 GitHub 账号能点击执行。

不建议做一个“网页密码 + 前端 token”或“网页密码 + 后端直接改配置”的方案。它看起来简单，但权限边界更差，也更容易在开源项目里泄漏高权限入口。

## 回滚

回滚也用同一个 workflow：

1. 选择上一个稳定 `strategy_profile`。
2. 保持同一个 `platform` 和 `target_name`。
3. 运行 `apply=true`。
4. 如果之前同步过 Cloud Run，这次也用 `APPLY_AND_SYNC`。

## 可选增强

以后资金规模变大，或者多人一起维护，再打开这些：

- `runtime-strategy-switch` Environment required reviewers
- deployment branch 限制只允许 `main`
- token 90 天轮换
- 独立记录每次切换的 Actions run URL
