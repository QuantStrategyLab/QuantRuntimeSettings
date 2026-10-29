# QuantRuntimeSettings

[Documentation index](docs/README.md) — architecture scope, dated design overview and console tasks.

[Chinese README](README.zh-CN.md)

> Investing involves risk. This project does not provide investment advice and is for education, research, and engineering review only.

## What this repository is

QuantRuntimeSettings is a QuantStrategyLab runtime settings package. It defines schemas and tooling for versioned runtime settings shared across QuantStrategyLab platforms.

It supports the system but does not decide which strategy should be live. Strategy eligibility remains in the strategy and snapshot repositories; broker execution remains in the platform repositories.

## Configuration

Set these non-secret repository variables before running the affected workflows. Export the same names for standalone scripts. Promotion root records and externally pinned root digests remain authoritative.

| Variable | Purpose | Required | Default |
|---|---|---|---|
| `MARKET_BENCHMARK_SYNC_URL` | Complete benchmark sync endpoint | Benchmark sync | none |
| `STRATEGY_SWITCH_CONSOLE_URL` | HTTPS console origin | Review credential check and Firstrade preparation | none |
| `DIGEST_GCP_PROJECT_ID` | Digest cloud project | Digest workflow | none |
| `DIGEST_GCP_WORKLOAD_IDENTITY_SERVICE_ACCOUNT` | Digest cloud identity | Digest workflow | none |
| `DIGEST_CANDIDATES_READER_SERVICE_ACCOUNT` | Candidate store reader identity | Optional | `DIGEST_GCP_WORKLOAD_IDENTITY_SERVICE_ACCOUNT` |
| `DIGEST_CANDIDATES_GCS_URI` | Candidate store prefix | Store preflight; optional otherwise | empty |
| `QSL_PROMOTION_ROOT_PROJECTS_JSON` | JSON object mapping platform IDs to their existing trust-root project IDs | Strategy switch and signature verification | none |


### US equity session configuration

`platform-config.json.domains.us_equity` defines configurable trading sessions. All times use `market_timezone` (`America/New_York`), including daylight saving time changes.

| Key | Purpose | Default |
|---|---|---|
| `trade_date_boundary` | Local time used to separate trading dates | `20:00` |
| `maintenance_pause` | Start and end of the daily maintenance pause | `["20:00", "21:00"]` |
| `sessions` | Each session's `start`, `end`, and boolean `enabled` flag | `overnight` 21:00–04:00, `pre` 04:00–09:30, `regular` 09:30–16:00, `post` 16:00–20:00 |

Only `regular.enabled` defaults to `true`; all extended sessions default to `false`. An end time earlier than its start crosses midnight. These keys prepare configuration for US equity 23x5; this change does not connect platform consumers or change existing trading or scheduling behavior. `scheduling.profiles` remains unchanged.

## QSL architecture role

- **Layer**: `ops/tooling`.
- **Responsibility**: central runtime settings and compatibility control plane.
- **Owns**: platform-config.json, compat bundles, dependency matrix, switch tooling.
- **Consumes**: all runtime platforms and internal dependency consumers.
- **Must not**: submit broker orders or replace strategy evidence gates.

## Design boundary

- Keep contracts stable and versioned where downstream repositories depend on them.
- Prefer backward-compatible changes unless a coordinated migration is planned.
- Keep secrets and environment-specific settings outside the shared library code.
- Document changes that affect multiple platforms or strategy packages.

## P0–P6 runtime-authority status

`platform-config.json.meta.runtime_authority` is the machine-readable status for the P0–P6 control plane. Its current `P0_CONTROL_PLANE_NOT_RUNTIME_WIRED` status means that this repository has no active preauthorized autonomy policy and no runtime-wired P0 execution gateway.

`default_execution_mode`, `live_configured`, strategy lifecycle labels, this repository's switch workflow, and a green CI result are configuration or historical metadata—not authorization for runtime, orders, funds, or a stage change. P1–P3 non-live data acquisition needs its own precise contract; P0 does not grant it by implication. P4–P6 remain undefined. See [the architecture boundary](docs/ARCHITECTURE.md#p0p6-runtime-authority-boundary).

