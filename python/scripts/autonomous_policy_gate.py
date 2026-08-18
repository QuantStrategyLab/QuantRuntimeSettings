#!/usr/bin/env python3
"""Fail-closed verification of a signed QSL autonomous operating policy.

This module never signs a policy and never handles a private key.  A caller must
provide the expected trusted-root digest from a control plane outside this
repository.  The policy signature is verified with OpenSSH's audited verifier.
"""

from __future__ import annotations

import argparse
import base64
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
from deployment_bundle_contract import BundleValidationError, parse_bundle_json, validate_bundle

POLICY_SCHEMA_ID = "qsl.autonomous_operating_policy.v1"
TRUSTED_ROOT_SCHEMA_ID = "qsl.trusted_policy_root.v1"
_DIGEST_ALGORITHM = "sha256"
_SSH_SIGNATURE_NAMESPACE = "qsl-policy-v1@quantstrategylab"
_MAX_POLICY_VALIDITY = timedelta(days=31)
_MAX_ROOT_VALIDITY = timedelta(days=366)
_STAGES = ("DISABLED", "PAPER_DRY_RUN", "SHADOW", "LIMITED_LIVE", "FULL_LIVE")
_IDENTITY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_SIGNER_IDENTITY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._+-]*@[a-z0-9][a-z0-9.-]*$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
_TIMESTAMP_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
_REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$")
_FORBIDDEN_KEY_PATTERN = re.compile(
    r"credential|secret|token|password|cookie|jwt|private(?:[_-]?key)?|access[_-]?key|"
    r"broker|order|capital|fill|runtime[_-]?active|config[_-]?applied|applied",
    re.IGNORECASE,
)
_URL_PATTERN = re.compile(r"[a-z][a-z0-9+.-]*://", re.IGNORECASE)
_ALLOWED_AI_ACTIONS = (
    "evidence_validation",
    "monitor_readonly",
    "release_evaluation",
    "research_candidate_generation",
)
_FORBIDDEN_AI_ACTIONS = (
    "credential_access",
    "direct_order_submission",
    "kill_switch_reset",
    "policy_mutation",
    "risk_limit_mutation",
)
_ROOT_FIELDS = {
    "schema",
    "root_id",
    "created_at",
    "effective_at",
    "expires_at",
    "digest_algorithm",
    "signer_identity",
    "signature_namespace",
    "public_key",
    "public_key_sha256",
    "trusted_policy_root_sha256",
}
_POLICY_FIELDS = {
    "schema",
    "policy_id",
    "policy_version",
    "created_at",
    "effective_at",
    "expires_at",
    "digest_algorithm",
    "stage",
    "deployment_bundle",
    "target",
    "risk_control",
    "allowed_ai_actions",
    "forbidden_ai_actions",
    "policy_sha256",
}
_BUNDLE_REFERENCE_FIELDS = {"schema", "bundle_id", "bundle_sha256"}
_TARGET_FIELDS = {
    "platform",
    "repository",
    "revision",
    "environment",
    "account_alias",
    "account_digest_sha256",
}
_RISK_CONTROL_FIELDS = {"risk_policy_id", "risk_policy_version", "risk_policy_sha256"}


class AutonomousPolicyValidationError(ValueError):
    """Raised when a policy, trusted root, or its signature is not trustworthy."""


def _fail(message: str) -> None:
    raise AutonomousPolicyValidationError(message)


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
                _fail(f"{path}.{key} is forbidden in a policy control contract")
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
        raise AutonomousPolicyValidationError(f"{path} must be a valid calendar timestamp") from exc
    return parsed.replace(tzinfo=UTC)


def _validate_window(created_at: datetime, effective_at: datetime, expires_at: datetime, maximum: timedelta, path: str) -> None:
    if created_at > effective_at:
        _fail(f"{path}.created_at must not be after effective_at")
    if expires_at <= effective_at:
        _fail(f"{path}.expires_at must be after effective_at")
    if expires_at - effective_at > maximum:
        _fail(f"{path} validity window exceeds its maximum")


