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
STRATEGY_SWITCH_ADMIN_LOGINS
```

Optional variables:

```text
RUNTIME_SETTINGS_REPO=QuantStrategyLab/QuantRuntimeSettings
RUNTIME_SETTINGS_WORKFLOW=manual-strategy-switch.yml
RUNTIME_SETTINGS_REF=main
STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON={"longbridge":[{"key":"hk","label":"hk","target_name":"hk","account_selector":"HK"},{"key":"sg","label":"sg","target_name":"sg","account_selector":"SG"},{"key":"paper","label":"paper","target_name":"paper","account_selector":"PAPER"}],"ibkr":[{"key":"u0000000","label":"u0000000","target_name":"u0000000","account_selector":"u0000000"}],"schwab":[{"key":"default","label":"default","target_name":"default"}],"firstrade":[{"key":"default","label":"default","target_name":"default"}]}
```

`ALLOWED_GITHUB_LOGINS` and `STRATEGY_SWITCH_ADMIN_LOGINS` are comma-separated lists:

```text
your-github-login
```

The login entrypoint is `/login` on the Worker domain. When the Worker is available, the page header shows the GitHub sign-in link. After sign-in, `/api/session` returns:

```json
{
  "authenticated": true,
  "login": "your-github-login",
  "allowed": true,
  "admin": true
}
```

`admin=true` means the login is listed in `STRATEGY_SWITCH_ADMIN_LOGINS`. You can also open `/admin` directly to verify admin permission; non-admin users receive 403.

## Page Asset

`worker.js` serves the same UI as `docs/index.html` through `page_asset.js`.

After editing `docs/index.html`, regenerate the asset:

```bash
python3 scripts/sync_strategy_switch_page_asset.py
```

Deploy `worker.js` and `page_asset.js` together.

## Account Dropdowns

The public page only ships sample targets. After sign-in, switching stays disabled until the Worker loads private account options; the Worker also rejects dispatches without matching private account config. Copy the example and fill in your real target/account routes:

```bash
cp web/strategy-switch-console/account-options.example.json /tmp/strategy-switch-accounts.json
```

Store it as a Worker secret:

```bash
cd web/strategy-switch-console
wrangler secret put STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON < /tmp/strategy-switch-accounts.json
```

Each account item supports:

```json
{
  "key": "u0000000",
  "label": "u0000000",
  "target_name": "u0000000",
  "account_selector": "u0000000",
  "service_name": "interactive-brokers-u0000000-service"
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
wrangler secret put STRATEGY_SWITCH_ADMIN_LOGINS
wrangler secret put STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON < /tmp/strategy-switch-accounts.json
```

Deploy:

```bash
wrangler deploy
```

## Token Scope

`RUNTIME_SETTINGS_DISPATCH_TOKEN` only needs permission to dispatch workflows in the `QuantRuntimeSettings` repository. Cross-platform variable writes still happen inside `Manual Strategy Switch` with the GitHub Actions environment secret `RUNTIME_SETTINGS_GH_TOKEN`.

Configure `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON` as a secret if it contains real account routes. It is returned only after an allowlisted login. Keep broker, email, cloud, API key, and token values out of this config.
