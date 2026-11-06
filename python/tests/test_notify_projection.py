"""Synthetic, offline summary projection regressions; no sends or broker IO."""
from copy import deepcopy
from dataclasses import replace
from datetime import datetime
from itertools import permutations
import os
import unittest
from unittest.mock import patch

import notification_candidate_adapter as adapter
from test_notification_consolidation import build, candidate
from test_unified_daily_digest import payload, row
from unified_daily_digest import render
from notification_snapshot.unified_contract import NotificationEvent


class NotifyProjectionTests(unittest.TestCase):
    def test_completed_execution_still_flags_unknown_fill_count(self):
        with patch.dict(os.environ, {}, clear=True):
            text = render(payload(row(order_count=1, fill_count=None,
                fill_count_status="unknown", execution_status="completed")))
        self.assertIn("Fill count unknown", text)
        self.assertNotIn("· 已完成 / Completed", text)

    def test_unconfirmed_status_is_visible_even_with_observed_fills(self):
        for status in ("order_submitted", "submitted", "broker_acknowledged", "pending",
                       "partially_filled", "pending_reconciliation", "reconciliation_required", "unknown"):
            for locale in ("zh", "en"):
                with self.subTest(status=status, locale=locale), patch.dict(os.environ,
                        {"QRS_UNIFIED_NOTIFICATION_ENABLED": "true"}, clear=True):
                    text = render(replace(payload(row(order_count=1, fill_count=1,
                        execution_status=status)), locale=locale))
                    self.assertIn("待确认" if locale == "zh" else "unconfirmed", text)
                    self.assertIn("需核对" if locale == "zh" else "Needs review", text)

    def test_zero_counts_do_not_hide_an_inner_failure(self):
        with patch.dict(os.environ, {"QRS_UNIFIED_NOTIFICATION_ENABLED": "true"}, clear=True):
            text = render(payload(row(status="alert", execution_status="risk_blocked")))
        self.assertNotIn("已核验目标无交易", text)
        self.assertIn("已拦截", text)

    def test_truncation_cannot_separate_counts_from_unconfirmed_status(self):
        for unified in ("false", "true"):
            for locale in ("zh", "en"):
                for budget in ((1024, 3900) if unified == "true" else (256, 300, 3900)):
                    with self.subTest(unified=unified, locale=locale, budget=budget), patch.dict(os.environ,
                            {"QRS_UNIFIED_NOTIFICATION_ENABLED": unified}, clear=True):
                        text = render(replace(payload(row(order_count=1, fill_count=1,
                            execution_status="order_submitted")), locale=locale), max_units=budget)
                        self.assertLessEqual(len(text.encode("utf-16-le")) // 2, budget)
                        for line in text.splitlines():
                            if any(token in line for token in ("Orders 1", "Orders: 1", "Submitted 1", "提交1", "订单：1")):
                                self.assertIn("待确认" if locale == "zh" else "unconfirmed", line)

    def test_longbridge_and_binance_use_half_open_sgt_windows(self):
        for platform in ("longbridge", "binance"):
            rows = []
            for index, (stamp, day) in enumerate((
                    ("2026-10-15T05:59:59+08:00", "2026-10-14"),
                    ("2026-10-15T06:00:00+08:00", "2026-10-15"),
                    ("2026-10-16T05:59:59+08:00", "2026-10-15"),
                    ("2026-10-16T06:00:00+08:00", "2026-10-16"))):
                item = candidate(run=f"synthetic-{index}", platform_id=platform,
                    business_day=day, order_count=1, fill_count=2)
                item["notification_event"] = NotificationEvent("routine_cycle", datetime.fromisoformat(stamp),
                    **{name: item[name] for name in adapter.IDENTITY}).to_candidate()
                rows.append(item)
            current, stale = adapter.partition(rows, "2026-10-15")
            runs, summary = adapter.aggregate(current + current, [rows[0]])
            self.assertEqual({item["source_run_id"] for item in runs}, {"synthetic-1", "synthetic-2"})
            self.assertEqual(sum(item["fill_count"] for item in runs), 4)
            self.assertEqual(len(stale), 2)
            self.assertEqual(summary["source_inventory"][platform]["runs"], 2)

    def test_same_source_observations_are_deterministic_and_conflicts_stay_unknown(self):
        a = candidate(order_count=2, fill_count=None, execution_status="order_submitted")
        b = candidate(order_count=2, fill_count=1, execution_status="completed")
        c = candidate(order_count=3, fill_count=1, execution_status="completed")
        results = []
        original = deepcopy([a, b, c])
        for rows in permutations([a, b, c]):
            runs, summary = adapter.aggregate(rows, [a])
            results.append((runs, summary))
        self.assertTrue(all(result == results[0] for result in results))
        run = results[0][0][0]
        self.assertIsNone(run["order_count"])
        self.assertEqual(run["execution_status"], "execution_unknown")
        self.assertEqual(run["status"], "alert")
        self.assertEqual([a, b, c], original)

    def test_longbridge_and_binance_are_counted_once_with_missing_coverage_unknown(self):
        rows = [candidate(run="synthetic-" + p, platform_id=p, order_count=2, fill_count=3)
                for p in ("longbridge", "binance")]
        for item in rows:
            item.pop("notification_event")
        expected = deepcopy(rows)
        p, text, collected, receipt = build([*rows, *rows], expected=expected)
        self.assertEqual(len(p.runs), 2)
        self.assertEqual(sum(item.order_count for item in p.runs), 4)
        self.assertEqual(receipt["total_fills"], 6)
        for platform in ("longbridge", "binance"):
            self.assertEqual(collected.notification_summary["source_inventory"][platform]["covered_targets"], 1)
            self.assertIn("LongBridge" if platform == "longbridge" else "Binance", text)
        _, text, _, receipt = build(rows[:1], expected=expected)
        self.assertIsNone(receipt["total_fills"])
        self.assertIn("全窗口统计未知", text)
        self.assertIn("目标覆盖 0/1", text)

    def test_same_run_evidence_failure_survives_both_orders_and_locales(self):
        for axis, failure, healthy, zh, en in (
                ("evidence_delivery_status", "delivery_failed", "delivered_to_central",
                 "证据传递失败", "Evidence delivery failed"),
                ("evidence_persistence_status", "persistence_failed", "persisted",
                 "证据留存失败", "Evidence persistence failed")):
            bad = candidate(execution_status="completed", **{axis: failure})
            good = candidate(execution_status="completed", **{axis: healthy})
            for order, observations in enumerate(([bad, good], [good, bad], [good, bad, good])):
                for locale, diagnostic in (("zh", zh), ("en", en)):
                    with self.subTest(axis=axis, order=order, locale=locale):
                        projected, text, _, _ = build(deepcopy(observations), locale=locale)
                        self.assertEqual(getattr(projected.runs[0], axis), failure)
                        self.assertIn(diagnostic, text)
                        self.assertNotIn("无交易" if locale == "zh" else "No trades", text)

    def test_explicit_unknown_evidence_cannot_be_replaced_by_healthy_replays(self):
        for axis, healthy in (("evidence_delivery_status", "delivered_to_central"),
                              ("evidence_persistence_status", "persisted")):
            for uncertain in ("unknown", "synthetic_unrecognized"):
                a = candidate(execution_status="completed", **{axis: uncertain})
                b = candidate(execution_status="completed", **{axis: healthy})
                for observations in ([a, b, b], [b, a, b]):
                    for locale, diagnostic in (("zh", "状态未知"), ("en", "status unknown")):
                        with self.subTest(axis=axis, uncertain=uncertain, locale=locale):
                            projected, text, _, _ = build(deepcopy(observations), locale=locale)
                            self.assertEqual(getattr(projected.runs[0], axis), "unknown")
                            self.assertIn(diagnostic, text)

    def test_block_and_unconfirmed_finality_survive_both_render_paths(self):
        for status in ("order_submitted", "execution_unknown"):
            for unified in ("false", "true"):
                for locale in ("zh", "en"):
                    with self.subTest(status=status, unified=unified, locale=locale), patch.dict(
                            os.environ, {"QRS_UNIFIED_NOTIFICATION_ENABLED": unified}, clear=True):
                        text = render(replace(payload(row(order_count=1, fill_count=1, status="alert",
                            execution_status=status, rebalance_conclusion="blocked")), locale=locale))
                        self.assertIn("待确认" if locale == "zh" else "unconfirmed", text.lower())
                        self.assertIn("已拦截" if locale == "zh" else "Blocked", text)
        submitted = candidate(order_count=1, fill_count=1, execution_status="order_submitted",
                              status="alert", rebalance_conclusion="blocked")
        for observations in ([submitted], [submitted, dict(submitted, execution_status="completed")]):
            for locale in ("zh", "en"):
                projected, text, _, _ = build(observations, locale=locale)
                self.assertEqual(projected.runs[0].execution_status,
                                 "order_submitted" if len(observations) == 1 else "execution_unknown")
                self.assertIn("待确认" if locale == "zh" else "unconfirmed", text.lower())
                self.assertIn("已拦截" if locale == "zh" else "Blocked", text)

    def test_terminal_block_status_does_not_invent_pending_orders(self):
        for status in ("blocked", "strategy_risk_rejected", "risk_blocked", "completed"):
            with self.subTest(status=status), patch.dict(os.environ,
                    {"QRS_UNIFIED_NOTIFICATION_ENABLED": "true"}, clear=True):
                text = render(replace(payload(row(order_count=1, fill_count=1,
                    execution_status=status, rebalance_conclusion="blocked")), locale="en"))
                self.assertNotIn("unconfirmed", text)
                self.assertIn("Blocked", text)

    def test_short_budget_retains_execution_and_evidence_failure_diagnostics(self):
        for axis, failure, zh, en in (
                ("evidence_delivery_status", "delivery_failed", "证据传递失败", "Evidence delivery failed"),
                ("evidence_persistence_status", "persistence_failed", "证据留存失败", "Evidence persistence failed")):
            for locale, diagnostic in (("zh", zh), ("en", en)):
                for budget in (1024, 3900):
                    with self.subTest(axis=axis, locale=locale, budget=budget), patch.dict(os.environ,
                            {"QRS_UNIFIED_NOTIFICATION_ENABLED": "true"}, clear=True):
                        text = render(replace(payload(row(order_count=1, fill_count=1,
                            execution_status="order_submitted", status="alert", **{axis: failure})),
                            locale=locale), max_units=budget)
                        self.assertIn("执行异常" if locale == "zh" else "Execution issue", text)
                        self.assertIn(diagnostic, text)
                        self.assertIn("待确认" if locale == "zh" else "unconfirmed", text)
                        self.assertLessEqual(len(text.encode("utf-16-le")) // 2, budget)

    def test_blocked_submitted_run_keeps_each_evidence_failure_within_budget(self):
        failures = (
            {"evidence_delivery_status": "delivery_failed"},
            {"evidence_persistence_status": "persistence_failed"},
            {"evidence_delivery_status": "delivery_failed",
             "evidence_persistence_status": "persistence_failed"},
        )
        for evidence in failures:
            for locale in ("en", "zh"):
                for budget in (1024, 3900):
                    for intake in (False, True):
                        with self.subTest(evidence=evidence, locale=locale, budget=budget, intake=intake), patch.dict(
                                os.environ, {"QRS_UNIFIED_NOTIFICATION_ENABLED": "true"}, clear=True):
                            facts = dict(order_count=1, fill_count=1, status="alert",
                                         execution_status="order_submitted", rebalance_conclusion="blocked", **evidence)
                            source = build([candidate(**facts)], locale=locale)[0] if intake else replace(
                                payload(row(**facts)), locale=locale)
                            text = render(source, max_units=budget)
                            for marker in (("执行异常", "待确认", "已拦截") if locale == "zh" else
                                           ("Execution issue", "unconfirmed", "Blocked")):
                                self.assertIn(marker, text)
                            for axis in evidence:
                                marker = (("证据传递失败" if "delivery" in axis else "证据留存失败") if locale == "zh" else
                                          ("Evidence delivery failed" if "delivery" in axis else "Evidence persistence failed"))
                                self.assertIn(marker, text)
                            self.assertLessEqual(len(text.encode("utf-16-le")) // 2, budget)
