#!/usr/bin/env python3
"""Build a redacted PAPER admission receipt from a deterministic risk decision.

This is a pure adapter between ``deterministic_risk_gate`` and the shared
``paper_risk_admission_receipt.v1`` contract.  It does not read a runtime
configuration, account, broker, credential, position, or order.  The receipt
is evidence of one already-computed risk decision only; it does not grant
runtime or broker authority.

The source decision contains projected exposure values so that the local gate
can be evaluated.  Those values deliberately never cross this boundary.  A
consumer receives only the immutable policy digest, release binding, decision
digest, session, disposition, and stable reason codes.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date
from typing import Any, Mapping

from deterministic_risk_gate import (
    RISK_GATE_DECISION_SCHEMA_ID,
    calculate_risk_gate_decision_sha256,
)


PAPER_RISK_ADMISSION_RECEIPT_SCHEMA_VERSION = "paper_risk_admission_receipt.v1"

_IDENTITY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_RELEASE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_REASON_CODE_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{1,127}$")
_SOURCE_DECISION_FIELDS = {
    "schema",
    "evaluation_id",
    "observed_at",
    "policy",
    "decision",
    "reason_codes",
    "next_circuit_breaker_state",
    "manual_reset_required",
    "projected",
    "decision_sha256",
}
_SOURCE_POLICY_FIELDS = {"risk_policy_id", "risk_policy_version", "risk_policy_sha256"}
_SOURCE_PROJECTED_FIELDS = {
    "gross_notional_cents",
    "symbol_gross_notional_cents",
    "strategy_gross_notional_cents",
    "leverage_bps",
    "decisions_in_session",
}
_RECEIPT_FIELDS = {
    "schema_version",
    "strategy_profile",
    "release_id",
    "risk_policy_sha256",
    "decision_digest",
    "effective_session",
    "disposition",
    "reason_codes",
    "receipt_sha256",
}
_DISPOSITIONS = frozenset({"allow_new_risk", "reducing_only", "halted"})
_UNKNOWN_DECISION_REASON = "UNKNOWN_DETERMINISTIC_RISK_DECISION"
_KNOWN_PROHIBITION_REASONS = frozenset(
    {
        "OBSERVATION_NOT_COMPLETE",
        "RECONCILIATION_NOT_VERIFIED",
        "CIRCUIT_BREAKER_OPEN",
        "GROSS_EXPOSURE_LIMIT_EXCEEDED",
        "SINGLE_SYMBOL_LIMIT_EXCEEDED",
        "SINGLE_STRATEGY_LIMIT_EXCEEDED",
        "LEVERAGE_LIMIT_EXCEEDED",
        "DAILY_LOSS_LIMIT_EXCEEDED",
        "SESSION_DECISION_LIMIT_EXCEEDED",
    }
)


class PaperRiskAdmissionReceiptError(ValueError):
    """Raised when a source decision or resulting receipt is not trustworthy."""


def _fail(message: str) -> None:
    raise PaperRiskAdmissionReceiptError(message)


def _expect_mapping(value: Any, path: str) -> Mapping[str, Any]:
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


def _expect_identity(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _IDENTITY_PATTERN.fullmatch(value):
        _fail(f"{path} must be a lowercase immutable identity")
    return value


def _expect_release_id(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _RELEASE_ID_PATTERN.fullmatch(value):
        _fail(f"{path} must be a visible immutable release identity")
    return value


def _expect_sha256(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _SHA256_PATTERN.fullmatch(value):
        _fail(f"{path} must be a lowercase SHA-256 digest")
    return value


def _expect_effective_session(value: Any, path: str) -> str:
    if not isinstance(value, str):
        _fail(f"{path} must be an ISO date")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise PaperRiskAdmissionReceiptError(f"{path} must be an ISO date") from exc


def _validate_reason_codes(value: Any, path: str) -> list[str]:
    if not isinstance(value, list):
        _fail(f"{path} must be an array")
    normalized: list[str] = []
    for index, reason in enumerate(value):
        if not isinstance(reason, str) or not _REASON_CODE_PATTERN.fullmatch(reason):
            _fail(f"{path}[{index}] must be a stable uppercase reason code")
        if reason in normalized:
            _fail(f"{path} must not contain duplicate reason codes")
        normalized.append(reason)
    return normalized


def _validate_projected(value: Any) -> Mapping[str, int]:
    projected = _expect_mapping(value, "decision.projected")
    _expect_exact_keys(projected, _SOURCE_PROJECTED_FIELDS, "decision.projected")
    normalized: dict[str, int] = {}
    for field, amount in projected.items():
        if isinstance(amount, bool) or not isinstance(amount, int) or amount < 0:
            _fail(f"decision.projected.{field} must be a non-negative integer")
        normalized[field] = amount
    return normalized


def _validate_source_decision(decision: Any) -> Mapping[str, Any]:
    """Validate a complete local decision before projecting it into a receipt."""
    value = _expect_mapping(decision, "decision")
    _expect_exact_keys(value, _SOURCE_DECISION_FIELDS, "decision")
    if value["schema"] != RISK_GATE_DECISION_SCHEMA_ID:
        _fail(f"decision.schema must be {RISK_GATE_DECISION_SCHEMA_ID}")
    _expect_identity(value["evaluation_id"], "decision.evaluation_id")
    policy = _expect_mapping(value["policy"], "decision.policy")
    _expect_exact_keys(policy, _SOURCE_POLICY_FIELDS, "decision.policy")
    _expect_identity(policy["risk_policy_id"], "decision.policy.risk_policy_id")
    _expect_identity(policy["risk_policy_version"], "decision.policy.risk_policy_version")
    _expect_sha256(policy["risk_policy_sha256"], "decision.policy.risk_policy_sha256")
    if not isinstance(value["decision"], str) or not value["decision"]:
        _fail("decision.decision must be a non-empty string")
    if value["next_circuit_breaker_state"] not in {"CLOSED", "OPEN"}:
        _fail("decision.next_circuit_breaker_state must be CLOSED or OPEN")
    if value["manual_reset_required"] is not True:
        _fail("decision.manual_reset_required must be true")
    _validate_reason_codes(value["reason_codes"], "decision.reason_codes")
    _validate_projected(value["projected"])
    _expect_sha256(value["decision_sha256"], "decision.decision_sha256")
    if value["decision_sha256"] != calculate_risk_gate_decision_sha256(value):
        _fail("decision.decision_sha256 mismatch")
    return value


def _disposition_for(validated_decision: Mapping[str, Any]) -> tuple[str, list[str]]:
    """Map only the known deterministic-gate semantics to safe dispositions."""
    decision = validated_decision["decision"]
    breaker = validated_decision["next_circuit_breaker_state"]
    reasons = list(validated_decision["reason_codes"])
    if decision == "ALLOW_NEW_RISK" and breaker == "CLOSED" and not reasons:
        return "allow_new_risk", []
    if (
        decision == "NEW_RISK_PROHIBITED"
        and breaker == "OPEN"
        and reasons
        and set(reasons).issubset(_KNOWN_PROHIBITION_REASONS)
    ):
        return "reducing_only", reasons
    return "halted", [_UNKNOWN_DECISION_REASON]


def canonical_paper_risk_admission_receipt_json(receipt: Mapping[str, Any]) -> str:
    """Return the QPK-compatible canonical receipt JSON without its digest."""
    if not isinstance(receipt, Mapping):
        _fail("paper risk admission receipt must be an object")
    content = dict(receipt)
    content.pop("receipt_sha256", None)
    try:
        return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise PaperRiskAdmissionReceiptError(
            "paper risk admission receipt cannot be represented as canonical JSON"
        ) from exc


def calculate_paper_risk_admission_receipt_sha256(receipt: Mapping[str, Any]) -> str:
    """Return the SHA-256 of the exact QPK receipt projection."""
    return hashlib.sha256(canonical_paper_risk_admission_receipt_json(receipt).encode("utf-8")).hexdigest()


def validate_paper_risk_admission_receipt(receipt: Any) -> Mapping[str, Any]:
    """Validate the exact, redacted QPK-compatible receipt contract."""
    value = _expect_mapping(receipt, "paper risk admission receipt")
    _expect_exact_keys(value, _RECEIPT_FIELDS, "paper risk admission receipt")
    if value["schema_version"] != PAPER_RISK_ADMISSION_RECEIPT_SCHEMA_VERSION:
        _fail(f"receipt.schema_version must be {PAPER_RISK_ADMISSION_RECEIPT_SCHEMA_VERSION}")
    _expect_identity(value["strategy_profile"], "receipt.strategy_profile")
    _expect_release_id(value["release_id"], "receipt.release_id")
    _expect_sha256(value["risk_policy_sha256"], "receipt.risk_policy_sha256")
    _expect_sha256(value["decision_digest"], "receipt.decision_digest")
    _expect_effective_session(value["effective_session"], "receipt.effective_session")
    disposition = value["disposition"]
    if disposition not in _DISPOSITIONS:
        _fail("receipt.disposition must be allow_new_risk, reducing_only, or halted")
    reasons = _validate_reason_codes(value["reason_codes"], "receipt.reason_codes")
    if disposition == "allow_new_risk" and reasons:
        _fail("receipt.allow_new_risk must not contain reason codes")
    if disposition in {"reducing_only", "halted"} and not reasons:
        _fail(f"receipt.{disposition} must contain at least one reason code")
    _expect_sha256(value["receipt_sha256"], "receipt.receipt_sha256")
    if value["receipt_sha256"] != calculate_paper_risk_admission_receipt_sha256(value):
        _fail("receipt.receipt_sha256 mismatch")
    return value


def build_paper_risk_admission_receipt(
    *,
    decision: Any,
    strategy_profile: Any,
    release_id: Any,
    effective_session: Any,
) -> dict[str, object]:
    """Project one deterministic decision into a minimal PAPER admission receipt.

    Structural or digest failures raise rather than fabricate a receipt.  A
    caller must fail closed in that case.  A valid but unknown source decision
    remains auditable as ``halted`` and cannot grant new-risk permission.
    """
    validated_decision = _validate_source_decision(decision)
    resolved_profile = _expect_identity(strategy_profile, "strategy_profile")
    resolved_release_id = _expect_release_id(release_id, "release_id")
    resolved_session = _expect_effective_session(effective_session, "effective_session")
    disposition, reason_codes = _disposition_for(validated_decision)
    receipt: dict[str, object] = {
        "schema_version": PAPER_RISK_ADMISSION_RECEIPT_SCHEMA_VERSION,
        "strategy_profile": resolved_profile,
        "release_id": resolved_release_id,
        "risk_policy_sha256": validated_decision["policy"]["risk_policy_sha256"],
        "decision_digest": validated_decision["decision_sha256"],
        "effective_session": resolved_session,
        "disposition": disposition,
        "reason_codes": reason_codes,
        "receipt_sha256": "",
    }
    receipt["receipt_sha256"] = calculate_paper_risk_admission_receipt_sha256(receipt)
    validate_paper_risk_admission_receipt(receipt)
    return receipt


__all__ = [
    "PAPER_RISK_ADMISSION_RECEIPT_SCHEMA_VERSION",
    "PaperRiskAdmissionReceiptError",
    "build_paper_risk_admission_receipt",
    "calculate_paper_risk_admission_receipt_sha256",
    "canonical_paper_risk_admission_receipt_json",
    "validate_paper_risk_admission_receipt",
]
