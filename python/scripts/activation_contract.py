#!/usr/bin/env python3
"""Validate local-only QSL Activation v2 contracts and promotion manifests."""

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

SCHEMA_ID = "qsl.activation.v2"
BUNDLE_SCHEMA_ID = "qsl.deployment_bundle.v1"
STAGES = ("DISABLED", "PAPER_DRY_RUN", "SHADOW", "LIMITED_LIVE", "FULL_LIVE")
_DIGEST_ALGORITHM = "sha256"
_IDENTITY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_TIMESTAMP_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
_REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$")
_MOVING_OR_DEFAULT_ALIASES = {"current", "default", "head", "latest", "main"}
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
    "operating_authority",
    "target",
    "activation_sha256",
}
_BUNDLE_REFERENCE_FIELDS = {"schema", "bundle_id", "bundle_sha256"}
_OPERATING_AUTHORITY_FIELDS = {
    "mode",
    "stage",
    "policy_id",
    "policy_version",
    "policy_receipt_sha256",
    "allowed_ai_actions",
    "forbidden_ai_actions",
}
_TARGET_FIELDS = {
    "platform",
    "repository",
    "revision",
    "environment",
    "account_alias",
    "account_digest_sha256",
}
_PROMOTION_REQUIRED_FIELDS = {
    "schema",
    "manifest_kind",
    "single_use_id",
    "issued_at",
    "expires_at",
    "digest_algorithm",
    "contract_only",
    "candidate",
    "target",
    "promotion_sha256",
}
_PROMOTION_CANDIDATE_FIELDS = {
    "strategy_profile",
    "source_revision",
    "artifact_sha256",
    "config_sha256",
    "risk_sha256",
}
_PROMOTION_TARGET_FIELDS = {"platform", "target_name", "execution_mode"}
_PROMOTION_KIND = "promotion"
_PROMOTION_EXECUTION_MODES = ("paper", "live")
_AUTONOMY_MODE = "PREAUTHORIZED_AUTONOMY"
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


def _expect_bound_revision(value: Any, path: str) -> str:
    revision = _expect_revision(value, path)
    if revision == "0" * 40:
        _fail(f"{path} must not use an unknown revision sentinel")
    return revision


def _expect_bound_sha256(value: Any, path: str) -> str:
    digest = _expect_sha256(value, path)
    if digest == "0" * 64:
        _fail(f"{path} must not use an unknown digest sentinel")
    return digest


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


def _validate_operating_authority(value: Any, path: str = "operating_authority") -> Mapping[str, Any]:
    authority = _expect_object(value, path)
    _expect_exact_keys(authority, _OPERATING_AUTHORITY_FIELDS, path)
    if authority["mode"] != _AUTONOMY_MODE:
        _fail(f"{path}.mode must be {_AUTONOMY_MODE}")
    if authority["stage"] not in STAGES:
        _fail(f"{path}.stage must be a canonical activation stage")
    _expect_identity(authority["policy_id"], f"{path}.policy_id")
    _expect_identity(authority["policy_version"], f"{path}.policy_version")
    _expect_sha256(authority["policy_receipt_sha256"], f"{path}.policy_receipt_sha256")
    if authority["allowed_ai_actions"] != list(_ALLOWED_AI_ACTIONS):
        _fail(f"{path}.allowed_ai_actions must be the fixed non-execution action set")
    if authority["forbidden_ai_actions"] != list(_FORBIDDEN_AI_ACTIONS):
        _fail(f"{path}.forbidden_ai_actions must protect the control roots")
    return {
        "mode": _AUTONOMY_MODE,
        "stage": authority["stage"],
        "policy_id": authority["policy_id"],
        "policy_version": authority["policy_version"],
        "policy_receipt_sha256": authority["policy_receipt_sha256"],
        "allowed_ai_actions": list(_ALLOWED_AI_ACTIONS),
        "forbidden_ai_actions": list(_FORBIDDEN_AI_ACTIONS),
    }


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


def _validate_promotion_candidate(value: Any, path: str = "candidate") -> Mapping[str, Any]:
    candidate = _expect_object(value, path)
    _expect_exact_keys(candidate, _PROMOTION_CANDIDATE_FIELDS, path)
    _expect_identity(candidate["strategy_profile"], f"{path}.strategy_profile")
    _expect_bound_revision(candidate["source_revision"], f"{path}.source_revision")
    for field in ("artifact_sha256", "config_sha256", "risk_sha256"):
        _expect_bound_sha256(candidate[field], f"{path}.{field}")
    return candidate


