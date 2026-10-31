"""Offline default-off selector and daily sender safety regressions."""
import io
import json
import os
import re
import subprocess
import tempfile
import textwrap
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import daily_digest_aggregator as aggregator
import daily_digest_resend_guard as guard
from notification_mode import consolidation_enabled, routine_mode
from unified_daily_digest import render
from test_unified_daily_digest import payload, row
from test_daily_digest_ux import config
from notification_snapshot.unified_contract import NotificationEvent, select_notification_route

ON = {"QRS_UNIFIED_NOTIFICATION_ENABLED": "true"}


def candidate(run="run-a", kind="routine_cycle", **updates):
    fact = NotificationEvent(kind, datetime.fromisoformat("2026-10-16T05:50:00+08:00"),
                             platform_id="schwab", opaque_account_uid="synthetic-account", target_id="synthetic-target",
                             strategy_profile="synthetic_core", source_run_id=run,
                             order_count=0, fill_count=0)
    value = {name: getattr(fact, name) for name in
             ("platform_id", "opaque_account_uid", "target_id", "strategy_profile", "source_run_id")}
    value.update(actually_ran=True, business_day="2026-10-15", order_count=0, fill_count=0, cycle_count=1,
                 notification_event=fact.to_candidate())
    value.update(updates)
    return value


def build(rows, expected=None, **kwargs):
    with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, ON, clear=True):
        path = Path(directory) / "candidates.json"
        path.write_text(json.dumps({"runs": rows}))
        with patch.object(aggregator, "load_platform_config", return_value=config([candidate()] if expected is None else expected)):
            result = aggregator.build_digest_payload(business_day="2026-10-15", include_github=False,
                                                     candidates_path=path, **kwargs)
            receipt = aggregator.build_receipt(result[0], result[2], message_chars=len(result[1]))
            return *result, receipt


class ConsolidationSelectorTests(unittest.TestCase):
    def test_only_valid_true_maps_to_the_existing_mode(self):
        for value in (None, "", "false", "invalid", "1", "yes"):
            env = {} if value is None else {"QRS_UNIFIED_NOTIFICATION_ENABLED": value}
            self.assertFalse(consolidation_enabled(env))
            self.assertEqual(routine_mode(env), "immediate")
            self.assertEqual(routine_mode({**env, "QSL_ROUTINE_NOTIFICATION_MODE": "daily_digest"}), "daily_digest")
        self.assertEqual(routine_mode({**ON, "QSL_ROUTINE_NOTIFICATION_MODE": "immediate"}), "daily_digest")

    def test_actions_schedules_are_retired_in_every_notification_mode(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / ".github/workflows/daily-digest-notify.yml").read_text()
        job = source.split("  digest:\n", 1)[1].split("\n  maintenance-read-check:", 1)[0]
        steps = re.split(r"(?m)^      - (?:name|uses): ", job)[1:]
        script = textwrap.dedent(steps[0].split("        run: |\n", 1)[1])
        self.assertIn("QRS_UNIFIED_NOTIFICATION_ENABLED || 'false'", source)
        for value in ("", "false", "invalid", "true", " TRUE "):
            for slot in ("10 23 * * 1-5", "0 23 * * *"):
                with tempfile.TemporaryDirectory() as directory:
                    output = Path(directory) / "out"
                    env = dict(PATH=os.environ["PATH"], QRS_UNIFIED_NOTIFICATION_ENABLED=value,
                               QSL_ROUTINE_NOTIFICATION_MODE="immediate", DIGEST_EVENT_NAME="schedule",
                               DIGEST_EVENT_SCHEDULE=slot, GITHUB_OUTPUT=str(output))
                    result = subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(output.read_text(), "proceed=false\n")
        self.assertNotIn("\n  schedule:\n", source)
        self.assertIn("cancel-in-progress: false", source)

    def test_completed_sgt_window_is_used_even_for_late_manual_calls(self):
        with patch.dict(os.environ, ON, clear=True):
            for stamp, day in (("2026-10-16T21:59:00+00:00", "2026-10-15"),
                               ("2026-10-16T22:00:00+00:00", "2026-10-16"),
                               ("2026-10-17T12:00:00+00:00", "2026-10-16")):
                self.assertEqual(aggregator.resolve_business_day(now=datetime.fromisoformat(stamp)), day)
            self.assertEqual(aggregator.resolve_business_day(explicit="2026-10-10"), "2026-10-10")


