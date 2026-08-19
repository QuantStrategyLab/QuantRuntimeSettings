# QuantRuntimeSettings


## QSL architecture role

- **Layer**: `ops/tooling`.
- **Responsibility**: central runtime settings and compatibility control plane.
- **Owns**: platform-config.json, compat bundles, dependency matrix, switch tooling.
- **Consumes**: all runtime platforms and internal dependency consumers.
- **Must not**: submit broker orders or replace strategy evidence gates.

[Chinese README](README.zh-CN.md)

> Investing involves risk. This project does not provide investment advice and is for education, research, and engineering review only.

## What this repository is

QuantRuntimeSettings is a QuantStrategyLab runtime settings package. It defines schemas and tooling for versioned runtime settings shared across QuantStrategyLab platforms.

It supports the system but does not decide which strategy should be live. Strategy eligibility remains in the strategy and snapshot repositories; broker execution remains in the platform repositories.

## Design boundary

- Keep contracts stable and versioned where downstream repositories depend on them.
- Prefer backward-compatible changes unless a coordinated migration is planned.
- Keep secrets and environment-specific settings outside the shared library code.
- Document changes that affect multiple platforms or strategy packages.

## P0–P6 runtime-authority status

`platform-config.json.meta.runtime_authority` is the machine-readable status for the P0–P6 control plane. Its current `P0_CONTROL_PLANE_NOT_RUNTIME_WIRED` status means that this repository has no active preauthorized autonomy policy and no runtime-wired P0 execution gateway.

`default_execution_mode`, `live_configured`, strategy lifecycle labels, this repository's switch workflow, and a green CI result are configuration or historical metadata—not authorization for runtime, orders, funds, or a stage change. P1–P3 non-live data acquisition needs its own precise contract; P0 does not grant it by implication. P4–P6 remain undefined. See [the architecture boundary](docs/ARCHITECTURE.md#p0p6-runtime-authority-boundary).

AI and monitoring systems can create only an immutable, no-order `qsl.research_task.v1` request for offline research.  The request binds evidence digests and a bounded experiment, but it does not activate a candidate or grant P4–P6 authority.  See the [research task contract](docs/qsl_research_task_v1.zh-CN.md).

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
- `compat/bundles/2026.07.3.toml`: current compatibility bundle baseline (CalVer).
- `compat/repo-tiers.toml`: repo tier and upgrade ring policy notes.
- [QSL compatibility docs](docs/qsl_compat_upgrade.md)

## Quick start

```bash
python3 python/scripts/runtime_settings.py validate
python3 -m unittest discover -s python/tests -v
```

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
plugin_mode=auto
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
- The workflow is bound to the `runtime-strategy-switch` GitHub Environment. For a personal system, required reviewers are optional; prefer storing `RUNTIME_SETTINGS_GH_TOKEN` as an Environment secret and rely on preview, confirmation text, and a least-privilege token for day-to-day safety.
- Follow the simplified permission-control plan before enabling real switches: [docs/manual_strategy_switch_permission_control.zh-CN.md](docs/manual_strategy_switch_permission_control.zh-CN.md).

## Useful docs

- [Internal dependency pin policy](docs/internal_dependency_pin_policy.md)
- [Fork guide for the strategy switch console](docs/strategy_switch_fork_guide.md)
- [Strategy switch console Worker](web/strategy-switch-console/README.md)
- [Strategy switch admin backend](docs/strategy_switch_admin_backend.md)
- [Manual strategy switch permission-control plan](docs/manual_strategy_switch_permission_control.zh-CN.md)

## Community and security

- See [CONTRIBUTING.md](CONTRIBUTING.md) for pull request scope, local verification, and documentation expectations.
- Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for maintainer and contributor conduct.
- Report credential, automation, broker, exchange, or cloud-resource vulnerabilities through [SECURITY.md](SECURITY.md); do not open public issues for secrets or live-execution risk.

## License

See [LICENSE](LICENSE).
