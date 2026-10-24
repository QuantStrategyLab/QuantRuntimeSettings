"""Active legacy presentation regressions; all values and identities are synthetic."""
import copy
from dataclasses import asdict, replace
from datetime import datetime, timedelta
import json
import math
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import daily_digest_aggregator as aggregator
import daily_digest_notify as digest
from test_daily_digest_ux import config
from test_notification_approved_gates import CONSECUTIVE, DAILY, gate
from notification_candidate_adapter import _event
from notification_snapshot.unified_contract import NotificationEvent


def row(**updates):
    value = dict(platform_id="ibkr", strategy_profile="tqqq_growth_income",
                 target_id="synthetic-target", opaque_account_uid="synthetic-account",
                 account_hint="U00000001", business_day="2026-10-15", actually_ran=True,
                 order_count=0, fill_count=0, cycle_count=1, status="ok",
                 signal_summary="no_action", rebalance_kind="no_order")
    value.update(updates)
    return value


def render(rows, locale="zh"):
    with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {}, clear=True):
        path = Path(directory) / "candidates.json"
        path.write_text(json.dumps({"runs": rows}))
        with mock.patch.object(aggregator, "load_platform_config", return_value=config(rows)):
            return aggregator.build_digest_payload(business_day="2026-10-15", locale=locale,
                layout="v1", candidates_path=path, include_github=False)


