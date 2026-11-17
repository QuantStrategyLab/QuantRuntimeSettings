# Strategy Switch Console Information Design

English | [简体中文](console-information-design.zh-CN.md)

This document defines the information architecture, display boundaries, and design rules for the operations console. All existing account permissions, strategy gates, and confirmation flows remain unchanged, with no new services, dependencies, or charges.

## Frontend design rules

Only two frontend design requirements are mandatory for all plans and implementations:

1. **Bilingual:** `zh-CN` is the primary language, with `en` alongside it.
2. **Light and dark mode:** every screen works in both.

All other visual choices (layout, colour, shadows, gradients, borders, radius, grids, charts, components, and token usage) are flexible. Hardcoded colours are reported only as warnings by `npm run check:style-guards` in `web/strategy-switch-console/frontend`, which never blocks.

Blocking design checks cover only the two mandatory requirements: `tests/console_frontend_i18n_validation.mjs` for `zh-CN` and `en`, and `tests/console_tokens_css_validation.mjs` plus the theme section of `tests/console_credential_rotation_ui_validation.mjs` for light and dark colour tokens. `tests/console_tokens_css_validation.mjs` also requires `tokens.css` to remain the only stylesheet declaring `:root` tokens and every `var()` in it to resolve.

The flat design specification adopted on 2026-11-01 was revoked on 2026-11-02 and no longer applies; existing pages do not need migration.

## IBKR account naming

Authenticated surfaces display an IBKR account by its validated `account_selector` (native IBKR account ID: `U` plus digits for live, `DU` plus digits for paper). When missing or invalid, the UI displays "Account ID unavailable" instead of substituting a strategy name, `key`, `label`, or `target_name`. Platform and strategy remain separate fields. Stop confirmation requires entering that account ID and blocks if unavailable. `account_alias` remains the technical key for requests, selection, grouping, and history.

## Daily operational questions

| Surface | Primary content | Secondary content |
| --- | --- | --- |
| Operations overview (default) | All configured accounts, saved switches, actual readback, recorded timestamps, pending confirmations, and mismatches | Filtering, search, account drill-down, items genuinely needing human action |
| Account management | Platform/account selection, current strategy, saved switches, recent runtime checks and timestamps | Collapsed actual switches, scheduler, and application state; strategy settings expanded on demand |
| Research and confirmation | Target platform intent selection when accepting candidates, pending human decisions, or explicit empty state | Collapsed risk explanations, legacy tickets, and historical research records |

Research timestamps are never presented as page refresh times, and saved "enabled" configuration is never presented as healthy runtime operation. Missing, stale, or unmapped readbacks stay pending confirmation. Recorded timestamps denote readback time rather than fill time or latest successful cycle. The home screen omits raw tickets, SHAs, JSON payloads, and design-preview risk numbers, and never invents returns, balances, or health status.

Account views do not infer live readiness from the editing environment. Normal browsing hides pseudo-readiness checklists for form fields; validation errors appear inline beside fields and primary actions, and unsaved edits remain in the change summary.

The overview shows the research entry point only when complete candidates await human decision. Legacy tickets and unverified material remain in collapsed research history rather than active TODOs. Stale research material is distinguished from read failures; stale material never implies no new decisions exist, and newer timestamps from other sources never overwrite the research material timestamp.

Viewing, searching, filtering, and refreshing are read-only. Existing live resume, stop, strategy switch, and research confirmation paths keep their respective permissions and submission guards.

## Layout and copy

- Desktop: fixed narrow sidebar, ~1120 px main content area, four summary stats, compact status banner, and account list.
- Mobile: three-item top navigation, two-column summary stats, and vertical account blocks without horizontal scroll; account details also stack vertically.
- Navigation labels: Operations overview, Account management, Research and confirmation. Overview title and subtitle clarify that saved configuration, actual readback, and recent runtime records are shown.
- All states and actions provide both Chinese and English copy, semantic buttons, visible focus indicators, and primary touch targets of at least 44 px.
- Palette: background `#f6f7f9`, primary text `#172d35`, secondary text `#667680`, accent `#10766a`, border `#dfe6ea`; pending confirmation uses neutral tones rather than error red; config mismatch uses light amber.
- System sans-serif typography; desktop H1 ~32 px, mobile H1 26 px, body 14–15 px, 8 px spacing scale, ~8 px corner radius, no decorative charts.

