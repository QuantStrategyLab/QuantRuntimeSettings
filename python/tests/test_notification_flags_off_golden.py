"""Main-head output/call recordings; all delivery boundaries are fakes."""
import hashlib
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import daily_digest_aggregator as aggregator
import daily_digest_resend_guard as guard
import send_daily_digest_telegram as sender
from test_daily_digest_ux import config

GOLDEN = Path(__file__).with_name("fixtures") / "notification_main_golden.json"
DAY = "2026-10-15"


def record_main_behavior(flag=None):
    records = {}
    for mode in ("immediate", "daily_digest"):
        for locale in ("zh", "en"):
            for layout in ("v1", "sections_v2"):
                for scenario in ("idle", "orders", "blocked", "unknown"):
                    row = dict(platform_id="schwab", strategy_profile="synthetic_core",
                               target_id="synthetic-target", opaque_account_uid="synthetic-account",
                               actually_ran=True, business_day=DAY, order_count=0, fill_count=0,
                               cycle_count=1)
                    if scenario == "orders":
                        row.update(order_count=2, fill_count=1, execution_status="executed")
                    elif scenario == "blocked":
                        row.update(status="alert", execution_status="blocked", rebalance_conclusion="blocked",
                                   block_reason=dict(reason_code="strategy_risk_rejected",
                                                     order_submitted_this_run=False))
                    elif scenario == "unknown":
                        row.update(fill_count=None, order_count=None, reason_code="schwab_fills_not_connected")
                    env = {"QSL_ROUTINE_NOTIFICATION_MODE": mode}
                    if flag is not None:
                        env["QRS_UNIFIED_NOTIFICATION_ENABLED"] = flag
                    calls = []

                    def call(name, result):
                        def fake(*args, **kwargs):
                            value = kwargs.get("text")
                            calls.append([name, hashlib.sha256(value.encode()).hexdigest()] if value is not None else [name])
                            return result
                        return fake

                    with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, env, clear=True):
                        path = Path(directory) / "input.json"
                        path.write_text(json.dumps({"runs": [row]}))
                        receipt_path = Path(directory) / "receipt.json"
                        with patch.object(aggregator, "load_platform_config", return_value=config([row])), \
                             patch.object(sender.aggregator, "load_platform_config", return_value=config([row])), \
                             patch.object(guard, "evaluate", return_value=guard.Decision("send", "FIRST_SEND")), \
                             patch.object(guard, "report_date", return_value="2026-10-16"), \
                             patch.object(sender.maintenance.MaintenanceClient, "from_environment", return_value=None), \
                             patch.object(sender, "diagnose_telegram_route", return_value={}), \
                             patch.object(sender, "missing_delivery_requirements", side_effect=call("requirements", [])), \
                             patch.object(sender, "resolve_telegram_token", side_effect=call("token", "synthetic-token")), \
                             patch.object(sender, "resolve_telegram_chat_id", side_effect=call("chat", "synthetic-chat")), \
                             patch.object(sender, "send_telegram_message", side_effect=call("send", True)), \
                             patch.object(sender.maintenance, "send_strict_telegram", side_effect=call("strict_send", True)), \
                             redirect_stdout(io.StringIO()):
                            _, text, _ = aggregator.build_digest_payload(
                                business_day=DAY, locale=locale, layout=layout, candidates_path=path, include_github=False)
                            rc = sender.main(["--business-day", DAY, "--locale", locale, "--layout", layout,
                                              "--candidates", str(path), "--no-github", "--write-receipt", str(receipt_path)])
                        receipt = json.loads(receipt_path.read_text())
                    key = "/".join((mode, locale, layout, scenario))
                    records[key] = dict(render_sha256=hashlib.sha256(text.encode()).hexdigest(), rc=rc, calls=calls,
                                        receipt={name: receipt.get(name) for name in
                                                 ("status", "delivered", "run_count", "total_fills", "languages", "locale")})
    return records


class FlagsOffGoldenTests(unittest.TestCase):
    def test_main_entrypoint_render_and_delivery_calls_unchanged_when_off(self):
        golden = json.loads(GOLDEN.read_text())
        self.assertEqual(golden["source_head"], "782ac485bf8b98aa39600535d8c4197ffa3c7bd0")
        for value in (None, "", "false", "invalid"):
            with self.subTest(flag=value):
                self.assertEqual(record_main_behavior(value), golden["records"])
