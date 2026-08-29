#!/usr/bin/env python3
"""Build a hash-bound, research-only M0 publisher envelope.

This is deliberately an *offline* builder.  It accepts one closed
``qsl_m0_research_source_snapshot.v1`` file and explicit immutable artifact
metadata, then asks the local M0 validator/aggregator to produce a ledger.
The result is written as canonical local JSON.  A network POST is possible
only when ``--publish`` is set and the two dedicated publish environment
variables are present; this module never discovers or reads broker, strategy,
runtime, or general-purpose credentials.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from m0_research_ledger import (
    M0_AUTHORITY,
    M0_LEDGER_SCHEMA,
    M0_NEXT_STEP,
    M0ResearchLedgerValidationError,
    aggregate_m0_research_sources,
)


PUBLISHER_ENVELOPE_SCHEMA = "qsl_m0_research_publisher_envelope.v1"
PUBLISH_URL_ENV = "QSL_M0_RESEARCH_LEDGER_PUBLISH_URL"
PUBLISH_TOKEN_ENV = "QSL_M0_RESEARCH_LEDGER_PUBLISH_TOKEN"
MAX_SOURCE_SNAPSHOT_BYTES = 2 * 1024 * 1024
# The receiving Worker ingress accepts at most 256 KiB.  This is enforced on
# the actual compact UTF-8 JSON body, not on a Python object estimate, source
# artifact size, or character count.
MAX_PUBLISHER_ENVELOPE_BYTES = 256 * 1024

_REPOSITORY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$")
_REVISION = re.compile(r"^[0-9a-f]{40}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_IDENTIFIER = re.compile(r"^[A-Za-z0-9._:/-]{1,128}$")
_CANONICAL_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


class M0ResearchPublisherEnvelopeError(ValueError):
    """Raised when an envelope cannot be built or safely published."""


def canonical_json(value: object) -> str:
    """Return the only JSON representation used for M0 envelope hashes."""

    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise M0ResearchPublisherEnvelopeError("m0_envelope_not_canonicalizable") from exc


def calculate_ledger_sha256(ledger: Mapping[str, Any]) -> str:
    """Hash the complete ledger, never an abbreviated display projection."""

    if not isinstance(ledger, Mapping):
        raise M0ResearchPublisherEnvelopeError("ledger_invalid")
    return hashlib.sha256(canonical_json(dict(ledger)).encode("utf-8")).hexdigest()


def canonical_envelope_body(envelope: Mapping[str, Any]) -> bytes:
    """Serialize the exact compact UTF-8 body used for local output and POST."""

    if not isinstance(envelope, Mapping):
        raise M0ResearchPublisherEnvelopeError("publisher_envelope_invalid")
    return canonical_json(dict(envelope)).encode("utf-8")


def _enforce_publisher_envelope_size(envelope: Mapping[str, Any]) -> None:
    """Fail closed before a too-large envelope can be written or published."""

    if len(canonical_envelope_body(envelope)) > MAX_PUBLISHER_ENVELOPE_BYTES:
        raise M0ResearchPublisherEnvelopeError("publisher_envelope_size_exceeded")


def _exact_mapping(value: object, fields: frozenset[str], label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != fields:
        raise M0ResearchPublisherEnvelopeError(f"{label}_keys_invalid")
    return dict(value)


def _require_repository(value: object, label: str) -> str:
    if not isinstance(value, str) or not _REPOSITORY.fullmatch(value):
        raise M0ResearchPublisherEnvelopeError(f"{label}_invalid")
    return value


def _require_revision(value: object, label: str) -> str:
    if not isinstance(value, str) or not _REVISION.fullmatch(value):
        raise M0ResearchPublisherEnvelopeError(f"{label}_invalid")
    return value


def _require_sha256(value: object, label: str) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise M0ResearchPublisherEnvelopeError(f"{label}_invalid")
    return value


def _require_identifier(value: object, label: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise M0ResearchPublisherEnvelopeError(f"{label}_invalid")
    return value


def canonical_timestamp(value: object, label: str = "now") -> str:
    """Accept only UTC whole-second timestamps and return their canonical form."""

    if not isinstance(value, str) or not _CANONICAL_TIMESTAMP.fullmatch(value):
        raise M0ResearchPublisherEnvelopeError(f"{label}_invalid")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise M0ResearchPublisherEnvelopeError(f"{label}_invalid") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != dt.timedelta(0):
        raise M0ResearchPublisherEnvelopeError(f"{label}_invalid")
    return parsed.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _current_canonical_timestamp() -> str:
    return dt.datetime.now(tz=dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _reject_duplicate_keys(pairs: Sequence[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def load_source_snapshot(path: Path) -> tuple[dict[str, Any], str]:
    """Load one bounded source artifact and return its payload plus byte hash."""

    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise M0ResearchPublisherEnvelopeError("source_snapshot_unreadable") from exc
    if not raw or len(raw) > MAX_SOURCE_SNAPSHOT_BYTES:
        raise M0ResearchPublisherEnvelopeError("source_snapshot_size_invalid")
    try:
        payload = json.loads(raw.decode("utf-8"), object_pairs_hook=_reject_duplicate_keys)
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
        raise M0ResearchPublisherEnvelopeError("source_snapshot_json_invalid") from exc
    if not isinstance(payload, dict):
        raise M0ResearchPublisherEnvelopeError("source_snapshot_object_invalid")
    return payload, hashlib.sha256(raw).hexdigest()


def build_source_artifact_metadata(
    *,
    repository: str,
    revision: str,
    run_id: str,
    artifact_id: str,
    sha256: str,
) -> dict[str, str]:
    """Close the provenance of exactly one source snapshot artifact."""

    return {
        "repository": _require_repository(repository, "source_artifact_repository"),
        "revision": _require_revision(revision, "source_artifact_revision"),
        "run_id": _require_identifier(run_id, "source_artifact_run_id"),
        "artifact_id": _require_identifier(artifact_id, "source_artifact_id"),
        "sha256": _require_sha256(sha256, "source_artifact_sha256"),
    }


def _validate_ledger(ledger: object, *, expected_timestamp: str) -> dict[str, Any]:
    value = _exact_mapping(
        ledger,
        frozenset(
            {
                "schema_version",
                "generated_at",
                "computed_at",
                "data_status",
                "summary",
                "subjects",
                "policy",
                "errors",
            }
        ),
        "ledger",
    )
    if value["schema_version"] != M0_LEDGER_SCHEMA:
        raise M0ResearchPublisherEnvelopeError("ledger_schema_invalid")
    if (
        canonical_timestamp(value["generated_at"], "ledger_generated_at") != expected_timestamp
        or canonical_timestamp(value["computed_at"], "ledger_computed_at") != expected_timestamp
    ):
        raise M0ResearchPublisherEnvelopeError("ledger_time_invalid")
    policy = _exact_mapping(
        value["policy"],
        frozenset({"authority", "no_order", "permitted_next_step", "notice"}),
        "ledger_policy",
    )
    if (
        policy["authority"] != M0_AUTHORITY
        or policy["no_order"] is not True
        or policy["permitted_next_step"] != M0_NEXT_STEP
    ):
        raise M0ResearchPublisherEnvelopeError("ledger_policy_invalid")
    return copy.deepcopy(value)


def build_m0_research_publisher_envelope(
    *,
    source_snapshot: object,
    source_artifact: Mapping[str, Any],
    producer_repository: str,
    producer_revision: str,
    now: str,
) -> dict[str, Any]:
    """Aggregate one immutable M0 source artifact into a strict publish envelope."""

    timestamp = canonical_timestamp(now)
    producer = {
        "repository": _require_repository(producer_repository, "producer_repository"),
        "revision": _require_revision(producer_revision, "producer_revision"),
    }
    artifact = _exact_mapping(
        source_artifact,
        frozenset({"repository", "revision", "run_id", "artifact_id", "sha256"}),
        "source_artifact",
    )
    normalized_artifact = build_source_artifact_metadata(**artifact)
    try:
        ledger = aggregate_m0_research_sources([source_snapshot], now=timestamp)
    except M0ResearchLedgerValidationError as exc:
        raise M0ResearchPublisherEnvelopeError("m0_source_snapshot_invalid") from exc
    normalized_ledger = _validate_ledger(ledger, expected_timestamp=timestamp)
    envelope = {
        "schema_version": PUBLISHER_ENVELOPE_SCHEMA,
        "producer": producer,
        "source_artifact": normalized_artifact,
        "ledger_sha256": calculate_ledger_sha256(normalized_ledger),
        "ledger": normalized_ledger,
    }
    return validate_m0_research_publisher_envelope(envelope)


def validate_m0_research_publisher_envelope(payload: object) -> dict[str, Any]:
    """Verify a strict, non-executable M0 envelope before any optional POST."""

    envelope = _exact_mapping(
        payload,
        frozenset({"schema_version", "producer", "source_artifact", "ledger_sha256", "ledger"}),
        "publisher_envelope",
    )
    if envelope["schema_version"] != PUBLISHER_ENVELOPE_SCHEMA:
        raise M0ResearchPublisherEnvelopeError("publisher_envelope_schema_invalid")
    producer = _exact_mapping(envelope["producer"], frozenset({"repository", "revision"}), "producer")
    normalized_producer = {
        "repository": _require_repository(producer["repository"], "producer_repository"),
        "revision": _require_revision(producer["revision"], "producer_revision"),
    }
    source_artifact = _exact_mapping(
        envelope["source_artifact"],
        frozenset({"repository", "revision", "run_id", "artifact_id", "sha256"}),
        "source_artifact",
    )
    normalized_artifact = build_source_artifact_metadata(**source_artifact)
    ledger = envelope["ledger"]
    if not isinstance(ledger, Mapping):
        raise M0ResearchPublisherEnvelopeError("ledger_invalid")
    # This validator is intentionally narrow: the only ledger accepted by the
    # builder is generated by the local M0 aggregator above.  It still binds
    # the no-order policy and canonical timestamps before a publish attempt.
    generated_at = ledger.get("generated_at")
    expected_timestamp = canonical_timestamp(generated_at, "ledger_generated_at")
    normalized_ledger = _validate_ledger(ledger, expected_timestamp=expected_timestamp)
    expected_digest = calculate_ledger_sha256(normalized_ledger)
    if _require_sha256(envelope["ledger_sha256"], "ledger_sha256") != expected_digest:
        raise M0ResearchPublisherEnvelopeError("ledger_sha256_mismatch")
    normalized = {
        "schema_version": PUBLISHER_ENVELOPE_SCHEMA,
        "producer": normalized_producer,
        "source_artifact": normalized_artifact,
        "ledger_sha256": expected_digest,
        "ledger": normalized_ledger,
    }
    _enforce_publisher_envelope_size(normalized)
    return normalized


def _publish_url_from_environment(environ: Mapping[str, str]) -> tuple[str, str]:
    """Read only the two dedicated publisher variables, never ambient credentials."""

    url = environ.get(PUBLISH_URL_ENV)
    token = environ.get(PUBLISH_TOKEN_ENV)
    if not isinstance(url, str) or not url or not isinstance(token, str) or not token:
        raise M0ResearchPublisherEnvelopeError("m0_publish_environment_missing")
    parsed = urllib.parse.urlsplit(url)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise M0ResearchPublisherEnvelopeError("m0_publish_url_invalid")
    return url, token


def publish_m0_research_publisher_envelope(
    envelope: Mapping[str, Any], *, environ: Mapping[str, str] | None = None
) -> None:
    """POST one validated envelope through the dedicated, opt-in publication route."""

    validated = validate_m0_research_publisher_envelope(envelope)
    url, token = _publish_url_from_environment(os.environ if environ is None else environ)
    request = urllib.request.Request(
        url,
        data=canonical_envelope_body(validated),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:  # nosec B310 - URL is HTTPS validated above.
            status = response.getcode()
    except (urllib.error.HTTPError, urllib.error.URLError, OSError) as exc:
        raise M0ResearchPublisherEnvelopeError("m0_publish_failed") from exc
    if not isinstance(status, int) or status < 200 or status >= 300:
        raise M0ResearchPublisherEnvelopeError("m0_publish_failed")


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a local, no-order M0 research publisher envelope.")
    parser.add_argument("--source-snapshot", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-artifact-repository", required=True)
    parser.add_argument("--source-artifact-revision", required=True)
    parser.add_argument("--source-artifact-run-id", required=True)
    parser.add_argument("--source-artifact-id", required=True)
    parser.add_argument("--source-artifact-sha256", required=True)
    parser.add_argument("--producer-repository", required=True)
    parser.add_argument("--producer-revision", required=True)
    parser.add_argument(
        "--now",
        help="Canonical UTC timestamp (YYYY-MM-DDTHH:MM:SSZ); pass explicitly for reproducible output.",
    )
    parser.add_argument(
        "--publish",
        action="store_true",
        help=(
            "POST only after writing the local envelope; requires dedicated "
            f"{PUBLISH_URL_ENV} and {PUBLISH_TOKEN_ENV} environment variables."
        ),
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    now = canonical_timestamp(args.now) if args.now else _current_canonical_timestamp()
    snapshot, snapshot_sha256 = load_source_snapshot(args.source_snapshot)
    if snapshot_sha256 != _require_sha256(args.source_artifact_sha256, "source_artifact_sha256"):
        raise M0ResearchPublisherEnvelopeError("source_artifact_sha256_mismatch")
    artifact = build_source_artifact_metadata(
        repository=args.source_artifact_repository,
        revision=args.source_artifact_revision,
        run_id=args.source_artifact_run_id,
        artifact_id=args.source_artifact_id,
        sha256=snapshot_sha256,
    )
    envelope = build_m0_research_publisher_envelope(
        source_snapshot=snapshot,
        source_artifact=artifact,
        producer_repository=args.producer_repository,
        producer_revision=args.producer_revision,
        now=now,
    )
    if args.publish:
        # Validate the dedicated environment before writing so a typo cannot
        # leave a local file that an operator mistakes for an attempted POST.
        _publish_url_from_environment(os.environ)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(canonical_envelope_body(envelope) + b"\n")
    if args.publish:
        publish_m0_research_publisher_envelope(envelope)
    print(
        json.dumps(
            {
                "output": str(args.output),
                "ledger_sha256": envelope["ledger_sha256"],
                "published": bool(args.publish),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except M0ResearchPublisherEnvelopeError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2) from exc


__all__ = [
    "MAX_SOURCE_SNAPSHOT_BYTES",
    "MAX_PUBLISHER_ENVELOPE_BYTES",
    "M0ResearchPublisherEnvelopeError",
    "PUBLISHER_ENVELOPE_SCHEMA",
    "PUBLISH_TOKEN_ENV",
    "PUBLISH_URL_ENV",
    "build_m0_research_publisher_envelope",
    "build_source_artifact_metadata",
    "calculate_ledger_sha256",
    "canonical_envelope_body",
    "canonical_json",
    "canonical_timestamp",
    "load_source_snapshot",
    "main",
    "publish_m0_research_publisher_envelope",
    "validate_m0_research_publisher_envelope",
]
