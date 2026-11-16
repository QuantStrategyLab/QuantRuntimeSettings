"""Every annotation in the account digest is rendered from the input data, never fixed text."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import test_daily_caller_presentation as fixture
from test_daily_caller_presentation import EXPECTED, ROW, snapshot, with_facts

GIFT = {"symbol": "ABC", "quantity": 0.0466, "asset_type": "stock", "origin": "account_opening_gift"}
HELD = {"symbol": "TQQQ", "quantity": 300, "asset_type": "stock"}


class AccountDailyDataVariationTests(unittest.TestCase):
    setUp = fixture.DailyCallerPresentationTests.setUp
    report = fixture.DailyCallerPresentationTests.report

    @staticmethod
    def header(text):
        return next(line for line in text.splitlines() if line.startswith("🏦"))

    def render(self, *, holdings=(HELD,), as_of=None, locale="zh", plan_status=None):
        updates = {"holdings": list(holdings)}
        if as_of:
            updates["as_of"] = as_of
        expected = [{**EXPECTED[0], **({"plan_status": plan_status} if plan_status else {})}]
        row = with_facts(ROW, snapshots=[snapshot(**updates)])
        return self.report([row], ["present"], locale=locale, expected=expected)[0]

    def test_position_note_follows_the_position_record(self):
        text = self.render(holdings=(GIFT,))
        self.assertIn("📦 持仓：ABC 0.0466股（开户赠送）", text)
        self.assertNotIn("冲突", text)
        self.assertIn("(account-opening gift)", self.render(holdings=(GIFT,), locale="en"))
        # The same record without the attribute carries no note.
        self.assertNotIn("开户赠送", self.render(holdings=({**GIFT, "origin": "other"},)))
        # Closing the position removes the note together with the line.
        closed = self.render(holdings=())
        self.assertNotIn("开户赠送", closed)
        self.assertIn("📦 持仓：空仓", closed)
        # With another position left, only the gift line loses its note.
        both = self.render(holdings=(HELD, GIFT))
        self.assertEqual(both.count("开户赠送"), 1)
        self.assertNotIn("开户赠送", self.render(holdings=(HELD,)))

    def test_snapshot_age_is_computed_against_the_window(self):
        stale = self.render(as_of="2026-10-14T05:10:00+08:00")
        self.assertIn("快照 2026-10-14 05:10 UTC+8（距截止 48 小时，早于统计区间）", stale)
        self.assertIn("(48 hours before the cutoff, earlier than the reporting window)",
                      self.render(as_of="2026-10-14T05:10:00+08:00", locale="en"))
        older = self.render(as_of="2026-10-13T05:10:00+08:00")
        self.assertIn("距截止 72 小时", older)
        inside = self.render(as_of="2026-10-15T07:00:00+08:00")
        self.assertIn("快照 2026-10-15 07:00 UTC+8", inside)
        for text in (inside, self.render(as_of="2026-10-15T07:00:00+08:00", locale="en")):
            self.assertNotIn("早于统计区间", text)
            self.assertNotIn("earlier than the reporting window", text)
            self.assertNotIn("距截止", text)

    def test_plan_label_follows_the_plan_status_record(self):
        self.assertIn("（已停止）", self.header(self.render(plan_status="stopped")))
        self.assertIn("（已启用）", self.header(self.render(plan_status="enabled")))
        self.assertIn("(stopped)", self.header(self.render(plan_status="stopped", locale="en")))
        for text in (self.render(), self.render(plan_status="unrecognised")):
            self.assertNotIn("已停止", text)
            self.assertNotIn("已启用", text)


if __name__ == "__main__":
    unittest.main()
