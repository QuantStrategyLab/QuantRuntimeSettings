from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "python" / "scripts" / "runtime_settings.py"
SPEC = importlib.util.spec_from_file_location("runtime_settings", MODULE_PATH)
runtime_settings = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = runtime_settings
SPEC.loader.exec_module(runtime_settings)

SWITCH_MODULE_PATH = ROOT / "python" / "scripts" / "build_runtime_switch.py"
SWITCH_SPEC = importlib.util.spec_from_file_location("build_runtime_switch", SWITCH_MODULE_PATH)
build_runtime_switch = importlib.util.module_from_spec(SWITCH_SPEC)
assert SWITCH_SPEC.loader is not None
sys.modules[SWITCH_SPEC.name] = build_runtime_switch
SWITCH_SPEC.loader.exec_module(build_runtime_switch)


class RuntimeSettingsTest(unittest.TestCase):
    def test_manual_strategy_switch_workflow_stays_within_dispatch_input_limit(self):
        workflow = (ROOT / ".github/workflows/manual-strategy-switch.yml").read_text(encoding="utf-8")
        input_names: list[str] = []
        in_inputs = False
        for line in workflow.splitlines():
            if line.strip() == "inputs:":
                in_inputs = True
                continue
            if in_inputs and line.startswith("concurrency:"):
                break
            match = re.match(r"      ([A-Za-z0-9_]+):$", line)
            if in_inputs and match:
                input_names.append(match.group(1))

        self.assertLessEqual(len(input_names), 25)
        self.assertNotIn("dca_mode", input_names)
        self.assertNotIn("dca_base_investment_usd", input_names)
        self.assertNotIn("income_threshold_usd", input_names)
        self.assertNotIn("qqqi_income_ratio", input_names)

    def test_manual_switch_platform_choices_cover_supported_platforms(self):
        workflow = (ROOT / ".github/workflows/manual-strategy-switch.yml").read_text(encoding="utf-8")
        platform_choices: list[str] = []
        in_platform_options = False
        for line in workflow.splitlines():
            if line.strip() == "platform:":
                in_platform_options = False
                continue
            if line.strip() == "options:" and not platform_choices:
                in_platform_options = True
                continue
            if in_platform_options:
                match = re.match(r"\s+- ([A-Za-z0-9_-]+)$", line)
                if match:
                    platform_choices.append(match.group(1))
                    continue
                if platform_choices and line.strip() and not line.strip().startswith("-"):
                    break

        self.assertEqual(set(platform_choices), set(runtime_settings.SUPPORTED_PLATFORMS))

    def test_platform_config_default_strategy_profiles_exist(self):
        config = json.loads((ROOT / "platform-config.json").read_text(encoding="utf-8"))
        profiles = set(config["strategies"])
        for platform, data in config["platforms"].items():
            default_profile = data.get("default_account", {}).get("default_strategy_profile")
            if default_profile:
                with self.subTest(platform=platform):
                    self.assertIn(default_profile, profiles)

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
                    any(mount["strategy"] == profile and mount["enabled"] is True for mount in target["plugin_mounts"])
                )

    def test_plugin_mount_schema_version_is_rendered_for_platform_parser(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertIn(
            '"expected_schema_version":"example_notification_plugin.v1"',
            assignments["SCHWAB_STRATEGY_PLUGIN_MOUNTS_JSON"],
        )

    def test_auto_market_regime_control_profiles_cover_published_strategy_artifacts(self):
        strategy_profiles = {
            item["profile"]
            for item in json.loads(
                (ROOT / "web/strategy-switch-console/strategy-profiles.example.json").read_text(encoding="utf-8")
            )
        }
        published_strategy_artifact_profiles = {
            "tqqq_growth_income",
            "soxl_soxx_trend_income",
        }

        self.assertLessEqual(published_strategy_artifact_profiles, strategy_profiles)
        self.assertEqual(published_strategy_artifact_profiles, build_runtime_switch.MARKET_REGIME_CONTROL_PROFILES)

    def test_assignment_payload_can_redact_values(self):
        _, target = self.load_target("examples/targets/longbridge/sg.example.json")
        assignment = next(
            item for item in runtime_settings.build_assignments(target) if item.name == "RUNTIME_TARGET_JSON"
        )

        payload = runtime_settings.assignment_payload(assignment, redact_values=True)

        self.assertEqual(payload["value"], "<redacted>")
        self.assertTrue(payload["value_redacted"])
        self.assertNotIn(target["runtime_target"]["strategy_profile"], json.dumps(payload))
        self.assertNotIn(target["runtime_target"]["service_name"], json.dumps(payload))

    def test_assignment_shell_command_can_redact_body_and_metadata(self):
        _, target = self.load_target("examples/targets/longbridge/sg.example.json")
        assignment = next(
            item for item in runtime_settings.build_assignments(target) if item.name == "RUNTIME_TARGET_JSON"
        )

        command = assignment.shell_command(redact_body=True, redact_metadata=True)

        self.assertIn("--repo '<redacted>'", command)
        self.assertIn("--body '<redacted>'", command)
        self.assertIn("--env '<redacted>'", command)
        self.assertNotIn(assignment.value, command)
        self.assertNotIn(assignment.repository, command)
        self.assertNotIn(assignment.environment, command)

    def test_empty_assignment_deletes_variable_instead_of_setting_empty_body(self):
        assignment = runtime_settings.Assignment(
            "longbridge/sg",
            "QuantStrategyLab/LongBridgePlatform",
            "environment",
            "longbridge-sg",
            "LONGBRIDGE_MIN_RESERVED_CASH_USD",
            "",
        )

        self.assertTrue(assignment.deletes_variable)
        self.assertEqual(
            assignment.gh_command(),
            [
                "gh",
                "variable",
                "delete",
                "LONGBRIDGE_MIN_RESERVED_CASH_USD",
                "--repo",
                "QuantStrategyLab/LongBridgePlatform",
                "--env",
                "longbridge-sg",
            ],
        )
        self.assertNotIn("--body", assignment.shell_command())
        self.assertEqual(runtime_settings.assignment_payload(assignment)["action"], "delete")

    def test_manual_switch_account_default_sync_is_warning_only(self):
        workflow = (ROOT / ".github" / "workflows" / "manual-strategy-switch.yml").read_text(encoding="utf-8")

        self.assertIn("Strategy switch account default sync failed", workflow)
        self.assertIn("::warning::", workflow)
        self.assertIn("raise SystemExit(0)", workflow)
        self.assertIn('"variable_scope": "default"', workflow)
        self.assertIn("runtime_settings.extract_account_sync_controls(target)", workflow)
        self.assertIn('extra_variables.get("cash_only_execution_mode")', workflow)

    def test_build_switch_target_sets_cash_only_execution_from_control_field(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "ibkr-primary",
                "--strategy-profile",
                "tqqq_growth_income",
                "--extra-variables-json",
                '{"cash_only_execution_mode":"enabled"}',
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(assignments["IBKR_CASH_ONLY_EXECUTION"], "true")

    def test_extract_account_sync_controls_reads_ibkr_service_targets(self):
        target = {
            "target_id": "ibkr/demo-ibkr-dca",
            "runtime_target": {
                "platform_id": "ibkr",
                "strategy_profile": "nasdaq_sp500_smart_dca",
                "service_name": "interactive-brokers-demo-ibkr-dca-service",
                "account_scope": "demo-ibkr-dca",
            },
            "extra_variables": {
                "CLOUD_RUN_SERVICE_TARGETS_JSON": {
                    "targets": [
                        {
                            "service": "interactive-brokers-demo-ibkr-dca-service",
                            "ACCOUNT_GROUP": "demo-ibkr-dca",
                            "DCA_MODE": "smart",
                            "DCA_BASE_INVESTMENT_USD": "500",
                            "IBIT_ZSCORE_EXIT_MODE": "paper",
                        }
                    ]
                }
            },
        }

        controls = runtime_settings.extract_account_sync_controls(target)

        self.assertEqual(
            controls,
            {
                "dca_mode": "smart",
                "dca_base_investment_usd": "500",
                "ibit_zscore_exit_mode": "paper",
            },
        )

    def test_extract_account_sync_controls_prefers_top_level_extra_variables(self):
        target = {
            "target_id": "firstrade/default",
            "runtime_target": {
                "platform_id": "firstrade",
                "strategy_profile": "ibit_smart_dca",
                "service_name": "firstrade-quant-service",
                "account_scope": "US",
            },
            "extra_variables": {
                "DCA_MODE": "fixed",
                "DCA_BASE_INVESTMENT_USD": "50",
            },
        }

        self.assertEqual(
            runtime_settings.extract_account_sync_controls(target),
            {"dca_mode": "fixed", "dca_base_investment_usd": "50"},
        )

    def test_strategy_switch_console_deploy_workflow_syncs_bundled_profiles(self):
        workflow = (ROOT / ".github" / "workflows" / "deploy-strategy-switch-console.yml").read_text(encoding="utf-8")

        self.assertIn("environment: runtime-strategy-switch", workflow)
        self.assertIn("npx wrangler@4.106.0 deploy --config wrangler.toml", workflow)
        self.assertIn("/api/internal/sync-strategy-profiles", workflow)
        self.assertIn("expected_count=", workflow)
        self.assertIn("Waiting for deployed Worker propagation", workflow)
        self.assertIn("Strategy profile KV sync verified", workflow)
        self.assertNotIn("continue-on-error: true", workflow)
        self.assertIn("STRATEGY_SWITCH_CONSOLE_URL", workflow)
        self.assertIn("STRATEGY_SWITCH_SYNC_TOKEN", workflow)
        self.assertIn("CLOUDFLARE_WRANGLER_CONFIG_TOML", workflow)
        self.assertIn("STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID", workflow)
        self.assertIn("python/scripts/sync_strategy_switch_page_asset.py", workflow)

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

    def test_controlled_option_overlay_variables_are_allowed_and_validated(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        target["extra_variables"] = {
            "OPTION_OVERLAY_ENABLED": "true",
            "OPTION_GROWTH_OVERLAY_ENABLED": "true",
            "OPTION_GROWTH_OVERLAY_RECIPE": "tqqq_leaps_growth_v1",
            "OPTION_GROWTH_OVERLAY_START_USD": "250000",
            "OPTION_GROWTH_OVERLAY_NAV_BUDGET_RATIO": "0.03",
            "OPTION_INCOME_OVERLAY_ENABLED": "false",
            "OPTION_INCOME_OVERLAY_RECIPE": "",
            "OPTION_INCOME_OVERLAY_START_USD": "",
            "OPTION_INCOME_OVERLAY_NAV_RISK_RATIO": "",
        }

        self.assertEqual(runtime_settings.validate_target(target), [])

        target["extra_variables"] = {"OPTION_OVERLAY_ENABLED": "true"}

        self.assertIn(
            "extra_variables.OPTION_OVERLAY_ENABLED is true but no option overlay family is enabled",
            runtime_settings.validate_target(target),
        )

    def test_legacy_income_layer_variables_are_rejected(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        target["extra_variables"] = {"INCOME_THRESHOLD_USD": "250000"}

        self.assertIn(
            "extra_variables.INCOME_THRESHOLD_USD is research-only and must not be stored in live switch settings",
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
        self.assertEqual(
            target["runtime_target"]["scheduler"],
            {
                "timezone": "America/New_York",
                "main_time": "45 15 * * *",
                "probe_time": "35 9,15 * * *",
                "precheck_time": "45 9 * * *",
            },
        )
        self.assertEqual(assignments["STRATEGY_PROFILE"], "tqqq_growth_income")
        self.assertEqual(assignments["LONGBRIDGE_DRY_RUN_ONLY"], "false")
        plugin_payload = json.loads(assignments["LONGBRIDGE_STRATEGY_PLUGIN_MOUNTS_JSON"])
        self.assertEqual(plugin_payload["strategy_plugins"][0]["plugin"], "market_regime_control")
        self.assertEqual(
            plugin_payload["strategy_plugins"][0]["signal_path"],
            "gs://qsl-runtime-logs-shared/strategy-artifacts/us_equity/"
            "tqqq_growth_income/plugins/market_regime_control/latest_signal.json",
        )
        self.assertEqual(plugin_payload["strategy_plugins"][0]["expected_schema_version"], "market_regime_control.v1")

    def test_build_switch_target_uses_fork_repository_overrides(self):
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

        with patch.dict(os.environ, {"RUNTIME_SETTINGS_LONGBRIDGE_REPO": "ForkOrg/LongBridgePlatform"}):
            target = build_runtime_switch.build_switch_target(args)

        self.assertEqual(target["github"]["repository"], "ForkOrg/LongBridgePlatform")
        with patch.dict(os.environ, {"RUNTIME_SETTINGS_LONGBRIDGE_REPO": "ForkOrg/LongBridgePlatform"}):
            self.assertEqual(runtime_settings.validate_target(target), [])

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
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(target["github"]["repository"], "QuantStrategyLab/CharlesSchwabPlatform")
        self.assertEqual(target["github"]["variable_scope"], "repository")
        self.assertNotIn("environment", target["github"])
        self.assertEqual(target["runtime_target"]["service_name"], "charles-schwab-quant-service")
        self.assertEqual(assignments["SCHWAB_DRY_RUN_ONLY"], "false")
        plugin_payload = json.loads(assignments["SCHWAB_STRATEGY_PLUGIN_MOUNTS_JSON"])
        self.assertEqual(plugin_payload["strategy_plugins"][0]["plugin"], "market_regime_control")
        self.assertEqual(
            plugin_payload["strategy_plugins"][0]["signal_path"],
            "gs://qsl-runtime-logs-shared/strategy-artifacts/us_equity/"
            "soxl_soxx_trend_income/plugins/market_regime_control/latest_signal.json",
        )

    def test_build_switch_target_auto_mounts_market_regime_control_for_soxl(self):
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
        plugin_payload = json.loads(assignments["LONGBRIDGE_STRATEGY_PLUGIN_MOUNTS_JSON"])
        self.assertEqual(plugin_payload["strategy_plugins"][0]["plugin"], "market_regime_control")
        self.assertEqual(
            plugin_payload["strategy_plugins"][0]["signal_path"],
            "gs://qsl-runtime-logs-shared/strategy-artifacts/us_equity/"
            "soxl_soxx_trend_income/plugins/market_regime_control/latest_signal.json",
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

    def test_build_switch_target_defaults_qmt_repository_scope(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "qmt",
                "--target-name",
                "industry-etf-dry-run",
                "--strategy-profile",
                "cn_industry_etf_rotation",
                "--execution-mode",
                "dry_run",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(target["github"]["repository"], "QuantStrategyLab/QmtPlatform")
        self.assertEqual(target["github"]["variable_scope"], "repository")
        self.assertEqual(target["runtime_target"]["platform_id"], "qmt")
        self.assertEqual(target["runtime_target"]["deployment_selector"], "qmt")
        self.assertEqual(target["runtime_target"]["account_selector"], ["qmt"])
        self.assertEqual(target["runtime_target"]["account_scope"], "CN")
        self.assertEqual(target["runtime_target"]["service_name"], "qmt-quant-service")
        self.assertEqual(target["runtime_target"]["dry_run_only"], True)
        self.assertEqual(assignments["QMT_DRY_RUN_ONLY"], "true")
        self.assertEqual(assignments["STRATEGY_PROFILE"], "cn_industry_etf_rotation")
        self.assertEqual(
            target["runtime_target"]["scheduler"],
            {
                "timezone": "Asia/Shanghai",
                "main_time": "45 15 * * *",
                "probe_time": "35 9,15 * * *",
                "precheck_time": "45 9 * * *",
            },
        )

    def test_build_switch_target_defaults_binance_repository_scope(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "binance",
                "--target-name",
                "default",
                "--strategy-profile",
                "crypto_equity_combo",
                "--plugin-mode",
                "none",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(target["github"]["repository"], "QuantStrategyLab/BinancePlatform")
        self.assertEqual(target["github"]["variable_scope"], "repository")
        self.assertEqual(target["runtime_target"]["platform_id"], "binance")
        self.assertEqual(assignments["BINANCE_DRY_RUN"], "false")

    def test_build_switch_target_uses_dca_monthly_scheduler_window(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "firstrade",
                "--target-name",
                "dca",
                "--strategy-profile",
                "nasdaq_sp500_smart_dca",
                "--plugin-mode",
                "none",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)

        self.assertEqual(
            target["runtime_target"]["scheduler"],
            {
                "timezone": "America/New_York",
                "main_time": "45 15 25-28 * *",
                "probe_time": "35 9,15 25-28 * *",
                "precheck_time": "45 9 25-28 * *",
            },
        )

    def test_build_switch_target_uses_daily_scheduler_when_ibit_zscore_plugin_is_auto_mounted(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "firstrade",
                "--target-name",
                "ibit",
                "--strategy-profile",
                "ibit_smart_dca",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}
        plugin_payload = json.loads(assignments["FIRSTRADE_STRATEGY_PLUGIN_MOUNTS_JSON"])

        self.assertEqual(
            target["runtime_target"]["scheduler"],
            {
                "timezone": "America/New_York",
                "main_time": "45 15 * * *",
                "probe_time": "35 9,15 * * *",
                "precheck_time": "45 9 * * *",
            },
        )
        self.assertEqual(plugin_payload["strategy_plugins"][0]["plugin"], "ibit_zscore_exit")
        self.assertEqual(plugin_payload["strategy_plugins"][0]["expected_mode"], "shadow")
        self.assertEqual(plugin_payload["strategy_plugins"][0]["expected_schema_version"], "ibit_zscore_exit.v1")
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_ENABLED"], "true")
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_MODE"], "live")

    def test_build_switch_target_sets_ibit_zscore_exit_runtime_controls(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "firstrade",
                "--target-name",
                "ibit",
                "--strategy-profile",
                "ibit_smart_dca",
                "--extra-variables-json",
                '{"ibit_zscore_exit_mode":"live","ibit_zscore_exit_parking_symbol":"SGOV"}',
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_ENABLED"], "true")
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_MODE"], "live")
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_PARKING_SYMBOL"], "SGOV")
        self.assertNotIn("ibit_zscore_exit_mode", target["extra_variables"])
        self.assertNotIn("ibit_zscore_exit_parking_symbol", target["extra_variables"])

    def test_build_switch_target_disables_ibit_zscore_exit_when_plugins_are_disabled(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "firstrade",
                "--target-name",
                "ibit",
                "--strategy-profile",
                "ibit_smart_dca",
                "--plugin-mode",
                "none",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(target["runtime_target"]["scheduler"], build_runtime_switch.US_DCA_SCHEDULER)
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_ENABLED"], "false")
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_MODE"], "paper")

    def test_build_switch_target_rejects_ibit_zscore_controls_for_other_profiles(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "firstrade",
                "--target-name",
                "dca",
                "--strategy-profile",
                "nasdaq_sp500_smart_dca",
                "--extra-variables-json",
                '{"ibit_zscore_exit_mode":"live"}',
            ]
        )

        with self.assertRaisesRegex(ValueError, "IBIT Z-Score exit settings"):
            build_runtime_switch.build_switch_target(args)

    def test_build_switch_target_sets_dca_settings_for_dca_profile(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "firstrade",
                "--target-name",
                "dca",
                "--strategy-profile",
                "nasdaq_sp500_smart_dca",
                "--plugin-mode",
                "none",
                "--dca-mode",
                "smart",
                "--dca-base-investment-usd",
                "500",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(assignments["DCA_MODE"], "smart")
        self.assertEqual(assignments["DCA_BASE_INVESTMENT_USD"], "500")

    def test_build_switch_target_accepts_dca_control_fields_from_extra_variables_json(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "firstrade",
                "--target-name",
                "dca",
                "--strategy-profile",
                "nasdaq_sp500_smart_dca",
                "--plugin-mode",
                "none",
                "--extra-variables-json",
                '{"dca_mode":"smart","dca_base_investment_usd":"500"}',
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(assignments["DCA_MODE"], "smart")
        self.assertEqual(assignments["DCA_BASE_INVESTMENT_USD"], "500")
        self.assertNotIn("dca_mode", target["extra_variables"])
        self.assertNotIn("dca_base_investment_usd", target["extra_variables"])

    def test_build_switch_target_rejects_dca_settings_for_non_dca_profile(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "live",
                "--strategy-profile",
                "tqqq_growth_income",
                "--dca-mode",
                "smart",
            ]
        )

        with self.assertRaisesRegex(ValueError, "DCA settings are only supported"):
            build_runtime_switch.build_switch_target(args)

    def test_build_switch_target_rejects_dca_profile_on_non_firstrade_platform(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "dca",
                "--strategy-profile",
                "nasdaq_sp500_smart_dca",
                "--plugin-mode",
                "none",
            ]
        )

        with self.assertRaisesRegex(ValueError, "DCA strategy profiles are only supported on firstrade"):
            build_runtime_switch.build_switch_target(args)

    def test_build_switch_target_rejects_direct_dca_extra_variables(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "firstrade",
                "--target-name",
                "dca",
                "--strategy-profile",
                "nasdaq_sp500_smart_dca",
                "--extra-variables-json",
                '{"DCA_MODE":"smart"}',
            ]
        )

        with self.assertRaisesRegex(ValueError, "control fields"):
            build_runtime_switch.build_switch_target(args)

    def test_build_switch_target_rejects_research_only_option_overlay_extra_variables(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "live",
                "--strategy-profile",
                "tqqq_growth_income",
                "--extra-variables-json",
                '{"option_growth_overlay_enabled":"true"}',
            ]
        )

        with self.assertRaisesRegex(ValueError, "research-only"):
            build_runtime_switch.build_switch_target(args)

    def test_build_switch_target_sets_option_overlay_profile_defaults(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "schwab",
                "--target-name",
                "live",
                "--strategy-profile",
                "tqqq_growth_income",
                "--option-overlay-mode",
                "enabled",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(assignments["OPTION_OVERLAY_ENABLED"], "true")
        self.assertEqual(assignments["OPTION_GROWTH_OVERLAY_ENABLED"], "true")
        self.assertEqual(assignments["OPTION_GROWTH_OVERLAY_RECIPE"], "tqqq_leaps_growth_v1")
        self.assertEqual(assignments["OPTION_GROWTH_OVERLAY_START_USD"], "250000")
        self.assertEqual(assignments["OPTION_GROWTH_OVERLAY_NAV_BUDGET_RATIO"], "0.03")
        self.assertEqual(assignments["OPTION_INCOME_OVERLAY_ENABLED"], "false")
        self.assertEqual(assignments["OPTION_INCOME_OVERLAY_RECIPE"], "")

    def test_build_switch_target_can_disable_option_overlay(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "schwab",
                "--target-name",
                "live",
                "--strategy-profile",
                "tqqq_growth_income",
                "--option-overlay-mode",
                "disabled",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(assignments["OPTION_OVERLAY_ENABLED"], "false")
        self.assertEqual(assignments["OPTION_GROWTH_OVERLAY_ENABLED"], "false")
        self.assertEqual(assignments["OPTION_GROWTH_OVERLAY_RECIPE"], "")
        self.assertEqual(assignments["OPTION_INCOME_OVERLAY_ENABLED"], "false")

    def test_build_switch_target_sets_platform_cash_only_execution(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "ibkr-primary",
                "--strategy-profile",
                "tqqq_growth_income",
                "--cash-only-execution-mode",
                "disabled",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(assignments["IBKR_CASH_ONLY_EXECUTION"], "false")

    def test_build_switch_target_rejects_enabled_option_overlay_without_profile_defaults(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "firstrade",
                "--target-name",
                "default",
                "--strategy-profile",
                "nasdaq_sp500_smart_dca",
                "--option-overlay-mode",
                "enabled",
            ]
        )

        with self.assertRaisesRegex(ValueError, "option overlay defaults"):
            build_runtime_switch.build_switch_target(args)

    def test_build_switch_target_rejects_legacy_income_extra_variables(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "live",
                "--strategy-profile",
                "tqqq_growth_income",
                "--extra-variables-json",
                '{"INCOME_THRESHOLD_USD":"250000"}',
            ]
        )

        with self.assertRaisesRegex(ValueError, "legacy income"):
            build_runtime_switch.build_switch_target(args)

    def test_build_switch_target_preserves_dca_fields_in_service_targets_when_omitted(self):
        existing = {
            "targets": [
                {
                    "service": "firstrade-quant-service",
                    "ACCOUNT_GROUP": "firstrade",
                    "DCA_MODE": "smart",
                    "DCA_BASE_INVESTMENT_USD": "500",
                    "runtime_target": {
                        "platform_id": "firstrade",
                        "strategy_profile": "nasdaq_sp500_smart_dca",
                        "dry_run_only": False,
                        "deployment_selector": "firstrade",
                        "account_selector": ["firstrade"],
                        "account_scope": "US",
                        "service_name": "firstrade-quant-service",
                        "execution_mode": "live",
                    },
                },
            ],
        }
        path = ROOT / ".pytest_runtime_service_targets_dca.json"
        path.write_text(runtime_settings.compact_json(existing), encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "firstrade",
                "--target-name",
                "default",
                "--strategy-profile",
                "nasdaq_sp500_smart_dca",
                "--account-selector",
                "firstrade",
                "--service-name",
                "firstrade-quant-service",
                "--plugin-mode",
                "none",
                "--existing-service-targets-json-file",
                str(path),
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}
        selected = json.loads(assignments["CLOUD_RUN_SERVICE_TARGETS_JSON"])["targets"][0]

        self.assertEqual(selected["runtime_target"]["strategy_profile"], "nasdaq_sp500_smart_dca")
        self.assertEqual(selected["DCA_MODE"], "smart")
        self.assertEqual(selected["DCA_BASE_INVESTMENT_USD"], "500")

    def test_build_switch_target_preserves_market_signal_fields_in_service_targets_when_omitted(self):
        existing = {
            "targets": [
                {
                    "service": "interactive-brokers-demo-ibkr-dca-service",
                    "ACCOUNT_GROUP": "demo-ibkr-dca",
                    "IBKR_MARKET_SIGNAL_HANDOFF_INDEX_URI": "gs://signals/index.json",
                    "IBKR_MARKET_SIGNAL_REQUIRED": "true",
                    "IBKR_MARKET_SIGNAL_FALLBACK_MODE": "last_valid",
                    "runtime_target": {
                        "platform_id": "ibkr",
                        "strategy_profile": "nasdaq_sp500_smart_dca",
                        "dry_run_only": False,
                        "deployment_selector": "demo-ibkr-dca",
                        "account_selector": ["DEMO_IBKR_DCA"],
                        "account_scope": "demo-ibkr-dca",
                        "service_name": "interactive-brokers-demo-ibkr-dca-service",
                        "execution_mode": "live",
                    },
                },
            ],
        }
        path = ROOT / ".pytest_runtime_service_targets_market_signal.json"
        path.write_text(runtime_settings.compact_json(existing), encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "demo-ibkr-dca",
                "--strategy-profile",
                "tqqq_growth_income",
                "--account-selector",
                "DEMO_IBKR_DCA",
                "--service-name",
                "interactive-brokers-demo-ibkr-dca-service",
                "--plugin-mode",
                "none",
                "--existing-service-targets-json-file",
                str(path),
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}
        selected = json.loads(assignments["CLOUD_RUN_SERVICE_TARGETS_JSON"])["targets"][0]

        self.assertEqual(selected["runtime_target"]["strategy_profile"], "tqqq_growth_income")
        self.assertEqual(selected["IBKR_MARKET_SIGNAL_HANDOFF_INDEX_URI"], "gs://signals/index.json")
        self.assertEqual(selected["IBKR_MARKET_SIGNAL_REQUIRED"], "true")
        self.assertEqual(selected["IBKR_MARKET_SIGNAL_FALLBACK_MODE"], "last_valid")

    def test_build_switch_target_uses_snapshot_scheduler_window(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "longbridge",
                "--target-name",
                "hk",
                "--strategy-profile",
                "hk_low_vol_dividend_quality_snapshot",
                "--plugin-mode",
                "none",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)

        self.assertEqual(
            target["runtime_target"]["scheduler"],
            {
                "timezone": "Asia/Hong_Kong",
                "main_time": "45 15 1-7 * *",
                "probe_time": "35 9,15 1-7 * *",
                "precheck_time": "45 9 1-7 * *",
            },
        )

    def test_runtime_target_scheduler_rejects_invalid_cron_shape(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        target["runtime_target"]["scheduler"] = {
            "timezone": "America/New_York",
            "main_time": "45",
            "probe_time": "35 9,15 * * *",
            "precheck_time": "45 9 * * *",
        }

        self.assertIn(
            "runtime_target.scheduler.main_time must have 2 time fields or 5 cron fields",
            runtime_settings.validate_target(target),
        )

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
                    "service": "interactive-brokers-demo-ibkr-tqqq-service",
                    "ACCOUNT_GROUP": "demo-ibkr-tqqq",
                    "IBKR_MIN_RESERVED_CASH_USD": "150",
                    "IBKR_RESERVED_CASH_RATIO": "0.03",
                    "INCOME_LAYER_ENABLED": "true",
                    "INCOME_LAYER_START_USD": "250000",
                    "INCOME_LAYER_MAX_RATIO": "0.55",
                    "OPTION_OVERLAY_ENABLED": "true",
                    "OPTION_GROWTH_OVERLAY_ENABLED": "true",
                    "OPTION_GROWTH_OVERLAY_RECIPE": "tqqq_leaps_growth_v1",
                    "OPTION_GROWTH_OVERLAY_START_USD": "250000",
                    "OPTION_GROWTH_OVERLAY_NAV_BUDGET_RATIO": "0.03",
                    "OPTION_INCOME_OVERLAY_ENABLED": "false",
                    "RUNTIME_TARGET_ENABLED": "false",
                    "runtime_target": {
                        "platform_id": "ibkr",
                        "strategy_profile": "old_strategy",
                        "dry_run_only": False,
                        "deployment_selector": "demo-ibkr-tqqq",
                        "account_selector": ["DEMO_IBKR_PRIMARY"],
                        "account_scope": "demo-ibkr-tqqq",
                        "service_name": "interactive-brokers-demo-ibkr-tqqq-service",
                        "execution_mode": "live",
                    },
                },
                {
                    "service": "interactive-brokers-demo-ibkr-soxl-service",
                    "ACCOUNT_GROUP": "demo-ibkr-soxl",
                    "runtime_target": {
                        "platform_id": "ibkr",
                        "strategy_profile": "soxl_soxx_trend_income",
                        "dry_run_only": False,
                        "deployment_selector": "demo-ibkr-soxl",
                        "account_selector": ["DEMO_IBKR_SOXL"],
                        "account_scope": "demo-ibkr-soxl",
                        "service_name": "interactive-brokers-demo-ibkr-soxl-service",
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
                "demo-ibkr-tqqq",
                "--strategy-profile",
                "tqqq_growth_income",
                "--account-selector",
                "DEMO_IBKR_PRIMARY",
                "--service-name",
                "interactive-brokers-demo-ibkr-tqqq-service",
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
        self.assertEqual(selected["IBKR_MIN_RESERVED_CASH_USD"], "150")
        self.assertEqual(selected["IBKR_RESERVED_CASH_RATIO"], "0.03")
        self.assertEqual(selected["INCOME_LAYER_ENABLED"], "true")
        self.assertEqual(selected["INCOME_LAYER_START_USD"], "250000")
        self.assertEqual(selected["INCOME_LAYER_MAX_RATIO"], "0.55")
        self.assertEqual(selected["OPTION_OVERLAY_ENABLED"], "true")
        self.assertEqual(selected["OPTION_GROWTH_OVERLAY_RECIPE"], "tqqq_leaps_growth_v1")
        self.assertEqual(selected["OPTION_INCOME_OVERLAY_ENABLED"], "false")
        self.assertEqual(selected["RUNTIME_TARGET_ENABLED"], "false")
        self.assertEqual(
            selected["IBKR_STRATEGY_PLUGIN_MOUNTS_JSON"]["strategy_plugins"][0]["plugin"],
            "market_regime_control",
        )
        self.assertEqual(
            selected["IBKR_STRATEGY_PLUGIN_MOUNTS_JSON"]["strategy_plugins"][0]["signal_path"],
            "gs://qsl-runtime-logs-shared/strategy-artifacts/us_equity/"
            "tqqq_growth_income/plugins/market_regime_control/latest_signal.json",
        )
        self.assertEqual(untouched["runtime_target"]["strategy_profile"], "soxl_soxx_trend_income")

    def test_build_switch_target_can_clear_preserved_ibkr_reserved_cash_fields(self):
        existing = {
            "targets": [
                {
                    "service": "interactive-brokers-demo-ibkr-tqqq-service",
                    "ACCOUNT_GROUP": "demo-ibkr-tqqq",
                    "IBKR_MIN_RESERVED_CASH_USD": "150",
                    "IBKR_RESERVED_CASH_RATIO": "0.03",
                    "runtime_target": {
                        "platform_id": "ibkr",
                        "strategy_profile": "old_strategy",
                        "dry_run_only": False,
                        "deployment_selector": "demo-ibkr-tqqq",
                        "account_selector": ["DEMO_IBKR_PRIMARY"],
                        "account_scope": "demo-ibkr-tqqq",
                        "service_name": "interactive-brokers-demo-ibkr-tqqq-service",
                        "execution_mode": "live",
                    },
                },
            ],
        }
        path = ROOT / ".pytest_runtime_service_targets_reserved_cash.json"
        path.write_text(runtime_settings.compact_json(existing), encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "demo-ibkr-tqqq",
                "--strategy-profile",
                "tqqq_growth_income",
                "--account-selector",
                "DEMO_IBKR_PRIMARY",
                "--service-name",
                "interactive-brokers-demo-ibkr-tqqq-service",
                "--existing-service-targets-json-file",
                str(path),
                "--extra-variables-json",
                '{"IBKR_MIN_RESERVED_CASH_USD":"","IBKR_RESERVED_CASH_RATIO":""}',
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}
        patched = json.loads(assignments["CLOUD_RUN_SERVICE_TARGETS_JSON"])
        selected = patched["targets"][0]

        self.assertEqual(selected["IBKR_MIN_RESERVED_CASH_USD"], "")
        self.assertEqual(selected["IBKR_RESERVED_CASH_RATIO"], "")

    def test_build_switch_target_patches_ibkr_service_targets_with_soxl_plugin_mounts(self):
        existing = {
            "targets": [
                {
                    "service": "interactive-brokers-demo-ibkr-tqqq-service",
                    "ACCOUNT_GROUP": "demo-ibkr-tqqq",
                    "runtime_target": {
                        "platform_id": "ibkr",
                        "strategy_profile": "tqqq_growth_income",
                        "dry_run_only": False,
                        "deployment_selector": "demo-ibkr-tqqq",
                        "account_selector": ["DEMO_IBKR_PRIMARY"],
                        "account_scope": "demo-ibkr-tqqq",
                        "service_name": "interactive-brokers-demo-ibkr-tqqq-service",
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
                "demo-ibkr-tqqq",
                "--strategy-profile",
                "soxl_soxx_trend_income",
                "--account-selector",
                "DEMO_IBKR_PRIMARY",
                "--service-name",
                "interactive-brokers-demo-ibkr-tqqq-service",
                "--existing-service-targets-json-file",
                str(path),
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}
        patched = json.loads(assignments["CLOUD_RUN_SERVICE_TARGETS_JSON"])
        selected = patched["targets"][0]

        self.assertEqual(selected["runtime_target"]["strategy_profile"], "soxl_soxx_trend_income")
        self.assertEqual(
            selected["IBKR_STRATEGY_PLUGIN_MOUNTS_JSON"]["strategy_plugins"][0]["plugin"],
            "market_regime_control",
        )
        self.assertEqual(
            selected["IBKR_STRATEGY_PLUGIN_MOUNTS_JSON"]["strategy_plugins"][0]["signal_path"],
            "gs://qsl-runtime-logs-shared/strategy-artifacts/us_equity/"
            "soxl_soxx_trend_income/plugins/market_regime_control/latest_signal.json",
        )


if __name__ == "__main__":
    unittest.main()
