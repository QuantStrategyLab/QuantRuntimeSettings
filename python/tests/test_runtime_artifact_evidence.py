from __future__ import annotations

import datetime as dt
import hashlib
import importlib.util
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "python" / "scripts" / "verify_runtime_artifact_evidence.py"
SPEC = importlib.util.spec_from_file_location("verify_runtime_artifact_evidence", MODULE_PATH)
artifact_evidence = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = artifact_evidence
SPEC.loader.exec_module(artifact_evidence)


def _registry(*, max_age_days: int = 5) -> tuple[dict, dict[str, bytes]]:
    snapshot = b"symbol,score\nQQQ,1\n"
    manifest = {
        "strategy_profile": "example_profile",
        "snapshot_sha256": hashlib.sha256(snapshot).hexdigest(),
        "snapshot_as_of": "2026-08-27",
    }
    objects = {
        "gs://bucket/example.csv": snapshot,
        "gs://bucket/example.csv.manifest.json": json.dumps(manifest).encode("utf-8"),
    }
    return (
        {
            "schema_version": "runtime_artifact_evidence_registry.v1",
            "entries": [
                {
                    "profile": "example_profile",
                    "snapshot_path": "gs://bucket/example.csv",
                    "manifest_path": "gs://bucket/example.csv.manifest.json",
                    "max_age_days": max_age_days,
                }
            ],
        },
        objects,
    )


def test_verify_registry_accepts_fresh_matching_manifest():
    registry, objects = _registry()

    receipt = artifact_evidence.verify_registry(
        registry,
        fetch_bytes=objects.__getitem__,
        today=dt.date(2026, 8, 28),
    )

    assert receipt["status"] == "verified"
    assert receipt["summary"] == {
        "required_artifact_count": 1,
        "verified_artifact_count": 1,
        "failed_artifact_count": 0,
    }
    assert receipt["entries"][0]["age_days"] == 1


def test_verify_registry_fails_closed_on_digest_mismatch():
    registry, objects = _registry()
    manifest = json.loads(objects["gs://bucket/example.csv.manifest.json"])
    manifest["snapshot_sha256"] = "0" * 64
    objects["gs://bucket/example.csv.manifest.json"] = json.dumps(manifest).encode("utf-8")

    receipt = artifact_evidence.verify_registry(
        registry,
        fetch_bytes=objects.__getitem__,
        today=dt.date(2026, 8, 28),
    )

    assert receipt["status"] == "failed"
    assert receipt["entries"][0]["errors"] == [
        "manifest.snapshot_sha256 does not match snapshot bytes"
    ]


def test_verify_registry_fails_closed_on_stale_or_unreadable_snapshot():
    registry, objects = _registry(max_age_days=1)

    stale = artifact_evidence.verify_registry(
        registry,
        fetch_bytes=objects.__getitem__,
        today=dt.date(2026, 8, 29),
    )
    assert stale["status"] == "failed"
    assert "snapshot is stale" in stale["entries"][0]["errors"][0]

    def unavailable(_: str) -> bytes:
        raise RuntimeError("forbidden")

    unavailable_receipt = artifact_evidence.verify_registry(
        registry,
        fetch_bytes=unavailable,
        today=dt.date(2026, 8, 28),
    )
    assert unavailable_receipt["status"] == "failed"
    assert unavailable_receipt["entries"][0]["errors"] == ["snapshot_read_failed: forbidden"]
