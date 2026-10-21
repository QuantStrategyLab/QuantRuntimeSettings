"""Wholly synthetic notification regressions; no bundled account mapping reads."""
import copy
import contextlib
import io
import json
import math
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import daily_digest_aggregator as aggregator
import daily_digest_notify as digest
import display_names


DAY = "2026-10-15"
NAMES = {
    "platforms": {"ibkr": "Demo IBKR", "schwab": "Demo Schwab"},
    "strategies": {"synthetic_strategy": "Synthetic strategy"},
    "accounts": {"ibkr": {"canonical-demo": "Long-term demo"},
                 "schwab": {"same-alias": "Schwab demo"}},
}


def row(**updates):
    value = dict(platform_id="ibkr", strategy_profile="synthetic_strategy",
                 opaque_account_uid="synthetic-account", target_id="synthetic-target",
                 source_run_id="synthetic-run", business_day=DAY, actually_ran=True,
                 order_count=0, fill_count=0, cycle_count=1, status="ok",
                 signal_summary="no_action", rebalance_kind="no_order",
                 execution_status="ok_no_order")
    value.update(updates)
    return value


def decision(**updates):
    value = dict(reason_code="min_notional", observed_value=12.5, limit=50.0,
                 currency="USD", symbol="DEMO")
    value.update(updates)
    return value