## Interaction and verification

Verify the default overview, account selection, config vs. observed separation, environment selection isolation, active reviewable candidate entry, research empty state, stale vs. failed read handling, collapsed history, search/filter, refresh timestamps, language switching, and desktop/mobile layouts. Live verification checks read-only navigation only; submission tests run against isolated synthetic fixtures and never trigger live trading.

## KV usage and heartbeat audit

Each runtime target heartbeat still writes the full latest snapshot, including source and readback timestamps; quota is not saved by skipping refreshes or extending TTLs. When only timestamps advance and normalized state is unchanged, the optional rolling audit list skips duplicate sync entries. First sync, enable/disable or strategy changes, runtime errors and recoveries, stale readback recoveries, and scheduler readback changes still append audit entries. Manual operator actions and other audit types are unaffected.

This reduces unchanged single-heartbeat syncs from two KV writes to one (e.g., from 480 to 240 writes/day across 10 hourly targets on this path, without estimating total Cloudflare account usage). Actual quota alerts must be read from Cloudflare account metrics rather than test counts.

Cloudflare free KV quotas are 100,000 reads and 1,000 writes, deletes, and lists per day (resetting at 08:00 Beijing time); check trigger categories and eliminate duplicates before considering plan upgrades. See [Cloudflare KV Pricing](https://developers.cloudflare.com/kv/platform/pricing/).

## Acceptance contracts (UI-01 to UI-05, DATA-01, DATA-02)

The sections below define acceptance contracts and boundaries; they do not claim all downstream capabilities are live.

### Strategy names vs. technical identity (UI-01)

- Human-readable primary names belong in bilingual `label_zh` / `label_en` fields read by `strategyDisplayName`; technical profiles/keys, immutable candidate IDs, artifact paths, and evidence digests stay immutable.
- Display names summarize instrument and approach; candidate version, source revision, parameter/config hash, role, execution lane, and evidence timestamp are displayed separately, with full technical identity placed in collapsed details. Duplicate display names must remain disambiguated while preserving access to older records.
- `candidate`, `challenger`, and `champion` are research/adoption roles; `research`, `shadow`, `paper`, and `live` are evidence or execution lanes. Selectability, saved config, and observed execution are independent facts.
- SOXL V7 is a frozen source-correctness candidate retaining a 3% cash reserve and V6 pre-registered parameters (`v7` does not imply repeated AI tuning rounds). AI authorship cannot be inferred from version numbers or `ai_extensions=disabled`.
- R5/R6 research tracks, signal candidates, strategy source revisions, and parameter config hashes are distinct identifiers; R6 retains the V7 signal under an independent single-source study/input/evaluation identity and does not inherit dual-source P1/P3 evidence.

### UI-01 display mapping and release notes

`platform-config.json` remains the single source of truth for catalog labels through the existing generator. Four strategy label pairs (V7, two US equity combos, and crypto pool rotation) were updated in [QRS #531](https://github.com/QuantStrategyLab/QuantRuntimeSettings/pull/531), leaving the other 23 pairs unchanged and keeping all parameters, accounts, IDs, and permissions intact. Recalculating catalog `content_sha256` reflects label regeneration, not a frozen strategy config hash.

| Stable profile / key (unchanged) | Chinese display name | English display name |
| --- | --- | --- |
| `tqqq_growth_income` | 纳斯达克增长收益 | NASDAQ Growth Income |
| `soxl_soxx_trend_income` | 半导体趋势收益 | Semiconductor Trend Income |
| `soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve` | SOXL/SOXX 核心复利（现金保留） | SOXL/SOXX Core Compounding (Cash Reserve) |
| `nasdaq_sp500_smart_dca` | 纳指标普定投 | NASDAQ/S&P 500 DCA |
| `ibit_smart_dca` | IBIT比特币定投 | IBIT Bitcoin DCA |
| `global_etf_rotation` | 全球ETF轮动 | Global ETF Rotation |
| `russell_top50_leader_rotation` | 罗素Top50领涨 | Russell Top50 Leaders |
| `tecl_xlk_trend_income` | TECL/XLK趋势收益 | TECL/XLK Trend Income |
| `us_equity_combo` | 美股核心收益组合 | US Core Income Combo |
| `us_equity_combo_core` | 美股核心组合 | US Core Combo |
| `us_equity_combo_leveraged` | 美股加速组合 | US Alpha Combo |
| `hk_global_etf_tactical_rotation` | 港股ETF战术轮动 | HK ETF Tactical Rotation |
| `hk_low_vol_dividend_quality_snapshot` | 港股红利质量 | HK Dividend Quality |
| `hk_equity_combo` | 港股恒生组合 | HK Core Combo |
| `cn_industry_etf_rotation` | A股行业ETF轮动 | CN Industry ETF Rotation |
| `cn_industry_etf_rotation_aggressive` | A股ETF轮动 | CN ETF Rotation |
| `cn_index_etf_tactical_rotation` | A股宽基ETF战术轮动 | CN Index ETF Tactical Rotation |
| `cn_chinext_tactical_rotation` | 创业板战术轮动 | CN ChiNext Tactical Rotation |
| `cn_chinext_growth_momentum_quality` | 创业板成长动量质量 | CN ChiNext Growth Momentum Quality |
| `cn_dividend_quality_snapshot` | A股红利质量 | CN Dividend Quality |
| `cn_chinext_growth_momentum_quality_snapshot` | 创业板成长质量快照 | CN ChiNext Growth Quality Snapshot |
| `cn_star_growth_momentum_quality` | 科创板成长动量质量 | CN STAR Growth Momentum Quality |
| `cn_equity_combo` | A股进取组合 | CN Alpha Combo |
| `crypto_live_pool_rotation` | 加密池轮动 | Crypto Pool Rotation |
| `crypto_btc_dca` | BTC定投 | BTC DCA |
| `crypto_trend_rotation` | 山寨趋势轮动 | Altcoin Trend |
| `crypto_equity_combo` | 加密动量组合 | Crypto Core Combo |

Because release gates do not overwrite private strategy catalogs on label-only edits, the frontend normalizes those four exact IDs from the generated asset without altering private catalog versions, parameters, or runtime adoption. Unknown IDs and other private labels stay untouched.

All 27 catalog profiles omit actual strategy source revision, research role, and observed execution lane, displaying "Unknown". Only V7's catalog `research_candidate_identity` supplies an immutable candidate ID and config digest `<frozen-config-sha256-v7>`; `lifecycle_stage`, `allowed_execution_modes`, account environment, enablement, and display names never backfill missing identity fields.

Current account config, strategy selection/drafts, decision details, and application cards share a unified display helper with full technical identity collapsed by default. Ticket, candidate, and application records read their own fields without patching gaps from today's catalog, and ticket creation timestamps are not evidence timestamps.

#### Frozen research version index (STRAT-01)

The mapping below documents fixed research source and candidate configs only; it does not attest deployment, adoption, or runtime status. The UI displays "Frozen research version" only when both candidate ID and config digest match exactly; missing source revisions remain Unknown.

| Immutable candidate ID | Chinese / English display name | Version | Frozen UES revision | Frozen config SHA-256 |
| --- | --- | --- | --- | --- |
| `soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve` | SOXL/SOXX 核心复利（现金保留） / SOXL/SOXX Core Compounding (Cash Reserve) | V7 | `<pinned-commit-sha>` | `<frozen-config-sha256-v7>` |
| `tqqq_core_only_p2_v5` | TQQQ 核心趋势 / TQQQ Core Trend | V5 | `<pinned-commit-sha>` | `<frozen-config-sha256-v5>` |
| `tqqq_core_only_p2_v9_benchmark_drawdown_guard` | TQQQ 基准回撤防护 / TQQQ Benchmark Drawdown Guard | V9 | `<pinned-commit-sha>` | `<frozen-config-sha256-v9>` |

V7 pins QPK revision `<pinned-commit-sha>`, and V5 pins `<pinned-commit-sha>`; V9 has no independent QPK pin in this index. V7's 3% figure reflects the frozen strategy's cash-reserve contract rather than live account cash readback.

R6 carries study ID `soxl_v7_twelve_basic_split_close_development_v1` and input contract `qsl.soxl-v7-twelve-single-source-r6-input.v1`. It shares the V7 signal and config under an independent single-source development evaluation identity and never inherits dual-source P1/P3 or forms champion, paper, shadow, or live conclusions.

Frozen sources (UESP `<pinned-commit-sha>`): [SOXL V7 config](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines/blob/<pinned-commit-sha>/config/soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve.json), [TQQQ V5 config](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines/blob/<pinned-commit-sha>/config/tqqq_core_only_p2_v5.json), [TQQQ V9 config](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines/blob/<pinned-commit-sha>/config/tqqq_core_only_p2_v9_benchmark_drawdown_guard.json), [R6 study contract](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines/blob/<pinned-commit-sha>/docs/soxl_v7_r6_twelve_single_source.md).

#### Release and verification scope

Offline verification covered 12 validation suites (bilingual naming, duplicate names, legacy private labels, unknown/mismatched identities, V7/R6 axis separation, immutable request IDs, React SSR, and overview/account regressions). A limited authenticated production check confirmed the referenced asset path and one decision's collapsed identity fields; direct asset fetch returned `net::ERR_BLOCKED_BY_CLIENT`, so full online hash verification, all four renamed labels, language switching, mobile layout, a live V7 cash-reserve record, and historical research UI remain unverified and UI-01/STRAT-01 remain open.

### Platform capabilities, account entity, and trading markets (UI-02)

Entity jurisdiction, account environment, trading market, currency, trading calendar, and execution capability are represented independently. LongBridge platform configuration and the strategy registry support both US and HK equities; an HK entity does not restrict an account to HK equities or imply equal permissions across accounts.

Selectable parameters come from the verified intersection of platform, real account permissions, strategy domain, instrument, and execution lane. Per-account capability sources, observation timestamps, and gaps are recorded individually; unknown permissions stay pending confirmation. Lot sizing, fractional/notional rules, paper/live availability, and calendar differences must be verified explicitly.

### Config save vs. actual adoption (UI-03)

Standard account settings saves create drafts and risk preferences only (`apply_strategy=false`, `activation=false`, `adopted=false`). An isolated profile-only confirmation path does not attest that routine settings saves apply to live runtimes. Subsequent validation follows authorized save, confirmation, runtime readback, and cycle checks without triggering live orders.

### 90-day records and history coverage (UI-04, UI-05)

The date picker currently covers the last 90 US Eastern business days, while `runtime_daily_contract.js` currently binds only one LongBridge paper/Russell target rather than proving 90-day producer retention across all accounts. Future coverage manifests must list each target's producer, account binding, market calendar, first/last record, retention policy, and gaps. `not_due`, HTTP 200, heartbeat presence, and clickable date buttons do not prove completed business cycles.

Normal no-order runs, dry-run previews, submitted/pending/filled orders, and failures are displayed distinctly; unknowns are never rendered green. Switching targets never reuses another account's cycle records, and US, HK, and 24/7 markets use matching business-day calendars.

Account equity history currently retains up to 366 days while charts offer 3/5/10-year ranges, requiring explicit first-sample and truncation indicators with no fabricated backfill. Verification covers failed refreshes, same-timestamp retries, stale responses, unmount cleanup, currency/account switching, and gap notices.

### Qualified returns and four benchmarks (DATA-01, DATA-02)

Equity and cash snapshots are not returns. Returns are displayed only after verifying account, currency, source, period, calculation method, fees/external flows, and coverage. Broker-reported account interval TWR is not automatically a strategy return, and monthly TWR remains an interval observation rather than fabricated daily series. Missing values are never zero-filled or patched from research CSVs.

The four legend series (S&P 500, Nasdaq, Dow Jones, Russell) require explicit index/series IDs, price vs. total-return methodology, source licensing, currency, window alignment, and comparability; embedded FRED price iframes do not constitute account comparisons, and price indexes are never silently mixed with total-return series.
