#!/usr/bin/env python3
"""Verify controller-declared runtime snapshots with a read-only GCS identity.

The control plane owns the list of required artifacts.  This tool only reads
the paired snapshot and manifest, verifies the declared digest/profile/date,
and emits a receipt.  It must never publish artifacts, change runtime
settings, or invoke an execution path.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any


BytesFetcher = Callable[[str], bytes]


def _read_gcs(uri: str) -> bytes:
    """Read a single GCS object through the ambient read-only identity."""
    completed = subprocess.run(
        ["gcloud", "storage", "cat", uri],
        check=False,
        capture_output=True,
    )
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(detail or f"gcloud storage cat exited {completed.returncode}")
    return completed.stdout


def _parse_snapshot_date(value: object) -> dt.date:
    if not isinstance(value, str):
        raise ValueError("manifest.snapshot_as_of must be an ISO date string")
    try:
        return dt.date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("manifest.snapshot_as_of must be an ISO date string") from exc


def verify_entry(
    entry: dict[str, Any],
    *,
    fetch_bytes: BytesFetcher,
    today: dt.date,
) -> dict[str, Any]:
    """Verify one registry entry without changing remote state."""
    profile = str(entry.get("profile") or "")
    result: dict[str, Any] = {
        "profile": profile,
        "snapshot_path": entry.get("snapshot_path"),
        "manifest_path": entry.get("manifest_path"),
        "max_age_days": entry.get("max_age_days"),
        "status": "failed",
        "errors": [],
    }
    errors: list[str] = result["errors"]
    snapshot_path = entry.get("snapshot_path")
    manifest_path = entry.get("manifest_path")
    max_age_days = entry.get("max_age_days")
    if not profile:
        errors.append("registry profile is missing")
    if not isinstance(snapshot_path, str) or not snapshot_path.startswith("gs://"):
        errors.append("registry snapshot_path must be a gs:// URI")
    if not isinstance(manifest_path, str) or not manifest_path.startswith("gs://"):
        errors.append("registry manifest_path must be a gs:// URI")
    if isinstance(max_age_days, bool) or not isinstance(max_age_days, int) or max_age_days < 1:
        errors.append("registry max_age_days must be an integer of at least 1")
    if errors:
        return result

    try:
        snapshot_bytes = fetch_bytes(snapshot_path)
    except Exception as exc:  # noqa: BLE001 - receipt must retain remote read failure.
        errors.append(f"snapshot_read_failed: {exc}")
        return result
    try:
        manifest_bytes = fetch_bytes(manifest_path)
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - receipt must retain remote parse failure.
        errors.append(f"manifest_read_failed: {exc}")
        return result
    if not isinstance(manifest, dict):
        errors.append("manifest must be a JSON object")
        return result

    manifest_profile = manifest.get("strategy_profile")
    if manifest_profile != profile:
        errors.append(
            f"manifest.strategy_profile mismatch: expected {profile!r}, got {manifest_profile!r}"
        )
    expected_sha = manifest.get("snapshot_sha256")
    actual_sha = hashlib.sha256(snapshot_bytes).hexdigest()
    if not isinstance(expected_sha, str) or expected_sha != actual_sha:
        errors.append("manifest.snapshot_sha256 does not match snapshot bytes")
    try:
        snapshot_as_of = _parse_snapshot_date(manifest.get("snapshot_as_of"))
        age_days = (today - snapshot_as_of).days
        result["snapshot_as_of"] = snapshot_as_of.isoformat()
        result["age_days"] = age_days
        if age_days < 0:
            errors.append("manifest.snapshot_as_of is in the future")
        elif age_days > max_age_days:
            errors.append(
                f"snapshot is stale: age {age_days} days exceeds max_age_days {max_age_days}"
            )
    except ValueError as exc:
        errors.append(str(exc))
    if not errors:
        result["status"] = "verified"
    return result


def verify_registry(
    registry: dict[str, Any],
    *,
    fetch_bytes: BytesFetcher,
    today: dt.date,
) -> dict[str, Any]:
    entries = registry.get("entries")
    if not isinstance(entries, list):
        raise ValueError("registry.entries must be a list")
    results = [
        verify_entry(entry, fetch_bytes=fetch_bytes, today=today)
        if isinstance(entry, dict)
        else {
            "profile": "",
            "status": "failed",
            "errors": ["registry entry must be an object"],
        }
        for entry in entries
    ]
    failures = [item for item in results if item["status"] != "verified"]
    return {
        "schema_version": "runtime_artifact_evidence_receipt.v1",
        "checked_at": today.isoformat(),
        "status": "verified" if not failures else "failed",
        "summary": {
            "required_artifact_count": len(results),
            "verified_artifact_count": len(results) - len(failures),
            "failed_artifact_count": len(failures),
        },
        "entries": results,
        "boundary": (
            "Read-only evidence receipt. It does not publish data, change a runtime "
            "target, or authorize paper, shadow, or live execution."
        ),
    }


def _load_registry(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("registry must be a JSON object")
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Read-only verification of required runtime snapshot artifacts."
    )
    parser.add_argument("--registry", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--as-of",
        type=dt.date.fromisoformat,
        help="Override the verification date (ISO date; intended for deterministic tests).",
    )
    args = parser.parse_args(argv)
    receipt = verify_registry(
        _load_registry(args.registry),
        fetch_bytes=_read_gcs,
        today=args.as_of or dt.datetime.now(tz=dt.UTC).date(),
    )
    payload = json.dumps(receipt, ensure_ascii=False, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    print(payload)
    return 0 if receipt["status"] == "verified" else 1


if __name__ == "__main__":
    raise SystemExit(main())