class ConsolidationGuardTests(unittest.TestCase):
    def test_public_pending_receipt_round_trip_blocks_a_second_attempt(self):
        import zipfile
        from project_public_digest_receipt import project_public_receipt
        receipt = dict(schema_version="qsl.daily_digest_receipt.v1", business_day="2026-10-15",
                       report_date="2026-10-16", recipient_scope="synthetic", dry_run=False, delivered=False,
                       status="sending", window={"timezone": "Asia/Singapore", "business_day": "2026-10-15",
                                                 "window_id": "sgt-0600:2026-10-15"})
        public = project_public_receipt(receipt)
        self.assertEqual(public["status"], "sending")
        self.assertEqual(public["window"]["timezone"], "Asia/Singapore")
        self.assertEqual(public["window"]["window_id"], "sgt-0600:2026-10-15")
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("receipt-public.json", json.dumps(public))
        marker = guard._read_marker(stream.getvalue())
        env = dict(ON, GITHUB_ACTIONS="true", GITHUB_EVENT_NAME="schedule", DIGEST_RECIPIENT_SCOPE="synthetic")
        with patch.object(guard, "report_date", return_value="2026-10-16"), \
             patch.object(guard, "read_history", return_value=[(1, marker)]):
            self.assertEqual(guard.evaluate("2026-10-15", env).reason, "DELIVERY_UNCERTAIN")
            marker["status"] = "unknown"
            self.assertEqual(guard.evaluate("2026-10-15", env).reason, "DELIVERY_UNCERTAIN")

    def test_old_window_cannot_be_sent_again_on_a_later_report_date(self):
        env = dict(ON, GITHUB_ACTIONS="true", GITHUB_EVENT_NAME="workflow_dispatch", DIGEST_RECIPIENT_SCOPE="synthetic")
        receipt = dict(report_date="2026-10-16", recipient_scope="synthetic", dry_run=False,
                       delivered=True, status="delivered", business_day="2026-10-15")
        with patch.object(guard, "report_date", return_value="2026-10-17"), \
             patch.object(guard, "read_history", return_value=[(1, receipt)]):
            self.assertEqual(guard.evaluate("2026-10-15", env).decision, "skip")
        with patch.object(guard, "read_history", return_value=[]):
            self.assertEqual(guard.evaluate("2020-01-01", env).reason, "BUSINESS_WINDOW_NOT_CURRENT")
            self.assertEqual(guard.evaluate("2020-01-01", env, dry_run=True).decision, "preview")

    def test_late_reruns_language_layout_and_force_do_not_send_a_second_summary(self):
        env = dict(ON, GITHUB_ACTIONS="true", GITHUB_EVENT_NAME="workflow_dispatch",
                   DIGEST_RESEND_GUARD="false", DIGEST_FORCE_RESEND="true", DIGEST_RECIPIENT_SCOPE="synthetic")
        receipt = dict(report_date="2026-10-17", recipient_scope="synthetic", dry_run=False,
                       delivered=True, status="delivered", business_day="2026-10-15")
        with patch.object(guard, "report_date", return_value="2026-10-17"), \
             patch.object(guard, "read_history", return_value=[(1, receipt)]):
            for lang in ("zh", "en"):
                for day in ("2026-10-15", "2026-10-16", "2026-10-17"):
                    self.assertEqual(guard.evaluate(day, dict(env, DIGEST_LOCALE=lang)).decision, "skip")
            receipt.update(status="sending", delivered=False)
            self.assertEqual(guard.evaluate("2026-10-16", env).reason, "DELIVERY_UNCERTAIN")
        with patch.object(guard, "read_history", side_effect=ValueError("missing history")):
            self.assertEqual(guard.evaluate("2026-10-16", env).reason, "HISTORY_UNAVAILABLE")


