# QSL Unified Control Console Architecture V1

English | [简体中文](qsl-unified-control-console-architecture-v1.zh-CN.md)

> Status: `DESIGN_AND_SNAPSHOT_CONTRACT_ONLY`
>
> This document establishes `QuantRuntimeSettings`'s Cloudflare Worker site as the single **human control-plane surface** for a personal deployment. It adds no broker connections, credential reads, orders, fund actions, or `P4`–`P6` runtime eligibility.

## Scope and boundaries

An operator visits one site to inspect organization-wide `P0`–`P6` status, daily data/replay health, single-strategy/combo/plugin candidates, AI advisories, and `P6` decisions when required. Each repository still owns its own code, data, `P1` inputs, `P2` configs, and `P3` evidence; the console aggregates verified **minimal state snapshots** and records explicit human decisions without becoming a broker terminal.

```text
Repo drivers / daily jobs ──source snapshot (by source_id)──► QuantRuntimeSettings Worker + KV ──aggregate──► Web UI
                                                                 │
                                                                 ▼
                                                  Single authenticated global decision surface
                                                                 │
              AI read-only advice ◄── audit receipts / intents ─┴─► Explicit owner P6 decision

Broker credentials, orders, and funds ──held solely by future deterministic execution gateway── never touch UI or AI
```

## Current baseline and gaps

`web/strategy-switch-console` provides GitHub OAuth, allowlist authorization, admin configuration, KV auditing, and token-authenticated `strategy_health_dashboard.v1` snapshots. The home page defaults to a human decision desk surfacing pending decisions with research, evidence, and operational details collapsed on demand, and moves legacy strategy switching under Strategy Settings. Because cross-repo catalogs, full `P0`–`P6` lifecycles, `P6` decision receipts, and deterministic execution gateways wire incrementally, existing switch buttons confer no global execution authority.

## Low-risk incremental evolution

### 1. Read-only global overview

Two snapshot layers separate ingestion from presentation: each repo publishes `qsl_control_plane_source_snapshot.v1`, which the Worker aggregates into `qsl_control_plane_dashboard.v1` carrying candidate identity, stage, freshness, `P1`/`P2`/`P3` summaries, machine recommendations, and `P6` owner-decision flags—with zero raw market data, accounts, full orders, file paths, or secrets.

`data_status=ready` indicates snapshot sync only, never strategy validation or order permission. A separate read-only `attention` field reports `attention_required` when any candidate is `DEFERRED`/`PARKED`, sources emit redacted errors, or candidates are absent, `unavailable` on missing snapshots, and `research_only` otherwise—preventing "green workflow = green strategy" confusion.

The Worker ingests snapshots under a dedicated sync identity isolated from dispatch tokens, stores them per `source_id` in KV, and serves aggregated views to authenticated allowlisted users only. Duplicate candidate IDs across sources fail closed with conflict records, and missing, expired (default 36-hour stale threshold for daily trading cadences), future-dated, or schema-invalid snapshots render `unavailable` / `stale`.

Execution evidence uses separate `qsl_execution_evidence_source_snapshot.v1` and `qsl_execution_evidence_dashboard.v1` projections keyed by `strategy revision x platform x execution lane` with their own KV prefix and sync token, never overwriting `P1`–`P3` snapshots or proving cross-platform authority.

### Home screen information architecture

The home page serves as a calm operator desk answering three prioritized questions within one screen: whether fresh trustworthy evidence exists, what automated jobs did, and whether any owner-only decision is waiting.

1. **Global status:** snapshot freshness, total candidates, `DEFERRED` / `PARKED` counts, and pending owner decisions (showing unknown explicitly when absent, never green-washing missing data).
2. **Owner queue:** explicit `P6` decisions only (normally empty; `P1`–`P5` parks/deferrals stay automated).
3. **Candidate lifecycle:** type, domain, `P` stage, machine recommendation, and evidence freshness summaries without raw data or log dumps.
4. **Strategy x platform execution evidence:** per-platform `shadow` / `paper` capability and matched evidence (`PAPER_BROKER` when supported; continuous `shadow` otherwise, surfacing limited canary decision prompts only when strategy, data, and execution evidence all match).
5. **Health & audit:** drill-down view keeping healthy items quiet and highlighting stale/anomalous/actionable entries.
6. **Legacy deployment switch:** retained under Settings for compatibility and clearly labeled as a legacy deployment config tool rather than `P0`–`P6` runtime authority.

