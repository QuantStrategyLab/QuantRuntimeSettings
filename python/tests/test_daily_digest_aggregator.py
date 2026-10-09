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
            self.assertIn("💓 【心跳检测】", text)
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
            self.assertIn("成交 未知", text)
            self.assertIn("无成交", text)  # verified zero on acct-b line
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
        self.assertIn("DIGEST_CANDIDATES", workflow)
        self.assertIn("Materialize DIGEST_CANDIDATES", workflow)
        self.assertIn("digest-candidates-wiring.zh-CN.md", workflow)


if __name__ == "__main__":
    unittest.main()
