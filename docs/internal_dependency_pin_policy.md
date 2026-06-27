# Internal dependency pin policy

[简体中文](internal_dependency_pin_policy.zh-CN.md)

QuantStrategyLab shares Python packages across platforms, strategies, and pipelines via git URL pins. This document explains how pins are tracked, when to use tags versus full commit SHAs, and how to bump dependencies safely.

## Source of truth

- **Tracked pins** live in [`internal_dependency_matrix.json`](../internal_dependency_matrix.json).
- **Validation** runs in QuantRuntimeSettings CI via:

```bash
python3 scripts/check_internal_dependency_matrix.py --projects-root .. --strict
```

The checker compares matrix entries against consumer `requirements.txt`, `requirements-lock.txt`, and `pyproject.toml` files in sibling repositories. With `--strict`, ref mismatches fail CI even when sibling repos are not checked out locally.

## Pin formats

| Format | Example | When to use |
|--------|---------|-------------|
| Full commit SHA | `aee8121d530c2e92c72b68aee434bf174b3b9c85` | **Default** for `quant-platform-kit`, strategy packages, and pipeline libraries consumed by live platforms |
| Annotated tag | `v0.7.38` | Allowed only when the matrix explicitly records the tag and the tagged commit is the intended release line |
| Branch name | `main` | Avoid for production consumers; not tracked in the matrix |

**Policy:** prefer **full SHAs** for anything that feeds Cloud Run, scheduled publish jobs, or cross-repo CI installs. Tags are acceptable for release bookkeeping when the matrix entry documents the tag and CI resolves it to a single commit.

## Package tracks

After the 2026-06 organization alignment, all tracked `quant-platform-kit` consumers pin the same commit (`aee8121…`, pyproject version `0.7.38`). Strategy packages (`us-equity-strategies`, `hk-equity-strategies`, `crypto-strategies`) each have their own matrix rows; bump them independently when strategy code changes.

## Bump procedure

1. Merge and verify CI on the **source** repository (for example QuantPlatformKit or UsEquityStrategies).
2. Update **direct consumers** (`requirements.txt` / `pyproject.toml`) to the new git ref.
3. Update matching rows in `internal_dependency_matrix.json` in the same change wave.
4. Regenerate lockfiles where applicable (`uv lock` for UsEquitySnapshotPipelines).
5. Run the matrix checker locally before opening PRs:

```bash
cd QuantRuntimeSettings
python3 scripts/check_internal_dependency_matrix.py --projects-root .. --strict
```

6. Merge consumer PRs only after upstream CI is green. Platform deploy and pipeline publish workflows are CI-gated on `main`.

## Adding a new tracked consumer

1. Add one matrix row per `(consumer_repo, path, package, source_repo)` tuple.
2. Ensure QuantRuntimeSettings validate workflow can reach sibling repos in CI (or document why the row is matrix-only).
3. Keep package names consistent with pip metadata (`quant-platform-kit`, not `QuantPlatformKit`).

## Related docs

- [CONTRIBUTING.md](../CONTRIBUTING.md) — PR scope and verification expectations
- [README.md](../README.md) — manual strategy switch and runtime settings tooling
