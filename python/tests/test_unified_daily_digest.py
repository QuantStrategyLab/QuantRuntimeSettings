"""Offline unified rendering, guard and no-send regression tests."""
from dataclasses import replace
import io
import json
import os
import unittest
import tempfile
from pathlib import Path
from contextlib import redirect_stdout
from unittest.mock import patch
import daily_digest_notify as digest
import daily_digest_resend_guard as guard
import send_daily_digest_telegram as sender
from unified_daily_digest import render


def payload(*runs):
    return digest.DailyDigestInput(business_day="2026-10-15", runs=runs,
        evidence_coverage=digest.EvidenceCoverage(candidates_loaded=True))


def row(platform="schwab", **kwargs):
    return digest.DigestRunEntry(platform_id=platform, strategy_profile="synthetic_core", **kwargs)


def test_idle_is_silent_and_trading_is_bilingual_without_diagnostics():
    assert render(payload(row())) == ""
    text = render(payload(row(fill_count=2, order_count=2), row("ibkr")))
    assert "订单 Orders 2" in text and "成交 Fills 2" in text
    assert "ibkr" not in text and "Diagnostics" not in text and "心跳" not in text


def test_all_five_platforms_fit_one_message_and_real_issue_is_visible():
    rows = [row(p, fill_count=1, order_count=1) for p in ("schwab", "ibkr", "longbridge", "binance", "firstrade")]
    text = render(payload(*rows))
    assert all(p in text for p in ("schwab", "ibkr", "longbridge", "binance", "firstrade"))
    assert "Diagnostics" not in text
    text = render(payload(*rows, row("other", status="alert")))
    assert "需关注 / Diagnostics" in text and "执行异常 / Execution issue" in text


def test_unknown_does_not_become_idle_and_source_errors_are_specific():
    text = render(payload(row(order_count=None, order_count_status="unknown")))
    assert "Incomplete execution evidence" in text
    source = replace(payload(), evidence_coverage=digest.EvidenceCoverage(candidate_failures=({"reason": "read_failed"},)))
    assert "Source read failure" in render(source)


def test_large_digest_stays_below_telegram_utf16_budget():
    text = render(payload(*(row(f"synthetic-{i}", strategy_label="🚀" * 100, fill_count=1, order_count=1) for i in range(100))))
    assert len(text.encode("utf-16-le")) // 2 <= 3900
    assert "more items omitted" in text


def test_unified_guard_shares_report_date_across_locale_business_day_force_and_scope():
    env = dict(GITHUB_ACTIONS="true", GITHUB_EVENT_NAME="workflow_dispatch", QSL_ROUTINE_NOTIFICATION_MODE="daily_digest",
               DIGEST_FORCE_RESEND="true", DIGEST_RESEND_GUARD="false")
    sent = dict(report_date="2026-10-16", business_day="2026-10-14", dry_run=False, delivered=True, status="delivered", test_message=True)
    with patch.object(guard, "report_date", return_value="2026-10-16"), patch.object(guard, "read_history", return_value=[(1, sent)]):
        for locale in ("zh", "en"):
            assert guard.evaluate("2026-10-15", {**env, "DIGEST_LOCALE": locale}).decision == "skip"
        assert guard.evaluate("2026-10-15", {**env, "DIGEST_RECIPIENT_SCOPE": "other"}).decision == "send"
        sent.update(delivered=False, status="send_failed")
        assert guard.evaluate("2026-10-15", env).reason == "DELIVERY_UNCERTAIN"


def test_empty_sender_never_resolves_credentials_or_calls_transport(tmp_path):
    from daily_digest_aggregator import CollectResult
    p = payload(row())
    c = CollectResult(runs=list(p.runs), coverage=p.evidence_coverage)
    path = tmp_path / "receipt.json"
    with patch.dict(os.environ, {"QSL_ROUTINE_NOTIFICATION_MODE": "daily_digest"}, clear=True), \
         patch.object(guard, "evaluate", return_value=guard.Decision("send", "FIRST_SEND")), \
         patch.object(sender.aggregator, "build_digest_payload", return_value=(p, "", c)), \
         patch.object(sender.maintenance.MaintenanceClient, "from_environment", return_value=None), \
         patch.object(sender, "diagnose_telegram_route", return_value={}), \
         patch.object(sender, "resolve_telegram_token") as token, \
         patch.object(sender, "send_telegram_message") as send, redirect_stdout(io.StringIO()):
        assert sender.main(["--business-day", p.business_day, "--write-receipt", str(path)]) == 0
    receipt = json.loads(path.read_text())
    assert receipt["status"] == "skipped_empty" and receipt["delivered"] is False
    token.assert_not_called()
    send.assert_not_called()


# The repository CI uses unittest discovery; keep these cases visible there.
class UnifiedDailyDigestTests(unittest.TestCase):
    test_idle = staticmethod(test_idle_is_silent_and_trading_is_bilingual_without_diagnostics)
    test_five_platforms = staticmethod(test_all_five_platforms_fit_one_message_and_real_issue_is_visible)
    test_unknown = staticmethod(test_unknown_does_not_become_idle_and_source_errors_are_specific)
    test_length = staticmethod(test_large_digest_stays_below_telegram_utf16_budget)
    test_daily_guard = staticmethod(test_unified_guard_shares_report_date_across_locale_business_day_force_and_scope)

    def test_empty_sender(self):
        with tempfile.TemporaryDirectory() as directory:
            test_empty_sender_never_resolves_credentials_or_calls_transport(Path(directory))
