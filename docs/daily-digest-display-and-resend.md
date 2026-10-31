# Daily digest display and same-business-day delivery

The daily digest reads producer evidence and never infers execution counts
from a signal such as `no_action`, workflow success, or a missing report.
Production Cloud Run rendering selects one normalized `zh` or `en` locale.
The legacy preview layouts `v1` and `sections_v2` also support `zh-CN` (`zh`)
and `en`; their bilingual compatibility text is separate from that production
language selection.

The unified trading digest displays its existing business window from 06:00
UTC+8 on the business day through 06:00 UTC+8 the next day. The start is
inclusive and the end is exclusive. Source inventory uses localized display
names and counts only included runs. Zero included runs does not prove that no
run or trade occurred. Target coverage counts expected targets with usable
evidence, including an explicit non-run report; it is not a run count. An
unconfigured source is shown as outside this digest's scope with unknown run
state, without making a claim about its deployment or connectivity.

Schwab may supply an optional `block_reason` object with `reason_code`,
`observed_value`, `limit` and `order_submitted_this_run`. A validated
`consecutive_loss_limit_exceeded` observation renders the supplied numbers in
the selected production language. The legacy renderer combines Chinese and
English on one line. Explicit `false` adds the localized equivalent of
`本轮未下单 / No orders submitted this run`; absent or unknown submission
evidence makes no such claim.
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

In the legacy aggregator/preview path, an older row is superseded only when the
same platform/target has a current-day producer row. If target identity is
absent, an exact opaque account identity can match instead. Anonymous rows
never prove another account is current.
Rows with `legacy: true`, `source_legacy: true`, or `source_kind: "legacy"`
are omitted, including their counts. A candidate envelope can set `legacy: true`;
the merger preserves that flag on its rows. Legacy-only input does not prove
an idle day. None of this depends on whether a legacy injected source exists.

The legacy aggregator/preview receipt retains suppressed row counts, which do not
appear in the message. Cloud Run rejects rows marked `legacy: true` and excludes
stale input before aggregation; its GCS delivery record does not retain these counts.
The legacy gap section says `以下账户今天的数据缺失或过期` /
`These accounts have missing or stale data today`, with a reason per target.
It is absent when only superseded rows were removed.

An intake can identify a target from its stale row. To detect a target with no
row at all in the legacy CLI/aggregator, supply
`notifications.quant_sentinel.daily_digest.aggregator.expected_targets` in the
existing platform configuration. Its `[]` default is a compatibility default
for that path, not a production Cloud Run setting. Each legacy entry needs
`platform_id`, `strategy_profile`, and `target_id` or `opaque_account_uid`;
`strategy_label` and `account_hint` are optional. Use the existing private
configuration path (`QSL_PLATFORM_CONFIG` or `--platform-config`) for private
identities; never commit them.

Production Cloud Run requires a nonempty protected
`DIGEST_EXPECTED_TARGETS_JSON` list of approved target bindings; each row also
requires its existing `candidate_slot`. See the [required protected
configuration](unified-daily-notification.md#cloud-run-delivery) for the
production contract. The following synthetic example is only for legacy/offline
use and is not a complete production binding:

```json
{"expected_targets": [{"platform_id": "demo", "strategy_profile": "demo_strategy", "target_id": "demo/synthetic-target"}]}
```

An expectation does not assert that a strategy ran, fabricate a run, or enable
a strategy. It makes absent current-day evidence visible. Configure only
targets expected for that digest; periodic strategies retain their run-day policy.

## Production delivery and duplicate protection

The production delivery contract assigns Cloud Run as the sole daily-report
sender. Its Scheduler contract specifies 07:00 and 07:30 Asia/Singapore. For
valid, same-day slots at or after cutover, when delivery is enabled, the 07:00
slot may send after a successful reservation. The 07:30 slot only checks the
persisted receipt for on-time acceptance; it does not read candidate data,
reserve a send or send a replacement. Inspect the `delivery` field: HTTP 200
alone does not confirm acceptance.

The original scheduled slot determines the SGT report date and the completed
06:00 SGT window; the business day is that report date minus one calendar day.
A later-calendar-day invocation expires instead of being relabelled. Upstream
reads stop no later than 07:20; after that, a normal report may still show
unavailable coverage. If the 07:00 processing time is at or beyond the 30-second
margin before the 07:30 deadline, including on the post-render check, it uses
the existing late notice instead of a normal report, subject to reservation.
See [Unified daily notification](unified-daily-notification.md) for the complete
delivery and cutoff contract.

Production reserves `<recipient_scope>/<SGT-report-date>.json` in the private
GCS delivery prefix before calling Telegram. A generation-zero precondition
creates the `sending` record; after acceptance, a generation-checked write
records `accepted`. An existing accepted record is a duplicate. An existing
`sending`, unknown or unreadable record, or an uncertain send or receipt write,
is not permission to send again. Do not automatically clear or expire a
reservation; investigate uncertain delivery and preserve its evidence.
Language and message content do not create a separate daily reservation.
Telegram acceptance does not prove that a person read the report.

## Manual previews and historical receipts

The retained `Daily Digest Preview` GitHub Actions workflow has no schedule and
admits the digest job only through `workflow_dispatch` with `dry_run=true`.
Its optional independent maintenance read check also does not send a message.
A preview does not reserve or deliver a production report. The former scheduled
Actions sender and `force_resend` workflow input are retired; do not use an old
retry command, re-enable the Actions sender, or treat a preview as a replacement
for the Cloud Run report.

The legacy CLI/history guard and its public Actions receipt artifacts remain
available for historical interpretation. Their GitHub history checks and old
force-resend settings describe the retired Actions-era path; they are not the
production GCS reservation and do not authorize a second sender. An old receipt
or a successful workflow alone does not establish the current report's delivery.
Inspect the Cloud Run delivery state and operational status when acceptance is
missing or uncertain; the 07:30 check does not retry or backfill delivery.

Legacy CLI/preview date resolution can use the New York calendar date when
consolidation is disabled; consolidation mode instead derives the completed
SGT 06:00 window, and an explicit business day takes precedence. These preview
rules do not replace Cloud Run's scheduled report-date rule.

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

Repeat with `--locale en`. Supply the business day appropriate to the synthetic
fixture and command. Never use production candidate artifacts as local fixtures.
