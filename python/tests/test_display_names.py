import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import json
import unittest
from dataclasses import asdict
from unittest.mock import patch
from daily_digest_notify import DigestRunEntry, _display_strategy, account_block_tag
from unified_daily_digest import render
from daily_digest_notify import DailyDigestInput
from build_display_names import outputs


class DisplayNamesTests(unittest.TestCase):
    def test_stale_producer_label_is_display_only(self):
        row = DigestRunEntry(platform_id="binance", account_hint="crypto_combo", strategy_profile="crypto_live_pool_rotation", strategy_label="Old name", order_count=1, fill_count=1)
        before = asdict(row)
        self.assertEqual(_display_strategy(row, "en"), "Crypto Pool Rotation")
        self.assertEqual(_display_strategy(row, "zh"), "加密池轮动")
        self.assertEqual(account_block_tag(row), "binance live")
        text = render(DailyDigestInput(business_day="2026-10-16", runs=(row,)))
        self.assertIn("Binance / live / 加密池轮动 / Crypto Pool Rotation", text)
        self.assertNotIn("Old name", text)
        self.assertEqual(asdict(row), before)

    def test_override_and_unknown_profile(self):
        row = DigestRunEntry(platform_id="other", strategy_profile="custom", strategy_label="My label")
        self.assertEqual(_display_strategy(row, "en"), "My label")
        with patch.dict("os.environ", {"QSL_DISPLAY_NAMES_JSON": json.dumps({"strategies": {"custom": {"en": "ETF-Rotation-202610"}}})}):
            self.assertEqual(_display_strategy(row, "en"), "ETF-Rotation-202610")
        self.assertEqual(row.strategy_profile, "custom")

    def test_checked_in_snapshots_match_authority(self):
        for path, expected in outputs().items():
            self.assertEqual(path.read_text(), expected, str(path))
