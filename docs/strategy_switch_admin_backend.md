# Strategy Switch Admin Backend

[简体中文](strategy_switch_admin_backend.zh-CN.md)

Goal: keep the open-source switch page public and read-only by default, while allowing an authenticated admin to manage who can switch strategies and which account routes appear in the dropdown.

## Current Implementation

- Login method: GitHub OAuth 2.0.
- Public access: unsigned visitors can view the page, but cannot dispatch the workflow.
- Allowed switch users/orgs: `ALLOWED_GITHUB_LOGINS`, `ALLOWED_GITHUB_ORGS`, KV `auth_config.allowed_logins`, KV `auth_config.allowed_orgs`, and all admins.
- Admin users/orgs: `STRATEGY_SWITCH_ADMIN_LOGINS`, `STRATEGY_SWITCH_ADMIN_ORGS`, KV `auth_config.admin_logins`, and KV `auth_config.admin_orgs`.
- Account dropdowns and account strategy domains: KV `account_options` first, falling back to `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON`.
- Audit log: each admin save appends to KV `audit_log`, capped at 50 entries.

## Cloudflare KV

Bind the namespace:

```toml
[[kv_namespaces]]
binding = "STRATEGY_SWITCH_CONFIG"
id = "..."
```

KV keys:

```text
auth_config
account_options
audit_log
```

Without the KV binding, `/admin` is read-only and the Worker falls back to secrets.

## Permission Rules

- Not signed in: public read-only page.
- Signed in but not allowlisted: no switch and no admin page.
- Allowlisted users or organization members: can dispatch switches.
- Admin users or admin organization members: can open `/admin` and manage allowed logins, allowed orgs, admin logins, admin orgs, and account dropdown JSON.
- `STRATEGY_SWITCH_ADMIN_LOGINS` and `STRATEGY_SWITCH_ADMIN_ORGS` remain break-glass admin sources and are preserved on save.

## Security Boundary

- The admin backend stores GitHub logins, GitHub organization names, and account routing metadata only.
- Account config may include `supported_domains`, such as `us_equity` or `hk_equity`, so unsupported strategies are filtered in the UI and rejected by the Worker.
- OAuth requests the `read:org` scope to verify membership in configured admin or allowlist organizations.
- Broker passwords, tokens, API keys, and cloud credentials stay out of this config.
- Admin writes use POST and same-origin checks.
- Sessions use HttpOnly, Secure, SameSite=Lax, and HMAC-signed cookies.
- The GitHub dispatch token stays in Worker secrets and is never returned to frontend or admin APIs.

This keeps the personal system simple: no database, review flow, or custom RBAC, while preventing strangers from operating the public page.
