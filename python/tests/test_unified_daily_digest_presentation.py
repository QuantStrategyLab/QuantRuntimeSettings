"""Synthetic presentation regressions; never send or load private accounts."""
from copy import deepcopy
from dataclasses import asdict, replace
import json
import os
import unittest
from unittest.mock import patch

from daily_digest_notify import DailyDigestInput, DigestRunEntry, EvidenceCoverage
from unified_daily_digest import render


def row(account="synthetic-a", **updates):
    values = dict(platform_id="schwab", strategy_profile="soxl_soxx_trend_income",
                  account_hint=account, opaque_account_uid="opaque-" + account,
                  target_id="target-" + account, source_run_id="run-" + account,
                  order_count=0, fill_count=0, cycle_count=1)
    values.update(updates)
    return DigestRunEntry(**values)


def payload(*runs, locale="zh"):
    return DailyDigestInput(business_day="2026-10-19", locale=locale, runs=runs,
        evidence_coverage=EvidenceCoverage(candidates_loaded=True),
        notification_summary={"counts_scope_unknown": False})


class UnifiedPresentationTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"QRS_UNIFIED_NOTIFICATION_ENABLED": "true"}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def display_names(self, value):
        return patch.dict(os.environ, {"QSL_DISPLAY_NAMES_JSON": json.dumps(value, ensure_ascii=False)})

    def test_window_crosses_calendar_boundaries_in_both_languages(self):
        for day, following in (("2026-10-31", "2026-11-01"), ("2026-12-31", "2027-01-01")):
            for locale, heading in (("zh", "统计区间"), ("en", "Reporting window")):
                with self.subTest(day=day, locale=locale):
                    text = render(replace(payload(row(), locale=locale), business_day=day))
                    self.assertIn(heading, text)
                    self.assertIn(f"{day} 06:00 – {following} 06:00 (UTC+8)", text)

    def test_management_station_name_preserves_not_connected_unknown(self):
        inventory = {"qrs": {"expected_targets": 0, "covered_targets": 0, "runs": None}}
        for locale, expected in (("zh", "管理站：未接入，运行状态未知"),
                                 ("en", "Management console: not connected; run state unknown")):
            with self.subTest(locale=locale):
                value = replace(payload(row(), locale=locale), notification_summary={
                    "counts_scope_unknown": True, "source_inventory": inventory})
                text = render(value)
                self.assertIn(expected, text)
                self.assertIn("全窗口统计未知" if locale == "zh" else "whole-window count unknown", text)

    def test_legacy_bilingual_render_also_shows_window(self):
        with patch.dict(os.environ, {"QRS_UNIFIED_NOTIFICATION_ENABLED": "false"}):
            text = render(replace(payload(row(order_count=1)), business_day="2026-12-31"))
        self.assertIn("统计区间", text)
        self.assertIn("Reporting window", text)
        self.assertIn("2026-12-31 06:00 – 2027-01-01 06:00 (UTC+8)", text)

    def test_legacy_window_fits_the_minimum_message_budget(self):
        with patch.dict(os.environ, {"QRS_UNIFIED_NOTIFICATION_ENABLED": "false"}):
            text = render(payload(row(order_count=1), row("synthetic-b", order_count=1)), max_units=256)
        self.assertLessEqual(len(text.encode("utf-16-le")) // 2, 256)
        self.assertEqual(text.count("2026-10-19 06:00"), 1)
        self.assertIn("其余", text)

    def test_same_platform_accounts_and_strategies_are_distinguishable_without_mutation(self):
        rows = (row(), row("synthetic-b", strategy_profile="tqqq_growth_income"))
        before = deepcopy([asdict(item) for item in rows])
        with self.display_names({"accounts": {"schwab": {
                "synthetic-a": {"zh": "合成甲", "en": "Synthetic A"},
                "synthetic-b": {"zh": "合成乙", "en": "Synthetic B"}}}}):
            text = render(payload(*rows))
        self.assertIn("Schwab / 合成甲 / 半导体趋势收益", text)
        self.assertIn("Schwab / 合成乙 / 纳斯达克增长收益", text)
        self.assertEqual([asdict(item) for item in rows], before)
        for item in rows:
            self.assertNotIn(item.opaque_account_uid, text)
            self.assertNotIn(item.target_id, text)
            self.assertNotIn(item.source_run_id, text)

    def test_selected_locale_reaches_alias_and_strategy_for_variants(self):
        mapping = {"accounts": {"schwab": {"synthetic-a": {"zh": "合成甲", "en": "Synthetic A"}}}}
        with self.display_names(mapping):
            for locale in ("zh-CN", "zh_TW", " ZH-hans ", " zh "):
                with self.subTest(locale=locale):
                    text = render(payload(row(), locale=locale))
                    self.assertIn("合成甲 / 半导体趋势收益", text)
                    self.assertNotIn("Synthetic A", text)
            text = render(payload(row(), locale=" en-US "))
            self.assertIn("Daily trading digest", text)
            self.assertIn("Synthetic A / Semiconductor Trend Income", text)
            self.assertNotIn("合成甲", text)

    def test_platform_account_mapping_precedes_global_alias_fallback(self):
        mapping = {"account_aliases": {"synthetic-a": {"zh": "全局甲", "en": "Global A"}}}
        with self.display_names(mapping):
            self.assertIn("全局甲", render(payload(row())))
        mapping["accounts"] = {"schwab": {"synthetic-a": {"zh": "平台甲", "en": "Platform A"}}}
        with self.display_names(mapping):
            text = render(payload(row()))
            self.assertIn("平台甲", text)
            self.assertNotIn("全局甲", text)

    def test_unmapped_accounts_get_distinct_generic_labels_not_raw_identifiers(self):
        text = render(payload(row(), row("synthetic-b")))
        self.assertIn("账户 1", text)
        self.assertIn("账户 2", text)
        self.assertNotIn("synthetic-a", text)
        self.assertNotIn("synthetic-b", text)

    def test_same_account_repeated_healthy_runs_do_not_repeat_context(self):
        item = row()
        with self.display_names({"account_aliases": {"synthetic-a": "Synthetic alias"}}):
            text = render(payload(item, replace(item, source_run_id="synthetic-second-run")))
        self.assertEqual(text.count("Schwab / Synthetic alias / 半导体趋势收益"), 1)
        self.assertIn("已收录运行 2 次", text)

    def test_colliding_aliases_are_disambiguated_by_display_ordinal(self):
        with self.display_names({"account_aliases": {"synthetic-a": "Shared alias", "synthetic-b": "Shared alias"}}):
            text = render(payload(row(), row("synthetic-b")))
        self.assertIn("Shared alias 1", text)
        self.assertIn("Shared alias 2", text)

    def test_generated_ordinals_cannot_collide_with_existing_alias(self):
        with self.display_names({"account_aliases": {
                "synthetic-a": "Shared alias", "synthetic-b": "Shared alias", "synthetic-c": "Shared alias 1"}}):
            text = render(payload(row(), row("synthetic-b"), row("synthetic-c")))
        lines = [line for line in text.splitlines() if line.startswith("• ")]
        self.assertEqual(len(lines), 3)
        self.assertEqual(len(set(lines)), 3)
        self.assertIn("已收录运行 3 次", text)

    def test_private_looking_or_invalid_alias_values_fall_back_safely(self):
        unsafe_values = ("U" + "0" * 7 + "1", "live-U" + "0" * 7 + "2",
                         "a" * 32, "https://synthetic.invalid/private", float("nan"))
        for value in unsafe_values:
            with self.subTest(value_type=type(value).__name__), self.display_names({"account_aliases": {"synthetic-a": value}}):
                text = render(payload(row()))
                self.assertIn("账户", text)
                if isinstance(value, str):
                    self.assertNotIn(value, text)
                self.assertNotIn("nan", text.lower())

    def test_missing_names_use_localized_fallbacks_not_machine_keys(self):
        for locale, expected in (("zh", "未命名策略"), ("en", "Unnamed strategy")):
            text = render(payload(row(strategy_profile="synthetic-unmapped-profile"), locale=locale))
            self.assertIn(expected, text)
            self.assertNotIn("synthetic-unmapped-profile", text)
        text = render(payload(row(platform_id="charles_schwab")))
        self.assertIn("未知平台", text)
        self.assertNotIn("charles_schwab", text)

    def test_unmapped_strategy_label_cannot_copy_protected_binding_values(self):
        item = row(strategy_profile="synthetic-unmapped-profile")
        for field in ("opaque_account_uid", "target_id", "source_run_id"):
            protected = getattr(item, field)
            with self.subTest(field=field):
                text = render(payload(replace(item, strategy_label=protected)))
                self.assertNotIn(protected, text)
                self.assertIn("未命名策略", text)

    def test_both_approved_risk_reasons_and_unknown_fills_survive_context(self):
        item = row(order_count=0, fill_count=None, fill_count_status="unknown",
            rebalance_conclusion="blocked", block_reason={"reason_code": "strategy_risk_rejected", "observed_value": None, "limit": None},
            approved_gate_reasons=({"reason_code": "consecutive_loss_limit_exceeded", "observed_value": 6, "limit": 5},
                {"reason_code": "daily_loss_limit_exceeded", "observed_value": 80, "limit": 60, "equity_usd": 2000}))
        with self.display_names({"account_aliases": {"synthetic-a": "Synthetic alias"}}):
            text = render(payload(item))
        self.assertIn("Synthetic alias / 半导体趋势收益", text)
        self.assertIn("6>5", text)
        self.assertIn("80≥60", text)
        self.assertIn("核对基准净值和资金进出", text)
        self.assertIn("成交：全窗口统计未知", text)
        self.assertNotIn("成交：0", text)

    def test_missing_reason_and_alert_stay_explicit_not_healthy(self):
        blocked = render(payload(row(rebalance_conclusion="blocked")))
        self.assertIn("具体原因未知", blocked)
        alert = render(payload(row(status="alert")))
        self.assertIn("需核对", alert)
        self.assertNotIn("：已运行", alert)

    def test_nonfinite_or_boolean_counts_are_unknown_never_zero_or_nan(self):
        for value in (float("nan"), float("inf"), True, False):
            with self.subTest(value_type=type(value).__name__):
                text = render(payload(row(order_count=value, fill_count=value)))
                self.assertIn("订单：全窗口统计未知", text)
                self.assertIn("成交：全窗口统计未知", text)
                self.assertNotIn("本轮 0 单", text)
                for token in ("nan", "inf", "True", "False"):
                    self.assertNotIn(token, text)

    def test_partially_known_run_counts_remain_visible_under_unknown_totals(self):
        cases = (
            (row(order_count=2, fill_count=None, fill_count_status="unknown", execution_status="order_submitted"),
             "本轮订单 2，成交 未知", "this run: orders 2, fills unknown"),
            (row(order_count=None, order_count_status="unknown", fill_count=3),
             "本轮订单 未知，成交 3", "this run: orders unknown, fills 3"),
        )
        for item, zh_detail, en_detail in cases:
            for locale, detail in (("zh", zh_detail), ("en", en_detail)):
                for reason in ("", "schwab_fills_not_connected"):
                    with self.subTest(locale=locale, orders=item.order_count, reason=reason):
                        value = replace(payload(replace(item, reason_code=reason), locale=locale),
                            notification_summary={"counts_scope_unknown": True})
                        text = render(value)
                        self.assertIn(detail, text)
                        self.assertIn("全窗口统计未知" if locale == "zh" else "whole-window count unknown", text)
                        self.assertNotIn("无交易" if locale == "zh" else "no trades", text)
                        if item.execution_status == "order_submitted":
                            self.assertIn("成交待确认" if locale == "zh" else "fill confirmation pending", text)

    def test_evidence_axis_failures_remain_visible_without_reclassifying_counts(self):
        cases = (
            ("evidence_persistence_status", "persistence_failed", "证据留存失败", "Evidence persistence failed"),
            ("evidence_persistence_status", "unknown", "证据留存状态未知", "Evidence persistence status unknown"),
            ("evidence_delivery_status", "delivery_failed", "证据传递失败", "Evidence delivery failed"),
            ("evidence_delivery_status", "pending_central", "证据待中央汇总", "Evidence pending central aggregation"),
            ("evidence_delivery_status", "unknown", "证据传递状态未知", "Evidence delivery status unknown"),
        )
        for field, value, chinese, english in cases:
            for locale, expected in (("zh", chinese), ("en", english)):
                with self.subTest(field=field, value=value, locale=locale):
                    item = row(order_count=2, fill_count=1, **{field: value})
                    before = deepcopy(asdict(item))
                    text = render(payload(item, locale=locale))
                    self.assertIn(expected, text)
                    self.assertIn("需核对" if locale == "zh" else "Needs review", text)
                    self.assertNotIn("：已运行" if locale == "zh" else ": Observed run", text)
                    self.assertIn("本轮 2 单，成交 1" if locale == "zh" else "2 orders, 1 fills", text)
                    self.assertEqual(asdict(item), before)

    def test_risk_and_evidence_failures_are_both_visible(self):
        item = row(rebalance_conclusion="blocked", evidence_delivery_status="delivery_failed",
            block_reason={"reason_code": "consecutive_loss_limit_exceeded", "observed_value": 6, "limit": 5})
        text = render(payload(item))
        self.assertIn("连续亏损 6 次", text)
        self.assertIn("证据传递失败", text)

    def test_evidence_issue_keeps_priority_under_message_budget(self):
        rows = tuple(row("synthetic-" + str(index)) for index in range(100))
        issue = row("synthetic-issue", evidence_persistence_status="persistence_failed")
        text = render(payload(*rows, issue), max_units=512)
        self.assertIn("证据留存失败", text)
        self.assertIn("已省略", text)
        self.assertLessEqual(len(text.encode("utf-16-le")) // 2, 512)

    def test_aliases_are_single_line_and_long_context_keeps_message_budget(self):
        with self.display_names({"account_aliases": {"synthetic-a": "合成\n别名"}}):
            text = render(payload(row()))
        self.assertIn("合成 别名", text)
        rows = tuple(row("synthetic-" + str(index)) for index in range(100))
        text = render(payload(*rows), max_units=512)
        self.assertLessEqual(len(text.encode("utf-16-le")) // 2, 512)
        self.assertIn("已省略", text)

    def test_risk_reason_keeps_priority_over_many_healthy_contexts(self):
        rows = tuple(row("synthetic-" + str(index)) for index in range(100))
        blocked = row("synthetic-blocked", rebalance_conclusion="blocked",
            block_reason={"reason_code": "consecutive_loss_limit_exceeded", "observed_value": 6, "limit": 5})
        text = render(payload(*rows, blocked), max_units=512)
        self.assertIn("6 次", text)
        self.assertIn("5 次", text)
        self.assertIn("已省略", text)

    def test_alert_keeps_priority_over_many_healthy_contexts(self):
        rows = tuple(row("synthetic-" + str(index)) for index in range(100))
        text = render(payload(*rows, row("synthetic-alert", status="alert")), max_units=512)
        self.assertIn("需核对", text)
        self.assertIn("已省略", text)
