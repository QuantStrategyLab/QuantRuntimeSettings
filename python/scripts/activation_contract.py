#!/usr/bin/env python3
"""Validate the local-only QSL Activation v1 contract."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping

from deployment_bundle_contract import BundleValidationError, parse_bundle_json, validate_bundle

SCHEMA_ID = "qsl.activation.v1"
BUNDLE_SCHEMA_ID = "qsl.deployment_bundle.v1"
STAGES = ("DISABLED", "PAPER_DRY_RUN", "SHADOW", "LIMITED_LIVE", "FULL_LIVE")
_DIGEST_ALGORITHM = "sha256"
_IDENTITY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_TIMESTAMP_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
_REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$")
_FORBIDDEN_KEY_PATTERN = re.compile(
    r"credential|secret|token|password|cookie|jwt|private(?:[_-]?key)?|access[_-]?key|"
    r"broker|order|capital|fill|matched|runtime[_-]?active|config[_-]?applied|applied",
    re.IGNORECASE,
)
_URL_PATTERN = re.compile(r"[a-z][a-z0-9+.-]*://", re.IGNORECASE)
_REQUIRED_FIELDS = {
    "schema",
    "activation_id",
    "created_at",
    "digest_algorithm",
    "contract_only",
    "deployment_bundle",
    "stage",
    "effective_at",
    "expires_at",
    "human_authority",
    "target",
    "activation_sha256",
}
_BUNDLE_REFERENCE_FIELDS = {"schema", "bundle_id", "bundle_sha256"}
_AUTHORITY_FIELDS = {"stage", "authority_id", "authority_version", "authority_receipt_sha256"}
_TARGET_FIELDS = {
    "platform",
    "repository",
    "revision",
    "environment",
    "account_alias",
    "account_digest_sha256",
}


class ActivationValidationError(ValueError):
    """Raised when an input is not a valid contract-only Activation."""


def _fail(message: str) -> None:
    raise ActivationValidationError(message)


def _reject_non_finite_or_null(value: Any, path: str = "activation") -> None:
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


def _reject_forbidden_material(value: Any, path: str = "activation") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            if _FORBIDDEN_KEY_PATTERN.search(key):
                _fail(f"{path}.{key} is forbidden in an activation contract")
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


def _expect_identity(value: Any, path: str, *, allow_numeric_only: bool = True) -> str:
    if not isinstance(value, str) or not _IDENTITY_PATTERN.fullmatch(value):
        _fail(f"{path} must be a lowercase immutable identity")
    if not allow_numeric_only and value.isdigit():
        _fail(f"{path} must be a non-sensitive alias, not a numeric account identifier")
    return value


def _expect_revision(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _REVISION_PATTERN.fullmatch(value):
        _fail(f"{path} must be a lowercase 40-character revision")
    return value


def _expect_sha256(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _SHA256_PATTERN.fullmatch(value):
        _fail(f"{path} must be a lowercase SHA-256 digest")
    return value


def _parse_timestamp(value: Any, path: str) -> datetime:
    if not isinstance(value, str) or not _TIMESTAMP_PATTERN.fullmatch(value):
        _fail(f"{path} must be an RFC3339 UTC timestamp with whole seconds")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise ActivationValidationError(f"{path} must be a valid calendar timestamp") from exc
    return parsed.replace(tzinfo=UTC)


def _validate_bundle_reference(value: Any) -> Mapping[str, Any]:
    reference = _expect_object(value, "deployment_bundle")
    _expect_exact_keys(reference, _BUNDLE_REFERENCE_FIELDS, "deployment_bundle")
    if reference["schema"] != BUNDLE_SCHEMA_ID:
        _fail(f"deployment_bundle.schema must be {BUNDLE_SCHEMA_ID}")
    _expect_identity(reference["bundle_id"], "deployment_bundle.bundle_id")
    _expect_sha256(reference["bundle_sha256"], "deployment_bundle.bundle_sha256")
    return reference


def _validate_authority(value: Any, path: str = "human_authority") -> Mapping[str, Any]:
    authority = _expect_object(value, path)
    _expect_exact_keys(authority, _AUTHORITY_FIELDS, path)
    if authority["stage"] not in STAGES:
        _fail(f"{path}.stage must be a canonical activation stage")
    _expect_identity(authority["authority_id"], f"{path}.authority_id")
    _expect_identity(authority["authority_version"], f"{path}.authority_version")
    _expect_sha256(authority["authority_receipt_sha256"], f"{path}.authority_receipt_sha256")
    return authority


def _validate_target(value: Any) -> Mapping[str, Any]:
    target = _expect_object(value, "target")
    _expect_exact_keys(target, _TARGET_FIELDS, "target")
    _expect_identity(target["platform"], "target.platform")
    if not isinstance(target["repository"], str) or not _REPOSITORY_PATTERN.fullmatch(target["repository"]):
        _fail("target.repository must be an owner/repository identity, not a URL")
    _expect_revision(target["revision"], "target.revision")
    _expect_identity(target["environment"], "target.environment")
    _expect_identity(target["account_alias"], "target.account_alias", allow_numeric_only=False)
    _expect_sha256(target["account_digest_sha256"], "target.account_digest_sha256")
    return target


def _validate_shape(activation: Any) -> tuple[Mapping[str, Any], datetime, datetime, datetime]:
    _reject_non_finite_or_null(activation)
    _reject_forbidden_material(activation)
    root = _expect_object(activation, "activation")
    _expect_exact_keys(root, _REQUIRED_FIELDS, "activation")
    if root["schema"] != SCHEMA_ID:
        _fail(f"schema must be {SCHEMA_ID}")
    _expect_identity(root["activation_id"], "activation_id")
    created_at = _parse_timestamp(root["created_at"], "created_at")
    if root["digest_algorithm"] != _DIGEST_ALGORITHM:
        _fail("digest_algorithm must be sha256")
    if root["contract_only"] is not True:
        _fail("contract_only must be true")
    _validate_bundle_reference(root["deployment_bundle"])
    if root["stage"] not in STAGES:
        _fail("stage must be a canonical activation stage")
    effective_at = _parse_timestamp(root["effective_at"], "effective_at")
    expires_at = _parse_timestamp(root["expires_at"], "expires_at")
    if created_at > effective_at:
        _fail("created_at must not be after effective_at")
    if expires_at <= effective_at:
        _fail("expires_at must be after effective_at")
    authority = _validate_authority(root["human_authority"])
    if authority["stage"] != root["stage"]:
        _fail("human authority stage must exactly match activation stage")
    _validate_target(root["target"])
    _expect_sha256(root["activation_sha256"], "activation_sha256")
    return root, created_at, effective_at, expires_at


def canonical_json(activation: Mapping[str, Any]) -> str:
    """Return deterministic JSON with only the Activation self hash omitted."""
    if not isinstance(activation, Mapping):
        _fail("activation must be an object")
    content = dict(activation)
    content.pop("activation_sha256", None)
    try:
        return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ActivationValidationError("activation cannot be represented as canonical JSON") from exc


def calculate_activation_sha256(activation: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_json(activation).encode("utf-8")).hexdigest()


def _validate_expected_bundle(root: Mapping[str, Any], expected_bundle: Any) -> None:
    if expected_bundle is None:
        _fail("expected qsl.deployment_bundle.v1 is required")
    try:
        bundle = validate_bundle(expected_bundle)
    except BundleValidationError as exc:
        raise ActivationValidationError(f"expected bundle is invalid: {exc}") from exc
    reference = root["deployment_bundle"]
    expected_reference = {
        "schema": bundle["schema"],
        "bundle_id": bundle["bundle_id"],
        "bundle_sha256": bundle["bundle_sha256"],
    }
    if reference != expected_reference:
        _fail("deployment bundle reference does not match the exact expected bundle identity")
    target = root["target"]
    if target["platform"] != bundle["target"]["platform_id"]:
        _fail("activation target does not match deployment bundle target")
    if target["revision"] != bundle["dependencies"]["platform"]["revision"]:
        _fail("activation platform revision does not match deployment bundle platform revision")


def _validate_expected_authority(root: Mapping[str, Any], expected_authority: Any) -> None:
    if expected_authority is None:
        return
    authority = _validate_authority(expected_authority, "expected_authority")
    if root["human_authority"] != authority:
        _fail("human authority reference does not match the exact expected authority")


def _validate_previous_activation(root: Mapping[str, Any], previous_activation: Any) -> None:
    if previous_activation is None:
        return
    previous, _, _, _ = _validate_shape(previous_activation)
    if previous["activation_sha256"] != calculate_activation_sha256(previous):
        _fail("previous activation_sha256 mismatch")
    if previous["stage"] == root["stage"]:
        return
    previous_authority = previous["human_authority"]
    current_authority = root["human_authority"]
    reused = any(
        previous_authority[field] == current_authority[field]
        for field in ("authority_id", "authority_receipt_sha256")
    )
    if reused:
        _fail("cross-stage authority reuse or upgrade is forbidden")


def validate_activation(
    activation: Any,
    *,
    as_of: str | None = None,
    expected_bundle: Any,
    expected_authority: Any = None,
    previous_activation: Any = None,
) -> Mapping[str, Any]:
    """Fail closed unless identity, authority, target, time window, and digest all match."""
    root, created_at, effective_at, expires_at = _validate_shape(activation)
    expected_hash = calculate_activation_sha256(root)
    if root["activation_sha256"] != expected_hash:
        _fail("activation_sha256 mismatch")
    _validate_expected_bundle(root, expected_bundle)
    _validate_expected_authority(root, expected_authority)
    _validate_previous_activation(root, previous_activation)
    observed_at = datetime.now(UTC).replace(microsecond=0) if as_of is None else _parse_timestamp(as_of, "as_of")
    if created_at > observed_at:
        _fail("activation is stale or invalid because created_at is in the future")
    if observed_at < effective_at:
        _fail("activation is not yet effective")
    if observed_at >= expires_at:
        _fail("activation is expired")
    return root


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _fail(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _load_json(text: str) -> Any:
    try:
        return json.loads(
            text,
            object_pairs_hook=_reject_duplicate_pairs,
            parse_constant=lambda _: _fail("non-finite JSON value"),
        )
    except json.JSONDecodeError as exc:
        raise ActivationValidationError("invalid JSON") from exc


def parse_activation_json(
    text: str,
    *,
    as_of: str | None = None,
    expected_bundle: Any = None,
    expected_authority: Any = None,
    previous_activation: Any = None,
) -> Mapping[str, Any]:
    value = _load_json(text)
    return validate_activation(
        value,
        as_of=as_of,
        expected_bundle=expected_bundle,
        expected_authority=expected_authority,
        previous_activation=previous_activation,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="contract-only Activation JSON")
    parser.add_argument("--bundle", type=Path, required=True, help="exact DeploymentBundle JSON")
    parser.add_argument("--as-of", help="inject canonical UTC validation time; defaults to current UTC")
    parser.add_argument("--previous", type=Path, help="optional previous Activation used only to reject cross-stage authority reuse")
    args = parser.parse_args(argv)
    try:
        bundle = parse_bundle_json(args.bundle.read_text(encoding="utf-8"))
        previous = _load_json(args.previous.read_text(encoding="utf-8")) if args.previous else None
        activation = parse_activation_json(
            args.input.read_text(encoding="utf-8"),
            as_of=args.as_of,
            expected_bundle=bundle,
            previous_activation=previous,
        )
    except (OSError, ActivationValidationError, BundleValidationError) as exc:
        print(f"activation validation failed: {exc}", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "activation_sha256": activation["activation_sha256"],
                "contract_only": True,
                "schema": activation["schema"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
