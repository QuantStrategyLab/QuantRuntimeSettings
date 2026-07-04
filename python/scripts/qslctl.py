#!/usr/bin/env python3
"""Unified QSL version-control command line tools.

This is the control-plane entry point for QuantStrategyLab internal version
management.  It intentionally wraps the existing compatibility checker and
internal dependency matrix generator instead of replacing them in one step.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PROJECTS_ROOT = ROOT.parent
DEFAULT_MATRIX_PATH = ROOT / "internal_dependency_matrix.json"
DEFAULT_COMPAT_ROOT = ROOT
CHECK_QSL_COMPAT_PATH = ROOT / "scripts" / "check_qsl_compat.py"

try:  # pragma: no cover - direct script execution fallback
    from python.scripts import check_internal_dependency_matrix
except ModuleNotFoundError:  # pragma: no cover
    sys.path.insert(0, str(ROOT))
    from python.scripts import check_internal_dependency_matrix


def _load_check_qsl_compat():
    spec = importlib.util.spec_from_file_location("check_qsl_compat", CHECK_QSL_COMPAT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load checker: {CHECK_QSL_COMPAT_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(spec.name, module)
    spec.loader.exec_module(module)
    return module


check_qsl_compat = _load_check_qsl_compat()


@dataclass(frozen=True)
class RepoCheckResult:
    repo: str
    ok: bool
    issues: list[str]
    warnings: list[str]
    notes: list[str]
    repo_root: str


def _is_quant_repo(repo_dir: Path) -> bool:
    if not (repo_dir / ".git").exists():
        return False
    try:
        remote = subprocess.check_output(
            ["git", "-C", str(repo_dir), "remote", "get-url", "origin"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False
    return "github.com/QuantStrategyLab/" in remote


def iter_qsl_repos(projects_root: Path) -> list[Path]:
    repos: list[Path] = []
    for repo_dir in sorted(projects_root.iterdir()):
        if not repo_dir.is_dir() or repo_dir.name.startswith("."):
            continue
        if not (repo_dir / "qsl.toml").exists():
            continue
        if _is_quant_repo(repo_dir):
            repos.append(repo_dir)
    return repos


def check_repo(repo_root: Path, compat_root: Path) -> RepoCheckResult:
    try:
        ok, issues, warnings, notes = check_qsl_compat._check(repo_root=repo_root, compat_root=compat_root)
    except (FileNotFoundError, ValueError, TypeError) as exc:
        ok = False
        issues = [str(exc)]
        warnings = []
        notes = []
    return RepoCheckResult(
        repo=repo_root.name,
        ok=bool(ok),
        issues=list(issues),
        warnings=list(warnings),
        notes=list(notes),
        repo_root=str(repo_root),
    )


def check_all(projects_root: Path, compat_root: Path) -> list[RepoCheckResult]:
    return [check_repo(repo_root=repo, compat_root=compat_root) for repo in iter_qsl_repos(projects_root)]


def _result_payload(result: RepoCheckResult) -> dict[str, Any]:
    return {
        "repo": result.repo,
        "ok": result.ok,
        "issues": result.issues,
        "warnings": result.warnings,
        "notes": result.notes,
        "repo_root": result.repo_root,
    }


def _summary_payload(results: list[RepoCheckResult]) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "total_repositories": len(results),
        "failed_repositories": sum(1 for result in results if not result.ok),
        "warning_repositories": sum(1 for result in results if result.warnings),
        "issue_count": sum(len(result.issues) for result in results),
        "warning_count": sum(len(result.warnings) for result in results),
        "repositories": [_result_payload(result) for result in results],
    }


def _print_check_result(result: RepoCheckResult) -> None:
    status = "PASS" if result.ok else "FAIL"
    warning_suffix = f", warnings={len(result.warnings)}" if result.warnings else ""
    print(f"[{status}] {result.repo} issues={len(result.issues)}{warning_suffix}")
    for note in result.notes:
        print(f"  {note}")
    for issue in result.issues:
        print(f"  issue: {issue}")
    for warning in result.warnings:
        print(f"  warning: {warning}")


def _cmd_check(args: argparse.Namespace) -> int:
    result = check_repo(repo_root=args.repo_root.resolve(), compat_root=args.compat_root.resolve())
    if args.json:
        print(json.dumps(_result_payload(result), ensure_ascii=False, indent=2))
    else:
        _print_check_result(result)
    return 1 if args.strict and not result.ok else 0


def _cmd_check_all(args: argparse.Namespace) -> int:
    results = check_all(projects_root=args.projects_root.resolve(), compat_root=args.compat_root.resolve())
    payload = _summary_payload(results)
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(
            "QSL compatibility summary: "
            f"repos={payload['total_repositories']} "
            f"failed={payload['failed_repositories']} "
            f"warnings={payload['warning_repositories']} "
            f"issues={payload['issue_count']}"
        )
        for result in results:
            if not result.ok or result.warnings or args.verbose:
                _print_check_result(result)
    return 1 if args.strict and payload["failed_repositories"] else 0


def _matrix_payload(projects_root: Path) -> dict[str, Any]:
    return check_internal_dependency_matrix.matrix_payload(
        check_internal_dependency_matrix.collect_dependency_pins_from_projects(projects_root)
    )


def _cmd_generate_matrix(args: argparse.Namespace) -> int:
    projects_root = args.projects_root.resolve()
    matrix_path = args.matrix.resolve()
    payload = _matrix_payload(projects_root)
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"

    if args.check:
        existing = matrix_path.read_text(encoding="utf-8") if matrix_path.exists() else ""
        ok = existing == rendered
        result = {
            "ok": ok,
            "matrix": str(matrix_path),
            "generated_dependency_count": len(payload["dependencies"]),
        }
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(
                f"internal dependency matrix {'is current' if ok else 'is stale'} "
                f"({result['generated_dependency_count']} dependencies)"
            )
        return 1 if args.strict and not ok else 0

    if args.sync:
        matrix_path.write_text(rendered, encoding="utf-8")
        if not args.json:
            print(f"synced matrix -> {matrix_path}")

    if args.json:
        print(rendered, end="")
    elif not args.sync:
        print(rendered, end="")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="QSL internal version control plane CLI.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    check = subparsers.add_parser("check", help="Check one repository against its declared QSL bundle.")
    check.add_argument("--repo-root", type=Path, default=Path("."))
    check.add_argument("--compat-root", type=Path, default=DEFAULT_COMPAT_ROOT)
    check.add_argument("--json", action="store_true")
    check.add_argument("--strict", action="store_true", help="Exit non-zero when the repo has issues.")
    check.set_defaults(func=_cmd_check)

    check_all_parser = subparsers.add_parser("check-all", help="Check all local QuantStrategyLab qsl.toml repositories.")
    check_all_parser.add_argument("--projects-root", type=Path, default=DEFAULT_PROJECTS_ROOT)
    check_all_parser.add_argument("--compat-root", type=Path, default=DEFAULT_COMPAT_ROOT)
    check_all_parser.add_argument("--json", action="store_true")
    check_all_parser.add_argument("--strict", action="store_true", help="Exit non-zero when any repo has issues.")
    check_all_parser.add_argument("--verbose", action="store_true", help="Print passing repositories too.")
    check_all_parser.set_defaults(func=_cmd_check_all)

    matrix = subparsers.add_parser("generate-matrix", help="Generate or check the internal dependency matrix.")
    matrix.add_argument("--projects-root", type=Path, default=DEFAULT_PROJECTS_ROOT)
    matrix.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX_PATH)
    matrix.add_argument("--sync", action="store_true", help="Overwrite --matrix with generated payload.")
    matrix.add_argument("--check", action="store_true", help="Check whether --matrix equals generated payload.")
    matrix.add_argument("--json", action="store_true")
    matrix.add_argument("--strict", action="store_true", help="With --check, exit non-zero when stale.")
    matrix.set_defaults(func=_cmd_generate_matrix)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
