#!/usr/bin/env python3
"""Build a bounded, no-order lifecycle snapshot for one runtime target.

This contract intentionally tracks configured target state separately from
execution evidence.  A target disabled by policy is not an unavailable broker,
and it must not be represented as a paper/live execution result.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping


SOURCE_SCHEMA_VERSION = "qsl_runtime_target_lifecycle_source_snapshot.v1"
PLATFORMS = frozenset({"alpaca", "binance", "firstrade", "ibkr", "longbridge", "qmt", "schwab"})
CONFIGURED_STATES = frozenset({"enabled", "disabled"})
EXECUTION_MODES = frozenset({"dry_run", "paper", "live"})
CHECK_STATUSES = frozenset({"pass", "attention", "not_due", "not_applicable", "unavailable"})
DISPOSITIONS = frozenset({"continue_enabled_monitoring", "continue_disabled_validation", "parked"})
REASON_CODES = frozenset(
    {
        "none",
        "target_intentionally_disabled",
        "runtime_guard_attention",
        "execution_heartbeat_attention",
        "monitoring_unavailable",
    }
)
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,127}$")
_TIMESTAMP = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")


class RuntimeTargetLifecycleError(ValueError):
    """Raised when a lifecycle snapshot would be ambiguous or unsafe."""


def _identifier(value: object, field: str) -> str:
    text = str(value or "").strip()
    if not _IDENTIFIER.fullmatch(text):
        raise RuntimeTargetLifecycleError(f"{field} must be a stable non-sensitive identifier")
    return text


def _choice(value: object, choices: frozenset[str], field: str) -> str:
    text = str(value or "").strip()
    if text not in choices:
        raise RuntimeTargetLifecycleError(f"{field} is unsupported")
    return text


def _timestamp(value: object | None) -> str:
    if value is None:
        return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    text = str(value).strip()
    if not _TIMESTAMP.fullmatch(text):
        raise RuntimeTargetLifecycleError("observed_at must be an RFC3339 UTC timestamp")
    try:
        datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise RuntimeTargetLifecycleError("observed_at must be a valid calendar timestamp") from exc
    return text


def _target_disposition(
    *,
    configured_state: str,
    runtime_guard: str,
    execution_heartbeat: str,
) -> tuple[str, str]:
    if runtime_guard == "attention":
        return "parked", "runtime_guard_attention"
    if execution_heartbeat == "attention":
        return "parked", "execution_heartbeat_attention"
    if runtime_guard == "unavailable" or execution_heartbeat == "unavailable":
        return "parked", "monitoring_unavailable"
    if configured_state == "disabled":
        if execution_heartbeat != "not_applicable":
            raise RuntimeTargetLifecycleError(
                "disabled targets require a not_applicable execution heartbeat"
            )
        return "continue_disabled_validation", "target_intentionally_disabled"
    if runtime_guard not in {"pass", "not_due"} or execution_heartbeat not in {"pass", "not_due"}:
        raise RuntimeTargetLifecycleError("enabled target monitoring state is incomplete")
    return "continue_enabled_monitoring", "none"


def normalize_deployment(value: object) -> dict[str, Any]:
    fields = {"runtime_enabled", "scheduler_state", "strategy_profile", "execution_mode"}
    if not isinstance(value, dict) or not fields.issubset(value) or set(value) - fields - {"observed_at"}:
        raise RuntimeTargetLifecycleError("deployment has invalid fields")
    enabled = value["runtime_enabled"]
    if enabled is not None and not isinstance(enabled, bool):
        raise RuntimeTargetLifecycleError("deployment runtime_enabled must be boolean or null")
    return {
        **({"observed_at": _timestamp(value["observed_at"])} if "observed_at" in value else {}),
        "runtime_enabled": enabled,
        "scheduler_state": _choice(value["scheduler_state"], frozenset({"enabled", "paused", "mixed", "missing", "unknown", "not_applicable"}), "scheduler_state"),
        "strategy_profile": None if value["strategy_profile"] is None else _identifier(value["strategy_profile"], "strategy_profile"),
        "execution_mode": None if value["execution_mode"] is None else _choice(value["execution_mode"], EXECUTION_MODES, "execution_mode"),
    }


def build_runtime_target_lifecycle_source_snapshot(
    *,
    source_id: object,
    target_id: object,
    platform: object,
    configured_state: object,
    execution_mode: object,
    runtime_guard: object,
    execution_heartbeat: object,
    observed_at: object | None = None,
    deployment: object | None = None,
) -> dict[str, Any]:
    """Create one sanitized target state record without execution authority."""
    normalized_source_id = _identifier(source_id, "source_id")
    normalized_target_id = _identifier(target_id, "target_id")
    normalized_platform = _choice(platform, PLATFORMS, "platform")
    normalized_state = _choice(configured_state, CONFIGURED_STATES, "configured_state")
    normalized_mode = _choice(execution_mode, EXECUTION_MODES, "execution_mode")
    normalized_guard = _choice(runtime_guard, CHECK_STATUSES, "runtime_guard")
    normalized_heartbeat = _choice(execution_heartbeat, CHECK_STATUSES, "execution_heartbeat")
    disposition, reason_code = _target_disposition(
        configured_state=normalized_state,
        runtime_guard=normalized_guard,
        execution_heartbeat=normalized_heartbeat,
    )
    timestamp = _timestamp(observed_at)
    return {
        "schema_version": SOURCE_SCHEMA_VERSION,
        "source_id": normalized_source_id,
        "generated_at": timestamp,
        "computed_at": timestamp,
        "data_status": "ready",
        "targets": [
            {
                "target_id": normalized_target_id,
                "target": {
                    "platform": normalized_platform,
                    "configured_state": normalized_state,
                    "execution_mode": normalized_mode,
                },
                "monitoring": {
                    "runtime_guard": normalized_guard,
                    "execution_heartbeat": normalized_heartbeat,
                },
                "disposition": {"code": disposition, "reason_code": reason_code},
                "no_order": True,
                **({"deployment": normalize_deployment(deployment)} if deployment is not None else {}),
            }
        ],
        "errors": [],
    }


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--target-id", required=True)
    parser.add_argument("--platform", required=True)
    parser.add_argument("--configured-state", required=True, choices=sorted(CONFIGURED_STATES))
    parser.add_argument("--execution-mode", required=True, choices=sorted(EXECUTION_MODES))
    parser.add_argument("--runtime-guard", required=True, choices=sorted(CHECK_STATUSES))
    parser.add_argument("--execution-heartbeat", required=True, choices=sorted(CHECK_STATUSES))
    parser.add_argument("--observed-at")
    parser.add_argument("--deployment-json")
    parser.add_argument("--output", required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    snapshot = build_runtime_target_lifecycle_source_snapshot(
        source_id=args.source_id,
        target_id=args.target_id,
        platform=args.platform,
        configured_state=args.configured_state,
        execution_mode=args.execution_mode,
        runtime_guard=args.runtime_guard,
        execution_heartbeat=args.execution_heartbeat,
        observed_at=args.observed_at,
        deployment=json.loads(args.deployment_json) if args.deployment_json else None,
    )
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