def _validate_bundle_reference(value: Any, path: str) -> Mapping[str, Any]:
    reference = _expect_object(value, path)
    _expect_exact_keys(reference, _BUNDLE_REFERENCE_FIELDS, path)
    if reference["schema"] != "qsl.deployment_bundle.v1":
        _fail(f"{path}.schema must be qsl.deployment_bundle.v1")
    _expect_identity(reference["bundle_id"], f"{path}.bundle_id")
    _expect_sha256(reference["bundle_sha256"], f"{path}.bundle_sha256")
    return reference


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


def _validate_risk_control(value: Any) -> Mapping[str, Any]:
    risk_control = _expect_object(value, "risk_control")
    _expect_exact_keys(risk_control, _RISK_CONTROL_FIELDS, "risk_control")
    _expect_identity(risk_control["risk_policy_id"], "risk_control.risk_policy_id")
    _expect_identity(risk_control["risk_policy_version"], "risk_control.risk_policy_version")
    _expect_sha256(risk_control["risk_policy_sha256"], "risk_control.risk_policy_sha256")
    return risk_control


def _canonical_json(value: Mapping[str, Any], omitted_field: str, label: str) -> str:
    if not isinstance(value, Mapping):
        _fail(f"{label} must be an object")
    content = dict(value)
    content.pop(omitted_field, None)
    try:
        return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise AutonomousPolicyValidationError(f"{label} cannot be represented as canonical JSON") from exc


def canonical_policy_json(policy: Mapping[str, Any]) -> str:
    return _canonical_json(policy, "policy_sha256", "policy")


def calculate_policy_sha256(policy: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_policy_json(policy).encode("utf-8")).hexdigest()


def canonical_trusted_root_json(root: Mapping[str, Any]) -> str:
    return _canonical_json(root, "trusted_policy_root_sha256", "trusted policy root")


def calculate_trusted_policy_root_sha256(root: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_trusted_root_json(root).encode("utf-8")).hexdigest()


def _validate_public_key(value: Any) -> str:
    if not isinstance(value, str) or "\n" in value or "\r" in value:
        _fail("trusted policy root public_key must be a single OpenSSH public-key line")
    parts = value.split()
    if len(parts) not in {2, 3} or parts[0] not in {
        "ssh-ed25519",
        "sk-ssh-ed25519@openssh.com",
        "sk-ecdsa-sha2-nistp256@openssh.com",
    }:
        _fail("trusted policy root public_key must use an approved Ed25519 or security-key OpenSSH algorithm")
    try:
        base64.b64decode(parts[1].encode("ascii"), validate=True)
    except (UnicodeEncodeError, ValueError) as exc:
        raise AutonomousPolicyValidationError("trusted policy root public_key is not valid OpenSSH base64") from exc
    return value


def validate_trusted_policy_root(root: Any, *, expected_root_sha256: Any, as_of: str | None = None) -> Mapping[str, Any]:
    """Validate a public trusted root that is integrity-pinned outside this repository."""
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
    _validate_window(created_at, effective_at, expires_at, _MAX_ROOT_VALIDITY, "trusted_policy_root")
    if value["digest_algorithm"] != _DIGEST_ALGORITHM:
        _fail("trusted_policy_root.digest_algorithm must be sha256")
    if not isinstance(value["signer_identity"], str) or not _SIGNER_IDENTITY_PATTERN.fullmatch(value["signer_identity"]):
        _fail("trusted_policy_root.signer_identity must be a signer user@domain identity")
    if value["signature_namespace"] != _SSH_SIGNATURE_NAMESPACE:
        _fail(f"trusted_policy_root.signature_namespace must be {_SSH_SIGNATURE_NAMESPACE}")
    public_key = _validate_public_key(value["public_key"])
    _expect_sha256(value["public_key_sha256"], "trusted_policy_root.public_key_sha256")
    if value["public_key_sha256"] != hashlib.sha256(public_key.encode("utf-8")).hexdigest():
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


