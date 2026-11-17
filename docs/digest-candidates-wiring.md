# Central Daily Digest `DIGEST_CANDIDATES` Wiring (No Secrets)

English | [简体中文](digest-candidates-wiring.zh-CN.md)

Repository evidence points to the Azure scheduled sender (sharing the digest core with the Cloud Run entry point) as the current production path, verified in production by operators on 2026-11-16 with live resource configs kept outside this repository. Cloud Scheduler → Cloud Run remains an earlier supported design documented in the [unified daily notification contract](unified-daily-notification.md). The digest core reads authorized GCS candidate objects directly via the official SDK rather than Actions state variables. The Environment, list/copy, and workflow sections below apply to manual read-only previews and legacy evidence only and must not re-enable the retired Actions sender.

This document describes how to wire a platform's daily digest candidate evidence into `QuantRuntimeSettings` without storing secrets, real account IDs, or asset balances in public files.

## Goal

Platform producer emits structured candidates → central `daily_digest_aggregator` consumes → `daily_digest_notify` renders → QuantSentinel delivers.

GitHub workflow success provides **existence** evidence only; unknown fill and order counts must be shown as unknown rather than zero.

For IBKR, ending settled USD cash is read from each account's private Flex summary object. The digest verifies account, target, and statement date and displays the statement date; missing cash summaries stay unknown while trade and fill coverage remain governed by candidate records.

## JSON Schema

The formal contract lives at [`schemas/qsl-digest-candidates.v1.schema.json`](../schemas/qsl-digest-candidates.v1.schema.json) (`schema_version` = `qsl.digest_candidates.v1`). Producer docs and examples must match this schema, keeping unknown counts as `null` plus `field_status.counts_unknown`.

Schwab may attach a notification-only `block_reason` object (`reason_code`, `observed_value`, `limit`, `order_submitted_this_run`). Verified consecutive-loss reasons render bilingual inline values; only explicit `false` displays "no order submitted this run". This per-run fact does not infer full-day order/fill totals, and missing, unknown, or malformed reason fields fall back to existing blocked/untracked wording under existing notification modes and protected configuration.

## Minimal candidate JSON shape

```json
{
  "runs": [
    {
      "platform_id": "schwab",
      "strategy_profile": "soxl_soxx_trend_income",
      "opaque_account_uid": "acct_opaque_example",
      "target_id": "schwab/example-target",
      "actually_ran": true,
      "fill_count": 0,
      "order_count": 0,
      "cycle_count": 1,
      "field_status": {
        "fill_count": "known",
        "order_count": "known",
        "cycle_count": "known"
      },
      "evidence_provenance": "candidates",
      "strategy_label": "半导体趋势收益"
    }
  ]
}
```

Constraints:

- Aggregation key: `(platform_id, strategy_profile, opaque_account_uid|unknown, target_id|unknown)`. Multi-account targets sharing a strategy must carry identity rather than collapsing to platform + strategy.
- `actually_ran` must be an explicit boolean (no implicit `true` default).
- **NOTIFY-04 freshness:** Each row must carry `business_day` (`America/New_York` ISO date) or `as_of` (ISO timestamp converted to New York date, defaulting naive timestamps to UTC). Rows mismatched with the digest business day, missing, or unparseable are dropped without rendering amounts/holdings; the digest appends a stale notice, writes `stale_candidates[]` (platform, strategy, date, reason code only) and `source_coverage.stale_candidates_count` to the receipt, and blocks "verified idle" when rows are dropped.
- Stub / existence-only evidence: use `null` for `fill_count`/`order_count` with `field_status.counts_unknown` or `reason_code=github_workflow_existence_only`.
- Legacy producers emitting integer `0` without `field_status` retain compatibility as verified zero fills.
- Equity, holdings, signals, and rebalance fields are optional: rendered when present, omitted when absent, never fabricated.
- `holdings_scope` (optional): `strategy_symbols_only` (Schwab) or `stocks_only` (IBKR); unknown values are ignored and empty holdings omit the section.

## Central workflow wiring

File: `.github/workflows/daily-digest-notify.yml` (manual read-only preview only; legacy `docs/workflows/` copies are removed). Environment: `runtime-strategy-switch`.

