# Canonical naming registry

[中文版](canonical-naming-registry.zh-CN.md)

Status: proposed. This document defines the QuantStrategyLab canonical naming
registry, Draft 2020-12 schema
([`qsl-canonical-naming-registry.v1.schema.json`](../schemas/qsl-canonical-naming-registry.v1.schema.json)),
and pure leaf validator
([`naming_canonical/registry.js`](../web/strategy-switch-console/application/naming_canonical/registry.js)),
aligned with Roadmap v2.0 Item 14, Item 16 (`NAMING-CANONICAL`), and Item 17.
It defines naming conventions and non-breaking alias mappings only. It does not
authorize any rename, migration, deletion, deployment, runtime behavior change,
or trading/order authority.

All examples use synthetic values. Existing historical ledger hashes, Durable
Object keys, KV directory keys, and signed receipts stay completely intact
(`immutable_legacy_hashes: true`) through `legacy_aliases`. Real brokerage
account IDs, credentials, and private storage locators stay in protected
configuration, not in tracked repositories.

Related specifications:

- [GCP resource naming convention](gcp-resource-naming-convention.md) (cloud
  infrastructure resource names and labels; uses hyphens while application
  machine IDs follow the registry formats below)
- [ADR 0002: observation and identity boundaries](adr/0002-observation-and-identity-boundaries.md)
  (rule R3: keep account, instance, target, and display separate)
- [Strategy plugin contract V2](qsl-strategy-plugin-contract-v2.md) (signal-only
  plugin boundaries and `P1`/`P2`/`P3` digest binding)

## General rules

- Separate human labels (`label_zh`, `label_en`) from immutable machine IDs.
  Changing display text never mutates a machine ID, hash, or tier binding.
- Reject raw brokerage account numbers (such as `^U\d{5,}$`, `^DU\d{5,}$`, or
  standalone 6+ digit numeric IDs) and unsafe private storage locators (`kv://`,
  `do://`, `https://`, filesystem paths, query strings) in machine identifiers,
  labels, and aliases.
- Preserve existing legacy catalog IDs and historical hashes via
  non-destructive `legacy_aliases` (`resolveCanonicalAlias`) instead of in-place
  renames.

## 1. Closed platform slugs

Only the five registered platform slugs are valid in canonical schemas:

| Slug | Status | Human label (EN / ZH) | Legacy aliases |
| --- | --- | --- | --- |
| `schwab` | `active` | Schwab / 嘉信理财 | `charles-schwab`, `charles_schwab` |
| `firstrade` | `active` | Firstrade / 第一证券 | — |
| `ibkr` | `active` | IBKR / 盈透证券 | `interactive-brokers`, `interactive_brokers` |
| `longbridge` | `active` | LongBridge / 长桥证券 | `longport`, `lb` |
| `binance` | `dormant` | Binance / 币安 | — |

Notes:

- `binance` is marked `dormant` (deferred post-`HORIZON`, per Item 17).
- There is zero active A-share venue (`cn_a_share` / `qmt` are excluded from the
  closed platform enum).

## 2. Account slot tuples

Canonical account slots use the three-part tuple `{platform}:{env}:{slot}`:

- Pattern:
  `^(schwab|firstrade|ibkr|longbridge|binance):(live|paper|research):[a-z0-9][a-z0-9_-]{0,31}$`
- Allowed `env` values: `live`, `paper`, `research`.
- Synthetic examples: `ibkr:live:a1`..`ibkr:live:a4`, `longbridge:paper:pilot`,
  `longbridge:live:sg`, `longbridge:live:hk`, `schwab:live:main`,
  `firstrade:live:main`, `binance:live:dormant`, `binance:research:archive`.
- Raw brokerage account IDs and unqualified bare keys (such as `live` without a
  platform prefix when multiple platforms share that suffix) are rejected.

## 3. Strategy profile IDs

Canonical strategy IDs use four lowercase alphanumeric segments
`{market}_{asset}_{family}_{horizon}`:

- Pattern: `^(us|hk|global|crypto)_[a-z0-9]+_[a-z0-9]+_[a-z0-9]+$`
- `version` (e.g., `v5`, `v7`) and `risk_tier` are stored as separate metadata
  fields — never suffixed onto `strategy_id` (for example, `us_soxl_trend_v2`
  and `tqqq_growth_income_v7_aggressive` are rejected).
- Allowed `disposition` values: `active_pilot`, `phase8_review`, `archived`.

Selected mappings from legacy catalog IDs (non-breaking; legacy IDs remain
intact in existing configs/ledgers via `legacy_aliases`):

| Canonical ID | Disposition | Legacy alias |
| --- | --- | --- |
| `us_tqqq_trend_daily` | `active_pilot` | `tqqq_growth_income` |
| `us_soxl_trend_daily` | `active_pilot` | `soxl_soxx_trend_income` |
| `us_soxx_core_daily` | `active_pilot` | `soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve` |
| `global_etf_rot_weekly` | `phase8_review` | `global_etf_rotation` |
| `us_russell50_rot_weekly` | `phase8_review` | `russell_top50_leader_rotation` |
| `hk_etf_rot_weekly` | `phase8_review` | `hk_global_etf_tactical_rotation` |
| `hk_div_qual_daily` | `phase8_review` | `hk_low_vol_dividend_quality_snapshot` |
| `us_ibit_dca_weekly` | `phase8_review` | `ibit_smart_dca` |
| `crypto_btc_dca_weekly` | `phase8_review` | `crypto_btc_dca` |

Legacy `cn_equity` profiles are permanently abandoned/archived with zero new
canonical promotion under `us|hk|global|crypto`.

## 4. Plugin IDs and capability classes

Canonical plugin IDs enforce strict capability prefixes:

- Pattern: `^(obs|risk)_[a-z0-9]+(?:_[a-z0-9]+)*$`
- `obs_*` (**observer**): strictly read-only (`read_only: true`,
  `can_adjust_risk: false`, `can_bypass_fuse: false`, never emits risk
  adjustment or scalar `> 1.0`). Examples: `obs_advisor_scorecard`,
  `obs_event_radar`.
- `risk_*` (**risk reduction**): bounded one-way risk-reduction scalar only
  (`0 <= max_scalar <= 1.0`, `can_adjust_risk: true`, `can_bypass_fuse: false`).
  Examples: `risk_macro_governor` (legacy `macro_risk_governor`),
  `risk_regime_control` (legacy `market_regime_control`).
- Bare unprefixed plugin names (such as `macro_risk_governor` as a canonical ID)
  and `can_bypass_fuse: true` are rejected by both schema and validator.

## 5. 1:1 Risk tier bidirectional map

Console risk tiers bind 1:1 with engine risk tiers:

| Console tier | Engine tier |
| --- | --- |
| `CAPITAL_PRESERVATION` | `conservative` |
| `BALANCED_COMPOUNDING` | `balanced` |
| `GROWTH_COMPOUNDING` | `aggressive` |

Unknown tiers return `null` rather than defaulting to any numeric policy.

## 6. Non-breaking policy

1. **New contracts (`SA-2..4`, `FUSE-3`, `BREADTH`)** must use canonical IDs
   matching [`qsl-canonical-naming-registry.v1.schema.json`](../schemas/qsl-canonical-naming-registry.v1.schema.json).
2. **Existing records and hashes** keep their legacy identifiers unchanged;
   consumers bridge via `legacy_aliases` without rewriting history.
3. **Retirements and migrations** occur only under separate owner-approved
   plans (such as Phase 8.5).
