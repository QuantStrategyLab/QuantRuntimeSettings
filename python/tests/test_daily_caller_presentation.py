"""Exercise the authenticated caller with synthetic protected candidates."""
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
import unittest

import cloud_run_daily_digest as app
from account_daily_digest import render_account_daily
from daily_digest_notify import DailyDigestInput, DigestRunEntry
import test_cloud_run_daily_digest as caller_fixture
from test_cloud_run_daily_digest import EXPECTED, MemoryStore, ROW
from test_daily_digest_ux import config

DAY = ROW["business_day"]
TIME = "2026-10-16T05:10:00+08:00"
NO_REPORT_TECH = ("【结果】", "【覆盖】", "[Result]", "[Coverage]", "https://", "运行链接")


def record(kind, **updates):
    return {"id": kind, "symbol": "TQQQ", "side": "buy", "quantity": 3, "asset_type": "stock",
            "currency": "USD", "occurred_at": TIME, **updates}


def with_facts(row, **facts):
    result = {**row, "account_daily_facts": facts}
    result.pop("notification_event", None)
    return result


def snapshot(**updates):
    return {"as_of": TIME, "equity": 50000, "equity_currency": "USD", "holdings_scope": "account",
            "holdings_complete": True, "holdings": [{"symbol": "TQQQ", "quantity": 300, "asset_type": "stock"}],
            **updates}


