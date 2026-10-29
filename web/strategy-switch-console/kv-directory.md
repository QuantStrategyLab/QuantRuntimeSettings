# Console KV discovery

Authenticated readers can GET `/api/admin/kv-directory` for a whitelisted status
projection without listing keys or writing storage. `status=unknown` and
`complete=null` mean no known manifest; an incomplete scan remains
`status=incomplete/complete=false`. `last_success` and `data_as_of` are the last
complete scan's epoch milliseconds, not business-record freshness.
`last_error={code,at}` retains the last persisted failure, even after a successful
scan; legacy errors without recorded times have `at=null`. `retry_at` is the
existing backoff deadline or null. `in_progress` means a pagination cursor is
pending (null if unknown), not a currently running maintenance invocation.
There are no public keys, counts, cursors, user identifiers or raw error strings.
Unreadable metadata returns HTTP 503/read_failed, never empty success.
GET does not initialize, repair, mirror or maintain the directory. The status
action is serialized with existing commands and performs only exact reads.

The existing `STRATEGY_SWITCH_RUNTIME_INSTANCES` binding also hosts a separate object named `console-kv-directory-v1`. Its manifest stores discovery keys only, with a maintained KV mirror at `console_kv_directory:v1`. It has no decision, trading, account, IAM or secret authority, and requires no D1 database, new binding, migration or dependency.

All seven source queues and daily history read this maintained manifest. Source/daily publishers register each key durably before writing its existing KV record, under one serialized object queue. New keys update the mirror after the record write; a failed mirror write leaves a persisted dirty marker for retry. Records, freshness, binding checks and decision authority are still read through their original paths. A listed record that cannot be read remains a source error. An incomplete manifest never means an empty queue; unknown daily history is `null`.

Existing keys require a complete migration scan. A 0% Worker override does not select the Durable Object version. If the private receiver returns the exact legacy actor-required rejection, reads use the KV mirror and the explicit authenticated admin operation can perform one bounded migration page directly. No background or read-path fallback scans are allowed; a real object outage does not enable this fallback. The new object adopts that mirror on activation. During this bootstrap, invoke admin maintenance once and inspect its result; the KV mirror alone does not provide cross-region serialization against simultaneous operator requests. Only the existing five-minute cron or an authenticated same-origin admin POST to `/api/admin/kv-directory` can run maintenance. Ordinary reads and acceptance never trigger scans. Each maintenance invocation reads at most one unfiltered KV page (1,000 keys), retaining its cursor. Pending migrations remain unavailable. Concurrent publishers are retained between pages. After success, periodic reconciliation covers legacy/out-of-band writers; records written through the current ingress are registered immediately. An admin POST requests a fresh scan, with a minimum 60-second successful-scan interval; its response includes `scanned_at` and whether a recent scan was reused. During a mixed-version candidate test, reconcile after the last legacy writer before relying on directory coverage. No index can infer keys that were never discovered or registered.

A daily list-quota failure is persisted until the next UTC reset plus 60 seconds. Other migration errors use bounded exponential backoff. The old production version can still consume quota until promotion; installing a candidate cannot restore already-exhausted quota. Never seed a supposedly complete index from a few observed source IDs. If migration cannot complete, retain the explicit source outage. Apply the approved deployment criterion: no worse than the same-request baseline and zero page errors. A new unknown, truncated or mismatched directory is a regression and blocks promotion; an independently confirmed identical quota outage in both versions may remain visible under that criterion.

Configuration uses optional Worker vars with conservative defaults; no production settings need to be changed to use the defaults:

| Variable | Default | Allowed range | Purpose |
| --- | --- | --- | --- |
| `KV_DIRECTORY_RECONCILE_SECONDS` | 21600 | 3600–86400 | Minimum interval between completed migration/reconciliation scans |
| `KV_DIRECTORY_PAGE_DELAY_SECONDS` | 60 | 30–3600 | Minimum delay between migration pages |
| `KV_DIRECTORY_RETRY_SECONDS` | 300 | 60–3600 | Initial transient-error backoff; exponential delay capped at one hour |
| `KV_DIRECTORY_MAX_KEYS` | 10000 | 100–100000 | Registry safety bound; the manifest also has a conservative 120 KB object-value limit |
| `VITE_INBOX_CACHE_MS` | 15000 | 1000–300000 | Build-time inbox result cache |
| `VITE_INBOX_FAILURE_BACKOFF_MS` | 60000 | 1000–300000 | Build-time cooldown for `read_failed`; explicit refresh does not bypass this cooldown |

Successful mutations and session invalidation invalidate the inbox cache. Explicit refresh bypasses successful cached data. The app has no autonomous network polling; the existing regression checks enforce that behavior.

## Bounded acceptance

Use `installAcceptanceBudget(page, { origin, legacy, maxApiRequests, maxLegacyLists })` from `scripts/console_acceptance_budget.mjs` in a Playwright CLI probe before navigation. Keep one budget for the complete six-page desktop/mobile pass. Repeated API URLs reuse the actual first response, including its original failure status and body, within that run. Count cached replies separately; do not present them as fresh network evidence. Business writes are blocked, transport retries are disabled, and exhausted budgets stop requests. Do not rerun acceptance to obtain a passing result.

Defaults allow at most 80 unique API reads and an estimated 48 legacy list requests. The estimate assumes one page per source directory and two bound accounts for legacy today summaries; inspect current bindings and pagination before using it as a measured count. A legacy Worker may ignore `include_history=false`, so daily reads still consume its budget. The indexed candidate's ordinary read routes and the optional lifecycle inspection CLI use zero KV list calls. Read candidate and baseline with identical URLs and version overrides; preserve business errors and compare the unique observed responses. Require zero candidate console errors, page errors and request failures. A maintenance result alone is insufficient evidence for promotion. Run at most one bounded comparison, preserve its raw failures, and apply the approved criterion. Passing with an existing quota outage does not establish business recovery or directory completeness.
