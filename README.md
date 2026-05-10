# QuantRuntimeSettings

Declarative runtime settings tooling for QuantStrategyLab deployments.

This repository provides the schema and tooling for "which platform runs which strategy". It does not contain live runtime assignments, strategy logic, broker execution code, credentials, or secrets.

## Public Repository Policy

Live target files must not be committed to this public repository. Keep real deployment choices in GitHub Variables/Environments, GitHub Secrets, Secret Manager, or ignored local files under `local/`.

Use repository or environment variables for non-secret runtime choices such as `RUNTIME_TARGET_JSON` and plugin mount declarations. Use secrets only for credentials, tokens, and private keys.

If a deployment needs private validation policy, keep it in ignored local files such as `local/policy.json`.

## Boundaries

- `UsEquityStrategies` owns allocation logic, strategy defaults, and risk rules.
- Platform repositories own broker adapters, runtime input collection, notifications, and execution.
- This repository owns runtime target schemas, examples, validation, and rendering tools.
- Secret values are intentionally excluded. Use secret names or platform repository secrets when needed.

## Commands

Validate examples, or local targets when `local/targets/**/*.json` exists:

```bash
python3 scripts/runtime_settings.py validate
```

Render assignments for an example:

```bash
python3 scripts/runtime_settings.py render examples/targets/schwab/live.example.json
```

Preview GitHub variable updates for an ignored local target:

```bash
python3 scripts/runtime_settings.py apply local/targets/longbridge/sg.json
```

Apply GitHub variable updates:

```bash
python3 scripts/runtime_settings.py apply --yes local/targets/longbridge/sg.json
```

`RUNTIME_TARGET_JSON` is canonical. Compatibility variables such as `STRATEGY_PROFILE` are generated from it so they cannot drift independently.

## Architecture

This repo acts as a small bridge between strategy selection and platform deployment without exposing live assignments:

- A target file declares the desired runtime target.
- The validator checks that required runtime fields and plugin mounts are coherent.
- Optional ignored local policy can add private strategy/plugin requirements.
- The renderer converts the declaration into platform-specific GitHub variables.
- Platform repositories keep their existing adapter code and consume the generated variables.
