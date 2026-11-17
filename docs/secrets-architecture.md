# Secrets and Account Configuration Architecture (Open-Source Guide)

English | [简体中文](secrets-architecture.zh-CN.md)

See [Security Policy](../SECURITY.md). This guide explains for forks and self-hosted deployments **what belongs in public Git**, **what belongs in Secret Manager / Worker secrets / GitHub Environments**, and why browsers never receive raw secrets.

## Layering

| Layer | Allowed contents | Never store here |
| --- | --- | --- |
| Public repository | Schemas, adapters, Worker contracts, `*.example.json`, secret **names**, non-secret flag names | Real account routes, API keys, OAuth secrets, Flex tokens, SA JSON keys, session cookies |
| Google Secret Manager | Broker / Flex / OAuth refresh / Gateway login / SA keys (per platform GCP project) | — |
| GitHub Environment | Variables = switches and topology; Secrets = tokens and binding JSON | Production account catalogs committed in PRs |
| Cloudflare Worker secrets | `SESSION_SECRET`, OAuth creds, `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON`, sync tokens | Committed `wrangler.toml` / `.dev.vars` |
| Browser | Redacted account catalog and `AccountStatus` | Any plaintext secret |

The account "desired catalog" is desired configuration served in display-safe form by the Worker; enablement and health always rely on Observed evidence (see [Lifecycle Truth V1](qsl-lifecycle-truth-v1.md)).

## Naming conventions

```text
qsl-{platform}-{env}-{purpose}     # Secret Manager friendly names
{PLATFORM}_{PURPOSE}_TOKEN         # Actions / Worker bindings
```

Public examples use `EXAMPLE_` / `example-` / `synthetic-` prefixes. `runtime_status_target_id` inside example files illustrates shape only (such as `ibkr.soxl`) and does not attest production bindings.

## Worker account catalog

1. Copy [`web/strategy-switch-console/account-options.example.json`](../web/strategy-switch-console/account-options.example.json) to a **private** file outside public Git.
2. Fill in your target and selector values (never commit real routes back to a public fork).
3. Upload via `wrangler secret put STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON < /path/to/private.json` or write KV `account_options` as an authenticated admin.

Never commit production routing JSON disguised as an example file.

## Local Gateway vs. cloud

- **Local Mac IBKR Gateway:** store login config in Keychain or inject in memory from Secret Manager; never commit Gateway config files.
- **Cloud:** GCP Workload Identity Federation + Secret Manager; forks must substitute their **own** GCP project and WIF provider rather than copying organization numeric project paths.

## Rotation and local ignores

Rotate credentials at the provider first → update Secret Manager / Environment / Worker → verify read-only projections → deprecate old versions (if exposed in Git, rotate immediately; see `SECURITY.md`). `.gitignore` ignores `.env*`, `wrangler.toml`, `.dev.vars`, local `account-options.json`, and common key suffixes; confirm with `git status` and `git check-ignore -v <path>` before committing.

## Operational pins (diagnostic run IDs)

When one-off KV diagnostics restrict allowed `source_run_id` values, store the allowed value in a GitHub Environment secret/variable (such as `BINANCE_ACCOUNT_FACTS_ALLOWED_SOURCE_RUN_ID`) rather than embedding production run IDs as public workflow defaults.

## Telegram / QuantSentinel and route aliases (P0-06)

Cross-platform notifications share GCP secret name `<sentinel-telegram-secret>` (see [QuantSentinel Notification Architecture](notifications-quant-sentinel.md)), referenced by `TELEGRAM_TOKEN_SECRET_NAME` and `STRATEGY_PLUGIN_ALERT_TELEGRAM_BOT_TOKEN_SECRET_NAME` with zero tokens or chat IDs in public repos.

Runtime resolution order (names only):

- Token: `TELEGRAM_TOKEN` → `TG_TOKEN` → GCP Secret Manager (`<sentinel-telegram-secret>`, overridable via `TELEGRAM_TOKEN_SECRET_NAME`).
- Chat: `QSL_GLOBAL_TELEGRAM_CHAT_ID` → `GLOBAL_TELEGRAM_CHAT_ID` → `STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS` (first entry).

Environment-injected `TELEGRAM_TOKEN` / `TG_TOKEN` shadows GCP Secret Manager; `--route-check` outputs matching metadata (`token_source_kind`, `chat_source_kind`, `warnings`) without secret values.

## IBKR Flex write-only rotation backend

Browsers reach only the same-origin Worker, which validates the designated owner, single-use TOTP or recovery code, and request idempotency inside `RuntimeInstances` SQLite while serializing rotation state. New secret values pass strictly in request memory through a fixed proxy `stage` route—never entering DO, KV, Firestore, audit logs, notifications, or HTTP responses.

Worker-to-proxy requests use HMAC-SHA-256 bound to method, path, timestamp, random nonce, operation/request ID, and body digest. The dedicated Cloud Run proxy rejects redirects, expired signatures, and replay conflicts, recording nonces (`expires_at` 10 minutes > 5-minute signature window) and keyed HMAC idempotency checks in Firestore transactions prior to Secret Manager writes—without storing values or standalone value digests.

The proxy permits fixed-target `add`, `list`, `get` metadata, and `disable` operations using its runtime identity token in memory, exposing no `access`, `destroy`, `enable`, arbitrary-resource, or IAM methods. Staging requires exactly one enabled version beforehand; `finalize` and `cancel` re-check the captured version set and stay `unknown` on concurrent modifications.

Protected Worker config names: `CREDENTIAL_ROTATION_OWNER` (lowercase login), `CREDENTIAL_ROTATION_TOTP_SEED` (Base32), `CREDENTIAL_ROTATION_RECOVERY_VERIFIERS` (HMAC verifier JSON array, see [API documentation](console-api.md#write-only-credential-rotation)), `CREDENTIAL_ROTATION_FINGERPRINT_KEY`, `CREDENTIAL_ROTATION_PROXY_URL`, `CREDENTIAL_ROTATION_HMAC_KEY_ID`, and `CREDENTIAL_ROTATION_HMAC_KEY`. Protected proxy config names: `ROTATION_HMAC_KEYS`, `ROTATION_FIRESTORE_DATABASE`, `ROTATION_TARGET_SECRET`, and `PORT`. The proxy uses Node built-ins with no added runtime dependencies, and rotation endpoints send no notifications.

References: [TOTP RFC 6238](https://www.rfc-editor.org/rfc/rfc6238), [Secret Manager REST](https://docs.cloud.google.com/secret-manager/docs/reference/rest/v1/projects.secrets.versions), and [Firestore REST transactions](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/beginTransaction).
