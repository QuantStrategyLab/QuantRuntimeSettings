# QSL Org Architecture & Health Checks

This document defines the organization-level governance model used by QuantRuntimeSettings for QuantStrategyLab repositories.

## Repository layers

The workspace is split into three operational layers:

1. **Control plane**
   - `QuantRuntimeSettings`
   - Owns compatibility bundles, tier/ring policy, validation tooling, and org-level reports.
2. **Consumer repositories**
   - Strategy libraries, platform repos, pipelines, runtime repos, and ops/tooling repos.
   - Consume bundle pins and repo-tier policy from the control plane.
3. **Derived outputs**
   - `internal_dependency_matrix.json`
   - `qslctl report` / `qslctl plan` outputs
   - Generated dependency graphs and validation summaries

## Source of truth

- `compat/bundles/*.toml`
  - Canonical bundle pin set for internal repositories.
- `compat/repo-tiers.toml`
  - Canonical repo tier and upgrade-ring policy.
- `qsl.toml` in each consumer repository
  - Declares the repo’s selected bundle, tier, and upgrade ring.
- Consumer dependency manifests
  - `pyproject.toml`, `uv.lock`, `requirements.txt`, `constraints.txt`
  - Must match the declared bundle pins.
- `internal_dependency_matrix.json`
  - Derived drift snapshot; regenerate from consumer manifests instead of hand-editing.

## Contract and compatibility checks

Use the compatibility checker as the repo-level contract gate:

```bash
python3 python/scripts/qslctl.py check --repo-root /path/to/repo
```

Use the org/workspace checks for a prepared workspace that contains cloned QuantStrategyLab repos:

```bash
python3 python/scripts/qslctl.py check-all --projects-root /Users/lisiyi/Projects --strict
python3 python/scripts/qslctl.py report --projects-root /Users/lisiyi/Projects
python3 python/scripts/qslctl.py plan --projects-root /Users/lisiyi/Projects
python3 python/scripts/qslctl.py generate-matrix --projects-root /Users/lisiyi/Projects --check --strict
python3 python/scripts/check_internal_dependency_matrix.py --projects-root /Users/lisiyi/Projects --strict
```

Operational guidance:

- `check` answers: “Does this repo still match its declared bundle?”
- `check-all` answers: “Which repos are currently failing the compatibility contract?”
- `report` answers: “What is broken now, and in which ring?”
- `plan` answers: “What should be fixed first to converge the workspace?”
- `generate-matrix --check` and `check_internal_dependency_matrix.py --strict` guard the derived dependency matrix against drift.

## Release boundary

Treat the following as the release boundary for QuantRuntimeSettings governance changes:

- Safe to release together:
  - bundle updates in `compat/bundles/`
  - tier/ring policy updates in `compat/repo-tiers.toml`
  - repo metadata updates in `qsl.toml`
  - regenerated `internal_dependency_matrix.json`
  - documentation updates that describe the governance model
- Do **not** bundle with unrelated consumer runtime changes:
  - application/runtime code in consumer repos
  - emergency exception metadata without an expiry plan
  - bundle policy changes that have not passed org-level checks

Recommended promotion sequence:

1. Update the central bundle or tier policy.
2. Re-pin consumer repos in the targeted ring.
3. Regenerate the matrix and run `check-all` / `generate-matrix --check`.
4. Promote the next ring only after the current ring is clean or explicitly exceptioned.

## Health-check sufficiency

Current scripts are sufficient for org-level health checks:

- `python/scripts/qslctl.py` already provides repo checks, workspace checks, ring reports, convergence planning, and matrix generation.
- `python/scripts/check_internal_dependency_matrix.py` already validates internal git dependency drift across the workspace.

No new script is required for the current scope. The only hard requirement is that the workspace root must contain the relevant cloned QuantStrategyLab repositories; these checks do not turn an arbitrary checkout into an org scan by themselves.
