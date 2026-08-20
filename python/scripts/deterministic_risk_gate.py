#!/usr/bin/env python3
"""Pure, fail-closed risk evaluation for a future P4/P5 gateway.

This module evaluates one requested increase in risk against an immutable,
digest-bound policy and an injected portfolio snapshot.  It has no broker,
account, credential, network, scheduler, persistence, or order-submission
dependency.  A future gateway must treat any validation error as prohibition
of new risk and persist an OPEN breaker itself; this module never resets it.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime
from typing import Any, Mapping


RISK_GATE_POLICY_SCHEMA_ID = "qsl.deterministic_risk_gate_policy.v1"
RISK_GATE_INPUT_SCHEMA_ID = "qsl.deterministic_risk_gate_input.v1"
RISK_GATE_DECISION_SCHEMA_ID = "qsl.deterministic_risk_gate_decision.v1"
FORWARD_OBSERVATION_RISK_CONTROL_SCHEMA_ID = "qsl.forward_observation_risk_control.v1"

_IDENTITY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9.-]{0,15}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_TIMESTAMP_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
_URL_PATTERN = re.compile(r"[a-z][a-z0-9+.-]*://", re.IGNORECASE)
_FORBIDDEN_KEY_PATTERN = re.compile(
    r"credential|secret|token|password|cookie|jwt|private(?:[_-]?key)?|access[_-]?key|"
    r"broker|account(?:[_-]?(?:id|number|alias))?|endpoint|order(?:[_-]?payload)?|fill",
    re.IGNORECASE,
)
_POLICY_FIELDS = {
    "schema",
    "risk_policy_id",
    "risk_policy_version",
    "source_risk_control",
    "limits",
    "circuit_breaker",
    "risk_policy_sha256",
}
_RISK_CONTROL_REFERENCE_FIELDS = {
    "schema",
    "risk_policy_id",
    "risk_policy_version",
    "risk_policy_sha256",
}
_LIMIT_FIELDS = {
    "max_gross_notional_cents",
    "max_single_symbol_notional_cents",
    "max_single_strategy_notional_cents",
    "max_leverage_bps",
    "max_daily_loss_cents",
    "max_decisions_per_session",
}
_CIRCUIT_BREAKER_FIELDS = {"manual_reset_required"}
_INPUT_FIELDS = {"schema", "evaluation_id", "observed_at", "policy", "snapshot", "new_risk_request"}
_POLICY_REFERENCE_FIELDS = {"risk_policy_id", "risk_policy_version", "risk_policy_sha256"}
_SNAPSHOT_FIELDS = {
    "observation_status",
    "reconciliation_status",
    "circuit_breaker_state",
    "equity_cents",
    "gross_notional_cents",
    "daily_loss_cents",
    "decisions_in_session",
    "symbol_gross_notionals_cents",
    "strategy_gross_notionals_cents",
}
_REQUEST_FIELDS = {"symbol", "strategy_id", "additional_gross_notional_cents"}


class DeterministicRiskGateError(ValueError):
    """Raised when the pure risk-gate policy or evaluation input is unsafe."""


def _fail(message: str) -> None:
    raise DeterministicRiskGateError(message)


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
            if _FORBIDDEN_KEY_PATTERN.search(key):
                _fail(f"{path}.{key} is forbidden in a deterministic risk-gate contract")
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


def _expect_symbol(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _SYMBOL_PATTERN.fullmatch(value):
        _fail(f"{path} must be an uppercase symbol identity")
    return value


def _expect_sha256(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _SHA256_PATTERN.fullmatch(value):
        _fail(f"{path} must be a lowercase SHA-256 digest")
    return value


def _expect_timestamp(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _TIMESTAMP_PATTERN.fullmatch(value):
        _fail(f"{path} must be an RFC3339 UTC timestamp with whole seconds")
    try:
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise DeterministicRiskGateError(f"{path} must be a valid calendar timestamp") from exc
    return value


def _expect_nonnegative_integer(value: Any, path: str, *, maximum: int = 1_000_000_000_000_000) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > maximum:
        _fail(f"{path} must be an integer between 0 and {maximum}")
    return value


def _expect_positive_integer(value: Any, path: str, *, maximum: int = 1_000_000_000_000_000) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > maximum:
        _fail(f"{path} must be an integer between 1 and {maximum}")
    return value


def _validate_risk_control_reference(value: Any, path: str) -> Mapping[str, Any]:
    reference = _expect_object(value, path)
    _expect_exact_keys(reference, _RISK_CONTROL_REFERENCE_FIELDS, path)
    if reference["schema"] != FORWARD_OBSERVATION_RISK_CONTROL_SCHEMA_ID:
        _fail(f"{path}.schema must be {FORWARD_OBSERVATION_RISK_CONTROL_SCHEMA_ID}")
    _expect_identity(reference["risk_policy_id"], f"{path}.risk_policy_id")
    _expect_identity(reference["risk_policy_version"], f"{path}.risk_policy_version")
    _expect_sha256(reference["risk_policy_sha256"], f"{path}.risk_policy_sha256")
    return reference


def _validate_limits(value: Any) -> Mapping[str, Any]:
    limits = _expect_object(value, "limits")
    _expect_exact_keys(limits, _LIMIT_FIELDS, "limits")
    max_gross = _expect_positive_integer(limits["max_gross_notional_cents"], "limits.max_gross_notional_cents")
    _expect_positive_integer(
        limits["max_single_symbol_notional_cents"],
        "limits.max_single_symbol_notional_cents",
        maximum=max_gross,
    )
    _expect_positive_integer(
        limits["max_single_strategy_notional_cents"],
        "limits.max_single_strategy_notional_cents",
        maximum=max_gross,
    )
    _expect_positive_integer(limits["max_leverage_bps"], "limits.max_leverage_bps", maximum=100_000)
    _expect_positive_integer(limits["max_daily_loss_cents"], "limits.max_daily_loss_cents", maximum=max_gross)
    _expect_positive_integer(limits["max_decisions_per_session"], "limits.max_decisions_per_session", maximum=1_000)
    return limits


def _validate_circuit_breaker(value: Any) -> Mapping[str, Any]:
    circuit_breaker = _expect_object(value, "circuit_breaker")
    _expect_exact_keys(circuit_breaker, _CIRCUIT_BREAKER_FIELDS, "circuit_breaker")
    if circuit_breaker["manual_reset_required"] is not True:
        _fail("circuit_breaker.manual_reset_required must be true")
    return circuit_breaker


def canonical_risk_gate_policy_json(policy: Mapping[str, Any]) -> str:
    if not isinstance(policy, Mapping):
        _fail("risk-gate policy must be an object")
    content = dict(policy)
    content.pop("risk_policy_sha256", None)
    try:
        return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise DeterministicRiskGateError("risk-gate policy cannot be represented as canonical JSON") from exc


def calculate_risk_gate_policy_sha256(policy: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_risk_gate_policy_json(policy).encode("utf-8")).hexdigest()


def validate_risk_gate_policy(policy: Any) -> Mapping[str, Any]:
    """Validate an immutable policy; it does not load or alter any P4/P5 policy."""
    _reject_non_finite_or_null(policy, "risk-gate policy")
    _reject_forbidden_material(policy, "risk-gate policy")
    value = _expect_object(policy, "risk-gate policy")
    _expect_exact_keys(value, _POLICY_FIELDS, "risk-gate policy")
    if value["schema"] != RISK_GATE_POLICY_SCHEMA_ID:
        _fail(f"risk-gate policy.schema must be {RISK_GATE_POLICY_SCHEMA_ID}")
    _expect_identity(value["risk_policy_id"], "risk-gate policy.risk_policy_id")
    _expect_identity(value["risk_policy_version"], "risk-gate policy.risk_policy_version")
    _validate_risk_control_reference(value["source_risk_control"], "risk-gate policy.source_risk_control")
    _validate_limits(value["limits"])
    _validate_circuit_breaker(value["circuit_breaker"])
    _expect_sha256(value["risk_policy_sha256"], "risk-gate policy.risk_policy_sha256")
    if value["risk_policy_sha256"] != calculate_risk_gate_policy_sha256(value):
        _fail("risk-gate policy.risk_policy_sha256 mismatch")
    return value


def _validate_policy_reference(value: Any, policy: Mapping[str, Any]) -> Mapping[str, Any]:
    reference = _expect_object(value, "input policy")
    _expect_exact_keys(reference, _POLICY_REFERENCE_FIELDS, "input policy")
    for field in _POLICY_REFERENCE_FIELDS:
        if reference[field] != policy[field]:
            _fail("input policy does not match the exact risk-gate policy")
    return reference


def _validate_exposure_map(value: Any, path: str, *, key_validator) -> Mapping[str, int]:
    exposure = _expect_object(value, path)
    normalized: dict[str, int] = {}
    for key, amount in exposure.items():
        key_validator(key, f"{path}.{key}")
        normalized[key] = _expect_positive_integer(amount, f"{path}.{key}")
    return normalized


def _validate_snapshot(value: Any) -> Mapping[str, Any]:
    snapshot = _expect_object(value, "snapshot")
    _expect_exact_keys(snapshot, _SNAPSHOT_FIELDS, "snapshot")
    if snapshot["observation_status"] not in {"COMPLETE", "STALE", "UNAVAILABLE"}:
        _fail("snapshot.observation_status must be COMPLETE, STALE, or UNAVAILABLE")
    if snapshot["reconciliation_status"] not in {"VERIFIED", "UNVERIFIED", "FAILED"}:
        _fail("snapshot.reconciliation_status must be VERIFIED, UNVERIFIED, or FAILED")
    if snapshot["circuit_breaker_state"] not in {"CLOSED", "OPEN"}:
        _fail("snapshot.circuit_breaker_state must be CLOSED or OPEN")
    _expect_positive_integer(snapshot["equity_cents"], "snapshot.equity_cents")
    gross_notional = _expect_nonnegative_integer(snapshot["gross_notional_cents"], "snapshot.gross_notional_cents")
    _expect_nonnegative_integer(snapshot["daily_loss_cents"], "snapshot.daily_loss_cents")
    _expect_nonnegative_integer(snapshot["decisions_in_session"], "snapshot.decisions_in_session", maximum=1_000_000)
    symbol_exposure = _validate_exposure_map(
        snapshot["symbol_gross_notionals_cents"], "snapshot.symbol_gross_notionals_cents", key_validator=_expect_symbol
    )
    strategy_exposure = _validate_exposure_map(
        snapshot["strategy_gross_notionals_cents"],
        "snapshot.strategy_gross_notionals_cents",
        key_validator=_expect_identity,
    )
    if sum(symbol_exposure.values()) != gross_notional:
        _fail("snapshot.gross_notional_cents does not equal symbol exposure total")
    if sum(strategy_exposure.values()) != gross_notional:
        _fail("snapshot.gross_notional_cents does not equal strategy exposure total")
    return snapshot


def _validate_new_risk_request(value: Any) -> Mapping[str, Any]:
    request = _expect_object(value, "new_risk_request")
    _expect_exact_keys(request, _REQUEST_FIELDS, "new_risk_request")
    _expect_symbol(request["symbol"], "new_risk_request.symbol")
    _expect_identity(request["strategy_id"], "new_risk_request.strategy_id")
    _expect_positive_integer(
        request["additional_gross_notional_cents"], "new_risk_request.additional_gross_notional_cents"
    )
    return request


def validate_risk_gate_input(risk_input: Any, *, policy: Mapping[str, Any]) -> Mapping[str, Any]:
    """Validate a supplied, in-memory snapshot against one exact policy reference."""
    _reject_non_finite_or_null(risk_input, "risk-gate input")
    _reject_forbidden_material(risk_input, "risk-gate input")
    value = _expect_object(risk_input, "risk-gate input")
    _expect_exact_keys(value, _INPUT_FIELDS, "risk-gate input")
    if value["schema"] != RISK_GATE_INPUT_SCHEMA_ID:
        _fail(f"risk-gate input.schema must be {RISK_GATE_INPUT_SCHEMA_ID}")
    _expect_identity(value["evaluation_id"], "risk-gate input.evaluation_id")
    _expect_timestamp(value["observed_at"], "risk-gate input.observed_at")
    _validate_policy_reference(value["policy"], policy)
    _validate_snapshot(value["snapshot"])
    _validate_new_risk_request(value["new_risk_request"])
    return value


def canonical_risk_gate_decision_json(decision: Mapping[str, Any]) -> str:
    if not isinstance(decision, Mapping):
        _fail("risk-gate decision must be an object")
    content = dict(decision)
    content.pop("decision_sha256", None)
    try:
        return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise DeterministicRiskGateError("risk-gate decision cannot be represented as canonical JSON") from exc


def calculate_risk_gate_decision_sha256(decision: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_risk_gate_decision_json(decision).encode("utf-8")).hexdigest()


def evaluate_new_risk(policy: Any, risk_input: Any) -> Mapping[str, Any]:
    """Return ALLOW_NEW_RISK or NEW_RISK_PROHIBITED without causing any side effect.

    A structural validation error raises :class:`DeterministicRiskGateError`.
    Callers must interpret that exception as ``NEW_RISK_PROHIBITED`` and keep
    their persisted breaker OPEN.  This function has no reset operation.
    """
    validated_policy = validate_risk_gate_policy(policy)
    validated_input = validate_risk_gate_input(risk_input, policy=validated_policy)
    snapshot = validated_input["snapshot"]
    request = validated_input["new_risk_request"]
    limits = validated_policy["limits"]

    symbol_exposure = dict(snapshot["symbol_gross_notionals_cents"])
    strategy_exposure = dict(snapshot["strategy_gross_notionals_cents"])
    amount = request["additional_gross_notional_cents"]
    symbol = request["symbol"]
    strategy_id = request["strategy_id"]
    projected_gross = snapshot["gross_notional_cents"] + amount
    projected_symbol = symbol_exposure.get(symbol, 0) + amount
    projected_strategy = strategy_exposure.get(strategy_id, 0) + amount
    projected_leverage_bps = (projected_gross * 10_000 + snapshot["equity_cents"] - 1) // snapshot["equity_cents"]
    projected_decisions = snapshot["decisions_in_session"] + 1

    reasons: list[str] = []
    if snapshot["observation_status"] != "COMPLETE":
        reasons.append("OBSERVATION_NOT_COMPLETE")
    if snapshot["reconciliation_status"] != "VERIFIED":
        reasons.append("RECONCILIATION_NOT_VERIFIED")
    if snapshot["circuit_breaker_state"] != "CLOSED":
        reasons.append("CIRCUIT_BREAKER_OPEN")
    if projected_gross > limits["max_gross_notional_cents"]:
        reasons.append("GROSS_EXPOSURE_LIMIT_EXCEEDED")
    if projected_symbol > limits["max_single_symbol_notional_cents"]:
        reasons.append("SINGLE_SYMBOL_LIMIT_EXCEEDED")
    if projected_strategy > limits["max_single_strategy_notional_cents"]:
        reasons.append("SINGLE_STRATEGY_LIMIT_EXCEEDED")
    if projected_leverage_bps > limits["max_leverage_bps"]:
        reasons.append("LEVERAGE_LIMIT_EXCEEDED")
    if snapshot["daily_loss_cents"] >= limits["max_daily_loss_cents"]:
        reasons.append("DAILY_LOSS_LIMIT_EXCEEDED")
    if projected_decisions > limits["max_decisions_per_session"]:
        reasons.append("SESSION_DECISION_LIMIT_EXCEEDED")

    decision: dict[str, Any] = {
        "schema": RISK_GATE_DECISION_SCHEMA_ID,
        "evaluation_id": validated_input["evaluation_id"],
        "observed_at": validated_input["observed_at"],
        "policy": dict(validated_input["policy"]),
        "decision": "ALLOW_NEW_RISK" if not reasons else "NEW_RISK_PROHIBITED",
        "reason_codes": reasons,
        "next_circuit_breaker_state": "CLOSED" if not reasons else "OPEN",
        "manual_reset_required": True,
        "projected": {
            "gross_notional_cents": projected_gross,
            "symbol_gross_notional_cents": projected_symbol,
            "strategy_gross_notional_cents": projected_strategy,
            "leverage_bps": projected_leverage_bps,
            "decisions_in_session": projected_decisions,
        },
        "decision_sha256": "",
    }
    decision["decision_sha256"] = calculate_risk_gate_decision_sha256(decision)
    return decision
