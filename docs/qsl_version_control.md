# QSL version control plane

QuantRuntimeSettings is the control plane for QuantStrategyLab internal version
management.

## Source of truth

- `compat/bundles/*.toml` is the source of truth for internal repository commit pins.
- Each consumer repository declares its bundle in `qsl.toml`.
- Consumer files (`pyproject.toml`, `uv.lock`, `requirements.txt`, `constraints.txt`) must match the declared bundle.
- `internal_dependency_matrix.json` is generated from local consumer dependency files; do not hand-edit it except for emergency repair.

## CLI

Use `qslctl` for repository and workspace checks:

```bash
python3 python/scripts/qslctl.py check --repo-root ../UsEquityStrategies
python3 python/scripts/qslctl.py check-all --projects-root /Users/lisiyi/Projects
python3 python/scripts/qslctl.py report --projects-root /Users/lisiyi/Projects
python3 python/scripts/qslctl.py plan --projects-root /Users/lisiyi/Projects
python3 python/scripts/qslctl.py generate-matrix --projects-root /Users/lisiyi/Projects --check
python3 python/scripts/qslctl.py generate-matrix --projects-root /Users/lisiyi/Projects --sync
```

## Rollout policy

1. Create or update a bundle in `compat/bundles/`.
2. Apply that bundle by ring: core → strategy libraries → pipelines/research → runtime platforms → ops/tooling.
3. Regenerate `internal_dependency_matrix.json` after consumer pins are updated.
4. Keep strict checks enabled only after a ring is converged.

## Workspace report / plan

- `qslctl report` is read-only. It groups the current workspace by ring, status, and bundle hotspot.
- `qslctl plan` is read-only. It renders the ring-by-ring convergence order and highlights which repos should be fixed before the next ring starts.
- Use `report` to answer “what is broken right now?” and `plan` to answer “what should we fix first?”
