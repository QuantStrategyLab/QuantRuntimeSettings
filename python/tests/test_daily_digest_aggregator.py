from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def _load_module(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


aggregator = _load_module("daily_digest_aggregator")
sender = _load_module("send_daily_digest_telegram")


class DailyDigestAggregatorTests(unittest.TestCase):
    def test_business_day_uses_new_york_calendar(self):
        # Monday 22:00 UTC == Monday evening America/New_York (EDT).
        stamp = datetime(2026, 10, 5, 22, 0, tzinfo=ZoneInfo("UTC"))
        self.assertEqual(
            aggregator.resolve_business_day(now=stamp),
            "2026-10-05",
        )

    def test_empty_evidence_renders_heartbeat(self):
        payload, text = aggregator.build_digest_payload(
            business_day="2026-10-08",
            locale="zh",
            include_github=False,
        )
        self.assertEqual(payload.runs, ())
        self.assertIn("心跳", text)
        self.assertIn("无平台/策略实际运行", text)

    def test_candidates_file_only_includes_actual_runners(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "candidates.json"
            path.write_text(
                json.dumps(
                    {
                        "runs": [
                            {
                                "platform_id": "ibkr",
                                "strategy_profile": "soxl_soxx_trend_income",
                                "actually_ran": True,
                                "fill_count": 2,
                                "order_count": 2,
                            },
                            {
                                "platform_id": "firstrade",
                                "strategy_profile": "dca_month_end",
                                "actually_ran": False,
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )
            payload, text = aggregator.build_digest_payload(
                business_day="2026-10-08",
                locale="zh",
                candidates_path=path,
                include_github=False,
            )
            self.assertEqual(len(payload.runs), 1)
            self.assertEqual(payload.runs[0].platform_id, "ibkr")
            self.assertIn("收盘日报", text)
            self.assertNotIn("firstrade", text)

    def test_merge_prefers_rows_with_counts(self):
        merged = aggregator.merge_candidates(
            [
                {
                    "platform_id": "binance",
                    "strategy_profile": "crypto_equity_combo",
                    "actually_ran": True,
                    "cycle_count": 1,
                    "fill_count": 0,
                    "note": "github_workflow:x.yml",
                }
            ],
            [
                {
                    "platform_id": "binance",
                    "strategy_profile": "crypto_equity_combo",
                    "actually_ran": True,
                    "cycle_count": 4,
                    "fill_count": 1,
                    "note": "producer",
                }
            ],
        )
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["fill_count"], 1)
        self.assertEqual(merged[0]["note"], "producer")

    def test_allowlist_loaded_from_platform_config(self):
        config = aggregator.load_platform_config()
        rows = aggregator.default_workflow_allowlist(config)
        self.assertTrue(any(row["platform_id"] == "longbridge" for row in rows))
        self.assertTrue(all(row["repository"].startswith("QuantStrategyLab/") for row in rows))

    def test_sender_dry_run_does_not_require_secrets(self):
        code = sender.main(
            [
                "--dry-run",
                "--no-github",
                "--business-day",
                "2026-10-08",
                "--locale",
                "en",
            ]
        )
        self.assertEqual(code, 0)


class DailyDigestWorkflowContractTests(unittest.TestCase):
    def test_workflow_schedule_matches_shanghai_post_close(self):
        workflow = (
            Path(__file__).resolve().parents[2]
            / "docs/workflows/daily-digest-notify.yml"
        ).read_text(encoding="utf-8")
        self.assertIn('cron: "0 22 * * 1-5"', workflow)
        self.assertIn("Asia/Shanghai", workflow)
        self.assertIn("workflow_dispatch", workflow)
        self.assertIn("quant-sentinel-telegram-bot-token", workflow)
        self.assertIn("runtime-strategy-switch", workflow)
        self.assertIn("send_daily_digest_telegram.py", workflow)
        self.assertNotIn("api.telegram.org/bot", workflow)
        self.assertIn("dry_run", workflow)


if __name__ == "__main__":
    unittest.main()
