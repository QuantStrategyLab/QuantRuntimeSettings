#!/usr/bin/env python3
"""Build a fail-closed, read-only execution-evidence source snapshot.

The input is one or more ``runtime_report.v1`` documents already exported by
platform runtimes.  This module deliberately does not fetch reports, accept
credentials, call a broker, or publish a network request.  It only projects
the narrow, non-sensitive identity fields that the Strategy Switch Console
requires for its read-only execution-evidence board.

An eligible report can attest that a runtime loaded a specific strategy
revision and was configured for a paper or live lane.  It cannot attest data
quality, broker acceptance, fills, positions, or capital.  Those fields stay
``pending`` and the resulting recommendation is always ``parked``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any


SOURCE_SCHEMA_VERSION = "qsl_execution_evidence_source_snapshot.v1"
RUNTIME_REPORT_SCHEMA_VERSION = "runtime_report.v1"
EXECUTION_RECEIPT_SCHEMA_VERSION = "qsl_execution_receipt.v1"
_PLATFORM_ALIASES = {
    "alpaca": "alpaca",
    "binance": "binance",
    "charles-schwab": "schwab",
    "charles_schwab": "schwab",
    "firstrade": "firstrade",
    "ibkr": "ibkr",
    "interactive-brokers": "ibkr",
    "interactive_brokers": "ibkr",
    "longbridge": "longbridge",
    "qmt": "qmt",
    "schwab": "schwab",
}
_DOMAINS = frozenset({"us_equity", "hk_equity", "cn_equity", "crypto"})
_REVISION = re.compile(r"^[0-9a-f]{40}$")
_IDENTIFIER = re.compile(r"^[A-Za-z0-9._=-]{1,128}$")
_FORBIDDEN_TEXT = re.compile(r"(?:secret|token|password|credential|api[_-]?key|account|order|fill|position|capital)", re.IGNORECASE)
_EXECUTION_RECEIPT_ID = re.compile(r"^execution-receipt\.[0-9a-f]{32}$")
_EXECUTION_RECEIPT_OUTCOMES = frozenset(
    {
        "not_due",
        "no_action",
        "risk_blocked",
        "submitted",
        "broker_acknowledged",
        "partially_filled",
        "filled",
        "reconciliation_required",
        "failed",
    }
)
_EXECUTION_RECEIPT_CONFIRMATIONS = frozenset(
    {
        "not_applicable",
        "not_observed",
        "acknowledged",
        "partially_filled",
        "filled",
        "reconciliation_required",
    }
)
_EXECUTION_RECEIPT_OUTCOME_CONFIRMATIONS = {
    "not_due": frozenset({"not_applicable"}),
    "no_action": frozenset({"not_applicable"}),
    "risk_blocked": frozenset({"not_applicable"}),
    "submitted": frozenset({"not_observed"}),
    "broker_acknowledged": frozenset({"acknowledged"}),
    "partially_filled": frozenset({"partially_filled"}),
    "filled": frozenset({"filled"}),
    "reconciliation_required": frozenset({"reconciliation_required"}),
    "failed": frozenset({"not_applicable", "not_observed", "reconciliation_required"}),
}


class ExecutionEvidenceProjectionError(ValueError):
    """Raised when a projection request is malformed."""


def build_execution_evidence_source_snapshot(
    reports: Iterable[Mapping[str, Any]],
    *,
    source_id: str,
    now: datetime | None = None,
    max_report_age: timedelta = timedelta(hours=36),
) -> dict[str, Any]:
    """Project eligible runtime reports into the Worker source schema.

    Invalid or legacy reports are represented only by bounded error codes. No
    source value from a report's diagnostics, summaries, artifacts, or errors
    is copied to the output.
    """
    normalized_source_id = _identity(source_id, "source_id")
    computed_at_value = _normalize_now(now)
    if max_report_age < timedelta(minutes=5) or max_report_age > timedelta(days=7):
        raise ExecutionEvidenceProjectionError("max_report_age is outside safe bounds")
    latest_by_deployment: dict[str, tuple[datetime, dict[str, Any]]] = {}
    errors: set[str] = set()

    for report in reports:
        try:
            deployment, observed_at = _project_runtime_report(report)
        except ExecutionEvidenceProjectionError as exc:
            errors.add(str(exc))
            continue
        if observed_at > computed_at_value + timedelta(minutes=5):
            errors.add("runtime_report_timestamp_future")
            continue
        if observed_at < computed_at_value - max_report_age:
            errors.add("runtime_report_stale")
            continue
        previous = latest_by_deployment.get(deployment["deployment_id"])
        if previous is None or observed_at > previous[0]:
            latest_by_deployment[deployment["deployment_id"]] = (observed_at, deployment)

    selected = [entry for _, entry in sorted(latest_by_deployment.items())]
    deployments = [entry[1] for entry in selected]
    if not deployments:
        errors.add("runtime_report_no_eligible_records")
    return {
        "schema_version": SOURCE_SCHEMA_VERSION,
        "source_id": normalized_source_id,
        # The Worker uses the older of generated_at/computed_at for freshness.
        # Preserve the oldest included observation so a fresh collection cannot
        # make an old platform report appear current.
        "generated_at": _timestamp(min(entry[0] for entry in selected)) if selected else None,
        "computed_at": _timestamp(computed_at_value),
        "data_status": "ready" if deployments else "unavailable",
        "deployments": deployments,
        "errors": sorted(errors)[:20],
    }


def load_runtime_report(path: str | Path) -> dict[str, Any]:
    """Load one report while rejecting duplicate JSON keys."""
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=_reject_duplicate_keys)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise ExecutionEvidenceProjectionError("runtime_report_input_invalid") from exc
    if not isinstance(value, dict):
        raise ExecutionEvidenceProjectionError("runtime_report_input_invalid")
    return value


def _project_runtime_report(report: Mapping[str, Any]) -> tuple[dict[str, Any], datetime]:
    if not isinstance(report, Mapping) or report.get("schema_version") != RUNTIME_REPORT_SCHEMA_VERSION:
        raise ExecutionEvidenceProjectionError("runtime_report_schema_unsupported")

    platform = _PLATFORM_ALIASES.get(str(report.get("platform") or "").strip().lower())
    profile = _identity(report.get("strategy_profile"), "runtime_report_strategy_invalid")
    domain = str(report.get("strategy_domain") or "").strip()
    if platform is None or domain not in _DOMAINS:
        raise ExecutionEvidenceProjectionError("runtime_report_target_invalid")

    runtime_target = _mapping(report.get("runtime_target"), "runtime_report_target_invalid")
    execution_mode = str(runtime_target.get("execution_mode") or "").strip()
    dry_run_only = runtime_target.get("dry_run_only")
    if execution_mode not in {"paper", "live"} or not isinstance(dry_run_only, bool):
        raise ExecutionEvidenceProjectionError("runtime_report_target_invalid")
    report_dry_run = report.get("dry_run")
    if not isinstance(report_dry_run, bool):
        raise ExecutionEvidenceProjectionError("runtime_report_target_invalid")
    if report_dry_run != dry_run_only or (execution_mode == "paper") != dry_run_only:
        raise ExecutionEvidenceProjectionError("runtime_report_lane_mismatch")

    receipt = _mapping(report.get("runtime_release_receipt"), "runtime_report_release_unattested")
    release = _mapping(receipt.get("strategy_release"), "runtime_report_release_unattested")
    revision = release.get("strategy_revision")
    if receipt.get("attestation_state") != "self_attested" or not isinstance(revision, str) or not _REVISION.fullmatch(revision):
        raise ExecutionEvidenceProjectionError("runtime_report_release_unattested")

    observed_at = _report_timestamp(report)
    execution_receipt = _project_execution_receipt(
        report.get("execution_receipt"),
        platform=platform,
        strategy_profile=profile,
        strategy_revision=revision,
        execution_mode=execution_mode,
        report_observed_at=observed_at,
    )
    deployment_id = _deployment_id(
        platform=platform,
        deploy_target=report.get("deploy_target"),
        service_name=report.get("service_name"),
        strategy_profile=profile,
        environment=execution_mode,
    )
    target_execution, reason_code = _execution_evidence_from_receipt(execution_receipt)
    deployment = {
        "deployment_id": deployment_id,
        "strategy": {
            "candidate_id": profile,
            "candidate_kind": "individual",
            "domain": domain,
            "strategy_revision": revision,
        },
        "target": {"platform": platform, "environment": execution_mode},
        "capabilities": {"shadow": "unknown", "paper": "unknown"},
        "evidence": {
            "strategy": "verified",
            "target_data": "pending",
            "target_execution": target_execution,
        },
        "recommendation": {
            "code": "parked",
            "reason_code": reason_code,
        },
    }
    if execution_receipt is not None:
        deployment["execution_receipt"] = execution_receipt
    return deployment, observed_at


def _project_execution_receipt(
    value: object,
    *,
    platform: str,
    strategy_profile: str,
    strategy_revision: str,
    execution_mode: str,
    report_observed_at: datetime,
) -> dict[str, str] | None:
    """Project one exact, privacy-safe outcome receipt from a runtime report.

    The report itself remains the source of identity.  Any receipt that does
    not match its platform, strategy revision and lane is discarded instead of
    being used to make execution look verified.
    """

    if value is None:
        return None
    receipt = _mapping(value, "runtime_report_execution_receipt_invalid")
    expected_fields = {
        "schema_version",
        "receipt_id",
        "platform",
        "strategy_profile",
        "strategy_revision",
        "execution_mode",
        "outcome",
        "broker_confirmation",
        "observed_at",
    }
    if set(receipt) != expected_fields or receipt.get("schema_version") != EXECUTION_RECEIPT_SCHEMA_VERSION:
        raise ExecutionEvidenceProjectionError("runtime_report_execution_receipt_invalid")
    receipt_platform = _PLATFORM_ALIASES.get(str(receipt.get("platform") or "").strip().lower())
    receipt_profile = _identity(receipt.get("strategy_profile"), "runtime_report_execution_receipt_invalid")
    receipt_revision = str(receipt.get("strategy_revision") or "").strip()
    receipt_mode = str(receipt.get("execution_mode") or "").strip()
    outcome = str(receipt.get("outcome") or "").strip()
    confirmation = str(receipt.get("broker_confirmation") or "").strip()
    receipt_id = str(receipt.get("receipt_id") or "").strip()
    receipt_at = _receipt_timestamp(receipt.get("observed_at"))
    if (
        receipt_platform != platform
        or receipt_profile != strategy_profile
        or receipt_revision != strategy_revision
        or receipt_mode != execution_mode
        or not _REVISION.fullmatch(receipt_revision)
        or outcome not in _EXECUTION_RECEIPT_OUTCOMES
        or confirmation not in _EXECUTION_RECEIPT_CONFIRMATIONS
        or confirmation not in _EXECUTION_RECEIPT_OUTCOME_CONFIRMATIONS[outcome]
        or not _EXECUTION_RECEIPT_ID.fullmatch(receipt_id)
    ):
        raise ExecutionEvidenceProjectionError("runtime_report_execution_receipt_invalid")
    expected_id = _execution_receipt_id(
        platform=receipt_platform,
        strategy_profile=receipt_profile,
        strategy_revision=receipt_revision,
        execution_mode=receipt_mode,
        outcome=outcome,
        broker_confirmation=confirmation,
        observed_at=_timestamp(receipt_at),
    )
    if receipt_id != expected_id:
        raise ExecutionEvidenceProjectionError("runtime_report_execution_receipt_invalid")
    if receipt_at > report_observed_at + timedelta(minutes=5) or receipt_at < report_observed_at - timedelta(hours=24):
        raise ExecutionEvidenceProjectionError("runtime_report_execution_receipt_timestamp_mismatch")
    return {
        "outcome": outcome,
        "broker_confirmation": confirmation,
        "observed_at": _timestamp(receipt_at),
    }


def _execution_evidence_from_receipt(
    receipt: Mapping[str, str] | None,
) -> tuple[str, str]:
    if receipt is None:
        return "pending", "target_execution_evidence_missing"
    outcome = receipt["outcome"]
    if outcome == "reconciliation_required":
        return "unavailable", "target_execution_reconciliation_required"
    if outcome == "failed":
        return "unavailable", "target_execution_receipt_failed"
    return "verified", "target_execution_receipt_observed"


def _mapping(value: object, error_code: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ExecutionEvidenceProjectionError(error_code)
    return value


def _identity(value: object, error_code: str) -> str:
    text = str(value or "").strip()
    if not _IDENTIFIER.fullmatch(text) or _FORBIDDEN_TEXT.search(text):
        raise ExecutionEvidenceProjectionError(error_code)
    return text


def _report_timestamp(report: Mapping[str, Any]) -> datetime:
    for key in ("finished_at", "started_at"):
        value = report.get(key)
        if not isinstance(value, str) or not value.strip():
            continue
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            continue
        if parsed.tzinfo is not None and parsed.utcoffset() is not None:
            return parsed.astimezone(UTC)
    raise ExecutionEvidenceProjectionError("runtime_report_timestamp_invalid")


def _receipt_timestamp(value: object) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ExecutionEvidenceProjectionError("runtime_report_execution_receipt_invalid")
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise ExecutionEvidenceProjectionError("runtime_report_execution_receipt_invalid") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ExecutionEvidenceProjectionError("runtime_report_execution_receipt_invalid")
    return parsed.astimezone(UTC).replace(microsecond=0)


def _execution_receipt_id(
    *,
    platform: str,
    strategy_profile: str,
    strategy_revision: str,
    execution_mode: str,
    outcome: str,
    broker_confirmation: str,
    observed_at: str,
) -> str:
    payload = {
        "schema_version": EXECUTION_RECEIPT_SCHEMA_VERSION,
        "platform": platform,
        "strategy_profile": strategy_profile,
        "strategy_revision": strategy_revision,
        "execution_mode": execution_mode,
        "outcome": outcome,
        "broker_confirmation": broker_confirmation,
        "observed_at": observed_at,
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    ).hexdigest()
    return f"execution-receipt.{digest[:32]}"


def _deployment_id(
    *,
    platform: str,
    deploy_target: object,
    service_name: object,
    strategy_profile: str,
    environment: str,
) -> str:
    material = "\x1f".join(
        [
            platform,
            _safe_label(deploy_target),
            _safe_label(service_name),
            strategy_profile,
            environment,
        ]
    )
    # A digest is stable across reports and avoids exposing service/account-like
    # labels in the console-facing deployment identity.
    return f"runtime.{platform}.{hashlib.sha256(material.encode('utf-8')).hexdigest()[:24]}"


def _safe_label(value: object) -> str:
    text = str(value or "").strip()
    if not text or len(text) > 256 or _FORBIDDEN_TEXT.search(text):
        return "unavailable"
    return text


def _timestamp(value: datetime) -> str:
    return value.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _normalize_now(value: datetime | None) -> datetime:
    resolved = value or datetime.now(UTC)
    if resolved.tzinfo is None or resolved.utcoffset() is None:
        raise ExecutionEvidenceProjectionError("now must be timezone-aware")
    return resolved.astimezone(UTC)


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-id", required=True, help="stable non-sensitive source identity")
    parser.add_argument("--runtime-report", action="append", default=[], help="path to one runtime_report.v1 JSON document")
    parser.add_argument(
        "--max-report-age-hours",
        type=float,
        default=36,
        help="discard reports older than this bounded freshness window (default: 36)",
    )
    parser.add_argument("--output", required=True, help="path for the generated source snapshot")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    reports: list[Mapping[str, Any]] = []
    input_errors: list[str] = []
    for path in args.runtime_report:
        try:
            reports.append(load_runtime_report(path))
        except ExecutionEvidenceProjectionError as exc:
            input_errors.append(str(exc))
    snapshot = build_execution_evidence_source_snapshot(
        reports,
        source_id=args.source_id,
        max_report_age=timedelta(hours=args.max_report_age_hours),
    )
    snapshot["errors"] = sorted(set([*snapshot["errors"], *input_errors]))[:20]
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
