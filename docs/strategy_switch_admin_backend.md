# Strategy Switch Admin Backend

Goal: keep the open-source switch page public and read-only by default, while allowing an authenticated admin to manage who can switch strategies and which account routes appear in the dropdown.

## Current Implementation

- Login method: GitHub OAuth 2.0.
- Public access: unsigned visitors can view the page, but cannot dispatch the workflow.
- Allowed switch users: `ALLOWED_GITHUB_LOGINS`, KV `auth_config.allowed_logins`, and all admins.
- Admin users: `STRATEGY_SWITCH_ADMIN_LOGINS` plus KV `auth_config.admin_logins`.
- Account dropdowns: KV `account_options` first, falling back to `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON`.
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
- Allowlisted: can dispatch switches.
- Admin-listed: can open `/admin` and manage allowed logins, admin logins, and account dropdown JSON.
- `STRATEGY_SWITCH_ADMIN_LOGINS` remains the break-glass admin source and is preserved on save.

## Security Boundary

- The admin backend stores GitHub logins and account routing metadata only.
- Broker passwords, tokens, API keys, and cloud credentials stay out of this config.
- Admin writes use POST and same-origin checks.
- Sessions use HttpOnly, Secure, SameSite=Lax, and HMAC-signed cookies.
- The GitHub dispatch token stays in Worker secrets and is never returned to frontend or admin APIs.

This keeps the personal system simple: no database, review flow, or custom RBAC, while preventing strangers from operating the public page.
