"""Synthetic account evidence; rendering never infers zero from a signal label."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import daily_digest_aggregator as aggregator

DAY = "2026-10-14"


def five_accounts():
    return [
        {
            "platform_id": "ibkr" if i < 4 else "schwab",
            "strategy_profile": "demo_strategy",
            "opaque_account_uid": f"synthetic-account-{i}",
            "account_hint": f"demo-{i}",
            "target_id": f"demo/target-{i}",
            "business_day": DAY,
            "actually_ran": True,
            "fill_count": 0,
            "order_count": 0,
            "cycle_count": 1,
            "field_status": {"fill_count": "known", "order_count": "known"},
            "signal_summary": "no_action",
        }
        for i in range(5)
    ]


def render(rows, *, layout="v1", contents=None, failed=False, locale="zh"):
    with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {}, clear=True):
        path = Path(tmp) / "synthetic.json"
        path.write_text(contents if contents is not None else json.dumps({"runs": rows}))
        if failed:
            os.environ["DIGEST_CANDIDATES_STORE_STATUS"] = "failed"
            os.environ["DIGEST_CANDIDATES_STORE_REASON"] = "candidate_store_copy_failed"
        return aggregator.build_digest_payload(
            business_day=DAY, candidates_path=path, include_github=False,
            locale=locale, layout=layout,
        )


class DailyDigestFillEvidenceTests(unittest.TestCase):
    def test_five_verified_no_order_accounts_show_explicit_zero(self):
        for layout in ("v1", "sections_v2"):
            with self.subTest(layout=layout):
                payload, text, collected = render(five_accounts(), layout=layout)
                self.assertEqual(text.count("成交 0 笔 / 无订单"), 5)
                self.assertNotIn("证据未覆盖", text)
                self.assertEqual(aggregator.build_receipt(payload, collected, message_chars=len(text))["total_fills"], 0)

    def test_positive_counts_are_visible_in_rich_account_blocks(self):
        rows = five_accounts()[:1]
        rows[0].update(fill_count=3, order_count=2)
        for locale, expected in (("zh", "成交 3 笔 / 订单 2 笔"), ("en", "fills 3 / orders 2")):
            for layout in ("v1", "sections_v2"):
                with self.subTest(locale=locale, layout=layout):
                    payload, text, _ = render(rows, locale=locale, layout=layout)
                    self.assertIn(expected, text)
                    self.assertEqual(aggregator.digest.global_total_fills(payload), 3)

    def test_legacy_null_missing_and_signal_only_counts_stay_unknown(self):
        for mode in ("null", "missing"):
            rows = five_accounts()
            for row in rows:
                row.pop("field_status")
                for field in ("fill_count", "order_count"):
                    if mode == "missing":
                        row.pop(field)
                    else:
                        row[field] = None
            for layout in ("v1", "sections_v2"):
                with self.subTest(mode=mode, layout=layout):
                    payload, text, _ = render(rows, layout=layout)
                    self.assertIn("证据未覆盖", text)
                    self.assertEqual(text.count("成交 未知 / 订单 未知"), 5)
                    self.assertIsNone(aggregator.digest.global_total_fills(payload))

    def test_mixed_coverage_keeps_total_unknown_and_known_account_facts(self):
        rows = five_accounts()
        rows[-1].update(fill_count=None, order_count=None, field_status={})
        for layout in ("v1", "sections_v2"):
            with self.subTest(layout=layout):
                payload, text, _ = render(rows, layout=layout)
                self.assertEqual(text.count("成交 0 笔 / 无订单"), 4)
                self.assertEqual(text.count("成交 未知 / 订单 未知"), 1)
                self.assertIn("证据未覆盖", text)
                self.assertIsNone(aggregator.digest.global_total_fills(payload))

    def test_stale_business_day_does_not_supply_zero(self):
        rows = five_accounts()
        rows[-1]["business_day"] = "2026-10-13"
        payload, text, collected = render(rows)
        self.assertEqual(len(payload.runs), 4)
        self.assertEqual(collected.coverage.stale_candidates_count, 1)
        self.assertIn("证据未覆盖", text)
        self.assertIsNone(aggregator.digest.global_total_fills(payload))

    def test_unreadable_source_cannot_claim_zero(self):
        payload, text, collected = render([], contents="{invalid", failed=True)
        self.assertFalse(collected.coverage.candidates_loaded)
        self.assertIn("未知", text)
        self.assertIsNone(aggregator.digest.global_total_fills(payload))

    def test_absent_unreadable_and_stale_counts_with_run_existence_stay_unknown(self):
        stubs = five_accounts()
        for row in stubs:
            row.update(fill_count=None, order_count=None, field_status={},
                       evidence_provenance="github_workflow_stub")
        github = aggregator.GithubEvidenceResult(rows=stubs, sources_queried=5, sources_matched=5)
        for kind in ("absent", "unreadable", "stale"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {}, clear=True):
                path = Path(tmp) / "synthetic.json"
                if kind == "absent":
                    path = None
                elif kind == "unreadable":
                    path.write_text("{invalid")
                    os.environ["DIGEST_CANDIDATES_STORE_STATUS"] = "failed"
                else:
                    rows = five_accounts()
                    for row in rows:
                        row["business_day"] = "2026-10-13"
                    path.write_text(json.dumps({"runs": rows}))
                with mock.patch.object(aggregator, "collect_from_github_workflows", return_value=github):
                    payload, text, _ = aggregator.build_digest_payload(
                        business_day=DAY, candidates_path=path, include_github=True,
                    )
                self.assertEqual(text.count("成交 未知 / 订单 未知"), 5)
                self.assertIn("证据未覆盖", text)
                self.assertIsNone(aggregator.digest.global_total_fills(payload))

    def test_legacy_explicit_zero_and_thin_rows_remain_supported(self):
        rows = five_accounts()[:1]
        rows[0].pop("field_status")
        rows[0].pop("signal_summary")
        payload, text, _ = render(rows)
        self.assertIn("成交 0 笔 / 无订单", text)
        self.assertEqual(aggregator.digest.global_total_fills(payload), 0)


if __name__ == "__main__":
    unittest.main()
