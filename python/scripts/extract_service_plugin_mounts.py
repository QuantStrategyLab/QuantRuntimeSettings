#!/usr/bin/env python3
"""Extract one service target's existing plugin mounts without broadening them.

Cloud Run inventories can hold a distinct plugin-mount object for each service.
This utility is used by the central switch workflow when ``plugin_mode=current``:
it reads only the selected existing service target and emits its exact current
mount document.  It never resolves, adds, or rewrites a plugin.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


class TargetNotFoundError(ValueError):
    """Raised when the requested incumbent cannot be identified safely."""


def _entry_service_name(entry: dict[str, Any]) -> str:
    for field in ("service", "service_name", "cloud_run_service"):
        value = entry.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    runtime_target = entry.get("runtime_target")
    if isinstance(runtime_target, dict):
        value = runtime_target.get("service_name")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _entry_target_name(entry: dict[str, Any]) -> str:
    runtime_target = entry.get("runtime_target")
    if not isinstance(runtime_target, dict):
        return ""
    for field in ("deployment_selector", "account_scope"):
        value = runtime_target.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _target_entries(payload: object) -> list[dict[str, Any]]:
    raw_entries = payload.get("targets") if isinstance(payload, dict) else payload
    if not isinstance(raw_entries, list) or any(not isinstance(item, dict) for item in raw_entries):
        raise ValueError("service targets must be an array of objects")
    return [dict(item) for item in raw_entries]


def _select_entry(
    entries: list[dict[str, Any]],
    *,
    service_name: str,
    target_name: str,
) -> dict[str, Any]:
    if service_name:
        matches = [entry for entry in entries if _entry_service_name(entry) == service_name]
    else:
        matches = [entry for entry in entries if _entry_target_name(entry) == target_name]
    if not matches:
        description = f"service {service_name!r}" if service_name else f"target {target_name!r}"
        raise TargetNotFoundError(f"existing {description} was not found")
    if len(matches) != 1:
        description = f"service {service_name!r}" if service_name else f"target {target_name!r}"
        raise ValueError(f"existing {description} is ambiguous")
    return matches[0]


def _mount_document(entry: dict[str, Any], mounts_variable: str) -> dict[str, Any]:
    nested_env = entry.get("env")
    nested_value = nested_env.get(mounts_variable) if isinstance(nested_env, dict) else None
    top_level_value = entry.get(mounts_variable)
    if nested_value is not None and top_level_value is not None and nested_value != top_level_value:
        raise ValueError(f"{mounts_variable} has conflicting top-level and env values")
    value = nested_value if nested_value is not None else top_level_value
    if value is None:
        return {"strategy_plugins": []}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{mounts_variable} must contain valid JSON") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{mounts_variable} must be an object")
    mounts = value.get("strategy_plugins")
    if not isinstance(mounts, list) or any(not isinstance(item, dict) for item in mounts):
        raise ValueError(f"{mounts_variable}.strategy_plugins must be an array of objects")
    return {"strategy_plugins": [dict(item) for item in mounts]}


def extract_service_plugin_mounts(
    payload: object,
    *,
    mounts_variable: str,
    service_name: str = "",
    target_name: str = "",
) -> dict[str, Any]:
    """Return the exact current mount document for one unambiguous service."""

    mounts_variable = mounts_variable.strip()
    service_name = service_name.strip()
    target_name = target_name.strip()
    if not mounts_variable:
        raise ValueError("mounts_variable is required")
    if not service_name and not target_name:
        raise ValueError("service_name or target_name is required")
    entry = _select_entry(
        _target_entries(payload),
        service_name=service_name,
        target_name=target_name,
    )
    return _mount_document(entry, mounts_variable)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service-targets-file", required=True, type=Path)
    parser.add_argument("--mounts-variable", required=True)
    parser.add_argument("--service-name", default="")
    parser.add_argument("--target-name", default="")
    parser.add_argument("--output", required=True, type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        payload = json.loads(args.service_targets_file.read_text(encoding="utf-8"))
        mounts = extract_service_plugin_mounts(
            payload,
            mounts_variable=args.mounts_variable,
            service_name=args.service_name,
            target_name=args.target_name,
        )
    except TargetNotFoundError as exc:
        print(f"error: {exc}")
        return 3
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}")
        return 2
    args.output.write_text(json.dumps(mounts, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
