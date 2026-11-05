"""Fixed digest regressions with fake-only bindings and no external services."""
from dataclasses import replace
import os
import unittest
from unittest.mock import patch

from daily_digest_notify import DailyDigestInput, DigestRunEntry, EvidenceCoverage
from unified_daily_digest import render
import cloud_run_daily_digest as app
from test_cloud_run_daily_digest import EXPECTED, JOB, MemoryStore, NOW, HEADERS
from test_daily_digest_ux import config


class FixedDigestContractTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"QRS_UNIFIED_NOTIFICATION_ENABLED": "true"}, clear=True)
        env.start()
        self.addCleanup(env.stop)

    def payload(self, **updates):
        values = dict(business_day="2026-10-15", runs=(DigestRunEntry(
            platform_id="schwab", strategy_profile="soxl_soxx_trend_income",
            source_run_id="fake-run", cycle_count=1),),
            evidence_coverage=EvidenceCoverage(candidates_loaded=True))
        values.update(updates)
        return DailyDigestInput(**values)

    def test_idle_uses_same_sections_with_flag_and_layout_variants(self):
        for flag in ("true",):
            for layout in ("v1", "sections_v2"):
                with self.subTest(flag=flag, layout=layout), patch.dict(os.environ,
                        {"QRS_UNIFIED_NOTIFICATION_ENABLED": flag}, clear=True):
                    text = render(self.payload(layout=layout))
                    for section in ("【资产管理日报｜2026-10-16】", "统计区间", "完整性", "需关注", "运行与交易", "账户观察", "证据与缺口"):
                        self.assertIn(section, text)
                    self.assertIn("已核实无交易", text)
                    self.assertIn("2026-10-15 06:00", text)
                    self.assertIn("2026-10-16 06:00", text)

    def test_unknown_empty_or_blocked_never_claims_no_trade(self):
        for value in (self.payload(runs=(), evidence_coverage=None),
                      self.payload(runs=(replace(self.payload().runs[0], order_count=None,
                                                order_count_status="unknown"),)),
                      self.payload(runs=(replace(self.payload().runs[0], execution_status="empty_position_decision"),))):
            with self.subTest(value=value):
                text = render(value)
                self.assertNotIn("已核实无交易", text)
                self.assertIn("未知", text)
                self.assertIn("运行链接不可用", text)

    def test_opaque_identity_and_producer_prose_are_not_display_fallbacks(self):
        row = replace(self.payload().runs[0], opaque_account_uid="fake-private-opaque",
                      target_id="fake-private-target", source_run_id="fake-private-run",
                      account_hint="fake-private-account", note="fake-private-diagnostic",
                      status="alert")
        text = render(self.payload(runs=(row,)))
        for private in (row.opaque_account_uid, row.target_id, row.source_run_id, row.account_hint, row.note):
            self.assertNotIn(private, text)
        self.assertIn("运行链接不可用", text)

    def test_locale_and_overflow_keep_sections_and_unknown_gaps(self):
        rows = tuple(replace(self.payload().runs[0], status="alert", order_count=1, fill_count=1, target_id=f"fake-{i}") for i in range(100))
        for locale in ("zh-CN", "en"):
            for budget in (256, 3900):
                with self.subTest(locale=locale, budget=budget):
                    text = render(self.payload(runs=rows, locale=locale), max_units=budget)
                    self.assertLessEqual(len(text.encode("utf-16-le")) // 2, budget)
                    self.assertIn("证据与缺口" if locale == "zh-CN" else "Evidence and gaps", text)
                    self.assertIn("省略" if locale == "zh-CN" else "omitted", text)

    def test_disabled_expected_target_is_not_read_or_counted_as_running(self):
        disabled = dict(EXPECTED[0], platform_id="binance", target_id="fake-disabled",
                        opaque_account_uid="fake-disabled", notification_state="disabled")
        cfg = app.Configuration([*EXPECTED, disabled], JOB, "fake-scope", "2026-10-16", True)
        store, sent = MemoryStore(), []
        original = store.candidate
        def candidate(key, timeout):
            self.assertFalse(key.startswith("binance/"))
            return original(key, timeout)
        store.candidate = candidate
        with patch.dict(os.environ, {"QRS_UNIFIED_NOTIFICATION_ENABLED": "true"}, clear=True):
            status, result = app.execute(HEADERS, cfg, store, lambda text: sent.append(text) or 1,
                now=lambda: NOW, platform_config=config(EXPECTED))
        self.assertEqual((status, result["coverage"]), (200, "complete"))
        self.assertIn("Binance：已停用", sent[0])
        self.assertIn("不适用", sent[0])
        self.assertNotIn("Binance：已收录", sent[0])

    def test_unknown_expected_state_fails_closed(self):
        for state in (None, "unknown", "false", False):
            with self.subTest(state=state), self.assertRaisesRegex(ValueError, "digest_expected_state_invalid"):
                app.Configuration([dict(EXPECTED[0], notification_state=state)], JOB, "fake-scope", "2026-10-16")

    def test_disabled_inventory_conflict_is_not_silently_hidden(self):
        from test_notification_consolidation import build, candidate
        with self.assertRaisesRegex(ValueError, "digest_disabled_target_has_candidate"):
            build([candidate()], [dict(EXPECTED[0], notification_state="disabled")])

    def test_all_disabled_scope_has_no_inferred_zero_trade_counts(self):
        from test_notification_consolidation import build
        _, text, _, receipt = build([], [dict(EXPECTED[0], notification_state="disabled")])
        self.assertIn("Schwab：已停用", text)
        self.assertIn("订单：不适用", text)
        self.assertIn("成交：不适用", text)
        self.assertNotIn("已核实无交易", text)
        self.assertEqual(receipt["notification_summary"]["source_inventory"]["schwab"]["state"], "disabled")
        self.assertIsNone(receipt["run_count"])
        self.assertIsNone(receipt["total_fills"])

    def test_mixed_active_and_disabled_targets_do_not_hide_active_gaps(self):
        from test_notification_consolidation import build, candidate
        disabled = dict(EXPECTED[0], target_id="fake-disabled", notification_state="disabled")
        _, text, _, receipt = build([candidate()], [EXPECTED[0], disabled])
        self.assertIn("另有 1 个停用目标", text)
        self.assertIn("目标覆盖 1/1", text)
        inventory = receipt["notification_summary"]["source_inventory"]["schwab"]
        self.assertNotEqual(inventory.get("state"), "disabled")
        self.assertEqual(inventory["runs"], 1)
