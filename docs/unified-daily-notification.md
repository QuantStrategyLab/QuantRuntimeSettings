# Unified daily notification

## Cloud Run delivery

The standalone notification image uses `python/Dockerfile.digest`. Cloud Scheduler
calls its authenticated `POST /daily-digest` endpoint at `0,30 7 * * *`, timezone
`Asia/Singapore`, with an OIDC service identity. Set minimum instances to zero,
maximum instances and concurrency to one, and request timeout to 300 seconds.
Instance limits are capacity settings, not deduplication guarantees.
The 07:00 slot sends the report. The 07:30 slot only checks the persisted receipt
and emits a fixed error status when it cannot confirm on-time acceptance; it
never reads financial inputs, reserves a send or produces a second report.

The entry point validates the configured Scheduler job name and the original
`X-CloudScheduler-ScheduleTime`. It freezes the report date, previous business
day and completed 06:00 SGT window. Retries retain that original slot. A retry
on a later calendar day is expired, not relabelled as a new report. Only the
Cloud Run invoker identity authenticates a request; Scheduler headers alone
are not authentication.

The runtime reads one explicitly bound producer object per target, without a
bucket listing, GitHub token, broker call, AI task or console request. It reuses
the existing aggregator, event validation, labels and compact renderer. A
missing, stale, invalid or unreadable target is reported as such while other
valid targets remain available. Global totals stay unknown if coverage is
incomplete. An explicit `actually_ran=false` row proves non-execution, not its
cause or zero fills. Empty input produces an unavailable report, not silence.
SDK intake outcomes are passed explicitly to the aggregator. Production does
not depend on the legacy Actions `DIGEST_CANDIDATES_STORE_STATUS` variable;
read failures and invalid inputs still mark source coverage incomplete.

Upstream reads share at most 120 seconds and stop no later than 07:20. Check the
07:30 deadline again after reads and rendering. A late invocation sends only
the existing late notice. It must not send a normal stale report or backfill
another day. `POST /preview` may validate explicitly selected archived inputs
after cutoff; it returns only delivery/coverage status, never message text or
financial facts, and never reserves or sends. `GET /health` tests startup only.

Required protected configuration:

| Variable | Meaning |
| --- | --- |
| `QRS_UNIFIED_NOTIFICATION_ENABLED` | Exact `true` |
| `DIGEST_EXPECTED_TARGETS_JSON` | Approved identity rows, each with its existing `candidate_slot` |
| `DIGEST_CANDIDATES_GCS_URI` | Existing private candidates prefix |
| `DIGEST_DELIVERIES_GCS_URI` | Private prefix for daily delivery state |
| `DIGEST_SCHEDULER_JOB_NAME` | Full approved Scheduler job resource name |
| `DIGEST_RECIPIENT_SCOPE` | Stable recipient scope, preserved across releases/locales |
| `DIGEST_CUTOVER_REPORT_DATE` | First report date owned by Cloud Run |
| `DIGEST_DELIVERY_ENABLED` | Default `false`; previews do not enable delivery |
| `TELEGRAM_TOKEN` | Existing Bot secret reference |
| `QSL_GLOBAL_TELEGRAM_CHAT_ID` | Existing approved recipient |
| `QSL_NOTIFY_LANG` | `zh` or `en` |

### Delivery reservation

The key is `<recipient_scope>/<SGT-report-date>.json` under the deliveries
prefix. Language, source version, request ID and content hash do not form part
of the key and cannot bypass it. Create a `sending` record with GCS generation
precondition zero before the single Telegram call. Persist `accepted` with the
Telegram message ID using the exact reservation generation. A pre-existing
accepted record is a duplicate; a `sending`, unknown or unreadable record is
not permission to send again. Never expire a sending reservation or clear it
automatically. A claim timeout or an accepted send followed by an ACK-write
failure remains uncertain. Read retries and delivery retries are different.

