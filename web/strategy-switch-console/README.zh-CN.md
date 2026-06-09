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
ALLOWED_GITHUB_ORGS
STRATEGY_SWITCH_ADMIN_LOGINS
STRATEGY_SWITCH_ADMIN_ORGS
```

可选：

```text
RUNTIME_SETTINGS_REPO=QuantStrategyLab/QuantRuntimeSettings
RUNTIME_SETTINGS_WORKFLOW=manual-strategy-switch.yml
RUNTIME_SETTINGS_REF=main
STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON=<account-options.example.json 的内容>
```

`ALLOWED_GITHUB_LOGINS`、`ALLOWED_GITHUB_ORGS`、`STRATEGY_SWITCH_ADMIN_LOGINS` 和 `STRATEGY_SWITCH_ADMIN_ORGS` 用英文逗号分隔。个人系统建议用组织名做管理员入口，例如：

```text
STRATEGY_SWITCH_ADMIN_ORGS=QuantStrategyLab
STRATEGY_SWITCH_ADMIN_LOGINS=your-github-login
```

登录入口是 Worker 域名下的 `/login`，页面顶部保留一个“登录管理”入口。登录成功后访问 `/api/session` 会返回：

```json
{
  "authenticated": true,
  "login": "your-github-login",
  "allowed": true,
  "admin": true
}
```

`admin=true` 表示该账号在 `STRATEGY_SWITCH_ADMIN_LOGINS`、`STRATEGY_SWITCH_ADMIN_ORGS`，或 KV 后台管理员名单/组织中。直接访问 `/admin` 可以管理允许登录的 GitHub 用户、组织和账号下拉路由；非管理员会返回 403。

## 登录管理后台

登录方式使用 GitHub OAuth 2.0，并请求 `read:org` scope 来校验 GitHub 组织成员关系。建议把 `QuantStrategyLab` 放在 `STRATEGY_SWITCH_ADMIN_ORGS`，同时把你自己的 GitHub login 放在 `STRATEGY_SWITCH_ADMIN_LOGINS` 作为兜底管理员。

如果要让 `/admin` 保存修改，需要绑定 Cloudflare KV namespace：`STRATEGY_SWITCH_CONFIG`。Worker 会使用这些 key：

```text
auth_config
account_options
strategy_profiles
audit_log
```

没有绑定 KV 时，`/admin` 只读；Worker 会回退读取 `ALLOWED_GITHUB_LOGINS`、`ALLOWED_GITHUB_ORGS`、`STRATEGY_SWITCH_ADMIN_LOGINS`、`STRATEGY_SWITCH_ADMIN_ORGS` 和 `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON`。

## 文件结构

```text
index.html
worker.js
page_asset.js
wrangler.toml.example
```

`worker.js` 会通过 `page_asset.js` 发布 `web/strategy-switch-console/index.html`，并通过 `strategy_profiles_asset.js` 提供兜底 live-enabled 策略目录。改完页面或 `strategy-profiles.example.json` 后运行：

```bash
python3 scripts/sync_strategy_switch_page_asset.py
```

这会重新生成 `web/strategy-switch-console/page_asset.js` 和 `web/strategy-switch-console/strategy_profiles_asset.js`。部署 Worker 时需要同时带上 `worker.js`、`page_asset.js` 和 `strategy_profiles_asset.js`。

## 账号下拉配置

Worker 页面内置示例 target 作为兜底。登录后如果没有加载账号配置，“一键切换”仍会保持禁用，Worker 后端也会拒绝 dispatch，避免账号不匹配。复制示例文件后填入你的真实 target/account route：

```bash
cp web/strategy-switch-console/account-options.example.json /tmp/strategy-switch-accounts.json
```

然后把 JSON 作为 Worker secret：

```bash
cd web/strategy-switch-console
wrangler secret put STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON < /tmp/strategy-switch-accounts.json
```

绑定 `STRATEGY_SWITCH_CONFIG` 后，也可以直接在 `/admin` 编辑并保存同一份账号 JSON。KV 优先级高于 secret；secret 作为兜底配置。

每个账号项支持这些字段：

```json
{
  "key": "u15998061",
  "label": "u15998061",
  "target_name": "u15998061",
  "account_selector": "U15998061",
  "deployment_selector": "live-u1599-tqqq",
  "account_scope": "live-u1599-tqqq",
  "service_name": "interactive-brokers-live-u1599-tqqq-service",
  "default_strategy_profile": "tqqq_growth_income",
  "supported_domains": ["us_equity"]
}
```

Worker 会校验 dispatch 参数必须匹配这里的某个账号项，也会校验所选策略的 `domain` 是否在该账号的 `supported_domains` 内。只放路由信息，不放 broker 密码、token、API key。

`/api/strategy-profiles` 会返回公开的 live-enabled 策略目录，用于生成策略下拉框。读取优先级是 KV `strategy_profiles`、`STRATEGY_SWITCH_STRATEGY_PROFILES_JSON`、`strategy-profiles.example.json`。

登录用户访问 `/api/config` 时，Worker 还会读取目标平台仓库的当前 GitHub Variables。读取优先级是账号匹配的 `CLOUD_RUN_SERVICE_TARGETS_JSON`、匹配的 `RUNTIME_TARGET_JSON.strategy_profile`、`STRATEGY_PROFILE`；都读不到时，页面才回退到 `default_strategy_profile`。

## 策略 Profile 对齐规范

`strategy_profile` 是切换页、runtime settings 和各平台仓库之间的统一策略 ID。

新增或重命名策略 profile 时，需要同时做这些事：

- 在 `strategy-profiles.example.json` 增加 runtime-enabled profile id 和显示名称。
- 运行 `python3 scripts/sync_strategy_switch_page_asset.py` 重新生成 `strategy_profiles_asset.js`。
- 给每个策略 profile 设置 `domain`。当前支持 `us_equity` 和 `hk_equity`。
- 在 `account-options.example.json` 和已部署的 KV 账号配置里更新对应账号的 `default_strategy_profile` 和 `supported_domains`。
- 用 `strategy-profiles.example.json` 更新已部署 KV 的 `strategy_profiles` key。
- 确认平台仓库当前的 `RUNTIME_TARGET_JSON.strategy_profile` 或账号级 `CLOUD_RUN_SERVICE_TARGETS_JSON` 使用同一个 id。
- profile id 只使用小写字母、数字、点、下划线、短横线或等号。不要把账号名、密码、token、密钥信息写进 profile id。

切换页只允许选择 runtime-enabled 且 `domain` 属于当前账号 `supported_domains` 的策略。如果从 GitHub Variables 动态读到了未登记 profile，先补进策略目录再切换。

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
wrangler secret put ALLOWED_GITHUB_ORGS
wrangler secret put STRATEGY_SWITCH_ADMIN_LOGINS
wrangler secret put STRATEGY_SWITCH_ADMIN_ORGS
wrangler secret put STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON < /tmp/strategy-switch-accounts.json
```

如果要启用后台保存，先创建 KV：

```bash
wrangler kv namespace create STRATEGY_SWITCH_CONFIG
```

然后把返回的 namespace id 加到 `wrangler.toml`。

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
3. 点击“登录管理”，也可以直接访问 `/login`。
4. 如果登录账号在 allowlist 用户/组织或管理员用户/组织中，且账号配置已加载，按钮启用。
5. 顶部只保留“登录管理”入口；如果登录账号是管理员，点击后进入 `/admin` 管理登录权限和账号下拉。
6. 选择平台、账号、策略和模式后点击“一键切换”。
7. 页面返回 GitHub Actions 链接，用于查看运行结果。

这个模式适合个人系统：不需要审批人，但能避免公开网页被任何人直接切换。
