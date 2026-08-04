#!/usr/bin/env python3
"""Validate the local-only immutable QSL DeploymentBundle v1 contract."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping

SCHEMA_ID = "qsl.deployment_bundle.v1"
_DIGEST_ALGORITHM = "sha256"
_IDENTITY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_TIMESTAMP_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
_FORBIDDEN_KEY_PATTERN = re.compile(
    r"credential|secret|token|password|cookie|jwt|private|access[_-]?key|broker|account|order|capital|"
    r"activation|apply|runtime|configured|live[_-]?ready|promotion|matched|fill",
    re.IGNORECASE,
)
_URL_PATTERN = re.compile(r"[a-z][a-z0-9+.-]*://", re.IGNORECASE)
_REQUIRED_FIELDS = {
    "schema",
    "bundle_id",
    "created_at",
    "digest_algorithm",
    "strategy",
    "profile",
    "config",
    "evidence",
    "target",
    "dependencies",
    "bundle_sha256",
}
_REQUIRED_ARTIFACT_FIELDS = {"id", "revision", "artifact_sha256"}


class BundleValidationError(ValueError):
    """Raised when an input is not a valid immutable deployment bundle."""


def _fail(message: str) -> None:
    raise BundleValidationError(message)


def _reject_non_finite_or_null(value: Any, path: str = "bundle") -> None:
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


def _reject_forbidden_material(value: Any, path: str = "bundle") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            if _FORBIDDEN_KEY_PATTERN.search(key):
                _fail(f"{path}.{key} is forbidden in a deployment bundle")
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


def _expect_revision(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _REVISION_PATTERN.fullmatch(value):
        _fail(f"{path} must be a lowercase 40-character revision")
    return value


def _expect_sha256(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _SHA256_PATTERN.fullmatch(value):
        _fail(f"{path} must be a lowercase SHA-256 digest")
    return value


def _expect_timestamp(value: Any) -> str:
    if not isinstance(value, str) or not _TIMESTAMP_PATTERN.fullmatch(value):
        _fail("created_at must be an RFC3339 UTC timestamp with whole seconds")
    try:
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise BundleValidationError("created_at must be a valid calendar timestamp") from exc
    return value


def _validate_artifact_identity(value: Any, path: str, *, strategy: bool = False) -> Mapping[str, Any]:
    identity = _expect_object(value, path)
    expected = _REQUIRED_ARTIFACT_FIELDS | ({"source_id"} if strategy else set())
    _expect_exact_keys(identity, expected, path)
    _expect_identity(identity["id"], f"{path}.id")
    if strategy:
        _expect_identity(identity["source_id"], f"{path}.source_id")
    _expect_revision(identity["revision"], f"{path}.revision")
    _expect_sha256(identity["artifact_sha256"], f"{path}.artifact_sha256")
    return identity


def _validate_shape(bundle: Any) -> Mapping[str, Any]:
    _reject_non_finite_or_null(bundle)
    _reject_forbidden_material(bundle)
    root = _expect_object(bundle, "bundle")
    _expect_exact_keys(root, _REQUIRED_FIELDS, "bundle")
    if root["schema"] != SCHEMA_ID:
        _fail(f"schema must be {SCHEMA_ID}")
    _expect_identity(root["bundle_id"], "bundle_id")
    _expect_timestamp(root["created_at"])
    if root["digest_algorithm"] != _DIGEST_ALGORITHM:
        _fail("digest_algorithm must be sha256")
    strategy = _validate_artifact_identity(root["strategy"], "strategy", strategy=True)
    _validate_artifact_identity(root["profile"], "profile")
    _validate_artifact_identity(root["config"], "config")
    _validate_artifact_identity(root["evidence"], "evidence")
    target = _expect_object(root["target"], "target")
    _expect_exact_keys(target, {"id", "platform_id"}, "target")
    _expect_identity(target["id"], "target.id")
    _expect_identity(target["platform_id"], "target.platform_id")
    dependencies = _expect_object(root["dependencies"], "dependencies")
    _expect_exact_keys(dependencies, {"qpk", "strategy", "pipeline", "platform"}, "dependencies")
    for name in ("qpk", "strategy", "pipeline", "platform"):
        _validate_artifact_identity(dependencies[name], f"dependencies.{name}")
    if strategy["source_id"] != dependencies["strategy"]["id"]:
        _fail("strategy.source_id must match dependencies.strategy.id")
    if target["platform_id"] != dependencies["platform"]["id"]:
        _fail("target.platform_id must match dependencies.platform.id")
    _expect_sha256(root["bundle_sha256"], "bundle_sha256")
    return root


def canonical_json(bundle: Mapping[str, Any]) -> str:
    """Return the deterministic JSON representation with only the self hash omitted."""
    if not isinstance(bundle, Mapping):
        _fail("bundle must be an object")
    content = dict(bundle)
    content.pop("bundle_sha256", None)
    try:
        return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise BundleValidationError("bundle cannot be represented as canonical JSON") from exc


def calculate_bundle_sha256(bundle: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_json(bundle).encode("utf-8")).hexdigest()


def validate_bundle(bundle: Any) -> Mapping[str, Any]:
    """Fail closed unless the exact immutable content matches its declared digest."""
    root = _validate_shape(bundle)
    expected = calculate_bundle_sha256(root)
    if root["bundle_sha256"] != expected:
        _fail("bundle_sha256 mismatch")
    return root


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _fail(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def parse_bundle_json(text: str) -> Mapping[str, Any]:
    try:
        value = json.loads(text, object_pairs_hook=_reject_duplicate_pairs, parse_constant=lambda _: _fail("non-finite JSON value"))
    except json.JSONDecodeError as exc:
        raise BundleValidationError("invalid JSON") from exc
    return validate_bundle(value)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="immutable bundle JSON to validate locally")
    args = parser.parse_args(argv)
    try:
        bundle = parse_bundle_json(args.input.read_text(encoding="utf-8"))
    except (OSError, BundleValidationError) as exc:
        print(f"deployment bundle validation failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"bundle_sha256": bundle["bundle_sha256"], "schema": bundle["schema"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
