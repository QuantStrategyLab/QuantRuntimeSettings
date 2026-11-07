# Unified daily notification

## Delivery policy and message contract

Routine successful trades, broker acknowledgements, healthy no-trade runs and
heartbeats are recorded for the next scheduled daily report. They do not create
instant messages, including when an older platform release flag is disabled.
Unknown order outcomes, authentication or execution errors, new risk incidents
and failures to preserve required report evidence retain the urgent path.
Routine pending broker acknowledgements require producer-validated identities
and compatible counts; the word `pending_reconciliation` alone cannot establish
either a healthy acknowledgement or an urgent failure.

Deferral requires a confirmed write to the existing protected candidate/report
path. A failed or uncertain write produces an operational coverage diagnostic;
the original successful-trade or heartbeat body is never a fallback message.
A broker acknowledgement means submitted, not filled. Missing fill evidence
stays unknown in the report. Urgent items listed in a digest are a daily record,
not a claim that their instant notification was delivered.

A normal acknowledgement is displayed as an order submission with fill
confirmation pending when fill evidence is absent. A verified zero-order,
zero-fill run can say no trades; an unknown count cannot. Independent evidence
persistence or delivery issues remain visible alongside the submission status.

The production compact template, with `QRS_UNIFIED_NOTIFICATION_ENABLED=true`,
uses one selected language: report business day, observed
run count, independently verified order/fill totals, source coverage, attention
items, then routine decisions and observations. Healthy zero-trade runs still
produce a daily report. Unknown coverage never becomes a successful idle day.
The existing UTF-16 budget keeps delivery to one message and prioritizes issues.
Internal exception text, account identifiers, private paths and plugin prose
are not display fallbacks.

Each producer row is one protected source run, keyed by platform, account,
target, strategy and `source_run_id`. Archive, event and heartbeat observations
with that identity are merged once. A legacy day aggregate without run identity
is rejected; producers must use their explicit per-run archive projector.
The optional `routine_observation_counts` map allows only `watch`,
`opportunity_watch`, `panic_reversal` and `taco_rebound` with nonnegative integer
counts. Producers classify live signals before archiving this map, because old
plugin summaries omit error flags. An absent map is unavailable evidence; an
empty map is observed zero. An unavailable optional map is omitted from display,
which does not claim zero observations. Repeated maps do not add counts. Conflicting counts
for the same run remain unknown, including an empty map against a positive
count. These observations never increment order, fill or run totals.

Chinese and English templates share the same facts and routing. Production
accepts `zh`/`en` and regional variants such as `zh-CN`, `ZH_hans` and `en-US`,
normalizing them before rendering; unsupported or malformed locales fail
configuration validation. The default is Chinese. Locale does not change the
recipient/date delivery reservation or permit a second daily send.

## Unified operator display

The consolidated renderer uses the shared QPK five-section display contract:
Result, Scope, Evidence, Coverage and Next step. Chinese and English render the
same facts. The pure helper is vendored under `notification_snapshot` with its
own source manifest. The manifest records the upstream revision and hash,
the local account-context changes, and the current file hash. The existing
event and routing snapshots retain their original source revisions.

Financial observations remain inside their originating active account block.
Required diagnostics retain that account's display header, including when
multiple accounts share the same failure text. Budget selection keeps account
summaries before optional observations and never retains an observation after
omitting its account context.

Every daily report lists IBKR, Schwab, Firstrade, LongBridge, Binance and the
management console. An explicitly unbound source says it is not included and
its run state is unknown. A missing inventory says coverage is unknown. This
display does not bind a new source, collect another platform, or make unknown
orders/fills zero. Existing totals cover bound targets only. The central Cloud Run caller presents
an unbound Binance inventory as disabled under the standing owner OFF decision:
runs, orders and fills are N/A. This display-only decision does not change any
switch or collect data. A missing inventory remains unknown; a bound Binance
target retains its observed coverage rather than being hidden by the OFF label.
Other unbound platforms retain unknown run state.

The central caller and its deadline fallback use the same five sections,
including missing-source and verified-idle reports. Coverage details stay inside
the Coverage section. The deadline fallback keeps trades and assets unknown and
retains the existing single reservation and no-follow-up behavior.

For each actual source run, a supplied `source_run_id` may already be a full
Actions run URL. The renderer accepts that URL only when it matches the
platform's configured repository and the canonical HTTPS GitHub Actions run
path; query and fragment are stripped by the shared URL helper. It never
constructs a URL from a numeric or opaque run ID. Missing or rejected links
produce an explicit unavailable marker; optional links may be omitted under
the existing evidence budget. Run identity, counts and receipt fields are
unchanged. An accepted link is navigation evidence, not a new claim that the
run succeeded, remains active or delivered a message.

Verified idle reports retain the business window, independently known counts,
source coverage and next action. Their result says “No trades in verified
targets”; unbound sources do not support an all-account claim. The one-message
3900 UTF-16-unit budget reserves these sections and reports omitted evidence.
An artificially small budget that cannot contain the mandatory fields fails
with `notification_required_fields_exceed_budget` rather than dropping them.

