import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python" / "scripts"))

import schema_check  # noqa: E402


class SchemaCheckTests(unittest.TestCase):
    def test_strict_int_rejects_booleans_and_out_of_bounds(self) -> None:
        self.assertTrue(schema_check.is_strict_int(0, min_value=0))
        self.assertTrue(schema_check.is_strict_int(42, min_value=1, max_value=100))
        self.assertFalse(schema_check.is_strict_int(True, min_value=0))
        self.assertFalse(schema_check.is_strict_int(False, min_value=0))
        self.assertFalse(schema_check.is_strict_int(0, min_value=1))
        self.assertFalse(schema_check.is_strict_int(101, max_value=100))

    def test_validate_mapping_schema_checks_required_types_and_unsupported(self) -> None:
        rules = {
            "id": schema_check.FieldRule(kind="nonempty_str"),
            "count": schema_check.FieldRule(kind="strict_int", min_value=1),
            "digest": schema_check.FieldRule(kind="sha256", required=False),
            "mode": schema_check.FieldRule(kind="choice", choices={"paper", "live"}),
        }
        errors: list[str] = []
        ok = schema_check.validate_mapping_schema(
            {"id": "target-a", "count": 2, "digest": "a" * 64, "mode": "paper"},
            rules,
            errors=errors,
            prefix="sample",
        )
        self.assertTrue(ok)
        self.assertEqual(errors, [])

        bad_errors: list[str] = []
        schema_check.validate_mapping_schema(
            {"count": True, "mode": "bad", "extra": 1},
            rules,
            errors=bad_errors,
            prefix="sample",
        )
        self.assertIn("sample contains unsupported fields: extra", bad_errors)
        self.assertIn("sample.id is required", bad_errors)
        self.assertIn("sample.count is invalid", bad_errors)
        self.assertIn("sample.mode is invalid", bad_errors)

    def test_utc_timestamp_and_sha256_helpers(self) -> None:
        self.assertIsNotNone(schema_check.parse_utc_iso_timestamp("2026-01-02T03:04:05Z"))
        self.assertIsNone(schema_check.parse_utc_iso_timestamp("2026-01-02T03:04:05+08:00"))
        self.assertTrue(schema_check.is_sha256_str("sha256:" + "a" * 64, allow_prefix=True, lowercase_only=True))
        self.assertFalse(schema_check.is_sha256_str("sha256:" + "A" * 64, allow_prefix=True, lowercase_only=True))

    def test_matches_mapping_rules_and_list_predicates(self) -> None:
        rules = {
            "kind": schema_check.FieldRule(kind="prefix", prefix="daily."),
            "schedule": schema_check.FieldRule(kind="cron_or_time"),
            "active": schema_check.FieldRule(kind="bool", required=False),
            "tags": schema_check.FieldRule(kind="nonempty_str_list", unique=True, required=False),
        }
        self.assertTrue(
            schema_check.matches_mapping_rules(
                {"kind": "daily.digest", "schedule": "0 8 * * *", "active": True, "tags": ["a", "b"]},
                rules,
                exact_keys=False,
            )
        )
        self.assertFalse(
            schema_check.matches_mapping_rules(
                {"kind": "daily.digest", "schedule": "0 8 * * *"},
                rules,
                exact_keys=True,
            )
        )
        self.assertFalse(
            schema_check.matches_mapping_rules(
                {"kind": "other", "schedule": "08:00 UTC"},
                rules,
                exact_keys=False,
            )
        )
        self.assertTrue(schema_check.is_list_of_dicts([{"x": 1}], non_empty=True))
        self.assertFalse(schema_check.is_list_of_dicts([], non_empty=True))
        self.assertFalse(schema_check.is_list_of_dicts([{"x": 1}, "bad"], non_empty=False))

    def test_validate_variable_mapping_enforces_guardrails(self) -> None:
        errors: list[str] = []
        schema_check.validate_variable_mapping(
            {
                "GEN_KEY": "1",
                "DUP_KEY": "2",
                "RESEARCH_ONLY": "3",
                "API_TOKEN": "4",
                "MULTILINE": "a\nb",
            },
            scope_name="extra_variables",
            generated_names={"GEN_KEY"},
            research_only_names=frozenset({"RESEARCH_ONLY"}),
            is_secret_fn=lambda name: "TOKEN" in name,
            validate_inventory_fn=lambda value, *, path, errors: None,
            errors=errors,
            duplicate_names={"DUP_KEY"},
            duplicate_label="extra_variables",
        )
        self.assertEqual(len(errors), 5)


if __name__ == "__main__":
    unittest.main()