class LegacyDigestPresentationTests(unittest.TestCase):
    def test_alert_no_rebalance_shows_one_decision_and_honest_missing_reason(self):
        for locale, token in (("zh", "无需调仓"), ("en", "No rebalance")):
            _, text, _ = render([row(status="alert", rebalance_kind="no_rebalance",
                                      signal_summary="no_rebalance", rebalance_conclusion="no_rebalance")], locale)
            self.assertIn("需核对" if locale == "zh" else "Needs review", text)
            self.assertEqual(text.count(token), 1)
            self.assertIn("具体原因未随候选提供" if locale == "zh" else
                          "Candidate did not provide a displayable reason", text)

    def test_verified_zero_noop_is_neutral_without_redundant_signal_or_platform_footer(self):
        for locale in ("zh", "en"):
            payload, text, _ = render([row()], locale)
            self.assertIn("无需操作" if locale == "zh" else "No action needed", text)
            self.assertNotIn("⚠️", text)
            self.assertNotIn("🎯", text)
            self.assertNotIn("平台:" if locale == "zh" else "Platform:", text)
            self.assertEqual(text.count("无交易" if locale == "zh" else "No trades"), 1)
            self.assertIn("纳斯达克增长收益" if locale == "zh" else "NASDAQ Growth Income", text)
            self.assertNotIn("U00000001", text)
            self.assertEqual((payload.runs[0].order_count, payload.runs[0].fill_count), (0, 0))

    def test_unknown_alert_missing_receipt_and_threshold_states_are_never_neutral(self):
        variants = [dict(status="alert"), dict(status="alert", rebalance_kind="pending"),
            dict(order_count=None), dict(fill_count=None),
            dict(cycle_count=None), dict(reason_code="receipt_missing"),
            dict(missing_evidence_reason="EVIDENCE_UNREADABLE"),
            dict(execution_status="pending_reconciliation"), dict(reason_code="real_error"),
            dict(rebalance_conclusion="blocked"),
            dict(rebalance_conclusion="No order: minimum order threshold not met")]
        for locale in ("zh", "en"):
            for updates in variants:
                with self.subTest(locale=locale, updates=updates):
                    _, text, _ = render([row(**updates)], locale)
                    self.assertNotIn("✅ 【无需操作】" if locale == "zh" else "✅ [No action needed]", text)
                    self.assertIn("⚠️", text)
        _, text, _ = render([row(rebalance_kind="pending", signal_summary="submitted")])
        self.assertIn("待确认", text)
        self.assertNotIn("无需操作", text)

    def test_validated_gate_details_reach_legacy_without_changing_counts_or_block_status(self):
        for reasons in ([DAILY], [CONSECUTIVE], [CONSECUTIVE, DAILY]):
            for locale in ("zh", "en"):
                raw = gate(reasons)
                raw.update(signal_summary="blocked", rebalance_kind="no_order")
                before = copy.deepcopy(raw)
                payload, text, _ = render([raw], locale)
                self.assertIn("⚠️", text)
                for reason in reasons:
                    self.assertIn("6>5" if reason == CONSECUTIVE else ("80≥60" if locale == "zh" else "80>=60"), text)
                if DAILY in reasons:
                    self.assertIn("USD", text)
                self.assertEqual(raw, before)
                self.assertEqual(payload.runs[0].status, "alert")
                self.assertEqual(payload.runs[0].order_count, 0)

    def test_invalid_or_cross_run_gate_proof_stays_blocked_with_unknown_reason(self):
        for mutation in ("cross_run", "urgent", "nonfinite", "positive_order", "forged_validated"):
            raw = gate([DAILY])
            raw.update(signal_summary="blocked", rebalance_kind="no_order")
            if mutation == "cross_run":
                raw["notification_event"]["source_run_id"] = "another-run"
            if mutation == "urgent":
                raw["notification_event"]["event_kind"] = "real_error"
            if mutation == "nonfinite":
                raw["approved_gate_reasons"][0]["observed_value"] = math.nan
            if mutation == "positive_order":
                raw["order_count"] = 1
            if mutation == "forged_validated":
                raw.pop("approved_gate_reasons")
                raw["_validated_approved_gate_reasons"] = [DAILY]
            for locale in ("zh", "en"):
                with self.subTest(mutation=mutation, locale=locale):
                    _, text, _ = render([raw], locale)
                    self.assertIn("具体原因未知" if locale == "zh" else "specific reason unknown", text)
                    self.assertIn("⚠️", text)
                    self.assertNotIn("80≥60", text)
                    self.assertNotIn("80>=60", text)

    def test_unconnected_counts_and_missing_reason_are_explicit_not_zero(self):
        for locale in ("zh", "en"):
            payload, text, _ = render([row(platform_id="schwab", signal_summary="blocked",
                order_count=None, fill_count=None, reason_code="schwab_fills_not_connected")], locale)
            self.assertIn("具体原因未知" if locale == "zh" else "specific reason unknown", text)
            self.assertIn("未接入统计" if locale == "zh" else "not connected", text)
            self.assertNotIn("无交易" if locale == "zh" else "No trades", text)
            self.assertIsNone(payload.runs[0].order_count)
            self.assertIsNone(payload.runs[0].fill_count)

    def test_safe_context_distinguishes_two_accounts_without_private_identity_fallback(self):
        rows = [row(), row(account_hint="U00000002", opaque_account_uid="another-private-account",
                           target_id="another-private-target")]
        _, text, _ = render(rows, "en")
        self.assertIn("Account 1", text)
        self.assertIn("Account 2", text)
        for private in ("U00000001", "U00000002", "another-private-account", "another-private-target"):
            self.assertNotIn(private, text)
        self.assertEqual(text.count("NASDAQ Growth Income"), 2)

    def test_nonfinite_numeric_helpers_use_localized_unknown_and_preserve_finite_format(self):
        for locale in ("zh", "en"):
            unknown = "未知" if locale == "zh" else "unknown"
            for value in (None, math.nan, math.inf, -math.inf, True):
                for formatter in (digest._format_money, digest._format_equity):
                    self.assertIn(unknown, formatter(value, locale=locale))
                if value is not None:
                    self.assertIn(unknown, digest._format_qty(value, locale=locale))
            self.assertEqual(digest._format_money(1234.5, locale=locale), "$1,234.50")
            self.assertEqual(digest._format_equity(1234.5, currency="SGD", locale=locale), "SGD 1,234.50")
            self.assertEqual(digest._format_qty(1.23456789, locale=locale), "1.234568")
            self.assertEqual(digest._format_qty(4, locale=locale), "4")

    def test_rendered_nonfinite_values_are_unknown_without_nan_inf_or_fake_zero(self):
        for locale in ("zh", "en"):
            _, text, _ = render([row(equity=math.nan, holdings=[dict(symbol="SYNTH", quantity=math.inf,
                market_value=math.nan)])], locale)
            self.assertIn("未知" if locale == "zh" else "unknown", text)
            self.assertNotIn("nan", text.lower())
            self.assertNotIn("inf", text.lower())
            self.assertNotIn("USD 0.00", text)
            self.assertNotIn("$0.00", text)

    def test_nested_urgent_events_and_failed_axes_cannot_be_green(self):
        variants = []
        for kind in ("real_error", "receipt_missing", "order_status_unknown"):
            raw = row(source_run_id="synthetic-run")
            raw["notification_event"] = NotificationEvent(kind,
                datetime.fromisoformat("2026-10-16T05:50:00+08:00"),
                **{key: raw[key] for key in ("platform_id", "opaque_account_uid", "target_id",
                                             "strategy_profile", "source_run_id")}).to_candidate()
            variants.append(raw)
        for key, values in (("evidence_persistence_status", ("persistence_failed", "unknown")),
                            ("evidence_delivery_status", ("delivery_failed", "pending_central", "unknown"))):
            variants.extend(row(**{key: value}) for value in values)
        for locale in ("zh", "en"):
            for raw in variants:
                with self.subTest(locale=locale, raw=raw):
                    before = copy.deepcopy(raw)
                    payload, text, _ = render([raw], locale)
                    self.assertEqual(raw, before)
                    self.assertIn("⚠️", text)
                    self.assertNotIn("✅ 【无需操作】" if locale == "zh" else "✅ [No action needed]", text)
                    self.assertEqual(payload.runs[0].status, "ok")
                    self.assertNotIn("presentation_attention", asdict(payload.runs[0]))
                    self.assertNotIn("_presentation_attention", asdict(payload.runs[0]))
        raw = copy.deepcopy(variants[0])
        raw.pop("source_run_id")
        before = copy.deepcopy(raw)
        self.assertTrue(digest._legacy_presentation_attention(raw))
        self.assertEqual(raw, before)

    def test_gate_event_from_another_business_window_is_not_display_authority(self):
        raw = gate([DAILY])
        event = _event(raw["notification_event"])
        raw["notification_event"].update(replace(event, occurred_at=event.occurred_at-timedelta(days=1)).to_candidate())
        raw.update(signal_summary="blocked", rebalance_kind="no_order")
        for locale in ("zh", "en"):
            _, text, _ = render([raw], locale)
            self.assertIn("具体原因未知" if locale == "zh" else "specific reason unknown", text)
            self.assertNotIn("80≥60", text)
            self.assertNotIn("80>=60", text)

    def test_boolean_values_are_rejected_before_coercion_can_invent_numbers(self):
        for locale in ("zh", "en"):
            _, text, _ = render([row(equity=True, holdings=[dict(symbol="SYNTH", quantity=True,
                market_value=False)])], locale)
            self.assertGreaterEqual(text.count("未知" if locale == "zh" else "unknown"), 3)
            for fake in ("USD 1.00", "$0.00", "1股", "1sh"):
                self.assertNotIn(fake, text)
            payload, text, _ = render([row(order_count=False, fill_count=False)], locale)
            self.assertIsNone(payload.runs[0].order_count)
            self.assertIsNone(payload.runs[0].fill_count)
            self.assertNotIn("无交易" if locale == "zh" else "No trades", text)
            self.assertIn("⚠️", text)

    def test_canonical_ok_no_order_execution_status_is_neutral(self):
        for locale in ("zh", "en"):
            _, text, _ = render([row(execution_status="ok_no_order")], locale)
            self.assertIn("✅ 【无需操作】" if locale == "zh" else "✅ [No action needed]", text)
            self.assertNotIn("⚠️", text)

    def test_incomplete_nested_event_identity_cannot_be_green(self):
        raw = row(source_run_id="synthetic-run")
        identity = {key: raw[key] for key in ("platform_id", "opaque_account_uid", "target_id",
                                              "strategy_profile", "source_run_id")}
        identity["opaque_account_uid"] = None
        raw["notification_event"] = NotificationEvent("routine_cycle",
            datetime.fromisoformat("2026-10-16T05:50:00+08:00"), **identity).to_candidate()
        before = copy.deepcopy(raw)
        for locale in ("zh", "en"):
            payload, text, _ = render([raw], locale)
            self.assertIn("⚠️", text)
            self.assertNotIn("✅ 【无需操作】" if locale == "zh" else "✅ [No action needed]", text)
            self.assertEqual(payload.runs[0].status, "ok")
            self.assertEqual(raw, before)


if __name__ == "__main__":
    unittest.main()
