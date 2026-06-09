# 策略切换登录权限后台

目标：开源页面可以公开查看，但只有登录并通过权限校验的 GitHub 账号能一键切换策略；管理员可以自己维护登录名单和账号下拉，不需要每次改代码。

## 当前实现

- 登录方式：GitHub OAuth 2.0。
- 公开访问：未登录用户只能看到只读切换页，不能触发 workflow。
- 可切换用户/组织：来自 `ALLOWED_GITHUB_LOGINS`、`ALLOWED_GITHUB_ORGS`、KV `auth_config.allowed_logins`、KV `auth_config.allowed_orgs` 和管理员配置。
- 管理员用户/组织：来自 `STRATEGY_SWITCH_ADMIN_LOGINS`、`STRATEGY_SWITCH_ADMIN_ORGS`、KV `auth_config.admin_logins` 和 KV `auth_config.admin_orgs`。
- 账号下拉和账号策略市场范围：优先读取 KV `account_options`，没有 KV 配置时回退 `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON`。
- 审计：管理员保存配置后写入 KV `audit_log`，保留最近 50 条。

## Cloudflare KV

绑定 namespace：

```toml
[[kv_namespaces]]
binding = "STRATEGY_SWITCH_CONFIG"
id = "..."
```

使用的 key：

```text
auth_config
account_options
audit_log
```

没有绑定 KV 时，`/admin` 只读；登录和切换仍可通过 Worker secrets 运行。

## 权限规则

- 未登录：只能查看公开页面。
- 登录但不在 allowlist：不能切换，也不能进入后台。
- allowlist 用户或组织成员：可以一键切换。
- admin 用户或管理员组织成员：可以进入 `/admin`，维护 allowlist、admin list、组织名单和账号下拉 JSON。
- `STRATEGY_SWITCH_ADMIN_LOGINS` 和 `STRATEGY_SWITCH_ADMIN_ORGS` 是兜底管理员来源，后台保存时会自动保留，避免把自己锁在外面。

## 安全边界

- 后台只保存 GitHub login、GitHub 组织名和账号路由信息。
- 账号配置可以包含 `supported_domains`，例如 `us_equity` 或 `hk_equity`，用于前端过滤不支持的策略，并由 Worker 后端再次拒绝非法组合。
- OAuth 会请求 `read:org` scope，用于校验登录用户是否属于配置的管理员组织或 allowlist 组织。
- 不保存 broker 密码、token、API key 或云密钥。
- 后台写操作使用 POST，并校验 Same-Origin。
- session cookie 使用 HttpOnly、Secure、SameSite=Lax 和 HMAC 签名。
- GitHub dispatch token 只在 Worker secret 中，前端和后台配置接口都不会返回。

这个方案保留个人项目的简单性：没有独立数据库、审批流或复杂 RBAC，但公开页面不能被陌生人直接操作。
