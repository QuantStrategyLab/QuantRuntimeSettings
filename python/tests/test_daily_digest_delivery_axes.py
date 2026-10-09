from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def _load_module(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


axes = _load_module("daily_digest_delivery_axes")
aggregator = _load_module("daily_digest_aggregator")


class DeliveryAxesProjectionTests(unittest.TestCase):
    def test_execution_unknown_when_fills_unknown(self):
        status = axes.project_run_execution_status(
            {
                "fill_count": None,
                "fill_count_status": "unknown",
                "reason_code": "schwab_fills_not_connected",
                "status": "ok",
                "rebalance_kind": "",
            }
        )
        self.assertEqual(status, "execution_unknown")

    def test_execution_ok_no_order(self):
        status = axes.project_run_execution_status(
            {
                "fill_count": 0,
                "fill_count_status": "known",
                "rebalance_kind": "no_order",
                "status": "ok",
            }
        )
        self.assertEqual(status, "ok_no_order")

    def test_execution_ok_filled(self):
        status = axes.project_run_execution_status(
            {
                "fill_count": 2,
                "fill_count_status": "known",
                "rebalance_kind": "rebalance",
                "status": "ok",
            }
        )
        self.assertEqual(status, "ok_filled")

    def test_execution_alert(self):
        status = axes.project_run_execution_status(
            {"status": "alert", "fill_count": 0, "fill_count_status": "known"}
        )
        self.assertEqual(status, "execution_alert")

    def test_execution_explicit_passthrough(self):
        status = axes.project_run_execution_status(
            {
                "execution_status": "reconciliation_required",
                "fill_count": 0,
                "fill_count_status": "known",
                "status": "ok",
            }
        )
        self.assertEqual(status, "reconciliation_required")

    def test_persistence_from_archive_reason(self):
        status = axes.project_run_persistence_status(
            {
                "evidence_provenance": "candidates",
                "reason_code": "equity_from_archive_facts",
                "note": "injected_from_schwab_emit_archive_projection",
            }
        )
        self.assertEqual(status, "persisted")

    def test_persistence_github_stub_unknown(self):
        status = axes.project_run_persistence_status(
            {
                "evidence_provenance": "github_workflow_stub",
                "reason_code": "github_workflow_existence_only",
            }
        )
        self.assertEqual(status, "unknown")

    def test_notification_dry_run(self):
        self.assertEqual(
            axes.project_notification_delivery_status(
                {"dry_run": True, "delivered": False, "status": "dry_run"}
            ),
            "dry_run_not_sent",
        )

    def test_notification_sent_ok(self):
        self.assertEqual(
            axes.project_notification_delivery_status(
                {"dry_run": False, "delivered": True, "status": "delivered"}
            ),
            "sent_ok",
        )

    def test_notification_absent_not_applicable(self):
        self.assertEqual(
            axes.project_notification_delivery_status({"evidence_status": "has_runs"}),
            "not_applicable",
        )

    def test_evidence_delivery_has_runs(self):
        status = axes.project_evidence_delivery_status(
            {
                "evidence_status": "has_runs",
                "source_coverage": {
                    "candidates_configured": True,
                    "candidates_loaded": True,
                    "github_failures": [],
                },
                "runs": [{"platform_id": "schwab"}],
            }
        )
        self.assertEqual(status, "delivered_to_central")

    def test_evidence_delivery_verified_idle(self):
        status = axes.project_evidence_delivery_status(
            {
                "evidence_status": "verified_idle",
                "source_coverage": {
                    "candidates_configured": True,
                    "candidates_loaded": True,
                    "github_failures": [],
                },
                "runs": [],
            }
        )
        self.assertEqual(status, "delivered_idle")

    def test_attach_preserves_legacy_and_dual_writes(self):
        receipt = {
            "schema_version": "qsl.daily_digest_receipt.v1",
            "dry_run": True,
            "delivered": False,
            "status": "dry_run",
            "evidence_status": "has_runs",
            "source_coverage": {
                "candidates_configured": True,
                "candidates_loaded": True,
                "github_failures": [],
            },
            "runs": [
                {
                    "platform_id": "schwab",
                    "strategy_profile": "soxl_soxx_trend_income",
                    "fill_count": None,
                    "fill_count_status": "unknown",
                    "status": "ok",
                    "reason_code": "schwab_fills_not_connected+equity_from_archive_facts",
                    "evidence_provenance": "candidates",
                    "note": "archive_projection",
                    "rebalance_kind": "",
                },
                {
                    "platform_id": "ibkr",
                    "strategy_profile": "tqqq_growth_income",
                    "fill_count": 0,
                    "fill_count_status": "known",
                    "status": "ok",
                    "rebalance_kind": "no_order",
                    "rebalance_conclusion": "no_order",
                    "evidence_provenance": "candidates",
                    "reason_code": "",
                },
            ],
        }
        out = axes.attach_delivery_axes(receipt)
        self.assertIs(out, receipt)
        # Legacy fields untouched.
        self.assertTrue(receipt["dry_run"])
        self.assertFalse(receipt["delivered"])
        self.assertEqual(receipt["evidence_status"], "has_runs")
        self.assertEqual(receipt["status"], "dry_run")
        axes_block = receipt["delivery_axes"]
        self.assertEqual(axes_block["notification_delivery_status"], "dry_run_not_sent")
        self.assertEqual(axes_block["evidence_delivery_status"], "delivered_to_central")
        self.assertEqual(axes_block["execution_status"], "execution_unknown")
        self.assertEqual(axes_block["evidence_persistence_status"], "persisted")
        self.assertEqual(receipt["runs"][0]["execution_status"], "execution_unknown")
        self.assertEqual(receipt["runs"][1]["execution_status"], "ok_no_order")
        self.assertEqual(
            receipt["runs"][0]["evidence_delivery_status"], "delivered_to_central"
        )

    def test_old_receipt_without_axes_still_projects(self):
        """Readers can project from legacy-only receipts (no delivery_axes yet)."""
        legacy = {
            "schema_version": "qsl.daily_digest_receipt.v1",
            "dry_run": True,
            "delivered": False,
            "status": "dry_run",
            "evidence_status": "has_runs",
            "source_coverage": {
                "candidates_configured": True,
                "candidates_loaded": True,
                "github_failures": [],
            },
            "runs": [
                {
                    "platform_id": "ibkr",
                    "fill_count": 1,
                    "fill_count_status": "known",
                    "status": "ok",
                    "rebalance_kind": "rebalance",
                    "evidence_provenance": "candidates",
                }
            ],
        }
        # No delivery_axes key beforehand.
        self.assertNotIn("delivery_axes", legacy)
        axes.attach_delivery_axes(legacy)
        self.assertEqual(legacy["delivery_axes"]["execution_status"], "ok_filled")
        self.assertEqual(
            legacy["delivery_axes"]["notification_delivery_status"], "dry_run_not_sent"
        )


class BuildReceiptDualWriteTests(unittest.TestCase):
    def test_build_receipt_includes_delivery_axes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "candidates.json"
            path.write_text(
                json.dumps(
                    {
                        "schema_version": "qsl.digest_candidates.v1",
                        "runs": [
                            {
                                "platform_id": "schwab",
                                "strategy_profile": "soxl_soxx_trend_income",
                                "actually_ran": True,
                                "opaque_account_uid": "acct-a",
                                "target_id": "schwab-primary",
                                "account_scope": "live",
                                "fill_count": None,
                                "field_status": {"fill_count": "counts_unknown"},
                                "reason_code": "schwab_fills_not_connected+equity_from_archive_facts",
                                "evidence_provenance": "candidates",
                                "equity": 989.34,
                                "note": "archive_projection",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            payload, text, collected = aggregator.build_digest_payload(
                business_day="2026-10-09",
                locale="zh",
                candidates_path=path,
                include_github=False,
            )
            receipt = aggregator.build_receipt(
                payload, collected, message_chars=len(text)
            )
            self.assertIn("delivery_axes", receipt)
            self.assertEqual(
                receipt["delivery_axes"]["evidence_delivery_status"],
                "delivered_to_central",
            )
            # Aggregator-only receipt has no notify fields → not_applicable.
            self.assertEqual(
                receipt["delivery_axes"]["notification_delivery_status"],
                "not_applicable",
            )
            self.assertEqual(
                receipt["delivery_axes"]["execution_status"], "execution_unknown"
            )
            # Legacy fields kept.
            self.assertEqual(receipt["evidence_status"], "has_runs")
            self.assertEqual(receipt["schema_version"], "qsl.daily_digest_receipt.v1")
            self.assertNotIn("dry_run", receipt)
            self.assertEqual(receipt["runs"][0]["execution_status"], "execution_unknown")
            # Render unchanged contract: text still produced.
            self.assertIn("心跳", text)

    def test_explicit_producer_execution_status_passthrough(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "candidates.json"
            path.write_text(
                json.dumps(
                    {
                        "schema_version": "qsl.digest_candidates.v1",
                        "runs": [
                            {
                                "platform_id": "ibkr",
                                "strategy_profile": "tqqq_growth_income",
                                "actually_ran": True,
                                "account_hint": "U16608560",
                                "fill_count": 0,
                                "execution_status": "ok_no_order",
                                "evidence_persistence_status": "persisted",
                                "evidence_delivery_status": "pending_central",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            payload, text, collected = aggregator.build_digest_payload(
                business_day="2026-10-09",
                locale="zh",
                candidates_path=path,
                include_github=False,
            )
            receipt = aggregator.build_receipt(
                payload, collected, message_chars=len(text)
            )
            self.assertEqual(receipt["runs"][0]["execution_status"], "ok_no_order")
            self.assertEqual(
                receipt["runs"][0]["evidence_persistence_status"], "persisted"
            )
            # Once in central runs[], delivery projects to delivered_to_central
            # unless we only pass through when already terminal — pass-through
            # wins when explicit (priority 1).
            self.assertEqual(
                receipt["runs"][0]["evidence_delivery_status"], "pending_central"
            )


if __name__ == "__main__":
    unittest.main()
