"""Candidate contract accepts optional account observations and legacy rows."""
import copy
import json
from pathlib import Path
import unittest

try:
    import jsonschema
except ImportError:
    jsonschema = None


@unittest.skipIf(jsonschema is None, "jsonschema is not installed")
class AccountDailyFactsSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[2] / "schemas/qsl-digest-candidates.v1.schema.json"
        schema = json.loads(path.read_text(encoding="utf-8"))
        jsonschema.Draft202012Validator.check_schema(schema)
        cls.validator = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())
        cls.legacy = {"schema_version": "qsl.digest_candidates.v1", "runs": [{"platform_id": "example", "strategy_profile": "demo", "actually_ran": True}]}
        stamp = "2026-10-16T05:10:00+08:00"
        cls.facts = {
            "orders": [{"id": "order", "submission_window_start": stamp, "submission_window_end": stamp,
                        "quantity": 3, "filled_quantity": None, "currency": "USD"}],
            "fills": [{"id": "fill", "order_id": "order", "occurred_at": stamp, "quantity": 1, "price": 60}],
            "snapshots": [{"as_of": stamp, "equity": 50000, "equity_currency": "USD",
                           "holdings_scope": "account", "holdings_complete": True,
                           "holdings": [{"symbol": "TQQQ", "quantity": 300, "asset_type": "stock"}]}],
        }

    def test_legacy_and_account_facts_validate(self):
        self.validator.validate(self.legacy)
        candidate = copy.deepcopy(self.legacy)
        candidate["runs"][0]["account_daily_facts"] = self.facts
        self.validator.validate(candidate)

    def test_malformed_facts_are_rejected(self):
        for invalid in ({"fills": [{"id": "fill"}]}, {"orders": "not-an-array"},
                        {"snapshots": [{"as_of": 123}]}, {"unexpected": True}):
            with self.subTest(invalid=invalid):
                candidate = copy.deepcopy(self.legacy)
                candidate["runs"][0]["account_daily_facts"] = invalid
                self.assertFalse(self.validator.is_valid(candidate))


if __name__ == "__main__":
    unittest.main()
