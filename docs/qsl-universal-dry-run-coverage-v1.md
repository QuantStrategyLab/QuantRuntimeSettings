# QSL Universal Dry-Run Coverage V1

English | [简体中文](qsl-universal-dry-run-coverage-v1.zh-CN.md)

> Status: integrated into `QuantRuntimeSettings` config validation, health reporting, and the Strategy Switch Console.

## Problem addressed

Strategy profiles could declare `allowed_execution_modes: ["dry_run"]`, yet the manual switcher materialized requests as `execution_mode=paper` with `dry_run_only=true`. While most legacy platforms still placed no orders, control-plane policy validation rejected those requests as "strategy does not allow paper", blocking valid no-order dry-run routes.

This contract separates three distinct modes:

| Mode | Current meaning | Places orders? |
| --- | --- | --- |
| `dry_run` | Mandatory safe simulation route required on every registered strategy and platform | No |
| Legacy `paper + dry_run_only=true` | Compatibility representation for existing runtime targets; evaluated as `dry_run` by policy | No |
| `P4` `PAPER_BROKER` | Future capability requiring isolated paper accounts, credentials, order adapter, reconciliation, and signed policy | Only once wired independently |

Console `dry_run` selection is neither `P4` nor a live switch and grants no broker, order, fund, `P4`–`P6`, or promotion authority.

## Universal contract

Every platform deployment in `platform-config.json` must declare supported control-plane modes (omitting `paper` while `P4` is unwired):

```json
{
  "default_execution_mode": "live",
  "supported_execution_modes": ["live", "dry_run"]
}
```

Platforms without live configuration must declare:

```json
{
  "default_execution_mode": "dry_run",
  "supported_execution_modes": ["dry_run"],
  "dry_run_only": true
}
```

Every strategy's `allowed_execution_modes` must include `dry_run`. The health report checks strategy/platform domain intersection at two levels:

| Level | Meaning | Current count |
| --- | --- | --- |
| Declared routes | Strategy domain, strategy permission, and platform `dry_run` permission align | 59 routes |
| Default buildable routes | Generates a policy-valid no-order target without manual runtime artifact overrides | 59 routes |

When a strategy requires `runtime_artifacts.feature_snapshot.required=true`, a default buildable route must configure paired `gs://<bucket>/...` snapshot and manifest URIs. Missing artifacts mark the strategy **PARKED**, fail `strategy_platform_dry_run_coverage` critically, and keep execution off rather than guessing URIs.

Currently `global_etf_rotation`, `russell_top50_leader_rotation` (published by [UsEquitySnapshotPipelines](https://github.com/QuantStrategyLab/UsEquitySnapshotPipelines)), and `hk_low_vol_dividend_quality_snapshot` (published by [HkEquitySnapshotPipelines](https://github.com/QuantStrategyLab/HkEquitySnapshotPipelines)) enforce this requirement; automated health repairs only inspect, park, notify, and re-verify without fabricating artifacts or advancing lifecycles.

### Read-only artifact evidence gate

`Runtime Artifact Evidence Gate` generates the full required-artifact manifest from `platform-config.json` and verifies with a read-only identity that objects are readable, manifest strategy identity and SHA-256 match the snapshot, and `snapshot_as_of` stays within freshness budgets (5 calendar days for daily global ETFs covering weekends plus one holiday; 40 calendar days for monthly Russell and HK snapshots). It emits receipts and alerts only without publishing data, editing URIs, modifying targets, or submitting orders.

## Plugin boundary

Plugin mounts accept `expected_mode` in `dry_run`, `paper`, or `shadow` only—rejecting `live` mount requests—without auto-mounting plugins. Legacy `custom` mounts stay disabled until bound through recomputable `P1`/`P2`/`P3` `strategy_plugin_signal.v2` adapters.

## Operations and verification

Selecting `dry_run` in the console or `Manual Strategy Switch` writes `dry_run_only=true` (emitting `execution_mode=paper` + `dry_run_only=true` for existing platform sync compatibility, validated strictly as `dry_run`). Legacy `paper` workflow inputs remain bound by existing strategy `paper` gates and never constitute `P4` paper trading.

Run these checks around any strategy, platform, or plugin config edit:

```bash
python3 python/scripts/build_config.py --check
python3 python/scripts/runtime_settings.py validate
python3 python/scripts/build_config.py --platform-health-report
python3 python/scripts/build_config.py --runtime-artifact-evidence-registry > /tmp/runtime-artifact-registry.json
python3 python/scripts/verify_runtime_artifact_evidence.py --registry /tmp/runtime-artifact-registry.json
node tests/strategy_switch_worker_validation.mjs
```

`declared_dry_run_route_count`, `buildable_dry_run_route_count`, and `artifact_blocked_strategy_count` expose coverage gaps continuously (`recommended_action=supply_verified_runtime_artifact`), and `Platform Health Monitor` labels only config/code-fixable issues `codex-repair-ready` while labeling missing upstream artifacts `external-evidence-required`.
