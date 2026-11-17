# QuantSentinel Notification Architecture

English | [简体中文](notifications-quant-sentinel.zh-CN.md)

Source of truth: `QuantRuntimeSettings/platform-config.json` → `notifications.quant_sentinel`

## GCP Secrets (unified bot)

| Secret name | Purpose |
| --- | --- |
| `<sentinel-telegram-secret>` | **Single** organization sentinel bot (monitoring, daily digest, plugin alerts, execution paths) |
| `<legacy-crisis-secret>` | **Deprecated**, retained for rollback only |

Each platform GCP project holds a copy of the sentinel secret under the same name (same bot): `<firstrade-project-id>`, `<longbridge-project-id>`, `<schwab-project-id>`, `<ibkr-project-id>`, plus crypto GCP projects if used.

Legacy per-platform bot secrets must not be used for execution digests:

| Legacy secret name | Status |
| --- | --- |
| `<legacy-longbridge-secret>` | Legacy; GitHub variable should point to sentinel |
| `<legacy-ibkr-secret>` | Legacy |
| `<legacy-telegram-secret>` | Legacy |
| `<legacy-schwab-secret>` | Legacy |

Binance's historical GitHub secret `TG_TOKEN` must point to the **same sentinel bot**; public repositories record names only, never token values.

## GitHub variable contract (names only)

| Variable name | Expected value |
| --- | --- |
| `TELEGRAM_TOKEN_SECRET_NAME` | `<sentinel-telegram-secret>` |
| `STRATEGY_PLUGIN_ALERT_TELEGRAM_BOT_TOKEN_SECRET_NAME` | `<sentinel-telegram-secret>` |
| `NOTIFY_LANG` / `QSL_NOTIFY_LANG` | `zh` or `en` (code default `en`). Production digest language comes from `QSL_NOTIFY_LANG` set explicitly by the Azure invocation; `daily_digest.default_locale` / `locales` in `platform-config.json` do not select it |

Chat targets are injected at runtime only: `QSL_GLOBAL_TELEGRAM_CHAT_ID` (preferred) → `GLOBAL_TELEGRAM_CHAT_ID` → `STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS`. Public config carries `telegram_chat_id_ref` only and forbids literal chat IDs.

## Runtime environment variables

| Variable | Description |
| --- | --- |
| `TELEGRAM_TOKEN` | Bot token (injected via secret reference in production senders; Actions preview injects no bot credentials) |
| `QSL_GLOBAL_TELEGRAM_CHAT_ID` | Preferred cross-platform chat routing variable |
| `GLOBAL_TELEGRAM_CHAT_ID` | Legacy fallback |
| `QSL_NOTIFY_LANG` / `NOTIFY_LANG` | Digest and preview language |

## Daily cross-platform digest

Configuration block: `notifications.quant_sentinel.daily_digest` (schema `qsl.daily_digest.v1`).

### Behavior

- **Single message** through the unified QuantSentinel bot rather than one bot per platform.
- **Actually-ran filter:** includes only platforms/strategies that ran in the window (hourly crypto when cycles ran, month-end DCA on run days; non-running strategies omitted).
- **No runs:** verified empty heartbeat (short message). **Runs with zero fills:** heartbeat header, expanding observation blocks if candidate fields are present.
- **Fills > 0:** daily digest header, prioritizing observation blocks.
- **Observation fields (evidence-backed only, never fabricated):** `strategy_label`, `equity`, `holdings[]` (`symbol`/`value`/`qty`), `signal_summary`, `rebalance_kind` / `rebalance_conclusion`, optional `tips` / `account_hint`. Block header `[account]` resolves `account_hint` → `{platform_id} {account_scope|execution_mode}` (e.g., `schwab live`, `ibkr live`, `firstrade paper`) → short `opaque_account_uid` → `target_id`. GitHub workflow success proves execution existence only and never populates balances or holdings.
- **Pure aggregation:** never changes trading or risk decisions; amounts and account IDs never enter public CI logs.

