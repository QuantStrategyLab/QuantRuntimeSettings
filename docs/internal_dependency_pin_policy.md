# Internal dependency pin policy

[简体中文](internal_dependency_pin_policy.zh-CN.md)

QuantStrategyLab shares Python packages across platforms, strategies, and pipelines via git URL pins. This document explains how pins are tracked, when to use tags versus full commit SHAs, and how to bump dependencies safely.

## Source of truth (three layers)

| Layer | Location | Meaning | Install authority? |
| --- | --- | --- | --- |
| Install truth | Each consumer's `pyproject.toml` / lock / `qsl.toml` | Refs that CI and installs actually resolve | Yes |
| Saved snapshot | [`internal_dependency_matrix.json`](../internal_dependency_matrix.json) | Refs from the consumer files scanned when generated | Snapshot consistency only; not proof of latest main or deployment |
| Candidate | `QuantPlatformKit/QPK_PIN` | Suggested next upgrade target | No; must not force every live consumer onto one SHA |

- **Validation** runs in QuantRuntimeSettings CI: every PR publishes a drift report, while
  strict enforcement blocks only changes to `internal_dependency_matrix.json`. This prevents
  an unrelated console or documentation PR from failing non-hermetically merely because a
  separately checked-out consumer advanced; a ledger change must still match every consumer.
- See also [qsl_compat_upgrade.md](qsl_compat_upgrade.md) and QPK ADR 0003 Amendment 2026-09-06.

```bash
python3 python/scripts/check_internal_dependency_matrix.py --projects-root .. --strict --require-consumer-files
```

Compare the selected local cohort with the saved snapshot first. Regenerate only after verifying
that all tracked consumers are present, their actual HEADs and file hashes are recorded, and the
cohort did not move during the scan. An old drift report without HEAD evidence is not a fresh cohort:

```bash
python3 python/scripts/qslctl.py generate-matrix --projects-root .. --check --strict
python3 python/scripts/check_internal_dependency_matrix.py --projects-root .. --generate --json > /tmp/internal_dependency_matrix.json
# After reviewing the complete cohort and its dependency changes:
python3 python/scripts/qslctl.py generate-matrix --projects-root .. --sync
```

The checker compares matrix entries against consumer `requirements.txt`, `requirements-lock.txt`,
`pyproject.toml`, and `uv.lock` files in sibling repositories. `--strict` fails on reported issues,
including ref mismatches. Missing consumer files are listed in `missing_files`; they become issues
only with `--require-consumer-files`. Thus `--strict` alone can return zero for an incomplete scan.
Neither a matching snapshot nor a fresh checkout proves the deployed runtime or dependency compatibility.

## Checkout evidence

`bash python/shell/checkout_internal_dependency_consumers.sh --output-root ..` clones missing
consumer repositories using the requested branch when available, otherwise `main`. It preserves
existing directories without fetch, pull, checkout, or overwriting local edits, and validates the
canonical `QuantStrategyLab/<consumer_repo>` origin, repository root, and HEAD connectivity.
It requires `git`, `python3`, `gh`, and `GH_TOKEN` or `GITHUB_TOKEN` with read access to the tracked repositories.

The script emits one JSON record per repository to stdout. Each record contains the requested ref,
actual selected branch (or full HEAD for a detached checkout), full `head_sha`, canonical origin,
`worktree_dirty`, `matrix_sha256`, and SHA256 digests for manifest/lock files. `sha256` describes the
working-tree bytes; `head_sha256` describes the bytes committed at that HEAD. Missing files and
uncommitted files are explicit. Raw origin URLs, credentials, and file contents are never printed.
Symlinked dependency files and changes during a repository's scan fail evidence collection.

These records describe the checked-out repositories, including preserved older or dirty checkouts;
the requested `main` name is not proof of latest main or deployment. Before regenerating a frozen
cohort, verify the complete repository/file set and recheck all HEADs and hashes across the full scan.
Per-repository stability is not an atomic snapshot of the whole batch.

## Pin formats

| Format | Example | When to use |
|--------|---------|-------------|
| Full commit SHA | `aee8121d530c2e92c72b68aee434bf174b3b9c85` | **Default** for `quant-platform-kit`, strategy packages, and pipeline libraries consumed by live platforms |
| Annotated tag | `v0.7.38` | Allowed only when the matrix explicitly records the tag and the tagged commit is the intended release line |
| Branch name | `main` | Avoid for production consumers; not tracked in the matrix |

**Policy:** prefer **full SHAs** for anything that feeds Cloud Run, scheduled publish jobs, or cross-repo CI installs. Tags are acceptable for release bookkeeping when the matrix entry documents the tag and CI resolves it to a single commit.

## Package tracks

Different consumers may keep different full QPK SHAs when those combinations are already validated; the matrix records actual pins and does not require an org-wide single SHA.
Strategy packages (`us-equity-strategies`, `hk-equity-strategies`, `crypto-strategies`) each have their own matrix rows; bump them independently when strategy code changes.

## Bump procedure

1. Merge and verify CI on the **source** repository (for example QuantPlatformKit or UsEquityStrategies); advancing `QPK_PIN` only stages a candidate.
2. Update only **affected consumers that are behind** the candidate. Downstream opener defaults to `upgrade-affected` and **must not** open downgrade PRs against equal / ahead / diverged consumers.
3. Update matching rows in `internal_dependency_matrix.json` in the same change wave (ledger follows actual pins; never force a downgrade).
4. Regenerate lockfiles where applicable (`uv lock` for UsEquitySnapshotPipelines).
5. Run the matrix checker locally before opening PRs:

```bash
cd QuantRuntimeSettings
python3 python/scripts/check_internal_dependency_matrix.py --projects-root .. --strict --require-consumer-files
```

6. Merge consumer PRs only after upstream CI is green. Platform deploy and pipeline publish workflows are CI-gated on `main`.
7. Close leftover generated PRs whose target SHA is older than the current candidate as superseded/downgrade; do not merge rollbacks.

## Adding a new tracked consumer

1. Add one matrix row per `(consumer_repo, path, package, source_repo)` tuple.
2. Ensure QuantRuntimeSettings validate workflow can reach sibling repos in CI (or document why the row is matrix-only).
3. Keep package names consistent with pip metadata (`quant-platform-kit`, not `QuantPlatformKit`).

## Related docs

- [CONTRIBUTING.md](../CONTRIBUTING.md) — PR scope and verification expectations
- [README.md](../README.md) — manual strategy switch and runtime settings tooling
