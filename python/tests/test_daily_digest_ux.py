"""Display regressions use synthetic identities and no account/market data."""
import copy
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import daily_digest_aggregator as aggregator

DAY = "2026-10-14"


def fixture():
    rows = [{
        "platform_id": "demo", "strategy_profile": "demo_strategy",
        "opaque_account_uid": f"synthetic-account-{i}", "target_id": f"demo/target-{i}",
        "account_hint": f"demo-{i}", "business_day": DAY, "actually_ran": True,
        "fill_count": 0, "order_count": 0, "cycle_count": 1,
        "signal_summary": "no_action",
    } for i in range(5)]
    rows[3].update(fill_count=3, order_count=2, signal_summary="filled")
    rows[4].update(fill_count=None, order_count=None)
    legacy = [dict(row, business_day="2026-10-08") for row in rows]
    return rows + legacy


def config(expected=()):
    return {"strategies": {}, "notifications": {"quant_sentinel": {"daily_digest": {
        "aggregator": {"expected_targets": list(expected)},
    }}}}


def render(rows, *, locale="zh", layout="v1", expected=(), environment=None, contents=None, github=None):
    with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, environment or {}, clear=True):
        path = Path(tmp) / "candidates.json"
        path.write_text(contents if contents is not None else json.dumps({"runs": rows}))
        with mock.patch.object(aggregator, "load_platform_config", return_value=config(expected)), \
             mock.patch.object(aggregator, "collect_from_github_workflows", return_value=github):
            return aggregator.build_digest_payload(
                business_day=DAY, candidates_path=path, include_github=github is not None,
                locale=locale, layout=layout,
            )


