# 策略切换控制台

这是个人量化系统的登录版网页控制台示例。它用 Cloudflare Worker 提供一个很薄的后端：

- 未登录或不在 allowlist：只能查看公开页面，不能触发切换。
- 已登录且 GitHub 用户名在 allowlist：可以从账号下拉框选择目标，然后点击“一键切换”，由 Worker 服务端触发 GitHub Actions workflow。
- GitHub token 只放在 Worker secret 中，不进入前端、不写入开源代码。

## 必要配置

Worker 需要这些环境变量或 secret：

```text
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
SESSION_SECRET
RUNTIME_SETTINGS_DISPATCH_TOKEN
ALLOWED_GITHUB_LOGINS
STRATEGY_SWITCH_ADMIN_LOGINS
```

可选：

```text
RUNTIME_SETTINGS_REPO=QuantStrategyLab/QuantRuntimeSettings
RUNTIME_SETTINGS_WORKFLOW=manual-strategy-switch.yml
RUNTIME_SETTINGS_REF=main
STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON={"longbridge":[{"key":"hk","label":"hk","target_name":"hk","account_selector":"HK"},{"key":"sg","label":"sg","target_name":"sg","account_selector":"SG"},{"key":"paper","label":"paper","target_name":"paper","account_selector":"PAPER"}],"ibkr":[{"key":"u0000000","label":"u0000000","target_name":"u0000000","account_selector":"u0000000"}],"schwab":[{"key":"default","label":"default","target_name":"default"}],"firstrade":[{"key":"default","label":"default","target_name":"default"}]}
```

`ALLOWED_GITHUB_LOGINS` 和 `STRATEGY_SWITCH_ADMIN_LOGINS` 用英文逗号分隔，例如：

```text
your-github-login
```

登录入口是 Worker 域名下的 `/login`，页面顶部会在 Worker 可用时显示“登录 GitHub”。登录成功后访问 `/api/session` 会返回：

```json
{
  "authenticated": true,
  "login": "your-github-login",
  "allowed": true,
  "admin": true
}
```

`admin=true` 表示该账号在 `STRATEGY_SWITCH_ADMIN_LOGINS` 中。也可以直接访问 `/admin` 验证管理权限；非管理员会返回 403。

## 文件结构

```text
worker.js
page_asset.js
wrangler.toml.example
```

`worker.js` 会复用 `docs/index.html` 的同一套页面。改完页面后运行：

```bash
python3 scripts/sync_strategy_switch_page_asset.py
```

这会重新生成 `web/strategy-switch-console/page_asset.js`。部署 Worker 时需要同时带上 `worker.js` 和 `page_asset.js`。

## 账号下拉配置

公开页面只带示例 target，登录后如果没有加载私有账号配置，“一键切换”仍会保持禁用，Worker 后端也会拒绝 dispatch，避免账号不匹配。复制示例文件后填入你的真实 target/account route：

```bash
cp web/strategy-switch-console/account-options.example.json /tmp/strategy-switch-accounts.json
```

然后把 JSON 作为 Worker secret：

```bash
cd web/strategy-switch-console
wrangler secret put STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON < /tmp/strategy-switch-accounts.json
```

每个账号项支持这些字段：

```json
{
  "key": "u0000000",
  "label": "u0000000",
  "target_name": "u0000000",
  "account_selector": "u0000000",
  "service_name": "interactive-brokers-u0000000-service"
}
```

Worker 会校验 dispatch 参数必须匹配这里的某个账号项。只放路由信息，不放 broker 密码、token、API key。

## GitHub OAuth App

创建 GitHub OAuth App：

- Homepage URL：Worker 域名
- Authorization callback URL：`https://你的域名/callback`

把 OAuth App 的 client id 和 client secret 配到 Worker。

## Cloudflare Worker 部署

复制示例配置：

```bash
cp web/strategy-switch-console/wrangler.toml.example web/strategy-switch-console/wrangler.toml
```

进入目录后设置 secrets：

```bash
cd web/strategy-switch-console
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put SESSION_SECRET
wrangler secret put RUNTIME_SETTINGS_DISPATCH_TOKEN
wrangler secret put ALLOWED_GITHUB_LOGINS
wrangler secret put STRATEGY_SWITCH_ADMIN_LOGINS
wrangler secret put STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON < /tmp/strategy-switch-accounts.json
```

部署：

```bash
wrangler deploy
```

## Token 权限

`RUNTIME_SETTINGS_DISPATCH_TOKEN` 只需要能触发 `QuantRuntimeSettings` 仓库的 workflow。实际跨平台 variables 写入仍由 `Manual Strategy Switch` workflow 内部使用 GitHub Actions 环境里的 `RUNTIME_SETTINGS_GH_TOKEN` 执行。

`STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON` 建议作为 secret 配置，这样真实账号下拉项只会在登录且通过 allowlist 后返回给前端。它只放账号路由信息，不要放 broker、email、cloud、API key 等密钥。

## 操作流程

1. 访问控制台页面。
2. 未登录时只能查看公开示例，“一键切换”按钮禁用。
3. 点击“登录 GitHub”，也可以直接访问 `/login`。
4. 如果登录账号在 `ALLOWED_GITHUB_LOGINS` 或 `STRATEGY_SWITCH_ADMIN_LOGINS`，且账号配置已加载，按钮启用。
5. 顶部只保留“登录管理”入口；如果登录账号在 `STRATEGY_SWITCH_ADMIN_LOGINS`，点击后进入 `/admin` 验证管理权限。
6. 选择平台、账号、策略和模式后点击“一键切换”。
7. 页面返回 GitHub Actions 链接，用于查看运行结果。

这个模式适合个人系统：不需要审批人，但能避免公开网页被任何人直接切换。
