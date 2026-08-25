from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def _load_module(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


projection = _load_module("execution_evidence_projection")


class ExecutionEvidenceProjectionTest(unittest.TestCase):
    def _report(self, *, finished_at: str = "2026-08-25T16:00:00Z") -> dict[str, object]:
        return {
            "schema_version": "runtime_report.v1",
            "platform": "longbridge",
            "deploy_target": "sg",
            "service_name": "longbridge-quant-sg-service",
            "strategy_profile": "soxl_soxx_trend_income",
            "strategy_domain": "us_equity",
            "runtime_target": {"execution_mode": "paper", "dry_run_only": True},
            "runtime_release_receipt": {
                "attestation_state": "self_attested",
                "strategy_release": {"strategy_revision": "a" * 40},
            },
            "dry_run": True,
            "started_at": "2026-08-25T15:58:00Z",
            "finished_at": finished_at,
            "summary": {"account_ids": ["must-not-be-projected"]},
            "diagnostics": {"api_token": "must-not-be-projected"},
            "artifacts": {"runtime_report_cloud_uri": "gs://must-not-be-projected"},
        }

    def test_projects_only_attested_identity_and_keeps_execution_pending(self):
        snapshot = projection.build_execution_evidence_source_snapshot(
            [self._report()],
            source_id="runtime-reports",
            now=datetime(2026, 8, 25, 16, 5, tzinfo=UTC),
        )
        self.assertEqual(snapshot["schema_version"], "qsl_execution_evidence_source_snapshot.v1")
        self.assertEqual(snapshot["data_status"], "ready")
        self.assertEqual(snapshot["generated_at"], "2026-08-25T16:05:00Z")
        self.assertEqual(len(snapshot["deployments"]), 1)
        deployment = snapshot["deployments"][0]
        self.assertEqual(deployment["target"], {"platform": "longbridge", "environment": "paper"})
        self.assertEqual(deployment["evidence"], {
            "strategy": "verified",
            "target_data": "pending",
            "target_execution": "pending",
        })
        self.assertEqual(deployment["recommendation"], {
            "code": "parked",
            "reason_code": "target_execution_evidence_missing",
        })
        serialized = json.dumps(snapshot, sort_keys=True)
        for forbidden in ("must-not-be-projected", "account_ids", "api_token", "gs://"):
            self.assertNotIn(forbidden, serialized)

    def test_rejects_unattested_or_lane_mismatched_reports_without_claiming_execution(self):
        unattested = self._report()
        unattested["runtime_release_receipt"] = {"attestation_state": "legacy_unattested"}
        mismatched = self._report()
        mismatched["dry_run"] = False
        snapshot = projection.build_execution_evidence_source_snapshot(
            [unattested, mismatched],
            source_id="runtime-reports",
            now=datetime(2026, 8, 25, 16, 5, tzinfo=UTC),
        )
        self.assertEqual(snapshot["data_status"], "unavailable")
        self.assertEqual(snapshot["deployments"], [])
        self.assertEqual(snapshot["errors"], [
            "runtime_report_lane_mismatch",
            "runtime_report_no_eligible_records",
            "runtime_report_release_unattested",
        ])

    def test_keeps_only_the_latest_report_per_deployment(self):
        older = self._report(finished_at="2026-08-25T15:00:00Z")
        latest = self._report(finished_at="2026-08-25T16:00:00Z")
        latest["runtime_release_receipt"] = {
            "attestation_state": "self_attested",
            "strategy_release": {"strategy_revision": "b" * 40},
        }
        snapshot = projection.build_execution_evidence_source_snapshot(
            [older, latest],
            source_id="runtime-reports",
            now=datetime(2026, 8, 25, 16, 5, tzinfo=UTC),
        )
        self.assertEqual(len(snapshot["deployments"]), 1)
        self.assertEqual(snapshot["deployments"][0]["strategy"]["strategy_revision"], "b" * 40)

    def test_cli_rejects_duplicate_json_keys_and_writes_a_fail_closed_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            invalid = root / "invalid.json"
            output = root / "snapshot.json"
            invalid.write_text('{"schema_version":"runtime_report.v1","schema_version":"other"}', encoding="utf-8")
            self.assertEqual(
                projection.main([
                    "--source-id", "runtime-reports",
                    "--runtime-report", str(invalid),
                    "--output", str(output),
                ]),
                0,
            )
            snapshot = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(snapshot["data_status"], "unavailable")
            self.assertIn("runtime_report_input_invalid", snapshot["errors"])


if __name__ == "__main__":
    unittest.main()
