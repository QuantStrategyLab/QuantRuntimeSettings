#!/usr/bin/env python3
"""Render a lightweight QSL dependency graph for a repository."""

from __future__ import annotations

import argparse
import re
from collections import OrderedDict
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    import toml as tomllib  # type: ignore[import-not-found]


GITHUB_OWNER = "QuantStrategyLab"

PATTERNS = (
    re.compile(
        r"git\+https://github\.com/" + re.escape(GITHUB_OWNER) + r"/(?P<repo>[A-Za-z0-9_.-]+)\.git@(?P<ref>[A-Za-z0-9_.-]+)"
    ),
    re.compile(
        r"https://github\.com/" + re.escape(GITHUB_OWNER) + r"/(?P<repo>[A-Za-z0-9_.-]+)\.git\?rev=(?P<ref>[A-Za-z0-9_.-]+)"
    ),
)


def _read_toml(path: Path) -> dict:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def _load_qsl_config(repo_root: Path) -> dict[str, str | bool]:
    qsl_path = repo_root / "qsl.toml"
    payload = _read_toml(qsl_path)
    config = payload.get("qsl", payload)
    if not isinstance(config, dict):
        raise TypeError("qsl section must be a table")

    bundle = config.get("bundle") or config.get("compat")
    if not isinstance(bundle, str) or not bundle.strip():
        raise ValueError("qsl.bundle (or qsl.compat) is required")
    return {
        "bundle": bundle.strip(),
        "tier": str(config.get("tier", "")),
        "upgrade_ring": str(config.get("upgrade_ring", "")),
    }


def _load_bundle(compat_root: Path, bundle: str) -> dict[str, str]:
    payload = _read_toml(compat_root / "compat" / "bundles" / f"{bundle}.toml")
    repos = payload.get("repos")
    if not isinstance(repos, dict):
        raise ValueError("bundle manifest missing [repos]")
    return {str(k): str(v).strip() for k, v in repos.items() if isinstance(k, str) and isinstance(v, str)}


def _scan_refs(path: Path) -> list[tuple[str, str]]:
    refs = []
    if not path.exists():
        return refs

    for line in path.read_text(encoding="utf-8").splitlines():
        for pattern in PATTERNS:
            for match in pattern.finditer(line):
                refs.append((match.group("repo"), match.group("ref")))
    return refs


def _unique_refs(pairs: list[tuple[str, str]]) -> list[tuple[str, str]]:
    seen = set()
    out: list[tuple[str, str]] = []
    for item in pairs:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _render_markdown(repo: str, tier: str, upgrade_ring: str, bundle: str, refs: list[tuple[str, str]], bundle_refs: dict[str, str]) -> str:
    lines = [
        f"# QSL dependency graph: {repo}",
        "",
        f"- bundle: {bundle}",
        f"- tier: {tier or 'unknown'}",
        f"- upgrade_ring: {upgrade_ring or 'unknown'}",
        "",
        "## Direct QSL dependencies",
    ]

    if not refs:
        lines.append("- (none)")
    else:
        for source_repo, ref in refs:
            status = "✓" if bundle_refs.get(source_repo) == ref else "!"
            lines.append(f"- {status} `{source_repo}` @ `{ref}`")

    lines.extend(["", "## Bundle node refs (source of truth)", ""])
    for source_repo, expected_ref in OrderedDict(sorted(bundle_refs.items())).items():
        lines.append(f"- `{source_repo}` -> {expected_ref}")

    return "\n".join(lines)


def _render_text(repo: str, tier: str, upgrade_ring: str, bundle: str, refs: list[tuple[str, str]], bundle_refs: dict[str, str]) -> str:
    lines = [
        f"QSL Dependency Graph - {repo}",
        f"bundle: {bundle}",
        f"tier: {tier or 'unknown'}",
        f"upgrade_ring: {upgrade_ring or 'unknown'}",
        "",
        "Direct QSL refs:",
    ]
    if not refs:
        lines.append("  (none)")
    else:
        for source_repo, ref in refs:
            lines.append(f"  - {source_repo} -> {ref}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render QSL dependency graph")
    parser.add_argument("--repo-root", default=".", type=Path, help="Repository root")
    parser.add_argument(
        "--compat-root",
        default=None,
        type=Path,
        help="Path to QuantRuntimeSettings checkout (defaults to checker script parent)",
    )
    parser.add_argument("--format", choices=("md", "text"), default="md")
    args = parser.parse_args(argv)

    repo_root = args.repo_root.resolve()
    compat_root = args.compat_root
    if compat_root is None:
        compat_root = Path(__file__).resolve().parents[1]
    else:
        compat_root = compat_root.resolve()

    config = _load_qsl_config(repo_root)
    bundle = str(config["bundle"])
    bundle_refs = _load_bundle(compat_root, bundle)

    direct_refs = _scan_refs(repo_root / "pyproject.toml") + _scan_refs(repo_root / "uv.lock")
    direct_refs = _unique_refs(direct_refs)

    if args.format == "text":
        output = _render_text(repo_root.name, str(config["tier"]), str(config["upgrade_ring"]), bundle, direct_refs, bundle_refs)
    else:
        output = _render_markdown(repo_root.name, str(config["tier"]), str(config["upgrade_ring"]), bundle, direct_refs, bundle_refs)

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
