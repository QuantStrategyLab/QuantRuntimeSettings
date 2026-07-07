# 策略切换控制台

[English](README.md)

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
STRATEGY_SWITCH_PLATFORM_REPOSITORIES_JSON={"longbridge":"your-org/LongBridgePlatform","ibkr":"your-org/InteractiveBrokersPlatform","schwab":"your-org/CharlesSchwabPlatform","firstrade":"your-org/FirstradePlatform"}
STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON=<account-options.example.json 的内容>
```

Fork 用户也可以分别设置 `STRATEGY_SWITCH_LONGBRIDGE_REPO`、`STRATEGY_SWITCH_IBKR_REPO`、`STRATEGY_SWITCH_SCHWAB_REPO`、`STRATEGY_SWITCH_FIRSTRADE_REPO`。GitHub Actions workflow 侧也支持同样的映射，变量名是 `RUNTIME_SETTINGS_PLATFORM_REPOSITORIES_JSON` 或 `RUNTIME_SETTINGS_*_REPO`。

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
  "key": "ibkr-primary",
  "label": "ibkr-primary",
  "target_name": "ibkr-primary",
  "account_selector": "DEMO_IBKR_PRIMARY",
  "deployment_selector": "demo-ibkr-tqqq",
  "account_scope": "demo-ibkr-tqqq",
  "service_name": "interactive-brokers-demo-ibkr-tqqq-service",
  "cash_currency": "USD",
  "supported_domains": ["us_equity", "hk_equity"]
}
```

Worker 会校验 dispatch 参数必须匹配这里的某个账号项，也会校验所选策略的 `domain` 是否在该账号的 `supported_domains` 内。只放路由信息，不放 broker 密码、token、API key。

`/api/strategy-profiles` 会返回公开的 live-enabled 策略目录，用于生成策略下拉框。读取优先级是 KV `strategy_profiles`、`STRATEGY_SWITCH_STRATEGY_PROFILES_JSON`、`strategy-profiles.example.json`。

登录用户访问 `/api/config` 时，Worker 还会读取目标平台仓库的当前 GitHub Variables。读取优先级是账号匹配的 `CLOUD_RUN_SERVICE_TARGETS_JSON`、匹配的 `RUNTIME_TARGET_JSON.strategy_profile`、`STRATEGY_PROFILE`。如果 GitHub 变量中未配置策略，页面会显示"未配置"状态，不再使用硬编码回退值。

切换表单也支持可选的预留现金覆盖项：所选账号币种下的最小预留现金和预留现金比例。如果账号现金币种固定，可以在账号配置里把 `cash_currency` 设为 `USD`、`HKD` 或 `CNY`；否则页面会按所选策略推断，A 股策略显示 CNY，港股策略显示 HKD，美股策略显示 USD。沿用当前策略会保留平台现有变量；如果平台没有显式配置预留现金变量，源码默认是不额外预留（账号币种 `0`、比例 `0%`）。填写后，Worker 会把它们传给 `manual-strategy-switch.yml`，由 workflow 写入平台对应变量，例如 `IBKR_MIN_RESERVED_CASH_USD` 和 `IBKR_RESERVED_CASH_RATIO`。

「允许融资」与「预留现金覆盖」在网页上互斥：选「允许融资：是」会禁用预留现金覆盖；设置比例/金额类预留覆盖会禁用「允许融资：是」，并自动切到「否」。QMT（A 股）平台不展示这两项，现金约束在 CnEquityStrategies 策略参数 `execution_cash_reserve_ratio` 内配置。

收入层控件来自 `strategy-profiles.example.json` 里的 live 验证策略元数据。切换页可以沿用当前配置、按 profile 默认起始金额和最高比例开启收入层，或关闭收入层。期权层也来自同一份策略 profile 元数据，但网页只暴露三态策略：沿用当前、启用 profile 默认 recipe 和预算、或关闭并清理期权层变量。手工切换请求仍不能通过 `extra_variables_json` 覆盖直接期权 overlay / LEAPS 字段；Worker 和构建脚本会拒绝这些直接覆盖项。

