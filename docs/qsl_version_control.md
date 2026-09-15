# QSL version control plane

QuantRuntimeSettings is the control plane for QuantStrategyLab internal version
management.

## Source of truth

- `compat/bundles/*.toml` is the source of truth for internal repository commit pins.
- Each consumer repository declares its bundle in `qsl.toml`.
- Consumer installation files (`pyproject.toml`, `uv.lock`, and actual legacy requirements) must match the declared bundle. A `live_constraint_files` entry such as `constraints.txt` is treated as pin metadata only when it is an exact source/full-SHA mirror of the same repository's `qsl-pins.txt`; malformed or mismatched mirrors fail validation.
- `internal_dependency_matrix.json` is generated from local consumer dependency files; do not hand-edit it except for emergency repair.

## CLI

Use `qslctl` for repository and workspace checks:

```bash
python3 python/scripts/qslctl.py check --repo-root ../UsEquityStrategies
python3 python/scripts/qslctl.py check-all --projects-root /Users/lisiyi/Projects
python3 python/scripts/qslctl.py report --projects-root /Users/lisiyi/Projects
python3 python/scripts/qslctl.py plan --projects-root /Users/lisiyi/Projects
python3 python/scripts/qslctl.py report --projects-root /Users/lisiyi/Projects --scope current
python3 python/scripts/qslctl.py plan --projects-root /Users/lisiyi/Projects --scope current
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
- Both commands default to `--scope frozen`, preserving exact bundle ref checks. `--scope current` checks each consumer's `qsl.requires` against its manifests, locks, and actual legacy dependencies; a `live_constraint_files` mirror is checked against `qsl-pins.txt` for metadata integrity without becoming an install dependency. `CONSISTENT` then means current declaration consistency only. Different valid full SHAs across consumers do not alone require `HUMAN_REQUIRED`, while actual issues, missing repositories, and invalid configuration still do.
- Use `report` to answer “what is broken right now?” and `plan` to answer “what should we fix first?”

## QSL exception lifecycle check

Use the repository workflow `.github/workflows/qsl_exception_lifecycle.yml` to run a scheduled or manual report.

The workflow first reads the current bundle from `qsl.toml`, prepares a temporary workspace, links the current `QuantRuntimeSettings` checkout, clones the existing bundle repository set, and runs `qslctl report` against that prepared workspace. Scheduled runs and manual runs default to `current`, checking each cloned repository at its resolved `origin/main` SHA. Manual runs can select `frozen` to check the exact bundle SHAs.

It checks each prepared QuantStrategyLab repo for:

- `enforce_bundle = false` exception metadata completeness
  - `owner`
  - `expires_at`
  - `next_action`
- expired `expires_at`
- any strict QSL issues or warning-level QSL issues

It does **not** scan the GitHub Actions checkout directory as a proxy for the full org workspace. If you need a broader multi-repo scan, prepare a local workspace or use external orchestration to clone the repositories first.

Run locally with:

```bash
python3 python/scripts/qslctl.py report --projects-root /path/to/prepared-workspace --compat-root . --json
```

The workflow writes the report to the GitHub Actions step summary and fails the job when any strict or warning repository is found. Public repositories can be cloned with the default GitHub token. If a repository becomes private, configure `RUNTIME_SETTINGS_GH_TOKEN` with read access; otherwise the clone step will fail instead of silently skipping it.
