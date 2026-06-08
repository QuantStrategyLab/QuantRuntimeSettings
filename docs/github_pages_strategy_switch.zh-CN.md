# GitHub Pages 策略切换网页设计

推荐把网页拆成两层：

1. GitHub Pages：公开、只读、无 secret。
2. Protected Worker：登录、allowlist、一键触发 workflow。

这样开源项目可以放心展示控制台 UI，真正切换能力不会暴露给访客。

## GitHub Pages 层

使用 `docs/index.html` 作为公开首页：

- 支持中文/英文切换。
- 可以填写平台、策略、目标和执行模式。
- 实时生成 workflow inputs 和 GitHub CLI 命令。
- 不保存 token。
- 不直接写 GitHub variables。
- 不直接改 Cloud Run。
- 未接入后端时“一键执行”按钮禁用。

GitHub 仓库设置：

```text
Settings -> Pages -> Build and deployment
Source: Deploy from a branch
Branch: main
Folder: /docs
```

启用后，公开地址通常是：

```text
https://quantstrategylab.github.io/QuantRuntimeSettings/
```

如果组织或仓库名不同，以 GitHub Pages 页面显示的 URL 为准。

## Protected Worker 层

登录版控制台使用：

```text
web/strategy-switch-console/worker.js
```

Worker 复用同一个 `docs/index.html` 页面。改动页面后运行：

```bash
python3 scripts/sync_strategy_switch_page_asset.py
```

这会生成 `web/strategy-switch-console/page_asset.js`，避免 GitHub Pages 和登录版 Worker 出现两套不同 UI。

Worker 负责：

- GitHub OAuth 登录。
- 检查 `ALLOWED_GITHUB_LOGINS`。
- 通过服务端 secret `RUNTIME_SETTINGS_DISPATCH_TOKEN` 触发 `manual-strategy-switch.yml`。

Worker 不负责：

- 不直接写平台仓 variables。
- 不直接调用 Cloud Run。
- 不把 token 发到浏览器。

真实变量写入仍在 GitHub Actions workflow 中完成，并继续使用 `RUNTIME_SETTINGS_GH_TOKEN`、确认词和 secret 变量名校验。

## Secret 分层

GitHub Pages：

```text
不需要 secret
```

Worker secrets：

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

GitHub Actions Environment secret：

```text
RUNTIME_SETTINGS_GH_TOKEN
```

这两个 token 不要混用。`RUNTIME_SETTINGS_DISPATCH_TOKEN` 只负责触发 RuntimeSettings 仓库 workflow；`RUNTIME_SETTINGS_GH_TOKEN` 只在 GitHub Actions 内部写目标平台仓变量。

## 推荐上线顺序

1. 先合并 `docs/index.html`，启用 GitHub Pages，只发布只读控制台。
2. 配置 `Manual Strategy Switch` workflow 和 `RUNTIME_SETTINGS_GH_TOKEN`。
3. 部署 Worker，配置 GitHub OAuth、允许登录用户/组织和管理员用户/组织。
4. 先用受控账号测试登录、账号下拉和 workflow dispatch。
5. 再用低风险目标测试 `apply=true`。

## 为什么不直接在 GitHub Pages 一键切换

GitHub Pages 是纯静态托管。只要把 token 放进去，开源后任何人都可能看到或复用。即使 token 只在浏览器内存中，也很难做到稳定的 allowlist、审计和失效控制。

所以 GitHub Pages 只做公开只读；一键切换放到登录版 Worker。
