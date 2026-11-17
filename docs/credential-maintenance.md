# IBKR Flex Expiry Maintenance

English | [简体中文](credential-maintenance.zh-CN.md)

This is one shared `ibkr_flex` maintenance item for the master username, independent of individual accounts or
Gateways. An administrator registers the timezone-aware expiry instant from IBKR `CurrentTokenDetails` (for
example, synthetic `2035-04-01T08:00:00+08:00`). The backend stores UTC instants. Unknown or invalid metadata
remains unknown and never implies broker validity, completed token rotation, or trading authority.

## Registration

Select Credential maintenance or Manage expiry on the existing Decisions page, enter the full timezone-aware ISO
instant, and save. An expiry more than 30 days ahead leaves the TODO queue while the admin form remains accessible.
Unconfirmed reads or saves preserve editing state and require explicit readback; revision conflicts must be reconciled
before saving rather than overwriting newer records. This feature stores no tokens, query IDs, accounts, credential
fingerprints, or secrets.

## Delivery channel

Delivery reuses the existing `daily-digest-notify.yml` weekday central digest, bot/chat routing, and Environment.
Configure the existing `vars.STRATEGY_SWITCH_CONSOLE_URL` and explicit `secrets.STRATEGY_SWITCH_SYNC_TOKEN`;
GitHub/dispatch fallbacks and shared token aliases are forbidden. The Worker uses the existing `RuntimeInstances`
SQLite binding with no new cloud resources or cron jobs.

Durable maintenance persistence requires an actual `main` workflow context. Dry-runs, `route-check`, and non-`main`
branches do not claim, ACK, or send maintenance blocks and add no Secret Manager, Gateway, or Flex reads.

Only the single most urgent phase (30 days, 14 days, 7 days, or registered expiry reached) is sent, with no
historical backfill; unknown expiry shows only the website registration TODO. The maintenance block appends to the
central digest message under strict Telegram receipt validation. If candidate data fails to build, the workflow may
deliver a maintenance-only message while preserving the business failure status, unknown business counts, and nonzero
exit code.

## Deduplication and uncertainty

The durable unique key is shared credential + canonical expiry + phase; `metadata_revision` binds registration CAS
and claim/ACK checks only. Same-date saves, A→B→A edits, and restarts preserve prior history. Reserved, timed-out,
or uncertain Telegram/ACK outcomes never automatically release, resend, or reset; the website TODO remains open and
old-revision ACKs cannot alter newer metadata. Operators verify delivery and credentials directly and register genuine
new expiry dates instead of inventing dates to bypass deduplication.

Actual expiry dates and claim IDs never enter stdout, public CI artifacts, or issues. Authorized website reads and
the in-memory Telegram body carry the expiry; public evidence exposes fixed phase and delivery enums only. Source
code, tests, and screenshot fixtures use synthetic dates unrelated to real credentials.

## Write-only rotation endpoints

The backend exposes `ibkr_flex` `stage`, `finalize`, and `cancel` endpoints for a separate frontend. Every write
requires the designated owner's admin session, a same-origin request, and a fresh single-use verification code.
Staging adds a new version while leaving the prior version enabled and keeping expiry and `last_rotated_at` unchanged.

The owner submits the `finalize` confirmation only after updating and verifying all downstream consumers externally;
confirmation does not represent automated downstream health verification. On confirmed `finalize`, the backend
atomically updates the operation, expiry record, and `last_rotated_at` while checking the maintenance revision
captured during staging. Canceling disables only the newly staged version without modifying expiry or rotation
timestamps.

On uncertain outcomes, the operation retains `add_unknown`, `finalize_unknown`, or `cancel_unknown`, blocking
further writes until reconciled via read-only status inspection (which never adds or disables versions). If the remote
operation completed while local metadata changed concurrently, the state remains unknown without overwriting newer
records. Only a confirmed `finalize` updates rotation metadata; manual registration remains admin-entered only, and
30/14/7-day reminder deduplication rules remain intact. Submitted secret values and verification codes never enter DO,
audit logs, or notifications, and browsers never read secret values, version names, fingerprints, or raw upstream
server errors.
