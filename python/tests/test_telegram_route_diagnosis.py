from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def _load_module(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


sender = _load_module("send_daily_digest_telegram")


def _clear_route_env(env: dict[str, str]) -> dict[str, str]:
    keys = (
        "TELEGRAM_TOKEN",
        "TG_TOKEN",
        "TELEGRAM_TOKEN_SECRET_NAME",
        "QSL_GLOBAL_TELEGRAM_CHAT_ID",
        "GLOBAL_TELEGRAM_CHAT_ID",
        "STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS",
        "STRATEGY_PLUGIN_ALERT_TELEGRAM_BOT_TOKEN",
        "DIGEST_ROUTE_CHAT_FINGERPRINT",
        "DIGEST_ROUTE_PROBE_SECRET_MANAGER",
        "GCP_PROJECT_ID",
        "GOOGLE_CLOUD_PROJECT",
    )
    cleaned = dict(env)
    for key in keys:
        cleaned.pop(key, None)
    return cleaned


class TelegramRouteDiagnosisTests(unittest.TestCase):
    def test_token_priority_telegram_over_tg(self):
        env = _clear_route_env(os.environ)
        env["TELEGRAM_TOKEN"] = "tok-primary"
        env["TG_TOKEN"] = "tok-alias"
        env["QSL_GLOBAL_TELEGRAM_CHAT_ID"] = "chat-primary"
        with mock.patch.dict(os.environ, env, clear=True):
            route = sender.diagnose_telegram_route()
        self.assertEqual(route["token_source_kind"], "env:TELEGRAM_TOKEN")
        self.assertFalse(route["token_alias_used"])
        self.assertIn(
            "token_env_shadowed:TG_TOKEN_present_but_TELEGRAM_TOKEN_wins",
            route["warnings"],
        )
        self.assertTrue(
            any(
                w.startswith("token_gcp_secret_manager_shadowed_by_environment:")
                for w in route["warnings"]
            )
        )
        self.assertEqual(route["secret_name_contract"], sender.DEFAULT_SECRET_NAME)
        dumped = json.dumps(route)
        self.assertNotIn("tok-primary", dumped)
        self.assertNotIn("tok-alias", dumped)
        self.assertNotIn("chat-primary", dumped)

    def test_token_alias_tg_when_primary_absent(self):
        env = _clear_route_env(os.environ)
        env["TG_TOKEN"] = "tok-alias-only"
        env["GLOBAL_TELEGRAM_CHAT_ID"] = "chat-legacy"
        with mock.patch.dict(os.environ, env, clear=True):
            route = sender.diagnose_telegram_route()
        self.assertEqual(route["token_source_kind"], "env:TG_TOKEN")
        self.assertTrue(route["token_alias_used"])
        self.assertEqual(route["chat_source_kind"], "env:GLOBAL_TELEGRAM_CHAT_ID")
        self.assertTrue(route["chat_alias_used"])

    def test_chat_priority_qsl_global_shadows_legacy(self):
        env = _clear_route_env(os.environ)
        env["TELEGRAM_TOKEN"] = "tok"
        env["QSL_GLOBAL_TELEGRAM_CHAT_ID"] = "chat-a"
        env["GLOBAL_TELEGRAM_CHAT_ID"] = "chat-b"
        env["STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS"] = "chat-c,chat-d"
        with mock.patch.dict(os.environ, env, clear=True):
            route = sender.diagnose_telegram_route()
        self.assertEqual(route["chat_source_kind"], "env:QSL_GLOBAL_TELEGRAM_CHAT_ID")
        self.assertFalse(route["chat_alias_used"])
        self.assertIn(
            "chat_env_shadowed:GLOBAL_TELEGRAM_CHAT_ID_present_but_QSL_GLOBAL_TELEGRAM_CHAT_ID_wins",
            route["warnings"],
        )
        self.assertIn(
            "chat_env_shadowed:STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS_present_but_QSL_GLOBAL_TELEGRAM_CHAT_ID_wins",
            route["warnings"],
        )

    def test_plugin_chat_first_of_many_warns(self):
        env = _clear_route_env(os.environ)
        env["TELEGRAM_TOKEN"] = "tok"
        env["STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS"] = "c1,c2,c3"
        with mock.patch.dict(os.environ, env, clear=True):
            route = sender.diagnose_telegram_route()
        self.assertEqual(
            route["chat_source_kind"], "env:STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS"
        )
        self.assertTrue(route["chat_alias_used"])
        self.assertIn(
            "chat_multi_id_list_first_only:STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS_count=3",
            route["warnings"],
        )

    def test_unprobed_gcp_fallback_kind_without_missing_when_contract_present(self):
        env = _clear_route_env(os.environ)
        env["QSL_GLOBAL_TELEGRAM_CHAT_ID"] = "chat-only"
        with mock.patch.dict(os.environ, env, clear=True):
            route = sender.diagnose_telegram_route(probe_secret_manager=False)
        self.assertEqual(route["token_source_kind"], "gcp_secret_manager_unprobed")
        self.assertEqual(route["missing"], [])
        self.assertEqual(route["secret_name_contract"], sender.DEFAULT_SECRET_NAME)

    def test_probe_secret_manager_success_and_discards_value(self):
        env = _clear_route_env(os.environ)
        env["QSL_GLOBAL_TELEGRAM_CHAT_ID"] = "chat-only"
        with mock.patch.dict(os.environ, env, clear=True):
            with mock.patch.object(
                sender, "_load_token_from_secret_manager", return_value="sm-secret-value"
            ) as load:
                route = sender.diagnose_telegram_route(probe_secret_manager=True)
        load.assert_called_once()
        self.assertEqual(route["token_source_kind"], "gcp_secret_manager")
        self.assertFalse(route["token_alias_used"])
        dumped = json.dumps(route)
        self.assertNotIn("sm-secret-value", dumped)

    def test_unused_plugin_bot_token_alias_warns(self):
        env = _clear_route_env(os.environ)
        env["TELEGRAM_TOKEN"] = "tok"
        env["QSL_GLOBAL_TELEGRAM_CHAT_ID"] = "chat"
        env["STRATEGY_PLUGIN_ALERT_TELEGRAM_BOT_TOKEN"] = "plugin-tok"
        with mock.patch.dict(os.environ, env, clear=True):
            route = sender.diagnose_telegram_route()
        self.assertIn(
            "token_alias_present_but_not_in_sender_chain:STRATEGY_PLUGIN_ALERT_TELEGRAM_BOT_TOKEN",
            route["warnings"],
        )
        self.assertNotIn("plugin-tok", json.dumps(route))

    def test_secret_name_override_warns_when_differs(self):
        env = _clear_route_env(os.environ)
        env["TELEGRAM_TOKEN"] = "tok"
        env["QSL_GLOBAL_TELEGRAM_CHAT_ID"] = "chat"
        env["TELEGRAM_TOKEN_SECRET_NAME"] = "legacy-platform-telegram-token"
        with mock.patch.dict(os.environ, env, clear=True):
            route = sender.diagnose_telegram_route()
        self.assertEqual(route["secret_name_contract"], "legacy-platform-telegram-token")
        self.assertFalse(route["secret_name_matches_default_contract"])
        self.assertTrue(
            any(
                w.startswith("telegram_token_secret_name_differs_from_contract:")
                for w in route["warnings"]
            )
        )

    def test_chat_fingerprint_default_off(self):
        env = _clear_route_env(os.environ)
        env["TELEGRAM_TOKEN"] = "tok"
        env["QSL_GLOBAL_TELEGRAM_CHAT_ID"] = "1234567890"
        with mock.patch.dict(os.environ, env, clear=True):
            route = sender.diagnose_telegram_route()
            routed = sender.diagnose_telegram_route(include_chat_fingerprint=True)
        self.assertNotIn("chat_fingerprint", route)
        self.assertIn("chat_fingerprint", routed)
        self.assertIn("last4=7890", routed["chat_fingerprint"])
        self.assertNotIn("1234567890", routed["chat_fingerprint"])

    def test_route_check_cli_writes_receipt_without_secrets(self):
        env = _clear_route_env(os.environ)
        env["TG_TOKEN"] = "tok-alias"
        env["GLOBAL_TELEGRAM_CHAT_ID"] = "chat-legacy"
        with tempfile.TemporaryDirectory() as tmp:
            receipt_path = Path(tmp) / "route-receipt.json"
            with mock.patch.dict(os.environ, env, clear=True):
                code = sender.main(
                    ["--route-check", "--write-receipt", str(receipt_path)]
                )
            self.assertEqual(code, 0)
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        self.assertEqual(receipt["status"], "route_check")
        self.assertEqual(receipt["token_source_kind"], "env:TG_TOKEN")
        self.assertEqual(receipt["chat_source_kind"], "env:GLOBAL_TELEGRAM_CHAT_ID")
        self.assertTrue(receipt["token_alias_used"])
        self.assertTrue(receipt["chat_alias_used"])
        self.assertEqual(
            receipt["secret_name_contract"], sender.DEFAULT_SECRET_NAME
        )
        dumped = json.dumps(receipt)
        self.assertNotIn("tok-alias", dumped)
        self.assertNotIn("chat-legacy", dumped)
        self.assertIn("warnings", receipt)
        self.assertIn("route_diagnosis", receipt)

    def test_dry_run_receipt_includes_route_fields(self):
        env = _clear_route_env(os.environ)
        env["TELEGRAM_TOKEN"] = "synthetic-bot-token-xyz"
        env["QSL_GLOBAL_TELEGRAM_CHAT_ID"] = "999888777"
        with tempfile.TemporaryDirectory() as tmp:
            receipt_path = Path(tmp) / "dry.json"
            with mock.patch.dict(os.environ, env, clear=True):
                code = sender.main(
                    [
                        "--dry-run",
                        "--no-github",
                        "--business-day",
                        "2026-10-08",
                        "--locale",
                        "en",
                        "--write-receipt",
                        str(receipt_path),
                    ]
                )
            self.assertEqual(code, 0)
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        self.assertEqual(receipt["status"], "dry_run")
        self.assertEqual(receipt["token_source_kind"], "env:TELEGRAM_TOKEN")
        self.assertEqual(receipt["chat_source_kind"], "env:QSL_GLOBAL_TELEGRAM_CHAT_ID")
        dumped = json.dumps(receipt)
        self.assertNotIn("synthetic-bot-token-xyz", dumped)
        self.assertNotIn("999888777", dumped)


if __name__ == "__main__":
    unittest.main()
