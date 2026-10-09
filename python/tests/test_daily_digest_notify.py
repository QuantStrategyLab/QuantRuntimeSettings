from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def _load_module(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


daily_digest_notify = _load_module("daily_digest_notify")


class DailyDigestNotifyTests(unittest.TestCase):
    def test_locale_normalization(self):
        self.assertEqual(daily_digest_notify.normalize_locale("zh-CN"), "zh")
        self.assertEqual(daily_digest_notify.normalize_locale("en-US"), "en")
        self.assertEqual(daily_digest_notify.normalize_locale(None), "zh")

    def test_heartbeat_when_nothing_ran(self):
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-08", locale="zh", runs=()
            )
        )
        self.assertIn("心跳", text)
        self.assertIn("无平台/策略实际运行", text)
        self.assertIn("QuantSentinel", text)
        self.assertNotIn("token", text.lower())

    def test_heartbeat_when_ran_but_no_fills(self):
        runs = (
            daily_digest_notify.DigestRunEntry(
                "binance", "crypto_equity_combo", cycle_count=3, fill_count=0
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-08", locale="en", runs=runs
            )
        )
        self.assertIn("Heartbeat", text)
        self.assertIn("no fills", text)
        self.assertIn("binance", text)
        self.assertEqual(daily_digest_notify.total_fills(runs), 0)

    def test_digest_lists_only_provided_runners(self):
        runs = (
            daily_digest_notify.DigestRunEntry(
                "ibkr", "soxl_soxx_trend_income", fill_count=2, order_count=2
            ),
            daily_digest_notify.DigestRunEntry(
                "binance", "crypto_equity_combo", fill_count=1, cycle_count=4
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-08",
                window_label="Asia/Shanghai 06:00",
                locale="zh",
                runs=runs,
            )
        )
        self.assertIn("收盘日报", text)
        self.assertIn("ibkr", text)
        self.assertIn("binance", text)
        self.assertNotIn("firstrade", text)
        self.assertIn("成交 2", text)

    def test_filter_skips_non_runners(self):
        rows = daily_digest_notify.filter_runs_for_digest(
            [
                {
                    "platform_id": "firstrade",
                    "strategy_profile": "dca_month_end",
                    "actually_ran": False,
                },
                {
                    "platform_id": "schwab",
                    "strategy_profile": "soxl_soxx_trend_income",
                    "actually_ran": True,
                    "fill_count": 1,
                },
            ]
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].platform_id, "schwab")

    def test_rejects_blank_ids(self):
        with self.assertRaises(ValueError):
            daily_digest_notify.DigestRunEntry("", "x")


if __name__ == "__main__":
    unittest.main()
