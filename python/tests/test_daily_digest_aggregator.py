from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock
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
digest = _load_module("daily_digest_notify")


class DailyDigestAggregatorTests(unittest.TestCase):
    def test_business_day_uses_new_york_calendar(self):
        stamp = datetime(2026, 10, 5, 22, 0, tzinfo=ZoneInfo("UTC"))
        self.assertEqual(
            aggregator.resolve_business_day(now=stamp),
            "2026-10-05",
        )

    def test_empty_evidence_without_sources_is_unknown_not_link_healthy(self):
        payload, text, collected = aggregator.build_digest_payload(
            business_day="2026-10-08",
            locale="zh",
            include_github=False,
        )
        self.assertEqual(payload.runs, ())
        self.assertEqual(payload.evidence_status, "evidence_unknown")
        self.assertIn("心跳", text)
        self.assertIn("证据未知或读取失败", text)
        self.assertNotIn("监测链路心跳正常", text)
        self.assertFalse(collected.coverage.is_complete_for_verified_idle)

    def test_candidates_file_only_includes_actual_runners(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "candidates.json"
            path.write_text(
                json.dumps(
                    {
                        "runs": [
                            {
                                "platform_id": "ibkr",
                                "business_day": "2026-10-08",
                                "strategy_profile": "soxl_soxx_trend_income",
                                "actually_ran": True,
                                "fill_count": 2,
                                "order_count": 2,
                            },
                            {
                                "platform_id": "firstrade",
                                "business_day": "2026-10-08",
                                "strategy_profile": "dca_month_end",
                                "actually_ran": False,
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )
            payload, text, collected = aggregator.build_digest_payload(
                business_day="2026-10-08",
                locale="zh",
                candidates_path=path,
                include_github=False,
            )
            self.assertEqual(len(payload.runs), 1)
            self.assertEqual(payload.runs[0].platform_id, "ibkr")
            self.assertIn("收盘日报", text)
            self.assertNotIn("firstrade", text)
            self.assertTrue(collected.coverage.candidates_loaded)

    def test_merge_same_identity_prefers_rows_with_counts(self):
        merged = aggregator.merge_candidates(
            [
                {
                    "platform_id": "binance",
                    "strategy_profile": "crypto_equity_combo",
                    "opaque_account_uid": "binance-opaque-1",
                    "target_id": "binance/main",
                    "actually_ran": True,
                    "cycle_count": 1,
                    "fill_count": None,
                    "field_status": {"fill_count": "counts_unknown"},
                    "reason_code": "github_workflow_existence_only",
                    "evidence_provenance": "github_workflow_stub",
                    "note": "github_workflow:x.yml",
                }
            ],
            [
                {
                    "platform_id": "binance",
                    "strategy_profile": "crypto_equity_combo",
                    "opaque_account_uid": "binance-opaque-1",
                    "target_id": "binance/main",
                    "actually_ran": True,
                    "cycle_count": 4,
                    "fill_count": 1,
                    "evidence_provenance": "candidates",
                    "note": "producer",
                }
            ],
        )
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["fill_count"], 1)
        self.assertEqual(merged[0]["note"], "producer")

    def test_merge_does_not_combine_different_account_uids(self):
        merged = aggregator.merge_candidates(
            [
                {
                    "platform_id": "schwab",
                    "strategy_profile": "soxl_soxx_trend_income",
                    "opaque_account_uid": "uid-a",
                    "target_id": "schwab/a",
                    "actually_ran": True,
                    "fill_count": 0,
                    "equity": 100.0,
                    "evidence_provenance": "candidates",
                },
                {
                    "platform_id": "schwab",
                    "strategy_profile": "soxl_soxx_trend_income",
                    "opaque_account_uid": "uid-b",
                    "target_id": "schwab/b",
                    "actually_ran": True,
                    "fill_count": 2,
                    "equity": 200.0,
                    "evidence_provenance": "candidates",
                },
            ]
        )
        self.assertEqual(len(merged), 2)
        uids = {row["opaque_account_uid"] for row in merged}
        self.assertEqual(uids, {"uid-a", "uid-b"})

    def test_unknown_identity_rows_do_not_cross_fill_fields(self):
        merged = aggregator.merge_candidates(
            [
                {
                    "platform_id": "ibkr",
                    "strategy_profile": "soxl_soxx_trend_income",
                    "actually_ran": True,
                    "cycle_count": 1,
                    "note": "github_workflow:a.yml",
                    "evidence_provenance": "github_workflow_stub",
                    "reason_code": "github_workflow_existence_only",
                },
                {
                    "platform_id": "ibkr",
                    "strategy_profile": "soxl_soxx_trend_income",
                    "actually_ran": True,
                    "equity": 500.0,
                    "note": "producer-partial",
                    "evidence_provenance": "candidates",
                },
            ]
        )
        # Different notes/provenance → kept separate; no field patching.
        self.assertEqual(len(merged), 2)
        equities = [row.get("equity") for row in merged]
        self.assertIn(500.0, equities)
        self.assertTrue(any(row.get("equity") in (None, "") for row in merged) or
                        any("github_workflow" in str(row.get("note")) for row in merged))

    def test_allowlist_loaded_from_platform_config(self):
        config = aggregator.load_platform_config()
        rows = aggregator.default_workflow_allowlist(config)
        self.assertTrue(any(row["platform_id"] == "longbridge" for row in rows))
        self.assertTrue(all(row["repository"].startswith("QuantStrategyLab/") for row in rows))

    def test_allowlist_calibrated_paths_and_roles(self):
        config = aggregator.load_platform_config()
        rows = aggregator.default_workflow_allowlist(config)
        by_platform = {row["platform_id"]: row for row in rows}
        self.assertEqual(set(by_platform), {"longbridge", "schwab"})
        self.assertEqual(
            by_platform["longbridge"]["workflow"], "publish-runtime-daily-once.yml"
        )
        self.assertEqual(
            by_platform["longbridge"].get("evidence_role"), "paper_projection_once"
        )
        self.assertEqual(by_platform["schwab"]["workflow"], "runtime-daily-sync.yml")
        self.assertEqual(
            by_platform["schwab"].get("evidence_role"), "manual_daily_projection"
        )
        # 404 / heartbeat-only platforms stay out of the active allowlist.
        for absent in ("ibkr", "binance", "firstrade"):
            self.assertNotIn(absent, by_platform)
        omitted = (
            (config.get("notifications") or {})
            .get("quant_sentinel", {})
            .get("daily_digest", {})
            .get("aggregator", {})
            .get("github_workflow_allowlist_omitted")
            or []
        )
        omitted_ids = {str(item.get("platform_id")) for item in omitted}
        self.assertTrue({"ibkr", "binance", "firstrade"}.issubset(omitted_ids))

    def test_allowlist_fallback_defaults_match_calibrated_paths(self):
        config = {
            "platforms": {
                "longbridge": {"repository": "QuantStrategyLab/LongBridgePlatform"},
                "schwab": {"repository": "QuantStrategyLab/CharlesSchwabPlatform"},
                "ibkr": {"repository": "QuantStrategyLab/InteractiveBrokersPlatform"},
            },
            "notifications": {"quant_sentinel": {"daily_digest": {"aggregator": {}}}},
        }
        rows = aggregator.default_workflow_allowlist(config)
        by_platform = {row["platform_id"]: row for row in rows}
        self.assertEqual(set(by_platform), {"longbridge", "schwab"})
        self.assertEqual(by_platform["schwab"]["workflow"], "runtime-daily-sync.yml")
        self.assertNotIn("ibkr", by_platform)

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

    def test_merge_prefers_observation_rich_rows_same_identity(self):
        merged = aggregator.merge_candidates(
            [
                {
                    "platform_id": "schwab",
                    "strategy_profile": "soxl_soxx_trend_income",
                    "opaque_account_uid": "schwab-opaque",
                    "target_id": "schwab/paper",
                    "actually_ran": True,
                    "cycle_count": 1,
                    "note": "github_workflow:x.yml",
                    "evidence_provenance": "github_workflow_stub",
                    "reason_code": "github_workflow_existence_only",
                    "fill_count": None,
                    "field_status": {"fill_count": "counts_unknown"},
                }
            ],
            [
                {
                    "platform_id": "schwab",
                    "strategy_profile": "soxl_soxx_trend_income",
                    "opaque_account_uid": "schwab-opaque",
                    "target_id": "schwab/paper",
                    "actually_ran": True,
                    "cycle_count": 1,
                    "equity": 990.06,
                    "holdings": [{"symbol": "SOXL", "market_value": 635.92, "qty": 4}],
                    "signal_summary": "hold",
                    "rebalance_kind": "no_rebalance",
                    "strategy_label": "半导体趋势收益",
                    "note": "producer",
                    "evidence_provenance": "candidates",
                    "fill_count": 0,
                }
            ],
        )
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["equity"], 990.06)
        self.assertEqual(merged[0]["note"], "producer")
        self.assertEqual(merged[0]["strategy_label"], "半导体趋势收益")

    def test_candidates_with_observation_render_rich_zh(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "candidates.json"
            path.write_text(
                json.dumps(
                    {
                        "runs": [
                            {
                                "platform_id": "schwab",
                                "business_day": "2026-10-08",
                                "strategy_profile": "soxl_soxx_trend_income",
                                "actually_ran": True,
                                "cycle_count": 1,
                                "fill_count": 0,
                                "equity": 990.06,
                                "holdings": [
                                    {
                                        "symbol": "SOXL",
                                        "market_value": 635.92,
                                        "quantity": 4,
                                    }
                                ],
                                "signal_summary": "SOXX 站上 140 日门槛线，持有 SOXL 70.0% + SOXX 20.0%",
                                "rebalance_kind": "no_rebalance",
                                "tips": [
                                    "净值 $990 低于建议 $1,000；整数股和最小仓位限制可能导致实盘无法完全复现回测"
                                ],
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            payload, text, _collected = aggregator.build_digest_payload(
                business_day="2026-10-08",
                locale="zh",
                candidates_path=path,
                include_github=False,
            )
            self.assertEqual(len(payload.runs), 1)
            self.assertEqual(payload.runs[0].strategy_label, "半导体趋势收益")
            self.assertIn("⚠️ 【需核对】", text)
            self.assertIn("账户总权益: USD 990.06", text)
            self.assertIn("SOXL: $635.92 / 4股", text)
            self.assertIn("✅ 无需调仓", text)

    def test_strategy_label_from_config(self):
        config = aggregator.load_platform_config()
        self.assertEqual(
            aggregator.strategy_label_from_config(
                config, "soxl_soxx_trend_income", locale="zh"
            ),
            "半导体趋势收益",
        )
        self.assertEqual(
            aggregator.strategy_label_from_config(
                config, "tqqq_growth_income", locale="en"
            ),
            "NASDAQ Growth Income",
        )

    def test_multi_account_candidates_render_separately_and_unknown_fills(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "candidates.json"
            path.write_text(
                json.dumps(
                    {
                        "runs": [
                            {
                                "platform_id": "schwab",
                                "business_day": "2026-10-08",
                                "strategy_profile": "soxl_soxx_trend_income",
                                "opaque_account_uid": "acct-a",
                                "target_id": "schwab/a",
                                "actually_ran": True,
                                "cycle_count": 1,
                                "fill_count": None,
                                "order_count": None,
                                "field_status": {
                                    "fill_count": "counts_unknown",
                                    "order_count": "counts_unknown",
                                },
                                "reason_code": "counts_unknown",
                                "evidence_provenance": "candidates",
                            },
                            {
                                "platform_id": "schwab",
                                "business_day": "2026-10-08",
                                "strategy_profile": "soxl_soxx_trend_income",
                                "opaque_account_uid": "acct-b",
                                "target_id": "schwab/b",
                                "actually_ran": True,
                                "cycle_count": 1,
                                "fill_count": 0,
                                "order_count": 0,
                                "evidence_provenance": "candidates",
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )
            payload, text, collected = aggregator.build_digest_payload(
                business_day="2026-10-08",
                locale="zh",
                candidates_path=path,
                include_github=False,
            )
            self.assertEqual(len(payload.runs), 2)
            self.assertIn("数据缺失：EVIDENCE_NOT_FOUND", text)
            self.assertIn("无交易", text)  # verified zero on acct-b line
            self.assertIsNone(digest.total_fills(payload.runs))
            receipt = aggregator.build_receipt(
                payload, collected, message_chars=len(text)
            )
            self.assertEqual(receipt["total_fills_status"], "unknown")
            identities = {
                (r["identity"]["opaque_account_uid"], r["identity"]["target_id"])
                for r in receipt["runs"]
            }
            self.assertEqual(
                identities, {("acct-a", "schwab/a"), ("acct-b", "schwab/b")}
            )

    def test_github_api_failure_recorded_not_silent_healthy(self):
        config = aggregator.load_platform_config()
        allowlist = [
            {
                "platform_id": "schwab",
                "repository": "QuantStrategyLab/CharlesSchwabPlatform",
                "workflow": "publish-runtime-daily-once.yml",
                "strategy_profile": "soxl_soxx_trend_income",
            }
        ]
        with mock.patch.object(
            aggregator,
            "_gh_api_get",
            side_effect=RuntimeError("GitHub API HTTP 403 for test"),
        ):
            result = aggregator.collect_from_github_workflows(
                business_day="2026-10-08",
                config=config,
                token="fake-token",
                allowlist=allowlist,
            )
        self.assertEqual(result.rows, [])
        self.assertEqual(len(result.failures), 1)
        self.assertEqual(result.failures[0]["reason_code"], "github_api_error")
        self.assertEqual(result.sources_queried, 1)

        coverage = digest.EvidenceCoverage(
            github_enabled=True,
            github_sources_queried=result.sources_queried,
            github_sources_matched=0,
            github_failures=tuple(result.failures),
        )
        payload = digest.DailyDigestInput(
            business_day="2026-10-08",
            locale="zh",
            runs=(),
            evidence_coverage=coverage,
        )
        text = digest.render_daily_digest(payload)
        self.assertIn("证据未知或读取失败", text)
        self.assertNotIn("监测链路心跳正常", text)
        self.assertNotIn("已验证无平台", text)

    def test_github_stub_omits_fake_zero_fills(self):
        config = aggregator.load_platform_config()
        allowlist = [
            {
                "platform_id": "ibkr",
                "repository": "QuantStrategyLab/InteractiveBrokersPlatform",
                "workflow": "publish-runtime-daily-once.yml",
                "strategy_profile": "soxl_soxx_trend_income",
            }
        ]
        fake_payload = {
            "workflow_runs": [
                {
                    "conclusion": "success",
                    "updated_at": "2026-10-08T18:00:00Z",
                    "created_at": "2026-10-08T17:00:00Z",
                }
            ]
        }
        with mock.patch.object(aggregator, "_gh_api_get", return_value=fake_payload):
            result = aggregator.collect_from_github_workflows(
                business_day="2026-10-08",
                config=config,
                token="fake-token",
                allowlist=allowlist,
            )
        self.assertEqual(len(result.rows), 1)
        stub = result.rows[0]
        self.assertTrue(stub["actually_ran"])
        self.assertIsNone(stub["fill_count"])
        self.assertIsNone(stub["order_count"])
        self.assertEqual(stub["reason_code"], "github_workflow_existence_only")
        filtered = digest.filter_runs_for_digest(result.rows)
        self.assertIsNone(filtered[0].fill_count)
        self.assertEqual(filtered[0].fill_count_status, "unknown")

    def test_receipt_includes_coverage_and_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "candidates.json"
            path.write_text(
                json.dumps(
                    {
                        "runs": [
                            {
                                "platform_id": "ibkr",
                                "business_day": "2026-10-08",
                                "strategy_profile": "soxl_soxx_trend_income",
                                "opaque_account_uid": "ibkr-opaque",
                                "target_id": "ibkr/demo",
                                "actually_ran": True,
                                "fill_count": 1,
                                "order_count": 1,
                                "evidence_provenance": "candidates",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            payload, text, collected = aggregator.build_digest_payload(
                business_day="2026-10-08",
                locale="zh",
                candidates_path=path,
                include_github=False,
            )
            receipt = aggregator.build_receipt(
                payload, collected, message_chars=len(text)
            )
            self.assertIn("source_coverage", receipt)
            self.assertTrue(receipt["source_coverage"]["candidates_loaded"])
            self.assertEqual(receipt["runs"][0]["field_provenance"]["fill_count"], "candidates")
            self.assertEqual(
                receipt["runs"][0]["identity"]["opaque_account_uid"], "ibkr-opaque"
            )


class DailyDigestWorkflowContractTests(unittest.TestCase):
    def test_retired_workflow_allows_manual_previews_only(self):
        workflow = (
            Path(__file__).resolve().parents[2]
            / ".github/workflows/daily-digest-notify.yml"
        ).read_text(encoding="utf-8")
        self.assertNotIn("\n  schedule:\n", workflow)
        self.assertIn("send_daily_digest_telegram.py --dry-run", workflow)
        self.assertIn("workflow_dispatch", workflow)
        self.assertIn("runtime-strategy-switch", workflow)
        self.assertIn("send_daily_digest_telegram.py", workflow)
        self.assertNotIn("api.telegram.org/bot", workflow)
        self.assertIn("dry_run", workflow)
        self.assertIn("DIGEST_CANDIDATES", workflow)
        self.assertIn("Materialize DIGEST_CANDIDATES", workflow)


if __name__ == "__main__":
    unittest.main()


class CandidateFreshnessTests(unittest.TestCase):
    """NOTIFY-04: stale DIGEST_CANDIDATES rows are dropped, never replayed."""

    def _write(self, tmp: str, rows: list[dict]) -> Path:
        path = Path(tmp) / "candidates.json"
        path.write_text(
            json.dumps({"schema_version": "qsl.digest_candidates.v1", "runs": rows}),
            encoding="utf-8",
        )
        return path

    def _row(self, **extra) -> dict:
        row = {
            "platform_id": "schwab",
            "strategy_profile": "soxl_soxx_trend_income",
            "opaque_account_uid": "acct-a",
            "target_id": "schwab/live",
            "actually_ran": True,
            "cycle_count": 1,
            "fill_count": None,
            "field_status": {"fill_count": "counts_unknown"},
            "equity": 990.06,
            "signal_summary": "hold",
        }
        row.update(extra)
        return row

    def test_candidate_business_day_sources(self):
        self.assertEqual(
            aggregator.candidate_business_day({"business_day": "2026-10-09"}),
            ("2026-10-09", "ok"),
        )
        # as_of falls back to the New York calendar day (02:00Z → prior NY day).
        self.assertEqual(
            aggregator.candidate_business_day({"as_of": "2026-10-10T02:00:00Z"}),
            ("2026-10-09", "ok"),
        )
        self.assertEqual(aggregator.candidate_business_day({}), ("", "missing"))
        self.assertEqual(
            aggregator.candidate_business_day({"business_day": "yesterday"}),
            ("", "invalid"),
        )

    def test_stale_rows_dropped_and_fresh_rows_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(
                tmp,
                [
                    self._row(business_day="2026-10-12"),
                    self._row(
                        platform_id="ibkr",
                        strategy_profile="tqqq_growth_income",
                        opaque_account_uid="acct-b",
                        target_id="ibkr/live",
                        business_day="2026-10-08",
                    ),
                ],
            )
            payload, text, collected = aggregator.build_digest_payload(
                business_day="2026-10-12",
                locale="zh",
                candidates_path=path,
                include_github=False,
            )
            receipt = aggregator.build_receipt(payload, collected, message_chars=len(text))
        self.assertEqual([r.platform_id for r in payload.runs], ["schwab"])
        self.assertEqual(receipt["source_coverage"]["candidates_count"], 1)
        self.assertEqual(receipt["source_coverage"]["stale_candidates_count"], 1)
        stale = receipt["stale_candidates"][0]
        self.assertEqual(stale["platform_id"], "ibkr")
        self.assertEqual(stale["candidate_business_day"], "2026-10-08")
        self.assertEqual(stale["reason_code"], "candidate_business_day_stale")
        self.assertNotIn("opaque_account_uid", stale)
        self.assertNotIn("equity", stale)
        self.assertIn("⚠️ 以下账户今天的数据缺失或过期：", text)
        self.assertIn("· ibkr / 纳斯达克增长收益（数据缺失：EVIDENCE_STALE_BUSINESS_DAY", text)
        self.assertIn("数据业务日 2026-10-08", text)

    def test_all_stale_is_not_verified_idle(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(
                tmp,
                [
                    self._row(business_day="2026-10-09"),
                    self._row(opaque_account_uid="acct-z"),  # undated
                ],
            )
            payload, text, collected = aggregator.build_digest_payload(
                business_day="2026-10-12",
                locale="zh",
                candidates_path=path,
                include_github=False,
            )
            receipt = aggregator.build_receipt(payload, collected, message_chars=len(text))
        self.assertEqual(payload.runs, ())
        self.assertEqual(receipt["evidence_status"], "evidence_unknown")
        self.assertFalse(receipt["source_coverage"]["is_complete_for_verified_idle"])
        self.assertNotIn("已验证无平台", text)
        self.assertNotIn("990", text)
        self.assertIn("今日候选数据均未更新，不能判定为链路正常。", text)
        self.assertIn("数据业务日 2026-10-09", text)
        self.assertIn("未注明业务日", text)
        reasons = sorted(item["reason_code"] for item in receipt["stale_candidates"])
        self.assertEqual(
            reasons,
            ["candidate_business_day_missing", "candidate_business_day_stale"],
        )

    def test_future_row_dropped_and_english_note(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(tmp, [self._row(business_day="2026-10-13")])
            payload, text, collected = aggregator.build_digest_payload(
                business_day="2026-10-12",
                locale="en",
                candidates_path=path,
                include_github=False,
            )
        self.assertEqual(payload.runs, ())
        self.assertEqual(
            collected.coverage.stale_candidates[0]["reason_code"],
            "candidate_business_day_future",
        )
        self.assertIn("⚠️ These accounts have missing or stale data today:", text)
        self.assertIn("data business day 2026-10-13", text)

    def test_no_stale_note_when_all_fresh(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(tmp, [self._row(business_day="2026-10-12")])
            _payload, text, collected = aggregator.build_digest_payload(
                business_day="2026-10-12",
                locale="zh",
                candidates_path=path,
                include_github=False,
            )
        self.assertEqual(collected.coverage.stale_candidates, ())
        self.assertNotIn("数据未更新", text)

    def test_schema_declares_as_of(self):
        schema = json.loads(
            (ROOT.parent / "schemas" / "qsl-digest-candidates.v1.schema.json").read_text(
                encoding="utf-8"
            )
        )
        props = schema["$defs"]["run"]["properties"]
        self.assertIn("as_of", props)
        self.assertIn("business_day", props)


class SectionsLayoutTests(unittest.TestCase):
    """NOTIFY-04 B1: opt-in four-section layout with Shanghai cut-off window."""

    def _write(self, tmp: str, rows: list[dict]) -> Path:
        path = Path(tmp) / "candidates.json"
        path.write_text(
            json.dumps({"schema_version": "qsl.digest_candidates.v1", "runs": rows}),
            encoding="utf-8",
        )
        return path

    def test_window_is_shanghai_0600_to_0600(self):
        window = aggregator.digest_window_for("2026-10-12")
        self.assertEqual(window["report_date"], "2026-10-13")
        self.assertEqual(window["start_local"], "2026-10-12 06:00")
        self.assertEqual(window["end_local"], "2026-10-13 06:00")
        self.assertEqual(window["start_utc"], "2026-10-11T22:00:00Z")
        self.assertEqual(window["end_utc"], "2026-10-12T22:00:00Z")

    def test_section_inference_from_config(self):
        config = aggregator.load_platform_config()
        self.assertEqual(aggregator.section_for_profile(config, "soxl_soxx_trend_income"), "us_daily")
        self.assertEqual(aggregator.section_for_profile(config, "ibit_smart_dca"), "dca")
        self.assertEqual(aggregator.section_for_profile(config, "nasdaq_sp500_smart_dca"), "dca")
        self.assertEqual(aggregator.section_for_profile(config, "crypto_btc_dca"), "dca")
        self.assertEqual(
            aggregator.section_for_profile(config, "crypto_live_pool_rotation"), "crypto_intraday"
        )

    def test_v1_remains_default(self):
        with mock.patch.dict("os.environ", {}, clear=False):
            import os

            os.environ.pop("DIGEST_LAYOUT", None)
            payload, text, _ = aggregator.build_digest_payload(
                business_day="2026-10-12", locale="zh", include_github=False
            )
        self.assertEqual(payload.layout, "v1")
        self.assertNotIn("📈 美股日策略", text)

    def test_sections_render_order_and_content(self):
        rows = [
            {
                "platform_id": "schwab",
                "business_day": "2026-10-12",
                "strategy_profile": "soxl_soxx_trend_income",
                "opaque_account_uid": "a",
                "actually_ran": True,
                "cycle_count": 1,
                "fill_count": 0,
                "order_count": 0,
            },
            {
                "platform_id": "firstrade",
                "business_day": "2026-10-12",
                "strategy_profile": "ibit_smart_dca",
                "opaque_account_uid": "b",
                "actually_ran": True,
                "cycle_count": 1,
                "fill_count": 1,
                "order_count": 1,
            },
            {
                "platform_id": "binance",
                "business_day": "2026-10-12",
                "strategy_profile": "crypto_live_pool_rotation",
                "opaque_account_uid": "c",
                "actually_ran": True,
                "cycle_count": 24,
                "fill_count": None,
                "field_status": {"fill_count": "counts_unknown"},
                "status": "alert",
                "reason_code": "circuit_breaker",
            },
            {
                "platform_id": "ibkr",
                "business_day": "2026-10-09",
                "strategy_profile": "tqqq_growth_income",
                "opaque_account_uid": "d",
                "actually_ran": True,
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            payload, text, collected = aggregator.build_digest_payload(
                business_day="2026-10-12",
                locale="zh",
                candidates_path=self._write(tmp, rows),
                include_github=False,
                layout="sections_v2",
            )
            receipt = aggregator.build_receipt(payload, collected, message_chars=len(text))
        lines = text.split("\n")
        self.assertEqual(lines[0], "📡 量化哨兵 · 日报 2026-10-13")
        self.assertEqual(lines[1], "窗口 2026-10-12 06:00 → 2026-10-13 06:00（上海时间）")
        order = [
            text.index("⚠️ 待处理"),
            text.index("📈 美股日策略（纽约交易日 2026-10-12）"),
            text.index("💰 定投"),
            text.index("🪙 加密小时策略"),
            text.index("🧾 覆盖"),
        ]
        self.assertEqual(order, sorted(order))
        self.assertIn("circuit_breaker", text.split("📈")[0])
        self.assertIn("数据业务日 2026-10-09", text.split("📈")[0])
        self.assertIn("firstrade", text.split("💰 定投")[1].split("🪙")[0])
        self.assertIn("binance", text.split("🪙 加密小时策略")[1])
        self.assertIn("已收录 3 条运行；候选 3 条可用、1 条过期已略去", text)
        self.assertEqual(receipt["layout"], "sections_v2")
        self.assertEqual(receipt["window"]["end_utc"], "2026-10-12T22:00:00Z")
        self.assertEqual(
            sorted(r["section"] for r in receipt["runs"]),
            ["crypto_intraday", "dca", "us_daily"],
        )

    def test_weekend_us_section_market_closed_and_empty_sections_omitted(self):
        with tempfile.TemporaryDirectory() as tmp:
            rows = [
                {
                    "platform_id": "binance",
                    "business_day": "2026-10-10",
                    "strategy_profile": "crypto_live_pool_rotation",
                    "actually_ran": True,
                    "cycle_count": 24,
                }
            ]
            _payload, text, _ = aggregator.build_digest_payload(
                business_day="2026-10-10",
                locale="zh",
                candidates_path=self._write(tmp, rows),
                include_github=False,
                layout="sections_v2",
            )
        us = text.split("📈 美股日策略（纽约交易日 2026-10-10）")[1].split("\n")[1]
        self.assertEqual(us, "休市")
        self.assertNotIn("💰 定投", text)
        self.assertIn("🪙 加密小时策略", text)
        self.assertNotIn("⚠️ 待处理", text)

    def test_weekday_without_evidence_is_not_claimed_idle(self):
        _payload, text, _ = aggregator.build_digest_payload(
            business_day="2026-10-12", locale="en", include_github=False, layout="sections_v2"
        )
        self.assertIn("📡 QuantSentinel · Daily report 2026-10-13", text)
        self.assertIn("No run evidence in this window", text)
        self.assertIn("link health is not confirmed", text)

    def test_manual_preview_keeps_explicit_layout_selection(self):
        text = (ROOT.parent / ".github/workflows/daily-digest-notify.yml").read_text(encoding="utf-8")
        self.assertIn('echo "layout=v1" >> "$GITHUB_OUTPUT"', text)
        self.assertIn("default: v1", text)
        self.assertNotIn("\n  schedule:\n", text)
        self.assertIn("QRS_UNIFIED_NOTIFICATION_ENABLED || 'false'", text)
