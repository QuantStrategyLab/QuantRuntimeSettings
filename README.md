# QuantRuntimeSettings

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

## Repository layout

- `tests/`: unit, contract, and regression tests.
- `.github/workflows/`: CI, scheduled jobs, release, or deployment workflows.
- `scripts/`: operator scripts and local helpers.

## Quick start

```bash
python3 scripts/runtime_settings.py validate
python3 -m unittest discover -s tests -v
```

## Manual Strategy Switch

`.github/workflows/manual-strategy-switch.yml` provides a central manual switch entrypoint. It builds a transient runtime target from workflow inputs, validates it with `scripts/runtime_settings.py`, and writes GitHub variables into the target platform repository. It currently supports `longbridge`, `ibkr`, `schwab`, and `firstrade`.

Recommended flow:

1. Run once with `apply=false` to preview the assignments.
2. Check `repository`, `environment`, `strategy_profile`, `service_name`, `execution_mode`, and plugin mounts.
3. Re-run with `apply=true` and `confirm_apply=APPLY` to write variables.
4. Set `trigger_platform_sync=true` and `confirm_apply=APPLY_AND_SYNC` when the target platform should dispatch its Cloud Run env sync workflow.

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
- LongBridge defaults to environment-scoped variables; `target_name=sg` resolves to `longbridge-sg`.
- Schwab defaults to repository-scoped variables.
- Firstrade defaults to repository-scoped variables; `target_name=live` uses `firstrade-quant-service` and `account_scope=US`.
- IBKR patches the selected service/account-scope entry inside `CLOUD_RUN_SERVICE_TARGETS_JSON` when that variable exists, so other IBKR services are preserved.
- Cross-repository variable writes and workflow dispatches require a `RUNTIME_SETTINGS_GH_TOKEN` secret in this repository with sufficient target-repository variable/workflow permissions. The workflow does not fall back to the default `github.token` for remote writes.
- IBKR `service_targets_mode=auto` must read and patch the target repository's `CLOUD_RUN_SERVICE_TARGETS_JSON`, so even preview mode requires `RUNTIME_SETTINGS_GH_TOKEN` for IBKR.
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