Preview inputs (choose one, secret JSON takes precedence):

| Source | Name | Purpose |
| --- | --- | --- |
| Environment secret | `DIGEST_CANDIDATES_JSON` | Full candidate JSON materialized to `data/input/daily-digest/candidates.json` and passed via `DIGEST_CANDIDATES_PATH` |
| Environment variable | `DIGEST_CANDIDATES_PATH` | Path to an existing file on the runner written by a private step |

Supported script inputs: env `DIGEST_CANDIDATES_PATH` / `DIGEST_CANDIDATES_JSON`, and CLI `--candidates <path>`.

Never upload candidate payloads or full `receipt.json` files containing account assets as public artifacts. Full receipts and message previews stay on the runner; public artifacts/summaries use `project_public_digest_receipt.py`'s allowlisted `receipt-public.json` (source SHA, window, coverage counts, unknown states, and fixed failure codes only—no run rows, identities, amounts, or free text).

## Recommended onboarding order (read-only notes)

1. **CharlesSchwabPlatform** — See `docs/digest_candidates_producer.zh-CN.md` in that repo; projects `qsl.digest_candidates.v1` from verified `runtime-daily-sync` facts.
2. **InteractiveBrokersPlatform** — See `docs/digest_candidates_producer.zh-CN.md` in that repo; sources `runtime_report.v1` + snapshot history (no Schwab-style `runtime-daily-sync`); keep `target_id` / account scope aligned with console bindings.
3. **LongBridgePlatform (SG)** — Isolated from HK; injects candidates through protected channels without modifying HK ingress or scheduler.

When private artifacts are unavailable locally, verify aggregation and rendering with synthetic dry-run candidates before configuring protected Environment secrets.

## Platform producers

The central repository consumes candidates only; producers live in platform repositories using canonical short `platform_id` values (`schwab`, `ibkr`):

| Platform repo | Doc | Notes |
| --- | --- | --- |
| `CharlesSchwabPlatform` | `docs/digest_candidates_producer.zh-CN.md` | Projects `qsl.digest_candidates.v1` from verified `runtime-daily-sync` facts; no public artifact upload; unknown fills stay `null` |
| `InteractiveBrokersPlatform` | `docs/digest_candidates_producer.zh-CN.md` | Sources `runtime_report.v1` + snapshot history (no `runtime-daily-sync`); unknown fills stay `null` |

### Local integration test (synthetic Schwab fixture)

```bash
python3 python/scripts/send_daily_digest_telegram.py \
  --dry-run --no-github \
  --business-day 2026-10-08 \
  --candidates /path/to/synthetic-candidates.json \
  --write-receipt /tmp/digest-receipt.json
```

Expected receipt: `source_coverage.candidates_loaded=true`, `total_fills=null` (`total_fills_status=unknown`), and copy showing unknown fills rather than zero fills or healthy link.

### Private candidate store (`DigestCandidateStore`, NOTIFY-04 B2)

`DigestCandidateStore` shares an existing GCS bucket (`gs://<shared-bucket>/digest-candidates/`) between platform producers and `QuantRuntimeSettings` rather than introducing a new repository, service, or public Actions artifacts (which would expose account equity).

- Producers (Schwab `digest-candidates-daily.yml`, IBKR `execution-report-heartbeat.yml`) upload `<uri>/<platform_id>/<business_day>/<target>.json` only when `DIGEST_CANDIDATES_GCS_URI` is set; otherwise they stay dry-run.
- When `DIGEST_CANDIDATES_GCS_URI` is configured in the central workflow, `DIGEST_CANDIDATES_READER_*` WIF credentials authenticate, list/copy `<uri>/*/<business_day>/*.json`, and run `merge_digest_candidates.py` (logging item counts only). Stale rows are dropped by B0 rules.
- Historical pre-permission probes (2026-10-11) confirmed Schwab/IBKR deploy SAs had get/list only and `<digest-reader-service-account>` lacked get/list before prefix-scoped IAM bindings were added and validated via dry-run preflight on 2026-10-14; natural-cycle acceptance remains tracked separately.

