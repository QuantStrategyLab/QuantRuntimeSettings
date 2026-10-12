"""Read back every assignment of a target file after apply; print names only."""
from __future__ import annotations

import json
import subprocess
import sys
from urllib.parse import quote

from runtime_settings import build_assignments


def read_variable(assignment, run=subprocess.run) -> str | None:
    endpoint = f"repos/{assignment.repository}"
    if assignment.variable_scope == "environment":
        endpoint += f"/environments/{quote(str(assignment.environment), safe='')}"
    endpoint += f"/variables/{assignment.name}"
    try:
        result = run(["gh", "api", endpoint, "-q", ".value"], text=True, capture_output=True, timeout=60, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout[:-1] if result.stdout.endswith("\n") else result.stdout


def verify(target: dict, run=subprocess.run) -> list[str]:
    mismatched = []
    for assignment in build_assignments(target):
        if read_variable(assignment, run=run) != assignment.value:
            mismatched.append(assignment.name)
    return mismatched


def main(argv: list[str]) -> int:
    with open(argv[1], encoding="utf-8") as handle:
        target = json.load(handle)
    mismatched = verify(target)
    if mismatched:
        print("apply_readback_mismatch: " + ",".join(sorted(mismatched)), file=sys.stderr)
        return 2
    print("apply_readback_matched")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
