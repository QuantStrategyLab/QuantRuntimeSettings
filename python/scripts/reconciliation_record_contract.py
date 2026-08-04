#!/usr/bin/env python3
"""Validate the contract-only QSL ReconciliationRecord v1 consumer contract."""

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

from activation_contract import ActivationValidationError, parse_activation_json, validate_activation
from deployment_bundle_contract import BundleValidationError, parse_bundle_json, validate_bundle

SCHEMA_ID = "qsl.reconciliation_record.v1"
BUNDLE_SCHEMA_ID = "qsl.deployment_bundle.v1"
ACTIVATION_SCHEMA_ID = "qsl.activation.v1"
OBSERVER_SCHEMA_ID = "qsl.reconciliation_observer_receipt.v1"
RECONCILIATION_STATUSES = ("MISSING", "MATCHED", "MISMATCHED")
COMPARISON_FIELDS = (
    "deployment_bundle_sha256",
    "activation_id",
    "activation_sha256",
    "platform",
    "repository",
    "revision",
    "environment",
    "account_alias",
    "account_digest_sha256",
)

_IDENTITY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_TIMESTAMP_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
_REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$")
_FORBIDDEN_KEY_PATTERN = re.compile(
    r"credential|secret|token|password|cookie|jwt|private(?:[_-]?key)?|api[_-]?key|access[_-]?key|"
    r"provider[_-]?rows?|raw[_-]?provider|account[_-]?(?:number|id|balance)|balance|positions?|orders?|"
    r"fills?|capital(?:[_-]?(?:amount|balance|value))?",
    re.IGNORECASE,
)
_ALLOWED_ASSERTION_KEYS = {"fills_verified", "capital_use_verified"}
_URL_PATTERN = re.compile(r"[a-z][a-z0-9+.-]*://", re.IGNORECASE)
_JWT_PATTERN = re.compile(r"(?:^|\s)[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:$|\s)")
_BEARER_PATTERN = re.compile(r"(?:^|\s)bearer\s+\S+", re.IGNORECASE)

_COMMON_FIELDS = {
    "schema",
    "reconciliation_id",
    "created_at",
    "expires_at",
    "digest_algorithm",
    "contract_only",
    "deployment_bundle",
    "activation",
    "target",
    "expected_identity",
    "status",
    "assertions",
    "reconciliation_sha256",
}
_OBSERVATION_FIELDS = {"observed_identity", "observer_receipt", "comparison"}
_BUNDLE_REFERENCE_FIELDS = {"schema", "bundle_id", "bundle_sha256"}
_ACTIVATION_REFERENCE_FIELDS = {"schema", "activation_id", "activation_sha256"}
_TARGET_FIELDS = {
    "platform",
    "repository",
    "revision",
    "environment",
    "account_alias",
    "account_digest_sha256",
}
_EXPECTED_IDENTITY_FIELDS = set(COMPARISON_FIELDS) | {"expected_identity_sha256"}
_OBSERVED_IDENTITY_FIELDS = set(COMPARISON_FIELDS) | {
    "producer_id",
    "producer_revision",
    "artifact_sha256",
    "observed_at",
    "observed_identity_sha256",
}
_OBSERVER_RECEIPT_FIELDS = {
    "schema",
    "observer_id",
    "observer_revision",
    "created_at",
    "observed_identity",
    "observer_receipt_sha256",
}
_ASSERTION_FIELDS = {
    "apply_performed",
    "config_sync_performed",
    "runtime_mutation_performed",
    "runtime_active",
    "fills_verified",
    "capital_use_verified",
}


class ReconciliationValidationError(ValueError):
    """Raised when an input is not a valid consumer-side reconciliation record."""


def _fail(message: str) -> None:
    raise ReconciliationValidationError(message)


def _reject_non_finite_or_null(value: Any, path: str = "reconciliation") -> None:
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


