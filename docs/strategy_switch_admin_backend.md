# Strategy Switch Admin Backend

Goal: keep the personal strategy switch console simple while avoiding code changes for every login or account dropdown update.

## Current Mode

- GitHub OAuth signs users in.
- `ALLOWED_GITHUB_LOGINS` controls who can dispatch a switch.
- `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON` controls signed-in account dropdowns.
- The GitHub dispatch token stays in Worker secrets and is never sent to the browser.

This is enough for the first deployment. Its main limitation is that user and account changes require updating Worker secrets.

## Recommended Admin Mode

Keep GitHub OAuth and use an admin-only `/admin` page:

- Bootstrap admins come from `STRATEGY_SWITCH_ADMIN_LOGINS`; keep your own GitHub login there.
- Admin actions:
  - The current version verifies admin identity and shows configured account counts for the four platforms.
  - After KV is connected, add or remove allowed GitHub logins.
  - After KV is connected, edit account dropdowns for the four platforms.
  - After KV is connected, review recent permission and account-config changes.
- Storage:
  - Cloudflare KV namespace: `STRATEGY_SWITCH_CONFIG`.
  - key `auth_config`: `allowed_logins` and `admin_logins`.
  - key `account_options`: platform account dropdowns.
  - key `audit_log`: recent admin changes.

## Permission Rules

- Not signed in: public read-only page.
- Signed in but not allowlisted: no switch, no admin page.
- Allowlisted: can dispatch switches.
- Admin-listed: can manage login permissions and account dropdowns.
- `STRATEGY_SWITCH_ADMIN_LOGINS` remains the break-glass admin source so you cannot remove yourself through the UI.

## Security Boundary

- The admin backend stores GitHub logins and account routing metadata only.
- Broker passwords, tokens, API keys, and cloud credentials stay out of this config.
- Admin writes use POST and the existing Worker same-origin checks.
- Sessions keep HttpOnly, Secure, SameSite=Lax, and HMAC-signed cookies.
- Dispatch tokens remain separate from admin config and are never readable from frontend code.
- Audit logs record time, admin login, and action type, but never secrets.

## Rollout

1. Ship the current secret-backed console.
2. The read-only `/admin` verification page is already available for `STRATEGY_SWITCH_ADMIN_LOGINS`.
3. Add Worker KV reads with secret fallback.
4. Add `/api/admin/config` write operations for admins.
5. Add audit logs and last-version rollback.

This avoids a database, custom user system, or broad RBAC while still giving a practical backend for a personal open-source project.
