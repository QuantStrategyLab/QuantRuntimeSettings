from __future__ import annotations

import sys
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import daily_digest_aggregator as aggregator
import daily_digest_notify as digest
import send_daily_digest_telegram as sender


class ReceiptCountEvidenceTests(unittest.TestCase):
    def test_sender_delivery_summary_preserves_unknown_global_total(self):
        for count in [0, 2]:
            with self.subTest(count=count), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "candidates.json"
                path.write_text(json.dumps({"runs": [{
                    "platform_id": "schwab", "strategy_profile": "soxl_soxx_trend_income",
                    "business_day": "2026-10-12", "actually_ran": True, "fill_count": count,
                }, {
                    "platform_id": "ibkr", "strategy_profile": "global_etf_rotation",
                    "business_day": "2026-10-09", "actually_ran": True, "fill_count": 0,
                }]}))
                preview = StringIO()
                with mock.patch.dict("os.environ", {
                    "TELEGRAM_TOKEN": "synthetic-token", "GLOBAL_TELEGRAM_CHAT_ID": "synthetic-chat",
                }, clear=True), mock.patch.object(sender, "send_telegram_message", return_value=True) as send:
                    with redirect_stdout(preview):
                        code = sender.main(["--no-github", "--business-day", "2026-10-12", "--candidates", str(path)])
                self.assertEqual(code, 0)
                send.assert_called_once()
                self.assertIn("fills=unknown", preview.getvalue())

    def test_stale_candidate_makes_global_zero_or_positive_unknown_but_keeps_run_facts(self):
        for count in [0, 2, None]:
            with self.subTest(count=count), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "candidates.json"
                path.write_text(json.dumps({"runs": [{
                    "platform_id": "schwab", "strategy_profile": "soxl_soxx_trend_income",
                    "business_day": "2026-10-12", "actually_ran": True, "fill_count": count,
                }, {
                    "platform_id": "ibkr", "strategy_profile": "global_etf_rotation",
                    "business_day": "2026-10-09", "actually_ran": True, "fill_count": 0,
                }]}))
                with mock.patch.dict("os.environ", {}, clear=True):
                    payload, text, collected = aggregator.build_digest_payload(
                        business_day="2026-10-12", candidates_path=path, include_github=False, layout="v1",
                    )
                receipt = aggregator.build_receipt(payload, collected, message_chars=len(text))
                self.assertIsNone(receipt["total_fills"])
                self.assertEqual(receipt["runs"][0]["fill_count"], count)
                self.assertNotIn("已验证零成交", text)
                self.assertIn("成交数未知", text)
                if count == 2:
                    self.assertIn("成交 2", text)

    def test_sender_preserves_unknown_global_total_and_local_private_preview(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            candidates = root / "candidates.json"
            receipt = root / "receipt.json"
            candidates.write_text(json.dumps({"runs": [{
                "platform_id": "schwab", "strategy_profile": "soxl_soxx_trend_income",
                "business_day": "2026-10-12", "actually_ran": True, "fill_count": 0,
                "opaque_account_uid": "synthetic-private-account", "target_id": "schwab/synthetic-private-target",
                "equity": 123.45,
            }, {
                "platform_id": "ibkr", "strategy_profile": "global_etf_rotation",
                "business_day": "2026-10-09", "actually_ran": True, "fill_count": 0,
            }]}))
            preview = StringIO()
            with mock.patch.dict("os.environ", {}, clear=True), redirect_stdout(preview):
                code = sender.main(["--dry-run", "--no-github", "--business-day", "2026-10-12",
                                    "--candidates", str(candidates), "--write-receipt", str(receipt)])
            result = json.loads(receipt.read_text())
        self.assertEqual(code, 0)
        self.assertIsNone(result["total_fills"])
        self.assertEqual(result["total_fills_status"], "unknown")
        self.assertEqual(result["runs"][0]["fill_count"], 0)
        # Local preview and the private receipt retain their existing purpose.
        self.assertIn("123.45", preview.getvalue())
        self.assertIn("synthetic-private-target", json.dumps(result))

    def receipt(self, coverage, runs=()):
        payload = digest.DailyDigestInput(
            business_day="2026-10-12",
            runs=runs,
            evidence_coverage=coverage,
        )
        collected = aggregator.CollectResult(runs=list(runs), coverage=coverage)
        return aggregator.build_receipt(payload, collected, message_chars=0)

    def assert_unknown_total(self, receipt):
        self.assertIsNone(receipt["total_fills"])
        self.assertEqual(receipt["total_fills_status"], "unknown")

    def test_absent_evidence_cannot_prove_zero_fills(self):
        receipt = self.receipt(digest.EvidenceCoverage())
        self.assertEqual(receipt["evidence_status"], "evidence_unknown")
        self.assert_unknown_total(receipt)

    def test_all_stale_candidates_cannot_prove_zero_fills(self):
        coverage = digest.EvidenceCoverage(
            candidates_configured=True,
            candidates_loaded=True,
            stale_candidates=({"reason_code": "candidate_business_day_stale"},),
        )
        receipt = self.receipt(coverage)
        self.assertEqual(receipt["evidence_status"], "evidence_unknown")
        self.assert_unknown_total(receipt)

    def test_failed_source_cannot_prove_zero_fills(self):
        receipt = self.receipt(digest.EvidenceCoverage(
            github_enabled=True,
            github_sources_queried=1,
            github_failures=({"reason_code": "github_api_error"},),
        ))
        self.assert_unknown_total(receipt)

    def test_partial_coverage_preserves_known_run_but_not_global_total(self):
        run = digest.DigestRunEntry(
            platform_id="schwab",
            strategy_profile="soxl_soxx_trend_income",
            fill_count=2,
            order_count=2,
        )
        for gap in [
            {"stale_candidates": ({"reason_code": "candidate_business_day_stale"},)},
            {"github_failures": ({"reason_code": "github_api_error"},)},
        ]:
            with self.subTest(gap=gap):
                receipt = self.receipt(digest.EvidenceCoverage(
                    candidates_configured=True,
                    candidates_loaded=True,
                    candidates_count=1,
                    **gap,
                ), (run,))
                self.assert_unknown_total(receipt)
                self.assertEqual(receipt["runs"][0]["fill_count"], 2)
                self.assertEqual(receipt["runs"][0]["fill_count_status"], "known")

    def test_verified_idle_retains_known_zero(self):
        receipt = self.receipt(digest.EvidenceCoverage(
            candidates_configured=True,
            candidates_loaded=True,
        ))
        self.assertEqual(receipt["evidence_status"], "verified_idle")
        self.assertEqual(receipt["total_fills"], 0)
        self.assertEqual(receipt["total_fills_status"], "known")

    def test_complete_known_run_retains_known_total(self):
        run = digest.DigestRunEntry(
            platform_id="schwab",
            strategy_profile="soxl_soxx_trend_income",
            fill_count=2,
            order_count=2,
        )
        receipt = self.receipt(digest.EvidenceCoverage(
            candidates_configured=True,
            candidates_loaded=True,
            candidates_count=1,
        ), (run,))
        self.assertEqual(receipt["total_fills"], 2)
        self.assertEqual(receipt["total_fills_status"], "known")


if __name__ == "__main__":
    unittest.main()