def _validate_promotion_target(value: Any, path: str = "target") -> Mapping[str, Any]:
    target = _expect_object(value, path)
    _expect_exact_keys(target, _PROMOTION_TARGET_FIELDS, path)
    _expect_identity(target["platform"], f"{path}.platform")
    target_name = _expect_identity(target["target_name"], f"{path}.target_name")
    if target_name in _MOVING_OR_DEFAULT_ALIASES:
        _fail(f"{path}.target_name must not use a moving or default alias")
    if target["execution_mode"] not in _PROMOTION_EXECUTION_MODES:
        _fail(f"{path}.execution_mode must be paper or live")
    return target


def _validate_promotion_shape(manifest: Any) -> tuple[Mapping[str, Any], datetime, datetime]:
    _reject_non_finite_or_null(manifest, "promotion_manifest")
    _reject_forbidden_material(manifest, "promotion_manifest")
    root = _expect_object(manifest, "promotion_manifest")
    _expect_exact_keys(root, _PROMOTION_REQUIRED_FIELDS, "promotion_manifest")
    if root["schema"] != SCHEMA_ID:
        _fail(f"schema must be {SCHEMA_ID}")
    if root["manifest_kind"] != _PROMOTION_KIND:
        _fail(f"manifest_kind must be {_PROMOTION_KIND}")
    _expect_identity(root["single_use_id"], "single_use_id")
    issued_at = _parse_timestamp(root["issued_at"], "issued_at")
    expires_at = _parse_timestamp(root["expires_at"], "expires_at")
    if expires_at <= issued_at:
        _fail("expires_at must be after issued_at")
    if root["digest_algorithm"] != _DIGEST_ALGORITHM:
        _fail("digest_algorithm must be sha256")
    if root["contract_only"] is not True:
        _fail("contract_only must be true")
    _validate_promotion_candidate(root["candidate"])
    _validate_promotion_target(root["target"])
    _expect_sha256(root["promotion_sha256"], "promotion_sha256")
    return root, issued_at, expires_at


def canonical_promotion_json(manifest: Mapping[str, Any]) -> str:
    """Return deterministic JSON with only the promotion self hash omitted."""
    if not isinstance(manifest, Mapping):
        _fail("promotion_manifest must be an object")
    content = dict(manifest)
    content.pop("promotion_sha256", None)
    try:
        return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ActivationValidationError("promotion_manifest cannot be represented as canonical JSON") from exc


def calculate_promotion_sha256(manifest: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_promotion_json(manifest).encode("utf-8")).hexdigest()


def validate_promotion_manifest(
    manifest: Any,
    *,
    expected_single_use_id: Any,
    expected_candidate: Any,
    expected_target: Any,
    as_of: str | None = None,
) -> Mapping[str, Any]:
    """Verify exact immutable inputs; durable single-use consumption remains a caller responsibility."""
    root, issued_at, expires_at = _validate_promotion_shape(manifest)
    if root["promotion_sha256"] != calculate_promotion_sha256(root):
        _fail("promotion_sha256 mismatch")
    _expect_identity(expected_single_use_id, "expected_single_use_id")
    candidate = _validate_promotion_candidate(expected_candidate, "expected_candidate")
    target = _validate_promotion_target(expected_target, "expected_target")
    if root["single_use_id"] != expected_single_use_id:
        _fail("single_use_id does not match the exact expected single-use identity")
    if root["candidate"] != candidate:
        _fail("candidate does not match the exact expected candidate")
    if root["target"] != target:
        _fail("target does not match the exact expected target")
    observed_at = datetime.now(UTC).replace(microsecond=0) if as_of is None else _parse_timestamp(as_of, "as_of")
    if observed_at < issued_at:
        _fail("promotion manifest is not yet valid")
    if observed_at >= expires_at:
        _fail("promotion manifest is expired")
    return root


