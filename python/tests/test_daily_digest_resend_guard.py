"""Offline resend decisions, public history transport, and sender integration."""
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import daily_digest_resend_guard as guard
import send_daily_digest_telegram as sender
import project_public_digest_receipt as public
from test_daily_digest_ux import DAY, fixture, config


def environment(event="schedule", **extra):
    return {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "example/demo",
            "GITHUB_API_URL": "https://api.example.invalid", "GITHUB_RUN_ID": "100",
            "GITHUB_RUN_ATTEMPT": "1", "GITHUB_EVENT_NAME": event,
            "GITHUB_WORKFLOW_REF": "example/demo/.github/workflows/digest.yml@refs/heads/main",
            "DIGEST_GUARD_TOKEN": "synthetic-token", **extra}


def sent(**extra):
    return {"business_day": DAY, "delivered": True, "dry_run": False, "status": "delivered", **extra}


class DailyDigestResendGuardTests(unittest.TestCase):
    def decision(self, history=(), event="schedule", force=False, **kwargs):
        with mock.patch.object(guard, "read_history", return_value=list(history)):
            return guard.evaluate(DAY, environment(event, DIGEST_FORCE_RESEND=str(force).lower()), **kwargs)

    def test_scheduled_first_send(self):
        result = self.decision()
        self.assertEqual((result.decision, result.reason), ("send", "FIRST_SEND"))
        print(result.log(DAY, "schedule"))

    def test_scheduled_duplicate_skipped_even_if_prior_workflow_failed(self):
        result = self.decision([(90, sent())])
        self.assertEqual((result.decision, result.reason), ("skip", "ALREADY_DELIVERED"))
        print(result.log(DAY, "schedule"))

    def test_manual_without_flag_skipped(self):
        result = self.decision([(90, sent())], event="workflow_dispatch")
        self.assertEqual(result.decision, "skip")
        print(result.log(DAY, "workflow_dispatch"))

    def test_manual_with_flag_sent_and_labelled_test_both_locales(self):
        result = self.decision([(90, sent())], event="workflow_dispatch", force=True)
        self.assertEqual(result.decision, "send")
        self.assertTrue(result.test_message)
        for locale, label in (("zh-CN", "【测试】"), ("en", "[TEST]")):
            with self.subTest(locale=locale):
                self.assertTrue(sender.digest.label_delivery_text("demo", locale, test=result.test_message).startswith(label + "\n"))
        print(result.log(DAY, "workflow_dispatch"))

    def test_schedule_cannot_force_and_tests_do_not_block_a_normal_digest(self):
        self.assertEqual(self.decision([(90, sent())], force=True).decision, "skip")
        self.assertEqual(self.decision([(90, sent(test_message=True))]).decision, "send")
        self.assertEqual(self.decision([(90, sent(dry_run=True))]).decision, "send")
        self.assertEqual(self.decision([(90, sent(business_day="2026-10-13"))]).decision, "send")

    def test_detection_failure_is_closed_for_schedule_and_unforced_manual(self):
        for event in ("schedule", "workflow_dispatch"):
            with self.subTest(event=event), mock.patch.object(guard, "read_history", side_effect=RuntimeError("private error")):
                result = guard.evaluate(DAY, environment(event))
                self.assertEqual((result.decision, result.reason), ("blocked", "HISTORY_UNAVAILABLE"))
                self.assertNotIn("private", result.log(DAY, event))

    def test_transient_history_failure_retries_reads_without_sending(self):
        import urllib.error
        with mock.patch.object(guard, "read_history", side_effect=[urllib.error.URLError("private"), []]) as read, \
             mock.patch.object(guard.time, "sleep") as sleep:
            result = guard.evaluate(DAY, environment(DIGEST_GUARD_RETRY_DELAY_SECONDS="1"))
        self.assertEqual(result.decision, "send")
        self.assertEqual(read.call_count, 2)
        sleep.assert_called_once_with(1)

    def test_exhausted_history_retries_expose_only_safe_diagnostics(self):
        import urllib.error
        with mock.patch.object(guard, "read_history", side_effect=urllib.error.URLError("private-token-url")) as read, \
             mock.patch.object(guard.time, "sleep"):
            result = guard.evaluate(DAY, environment(DIGEST_GUARD_READ_ATTEMPTS="2"))
        self.assertEqual(read.call_count, 2)
        self.assertEqual(result.reason, "HISTORY_UNAVAILABLE")
        self.assertEqual(result.history_error, "guard_transport_unavailable")
        self.assertEqual(result.history_attempts, 2)
        self.assertNotIn("private", json.dumps(result.to_dict()))
        projected = public.project_public_receipt(guard.skip_receipt(DAY, "zh", result))
        self.assertEqual(projected["resend_guard"]["history_error"], result.history_error)
        self.assertEqual(projected["resend_guard"]["history_attempts"], 2)

    def test_invalid_history_and_retry_configuration_do_not_repeat(self):
        with mock.patch.object(guard, "read_history", side_effect=ValueError("guard_marker_invalid")) as read, \
             mock.patch.object(guard.time, "sleep") as sleep:
            result = guard.evaluate(DAY, environment())
        self.assertEqual(read.call_count, 1)
        sleep.assert_not_called()
        self.assertEqual(result.history_error, "guard_marker_invalid")
        for value in ("0", "6", "bad"):
            with mock.patch.object(guard, "read_history") as read:
                result = guard.evaluate(DAY, environment(DIGEST_GUARD_READ_ATTEMPTS=value))
            self.assertEqual(result.reason, "CONFIGURATION_INVALID")
            read.assert_not_called()

    def test_blocked_history_has_urgent_day_pinned_unforced_retry(self):
        notice = guard.recovery_notice(DAY, environment())
        self.assertIn("URGENT", notice)
        self.assertIn("business_day=" + DAY, notice)
        self.assertIn("force_resend=false", notice)
        self.assertIn("dry_run=false", notice)
        self.assertNotIn("synthetic-token", notice)

    def test_workflow_summary_executes_urgent_recovery_for_blocked_history(self):
        from test_daily_digest_store_workflow import workflow_body
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            receipt = root / "data/output/daily-digest/receipt-public.json"
            receipt.parent.mkdir(parents=True)
            receipt.write_text(json.dumps(public.project_public_receipt(guard.skip_receipt(
                DAY, "zh", guard.Decision("blocked", "HISTORY_UNAVAILABLE",
                                         history_error="guard_marker_invalid", history_attempts=1)))))
            summary = root / "summary.md"
            env = {"PATH": os.environ["PATH"], "GITHUB_STEP_SUMMARY": str(summary),
                   "PYTHONPATH": str(Path(guard.__file__).parent), **environment()}
            result = subprocess.run(["bash", "-c", workflow_body("Summarize (no secrets)")],
                                    cwd=root, env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            text = summary.read_text()
            self.assertIn("URGENT", text)
            self.assertIn("business_day=" + DAY, text)
            self.assertIn("force_resend=false", text)
            self.assertIn("guard_marker_invalid", text)
            self.assertNotIn("synthetic-token", text)

    def test_unknown_delivery_is_not_retried(self):
        result = self.decision([(90, sent(delivered=False, status="send_failed"))])
        self.assertEqual((result.decision, result.reason), ("blocked", "DELIVERY_UNCERTAIN"))

    def test_any_confirmed_delivery_skips_regardless_of_history_order(self):
        history = [(90, sent()), (91, sent(delivered=False, status="send_failed"))]
        for rows in (history, list(reversed(history))):
            self.assertEqual(self.decision(rows).decision, "skip")

    def test_preview_is_offline_and_invalid_flags_fail_closed(self):
        with mock.patch.object(guard, "read_history") as read:
            self.assertEqual(guard.evaluate(DAY, environment(), dry_run=True).decision, "preview")
            read.assert_not_called()
        self.assertEqual(guard.evaluate(DAY, environment(DIGEST_FORCE_RESEND="invalid")).decision, "blocked")

    def test_unresolved_failure_surfaces_in_next_digest_in_both_languages(self):
        history = [(90, {"business_day": "2026-10-13", "status": "blocked_resend_guard", "delivered": False})]
        result = self.decision(history)
        self.assertEqual(result.previous_failures, 1)
        for locale, phrase in (("zh", "无法确认发送记录"), ("en", "send history could not be verified")):
            self.assertIn(phrase, sender.digest.label_delivery_text("demo", locale, previous_failures=result.previous_failures))
        self.assertEqual(self.decision(history + [(91, sent())]).previous_failures, 0)

    def test_sender_skips_before_credentials_maintenance_or_any_send(self):
        for decision, locale in ((decision, locale) for locale in ("zh", "en") for decision in
                                 (guard.Decision("skip", "ALREADY_DELIVERED"), guard.Decision("blocked", "HISTORY_UNAVAILABLE"))):
            with self.subTest(decision=decision, locale=locale), tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, environment(), clear=True), \
                 mock.patch.object(sender.resend_guard, "evaluate", return_value=decision), \
                 mock.patch.object(sender, "diagnose_telegram_route") as route, \
                 mock.patch.object(sender.maintenance.MaintenanceClient, "from_environment") as maintenance, \
                 mock.patch.object(sender, "send_telegram_message") as send, redirect_stdout(io.StringIO()):
                path = Path(tmp) / "receipt.json"
                code = sender.main(["--business-day", DAY, "--locale", locale, "--write-receipt", str(path)])
                receipt = public.project_public_receipt(json.loads(path.read_text()))
                self.assertEqual(code, 0 if decision.decision == "skip" else 1)
                self.assertFalse(receipt["delivered"])
                self.assertEqual(receipt["resend_guard"]["decision"], decision.decision)
                route.assert_not_called(); maintenance.assert_not_called(); send.assert_not_called()

    def test_early_workflow_gate_keeps_duplicate_success_and_exposes_detection_failure(self):
        for decision in (guard.Decision("skip", "ALREADY_DELIVERED"), guard.Decision("blocked", "HISTORY_UNAVAILABLE")):
            with self.subTest(decision=decision), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp)
                with mock.patch.dict(os.environ, environment(DIGEST_BUSINESS_DAY=DAY, GITHUB_OUTPUT=str(path / "outputs")), clear=True), \
                     mock.patch.object(guard, "evaluate", return_value=decision), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()) as errors:
                    code = guard.main(["--write-receipt", str(path / "receipt.json")])
                self.assertEqual(code, 0 if decision.decision == "skip" else 1)
                self.assertEqual((path / "outputs").read_text(), "proceed=false\n")
                if decision.decision == "blocked":
                    self.assertIn("::error::URGENT", errors.getvalue())
                self.assertFalse(json.loads((path / "receipt.json").read_text())["delivered"])
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/daily-digest-notify.yml").read_text()
        self.assertLess(workflow.index("id: resend_guard"), workflow.index("id: candidates"))
        self.assertNotIn("actions: read", workflow)
        self.assertNotIn("\n  schedule:\n", workflow)
        self.assertNotIn("secrets.TELEGRAM_TOKEN", workflow.split("  maintenance-read-check:", 1)[0])
        self.assertFalse((Path(__file__).resolve().parents[2] / "docs/workflows/daily-digest-notify.yml").exists())

    def test_sender_sends_labelled_test_and_projects_only_safe_guard_fields(self):
        for locale, label in (("zh", "【测试】"), ("en", "[TEST]")):
            with self.subTest(locale=locale), tempfile.TemporaryDirectory() as tmp, \
                 mock.patch.dict(os.environ, environment("workflow_dispatch", DIGEST_FORCE_RESEND="true"), clear=True), \
                 mock.patch.object(sender.aggregator, "load_platform_config", return_value=config()), \
                 mock.patch.object(sender, "diagnose_telegram_route", return_value={"secret_name_contract": "synthetic", "warnings": []}), \
                 mock.patch.object(sender, "missing_delivery_requirements", return_value=[]), \
                 mock.patch.object(sender, "resolve_telegram_token", return_value="synthetic-token"), \
                 mock.patch.object(sender, "resolve_telegram_chat_id", return_value="synthetic-chat"), \
                 mock.patch.object(sender, "send_telegram_message", return_value=True) as send, redirect_stdout(io.StringIO()):
                path = Path(tmp) / "candidates.json"
                receipt_path = Path(tmp) / "receipt.json"
                path.write_text(json.dumps({"runs": fixture()[:1]}))
                code = sender.main(["--no-github", "--business-day", DAY, "--locale", locale,
                                    "--candidates", str(path), "--write-receipt", str(receipt_path)])
                self.assertEqual(code, 0)
                self.assertTrue(send.call_args.kwargs["text"].startswith(label + "\n"))
                receipt = public.project_public_receipt(json.loads(receipt_path.read_text()))
                self.assertTrue(receipt["test_message"])
                self.assertNotIn("synthetic-token", json.dumps(receipt))