### NOTIFY-04 four-section digest (`sections_v2`, pilot)

- Layout flag: `--layout sections_v2` / env `DIGEST_LAYOUT` / `workflow_dispatch` input `layout`. **Scheduled runs stay fixed on `v1`**; switching requires separate authorization (NOTIFY-04 B7).
- Window: New York business day `B` maps to Shanghai report date `B+1`, covering `[B 06:00, B+1 06:00)` `Asia/Shanghai` (`[B-1 22:00, B 22:00)` UTC); receipts record `window{start_local,end_local,start_utc,end_utc,report_date}`.
- Section order: Pending attention (errors, stale candidates, unknown evidence) → US daily strategies (market closed on NY weekends; missing-evidence note on weekdays) → DCA (`us_dca_month_end` and crypto `*_dca`, shown only when run) → Crypto intraday (shown only when run) → Coverage.
- Section assignment prefers candidate `section` (`us_daily` / `dca` / `crypto_intraday`), falling back to `platform-config.json` domain / `scheduler_profile`. A Binance BTC DCA leg inside hourly strategies requires a separate `section=dca` candidate row (B3).

### Production digest schedule

- Timezone: `Asia/Singapore`
- Daily send at 07:00; read-only receipt check at 07:30. Repository evidence points to the Azure scheduled sender (sharing the digest core with the Cloud Run entry point), verified live on 2026-11-16 with live configs kept out of this repo. Cloud Scheduler → Cloud Run remains a supported earlier design. Legacy Actions cron is retired; the stats window still closes at 06:00.
- Crypto strategies merge into the same window whenever UTC cycles ran.

### Copy and i18n

Reference implementation: `python/scripts/daily_digest_notify.py` (pure rendering; no secret reads or network calls).

| Locale | Fills > 0 header | Idle / zero-fill header |
| --- | --- | --- |
| `zh` | 量化哨兵 · 收盘日报 | 量化哨兵 · 心跳 |
| `en` | QuantSentinel · Daily digest | QuantSentinel · Heartbeat |

Aggregator/preview locale lookup: `QSL_NOTIFY_LANG` → `NOTIFY_LANG` → `en`. In `cloud_run_daily_digest.py`, `Configuration.locale` uses the explicit caller value or `QSL_NOTIFY_LANG` via `Configuration.from_environment()` (default `en`), ignoring `NOTIFY_LANG` and `platform-config.json` locale fields.

Message structure examples (synthetic fixture values; window and channel lines omitted):

Thin list (without observation fields):

```text
📡 量化哨兵 · 收盘日报
业务日: 2026-10-08
【当日已运行】
· ibkr / soxl_soxx_trend_income · 订单 2 · 成交 2 · 正常
· binance / crypto_equity_combo · 周期 4 · 成交 1 · 正常
```

Observation heartbeat block (fields supplied by producer candidates):

```text
📡 量化哨兵 · 心跳
业务日: 2026-10-08
[schwab live] 💓 【心跳检测】
🧭 策略: 半导体趋势收益
💰 账户总权益: USD 990.06
💼 持仓
- SOXL: $635.92 / 4股
- 🎯 信号: SOXX 站上 140 日门槛线，持有 SOXL 70.0% + SOXX 20.0%
- 小账户提示: 净值 $990 低于建议 $1,000；…
✅ 无需调仓
平台: schwab
```

Multi-platform observation blocks (separated by blank lines):

```text
📡 量化哨兵 · 心跳
业务日: 2026-10-09
[schwab live] 💓 【心跳检测】
🧭 策略: 半导体趋势收益
💰 账户总权益: USD 989.34
✅ 无需调仓
平台: schwab

[U00000000] 💓 【心跳检测】
🧭 策略: 纳斯达克增长收益
💰 账户总权益: USD 569.16
💼 持仓
- TQQQ: $312.40 / 4股
✅ 无需调仓
平台: ibkr
```

Filled rebalance observation block (`fill_count > 0`):

