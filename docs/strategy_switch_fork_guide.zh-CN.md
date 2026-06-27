# Fork 指南：策略切换控制台

[English](strategy_switch_fork_guide.md)

这份文档说明别人 fork 本仓库后，如何部署同样的“公开只读、登录后一键切换”策略控制台。

## 你需要准备什么

- 一个拥有 fork 仓库的 GitHub 个人账号或组织。
- 可选的 LongBridge、IBKR、Schwab、Firstrade 平台自动化仓库。
- 一个启用 Workers 的 Cloudflare 账号。
- 一个用于登录的 GitHub OAuth App。
- 一个能触发本仓库 workflow 的 fine-grained GitHub token。
- 一个放在 GitHub Actions secret 里的 token，用于写入平台仓库 variables。

不要提交 broker 凭据、云凭据、API key、账号密码或 personal access token。

## 仓库映射

默认平台仓库映射指向 QuantStrategyLab：

```text
longbridge -> QuantStrategyLab/LongBridgePlatform
ibkr       -> QuantStrategyLab/InteractiveBrokersPlatform
schwab     -> QuantStrategyLab/CharlesSchwabPlatform
firstrade  -> QuantStrategyLab/FirstradePlatform
```

Fork 用户不需要改源码，可以用配置覆盖。

在 fork 后的 GitHub 仓库 variables 里设置平台仓库映射：

```text
RUNTIME_SETTINGS_LONGBRIDGE_REPO=your-org/LongBridgePlatform
RUNTIME_SETTINGS_IBKR_REPO=your-org/InteractiveBrokersPlatform
RUNTIME_SETTINGS_SCHWAB_REPO=your-org/CharlesSchwabPlatform
RUNTIME_SETTINGS_FIRSTRADE_REPO=your-org/FirstradePlatform
```

也可以只设置一个 JSON 变量：

```json
{
  "longbridge": "your-org/LongBridgePlatform",
  "ibkr": "your-org/InteractiveBrokersPlatform",
  "schwab": "your-org/CharlesSchwabPlatform",
  "firstrade": "your-org/FirstradePlatform"
}
```

变量名用 `RUNTIME_SETTINGS_PLATFORM_REPOSITORIES_JSON`。

Cloudflare Worker 侧可以用同样的 JSON，变量名是 `STRATEGY_SWITCH_PLATFORM_REPOSITORIES_JSON`；也可以分别设置：

```text
RUNTIME_SETTINGS_REPO=your-org/QuantRuntimeSettings
STRATEGY_SWITCH_LONGBRIDGE_REPO=your-org/LongBridgePlatform
STRATEGY_SWITCH_IBKR_REPO=your-org/InteractiveBrokersPlatform
STRATEGY_SWITCH_SCHWAB_REPO=your-org/CharlesSchwabPlatform
STRATEGY_SWITCH_FIRSTRADE_REPO=your-org/FirstradePlatform
```

## GitHub Actions 配置

创建 GitHub Environment：

```text
runtime-strategy-switch
```

在这个 Environment 里添加 secret：

```text
RUNTIME_SETTINGS_GH_TOKEN
```

这个 token 由 `.github/workflows/manual-strategy-switch.yml` 使用，用来写入平台仓库的 GitHub Actions variables，并在需要时触发平台仓库的同步 workflow。建议用 fine-grained PAT，只授权你实际使用的平台仓库。

这个 token 不需要 `contents: write`。

## Worker 配置

创建 GitHub OAuth App：

```text
Homepage URL: https://你的-worker-域名
Authorization callback URL: https://你的-worker-域名/callback
```

复制 Worker 配置：

```bash
cp web/strategy-switch-console/wrangler.toml.example web/strategy-switch-console/wrangler.toml
```

编辑 `wrangler.toml`：

```toml
name = "your-strategy-switch-console"

[vars]
RUNTIME_SETTINGS_REPO = "your-org/QuantRuntimeSettings"
STRATEGY_SWITCH_PLATFORM_REPOSITORIES_JSON = '{"longbridge":"your-org/LongBridgePlatform","ibkr":"your-org/InteractiveBrokersPlatform","schwab":"your-org/CharlesSchwabPlatform","firstrade":"your-org/FirstradePlatform"}'
```

设置 Worker secrets：

```bash
cd web/strategy-switch-console
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put SESSION_SECRET
wrangler secret put RUNTIME_SETTINGS_DISPATCH_TOKEN
wrangler secret put STRATEGY_SWITCH_SYNC_TOKEN
wrangler secret put ALLOWED_GITHUB_LOGINS
wrangler secret put ALLOWED_GITHUB_ORGS
wrangler secret put STRATEGY_SWITCH_ADMIN_LOGINS
wrangler secret put STRATEGY_SWITCH_ADMIN_ORGS
```

`RUNTIME_SETTINGS_DISPATCH_TOKEN` 只需要能触发 fork 后 runtime settings 仓库里的 workflow。它不是写入平台 variables 的 token。

## 账号下拉配置

复制通用示例：

```bash
cp web/strategy-switch-console/account-options.example.json /tmp/strategy-switch-accounts.json
```

把里面的 route 名称、service 名称、account selector、支持市场改成自己的。这里仍然只放路由元数据，不放任何密钥。

保存为 Worker secret：

```bash
wrangler secret put STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON < /tmp/strategy-switch-accounts.json
```

如果希望网页后台可编辑，创建 KV：

```bash
wrangler kv namespace create STRATEGY_SWITCH_CONFIG
```

把返回的 id 写入 `wrangler.toml`，部署后可以在 `/admin` 编辑这些 key：

```text
auth_config
account_options
strategy_profiles
audit_log
```

## 策略目录

可切换策略目录在：

```text
web/strategy-switch-console/strategy-profiles.example.json
```

每个策略项需要：

```json
{
  "profile": "my_strategy_profile",
  "label": "My Strategy Profile",
  "domain": "us_equity",
  "runtime_enabled": true
}
```

当前支持的 domain：

```text
us_equity
hk_equity
```

修改策略目录或网页后运行：

```bash
python3 scripts/sync_strategy_switch_page_asset.py
```

## 部署和验证

部署 Worker：

```bash
cd web/strategy-switch-console
wrangler deploy
```

验证公开模式：

```bash
curl -s https://你的-worker-域名/api/config
```

未登录应返回：

```json
{
  "accountOptions": null
}
```

然后打开 Worker 页面：

- 未登录用户只能看到公开只读页。
- 登录并在 allowlist 中的用户能看到账号、策略、模式、当前状态和一键切换按钮。
- 管理员能打开 `/admin`。

## 本地检查

开 PR 前建议跑：

```bash
jq empty web/strategy-switch-console/account-options.example.json web/strategy-switch-console/strategy-profiles.example.json
node --experimental-default-type=module tests/strategy_switch_worker_validation.mjs
python3 scripts/runtime_settings.py validate
python3 -m unittest discover -s tests -v
git diff --check
```