class DailyDigestHistoryTests(unittest.TestCase):
    def setUp(self):
        self.env = environment()
        self.run = {"id": 90, "status": "completed", "conclusion": "failure", "event": "schedule",
                    "created_at": DAY + "T22:00:00Z"}

    def archive(self, payload):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as z:
            z.writestr("receipt-public.json", json.dumps(payload))
        return data.getvalue()

    def transport(self, route, token, **kwargs):
        if "/workflows/" in route:
            return {"total_count": 2, "workflow_runs": [self.run, {"id": 100}]}
        if route.endswith("/artifacts?per_page=100&page=1"):
            return {"total_count": 1, "artifacts": [{"id": 4, "name": "daily-digest-receipt", "expired": False}]}
        if route.endswith("/4/zip"):
            return self.archive(sent())
        raise AssertionError(route)

    def test_reads_delivered_marker_from_failed_run_with_current_run_excluded(self):
        with mock.patch.object(guard, "api_get", side_effect=self.transport):
            self.assertEqual(guard.read_history(DAY, self.env), [(90, sent())])

    def test_expired_missing_malformed_or_truncated_history_blocks(self):
        for mode in ("expired", "missing", "malformed", "truncated"):
            def transport(route, token, **kwargs):
                if mode == "truncated" and "/workflows/" in route:
                    return {"total_count": 10001, "workflow_runs": [self.run] * 100}
                if "/jobs?" in route:
                    return {"total_count": 1, "jobs": [{"steps": [{"name": "Aggregate, render, and send daily digest", "conclusion": "success"}]}]}
                value = self.transport(route, token, **kwargs)
                if "/artifacts?" in route:
                    return {"total_count": 0, "artifacts": []} if mode == "missing" else {
                        "total_count": 1, "artifacts": [{"id": 4, "name": "daily-digest-receipt", "expired": mode == "expired"}]}
                if route.endswith("/zip") and mode == "malformed":
                    return b"invalid zip"
                return value
            with self.subTest(mode=mode), mock.patch.object(guard, "api_get", side_effect=transport):
                self.assertEqual(guard.evaluate(DAY, self.env).decision, "blocked")

    def test_pagination_reads_a_delivery_after_the_first_page(self):
        calls = []
        def transport(route, token, **kwargs):
            calls.append(route)
            if "/workflows/" in route and route.endswith("&page=1"):
                return {"total_count": 101, "workflow_runs": [dict(self.run, id=i, event="push") for i in range(200, 300)]}
            if "/workflows/" in route:
                return {"total_count": 101, "workflow_runs": [self.run]}
            return self.transport(route, token, **kwargs)
        with mock.patch.object(guard, "api_get", side_effect=transport):
            self.assertEqual(guard.evaluate(DAY, self.env).decision, "skip")
        self.assertTrue(any("page=2" in url for url in calls))

    def test_marker_without_delivery_day_and_oversized_zip_members_are_rejected(self):
        for receipt in (sent(business_day=None), sent(test_message="false")):
            with self.subTest(receipt=receipt), self.assertRaises(ValueError):
                guard._read_marker(self.archive(receipt))
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as z:
            z.writestr("../receipt-public.json", json.dumps(sent()))
        with self.assertRaises(ValueError):
            guard._read_marker(data.getvalue())
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as z:
            z.writestr("receipt-public.json", "x" * 65537)
        with self.assertRaises(ValueError):
            guard._read_marker(data.getvalue())

    def test_legacy_receipt_projects_only_delivery_fields_and_blocks_duplicates(self):
        legacy = {**sent(), "schema_version": "qsl.daily_digest_receipt.v1", "account": "private-row"}
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("receipt.json", json.dumps(legacy))
        marker = guard._read_marker(data.getvalue())
        self.assertEqual(marker["business_day"], DAY)
        self.assertNotIn("private-row", json.dumps(marker))
        def transport(route, token, **kwargs):
            return data.getvalue() if route.endswith("/zip") else self.transport(route, token, **kwargs)
        with mock.patch.object(guard, "api_get", side_effect=transport):
            self.assertEqual(guard.evaluate(DAY, self.env).decision, "skip")
        legacy["business_day"] = "2026-10-12"
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("receipt.json", json.dumps(legacy))
        with mock.patch.object(guard, "api_get", side_effect=transport):
            self.assertEqual(guard.evaluate(DAY, self.env).decision, "send")

    def test_legacy_filename_is_configurable_and_malformed_legacy_stays_blocked(self):
        for receipt in (sent(), {**sent(), "schema_version": "qsl.daily_digest_receipt.v1", "dry_run": "false"}):
            data = io.BytesIO()
            with zipfile.ZipFile(data, "w") as archive:
                archive.writestr("receipt.json", json.dumps(receipt))
            with self.assertRaises(ValueError):
                guard._read_marker(data.getvalue())
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("old-marker.json", json.dumps({**sent(), "schema_version": "qsl.daily_digest_receipt.v1"}))
        self.assertTrue(guard._read_marker(data.getvalue(), legacy_filename="old-marker.json")["delivered"])
        with self.assertRaises(ValueError):
            guard._read_marker(data.getvalue(), legacy_filename="")

    def test_history_is_independent_of_console_and_kv(self):
        self.env.update(STRATEGY_SWITCH_CONSOLE_URL="https://console.invalid",
                        STRATEGY_SWITCH_SYNC_TOKEN="private-console-token")
        routes = []
        def transport(route, token, **kwargs):
            routes.append(route)
            return self.transport(route, token, **kwargs)
        with mock.patch.object(guard, "api_get", side_effect=transport):
            self.assertEqual(guard.evaluate(DAY, self.env).decision, "skip")
        self.assertTrue(routes)
        self.assertTrue(all(route.startswith("https://api.example.invalid/repos/example/demo/actions/") for route in routes))

    def test_current_run_rerun_reads_its_previous_attempt_receipt(self):
        self.run["id"] = 100
        self.env["GITHUB_RUN_ATTEMPT"] = "2"
        with mock.patch.object(guard, "api_get", side_effect=self.transport):
            self.assertEqual(guard.evaluate(DAY, self.env).decision, "skip")

    def test_no_receipt_is_safe_only_when_send_step_did_not_run(self):
        def transport(route, token, **kwargs):
            if "/artifacts?" in route:
                return {"total_count": 0, "artifacts": []}
            if "/jobs?" in route:
                return {"total_count": 1, "jobs": [{"steps": [{"name": "Aggregate, render, and send daily digest", "conclusion": "skipped"}]}]}
            return self.transport(route, token, **kwargs)
        with mock.patch.object(guard, "api_get", side_effect=transport):
            self.assertEqual(guard.evaluate(DAY, self.env).decision, "send")

    def test_artifact_redirect_does_not_forward_authorization_to_another_host(self):
        import urllib.request
        request = urllib.request.Request("https://api.example.invalid/archive", headers={"Authorization": "Bearer synthetic-token"})
        redirected = guard._SafeRedirect().redirect_request(request, None, 302, "", {}, "https://files.example.invalid/archive")
        self.assertFalse(redirected.has_header("Authorization"))
