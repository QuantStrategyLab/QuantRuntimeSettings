# QSL Lifecycle Truth V1

English | [简体中文](qsl-lifecycle-truth-v1.zh-CN.md)

Strategy catalogs, cross-asset inventories, and evidence packages describe a strategy's lifecycle stage only; they never confer `paper` or `live` authority. Canonical states are defined by `QuantPlatformKit`:

```text
research_active -> shadow_active -> paper_active (when platform supports it)
                -> live_candidate -> live_enabled
```

Legacy states map conservatively under read-only catalog semantics:

| Legacy state | Canonical state |
| --- | --- |
| `research_backtest_only` | `research_active` |
| `ai_monitored_candidate` | `research_active` |
| `shadow_candidate` | `shadow_active` |
| `runtime_enabled` | `live_candidate` |

`runtime_enabled` is a legacy "selectable at runtime" flag and does not by itself attest live order approval. Existing live strategies may continue operating, but `QuantRuntimeSettings` accepts `live` requests only when all deployment fields explicitly hold:

```text
runtime_enabled == true
can_switch_live == true
lifecycle_stage in {live_enabled, runtime_enabled}
allowed_execution_modes contains live
blocked_live_reason is empty
```

The `runtime_enabled` lifecycle label exists solely for legacy deployment compatibility; new deployments must write `live_enabled` and still pass the Risk Gate, broker/account permissions, and deployment authorization checks. Any missing field fails closed. Web UIs, Workers, config generators, and backend validators must never infer `live` authority from catalog names, defaults, or inventory states.

## Console read precedence and stale-data protection

`web/strategy-switch-console/runtime-catalog-projection.json` is generated from `platform-config.json` with a source content SHA-256. It shows catalog gating only (`data_status=catalog_only`) and does not observe Cloud Run, Gateways, accounts, orders, funds, or P4–P6 receipts, so it cannot establish running or promotable status.

The console must read independent sources by purpose:

1. Candidate P1–P3 lifecycle and freshness: `GET /api/control-plane`.
2. Exact `strategy x platform x lane` execution evidence: `GET /api/execution-evidence`.
3. Configuration catalog gates: authenticated `GET /api/runtime-catalog`.

`web/strategy-switch-console/lifecycle-matrix.json` is retained solely as a dated 2026-08-23 reference marked `historical_reference_only`. Neither UIs, automation, nor human reviews may treat it as current runtime, promotion, or order evidence; missing fresh snapshots must render `unavailable` / `stale` rather than falling back to the historical matrix.

## Monitoring vs. execution-evidence boundaries

Source records for `/api/runtime-target-lifecycle` fix `no_order=true`. They answer whether a target is configured enabled and whether runtime guards and execution heartbeats are reachable—without reading accounts, orders, fills, positions, or funds. The console labels each record as `not_due`, `monitoring_only`, `not_applicable`, `attention`, or `unavailable`, with fixed `order_or_fill_evidence=not_collected`.

`monitoring_only` means guards and heartbeats passed and must **never** be interpreted as submitted, accepted, or filled orders; `not_due` means the scheduled trading window has not arrived. Any future fill reporting in the console must come from a separate minimal verifiable execution-receipt source rather than promoting lifecycle snapshots or GitHub workflow successes into fill evidence.

## One-time migration rules

- `platform-config.json`, console fallbacks, and generated profile assets store canonical states only.
- The Worker may read legacy states at ingestion once, converting them to canonical states before writing to KV.
- Legacy `runtime_enabled` converts to `live_enabled` only when paired with explicit legacy deployment live fields; otherwise it converts to `live_candidate`.
- The Python backend keeps read-only compatibility for legacy live stages solely for unmigrated runtime rollbacks; config generators no longer emit legacy values.
- Authoritative `platform-config.json` in `QuantRuntimeSettings` holds no legacy `runtime_enabled` live entries, and two stale console fallback live flags were aligned fail-closed to `research_active`. Once all broker runtimes consume canonical fields and verify rollback, the final read-only `runtime_enabled` compatibility layer can be removed.