Research tasks appear as a drill-down queue under `qsl_research_task_source_snapshot.v1` rather than a trading surface or inside candidate snapshots; until a valid source snapshot arrives, the queue stays empty rather than inferring tasks from GitHub issues. The UI favors a low-noise workbench over card mosaics or fabricated single-point return charts, matching operational dashboard practices ([Grafana dashboard best practices](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/); [Google SRE monitoring](https://sre.google/workbook/monitoring/)).

### Product principles aligned with operational consoles

1. **Actionable items only on home:** progress toward target, severity, impact, freshness, safety state, suggested action, and runbook links; show insufficient evidence rather than green when fields are missing.
2. **Impact-grouped routing:** deduplicate alerts by root cause, separate immediate high-risk alerts from batched reviews and status-page telemetry ([Grafana alerting](https://grafana.com/docs/grafana/latest/alerting/guides/best-practices/)).
3. **Verify diffs before acting:** Settings shows current value, proposed diff, scope, and readiness checks while keeping execution evidence, positions, cash, and runtime status read-only ([QuantConnect live trading](https://www.quantconnect.com/docs/v2/local-platform/live-trading/getting-started)).
4. **Traceable incident timelines without daily noise:** highlight `critical`/`review`, last trusted sample, and linked evidence ([Datadog incident management](https://docs.datadoghq.com/incident_response/incident_management/)).
5. **Catalog-derived identity:** derive identity, versions, ownership, lifecycle, and targets from code/snapshots rather than manual web entry ([Backstage Software Catalog](https://backstage.io/docs/features/software-catalog/)).
6. **Zero direct broker panic buttons in the console:** stop or de-risk intents carry evidence bindings consumed exclusively by an isolated, idempotent, reconcilable execution gateway.

Primary navigation reflects that cadence: **Decisions**, **Strategy Settings**, and **System Status**, adding catalog/notification/audit drill-downs only once backed by real snapshots and auth.

### 2. Decision queue and 3. P6 decision adapter

`P1`–`P3` `DEFERRED`/`PARKED` retries wait for the next valid trading day, `P4`/`P5` show policy-driven automated status without "AI tune now" buttons, and only `P6` candidates with `owner_decision_required` and `owner_live_decision` enter the owner queue to record `qsl_owner_decision_intent.v1` bound to current evidence fingerprints (stale intents invalidate automatically on drift). The narrow `P6` adapter lands only after `P0` roots, deterministic gateways, and `P4`/`P5` receipts are wired.

## Snapshot data ownership

| Data domain | Sole producer | Console role | Excluded |
| --- | --- | --- | --- |
| `P0` control root / policy | `QuantRuntimeSettings` | Display verified summaries | Issuing or renewing policies |
| `P1`/`P3` daily research | `UsEquitySnapshotPipelines` | Display recent evidence and freshness | Reading raw bars or credentials |
| `P2` strategy / candidate | Strategy repos & candidate registry | Display pinned revisions and advice | Editing parameters or swapping candidates |
| `P4`/`P5` receipts | Future lifecycle services | Display state and reason codes | Submitting `paper`/`shadow` runs |
| Strategy x platform evidence | Future platform audit/schedule sources | Display per-target capabilities, evidence, next steps | Cross-platform permission carryover |
| `P6` owner decision | Decision adapter | Display and record auditable intents | Submitting orders directly |

Each combination and plugin `candidate_id` maintains an independent lifecycle without inheriting `P3`–`P6` eligibility from constituent strategies.

## Anti-patterns to avoid and rollout sequence

Avoid replicating repositories, raw data, or secrets into Settings, letting the web Worker call brokers directly, letting AI hot-swap running strategies, or replacing Worker + KV + JSON snapshots with heavy infrastructure. Roll out sequentially: (1) read-only overview schemas/endpoints failing closed when empty; (2) sanitized `P1`/`P3` summaries (marking legacy derived backtests `exploratory` only); (3) pinned candidate identities across single/combo/plugin tracks; (4) `P4`/`P5` automated receipts; (5) `P6` owner intent adapter.

## Compatibility and security

`strategy_health_dashboard.v1` stays intact alongside `qsl_control_plane_dashboard.v1`. Worker sync tokens must remain strictly separated from OAuth, workflow dispatch tokens, policy roots, and future broker credentials, with KV holding redacted snapshots and minimal audit indexes only.