AI and monitoring systems can create only an immutable, no-order `qsl.research_task.v1` request for offline research.  The request binds evidence digests and a bounded experiment, but it does not activate a candidate or grant P4–P6 authority.  See the [research task contract](docs/qsl-research-task-v1.zh-CN.md).

## Current account asset totals

The account-facts read model deduplicates IBKR, Schwab and Firstrade snapshots using broker-native identity already checked against the protected binding. Native identities stay in Worker memory. Each public account row exposes only `aggregation_status` (`included`, `duplicate`, `conflict`, or `unverified`). The latest verified observation contributes once; conflicting amounts at the same observation time or conflicting live/paper classifications contribute nothing. Older snapshots cannot block a newer valid observation. LongBridge channel identity remains insufficient for physical deduplication.

`totals.status=by_currency` requires every non-paper account to have fresh, bound data, verified physical identity and complete net assets. Currencies are never converted implicitly. `cash_balance` and `available_cash` remain separate nullable totals; missing cash does not invalidate known assets or become zero. The dashboard uses complete totals only for the same current configuration and unexpired snapshot; otherwise it retains the explicitly partial available-asset sum. These projections do not authorize trading or establish investment returns.

## Repository layout

- `python/`: Python tooling (scripts, tests, pyproject.toml) — validation, code generation, deployment scripts.
- `web/`: JavaScript web app (Cloudflare Workers strategy switch console).
- `compat/`: QSL compatibility manifests (bundle matrix and repo tier rules).
- `schemas/`: JSON Schema files shared by both Python and JS.
- `tests/`: JavaScript unit/integration tests.
- `.github/workflows/`: CI, scheduled jobs, release, or deployment workflows.
- `docs/ARCHITECTURE.md`: Detailed architecture documentation.

## QSL compatibility manifest (phase 1)

This repository is the central manifest source for QSL compatibility checks.

- `qsl.toml`: current repo QSL metadata (`tier`, `upgrade_ring`, `bundle`).
- `scripts/check_qsl_compat.py`: validate a repo's QSL compliance in `pyproject.toml`/`uv.lock` against central bundle.
- `python/scripts/qslctl.py`: unified QSL version-control CLI for repo checks, workspace checks, ring reports/plans, and matrix generation.
- `scripts/render_qsl_dependency_graph.py`: render dependency graph for review.
- `compat/bundles/2026.08.0.toml`: current compatibility bundle baseline (CalVer).
- `compat/repo-tiers.toml`: repo tier and upgrade ring policy notes.
- [QSL compatibility docs](docs/qsl-compat-upgrade.md)

## Quick start

```bash
python3 python/scripts/runtime_settings.py validate
python3 -m unittest discover -s python/tests -v
```

## Account domain validation

Runtime targets may include an optional `account_domain` identity and policy. Its platform must match the target, policy timestamps must be UTC, and non-dry-run execution mode must match the capital kind. Existing targets without a domain remain valid. `python3 python/scripts/qslctl.py validate-account-domain PATH` validates a standalone domain offline; structural validation does not establish account identity, policy freshness, or trading authority. Consumers must adopt a compatible QuantPlatformKit revision before relying on this field.

## Manual Strategy Switch

`.github/workflows/manual-strategy-switch.yml` provides a central manual switch entrypoint. It builds a transient runtime target from workflow inputs, validates it with `python/scripts/runtime_settings.py`, and writes GitHub variables into the target platform repository. It supports `longbridge`, `ibkr`, `schwab`, `firstrade`, `qmt`, and `binance`.

This is a legacy settings-change path. It does not create or broaden P0–P6 runtime authority, and it must not be used to infer permission while the status above is not runtime-wired.

Recommended flow:

1. Run once with `apply=false` to preview the assignments.
2. Check `repository`, `environment`, `strategy_profile`, `service_name`, `execution_mode`, and plugin mounts.
3. Re-run with `apply=true` and `confirm_apply=APPLY` to write variables.
4. For a Cloud Run platform, set `trigger_platform_sync=true` and `confirm_apply=APPLY_AND_SYNC` to dispatch its environment sync workflow.

Example:

```text
platform=longbridge
target_name=sg
strategy_profile=tqqq_growth_income
execution_mode=live
plugin_mode=none
apply=true
trigger_platform_sync=true
confirm_apply=APPLY_AND_SYNC
```

