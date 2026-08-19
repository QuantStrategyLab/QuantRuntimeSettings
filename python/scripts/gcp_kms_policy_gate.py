#!/usr/bin/env python3
"""Fail-closed offline validation of a Cloud KMS P-256 signed QSL policy.

This verifier never calls Cloud KMS.  It verifies the detached DER signature
against the public PEM recorded in an externally pinned trusted root.  Signing
remains a separate KMS-only control-plane action.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Mapping

from activation_contract import ActivationValidationError, validate_activation
from autonomous_policy_gate import (
    AutonomousPolicyValidationError,
    canonical_policy_json,
    parse_json,
    validate_autonomous_operating_policy,
)
from deployment_bundle_contract import BundleValidationError, parse_bundle_json, validate_bundle

TRUSTED_ROOT_SCHEMA_ID = "qsl.gcp_kms_policy_root.v1"
POLICY_GATE_RECEIPT_SCHEMA_ID = "qsl.gcp_kms_policy_gate_receipt.v1"
_DIGEST_ALGORITHM = "sha256"
_SIGNATURE_ALGORITHM = "EC_SIGN_P256_SHA256"
_MAX_ROOT_VALIDITY = timedelta(days=366)
_IDENTITY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
_TIMESTAMP_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
_KMS_KEY_VERSION_PATTERN = re.compile(
    r"^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/locations/[a-z0-9-]+/"
    r"keyRings/[A-Za-z0-9_-]{1,63}/cryptoKeys/[A-Za-z0-9_-]{1,63}/cryptoKeyVersions/[1-9][0-9]*$"
)
_FORBIDDEN_KEY_PATTERN = re.compile(
    r"credential|secret|token|password|cookie|jwt|private(?:[_-]?key)?|access[_-]?key|"
    r"broker|order|capital|fill|runtime[_-]?active|config[_-]?applied|applied",
    re.IGNORECASE,
)
_URL_PATTERN = re.compile(r"[a-z][a-z0-9+.-]*://", re.IGNORECASE)
_ROOT_FIELDS = {
    "schema",
    "root_id",
    "created_at",
    "effective_at",
    "expires_at",
    "digest_algorithm",
    "kms_key_version",
    "signature_algorithm",
    "public_key_pem",
    "public_key_sha256",
    "trusted_policy_root_sha256",
}
_RECEIPT_FIELDS = {
    "schema",
    "verified_at",
    "deployment_bundle",
    "policy",
    "activation",
    "target",
    "risk_control",
    "trusted_policy_root",
    "signature_sha256",
    "receipt_sha256",
}
_RECEIPT_BUNDLE_FIELDS = {"schema", "bundle_id", "bundle_sha256"}
_RECEIPT_POLICY_FIELDS = {
    "policy_id",
    "policy_version",
    "policy_sha256",
    "stage",
    "effective_at",
    "expires_at",
}
_RECEIPT_ACTIVATION_FIELDS = {"activation_id", "activation_sha256", "effective_at", "expires_at"}
_RECEIPT_TARGET_FIELDS = {"platform", "repository", "revision", "environment", "target_sha256"}
_RECEIPT_RISK_CONTROL_FIELDS = {"risk_policy_id", "risk_policy_version", "risk_policy_sha256"}
_RECEIPT_ROOT_FIELDS = {"root_id", "trusted_policy_root_sha256", "expires_at"}


class GcpKmsPolicyValidationError(ValueError):
    """Raised when a KMS public root or detached signature is untrustworthy."""


def _fail(message: str) -> None:
    raise GcpKmsPolicyValidationError(message)


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
                _fail(f"{path}.{key} is forbidden in a KMS policy root")
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
        raise GcpKmsPolicyValidationError(f"{path} must be a valid calendar timestamp") from exc
    return parsed.replace(tzinfo=UTC)


def _validate_window(created_at: datetime, effective_at: datetime, expires_at: datetime) -> None:
    if created_at > effective_at:
        _fail("trusted_policy_root.created_at must not be after effective_at")
    if expires_at <= effective_at:
        _fail("trusted_policy_root.expires_at must be after effective_at")
    if expires_at - effective_at > _MAX_ROOT_VALIDITY:
        _fail("trusted policy root validity window exceeds its maximum")


def _canonical_json(value: Mapping[str, Any], *, omitted_field: str | None, label: str) -> str:
    if not isinstance(value, Mapping):
        _fail(f"{label} must be an object")
    content = dict(value)
    if omitted_field is not None:
        content.pop(omitted_field, None)
    try:
        return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise GcpKmsPolicyValidationError(f"{label} cannot be represented as canonical JSON") from exc


def _canonical_sha256(value: Mapping[str, Any], *, omitted_field: str | None, label: str) -> str:
    return hashlib.sha256(_canonical_json(value, omitted_field=omitted_field, label=label).encode("utf-8")).hexdigest()


def calculate_gcp_kms_policy_gate_receipt_sha256(receipt: Mapping[str, Any]) -> str:
    """Return the canonical digest of one detached, non-secret gate receipt."""
    return _canonical_sha256(
        receipt,
        omitted_field="receipt_sha256",
        label="GCP KMS policy-gate receipt",
    )


def _target_sha256(target: Mapping[str, Any]) -> str:
    return _canonical_sha256(target, omitted_field=None, label="policy target")


def _receipt_mapping(value: Any, fields: set[str], label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or set(value) != fields:
        _fail(f"invalid {label}")
    return value


def _receipt_timestamp(value: Any, label: str) -> tuple[str, datetime]:
    return str(value), _parse_timestamp(value, label)


def _receipt_repository(value: Any, label: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*", value):
        _fail(f"invalid {label}")
    return value


def build_gcp_kms_policy_gate_receipt(
    verified_gate: Mapping[str, Any],
    *,
    verified_at: str,
) -> dict[str, Any]:
    """Project one successful KMS policy verification into a minimal receipt.

    This function never verifies, signs, fetches, or writes anything.  Its
    caller must use the return value of ``validate_gcp_kms_policy_gate`` from
    an independently protected control service.  The receipt intentionally
    excludes signatures, public keys, account aliases, account digests, and
    all credentials so it can be passed to a no-broker P5 gateway.
    """
    if not isinstance(verified_gate, Mapping) or set(verified_gate) != {
        "activation",
        "policy",
        "signature_sha256",
        "trusted_policy_root",
    }:
        _fail("invalid verified GCP KMS policy gate")
    activation = _receipt_mapping(verified_gate["activation"], {
        "schema", "activation_id", "created_at", "digest_algorithm", "contract_only", "deployment_bundle",
        "stage", "effective_at", "expires_at", "operating_authority", "target", "activation_sha256",
    }, "verified activation")
    policy = _receipt_mapping(verified_gate["policy"], {
        "schema", "policy_id", "policy_version", "created_at", "effective_at", "expires_at", "digest_algorithm",
        "stage", "deployment_bundle", "target", "risk_control", "allowed_ai_actions", "forbidden_ai_actions",
        "policy_sha256",
    }, "verified policy")
    root = _receipt_mapping(verified_gate["trusted_policy_root"], _ROOT_FIELDS, "verified trusted policy root")
    if activation["stage"] != policy["stage"] or activation["target"] != policy["target"]:
        _fail("verified policy and activation are not bound")
    if activation["deployment_bundle"] != policy["deployment_bundle"]:
        _fail("verified policy and activation bundle mismatch")
    target = _receipt_mapping(policy["target"], {
        "platform", "repository", "revision", "environment", "account_alias", "account_digest_sha256",
    }, "verified policy target")
    risk_control = _receipt_mapping(policy["risk_control"], {
        "risk_policy_id", "risk_policy_version", "risk_policy_sha256",
    }, "verified policy risk control")
    bundle = _receipt_mapping(policy["deployment_bundle"], _RECEIPT_BUNDLE_FIELDS, "verified deployment bundle")
    timestamp, _ = _receipt_timestamp(verified_at, "verified_at")
    receipt: dict[str, Any] = {
        "schema": POLICY_GATE_RECEIPT_SCHEMA_ID,
        "verified_at": timestamp,
        "deployment_bundle": {
            "schema": bundle["schema"],
            "bundle_id": bundle["bundle_id"],
            "bundle_sha256": bundle["bundle_sha256"],
        },
        "policy": {
            "policy_id": policy["policy_id"],
            "policy_version": policy["policy_version"],
            "policy_sha256": policy["policy_sha256"],
            "stage": policy["stage"],
            "effective_at": policy["effective_at"],
            "expires_at": policy["expires_at"],
        },
        "activation": {
            "activation_id": activation["activation_id"],
            "activation_sha256": activation["activation_sha256"],
            "effective_at": activation["effective_at"],
            "expires_at": activation["expires_at"],
        },
        "target": {
            "platform": target["platform"],
            "repository": target["repository"],
            "revision": target["revision"],
            "environment": target["environment"],
            "target_sha256": _target_sha256(target),
        },
        "risk_control": {
            "risk_policy_id": risk_control["risk_policy_id"],
            "risk_policy_version": risk_control["risk_policy_version"],
            "risk_policy_sha256": risk_control["risk_policy_sha256"],
        },
        "trusted_policy_root": {
            "root_id": root["root_id"],
            "trusted_policy_root_sha256": root["trusted_policy_root_sha256"],
            "expires_at": root["expires_at"],
        },
        "signature_sha256": verified_gate["signature_sha256"],
        "receipt_sha256": "",
    }
    receipt["receipt_sha256"] = calculate_gcp_kms_policy_gate_receipt_sha256(receipt)
    return validate_gcp_kms_policy_gate_receipt(receipt, as_of=verified_at)


def validate_gcp_kms_policy_gate_receipt(
    receipt: Any,
    *,
    as_of: str | None = None,
) -> dict[str, Any]:
    """Validate a minimal receipt created only after a KMS policy-gate pass."""
    value = _receipt_mapping(receipt, _RECEIPT_FIELDS, "GCP KMS policy-gate receipt")
    if value["schema"] != POLICY_GATE_RECEIPT_SCHEMA_ID:
        _fail(f"receipt.schema must be {POLICY_GATE_RECEIPT_SCHEMA_ID}")
    verified_at_text, verified_at = _receipt_timestamp(value["verified_at"], "receipt.verified_at")
    bundle = _receipt_mapping(value["deployment_bundle"], _RECEIPT_BUNDLE_FIELDS, "receipt deployment bundle")
    if bundle["schema"] != "qsl.deployment_bundle.v1":
        _fail("invalid receipt deployment bundle")
    bundle_id = _expect_identity(bundle["bundle_id"], "receipt deployment bundle id")
    bundle_sha256 = _expect_sha256(bundle["bundle_sha256"], "receipt deployment bundle digest")
    policy = _receipt_mapping(value["policy"], _RECEIPT_POLICY_FIELDS, "receipt policy")
    policy_effective_text, policy_effective = _receipt_timestamp(policy["effective_at"], "receipt policy effective_at")
    policy_expires_text, policy_expires = _receipt_timestamp(policy["expires_at"], "receipt policy expires_at")
    policy_stage = policy["stage"]
    if policy_stage not in {"DISABLED", "PAPER_DRY_RUN", "SHADOW", "LIMITED_LIVE", "FULL_LIVE"}:
        _fail("invalid receipt policy stage")
    normalized_policy = {
        "policy_id": _expect_identity(policy["policy_id"], "receipt policy id"),
        "policy_version": _expect_identity(policy["policy_version"], "receipt policy version"),
        "policy_sha256": _expect_sha256(policy["policy_sha256"], "receipt policy digest"),
        "stage": policy_stage,
        "effective_at": policy_effective_text,
        "expires_at": policy_expires_text,
    }
    activation = _receipt_mapping(value["activation"], _RECEIPT_ACTIVATION_FIELDS, "receipt activation")
    activation_effective_text, activation_effective = _receipt_timestamp(
        activation["effective_at"], "receipt activation effective_at"
    )
    activation_expires_text, activation_expires = _receipt_timestamp(
        activation["expires_at"], "receipt activation expires_at"
    )
    normalized_activation = {
        "activation_id": _expect_identity(activation["activation_id"], "receipt activation id"),
        "activation_sha256": _expect_sha256(activation["activation_sha256"], "receipt activation digest"),
        "effective_at": activation_effective_text,
        "expires_at": activation_expires_text,
    }
    target = _receipt_mapping(value["target"], _RECEIPT_TARGET_FIELDS, "receipt target")
    normalized_target = {
        "platform": _expect_identity(target["platform"], "receipt target platform"),
        "repository": _receipt_repository(target["repository"], "receipt target repository"),
        "revision": _expect_revision(target["revision"], "receipt target revision"),
        "environment": _expect_identity(target["environment"], "receipt target environment"),
        "target_sha256": _expect_sha256(target["target_sha256"], "receipt target digest"),
    }
    risk_control = _receipt_mapping(value["risk_control"], _RECEIPT_RISK_CONTROL_FIELDS, "receipt risk control")
    normalized_risk_control = {
        "risk_policy_id": _expect_identity(risk_control["risk_policy_id"], "receipt risk policy id"),
        "risk_policy_version": _expect_identity(risk_control["risk_policy_version"], "receipt risk policy version"),
        "risk_policy_sha256": _expect_sha256(risk_control["risk_policy_sha256"], "receipt risk policy digest"),
    }
    root = _receipt_mapping(value["trusted_policy_root"], _RECEIPT_ROOT_FIELDS, "receipt trusted policy root")
    root_expires_text, root_expires = _receipt_timestamp(root["expires_at"], "receipt trusted policy root expires_at")
    normalized_root = {
        "root_id": _expect_identity(root["root_id"], "receipt trusted policy root id"),
        "trusted_policy_root_sha256": _expect_sha256(root["trusted_policy_root_sha256"], "receipt trusted policy root digest"),
        "expires_at": root_expires_text,
    }
    signature_sha256 = _expect_sha256(value["signature_sha256"], "receipt signature digest")
    receipt_sha256 = _expect_sha256(value["receipt_sha256"], "receipt digest")
    if activation_effective < policy_effective or activation_expires > policy_expires:
        _fail("receipt activation window is not contained in policy window")
    observed_at = datetime.now(UTC).replace(microsecond=0) if as_of is None else _parse_timestamp(as_of, "as_of")
    if (
        observed_at < verified_at
        or observed_at < policy_effective
        or observed_at < activation_effective
        or observed_at >= min(policy_expires, activation_expires, root_expires)
    ):
        _fail("receipt is not currently effective")
    normalized: dict[str, Any] = {
        "schema": POLICY_GATE_RECEIPT_SCHEMA_ID,
        "verified_at": verified_at_text,
        "deployment_bundle": {"schema": "qsl.deployment_bundle.v1", "bundle_id": bundle_id, "bundle_sha256": bundle_sha256},
        "policy": normalized_policy,
        "activation": normalized_activation,
        "target": normalized_target,
        "risk_control": normalized_risk_control,
        "trusted_policy_root": normalized_root,
        "signature_sha256": signature_sha256,
        "receipt_sha256": receipt_sha256,
    }
    if receipt_sha256 != calculate_gcp_kms_policy_gate_receipt_sha256(normalized):
        _fail("receipt_sha256 mismatch")
    return normalized


def canonical_trusted_root_json(root: Mapping[str, Any]) -> str:
    if not isinstance(root, Mapping):
        _fail("trusted policy root must be an object")
    content = dict(root)
    content.pop("trusted_policy_root_sha256", None)
    try:
        return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise GcpKmsPolicyValidationError("trusted policy root cannot be represented as canonical JSON") from exc


def calculate_trusted_policy_root_sha256(root: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_trusted_root_json(root).encode("utf-8")).hexdigest()


def _validate_p256_public_key(public_key_pem: Any) -> str:
    if not isinstance(public_key_pem, str) or not public_key_pem.startswith("-----BEGIN PUBLIC KEY-----\n") or not public_key_pem.endswith(
        "-----END PUBLIC KEY-----\n"
    ):
        _fail("trusted policy root public_key_pem must be a canonical PEM public key")
    with tempfile.TemporaryDirectory(prefix="qsl-kms-public-key-") as directory:
        key_path = Path(directory) / "public.pem"
        key_path.write_text(public_key_pem, encoding="utf-8")
        try:
            result = subprocess.run(
                ["openssl", "pkey", "-pubin", "-in", str(key_path), "-text_pub", "-noout"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        except OSError as exc:
            raise GcpKmsPolicyValidationError("OpenSSL public-key verifier is unavailable") from exc
    if result.returncode != 0:
        _fail("trusted policy root public_key_pem is invalid")
    description = result.stdout.decode("utf-8", errors="replace")
    if "prime256v1" not in description and "P-256" not in description:
        _fail("trusted policy root public_key_pem must be a P-256 public key")
    return public_key_pem


def validate_gcp_kms_policy_root(root: Any, *, expected_root_sha256: Any, as_of: str | None = None) -> Mapping[str, Any]:
    """Validate a Cloud KMS P-256 public root pinned outside this repository."""
    _reject_non_finite_or_null(root, "trusted_policy_root")
    _reject_forbidden_material(root, "trusted_policy_root")
    value = _expect_object(root, "trusted_policy_root")
    _expect_exact_keys(value, _ROOT_FIELDS, "trusted_policy_root")
    if value["schema"] != TRUSTED_ROOT_SCHEMA_ID:
        _fail(f"trusted_policy_root.schema must be {TRUSTED_ROOT_SCHEMA_ID}")
    _expect_identity(value["root_id"], "trusted_policy_root.root_id")
    created_at = _parse_timestamp(value["created_at"], "trusted_policy_root.created_at")
    effective_at = _parse_timestamp(value["effective_at"], "trusted_policy_root.effective_at")
    expires_at = _parse_timestamp(value["expires_at"], "trusted_policy_root.expires_at")
    _validate_window(created_at, effective_at, expires_at)
    if value["digest_algorithm"] != _DIGEST_ALGORITHM:
        _fail("trusted_policy_root.digest_algorithm must be sha256")
    if not isinstance(value["kms_key_version"], str) or not _KMS_KEY_VERSION_PATTERN.fullmatch(value["kms_key_version"]):
        _fail("trusted_policy_root.kms_key_version must be a pinned Cloud KMS key-version identity")
    if value["signature_algorithm"] != _SIGNATURE_ALGORITHM:
        _fail(f"trusted_policy_root.signature_algorithm must be {_SIGNATURE_ALGORITHM}")
    public_key_pem = _validate_p256_public_key(value["public_key_pem"])
    _expect_sha256(value["public_key_sha256"], "trusted_policy_root.public_key_sha256")
    if value["public_key_sha256"] != hashlib.sha256(public_key_pem.encode("utf-8")).hexdigest():
        _fail("trusted_policy_root.public_key_sha256 mismatch")
    _expect_sha256(value["trusted_policy_root_sha256"], "trusted_policy_root.trusted_policy_root_sha256")
    if value["trusted_policy_root_sha256"] != calculate_trusted_policy_root_sha256(value):
        _fail("trusted_policy_root_sha256 mismatch")
    _expect_sha256(expected_root_sha256, "expected_root_sha256")
    if value["trusted_policy_root_sha256"] != expected_root_sha256:
        _fail("trusted policy root does not match the externally pinned root digest")
    observed_at = datetime.now(UTC).replace(microsecond=0) if as_of is None else _parse_timestamp(as_of, "as_of")
    if observed_at < effective_at or observed_at >= expires_at:
        _fail("trusted policy root is not currently effective")
    return value


def _verify_kms_signature(policy: Mapping[str, Any], root: Mapping[str, Any], signature: bytes) -> str:
    if not isinstance(signature, bytes) or not signature:
        _fail("policy signature must be a non-empty byte sequence")
    signature_sha256 = hashlib.sha256(signature).hexdigest()
    with tempfile.TemporaryDirectory(prefix="qsl-kms-policy-verify-") as directory:
        temporary = Path(directory)
        public_key_path = temporary / "public.pem"
        signature_path = temporary / "policy.der"
        policy_path = temporary / "policy.json"
        public_key_path.write_text(str(root["public_key_pem"]), encoding="utf-8")
        signature_path.write_bytes(signature)
        policy_path.write_text(canonical_policy_json(policy), encoding="utf-8")
        try:
            result = subprocess.run(
                [
                    "openssl",
                    "dgst",
                    "-sha256",
                    "-verify",
                    str(public_key_path),
                    "-signature",
                    str(signature_path),
                    str(policy_path),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        except OSError as exc:
            raise GcpKmsPolicyValidationError("OpenSSL signature verifier is unavailable") from exc
    if result.returncode != 0:
        _fail("KMS policy signature verification failed")
    return signature_sha256


def _activation_authority_from_policy(policy: Mapping[str, Any], signature_sha256: str) -> dict[str, Any]:
    return {
        "mode": "PREAUTHORIZED_AUTONOMY",
        "stage": policy["stage"],
        "policy_id": policy["policy_id"],
        "policy_version": policy["policy_version"],
        "policy_receipt_sha256": signature_sha256,
        "allowed_ai_actions": [
            "evidence_validation",
            "monitor_readonly",
            "release_evaluation",
            "research_candidate_generation",
        ],
        "forbidden_ai_actions": [
            "credential_access",
            "direct_order_submission",
            "kill_switch_reset",
            "policy_mutation",
            "risk_limit_mutation",
        ],
    }


def validate_gcp_kms_policy_gate(
    *,
    bundle: Any,
    activation: Any,
    policy: Any,
    signature: bytes,
    trusted_policy_root: Any,
    expected_root_sha256: Any,
    as_of: str | None = None,
) -> Mapping[str, Any]:
    """Verify a KMS-P256 signed policy and bind it exactly to bundle and activation."""
    try:
        validated_bundle = validate_bundle(bundle)
    except BundleValidationError as exc:
        raise GcpKmsPolicyValidationError(f"expected bundle is invalid: {exc}") from exc
    root = validate_gcp_kms_policy_root(trusted_policy_root, expected_root_sha256=expected_root_sha256, as_of=as_of)
    try:
        validated_policy = validate_autonomous_operating_policy(policy, as_of=as_of)
    except AutonomousPolicyValidationError as exc:
        raise GcpKmsPolicyValidationError(f"policy is invalid: {exc}") from exc
    signature_sha256 = _verify_kms_signature(validated_policy, root, signature)
    root_effective = _parse_timestamp(root["effective_at"], "trusted_policy_root.effective_at")
    root_expires = _parse_timestamp(root["expires_at"], "trusted_policy_root.expires_at")
    policy_effective = _parse_timestamp(validated_policy["effective_at"], "policy.effective_at")
    policy_expires = _parse_timestamp(validated_policy["expires_at"], "policy.expires_at")
    if policy_effective < root_effective or policy_expires > root_expires:
        _fail("policy validity window is not contained within the trusted policy root window")
    expected_bundle_reference = {
        "schema": validated_bundle["schema"],
        "bundle_id": validated_bundle["bundle_id"],
        "bundle_sha256": validated_bundle["bundle_sha256"],
    }
    if validated_policy["deployment_bundle"] != expected_bundle_reference:
        _fail("policy deployment bundle does not match the exact expected bundle")
    try:
        validated_activation = validate_activation(
            activation,
            expected_bundle=validated_bundle,
            expected_operating_authority=_activation_authority_from_policy(validated_policy, signature_sha256),
            as_of=as_of,
        )
    except ActivationValidationError as exc:
        raise GcpKmsPolicyValidationError(f"activation is invalid for the KMS signed policy: {exc}") from exc
    if validated_policy["target"] != validated_activation["target"]:
        _fail("policy target does not match the exact activation target")
    activation_effective = _parse_timestamp(validated_activation["effective_at"], "activation.effective_at")
    activation_expires = _parse_timestamp(validated_activation["expires_at"], "activation.expires_at")
    if activation_effective < policy_effective or activation_expires > policy_expires:
        _fail("activation validity window is not contained within the KMS signed policy window")
    return {
        "activation": validated_activation,
        "policy": validated_policy,
        "signature_sha256": signature_sha256,
        "trusted_policy_root": root,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify a Cloud KMS P-256 signed QSL autonomous policy")
    parser.add_argument("--bundle", type=Path, required=True, help="exact DeploymentBundle JSON")
    parser.add_argument("--activation", type=Path, required=True, help="contract-only Activation JSON")
    parser.add_argument("--policy", type=Path, required=True, help="KMS-signed autonomous policy JSON")
    parser.add_argument("--policy-signature", type=Path, required=True, help="detached DER policy signature")
    parser.add_argument("--trusted-policy-root", type=Path, required=True, help="public Cloud KMS policy-root JSON")
    parser.add_argument(
        "--receipt-output",
        type=Path,
        help="optional create-only path for the non-secret verified policy-gate receipt",
    )
    parser.add_argument("--as-of", help="inject canonical UTC validation time; defaults to current UTC")
    args = parser.parse_args(argv)
    try:
        expected_root_sha256 = os.environ.get("QSL_TRUSTED_POLICY_ROOT_SHA256", "")
        if not expected_root_sha256:
            _fail("QSL_TRUSTED_POLICY_ROOT_SHA256 must be injected by the independent execution control")
        result = validate_gcp_kms_policy_gate(
            bundle=parse_bundle_json(args.bundle.read_text(encoding="utf-8")),
            activation=parse_json(args.activation.read_text(encoding="utf-8"), label="activation"),
            policy=parse_json(args.policy.read_text(encoding="utf-8"), label="policy"),
            signature=args.policy_signature.read_bytes(),
            trusted_policy_root=parse_json(args.trusted_policy_root.read_text(encoding="utf-8"), label="trusted policy root"),
            expected_root_sha256=expected_root_sha256,
            as_of=args.as_of,
        )
        receipt = None
        if args.receipt_output is not None:
            verified_at = args.as_of or datetime.now(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
            receipt = build_gcp_kms_policy_gate_receipt(result, verified_at=verified_at)
            with args.receipt_output.open("x", encoding="utf-8") as handle:
                handle.write(json.dumps(receipt, sort_keys=True, separators=(",", ":"), ensure_ascii=True))
                handle.write("\n")
    except (OSError, AutonomousPolicyValidationError, BundleValidationError, GcpKmsPolicyValidationError) as exc:
        print(f"GCP KMS policy gate failed: {exc}", file=sys.stderr)
        return 1
    summary = {
        "activation_id": result["activation"]["activation_id"],
        "kms_key_version": result["trusted_policy_root"]["kms_key_version"],
        "policy_id": result["policy"]["policy_id"],
        "signature_sha256": result["signature_sha256"],
        "stage": result["policy"]["stage"],
    }
    if receipt is not None:
        summary["receipt_sha256"] = receipt["receipt_sha256"]
    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