class RoutineNotificationContractTests(unittest.TestCase):
    def setUp(self):
        self.names = mock.patch.object(display_names, "_defaults", return_value=copy.deepcopy(NAMES))
        self.names.start()
        self.addCleanup(self.names.stop)

    def render(self, rows, *, locale="zh", unified=False, layout="v1"):
        config = {"strategies": {}, "notifications": {"quant_sentinel": {"daily_digest": {
            "aggregator": {"expected_targets": rows}}}}}
        env = {"QRS_UNIFIED_NOTIFICATION_ENABLED": "true"} if unified else {}
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, env, clear=True):
            path = Path(directory) / "synthetic.json"
            path.write_text(json.dumps({"runs": rows}))
            with mock.patch.object(aggregator, "load_platform_config", return_value=config):
                return aggregator.build_digest_payload(business_day=DAY, candidates_path=path,
                    include_github=False, locale=locale, layout=layout)

    def test_producer_count_provenance_and_optional_equity_gap_do_not_warn_about_verified_noop(self):
        reasons = ("ibkr_execution_counts_projected+account_facts_equity_absent",
                   "schwab_no_submission_verified+account_facts_absent")
        for reason in reasons:
            for locale in ("zh", "en"):
                raw = row(reason_code=reason)
                before = copy.deepcopy(raw)
                payload, text, _ = self.render([raw], locale=locale)
                self.assertNotIn("⚠️", text)
                self.assertIn("无需操作" if locale == "zh" else "No action needed", text)
                self.assertEqual(raw, before)
                self.assertEqual((payload.runs[0].order_count, payload.runs[0].fill_count), (0, 0))

    def test_unknown_urgent_mixed_reasons_and_missing_counts_cannot_be_neutralized(self):
        variants = [dict(reason_code="ibkr_execution_counts_projected+"+code) for code in
                    ("real_error", "receipt_missing", "pending_reconciliation", "arbitrary", "opaque_account_uid_absent")]
        variants += [dict(reason_code="ibkr_execution_counts_projected", order_count=None),
                     dict(reason_code="schwab_no_submission_verified", status="alert"),
                     dict(reason_code="ibkr_execution_counts_projected", execution_status="reconciliation_required")]
        for updates in variants:
            _, text, _ = self.render([row(**updates)])
            self.assertIn("⚠️", text)
            self.assertNotIn("✅ 【无需操作】", text)

    def test_minimum_notional_values_survive_both_renderers_without_changing_execution_facts(self):
        for unified in (False, True):
            for locale in ("zh", "en"):
                raw = row(routine_decision=decision(), status="alert", rebalance_conclusion="blocked")
                before = copy.deepcopy(raw)
                payload, text, collected = self.render([raw], locale=locale, unified=unified)
                self.assertIn("12.5 USD", text)
                self.assertIn("50.0 USD", text)
                self.assertIn("跳过该计划" if locale == "zh" else "skip this plan", text)
                self.assertEqual(raw, before)
                self.assertEqual(payload.runs[0].status, "alert")
                self.assertEqual((payload.runs[0].order_count, payload.runs[0].fill_count), (0, 0))
                self.assertFalse(payload.runs[0].approved_gate_reasons)
                if unified:
                    baseline = self.render([row(status="alert", rebalance_conclusion="blocked")], unified=True)[2]
                    self.assertEqual(collected.notification_summary, baseline.notification_summary)

    def test_missing_amount_threshold_currency_remain_unknown_and_counts_stay_unknown(self):
        for unified in (False, True):
            for locale in ("zh", "en"):
                payload, text, _ = self.render([row(order_count=None, fill_count=None,
                    routine_decision=decision(observed_value=None, limit=None, currency=""))],
                    locale=locale, unified=unified)
                self.assertIn("未知" if locale == "zh" else "unknown", text)
                self.assertIn("币种未知" if locale == "zh" else "currency unknown", text)
                self.assertNotIn("0.0 USD", text)
                self.assertNotIn("无交易" if locale == "zh" else "No trades", text)
                self.assertIsNone(payload.runs[0].order_count)
                self.assertIsNone(payload.runs[0].fill_count)

    def test_each_plan_keeps_its_own_amount_and_duplicate_observations_are_displayed_once(self):
        first, second = decision(), decision(symbol="02834", observed_value=17.5, currency="HKD")
        for unified in (False, True):
            for locale in ("zh", "en"):
                payload, text, _ = self.render([row(routine_decision=first,
                    routine_decisions=[first, second, first])], locale=locale, unified=unified)
                self.assertEqual(text.count("12.5 USD"), 1)
                self.assertEqual(text.count("17.5 HKD"), 1)
                self.assertIn("50.0 HKD", text)
                self.assertNotIn("30.0", text)
                self.assertEqual((payload.runs[0].order_count, payload.runs[0].fill_count), (0, 0))
        for invalid in ([first, decision(observed_value=True)], "private", [first] * 101):
            self.assertEqual(digest._parse_routine_decisions(invalid), ())
        for unified in (False, True):
            for layout in ("v1", "sections_v2"):
                for locale in ("zh", "en"):
                    payload, text, _ = self.render([row(status="alert", rebalance_conclusion="blocked",
                        routine_decisions=[decision(symbol=f"DEMO{i}", observed_value=i, limit=1000) for i in range(100)])],
                        unified=unified, layout=layout, locale=locale)
                    from unified_daily_digest import _units
                    self.assertIn("具体原因未知" if locale == "zh" else "specific reason unknown", text)
                    self.assertIn("已省略" if locale == "zh" else "omitted", text)
                    self.assertLessEqual(_units(text), 3900)
                    if not unified:
                        compact = digest.render_daily_digest(payload, max_units=700)
                        self.assertLessEqual(_units(compact), 700)
                        self.assertIn("具体原因未知" if locale == "zh" else "specific reason unknown", compact)

    def test_malformed_or_contradictory_minimum_observations_never_render_as_proof(self):
        bad = [decision(observed_value=v) for v in (True, math.nan, math.inf, -1, 50, 70, 10**1000)]
        bad += [decision(limit=v) for v in (True, math.nan, math.inf, -1, 0)]
        bad += [decision(currency="private account"), decision(symbol="<private>"), decision(reason_code="risk_rejected")]
        for value in bad:
            self.assertIsNone(digest._parse_routine_decision(value))
        # A plan observation cannot clear an urgent status or contradict counts.
        payload, text, _ = self.render([row(status="alert", order_count=1, fill_count=1,
            execution_status="reconciliation_required", routine_decision=decision())])
        self.assertIn("⚠️", text)
        self.assertEqual((payload.runs[0].order_count, payload.runs[0].fill_count), (1, 1))

    def test_legacy_sender_reserves_reminder_budget_and_uses_one_mock_send(self):
        import send_daily_digest_telegram as sender
        from test_credential_maintenance_notify import ENV, META
        payload, text, collected = self.render([row(status="alert", rebalance_conclusion="blocked",
            routine_decisions=[decision(symbol=f"DEMO{i}", observed_value=i, limit=1000) for i in range(100)])])
        client = sender.maintenance.MaintenanceClient.from_environment(ENV)
        route = dict(token_source_kind="env", chat_source_kind="env", warnings=[], missing=[],
                     token_alias_used=None, chat_alias_used=None, secret_name_contract="synthetic-name")
        responses = [META, dict(granted=True, claim_id="synthetic-claim", phase="7", delivery="reserved"),
                     dict(phase="7", delivery="delivered")]
        with mock.patch.dict(os.environ, ENV, clear=True), \
             mock.patch.object(sender.resend_guard, "evaluate", return_value=sender.resend_guard.Decision("send", "FIRST_SEND")), \
             mock.patch.object(sender.maintenance.MaintenanceClient, "from_environment", return_value=client), \
             mock.patch.object(client, "_request", side_effect=responses), \
             mock.patch.object(sender.aggregator, "build_digest_payload", return_value=(payload, text, collected)), \
             mock.patch.object(sender, "diagnose_telegram_route", return_value=route), \
             mock.patch.object(sender, "missing_delivery_requirements", return_value=[]), \
             mock.patch.object(sender, "resolve_telegram_token", return_value="synthetic-token"), \
             mock.patch.object(sender, "resolve_telegram_chat_id", return_value="-123"), \
             mock.patch.object(sender.maintenance, "send_strict_telegram", return_value=True) as send, \
             mock.patch.object(sender, "send_telegram_message") as legacy, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(sender.main(["--no-github"]), 0)
        self.assertEqual(send.call_count, 1)
        legacy.assert_not_called()
        from unified_daily_digest import _units
        combined = send.call_args.kwargs["text"]
        self.assertLessEqual(_units(combined), 3900)
        self.assertIn("具体原因未知", combined)
        self.assertIn("IBKR Flex", combined)

    def test_trusted_same_platform_alias_wins_over_masked_hint_without_becoming_identity(self):
        for unified in (False, True):
            payload, text, _ = self.render([row(account_alias="canonical-demo", account_hint="masked-demo")], unified=unified)
            self.assertIn("Long-term demo", text)
            for private in ("canonical-demo", "masked-demo", "synthetic-account", "synthetic-target"):
                self.assertNotIn(private, text)
            self.assertEqual(payload.runs[0].opaque_account_uid, "synthetic-account")

    def test_alias_unknown_cross_platform_unsafe_and_collisions_keep_safe_fallback(self):
        from unified_daily_digest import _run_display_labels, _safe_display_text
        for alias in ("unmapped-demo", "same-alias"):
            _, text, _ = self.render([row(account_alias=alias)])
            self.assertNotIn(alias, text)
            self.assertNotIn("Schwab demo", text)
        for unsafe in ("U00000001", "DU00000001", "IBKR_U00000001", "DU00000001_main",
                       "账户U00000001", "1", "1234", "00000001", "https://private.invalid", "0123456789abcdef"):
            with mock.patch.object(display_names, "_defaults", return_value={
                    **NAMES, "accounts": {"ibkr": {"unsafe-demo": unsafe}}}):
                _, text, _ = self.render([row(account_alias="unsafe-demo")])
                self.assertEqual(_safe_display_text(unsafe), "")
                self.assertNotIn(f" / {unsafe} / ", text)
                self.assertIn(" / 账户 / ", text)
        entries = digest.filter_runs_for_digest([row(account_alias="canonical-demo"),
            row(account_alias="canonical-demo", opaque_account_uid="another-synthetic-account", target_id="another-target")])
        labels = _run_display_labels(entries, "en")
        self.assertIn("Long-term demo 1", labels[0])
        self.assertIn("Long-term demo 2", labels[1])

    def test_exact_reconciliation_token_is_present_once_without_clearing_alert(self):
        for locale in ("zh", "en"):
            raw = row(platform_id="schwab", status="alert", signal_summary="reconciliation_required",
                rebalance_conclusion="reconciliation_required", rebalance_kind="pending",
                execution_status="reconciliation_required", order_count=None, fill_count=None,
                reason_code="schwab_fills_not_connected")
            payload, text, _ = self.render([raw], locale=locale)
            self.assertEqual(text.count("需对账" if locale == "zh" else "Reconciliation required"), 1)
            self.assertIn("⚠️", text)
            self.assertIn("未接入统计" if locale == "zh" else "not connected", text)
            self.assertEqual(payload.runs[0].execution_status, "reconciliation_required")

    def test_missing_statistics_do_not_create_reconciliation_and_free_form_details_survive(self):
        raw = row(platform_id="schwab", order_count=None, fill_count=None, reason_code="schwab_fills_not_connected")
        _, text, _ = self.render([raw])
        self.assertNotIn("需对账", text)
        raw.update(status="alert", signal_summary="reconciliation_required",
                   rebalance_conclusion="Synthetic pending order requires broker confirmation")
        _, text, _ = self.render([raw], locale="en")
        self.assertIn("Reconciliation required", text)
        self.assertIn("Synthetic pending order requires broker confirmation", text)


if __name__ == "__main__":
    unittest.main()