Notes:

- This is a GitHub Actions `workflow_dispatch` form, not a public web app. The default `apply=false` mode only previews assignments and writes nothing remotely.
- LongBridge defaults to environment-scoped variables; `target_name=sg` resolves to `longbridge-sg`. When a repository-level multi-service target list exists, the same switch also updates its exact service entry.
- Multi-service targets use `service_name` as their primary identity. Multiple services may share one `account_scope`; a switch never selects a sibling service by account scope.
- `CLOUD_RUN_SERVICE_TARGETS_JSON` supports both a bare array and an object with `targets`. New services require the explicit `allow_create` mode.
- Schwab defaults to repository-scoped variables.
- Firstrade defaults to repository-scoped variables; `target_name=live` uses `firstrade-quant-service` and `account_scope=US`.
- IBKR `service_targets_mode=auto` patches the exact existing service entry inside `CLOUD_RUN_SERVICE_TARGETS_JSON`; account scope is only a fallback for a legacy entry with no service identity. Other services are preserved and an unknown target fails closed. Use `allow_create` only when intentionally provisioning a new target.
- Cross-repository variable writes and workflow dispatches require a `RUNTIME_SETTINGS_GH_TOKEN` secret in this repository with sufficient target-repository variable/workflow permissions. The workflow does not fall back to the default `github.token` for remote writes.
- LongBridge, IBKR, Schwab, and Firstrade `service_targets_mode=auto` checks the target repository's multi-service inventory, so even preview mode requires `RUNTIME_SETTINGS_GH_TOKEN`.
- Binance runs through an Oracle Cloud VPS self-hosted runner. Repository variable writes are consumed by the next externally scheduled `main.yml` dispatch; the central switch does not dispatch that runtime workflow because it may execute live trading. A strategy cadence change also requires a separate review of the external VPS scheduler.
- QMT remains dry-run only and has no live deployment configuration. Its generated target can stage repository variables, but `trigger_platform_sync=true` is rejected.
- Every strategy must retain a domain-matched, no-order `dry_run` route. The health report separately proves declared and default-buildable routes, parking profiles with missing required runtime artifacts instead of fabricating inputs; this is not P4 paper trading. See [Universal Dry-run Coverage V1](docs/qsl-universal-dry-run-coverage-v1.zh-CN.md).
- `plugin_mode=none` is the safe default. `auto` remains only as a compatibility alias for `none`; strategy names must not auto-mount a `latest_signal.json` artifact. Legacy `custom` mounts are disabled and cannot bypass P1/P2/P3 binding through the manual form. A future runtime plugin must be referenced by the frozen P2 candidate and recomputable in P3; see the [Strategy Plugin Contract V2](docs/qsl-strategy-plugin-contract-v2.zh-CN.md).
- The workflow is bound to the `runtime-strategy-switch` GitHub Environment. For a personal system, required reviewers are optional; prefer storing `RUNTIME_SETTINGS_GH_TOKEN` as an Environment secret and rely on preview, confirmation text, and a least-privilege token for day-to-day safety.
- Follow the simplified permission-control plan before enabling real switches: [docs/manual-strategy-switch-permission-control.zh-CN.md](docs/manual-strategy-switch-permission-control.zh-CN.md).

## Useful docs

- [Internal dependency pin policy](docs/internal-dependency-pin-policy.md)
- [Fork guide for the strategy switch console](docs/strategy-switch-fork-guide.md)
- [Strategy switch console Worker](web/strategy-switch-console/README.md)
- [Strategy switch admin backend](docs/strategy-switch-admin-backend.md)
- [Manual strategy switch permission-control plan](docs/manual-strategy-switch-permission-control.zh-CN.md)

## Community and security

- See [CONTRIBUTING.md](CONTRIBUTING.md) for pull request scope, local verification, and documentation expectations.
- Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for maintainer and contributor conduct.
- Report credential, automation, broker, exchange, or cloud-resource vulnerabilities through [SECURITY.md](SECURITY.md); do not open public issues for secrets or live-execution risk.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). AI assistants and maintainers follow [AGENTS.md](AGENTS.md).

## License

See [LICENSE](LICENSE).

显示与通知名称配置：[说明](docs/display-names.md)。
