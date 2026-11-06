"""Unified display contract using synthetic producer evidence only."""
import hashlib
import json
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from test_notification_consolidation import ON, build, candidate
from unified_daily_digest import render


class OperatorFormatTests(unittest.TestCase):
    def test_six_sources_and_five_sections_remain_visible_on_idle_day(self):
        _, text, _, _ = build([candidate()])
        for section in ("结果", "范围", "证据", "覆盖", "下一步"):
            self.assertIn(f"【{section}】", text)
        for platform in ("IBKR", "Schwab", "Firstrade", "LongBridge", "Binance", "管理站"):
            self.assertIn(platform, text)
        self.assertIn("未纳入本期汇总，运行状态未知", text)
        self.assertIn("已核验目标无交易", text)
        self.assertNotIn("全部账号无交易", text)

    def test_unknown_counts_are_not_zero_and_locale_keeps_the_same_facts(self):
        p, _, _, receipt = build([candidate(order_count=None, fill_count=None,
            field_status={"order_count": "unknown", "fill_count": "unknown", "cycle_count": "known"})])
        for locale in ("zh", "en"):
            with self.subTest(locale=locale), patch.dict("os.environ", ON, clear=True):
                text = render(replace(p, locale=locale))
                self.assertIn("全窗口统计未知" if locale == "zh" else "whole-window count unknown", text)
                self.assertNotIn("订单：0" if locale == "zh" else "Orders: 0", text)
                self.assertIn("【下一步】" if locale == "zh" else "[Next step]", text)
        self.assertIsNone(receipt["total_fills"])

    def test_presentation_snapshot_matches_its_separate_source_manifest(self):
        root = Path(__file__).resolve().parents[1] / "scripts/notification_snapshot"
        source = json.loads((root / "presentation-source.json").read_text())
        self.assertEqual(source["repository"], "QuantStrategyLab/QuantPlatformKit")
        self.assertRegex(source["commit"], r"^[a-f0-9]{40}$")
        self.assertRegex(source["upstream_sha256"], r"^[a-f0-9]{64}$")
        self.assertIn("account context", source["local_changes"])
        self.assertEqual(hashlib.sha256((root / "presentation.py").read_bytes()).hexdigest(), source["sha256"])
