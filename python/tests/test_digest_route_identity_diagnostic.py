from __future__ import annotations

import contextlib
import ast
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import urllib.error


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "python/scripts/diagnose_digest_route_identity.py"
WORKFLOW = ROOT / ".github/workflows/digest-bot-identity.yml"
SPEC = importlib.util.spec_from_file_location("digest_route_diagnostic", SCRIPT)
diagnostic = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(diagnostic)

SHA = "a" * 40
CONTEXT = {
    "INPUT_EVENT_NAME": "workflow_dispatch",
    "INPUT_REF": "refs/heads/main",
    "SOURCE_SHA": SHA,
}
PRIVATE = (
    "primary-private-token", "alias-private-token", "sm-private-token",
    "private-chat-one", "private-chat-two", "private-secret-name",
    "private-project", "private-bot-name", "847362915",
)


def configured_env(**updates):
    return {**CONTEXT, "TELEGRAM_TOKEN": PRIVATE[0],
            "QSL_GLOBAL_TELEGRAM_CHAT_ID": PRIVATE[3], **updates}


class DiagnosticTests(unittest.TestCase):
    def assert_private(self, value):
        serialized = json.dumps(value)
        for private in PRIVATE:
            self.assertNotIn(private, serialized)
        for forbidden in ("https://", "getMe?", "bot_id", "username", "last4", "fingerprint"):
            self.assertNotIn(forbidden, serialized)

    def test_primary_winner_only_and_shadowed_token_comparison(self):
        getter = mock.Mock(return_value=847362915)
        reader = mock.Mock(side_effect=AssertionError("secret access forbidden"))
        result = diagnostic.diagnose(configured_env(TG_TOKEN=PRIVATE[1]),
                                     getme=getter, secret_reader=reader)
        getter.assert_called_once_with(PRIVATE[0])
        reader.assert_not_called()
        self.assertEqual(result["status"], "observed")
        self.assertEqual(result["token"]["source_kind"], "environment_primary")
        self.assertFalse(result["token"]["winner_equals_shadowed_alias_token"])
        self.assertEqual(result["canonical_route_approval"], "unknown")
        self.assertEqual(result["loaded_runtime_identity"], "unknown")
        self.assertEqual(result["natural_delivery"], "unknown")
        self.assert_private(result)

    def test_failed_primary_never_rescued_by_alias(self):
        getter = mock.Mock(side_effect=ValueError("private-token-and-private-bot-name"))
        result = diagnostic.diagnose(configured_env(TG_TOKEN=PRIVATE[1]), getme=getter)
        getter.assert_called_once_with(PRIVATE[0])
        self.assertEqual(result["reason"], "winner_getme_failed")
        self.assertEqual(result["token"]["identity_state"], "unknown")
        self.assert_private(result)

    def test_alias_used_when_primary_whitespace(self):
        getter = mock.Mock(return_value=847362915)
        result = diagnostic.diagnose(configured_env(TELEGRAM_TOKEN=" \n ", TG_TOKEN=" " + PRIVATE[1] + " "), getme=getter)
        getter.assert_called_once_with(PRIVATE[1])
        self.assertEqual(result["token"]["source_kind"], "environment_alias")
        self.assertIsNone(result["token"]["winner_equals_shadowed_alias_token"])

    def test_same_shadowed_token_equality_is_credential_not_bot_equality(self):
        result = diagnostic.diagnose(configured_env(TG_TOKEN=PRIVATE[0]), getme=lambda _: 123)
        self.assertTrue(result["token"]["winner_equals_shadowed_alias_token"])
        self.assertNotIn("same_bot", result["token"])

    def test_absent_shadowed_token_equality_is_unknown(self):
        result = diagnostic.diagnose(configured_env(), getme=lambda _: 123)
        self.assertIsNone(result["token"]["winner_equals_shadowed_alias_token"])

    def test_secret_fallback_requires_known_auth(self):
        reader = mock.Mock(return_value=PRIVATE[2])
        getter = mock.Mock(return_value=123)
        result = diagnostic.diagnose(configured_env(TELEGRAM_TOKEN="", TG_TOKEN=""), secret_reader=reader, getme=getter)
        self.assertEqual(result["reason"], "secret_manager_auth_unavailable")
        self.assertEqual(result["token"]["source_kind"], "secret_manager")
        reader.assert_not_called()
        getter.assert_not_called()

    def test_secret_fallback_reads_once_then_gets_winner_only(self):
        env = configured_env(TELEGRAM_TOKEN="", DIAGNOSTIC_SM_AUTH_STATUS="success")
        reader = mock.Mock(return_value=" " + PRIVATE[2] + " ")
        getter = mock.Mock(return_value=123)
        result = diagnostic.diagnose(env, secret_reader=reader, getme=getter)
        reader.assert_called_once_with(env)
        getter.assert_called_once_with(PRIVATE[2])
        self.assertEqual(result["status"], "observed")

    def test_secret_fallback_failure_or_empty_stays_unknown(self):
        for returned in (None, "", " \n "):
            with self.subTest(returned=returned):
                result = diagnostic.diagnose(configured_env(TELEGRAM_TOKEN="", DIAGNOSTIC_SM_AUTH_STATUS="success"),
                                             secret_reader=lambda _: returned,
                                             getme=mock.Mock(side_effect=AssertionError("must not getMe")))
                self.assertEqual(result["reason"], "secret_manager_token_unavailable")
        result = diagnostic.diagnose(configured_env(TELEGRAM_TOKEN="", DIAGNOSTIC_SM_AUTH_STATUS="success"),
                                     secret_reader=mock.Mock(side_effect=RuntimeError(PRIVATE[5])))
        self.assertEqual(result["reason"], "secret_manager_token_unavailable")
        self.assert_private(result)

    def test_invalid_context_blocks_external_io_before_route_read(self):
        for override in ({"INPUT_EVENT_NAME": "push"}, {"INPUT_REF": "refs/heads/private-ref"},
                         {"SOURCE_SHA": "private-revision"}, {"SOURCE_SHA": "a" * 39},
                         {"SOURCE_SHA": "z" * 40}):
            with self.subTest(override=override):
                getter = mock.Mock(side_effect=AssertionError("unexpected external IO"))
                reader = mock.Mock(side_effect=AssertionError("unexpected external IO"))
                result = diagnostic.diagnose(configured_env(**override), getme=getter, secret_reader=reader)
                self.assertEqual(result["status"], "blocked")
                self.assertEqual(result["reason"], "manual_main_source_required")
                getter.assert_not_called()
                reader.assert_not_called()
                self.assertNotIn("private", json.dumps(result))

    def test_chat_priority_and_first_id_equality(self):
        result = diagnostic.diagnose(configured_env(
            QSL_GLOBAL_TELEGRAM_CHAT_ID=" ; " + PRIVATE[3] + "," + PRIVATE[4],
            GLOBAL_TELEGRAM_CHAT_ID=PRIVATE[3] + ";ignored-second",
            STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS=PRIVATE[4] + ",ignored-second"), getme=lambda _: 123)
        self.assertEqual(result["chat"]["source_kind"], "environment_global_primary")
        self.assertEqual(result["chat"]["state"], "known")
        self.assertTrue(result["chat"]["winner_equals_shadowed_global_alias_first_id"])
        self.assertFalse(result["chat"]["winner_equals_shadowed_plugin_first_id"])
        self.assertIsNone(result["chat"]["equals_independent_canonical"])
        self.assertEqual(result["topic_parameter"], "omitted")
        self.assert_private(result)

    def test_chat_alias_and_plugin_fallback_preserve_sender_selector(self):
        cases = [
            ({"QSL_GLOBAL_TELEGRAM_CHAT_ID": " ;, ", "GLOBAL_TELEGRAM_CHAT_ID": PRIVATE[4]}, "environment_global_alias"),
            ({"QSL_GLOBAL_TELEGRAM_CHAT_ID": "", "GLOBAL_TELEGRAM_CHAT_ID": " , ",
              "STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS": " , " + PRIVATE[4] + ";other"}, "environment_plugin_first_id"),
        ]
        for overrides, kind in cases:
            with self.subTest(kind=kind):
                result = diagnostic.diagnose(configured_env(**overrides), getme=lambda _: 123)
                self.assertEqual(result["chat"]["source_kind"], kind)
                self.assertEqual(result["chat"]["state"], "known")
                self.assertIsNone(result["chat"]["winner_equals_shadowed_global_alias_first_id"])

    def test_missing_chat_does_not_turn_known_bot_into_complete_route(self):
        result = diagnostic.diagnose(configured_env(QSL_GLOBAL_TELEGRAM_CHAT_ID=""), getme=lambda _: 123)
        self.assertEqual(result["token"]["identity_state"], "observed")
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["reason"], "chat_missing")
        self.assertEqual(result["chat"]["state"], "unknown")

    def test_no_plugin_token_fallback(self):
        getter = mock.Mock(side_effect=AssertionError("plugin token must not win"))
        result = diagnostic.diagnose(configured_env(TELEGRAM_TOKEN="", STRATEGY_PLUGIN_ALERT_TELEGRAM_BOT_TOKEN=PRIVATE[2]), getme=getter)
        self.assertEqual(result["reason"], "secret_manager_auth_unavailable")
        getter.assert_not_called()

    def test_sender_priority_contract_matches_current_source_without_importing_sender(self):
        source = (ROOT / "python/scripts/send_daily_digest_telegram.py").read_text()
        constants = {}
        for node in ast.parse(source).body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id in {"TOKEN_ENV_PRIORITY", "CHAT_ENV_PRIORITY"}:
                        constants[target.id] = ast.literal_eval(node.value)
        self.assertEqual(constants["TOKEN_ENV_PRIORITY"], diagnostic.TOKEN_KEYS)
        self.assertEqual(constants["CHAT_ENV_PRIORITY"], diagnostic.CHAT_KEYS)
        self.assertIn('return chats[0]', source)
        self.assertIn('return _load_token_from_secret_manager()', source)
        self.assertIn('str(raw).replace(";", ",").split(",")', source)