class DailyCallerPresentationTests(unittest.TestCase):
    setUp = caller_fixture.CloudRunDigestTests.setUp
    run_request = caller_fixture.CloudRunDigestTests.run_request
    send = caller_fixture.CloudRunDigestTests.send
    enable = caller_fixture.CloudRunDigestTests.enable

    def report(self, rows, outcomes, *, locale="zh", expected=EXPECTED, stale=()):
        configuration = replace(self.configuration, locale=locale, expected=expected)
        text, coverage = app._report(configuration, rows, outcomes, DAY, config(expected), stale_observations=stale)
        for token in NO_REPORT_TECH:
            self.assertNotIn(token, text)
        self.assertLessEqual(len(text.encode("utf-16-le")) // 2, 3850)
        return text, coverage

    def test_one_order_three_distinct_fills_in_both_languages_through_real_sender(self):
        fills = [record(f"fill-{i}", order_id="order", quantity=1, price=60 + i) for i in range(3)]
        order = record("order", status="filled", filled_quantity=3, remaining_quantity=0)
        item = with_facts({**ROW, "order_count": 1, "fill_count": 3, "source_run_id": "https://example.invalid/private"},
                          orders=[order], fills=[*fills, fills[0]], snapshots=[snapshot()])
        for locale, header, order_count, fill_count, holding in (
            ("zh", "📊 昨日账户日报｜", "提交订单 1笔", "成交回报 3笔", "TQQQ 300股"),
            ("en", "📊 Daily account report | ", "Orders submitted: 1", "Fill reports: 3", "TQQQ 300 shares"),
        ):
            with self.subTest(locale=locale):
                self.store = MemoryStore({"schwab/2026-10-15/synthetic-slot.json": {"runs": [item]}})
                self.sent = []
                cfg = replace(self.enable(), locale=locale, expected=[{**EXPECTED[0], "account_label": "Desk  Alpha"}])
                _, result = self.run_request(configuration=cfg)
                self.assertEqual(result["delivery"], "accepted")
                text = self.sent[0]
                for part in (header, "🏦 Schwab · Desk  Alpha · ", order_count, fill_count, holding, "USD 50,000.00"):
                    self.assertIn(part, text)
                self.assertEqual(text.count("@ USD"), 3)
                for token in NO_REPORT_TECH:
                    self.assertNotIn(token, text)
                self.assertNotIn(item["opaque_account_uid"], text)

    def test_pending_partial_cancel_reject_and_expiry_follow_evidence(self):
        for status, filled, expected in (
            ("open", None, "已提交，成交待确认"),
            ("partially_filled", 1, "部分成交"),
            ("cancelled", 1, "已取消"),
            ("rejected", 0, "已拒绝"),
            ("expired", 0, "已过期"),
        ):
            with self.subTest(status=status):
                order = record("order", status=status, filled_quantity=filled,
                               remaining_quantity=None if filled is None else 3 - filled)
                fill = [record("fill", quantity=1, price=61)] if filled else []
                item = with_facts({**ROW, "order_count": 1, "fill_count": filled},
                                  orders=[order], fills=fill)
                text, _ = self.report([item], ["present"])
                self.assertIn(expected, text)
                self.assertNotIn("😴 无交易", text)
                if filled is None:
                    self.assertIn("成交回报 未知", text)
                if filled:
                    self.assertIn("剩余 2股", text)
                    self.assertIn("USD 61.00", text)
                if status in {"cancelled", "rejected", "expired"}:
                    self.assertNotIn("成交待确认", text)

    def test_unconfirmed_execution_does_not_imply_an_order(self):
        item = with_facts({**ROW, "status": "alert", "execution_status": "execution_unknown",
                           "order_count": None, "fill_count": None})
        text, _ = self.report([item], ["present"])
        self.assertIn("执行结果待核对", text)
        self.assertNotIn("订单最终状态待确认", text)

        submitted = {**item, "execution_status": "order_submitted", "order_count": 1}
        text, _ = self.report([submitted], ["present"])
        self.assertIn("订单最终状态待确认", text)

    def test_verified_risk_block_reports_the_reason_without_an_execution_error(self):
        reason = {"reason_code": "consecutive_loss_limit_exceeded", "observed_value": 6, "limit": 5}
        item = with_facts({**ROW, "status": "alert", "execution_status": "strategy_risk_rejected",
                           "block_reason": reason, "approved_gate_reasons": [reason]})
        text, _ = self.report([item], ["present"])
        self.assertIn("连亏熔断", text)
        self.assertIn("本轮未下单", text)
        self.assertNotIn("执行异常", text)
        self.assertNotIn("无交易", text)

    def test_multiple_runs_keep_verified_count_as_a_minimum(self):
        first = with_facts({**ROW, "order_count": 3, "fill_count": 2})
        second = with_facts({**ROW, "source_run_id": "other-run", "order_count": 2, "fill_count": 1})
        text, _ = self.report([first, second], ["present"])
        self.assertIn("提交订单 已见 3 笔，总数未知", text)
        self.assertIn("成交回报 已见 2 笔，总数未知", text)

    def test_newer_partial_snapshot_preserves_other_verified_field_and_its_time(self):
        before = snapshot(as_of="2026-10-16T04:00:00+08:00", holdings=None)
        after = snapshot(equity=None, equity_currency=None)
        text, _ = self.report([with_facts(ROW, snapshots=[after, before])], ["present"])
        self.assertIn("总资产：USD 50,000.00 · 快照 2026-10-16 04:00", text)
        self.assertIn("持仓：快照 2026-10-16 05:10", text)
        self.assertIn("TQQQ 300股", text)

    def test_no_trade_keeps_assets_and_explicit_empty_positions(self):
        item = with_facts(ROW, snapshots=[snapshot(holdings=[])])
        text, coverage = self.report([item], ["present"])
        self.assertEqual(coverage, "complete")
        for part in ("😴 无交易（已核验策略范围）", "提交订单 0笔", "成交回报 0笔",
                     "💰 总资产：USD 50,000.00", "📦 持仓：空仓"):
            self.assertIn(part, text)
        self.assertNotIn("全部已核验账户无交易", text)

    def test_mixed_case_terminal_status_agrees_with_order_details(self):
        for status, detail in (("Cancelled", "cancelled"), ("REJECTED", "rejected"), ("Expired", "expired")):
            with self.subTest(status=status):
                order = record("closed-order", status=status, filled_quantity=0)
                item = with_facts({**ROW, "order_count": 1, "fill_count": 0}, orders=[order])
                text, _ = self.report([item], ["present"], locale="en")
                self.assertIn("Orders closed; statuses below", text)
                self.assertIn(f" · {detail}", text)
                self.assertNotIn("Submitted, fills unconfirmed", text)

    def test_closed_observed_order_does_not_close_unobserved_orders(self):
        order = record("closed-order", status="cancelled", filled_quantity=0)
        item = with_facts({**ROW, "order_count": 2, "fill_count": 0}, orders=[order])
        text, _ = self.report([item], ["present"], locale="en")
        self.assertIn("Some order details are unavailable", text)
        self.assertIn(" · cancelled", text)
        self.assertNotIn("Orders closed; statuses below", text)

    def test_simulation_does_not_establish_actual_account_trades(self):
        item = with_facts({**ROW, "execution_mode": "dry_run", "fill_count": 1},
                          fills=[record("simulated-fill", price=99)], snapshots=[snapshot()])
        text, _ = self.report([item], ["present"])
        self.assertIn("模拟记录未计入实际交易", text)
        self.assertIn("成交回报 未知", text)
        self.assertNotIn("✅ 有交易", text)
        self.assertNotIn("USD 99.00", text)

    def test_all_accounts_no_trade_headline_requires_account_window_coverage(self):
        binding = EXPECTED[0]
        row = DigestRunEntry(**{key: binding[key] for key in app.IDENTITY})
        key = (binding["platform_id"], binding["opaque_account_uid"])
        facts = {key: {"orders_complete": True, "fills_complete": True}}
        text = render_account_daily(DailyDigestInput(DAY, runs=(row,)), [binding], ["present"], facts=facts)
        self.assertIn("全部已核验账户无交易", text)
        self.assertIn("🏦 ", text)

    def test_account_daily_golden_output_in_both_languages(self):
        for locale in ("zh", "en"):
            with self.subTest(locale=locale):
                text, _ = self.report([ROW], ["present"], locale=locale)
                fixture = Path(__file__).parent / "fixtures" / f"daily-caller-{locale}.txt"
                self.assertEqual(text + "\n", fixture.read_text())

    def test_nonrun_missing_and_stale_have_separate_status_and_keep_known_snapshot(self):
        idle = with_facts({**ROW, "actually_ran": False}, snapshots=[snapshot()])
        text, _ = self.report([idle], ["not_run"])
        self.assertIn("策略未运行，账户交易未知", text)
        self.assertNotIn("无交易", text)
        self.assertIn("USD 50,000.00", text)
        stale = with_facts({**ROW, "business_day": "2026-10-14"},
                           fills=[record("old", price=777, occurred_at="2026-10-15T05:10:00+08:00")],
                           snapshots=[snapshot(as_of="2026-10-14T05:10:00+08:00")])
        text, _ = self.report([], ["stale"], stale=[stale])
        self.assertIn("报告过期", text)
        self.assertIn("较早快照 2026-10-14", text)
        self.assertNotIn("777", text)
        text, _ = self.report([], ["missing"])
        for part in ("报告缺失", "提交订单 未知", "成交回报 未知", "总资产：未知", "持仓：未知"):
            self.assertIn(part, text)
        self.assertNotIn("空仓", text)

    def test_two_accounts_and_multiple_strategies_preserve_one_snapshot_per_account(self):
        second = {**EXPECTED[0], "target_id": "other-strategy", "strategy_profile": "tqqq_growth_income",
                  "candidate_slot": "other-strategy", "account_label": "Shared Desk"}
        third = {**EXPECTED[0], "target_id": "other-account", "opaque_account_uid": "other-account",
                 "candidate_slot": "other-account", "account_label": "Second Desk"}
        primary = {**EXPECTED[0], "account_label": "Shared Desk"}
        fill = record("unique-fill", price=63)
        one = with_facts({**ROW, "fill_count": 1}, fills=[{**fill, "strategy": ROW["strategy_profile"]}],
                         snapshots=[snapshot()])
        two = with_facts({**ROW, **{key: second[key] for key in app.IDENTITY}, "source_run_id": "other-run", "fill_count": 1},
                         fills=[{**fill, "strategy": second["strategy_profile"]}], snapshots=[snapshot()])
        text, _ = self.report([one, two], ["present", "present", "missing"], expected=[primary, second, third])
        self.assertEqual(text.count("🏦 "), 2)
        self.assertEqual(text.count("USD 50,000.00"), 1)
        self.assertEqual(text.count("@ USD 63.00"), 1)
        self.assertIn("策略未知", text)
        self.assertIn("Second Desk", text)

    def test_same_configured_label_keeps_accounts_distinguishable(self):
        primary = {**EXPECTED[0], "account_label": "Desk  Alpha"}
        second = {**primary, "target_id": "other-target", "opaque_account_uid": "other-account",
                  "candidate_slot": "other-slot"}
        third = {**second, "target_id": "third-target", "opaque_account_uid": "third-account",
                 "candidate_slot": "third-slot", "account_label": "Desk  Alpha 1"}
        text, _ = self.report([], ["missing"] * 3, locale="en", expected=[primary, second, third])
        self.assertIn("🏦 Schwab · Desk  Alpha 2 · ", text)
        self.assertIn("🏦 Schwab · Desk  Alpha 3 · ", text)
        self.assertIn("🏦 Schwab · Desk  Alpha 1 · ", text)
        self.assertNotIn("other-account", text)

    def test_equal_snapshot_instants_keep_verified_assets_and_holdings(self):
        second = {**EXPECTED[0], "target_id": "other-strategy", "strategy_profile": "tqqq_growth_income",
                  "candidate_slot": "other-strategy"}
        equivalent_time = datetime.fromisoformat(TIME).astimezone(timezone.utc).isoformat()
        one = with_facts(ROW, snapshots=[snapshot()])
        two = with_facts({**ROW, **{key: second[key] for key in app.IDENTITY}, "source_run_id": "other-run"},
                         snapshots=[snapshot(as_of=equivalent_time)])
        text, _ = self.report([one, two], ["present", "present"], locale="en", expected=[EXPECTED[0], second])
        self.assertEqual(text.count("Total assets: USD 50,000.00"), 1)
        self.assertEqual(text.count("TQQQ 300 shares"), 1)

    def test_snapshot_position_order_does_not_mask_real_conflicts(self):
        second = {**EXPECTED[0], "target_id": "other-strategy", "strategy_profile": "tqqq_growth_income",
                  "candidate_slot": "other-strategy"}
        holdings = [*snapshot()["holdings"], {"symbol": "BOXX", "quantity": 100, "asset_type": "etf"}]
        first = with_facts(ROW, snapshots=[snapshot(holdings=holdings)])
        second_row = {**ROW, **{key: second[key] for key in app.IDENTITY}, "source_run_id": "other-run"}
        for change in (False, True):
            with self.subTest(change=change):
                reordered = list(reversed(holdings))
                if change:
                    reordered[0] = {**reordered[0], "quantity": 101}
                other = with_facts(second_row, snapshots=[snapshot(holdings=reordered)])
                text, _ = self.report([first, other], ["present", "present"], locale="en",
                                      expected=[EXPECTED[0], second])
                if change:
                    self.assertIn("Total assets: unknown", text)
                    self.assertIn("Holdings: unknown", text)
                else:
                    for part in ("Total assets: USD 50,000.00", "BOXX 100 shares", "TQQQ 300 shares"):
                        self.assertEqual(text.count(part), 1)

    def test_equivalent_order_instants_and_intervals_keep_order_details(self):
        equivalent_time = datetime.fromisoformat(TIME).astimezone(timezone.utc).isoformat()
        for interval in (False, True):
            with self.subTest(interval=interval):
                orders = []
                for stamp, status in ((TIME, "Cancelled"), (equivalent_time, "cancelled")):
                    order = record("closed-order", status=status, filled_quantity=0, occurred_at=stamp)
                    if interval:
                        order.pop("occurred_at")
                        order.update(submission_window_start=stamp, submission_window_end=stamp)
                    orders.append(order)
                item = with_facts({**ROW, "order_count": 1, "fill_count": 0}, orders=orders)
                text, _ = self.report([item], ["present"], locale="en")
                self.assertIn("Orders closed; statuses below", text)
                self.assertEqual(text.count(" · cancelled"), 1)

    def test_budget_discloses_omitted_holdings_without_losing_totals(self):
        hold = [{"symbol": f"TEST{i}", "quantity": i + 1, "asset_type": "option"} for i in range(70)]
        binding = {**EXPECTED[0], "account_label": "Desk"}
        facts = {(binding["platform_id"], binding["opaque_account_uid"]): {"snapshots": [snapshot(holdings=hold)]}}
        text = render_account_daily(DailyDigestInput(DAY), [binding], ["not_run"], facts=facts, max_units=380)
        self.assertLessEqual(len(text.encode("utf-16-le")) // 2, 380)
        shown = sum(line.startswith("TEST") for line in text.splitlines())
        self.assertGreater(shown, 0)
        self.assertIn(f"持仓展示 {shown} 项、省略 {len(hold) - shown} 项", text)
        self.assertIn("张", text)
        self.assertIn("USD 50,000.00", text)

    def test_cutoff_uses_same_report_title_and_reservation(self):
        self.now += app.timedelta(minutes=31)
        self.run_request(configuration=self.enable())
        self.run_request(configuration=self.enable())
        self.assertEqual(len(self.sent), 1)
        self.assertIn("昨日账户日报", self.sent[0])
        self.assertIn("交易、资产和持仓无法确认", self.sent[0])
        for token in NO_REPORT_TECH:
            self.assertNotIn(token, self.sent[0])

    def test_settlement_without_fill_time_never_counts_as_yesterday_fill(self):
        order = record("order", status="cancelled", filled_quantity=1, remaining_quantity=2,
                       average_fill_price=61)
        row = with_facts({**ROW, "order_count": 1, "fill_count": 1}, orders=[order],
                         fills_window_unknown=True)
        text, _ = self.report([row], ["present"])
        for part in ("已取消", "成交均价 USD 61.00", "成交回报 未知", "发生时段未核实"):
            self.assertIn(part, text)
        self.assertNotIn("✅ 有交易", text)
        self.assertNotIn("✅ 部分成交", text)

    def test_cross_window_settlement_keeps_only_actual_in_window_fills(self):
        current = record("before-boundary", price=61, occurred_at="2026-10-16T05:59:59+08:00")
        later = record("after-boundary", price=62, occurred_at="2026-10-16T06:00:00+08:00")
        row = with_facts({**ROW, "order_count": 1, "fill_count": 2}, orders=[record("order", status="filled")],
                         fills=[current, later], fills_window_mixed=True)
        text, _ = self.report([row], ["present"])
        self.assertIn("✅ 有交易", text)
        self.assertIn("成交回报 已见 1 笔，总数未知", text)
        self.assertIn("USD 61.00", text)
        self.assertNotIn("USD 62.00", text)
        self.assertNotIn("成交回报 2笔", text)
        self.assertIn("跨统计窗口", text)
        self.assertNotIn("发生时段未核实", text)

    def test_dated_fill_on_already_read_older_run_does_not_count_its_submission(self):
        row = with_facts({**ROW, "business_day": "2026-10-14", "order_count": 1, "fill_count": 1},
                         orders=[record("old-order", status="filled", occurred_at="2026-10-15T05:00:00+08:00")],
                         fills=[record("new-fill", price=64, occurred_at="2026-10-15T06:00:00+08:00")])
        self.store = MemoryStore({"schwab/2026-10-15/synthetic-slot.json": {"runs": [row]}})
        _, result = self.run_request(configuration=self.enable())
        self.assertEqual(result["coverage"], "unavailable")
        text = self.sent[0]
        for part in ("报告过期", "提交订单 未知", "成交回报 已见 1 笔，总数未知", "USD 64.00"):
            self.assertIn(part, text)
        self.assertNotIn("提交订单 1笔", text)