The runtime logs only fixed status fields: report date, business day, coverage,
delivery and lateness. Never print message bodies, private paths, account IDs,
headers, tokens or exception details. `accepted` means Telegram accepted the
request, not that a person has read it. An HTTP 200 can also acknowledge a
duplicate or an uncertain outcome that must not be retried. Monitor the
structured `delivery` field, source coverage, deadline and missing scheduled
execution separately, using the existing operations alert channel.

### Cutover and retirement

1. Deploy the immutable notification image with delivery disabled and no active
   Scheduler. Validate startup, authenticated preview, target bindings, IAM and
   the original recipient. The notification identity may read only approved
   candidates, write its delivery prefix and access the existing Bot secret;
   it has no broker or trading permissions.
2. Inspect in-flight old senders. Preserve prior public receipts, importing
   relevant accepted/uncertain markers without inventing a message ID. Set a
   definite future report-date boundary; do not backfill today's late report.
3. Set the old protected environment `DIGEST_DELIVERY_RUNTIME=cloud_run` so real
   scheduled/manual Actions sends stop. Confirm the skip before enabling the
   single Cloud Scheduler target. The Actions workflow now has no crons, no Bot
   credentials in its digest job and an unconditional dry-run sender. Its old
   installable workflow copy has been removed; do not reinstall it.
4. Disable the old VPS briefing sender/timer only after verifying it owns no
   required collector work. Retain Binance's original collector/runtime and
   archived financial evidence. Remove uninstalled VPS relay proposals, not
   unrelated systemd units or other organizations' AI services.
5. Validate the next natural report and same-day duplicate suppression, then
   extend target coverage in the existing platform order. Revert a Cloud Run
   image against the same ledger if necessary. Never re-enable the old Actions
   sender as an independent failover after cutover.

The following Actions-era contracts remain for manual previews and historical
receipt interpretation. They do not grant a second production delivery path.

## Actions-era compatibility

Exact `QSL_ROUTINE_NOTIFICATION_MODE=daily_digest` enables the compact bilingual
message. The default `immediate` preserves the existing renderer and schedule.
A healthy day without orders, fills or real evidence problems is silent.
Normal orders and fills share one message; source failures, missing targets,
stale reports and execution alerts add a diagnostics section only when present.
The UTF-16 budget is bounded; long digests are summarized without multiple sends.

Unified mode uses the existing digest workflow at 23:00 UTC daily, after the
existing 22:20 UTC report monitors. Legacy mode runs at 23:10 UTC on weekdays,
after those monitors; the business-day cutoff remains 22:00 UTC.
No runtime trading schedule or disabled target is changed. Reports cover the
completed 06:00 SGT window. Platform producers must supply real archived counts;
a workflow conclusion alone is never an order or fill fact.

The resend guard keys unified sends by current SGT report date and configured
`DIGEST_RECIPIENT_SCOPE` (default `default`). Language and business-day overrides,
legacy force-test inputs and a disabled local guard cannot bypass this limit.
An uncertain previous send or missing send receipt blocks another attempt.
Keep the workflow concurrency group shared by manual and scheduled runs.

The workflow freezes the business window before reading send history. Upstream
candidate reads share at most 120 seconds and stop at 07:20 Asia/Singapore.
The 07:30 deadline leaves time for a single guarded failure notice when source
verification is incomplete. A run starting after the deadline reports that it
is late, keeps trading and asset facts unknown, and does not send an automatic
follow-up. Actions queue delays remain observable; this does not guarantee a
07:30 start or delivery. Public receipts preserve acceptance time, the deadline
and late/failure flags without private message text.

No variables are applied, workflow dispatched, secrets read or messages sent by
this code-only change. Validate protected source bindings and the approved UES
fingerprint/baseline release plan before production adoption.

Unified mode requires a nonempty protected `DIGEST_EXPECTED_TARGETS_JSON` list
(or the existing `aggregator.expected_targets` contract). Declare only approved
active targets, with platform/profile and protected target/account identity.
Missing due targets remain diagnostics; an absent inventory stops construction
rather than silently claiming coverage of all platforms. Configured closed
sessions provide an `actually_ran=false` candidate without a no-trade heartbeat.