def _reject_forbidden_material(value: Any, path: str = "reconciliation") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            if key not in _ALLOWED_ASSERTION_KEYS and _FORBIDDEN_KEY_PATTERN.search(key):
                _fail(f"{path}.{key} is forbidden in a reconciliation contract")
            _reject_forbidden_material(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_forbidden_material(child, f"{path}[{index}]")
    elif isinstance(value, str):
        if _URL_PATTERN.search(value):
            _fail(f"{path} contains a forbidden credential-capable URL")
        if _JWT_PATTERN.search(value) or _BEARER_PATTERN.search(value):
            _fail(f"{path} contains forbidden credential material")


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


def _expect_repository(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _REPOSITORY_PATTERN.fullmatch(value):
        _fail(f"{path} must be an owner/repository identity, not a URL")
    return value


def _parse_timestamp(value: Any, path: str) -> datetime:
    if not isinstance(value, str) or not _TIMESTAMP_PATTERN.fullmatch(value):
        _fail(f"{path} must be an RFC3339 UTC timestamp with whole seconds")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise ReconciliationValidationError(f"{path} must be a valid calendar timestamp") from exc
    return parsed.replace(tzinfo=UTC)


def _canonical_without(value: Mapping[str, Any], excluded_field: str, path: str) -> str:
    if not isinstance(value, Mapping):
        _fail(f"{path} must be an object")
    content = dict(value)
    content.pop(excluded_field, None)
    try:
        return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ReconciliationValidationError(f"{path} cannot be represented as canonical JSON") from exc


def canonical_json(record: Mapping[str, Any]) -> str:
    """Return deterministic JSON with only the record's self hash omitted."""
    return _canonical_without(record, "reconciliation_sha256", "reconciliation")


def calculate_reconciliation_sha256(record: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_json(record).encode("utf-8")).hexdigest()


def calculate_expected_identity_sha256(identity: Mapping[str, Any]) -> str:
    canonical = _canonical_without(identity, "expected_identity_sha256", "expected_identity")
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def calculate_observed_identity_sha256(identity: Mapping[str, Any]) -> str:
    canonical = _canonical_without(identity, "observed_identity_sha256", "observed_identity")
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def calculate_observer_receipt_sha256(receipt: Mapping[str, Any]) -> str:
    canonical = _canonical_without(receipt, "observer_receipt_sha256", "observer_receipt")
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _validate_target(value: Any, path: str = "target") -> Mapping[str, Any]:
    target = _expect_object(value, path)
    _expect_exact_keys(target, _TARGET_FIELDS, path)
    _expect_identity(target["platform"], f"{path}.platform")
    _expect_repository(target["repository"], f"{path}.repository")
    _expect_revision(target["revision"], f"{path}.revision")
    _expect_identity(target["environment"], f"{path}.environment")
    _expect_identity(target["account_alias"], f"{path}.account_alias", allow_numeric_only=False)
    _expect_sha256(target["account_digest_sha256"], f"{path}.account_digest_sha256")
    return target


def _expected_identity(bundle: Mapping[str, Any], activation: Mapping[str, Any]) -> dict[str, Any]:
    target = activation["target"]
    identity = {
        "deployment_bundle_sha256": bundle["bundle_sha256"],
        "activation_id": activation["activation_id"],
        "activation_sha256": activation["activation_sha256"],
        "platform": target["platform"],
        "repository": target["repository"],
        "revision": target["revision"],
        "environment": target["environment"],
        "account_alias": target["account_alias"],
        "account_digest_sha256": target["account_digest_sha256"],
    }
    identity["expected_identity_sha256"] = calculate_expected_identity_sha256(identity)
    return identity


def _validate_expected_identity(value: Any) -> Mapping[str, Any]:
    identity = _expect_object(value, "expected_identity")
    _expect_exact_keys(identity, _EXPECTED_IDENTITY_FIELDS, "expected_identity")
    _expect_sha256(identity["deployment_bundle_sha256"], "expected_identity.deployment_bundle_sha256")
    _expect_identity(identity["activation_id"], "expected_identity.activation_id")
    _expect_sha256(identity["activation_sha256"], "expected_identity.activation_sha256")
    _validate_target({field: identity[field] for field in _TARGET_FIELDS}, "expected_identity")
    _expect_sha256(identity["expected_identity_sha256"], "expected_identity.expected_identity_sha256")
    if identity["expected_identity_sha256"] != calculate_expected_identity_sha256(identity):
        _fail("expected_identity_sha256 mismatch")
    return identity


def _validate_observed_identity(value: Any) -> tuple[Mapping[str, Any], datetime]:
    identity = _expect_object(value, "observed_identity")
    _expect_exact_keys(identity, _OBSERVED_IDENTITY_FIELDS, "observed_identity")
    _expect_sha256(identity["deployment_bundle_sha256"], "observed_identity.deployment_bundle_sha256")
    _expect_identity(identity["activation_id"], "observed_identity.activation_id")
    _expect_sha256(identity["activation_sha256"], "observed_identity.activation_sha256")
    _validate_target({field: identity[field] for field in _TARGET_FIELDS}, "observed_identity")
    _expect_identity(identity["producer_id"], "observed_identity.producer_id")
    _expect_revision(identity["producer_revision"], "observed_identity.producer_revision")
    _expect_sha256(identity["artifact_sha256"], "observed_identity.artifact_sha256")
    observed_at = _parse_timestamp(identity["observed_at"], "observed_identity.observed_at")
    _expect_sha256(identity["observed_identity_sha256"], "observed_identity.observed_identity_sha256")
    if identity["observed_identity_sha256"] != calculate_observed_identity_sha256(identity):
        _fail("observed_identity_sha256 mismatch")
    return identity, observed_at


def _validate_observer_receipt(value: Any) -> tuple[Mapping[str, Any], Mapping[str, Any], datetime]:
    receipt = _expect_object(value, "observer_receipt")
    _expect_exact_keys(receipt, _OBSERVER_RECEIPT_FIELDS, "observer_receipt")
    if receipt["schema"] != OBSERVER_SCHEMA_ID:
        _fail(f"observer_receipt.schema must be {OBSERVER_SCHEMA_ID}")
    _expect_identity(receipt["observer_id"], "observer_receipt.observer_id")
    _expect_revision(receipt["observer_revision"], "observer_receipt.observer_revision")
    created_at = _parse_timestamp(receipt["created_at"], "observer_receipt.created_at")
    observed, _ = _validate_observed_identity(receipt["observed_identity"])
    if receipt["observer_id"] == observed["producer_id"]:
        _fail("observer receipt must be produced by an identity separate from the platform producer")
    _expect_sha256(receipt["observer_receipt_sha256"], "observer_receipt.observer_receipt_sha256")
    if receipt["observer_receipt_sha256"] != calculate_observer_receipt_sha256(receipt):
        _fail("observer_receipt_sha256 mismatch")
    return receipt, observed, created_at


def _validate_comparison(
    value: Any,
    expected: Mapping[str, Any],
    observed: Mapping[str, Any],
) -> list[str]:
    comparison = _expect_object(value, "comparison")
    _expect_exact_keys(comparison, {"complete", "fields"}, "comparison")
    if comparison["complete"] is not True:
        _fail("comparison.complete must be true for an observed reconciliation")
    fields = _expect_object(comparison["fields"], "comparison.fields")
    _expect_exact_keys(fields, set(COMPARISON_FIELDS), "comparison.fields")
    differences = []
    for field in COMPARISON_FIELDS:
        entry = _expect_object(fields[field], f"comparison.fields.{field}")
        _expect_exact_keys(entry, {"expected", "observed", "equal"}, f"comparison.fields.{field}")
        if entry["expected"] != expected[field] or entry["observed"] != observed[field]:
            _fail(f"comparison.fields.{field} does not bind the exact expected and observed values")
        equality = expected[field] == observed[field]
        if entry["equal"] is not equality:
            _fail(f"comparison.fields.{field}.equal is inconsistent")
        if not equality:
            differences.append(field)
    return differences


def _validate_references(
    root: Mapping[str, Any],
    bundle: Mapping[str, Any],
    activation: Mapping[str, Any],
) -> Mapping[str, Any]:
    bundle_reference = _expect_object(root["deployment_bundle"], "deployment_bundle")
    _expect_exact_keys(bundle_reference, _BUNDLE_REFERENCE_FIELDS, "deployment_bundle")
    expected_bundle_reference = {
        "schema": BUNDLE_SCHEMA_ID,
        "bundle_id": bundle["bundle_id"],
        "bundle_sha256": bundle["bundle_sha256"],
    }
    if bundle_reference != expected_bundle_reference:
        _fail("deployment bundle reference does not match the exact expected bundle identity")

    activation_reference = _expect_object(root["activation"], "activation")
    _expect_exact_keys(activation_reference, _ACTIVATION_REFERENCE_FIELDS, "activation")
    expected_activation_reference = {
        "schema": ACTIVATION_SCHEMA_ID,
        "activation_id": activation["activation_id"],
        "activation_sha256": activation["activation_sha256"],
    }
    if activation_reference != expected_activation_reference:
        _fail("activation reference does not match the exact expected activation identity")

    target = _validate_target(root["target"])
    if target != activation["target"]:
        _fail("target does not match the exact activation target")
    expected_identity = _validate_expected_identity(root["expected_identity"])
    if expected_identity != _expected_identity(bundle, activation):
        _fail("expected_identity does not match the exact bundle, activation, and target identity")
    return expected_identity


def _validate_assertions(value: Any) -> None:
    assertions = _expect_object(value, "assertions")
    _expect_exact_keys(assertions, _ASSERTION_FIELDS, "assertions")
    for field in _ASSERTION_FIELDS:
        if assertions[field] is not False:
            _fail(f"assertions.{field} must be false for a contract-only record")


def validate_reconciliation_record(
    record: Any,
    *,
    expected_bundle: Any,
    expected_activation: Any,
    as_of: str | None = None,
) -> Mapping[str, Any]:
    """Validate exact expected identity and optional independently observed truth, fail closed."""
    _reject_non_finite_or_null(record)
    _reject_forbidden_material(record)
    root = _expect_object(record, "reconciliation")
    status = root.get("status")
    if status not in RECONCILIATION_STATUSES:
        _fail("status must be one of MISSING, MATCHED, MISMATCHED")
    expected_fields = _COMMON_FIELDS if status == "MISSING" else _COMMON_FIELDS | _OBSERVATION_FIELDS
    _expect_exact_keys(root, expected_fields, "reconciliation")
    if root["schema"] != SCHEMA_ID:
        _fail(f"schema must be {SCHEMA_ID}")
    _expect_identity(root["reconciliation_id"], "reconciliation_id")
    created_at = _parse_timestamp(root["created_at"], "created_at")
    expires_at = _parse_timestamp(root["expires_at"], "expires_at")
    if expires_at <= created_at:
        _fail("expires_at must be after created_at")
    if root["digest_algorithm"] != "sha256":
        _fail("digest_algorithm must be sha256")
    if root["contract_only"] is not True:
        _fail("contract_only must be true")
    _expect_sha256(root["reconciliation_sha256"], "reconciliation_sha256")
    if root["reconciliation_sha256"] != calculate_reconciliation_sha256(root):
        _fail("reconciliation_sha256 mismatch")
    _validate_assertions(root["assertions"])

    if expected_bundle is None or expected_activation is None:
        _fail("exact expected bundle and activation inputs are required")
    try:
        bundle = validate_bundle(expected_bundle)
        activation = validate_activation(
            expected_activation,
            as_of=as_of,
            expected_bundle=bundle,
        )
    except (BundleValidationError, ActivationValidationError) as exc:
        raise ReconciliationValidationError(f"expected bundle or activation is invalid: {exc}") from exc
    expected = _validate_references(root, bundle, activation)

    validation_time = datetime.now(UTC).replace(microsecond=0) if as_of is None else _parse_timestamp(as_of, "as_of")
    if created_at > validation_time:
        _fail("reconciliation record was created in the future")
    if validation_time >= expires_at:
        _fail("reconciliation record is stale or expired")
    activation_effective = _parse_timestamp(activation["effective_at"], "expected_activation.effective_at")
    activation_expires = _parse_timestamp(activation["expires_at"], "expected_activation.expires_at")
    if created_at < activation_effective or expires_at > activation_expires:
        _fail("reconciliation validity window must remain within the activation window")

    if status == "MISSING":
        return root

    observed, observed_at = _validate_observed_identity(root["observed_identity"])
    _, receipt_observed, receipt_created_at = _validate_observer_receipt(root["observer_receipt"])
    if receipt_observed != observed:
        _fail("observer_receipt does not bind the exact platform-produced observed identity")
    if observed_at < activation_effective or observed_at > created_at:
        _fail("observed identity is stale or was produced after the reconciliation record")
    if receipt_created_at < observed_at or receipt_created_at > created_at:
        _fail("observer receipt time must be between observation and reconciliation creation")
    differences = _validate_comparison(root["comparison"], expected, observed)
    if status == "MATCHED" and differences:
        _fail("MATCHED requires every expected and observed identity field to be exactly equal")
    if status == "MISMATCHED" and not differences:
        _fail("MISMATCHED requires at least one explicit required-field difference")
    return root


def build_missing_record(
    *,
    record_id: str,
    created_at: str,
    expires_at: str,
    expected_bundle: Any,
    expected_activation: Any,
    as_of: str | None = None,
) -> dict[str, Any]:
    """Build only the safe default MISSING record; never synthesize observed platform truth."""
    try:
        bundle = validate_bundle(expected_bundle)
        activation = validate_activation(expected_activation, as_of=as_of, expected_bundle=bundle)
    except (BundleValidationError, ActivationValidationError) as exc:
        raise ReconciliationValidationError(f"expected bundle or activation is invalid: {exc}") from exc
    record = {
        "schema": SCHEMA_ID,
        "reconciliation_id": record_id,
        "created_at": created_at,
        "expires_at": expires_at,
        "digest_algorithm": "sha256",
        "contract_only": True,
        "deployment_bundle": {
            "schema": BUNDLE_SCHEMA_ID,
            "bundle_id": bundle["bundle_id"],
            "bundle_sha256": bundle["bundle_sha256"],
        },
        "activation": {
            "schema": ACTIVATION_SCHEMA_ID,
            "activation_id": activation["activation_id"],
            "activation_sha256": activation["activation_sha256"],
        },
        "target": dict(activation["target"]),
        "expected_identity": _expected_identity(bundle, activation),
        "status": "MISSING",
        "assertions": {field: False for field in sorted(_ASSERTION_FIELDS)},
    }
    record["reconciliation_sha256"] = calculate_reconciliation_sha256(record)
    validate_reconciliation_record(
        record,
        expected_bundle=bundle,
        expected_activation=activation,
        as_of=as_of,
    )
    return record


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
        raise ReconciliationValidationError("invalid JSON") from exc


def parse_reconciliation_json(
    text: str,
    *,
    expected_bundle: Any,
    expected_activation: Any,
    as_of: str | None = None,
) -> Mapping[str, Any]:
    return validate_reconciliation_record(
        _load_json(text),
        expected_bundle=expected_bundle,
        expected_activation=expected_activation,
        as_of=as_of,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="contract-only ReconciliationRecord JSON")
    parser.add_argument("--bundle", type=Path, required=True, help="exact DeploymentBundle JSON")
    parser.add_argument("--activation", type=Path, required=True, help="exact Activation JSON")
    parser.add_argument("--as-of", help="inject canonical UTC validation time; defaults to current UTC")
    args = parser.parse_args(argv)
    try:
        bundle = parse_bundle_json(args.bundle.read_text(encoding="utf-8"))
        activation = parse_activation_json(
            args.activation.read_text(encoding="utf-8"),
            as_of=args.as_of,
            expected_bundle=bundle,
        )
        record = parse_reconciliation_json(
            args.input.read_text(encoding="utf-8"),
            expected_bundle=bundle,
            expected_activation=activation,
            as_of=args.as_of,
        )
    except (OSError, ReconciliationValidationError, ActivationValidationError, BundleValidationError) as exc:
        print(f"reconciliation validation failed: {exc}", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "contract_only": True,
                "reconciliation_sha256": record["reconciliation_sha256"],
                "schema": record["schema"],
                "status": record["status"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