Existing receipt, delivery, routing, business-window and execution semantics
are unchanged. QPK risk/guard/receipt templates adopt the same sections at
source level; consumers need separate reviewed adoption. No source PR proves
runtime adoption, a complete data connection or actual notification delivery.

## IBKR post-submit settlement

The optional IBKR settlement feature starts with
`IBKR_ORDER_SETTLEMENT_ENABLED=false`. When enabled in an approved runtime,
protected pending records bind the original submission to its strategy, client,
account, symbol, side and quantity. A bounded follow-up and authenticated
`POST /settle` only read broker orders and executions. They cannot submit,
modify, cancel or retry an order, release risk/cash reservations or clear an
execution-authority UNKNOWN fence.

`Submitted` and `PreSubmitted` are acknowledgements. An open partial fill still
has an unresolved obligation. Only valid broker-confirmed terminal data can
mark a fill in an execution receipt. A terminal cancellation can retain an
actual partial fill; a missing response cannot become a zero fill or a rejection.
Commission and price remain unknown when the broker has not supplied them.

A settlement observation amends its original source run and business day, so it
never increments order or run totals a second time. Daily fill counts require
complete order coverage and unique broker execution IDs. Open, missing or
incomplete outcomes remain `reconciliation_required` at day end. Unrelated risk
or error incidents remain visible. The existing candidate schema carries final
status/counts and the masked settlement conclusion with quantity and price. Raw
account identities and execution IDs stay in protected producer storage.

For this opt-in IBKR final-state correction, one separately reserved completion
notice reports `filled N @ price`, `partial n/N` followed by cancellation, or a
cancelled/rejected outcome. It masks order identifiers and uses the configured
Telegram channel. This correction does not resend the original submission
message. A successful transport acknowledgement is recorded separately from
broker settlement. Ambiguous delivery is never blindly retried. Generic trade
and heartbeat routing above is unchanged.

The feature does not backfill orders submitted while it was off. After a restart,
a pending record without a durable broker ID stays UNKNOWN and cannot be matched
by symbol alone. Deployment, authenticated caller configuration, feature
activation and any future scheduler change need the owner's explicit approval.
Offline fake/replay tests establish source behavior only; deployed adoption,
authentic broker outcomes and real notification delivery remain unproven.

## Cloud Run delivery

The standalone notification image uses `python/Dockerfile.digest`. Cloud Scheduler
calls its authenticated `POST /daily-digest` endpoint at `0,30 7 * * *`, timezone
`Asia/Singapore`, with an OIDC service identity. Set minimum instances to zero,
maximum instances and concurrency to one, and request timeout to 300 seconds.
Instance limits are capacity settings, not deduplication guarantees.
The 07:00 slot sends the report. The 07:30 slot only checks the persisted receipt
and emits a fixed error status when it cannot confirm on-time acceptance; it
never reads financial inputs, reserves a send or produces a second report.

The entry point requires the full Scheduler resource name in configuration and
accepts either that exact name or its exact final job-name component in the
request header. Another full resource name is rejected even if its final
component matches. Cloud Run invoker authentication remains required.
The entry point also validates the original
`X-CloudScheduler-ScheduleTime`. It freezes the report date, previous business
day and completed 06:00 SGT window. Retries retain that original slot. A retry
on a later calendar day is expired, not relabelled as a new report. Only the
Cloud Run invoker identity authenticates a request; Scheduler headers alone
are not authentication.

The approved slots are the 07:00 and 07:30 minutes. RFC3339 seconds and fractional
seconds within those minutes are accepted and retained in the original scheduled
timestamp; other minutes and future timestamps remain invalid. Rejected requests
log a fixed reason code at error severity without recording header values.

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

