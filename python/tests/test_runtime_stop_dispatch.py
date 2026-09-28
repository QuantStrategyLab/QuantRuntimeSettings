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
        self.args = argparse.Namespace(yes=True, confirm="STOP_ONLY", apply_hk_stop=False)
        self.enterContext(patch.dict(os.environ, {"GITHUB_REF": "refs/heads/main"}, clear=False))

    def command(self):
        with patch.dict(
            os.environ,
            {"RUNTIME_STOP_REQUEST_JSON": json.dumps(self.request), "GITHUB_REF": "refs/heads/main"},
            clear=True,
        ), contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()) as err:
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

    def hk_variables(self, enabled, **extra):
        environment = {
            "RUNTIME_TARGET_JSON": json.dumps(self.hk_request()["runtime_target"]),
            "RUNTIME_TARGET_ENABLED": enabled,
            **extra,
        }
        return [{}, environment]

    def test_hk_stop_saves_false_readback_then_dispatches_once(self):
        self.request = self.hk_request()
        self.args.apply_hk_stop = True
        reads = self.hk_variables("true") + self.hk_variables("true") + self.hk_variables("false")
        reads.append(self.hk_variables("false")[1])
        calls = []

        def run(command, **kwargs):
            calls.append((command, kwargs.get("input")))
            if command[:3] == ["gh", "variable", "set"]:
                self.assertEqual(kwargs.get("input"), "false")
                self.assertNotIn("--body", command)
                return subprocess.CompletedProcess(command, 0, "", "")
            self.assertEqual(command, ["gh", "api", "--method", "POST",
                "repos/QuantStrategyLab/LongBridgePlatform/actions/workflows/stop-hk-runtime.yml/dispatches", "--input", "-"])
            payload = json.loads(kwargs["input"])
            self.assertEqual(payload["ref"], "main")
            self.assertEqual(payload["inputs"]["confirm"], "STOP_ONLY")
            self.assertEqual(json.loads(payload["inputs"]["stop_request"]), self.request)
            self.assertNotIn("synthetic-account", " ".join(command))
            return subprocess.CompletedProcess(command, 0, "", "")

        with patch.object(settings, "read_stop_variables", side_effect=reads), \
                patch.object(settings.subprocess, "run", side_effect=run):
            code, output = self.command()
        self.assertEqual(code, 0)
        self.assertEqual([item[0][:3] for item in calls], [["gh", "variable", "set"], ["gh", "api", "--method"]])
        body = json.loads(output)
        self.assertTrue(body["configured"])
        self.assertTrue(body["platform_apply_requested"])
        self.assertFalse(body["platform_applied"])

    def test_hk_scope_rejects_other_target_before_configuration_write(self):
        self.args.apply_hk_stop = True
        for target in [self.request, {**self.hk_request(), "target_id": "longbridge/sg"}]:
            self.request = target
            with self.subTest(target=target["target_id"]), patch.object(settings, "execute_stop") as save, patch.object(settings.subprocess, "run") as external:
                self.assertEqual(self.command()[0], 2)
                save.assert_not_called()
                external.assert_not_called()

    def test_hk_preview_missing_identity_conflict_or_readback_never_dispatch(self):
        self.request = self.hk_request()
        self.args.apply_hk_stop = True
        secret_only = [{}, {"RUNTIME_TARGET_ENABLED": "false"}]
        changed = self.hk_variables("true") + [{}, {**self.hk_variables("true")[1], "KEEP": "changed"}]
        mismatched = self.hk_variables("true") + self.hk_variables("true") + self.hk_variables("false", UNRELATED="changed")
        for label, reads, writes in [
            ("identity-missing", secret_only, 0),
            ("source-changed", changed, 0),
            ("readback-mismatch", mismatched, 1),
        ]:
            with self.subTest(label=label), patch.object(settings, "read_stop_variables", side_effect=reads), \
                    patch.object(settings.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as external:
                self.assertEqual(self.command()[0], 2)
                self.assertEqual(external.call_count, writes)
                for call in external.call_args_list:
                    self.assertNotEqual(call.args[0][1:3], ["api", "--method"])
        self.args.yes = False
        with patch.object(settings, "read_stop_variables") as read, patch.object(settings.subprocess, "run") as external:
            self.assertEqual(self.command()[0], 2)
            read.assert_not_called()
            external.assert_not_called()

    def test_hk_unknown_dispatch_is_not_retried_or_reported_applied(self):
        self.request = self.hk_request()
        self.args.apply_hk_stop = True
        reads = self.hk_variables("true") + self.hk_variables("true") + self.hk_variables("false")
        reads.append(self.hk_variables("false")[1])
        calls = []

        def run(command, **kwargs):
            calls.append(command)
            if command[:3] == ["gh", "variable", "set"]:
                return subprocess.CompletedProcess(command, 0, "", "")
            raise subprocess.TimeoutExpired(command, 45)

        with patch.object(settings, "read_stop_variables", side_effect=reads), \
                patch.object(settings.subprocess, "run", side_effect=run):
            self.assertEqual(self.command()[0], 2)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][1:3], ["api", "--method"])

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

    def test_hk_correlation_is_forwarded_once_and_invalid_correlation_never_dispatches(self):
        correlation = {
            "request_id": "11111111-1111-4111-8111-111111111111",
            "source_revision": 1,
            "source_identity_sha256": "ab" * 32,
        }
        self.args.apply_hk_stop = True
        self.request = {**self.hk_request(), "correlation": {**correlation, "source_revision": True}}
        with patch.object(settings, "execute_stop") as save, patch.object(settings.subprocess, "run") as external:
            self.assertEqual(self.command()[0], 2)
            save.assert_not_called()
            external.assert_not_called()
        self.request = {**self.hk_request(), "correlation": correlation}
        reads = self.hk_variables("true") + self.hk_variables("true") + self.hk_variables("false")
        reads.append(self.hk_variables("false")[1])

        def run(command, **kwargs):
            if command[:3] == ["gh", "variable", "set"]:
                return subprocess.CompletedProcess(command, 0, "", "")
            payload = json.loads(kwargs["input"])
            self.assertEqual(json.loads(payload["inputs"]["stop_request"]), self.request)
            return subprocess.CompletedProcess(command, 0, "", "")

        with patch.object(settings, "read_stop_variables", side_effect=reads), \
                patch.object(settings.subprocess, "run", side_effect=run):
            code, _output = self.command()
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
