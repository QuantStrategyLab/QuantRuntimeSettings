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
STRATEGY_SWITCH_PLATFORM_REPOSITORIES_JSON={"longbridge":"your-org/LongBridgePlatform","ibkr":"your-org/InteractiveBrokersPlatform","schwab":"your-org/CharlesSchwabPlatform","firstrade":"your-org/FirstradePlatform"}
STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON=<contents of account-options.example.json>
```

Forks can also override one platform at a time with `STRATEGY_SWITCH_LONGBRIDGE_REPO`, `STRATEGY_SWITCH_IBKR_REPO`, `STRATEGY_SWITCH_SCHWAB_REPO`, and `STRATEGY_SWITCH_FIRSTRADE_REPO`. The GitHub Actions workflow supports the same mapping with `RUNTIME_SETTINGS_PLATFORM_REPOSITORIES_JSON` or `RUNTIME_SETTINGS_*_REPO` repository variables.

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
strategy_profiles
audit_log
```

Without the KV binding, `/admin` is read-only and the Worker falls back to `ALLOWED_GITHUB_LOGINS`, `ALLOWED_GITHUB_ORGS`, `STRATEGY_SWITCH_ADMIN_LOGINS`, `STRATEGY_SWITCH_ADMIN_ORGS`, and `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON`.

## Page Asset

`worker.js` serves `web/strategy-switch-console/index.html` through `page_asset.js` and the fallback live-enabled strategy catalog through `strategy_profiles_asset.js`.

After editing `web/strategy-switch-console/index.html` or `strategy-profiles.example.json`, regenerate the assets:

```bash
python3 scripts/sync_strategy_switch_page_asset.py
```

