#!/usr/bin/env python3
"""Render a disabled, dry-run RuntimeControl from explicit local public files.

Default OFF produces no output and opens no input files. Opt in with
--preview-enabled; stdout is a preview envelope, never a deployment command.
No runtime, workflow, console, broker or cloud client calls this script.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from runtime_control_files import (
    TOLERANCE,
    _check_no_account_ids,
    validate_risk_policy,
    validate_runtime_control,
)


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON field")
        result[key] = value
    return result


def _reject_constant(_: str) -> None:
    raise ValueError("non-finite JSON number")


def load_json_object(path: Path) -> dict[str, Any]:
    """Read one explicit local JSON object; reject duplicate and non-finite input."""
    doc = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_unique_object, parse_constant=_reject_constant)
    if not isinstance(doc, dict):
        raise TypeError("input must be a JSON object")
    return doc


def _public_object(doc: Any, name: str) -> dict[str, Any]:
    if not isinstance(doc, Mapping):
        raise TypeError(f"{name} must be an object")
    # Copy through JSON to reject non-JSON values/non-finite numbers and avoid
    # mutating callers' nested dictionaries. This is not a general secret scrubber.
    text = _canonical(dict(doc))
    if _check_no_account_ids(name, text):
        raise ValueError(f"{name} contains an account-like identifier")
    return json.loads(text)


def render_preview(
    control: Mapping[str, Any] | None,
    policy: Mapping[str, Any] | None = None,
    *,
    preview_enabled: bool = False,
) -> dict[str, Any] | None:
    """Return a deterministic no-order preview; OFF returns None without parsing.

    Enabled/live/paper/options candidates are rejected, never silently rewritten.
    A referenced policy must be supplied explicitly and match the profile and
    policy ID. Its reserve ratio/floor can only raise the target reserve.
    Hashes cover canonical UTF-8 JSON without a trailing newline, not approval.
    """
    if type(preview_enabled) is not bool:
        raise TypeError("preview_enabled must be a bool")
    if not preview_enabled:
        return None
    doc = _public_object(control, "control")
    for key in ("platform_id", "strategy_profile"):
        if not isinstance(doc.get(key), str) or not doc[key].strip():
            raise ValueError(f"control {key} must be non-empty text")
    errors = validate_runtime_control("control", doc)
    if errors:
        raise ValueError("; ".join(errors))
    if doc["target_id"].split("/", 1)[0] != doc["platform_id"]:
        raise ValueError("target_id platform prefix does not match platform_id")
    if doc["enabled"] is not False or doc["mode"] != "dry_run" or doc.get("options_enabled", False) is not False:
        raise ValueError("preview requires enabled=false, mode=dry_run and options_enabled=false")
    cash = dict(doc["cash_policy"])
    cash.setdefault("reserved_cash_floor_usd", 0)
    policy_hash = None
    if "risk_limits_ref" in doc:
        ref = doc["risk_limits_ref"]
        if not isinstance(ref, str) or not ref.strip():
            raise ValueError("risk_limits_ref must be non-empty text")
        risk = _public_object(policy, "policy")
        symbols = risk.get("allowed_symbols")
        if not isinstance(symbols, list) or not all(isinstance(item, str) and item for item in symbols):
            raise ValueError("policy allowed_symbols must contain symbol strings")
        errors = validate_risk_policy("policy", risk)
        if errors:
            raise ValueError("; ".join(errors))
        if risk.get("policy_id") != ref or risk.get("strategy_profile") != doc["strategy_profile"]:
            raise ValueError("policy identity/profile does not match the control reference")
        policy_cash = risk["cash_policy"]
        if policy_cash["cash_only"] and not cash["cash_only"]:
            raise ValueError("policy requires cash-only")
        cash["reserved_cash_ratio"] = max(cash["reserved_cash_ratio"], policy_cash["reserved_cash_ratio"])
        cash["reserved_cash_floor_usd"] = max(
            cash["reserved_cash_floor_usd"], policy_cash.get("reserved_cash_floor_usd", 0)
        )
        if risk["total_nominal_exposure_cap"] + cash["reserved_cash_ratio"] > 1 + TOLERANCE:
            raise ValueError("effective reserve plus policy nominal cap exceeds one")
        policy_hash = hashlib.sha256(_canonical(risk).encode("utf-8")).hexdigest()
    elif policy is not None:
        raise ValueError("policy supplied without risk_limits_ref")
    rendered = {key: value for key, value in doc.items() if key != "description"}
    rendered.update(cash_policy=cash, options_enabled=False)
    encoded = _canonical(rendered)
    return {
        "preview_only": True,
        "no_order": True,
        "execution_authorized": False,
        "live_ready": False,
        "runtime_control_json": encoded,
        "runtime_control_sha256": hashlib.sha256(encoded.encode("utf-8")).hexdigest(),
        "risk_policy_sha256": policy_hash,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--preview-enabled", action="store_true", default=False)
    parser.add_argument("--control-file", type=Path)
    parser.add_argument("--risk-policy-file", type=Path)
    args = parser.parse_args(argv)
    if not args.preview_enabled:
        return 0
    if args.control_file is None:
        parser.error("--control-file is required when preview is enabled")
    try:
        control = load_json_object(args.control_file)
        policy = load_json_object(args.risk_policy_file) if args.risk_policy_file else None
        result = render_preview(control, policy, preview_enabled=True)
    except (OSError, ValueError, TypeError) as exc:
        # Report only the error category; local input can contain private text.
        print(f"runtime-control preview rejected ({type(exc).__name__}); check public input files", file=sys.stderr)
        return 1
    print(_canonical(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
