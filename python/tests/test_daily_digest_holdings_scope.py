from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
REPO = ROOT.parent


def _load_module(name: str):
    if str(SCRIPTS) not in sys.path:
        sys.path.insert(0, str(SCRIPTS))
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


aggregator = _load_module("daily_digest_aggregator")
digest = _load_module("daily_digest_notify")


def _row(**extra):
    row = {
        "platform_id": "ibkr",
        "strategy_profile": "global_etf_rotation",
        "opaque_account_uid": "ibkr-opaque",
        "target_id": "ibkr/live",
        "actually_ran": True,
        "cycle_count": 1,
        "fill_count": None,
        "field_status": {"fill_count": "counts_unknown"},
        "equity": 1000.0,
    }
    row.update(extra)
    return row


def _render(rows, locale="zh"):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "candidates.json"
        path.write_text(json.dumps({"runs": rows}, ensure_ascii=False), encoding="utf-8")
        payload, text, _ = aggregator.build_digest_payload(
            business_day="2026-10-09",
            locale=locale,
            candidates_path=path,
            include_github=False,
        )
    return payload, text


class HoldingsScopeTests(unittest.TestCase):
    def test_scope_label_rendered_zh(self):
        payload, text = _render(
            [
                _row(
                    holdings=[{"symbol": "VOO", "quantity": 2, "market_value": 1000.5, "currency": "USD"}],
                    holdings_scope="stocks_only",
                )
            ]
        )
        self.assertEqual(payload.runs[0].holdings_scope, "stocks_only")
        self.assertIn("💼 持仓（仅股票）", text)
        self.assertIn("VOO: $1,000.50 / 2股", text)

    def test_strategy_symbols_scope_zh_and_en(self):
        rows = [
            _row(
                platform_id="schwab",
                strategy_profile="soxl_soxx_trend_income",
                holdings=[{"symbol": "SOXL", "quantity": 4, "market_value": 635.92}],
                holdings_scope="strategy_symbols_only",
            )
        ]
        _, zh = _render(rows)
        self.assertIn("💼 持仓（仅策略标的）", zh)
        _, en = _render(rows, locale="en")
        self.assertIn("💼 Holdings (strategy symbols only)", en)

    def test_unknown_scope_is_dropped_and_plain_label_kept(self):
        payload, text = _render(
            [_row(holdings=[{"symbol": "VOO", "quantity": 1}], holdings_scope="whatever")]
        )
        self.assertEqual(payload.runs[0].holdings_scope, "")
        self.assertIn("💼 持仓\n", text)

    def test_absent_holdings_renders_without_holdings_block(self):
        payload, text = _render([_row()])
        self.assertEqual(payload.runs[0].holdings, ())
        self.assertNotIn("持仓", text)
        self.assertIn("账户总权益", text)

    def test_scope_without_holdings_renders_nothing(self):
        _, text = _render([_row(holdings_scope="stocks_only")])
        self.assertNotIn("持仓", text)

    def test_merge_keeps_scope_paired_with_supplied_holdings(self):
        merged = aggregator.merge_candidates(
            [_row(equity=None, note="stub")],
            [
                _row(
                    holdings=[{"symbol": "VOO", "quantity": 1}],
                    holdings_scope="stocks_only",
                )
            ],
        )
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].get("holdings_scope"), "stocks_only")
        self.assertTrue(merged[0].get("holdings"))

    def test_schema_declares_holdings_scope_enum(self):
        schema = json.loads(
            (REPO / "schemas" / "qsl-digest-candidates.v1.schema.json").read_text(encoding="utf-8")
        )
        prop = schema["$defs"]["run"]["properties"]["holdings_scope"]
        self.assertEqual(set(prop["enum"]), {"strategy_symbols_only", "stocks_only"})


if __name__ == "__main__":
    unittest.main()
