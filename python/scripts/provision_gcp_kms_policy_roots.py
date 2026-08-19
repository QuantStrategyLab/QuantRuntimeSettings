#!/usr/bin/env python3
"""Provision public-only QSL P0 Cloud KMS policy roots, explicitly and idempotently.

The default command is a plan.  ``--apply`` is required before it enables an
API, creates a key ring, or creates a key.  This program never signs a policy,
creates a workload identity, grants IAM, reads broker credentials, or connects
to a broker.  It writes only public KMS PEM keys and their self-hashed QSL root
records.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Mapping, Sequence

from gcp_kms_policy_gate import calculate_trusted_policy_root_sha256, validate_gcp_kms_policy_root

LOCATION = "global"
KEY_RING = "qsl-p0-policy-root"
KEY = "autonomy-policy-root-v1"
ALGORITHM = "ec-sign-p256-sha256"
API_ALGORITHM = "EC_SIGN_P256_SHA256"
ROOT_SCHEMA = "qsl.gcp_kms_policy_root.v1"
ROOT_VALIDITY = timedelta(days=365)
_KMS_API_PROPAGATION_RETRIES = 8
_KMS_API_PROPAGATION_DELAY_SECONDS = 5


class BootstrapError(RuntimeError):
    """Raised when a root cannot be provisioned or exactly verified."""


def _utc_timestamp(value: datetime) -> str:
    return value.astimezone(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def _gcloud(arguments: Sequence[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            ["gcloud", *arguments],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
    except OSError as exc:
        raise BootstrapError("gcloud is required to provision a Cloud KMS policy root") from exc
    if check and result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown gcloud failure"
        raise BootstrapError(detail)
    return result


def _project_has_billing(project: str) -> bool:
    result = _gcloud(["billing", "projects", "describe", project, "--format=json"])
    try:
        billing = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise BootstrapError(f"{project}: billing preflight returned invalid JSON") from exc
    return billing.get("billingEnabled") is True


def _resource_exists(arguments: Sequence[str]) -> bool:
    return _gcloud(arguments, check=False).returncode == 0


def _create_or_accept_existing(arguments: Sequence[str]) -> None:
    """Create once; a delayed first response may report an existing resource on retry."""
    try:
        _gcloud(arguments)
    except BootstrapError as exc:
        if "already_exists" not in str(exc).lower():
            raise


def _is_kms_api_propagation_error(error: BootstrapError) -> bool:
    detail = str(error).lower()
    return "cloud kms api has not been used" in detail or "cloudkms.googleapis.com" in detail and "disabled" in detail


def _require_billed_projects(projects: Sequence[str]) -> None:
    unbilled = [project for project in projects if not _project_has_billing(project)]
    if unbilled:
        raise BootstrapError(
            "Cloud KMS requires billing; no resources were changed. "
            f"Enable billing for: {', '.join(unbilled)}"
        )


def _create_or_verify_kms_key(project: str) -> None:
    _gcloud(["services", "enable", "cloudkms.googleapis.com", f"--project={project}", "--quiet"])
    for attempt in range(_KMS_API_PROPAGATION_RETRIES):
        try:
            _create_or_verify_kms_key_after_api_ready(project)
            return
        except BootstrapError as exc:
            if not _is_kms_api_propagation_error(exc) or attempt == _KMS_API_PROPAGATION_RETRIES - 1:
                raise
            time.sleep(_KMS_API_PROPAGATION_DELAY_SECONDS)


def _create_or_verify_kms_key_after_api_ready(project: str) -> None:
    keyring_arguments = ["kms", "keyrings", "describe", KEY_RING, f"--location={LOCATION}", f"--project={project}"]
    if not _resource_exists(keyring_arguments):
        _create_or_accept_existing(["kms", "keyrings", "create", KEY_RING, f"--location={LOCATION}", f"--project={project}", "--quiet"])
    key_arguments = [
        "kms",
        "keys",
        "describe",
        KEY,
        f"--keyring={KEY_RING}",
        f"--location={LOCATION}",
        f"--project={project}",
        "--format=json",
    ]
    if not _resource_exists(key_arguments):
        _create_or_accept_existing(
            [
                "kms",
                "keys",
                "create",
                KEY,
                f"--keyring={KEY_RING}",
                f"--location={LOCATION}",
                f"--project={project}",
                "--purpose=asymmetric-signing",
                f"--default-algorithm={ALGORITHM}",
                "--protection-level=software",
                "--quiet",
            ]
        )
    details = _gcloud(key_arguments)
    try:
        key_details = json.loads(details.stdout)
    except json.JSONDecodeError as exc:
        raise BootstrapError(f"{project}: KMS key describe returned invalid JSON") from exc
    if key_details.get("purpose") != "ASYMMETRIC_SIGN":
        raise BootstrapError(f"{project}: existing {KEY} does not have ASYMMETRIC_SIGN purpose")
    version_template = key_details.get("versionTemplate")
    if not isinstance(version_template, Mapping) or version_template.get("algorithm") != API_ALGORITHM:
        raise BootstrapError(f"{project}: existing {KEY} does not use {API_ALGORITHM}")
    version_details = _gcloud(
        [
            "kms",
            "keys",
            "versions",
            "describe",
            "1",
            f"--key={KEY}",
            f"--keyring={KEY_RING}",
            f"--location={LOCATION}",
            f"--project={project}",
            "--format=json",
        ]
    )
    try:
        version = json.loads(version_details.stdout)
    except json.JSONDecodeError as exc:
        raise BootstrapError(f"{project}: KMS key version describe returned invalid JSON") from exc
    if version.get("algorithm") != API_ALGORITHM or version.get("state") != "ENABLED":
        raise BootstrapError(f"{project}: key version 1 is not an enabled {API_ALGORITHM} version")
    if version.get("protectionLevel") != "SOFTWARE":
        raise BootstrapError(f"{project}: key version 1 is not software-protected as required for P0")


def _public_key(project: str) -> tuple[str, str]:
    version = "1"
    with tempfile.TemporaryDirectory(prefix="qsl-kms-public-key-") as directory:
        output = Path(directory) / "public.pem"
        _gcloud(
            [
                "kms",
                "keys",
                "versions",
                "get-public-key",
                version,
                f"--key={KEY}",
                f"--keyring={KEY_RING}",
                f"--location={LOCATION}",
                f"--project={project}",
                f"--output-file={output}",
            ]
        )
        try:
            public_key = output.read_text(encoding="utf-8")
        except OSError as exc:
            raise BootstrapError(f"{project}: Cloud KMS did not write its public PEM key") from exc
    if not public_key.endswith("\n"):
        public_key += "\n"
    if not public_key.startswith("-----BEGIN PUBLIC KEY-----\n"):
        raise BootstrapError(f"{project}: version 1 did not return a PEM public key")
    identity = f"projects/{project}/locations/{LOCATION}/keyRings/{KEY_RING}/cryptoKeys/{KEY}/cryptoKeyVersions/{version}"
    return identity, public_key


def build_root_record(*, project: str, public_key_pem: str, as_of: datetime) -> dict[str, str]:
    """Build the public root record and self-hash it without any cloud call."""
    issued_at = as_of.astimezone(UTC).replace(microsecond=0)
    root = {
        "schema": ROOT_SCHEMA,
        "root_id": f"qsl-{project}-p0-root-v1",
        "created_at": _utc_timestamp(issued_at),
        "effective_at": _utc_timestamp(issued_at),
        "expires_at": _utc_timestamp(issued_at + ROOT_VALIDITY),
        "digest_algorithm": "sha256",
        "kms_key_version": f"projects/{project}/locations/{LOCATION}/keyRings/{KEY_RING}/cryptoKeys/{KEY}/cryptoKeyVersions/1",
        "signature_algorithm": API_ALGORITHM,
        "public_key_pem": public_key_pem,
        "public_key_sha256": hashlib.sha256(public_key_pem.encode("utf-8")).hexdigest(),
    }
    root["trusted_policy_root_sha256"] = calculate_trusted_policy_root_sha256(root)
    validate_gcp_kms_policy_root(root, expected_root_sha256=root["trusted_policy_root_sha256"], as_of=_utc_timestamp(issued_at))
    return root


def write_or_validate_root_record(*, destination: Path, root: Mapping[str, Any], as_of: datetime) -> str:
    """Write a new public record once, or reject a conflicting pre-existing record."""
    if destination.exists():
        try:
            existing = json.loads(destination.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise BootstrapError(f"cannot parse existing root record {destination}") from exc
        if not isinstance(existing, Mapping):
            raise BootstrapError(f"existing root record {destination} is not an object")
        validate_gcp_kms_policy_root(
            existing,
            expected_root_sha256=existing.get("trusted_policy_root_sha256"),
            as_of=_utc_timestamp(as_of),
        )
        for field in ("kms_key_version", "public_key_pem", "public_key_sha256"):
            if existing.get(field) != root.get(field):
                raise BootstrapError(f"existing root record {destination} conflicts on {field}")
        return str(existing["trusted_policy_root_sha256"])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(root, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return str(root["trusted_policy_root_sha256"])


def _plan(projects: Sequence[str], destination: Path) -> list[dict[str, str]]:
    return [
        {
            "kms_key": f"projects/{project}/locations/{LOCATION}/keyRings/{KEY_RING}/cryptoKeys/{KEY}",
            "project": project,
            "root_record": str(destination / f"{project}.json"),
        }
        for project in projects
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Provision public-only QSL P0 Cloud KMS policy roots")
    parser.add_argument("--project", action="append", required=True, help="one billed GCP project; repeat for each root")
    parser.add_argument(
        "--root-record-dir",
        type=Path,
        default=Path("docs/p0_control_roots/gcp"),
        help="repository-relative directory for public root JSON records",
    )
    parser.add_argument("--apply", action="store_true", help="enable KMS and create missing key rings/keys")
    args = parser.parse_args(argv)
    projects = tuple(dict.fromkeys(args.project))
    if any(not project or project.startswith("-") for project in projects):
        parser.error("project IDs must be explicit non-empty values")
    plan = _plan(projects, args.root_record_dir)
    if not args.apply:
        print(json.dumps({"apply_required": True, "operations": plan}, indent=2, sort_keys=True))
        return 0
    try:
        _require_billed_projects(projects)
        now = datetime.now(UTC).replace(microsecond=0)
        results: list[dict[str, str]] = []
        for project in projects:
            _create_or_verify_kms_key(project)
            identity, public_key_pem = _public_key(project)
            root = build_root_record(project=project, public_key_pem=public_key_pem, as_of=now)
            if root["kms_key_version"] != identity:
                raise BootstrapError(f"{project}: KMS key-version identity changed while provisioning")
            root_sha256 = write_or_validate_root_record(
                destination=args.root_record_dir / f"{project}.json", root=root, as_of=now
            )
            results.append({"kms_key_version": identity, "project": project, "trusted_policy_root_sha256": root_sha256})
    except BootstrapError as exc:
        print(f"P0 KMS root provisioning failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"provisioned": results}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