def validate_autonomous_operating_policy(policy: Any, *, as_of: str | None = None) -> Mapping[str, Any]:
    """Validate only the shape and bounded lifetime of a policy, never its signature."""
    _reject_non_finite_or_null(policy, "policy")
    _reject_forbidden_material(policy, "policy")
    value = _expect_object(policy, "policy")
    _expect_exact_keys(value, _POLICY_FIELDS, "policy")
    if value["schema"] != POLICY_SCHEMA_ID:
        _fail(f"policy.schema must be {POLICY_SCHEMA_ID}")
    _expect_identity(value["policy_id"], "policy.policy_id")
    _expect_identity(value["policy_version"], "policy.policy_version")
    created_at = _parse_timestamp(value["created_at"], "policy.created_at")
    effective_at = _parse_timestamp(value["effective_at"], "policy.effective_at")
    expires_at = _parse_timestamp(value["expires_at"], "policy.expires_at")
    _validate_window(created_at, effective_at, expires_at, _MAX_POLICY_VALIDITY, "policy")
    if value["digest_algorithm"] != _DIGEST_ALGORITHM:
        _fail("policy.digest_algorithm must be sha256")
    if value["stage"] not in _STAGES:
        _fail("policy.stage must be a canonical activation stage")
    _validate_bundle_reference(value["deployment_bundle"], "policy.deployment_bundle")
    _validate_target(value["target"], "policy.target")
    _validate_risk_control(value["risk_control"])
    if value["allowed_ai_actions"] != list(_ALLOWED_AI_ACTIONS):
        _fail("policy.allowed_ai_actions must be the fixed non-execution action set")
    if value["forbidden_ai_actions"] != list(_FORBIDDEN_AI_ACTIONS):
        _fail("policy.forbidden_ai_actions must protect the control roots")
    _expect_sha256(value["policy_sha256"], "policy.policy_sha256")
    if value["policy_sha256"] != calculate_policy_sha256(value):
        _fail("policy_sha256 mismatch")
    observed_at = datetime.now(UTC).replace(microsecond=0) if as_of is None else _parse_timestamp(as_of, "as_of")
    if observed_at < effective_at or observed_at >= expires_at:
        _fail("policy is not currently effective")
    return value


