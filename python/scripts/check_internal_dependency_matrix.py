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
            missing_files.append(f"{consumer_repo}/{relative_path}")
            continue
        checked_files += 1
        actual_pins = parse_dependency_pins(consumer_repo, relative_path, path.read_text(encoding="utf-8"))
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

    return MatrixReport(checked_files=checked_files, missing_files=missing_files, issues=issues)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Report QuantStrategyLab internal dependency pin drift.")
    parser.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX_PATH)
    parser.add_argument("--projects-root", type=Path, default=DEFAULT_PROJECTS_ROOT)
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
