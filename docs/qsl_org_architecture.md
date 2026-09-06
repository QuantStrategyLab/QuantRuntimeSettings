# QSL Org Architecture & Health Checks

This document defines the repository governance and compatibility boundaries used by QuantRuntimeSettings. It does not report deployed account state or certify trading safety.

For coordination and dated research facts, use the existing [P0–P6 policy](QSL_P0_P6_CURRENT_STATE_AND_DRIVER_POLICY.zh-CN.md).

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
python3 python/scripts/qslctl.py check-all --projects-root /path/to/prepared-workspace --strict
python3 python/scripts/qslctl.py report --projects-root /path/to/prepared-workspace
python3 python/scripts/qslctl.py plan --projects-root /path/to/prepared-workspace
python3 python/scripts/qslctl.py generate-matrix --projects-root /path/to/prepared-workspace --check --strict
python3 python/scripts/check_internal_dependency_matrix.py --projects-root /path/to/prepared-workspace --strict
```

Operational guidance:

- `check` answers: “Does this repo still match its declared bundle?”
- `check-all` answers: “Which repos are currently failing the compatibility contract?”
- `report` answers: “Which prepared repositories deviate from compatibility policy, and in which ring?”
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

Use this sequence only for an intentional compatibility-bundle change, not every shared-library commit. Update only materially affected consumers; workflow references and runtime package pins are distinct.

1. Update the applicable central bundle or tier policy.
2. Re-pin consumer repos in the targeted ring.
3. Regenerate the matrix and run `check-all` / `generate-matrix --check`.
4. Promote the next ring only after the current ring is clean or explicitly exceptioned.

## Compatibility-check scope

The existing scripts cover repository compatibility checks, not runtime health:

- `python/scripts/qslctl.py` already provides repo checks, workspace checks, ring reports, convergence planning, and matrix generation.
- `python/scripts/check_internal_dependency_matrix.py` already validates internal git dependency drift across the workspace.

No new checker is required for this scope. The prepared workspace must contain the relevant repositories; an incomplete checkout is not an organization-wide scan. Report `matrix current` (tracked manifest snapshot) separately from `qslctl bundle drift` (selected compatibility policy). Neither proves deployed version, broker reconciliation, promotion eligibility or trading recovery.

## Runtime and recovery boundaries

- QuantPlatformKit owns shared risk/contracts and infrastructure ports; strategy and pipeline repositories own business/research logic; broker and cloud differences remain in platform adapters. QuantRuntimeSettings owns configuration and compatibility, not market signals or broker truth.
- Saved configuration, applied runtime/scheduler state, last complete business cycle and actual fills are different facts. Unknown or stale readback stays unknown; CI or an enabled flag cannot stand in for any of them.
- Verify the configured deployment target: GCP Scheduler/Cloud Run and self-hosted Oracle adapters are distinct. A developer machine is not a production prerequisite. Keep private infrastructure identifiers in deployment configuration, not shared core or this document.
- Restoring an unchanged approved version does not require repeating the complete research audit. Direct identity, authorization, risk and unresolved-order protections still apply. New strategy/risk changes retain their separate acceptance and live authority.
- Human-facing management exposes accounts, strategy selection, actual state and actionable decisions. Internal audit/diagnostic details do not become additional enablement gates. Stop-new-orders does not cancel orders, liquidate positions or erase unresolved state.
- Audit fixes and release adoption are separate: reuse an existing patch, verify the actual consumer and only deploy an affected service. A research library without a service does not need an unrelated restart or data/model rerun. Retain old evidence and identify affected conclusions rather than silently replacing it.