Offline intake bounds: `merge_digest_candidates.py` rejects runs with no base/input-dir source, missing paths, read errors, invalid JSON, missing arrays, or unsupported explicit schemas (exit 2) without writing partial envelopes or clobbering prior outputs. Explicit `producer_status` allows `projected` / `empty` / `skipped` (where `skipped`, `failed`, other values, and `null` fail closed rather than turning into valid empty sources). Valid `runs=[]` / `producer_status=empty` and empty directories from successful reads keep idle semantics. `digest_store_permission_check.py` prints counts, completeness, permission booleans, and HTTP status only—never object names or configured prefixes.

Non-empty candidates validate `platform_id` (non-empty string <= 64 chars), `strategy_profile` (non-empty string <= 128 chars), and explicit boolean `actually_ran` before filtering; missing or invalid fields fail closed.

The central fetch step passes `DIGEST_CANDIDATES_STORE_STATUS=loaded|failed` and `DIGEST_CANDIDATES_STORE_REASON` (`candidate_store_auth_failed`, `candidate_store_list_failed`, `candidate_store_copy_failed`, `candidate_store_merge_failed`, `candidate_store_outcome_missing`, `candidate_store_outcome_invalid`) without URIs, objects, or accounts. Failures populate `source_coverage.candidate_failures[]` and receipt `failures[]`, force full-source `total_fills=null` / `unknown`, warn in both `v1` and `sections_v2`, write full receipts/summaries before failing the intake gate, and never let legacy fallbacks mask failed stores unless `DIGEST_CANDIDATES_STORE_STATUS=failed` is explicitly set (emitting `candidate_input_unavailable_or_invalid`). Allowlisted public receipts validate types, enums, and date/window fields, converting invalid fields to `unknown` / `null`.

### Read-only preflight (`preflight_private_store`)

`workflow_dispatch` accepts boolean `preflight_private_store` (default `false`), permitted only on manual `refs/heads/main` runs with `dry_run=true`; invalid inputs or contexts exit 2 with fixed reason codes before reading credentials or creating directories. When enabled, an empty `DIGEST_CANDIDATES_GCS_URI` defaults to `gs://<shared-bucket>/digest-candidates` for that runner only using existing `DIGEST_CANDIDATES_READER_*` WIF credentials, without mutating Environment vars, secrets, IAM, schedule `v1` layout, or legacy candidates, and without sending Telegram messages.

### Production wiring

Formal candidate bindings and production configuration updates follow explicit user authorization using the production sender's protected configuration (Cloud Run or Azure package), least-privilege IAM, and read-only preview checks. Disabling `dry_run` in Actions does not restore the retired Actions sender.

## Dry-run validation

```bash
python3 python/scripts/send_daily_digest_telegram.py \
  --dry-run --no-github \
  --business-day 2026-10-08 \
  --candidates /path/to/synthetic-candidates.json \
  --write-receipt /tmp/digest-receipt.json
```

Verify in the receipt: `source_coverage.candidates_loaded=true`; distinct `opaque_account_uid` entries under the same `platform_id+strategy_profile` stay unmerged (`run_count>=2`); missing/unknown `fill_count` renders unknown rather than zero fills; simulated GitHub failures set `evidence_status=evidence_unknown`. Keep `workflow_dispatch` `dry_run=true` until Environment wiring is verified.

## Relationship to GitHub stubs

Without candidates, the aggregator may still query allowlisted workflows, but `actually_ran=true` denotes existence only, `fill_count`/`order_count` stay unknown, and API errors enter `failures` / `source_coverage` rather than reporting verified idle or healthy link.

## Related files

- `python/scripts/daily_digest_aggregator.py`
- `python/scripts/daily_digest_notify.py`
- `python/scripts/send_daily_digest_telegram.py`
- [`docs/notifications-quant-sentinel.md`](notifications-quant-sentinel.md)
- Schwab producer: `CharlesSchwabPlatform/docs/digest_candidates_producer.zh-CN.md`
- IBKR producer: `InteractiveBrokersPlatform/docs/digest_candidates_producer.zh-CN.md` (`runtime_report.v1` + snapshot history, no `runtime-daily-sync`)
