# Strategy Switch Console Worker

This is the authenticated backend for the personal strategy switch console. It is intentionally thin:

- Visitors who are not signed in, or are not in the allowlist, can only view the public page.
- Allowlisted GitHub logins can select an account from the dropdown and click `Switch now`; the Worker triggers the GitHub Actions workflow server-side.
- Tokens stay in Worker secrets and GitHub Actions environment secrets. They are not sent to the browser or committed to the repository.

## Required Secrets

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

Optional variables:

```text
RUNTIME_SETTINGS_REPO=QuantStrategyLab/QuantRuntimeSettings
RUNTIME_SETTINGS_WORKFLOW=manual-strategy-switch.yml
RUNTIME_SETTINGS_REF=main
STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON=<contents of account-options.example.json>
```

`ALLOWED_GITHUB_LOGINS`, `ALLOWED_GITHUB_ORGS`, `STRATEGY_SWITCH_ADMIN_LOGINS`, and `STRATEGY_SWITCH_ADMIN_ORGS` are comma-separated lists. Prefer the organization name for admin access:

```text
STRATEGY_SWITCH_ADMIN_ORGS=QuantStrategyLab
STRATEGY_SWITCH_ADMIN_LOGINS=your-github-login
```

The login entrypoint is `/login` on the Worker domain. The page header keeps a single Login Management entry. After sign-in, `/api/session` returns:

```json
{
  "authenticated": true,
  "login": "your-github-login",
  "allowed": true,
  "admin": true
}
```

`admin=true` means the login or one of its GitHub organizations is listed in `STRATEGY_SWITCH_ADMIN_LOGINS`, `STRATEGY_SWITCH_ADMIN_ORGS`, or the KV-backed admin config. Open `/admin` to manage allowed GitHub logins, organizations, and account dropdown routes; non-admin users receive 403.

## Admin Management

GitHub OAuth 2.0 is the only login method. The Worker requests the `read:org` scope to verify GitHub organization membership. Put `QuantStrategyLab` in `STRATEGY_SWITCH_ADMIN_ORGS`, and keep your own GitHub login in `STRATEGY_SWITCH_ADMIN_LOGINS` as a break-glass admin.

For editable admin settings, bind a Cloudflare KV namespace named `STRATEGY_SWITCH_CONFIG`. The Worker uses these KV keys:

```text
auth_config
account_options
audit_log
```

Without the KV binding, `/admin` is read-only and the Worker falls back to `ALLOWED_GITHUB_LOGINS`, `ALLOWED_GITHUB_ORGS`, `STRATEGY_SWITCH_ADMIN_LOGINS`, `STRATEGY_SWITCH_ADMIN_ORGS`, and `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON`.

## Page Asset

`worker.js` serves `web/strategy-switch-console/index.html` through `page_asset.js`.

After editing `web/strategy-switch-console/index.html`, regenerate the asset:

```bash
python3 scripts/sync_strategy_switch_page_asset.py
```

Deploy `worker.js` and `page_asset.js` together.

## Account Dropdowns

The Worker page ships sample targets as a fallback. After sign-in, switching stays disabled until the Worker loads configured account options; the Worker also rejects dispatches without matching account config. Copy the example and fill in your real target/account routes:

```bash
cp web/strategy-switch-console/account-options.example.json /tmp/strategy-switch-accounts.json
```

Store it as a Worker secret:

```bash
cd web/strategy-switch-console
wrangler secret put STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON < /tmp/strategy-switch-accounts.json
```

After `STRATEGY_SWITCH_CONFIG` is bound, admins can also edit and save the same account JSON from `/admin`. KV takes precedence over the secret; the secret remains a fallback.

Each account item supports:

```json
{
  "key": "u15998061",
  "label": "u15998061",
  "target_name": "u15998061",
  "account_selector": "U15998061",
  "deployment_selector": "live-u1599-tqqq",
  "account_scope": "live-u1599-tqqq",
  "service_name": "interactive-brokers-live-u1599-tqqq-service",
  "default_strategy_profile": "tqqq_growth_income"
}
```

The Worker validates dispatch inputs against this config. Keep only routing metadata here. Do not store broker passwords, tokens, or API keys in this config.

## GitHub OAuth App

Create a GitHub OAuth App:

- Homepage URL: your Worker URL
- Authorization callback URL: `https://your-worker-domain/callback`

Store the client ID and client secret in Worker secrets.

## Deploy With Wrangler

Copy the example config:

```bash
cp web/strategy-switch-console/wrangler.toml.example web/strategy-switch-console/wrangler.toml
```

Set secrets:

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

Create and bind KV if you want `/admin` to save changes:

```bash
wrangler kv namespace create STRATEGY_SWITCH_CONFIG
```

Add the returned namespace id to `wrangler.toml`.

Deploy:

```bash
wrangler deploy
```

## Token Scope

`RUNTIME_SETTINGS_DISPATCH_TOKEN` only needs permission to dispatch workflows in the `QuantRuntimeSettings` repository. Cross-platform variable writes still happen inside `Manual Strategy Switch` with the GitHub Actions environment secret `RUNTIME_SETTINGS_GH_TOKEN`.

Configure `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON` as a secret if it contains real account routes. It is returned only after an allowlisted login. Keep broker, email, cloud, API key, and token values out of this config.
