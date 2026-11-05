"""Offline preflight for the fixed cand-{sha8} tagged-URL contract.

Local Option B implementation: validate exact names, never rename or allocate tags.
The combined Cloud Run service + traffic tag budget is 46 characters.
"""
from __future__ import annotations

import json
import re
from typing import Any

SERVICE_TAG_BUDGET = 46
CANDIDATE_TAG_LENGTH = 13  # cand- + eight hexadecimal commit characters


def validate_service_name(service_name: Any) -> None:
    """Refuse invalid or over-budget names without exposing resource identities."""
    if not isinstance(service_name, str) or not re.fullmatch(r"[a-z](?:[a-z0-9-]*[a-z0-9])?", service_name):
        raise ValueError("service_name must use lowercase ASCII letters, digits and internal hyphens")
    headroom = SERVICE_TAG_BUDGET - len(service_name)
    if headroom < CANDIDATE_TAG_LENGTH:
        classification = "TAG_IMPOSSIBLE" if headroom < 1 else "TAG_TIGHT"
        raise ValueError(
            f"service_name {classification}: length={len(service_name)}, tag_headroom={headroom}; "
            f"cand-{{sha8}} requires {CANDIDATE_TAG_LENGTH} characters within the "
            f"{SERVICE_TAG_BUDGET}-character service+tag budget. "
            "Inventory generation refused; existing services must not be silently renamed."
        )


def validate_service_inventory(value: Any) -> None:
    """Check every retained name alias before a complete inventory is emitted."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            raise ValueError("service inventory must contain valid JSON") from None
    entries = value.get("targets") if isinstance(value, dict) else value
    if not isinstance(entries, list):
        raise ValueError("service inventory targets must be an array")
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("service inventory entries must be objects")
        names = [entry[key] for key in ("service", "service_name", "cloud_run_service") if key in entry]
        if "runtime_target" in entry:
            runtime_target = entry["runtime_target"]
            if not isinstance(runtime_target, dict):
                raise ValueError("service inventory runtime_target must be an object")
            if "service_name" in runtime_target:
                names.append(runtime_target["service_name"])
        if not names:
            raise ValueError("service inventory entry requires service_name")
        for name in names:
            validate_service_name(name)
