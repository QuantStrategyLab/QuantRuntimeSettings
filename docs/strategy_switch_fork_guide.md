# Fork Guide: Strategy Switch Console

[简体中文](strategy_switch_fork_guide.zh-CN.md)

This guide explains how to fork this repository and deploy the same public-readonly, login-to-switch console for your own platform repositories.

## What You Need

- A GitHub account or organization that owns your forked runtime settings repository.
- Optional platform repositories for LongBridge, IBKR, Schwab, and Firstrade automation.
- A Cloudflare account with Workers enabled.
- A GitHub OAuth App for login.
- A fine-grained GitHub token that can dispatch this repository's workflow.
- A separate GitHub Actions secret that can write variables in your platform repositories.

Do not commit broker credentials, cloud credentials, API keys, account passwords, or personal access tokens.

## Repository Mapping

The default repository mapping points to QuantStrategyLab:

```text
longbridge -> QuantStrategyLab/LongBridgePlatform
ibkr       -> QuantStrategyLab/InteractiveBrokersPlatform
schwab     -> QuantStrategyLab/CharlesSchwabPlatform
firstrade  -> QuantStrategyLab/FirstradePlatform
```

Fork users can override these without editing source code.

For GitHub Actions, set platform repository variables in your fork:

```text
RUNTIME_SETTINGS_LONGBRIDGE_REPO=your-org/LongBridgePlatform
RUNTIME_SETTINGS_IBKR_REPO=your-org/InteractiveBrokersPlatform
RUNTIME_SETTINGS_SCHWAB_REPO=your-org/CharlesSchwabPlatform
RUNTIME_SETTINGS_FIRSTRADE_REPO=your-org/FirstradePlatform
```

You can also use one JSON variable:

```json
{
  "longbridge": "your-org/LongBridgePlatform",
  "ibkr": "your-org/InteractiveBrokersPlatform",
  "schwab": "your-org/CharlesSchwabPlatform",
  "firstrade": "your-org/FirstradePlatform"
}
```

Store that JSON as `RUNTIME_SETTINGS_PLATFORM_REPOSITORIES_JSON`.

For the Cloudflare Worker, use the same JSON as `STRATEGY_SWITCH_PLATFORM_REPOSITORIES_JSON`, or set individual Worker variables:

```text
RUNTIME_SETTINGS_REPO=your-org/QuantRuntimeSettings
STRATEGY_SWITCH_LONGBRIDGE_REPO=your-org/LongBridgePlatform
STRATEGY_SWITCH_IBKR_REPO=your-org/InteractiveBrokersPlatform
STRATEGY_SWITCH_SCHWAB_REPO=your-org/CharlesSchwabPlatform
STRATEGY_SWITCH_FIRSTRADE_REPO=your-org/FirstradePlatform
```

## GitHub Actions Setup

Create a GitHub Environment named `runtime-strategy-switch`.

Add this secret to that environment:

```text
RUNTIME_SETTINGS_GH_TOKEN
```

This token is used by `.github/workflows/manual-strategy-switch.yml` to write GitHub Actions variables in your platform repositories and optionally dispatch each platform's sync workflow. Prefer a fine-grained PAT scoped only to the repositories you actually use.

The token should not need `contents: write`.

## Worker Setup

Create a GitHub OAuth App:

```text
Homepage URL: https://your-worker-domain
Authorization callback URL: https://your-worker-domain/callback
```

Copy the Worker config:

```bash
cp web/strategy-switch-console/wrangler.toml.example web/strategy-switch-console/wrangler.toml
```

Edit `wrangler.toml`:

```toml
name = "your-strategy-switch-console"

[vars]
RUNTIME_SETTINGS_REPO = "your-org/QuantRuntimeSettings"
STRATEGY_SWITCH_PLATFORM_REPOSITORIES_JSON = '{"longbridge":"your-org/LongBridgePlatform","ibkr":"your-org/InteractiveBrokersPlatform","schwab":"your-org/CharlesSchwabPlatform","firstrade":"your-org/FirstradePlatform"}'
```

Set Worker secrets:

```bash
cd web/strategy-switch-console
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put SESSION_SECRET
wrangler secret put RUNTIME_SETTINGS_DISPATCH_TOKEN
wrangler secret put STRATEGY_SWITCH_SYNC_TOKEN
wrangler secret put ALLOWED_GITHUB_LOGINS
wrangler secret put ALLOWED_GITHUB_ORGS
wrangler secret put STRATEGY_SWITCH_ADMIN_LOGINS
wrangler secret put STRATEGY_SWITCH_ADMIN_ORGS
```

`RUNTIME_SETTINGS_DISPATCH_TOKEN` only needs permission to dispatch the runtime settings workflow in your fork. It is not the token that writes platform variables.

## Account Options

Copy the generic example:

```bash
cp web/strategy-switch-console/account-options.example.json /tmp/strategy-switch-accounts.json
```

Edit it with your own route names, service names, account selectors, and supported strategy domains. Keep it to routing metadata only.

Store it as a Worker secret:

```bash
wrangler secret put STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON < /tmp/strategy-switch-accounts.json
```

For editable settings, create a KV namespace:

```bash
wrangler kv namespace create STRATEGY_SWITCH_CONFIG
```

Add the returned id to `wrangler.toml`, deploy, then use `/admin` to edit:

```text
auth_config
account_options
strategy_profiles
audit_log
```

## Strategy Catalog

Runtime-enabled strategies live in:

```text
web/strategy-switch-console/strategy-profiles.example.json
```

Each item needs:

```json
{
  "profile": "my_strategy_profile",
  "label": "My Strategy Profile",
  "domain": "us_equity",
  "runtime_enabled": true
}
```

Supported domains are currently:

```text
us_equity
hk_equity
```

After editing the strategy catalog or page:

```bash
python3 scripts/sync_strategy_switch_page_asset.py
```

## Deploy and Verify

Deploy the Worker:

```bash
cd web/strategy-switch-console
wrangler deploy
```

Verify public mode:

```bash
curl -s https://your-worker-domain/api/config
```

Expected unauthenticated response:

```json
{
  "accountOptions": null
}
```

Then open the Worker URL:

- Signed-out users should only see the public read-only page.
- Signed-in allowlisted users should see account, strategy, mode, current status, and the switch button.
- Admin users should be able to open `/admin`.

## Local Checks

Run these before opening a PR:

```bash
jq empty web/strategy-switch-console/account-options.example.json web/strategy-switch-console/strategy-profiles.example.json
node --experimental-default-type=module tests/strategy_switch_worker_validation.mjs
python3 scripts/runtime_settings.py validate
python3 -m unittest discover -s tests -v
git diff --check
```