class ConsolidationLanguageTests(unittest.TestCase):
    def test_utf16_budget_remains_one_message_with_both_locales(self):
        from dataclasses import replace
        item = row(block_reason=dict(reason_code="strategy_risk_rejected", order_submitted_this_run=False))
        with patch.dict(os.environ, ON, clear=True):
            for locale in ("zh", "en"):
                text = render(replace(payload(*([item] * 100)), locale=locale), max_units=256)
                self.assertLessEqual(len(text.encode("utf-16-le")) // 2, 256)
                self.assertIn("省略" if locale == "zh" else "omitted", text)

    def test_zero_runs_is_silent_but_zero_trade_runs_get_a_summary(self):
        with patch.dict(os.environ, ON, clear=True):
            self.assertEqual(render(payload()), "")
            self.assertIn("订单：0", render(payload(row())))
            self.assertIn("已收录运行 1 次", render(payload(row())))

    def test_localized_schwab_reason_is_run_scoped_and_does_not_infer_fills(self):
        from dataclasses import replace
        reason = dict(reason_code="consecutive_loss_limit_exceeded", observed_value=4, limit=3,
                      order_submitted_this_run=False)
        item = row(block_reason=reason, fill_count=None, fill_count_status="unknown", status="alert")
        with patch.dict(os.environ, ON, clear=True):
            zh = render(payload(item))
            en = render(replace(payload(item), locale="en"))
            self.assertIn("连续亏损 4 次，超过上限 3 次", zh)
            self.assertIn("本轮 0 单", zh)
            self.assertIn("成交：全窗口统计未知", zh)
            self.assertNotIn("No orders", zh)
            self.assertIn("Consecutive losses 4 exceed limit 3", en)
            self.assertIn("0 orders this run", en)
            self.assertNotRegex(en, r"[\u4e00-\u9fff]")


class ConsolidationCandidateTests(unittest.TestCase):
    def test_identity_in_event_is_bound_before_expected_target_coverage(self):
        a = candidate(order_count=2, fill_count=None)
        for name in ("opaque_account_uid", "target_id", "source_run_id", "business_day"):
            a.pop(name)
        p, text, _, receipt = build([a])
        self.assertEqual(len(p.runs), 1)
        self.assertIn("订单：2", text)
        self.assertEqual(receipt["notification_summary"]["source_inventory"]["schwab"]["covered_targets"], 1)

    def test_raw_event_counts_cannot_replace_archive_run_counters(self):
        a = candidate()["notification_event"]
        a["actually_ran"] = True
        _, text, _, receipt = build([a])
        self.assertIn("全窗口统计未知", text)
        self.assertIsNone(receipt["total_fills"])

    def test_off_intake_keeps_legacy_rows_byte_equivalent(self):
        from merge_digest_candidates import _rows
        legacy = candidate(cycle_count=2)
        legacy.pop("source_run_id")
        envelope = dict(runs=[legacy], notification_source_runs={"run-a": legacy})
        for flag in (None, "false", "invalid"):
            env = {} if flag is None else {"QRS_UNIFIED_NOTIFICATION_ENABLED": flag}
            with patch.dict(os.environ, env, clear=True):
                self.assertEqual(_rows(envelope), [legacy])

    def test_archive_resolves_raw_event_counts_in_both_input_orders(self):
        archive = candidate()
        raw = dict(archive["notification_event"], actually_ran=True)
        for rows in ([raw, archive], [archive, raw]):
            with self.subTest(raw_first=rows[0] is raw):
                p, text, _, receipt = build(rows)
                self.assertEqual(len(p.runs), 1)
                self.assertEqual(receipt["total_fills"], 0)
                self.assertFalse(receipt["notification_summary"]["counts_unknown"])
                self.assertIn("订单：0", text)
                self.assertNotIn("全窗口统计未知", text)

    def test_raw_event_cannot_clear_real_archive_conflict(self):
        archive = candidate()
        raw = dict(archive["notification_event"], actually_ran=True)
        conflict = candidate(order_count=1)
        for rows in ([raw, archive, conflict, archive], [conflict, archive, raw, archive]):
            _, _, _, receipt = build(rows)
            self.assertTrue(receipt["notification_summary"]["counts_unknown"])
            self.assertEqual(receipt["notification_summary"]["count_conflicts"], 1)
            self.assertIsNone(receipt["total_fills"])

    def test_window_aggregate_and_other_runs_events_are_rejected(self):
        from merge_digest_candidates import _rows
        missing_count = candidate()
        missing_count.pop("order_count")
        for value in (candidate(source_run_id=""), candidate(cycle_count=2), missing_count,
                      candidate(actually_ran=False),
                      candidate(order_count=True), candidate(fill_count=-1),
                      dict(candidate(), notification_events=[candidate("run-b")["notification_event"]])):
            # Do not let a singular event rescue an invalid aggregate identity.
            if value.get("source_run_id") == "":
                value.pop("notification_event")
            with self.assertRaisesRegex(ValueError, "notification_candidate"):
                build([value])
        with patch.dict(os.environ, ON, clear=True):
            with self.assertRaisesRegex(ValueError, "per_run_required"):
                _rows(dict(runs=[candidate()], source_runs={"run-a": {}}))

    def test_invalid_event_types_and_naive_time_are_rejected(self):
        for field, value in (("event_kind", 1), ("opaque_account_uid", 123),
                             ("occurred_at", "2026-10-16T05:50:00")):
            a = candidate()
            a["notification_event"][field] = value
            with self.assertRaisesRegex(ValueError, "notification_event_invalid"):
                build([a])

    def test_archive_facts_old_new_producers_and_heartbeat_count_one_run(self):
        a = candidate(order_count=2, fill_count=1)
        heartbeat = candidate(kind="healthy_heartbeat", order_count=2, fill_count=1)
        old = {name: value for name, value in a.items() if name != "notification_event"}
        p, text, collected, receipt = build([a, a, old, heartbeat, candidate("run-b", order_count=3, fill_count=2)])
        self.assertEqual(len(p.runs), 2)
        self.assertIn("订单：5", text)
        self.assertIn("成交：3", text)
        self.assertEqual(receipt["total_fills"], 3)
        self.assertEqual(collected.notification_summary["source_inventory"]["schwab"]["runs"], 2)
        self.assertEqual(len(collected.notification_summary["source_inventory"]), 6)
        self.assertIn("未纳入本期汇总，运行状态未知", text)
        self.assertNotIn("Binance：运行 0", text)

    def test_conflicting_revision_stays_unknown_and_earlier_alert_survives(self):
        a = candidate(status="alert", order_count=1, fill_count=None)
        b = candidate(order_count=2, fill_count=0)
        p, text, collected, receipt = build([a, b, b])
        self.assertEqual(len(p.runs), 1)
        self.assertEqual(p.runs[0].status, "alert")
        self.assertIsNone(p.runs[0].order_count)
        self.assertIn("全窗口统计未知", text)
        self.assertIsNone(receipt["total_fills"])
        self.assertGreater(collected.notification_summary["count_conflicts"], 0)

    def test_unknown_identity_is_never_zero_or_merged_across_accounts(self):
        a = candidate(opaque_account_uid="")
        a["notification_event"]["opaque_account_uid"] = None
        for name in ("dedupe_key", "coverage_status", "order_count", "fill_count"):
            a["notification_event"].pop(name)
        p, text, _, receipt = build([a, a])
        self.assertEqual(len(p.runs), 2)
        self.assertIn("全窗口统计未知", text)
        self.assertIsNone(receipt["total_fills"])
        self.assertEqual(receipt["notification_summary"]["source_inventory"]["schwab"]["covered_targets"], 0)
        self.assertIsNone(receipt["run_count"])

    def test_zero_runs_has_no_message_but_unknown_coverage_is_retained(self):
        p, text, _, receipt = build([])
        self.assertEqual(text, "")
        self.assertEqual(len(p.runs), 0)
        self.assertEqual(receipt["evidence_status"], "evidence_unknown")
        self.assertIsNone(receipt["total_fills"])
        idle = candidate(actually_ran=False)
        idle.pop("notification_event")
        _, text, _, receipt = build([idle])
        self.assertEqual(text, "")
        self.assertEqual(receipt["evidence_status"], "verified_idle")

    def test_missing_expected_binding_is_visible_without_filling_unknown_counts(self):
        other = dict(candidate(), target_id="synthetic-other")
        _, text, _, receipt = build([candidate()], expected=[candidate(), other])
        self.assertIn("覆盖 1/2", text)
        self.assertIn("全窗口统计未知", text)
        self.assertIsNone(receipt["total_fills"])
        for expected in ([], [dict(candidate(), opaque_account_uid="")]):
            with self.assertRaisesRegex(ValueError, "digest_expected_targets"):
                build([candidate()], expected=expected)

    def test_event_timestamp_and_window_boundary_are_enforced(self):
        a = candidate()
        a["notification_event"]["occurred_at"] = "2026-10-16T06:00:00+08:00"
        for name in ("business_day", "report_date", "window_id"):
            a["notification_event"].pop(name)
        with self.assertRaisesRegex(ValueError, "window_mismatch"):
            build([a])
        a["business_day"] = "2026-10-16"
        p, text, _, receipt = build([a])
        self.assertEqual(len(p.runs), 0)
        self.assertEqual(text, "")
        self.assertEqual(len(receipt["stale_candidates"]), 1)

    def test_orders_are_routine_and_digest_counts_only_archive_facts(self):
        a = candidate(kind="order_submitted", order_count=2, fill_count=None)
        a["notification_event"]["order_execution_digest"] = "a" * 64
        a["notification_event"].pop("dedupe_key")
        a["notification_event"].pop("coverage_status")
        self.assertEqual(select_notification_route(event_kind="order_submitted", env=ON,
                                                   flag_key="QRS_UNIFIED_NOTIFICATION_ENABLED"), "digest_candidate")
        _, text, _, receipt = build([a, a])
        self.assertIn("订单：2", text)
        self.assertIn("成交：全窗口统计未知", text)
        self.assertEqual(receipt["notification_summary"]["immediate_events"], 0)
        self.assertIsNone(receipt["total_fills"])
        self.assertEqual(select_notification_route(event_kind="blocked_run", env=ON,
                                                   flag_key="QRS_UNIFIED_NOTIFICATION_ENABLED"), "immediate")

    def test_successful_fill_is_daily_but_unknown_outcome_remains_urgent(self):
        fill = candidate(kind="fill", order_count=1, fill_count=1)
        fill["notification_event"].update(order_execution_digest="b" * 64)
        for name in ("dedupe_key", "coverage_status"):
            fill["notification_event"].pop(name)
        _, text, _, receipt = build([fill, fill])
        self.assertEqual(receipt["notification_summary"]["immediate_events"], 0)
        self.assertEqual(receipt["total_fills"], 1)
        self.assertNotIn("紧急事项", text)
        _, text, _, receipt = build([fill, candidate("run-b", kind="order_status_unknown")])
        self.assertEqual(receipt["notification_summary"]["immediate_events"], 1)
        self.assertIn("紧急事项 1 项（日报留档）", text)

    def test_acknowledged_order_text_keeps_fill_uncertainty_and_independent_issues(self):
        a = candidate(order_count=1, fill_count=None, execution_status="order_submitted")
        _, zh, _, _ = build([a])
        self.assertIn("订单已提交，成交待确认", zh)
        self.assertIn("成交：全窗口统计未知", zh)
        self.assertNotIn("已成交", zh)
        _, english, _, _ = build([a], locale="en")
        self.assertIn("Orders submitted; fill confirmation pending", english)
        self.assertNotRegex(english, r"[\u4e00-\u9fff]")
        _, issue, _, _ = build([dict(a, evidence_persistence_status="persistence_failed")])
        self.assertIn("需核对，订单已提交，成交待确认", issue)
        self.assertIn("证据留存失败", issue)

    def test_verified_idle_text_does_not_apply_to_unknown_counts(self):
        _, known, _, _ = build([candidate(execution_status="no_action")])
        self.assertIn("已运行，无交易", known)
        _, unknown, _, _ = build([candidate(execution_status="no_action", fill_count=None)])
        self.assertNotIn("无交易", unknown)

    def test_observations_from_candidate_archive_and_heartbeat_count_once(self):
        counts = {"watch": 2, "opportunity_watch": 1, "taco_rebound": 0}
        a = candidate(routine_observation_counts=counts)
        archived = {key: value for key, value in a.items() if key != "notification_event"}
        heartbeat = candidate(kind="healthy_heartbeat", routine_observation_counts=counts)
        p, text, _, receipt = build([a, archived, heartbeat, a])
        self.assertEqual(len(p.runs), 1)
        self.assertEqual(p.runs[0].routine_observation_counts, counts)
        self.assertEqual(receipt["notification_summary"]["source_inventory"]["schwab"]["runs"], 1)
        self.assertEqual(receipt["notification_summary"]["immediate_events"], 0)
        self.assertEqual(receipt["total_fills"], 0)
        self.assertEqual(text.count("策略观察 2"), 1)
        self.assertIn("机会观察 1", text)
        self.assertNotIn("反弹观察", text)
        _, english, _, _ = build([a, heartbeat], locale="en")
        self.assertIn("Strategy watch 2; Opportunity watch 1", english)
        self.assertNotRegex(english, r"[\u4e00-\u9fff]")

    def test_observation_disagreement_is_sticky_unknown_without_changing_trade_counts(self):
        known = candidate(routine_observation_counts={"watch": 2})
        for other in ({"watch": 3}, {}, {"watch": None}):
            with self.subTest(other=other):
                p, text, _, receipt = build([known, candidate(routine_observation_counts=other), known])
                self.assertIsNone(p.runs[0].routine_observation_counts["watch"])
                self.assertIn("策略观察 统计待核对", text)
                self.assertEqual(receipt["total_fills"], 0)
                self.assertEqual(len(p.runs), 1)
        p, _, _, _ = build([candidate(), known, candidate()])
        self.assertEqual(p.runs[0].routine_observation_counts, {"watch": 2})

    def test_observation_contract_rejects_private_and_invalid_values(self):
        for invalid in ([], "watch", {"watch": True}, {"watch": -1}, {"watch": 1.5},
                        {"source_uri": "gs://private/report"}, {"local_path": "/private/report"},
                        {"watch": "raw exception"}):
            with self.subTest(invalid=invalid):
                with self.assertRaisesRegex(ValueError, "^routine_observation_counts_invalid$"):
                    build([candidate(routine_observation_counts=invalid)])

    def test_changed_protected_target_cannot_enter_the_summary(self):
        with self.assertRaisesRegex(ValueError, "identity_mismatch"):
            build([candidate(target_id="synthetic-unapproved")])

    def test_snapshot_bytes_match_the_pinned_qpk_contract(self):
        import hashlib
        root = Path(aggregator.__file__).parent / "notification_snapshot"
        source = json.loads((root / "source.json").read_text())
        self.assertEqual(source["commit"], "2b04882058666ebc81d1650d93fa2105ec4ba3d8")
        for name, expected in source["files"].items():
            self.assertEqual(hashlib.sha256((root / name).read_bytes()).hexdigest(), expected)


class ConsolidationDeliveryTests(unittest.TestCase):
    def test_only_confirmed_ack_is_delivered_and_intent_is_recorded_before_transport(self):
        import send_daily_digest_telegram as sender
        for ack, delivered in ((True, False), ({"ok": True}, False),
                               ({"ok": True, "result": {"message_id": True, "chat": {"id": -123}}}, False),
                               ({"ok": True, "result": {"message_id": "transport-ack:" + "a" * 64, "chat": {"id": -123}}}, False),
                               ({"ok": True, "result": {"message_id": 3, "chat": {"id": -123}}}, True),
                               ({"ok": True, "result": {"message_id": 3, "chat": {"id": -456}}}, False)):
            p, text, c, _ = build([candidate()])
            with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, ON, clear=True):
                path = Path(directory) / "receipt.json"

                def response(_request):
                    pending = json.loads(path.read_text())
                    self.assertEqual(pending["status"], "sending")
                    self.assertFalse(pending["delivered"])
                    return ack

                with patch.object(guard, "evaluate", return_value=guard.Decision("send", "FIRST_SEND")), \
                     patch.object(sender.aggregator, "build_digest_payload", return_value=(p, text, c)), \
                     patch.object(sender.maintenance.MaintenanceClient, "from_environment", return_value=None), \
                     patch.object(sender, "diagnose_telegram_route", return_value={}), \
                     patch.object(sender, "missing_delivery_requirements", return_value=[]), \
                     patch.object(sender, "resolve_telegram_token", return_value="synthetic-token"), \
                     patch.object(sender, "resolve_telegram_chat_id", return_value="-123"), \
                     patch.object(sender.maintenance, "_json", side_effect=response) as send, \
                     patch.object(sender, "send_telegram_message") as old, \
                     patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden")), \
                     redirect_stdout(io.StringIO()):
                    rc = sender.main(["--business-day", p.business_day, "--write-receipt", str(path)])
                self.assertEqual(rc, 0 if delivered else 1)
                receipt = json.loads(path.read_text())
                self.assertEqual(receipt["delivered"], delivered)
                self.assertEqual(receipt["languages"], ["zh"])
                send.assert_called_once()
                old.assert_not_called()