The compact report also retains each run's evidence-persistence and
evidence-delivery state. Failed, unknown or pending evidence appears as an
attention item before routine healthy context, including when an independent
risk block is present. These display details do not rewrite execution status,
known order/fill counts, routing, receipt keys or send reservations. An observed
run alone is not proof that its evidence was stored or delivered successfully.

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
| `DIGEST_CANDIDATES_BY_PLATFORM_JSON` | Optional protected map from expected platform ID to its candidate root URI; default `{}` |
| `DIGEST_DELIVERIES_GCS_URI` | Private prefix for daily delivery state |
| `DIGEST_SCHEDULER_JOB_NAME` | Full approved Scheduler job resource name |
| `DIGEST_RECIPIENT_SCOPE` | Stable recipient scope, preserved across releases/locales |
| `DIGEST_CUTOVER_REPORT_DATE` | First report date owned by Cloud Run |
| `DIGEST_DELIVERY_ENABLED` | Default `false`; previews do not enable delivery |
| `TELEGRAM_TOKEN` | Existing Bot secret reference |
| `QSL_GLOBAL_TELEGRAM_CHAT_ID` | Existing approved recipient |
| `QSL_NOTIFY_LANG` | `zh` or `en`, including normalized regional variants |
| `QSL_DISPLAY_NAMES_JSON` | Protected runtime account identity mapping for v3 headers; see [account identity sources](display-names.md#private-account-identities-in-the-v3-daily-digest) |

### Separate candidate buckets

Each platform reads exactly one candidate root. An entry in
`DIGEST_CANDIDATES_BY_PLATFORM_JSON` overrides the default root for that platform;
the object suffix remains `<platform>/<business-day>/<candidate-slot>.json`.
Unmapped platforms keep `DIGEST_CANDIDATES_GCS_URI`. Invalid URIs, unknown
platforms and malformed maps fail startup. A missing, denied or timed-out read
from an explicit root never retries against the default root. Delivery receipts
and producer notification markers retain their existing locations and keys.

For a migration, first deploy support with the map empty. Outside publishing
and digest windows, pause candidate writers, wait for in-flight writes, and
copy the selected objects with generation-pinned reads and checksum verification.
Switch all producer entries, including scheduled jobs and protected workflow
configuration, while preserving explicit notification marker URIs. Validate
creation, same-day update and independent readback before changing the central
map. Use authenticated `/preview` to verify identity, business day and coverage
without reserving or sending. Keep other platform sources and delivery settings
unchanged. Observe at least two successful natural digest windows before removing
superseded shared-bucket grants.

After switching, retain the explicit new source during application rollback;
use a compatible image and repair forward. Do not silently return to the old
bucket or delete delivery reservations or notification markers. If validation
fails before switching, leave the current authoritative source in place.

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
message. The default `immediate` preserves the legacy renderer for previews.
A healthy day without orders, fills or real evidence problems is silent.
Normal orders and fills share one message; source failures, missing targets,
stale reports and execution alerts add a diagnostics section only when present.
The UTF-16 budget is bounded; long digests are summarized without multiple sends.

The historical workflow used 23:00 UTC daily in unified mode and 23:10 UTC
on weekdays in legacy mode. Both Actions schedules are retired. The retained
workflow admits only explicit manual dry runs and cannot send or reserve a
production delivery. Its old resend guard and public receipts remain for
historical interpretation; they are not the current durable GCS ledger.
No runtime trading schedule or disabled target is changed. Reports cover the
completed 06:00 SGT window. Platform producers must supply real archived counts;
a workflow conclusion alone is never an order or fill fact.

Unified mode requires a nonempty protected `DIGEST_EXPECTED_TARGETS_JSON` list
(or the existing `aggregator.expected_targets` contract). Declare only approved
active targets, with platform/profile and protected target/account identity.
Missing due targets remain diagnostics; an absent inventory stops construction
rather than silently claiming coverage of all platforms. Configured closed
sessions provide an `actually_ran=false` candidate without a no-trade heartbeat.

## Candidate readiness before 07:00

The central Cloud Scheduler read remains at 07:00 Asia/Shanghai, after the
completed business window ends at 06:00. Its 07:30 deadline check reads the
stored delivery receipt; it does not recollect late candidates or prove receiver
receipt. Do not postpone the central read or widen the business window to hide
late producer jobs.

Each expected producer target has an archive-only entrypoint,
`python -m scripts.publish_digest_before_read`, in its platform repository.
The proposed trigger is a dedicated Cloud Run Job at 06:10 Asia/Shanghai,
independent of GitHub heartbeat scheduling, drill results and account refresh.
Use one job for each already approved target and its exact existing binding.
Start must be before 06:40; the task and in-process watchdog are limited to ten
minutes, and successful readback must finish before 06:55. Disable automatic
job and Scheduler retries because an interrupted write has an unknown outcome.

No new target is implied. The consumer still requires the same platform,
strategy, opaque account, target, business date and candidate slot. Missing,
invalid, unreadable or stale candidates retain their existing coverage outcome.
A producer reports success only after it reads back a nonempty candidate for
that exact identity and date; `actually_ran=false` is allowed only through the
existing schedule-aware producer, with unavailable counts left unknown.

This is a rollout contract, not deployment authorization. Candidate readiness
is unverified until a natural execution writes each exact object before 07:00
and the central reader observes it. Cloud Scheduler accepting a job execution,
a successful test, or an English draft PR does not establish that result.
See the platform notification documents for the proposed job configuration and
[Google's scheduled-job instructions](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule).

## Deterministic summary projection

The summary counts archive-projected runs once by platform, account, target,
strategy and source run. Input arrival order does not establish chronology.
Conflicting known counters remain unknown; conflicting non-empty execution
statuses remain `execution_unknown` with attention. A submission, broker
acknowledgement, pending state or partial fill is explicitly unconfirmed even
when some execution records have already been counted. `completed` describes
execution processing and cannot replace an unknown fill count.

Known zero counters suppress a row only when its execution and evidence state
are healthy. Blocked or failed runs remain visible with zero observed orders.
LongBridge and Binance use the same identity, window, deduplication and unknown
coverage rules as other brokers. Platform support does not create production
bindings or turn a disabled target into a verified zero-activity window.

Future broker-side confirmation is described in
[Fill confirmation design](fill-confirm-design.md). It is design only and grants no
runtime, broker, deployment or notification authority.
