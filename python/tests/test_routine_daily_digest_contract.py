"""Offline proof that two producer observations use one bilingual digest send."""

import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import send_daily_digest_telegram as sender  # noqa: E402


class RoutineDailyDigestContractTests(unittest.TestCase):
    def test_one_send_contains_both_accounts_in_zh_cn_and_en(self):
        for locale, conclusion, unknown in (
            ("zh-CN", "无需调仓", "未知"),
            ("en", "No rebalance needed", "unknown"),
        ):
            with self.subTest(locale=locale), tempfile.TemporaryDirectory() as tmp:
                candidates = Path(tmp) / "synthetic-candidates.json"
                candidates.write_text(json.dumps({"runs": [
                    {
                        "platform_id": platform, "strategy_profile": "demo_strategy",
                        "opaque_account_uid": "demo-" + platform,
                        "target_id": platform + "/demo-target", "account_hint": platform + "-demo",
                        "business_day": "2026-10-12", "actually_ran": True,
                        "fill_count": None, "order_count": 0, "cycle_count": 1,
                        "field_status": {"fill_count": "counts_unknown"},
                        "rebalance_kind": "no_rebalance", "rebalance_conclusion": "no_rebalance",
                        "signal_summary": "no_action",
                    }
                    for platform in ("schwab", "ibkr")
                ]}))
                with mock.patch.dict(os.environ, {
                    "TELEGRAM_TOKEN": "synthetic-token", "GLOBAL_TELEGRAM_CHAT_ID": "synthetic-chat",
                }, clear=True), mock.patch.object(sender, "send_telegram_message", return_value=True) as send, redirect_stdout(StringIO()):
                    code = sender.main([
                        "--no-github", "--business-day", "2026-10-12", "--locale", locale,
                        "--candidates", str(candidates),
                    ])
                self.assertEqual(code, 0)
                send.assert_called_once()
                text = send.call_args.kwargs["text"]
                self.assertIn("Schwab", text)
                self.assertIn("IBKR", text)
                self.assertEqual(text.count(conclusion), 2)
                self.assertIn(unknown, text)


if __name__ == "__main__":
    unittest.main()