```text
📡 量化哨兵 · 收盘日报
业务日: 2026-10-09
[U00000000] 🔔 【调仓指令】
🧭 策略: 纳斯达克增长收益
💰 账户总权益: USD 569.16
💼 持仓
- TQQQ: $312.40 / 4股
✅ 成交成功 1个标的: TQQQ 1
📈 [市价买入] TQQQ: 1股 ✅ 已成交（状态: Filled）
平台: ibkr
```

Empty-run heartbeats distinguish three states:

- **Verified idle:** configured evidence sources queried cleanly with zero runs.
- **Evidence unknown / read failed:** missing candidates or API failures; never claim healthy link.
- **Verified zero fills:** producer explicitly reported `fill_count=0`; GitHub existence stubs leave fills `unknown`.

Receipt `total_fills` follows the same boundary: missing evidence, stale candidates, or source failures set all-source `total_fills` to `null` / `unknown` while preserving known per-run counts; verified idle and complete known run counts retain exact totals (including genuine zero).

```text
📡 量化哨兵 · 心跳
业务日: 2026-10-08
今日运行证据未知或读取失败，不能判定为链路正常。
```

### Aggregation and delivery (platform side)

1. Each platform emits an end-of-day run/order/fill summary (reusing execution reports or heartbeats).
2. Central aggregator invokes `filter_runs_for_digest` and `render_daily_digest`.
3. Send via the shared `<sentinel-telegram-secret>` and global chat route.
4. Disable or redirect legacy per-platform execution digest bots to sentinel.

### Aggregator implementation in this repository

- Contract: [unified daily notification contract](unified-daily-notification.md). Production evidence points to the Azure scheduled sender (packaged via `release-digest-package.yml`), with Cloud Run supported as an earlier entry point. `.github/workflows/daily-digest-notify.yml` is manual read-only preview only.
- Core: `python/scripts/cloud_run_daily_digest.py` (shared by Azure and Cloud Run) backed by `daily_digest_aggregator.py`; `send_daily_digest_telegram.py` handles legacy compatibility and read-only previews.
- Schedule: 07:00 `Asia/Singapore` send, 07:30 read-only receipt check, 06:00 window cutoff.
- Evidence: formal sender reads bound GCS candidate objects via the official SDK without bucket listing or GitHub queries. Legacy JSON/file merges and existence checks apply to manual previews only (see [candidate wiring](./digest-candidates-wiring.md)).
- Aggregation key: `platform_id + strategy + opaque_account_uid|unknown + target_id|unknown`.
- Delivery: `TELEGRAM_TOKEN` secret reference + `QSL_GLOBAL_TELEGRAM_CHAT_ID`, with GCS deduplication ledger per scope and report date.
- Preview: `workflow_dispatch` requires `dry_run=true`; Cloud Run `/preview` returns safe status only without reserving or sending.
- Binance: historical `TG_TOKEN` alignment notes reside in `platform-config.json` → `daily_digest.aggregator.binance_alignment_note_*`.

## VPS / Cloud Run references

```bash
scripts/load_telegram_env.sh /run/quant-monitor/telegram.env
systemd/quant-monitor.service.example
scripts/daily_briefing_pipeline.sh      # legacy briefing; daily_digest contract governs closing digests
```

`STRATEGY_PLUGIN_ALERT_TELEGRAM_BOT_TOKEN_SECRET_NAME=<sentinel-telegram-secret>`

## Read-only route diagnosis (P0-06)

Implemented in `python/scripts/send_daily_digest_telegram.py` (`diagnose_telegram_route()` / `--route-check`). Emits matching metadata only and never prints tokens or chat IDs; optional `--include-chat-fingerprint` (default off) outputs `sha256_12` + `last4`.