策略切换成功后会将账号级设置（plugin_mode、option_overlay_mode、cash_only_execution_mode、DCA 模式）同步回 KV 的 `account_options` key。策略 profile 本身仅保存在 GitHub 变量（`RUNTIME_TARGET_JSON` / `STRATEGY_PROFILE`）中，不在 KV 中重复存储。

## 策略 Profile 对齐规范

`strategy_profile` 是切换页、runtime settings 和各平台仓库之间的统一策略 ID。

新增或重命名策略 profile 时，需要同时做这些事：

- 在 `strategy-profiles.example.json` 增加 runtime-enabled profile id 和显示名称。
- 运行 `python3 scripts/sync_strategy_switch_page_asset.py` 重新生成 `strategy_profiles_asset.js`。
- 给每个策略 profile 设置 `domain`。当前支持 `us_equity`、`hk_equity` 和 `cn_equity`。
- 在 `account-options.example.json` 和已部署的 KV 账号配置里更新对应账号的 `supported_domains`。策略 profile 通过 GitHub 变量的策略切换工作流进行管理。
- LongBridge 和 IBKR 账号默认写 `["us_equity", "hk_equity"]`，除非你明确要把某个账号限制成单市场。
- QMT 账号写 `supported_domains: ["cn_equity"]`，`cash_currency: "CNY"`，并指向 `QuantStrategyLab/QmtPlatform` 仓库里的 target（见 `examples/targets/qmt/`）。当前阶段 **仅 dry-run**，无 live 券商账号；控制台会锁定 paper 模式，Worker 拒绝 QMT live 切换。Worker 后端已支持 `qmt`；平台 Cloud Run sync 目前仍会在 workflow 里 skip，切换策略本身可正常触发。
- 架构说明见 `examples/targets/qmt/README.zh-CN.md`。Runtime-enabled 的 A 股策略为 `cn_industry_etf_rotation`（主轨）与 `cn_dividend_quality_snapshot`；`cn_index_etf_tactical_rotation` 为 research-only，不要放进切换页策略目录。
- main 分支部署 workflow 会在 Worker 部署后，用 `strategy-profiles.example.json` 自动更新已部署 KV 的 `strategy_profiles` key。手动部署时，可用 Worker 同步 token 调用 `/api/internal/sync-strategy-profiles`。
- 确认平台仓库当前的 `RUNTIME_TARGET_JSON.strategy_profile` 或账号级 `CLOUD_RUN_SERVICE_TARGETS_JSON` 使用同一个 id。
- 让 `manual-strategy-switch.yml` 统一管理平台 plugin mounts。策略不需要插件时，它会写入空的 `*_STRATEGY_PLUGIN_MOUNTS_JSON`，清掉旧策略留下的插件配置。
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
wrangler secret put STRATEGY_SWITCH_SYNC_TOKEN # 可选；默认复用 RUNTIME_SETTINGS_DISPATCH_TOKEN
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

GitHub Actions 自动部署需要在 `runtime-strategy-switch` environment 配置 `STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID`、`STRATEGY_SWITCH_CONSOLE_URL`、`STRATEGY_SWITCH_SYNC_TOKEN`，以及 `CLOUDFLARE_API_TOKEN` 或 `CLOUDFLARE_WRANGLER_CONFIG_TOML` 二选一（只有当 `RUNTIME_SETTINGS_GH_TOKEN` 与 Worker 同步密钥相同时才复用它）。如果 Wrangler 能从 token 推断账号，`CLOUDFLARE_ACCOUNT_ID` 可不配。workflow 会先部署 Worker，再把内置策略 profile 目录同步到 KV，避免网站继续使用旧的 profile/plugin 元数据。

部署：

```bash
wrangler deploy
```

完整 fork 清单见 [docs/strategy_switch_fork_guide.zh-CN.md](../../docs/strategy_switch_fork_guide.zh-CN.md)。

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
