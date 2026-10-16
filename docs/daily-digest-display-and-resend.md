# Daily digest display and same-business-day delivery

The daily digest reads producer evidence and never infers execution counts
from a signal such as `no_action`, workflow success, or a missing report.
Both `v1` and `sections_v2` support `zh-CN` (`zh`) and `en`.

Schwab may supply an optional `block_reason` object with `reason_code`,
`observed_value`, `limit` and `order_submitted_this_run`. A validated
`consecutive_loss_limit_exceeded` observation renders the supplied numbers in
Chinese and English on one line. Explicit `false` adds `本轮未下单 / No orders
submitted this run`; absent or unknown submission evidence makes no such claim.
This run observation never supplies whole-day order/fill counts. Absent,
malformed or unknown reason fields retain the existing blocked/not-connected
wording. The optional contract is in `qsl-digest-candidates.v1.schema.json`;
existing notification mode and private candidate configuration remain in use.

## Account display

When **both** fill and order counts are known and zero, the account shows
`无交易` / `No trades`. Accounts with activity retain their fill/order counts.
A missing count gets an explicit reason instead of an invented zero. Any
known positive count remains visible alongside the missing-data explanation.
The header retains the evidence-uncovered warning if either count is missing,
or if a configured target or source has a coverage gap.

| Code | zh-CN explanation | English explanation |
| --- | --- | --- |
| `EVIDENCE_NOT_FOUND` | 未找到当天的成交或订单证据 | No fill or order evidence for this business day |
| `EVIDENCE_UNREADABLE` | 证据读取失败或格式无效 | Evidence could not be read or has an invalid format |
| `EVIDENCE_STALE_BUSINESS_DAY` | 证据业务日与日报不一致 | Evidence belongs to a different business day |
| `SOURCE_NOT_CONFIGURED` | 未配置成交或订单证据来源 | No fill or order evidence source is configured |

The full form is `数据缺失：CODE（解释）` / `Data missing: CODE (explanation)`.
Count diagnostics do not replace an execution or risk alert's original reason.
Malformed configured inputs still fail closed; the existing failed-store
path may render an incomplete report with `EVIDENCE_UNREADABLE`.

## Current-day gaps and legacy rows

An older row is superseded only when the same platform/target has a current-day
producer row. If target identity is absent, an exact opaque account identity
can match instead. Anonymous rows never prove another account is current.
Rows with `legacy: true`, `source_legacy: true`, or `source_kind: "legacy"`
are omitted, including their counts. A candidate envelope can set `legacy: true`;
the merger preserves that flag on its rows. Legacy-only input does not prove
an idle day. None of this depends on whether a legacy injected source exists.

Superseded/legacy counts are retained in the receipt, never in the message.
The gap section says `以下账户今天的数据缺失或过期` /
`These accounts have missing or stale data today`, with a reason per target.
It is absent when only superseded rows were removed.

An intake can identify a target from its stale row. To detect a target with no
row at all, supply `notifications.quant_sentinel.daily_digest.aggregator.expected_targets`
in the existing platform configuration. Default: `[]` (no additional expected
targets). Each entry needs `platform_id`, `strategy_profile`, and `target_id`
or `opaque_account_uid`; `strategy_label` and `account_hint` are optional.
Use the existing private configuration path (`QSL_PLATFORM_CONFIG` or
`--platform-config`) for private identities; never commit them. For example:

```json
{"expected_targets": [{"platform_id": "demo", "strategy_profile": "demo_strategy", "target_id": "demo/synthetic-target"}]}
```

An expectation does not assert that a strategy ran, fabricate a run, or enable
a strategy. It makes absent current-day evidence visible. Configure only
targets expected for that digest; periodic strategies retain their run-day policy.

## Resend guard

The existing candidate store is read-only and the maintenance reminder store
does not reserve general digests. The guard therefore uses **read-only GitHub
Actions history and the existing public receipt artifact**, with the workflow's
own `GITHUB_TOKEN`. Only the digest job adds `actions: read`; its existing
`contents: read` and `id-token: write` grants remain unchanged. No new store,
secret, resource, cross-repository token grant, or write permission is added.

1. The guard runs before candidate intake or notification work. The sender
   checks again before route resolution, maintenance reservation, or delivery.
   Existing workflow concurrency serializes scheduled and manual runs.
2. It lists this workflow's runs across branches, including failed/cancelled
   runs and a rerun's prior attempt, and reads `receipt-public.json` from the
   existing artifact. It also accepts the pre-projection `receipt.json` archive
   after validating its known receipt schema and delivery fields. Only delivery
   marker fields are retained; account data and private diagnostics are discarded.
   Overall workflow success alone never proves delivery. This path never calls
   the console or Cloudflare KV, including KV `list()`.
