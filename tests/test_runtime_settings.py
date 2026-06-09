from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "runtime_settings.py"
SPEC = importlib.util.spec_from_file_location("runtime_settings", MODULE_PATH)
runtime_settings = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = runtime_settings
SPEC.loader.exec_module(runtime_settings)

SWITCH_MODULE_PATH = ROOT / "scripts" / "build_runtime_switch.py"
SWITCH_SPEC = importlib.util.spec_from_file_location("build_runtime_switch", SWITCH_MODULE_PATH)
build_runtime_switch = importlib.util.module_from_spec(SWITCH_SPEC)
assert SWITCH_SPEC.loader is not None
sys.modules[SWITCH_SPEC.name] = build_runtime_switch
SWITCH_SPEC.loader.exec_module(build_runtime_switch)


class RuntimeSettingsTest(unittest.TestCase):
    def load_target(self, relative_path: str):
        path = ROOT / relative_path
        return path, runtime_settings.load_target(path)

    def test_all_targets_validate(self):
        for path in sorted((ROOT / "examples" / "targets").glob("*/*.json")):
            with self.subTest(path=path):
                self.assertEqual(runtime_settings.validate_target(runtime_settings.load_target(path), path), [])

    def test_runtime_target_json_is_canonical_source_for_strategy_profile(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertIn("RUNTIME_TARGET_JSON", assignments)
        self.assertEqual(assignments["STRATEGY_PROFILE"], target["runtime_target"]["strategy_profile"])
        self.assertNotIn("STRATEGY_PROFILE", target["extra_variables"])

    def test_example_targets_have_matching_plugin_mount(self):
        for relative_path in (
            "examples/targets/schwab/live.example.json",
            "examples/targets/longbridge/sg.example.json",
            "examples/targets/firstrade/live.example.json",
        ):
            with self.subTest(relative_path=relative_path):
                _, target = self.load_target(relative_path)
                profile = target["runtime_target"]["strategy_profile"]
                self.assertTrue(
                    any(
                        mount["strategy"] == profile
                        and mount["enabled"] is True
                        for mount in target["plugin_mounts"]
                    )
                )

    def test_plugin_mount_schema_version_is_rendered_for_platform_parser(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertIn(
            '"expected_schema_version":"example_notification_plugin.v1"',
            assignments["SCHWAB_STRATEGY_PLUGIN_MOUNTS_JSON"],
        )

    def test_plugin_mount_schema_version_must_be_non_empty_string(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        target["plugin_mounts"][0]["expected_schema_version"] = ""

        self.assertIn(
            "plugin_mounts[0].expected_schema_version must be a non-empty string",
            runtime_settings.validate_target(target),
        )

    def test_generated_variables_cannot_be_overridden(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        target["extra_variables"] = {"STRATEGY_PROFILE": "old_strategy"}

        self.assertIn(
            "extra_variables.STRATEGY_PROFILE duplicates a generated variable",
            runtime_settings.validate_target(target),
        )

    def test_extra_variables_reject_secret_values_but_allow_secret_pointers(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        target["extra_variables"] = {
            "BROKER_ACCESS_TOKEN": "not-allowed",
            "EMAIL_PASSWORD": "not-allowed",
            "BROKER_SECRET_NAME": "allowed-secret-manager-name",
        }

        errors = runtime_settings.validate_target(target)

        self.assertIn(
            "extra_variables.BROKER_ACCESS_TOKEN looks like a secret and must not be stored here",
            errors,
        )
        self.assertIn(
            "extra_variables.EMAIL_PASSWORD looks like a secret and must not be stored here",
            errors,
        )
        self.assertNotIn(
            "extra_variables.BROKER_SECRET_NAME looks like a secret and must not be stored here",
            errors,
        )

    def test_longbridge_dry_run_flag_must_match_runtime_target(self):
        _, target = self.load_target("examples/targets/longbridge/sg.example.json")
        target["extra_variables"]["LONGBRIDGE_DRY_RUN_ONLY"] = "true"

        self.assertIn(
            "extra_variables.LONGBRIDGE_DRY_RUN_ONLY must match runtime_target.dry_run_only",
            runtime_settings.validate_target(target),
        )

    def test_firstrade_dry_run_flag_must_match_runtime_target(self):
        _, target = self.load_target("examples/targets/firstrade/live.example.json")
        target["extra_variables"]["FIRSTRADE_DRY_RUN_ONLY"] = "true"

        self.assertIn(
            "extra_variables.FIRSTRADE_DRY_RUN_ONLY must match runtime_target.dry_run_only",
            runtime_settings.validate_target(target),
        )

    def test_build_switch_target_defaults_longbridge_sg_tqqq(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "longbridge",
                "--target-name",
                "sg",
                "--strategy-profile",
                "tqqq_growth_income",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(target["github"]["repository"], "QuantStrategyLab/LongBridgePlatform")
        self.assertEqual(target["github"]["variable_scope"], "environment")
        self.assertEqual(target["github"]["environment"], "longbridge-sg")
        self.assertEqual(target["runtime_target"]["service_name"], "longbridge-quant-sg-service")
        self.assertEqual(target["runtime_target"]["account_scope"], "SG")
        self.assertEqual(assignments["STRATEGY_PROFILE"], "tqqq_growth_income")
        self.assertEqual(assignments["LONGBRIDGE_DRY_RUN_ONLY"], "false")
        plugin_payload = json.loads(assignments["LONGBRIDGE_STRATEGY_PLUGIN_MOUNTS_JSON"])
        self.assertEqual(plugin_payload["strategy_plugins"][0]["plugin"], "market_regime_control")
        self.assertEqual(plugin_payload["strategy_plugins"][0]["expected_schema_version"], "market_regime_control.v1")

    def test_build_switch_target_defaults_schwab_repository_scope(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "schwab",
                "--target-name",
                "live",
                "--strategy-profile",
                "soxl_soxx_trend_income",
                "--plugin-mode",
                "none",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(target["github"]["repository"], "QuantStrategyLab/CharlesSchwabPlatform")
        self.assertEqual(target["github"]["variable_scope"], "repository")
        self.assertNotIn("environment", target["github"])
        self.assertEqual(target["runtime_target"]["service_name"], "charles-schwab-quant-service")
        self.assertEqual(assignments["SCHWAB_DRY_RUN_ONLY"], "false")
        self.assertEqual(
            json.loads(assignments["SCHWAB_STRATEGY_PLUGIN_MOUNTS_JSON"]),
            {"strategy_plugins": []},
        )

    def test_build_switch_target_clears_plugin_mounts_for_unmounted_strategy(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "longbridge",
                "--target-name",
                "sg",
                "--strategy-profile",
                "soxl_soxx_trend_income",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(assignments["STRATEGY_PROFILE"], "soxl_soxx_trend_income")
        self.assertEqual(
            json.loads(assignments["LONGBRIDGE_STRATEGY_PLUGIN_MOUNTS_JSON"]),
            {"strategy_plugins": []},
        )

    def test_build_switch_target_defaults_firstrade_repository_scope(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "firsttrade",
                "--target-name",
                "live",
                "--strategy-profile",
                "tqqq_growth_income",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(target["github"]["repository"], "QuantStrategyLab/FirstradePlatform")
        self.assertEqual(target["github"]["variable_scope"], "repository")
        self.assertEqual(target["runtime_target"]["platform_id"], "firstrade")
        self.assertEqual(target["runtime_target"]["deployment_selector"], "firstrade")
        self.assertEqual(target["runtime_target"]["account_selector"], ["firstrade"])
        self.assertEqual(target["runtime_target"]["account_scope"], "US")
        self.assertEqual(target["runtime_target"]["service_name"], "firstrade-quant-service")
        self.assertEqual(assignments["FIRSTRADE_DRY_RUN_ONLY"], "false")
        self.assertEqual(assignments["STRATEGY_PROFILE"], "tqqq_growth_income")
        plugin_payload = json.loads(assignments["FIRSTRADE_STRATEGY_PLUGIN_MOUNTS_JSON"])
        self.assertEqual(plugin_payload["strategy_plugins"][0]["plugin"], "market_regime_control")

    def test_build_switch_target_rejects_secret_extra_variable(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "firstrade",
                "--target-name",
                "live",
                "--strategy-profile",
                "tqqq_growth_income",
                "--extra-variables-json",
                '{"BROKER_API_KEY":"not-allowed"}',
            ]
        )

        with self.assertRaisesRegex(ValueError, "BROKER_API_KEY looks like a secret"):
            build_runtime_switch.build_switch_target(args)

    def test_build_switch_target_patches_ibkr_service_targets_json(self):
        existing = {
            "defaults": {"NOTIFY_LANG": "zh"},
            "targets": [
                {
                    "service": "interactive-brokers-live-u1599-tqqq-service",
                    "ACCOUNT_GROUP": "live-u1599-tqqq",
                    "runtime_target": {
                        "platform_id": "ibkr",
                        "strategy_profile": "old_strategy",
                        "dry_run_only": False,
                        "deployment_selector": "live-u1599-tqqq",
                        "account_selector": ["U15998061"],
                        "account_scope": "live-u1599-tqqq",
                        "service_name": "interactive-brokers-live-u1599-tqqq-service",
                        "execution_mode": "live",
                    },
                },
                {
                    "service": "interactive-brokers-live-u1660-soxl-service",
                    "ACCOUNT_GROUP": "live-u1660-soxl",
                    "runtime_target": {
                        "platform_id": "ibkr",
                        "strategy_profile": "soxl_soxx_trend_income",
                        "dry_run_only": False,
                        "deployment_selector": "live-u1660-soxl",
                        "account_selector": ["U16608560"],
                        "account_scope": "live-u1660-soxl",
                        "service_name": "interactive-brokers-live-u1660-soxl-service",
                        "execution_mode": "live",
                    },
                },
            ],
        }
        path = ROOT / ".pytest_runtime_service_targets.json"
        path.write_text(runtime_settings.compact_json(existing), encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "live-u1599-tqqq",
                "--strategy-profile",
                "tqqq_growth_income",
                "--account-selector",
                "U15998061",
                "--service-name",
                "interactive-brokers-live-u1599-tqqq-service",
                "--existing-service-targets-json-file",
                str(path),
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}
        patched = json.loads(assignments["CLOUD_RUN_SERVICE_TARGETS_JSON"])
        patched_targets = patched["targets"]

        self.assertEqual(len(patched_targets), 2)
        selected = patched_targets[0]
        untouched = patched_targets[1]
        self.assertEqual(selected["runtime_target"]["strategy_profile"], "tqqq_growth_income")
        self.assertEqual(selected["IBKR_DRY_RUN_ONLY"], "false")
        self.assertEqual(
            selected["IBKR_STRATEGY_PLUGIN_MOUNTS_JSON"]["strategy_plugins"][0]["plugin"],
            "market_regime_control",
        )
        self.assertEqual(untouched["runtime_target"]["strategy_profile"], "soxl_soxx_trend_income")

    def test_build_switch_target_patches_ibkr_service_targets_with_empty_plugin_mounts(self):
        existing = {
            "targets": [
                {
                    "service": "interactive-brokers-live-u1599-tqqq-service",
                    "ACCOUNT_GROUP": "live-u1599-tqqq",
                    "runtime_target": {
                        "platform_id": "ibkr",
                        "strategy_profile": "tqqq_growth_income",
                        "dry_run_only": False,
                        "deployment_selector": "live-u1599-tqqq",
                        "account_selector": ["U15998061"],
                        "account_scope": "live-u1599-tqqq",
                        "service_name": "interactive-brokers-live-u1599-tqqq-service",
                        "execution_mode": "live",
                    },
                    "IBKR_STRATEGY_PLUGIN_MOUNTS_JSON": {
                        "strategy_plugins": [
                            {
                                "strategy": "tqqq_growth_income",
                                "plugin": "market_regime_control",
                                "signal_path": "gs://bucket/old/latest_signal.json",
                                "enabled": True,
                                "expected_mode": "shadow",
                            }
                        ]
                    },
                },
            ],
        }
        path = ROOT / ".pytest_runtime_service_targets_empty_mounts.json"
        path.write_text(runtime_settings.compact_json(existing), encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "live-u1599-tqqq",
                "--strategy-profile",
                "soxl_soxx_trend_income",
                "--account-selector",
                "U15998061",
                "--service-name",
                "interactive-brokers-live-u1599-tqqq-service",
                "--existing-service-targets-json-file",
                str(path),
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}
        patched = json.loads(assignments["CLOUD_RUN_SERVICE_TARGETS_JSON"])
        selected = patched["targets"][0]

        self.assertEqual(selected["runtime_target"]["strategy_profile"], "soxl_soxx_trend_income")
        self.assertEqual(selected["IBKR_STRATEGY_PLUGIN_MOUNTS_JSON"], {"strategy_plugins": []})


if __name__ == "__main__":
    unittest.main()
