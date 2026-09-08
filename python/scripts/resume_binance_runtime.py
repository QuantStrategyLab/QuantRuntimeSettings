"""Restore only Binance's existing external switch, never its recovery authority.

The platform re-reads the private committed recovery control before execution.
This configuration writer neither reads nor changes that control, the frozen
target, risk settings or broker state. It must not report business recovery.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from runtime_settings import _stop_request_identity, build_stop_assignments, read_stop_variables


def validate_request(request):
    if not isinstance(request, dict) or set(request) != {
        "target_id", "runtime_target", "github", "runtime_target_sha256"
    }:
        raise ValueError("resume_request_invalid")
    identity_request = {key: value for key, value in request.items() if key != "runtime_target_sha256"}
    _, identity, github = _stop_request_identity(identity_request)
    if (identity["platform_id"] != "binance"
            or github != {"repository": "QuantStrategyLab/BinancePlatform", "variable_scope": "repository"}
            or not isinstance(request["runtime_target_sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", request["runtime_target_sha256"])):
        raise ValueError("resume_request_invalid")
    return identity_request


def validate_source(request, variables):
    identity_request = validate_request(request)
    build_stop_assignments(identity_request, variables)  # Reuse exact current identity checks.
    raw = variables["RUNTIME_TARGET_JSON"]
    if hashlib.sha256(raw.encode()).hexdigest() != request["runtime_target_sha256"]:
        raise ValueError("resume_target_changed")
    target = json.loads(raw)
    continuity = target.get("live_continuity") or {}
    if ("CLOUD_RUN_SERVICE_TARGETS_JSON" in variables
            or variables.get("RUNTIME_TARGET_ENABLED") != "false"
            or variables.get("BINANCE_RECOVERY_CONTROL_ENABLED") != "true"
            or variables.get("BINANCE_DRY_RUN", "false") != "false"
            or variables.get("STRATEGY_PROFILE", "crypto_live_pool_rotation") != "crypto_live_pool_rotation"
            or target.get("strategy_profile") != "crypto_live_pool_rotation"
            or target.get("execution_mode") != "live" or target.get("dry_run_only") is not False
            or not isinstance(continuity, dict)
            or continuity.get("baseline_kind") != "legacy_authorized"
            or continuity.get("state") not in {"RECONCILE_ONLY", "ACTIVE_LKG"}
            or not isinstance(continuity.get("baseline_id"), str) or not continuity["baseline_id"].strip()
            or not isinstance(continuity.get("captured_at"), str) or not continuity["captured_at"].strip()
            or not re.fullmatch(r"[a-f0-9]{64}", str(continuity.get("baseline_target_sha256", "")))):
        raise ValueError("resume_existing_legacy_target_required")


def execute_resume(request, *, apply=False):
    validate_request(request)
    github = request["github"]
    before = read_stop_variables(github)
    validate_source(request, before)
    if not apply:
        return dict(configured=False, platform_applied=False, preview=True)
    # Shared workflow concurrency protects known writers. This comparison is
    # a stale-read check, not an atomic CAS against external administrators.
    if read_stop_variables(github) != before:
        raise ValueError("resume_source_changed")
    try:
        result = subprocess.run(
            ["gh", "variable", "set", "RUNTIME_TARGET_ENABLED", "--repo", github["repository"]],
            input="true", text=True, capture_output=True, timeout=60, check=False,
        )
        if result.returncode != 0:
            raise ValueError
    except (OSError, subprocess.SubprocessError, ValueError):
        raise ValueError("resume_write_outcome_unverified") from None
    try:
        after = read_stop_variables(github)
    except ValueError:
        raise ValueError("resume_readback_unverified") from None
    if after != dict(before, RUNTIME_TARGET_ENABLED="true"):
        raise ValueError("resume_readback_unverified")
    return dict(configured=True, platform_applied=False, preview=False)


def main():
    try:
        if os.environ.get("GITHUB_REF") != "refs/heads/main":
            raise ValueError("resume_main_required")
        path = Path(os.environ["GITHUB_EVENT_PATH"])
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
            raise ValueError("resume_event_invalid")
        inputs = json.loads(path.read_text())["inputs"]
        apply = inputs.get("apply") in (True, "true")
        if apply and inputs.get("confirm") != "RESUME_EXISTING":
            raise ValueError("resume_confirmation_required")
        result = execute_resume(json.loads(inputs["resume_request"]), apply=apply)
    except (OSError, ValueError, TypeError, KeyError):
        print("resume_not_verified; check the existing run before retrying", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
