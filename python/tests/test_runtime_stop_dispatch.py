"""Configuration verification must precede one exact platform dispatch."""
import argparse
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import runtime_settings as settings
import test_runtime_stop as fixtures


class RuntimeStopDispatchTests(unittest.TestCase):
    def setUp(self):
        fixture = fixtures.RuntimeStopTests()
        fixture.setUp()
        self.request = fixture.request
        self.args = argparse.Namespace(yes=True, confirm="STOP_ONLY")

    def command(self):
        with patch.dict(os.environ, {"RUNTIME_STOP_REQUEST_JSON": json.dumps(self.request)}, clear=True), \
                contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()) as err:
            code = settings.command_stop(self.args)
        self.assertNotIn("synthetic", out.getvalue() + err.getvalue())
        return code, out.getvalue()

    def test_configuration_save_and_preview_never_dispatch(self):
        for apply in (True, False):
            self.args.yes = apply
            expected = {"configured": apply, "platform_applied": False, "preview": not apply}
            with self.subTest(apply=apply), \
                    patch.object(settings, "execute_stop", return_value=expected) as save, \
                    patch.object(settings.subprocess, "run") as external:
                code, output = self.command()
                self.assertEqual(code, 0)
                self.assertEqual(json.loads(output), expected)
                save.assert_called_once_with(self.request, apply=apply)
                external.assert_not_called()

    def test_failed_save_or_missing_confirmation_zero_dispatch(self):
        with patch.object(settings.subprocess, "run") as external, \
                patch.object(settings, "execute_stop", side_effect=ValueError("synthetic-private-error")) as save:
            self.assertEqual(self.command()[0], 2)
            self.args.confirm = ""
            self.assertEqual(self.command()[0], 2)
            self.assertEqual(save.call_count, 1)
            external.assert_not_called()

    def test_removed_platform_apply_option_rejected_before_any_io(self):
        with patch.object(settings, "execute_stop") as save, \
                patch.object(settings.subprocess, "run") as external, \
                contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as rejected:
            settings.build_parser().parse_args(["stop", "--yes", "--confirm", "STOP_ONLY", "--apply-platform"])
        self.assertEqual(rejected.exception.code, 2)
        save.assert_not_called()
        external.assert_not_called()

    def hk_request(self):
        return {"target_id": "longbridge/hk", "github": {
            "repository": "QuantStrategyLab/LongBridgePlatform", "variable_scope": "environment", "environment": "longbridge-hk"},
            "runtime_target": {"platform_id": "longbridge", "deployment_selector": "synthetic-hk",
                               "account_selector": ["synthetic-account"], "account_scope": "HK",
                               "service_name": "longbridge-quant-hk-service"}}

    def test_hk_stop_dispatch_reads_saved_false_without_writing_or_reading_protected_identity(self):
        self.request = self.hk_request()
        self.args.apply_hk_stop = True
        order = []
        def read(*args, **kwargs):
            order.append("read")
            return {"RUNTIME_TARGET_ENABLED": "false"}
        def dispatch(command, **kwargs):
            order.append("dispatch")
            self.assertEqual(command, ["gh", "api", "--method", "POST",
                "repos/QuantStrategyLab/LongBridgePlatform/actions/workflows/stop-hk-runtime.yml/dispatches", "--input", "-"])
            payload = json.loads(kwargs["input"])
            self.assertEqual(payload["ref"], "main")
            self.assertEqual(payload["inputs"]["confirm"], "STOP_ONLY")
            self.assertEqual(json.loads(payload["inputs"]["stop_request"]), self.request)
            self.assertNotIn("synthetic-account", " ".join(command))
            return subprocess.CompletedProcess(command, 0, "", "")
        with patch.object(settings, "execute_stop") as save, patch.object(settings, "read_stop_variables", side_effect=read), patch.object(settings.subprocess, "run", side_effect=dispatch):
            code, output = self.command()
        self.assertEqual(code, 0)
        self.assertEqual(order, ["read", "dispatch"])
        save.assert_not_called()
        self.assertTrue(json.loads(output)["platform_apply_requested"])
        self.assertFalse(json.loads(output)["platform_applied"])

    def test_hk_scope_rejects_other_target_before_configuration_write(self):
        self.args.apply_hk_stop = True
        for target in [self.request, {**self.hk_request(), "target_id": "longbridge/sg"}]:
            self.request = target
            with self.subTest(target=target["target_id"]), patch.object(settings, "execute_stop") as save, patch.object(settings.subprocess, "run") as external:
                self.assertEqual(self.command()[0], 2)
                save.assert_not_called()
                external.assert_not_called()

    def test_hk_preview_or_missing_saved_stop_never_dispatches(self):
        self.request = self.hk_request()
        self.args.apply_hk_stop = True
        for saved in [{}, {"RUNTIME_TARGET_ENABLED": "true"}, {"RUNTIME_TARGET_ENABLED": "unknown"}]:
            with patch.object(settings, "execute_stop") as save, patch.object(settings, "read_stop_variables", return_value=saved), patch.object(settings.subprocess, "run") as external:
                self.assertEqual(self.command()[0], 2)
                external.assert_not_called()
                save.assert_not_called()
        self.args.yes = False
        with patch.object(settings, "read_stop_variables") as read:
            self.assertEqual(self.command()[0], 2)
            read.assert_not_called()

    def test_hk_unknown_dispatch_is_not_retried_or_reported_applied(self):
        self.request = self.hk_request()
        self.args.apply_hk_stop = True
        with patch.object(settings, "read_stop_variables", return_value={"RUNTIME_TARGET_ENABLED": "false"}), \
                patch.object(settings.subprocess, "run", side_effect=subprocess.TimeoutExpired("synthetic", 45)) as external:
            self.assertEqual(self.command()[0], 2)
            self.assertEqual(external.call_count, 1)

    def test_event_file_wins_over_inline_environment_and_invalid_event_never_dispatches(self):
        with tempfile.TemporaryDirectory() as directory:
            event = Path(directory) / "event.json"
            event.write_text(json.dumps({"inputs": {"stop_request": json.dumps(self.request)}}))
            with patch.dict(os.environ, {"GITHUB_EVENT_PATH": str(event), "RUNTIME_STOP_REQUEST_JSON": "synthetic-invalid"}, clear=True):
                self.assertEqual(settings.load_stop_request(), self.request)
                event.write_text('{"inputs": {}}')
                with self.assertRaises(KeyError):
                    settings.load_stop_request()
            link = Path(directory) / "link.json"
            link.symlink_to(event)
            with patch.dict(os.environ, {"GITHUB_EVENT_PATH": str(link)}, clear=True), self.assertRaises(ValueError):
                settings.load_stop_request()


if __name__ == "__main__":
    unittest.main()