3. A receipt with the same business day, `status=delivered`, `delivered=true`,
   `dry_run=false`, and no test flag skips the send with exit success. Receipts
   written before test flags existed count as normal deliveries.
4. API/auth failures, expired or unreadable markers, incomplete pagination,
   another active sender, and uncertain delivery all stop an unforced send.
   A missing marker is safe only for an older day or when job history proves
   the send step did not run. A send failure is not automatically retried.
5. The existing public receipt, artifact, step summary and error log expose
   `blocked_resend_guard` and a fixed reason without private exception text.
   `HISTORY_UNAVAILABLE` also includes an allowlisted `history_error`, the number
   of attempted history reads, an **URGENT** annotation/summary, and an unforced
   `workflow_dispatch` command pinned to the blocked business day. Transient
   transport, server, incomplete-scan and concurrent-run errors retry history
   reads with bounded exponential delays. Invalid/expired/missing markers and
   auth failures stop immediately. No retry sends a message or writes state.
   The next normal digest that can safely send includes a bilingual notice of
   unresolved guard failures seen in recent history. A successful normal
   delivery clears that notice for later runs. No new alert channel is added.

`workflow_dispatch.force_resend` defaults to **false**. An ordinary manual run
obeys the same guard. With `force_resend=true`, a deliberate test send bypasses
history and starts with `【测试】` / `[TEST]`. A schedule cannot force a resend.
Test deliveries do not consume a normal day's delivery. `dry_run=true`
(the manual default) stays offline for the guard and never sends; a preview
does not create a successful-delivery marker. Keep real delivery checks for
the next scheduled run.

The workflow explicitly enables the guard. Direct CLI use enables it by
default only in GitHub Actions. Runtime settings for other installations:

| Environment setting | Default |
| --- | --- |
| `DIGEST_RESEND_GUARD` | `true` in Actions; `false` for local CLI |
| `DIGEST_FORCE_RESEND` | `false`; honored only for `workflow_dispatch` |
| `DIGEST_GUARD_TOKEN` | Workflow passes `github.token`; otherwise `GITHUB_TOKEN` |
| `DIGEST_GUARD_WORKFLOW` | Filename from `GITHUB_WORKFLOW_REF` |
| `DIGEST_GUARD_ARTIFACT` | `daily-digest-receipt` |
| `DIGEST_GUARD_SEND_STEP` | `Aggregate, render, and send daily digest` |
| `DIGEST_GUARD_MAX_PAGES` | `10` pages of 100 entries; incomplete scans block |
| `DIGEST_GUARD_LOOKBACK_DAYS` | `7` days before the requested business day, for recovery notices |
| `DIGEST_GUARD_LEGACY_RECEIPT` | `receipt.json`; configurable legacy basename, `none` disables legacy compatibility |
| `DIGEST_GUARD_READ_ATTEMPTS` | `3`; range `1..5`, transient history reads only |
| `DIGEST_GUARD_RETRY_DELAY_SECONDS` | `2`; range `0..60`, exponential delay capped at 60 seconds |

Repository, API URL, event, run ID and attempt come from standard `GITHUB_*`
context. All requests are GETs. Artifact redirects strip authorization before
following another host, archives are size-limited and never extracted. The
workflow exposes the legacy filename and read retry settings through optional
repository/environment variables of the same names; no variable change is
needed to use the safe defaults.
Future business-day sends are rejected by history detection; older overrides
scan from that older business day. Preserve receipts for any day that may be
resent. Removing/expiring evidence can block sending; it is not permission to
assume no prior delivery. Restore readable evidence, then dispatch with the
original business day and `force_resend=false`. Do not rerun the send after an
uncertain delivery; investigate that receipt first.

The US-session business day is the New York date, independently of the SGT
report date. For example, `2026-10-15T23:59Z` is October 15 in New York and
October 16 in Singapore. A manual recovery must keep `business_day=2026-10-15`.
GitHub schedules can be delayed; run creation and job startup timestamps show
which delay is visible, but do not establish the scheduler's internal cause.

## Offline verification

Run `python3 -m unittest discover -s python/tests -v` for the full Python suite.
Display and delivery regressions are in `test_daily_digest_ux.py` and
`test_daily_digest_resend_guard.py`, alongside the existing digest tests.
They use synthetic identities, mocked history and mocked delivery only.

To inspect a synthetic candidate file without route/credential reads or sends:

```sh
python3 python/scripts/daily_digest_aggregator.py \
  --business-day YYYY-MM-DD --locale zh-CN --no-github \
  --platform-config synthetic-config.json --candidates synthetic-candidates.json \
  --write-text preview.txt
```

Repeat with `--locale en`. Supply the current New York business day in the
fixture and command. Never use production candidate artifacts as local fixtures.
