# Unified daily notification (code only)

Exact `QSL_ROUTINE_NOTIFICATION_MODE=daily_digest` enables the compact bilingual
message. The default `immediate` preserves the existing renderer and schedule.
A healthy day without orders, fills or real evidence problems is silent.
Normal orders and fills share one message; source failures, missing targets,
stale reports and execution alerts add a diagnostics section only when present.
The UTF-16 budget is bounded; long digests are summarized without multiple sends.

Unified mode uses the existing digest workflow at 23:00 UTC daily, after the
existing 22:20 UTC report monitors. Legacy mode keeps 22:00 UTC weekdays.
No runtime trading schedule or disabled target is changed. Reports cover the
completed 06:00 SGT window. Platform producers must supply real archived counts;
a workflow conclusion alone is never an order or fill fact.

The resend guard keys unified sends by current SGT report date and configured
`DIGEST_RECIPIENT_SCOPE` (default `default`). Language and business-day overrides,
legacy force-test inputs and a disabled local guard cannot bypass this limit.
An uncertain previous send or missing send receipt blocks another attempt.
Keep the workflow concurrency group shared by manual and scheduled runs.

No variables are applied, workflow dispatched, secrets read or messages sent by
this code-only change. Validate protected source bindings and the approved UES
fingerprint/baseline release plan before production adoption.
