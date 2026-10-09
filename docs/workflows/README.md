# Workflow drafts

GitHub rejects pushes that create or update `.github/workflows/*` when the
credential lacks the OAuth `workflow` scope. Authored workflow YAML may live
here first.

## Daily Digest Notify

1. Copy `daily-digest-notify.yml` → `.github/workflows/daily-digest-notify.yml`
2. Push with a token that includes the `workflow` scope (or use the GitHub UI)
3. Ensure Environment `runtime-strategy-switch` has:
   - Secret `GLOBAL_TELEGRAM_CHAT_ID` or `QSL_GLOBAL_TELEGRAM_CHAT_ID`
   - Secret `TELEGRAM_TOKEN` **or** GCP WIF access to Secret Manager name
     `quant-sentinel-telegram-bot-token` (variable `TELEGRAM_TOKEN_SECRET_NAME`)
4. Run `workflow_dispatch` with `dry_run=true`, then `dry_run=false`

Binance still uses legacy secret name `TG_TOKEN`; align it to the same
QuantSentinel bot (names only in public docs).