| Field | Meaning |
| --- | --- |
| `secret_name_contract` | Contract name, default `<sentinel-telegram-secret>` |
| `token_source_kind` | `env:TELEGRAM_TOKEN` / `env:TG_TOKEN` / `gcp_secret_manager` / `gcp_secret_manager_unprobed` / `missing` |
| `chat_source_kind` | `env:QSL_GLOBAL_TELEGRAM_CHAT_ID` / `env:GLOBAL_TELEGRAM_CHAT_ID` / `env:STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS` / `missing` |
| `token_alias_used` / `chat_alias_used` | Whether a non-preferred alias resolved |
| `warnings` | Shadowing/conflict codes (`token_env_shadowed:...`, `token_gcp_secret_manager_shadowed_by_environment:...`, `chat_env_shadowed:...`) |
| `missing` | Missing wiring names (`gcp_secret_manager_unprobed` when GCP is not probed) |

```bash
python3 python/scripts/send_daily_digest_telegram.py --route-check --write-receipt /tmp/route-receipt.json
python3 python/scripts/send_daily_digest_telegram.py --route-check --probe-secret-manager --write-receipt /tmp/route-receipt.json
```

### Alias retirement criteria

| Alias | Retirement conditions (all required) | Pre-removal step |
| --- | --- | --- |
| `TG_TOKEN` | All consumers inject `TELEGRAM_TOKEN` or `TELEGRAM_TOKEN_SECRET_NAME`→`<sentinel-telegram-secret>`; Binance/plugins drop `TG_TOKEN`; >= 1 business week of `--route-check` with `token_alias_used=false` and no `TG_TOKEN` warnings | Mark deprecation date in Environment/org inventory; keep read-only for one week |
| `GLOBAL_TELEGRAM_CHAT_ID` | All consumers inject `QSL_GLOBAL_TELEGRAM_CHAT_ID`; heartbeats/canaries/syncs stop reading `GLOBAL_*`; >= 1 business week of clean `--route-check` | Same as above |
| `STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS` (digest fallback) | Global digest depends solely on `QSL_GLOBAL_*`; plugin multi-chat uses its own documented contract | Document plugin route before removing digest fallback |
| Legacy platform bot secret names (`<legacy-longbridge-secret>`, etc.) | All GitHub variables point to `<sentinel-telegram-secret>`; no platform `gcloud secrets access` calls on old names; PAPER preview equality verified | See legacy secret table above |

Retiring aliases does not rotate the bot: external display name ("QSL资产管家") and internal `QuantSentinel` coexist while technical secret contract stays `<sentinel-telegram-secret>`.

### Unverified duplicate-send risks (public code evidence)

The central digest sends from `cloud_run_daily_digest.py`. The following platform paths could send additional Telegram messages depending on private Environment settings:

| Repo | Public file | Role | Risk status |
| --- | --- | --- | --- |
| `LongBridgePlatform` | `main.py` | Runtime strategy notifications | Duplicate risk unverified |
| `LongBridgePlatform` | `scripts/execution_report_heartbeat.py` | Execution report heartbeat | Duplicate risk unverified |
| `LongBridgePlatform` | `scripts/cloud_run_runtime_guard.py` | Cloud Run guard alerts | Duplicate risk unverified (exception path, may be orthogonal) |
| `LongBridgePlatform` | `scripts/send_paper_notification_canary.py` | PAPER preview / canary | Preview path; avoid overlapping schedule with central digest |
| `QuantRuntimeSettings` | `python/scripts/cloud_run_daily_digest.py` | Central cross-platform digest core | Single formal sender; Actions is preview-only |

Note: several `LongBridgePlatform` scripts prioritize `GLOBAL_TELEGRAM_CHAT_ID` over `QSL_GLOBAL_TELEGRAM_CHAT_ID`; other broker repos not audited locally are marked unknown.

## Verification (no secret leakage)

- Permitted: manual `workflow_dispatch` on platform `paper-notification-preview` (synthetic PAPER preview, no orders).
- Confirm `TELEGRAM_TOKEN_SECRET_NAME` (or Binance `TG_TOKEN`) points to the same sentinel bot beforehand.
- Reports record delivery status, path, revision, and observation time only—never tokens, chat IDs, or balances.
- Same-named env/secret entries do not prove identical underlying bots without equality checks; healthy no-order / dry-run ticks stay quiet while real orders and exceptions still alert.