Deploy `worker.js`, `page_asset.js`, and `strategy_profiles_asset.js` together.

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
  "key": "ibkr-primary",
  "label": "ibkr-primary",
  "target_name": "ibkr-primary",
  "account_selector": "DEMO_IBKR_PRIMARY",
  "deployment_selector": "demo-ibkr-tqqq",
  "account_scope": "demo-ibkr-tqqq",
  "service_name": "interactive-brokers-demo-ibkr-tqqq-service",
  "cash_currency": "USD",
  "default_strategy_profile": "tqqq_growth_income",
  "supported_domains": ["us_equity", "hk_equity"]
}
```

The Worker validates dispatch inputs against this config, including whether the selected strategy domain is supported by the selected account. Keep only routing metadata here. Do not store broker passwords, tokens, or API keys in this config.

`/api/strategy-profiles` returns the public live-enabled strategy catalog for the dropdown. It reads the KV `strategy_profiles` key first, then `STRATEGY_SWITCH_STRATEGY_PROFILES_JSON`, then `strategy-profiles.example.json`.

For signed-in users, `/api/config` also reads the target repositories' current GitHub Variables. It prefers account-specific `CLOUD_RUN_SERVICE_TARGETS_JSON`, then matching `RUNTIME_TARGET_JSON.strategy_profile`, then `STRATEGY_PROFILE`; if none can be read safely, the page falls back to `default_strategy_profile`.

The switch form also accepts optional reserved-cash overrides: minimum reserved cash in the selected account currency and reserved-cash ratio. Set `cash_currency` to `USD` or `HKD` in account config when the account has a fixed cash currency; otherwise the page infers HKD for HK-equity strategy selections and USD for US-equity selections. Keeping the current policy leaves existing platform variables unchanged; when no explicit platform variables are configured, the platform source default is no extra reserve (`0` in the account currency and `0%`). When set, the Worker passes the values to `manual-strategy-switch.yml`, which writes the platform-specific variables such as `IBKR_MIN_RESERVED_CASH_USD` and `IBKR_RESERVED_CASH_RATIO`.

Income-layer controls are sourced from `strategy-profiles.example.json` metadata for live-validated US equity strategies. The switch form can keep the current setting, enable the income layer with the profile default start amount and cap, or disable it. Option-layer controls use the same strategy profile metadata but only expose a three-state policy: keep current, enable the profile default recipe and budget, or disable and clear option overlay variables. Manual switch requests still cannot override direct option overlay or LEAPS fields through `extra_variables_json`; the Worker and build script reject those direct overrides.

Successful strategy switches also sync the selected account's `default_strategy_profile` back to the KV `account_options` key. The web endpoint does this immediately after dispatching the workflow, and the manual GitHub workflow calls the Worker's internal sync endpoint after applying platform variables when the `runtime-strategy-switch` environment variable `STRATEGY_SWITCH_CONSOLE_URL` is set. For that workflow callback, set the GitHub environment secret `STRATEGY_SWITCH_SYNC_TOKEN` to the same value as the Worker secret with that name.

## Strategy Profile Alignment

Treat `strategy_profile` as the canonical strategy id across the switch console, runtime settings, and platform repositories.

When adding or renaming a strategy profile:

- Add the runtime-enabled profile id and display label to `strategy-profiles.example.json`.
- Run `python3 scripts/sync_strategy_switch_page_asset.py` so `strategy_profiles_asset.js` is regenerated.
- Set `domain` on each strategy profile. Current values are `us_equity` and `hk_equity`.
- Set each affected account's `default_strategy_profile` and `supported_domains` in `account-options.example.json` and the deployed KV account config.
- Use `["us_equity", "hk_equity"]` for LongBridge and IBKR accounts unless you intentionally want to narrow a specific account.
- The main-branch deploy workflow updates the deployed KV `strategy_profiles` key from `strategy-profiles.example.json` after deploying the Worker. For manual deploys, call `/api/internal/sync-strategy-profiles` with the Worker sync token.
- Make sure the platform repository's current `RUNTIME_TARGET_JSON.strategy_profile` or account-specific `CLOUD_RUN_SERVICE_TARGETS_JSON` uses the same id.
- Let `manual-strategy-switch.yml` manage platform plugin mounts. It writes an empty `*_STRATEGY_PLUGIN_MOUNTS_JSON` payload for strategies without plugin mounts, so old strategy plugin config is cleared instead of lingering.
- Use lower-case ids with letters, numbers, dot, underscore, dash, or equals only. Do not encode account names or secrets in profile ids.

The console only allows live-enabled profiles whose `domain` is included in the selected account's `supported_domains`. If a profile is dynamically read from GitHub Variables but is missing from the catalog, add it to the catalog before switching to it.

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
wrangler secret put STRATEGY_SWITCH_SYNC_TOKEN # optional; defaults to RUNTIME_SETTINGS_DISPATCH_TOKEN
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

For GitHub Actions auto-deploy, configure `STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID`, `STRATEGY_SWITCH_CONSOLE_URL`, `STRATEGY_SWITCH_SYNC_TOKEN`, and either `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_WRANGLER_CONFIG_TOML` in the `runtime-strategy-switch` environment (or reuse `RUNTIME_SETTINGS_GH_TOKEN` only if it matches the Worker sync secret). `CLOUDFLARE_ACCOUNT_ID` is optional when Wrangler can infer it from the token. The workflow deploys the Worker and then syncs the bundled strategy profile catalog into KV so the website is not left with stale profile/plugin metadata.

Deploy:

```bash
wrangler deploy
```

For a full fork checklist, see [docs/strategy_switch_fork_guide.md](../../docs/strategy_switch_fork_guide.md).

## Token Scope

`RUNTIME_SETTINGS_DISPATCH_TOKEN` only needs permission to dispatch workflows in the `QuantRuntimeSettings` repository. Cross-platform variable writes still happen inside `Manual Strategy Switch` with the GitHub Actions environment secret `RUNTIME_SETTINGS_GH_TOKEN`.

Configure `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON` as a secret if it contains real account routes. It is returned only after an allowlisted login. Keep broker, email, cloud, API key, and token values out of this config.
