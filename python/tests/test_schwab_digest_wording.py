"""Digest copy uses synthetic rows; unknown daily counts never become zero."""
import copy
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from test_daily_digest_ux import DAY, aggregator, render


def schwab_row():
    return {
        "platform_id": "schwab", "strategy_profile": "synthetic_strategy",
        "target_id": "schwab/synthetic-target", "account_hint": "demo",
        "business_day": DAY, "actually_ran": True, "status": "alert",
        "fill_count": None, "order_count": None, "cycle_count": 1,
        "field_status": {"fill_count": "counts_unknown", "order_count": "counts_unknown"},
        "reason_code": "schwab_fills_not_connected", "signal_summary": "blocked",
        "rebalance_kind": "pending", "rebalance_conclusion": "blocked",
    }


class SchwabDigestWordingTests(unittest.TestCase):
    def test_concrete_block_reason_and_run_fact_are_bilingual_on_one_line(self):
        for observed, limit in ((6, 5), (13, 12)):
            row = dict(schwab_row(), block_reason={"reason_code": "consecutive_loss_limit_exceeded",
                "observed_value": observed, "limit": limit, "order_submitted_this_run": False})
            for mode, locale, layout, (payload, text, collected) in self.variants([row]):
                with self.subTest(mode=mode, locale=locale, layout=layout, observed=observed):
                    line = next(line for line in text.splitlines() if f"连续亏损 {observed} 次" in line)
                    self.assertIn(f"上限 {limit} 次 / Consecutive losses {observed} > limit {limit}", line)
                    self.assertIn("本轮未下单 / No orders submitted this run", line)
                    self.assertIsNone(aggregator.digest.global_total_fills(payload))
                    receipt = aggregator.build_receipt(payload, collected, message_chars=len(text))
                    self.assertIsNone(receipt["runs"][0]["order_count"])
                    self.assertIsNone(receipt["runs"][0]["fill_count"])

    def test_missing_submission_fact_never_claims_no_submission(self):
        for submitted in (None, True):
            row = dict(schwab_row(), block_reason={"reason_code": "consecutive_loss_limit_exceeded",
                "observed_value": 6, "limit": 5, "order_submitted_this_run": submitted})
            for _, _, _, (_, text, _) in self.variants([row]):
                self.assertIn("Consecutive losses 6 > limit 5", text)
                self.assertNotIn("本轮未下单", text)
                self.assertNotIn("No orders submitted", text)
                if submitted is True:
                    self.assertIn("本轮已提交订单 / Orders submitted this run", text)

    def test_bad_block_fields_keep_exact_legacy_copy(self):
        bad = [None, "private text", {}, {"reason_code": []},
            {"reason_code": "untrusted-private-text"},
            {"reason_code": "consecutive_loss_limit_exceeded", "observed_value": True, "limit": 0},
            {"reason_code": "consecutive_loss_limit_exceeded", "observed_value": 6, "limit": 6},
            {"reason_code": "consecutive_loss_limit_exceeded", "observed_value": 6, "limit": 5,
             "order_submitted_this_run": "false"}]
        for mode in ("immediate", "daily_digest"):
            for locale in ("zh", "en"):
                for layout in ("v1", "sections_v2"):
                    options = dict(locale=locale, layout=layout, expected=[schwab_row()],
                        environment={"QSL_ROUTINE_NOTIFICATION_MODE": mode})
                    baseline = render([schwab_row()], **options)[1]
                    for value in bad:
                        self.assertEqual(render([dict(schwab_row(), block_reason=value)], **options)[1], baseline)

    def test_run_fact_does_not_erase_positive_daily_counts_or_other_accounts(self):
        row = dict(schwab_row(), order_count=2, fill_count=3, field_status={},
            block_reason={"reason_code": "strategy_risk_rejected", "observed_value": None,
                          "limit": None, "order_submitted_this_run": False})
        for _, _, _, (payload, text, _) in self.variants([row]):
            self.assertIn("本轮未下单 / No orders submitted this run", text)
            self.assertEqual(aggregator.digest.global_total_fills(payload), 3)
            self.assertNotIn("全天零", text)
        other = dict(row, platform_id="ibkr", target_id="ibkr/synthetic-target")
        for _, _, _, (_, text, _) in self.variants([other]):
            self.assertNotIn("本轮未下单", text)

    def test_unified_candidate_without_legacy_block_labels_still_shows_reason(self):
        row = schwab_row()
        for key in ("signal_summary", "rebalance_kind", "rebalance_conclusion"):
            row.pop(key)
        row["block_reason"] = {"reason_code": "consecutive_loss_limit_exceeded",
            "observed_value": 6, "limit": 5, "order_submitted_this_run": False}
        for _, _, _, (_, text, _) in self.variants([row]):
            self.assertIn("Consecutive losses 6 > limit 5", text)
            self.assertIn("No orders submitted this run", text)

    def variants(self, rows, **kwargs):
        for mode in ("immediate", "daily_digest"):
            for locale in ("zh", "en"):
                for layout in ("v1", "sections_v2"):
                    environment = {"QSL_ROUTINE_NOTIFICATION_MODE": mode}
                    yield mode, locale, layout, render(
                        rows, locale=locale, layout=layout, expected=[schwab_row()],
                        environment=environment, **kwargs,
                    )

    def test_blocked_unconnected_counts_are_plain_copy_and_stay_unknown(self):
        for mode, locale, layout, (payload, text, collected) in self.variants([schwab_row()]):
            with self.subTest(mode=mode, locale=locale, layout=layout):
                self.assertIn("已拦截" if locale == "zh" else "Blocked", text)
                self.assertIn("未接入统计" if locale == "zh" else "not connected", text)
                for unwanted in ("待确认", "Pending", "数据缺失", "Data missing", "EVIDENCE_NOT_FOUND",
                                 "schwab_fills_not_connected", "执行证据不完整", "Incomplete execution evidence"):
                    self.assertNotIn(unwanted, text)
                # A blocked label alone cannot prove that no order was submitted.
                self.assertNotIn("本轮未下单", text)
                self.assertNotIn("No orders submitted", text)
                receipt = aggregator.build_receipt(payload, collected, message_chars=len(text))
                self.assertIsNone(receipt["total_fills"])
                for field in ("fill_count", "order_count"):
                    self.assertIsNone(receipt["runs"][0][field])
                    self.assertEqual(receipt["runs"][0][field + "_status"], "unknown")

    def test_pending_is_not_relabelled_as_blocked_or_no_order(self):
        row = dict(schwab_row(), status="ok", signal_summary="submitted", rebalance_conclusion="submitted")
        for locale in ("zh", "en"):
            _, text, _ = render([row], locale=locale)
            self.assertIn("待确认" if locale == "zh" else "Pending", text)
            self.assertNotIn("本轮未下单", text)

    def test_positive_counts_are_preserved_when_the_other_count_is_unconnected(self):
        row = copy.deepcopy(schwab_row())
        row.update(fill_count=3, status="ok", signal_summary="filled", rebalance_kind="rebalance", rebalance_conclusion="filled")
        row["field_status"]["fill_count"] = "known"
        for _, locale, _, (payload, text, _) in self.variants([row]):
            self.assertIn("成交 3" if locale == "zh" else "fills 3", text.lower())
            self.assertIn("未接入统计" if locale == "zh" else "not connected", text)
            self.assertEqual(aggregator.digest.global_total_fills(payload), 3)

    def test_unconnected_reason_suffixes_and_unknown_coverage_never_supply_zero(self):
        row = dict(schwab_row(), reason_code="schwab_fills_not_connected+equity_absent")
        for _, locale, _, (payload, text, _) in self.variants([row]):
            self.assertIn("未接入统计" if locale == "zh" else "not connected", text)
            self.assertIsNone(aggregator.digest.global_total_fills(payload))
            self.assertNotIn("无交易", text)

    def test_mixed_targets_keep_known_counts_and_real_missing_warning(self):
        other = dict(schwab_row(), platform_id="ibkr", target_id="ibkr/synthetic-target",
                     reason_code="", signal_summary="filled", rebalance_conclusion="filled", rebalance_kind="rebalance",
                     fill_count=2, order_count=1, field_status={})
        _, text, _ = render([schwab_row(), other])
        self.assertIn("成交 2 笔 / 订单 1 笔", text)
        other.update(fill_count=None, order_count=None)
        payload, text, _ = render([schwab_row(), other])
        self.assertIn("EVIDENCE_NOT_FOUND", text)
        self.assertIn("未接入统计", text)
        self.assertIsNone(aggregator.digest.global_total_fills(payload))

    def test_dry_run_never_resolves_credentials_or_sends(self):
        import send_daily_digest_telegram as sender
        from test_daily_digest_ux import config
        for mode in ("immediate", "daily_digest"):
            for locale in ("zh", "en"):
                with self.subTest(mode=mode, locale=locale), tempfile.TemporaryDirectory() as tmp:
                    candidates, receipt_path = Path(tmp) / "candidates.json", Path(tmp) / "receipt.json"
                    row = dict(schwab_row(), block_reason={"reason_code": "consecutive_loss_limit_exceeded",
                        "observed_value": 6, "limit": 5, "order_submitted_this_run": False})
                    candidates.write_text(json.dumps({"runs": [row]}))
                    with mock.patch.dict(os.environ, {"QSL_ROUTINE_NOTIFICATION_MODE": mode}, clear=True), \
                         mock.patch.object(sender.aggregator, "load_platform_config", return_value=config([schwab_row()])), \
                         mock.patch.object(sender, "resolve_telegram_token") as token, \
                         mock.patch.object(sender, "resolve_telegram_chat_id") as chat, \
                         mock.patch.object(sender, "send_telegram_message") as send, \
                         mock.patch.object(sender.maintenance, "send_strict_telegram") as strict_send, \
                         mock.patch("urllib.request.urlopen") as network, redirect_stdout(io.StringIO()):
                        result = sender.main(["--dry-run", "--no-github", "--business-day", DAY,
                                              "--locale", locale, "--candidates", str(candidates),
                                              "--write-receipt", str(receipt_path)])
                    self.assertEqual(result, 0)
                    receipt = json.loads(receipt_path.read_text())
                    self.assertFalse(receipt["delivered"])
                    self.assertTrue(receipt["dry_run"])
                    self.assertIsNone(receipt["total_fills"])
                    for boundary in (token, chat, send, strict_send, network):
                        boundary.assert_not_called()

    def test_genuine_missing_stale_and_failed_sources_keep_their_warnings(self):
        for mode in ("immediate", "daily_digest"):
            for kind in ("absent", "stale", "failed"):
                row = schwab_row()
                kwargs = {}
                if kind == "stale":
                    row["business_day"] = "2026-10-13"
                if kind == "failed":
                    kwargs["environment"] = {"QSL_ROUTINE_NOTIFICATION_MODE": mode,
                        "DIGEST_CANDIDATES_STORE_STATUS": "failed"}
                else:
                    kwargs["environment"] = {"QSL_ROUTINE_NOTIFICATION_MODE": mode}
                payload, text, _ = render([] if kind == "absent" else [row], expected=[schwab_row()], **kwargs)
                with self.subTest(mode=mode, kind=kind):
                    self.assertIsNone(aggregator.digest.global_total_fills(payload))
                    self.assertIn({"absent": "Target report missing", "stale": "Stale candidates", "failed": "Source read failure"}[kind]
                                  if mode == "daily_digest" else
                                  {"absent": "EVIDENCE_NOT_FOUND", "stale": "EVIDENCE_STALE_BUSINESS_DAY", "failed": "EVIDENCE_UNREADABLE"}[kind], text)


if __name__ == "__main__":
    unittest.main()
