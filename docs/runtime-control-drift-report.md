# Runtime-control drift report

`python/scripts/runtime_control_drift_report.py` is a read-only tool that shows where the
same runtime control is defined more than once or disagrees across GitHub scopes.

```bash
# Collect variables and secret *names* (read-only gh API calls; secret values are never read).
python3 python/scripts/runtime_control_drift_report.py collect \
  --repo QuantStrategyLab/LongBridgePlatform --repo QuantStrategyLab/CharlesSchwabPlatform > inventory.json
# Report offline. Optional platform manifests add strategy-profile checks.
python3 python/scripts/runtime_control_drift_report.py report inventory.json \
  --manifest QuantStrategyLab/LongBridgePlatform=../LongBridgePlatform/config/runtime_targets.manifest.json
```

Keep `inventory.json` private: it contains variable values. The report itself prints names,
booleans, ratios and strategy profiles only.

Effective view per target: environment variable > repository variable, then per-service `env`
inside `CLOUD_RUN_SERVICE_TARGETS_JSON`. Only environments that declare a target
(`RUNTIME_TARGET_JSON`, `CLOUD_RUN_SERVICE_TARGETS_JSON` or `RUNTIME_TARGET_ENABLED`) count as targets.

| Rule | Severity | Meaning |
|---|---|---|
| `var_secret_collision` | high for target JSON / safety flags, else medium | Same name is a variable and a secret; workflows pick different ones |
| `repo_fallback_only` | medium | Repository value shadowed by every environment; only env-less jobs see it |
| `safety_flag_not_strict_bool` | high | Dry-run / cash-only / enabled flag is not exactly `true`/`false` |
| `dry_run_disagreement` | high | `RUNTIME_TARGET_JSON.dry_run_only` disagrees with the broker dry-run flag |
| `cash_only_alias_disagreement` | medium | Broker cash-only flag overrides `CASH_ONLY_EXECUTION` with a different value |
| `strategy_profile_mismatch` | medium | Target JSON, `STRATEGY_PROFILE` and manifest disagree |
| `risk_limits_missing` / `risk_limits_drift` | high | Profile has a reviewed policy in `examples/risk_policies` but the target lacks or differs from it |
| `reserved_cash_drift` / `cash_only_drift` | high | Broker reserve / cash-only flag differs from the reviewed policy |

Rules are independent functions (`SCOPE_RULES`, `TARGET_RULES`); add a rule by appending a function.
Broker variable names live in `PLATFORM_FLAG_NAMES`.
