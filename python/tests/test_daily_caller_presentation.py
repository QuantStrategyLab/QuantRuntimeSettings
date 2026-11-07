"""Source-only caller regressions; no network, credentials or real sends."""
from dataclasses import replace
import unittest
import re
from pathlib import Path

import test_cloud_run_daily_digest as caller_fixture
from test_cloud_run_daily_digest import EXPECTED, ROW
from test_daily_digest_ux import config
from test_notification_consolidation import candidate
import cloud_run_daily_digest as app
from notification_snapshot.presentation import SECTION_NAMES
from unified_daily_digest import _render_consolidated


class DailyCallerPresentationTests(unittest.TestCase):
    setUp = caller_fixture.CloudRunDigestTests.setUp
    run_request = caller_fixture.CloudRunDigestTests.run_request
    send = caller_fixture.CloudRunDigestTests.send
    enable = caller_fixture.CloudRunDigestTests.enable

    def assert_sections(self, text, locale="zh"):
        marks = [f"【{name}】" if locale == "zh" else f"[{name}]" for name in SECTION_NAMES[locale]]
        self.assertEqual([text.count(mark) for mark in marks], [1] * 5)
        self.assertEqual(sorted(text.index(mark) for mark in marks), [text.index(mark) for mark in marks])
        self.assertLessEqual(app._units(text), 3900)

    def test_central_caller_preserves_sections_and_disabled_scope(self):
        for locale in ("zh", "en"):
            with self.subTest(locale=locale):
                text, coverage = app._report(replace(self.configuration, locale=locale), [ROW],
                                             ["present"], ROW["business_day"], config(EXPECTED))
                self.assert_sections(text, locale)
                self.assertIn("Binance：已停用" if locale == "zh" else "Binance: disabled", text)
                self.assertIn("运行／订单／成交不适用" if locale == "zh" else "runs/orders/fills N/A", text)
                self.assertIn("未纳入本期汇总，运行状态未知" if locale == "zh" else "not included in this digest; run state unknown", text)
                self.assertIn("运行链接：不可用" if locale == "zh" else "Run link: unavailable", text)

    def test_central_caller_regression_snapshots(self):
        for locale in ("zh", "en"):
            text, _ = app._report(replace(self.configuration, locale=locale), [ROW],
                                  ["present"], ROW["business_day"], config(EXPECTED))
            normalized = re.sub(r"\d{4}-\d{2}-\d{2}", "<PROJECT_ID>", text)
            snapshot = Path(__file__).parent / "fixtures" / f"daily-caller-{locale}.txt"
            self.assertEqual(normalized + "\n", snapshot.read_text())

    def test_disabled_claim_requires_inventory_and_no_bound_binance(self):
        import daily_digest_notify as digest
        for source in (None, dict(expected_targets=1, covered_targets=0, runs=0)):
            inventory = {} if source is None else {"binance": source}
            payload = digest.DailyDigestInput(business_day=ROW["business_day"], locale="en",
                                              notification_summary={"source_inventory": inventory})
            text = _render_consolidated(payload, max_units=3900, known_disabled_platforms={"binance"})
            self.assertNotIn("Binance: disabled", text)
            self.assertIn("source coverage unknown" if source is None else "expected target coverage 0/1", text)

    def test_run_link_is_supplied_bound_and_sanitized_or_unavailable(self):
        repository = "example-org/example-repo"
        url = f"https://github.com/{repository}/actions/runs/42"
        cfg = config(EXPECTED)
        cfg["platforms"] = {"schwab": {"repository": repository}}
        for supplied, accepted in ((url + "?token=fake#private", True),
                                   (url.replace(repository, "other/repo"), False),
                                   (url.replace("github.com", "github.com.evil.test"), False),
                                   (url.replace("https:", "http:"), False),
                                   (url.replace("github.com", "user@github.com"), False),
                                   (url + "/private", False), ("private-run-id", False)):
            with self.subTest(accepted=accepted, supplied=supplied):
                row = candidate(run=supplied)
                text, _ = app._report(self.configuration, [row], ["present"], ROW["business_day"], cfg)
                self.assert_sections(text)
                self.assertNotIn("fake", text)
                self.assertNotIn("private", text)
                self.assertNotIn("evil.test", text)
                self.assertIn(url if accepted else "运行链接：不可用", text)

    def test_late_fallback_keeps_sections_unknown_and_single_reservation(self):
        self.now += app.timedelta(minutes=31)
        self.run_request(configuration=self.enable())
        self.run_request(configuration=self.enable())
        self.assertEqual(len(self.sent), 1)
        self.assert_sections(self.sent[0])
        self.assertIn("成交与资产状态未知", self.sent[0])
        self.assertIn("运行链接：不可用", self.sent[0])

    def test_missing_all_sources_stays_five_sections_without_global_zero(self):
        self.store.rows = {}
        self.run_request(configuration=self.enable())
        self.assert_sections(self.sent[0])
        self.assertIn("全窗口统计未知", self.sent[0])
        self.assertNotIn("今日全部账号无交易", self.sent[0])

    def test_nonrun_coverage_and_verified_zero_keep_different_scopes(self):
        ft = candidate(platform_id="firstrade", actually_ran=False, notification_event=None)
        ft.pop("notification_event")
        expected = [{**{key: ft[key] for key in app.IDENTITY}, "candidate_slot": "fake-slot"}]
        expected += EXPECTED + [{**EXPECTED[0], "platform_id": "longbridge"}]
        configuration = replace(self.configuration, expected=expected)
        text, _ = app._report(configuration, [ft, ROW], ["not_run", "present", "missing"], ROW["business_day"], config(expected))
        self.assertIn("已收录 0 次运行，目标覆盖 1/1", text)
        self.assertIn("全窗口统计未知", text)
        self.assertIn("Schwab：已收录 1 次运行，目标覆盖 1/1", text)
        self.assertIn("报告注明未运行；不推断成交统计", text)
        self.assert_sections(text)


if __name__ == "__main__":
    unittest.main()