class ExternalBoundaryTests(unittest.TestCase):
    def test_getme_uses_get_encoded_token_and_bounded_response(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = json.dumps({"ok": True, "result": {"id": 847362915, "is_bot": True, "username": PRIVATE[7]}}).encode()
        opener = mock.Mock()
        opener.open.return_value = response
        with mock.patch.object(diagnostic.urllib.request, "build_opener", return_value=opener):
            bot = diagnostic.getme_identity("private/token?x=1")
        self.assertEqual(bot, 847362915)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertIsNone(request.data)
        self.assertEqual(request.full_url, "https://api.telegram.org/botprivate%2Ftoken%3Fx%3D1/getMe")
        response.read.assert_called_once_with(65537)
        self.assertLessEqual(opener.open.call_args.kwargs["timeout"], 15)

    def test_invalid_getme_responses_do_not_claim_identity(self):
        bodies = [b"not-json", b"x" * 65537,
                  json.dumps({"ok": False, "description": PRIVATE[0]}).encode(),
                  json.dumps({"ok": True, "result": {"id": True, "is_bot": True}}).encode(),
                  json.dumps({"ok": True, "result": {"id": 0, "is_bot": True}}).encode(),
                  json.dumps({"ok": True, "result": {"id": 123, "is_bot": False}}).encode(),
                  json.dumps({"ok": True, "result": {"id": "123", "is_bot": True}}).encode(),
                  json.dumps({"ok": True, "result": []}).encode()]
        for body in bodies:
            with self.subTest(body_kind=len(body)):
                response = mock.MagicMock()
                response.__enter__.return_value = response
                response.read.return_value = body
                opener = mock.Mock()
                opener.open.return_value = response
                with mock.patch.object(diagnostic.urllib.request, "build_opener", return_value=opener):
                    self.assertIsNone(diagnostic.getme_identity(PRIVATE[0]))

    def test_redirects_are_rejected(self):
        with self.assertRaises(urllib.error.HTTPError):
            diagnostic.NoRedirect().redirect_request(None, None, 302, "private", {}, "https://private.example/")

    def test_secret_manager_exact_sender_command_and_private_capture(self):
        env = {"TELEGRAM_TOKEN_SECRET_NAME": PRIVATE[5], "GCP_PROJECT_ID": PRIVATE[6], "GOOGLE_CLOUD_PROJECT": "ignored"}
        runner = mock.Mock(return_value=subprocess.CompletedProcess([], 0, PRIVATE[2] + "\n", PRIVATE[0]))
        with mock.patch.object(diagnostic.subprocess, "run", runner):
            self.assertEqual(diagnostic.read_secret_token(env), PRIVATE[2])
        args = runner.call_args.args[0]
        self.assertEqual(args, ["gcloud", "secrets", "versions", "access", "latest", "--secret", PRIVATE[5], "--project", PRIVATE[6]])
        self.assertTrue(runner.call_args.kwargs["capture_output"])
        self.assertLessEqual(runner.call_args.kwargs["timeout"], 30)

    def test_secret_default_project_fallback_and_failures(self):
        runner = mock.Mock(return_value=subprocess.CompletedProcess([], 1, PRIVATE[2], PRIVATE[6]))
        with mock.patch.object(diagnostic.subprocess, "run", runner):
            self.assertEqual(diagnostic.read_secret_token({"TELEGRAM_TOKEN_SECRET_NAME": " ", "GOOGLE_CLOUD_PROJECT": " fallback "}), "")
        self.assertEqual(runner.call_args.args[0][-4:], ["--secret", "quant-sentinel-telegram-bot-token", "--project", "fallback"])
        for exception in (OSError(PRIVATE[0]), subprocess.TimeoutExpired("private-command", 30)):
            with self.subTest(kind=type(exception).__name__):
                with mock.patch.object(diagnostic.subprocess, "run", side_effect=exception):
                    self.assertEqual(diagnostic.read_secret_token({}), "")

    def test_main_private_exception_and_summary_projection(self):
        with tempfile.TemporaryDirectory() as temporary:
            summary = Path(temporary) / "summary.md"
            env = configured_env(GITHUB_STEP_SUMMARY=str(summary), TG_TOKEN=PRIVATE[1])
            output, error = io.StringIO(), io.StringIO()
            with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(diagnostic, "getme_identity", side_effect=RuntimeError(PRIVATE[0])), contextlib.redirect_stdout(output), contextlib.redirect_stderr(error):
                code = diagnostic.main([])
            self.assertEqual(code, 1)
            self.assertEqual(error.getvalue(), "")
            self.assertEqual(json.loads(output.getvalue())["reason"], "winner_getme_failed")
            DiagnosticTests().assert_private(output.getvalue() + summary.read_text())

    def test_main_invalid_arguments_never_echo_argument_or_access_network(self):
        output, error = io.StringIO(), io.StringIO()
        getter = mock.Mock(side_effect=AssertionError("no network"))
        with mock.patch.dict(os.environ, configured_env(), clear=True), mock.patch.object(diagnostic, "getme_identity", getter), contextlib.redirect_stdout(output), contextlib.redirect_stderr(error):
            code = diagnostic.main(["--" + PRIVATE[0]])
        self.assertEqual(code, 2)
        self.assertEqual(error.getvalue(), "")
        self.assertEqual(json.loads(output.getvalue())["reason"], "arguments_not_supported")
        getter.assert_not_called()
        DiagnosticTests().assert_private(output.getvalue())

    def test_summary_exception_fails_without_private_traceback(self):
        output, error = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, configured_env(GITHUB_STEP_SUMMARY="summary.md"), clear=True), mock.patch.object(diagnostic, "getme_identity", return_value=123), mock.patch.object(diagnostic.Path, "open", side_effect=ValueError(PRIVATE[3])), contextlib.redirect_stdout(output), contextlib.redirect_stderr(error):
            code = diagnostic.main([])
        self.assertEqual(code, 1)
        self.assertEqual(error.getvalue(), "")
        self.assertEqual(json.loads(output.getvalue())["reason"], "public_summary_write_failed")
        DiagnosticTests().assert_private(output.getvalue())

    def test_import_is_inert_in_fresh_interpreter(self):
        bootstrap = '''import importlib.util, socket, subprocess, urllib.request
def forbidden(*args, **kwargs): raise AssertionError("import external IO")
socket.socket = socket.create_connection = socket.getaddrinfo = forbidden
subprocess.run = subprocess.Popen = forbidden
urllib.request.urlopen = urllib.request.build_opener = forbidden
spec = importlib.util.spec_from_file_location("inert", __import__("sys").argv[1])
spec.loader.exec_module(importlib.util.module_from_spec(spec))
'''
        result = subprocess.run([sys.executable, "-I", "-S", "-c", bootstrap, str(SCRIPT)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_actual_subprocess_injected_get_never_sends_or_queries_shadowed(self):
        bootstrap = '''import io, json, os, runpy, socket, sys, urllib.request
script = sys.argv[1]
requests = []
def forbidden(*args, **kwargs):
    raise AssertionError("network forbidden")
socket.socket.connect = socket.socket.bind = socket.create_connection = socket.getaddrinfo = forbidden
urllib.request.urlopen = forbidden
class FixtureResponse(io.BytesIO):
    def read(self, size=-1):
        assert size == 65537
        return super().read(size)
def build(*handlers):
    assert len(handlers) == 1 and type(handlers[0]).__name__ == "NoRedirect"
    class FixtureOpener:
        def open(self, request, **kwargs):
            assert request.get_method() == "GET" and request.data is None
            assert request.full_url == "https://api.telegram.org/bot" + os.environ["TELEGRAM_TOKEN"] + "/getMe"
            assert kwargs == {"timeout": 15}
            requests.append(request.get_method())
            return FixtureResponse(json.dumps({"ok": True, "result": {"id": 847362915, "is_bot": True}}).encode())
    return FixtureOpener()
urllib.request.build_opener = build
sys.argv = [script]
try:
    runpy.run_path(script, run_name="__main__")
except SystemExit as exc:
    assert exc.code == 0
assert requests == ["GET"]
'''
        env = {"PATH": os.environ["PATH"], **configured_env(TG_TOKEN=PRIVATE[1])}
        result = subprocess.run([sys.executable, "-I", "-S", "-c", bootstrap, str(SCRIPT)],
                                env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertEqual(json.loads(result.stdout)["token"]["identity_state"], "observed")
        DiagnosticTests().assert_private(result.stdout)


class WorkflowBoundaryTests(unittest.TestCase):
    def test_workflow_manual_main_and_original_environment_only(self):
        source = WORKFLOW.read_text()
        self.assertIn("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'", source)
        self.assertIn("environment: runtime-strategy-switch", source)
        self.assertIn("persist-credentials: false", source)
        self.assertIn("python3 python/scripts/diagnose_digest_route_identity.py", source)
        self.assertNotIn("bot_id", source)
        self.assertNotIn("bot_username", source)
        self.assertNotIn("send_daily_digest_telegram.py", source)
        self.assertNotIn("sendMessage", source)
        self.assertNotIn("vars.", source)
        self.assertNotIn("DIGEST_CANDIDATES", source)
        self.assertNotIn("STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS", source)
        self.assertIn("DIAGNOSTIC_SM_AUTH_STATUS: unavailable", source)
        for name in ("TELEGRAM_TOKEN", "TG_TOKEN", "QSL_GLOBAL_TELEGRAM_CHAT_ID", "GLOBAL_TELEGRAM_CHAT_ID"):
            self.assertIn(f"{name}: ${{{{ secrets.{name} }}}}", source)


if __name__ == "__main__":
    unittest.main()
