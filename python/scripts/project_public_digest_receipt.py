#!/usr/bin/env python3
"""Project a private digest receipt into a public, count-only evidence summary."""
from __future__ import annotations

import argparse
import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Mapping

from daily_digest_aggregator import CANDIDATE_STORE_FAILURE_REASONS
from daily_digest_resend_guard import HISTORY_ERRORS
from credential_maintenance_notify import READ_STATUSES, PHASES, DELIVERIES
from daily_digest_delivery_axes import (
    EVIDENCE_DELIVERY_STATUSES, EXECUTION_STATUSES, NOTIFICATION_DELIVERY_STATUSES, PERSISTENCE_STATUSES,
)

PUBLIC_FIELDS = (
    "schema_version", "business_day", "report_date", "recipient_scope", "layout", "locale", "run_count", "total_fills", "total_fills_status",
    "evidence_status", "message_chars", "status", "dry_run", "delivered", "test_message", "business_digest_failed",
)
PUBLIC_ENUMS = {
    "schema_version": {"qsl.daily_digest_receipt.v1", "qsl.daily_digest_delivery_receipt.v1"},
    "layout": {"v1", "sections_v2"}, "locale": {"zh", "en"},
    "total_fills_status": {"known", "unknown"},
    "evidence_status": {"has_runs", "verified_idle", "evidence_unknown"},
    "status": {"route_check", "dry_run", "blocked_missing_secrets", "delivered", "send_failed",
               "skipped_duplicate", "blocked_resend_guard", "business_digest_failed", "skipped_empty", "sending"},
}
WINDOW_FIELDS = ("timezone", "business_day", "report_date", "start_local", "end_local", "start_utc", "end_utc", "window_id")
COVERAGE_FIELDS = (
    "candidates_configured", "candidates_loaded", "candidates_count", "github_enabled",
    "github_sources_queried", "github_sources_matched", "has_source_failures", "is_complete_for_verified_idle",
    "stale_candidates_count",
    "missing_targets_count", "suppressed_candidates_count",
)
PUBLIC_FAILURE_REASONS = CANDIDATE_STORE_FAILURE_REASONS | {
    "github_token_missing", "invalid_repository", "github_api_error", "github_payload_invalid",
    "github_pagination_incomplete",
}
AXIS_VALUES = {
    "execution_status": EXECUTION_STATUSES, "evidence_persistence_status": PERSISTENCE_STATUSES,
    "evidence_delivery_status": EVIDENCE_DELIVERY_STATUSES, "notification_delivery_status": NOTIFICATION_DELIVERY_STATUSES,
}
MAINTENANCE_VALUES = {"read": READ_STATUSES, "phase": PHASES, "delivery": DELIVERIES}


def _enum(value: object, choices: set[str] | frozenset[str], unknown: str = "unknown") -> str:
    return value if isinstance(value, str) and value in choices else unknown


def _count(value: object) -> int | None:
    return value if type(value) is int and value >= 0 else None


def _date(value: object) -> str | None:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        return None
    return value


def _time(value: object, *, local: bool) -> str | None:
    pattern = (r"[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}" if local else
               r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)")
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        return None
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return None
    return value


