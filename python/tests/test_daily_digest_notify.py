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

    def test_empty_runs_without_coverage_is_evidence_unknown(self):
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-08", locale="zh", runs=()
            )
        )
        self.assertIn("心跳", text)
        self.assertIn("证据未知或读取失败", text)
        self.assertNotIn("监测链路心跳正常", text)
        self.assertNotIn("窗口", text)
        self.assertNotIn("通道", text)
        self.assertNotIn("token", text.lower())
        self.assertNotIn("账户总权益", text)
        self.assertNotIn("持仓", text)

    def test_verified_idle_when_coverage_complete(self):
        coverage = daily_digest_notify.EvidenceCoverage(
            candidates_configured=True,
            candidates_loaded=True,
            candidates_count=0,
            github_enabled=True,
            github_sources_queried=3,
            github_sources_matched=0,
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-08",
                locale="zh",
                runs=(),
                evidence_coverage=coverage,
            )
        )
        self.assertIn("已验证无平台/策略实际运行", text)
        self.assertNotIn("监测链路心跳正常", text)
        self.assertNotIn("证据未知", text)

    def test_heartbeat_when_ran_but_verified_zero_fills(self):
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
        self.assertIn("verified zero fills", text.lower())
        self.assertIn("binance", text)
        self.assertEqual(daily_digest_notify.total_fills(runs), 0)

    def test_unknown_fill_count_renders_unknown_not_zero(self):
        runs = (
            daily_digest_notify.DigestRunEntry(
                platform_id="schwab",
                strategy_profile="soxl_soxx_trend_income",
                fill_count=None,
                fill_count_status="unknown",
                order_count=None,
                order_count_status="unknown",
                cycle_count=1,
                cycle_count_status="known",
                reason_code="github_workflow_existence_only",
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-08", locale="zh", runs=runs
            )
        )
        self.assertIn("成交 未知", text)
        self.assertNotIn("无成交", text)
        self.assertIn("成交数未知", text)
        self.assertIsNone(daily_digest_notify.total_fills(runs))

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
        self.assertNotIn("窗口", text)
        self.assertNotIn("通道", text)

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
                target_id="schwab-primary",
                account_scope="live",
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
        self.assertIn("业务日: 2026-10-08", text)
        self.assertNotIn("窗口", text)
        self.assertNotIn("Asia/Shanghai", text)
        self.assertNotIn("通道", text)
        self.assertNotIn("QuantSentinel", text)
        self.assertIn("[schwab live] 💓 【心跳检测】", text)
        self.assertNotIn("[schwab-primary]", text)
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
        self.assertIn("[ibkr U16608560] ⏳ 【待确认】", text)
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
                account_hint="U16608560",
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
        self.assertIn("[ibkr U16608560] ⚠️ 【未下单】", text)
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
                target_id="schwab-primary",
                account_scope="live",
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-08", locale="en", runs=runs
            )
        )
        self.assertIn("Heartbeat", text)
        self.assertIn("[schwab live] 💓 [Heartbeat]", text)
        self.assertNotIn("[schwab-primary]", text)
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
        self.assertEqual(entry.fill_count, 0)
        self.assertEqual(entry.fill_count_status, "known")

    def test_filter_skips_non_runners_and_missing_actually_ran(self):
        rows = daily_digest_notify.filter_runs_for_digest(
            [
                {
                    "platform_id": "firstrade",
                    "strategy_profile": "dca_month_end",
                    "actually_ran": False,
                },
                {
                    "platform_id": "ibkr",
                    "strategy_profile": "soxl_soxx_trend_income",
                    # actually_ran absent → excluded (no default True)
                    "fill_count": 9,
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

    def test_filter_github_stub_counts_unknown(self):
        rows = daily_digest_notify.filter_runs_for_digest(
            [
                {
                    "platform_id": "schwab",
                    "strategy_profile": "soxl_soxx_trend_income",
                    "actually_ran": True,
                    "fill_count": None,
                    "order_count": None,
                    "cycle_count": 1,
                    "field_status": {
                        "fill_count": "counts_unknown",
                        "order_count": "counts_unknown",
                    },
                    "reason_code": "github_workflow_existence_only",
                    "evidence_provenance": "github_workflow_stub",
                }
            ]
        )
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0].fill_count)
        self.assertEqual(rows[0].fill_count_status, "unknown")
        self.assertEqual(rows[0].cycle_count, 1)

    def test_legacy_explicit_zero_remains_known(self):
        rows = daily_digest_notify.filter_runs_for_digest(
            [
                {
                    "platform_id": "binance",
                    "strategy_profile": "crypto_equity_combo",
                    "actually_ran": True,
                    "fill_count": 0,
                    "order_count": 0,
                    "cycle_count": 1,
                    "evidence_provenance": "candidates",
                }
            ]
        )
        self.assertEqual(rows[0].fill_count, 0)
        self.assertEqual(rows[0].fill_count_status, "known")

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
                target_id="schwab-primary",
                opaque_account_uid=(
                    "bf2e669106f029a41e6f36dc18f704906ad6078d1f16a171ec0001e992d39b7d"
                ),
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-08", locale="zh", runs=runs
            )
        )
        self.assertIn("[schwab bf2e6691] 💓 【心跳检测】", text)  # no scope → platform + short uid
        self.assertNotIn("[schwab-primary]", text)
        self.assertIn("半导体趋势收益", text)
        self.assertIn("✅ 无需调仓", text)
        self.assertNotIn("账户总权益", text)
        self.assertNotIn("持仓", text)
        self.assertNotIn("信号", text)

    def test_single_schwab_omits_window_and_channel(self):
        runs = (
            daily_digest_notify.DigestRunEntry(
                platform_id="schwab",
                strategy_profile="soxl_soxx_trend_income",
                strategy_label="半导体趋势收益",
                fill_count=None,
                fill_count_status="unknown",
                equity=989.34,
                rebalance_kind="no_rebalance",
                opaque_account_uid=(
                    "bf2e669106f029a41e6f36dc18f704906ad6078d1f16a171ec0001e992d39b7d"
                ),
                target_id="schwab-primary",
                account_scope="live",
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-09",
                window_label="Asia/Shanghai cron `0 6 * * 2-6`",
                locale="zh",
                runs=runs,
            )
        )
        expected = (
            "📡 量化哨兵 · 心跳\n"
            "业务日: 2026-10-09\n"
            "[schwab live] 💓 【心跳检测】\n"
            "🧭 策略: 半导体趋势收益\n"
            "💰 账户总权益: USD 989.34\n"
            "✅ 无需调仓\n"
            "平台: schwab"
        )
        self.assertEqual(text, expected)

    def test_multi_platform_observation_blocks_separated(self):
        runs = (
            daily_digest_notify.DigestRunEntry(
                platform_id="schwab",
                strategy_profile="soxl_soxx_trend_income",
                strategy_label="半导体趋势收益",
                fill_count=None,
                fill_count_status="unknown",
                equity=989.34,
                rebalance_kind="no_rebalance",
                opaque_account_uid=(
                    "bf2e669106f029a41e6f36dc18f704906ad6078d1f16a171ec0001e992d39b7d"
                ),
                target_id="schwab-primary",
                account_scope="live",
            ),
            daily_digest_notify.DigestRunEntry(
                platform_id="ibkr",
                strategy_profile="tqqq_growth_income",
                strategy_label="纳斯达克增长收益",
                account_hint="U16608560",
                fill_count=0,
                equity=569.16,
                holdings=(
                    daily_digest_notify.DigestHolding(
                        symbol="TQQQ", market_value=312.40, quantity=4
                    ),
                ),
                rebalance_kind="no_rebalance",
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-09",
                window_label="should-not-appear",
                locale="zh",
                runs=runs,
            )
        )
        self.assertNotIn("窗口", text)
        self.assertNotIn("通道", text)
        self.assertNotIn("should-not-appear", text)
        # Header once; each platform block keeps its own strategy/equity/platform.
        self.assertEqual(text.count("量化哨兵 · 心跳"), 1)
        self.assertIn("平台: schwab", text)
        self.assertIn("平台: ibkr", text)
        self.assertIn("🧭 策略: 半导体趋势收益", text)
        self.assertIn("🧭 策略: 纳斯达克增长收益", text)
        self.assertIn("💰 账户总权益: USD 989.34", text)
        self.assertIn("💰 账户总权益: USD 569.16", text)
        self.assertIn("[schwab live] 💓 【心跳检测】", text)
        self.assertIn("[ibkr U16608560] 💓 【心跳检测】", text)
        # Blank line between observation blocks.
        schwab_idx = text.index("平台: schwab")
        ibkr_idx = text.index("[ibkr U16608560]")
        between = text[schwab_idx:ibkr_idx]
        self.assertIn("\n\n", between)
        # Exact multi-platform shape for zh locale — every block has [account] tag.
        expected = (
            "📡 量化哨兵 · 心跳\n"
            "业务日: 2026-10-09\n"
            "[schwab live] 💓 【心跳检测】\n"
            "🧭 策略: 半导体趋势收益\n"
            "💰 账户总权益: USD 989.34\n"
            "✅ 无需调仓\n"
            "平台: schwab\n"
            "\n"
            "[ibkr U16608560] 💓 【心跳检测】\n"
            "🧭 策略: 纳斯达克增长收益\n"
            "💰 账户总权益: USD 569.16\n"
            "💼 持仓\n"
            "- TQQQ: $312.40 / 4股\n"
            "✅ 无需调仓\n"
            "平台: ibkr"
        )
        self.assertEqual(text, expected)

    def test_account_block_tag_preference_order(self):
        hint_wins = daily_digest_notify.DigestRunEntry(
            platform_id="ibkr",
            strategy_profile="tqqq_growth_income",
            account_hint="U16608560",
            account_scope="live",
            opaque_account_uid="aaaaaaaaaaaaaaaa",
            target_id="ibkr-primary",
        )
        self.assertEqual(
            daily_digest_notify.account_block_tag(hint_wins), "ibkr U16608560"
        )
        # Lowercase broker hint normalizes to U######.
        lower_hint = daily_digest_notify.DigestRunEntry(
            platform_id="ibkr",
            strategy_profile="soxl_soxx_trend_income",
            account_hint="u15998061",
            account_scope="live",
        )
        self.assertEqual(
            daily_digest_notify.account_block_tag(lower_hint), "ibkr U15998061"
        )
        # Scope embedding live-u###### → broker id without needing account_hint.
        embedded = daily_digest_notify.DigestRunEntry(
            platform_id="ibkr",
            strategy_profile="soxl_soxx_trend_income",
            account_scope="live-u15998061",
        )
        self.assertEqual(
            daily_digest_notify.account_block_tag(embedded), "ibkr U15998061"
        )
        # Hex-only hint is rejected; platform+scope wins.
        hex_hint = daily_digest_notify.DigestRunEntry(
            platform_id="schwab",
            strategy_profile="soxl_soxx_trend_income",
            account_hint="bf2e669106f029a4",
            account_scope="live",
        )
        self.assertEqual(
            daily_digest_notify.account_block_tag(hex_hint), "schwab live"
        )
        # Universal platform + scope for every venue.
        for platform, scope, expected in (
            ("schwab", "live", "schwab live"),
            ("ibkr", "live", "ibkr live"),
            ("firstrade", "paper", "firstrade paper"),
            ("longbridge", "live", "longbridge live"),
        ):
            entry = daily_digest_notify.DigestRunEntry(
                platform_id=platform,
                strategy_profile="any_strategy",
                account_scope=scope,
                opaque_account_uid=(
                    "bf2e669106f029a41e6f36dc18f704906ad6078d1f16a171ec0001e992d39b7d"
                ),
                target_id=f"{platform}-primary",
            )
            self.assertEqual(
                daily_digest_notify.account_block_tag(entry), expected
            )
        mode_wins = daily_digest_notify.DigestRunEntry(
            platform_id="ibkr",
            strategy_profile="tqqq_growth_income",
            execution_mode="paper",
            target_id="ibkr-primary",
        )
        self.assertEqual(
            daily_digest_notify.account_block_tag(mode_wins), "ibkr paper"
        )
        uid_beats_target = daily_digest_notify.DigestRunEntry(
            platform_id="schwab",
            strategy_profile="soxl_soxx_trend_income",
            opaque_account_uid=(
                "bf2e669106f029a41e6f36dc18f704906ad6078d1f16a171ec0001e992d39b7d"
            ),
            target_id="schwab-primary",
        )
        self.assertEqual(
            daily_digest_notify.account_block_tag(uid_beats_target), "schwab bf2e6691"
        )
        target_last = daily_digest_notify.DigestRunEntry(
            platform_id="schwab",
            strategy_profile="soxl_soxx_trend_income",
            target_id="schwab-primary",
        )
        self.assertEqual(
            daily_digest_notify.account_block_tag(target_last), "schwab schwab-primary"
        )
        empty = daily_digest_notify.DigestRunEntry(
            platform_id="schwab", strategy_profile="soxl_soxx_trend_income"
        )
        self.assertEqual(daily_digest_notify.account_block_tag(empty), "")

    def test_trade_success_observation_block_zh(self):
        """Filled rebalance: 收盘日报 + [account] + 调仓指令 + conclusion."""
        runs = (
            daily_digest_notify.DigestRunEntry(
                platform_id="ibkr",
                strategy_profile="tqqq_growth_income",
                strategy_label="纳斯达克增长收益",
                account_hint="U16608560",
                fill_count=1,
                order_count=1,
                equity=569.16,  # fixture (not live)
                holdings=(
                    daily_digest_notify.DigestHolding(
                        symbol="TQQQ", market_value=312.40, quantity=4
                    ),
                ),
                rebalance_kind="rebalance",
                rebalance_conclusion=(
                    "✅ 成交成功 1个标的: TQQQ 1\n"
                    "📈 [市价买入] TQQQ: 1股 ✅ 已成交（状态: Filled）"
                ),
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-09",
                window_label="must-not-appear",
                locale="zh",
                runs=runs,
            )
        )
        expected = (
            "📡 量化哨兵 · 收盘日报\n"
            "业务日: 2026-10-09\n"
            "[ibkr U16608560] 🔔 【调仓指令】\n"
            "🧭 策略: 纳斯达克增长收益\n"
            "💰 账户总权益: USD 569.16\n"
            "💼 持仓\n"
            "- TQQQ: $312.40 / 4股\n"
            "✅ 成交成功 1个标的: TQQQ 1\n"
            "📈 [市价买入] TQQQ: 1股 ✅ 已成交（状态: Filled）\n"
            "平台: ibkr"
        )
        self.assertEqual(text, expected)
        self.assertNotIn("窗口", text)
        self.assertNotIn("通道", text)

    def test_trade_success_default_fills_conclusion(self):
        """Known fills without producer conclusion → default ✅ 成交 N."""
        runs = (
            daily_digest_notify.DigestRunEntry(
                platform_id="schwab",
                strategy_profile="soxl_soxx_trend_income",
                strategy_label="半导体趋势收益",
                target_id="schwab-primary",
                opaque_account_uid=(
                    "bf2e669106f029a41e6f36dc18f704906ad6078d1f16a171ec0001e992d39b7d"
                ),
                account_scope="live",
                fill_count=2,
                order_count=2,
                equity=989.34,  # live-known equity reused for illustration
                holdings=(
                    daily_digest_notify.DigestHolding(
                        symbol="SOXL", market_value=700.00, quantity=5
                    ),
                ),
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-09", locale="zh", runs=runs
            )
        )
        self.assertIn("收盘日报", text)
        self.assertIn("[schwab live] 🔔 【调仓指令】", text)
        self.assertIn("✅ 成交 2", text)
        self.assertNotIn("窗口", text)
        self.assertNotIn("通道", text)

    def test_multi_heartbeat_plus_fills_uses_digest_title(self):
        """Mixed: unknown-fill heartbeat + known fills → 收盘日报; both tagged."""
        runs = (
            daily_digest_notify.DigestRunEntry(
                platform_id="schwab",
                strategy_profile="soxl_soxx_trend_income",
                strategy_label="半导体趋势收益",
                target_id="schwab-primary",
                opaque_account_uid=(
                    "bf2e669106f029a41e6f36dc18f704906ad6078d1f16a171ec0001e992d39b7d"
                ),
                account_scope="live",
                fill_count=None,
                fill_count_status="unknown",
                equity=989.34,
                rebalance_kind="no_rebalance",
            ),
            daily_digest_notify.DigestRunEntry(
                platform_id="ibkr",
                strategy_profile="tqqq_growth_income",
                strategy_label="纳斯达克增长收益",
                account_hint="U16608560",
                fill_count=1,
                order_count=1,
                equity=569.16,  # fixture
                holdings=(
                    daily_digest_notify.DigestHolding(
                        symbol="TQQQ", market_value=312.40, quantity=4
                    ),
                ),
                rebalance_kind="rebalance",
                rebalance_conclusion="✅ 成交成功 1个标的: TQQQ 1",
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-09", locale="zh", runs=runs
            )
        )
        self.assertTrue(daily_digest_notify.has_known_positive_fills(runs))
        # total_fills stays None (schwab unknown), but title still 收盘日报.
        self.assertIsNone(daily_digest_notify.total_fills(runs))
        expected = (
            "📡 量化哨兵 · 收盘日报\n"
            "业务日: 2026-10-09\n"
            "[schwab live] 💓 【心跳检测】\n"
            "🧭 策略: 半导体趋势收益\n"
            "💰 账户总权益: USD 989.34\n"
            "✅ 无需调仓\n"
            "平台: schwab\n"
            "\n"
            "[ibkr U16608560] 🔔 【调仓指令】\n"
            "🧭 策略: 纳斯达克增长收益\n"
            "💰 账户总权益: USD 569.16\n"
            "💼 持仓\n"
            "- TQQQ: $312.40 / 4股\n"
            "✅ 成交成功 1个标的: TQQQ 1\n"
            "平台: ibkr"
        )
        self.assertEqual(text, expected)

    def test_multi_platform_scope_tags_universal(self):
        """Every venue uses ``[platform scope]`` when scope is known (no hardcode)."""
        runs = (
            daily_digest_notify.DigestRunEntry(
                platform_id="schwab",
                strategy_profile="soxl_soxx_trend_income",
                strategy_label="半导体趋势收益",
                account_scope="live",
                equity=989.34,
                rebalance_kind="no_rebalance",
            ),
            daily_digest_notify.DigestRunEntry(
                platform_id="ibkr",
                strategy_profile="tqqq_growth_income",
                strategy_label="纳斯达克增长收益",
                # no account_hint / no embedded U-id → platform+scope
                account_scope="live",
                equity=569.16,
                rebalance_kind="no_rebalance",
            ),
            daily_digest_notify.DigestRunEntry(
                platform_id="firstrade",
                strategy_profile="dca_month_end",
                strategy_label="月末定投",
                execution_mode="paper",
                equity=100.0,
                rebalance_kind="no_rebalance",
            ),
        )
        text = daily_digest_notify.render_daily_digest(
            daily_digest_notify.DailyDigestInput(
                business_day="2026-10-09", locale="zh", runs=runs
            )
        )
        self.assertIn("[schwab live] 💓 【心跳检测】", text)
        self.assertIn("[ibkr live] 💓 【心跳检测】", text)
        self.assertIn("[firstrade paper] 💓 【心跳检测】", text)
        self.assertNotIn("[bf2e6691]", text)
        self.assertNotIn("[schwab-primary]", text)
        self.assertNotIn("[live]", text)  # bare scope alone is not the tag

    def test_identity_key_includes_account_and_target(self):



        a = daily_digest_notify.identity_key(
            {
                "platform_id": "schwab",
                "strategy_profile": "soxl_soxx_trend_income",
                "opaque_account_uid": "uid-a",
                "target_id": "schwab/a",
            }
        )
        b = daily_digest_notify.identity_key(
            {
                "platform_id": "schwab",
                "strategy_profile": "soxl_soxx_trend_income",
                "opaque_account_uid": "uid-b",
                "target_id": "schwab/b",
            }
        )
        self.assertNotEqual(a, b)
        unknown = daily_digest_notify.identity_key(
            {
                "platform_id": "schwab",
                "strategy_profile": "soxl_soxx_trend_income",
            }
        )
        self.assertEqual(unknown[2], daily_digest_notify.UNKNOWN_ACCOUNT_UID)
        self.assertEqual(unknown[3], daily_digest_notify.UNKNOWN_TARGET_ID)


if __name__ == "__main__":
    unittest.main()
