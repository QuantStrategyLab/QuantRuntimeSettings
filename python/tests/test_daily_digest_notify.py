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
        self.assertNotIn("账户总权益", text)
        self.assertNotIn("持仓", text)

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

    def test_rich_heartbeat_matches_legacy_schwab_fields(self):
        runs = (
            daily_digest_notify.DigestRunEntry(
                platform_id="schwab",
                strategy_profile="soxl_soxx_trend_income",
                strategy_label="半导体趋势收益",
                cycle_count=1,
                fill_count=0,
                equity=990.06,
                holdings=(
                    daily_digest_notify.DigestHolding(
                        symbol="SOXL", market_value=635.92, quantity=4
                    ),
                ),
                signal_summary="SOXX 站上 140 日门槛线，持有 SOXL 70.0% + SOXX 20.0%",
                rebalance_kind="no_rebalance",
                tips=(
                    "净值 $990 低于建议 $1,000；整数股和最小仓位限制可能导致实盘无法完全复现回测",
                ),
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-08",
                window_label="Asia/Shanghai cron `0 6 * * 2-6`",
                locale="zh",
                runs=runs,
            )
        )
        self.assertIn("量化哨兵 · 心跳", text)
        self.assertIn("💓 【心跳检测】", text)
        self.assertIn("🧭 策略: 半导体趋势收益", text)
        self.assertIn("💰 账户总权益: USD 990.06", text)
        self.assertIn("💼 持仓", text)
        self.assertIn("- SOXL: $635.92 / 4股", text)
        self.assertIn("🎯 信号: SOXX 站上 140 日门槛线", text)
        self.assertIn("小账户提示", text)
        self.assertIn("✅ 无需调仓", text)
        self.assertIn("平台: schwab", text)
        self.assertNotIn("今日有运行但无成交", text)

    def test_rich_rebalance_block_ibkr_style(self):
        runs = (
            daily_digest_notify.DigestRunEntry(
                platform_id="ibkr",
                strategy_profile="tqqq_growth_income",
                strategy_label="纳斯达克增长收益",
                account_hint="U16608560",
                fill_count=1,
                order_count=1,
                equity=569.16,
                holdings=(
                    daily_digest_notify.DigestHolding(
                        symbol="TQQQ", market_value=312.40, quantity=4
                    ),
                ),
                rebalance_kind="pending",
                rebalance_conclusion=(
                    "⏳ 卖单待券商最终确认 1个标的: TQQQ 1\n"
                    "📉 [市价卖出] TQQQ: 1股 ✅ 已下发（状态: PendingSubmit），"
                    "尚未确认券商接受或成交，仍可能被拒单或取消；"
                    "DAY 限价单若收盘未成交会自动取消（订单号: 21）"
                ),
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-08", locale="zh", runs=runs
            )
        )
        self.assertIn("收盘日报", text)
        self.assertIn("[U16608560] ⏳ 【待确认】", text)
        self.assertIn("纳斯达克增长收益", text)
        self.assertIn("USD 569.16", text)
        self.assertIn("TQQQ: $312.40 / 4股", text)
        self.assertIn("PendingSubmit", text)

    def test_no_order_reason_renders(self):
        runs = (
            daily_digest_notify.DigestRunEntry(
                platform_id="ibkr",
                strategy_profile="tqqq_growth_income",
                strategy_label="纳斯达克增长收益",
                equity=572.93,
                holdings=(
                    daily_digest_notify.DigestHolding(
                        symbol="TQQQ", market_value=234.30, quantity=3
                    ),
                ),
                rebalance_kind="no_order",
                rebalance_conclusion="未下单: 原因=低于最小订单金额:TQQQ",
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-08", locale="zh", runs=runs
            )
        )
        self.assertIn("⚠️ 【未下单】", text)
        self.assertIn("低于最小订单金额:TQQQ", text)

    def test_english_observation_labels(self):
        runs = (
            daily_digest_notify.DigestRunEntry(
                platform_id="schwab",
                strategy_profile="soxl_soxx_trend_income",
                strategy_label="Semiconductor Trend Income",
                equity=990.06,
                holdings=(
                    daily_digest_notify.DigestHolding(
                        symbol="SOXL", market_value=635.92, quantity=4
                    ),
                ),
                signal_summary="SOXX above 140d threshold",
                rebalance_kind="no_rebalance",
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-08", locale="en", runs=runs
            )
        )
        self.assertIn("Heartbeat", text)
        self.assertIn("Account equity: USD 990.06", text)
        self.assertIn("4sh", text)
        self.assertIn("No rebalance needed", text)

    def test_filter_parses_observation_fields(self):
        rows = daily_digest_notify.filter_runs_for_digest(
            [
                {
                    "platform_id": "firstrade",
                    "strategy_profile": "dca_month_end",
                    "actually_ran": False,
                    "equity": 9999,
                },
                {
                    "platform_id": "schwab",
                    "strategy_profile": "soxl_soxx_trend_income",
                    "actually_ran": True,
                    "fill_count": 0,
                    "strategy_label": "半导体趋势收益",
                    "equity": 990.06,
                    "holdings": [
                        {"symbol": "SOXL", "market_value": 635.92, "qty": 4}
                    ],
                    "signal_summary": "hold SOXL",
                    "rebalance_kind": "no_rebalance",
                    "tips": ["small account"],
                },
            ]
        )
        self.assertEqual(len(rows), 1)
        entry = rows[0]
        self.assertEqual(entry.platform_id, "schwab")
        self.assertEqual(entry.equity, 990.06)
        self.assertEqual(entry.holdings[0].symbol, "SOXL")
        self.assertEqual(entry.holdings[0].quantity, 4)
        self.assertTrue(daily_digest_notify.has_observation(entry))

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

    def test_omits_missing_observation_fields(self):
        runs = (
            daily_digest_notify.DigestRunEntry(
                platform_id="schwab",
                strategy_profile="soxl_soxx_trend_income",
                strategy_label="半导体趋势收益",
                rebalance_kind="no_rebalance",
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-08", locale="zh", runs=runs
            )
        )
        self.assertIn("半导体趋势收益", text)
        self.assertIn("✅ 无需调仓", text)
        self.assertNotIn("账户总权益", text)
        self.assertNotIn("持仓", text)
        self.assertNotIn("信号", text)


if __name__ == "__main__":
    unittest.main()