def project_public_receipt(receipt: Mapping[str, Any], *, source_sha: str = "") -> dict[str, Any]:
    """Validate summary keys and values; retain unknowns without private prose."""
    public: dict[str, Any] = {}
    for key in PUBLIC_FIELDS:
        if key not in receipt:
            continue
        value = receipt[key]
        if key in PUBLIC_ENUMS:
            public[key] = _enum(value, PUBLIC_ENUMS[key], "evidence_unknown" if key == "evidence_status" else "unknown")
        elif key in {"dry_run", "delivered", "test_message", "business_digest_failed"}:
            public[key] = value if type(value) is bool else None
        elif key in {"business_day", "report_date"}:
            public[key] = _date(value)
        elif key == "recipient_scope":
            public[key] = value if isinstance(value, str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,40}", value) else "unknown"
        else:
            public[key] = _count(value)
    if "total_fills" in public and (public["total_fills"] is None or public.get("total_fills_status") != "known"):
        public["total_fills"], public["total_fills_status"] = None, "unknown"
    public["projection"] = "public_summary"
    guard = receipt.get("resend_guard")
    if isinstance(guard, Mapping):
        public["resend_guard"] = {
            "decision": _enum(guard.get("decision"), {"send", "skip", "blocked", "preview"}),
            "reason": _enum(guard.get("reason"), {
                "FIRST_SEND", "ALREADY_DELIVERED", "EXPLICIT_TEST_RESEND", "HISTORY_UNAVAILABLE",
                "DELIVERY_UNCERTAIN", "CONFIGURATION_INVALID", "UNSUPPORTED_EVENT", "LOCAL_EXECUTION", "DRY_RUN",
                "BUSINESS_WINDOW_NOT_CURRENT",
            }),
            "previous_failures": _count(guard.get("previous_failures")),
            "history_error": _enum(guard.get("history_error"), HISTORY_ERRORS | {""}),
            "history_attempts": _count(guard.get("history_attempts")),
        }
    if source_sha:
        if not isinstance(source_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", source_sha):
            raise ValueError("source_sha_invalid")
        public["source_sha"] = source_sha
    window = receipt.get("window")
    public["window"] = {}
    if isinstance(window, Mapping):
        for key in WINDOW_FIELDS:
            if key not in window:
                continue
            value = window[key]
            if key == "timezone":
                public["window"][key] = _enum(value, {"Asia/Shanghai", "Asia/Singapore"})
            elif key == "window_id":
                public["window"][key] = value if isinstance(value, str) and value == f"sgt-0600:{_date(window.get('business_day'))}" else None
            elif key in {"business_day", "report_date"}:
                public["window"][key] = _date(value)
            else:
                public["window"][key] = _time(value, local=key.endswith("_local"))
    coverage = receipt.get("source_coverage")
    public["source_coverage"] = {}
    if isinstance(coverage, Mapping):
        for key in COVERAGE_FIELDS:
            if key not in coverage:
                continue
            value = coverage[key]
            if key in {"candidates_configured", "candidates_loaded", "github_enabled",
                       "has_source_failures", "is_complete_for_verified_idle"}:
                public["source_coverage"][key] = value if type(value) is bool else None
            else:
                public["source_coverage"][key] = _count(value)
    public["failures"] = []
    failures = receipt.get("failures")
    if failures is None:
        failures = []
    elif not isinstance(failures, list):
        failures = [None]
    for item in failures:
        if not isinstance(item, Mapping):
            public["failures"].append({"source_kind": "unknown", "reason_code": "unrecognized_source_failure"})
            continue
        reason = _enum(item.get("reason_code"), PUBLIC_FAILURE_REASONS, "unrecognized_source_failure")
        public["failures"].append({
            "source_kind": ("candidate_store" if reason in CANDIDATE_STORE_FAILURE_REASONS else
                            "github_workflow" if reason in PUBLIC_FAILURE_REASONS else "unknown"),
            "reason_code": reason,
        })
    axes = receipt.get("delivery_axes") or {}
    if isinstance(axes, Mapping):
        public["delivery_axes"] = {
            key: _enum(value, AXIS_VALUES[key])
            for key, value in axes.items() if key in AXIS_VALUES
        }
    if "maintenance" in receipt:
        maintenance = receipt["maintenance"]
        maintenance = maintenance if isinstance(maintenance, Mapping) else {}
        public["maintenance"] = {
            key: _enum(maintenance.get(key), choices)
            for key, choices in MAINTENANCE_VALUES.items()
        }
        if public["maintenance"]["read"] != "ready":
            public["maintenance"].update(phase="unknown", delivery="unknown")
    return public


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-sha", default="")
    args = parser.parse_args(argv)
    raw = json.loads(args.input.read_text(encoding="utf-8"))
    if not isinstance(raw, Mapping):
        raise ValueError("receipt_must_be_object")
    public = project_public_receipt(raw, source_sha=args.source_sha)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(public, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
