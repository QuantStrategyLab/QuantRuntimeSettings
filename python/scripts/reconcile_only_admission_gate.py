#!/usr/bin/env python3
"""Admit only zero-new-risk reconciliation after a signed policy gate passes.

This is deliberately not a broker client.  It validates an immutable
reconcile-only risk policy and emits either RECONCILE_ONLY or PARKED.  There is
no order, trade, credential, account-read, or broker-write capability here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping

from autonomous_policy_gate import (
    AutonomousPolicyValidationError,
    parse_json,
    validate_policy_gate,
)
from deployment_bundle_contract import BundleValidationError, parse_bundle_json
from gcp_kms_policy_gate import GcpKmsPolicyValidationError, validate_gcp_kms_policy_gate

RISK_CONTROL_SCHEMA_ID = "qsl.reconcile_only_risk_control.v1"
ADMISSION_SCHEMA_ID = "qsl.reconcile_only_admission.v1"
_DIGEST_ALGORITHM = "sha256"
_ADMISSION_MODE = "RECONCILE_ONLY"
_IDENTITY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
_TIMESTAMP_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
_REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$")
_FORBIDDEN_KEY_PATTERN = re.compile(
    r"credential|secret|token|password|cookie|jwt|private(?:[_-]?key)?|access[_-]?key|"
    r"broker|order|capital|fill|position|balance|payload|runtime[_-]?active|config[_-]?applied|applied",
    re.IGNORECASE,
)
_URL_PATTERN = re.compile(r"[a-z][a-z0-9+.-]*://", re.IGNORECASE)
_RISK_CONTROL_FIELDS = {
    "schema",
    "risk_policy_id",
    "risk_policy_version",
    "created_at",
    "effective_at",
    "expires_at",
    "digest_algorithm",
    "admission_mode",
    "new_risk_ceiling",
    "write_action_ceiling",
    "risk_policy_sha256",
}
_ADMISSION_FIELDS = {
    "schema",
    "admission_id",
    "created_at",
    "effective_at",
    "expires_at",
    "digest_algorithm",
    "admission_mode",
    "target",
    "admission_sha256",
}
_TARGET_FIELDS = {
    "platform",
    "repository",
    "revision",
    "environment",
    "account_alias",
    "account_digest_sha256",
}


class ReconcileOnlyAdmissionError(ValueError):
    """Raised when a no-order reconciliation admission cannot be granted."""


def _fail(message: str) -> None:
    raise ReconcileOnlyAdmissionError(message)


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
                _fail(f"{path}.{key} is forbidden in a reconcile-only admission")
            _reject_forbidden_material(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_forbidden_material(child, f"{path}[{index}]")
    elif isinstance(value, str) and _URL_PATTERN.search(value):
        _fail(f"{path} contains a forbidden URL")


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
        raise ReconcileOnlyAdmissionError(f"{path} must be a valid calendar timestamp") from exc
    return parsed.replace(tzinfo=UTC)


def _validate_window(created_at: datetime, effective_at: datetime, expires_at: datetime, path: str) -> None:
    if created_at > effective_at:
        _fail(f"{path}.created_at must not be after effective_at")
    if expires_at <= effective_at:
        _fail(f"{path}.expires_at must be after effective_at")


def _canonical_json(value: Mapping[str, Any], omitted_field: str, label: str) -> str:
    if not isinstance(value, Mapping):
        _fail(f"{label} must be an object")
    content = dict(value)
    content.pop(omitted_field, None)
    try:
        return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ReconcileOnlyAdmissionError(f"{label} cannot be represented as canonical JSON") from exc


def canonical_risk_control_json(risk_control: Mapping[str, Any]) -> str:
    return _canonical_json(risk_control, "risk_policy_sha256", "risk control")


def calculate_risk_policy_sha256(risk_control: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_risk_control_json(risk_control).encode("utf-8")).hexdigest()


def canonical_admission_json(admission: Mapping[str, Any]) -> str:
    return _canonical_json(admission, "admission_sha256", "admission")


def calculate_admission_sha256(admission: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_admission_json(admission).encode("utf-8")).hexdigest()


def _validate_target(value: Any, path: str) -> Mapping[str, Any]:
    target = _expect_object(value, path)
    _expect_exact_keys(target, _TARGET_FIELDS, path)
    _expect_identity(target["platform"], f"{path}.platform")
    if not isinstance(target["repository"], str) or not _REPOSITORY_PATTERN.fullmatch(target["repository"]):
        _fail(f"{path}.repository must be an owner/repository identity, not a URL")
    _expect_revision(target["revision"], f"{path}.revision")
    _expect_identity(target["environment"], f"{path}.environment")
    _expect_identity(target["account_alias"], f"{path}.account_alias")
    _expect_sha256(target["account_digest_sha256"], f"{path}.account_digest_sha256")
    return target


def validate_reconcile_only_risk_control(risk_control: Any, *, as_of: str | None = None) -> Mapping[str, Any]:
    """Validate a zero-ceiling policy that can never admit new risk or writes."""
    _reject_non_finite_or_null(risk_control, "risk_control")
    _reject_forbidden_material(risk_control, "risk_control")
    value = _expect_object(risk_control, "risk_control")
    _expect_exact_keys(value, _RISK_CONTROL_FIELDS, "risk_control")
    if value["schema"] != RISK_CONTROL_SCHEMA_ID:
        _fail(f"risk_control.schema must be {RISK_CONTROL_SCHEMA_ID}")
    _expect_identity(value["risk_policy_id"], "risk_control.risk_policy_id")
    _expect_identity(value["risk_policy_version"], "risk_control.risk_policy_version")
    created_at = _parse_timestamp(value["created_at"], "risk_control.created_at")
    effective_at = _parse_timestamp(value["effective_at"], "risk_control.effective_at")
    expires_at = _parse_timestamp(value["expires_at"], "risk_control.expires_at")
    _validate_window(created_at, effective_at, expires_at, "risk_control")
    if value["digest_algorithm"] != _DIGEST_ALGORITHM:
        _fail("risk_control.digest_algorithm must be sha256")
    if value["admission_mode"] != _ADMISSION_MODE:
        _fail(f"risk_control.admission_mode must be {_ADMISSION_MODE}")
    if value["new_risk_ceiling"] != 0:
        _fail("risk_control.new_risk_ceiling must be zero")
    if value["write_action_ceiling"] != 0:
        _fail("risk_control.write_action_ceiling must be zero")
    _expect_sha256(value["risk_policy_sha256"], "risk_control.risk_policy_sha256")
    if value["risk_policy_sha256"] != calculate_risk_policy_sha256(value):
        _fail("risk_control.risk_policy_sha256 mismatch")
    observed_at = datetime.now(UTC).replace(microsecond=0) if as_of is None else _parse_timestamp(as_of, "as_of")
    if observed_at < effective_at or observed_at >= expires_at:
        _fail("risk_control is not currently effective")
    return value


def validate_reconcile_only_admission(admission: Any, *, as_of: str | None = None) -> Mapping[str, Any]:
    """Validate a target-bound admission that permits only reconciliation."""
    _reject_non_finite_or_null(admission, "admission")
    _reject_forbidden_material(admission, "admission")
    value = _expect_object(admission, "admission")
    _expect_exact_keys(value, _ADMISSION_FIELDS, "admission")
    if value["schema"] != ADMISSION_SCHEMA_ID:
        _fail(f"admission.schema must be {ADMISSION_SCHEMA_ID}")
    _expect_identity(value["admission_id"], "admission.admission_id")
    created_at = _parse_timestamp(value["created_at"], "admission.created_at")
    effective_at = _parse_timestamp(value["effective_at"], "admission.effective_at")
    expires_at = _parse_timestamp(value["expires_at"], "admission.expires_at")
    _validate_window(created_at, effective_at, expires_at, "admission")
    if value["digest_algorithm"] != _DIGEST_ALGORITHM:
        _fail("admission.digest_algorithm must be sha256")
    if value["admission_mode"] != _ADMISSION_MODE:
        _fail(f"admission.admission_mode must be {_ADMISSION_MODE}")
    _validate_target(value["target"], "admission.target")
    _expect_sha256(value["admission_sha256"], "admission.admission_sha256")
    if value["admission_sha256"] != calculate_admission_sha256(value):
        _fail("admission.admission_sha256 mismatch")
    observed_at = datetime.now(UTC).replace(microsecond=0) if as_of is None else _parse_timestamp(as_of, "as_of")
    if observed_at < effective_at or observed_at >= expires_at:
        _fail("admission is not currently effective")
    return value


def _admit_from_policy_gate(
    policy_gate: Mapping[str, Any],
    *,
    risk_control: Any,
    admission: Any,
    as_of: str | None = None,
) -> Mapping[str, Any]:
    """Apply zero-risk and target-window constraints to an already verified policy gate."""
    validated_risk_control = validate_reconcile_only_risk_control(risk_control, as_of=as_of)
    expected_risk_reference = {
        "risk_policy_id": validated_risk_control["risk_policy_id"],
        "risk_policy_version": validated_risk_control["risk_policy_version"],
        "risk_policy_sha256": validated_risk_control["risk_policy_sha256"],
    }
    if policy_gate["policy"]["risk_control"] != expected_risk_reference:
        _fail("signed policy risk_control does not match the exact zero-risk policy")
    validated_admission = validate_reconcile_only_admission(admission, as_of=as_of)
    if validated_admission["target"] != policy_gate["activation"]["target"]:
        _fail("admission target does not match the exact policy-gated activation target")
    risk_effective = _parse_timestamp(validated_risk_control["effective_at"], "risk_control.effective_at")
    risk_expires = _parse_timestamp(validated_risk_control["expires_at"], "risk_control.expires_at")
    policy_effective = _parse_timestamp(policy_gate["policy"]["effective_at"], "policy.effective_at")
    policy_expires = _parse_timestamp(policy_gate["policy"]["expires_at"], "policy.expires_at")
    activation_effective = _parse_timestamp(policy_gate["activation"]["effective_at"], "activation.effective_at")
    activation_expires = _parse_timestamp(policy_gate["activation"]["expires_at"], "activation.expires_at")
    admission_effective = _parse_timestamp(validated_admission["effective_at"], "admission.effective_at")
    admission_expires = _parse_timestamp(validated_admission["expires_at"], "admission.expires_at")
    if admission_effective < max(risk_effective, policy_effective, activation_effective) or admission_expires > min(
        risk_expires, policy_expires, activation_expires
    ):
        _fail("admission validity window is not contained within every policy and activation window")
    return {
        "admission_id": validated_admission["admission_id"],
        "admission_sha256": validated_admission["admission_sha256"],
        "new_risk_allowed": False,
        "policy_id": policy_gate["policy"]["policy_id"],
        "status": _ADMISSION_MODE,
        "write_action_allowed": False,
    }


def admit_reconcile_only(
    *,
    bundle: Any,
    activation: Any,
    policy: Any,
    signature: bytes,
    trusted_policy_root: Any,
    expected_root_sha256: Any,
    risk_control: Any,
    admission: Any,
    as_of: str | None = None,
) -> Mapping[str, Any]:
    """Return a no-write admission after an OpenSSH rooted policy gate passes."""
    try:
        policy_gate = validate_policy_gate(
            bundle=bundle,
            activation=activation,
            policy=policy,
            signature=signature,
            trusted_policy_root=trusted_policy_root,
            expected_root_sha256=expected_root_sha256,
            as_of=as_of,
        )
    except AutonomousPolicyValidationError as exc:
        raise ReconcileOnlyAdmissionError(f"OpenSSH policy gate denied admission: {exc}") from exc
    return _admit_from_policy_gate(policy_gate, risk_control=risk_control, admission=admission, as_of=as_of)


def admit_reconcile_only_gcp_kms(
    *,
    bundle: Any,
    activation: Any,
    policy: Any,
    signature: bytes,
    trusted_policy_root: Any,
    expected_root_sha256: Any,
    risk_control: Any,
    admission: Any,
    as_of: str | None = None,
) -> Mapping[str, Any]:
    """Return a no-write admission after a Cloud KMS P-256 policy gate passes."""
    try:
        policy_gate = validate_gcp_kms_policy_gate(
            bundle=bundle,
            activation=activation,
            policy=policy,
            signature=signature,
            trusted_policy_root=trusted_policy_root,
            expected_root_sha256=expected_root_sha256,
            as_of=as_of,
        )
    except GcpKmsPolicyValidationError as exc:
        raise ReconcileOnlyAdmissionError(f"Cloud KMS policy gate denied admission: {exc}") from exc
    return _admit_from_policy_gate(policy_gate, risk_control=risk_control, admission=admission, as_of=as_of)


def _parked_summary() -> dict[str, object]:
    return {
        "new_risk_allowed": False,
        "reason_code": "ADMISSION_DENIED",
        "status": "PARKED",
        "write_action_allowed": False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Admit only zero-new-risk QSL reconciliation after policy verification")
    parser.add_argument("--bundle", type=Path, required=True, help="exact DeploymentBundle JSON")
    parser.add_argument("--activation", type=Path, required=True, help="contract-only Activation JSON")
    parser.add_argument("--policy", type=Path, required=True, help="signed autonomous policy JSON")
    parser.add_argument("--policy-signature", type=Path, required=True, help="detached OpenSSH policy signature")
    parser.add_argument("--trusted-policy-root", type=Path, required=True, help="public trusted-policy-root JSON")
    parser.add_argument("--risk-control", type=Path, required=True, help="zero-new-risk control JSON")
    parser.add_argument("--admission", type=Path, required=True, help="reconcile-only admission JSON")
    parser.add_argument("--root-scheme", choices=("openssh-sshsig-ed25519", "gcp-kms-p256"), default="openssh-sshsig-ed25519")
    parser.add_argument("--as-of", help="inject canonical UTC validation time; defaults to current UTC")
    args = parser.parse_args(argv)
    try:
        expected_root_sha256 = os.environ.get("QSL_TRUSTED_POLICY_ROOT_SHA256", "")
        if not expected_root_sha256:
            _fail("QSL_TRUSTED_POLICY_ROOT_SHA256 must be injected by the independent execution control")
        common_inputs = {
            "bundle": parse_bundle_json(args.bundle.read_text(encoding="utf-8")),
            "activation": parse_json(args.activation.read_text(encoding="utf-8"), label="activation"),
            "policy": parse_json(args.policy.read_text(encoding="utf-8"), label="policy"),
            "signature": args.policy_signature.read_bytes(),
            "trusted_policy_root": parse_json(args.trusted_policy_root.read_text(encoding="utf-8"), label="trusted policy root"),
            "expected_root_sha256": expected_root_sha256,
            "risk_control": parse_json(args.risk_control.read_text(encoding="utf-8"), label="risk control"),
            "admission": parse_json(args.admission.read_text(encoding="utf-8"), label="admission"),
            "as_of": args.as_of,
        }
        result = (
            admit_reconcile_only_gcp_kms(**common_inputs)
            if args.root_scheme == "gcp-kms-p256"
            else admit_reconcile_only(**common_inputs)
        )
    except (OSError, AutonomousPolicyValidationError, BundleValidationError, GcpKmsPolicyValidationError, ReconcileOnlyAdmissionError) as exc:
        print(json.dumps(_parked_summary(), sort_keys=True))
        print(f"reconcile-only admission parked: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
