#!/usr/bin/env python3
"""Validate reference runtime-control and risk-policy documents.

The documents under ``examples/runtime_controls`` and ``examples/risk_policies``
are reviewed, public, secret-free references.  They are not read by any
runtime yet; this validator keeps them internally consistent so they can later
become the single source of truth for platform deploys.

Only the standard library is used so the check runs in the existing CI job.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping

ROOT = Path(__file__).resolve().parents[2]
RUNTIME_CONTROL_DIR = ROOT / "examples" / "runtime_controls"
RISK_POLICY_DIR = ROOT / "examples" / "risk_policies"

RUNTIME_CONTROL_SCHEMA_VERSION = "qsl.runtime_control.v1"
RISK_POLICY_SCHEMA_VERSION = "qsl.risk_policy.v1"
MODES = ("live", "paper", "dry_run")
TARGET_ID_PATTERN = re.compile(r"^[a-z0-9_-]+/[a-z0-9_-]+$")
# Real broker account identifiers must never appear in these public files.
ACCOUNT_LIKE_PATTERN = re.compile(r"\b(U\d{7,}|DU\d{6,}|\d{9,})\b")
TOLERANCE = 1e-9

RUNTIME_CONTROL_FIELDS = {
    "schema_version", "target_id", "platform_id", "strategy_profile", "description",
    "enabled", "mode", "cash_policy", "risk_limits_ref", "options_enabled",
}
RISK_POLICY_FIELDS = {
    "schema_version", "policy_id", "status", "description", "strategy_profile", "allowed_symbols",
    "product_leverage_factors", "nominal_caps", "total_nominal_exposure_cap",
    "total_effective_exposure_cap", "max_positions", "cash_policy", "options_enabled", "exit_parameters",
}


def _is_ratio(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
        and 0.0 <= float(value) <= 1.0
    )


def _check_cash_policy(prefix: str, cash: Any, errors: list[str]) -> None:
    if not isinstance(cash, Mapping):
        errors.append(f"{prefix}: cash_policy must be an object")
        return
    unknown = set(cash) - {"cash_only", "reserved_cash_ratio", "reserved_cash_floor_usd"}
    if unknown:
        errors.append(f"{prefix}: cash_policy has unknown fields {sorted(unknown)}")
    if type(cash.get("cash_only")) is not bool:
        errors.append(f"{prefix}: cash_policy.cash_only must be a boolean")
    if not _is_ratio(cash.get("reserved_cash_ratio")):
        errors.append(f"{prefix}: cash_policy.reserved_cash_ratio must be a number in [0, 1]")
    floor = cash.get("reserved_cash_floor_usd", 0)
    if isinstance(floor, bool) or not isinstance(floor, (int, float)) or floor < 0:
        errors.append(f"{prefix}: cash_policy.reserved_cash_floor_usd must be a non-negative number")


def validate_runtime_control(name: str, doc: Mapping[str, Any]) -> list[str]:
    """Mirror of QuantPlatformKit ``schemas/runtime-control.v1.schema.json``."""
    errors: list[str] = []
    unknown = set(doc) - RUNTIME_CONTROL_FIELDS
    if unknown:
        errors.append(f"{name}: unknown fields {sorted(unknown)}")
    if doc.get("schema_version") != RUNTIME_CONTROL_SCHEMA_VERSION:
        errors.append(f"{name}: schema_version must be {RUNTIME_CONTROL_SCHEMA_VERSION}")
    if not TARGET_ID_PATTERN.fullmatch(str(doc.get("target_id") or "")):
        errors.append(f"{name}: target_id must look like '<platform>/<target>'")
    for key in ("platform_id", "strategy_profile"):
        if not str(doc.get(key) or "").strip():
            errors.append(f"{name}: {key} is required")
    if type(doc.get("enabled")) is not bool:
        errors.append(f"{name}: enabled must be a boolean")
    if doc.get("mode") not in MODES:
        errors.append(f"{name}: mode must be one of {MODES}")
    if "options_enabled" in doc and type(doc["options_enabled"]) is not bool:
        errors.append(f"{name}: options_enabled must be a boolean")
    _check_cash_policy(name, doc.get("cash_policy"), errors)
    return errors


def validate_risk_policy(name: str, doc: Mapping[str, Any]) -> list[str]:
    """Structural and arithmetic consistency checks for a risk policy."""
    errors: list[str] = []
    unknown = set(doc) - RISK_POLICY_FIELDS
    if unknown:
        errors.append(f"{name}: unknown fields {sorted(unknown)}")
    if doc.get("schema_version") != RISK_POLICY_SCHEMA_VERSION:
        errors.append(f"{name}: schema_version must be {RISK_POLICY_SCHEMA_VERSION}")
    symbols = doc.get("allowed_symbols")
    caps = doc.get("nominal_caps")
    factors = doc.get("product_leverage_factors")
    if not isinstance(symbols, list) or not symbols or len(set(symbols)) != len(symbols):
        errors.append(f"{name}: allowed_symbols must be a non-empty list without duplicates")
        return errors
    if not isinstance(caps, Mapping) or set(caps) != set(symbols):
        errors.append(f"{name}: nominal_caps must cover exactly allowed_symbols")
        return errors
    if not isinstance(factors, Mapping) or set(factors) != set(symbols):
        errors.append(f"{name}: product_leverage_factors must cover exactly allowed_symbols")
        return errors
    total = doc.get("total_nominal_exposure_cap")
    effective = doc.get("total_effective_exposure_cap")
    if not _is_ratio(total):
        errors.append(f"{name}: total_nominal_exposure_cap must be in [0, 1]")
        return errors
    for symbol in symbols:
        if not _is_ratio(caps[symbol]):
            errors.append(f"{name}: nominal_caps.{symbol} must be in [0, 1]")
        elif caps[symbol] > total + TOLERANCE:
            errors.append(f"{name}: nominal_caps.{symbol} exceeds total_nominal_exposure_cap")
        if isinstance(factors[symbol], bool) or not isinstance(factors[symbol], int) or factors[symbol] < 1:
            errors.append(f"{name}: product_leverage_factors.{symbol} must be an integer >= 1")
    _check_cash_policy(name, doc.get("cash_policy"), errors)
    cash = doc.get("cash_policy") if isinstance(doc.get("cash_policy"), Mapping) else {}
    reserve = cash.get("reserved_cash_ratio")
    if _is_ratio(reserve) and total + reserve > 1.0 + TOLERANCE:
        errors.append(f"{name}: total_nominal_exposure_cap + reserved_cash_ratio must not exceed 1")
    if not errors:
        # Effective cap must not exceed the greediest allocation: fill the most
        # leveraged symbols first up to their caps until the nominal total is used.
        remaining = float(total)
        greediest = 0.0
        for symbol in sorted(symbols, key=lambda item: -factors[item]):
            used = min(float(caps[symbol]), remaining)
            greediest += used * factors[symbol]
            remaining -= used
        if not isinstance(effective, (int, float)) or isinstance(effective, bool) or effective < 0:
            errors.append(f"{name}: total_effective_exposure_cap must be a non-negative number")
        elif effective > greediest + 1e-6:
            errors.append(
                f"{name}: total_effective_exposure_cap {effective} exceeds the reachable maximum {greediest:.6f}"
            )
    max_positions = doc.get("max_positions")
    if isinstance(max_positions, bool) or not isinstance(max_positions, int) or max_positions < 1:
        errors.append(f"{name}: max_positions must be a positive integer")
    if type(doc.get("options_enabled")) is not bool:
        errors.append(f"{name}: options_enabled must be a boolean")
    return errors


def _iter_json(directory: Path) -> Iterable[Path]:
    return sorted(directory.rglob("*.json")) if directory.is_dir() else []


def _check_no_account_ids(name: str, text: str) -> list[str]:
    match = ACCOUNT_LIKE_PATTERN.search(text)
    return [f"{name}: looks like it contains a broker account identifier ({match.group(0)[:3]}...)"] if match else []


def validate_tree(control_dir: Path = RUNTIME_CONTROL_DIR, policy_dir: Path = RISK_POLICY_DIR) -> list[str]:
    errors: list[str] = []
    policy_ids: set[str] = set()
    for path in _iter_json(policy_dir):
        text = path.read_text(encoding="utf-8")
        doc = json.loads(text)
        errors.extend(_check_no_account_ids(path.name, text))
        errors.extend(validate_risk_policy(path.name, doc))
        policy_ids.add(str(doc.get("policy_id")))
    for path in _iter_json(control_dir):
        text = path.read_text(encoding="utf-8")
        doc = json.loads(text)
        errors.extend(_check_no_account_ids(path.name, text))
        errors.extend(validate_runtime_control(path.name, doc))
        ref = doc.get("risk_limits_ref")
        if ref is not None and ref not in policy_ids:
            errors.append(f"{path.name}: risk_limits_ref {ref!r} does not match any risk policy")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.parse_args(argv)
    errors = validate_tree()
    for error in errors:
        print(f"ERROR {error}", file=sys.stderr)
    if not errors:
        print("runtime-control reference files OK")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
