#!/usr/bin/env python3
"""Validate the bounded risk-control contract for automated P4/P5 observation.

This module never connects to a broker, reads credentials, submits an order, or
starts a scheduler.  It makes the policy an eventual paper/shadow gateway must
consume precise enough to validate before every cycle.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Mapping


RISK_CONTROL_SCHEMA_ID = "qsl.forward_observation_risk_control.v1"
_DIGEST_ALGORITHM = "sha256"
_MAX_VALIDITY = timedelta(days=31)
_STAGE_TO_LANE = {
    "PAPER_DRY_RUN": "PAPER_BROKER",
    "SHADOW": "SHADOW_LEDGER",
}
_IDENTITY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$")
_REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_TIMESTAMP_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
_FORBIDDEN_KEY_PATTERN = re.compile(
    r"credential|secret|token|password|cookie|jwt|private(?:[_-]?key)?|access[_-]?key|"
    r"broker[_-]?(?:url|endpoint|account)|order[_-]?payload|account[_-]?(?:id|number)|"
    r"position|balance|fill|capital(?:[_-]?(?:amount|balance|value))?",
    re.IGNORECASE,
)
_ALLOWED_SENSITIVE_KEYS = {"max_open_positions"}
_URL_PATTERN = re.compile(r"[a-z][a-z0-9+.-]*://", re.IGNORECASE)
_ROOT_FIELDS = {
    "schema",
    "risk_policy_id",
    "risk_policy_version",
    "created_at",
    "effective_at",
    "expires_at",
    "digest_algorithm",
    "stage",
    "execution_lane",
    "candidate",
    "source_evidence",
    "limits",
    "circuit_breaker",
    "risk_policy_sha256",
}
_CANDIDATE_FIELDS = {
    "candidate_id",
    "candidate_kind",
    "domain",
    "strategy_repository",
    "strategy_revision",
}
_SOURCE_EVIDENCE_FIELDS = {
    "p1_input_digest",
    "p2_config_digest",
    "p3_evidence_id",
    "producer_revision",
}
_LIMIT_FIELDS = {
    "allowed_symbols_sha256",
    "max_open_positions",
    "max_gross_notional_cents",
    "max_single_decision_notional_cents",
    "max_daily_turnover_notional_cents",
    "max_decisions_per_session",
    "max_consecutive_failures",
}
_CIRCUIT_BREAKER_FIELDS = {
    "require_market_session",
    "halt_on_data_unavailable",
    "halt_on_evidence_mismatch",
    "halt_on_reconciliation_failure",
    "halt_on_execution_error",
    "halt_on_unknown_execution_outcome",
    "require_reconciliation_before_next_cycle",
}


class ForwardObservationRiskControlError(ValueError):
    """Raised when a P4/P5 risk-control contract is invalid or unsafe."""


def _fail(message: str) -> None:
    raise ForwardObservationRiskControlError(message)


def _expect_object(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        _fail(f"{path} must be an object")
    return value


def _expect_exact_keys(value: Mapping[str, Any], expected: set[str], path: str) -> None:
    missing = sorted(expected - set(value))
    unknown = sorted(set(value) - expected)
    if missing:
        _fail(f"{path} missing required field(s): {', '.join(missing)}")
    if unknown:
        _fail(f"{path} has unknown field(s): {', '.join(unknown)}")


def _reject_non_finite_or_null(value: Any, path: str) -> None:
    if value is None:
        _fail(f"{path} must not be null")
    if isinstance(value, float) and not math.isfinite(value):
        _fail(f"{path} contains a non-finite number")
    if isinstance(value, Mapping):
        for key, child in value.items():
            if not isinstance(key, str):
                _fail(f"{path} contains a non-string key")
            _reject_non_finite_or_null(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_non_finite_or_null(child, f"{path}[{index}]")


def _reject_forbidden_material(value: Any, path: str) -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            if key not in _ALLOWED_SENSITIVE_KEYS and _FORBIDDEN_KEY_PATTERN.search(key):
                _fail(f"{path}.{key} is forbidden in a forward-observation risk control")
            _reject_forbidden_material(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_forbidden_material(child, f"{path}[{index}]")
    elif isinstance(value, str) and _URL_PATTERN.search(value):
        _fail(f"{path} contains a forbidden URL")


def _expect_identity(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _IDENTITY_PATTERN.fullmatch(value):
        _fail(f"{path} must be a lowercase immutable identity")
    return value


def _expect_sha256(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _SHA256_PATTERN.fullmatch(value):
        _fail(f"{path} must be a lowercase SHA-256 digest")
    return value


def _expect_revision(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _REVISION_PATTERN.fullmatch(value):
        _fail(f"{path} must be a lowercase 40-character revision")
    return value


def _parse_timestamp(value: Any, path: str) -> datetime:
    if not isinstance(value, str) or not _TIMESTAMP_PATTERN.fullmatch(value):
        _fail(f"{path} must be an RFC3339 UTC timestamp with whole seconds")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise ForwardObservationRiskControlError(f"{path} must be a valid calendar timestamp") from exc
    return parsed.replace(tzinfo=UTC)


def _expect_positive_integer(value: Any, path: str, *, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > maximum:
        _fail(f"{path} must be an integer between 1 and {maximum}")
    return value


def _validate_candidate(value: Any) -> Mapping[str, Any]:
    candidate = _expect_object(value, "candidate")
    _expect_exact_keys(candidate, _CANDIDATE_FIELDS, "candidate")
    _expect_identity(candidate["candidate_id"], "candidate.candidate_id")
    if candidate["candidate_kind"] not in {"individual", "combo", "plugin"}:
        _fail("candidate.candidate_kind must be individual, combo, or plugin")
    _expect_identity(candidate["domain"], "candidate.domain")
    if not isinstance(candidate["strategy_repository"], str) or not _REPOSITORY_PATTERN.fullmatch(
        candidate["strategy_repository"]
    ):
        _fail("candidate.strategy_repository must be an owner/repository identity, not a URL")
    _expect_revision(candidate["strategy_revision"], "candidate.strategy_revision")
    return candidate


def _validate_source_evidence(value: Any) -> Mapping[str, Any]:
    evidence = _expect_object(value, "source_evidence")
    _expect_exact_keys(evidence, _SOURCE_EVIDENCE_FIELDS, "source_evidence")
    _expect_sha256(evidence["p1_input_digest"], "source_evidence.p1_input_digest")
    _expect_sha256(evidence["p2_config_digest"], "source_evidence.p2_config_digest")
    _expect_sha256(evidence["p3_evidence_id"], "source_evidence.p3_evidence_id")
    _expect_revision(evidence["producer_revision"], "source_evidence.producer_revision")
    return evidence


def _validate_limits(value: Any) -> Mapping[str, Any]:
    limits = _expect_object(value, "limits")
    _expect_exact_keys(limits, _LIMIT_FIELDS, "limits")
    _expect_sha256(limits["allowed_symbols_sha256"], "limits.allowed_symbols_sha256")
    max_open_positions = _expect_positive_integer(
        limits["max_open_positions"], "limits.max_open_positions", maximum=100
    )
    max_gross = _expect_positive_integer(
        limits["max_gross_notional_cents"],
        "limits.max_gross_notional_cents",
        maximum=1_000_000_000,
    )
    max_single = _expect_positive_integer(
        limits["max_single_decision_notional_cents"],
        "limits.max_single_decision_notional_cents",
        maximum=max_gross,
    )
    max_turnover = _expect_positive_integer(
        limits["max_daily_turnover_notional_cents"],
        "limits.max_daily_turnover_notional_cents",
        maximum=max_gross * 4,
    )
    if max_turnover < max_single:
        _fail("limits.max_daily_turnover_notional_cents must cover one decision")
    _expect_positive_integer(limits["max_decisions_per_session"], "limits.max_decisions_per_session", maximum=64)
    _expect_positive_integer(limits["max_consecutive_failures"], "limits.max_consecutive_failures", maximum=10)
    if max_open_positions > limits["max_decisions_per_session"]:
        _fail("limits.max_open_positions must not exceed max_decisions_per_session")
    return limits


def _validate_circuit_breaker(value: Any) -> Mapping[str, Any]:
    circuit_breaker = _expect_object(value, "circuit_breaker")
    _expect_exact_keys(circuit_breaker, _CIRCUIT_BREAKER_FIELDS, "circuit_breaker")
    for field in _CIRCUIT_BREAKER_FIELDS:
        if circuit_breaker[field] is not True:
            _fail(f"circuit_breaker.{field} must be true")
    return circuit_breaker


def canonical_risk_control_json(risk_control: Mapping[str, Any]) -> str:
    if not isinstance(risk_control, Mapping):
        _fail("risk_control must be an object")
    content = dict(risk_control)
    content.pop("risk_policy_sha256", None)
    try:
        return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ForwardObservationRiskControlError("risk_control cannot be represented as canonical JSON") from exc


def calculate_risk_policy_sha256(risk_control: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_risk_control_json(risk_control).encode("utf-8")).hexdigest()


def validate_forward_observation_risk_control(
    risk_control: Any,
    *,
    as_of: str | None = None,
) -> Mapping[str, Any]:
    """Validate a finite P4/P5 risk-control artifact without granting execution."""
    _reject_non_finite_or_null(risk_control, "risk_control")
    _reject_forbidden_material(risk_control, "risk_control")
    value = _expect_object(risk_control, "risk_control")
    _expect_exact_keys(value, _ROOT_FIELDS, "risk_control")
    if value["schema"] != RISK_CONTROL_SCHEMA_ID:
        _fail(f"risk_control.schema must be {RISK_CONTROL_SCHEMA_ID}")
    _expect_identity(value["risk_policy_id"], "risk_control.risk_policy_id")
    _expect_identity(value["risk_policy_version"], "risk_control.risk_policy_version")
    created_at = _parse_timestamp(value["created_at"], "risk_control.created_at")
    effective_at = _parse_timestamp(value["effective_at"], "risk_control.effective_at")
    expires_at = _parse_timestamp(value["expires_at"], "risk_control.expires_at")
    if created_at > effective_at:
        _fail("risk_control.created_at must not be after effective_at")
    if expires_at <= effective_at:
        _fail("risk_control.expires_at must be after effective_at")
    if expires_at - effective_at > _MAX_VALIDITY:
        _fail("risk_control validity must not exceed 31 days")
    if value["digest_algorithm"] != _DIGEST_ALGORITHM:
        _fail("risk_control.digest_algorithm must be sha256")
    expected_lane = _STAGE_TO_LANE.get(value["stage"])
    if expected_lane is None:
        _fail("risk_control.stage must be PAPER_DRY_RUN or SHADOW")
    if value["execution_lane"] != expected_lane:
        _fail(f"risk_control.execution_lane must be {expected_lane} for {value['stage']}")
    _validate_candidate(value["candidate"])
    _validate_source_evidence(value["source_evidence"])
    _validate_limits(value["limits"])
    _validate_circuit_breaker(value["circuit_breaker"])
    _expect_sha256(value["risk_policy_sha256"], "risk_control.risk_policy_sha256")
    if value["risk_policy_sha256"] != calculate_risk_policy_sha256(value):
        _fail("risk_control.risk_policy_sha256 mismatch")
    observed_at = datetime.now(UTC).replace(microsecond=0) if as_of is None else _parse_timestamp(as_of, "as_of")
    if observed_at < effective_at or observed_at >= expires_at:
        _fail("risk_control is not currently effective")
    return value


def parse_risk_control_json(text: str) -> Mapping[str, Any]:
    try:
        return json.loads(text, object_pairs_hook=_reject_duplicate_pairs)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ForwardObservationRiskControlError("invalid forward-observation risk control JSON") from exc


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _fail(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate a non-executing QSL P4/P5 forward-observation risk control")
    parser.add_argument("--risk-control", type=Path, required=True, help="risk-control JSON")
    parser.add_argument("--as-of", help="RFC3339 UTC validation timestamp")
    args = parser.parse_args(argv)
    try:
        validated = validate_forward_observation_risk_control(
            parse_risk_control_json(args.risk_control.read_text(encoding="utf-8")),
            as_of=args.as_of,
        )
    except (OSError, ForwardObservationRiskControlError) as exc:
        print(f"forward-observation risk control failed: {exc}", file=sys.stderr)
        return 1
    print(
        "FORWARD_OBSERVATION_RISK_CONTROL_VALID "
        f"stage={validated['stage']} lane={validated['execution_lane']} "
        f"candidate={validated['candidate']['candidate_id']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
