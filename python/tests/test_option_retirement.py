"""Retired option defaults must not enter a newly prepared runtime target."""
from argparse import Namespace
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python/scripts"))
import build_platform_config as generator
import build_runtime_switch as switch
import runtime_settings


class OptionRetirementTest(unittest.TestCase):
    def test_source_and_generated_profiles_do_not_enable_retired_options(self):
        config = json.loads((ROOT / "platform-config.json").read_text())
        profiles = generator.build_strategy_profile_entries(config)
        for profile in (
            "tqqq_growth_income", "soxl_soxx_trend_income", "russell_top50_leader_rotation",
            "nasdaq_sp500_smart_dca", "ibit_smart_dca", "us_equity_combo",
            "us_equity_combo_core", "us_equity_combo_leveraged",
        ):
            with self.subTest(profile=profile):
                strategy = config["strategies"][profile]
                self.assertIs(strategy["features"]["option_overlay"], False)
                self.assertNotIn("option_overlay_defaults", strategy)
                entry = next(x for x in profiles if x["profile"] == profile)
                self.assertIs(entry["option_overlay_enabled"], False)
                self.assertFalse(any(key.startswith("option_growth_overlay_") or
                                     key.startswith("option_income_overlay_") for key in entry))

    def test_current_preserves_existing_option_variables_without_writes(self):
        self.assertEqual(switch._option_overlay_extra_variables(Namespace(), "tqqq_growth_income"), {})
        self.assertEqual(switch._option_overlay_extra_variables(
            Namespace(option_overlay_mode="current"), "tqqq_growth_income"), {})

    def test_enabled_requires_manual_migration(self):
        with self.assertRaisesRegex(ValueError, "retired"):
            switch._option_overlay_extra_variables(Namespace(option_overlay_mode="enabled"), "tqqq_growth_income")

    def test_explicit_disabled_emits_disabled_switches_and_clears_legacy_values(self):
        values = switch._option_overlay_extra_variables(Namespace(option_overlay_mode="disabled"), "tqqq_growth_income")
        self.assertEqual(values["OPTION_OVERLAY_ENABLED"], "false")
        self.assertEqual(values["OPTION_GROWTH_OVERLAY_ENABLED"], "false")
        self.assertEqual(values["OPTION_INCOME_OVERLAY_ENABLED"], "false")
        self.assertEqual(values["OPTION_GROWTH_OVERLAY_RECIPE"], "")
        self.assertEqual(values["OPTION_INCOME_OVERLAY_RECIPE"], "")

    def test_existing_active_or_nonempty_legacy_values_require_migration(self):
        for values in (
            {"OPTION_OVERLAY_ENABLED": "true"},
            {"OPTION_GROWTH_OVERLAY_RECIPE": "tqqq_leaps_growth_v1"},
            {"OPTION_INCOME_OVERLAY_START_USD": "150000"},
            {"OPTION_OVERLAY_ENABLED": "false", "OPTION_INCOME_OVERLAY_START_USD": "0"},
            {"OPTION_GROWTH_OVERLAY_NAV_BUDGET_RATIO": "0"},
            {"OPTION_INCOME_OVERLAY_NAV_RISK_RATIO": "0.01"},
        ):
            with self.subTest(values=values):
                errors = []
                runtime_settings.validate_option_overlay_variables(values, errors)
                self.assertTrue(any("retired" in error for error in errors))

    def test_false_and_empty_values_are_allowed(self):
        errors = []
        runtime_settings.validate_option_overlay_variables(switch._disabled_option_overlay_extra_variables(), errors)
        self.assertEqual(errors, [])
