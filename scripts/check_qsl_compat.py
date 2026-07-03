#!/usr/bin/env python3
"""Validate repository QSL compatibility policy against a central bundle manifest."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - py<3.11 compatibility fallback
    import toml as tomllib  # type: ignore[import-not-found]


GITHUB_OWNER = "QuantStrategyLab"


@dataclass(frozen=True)
class GitRef:
    repo: str
    ref: str
    source: str
    line_no: int | None


PATTERNS = (
    re.compile(
        r"git\+https://github\.com/" + re.escape(GITHUB_OWNER) + r"/(?P<repo>[A-Za-z0-9_.-]+)\.git@(?P<ref>[A-Za-z0-9_.-]+)"
    ),
    re.compile(
        r"https://github\.com/" + re.escape(GITHUB_OWNER) + r"/(?P<repo>[A-Za-z0-9_.-]+)\.git\?rev=(?P<ref>[A-Za-z0-9_.-]+)"
    ),
)


def _read_toml(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def _get_bundle(config: dict[str, Any]) -> str:
    bundle = config.get("bundle") or config.get("compat")
    if isinstance(bundle, dict):
        bundle = bundle.get("bundle")
    if not isinstance(bundle, str) or not bundle.strip():
        raise ValueError("qsl.bundle (or qsl.compat.bundle) is required")
    return bundle.strip()


def _get_upgrade_ring(config: dict[str, Any]) -> str:
    upgrade_ring = config.get("upgrade_ring", config.get("ring"))
    if upgrade_ring is None or str(upgrade_ring).strip() == "":
        raise ValueError("qsl.upgrade_ring (or qsl.ring) is required")
    return str(upgrade_ring).strip()


def _get_enforce_bundle(config: dict[str, Any]) -> bool:
    compat = config.get("compat")
    if isinstance(compat, dict) and "enforce_bundle" in compat:
        return bool(compat["enforce_bundle"])
    return bool(config.get("enforce_bundle", True))


def _load_qsl_config(repo_root: Path) -> dict[str, str | bool]:
    qsl_path = repo_root / "qsl.toml"
    if not qsl_path.exists():
        raise FileNotFoundError(f"missing qsl.toml: {qsl_path}")

    payload = _read_toml(qsl_path)
    config = payload.get("qsl", payload)
    if not isinstance(config, dict):
        raise TypeError("qsl section must be a table")

    bundle = _get_bundle(config)

    tier = config.get("tier")
    if not isinstance(tier, str) or not tier.strip():
        raise ValueError("qsl.tier is required")

    upgrade_ring = _get_upgrade_ring(config)

    allow_legacy = bool(config.get("allow_legacy", False))
    enforce_bundle = _get_enforce_bundle(config)

    return {
        "bundle": bundle,
        "tier": tier.strip(),
        "upgrade_ring": upgrade_ring,
        "allow_legacy": allow_legacy,
        "enforce_bundle": enforce_bundle,
        "qsl_path": qsl_path.as_posix(),
    }


def _load_bundle(compat_root: Path, bundle: str) -> dict[str, str]:
    bundle_path = compat_root / "compat" / "bundles" / f"{bundle}.toml"
    if not bundle_path.exists():
        raise FileNotFoundError(f"bundle manifest not found: {bundle_path}")

    payload = _read_toml(bundle_path)
    repos = payload.get("repos")
    if not isinstance(repos, dict) or not repos:
        raise ValueError(f"bundle manifest missing [repos] in {bundle_path}")

    parsed: dict[str, str] = {}
    for repo_name, ref in repos.items():
        if not isinstance(repo_name, str) or not repo_name.strip():
            continue
        if not isinstance(ref, str) or not ref.strip():
            raise ValueError(f"bundle manifest invalid ref for {repo_name}")
        parsed[repo_name.strip()] = ref.strip()

    return parsed


def _extract_git_refs(path: Path) -> list[GitRef]:
    refs: list[GitRef] = []
    if not path.exists():
        return refs

    for index, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        for pattern in PATTERNS:
            for match in pattern.finditer(line):
                refs.append(
                    GitRef(
                        repo=match.group("repo"),
                        ref=match.group("ref"),
                        source=f"{path.name}",
                        line_no=index,
                    )
                )

    return refs


def _gather_repo_refs(repo_root: Path) -> list[GitRef]:
    refs = []
    refs.extend(_extract_git_refs(repo_root / "pyproject.toml"))
    refs.extend(_extract_git_refs(repo_root / "uv.lock"))
    return refs


def _gather_legacy_refs(repo_root: Path) -> list[GitRef]:
    refs = []
    for legacy in ("requirements.txt", "constraints.txt"):
        refs.extend(_extract_git_refs(repo_root / legacy))
    return refs


def _is_full_sha(value: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-f]{40}", value.lower()))


def _is_main_ref(value: str) -> bool:
    return value.lower() == "main"


def _check(repo_root: Path, compat_root: Path) -> tuple[bool, list[str], list[str], list[str]]:
    issues: list[str] = []
    warnings: list[str] = []
    notes: list[str] = []

    qsl_cfg = _load_qsl_config(repo_root)
    bundle = str(qsl_cfg["bundle"])
    tier = str(qsl_cfg["tier"])
    upgrade_ring = str(qsl_cfg["upgrade_ring"])
    allow_legacy = bool(qsl_cfg["allow_legacy"])
    enforce_bundle = bool(qsl_cfg["enforce_bundle"])
    qsl_path = str(qsl_cfg["qsl_path"])

    notes.append(f"qsl={qsl_path}")
    notes.append(f"bundle={bundle}")
    notes.append(f"tier={tier}")
    notes.append(f"upgrade_ring={upgrade_ring}")
    notes.append(f"enforce_bundle={enforce_bundle}")

    bundle_refs = _load_bundle(compat_root, bundle)

    if not allow_legacy:
        for legacy_file in ("requirements.txt", "constraints.txt"):
            if (repo_root / legacy_file).exists():
                issues.append(f"legacy file forbidden: {legacy_file}")
    else:
        legacy_refs = _gather_legacy_refs(repo_root)
        if legacy_refs:
            warnings.append("legacy dependency files detected but allowed by qsl.allow_legacy=true")
            for legacy_ref in legacy_refs:
                if legacy_ref.repo not in bundle_refs:
                    issues.append(
                        f"unmanaged qsl dependency in {legacy_ref.source}:{legacy_ref.line_no}: "
                        f"{legacy_ref.repo}@{legacy_ref.ref}"
                    )
                    continue
                _validate_ref(legacy_ref, bundle_refs[legacy_ref.repo], issues, warnings, enforce_bundle)

    discovered = _gather_repo_refs(repo_root)
    for pin in discovered:
        if pin.repo not in bundle_refs:
            issues.append(f"unmanaged qsl dependency in {pin.source}:{pin.line_no}: {pin.repo}@{pin.ref}")
            continue
        expected_ref = bundle_refs[pin.repo]
        _validate_ref(pin, expected_ref, issues, warnings, enforce_bundle)

    return (len(issues) == 0, issues, warnings, notes)


def _validate_ref(pin: GitRef, expected_ref: str, issues: list[str], warnings: list[str], enforce_bundle: bool) -> None:
    if _is_main_ref(pin.ref):
        issues.append(f"forbidden ref 'main' in {pin.source}:{pin.line_no}: {pin.repo}")
        return
    if not _is_full_sha(pin.ref):
        message = f"forbidden short/invalid ref '{pin.ref}' in {pin.source}:{pin.line_no}: {pin.repo}"
        if enforce_bundle:
            issues.append(message)
        else:
            warnings.append(message)
        return
    if pin.ref != expected_ref:
        message = (
            f"bundle pin mismatch for {pin.repo} in {pin.source}:{pin.line_no}: "
            f"expected {expected_ref}, found {pin.ref}"
        )
        if enforce_bundle:
            issues.append(message)
        else:
            warnings.append(message)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Check repo QSL compatibility against the central manifest.")
    parser.add_argument("--repo-root", default=".", type=Path, help="Repository root to check")
    parser.add_argument(
        "--compat-root",
        type=Path,
        default=None,
        help="Path to QuantRuntimeSettings checkout (defaults to checker script parent)",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON payload")
    parser.add_argument("--non-strict", action="store_true", help="Exit 0 even when issues exist")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    repo_root = args.repo_root.resolve()
    compat_root = args.compat_root
    if compat_root is None:
        compat_root = Path(__file__).resolve().parents[1]
    else:
        compat_root = compat_root.resolve()

    try:
        ok, issues, warnings, notes = _check(repo_root=repo_root, compat_root=compat_root)
    except (FileNotFoundError, ValueError, TypeError) as exc:
        if args.json:
            payload = {"ok": False, "issues": [str(exc)], "repo_root": str(repo_root), "compat_root": str(compat_root)}
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print(f"[qsl-compat] ERROR: {exc}")
        return 2

    if args.json:
        print(
            json.dumps(
                {
                    "ok": ok,
                    "issues": issues,
                    "warnings": warnings,
                    "notes": notes,
                    "repo_root": str(repo_root),
                    "compat_root": str(compat_root),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(f"Repository: {repo_root.name}")
        for note in notes:
            print(note)
        if issues:
            print("Issues:")
            for issue in issues:
                print(f"- {issue}")
        if warnings:
            print("Warnings:")
            for warning in warnings:
                print(f"- {warning}")
        print(f"Result: {'pass' if ok else 'fail'}")

    if issues and not args.non_strict:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
