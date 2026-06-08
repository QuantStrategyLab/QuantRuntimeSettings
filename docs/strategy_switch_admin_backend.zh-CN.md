# 策略切换登录权限后台方案

目标：保持个人量化系统足够简单，同时不用每次改权限或账号下拉都重新改代码。

## 当前模式

- GitHub OAuth 登录。
- `ALLOWED_GITHUB_LOGINS` 控制谁能触发切换。
- `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON` 控制登录后可选账号。
- GitHub dispatch token 只在 Worker secret 里，前端拿不到。

这个模式可以先上线。它的缺点是：新增登录用户或账号 target 时，需要改 Worker secret。

## 推荐后台模式

保留 GitHub OAuth，使用一个只给管理员看的 `/admin` 页面：

- 管理员：由 `STRATEGY_SWITCH_ADMIN_LOGINS` 启动配置，建议只放你自己的 GitHub login。
- 可操作内容：
  - 当前已支持验证管理员身份，并展示四个平台已加载账号数量。
  - 后续接 KV 后，可添加或移除允许登录的 GitHub 用户名。
  - 后续接 KV 后，可编辑四个平台的账号下拉配置。
  - 后续接 KV 后，可查看最近的权限和账号配置修改记录。
- 存储：
  - Cloudflare KV namespace：`STRATEGY_SWITCH_CONFIG`。
  - key `auth_config`：保存 `allowed_logins`、`admin_logins`。
  - key `account_options`：保存四个平台账号下拉。
  - key `audit_log`：保存最近 50 条管理操作。

## 权限规则

- 未登录：只能看公开只读页。
- 登录但不在 allowlist：不能切换，也不能进入后台。
- 登录且在 allowlist：可以一键切换。
- 登录且在 admin list：可以进入后台管理权限和账号配置。
- `STRATEGY_SWITCH_ADMIN_LOGINS` 是兜底管理员，不通过后台删除，避免把自己锁在外面。

## 安全边界

- 后台只管理 GitHub login 和账号路由信息，不保存 broker 密码、token、API key。
- 所有后台写操作使用 POST，并复用当前 Worker 的 Same-Origin 校验。
- session cookie 继续使用 HttpOnly、Secure、SameSite=Lax 和 HMAC 签名。
- dispatch token 与后台配置分离；管理员能改账号路由，但不能在前端读取 token。
- 每次后台修改写 audit log，至少记录时间、管理员 login、操作类型，不记录密钥。

## 分阶段落地

1. 先上线当前 secret 模式：页面一键切换、账号配置由 `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON` 提供。
2. `/admin` 只读验证页已经具备：可验证 `STRATEGY_SWITCH_ADMIN_LOGINS` 管理权限，并展示已加载账号数量。
3. 给 Worker 增加 KV 读取：优先读 KV，没有 KV 时回退到 secrets。
4. 增加 `/api/admin/config` 写接口：管理员可更新 allowlist 和账号配置。
5. 增加 audit log 与回滚：保留最近版本，改错后可以恢复。

这个方案不引入独立数据库、用户系统或复杂 RBAC，适合个人开源项目。真正的权限根仍然是你的 GitHub 账号和 Worker secret。
