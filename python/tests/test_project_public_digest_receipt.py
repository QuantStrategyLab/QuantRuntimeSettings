from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
from project_public_digest_receipt import project_public_receipt


class PublicDigestReceiptTests(unittest.TestCase):
    def test_allowlisted_field_values_cannot_copy_private_strings_or_containers(self):
        marker = "SYNTHETIC_PRIVATE_ACCOUNT_TARGET_MARKER"
        probes = [
            {"status": marker}, {"schema_version": marker},
            {"run_count": {"target_id": marker, "equity": 123456.78}},
            {"window": {"timezone": marker}},
            {"source_coverage": {"candidates_count": {"opaque_account_uid": marker}}},
            {"business_day": marker, "window": {"start_local": marker, "end_utc": marker}},
            {"layout": marker, "locale": marker, "evidence_status": marker, "total_fills_status": marker},
            {"dry_run": {"private": marker}, "delivered": marker},
            {"failures": [{"reason_code": {"private": marker}}],
             "delivery_axes": {"execution_status": {"private": marker}}},
            {"failures": {"private": marker}},
        ]
        for raw in probes:
            with self.subTest(raw=raw):
                public = project_public_receipt(raw, source_sha="a" * 40)
                self.assertNotIn(marker, json.dumps(public))
                self.assertNotIn("123456.78", json.dumps(public))

    def test_invalid_counter_values_stay_unknown_not_zero_and_valid_dates_remain(self):
        for value in [True, -1, 1.5, "2", {"target_id": "private"}, None]:
            with self.subTest(value=value):
                public = project_public_receipt({
                    "run_count": value, "message_chars": value, "total_fills": value, "total_fills_status": "known",
                    "source_coverage": {"candidates_count": value},
                })
                self.assertIsNone(public["run_count"])
                self.assertIsNone(public["total_fills"])
                self.assertIsNone(public["source_coverage"]["candidates_count"])
                self.assertEqual(public["total_fills_status"], "unknown")
        public = project_public_receipt({"business_day": "2026-10-12", "window": {
            "timezone": "Asia/Shanghai", "report_date": "2026-10-13", "start_local": "2026-10-12 06:00",
            "end_utc": "2026-10-12T22:00:00Z",
        }})
        self.assertEqual(public["business_day"], "2026-10-12")
        self.assertEqual(public["window"]["start_local"], "2026-10-12 06:00")
        self.assertEqual(public["window"]["end_utc"], "2026-10-12T22:00:00Z")

    def test_public_projection_keeps_unknown_failure_and_window_without_private_fields(self):
        private = "synthetic-private-target-account"
        raw = {
            "schema_version": "qsl.daily_digest_receipt.v1", "business_day": "2026-10-12",
            "layout": "v1", "run_count": 1, "total_fills": None, "total_fills_status": "unknown",
            "status": "dry_run", "dry_run": True, "delivered": False,
            "runs": [{"target_id": private, "opaque_account_uid": private, "equity": 123456.78}],
            "stale_candidates": [{"strategy_label": private}], "warnings": [private],
            "window": {"end_utc": "2026-10-12T22:00:00Z", "private_extra": private},
            "source_coverage": {"has_source_failures": True, "is_complete_for_verified_idle": False,
                                "candidate_failures": [{"message": private}], "private_extra": private},
            "failures": [{"source_kind": "candidate_store", "reason_code": "candidate_store_copy_failed", "message": private},
                         {"reason_code": private, "workflow": private}],
            "delivery_axes": {"evidence_delivery_status": "intake_degraded", "private_extra": private},
        }
        summary = project_public_receipt(raw, source_sha="a" * 40)
        self.assertNotIn(private, json.dumps(summary))
        self.assertNotIn("123456.78", json.dumps(summary))
        self.assertNotIn("runs", summary)
        self.assertEqual(summary["total_fills_status"], "unknown")
        self.assertIsNone(summary["total_fills"])
        self.assertTrue(summary["source_coverage"]["has_source_failures"])
        self.assertEqual(summary["failures"][0]["reason_code"], "candidate_store_copy_failed")
        self.assertEqual(summary["failures"][1]["reason_code"], "unrecognized_source_failure")
        self.assertEqual(summary["window"]["end_utc"], raw["window"]["end_utc"])
        self.assertEqual(summary["source_sha"], "a" * 40)
        self.assertEqual(raw["runs"][0]["target_id"], private)

    def test_complete_zero_stays_known_and_invalid_source_hash_is_rejected(self):
        summary = project_public_receipt({"total_fills": 0, "total_fills_status": "known", "failures": []})
        self.assertEqual(summary["total_fills"], 0)
        self.assertEqual(summary["total_fills_status"], "known")
        with self.assertRaisesRegex(ValueError, "source_sha_invalid"):
            project_public_receipt({}, source_sha="private-path")


if __name__ == "__main__":
    unittest.main()
