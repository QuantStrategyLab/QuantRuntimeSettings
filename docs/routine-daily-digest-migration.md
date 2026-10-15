# Consolidate routine cycle notifications with the existing daily digest

The central `daily_digest_aggregator` already renders a single message from
private producer candidates across accounts. Its sender makes one Telegram
call per daily report. Sharing a bot with platform runtimes does not combine
their independent sends: cycle notifications and urgent attention pages are
separate from the scheduled central digest.

Binance [PR #378](https://github.com/QuantStrategyLab/BinancePlatform/pull/378)
adds opt-in candidates and intentionally does not enable production. The
Schwab and IBKR candidate producers and this repository's private-store reader
already exist. Reuse them; no additional notify repository, bot, server,
database or IAM changes are needed.

The proposed platform integration uses generic, per-target
`QSL_ROUTINE_NOTIFICATION_MODE=immediate|daily_digest`, default `immediate`.
Only verified healthy no-order cycle notices move into the daily report.
Risk blocks, pending/unknown orders, reconciliation and persistence problems,
and actual order activity remain immediate. Immediate alerts may also appear
as historical context in the daily report; a recap does not release a guard.

Both existing `v1` and `sections_v2` templates support `zh-CN` and `en`.
Language is configured separately from delivery mode. A typical routine
conclusion is `✅ 无需调仓` / `✅ No rebalance needed`; unknown fills remain
`成交数未知` / `fill counts are unknown`. Signals and tips authored as prose
retain their producer language; producers should use supported machine tokens
for bilingual rendering instead of expecting free text to be translated.

## Approval and rollout

1. Verify fresh candidates for the same business day, exact private target
   identity and original archived report. Do not copy private rows to public
   artifacts. Preserve unknown counts and report incomplete coverage.
2. Verify one complete central digest and actual delivery, then verify urgent
   alerts independently. Existing CI success or a successful storage preflight
   cannot substitute for delivery.
3. Obtain owner approval for the consumer deployment and one target's mode
   change. Keep other targets on their current notification paths. Reverting
   the mode to `immediate` restores the original notification decision.

The latest inspected public natural-run receipt had five stale candidates and
an unknown global fill count. It does not qualify as replacement coverage.
Inspect producer dates and the existing window before enabling suppression;
do not remove freshness or evidence checks to make a digest appear healthy.

中文：现有日报已经能把多个账户放进一条消息。消息仍分开发送，是平台周期通知、
风控即时通知与中央日报各自发送，尚未切换正常周期的通知方式。
本草稿复用既有存储与中英文模板；生产部署及开关变更需要负责人批准。