class DailyDigestUXTests(unittest.TestCase):
    def variants(self):
        for locale in ("zh", "en"):
            for layout in ("v1", "sections_v2"):
                yield locale, layout

    def test_verified_no_trade_is_compact_and_traded_counts_remain_visible(self):
        for locale, layout in self.variants():
            with self.subTest(locale=locale, layout=layout):
                payload, text, _ = render(fixture()[:4], locale=locale, layout=layout)
                self.assertEqual(text.count("无交易" if locale == "zh" else "No trades"), 3)
                self.assertIn("成交 3 笔 / 订单 2 笔" if locale == "zh" else "fills 3 / orders 2", text)
                self.assertNotIn("成交 0 笔" if locale == "zh" else "fills 0", text)
                self.assertEqual(aggregator.digest.global_total_fills(payload), 3)

    def test_each_missing_reason_is_explained_and_never_becomes_zero(self):
        explanations = {
            "EVIDENCE_NOT_FOUND": ("未找到当天的成交或订单证据", "No fill or order evidence for this business day"),
            "EVIDENCE_UNREADABLE": ("证据读取失败或格式无效", "Evidence could not be read or has an invalid format"),
            "EVIDENCE_STALE_BUSINESS_DAY": ("证据业务日与日报不一致", "Evidence belongs to a different business day"),
            "SOURCE_NOT_CONFIGURED": ("未配置成交或订单证据来源", "No fill or order evidence source is configured"),
        }
        for locale, layout in self.variants():
            for code, labels in explanations.items():
                with self.subTest(locale=locale, layout=layout, code=code):
                    row = fixture()[4]
                    row["reason_code"] = code
                    payload, text, _ = render([row], locale=locale, layout=layout)
                    expected = f"数据缺失：{code}（{labels[0]}）" if locale == "zh" else f"Data missing: {code} ({labels[1]})"
                    self.assertIn(expected, text)
                    self.assertNotIn("无交易" if locale == "zh" else "No trades", text)
                    self.assertIsNone(aggregator.digest.global_total_fills(payload))

    def test_missing_orders_with_known_zero_fills_keeps_header_honest(self):
        for locale, layout in self.variants():
            with self.subTest(locale=locale, layout=layout):
                row = fixture()[0]
                row["order_count"] = None
                _, text, _ = render([row], locale=locale, layout=layout)
                self.assertIn("证据未覆盖" if locale == "zh" else "evidence uncovered", text)
                self.assertNotIn("已验证零成交" if locale == "zh" else "verified zero fills", text)
                self.assertIn("EVIDENCE_NOT_FOUND", text)

    def test_mixed_accounts_and_superseded_legacy_rows(self):
        for locale, layout in self.variants():
            with self.subTest(locale=locale, layout=layout):
                payload, text, collected = render(fixture(), locale=locale, layout=layout)
                self.assertEqual(len(payload.runs), 5)
                self.assertEqual(collected.coverage.stale_candidates_count, 0)
                self.assertEqual(collected.coverage.suppressed_candidates_count, 5)
                self.assertIn("证据未覆盖" if locale == "zh" else "evidence uncovered", text)
                self.assertNotIn("以下账户" if locale == "zh" else "These accounts", text)
                self.assertNotIn("2026-10-08", text)
                self.assertIsNone(aggregator.digest.global_total_fills(payload))

    def test_supersession_matches_target_without_borrowing_other_accounts(self):
        rows = fixture()[:1]
        old = dict(rows[0], business_day="2026-10-08")
        old.pop("opaque_account_uid")
        _, _, collected = render(rows + [old])
        self.assertEqual(collected.coverage.stale_candidates_count, 0)
        old["target_id"] = "demo/another-target"
        _, _, collected = render(rows + [old])
        self.assertEqual(collected.coverage.stale_candidates_count, 1)

    def test_source_flagged_legacy_is_hidden_and_cannot_supply_counts(self):
        for locale, layout in self.variants():
            with self.subTest(locale=locale, layout=layout):
                rows = fixture()[:1]
                legacy = dict(rows[0], target_id="demo/retired", legacy=True, business_day="2026-10-08")
                payload, text, collected = render(rows + [legacy], locale=locale, layout=layout)
                self.assertNotIn("2026-10-08", text)
                self.assertEqual(collected.coverage.suppressed_candidates_count, 1)
                self.assertEqual(aggregator.digest.global_total_fills(payload), 0)

    def test_legacy_only_cannot_claim_verified_idle_and_envelope_flag_survives_merge(self):
        import merge_digest_candidates
        row = dict(fixture()[0], business_day="2026-10-08")
        rows = merge_digest_candidates._rows({"runs": [row], "legacy": True})
        for locale, layout in self.variants():
            with self.subTest(locale=locale, layout=layout):
                payload, text, collected = render(rows, locale=locale, layout=layout)
                self.assertFalse(collected.coverage.is_complete_for_verified_idle)
                self.assertIsNone(aggregator.digest.global_total_fills(payload))
                self.assertNotIn("2026-10-08", text)

    def test_count_diagnostics_do_not_replace_an_execution_alert_reason(self):
        for locale, layout in self.variants():
            with self.subTest(locale=locale, layout=layout):
                row = dict(fixture()[4], status="alert", reason_code="synthetic_risk_block")
                payload, text, _ = render([row], locale=locale, layout=layout)
                self.assertEqual(payload.runs[0].reason_code, "synthetic_risk_block")
                self.assertIn("EVIDENCE_NOT_FOUND", text)

    def test_real_stale_and_configured_missing_targets_have_visible_reasons(self):
        for locale, layout in self.variants():
            for stale in (False, True):
                with self.subTest(locale=locale, layout=layout, stale=stale):
                    rows = fixture()[:2]
                    expected = copy.deepcopy(rows)
                    if stale:
                        rows[1]["business_day"] = "2026-10-08"
                    else:
                        rows.pop()
                    payload, text, _ = render(rows, locale=locale, layout=layout, expected=expected)
                    self.assertIn("以下账户今天的数据缺失或过期" if locale == "zh" else "These accounts have missing or stale data today", text)
                    self.assertIn("EVIDENCE_STALE_BUSINESS_DAY" if stale else "EVIDENCE_NOT_FOUND", text)
                    self.assertIn("证据未覆盖" if locale == "zh" else "evidence uncovered", text)
                    self.assertIsNone(aggregator.digest.global_total_fills(payload))

    def test_source_failures_and_absent_source_map_to_public_reason_codes(self):
        for locale, layout in self.variants():
            for mode in ("unreadable", "unconfigured", "not_found", "stale"):
                with self.subTest(locale=locale, layout=layout, mode=mode):
                    row = fixture()[4]
                    stubs = aggregator.GithubEvidenceResult(rows=[dict(row, evidence_provenance="github_workflow_stub")], sources_queried=1)
                    environment = {}
                    if mode == "unreadable":
                        environment["DIGEST_CANDIDATES_STORE_STATUS"] = "failed"
                    elif mode == "unconfigured":
                        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(aggregator, "load_platform_config", return_value=config()), mock.patch.object(aggregator, "collect_from_github_workflows", return_value=stubs):
                            _, text, _ = aggregator.build_digest_payload(business_day=DAY, locale=locale, layout=layout)
                        self.assertIn("SOURCE_NOT_CONFIGURED", text)
                        continue
                    rows = [dict(row, business_day="2026-10-08")] if mode == "stale" else []
                    _, text, _ = render(rows, locale=locale, layout=layout, environment=environment,
                                        contents="invalid" if mode == "unreadable" else None, github=stubs)
                    self.assertIn({"unreadable": "EVIDENCE_UNREADABLE", "not_found": "EVIDENCE_NOT_FOUND", "stale": "EVIDENCE_STALE_BUSINESS_DAY"}[mode], text)
