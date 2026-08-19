#!/usr/bin/env python3
"""Fail-closed offline validation of a signed non-trading research-data authorization.

This module is deliberately separate from the autonomous execution-policy and
activation contracts.  It never calls Cloud KMS, signs anything, reads a
credential, fetches data, or grants paper, shadow, live, order, or capital
authority.  It only verifies a detached P-256 signature against a public KMS
root whose digest is injected from an independent data-control plane.
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

from gcp_kms_policy_gate import GcpKmsPolicyValidationError, validate_gcp_kms_policy_root


AUTHORIZATION_SCHEMA_ID = "qsl.research_data_authorization.v1"
_DIGEST_ALGORITHM = "sha256"
_MAX_AUTHORIZATION_VALIDITY = timedelta(days=31)
_IDENTITY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$")
_REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_TIMESTAMP_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
_URL_PATTERN = re.compile(r"[a-z][a-z0-9+.-]*://", re.IGNORECASE)
_FORBIDDEN_KEY_PATTERN = re.compile(
    r"credential|secret|token|password|cookie|jwt|private(?:[_-]?key)?|access[_-]?key|"
    r"endpoint|url|raw[_-]?data|bar(?:s)?|candle(?:s)?|price(?:s)?|broker|account",
    re.IGNORECASE,
)
_ALLOWED_OPERATIONS = (
    "historical_market_data_read",
    "offline_replay",
    "p1_private_input_root_create_only_write",
    "p3_private_evidence_metadata_create_only_write",
    "p3_private_input_root_read",
)
_FORBIDDEN_CAPABILITIES = (
    "credential_access",
    "paper_execution",
    "shadow_execution",
    "live_execution",
    "order_submission",
    "capital_allocation",
)
_AUTHORIZATION_FIELDS = {
    "schema",
    "authorization_id",
    "authorization_version",
    "created_at",
    "effective_at",
    "expires_at",
    "digest_algorithm",
    "repository",
    "revision",
    "runner_environment",
    "candidate_config",
    "provider",
    "retention_policy_sha256",
    "allowed_operations",
    "forbidden_capabilities",
    "authorization_sha256",
}
_CANDIDATE_CONFIG_FIELDS = {"candidate_sha256", "config_sha256"}
_PROVIDER_FIELDS = {"provider_id"}


class ResearchDataAuthorizationValidationError(ValueError):
    """Raised when a non-trading research-data authorization is untrustworthy."""


def _fail(message: str) -> None:
    raise ResearchDataAuthorizationValidationError(message)


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
                _fail(f"{path}.{key} is forbidden in a research-data authorization")
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
        raise ResearchDataAuthorizationValidationError(f"{path} must be a valid calendar timestamp") from exc
    return parsed.replace(tzinfo=UTC)


def _validate_window(created_at: datetime, effective_at: datetime, expires_at: datetime) -> None:
    if created_at > effective_at:
        _fail("authorization.created_at must not be after effective_at")
    if expires_at <= effective_at:
        _fail("authorization.expires_at must be after effective_at")
    if expires_at - effective_at > _MAX_AUTHORIZATION_VALIDITY:
        _fail("research-data authorization validity window exceeds its maximum")


def canonical_research_data_authorization_json(authorization: Mapping[str, Any]) -> str:
    """Return canonical JSON with only the authorization self-hash omitted."""
    if not isinstance(authorization, Mapping):
        _fail("research-data authorization must be an object")
    content = dict(authorization)
    content.pop("authorization_sha256", None)
    try:
        return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ResearchDataAuthorizationValidationError(
            "research-data authorization cannot be represented as canonical JSON"
        ) from exc


def calculate_research_data_authorization_sha256(authorization: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_research_data_authorization_json(authorization).encode("utf-8")).hexdigest()


def _validate_candidate_config(value: Any) -> Mapping[str, Any]:
    candidate_config = _expect_object(value, "authorization.candidate_config")
    _expect_exact_keys(candidate_config, _CANDIDATE_CONFIG_FIELDS, "authorization.candidate_config")
    _expect_sha256(candidate_config["candidate_sha256"], "authorization.candidate_config.candidate_sha256")
    _expect_sha256(candidate_config["config_sha256"], "authorization.candidate_config.config_sha256")
    return candidate_config


def _validate_provider(value: Any) -> Mapping[str, Any]:
    provider = _expect_object(value, "authorization.provider")
    _expect_exact_keys(provider, _PROVIDER_FIELDS, "authorization.provider")
    _expect_identity(provider["provider_id"], "authorization.provider.provider_id")
    return provider


def _validate_allowed_operations(value: Any) -> list[str]:
    if not isinstance(value, list) or not value:
        _fail("authorization.allowed_operations must be a non-empty list")
    if value != sorted(value) or len(set(value)) != len(value):
        _fail("authorization.allowed_operations must be sorted and unique")
    if value != list(_ALLOWED_OPERATIONS):
        _fail("authorization.allowed_operations must exactly match the complete P1/P3 non-trading operation set")
    return list(_ALLOWED_OPERATIONS)


def _validate_forbidden_capabilities(value: Any) -> list[str]:
    if value != list(_FORBIDDEN_CAPABILITIES):
        _fail("authorization.forbidden_capabilities must deny credentials and every execution/capital capability")
    return list(_FORBIDDEN_CAPABILITIES)


def validate_research_data_authorization(authorization: Any, *, as_of: str | None = None) -> Mapping[str, Any]:
    """Validate the unsigned research-data authorization shape, digest, and lifetime."""
    _reject_non_finite_or_null(authorization, "authorization")
    _reject_forbidden_material(authorization, "authorization")
    value = _expect_object(authorization, "authorization")
    _expect_exact_keys(value, _AUTHORIZATION_FIELDS, "authorization")
    if value["schema"] != AUTHORIZATION_SCHEMA_ID:
        _fail(f"authorization.schema must be {AUTHORIZATION_SCHEMA_ID}")
    _expect_identity(value["authorization_id"], "authorization.authorization_id")
    _expect_identity(value["authorization_version"], "authorization.authorization_version")
    created_at = _parse_timestamp(value["created_at"], "authorization.created_at")
    effective_at = _parse_timestamp(value["effective_at"], "authorization.effective_at")
    expires_at = _parse_timestamp(value["expires_at"], "authorization.expires_at")
    _validate_window(created_at, effective_at, expires_at)
    if value["digest_algorithm"] != _DIGEST_ALGORITHM:
        _fail("authorization.digest_algorithm must be sha256")
    if not isinstance(value["repository"], str) or not _REPOSITORY_PATTERN.fullmatch(value["repository"]):
        _fail("authorization.repository must be an owner/repository identity, not a URL")
    _expect_revision(value["revision"], "authorization.revision")
    _expect_identity(value["runner_environment"], "authorization.runner_environment")
    _validate_candidate_config(value["candidate_config"])
    _validate_provider(value["provider"])
    _expect_sha256(value["retention_policy_sha256"], "authorization.retention_policy_sha256")
    _validate_allowed_operations(value["allowed_operations"])
    _validate_forbidden_capabilities(value["forbidden_capabilities"])
    _expect_sha256(value["authorization_sha256"], "authorization.authorization_sha256")
    if value["authorization_sha256"] != calculate_research_data_authorization_sha256(value):
        _fail("authorization_sha256 mismatch")
    observed_at = datetime.now(UTC).replace(microsecond=0) if as_of is None else _parse_timestamp(as_of, "as_of")
    if created_at > observed_at:
        _fail("research-data authorization is stale or invalid because created_at is in the future")
    if observed_at < effective_at:
        _fail("research-data authorization is not yet effective")
    if observed_at >= expires_at:
        _fail("research-data authorization is expired")
    return value


def _verify_kms_signature(authorization: Mapping[str, Any], root: Mapping[str, Any], signature: bytes) -> str:
    if not isinstance(signature, bytes) or not signature:
        _fail("research-data authorization signature must be a non-empty byte sequence")
    signature_sha256 = hashlib.sha256(signature).hexdigest()
    with tempfile.TemporaryDirectory(prefix="qsl-research-data-verify-") as directory:
        temporary = Path(directory)
        public_key_path = temporary / "public.pem"
        signature_path = temporary / "authorization.der"
        authorization_path = temporary / "authorization.json"
        public_key_path.write_text(str(root["public_key_pem"]), encoding="utf-8")
        signature_path.write_bytes(signature)
        authorization_path.write_text(canonical_research_data_authorization_json(authorization), encoding="utf-8")
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
                    str(authorization_path),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        except OSError as exc:
            raise ResearchDataAuthorizationValidationError("OpenSSL signature verifier is unavailable") from exc
    if result.returncode != 0:
        _fail("research-data authorization signature verification failed")
    return signature_sha256


def _validate_expected_scope(
    authorization: Mapping[str, Any],
    *,
    expected_repository: Any,
    expected_revision: Any,
    expected_runner_environment: Any,
    expected_candidate_sha256: Any,
    expected_config_sha256: Any,
    expected_provider_id: Any,
    expected_retention_policy_sha256: Any,
) -> None:
    if not isinstance(expected_repository, str) or not _REPOSITORY_PATTERN.fullmatch(expected_repository):
        _fail("expected_repository must be an owner/repository identity, not a URL")
    _expect_revision(expected_revision, "expected_revision")
    _expect_identity(expected_runner_environment, "expected_runner_environment")
    _expect_sha256(expected_candidate_sha256, "expected_candidate_sha256")
    _expect_sha256(expected_config_sha256, "expected_config_sha256")
    _expect_identity(expected_provider_id, "expected_provider_id")
    _expect_sha256(expected_retention_policy_sha256, "expected_retention_policy_sha256")
    expected = {
        "repository": expected_repository,
        "revision": expected_revision,
        "runner_environment": expected_runner_environment,
        "candidate_sha256": expected_candidate_sha256,
        "config_sha256": expected_config_sha256,
        "provider_id": expected_provider_id,
        "retention_policy_sha256": expected_retention_policy_sha256,
    }
    actual = {
        "repository": authorization["repository"],
        "revision": authorization["revision"],
        "runner_environment": authorization["runner_environment"],
        "candidate_sha256": authorization["candidate_config"]["candidate_sha256"],
        "config_sha256": authorization["candidate_config"]["config_sha256"],
        "provider_id": authorization["provider"]["provider_id"],
        "retention_policy_sha256": authorization["retention_policy_sha256"],
    }
    if actual != expected:
        _fail(
            "research-data authorization does not match the exact expected "
            "repository, revision, runner environment, candidate, config, provider, and retention policy"
        )


def validate_research_data_authorization_gate(
    *,
    authorization: Any,
    signature: bytes,
    trusted_policy_root: Any,
    expected_root_sha256: Any,
    expected_repository: Any,
    expected_revision: Any,
    expected_runner_environment: Any,
    expected_candidate_sha256: Any,
    expected_config_sha256: Any,
    expected_provider_id: Any,
    expected_retention_policy_sha256: Any,
    as_of: str | None = None,
) -> Mapping[str, Any]:
    """Verify a P-256 signed authorization without invoking any execution gate.

    The expected scope is supplied independently by the caller.  A valid
    signature alone never lets an authorization move to another repository,
    revision, runner environment, candidate/config digest, provider, or
    retention-policy decision.
    """
    try:
        root = validate_gcp_kms_policy_root(
            trusted_policy_root,
            expected_root_sha256=expected_root_sha256,
            as_of=as_of,
        )
    except GcpKmsPolicyValidationError as exc:
        raise ResearchDataAuthorizationValidationError(f"trusted KMS public root is invalid: {exc}") from exc
    validated = validate_research_data_authorization(authorization, as_of=as_of)
    signature_sha256 = _verify_kms_signature(validated, root, signature)
    root_effective = _parse_timestamp(root["effective_at"], "trusted_policy_root.effective_at")
    root_expires = _parse_timestamp(root["expires_at"], "trusted_policy_root.expires_at")
    authorization_effective = _parse_timestamp(validated["effective_at"], "authorization.effective_at")
    authorization_expires = _parse_timestamp(validated["expires_at"], "authorization.expires_at")
    if authorization_effective < root_effective or authorization_expires > root_expires:
        _fail("research-data authorization validity window is not contained within the trusted policy root window")
    _validate_expected_scope(
        validated,
        expected_repository=expected_repository,
        expected_revision=expected_revision,
        expected_runner_environment=expected_runner_environment,
        expected_candidate_sha256=expected_candidate_sha256,
        expected_config_sha256=expected_config_sha256,
        expected_provider_id=expected_provider_id,
        expected_retention_policy_sha256=expected_retention_policy_sha256,
    )
    return {
        "authorization": validated,
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


def parse_research_data_authorization_json(text: str) -> Mapping[str, Any]:
    try:
        value = json.loads(
            text,
            object_pairs_hook=_reject_duplicate_pairs,
            parse_constant=lambda _: _fail("non-finite JSON value"),
        )
    except json.JSONDecodeError as exc:
        raise ResearchDataAuthorizationValidationError("invalid JSON") from exc
    if not isinstance(value, Mapping):
        _fail("research-data authorization must be a JSON object")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify a signed QSL non-trading research-data authorization"
    )
    parser.add_argument("--authorization", type=Path, required=True, help="signed research-data authorization JSON")
    parser.add_argument(
        "--authorization-signature",
        type=Path,
        required=True,
        help="detached DER authorization signature",
    )
    parser.add_argument("--trusted-policy-root", type=Path, required=True, help="public Cloud KMS policy-root JSON")
    parser.add_argument(
        "--expected-repository",
        required=True,
        help="exact owner/repository identity expected by this caller",
    )
    parser.add_argument(
        "--expected-revision",
        required=True,
        help="exact immutable repository revision expected by this caller",
    )
    parser.add_argument(
        "--expected-runner-environment",
        required=True,
        help="exact GitHub/runner environment identity expected by this caller",
    )
    parser.add_argument(
        "--expected-candidate-sha256",
        required=True,
        help="exact immutable candidate digest expected by this caller",
    )
    parser.add_argument(
        "--expected-config-sha256",
        required=True,
        help="exact immutable config digest expected by this caller",
    )
    parser.add_argument("--expected-provider-id", required=True, help="exact provider identity expected by this caller")
    parser.add_argument(
        "--expected-retention-policy-sha256",
        required=True,
        help="exact immutable license/retention-policy digest expected by this caller",
    )
    parser.add_argument("--as-of", help="inject canonical UTC validation time; defaults to current UTC")
    args = parser.parse_args(argv)
    try:
        expected_root_sha256 = os.environ.get("QSL_RESEARCH_DATA_POLICY_ROOT_SHA256", "")
        if not expected_root_sha256:
            _fail("QSL_RESEARCH_DATA_POLICY_ROOT_SHA256 must be injected by the independent data control")
        result = validate_research_data_authorization_gate(
            authorization=parse_research_data_authorization_json(args.authorization.read_text(encoding="utf-8")),
            signature=args.authorization_signature.read_bytes(),
            trusted_policy_root=parse_research_data_authorization_json(
                args.trusted_policy_root.read_text(encoding="utf-8")
            ),
            expected_root_sha256=expected_root_sha256,
            expected_repository=args.expected_repository,
            expected_revision=args.expected_revision,
            expected_runner_environment=args.expected_runner_environment,
            expected_candidate_sha256=args.expected_candidate_sha256,
            expected_config_sha256=args.expected_config_sha256,
            expected_provider_id=args.expected_provider_id,
            expected_retention_policy_sha256=args.expected_retention_policy_sha256,
            as_of=args.as_of,
        )
    except (OSError, GcpKmsPolicyValidationError, ResearchDataAuthorizationValidationError) as exc:
        print(f"research-data authorization gate failed: {exc}", file=sys.stderr)
        return 1
    authorization = result["authorization"]
    print(
        json.dumps(
            {
                "authorization_id": authorization["authorization_id"],
                "candidate_sha256": authorization["candidate_config"]["candidate_sha256"],
                "config_sha256": authorization["candidate_config"]["config_sha256"],
                "provider_id": authorization["provider"]["provider_id"],
                "repository": authorization["repository"],
                "retention_policy_sha256": authorization["retention_policy_sha256"],
                "revision": authorization["revision"],
                "runner_environment": authorization["runner_environment"],
                "signature_sha256": result["signature_sha256"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
