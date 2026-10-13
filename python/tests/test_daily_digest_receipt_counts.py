from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import daily_digest_aggregator as aggregator
import daily_digest_notify as digest


class ReceiptCountEvidenceTests(unittest.TestCase):
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