def parse_promotion_manifest_json(
    text: str,
    *,
    expected_single_use_id: Any,
    expected_candidate: Any,
    expected_target: Any,
    as_of: str | None = None,
) -> Mapping[str, Any]:
    return validate_promotion_manifest(
        _load_json(text),
        expected_single_use_id=expected_single_use_id,
        expected_candidate=expected_candidate,
        expected_target=expected_target,
        as_of=as_of,
    )


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
    authority = _validate_operating_authority(root["operating_authority"])
    if authority["stage"] != root["stage"]:
        _fail("operating authority stage must exactly match activation stage")
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


def _validate_expected_operating_authority(root: Mapping[str, Any], expected_operating_authority: Any) -> None:
    if expected_operating_authority is None:
        return
    authority = _validate_operating_authority(expected_operating_authority, "expected_operating_authority")
    if root["operating_authority"] != authority:
        _fail("operating authority reference does not match the exact expected policy")


def _validate_previous_activation(root: Mapping[str, Any], previous_activation: Any) -> None:
    if previous_activation is None:
        return
    previous, _, _, _ = _validate_shape(previous_activation)
    if previous["activation_sha256"] != calculate_activation_sha256(previous):
        _fail("previous activation_sha256 mismatch")
    if previous["stage"] == root["stage"]:
        return
    previous_authority = previous["operating_authority"]
    current_authority = root["operating_authority"]
    reused = any(
        previous_authority[field] == current_authority[field]
        for field in ("policy_id", "policy_receipt_sha256")
    )
    if reused:
        _fail("cross-stage operating policy reuse or upgrade is forbidden")


def validate_activation(
    activation: Any,
    *,
    as_of: str | None = None,
    expected_bundle: Any,
    expected_operating_authority: Any = None,
    previous_activation: Any = None,
) -> Mapping[str, Any]:
    """Fail closed unless identity, autonomous policy, target, time window, and digest all match."""
    root, created_at, effective_at, expires_at = _validate_shape(activation)
    expected_hash = calculate_activation_sha256(root)
    if root["activation_sha256"] != expected_hash:
        _fail("activation_sha256 mismatch")
    _validate_expected_bundle(root, expected_bundle)
    _validate_expected_operating_authority(root, expected_operating_authority)
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
    expected_operating_authority: Any = None,
    previous_activation: Any = None,
) -> Mapping[str, Any]:
    value = _load_json(text)
    return validate_activation(
        value,
        as_of=as_of,
        expected_bundle=expected_bundle,
        expected_operating_authority=expected_operating_authority,
        previous_activation=previous_activation,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="contract-only Activation JSON")
    parser.add_argument("--bundle", type=Path, help="exact DeploymentBundle JSON")
    parser.add_argument("--as-of", help="inject canonical UTC validation time; defaults to current UTC")
    parser.add_argument("--previous", type=Path, help="optional previous Activation used only to reject cross-stage policy reuse")
    parser.add_argument("--promotion-manifest", action="store_true", help="verify the input as a Promotion Manifest")
    parser.add_argument("--expected-single-use-id")
    parser.add_argument("--expected-strategy-profile")
    parser.add_argument("--expected-source-revision")
    parser.add_argument("--expected-artifact-sha256")
    parser.add_argument("--expected-config-sha256")
    parser.add_argument("--expected-risk-sha256")
    parser.add_argument("--expected-platform")
    parser.add_argument("--expected-target-name")
    parser.add_argument("--expected-execution-mode")
    args = parser.parse_args(argv)
    try:
        if args.promotion_manifest:
            activation = parse_promotion_manifest_json(
                args.input.read_text(encoding="utf-8"),
                as_of=args.as_of,
                expected_single_use_id=args.expected_single_use_id,
                expected_candidate={
                    "strategy_profile": args.expected_strategy_profile,
                    "source_revision": args.expected_source_revision,
                    "artifact_sha256": args.expected_artifact_sha256,
                    "config_sha256": args.expected_config_sha256,
                    "risk_sha256": args.expected_risk_sha256,
                },
                expected_target={
                    "platform": args.expected_platform,
                    "target_name": args.expected_target_name,
                    "execution_mode": args.expected_execution_mode,
                },
            )
        else:
            if args.bundle is None:
                _fail("exact DeploymentBundle JSON is required")
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
    if args.promotion_manifest:
        summary = {"contract_only": True, "schema": activation["schema"], "verified": "promotion_manifest"}
    else:
        summary = {
            "activation_sha256": activation["activation_sha256"],
            "contract_only": True,
            "schema": activation["schema"],
        }
    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
