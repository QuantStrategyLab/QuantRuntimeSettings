# Workflow notes

GitHub rejects pushes that create or update `.github/workflows/*` when the
credential lacks the OAuth `workflow` scope. Authored workflow YAML may live
here first.

## Daily digest preview

Production delivery has moved to the authenticated Cloud Run entry point; see
[Unified daily notification](../unified-daily-notification.md). The old workflow
installation template and both Actions schedules are retired. Do not reinstall
them or use an Actions sender as a production fallback.

`.github/workflows/daily-digest-notify.yml` is retained for explicit manual
`dry_run=true` previews and the independent maintenance GET diagnostic. It has
no Bot credentials in the preview job, secret-fetch step, scheduled send or force-resend input.
Existing historical receipts remain available for audit. Roll back the Cloud
Run image against the same GCS ledger rather than restoring an old sender.

Binance still uses legacy secret name `TG_TOKEN`; align it to the same
QuantSentinel bot (names only in public docs).
