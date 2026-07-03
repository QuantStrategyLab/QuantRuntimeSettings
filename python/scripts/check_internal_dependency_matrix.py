#!/usr/bin/env python3
"""Report QuantStrategyLab internal git dependency pin drift."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MATRIX_PATH = ROOT / "internal_dependency_matrix.json"
DEFAULT_PROJECTS_ROOT = ROOT.parent
DEPENDENCY_PATTERN = re.compile(
    r"(?P<package>[A-Za-z0-9_.-]+)\s*@\s*"
    r"git\+https://github\.com/QuantStrategyLab/"
    r"(?P<source_repo>[A-Za-z0-9_.-]+)\.git@(?P<ref>[A-Za-z0-9_.-]+)"
)
TRACKED_DEPENDENCY_PATHS = ("requirements.txt", "requirements-lock.txt", "pyproject.toml")
LEGACY_DEPENDENCY_PATHS = ("requirements.txt", "requirements-lock.txt")
PYPROJECT_FALLBACK_PATH = "pyproject.toml"


def _sort_dependency_pins(pins: list[DependencyPin]) -> list[DependencyPin]:
    return sorted(
        set(pins),
        key=lambda pin: (pin.consumer_repo, pin.path, pin.package, pin.source_repo, pin.ref),
    )


@dataclass(frozen=True)
class DependencyPin:
    consumer_repo: str
    path: str
    package: str
    source_repo: str
    ref: str

    @property
    def key(self) -> tuple[str, str, str, str]:
        return (self.consumer_repo, self.path, self.package, self.source_repo)

    def label(self) -> str:
        return f"{self.consumer_repo}/{self.path}:{self.package}->{self.source_repo}"


@dataclass(frozen=True)
class MatrixReport:
    checked_files: int
    missing_files: list[str]
    issues: list[str]

    @property
    def ok(self) -> bool:
        return not self.issues


def matrix_payload(pins: list[DependencyPin]) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "dependencies": [
            {
                "consumer_repo": pin.consumer_repo,
                "path": pin.path,
                "package": pin.package,
                "source_repo": pin.source_repo,
                "ref": pin.ref,
            }
            for pin in _sort_dependency_pins(pins)
        ],
    }


def collect_dependency_pins_from_projects(projects_root: Path) -> list[DependencyPin]:
    pins: list[DependencyPin] = []
    for project_dir in sorted(p for p in projects_root.iterdir() if p.is_dir() and not p.name.startswith(".")):
        for relative_path in TRACKED_DEPENDENCY_PATHS:
            path = project_dir / relative_path
            if not path.is_file():
                continue
            pins.extend(parse_dependency_pins(project_dir.name, relative_path, path.read_text(encoding="utf-8")))
    return _sort_dependency_pins(pins)


def load_matrix(path: Path) -> list[DependencyPin]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1:
        raise ValueError("internal dependency matrix schema_version must be 1")
    dependencies = payload.get("dependencies")
    if not isinstance(dependencies, list):
        raise ValueError("internal dependency matrix dependencies must be a list")
    pins: list[DependencyPin] = []
    for index, item in enumerate(dependencies):
        if not isinstance(item, dict):
            raise ValueError(f"dependencies[{index}] must be an object")
        pins.append(
            DependencyPin(
                consumer_repo=_required_string(item, "consumer_repo", index),
                path=_required_string(item, "path", index),
                package=_required_string(item, "package", index),
                source_repo=_required_string(item, "source_repo", index),
                ref=_required_string(item, "ref", index),
            )
        )
    return pins


def _required_string(item: dict[str, Any], key: str, index: int) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"dependencies[{index}].{key} must be a non-empty string")
    return value.strip()


def parse_dependency_pins(consumer_repo: str, path: str, text: str) -> list[DependencyPin]:
    return [
        DependencyPin(
            consumer_repo=consumer_repo,
            path=path,
            package=match.group("package"),
            source_repo=match.group("source_repo"),
            ref=match.group("ref"),
        )
        for match in DEPENDENCY_PATTERN.finditer(text)
    ]


def _parse_repo_pins(projects_root: Path, consumer_repo: str, relative_path: str) -> list[DependencyPin]:
    path = projects_root / consumer_repo / relative_path
    if not path.is_file():
        return []
    return parse_dependency_pins(consumer_repo, relative_path, path.read_text(encoding="utf-8"))


def _fallback_path_for_legacy_requirements(projects_root: Path, consumer_repo: str, expected_path: str) -> str | None:
    if expected_path not in LEGACY_DEPENDENCY_PATHS:
        return None
    pyproject_path = projects_root / consumer_repo / PYPROJECT_FALLBACK_PATH
    if pyproject_path.is_file():
        return PYPROJECT_FALLBACK_PATH
    return None


def _compare_dependency_pins(
    *, expected_pins: list[DependencyPin], actual_pins: list[DependencyPin], issues: list[str]
) -> None:
    actual_by_key = {pin.key: pin for pin in actual_pins}
    expected_by_key = {pin.key: pin for pin in expected_pins}

    for key, expected in sorted(expected_by_key.items()):
        actual = actual_by_key.get(key)
        if actual is None:
            issues.append(f"missing {expected.label()} expected @{expected.ref}")
        elif actual.ref != expected.ref:
            issues.append(f"ref mismatch {expected.label()}: expected @{expected.ref}, found @{actual.ref}")

    for key, actual in sorted(actual_by_key.items()):
        if key not in expected_by_key:
            issues.append(f"untracked internal dependency {actual.label()} @{actual.ref}")


def check_matrix(*, matrix_pins: list[DependencyPin], projects_root: Path) -> MatrixReport:
    expected_by_file: dict[tuple[str, str], list[DependencyPin]] = {}
    for pin in matrix_pins:
        expected_by_file.setdefault((pin.consumer_repo, pin.path), []).append(pin)

    issues: list[str] = []
    missing_files: list[str] = []
    checked_files = 0
    for (consumer_repo, relative_path), expected_pins in sorted(expected_by_file.items()):
        path = projects_root / consumer_repo / relative_path
        if not path.exists():
            fallback_path = _fallback_path_for_legacy_requirements(projects_root, consumer_repo, relative_path)
            if fallback_path is not None:
                fallback_pins = _parse_repo_pins(projects_root, consumer_repo, fallback_path)
                if fallback_pins:
                    _compare_dependency_pins(
                        expected_pins=[
                            DependencyPin(
                                consumer_repo=pin.consumer_repo,
                                path=fallback_path,
                                package=pin.package,
                                source_repo=pin.source_repo,
                                ref=pin.ref,
                            )
                            for pin in expected_pins
                        ],
                        actual_pins=fallback_pins,
                        issues=issues,
                    )
                    continue
            missing_files.append(f"{consumer_repo}/{relative_path}")
            continue
        checked_files += 1
        actual_pins = parse_dependency_pins(consumer_repo, relative_path, path.read_text(encoding="utf-8"))
        _compare_dependency_pins(expected_pins=expected_pins, actual_pins=actual_pins, issues=issues)

    return MatrixReport(checked_files=checked_files, missing_files=missing_files, issues=issues)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Report QuantStrategyLab internal dependency pin drift.")
    parser.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX_PATH)
    parser.add_argument("--projects-root", type=Path, default=DEFAULT_PROJECTS_ROOT)
    parser.add_argument(
        "--generate",
        action="store_true",
        help="Generate internal dependency matrix payload from local consumer dependency files.",
    )
    parser.add_argument(
        "--sync",
        action="store_true",
        help="Overwrite --matrix with generated internal dependency payload.",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable report.")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero when drift is detected.")
    parser.add_argument(
        "--require-consumer-files",
        action="store_true",
        help="Treat missing consumer dependency files as validation failures.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.generate or args.sync:
        generated_payload = matrix_payload(collect_dependency_pins_from_projects(projects_root=args.projects_root))
        rendered_payload = json.dumps(generated_payload, ensure_ascii=False, indent=2)
        print(rendered_payload)
        if args.sync:
            args.matrix.write_text(rendered_payload + "\n", encoding="utf-8")
            if not args.json:
                print(f"synced matrix -> {args.matrix}")
        return 0

    report = check_matrix(matrix_pins=load_matrix(args.matrix), projects_root=args.projects_root)
    issues = list(report.issues)
    if args.require_consumer_files and report.missing_files:
        for item in report.missing_files:
            issues.append(f"missing consumer dependency file {item}")
    ok = not issues
    if args.json:
        print(
            json.dumps(
                {
                    "checked_files": report.checked_files,
                    "missing_files": report.missing_files,
                    "issues": issues,
                    "ok": ok,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(f"checked_files={report.checked_files}")
        if report.missing_files:
            print("missing_files:")
            for item in report.missing_files:
                print(f"- {item}")
        if issues:
            print("issues:")
            for issue in issues:
                print(f"- {issue}")
        if ok:
            print("internal dependency matrix is current")
    return 1 if args.strict and not ok else 0


if __name__ == "__main__":
    raise SystemExit(main())
