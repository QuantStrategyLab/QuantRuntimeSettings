"""Configuration verification must precede one exact platform dispatch."""
import argparse
import contextlib
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
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

    def test_platform_workflow_preflight_is_read_only_and_rejects_unavailable(self):
        workflow = "sync-cloud-run-env.yml"
        response = subprocess.CompletedProcess([], 0, json.dumps({"state": "active", "path": f".github/workflows/{workflow}"}), "")
        with patch.object(settings.subprocess, "run", return_value=response) as api:
            self.assertEqual(settings.runtime_control_workflow_preflight(self.request), workflow)
            self.assertEqual(api.call_args.args[0][:4], ["gh", "api", "--method", "GET"])
        for response in (subprocess.CompletedProcess([], 1, "", "HTTP 403"),
                         subprocess.CompletedProcess([], 0, json.dumps({"state": "disabled_manually", "path": f".github/workflows/{workflow}"}), "")):
            with self.subTest(returncode=response.returncode), patch.object(settings.subprocess, "run", return_value=response):
                with self.assertRaises(ValueError):
                    settings.runtime_control_workflow_preflight(self.request)

    def test_schwab_preflight_compares_protected_service_before_write(self):
        request = {**self.request, "target_id": "schwab/synthetic-one",
                   "github": {"repository": "QuantStrategyLab/CharlesSchwabPlatform", "variable_scope": "repository"},
                   "runtime_target": {**self.request["runtime_target"], "platform_id": "schwab", "service_name": "charles-schwab-quant-service"}}
        workflow = "pilot-metadata-readback.yml"
        response = subprocess.CompletedProcess([], 0, json.dumps({"state": "active", "path": f".github/workflows/{workflow}"}), "")
        with patch.object(settings, "read_stop_variables") as variables, patch.object(settings.subprocess, "run", return_value=response):
            self.assertEqual(settings.runtime_control_workflow_preflight(request), workflow)
            variables.assert_not_called()
        request["runtime_target"] = {**request["runtime_target"], "service_name": "synthetic-other"}
        with patch.object(settings.subprocess, "run") as api:
            with self.assertRaises(ValueError):
                settings.runtime_control_workflow_preflight(request)
            api.assert_not_called()

    def test_platform_dispatch_correlates_or_retains_unknown_without_retry(self):
        request_id = "12345678-1234-4abc-8def-123456789abc"
        cases = [(subprocess.CompletedProcess([], 0, json.dumps({"workflow_run_id": 123}), ""), "accepted", 123),
                 (subprocess.CompletedProcess([], 0, "", ""), "unknown", None),
                 (subprocess.CompletedProcess([], 1, "", "HTTP 403"), "rejected", None),
                 (subprocess.CompletedProcess([], 1, "", "HTTP 503"), "unknown", None)]
        for result, expected, run_id in cases:
            with self.subTest(expected=expected), patch.object(settings.subprocess, "run", return_value=result) as api:
                received = settings.dispatch_runtime_control(self.request, "enable", request_id, "sync-cloud-run-env.yml")
                self.assertEqual(received, {"status": expected, "run_id": run_id})
                payload = json.loads(api.call_args.kwargs["input"])
                self.assertEqual(payload["inputs"]["request_id"], request_id)
                self.assertIs(payload["return_run_details"], True)
                self.assertEqual(api.call_count, 1)

    def test_receipt_requires_exact_run_target_and_actual_state(self):
        request_id = "12345678-1234-4abc-8def-123456789abc"
        receipt = {"request_id": request_id, "run_id": "123", "attempt": "1", "operation": "enable",
                   "status": "applied", "platform_applied": True, "enabled": True, "continuity": "ACTIVE_LKG",
                   "scheduler_state": "ENABLED", "revision_sha256": "a" * 64,
                   "target_sha256": hashlib.sha256(self.request["runtime_target"]["service_name"].encode()).hexdigest()}
        def check(item):
            return settings.validate_runtime_control_receipt(self.request, "enable", request_id, 123, item)
        self.assertEqual(check(receipt), "applied")
        self.assertEqual(check({**receipt, "continuity": "ROLLBACK_LKG"}), "applied")
        self.assertEqual(check({**receipt, "continuity": "ACTIVE_REDUCED"}), "unknown")
        for field, value in (("run_id", "124"), ("request_id", "other"), ("attempt", "2"),
                             ("target_sha256", "b" * 64), ("enabled", False), ("operation", "disable")):
            with self.subTest(field=field):
                self.assertEqual(check({**receipt, field: value}), "unknown")
        self.assertEqual(check({**receipt, "scheduler_state": "unknown"}), "partial")
        self.assertEqual(check({**receipt, "continuity": "RECONCILE_ONLY"}), "protected")

    def test_receipt_archive_reads_only_exact_bounded_member(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("ibkr-runtime-switch-result.json", '{"status":"partial"}')
            archive.writestr("other-private-file", "not read")
        self.assertEqual(settings.read_runtime_control_receipt_zip(buffer.getvalue(), "ibkr"), {"status": "partial"})
        with self.assertRaises(ValueError):
            settings.read_runtime_control_receipt_zip(buffer.getvalue(), "schwab")
        with self.assertRaises(ValueError):
            settings.read_runtime_control_receipt_zip(b"x" * 262145, "ibkr")

    def test_read_result_only_accepts_correlated_workflow_run_and_artifact(self):
        request_id = "12345678-1234-4abc-8def-123456789abc"
        receipt = {"request_id": request_id, "run_id": "123", "attempt": "1", "operation": "enable",
                   "status": "applied", "platform_applied": True, "enabled": True, "continuity": "ACTIVE_LKG",
                   "scheduler_state": "ENABLED", "revision_sha256": "a" * 64,
                   "target_sha256": hashlib.sha256(self.request["runtime_target"]["service_name"].encode()).hexdigest()}
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as archive:
            archive.writestr("ibkr-runtime-switch-result.json", json.dumps(receipt))
        meta = {"path": ".github/workflows/sync-cloud-run-env.yml", "id": 10}
        run = {"workflow_id": 10, "id": 123, "run_attempt": 1, "event": "workflow_dispatch", "head_branch": "main",
               "display_title": "Runtime switch " + request_id, "status": "completed"}
        listing = {"total_count": 1, "artifacts": [{"name": "ibkr-runtime-switch-result-123-1", "id": 4, "size_in_bytes": len(buf.getvalue())}]}
        def result(value):
            return subprocess.CompletedProcess([], 0, value if isinstance(value, bytes) else json.dumps(value).encode(), b"")
        with patch.object(settings.subprocess, "run", side_effect=[result(meta), result(run), result(listing), result(buf.getvalue())]):
            self.assertEqual(settings.read_runtime_control_result(self.request, "enable", request_id, 123, "sync-cloud-run-env.yml"), "applied")
        with patch.object(settings.subprocess, "run", side_effect=[result(meta), result({**run, "display_title": "wrong"})]) as api:
            self.assertEqual(settings.read_runtime_control_result(self.request, "enable", request_id, 123, "sync-cloud-run-env.yml"), "unknown")
            self.assertEqual(api.call_count, 2)

    def test_only_reviewed_pretraffic_failure_resolves_as_not_adopted(self):
        request_id = "12345678-1234-4abc-8def-123456789abc"
        receipt = {"request_id": request_id, "run_id": "123", "attempt": "1", "operation": "enable",
                   "status": "unknown", "target_sha256": hashlib.sha256(self.request["runtime_target"]["service_name"].encode()).hexdigest()}
        meta = {"path": ".github/workflows/sync-cloud-run-env.yml", "id": 10}
        run = {"workflow_id": 10, "id": 123, "run_attempt": 1, "event": "workflow_dispatch", "head_branch": "main",
               "display_title": "Runtime switch " + request_id, "status": "completed", "conclusion": "failure",
               "head_sha": "49af5187aabace9dec41059620ecc4f16aa76daf"}
        steps = [{"name": "Prepare env-only revision and runtime switch", "conclusion": "success"},
                 {"name": "Reconcile Cloud Run traffic", "conclusion": "failure", "started_at": "2026-01-01T00:00:00Z", "completed_at": "2026-01-01T00:00:02Z"},
                 {"name": "Reconcile existing runtime switch scheduler", "conclusion": "skipped"}]
        jobs = {"total_count": 1, "jobs": [{"id": 8, "run_id": 123, "run_attempt": 1, "conclusion": "failure", "steps": steps}]}
        listing = {"total_count": 1, "artifacts": [{"name": "ibkr-runtime-switch-result-123-1", "id": 4, "size_in_bytes": 200}]}
        log = b"2026-01-01T00:00:01.1234567Z error: switch candidate changed service annotations or labels\n"

        def check(run_data=run, receipt_data=receipt, job_data=jobs, log_data=log):
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w") as archive:
                archive.writestr("ibkr-runtime-switch-result.json", json.dumps(receipt_data))
            def response(value):
                return subprocess.CompletedProcess([], 0, value if isinstance(value, bytes) else json.dumps(value).encode(), b"")
            with patch.object(settings.subprocess, "run", side_effect=[response(meta), response(run_data), response(listing), response(buffer.getvalue()), response(job_data), response(log_data)]):
                return settings.read_runtime_control_result(self.request, "enable", request_id, 123, "sync-cloud-run-env.yml")

        self.assertEqual(check(), "rejected")
        self.assertEqual(check(log_data=b"2026-01-01T00:00:01Z error: another failure\n"), "unknown")
        self.assertEqual(check(log_data=b""), "unknown")
        self.assertEqual(check(log_data=log.replace(b"00:00:01", b"00:00:03")), "unknown")
        self.assertEqual(check(receipt_data={**receipt, "target_sha256": "0" * 64}), "unknown")
        self.assertEqual(check(receipt_data={**receipt, "request_id": "12345678-1234-4abc-8def-123456789abd"}), "unknown")
        self.assertEqual(check(receipt_data={**receipt, "attempt": "2"}), "unknown")
        self.assertEqual(check(run_data={**run, "head_sha": "0" * 40}), "unknown")
        self.assertEqual(check(job_data={"total_count": 1, "jobs": [{**jobs["jobs"][0], "run_id": 999}]}), "unknown")
        self.assertEqual(check(job_data={"total_count": 1, "jobs": [{**jobs["jobs"][0], "run_attempt": 2}]}), "unknown")
        self.assertEqual(check(job_data={"total_count": 1, "jobs": [{**jobs["jobs"][0], "steps": [*steps[:2], {**steps[2], "conclusion": "success"}]}]}), "unknown")

    def test_unknown_dispatch_recovers_only_unique_exact_request(self):
        request_id = "12345678-1234-4abc-8def-123456789abc"
        run = {"id": 123, "display_title": "Runtime switch " + request_id, "event": "workflow_dispatch", "head_branch": "main", "run_attempt": 1}
        for runs, total, expected in [([run], 1, 123), ([run, run], 2, None), ([{**run, "run_attempt": 2}], 1, None), ([], 1, None)]:
            response = subprocess.CompletedProcess([], 0, json.dumps({"total_count": total, "workflow_runs": runs}).encode(), b"")
            with patch.object(settings.subprocess, "run", return_value=response) as api:
                self.assertEqual(settings.recover_runtime_control_run(self.request, request_id, "sync-cloud-run-env.yml", "2026-01-01T00:00:00Z"), expected)
                self.assertEqual(api.call_count, 1)

    def test_control_checks_workflow_before_save_and_sends_once(self):
        args = argparse.Namespace(operation="enable", request_id="12345678-1234-4abc-8def-123456789abc")
        with patch.object(settings, "load_stop_request", return_value=self.request),                 patch.object(settings, "runtime_control_workflow_preflight", side_effect=ValueError("runtime_control_workflow_permission_denied")),                 patch.object(settings, "execute_stop") as save, patch.object(settings, "dispatch_runtime_control") as send,                 contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(settings.command_runtime_control(args), 1)
            self.assertEqual(output.getvalue(), "")
            save.assert_not_called()
            send.assert_not_called()
        with patch.object(settings, "load_stop_request", return_value=self.request),                 patch.object(settings, "runtime_control_workflow_preflight", return_value="sync-cloud-run-env.yml"),                 patch.object(settings, "execute_stop") as save,                 patch.object(settings, "dispatch_runtime_control", return_value={"status": "rejected", "run_id": None}) as send,                 contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(settings.command_runtime_control(args), 1)
            self.assertEqual(output.getvalue(), "")
            save.assert_called_once_with(self.request, apply=True, enabled=True)
            self.assertEqual(send.call_count, 1)

    def test_readback_only_queries_original_run_never_writes_or_dispatches(self):
        args = argparse.Namespace(operation="enable", request_id="12345678-1234-4abc-8def-123456789abc", check_id="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", platform_run_id="321")
        with patch.object(settings, "load_stop_request", return_value=self.request),                 patch.object(settings, "runtime_control_workflow_preflight", return_value="sync-cloud-run-env.yml"),                 patch.object(settings, "read_runtime_control_result", return_value="applied") as read,                 patch.object(settings, "execute_stop") as write, patch.object(settings, "dispatch_runtime_control") as send:
            self.assertEqual(settings.command_runtime_control_readback(args), 0)
            read.assert_called_once_with(self.request, "enable", args.request_id, 321, "sync-cloud-run-env.yml", {})
            write.assert_not_called()
            send.assert_not_called()

    def test_readback_diagnostic_reports_only_fixed_stage_and_http_status(self):
        diagnostic = {}
        response = subprocess.CompletedProcess([], 1, b"", b"HTTP 403 synthetic-private-message")
        with patch.object(settings.subprocess, "run", return_value=response):
            self.assertEqual(settings.read_runtime_control_result(self.request, "enable", "12345678-1234-4abc-8def-123456789abc", 123, "sync-cloud-run-env.yml", diagnostic), "unknown")
        self.assertEqual(diagnostic, {"stage": "workflow", "http_status": 403, "failure_kind": "command_failed"})

    def test_readback_diagnostic_distinguishes_oversize_and_timeout(self):
        for response, expected in [(subprocess.CompletedProcess([], 0, b"x" * 524289, b""), "response_too_large"),
                                   (subprocess.TimeoutExpired(["gh"], 30), "timeout")]:
            diagnostic = {}
            with self.subTest(expected=expected), patch.object(settings.subprocess, "run", side_effect=response if isinstance(response, Exception) else None, return_value=response):
                self.assertEqual(settings.read_runtime_control_result(self.request, "enable", "12345678-1234-4abc-8def-123456789abc", 123, "sync-cloud-run-env.yml", diagnostic), "unknown")
            self.assertEqual(diagnostic, {"stage": "workflow", "failure_kind": expected})

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