def _verify_ssh_signature(policy: Mapping[str, Any], root: Mapping[str, Any], signature: bytes) -> str:
    if not isinstance(signature, bytes) or not signature:
        _fail("policy signature must be a non-empty byte sequence")
    signature_sha256 = hashlib.sha256(signature).hexdigest()
    public_key = root["public_key"]
    with tempfile.TemporaryDirectory(prefix="qsl-policy-verify-") as directory:
        temporary = Path(directory)
        allowed_signers = temporary / "allowed_signers"
        signature_path = temporary / "policy.sshsig"
        allowed_signers.write_text(
            f'{root["signer_identity"]} namespaces="{root["signature_namespace"]}" {public_key}\n',
            encoding="utf-8",
        )
        signature_path.write_bytes(signature)
        try:
            result = subprocess.run(
                [
                    "ssh-keygen",
                    "-Y",
                    "verify",
                    "-f",
                    str(allowed_signers),
                    "-I",
                    str(root["signer_identity"]),
                    "-n",
                    str(root["signature_namespace"]),
                    "-s",
                    str(signature_path),
                ],
                input=canonical_policy_json(policy).encode("utf-8"),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        except OSError as exc:
            raise AutonomousPolicyValidationError("OpenSSH ssh-keygen -Y verifier is unavailable") from exc
    if result.returncode != 0:
        _fail("policy signature verification failed")
    return signature_sha256


def _activation_authority_from_policy(policy: Mapping[str, Any], signature_sha256: str) -> dict[str, Any]:
    return {
        "mode": "PREAUTHORIZED_AUTONOMY",
        "stage": policy["stage"],
        "policy_id": policy["policy_id"],
        "policy_version": policy["policy_version"],
        "policy_receipt_sha256": signature_sha256,
        "allowed_ai_actions": list(_ALLOWED_AI_ACTIONS),
        "forbidden_ai_actions": list(_FORBIDDEN_AI_ACTIONS),
    }


def validate_policy_gate(
    *,
    bundle: Any,
    activation: Any,
    policy: Any,
    signature: bytes,
    trusted_policy_root: Any,
    expected_root_sha256: Any,
    as_of: str | None = None,
) -> Mapping[str, Any]:
    """Verify the signed policy and bind it exactly to a bundle and activation."""
    try:
        validated_bundle = validate_bundle(bundle)
    except BundleValidationError as exc:
        raise AutonomousPolicyValidationError(f"expected bundle is invalid: {exc}") from exc
    root = validate_trusted_policy_root(trusted_policy_root, expected_root_sha256=expected_root_sha256, as_of=as_of)
    validated_policy = validate_autonomous_operating_policy(policy, as_of=as_of)
    signature_sha256 = _verify_ssh_signature(validated_policy, root, signature)
    expected_bundle_reference = {
        "schema": validated_bundle["schema"],
        "bundle_id": validated_bundle["bundle_id"],
        "bundle_sha256": validated_bundle["bundle_sha256"],
    }
    if validated_policy["deployment_bundle"] != expected_bundle_reference:
        _fail("policy deployment bundle does not match the exact expected bundle")
    policy_effective = _parse_timestamp(validated_policy["effective_at"], "policy.effective_at")
    policy_expires = _parse_timestamp(validated_policy["expires_at"], "policy.expires_at")
    try:
        validated_activation = validate_activation(
            activation,
            expected_bundle=validated_bundle,
            expected_operating_authority=_activation_authority_from_policy(validated_policy, signature_sha256),
            as_of=as_of,
        )
    except ActivationValidationError as exc:
        raise AutonomousPolicyValidationError(f"activation is invalid for the signed policy: {exc}") from exc
    if validated_policy["target"] != validated_activation["target"]:
        _fail("policy target does not match the exact activation target")
    activation_effective = _parse_timestamp(validated_activation["effective_at"], "activation.effective_at")
    activation_expires = _parse_timestamp(validated_activation["expires_at"], "activation.expires_at")
    if activation_effective < policy_effective or activation_expires > policy_expires:
        _fail("activation validity window is not contained within the signed policy window")
    return {
        "activation": validated_activation,
        "policy": validated_policy,
        "signature_sha256": signature_sha256,
        "trusted_policy_root": root,
    }


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _fail(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def parse_json(text: str, *, label: str) -> Any:
    try:
        return json.loads(text, object_pairs_hook=_reject_duplicate_pairs)
    except (TypeError, json.JSONDecodeError) as exc:
        raise AutonomousPolicyValidationError(f"invalid {label} JSON") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify a signed, externally rooted QSL autonomous policy gate")
    parser.add_argument("--bundle", type=Path, required=True, help="exact DeploymentBundle JSON")
    parser.add_argument("--activation", type=Path, required=True, help="contract-only Activation JSON")
    parser.add_argument("--policy", type=Path, required=True, help="signed autonomous policy JSON")
    parser.add_argument("--policy-signature", type=Path, required=True, help="detached OpenSSH policy signature")
    parser.add_argument("--trusted-policy-root", type=Path, required=True, help="public trusted-policy-root JSON")
    parser.add_argument("--as-of", help="inject canonical UTC validation time; defaults to current UTC")
    args = parser.parse_args(argv)
    try:
        expected_root_sha256 = os.environ.get("QSL_TRUSTED_POLICY_ROOT_SHA256", "")
        if not expected_root_sha256:
            _fail("QSL_TRUSTED_POLICY_ROOT_SHA256 must be injected by the independent execution control")
        result = validate_policy_gate(
            bundle=parse_bundle_json(args.bundle.read_text(encoding="utf-8")),
            activation=parse_json(args.activation.read_text(encoding="utf-8"), label="activation"),
            policy=parse_json(args.policy.read_text(encoding="utf-8"), label="policy"),
            signature=args.policy_signature.read_bytes(),
            trusted_policy_root=parse_json(args.trusted_policy_root.read_text(encoding="utf-8"), label="trusted policy root"),
            expected_root_sha256=expected_root_sha256,
            as_of=args.as_of,
        )
    except (OSError, AutonomousPolicyValidationError, BundleValidationError) as exc:
        print(f"autonomous policy gate failed: {exc}", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "activation_id": result["activation"]["activation_id"],
                "policy_id": result["policy"]["policy_id"],
                "schema": result["policy"]["schema"],
                "signature_sha256": result["signature_sha256"],
                "stage": result["policy"]["stage"],
                "trusted_root_id": result["trusted_policy_root"]["root_id"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
