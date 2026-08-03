#!/usr/bin/env python3
"""Validate an IBKR switch with the target platform's deployment planner."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from runtime_settings import build_assignments, load_target  # noqa: E402


PROTECTED_ENV_NAMES = {
    "GH_TOKEN",
    "HOME",
    "PATH",
    "PYTHONHOME",
    "PYTHONPATH",
    "VIRTUAL_ENV",
}


def _load_repository_variables(path: Path) -> dict[str, str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("repository variables file must contain a list")
    variables: dict[str, str] = {}
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("repository variable entries must be objects")
        name = str(item.get("name") or "").strip()
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
            raise ValueError("repository variable names must use uppercase environment syntax")
        if name in PROTECTED_ENV_NAMES or name.startswith(("LD_", "DYLD_")):
            continue
        value = item.get("value")
        variables[name] = value if isinstance(value, str) else str(value or "")
    return variables


def _candidate_environment(target: dict[str, Any], variables: dict[str, str]) -> dict[str, str]:
    environment = os.environ.copy()
    environment.update(variables)
    candidate_inventory = False
    for assignment in build_assignments(target):
        if assignment.name == "CLOUD_RUN_SERVICE_TARGETS_JSON":
            candidate_inventory = True
        if assignment.deletes_variable:
            environment.pop(assignment.name, None)
        else:
            environment[assignment.name] = assignment.value
    if not candidate_inventory:
        raise ValueError("candidate CLOUD_RUN_SERVICE_TARGETS_JSON assignment is required")
    return environment


def preflight(target_file: Path, platform_root: Path, repository_variables_file: Path) -> None:
    target = load_target(target_file)
    runtime_target = target.get("runtime_target")
    if not isinstance(runtime_target, dict) or runtime_target.get("platform_id") != "ibkr":
        raise ValueError("preflight_ibkr_switch.py only accepts IBKR targets")

    variables = _load_repository_variables(repository_variables_file)
    environment = _candidate_environment(target, variables)
    python_path = platform_root / ".venv" / "bin" / "python"
    planner_path = platform_root / "scripts" / "build_cloud_run_env_sync_plan.py"
    if not python_path.is_file() or not planner_path.is_file():
        raise ValueError("IBKR planner runtime is incomplete")

    result = subprocess.run(
        [str(python_path), str(planner_path), "--json"],
        cwd=platform_root,
        env=environment,
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )
    if result.returncode != 0:
        raise ValueError("IBKR deployment planner rejected the candidate runtime settings")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-file", required=True, type=Path)
    parser.add_argument("--platform-root", required=True, type=Path)
    parser.add_argument("--repository-variables-file", required=True, type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        preflight(args.target_file, args.platform_root, args.repository_variables_file)
    except (OSError, ValueError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print("IBKR deployment plan preflight passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
