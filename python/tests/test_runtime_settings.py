from __future__ import annotations

import importlib.util
import copy
import json
import os
import re
import subprocess
import sys
import tempfile
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

PLATFORM_CONFIG_MODULE_PATH = ROOT / "python" / "scripts" / "build_platform_config.py"
PLATFORM_CONFIG_SPEC = importlib.util.spec_from_file_location("build_platform_config", PLATFORM_CONFIG_MODULE_PATH)
build_platform_config = importlib.util.module_from_spec(PLATFORM_CONFIG_SPEC)
assert PLATFORM_CONFIG_SPEC.loader is not None
sys.modules[PLATFORM_CONFIG_SPEC.name] = build_platform_config
PLATFORM_CONFIG_SPEC.loader.exec_module(build_platform_config)

BUILD_CONFIG_MODULE_PATH = ROOT / "python" / "scripts" / "build_config.py"
BUILD_CONFIG_SPEC = importlib.util.spec_from_file_location("build_config", BUILD_CONFIG_MODULE_PATH)
build_config = importlib.util.module_from_spec(BUILD_CONFIG_SPEC)
assert BUILD_CONFIG_SPEC.loader is not None
sys.modules[BUILD_CONFIG_SPEC.name] = build_config
BUILD_CONFIG_SPEC.loader.exec_module(build_config)


class RuntimeSettingsTest(unittest.TestCase):
    NOT_EVIDENCED_PROFILES = (
        "tqqq_growth_income",
        "soxl_soxx_trend_income",
        "nasdaq_sp500_smart_dca",
        "ibit_smart_dca",
        "russell_top50_leader_rotation",
        "hk_low_vol_dividend_quality_snapshot",
        "cn_industry_etf_rotation",
        "crypto_live_pool_rotation",
    )

    def setUp(self):
        def synthetic_live_switch_config():
            config = build_config.load_config()
            for profile in self.NOT_EVIDENCED_PROFILES:
                config["strategies"][profile].update(
                    {
                        "runtime_enabled": True,
                        "can_switch_live": True,
                        "lifecycle_stage": "runtime_enabled",
                        "allowed_execution_modes": ["live", "paper", "dry_run"],
                        "blocked_live_reason": "",
                    }
                )
            return config

        self.enterContext(
            patch.object(build_runtime_switch, "_load_platform_config", side_effect=synthetic_live_switch_config)
        )
        self.enterContext(
            patch.object(runtime_settings, "load_platform_config", side_effect=synthetic_live_switch_config)
        )

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

    def test_platform_health_monitor_workflow_creates_codex_ready_issue(self):
        workflow = (ROOT / ".github/workflows/platform-health-monitor.yml").read_text(encoding="utf-8")

        self.assertIn("schedule:", workflow)
        self.assertIn("python3 python/scripts/build_config.py --platform-health-report", workflow)
        self.assertIn("python3 python/scripts/runtime_settings.py validate", workflow)
        self.assertIn("platform-health-report", workflow)
        self.assertIn("codex-repair-ready", workflow)
        self.assertIn("Do not enable live switching", workflow)

    def test_runtime_artifact_evidence_gate_is_read_only_and_uses_registry(self):
        workflow = (ROOT / ".github/workflows/runtime-artifact-evidence-gate.yml").read_text(
            encoding="utf-8"
        )

        self.assertIn("id-token: write", workflow)
        self.assertIn("--runtime-artifact-evidence-registry", workflow)
        self.assertIn("verify_runtime_artifact_evidence.py", workflow)
        self.assertIn("qsl-artifact-evidence@", workflow)
        self.assertIn("no publishing, runtime change, or order submission", workflow)
        self.assertIn("Keep affected routes parked", workflow)
        self.assertNotIn("gcloud storage cp", workflow)
        self.assertNotIn("Manual Strategy Switch", workflow)

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

    def test_platform_deployment_topology_matches_runtime_hosts(self):
        config = build_config.load_config()
        cloud_run_platforms = {"longbridge", "ibkr", "schwab", "firstrade"}

        for platform in cloud_run_platforms:
            deployment = config["platforms"][platform]["deployment"]
            self.assertEqual(deployment["runtime_model"], "cloud_run")
            self.assertEqual(deployment["settings_activation"], "cloud_run_sync_workflow")
            self.assertTrue(deployment["live_configured"])

        binance = config["platforms"]["binance"]["deployment"]
        self.assertEqual(binance["runtime_model"], "oracle_vps_self_hosted")
        self.assertEqual(binance["settings_activation"], "next_runtime_workflow_dispatch")
        self.assertTrue(binance["live_configured"])

        qmt = config["platforms"]["qmt"]["deployment"]
        self.assertEqual(qmt["runtime_model"], "not_configured")
        self.assertEqual(qmt["settings_activation"], "not_wired")
        self.assertFalse(qmt["live_configured"])

    def test_runtime_authority_status_does_not_grant_p0_p6_runtime_authority(self):
        config = build_config.load_config()
        authority = config["meta"]["runtime_authority"]

        self.assertEqual(authority["schema_version"], "qsl.runtime_authority_status.v1")
        self.assertEqual(authority["scope"], "p0_p6_control_plane")
        self.assertEqual(authority["status"], "P0_CONTROL_PLANE_NOT_RUNTIME_WIRED")
        self.assertFalse(authority["active_preauthorized_autonomy_policy"])
        self.assertFalse(authority["execution_metadata_is_runtime_authority"])
        self.assertEqual(authority["p1_p3_non_live_data_acquisition_authority"], "INDEPENDENT_CONTRACT_REQUIRED")
        self.assertEqual(authority["p4_p6_definition"], "UNDEFINED")

        invalid = copy.deepcopy(config)
        invalid["meta"]["runtime_authority"]["execution_metadata_is_runtime_authority"] = True
        self.assertIn(
            "meta.runtime_authority.execution_metadata_is_runtime_authority must be False",
            build_config.validate(invalid),
        )

    def test_notification_route_is_runtime_reference_only(self):
        config = build_config.load_config()
        sentinel = config["notifications"]["quant_sentinel"]

        self.assertNotIn("telegram_chat_id", sentinel)
        self.assertEqual(
            sentinel["telegram_chat_id_ref"],
            {
                "source": "runtime_environment",
                "preferred_env": "QSL_GLOBAL_TELEGRAM_CHAT_ID",
                "fallback_envs": [
                    "GLOBAL_TELEGRAM_CHAT_ID",
                    "STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS",
                ],
            },
        )
        self.assertEqual(
            sentinel["env_aliases"]["chat_id"],
            [
                "QSL_GLOBAL_TELEGRAM_CHAT_ID",
                "GLOBAL_TELEGRAM_CHAT_ID",
                "STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS",
            ],
        )
        self.assertEqual(build_config.validate(config), [])

    def test_notification_route_rejects_public_literal(self):
        config = build_config.load_config()
        config["notifications"]["quant_sentinel"]["telegram_chat_id"] = "test-chat-id"

        self.assertIn(
            "notifications.quant_sentinel must not contain telegram_chat_id; "
            "use telegram_chat_id_ref",
            build_config.validate(config),
        )

    def test_notification_route_guard_applies_to_future_plugin(self):
        config = build_config.load_config()
        plugin_alert = copy.deepcopy(config["notifications"]["quant_sentinel"])
        config["notifications"]["future_strategy_plugin"] = plugin_alert

        self.assertEqual(build_config.validate(config), [])

        plugin_alert["telegram_chat_id"] = "test-chat-id"
        self.assertIn(
            "notifications.future_strategy_plugin must not contain telegram_chat_id; "
            "use telegram_chat_id_ref",
            build_config.validate(config),
        )

    def test_manual_switch_rejects_unsupported_sync_before_variable_write(self):
        workflow = (ROOT / ".github" / "workflows" / "manual-strategy-switch.yml").read_text(encoding="utf-8")

        self.assertIn('runtime_settings.py settings-activation "${PLATFORM}"', workflow)
        self.assertIn("Oracle/VPS runtime activates settings on its next externally scheduled", workflow)
        self.assertIn("QMT has no live runtime configuration", workflow)
        self.assertLess(
            workflow.index('runtime_settings.py settings-activation "${PLATFORM}"'),
            workflow.index("Apply GitHub variable updates"),
        )

    def test_manual_switch_rejects_inventory_bypass_before_variable_write(self):
        workflow = (ROOT / ".github" / "workflows" / "manual-strategy-switch.yml").read_text(encoding="utf-8")

        self.assertIn("env.APPLY_SWITCH == 'true' ||", workflow)
        self.assertIn(
            "existing CLOUD_RUN_SERVICE_TARGETS_JSON requires "
            "service_targets_mode=patch or allow_create",
            workflow,
        )
        self.assertLess(
            workflow.index(
                "existing CLOUD_RUN_SERVICE_TARGETS_JSON requires "
                "service_targets_mode=patch or allow_create"
            ),
            workflow.index("Apply GitHub variable updates"),
        )

    def test_manual_switch_preflights_ibkr_plan_before_variable_write(self):
        workflow = (ROOT / ".github" / "workflows" / "manual-strategy-switch.yml").read_text(encoding="utf-8")

        self.assertIn("Preflight IBKR deployment plan", workflow)
        self.assertIn("python/scripts/preflight_ibkr_switch.py", workflow)
        self.assertIn("uv sync --frozen --no-dev", workflow)
        self.assertLess(
            workflow.index("Preflight IBKR deployment plan"),
            workflow.index("Apply GitHub variable updates"),
        )

    def test_preflight_ibkr_switch_uses_candidate_inventory_without_printing_plan(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as temp_dir:
            temp = Path(temp_dir)
            existing_path = temp / "existing.json"
            existing_path.write_text(
                runtime_settings.compact_json(
                    {
                        "targets": [
                            {
                                "service": "interactive-brokers-live-service",
                                "ACCOUNT_GROUP": "live",
                                "runtime_target": {
                                    "platform_id": "ibkr",
                                    "strategy_profile": "soxl_soxx_trend_income",
                                    "dry_run_only": True,
                                    "deployment_selector": "live",
                                    "account_selector": ["LIVE"],
                                    "account_scope": "live",
                                    "service_name": "interactive-brokers-live-service",
                                    "execution_mode": "dry_run",
                                },
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            args = build_runtime_switch.build_parser().parse_args(
                [
                    "--platform",
                    "ibkr",
                    "--target-name",
                    "live",
                    "--strategy-profile",
                    "tqqq_growth_income",
                    "--execution-mode",
                    "dry_run",
                    "--account-selector",
                    "LIVE",
                    "--service-name",
                    "interactive-brokers-live-service",
                    "--plugin-mode",
                    "none",
                    "--existing-service-targets-json-file",
                    str(existing_path),
                ]
            )
            target_path = temp / "target.json"
            target = build_runtime_switch.build_switch_target(args)
            target_path.write_text(
                runtime_settings.compact_json(target),
                encoding="utf-8",
            )
            variables_path = temp / "variables.json"
            variables_path.write_text(
                json.dumps(
                    [
                        {"name": "CLOUD_RUN_SERVICE_TARGETS_JSON", "value": '{"targets":[]}'},
                        {"name": "UNCHANGED_SETTING", "value": "preserved"},
                    ]
                ),
                encoding="utf-8",
            )
            platform_root = temp / "platform"
            planner_path = platform_root / "scripts" / "build_cloud_run_env_sync_plan.py"
            planner_path.parent.mkdir(parents=True)
            capture_path = temp / "capture.json"
            planner_path.write_text(
                """
import json
import os
from pathlib import Path

inventory = json.loads(os.environ["CLOUD_RUN_SERVICE_TARGETS_JSON"])
Path(os.environ["CAPTURE_PATH"]).write_text(
    json.dumps(
        {
            "profile": inventory["targets"][0]["runtime_target"]["strategy_profile"],
            "unchanged": os.environ.get("UNCHANGED_SETTING"),
        }
    ),
    encoding="utf-8",
)
print('{"candidate_inventory":"must-not-be-forwarded"}')
""".strip(),
                encoding="utf-8",
            )
            python_path = platform_root / ".venv" / "bin" / "python"
            python_path.parent.mkdir(parents=True)
            python_path.symlink_to(sys.executable)

            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "python" / "scripts" / "preflight_ibkr_switch.py"),
                    "--target-file",
                    str(target_path),
                    "--platform-root",
                    str(platform_root),
                    "--repository-variables-file",
                    str(variables_path),
                ],
                capture_output=True,
                text=True,
                env={**os.environ, "CAPTURE_PATH": str(capture_path)},
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, "IBKR deployment plan preflight passed.\n")
            self.assertNotIn("candidate_inventory", result.stdout + result.stderr)
            self.assertEqual(
                json.loads(capture_path.read_text(encoding="utf-8")),
                {"profile": "tqqq_growth_income", "unchanged": "preserved"},
            )

    def test_settings_activation_comes_from_platform_config(self):
        self.assertEqual(
            runtime_settings.platform_settings_activation("binance"),
            "next_runtime_workflow_dispatch",
        )
        self.assertEqual(runtime_settings.platform_settings_activation("qmt"), "not_wired")

    def test_manual_switch_reads_ibkr_targets_from_selected_environment_scope(self):
        workflow = (ROOT / ".github/workflows/manual-strategy-switch.yml").read_text(encoding="utf-8")

        assert (
            'if [ "${PLATFORM}" = "ibkr" ] && [ "${VARIABLE_SCOPE}" = "environment" ]; then'
            in workflow
        )
        assert 'target_environment="${GITHUB_ENVIRONMENT_NAME:-${TARGET_NAME}}"' in workflow
        assert 'command.extend(["--env", environment])' in workflow
        assert 'handle.write("{}")' in workflow
        assert 'contains(fromJSON(\'["longbridge","ibkr","schwab","firstrade"]\'), env.PLATFORM)' in workflow
        assert 'if [ -f "${output_file}" ]; then' in workflow

    def test_live_candidate_queue_lists_profiles_needing_promotion_review(self):
        catalog = [
            {
                "profile": "ready_next",
                "label_zh": "候选",
                "domain": "cn_equity",
                "lifecycle_stage": "live_candidate",
                "can_switch_live": False,
                "allowed_execution_modes": ["paper", "dry_run"],
                "blocked_live_reason": "live_candidate_requires_evidence_package",
            },
            {
                "profile": "shadow_next",
                "label": "Shadow",
                "domain": "crypto",
                "lifecycle_stage": "shadow_candidate",
                "can_switch_live": False,
                "blocked_live_reason": "shadow_candidate_requires_evidence_package",
            },
            {
                "profile": "live_now",
                "domain": "us_equity",
                "lifecycle_stage": "runtime_enabled",
                "can_switch_live": True,
            },
        ]

        queue = build_config.build_live_candidate_queue(catalog)

        self.assertEqual([item["profile"] for item in queue], ["ready_next", "shadow_next"])
        self.assertEqual(queue[0]["recommended_action"], "verify_preauthorized_policy_and_evidence")
        self.assertEqual(queue[0]["label"], "候选")
        self.assertTrue(queue[0]["operating_policy_required"])
        self.assertEqual(queue[0]["operating_policy_status"], "UNVERIFIED")
        self.assertEqual(queue[1]["recommended_action"], "collect_shadow_evidence")

    def test_live_candidate_queue_cli_outputs_json_only(self):
        with (
            patch.object(sys, "argv", ["build_config.py", "--live-candidate-queue"]),
            patch.object(build_config, "load_config", return_value={"platforms": {}, "strategies": {}}),
            patch.object(build_config, "validate", return_value=[]),
            patch.object(build_config, "build_live_candidate_queue", return_value=[{"profile": "candidate"}]),
            patch("builtins.print") as printed,
        ):
            self.assertEqual(build_config.main(), 0)

        printed.assert_called_once()
        self.assertEqual(json.loads(printed.call_args.args[0]), [{"profile": "candidate"}])

    def test_strategy_automation_registry_classifies_lanes(self):
        registry = build_config.build_strategy_automation_registry(
            {
                "strategies": {
                    "live": {
                        "label": "Live",
                        "domain": "us_equity",
                        "runtime_enabled": True,
                        "lifecycle_stage": "runtime_enabled",
                        "can_switch_live": True,
                        "features": {"option_overlay": True},
                    },
                    "candidate": {
                        "label": "Candidate",
                        "domain": "cn_equity",
                        "runtime_enabled": False,
                        "lifecycle_stage": "live_candidate",
                        "can_switch_live": False,
                        "features": {},
                    },
                    "shadow": {
                        "label": "Shadow",
                        "domain": "us_equity",
                        "runtime_enabled": False,
                        "lifecycle_stage": "shadow_candidate",
                        "can_switch_live": False,
                        "features": {},
                    },
                    "research": {
                        "label": "Research",
                        "domain": "crypto",
                        "runtime_enabled": False,
                        "lifecycle_stage": "research_backtest_only",
                        "can_switch_live": False,
                        "features": {},
                    },
                },
            }
        )

        profiles = {item["profile"]: item for item in registry["profiles"]}
        lanes = {profile: item["automation_lane"] for profile, item in profiles.items()}
        self.assertEqual(registry["schema_version"], "strategy_automation_registry.v2")
        self.assertEqual(lanes["live"], "live_equivalent_optimization")
        self.assertEqual(lanes["candidate"], "promotion_review")
        self.assertEqual(profiles["candidate"]["triggers"], ["evidence_package_ready"])
        self.assertTrue(profiles["candidate"]["operating_policy_required"])
        self.assertEqual(profiles["candidate"]["operating_policy_status"], "UNVERIFIED")
        self.assertEqual(
            profiles["candidate"]["evidence_required"],
            ["live_candidate_evidence", "preauthorized_operating_policy_receipt"],
        )
        self.assertFalse(profiles["candidate"]["can_switch_live"])
        self.assertEqual(lanes["shadow"], "shadow_research")
        self.assertEqual(
            profiles["shadow"]["evidence_required"],
            ["shadow_metrics", "preauthorized_operating_policy_receipt"],
        )
        self.assertTrue(profiles["shadow"]["operating_policy_required"])
        self.assertFalse(profiles["shadow"]["can_switch_live"])
        self.assertEqual(lanes["research"], "research_backlog")
        self.assertTrue(profiles["live"]["position_control_sensitive"])

    def test_automation_registry_cli_outputs_json(self):
        with (
            patch.object(sys, "argv", ["build_config.py", "--automation-registry"]),
            patch.object(build_config, "load_config", return_value={"strategies": {}}),
            patch("builtins.print") as printed,
        ):
            self.assertEqual(build_config.main(), 0)

        printed.assert_called_once()
        self.assertEqual(json.loads(printed.call_args.args[0])["schema_version"], "strategy_automation_registry.v2")

    def test_platform_health_report_summarizes_current_config(self):
        config = json.loads((ROOT / "platform-config.json").read_text(encoding="utf-8"))
        catalog = json.loads(
            (ROOT / "web" / "strategy-switch-console" / "strategy-profiles.example.json").read_text(encoding="utf-8")
        )

        report = build_config.build_platform_health_report(config, catalog)

        self.assertEqual(report["status"], "attention_required")
        self.assertEqual(report["schema_version"], "platform_health_report.v1")
        self.assertEqual(report["summary"]["runtime_enabled_switchable_count"], 0)
        self.assertIn("codex_repair_context", report)
        self.assertIn("automation_registry", report)
        self.assertIn("automation_lane_counts", report["summary"])
        self.assertEqual(report["summary"]["dry_run_uncovered_strategy_count"], 0)
        self.assertEqual(report["summary"]["dry_run_covered_strategy_count"], 26)
        self.assertGreater(report["summary"]["dry_run_route_count"], 0)
        self.assertEqual(
            report["summary"]["declared_dry_run_route_count"],
            report["summary"]["buildable_dry_run_route_count"],
        )
        self.assertEqual(report["summary"]["artifact_blocked_strategy_count"], 0)
        coverage_check = next(
            item for item in report["checks"] if item["name"] == "strategy_platform_dry_run_coverage"
        )
        self.assertEqual(coverage_check["status"], "pass")
        self.assertEqual(report["recommended_action"], "review_candidates")
        self.assertFalse(report["codex_repair_context"]["safe_to_attempt"])
        self.assertIn("python3 python/scripts/build_config.py --check", report["codex_repair_context"]["suggested_commands"])

    def test_strategy_platform_dry_run_coverage_fails_closed_when_domain_route_is_removed(self):
        config = build_config.load_config()
        config["platforms"]["qmt"]["supported_domains"] = []

        coverage = build_config.build_strategy_platform_dry_run_coverage(config)
        report = build_config.build_platform_health_report(config, [])

        self.assertIn("cn_industry_etf_rotation", coverage["uncovered_profiles"])
        coverage_check = next(
            item for item in report["checks"] if item["name"] == "strategy_platform_dry_run_coverage"
        )
        self.assertEqual(coverage_check["status"], "fail")

    def test_strategy_platform_dry_run_coverage_uses_verified_snapshot_artifact(self):
        coverage = build_config.build_strategy_platform_dry_run_coverage(build_config.load_config())
        route = next(
            item
            for item in coverage["profiles"]
            if item["profile"] == "hk_low_vol_dividend_quality_snapshot"
        )

        self.assertEqual(route["declared_dry_run_platforms"], ["ibkr", "longbridge"])
        self.assertEqual(route["buildable_dry_run_platforms"], ["ibkr", "longbridge"])
        self.assertEqual(route["blocked_reason"], "")
        self.assertNotIn("hk_low_vol_dividend_quality_snapshot", coverage["artifact_blocked_profiles"])
        self.assertEqual(coverage["summary"]["declared_dry_run_route_count"], 59)
        self.assertEqual(coverage["summary"]["buildable_dry_run_route_count"], 59)

    def test_feature_snapshot_platform_coverage_matches_runtime_injection(self):
        self.assertEqual(
            build_config.FEATURE_SNAPSHOT_RUNTIME_PLATFORMS,
            set(build_runtime_switch.PLATFORM_FEATURE_SNAPSHOT_VARIABLES),
        )

    def test_platform_health_report_cli_outputs_json(self):
        report = {
            "schema_version": "platform_health_report.v1",
            "status": "attention_required",
            "recommended_action": "review_candidates",
        }
        with (
            patch.object(sys, "argv", ["build_config.py", "--platform-health-report"]),
            patch.object(build_config, "load_config", return_value={"platforms": {}, "strategies": {}}),
            patch.object(build_config, "build_platform_health_report", return_value=report),
            patch("builtins.print") as printed,
        ):
            self.assertEqual(build_config.main(), 0)

        printed.assert_called_once()
        self.assertEqual(json.loads(printed.call_args.args[0])["schema_version"], "platform_health_report.v1")

    def test_runtime_target_rejects_live_switch_for_non_runtime_profile(self):
        _, target = self.load_target("examples/targets/qmt/cn_combo.example.json")
        target["runtime_target"]["execution_mode"] = "live"
        target["runtime_target"]["dry_run_only"] = False

        errors = runtime_settings.validate_target(target)

        self.assertIn(
            "runtime_target.strategy_profile cn_equity_combo is not runtime_enabled",
            errors,
        )
        self.assertIn(
            "runtime_target.strategy_profile cn_equity_combo cannot switch live",
            errors,
        )

    def test_runtime_target_never_infers_live_permission_from_catalog_status(self):
        config = build_config.load_config()
        config["strategies"]["global_etf_rotation"] = {
            **config["strategies"]["global_etf_rotation"],
            "runtime_enabled": True,
            "lifecycle_stage": "runtime_enabled",
        }
        config["strategies"]["global_etf_rotation"].pop("can_switch_live", None)
        config["strategies"]["global_etf_rotation"].pop(
            "allowed_execution_modes", None
        )
        errors = []

        with patch.object(
            runtime_settings, "load_platform_config", return_value=config
        ):
            runtime_settings.validate_runtime_target_strategy_policy(
                {
                    "platform_id": "ibkr",
                    "strategy_profile": "global_etf_rotation",
                    "execution_mode": "live",
                },
                errors,
            )

        self.assertIn(
            "runtime_target.strategy_profile global_etf_rotation cannot switch live",
            errors,
        )
        self.assertIn(
            "runtime_target.strategy_profile global_etf_rotation must explicitly allow live execution",
            errors,
        )

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

    def test_runtime_target_accepts_complete_optional_strategy_release_identity(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        digest = "a" * 64
        target["runtime_target"]["strategy_release"] = {
            "release_id": "soxl-p2-v3.20260824",
            "manifest_sha256": digest,
            "strategy_revision": "2e3bb51",
            "config_sha256": digest,
            "risk_policy_sha256": digest,
            "evidence_sha256": digest,
            "plugin_bundle_sha256": digest,
            "effective_session": "2026-08-25",
        }

        self.assertEqual(runtime_settings.validate_target(target), [])

    def test_runtime_target_rejects_partial_or_invalid_strategy_release_identity(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        target["runtime_target"]["strategy_release"] = {
            "release_id": "not valid",
            "manifest_sha256": "not-a-digest",
        }

        errors = runtime_settings.validate_target(target)

        self.assertIn("runtime_target.strategy_release.release_id has invalid characters", errors)
        self.assertIn(
            "runtime_target.strategy_release.manifest_sha256 must be a SHA-256 digest",
            errors,
        )
        self.assertIn("runtime_target.strategy_release.strategy_revision is required", errors)

    def test_live_continuity_keeps_an_existing_baseline_separate_from_candidate_gate(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        runtime_target = target["runtime_target"]
        runtime_target.update(
            {
                "strategy_profile": "soxl_soxx_trend_income",
                "deployment_selector": "default",
                "account_selector": ["default"],
                "account_scope": "default",
                "service_name": "charles-schwab-quant-service",
            }
        )
        runtime_target["live_continuity"] = {
            "state": "ACTIVE_LKG",
            "baseline_kind": "legacy_authorized",
            "baseline_id": "soxl-schwab-lkg-20260830",
            "baseline_target_sha256": runtime_settings.runtime_target_fingerprint(runtime_target),
            "captured_at": "2026-08-30",
        }

        self.assertEqual(runtime_settings.validate_target(target), [])

    def test_confirmed_legacy_ibkr_profiles_are_continuity_eligible(self):
        """Candidate policy must not strand an explicitly frozen IBKR incumbent."""

        parser = build_runtime_switch.build_parser()
        for profile in (
            "tqqq_growth_income",
            "global_etf_rotation",
            "russell_top50_leader_rotation",
        ):
            with self.subTest(profile=profile):
                target = build_runtime_switch.build_switch_target(
                    parser.parse_args(
                        [
                            "--platform",
                            "ibkr",
                            "--target-name",
                            f"legacy-{profile}",
                            "--strategy-profile",
                            profile,
                            "--execution-mode",
                            "live",
                            "--live-continuity-state",
                            "RECONCILE_ONLY",
                            "--live-continuity-baseline-id",
                            f"ibkr-{profile}-legacy-20260830",
                            "--live-continuity-captured-at",
                            "2026-08-30",
                        ]
                    )
                )

                strategy = build_config.load_config()["strategies"][profile]
                self.assertFalse(strategy["runtime_enabled"])
                self.assertFalse(strategy["can_switch_live"])
                self.assertEqual(runtime_settings.validate_target(target), [])

    def test_live_continuity_rejects_baseline_drift(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        runtime_target = target["runtime_target"]
        runtime_target.update(
            {
                "strategy_profile": "soxl_soxx_trend_income",
                "live_continuity": {
                    "state": "ACTIVE_LKG",
                    "baseline_kind": "legacy_authorized",
                    "baseline_id": "soxl-schwab-lkg-20260830",
                    "baseline_target_sha256": "a" * 64,
                    "captured_at": "2026-08-30",
                },
            }
        )

        errors = runtime_settings.validate_target(target)

        self.assertIn(
            "runtime_target.live_continuity.baseline_target_sha256 does not match the runtime target",
            errors,
        )

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

    def test_published_legacy_strategy_artifacts_are_not_auto_mounted(self):
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
        for profile in published_strategy_artifact_profiles:
            with self.subTest(profile=profile):
                self.assertEqual(
                    build_runtime_switch._auto_plugin_mounts(
                        profile,
                        "gs://qsl-runtime-logs-shared",
                    ),
                    [],
                )

    def test_build_config_strategy_to_json_compat_includes_strategy_gate_fields(self):
        strategies = {
            "sample": {
                "label": "样例策略",
                "domain": "us_equity",
                "runtime_enabled": False,
                "lifecycle_stage": "beta",
                "can_switch_live": False,
                "allowed_execution_modes": ["paper", "dry_run"],
                "blocked_live_reason": "manual-review",
                "features": {},
            },
        }

        payload = build_config.strategy_to_json_compat(strategies)
        profile = payload[0]
        self.assertEqual(profile["runtime_enabled"], False)
        self.assertEqual(profile["lifecycle_stage"], "beta")
        self.assertFalse(profile["can_switch_live"])
        self.assertEqual(profile["allowed_execution_modes"], ["paper", "dry_run"])
        self.assertEqual(profile["blocked_live_reason"], "manual-review")

    def test_runtime_catalog_projection_is_exact_and_never_claims_observed_runtime(self):
        config = build_config.load_config()
        projection_path = ROOT / "web" / "strategy-switch-console" / "runtime-catalog-projection.json"
        projection = json.loads(projection_path.read_text(encoding="utf-8"))

        self.assertEqual(projection, build_platform_config.build_runtime_catalog_projection(config))
        self.assertEqual(projection["schema_version"], "qsl.runtime_catalog_projection.v1")
        self.assertEqual(projection["data_status"], "catalog_only")
        self.assertFalse(projection["policy"]["catalog_is_runtime_observation"])
        self.assertFalse(projection["policy"]["catalog_can_authorize_promotion_or_trading"])
        self.assertFalse(projection["policy"]["historical_lifecycle_inventory_is_authoritative"])
        self.assertEqual(
            projection["summary"]["strategy_profile_count"],
            len(config["strategies"]),
        )
        self.assertEqual(projection["summary"]["live_switchable_count"], 0)
        self.assertEqual(
            projection["source"]["content_sha256"],
            build_platform_config._config_content_sha256(config),
        )

    def test_historical_lifecycle_inventory_is_explicitly_non_authoritative(self):
        matrix = json.loads(
            (ROOT / "web" / "strategy-switch-console" / "lifecycle-matrix.json").read_text(encoding="utf-8")
        )

        self.assertEqual(matrix["schema_version"], "qsl.historical_lifecycle_inventory.v1")
        self.assertEqual(matrix["record_status"], "historical_reference_only")
        self.assertEqual(matrix["superseded_by"]["catalog_gates"], "runtime-catalog-projection.json")
        self.assertEqual(matrix["superseded_by"]["candidate_lifecycle"], "GET /api/control-plane")
        self.assertEqual(matrix["superseded_by"]["target_execution_evidence"], "GET /api/execution-evidence")

    def test_global_and_hk_global_etf_rotation_profiles_are_research_only(self):
        expected = {
            "lifecycle_stage": "research_active",
            "runtime_enabled": False,
            "can_switch_live": False,
            "allowed_execution_modes": ["dry_run"],
            "blocked_live_reason": "research_backtest_only_requires_evidence_package",
        }
        config = build_config.load_config()
        profiles = {
            item["profile"]: item
            for item in json.loads(
                (ROOT / "web/strategy-switch-console/strategy-profiles.example.json").read_text(encoding="utf-8")
            )
        }

        for profile in ("global_etf_rotation", "hk_global_etf_tactical_rotation"):
            with self.subTest(profile=profile):
                self.assertEqual(
                    {field: config["strategies"][profile][field] for field in expected},
                    expected,
                )
                self.assertEqual({field: profiles[profile][field] for field in expected}, expected)
                for execution_mode in ("live", "paper"):
                    args = build_runtime_switch.build_parser().parse_args(
                        [
                            "--platform",
                            "ibkr",
                            "--target-name",
                            "live",
                            "--strategy-profile",
                            profile,
                            "--execution-mode",
                            execution_mode,
                            "--plugin-mode",
                            "none",
                        ]
                    )
                    with self.subTest(execution_mode=execution_mode):
                        with self.assertRaisesRegex(ValueError, f"does not allow {execution_mode} execution"):
                            build_runtime_switch.build_switch_target(args)

    def test_not_evidenced_profiles_are_catalog_demoted_fail_closed(self):
        expected = {
            "runtime_enabled": False,
            "can_switch_live": False,
            "lifecycle_stage": "research_active",
            "allowed_execution_modes": ["paper", "dry_run"],
            "blocked_live_reason": "missing_current_promotion_evidence_and_preauthorized_autonomy_policy",
        }
        config = build_config.load_config()["strategies"]
        generated = {
            item["profile"]: item
            for item in json.loads(
                (ROOT / "web" / "strategy-switch-console" / "strategy-profiles.example.json").read_text(
                    encoding="utf-8"
                )
            )
        }
        app_source = (ROOT / "web" / "strategy-switch-console" / "app.js").read_text(encoding="utf-8")
        fallback_match = re.search(
            r"const defaultStrategyProfiles = window\.__DEFAULT_STRATEGY_PROFILES__ \|\| (\[.*?\n    \]);",
            app_source,
            re.DOTALL,
        )
        self.assertIsNotNone(fallback_match)
        fallback = {item["profile"]: item for item in json.loads(fallback_match.group(1))}

        platform_by_domain = {
            "us_equity": "ibkr",
            "hk_equity": "ibkr",
            "cn_equity": "qmt",
            "crypto": "binance",
        }
        actual_config = build_config.load_config()
        for profile in self.NOT_EVIDENCED_PROFILES:
            with self.subTest(profile=profile):
                for catalog in (config, generated, fallback):
                    self.assertEqual({field: catalog[profile][field] for field in expected}, expected)
                errors = []
                with patch.object(runtime_settings, "load_platform_config", return_value=actual_config):
                    runtime_settings.validate_runtime_target_strategy_policy(
                        {
                            "platform_id": platform_by_domain[config[profile]["domain"]],
                            "strategy_profile": profile,
                            "execution_mode": "live",
                        },
                        errors,
                    )
                self.assertIn(f"runtime_target.strategy_profile {profile} does not allow live execution", errors)
                self.assertIn(f"runtime_target.strategy_profile {profile} is not runtime_enabled", errors)
                self.assertIn(f"runtime_target.strategy_profile {profile} cannot switch live", errors)

                errors = []
                with patch.object(runtime_settings, "load_platform_config", return_value=actual_config):
                    runtime_settings.validate_runtime_target_strategy_policy(
                        {
                            "platform_id": platform_by_domain[config[profile]["domain"]],
                            "strategy_profile": profile,
                            "execution_mode": "paper",
                            "dry_run_only": True,
                        },
                        errors,
                    )
                self.assertEqual(errors, [])

    def test_strategy_switch_console_normalizes_dry_run_and_keeps_non_live_profiles_selectable(self):
        source = (ROOT / "web" / "strategy-switch-console" / "app.js").read_text(encoding="utf-8")
        normalize = re.search(
            r"function normalizeExecutionMode\(.*?\n    }",
            source,
            re.DOTALL,
        )
        eligibility = re.search(
            r"function strategyAllowedForAccount\(.*?\n    }",
            source,
            re.DOTALL,
        )

        self.assertIsNotNone(normalize)
        self.assertIsNotNone(eligibility)
        self.assertIn('mode === "dry_run"', normalize.group(0))
        self.assertIn('return "dry_run"', normalize.group(0))
        self.assertNotIn("catalogEntry.runtime_enabled !== true", eligibility.group(0))
        self.assertIn('if (mode === "live") return strategyCanSwitchLive(catalogEntry);', eligibility.group(0))

    def test_build_platform_config_build_strategy_profile_entries_defaults_gate_fields(self):
        payload = build_platform_config.build_strategy_profile_entries({
            "strategies": {
                "sample": {
                    "label": "样例策略",
                    "domain": "us_equity",
                    "features": {},
                },
            },
        })
        profile = payload[0]

        self.assertEqual(profile["lifecycle_stage"], "research_active")
        self.assertFalse(profile["can_switch_live"])
        self.assertEqual(profile["allowed_execution_modes"], ["paper", "dry_run"])
        self.assertEqual(profile["blocked_live_reason"], "research_active")

    def test_published_strategy_lifecycle_fields_use_only_canonical_states(self):
        canonical = {
            "research_active",
            "shadow_active",
            "paper_active",
            "live_candidate",
            "live_enabled",
        }
        config_entries = build_config.load_config()["strategies"].values()
        generated_entries = json.loads(
            (
                ROOT
                / "web/strategy-switch-console/strategy-profiles.example.json"
            ).read_text(encoding="utf-8")
        )
        app_source = (
            ROOT / "web/strategy-switch-console/app.js"
        ).read_text(encoding="utf-8")
        fallback_match = re.search(
            r"const defaultStrategyProfiles = window\.__DEFAULT_STRATEGY_PROFILES__ \|\| (\[.*?\n    \]);",
            app_source,
            re.DOTALL,
        )
        self.assertIsNotNone(fallback_match)
        fallback_entries = json.loads(fallback_match.group(1))

        for entry in [*config_entries, *generated_entries, *fallback_entries]:
            self.assertIn(entry["lifecycle_stage"], canonical)

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
            },
        )

    def test_extract_account_sync_controls_prefers_exact_service_when_scope_is_shared(self):
        target = {
            "target_id": "ibkr/shared-b",
            "runtime_target": {
                "platform_id": "ibkr",
                "strategy_profile": "nasdaq_sp500_smart_dca",
                "service_name": "interactive-brokers-shared-b-service",
                "account_scope": "shared-account",
            },
            "extra_variables": {
                "CLOUD_RUN_SERVICE_TARGETS_JSON": {
                    "targets": [
                        {
                            "service": "interactive-brokers-shared-a-service",
                            "ACCOUNT_GROUP": "shared-account",
                            "DCA_MODE": "fixed",
                        },
                        {
                            "service": "interactive-brokers-shared-b-service",
                            "ACCOUNT_GROUP": "shared-account",
                            "DCA_MODE": "smart",
                        },
                    ]
                }
            },
        }

        self.assertEqual(
            runtime_settings.extract_account_sync_controls(target),
            {"dca_mode": "smart"},
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
        self.assertIn("STRATEGY_HEALTH_SYNC_TOKEN", workflow)
        self.assertIn("secret put STRATEGY_HEALTH_SYNC_TOKEN", workflow)
        self.assertIn("RESEARCH_TASK_SYNC_TOKEN", workflow)
        self.assertIn("secret put RESEARCH_TASK_SYNC_TOKEN", workflow)
        self.assertIn("M0_RESEARCH_SYNC_TOKEN", workflow)
        self.assertIn("secret put M0_RESEARCH_SYNC_TOKEN", workflow)
        self.assertIn("Verify M0 research-ledger ingress token", workflow)
        self.assertIn("M0_RESEARCH_SYNC_TOKEN is required", workflow)
        self.assertNotIn("if: env.M0_RESEARCH_SYNC_TOKEN != ''", workflow)
        self.assertIn("CLOUDFLARE_WRANGLER_CONFIG_TOML", workflow)
        self.assertIn("STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID", workflow)
        self.assertIn("python/scripts/sync_strategy_switch_page_asset.py", workflow)
        self.assertIn("expected_profiles", workflow)
        self.assertIn("actual_profiles", workflow)
        self.assertIn("actual_profiles != expected_profiles", workflow)
        self.assertIn("catalog_readback=", workflow)
        for field in (
            "profile",
            "runtime_enabled",
            "lifecycle_stage",
            "can_switch_live",
            "allowed_execution_modes",
            "blocked_live_reason",
        ):
            self.assertIn(field, workflow)

    def test_plugin_mount_schema_version_must_be_non_empty_string(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        target["plugin_mounts"][0]["expected_schema_version"] = ""

        self.assertIn(
            "plugin_mounts[0].expected_schema_version must be a non-empty string",
            runtime_settings.validate_target(target),
        )

    def test_plugin_mount_cannot_request_live_execution(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        target["plugin_mounts"][0]["expected_mode"] = "live"

        self.assertIn(
            "plugin_mounts[0].expected_mode must be dry_run, paper, or shadow; plugins cannot request live execution",
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

    def test_service_target_inventory_rejects_nested_secret_values(self):
        _, target = self.load_target("examples/targets/longbridge/sg.example.json")
        target["repository_variables"] = {
            "CLOUD_RUN_SERVICE_TARGETS_JSON": {
                "targets": [
                    {
                        "service": "longbridge-quant-sg-service",
                        "BROKER_PASSWORD": "not-allowed",
                        "LONGPORT_SECRET_NAME": "allowed-secret-manager-name",
                    }
                ]
            }
        }

        errors = runtime_settings.validate_target(target)

        self.assertIn(
            "repository_variables.CLOUD_RUN_SERVICE_TARGETS_JSON.targets[0].BROKER_PASSWORD looks like a secret and must not be stored here",
            errors,
        )
        self.assertNotIn(
            "repository_variables.CLOUD_RUN_SERVICE_TARGETS_JSON.targets[0].LONGPORT_SECRET_NAME looks like a secret and must not be stored here",
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
        self.assertEqual(target["runtime_target"]["market"], "US")
        self.assertEqual(target["runtime_target"]["market_calendar"], "NYSE")
        self.assertEqual(target["runtime_target"]["market_timezone"], "America/New_York")
        self.assertEqual(
            target["runtime_target"]["scheduler"],
            {
                "timezone": "America/New_York",
                "main_time": "45 15 * * 1-5",
                "probe_time": "35 9,15 * * 1-5",
                "precheck_time": "45 9 * * 1-5",
            },
        )
        self.assertEqual(assignments["STRATEGY_PROFILE"], "tqqq_growth_income")
        self.assertEqual(assignments["LONGBRIDGE_DRY_RUN_ONLY"], "false")
        plugin_payload = json.loads(assignments["LONGBRIDGE_STRATEGY_PLUGIN_MOUNTS_JSON"])
        self.assertEqual(plugin_payload["strategy_plugins"], [])
        self.assertEqual(runtime_settings.validate_target(target), [])

    def test_build_switch_target_freezes_eligible_legacy_live_baseline(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "longbridge",
                "--target-name",
                "sg",
                "--strategy-profile",
                "soxl_soxx_trend_income",
                "--execution-mode",
                "live",
                "--live-continuity-state",
                "ACTIVE_LKG",
                "--live-continuity-baseline-id",
                "soxl-longbridge-lkg-20260830",
                "--live-continuity-captured-at",
                "2026-08-30",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        continuity = target["runtime_target"]["live_continuity"]

        self.assertEqual(continuity["state"], "ACTIVE_LKG")
        self.assertEqual(continuity["baseline_kind"], "legacy_authorized")
        self.assertEqual(
            continuity["baseline_target_sha256"],
            runtime_settings.runtime_target_fingerprint(target["runtime_target"]),
        )
        self.assertEqual(runtime_settings.validate_target(target), [])

    def test_build_switch_target_rejects_continuity_for_dry_run(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "longbridge",
                "--target-name",
                "sg",
                "--strategy-profile",
                "tqqq_growth_income",
                "--execution-mode",
                "dry_run",
                "--live-continuity-state",
                "ACTIVE_LKG",
                "--live-continuity-baseline-id",
                "tqqq-longbridge-lkg-20260830",
                "--live-continuity-captured-at",
                "2026-08-30",
            ]
        )

        with self.assertRaisesRegex(ValueError, "only valid for an execution_mode=live"):
            build_runtime_switch.build_switch_target(args)

    def test_build_switch_target_treats_legacy_auto_plugin_mode_as_none(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "longbridge",
                "--target-name",
                "sg",
                "--strategy-profile",
                "tqqq_growth_income",
                "--plugin-mode",
                "auto",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(
            json.loads(assignments["LONGBRIDGE_STRATEGY_PLUGIN_MOUNTS_JSON"]),
            {"strategy_plugins": []},
        )

    def test_build_switch_target_preserves_current_mounts_for_same_strategy(self):
        parser = build_runtime_switch.build_parser()
        with tempfile.TemporaryDirectory() as temp_dir:
            mounts_path = Path(temp_dir) / "current-plugin-mounts.json"
            mounts_path.write_text(
                json.dumps(
                    {
                        "strategy_plugins": [
                            {
                                "strategy": "soxl_soxx_trend_income",
                                "plugin": "market_regime_control",
                                "enabled": True,
                                "expected_mode": "shadow",
                                "signal_path": "gs://example/plugin.json",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            args = parser.parse_args(
                [
                    "--platform",
                    "longbridge",
                    "--target-name",
                    "sg",
                    "--strategy-profile",
                    "soxl_soxx_trend_income",
                    "--plugin-mode",
                    "current",
                    "--current-plugin-mounts-json-file",
                    str(mounts_path),
                ]
            )

            target = build_runtime_switch.build_switch_target(args)

        self.assertEqual(
            target["plugin_mounts"],
            [
                {
                    "strategy": "soxl_soxx_trend_income",
                    "plugin": "market_regime_control",
                    "enabled": True,
                    "expected_mode": "shadow",
                    "signal_path": "gs://example/plugin.json",
                }
            ],
        )

    def test_build_switch_target_rejects_current_mounts_for_other_strategy(self):
        parser = build_runtime_switch.build_parser()
        with tempfile.TemporaryDirectory() as temp_dir:
            mounts_path = Path(temp_dir) / "current-plugin-mounts.json"
            mounts_path.write_text(
                json.dumps(
                    {
                        "strategy_plugins": [
                            {
                                "strategy": "tqqq_growth_income",
                                "plugin": "market_regime_control",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            args = parser.parse_args(
                [
                    "--platform",
                    "longbridge",
                    "--target-name",
                    "sg",
                    "--strategy-profile",
                    "soxl_soxx_trend_income",
                    "--plugin-mode",
                    "current",
                    "--current-plugin-mounts-json-file",
                    str(mounts_path),
                ]
            )

            with self.assertRaisesRegex(ValueError, "only preserves mounts for the selected strategy"):
                build_runtime_switch.build_switch_target(args)

    def test_build_switch_target_rejects_legacy_custom_plugin_mounts(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "longbridge",
                "--target-name",
                "sg",
                "--strategy-profile",
                "tqqq_growth_income",
                "--plugin-mode",
                "custom",
                "--custom-plugin-mounts-json",
                '[{"plugin":"market_regime_control"}]',
            ]
        )

        with self.assertRaisesRegex(ValueError, "legacy custom plugin mounts are retired"):
            build_runtime_switch.build_switch_target(args)

    def test_market_plan_covers_every_catalog_strategy(self):
        config = build_runtime_switch._load_platform_config()

        for profile, strategy in config["strategies"].items():
            domain = config["domains"][strategy["domain"]]
            self.assertEqual(
                build_runtime_switch._market_plan_for_strategy(profile),
                {
                    "market": domain["market"],
                    "market_calendar": domain["market_calendar"],
                    "market_timezone": domain["market_timezone"],
                },
            )

    def test_live_us_scheduler_profiles_are_weekday_only(self):
        config = build_runtime_switch._load_platform_config()

        for profile, scheduler in config["scheduling"]["profiles"].items():
            if not profile.startswith("us_"):
                continue
            for field in ("main_time", "probe_time", "precheck_time"):
                cron = scheduler[field].split()
                self.assertEqual(len(cron), 5, (profile, field))
                self.assertEqual(cron[2], "*", (profile, field))
                self.assertEqual(cron[4], "1-5", (profile, field))

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
        self.assertEqual(plugin_payload["strategy_plugins"], [])

    def test_build_switch_target_does_not_auto_mount_legacy_plugin_for_soxl(self):
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
        self.assertEqual(plugin_payload["strategy_plugins"], [])

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
        self.assertEqual(plugin_payload["strategy_plugins"], [])

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
        self.assertEqual(target["runtime_target"]["execution_mode"], "paper")
        self.assertEqual(target["runtime_target"]["market"], "CN")
        self.assertEqual(target["runtime_target"]["market_calendar"], "SSE")
        self.assertEqual(target["runtime_target"]["market_timezone"], "Asia/Shanghai")
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

    def test_build_switch_target_preserves_dry_run_semantics_for_all_profile_domains(self):
        cases = (
            ("ibkr", "coverage-us", "global_etf_rotation"),
            ("longbridge", "coverage-hk", "hk_global_etf_tactical_rotation"),
            ("qmt", "coverage-cn", "cn_industry_etf_rotation"),
            ("binance", "coverage-crypto", "crypto_live_pool_rotation"),
        )
        parser = build_runtime_switch.build_parser()
        for platform, target_name, profile in cases:
            with self.subTest(platform=platform, profile=profile):
                target = build_runtime_switch.build_switch_target(
                    parser.parse_args(
                        [
                            "--platform", platform,
                            "--target-name", target_name,
                            "--strategy-profile", profile,
                            "--execution-mode", "dry_run",
                        ]
                    )
                )
                self.assertEqual(target["runtime_target"]["execution_mode"], "paper")
                self.assertTrue(target["runtime_target"]["dry_run_only"])
                self.assertEqual(runtime_settings.effective_execution_mode(target["runtime_target"]), "dry_run")
                self.assertEqual(runtime_settings.validate_target(target), [])

    def test_every_default_buildable_dry_run_route_builds_a_valid_no_order_target(self):
        config = build_config.load_config()
        coverage = build_config.build_strategy_platform_dry_run_coverage(config)
        parser = build_runtime_switch.build_parser()
        route_count = 0

        for route in coverage["profiles"]:
            profile = route["profile"]
            for platform in route["buildable_dry_run_platforms"]:
                with self.subTest(profile=profile, platform=platform):
                    target = build_runtime_switch.build_switch_target(
                        parser.parse_args(
                            [
                                "--platform", platform,
                                "--target-name", f"coverage-{platform}",
                                "--strategy-profile", profile,
                                "--execution-mode", "dry_run",
                            ]
                        )
                    )
                    self.assertEqual(runtime_settings.effective_execution_mode(target["runtime_target"]), "dry_run")
                    self.assertTrue(target["runtime_target"]["dry_run_only"])
                    self.assertEqual(runtime_settings.validate_target(target), [])
                    route_count += 1

        self.assertEqual(route_count, coverage["summary"]["buildable_dry_run_route_count"])

    def test_parked_snapshot_strategy_builds_only_with_a_verified_artifact_pair(self):
        parser = build_runtime_switch.build_parser()
        variable_pairs = {
            "ibkr": ("IBKR_FEATURE_SNAPSHOT_PATH", "IBKR_FEATURE_SNAPSHOT_MANIFEST_PATH"),
            "longbridge": (
                "LONGBRIDGE_FEATURE_SNAPSHOT_PATH",
                "LONGBRIDGE_FEATURE_SNAPSHOT_MANIFEST_PATH",
            ),
        }
        for platform, (snapshot_variable, manifest_variable) in variable_pairs.items():
            with self.subTest(platform=platform):
                target = build_runtime_switch.build_switch_target(
                    parser.parse_args(
                        [
                            "--platform", platform,
                            "--target-name", f"snapshot-{platform}",
                            "--strategy-profile", "hk_low_vol_dividend_quality_snapshot",
                            "--execution-mode", "dry_run",
                            "--extra-variable", f"{snapshot_variable}=gs://verified-artifacts/factor.csv",
                            "--extra-variable", f"{manifest_variable}=gs://verified-artifacts/factor.csv.manifest.json",
                        ]
                    )
                )
                self.assertEqual(runtime_settings.effective_execution_mode(target["runtime_target"]), "dry_run")
                self.assertTrue(target["runtime_target"]["dry_run_only"])
                self.assertEqual(
                    target["extra_variables"][snapshot_variable],
                    "gs://verified-artifacts/factor.csv",
                )
                self.assertEqual(
                    target["extra_variables"][manifest_variable],
                    "gs://verified-artifacts/factor.csv.manifest.json",
                )
                self.assertEqual(runtime_settings.validate_target(target), [])

    def test_runtime_target_rejects_unwired_paper_control_mode(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        target["runtime_target"]["strategy_profile"] = "soxl_soxx_trend_income"
        target["runtime_target"]["execution_mode"] = "paper"
        target["runtime_target"]["dry_run_only"] = False

        self.assertIn(
            "platform schwab does not support paper control execution",
            runtime_settings.validate_target(target),
        )

    def test_build_switch_target_rejects_live_qmt_without_live_runtime_configuration(self):
        args = build_runtime_switch.build_parser().parse_args(
            [
                "--platform",
                "qmt",
                "--target-name",
                "industry-etf",
                "--strategy-profile",
                "cn_industry_etf_rotation",
                "--execution-mode",
                "live",
            ]
        )

        with self.assertRaisesRegex(
            ValueError,
            "platform qmt has no live runtime configuration",
        ):
            build_runtime_switch.build_switch_target(args)

    def test_build_switch_target_defaults_binance_repository_scope(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "binance",
                "--target-name",
                "default",
                "--strategy-profile",
                "crypto_live_pool_rotation",
                "--plugin-mode",
                "none",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(target["github"]["repository"], "QuantStrategyLab/BinancePlatform")
        self.assertEqual(target["github"]["variable_scope"], "repository")
        self.assertEqual(target["runtime_target"]["platform_id"], "binance")
        self.assertEqual(target["runtime_target"]["service_name"], "binance-platform")
        self.assertEqual(target["runtime_target"]["market"], "CRYPTO")
        self.assertEqual(target["runtime_target"]["market_calendar"], "24/7")
        self.assertEqual(target["runtime_target"]["market_timezone"], "UTC")
        self.assertEqual(assignments["BINANCE_DRY_RUN"], "false")
        self.assertEqual(
            target["runtime_target"]["scheduler"],
            {
                "timezone": "UTC",
                "main_time": "0,30 * * * *",
                "probe_time": "0 6,18 * * *",
                "precheck_time": "55 5 * * *",
            },
        )

    def test_build_switch_target_uses_weekday_trigger_for_monthly_dca(self):
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
                "main_time": "45 15 * * 1-5",
                "probe_time": "35 9,15 * * 1-5",
                "precheck_time": "45 9 * * 1-5",
            },
        )

    def test_build_switch_target_keeps_daily_dca_scheduler_but_disables_legacy_ibit_plugin(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "firstrade",
                "--target-name",
                "ibit",
                "--strategy-profile",
                "ibit_smart_dca",
                "--dca-mode",
                "smart",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}
        plugin_payload = json.loads(assignments["FIRSTRADE_STRATEGY_PLUGIN_MOUNTS_JSON"])

        self.assertEqual(
            target["runtime_target"]["scheduler"],
            {
                "timezone": "America/New_York",
                "main_time": "45 15 * * 1-5",
                "probe_time": "35 9,15 * * 1-5",
                "precheck_time": "45 9 * * 1-5",
            },
        )
        self.assertEqual(plugin_payload["strategy_plugins"], [])
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_ENABLED"], "false")
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_MODE"], "paper")

    def test_build_switch_target_ignores_legacy_ibit_zscore_controls(self):
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "firstrade",
                "--target-name",
                "ibit",
                "--strategy-profile",
                "ibit_smart_dca",
                "--dca-mode",
                "smart",
                "--extra-variables-json",
                '{"ibit_zscore_exit_mode":"live","ibit_zscore_exit_parking_symbol":"SGOV"}',
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_ENABLED"], "false")
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_MODE"], "paper")
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_PARKING_SYMBOL"], "BOXX")
        self.assertNotIn("ibit_zscore_exit_mode", target["extra_variables"])
        self.assertNotIn("ibit_zscore_exit_parking_symbol", target["extra_variables"])

    def test_build_switch_target_disables_ibit_zscore_exit_for_fixed_dca(self):
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
            build_runtime_switch._load_platform_config()["scheduling"]["profiles"]["us_dca_month_end"],
        )
        self.assertEqual(plugin_payload["strategy_plugins"], [])
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_ENABLED"], "false")
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_MODE"], "paper")

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
                "--dca-mode",
                "smart",
                "--plugin-mode",
                "none",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(
            target["runtime_target"]["scheduler"],
            build_runtime_switch._load_platform_config()["scheduling"]["profiles"]["us_dca_month_end"],
        )
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_ENABLED"], "false")
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_MODE"], "paper")

    def test_build_switch_target_ignores_legacy_ibit_zscore_controls_for_other_profiles(self):
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

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_ENABLED"], "")
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_MODE"], "")
        self.assertNotIn("ibit_zscore_exit_mode", target["extra_variables"])

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

    def test_build_switch_target_accepts_dca_profile_on_ibkr(self):
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

        target = build_runtime_switch.build_switch_target(args)

        self.assertEqual(target["runtime_target"]["strategy_profile"], "nasdaq_sp500_smart_dca")
        self.assertEqual(target["runtime_target"]["platform_id"], "ibkr")

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
                "--execution-mode",
                "paper",
                "--plugin-mode",
                "none",
                "--extra-variables-json",
                json.dumps(
                    {
                        "LONGBRIDGE_FEATURE_SNAPSHOT_PATH": "gs://manual/snapshot.csv",
                        "LONGBRIDGE_FEATURE_SNAPSHOT_MANIFEST_PATH": (
                            "gs://manual/snapshot.csv.manifest.json"
                        ),
                    }
                ),
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

    def test_build_switch_target_auto_configures_ibkr_snapshot_artifacts(self):
        cases = {
            "russell_top50_leader_rotation": (
                "gs://qsl-runtime-logs-shared/strategy-artifacts/us_equity/"
                "russell_top50_leader_rotation_staging/"
                "russell_top50_leader_rotation_feature_snapshot_latest.csv"
            ),
        }
        for profile, snapshot_path in cases.items():
            with self.subTest(profile=profile):
                args = build_runtime_switch.build_parser().parse_args(
                    [
                        "--platform",
                        "ibkr",
                        "--target-name",
                        "live",
                        "--strategy-profile",
                        profile,
                        "--plugin-mode",
                        "none",
                    ]
                )

                target = build_runtime_switch.build_switch_target(args)
                assignments = {
                    item.name: item.value for item in runtime_settings.build_assignments(target)
                }

                self.assertEqual(assignments["IBKR_FEATURE_SNAPSHOT_PATH"], snapshot_path)
                self.assertEqual(
                    assignments["IBKR_FEATURE_SNAPSHOT_MANIFEST_PATH"],
                    f"{snapshot_path}.manifest.json",
                )

    def test_build_switch_target_clears_stale_ibkr_snapshot_artifacts(self):
        existing = {
            "targets": [
                {
                    "service": "interactive-brokers-live-service",
                    "ACCOUNT_GROUP": "live",
                    "IBKR_FEATURE_SNAPSHOT_PATH": "gs://stale/snapshot.csv",
                    "IBKR_FEATURE_SNAPSHOT_MANIFEST_PATH": "gs://stale/snapshot.csv.manifest.json",
                    "runtime_target": {
                        "platform_id": "ibkr",
                        "strategy_profile": "global_etf_rotation",
                        "dry_run_only": False,
                        "deployment_selector": "live",
                        "account_selector": ["LIVE"],
                        "account_scope": "live",
                        "service_name": "interactive-brokers-live-service",
                        "execution_mode": "live",
                    },
                }
            ]
        }
        path = ROOT / ".pytest_runtime_service_targets_snapshot.json"
        path.write_text(runtime_settings.compact_json(existing), encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        args = build_runtime_switch.build_parser().parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "live",
                "--strategy-profile",
                "tqqq_growth_income",
                "--account-selector",
                "LIVE",
                "--service-name",
                "interactive-brokers-live-service",
                "--plugin-mode",
                "none",
                "--existing-service-targets-json-file",
                str(path),
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}
        selected = json.loads(assignments["CLOUD_RUN_SERVICE_TARGETS_JSON"])["targets"][0]

        self.assertEqual(selected["IBKR_FEATURE_SNAPSHOT_PATH"], "")
        self.assertEqual(selected["IBKR_FEATURE_SNAPSHOT_MANIFEST_PATH"], "")

    def test_snapshot_strategy_uses_verified_catalog_artifact_pair(self):
        args = build_runtime_switch.build_parser().parse_args(
            [
                "--platform",
                "longbridge",
                "--target-name",
                "hk",
                "--strategy-profile",
                "hk_low_vol_dividend_quality_snapshot",
                "--execution-mode",
                "paper",
                "--plugin-mode",
                "none",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        snapshot_path = (
            "gs://qsl-runtime-logs-shared/strategy-artifacts/hk_equity/"
            "hk_low_vol_dividend_quality_snapshot_staging/"
            "hk_low_vol_dividend_quality_snapshot_factor_snapshot_latest.csv"
        )
        self.assertEqual(assignments["LONGBRIDGE_FEATURE_SNAPSHOT_PATH"], snapshot_path)
        self.assertEqual(
            assignments["LONGBRIDGE_FEATURE_SNAPSHOT_MANIFEST_PATH"],
            f"{snapshot_path}.manifest.json",
        )

    def test_snapshot_strategy_accepts_explicit_platform_artifact_pair(self):
        args = build_runtime_switch.build_parser().parse_args(
            [
                "--platform",
                "longbridge",
                "--target-name",
                "hk",
                "--strategy-profile",
                "hk_low_vol_dividend_quality_snapshot",
                "--execution-mode",
                "paper",
                "--plugin-mode",
                "none",
                "--extra-variables-json",
                json.dumps(
                    {
                        "LONGBRIDGE_FEATURE_SNAPSHOT_PATH": "gs://manual/snapshot.csv",
                        "LONGBRIDGE_FEATURE_SNAPSHOT_MANIFEST_PATH": (
                            "gs://manual/snapshot.csv.manifest.json"
                        ),
                    }
                ),
            ]
        )

        target = build_runtime_switch.build_switch_target(args)

        self.assertEqual(
            target["extra_variables"]["LONGBRIDGE_FEATURE_SNAPSHOT_PATH"],
            "gs://manual/snapshot.csv",
        )

    def test_non_snapshot_strategy_rejects_snapshot_artifact_override(self):
        args = build_runtime_switch.build_parser().parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "live",
                "--strategy-profile",
                "tqqq_growth_income",
                "--extra-variables-json",
                json.dumps(
                    {
                        "IBKR_FEATURE_SNAPSHOT_PATH": "gs://unexpected/snapshot.csv",
                        "IBKR_FEATURE_SNAPSHOT_MANIFEST_PATH": (
                            "gs://unexpected/snapshot.csv.manifest.json"
                        ),
                    }
                ),
            ]
        )

        with self.assertRaisesRegex(ValueError, "does not accept feature snapshot artifacts"):
            build_runtime_switch.build_switch_target(args)

    def test_scheduler_plan_uses_catalog_strategy_override_without_code_mapping(self):
        scheduler = {
            "timezone": "Europe/London",
            "main_time": "5 14 * * 1-5",
            "probe_time": "55 13 * * 1-5",
            "precheck_time": "0 14 * * 1-5",
        }
        config = {
            "scheduling": {"profiles": {"custom_market": scheduler}},
            "domains": {"custom_equity": {"scheduler_profile": "custom_market"}},
            "strategies": {"custom_strategy": {"domain": "custom_equity"}},
        }

        with patch.object(build_runtime_switch, "_load_platform_config", return_value=config):
            resolved = build_runtime_switch._scheduler_plan_for_strategy("custom_strategy")

        self.assertEqual(resolved, scheduler)

    def test_scheduler_plugin_override_ignores_mount_for_another_strategy(self):
        config = build_runtime_switch._load_platform_config()

        resolved = build_runtime_switch._scheduler_plan_for_strategy(
            "ibit_smart_dca",
            plugin_mounts=[
                {
                    "strategy": "another_strategy",
                    "plugin": "ibit_zscore_exit",
                    "enabled": True,
                }
            ],
        )

        self.assertEqual(
            resolved,
            config["scheduling"]["profiles"]["us_dca_month_end"],
        )

    def test_build_config_rejects_unknown_strategy_scheduler_profile(self):
        config = build_config.load_config()
        config["strategies"] = dict(config["strategies"])
        config["strategies"]["global_etf_rotation"] = {
            **config["strategies"]["global_etf_rotation"],
            "scheduler_profile": "missing_profile",
        }

        self.assertIn(
            "strategy global_etf_rotation: unknown scheduler_profile 'missing_profile'",
            build_config.validate(config),
        )

    def test_build_config_requires_live_snapshot_artifact_pair(self):
        config = build_config.load_config()
        config["strategies"]["global_etf_rotation"]["can_switch_live"] = True
        config["strategies"]["global_etf_rotation"]["runtime_artifacts"][
            "feature_snapshot"
        ].pop("manifest_path")

        self.assertIn(
            "strategy global_etf_rotation: live feature snapshot requires path and manifest_path",
            build_config.validate(config),
        )

    def test_build_config_rejects_non_boolean_snapshot_requirement(self):
        config = build_config.load_config()
        config["strategies"]["global_etf_rotation"]["runtime_artifacts"][
            "feature_snapshot"
        ]["required"] = "true"

        self.assertIn(
            "strategy global_etf_rotation: runtime_artifacts.feature_snapshot.required must be boolean",
            build_config.validate(config),
        )

    def test_runtime_artifact_evidence_registry_covers_every_required_snapshot(self):
        config = build_config.load_config()

        registry = build_config.build_runtime_artifact_evidence_registry(config)

        self.assertEqual(registry["schema_version"], "runtime_artifact_evidence_registry.v1")
        self.assertEqual(registry["summary"]["required_artifact_count"], 3)
        self.assertEqual(
            {entry["profile"] for entry in registry["entries"]},
            {
                "global_etf_rotation",
                "russell_top50_leader_rotation",
                "hk_low_vol_dividend_quality_snapshot",
            },
        )
        self.assertTrue(all(entry["max_age_days"] >= 1 for entry in registry["entries"]))

    def test_build_config_requires_required_snapshot_freshness_budget(self):
        config = build_config.load_config()
        config["strategies"]["global_etf_rotation"]["runtime_artifacts"][
            "feature_snapshot"
        ].pop("max_age_days")

        self.assertIn(
            "strategy global_etf_rotation: required feature snapshot max_age_days must be an integer",
            build_config.validate(config),
        )

    def test_build_config_reports_malformed_scheduler_timezone(self):
        config = build_config.load_config()
        config["scheduling"]["profiles"]["us_daily"]["timezone"] = "../UTC"

        self.assertIn(
            "scheduler profile us_daily: invalid timezone '../UTC'",
            build_config.validate(config),
        )

    def test_build_config_rejects_invalid_deployment_topology(self):
        config = build_config.load_config()
        config["platforms"]["binance"]["deployment"]["settings_activation"] = "cloud_run_sync_workflow"

        self.assertIn(
            "platform binance: settings_activation 'cloud_run_sync_workflow' "
            "requires runtime_model 'cloud_run'",
            build_config.validate(config),
        )

    def test_build_config_requires_complete_domain_market_metadata(self):
        config = build_config.load_config()
        config["domains"]["us_equity"].pop("market_calendar")

        self.assertIn(
            "domain us_equity: market_calendar must be a non-empty string",
            build_config.validate(config),
        )

    def test_build_config_requires_scheduler_and_market_timezones_to_match(self):
        config = build_config.load_config()
        config["domains"]["us_equity"]["market_timezone"] = "America/Chicago"

        self.assertIn(
            "domain us_equity: scheduler timezone 'America/New_York' "
            "must match market_timezone 'America/Chicago'",
            build_config.validate(config),
        )

    def test_build_config_rejects_strategy_scheduler_market_timezone_mismatch(self):
        config = build_config.load_config()
        config["strategies"]["global_etf_rotation"]["scheduler_profile"] = "hk_daily"

        self.assertIn(
            "strategy global_etf_rotation: scheduler timezone 'Asia/Hong_Kong' "
            "must match market_timezone 'America/New_York'",
            build_config.validate(config),
        )

    def test_build_config_rejects_plugin_scheduler_market_timezone_mismatch(self):
        config = build_config.load_config()
        config["strategies"]["ibit_smart_dca"]["scheduler_profile_by_plugin"] = {
            "ibit_zscore_exit": "hk_daily"
        }

        self.assertIn(
            "strategy ibit_smart_dca: plugin ibit_zscore_exit scheduler timezone "
            "'Asia/Hong_Kong' must match market_timezone 'America/New_York'",
            build_config.validate(config),
        )

    def test_build_config_reports_non_string_scheduler_references(self):
        config = build_config.load_config()
        config["domains"]["us_equity"]["scheduler_profile"] = []
        config["strategies"]["global_etf_rotation"]["scheduler_profile"] = ["us_daily"]
        config["strategies"]["tqqq_growth_income"]["domain"] = []
        config["strategies"]["ibit_smart_dca"]["scheduler_profile_by_plugin"] = {
            "ibit_zscore_exit": ["us_daily"]
        }

        errors = build_config.validate(config)
        self.assertIn("domain us_equity: unknown scheduler_profile []", errors)
        self.assertIn("strategy global_etf_rotation: scheduler_profile must be a string", errors)
        self.assertIn("strategy tqqq_growth_income: domain must be a string", errors)
        self.assertIn(
            "strategy ibit_smart_dca: plugin ibit_zscore_exit references unknown scheduler_profile ['us_daily']",
            errors,
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

    def test_live_ibkr_us_scheduler_rejects_weekend_cron(self):
        args = build_runtime_switch.build_parser().parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "live",
                "--strategy-profile",
                "tqqq_growth_income",
            ]
        )
        target = build_runtime_switch.build_switch_target(args)
        target["runtime_target"]["scheduler"]["main_time"] = "45 15 * * *"

        self.assertIn(
            "runtime_target.scheduler.main_time must be a two-field time or Mon-Fri cron for live IBKR US targets",
            runtime_settings.validate_target(target),
        )

    def test_runtime_target_scheduler_rejects_extra_fields(self):
        _, target = self.load_target("examples/targets/longbridge/hk_combo.example.json")
        target["runtime_target"]["scheduler"]["offset_minutes"] = 10

        self.assertIn(
            "runtime_target.scheduler.offset_minutes is unsupported",
            runtime_settings.validate_target(target),
        )

    def test_runtime_target_scheduler_requires_timezone(self):
        _, target = self.load_target("examples/targets/longbridge/hk_combo.example.json")
        target["runtime_target"]["scheduler"].pop("timezone")

        self.assertIn(
            "runtime_target.scheduler.timezone must be a non-empty string",
            runtime_settings.validate_target(target),
        )

    def test_runtime_target_market_metadata_must_be_complete_when_present(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        target["runtime_target"]["market"] = "US"

        self.assertIn(
            "runtime_target market metadata must include market, market_calendar, and market_timezone together",
            runtime_settings.validate_target(target),
        )

    def test_runtime_target_market_metadata_must_match_strategy_domain(self):
        args = build_runtime_switch.build_parser().parse_args(
            [
                "--platform",
                "schwab",
                "--target-name",
                "live",
                "--strategy-profile",
                "tqqq_growth_income",
            ]
        )
        target = build_runtime_switch.build_switch_target(args)
        target["runtime_target"].update(
            {
                "market": "HK",
                "market_calendar": "XHKG",
                "market_timezone": "Asia/Hong_Kong",
            }
        )

        errors = runtime_settings.validate_target(target)

        self.assertIn(
            "runtime_target.market must match strategy domain us_equity: expected 'US'",
            errors,
        )
        self.assertIn(
            "runtime_target.market_calendar must match strategy domain us_equity: expected 'NYSE'",
            errors,
        )
        self.assertIn(
            "runtime_target.market_timezone must match strategy domain us_equity: expected 'America/New_York'",
            errors,
        )

    def test_runtime_target_scheduler_timezone_must_match_strategy_domain(self):
        args = build_runtime_switch.build_parser().parse_args(
            [
                "--platform",
                "schwab",
                "--target-name",
                "live",
                "--strategy-profile",
                "tqqq_growth_income",
            ]
        )
        target = build_runtime_switch.build_switch_target(args)
        target["runtime_target"]["scheduler"]["timezone"] = "Asia/Hong_Kong"

        self.assertIn(
            "runtime_target.scheduler.timezone must match strategy domain us_equity: "
            "expected 'America/New_York'",
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
        self.assertEqual(selected["IBKR_STRATEGY_PLUGIN_MOUNTS_JSON"]["strategy_plugins"], [])
        self.assertEqual(untouched["runtime_target"]["strategy_profile"], "soxl_soxx_trend_income")

    def test_build_switch_target_prefers_exact_service_when_account_scope_is_shared(self):
        existing = {
            "targets": [
                {
                    "service": "interactive-brokers-shared-a-service",
                    "ACCOUNT_GROUP": "shared-account",
                    "runtime_target": {
                        "platform_id": "ibkr",
                        "strategy_profile": "global_etf_rotation",
                        "dry_run_only": False,
                        "deployment_selector": "shared-a",
                        "account_selector": ["SHARED_ACCOUNT"],
                        "account_scope": "shared-account",
                        "service_name": "interactive-brokers-shared-a-service",
                        "execution_mode": "live",
                    },
                },
                {
                    "service": "interactive-brokers-shared-b-service",
                    "ACCOUNT_GROUP": "shared-account",
                    "runtime_target": {
                        "platform_id": "ibkr",
                        "strategy_profile": "soxl_soxx_trend_income",
                        "dry_run_only": False,
                        "deployment_selector": "shared-b",
                        "account_selector": ["SHARED_ACCOUNT"],
                        "account_scope": "shared-account",
                        "service_name": "interactive-brokers-shared-b-service",
                        "execution_mode": "live",
                    },
                },
            ]
        }
        path = ROOT / ".pytest_runtime_service_targets_shared_scope.json"
        path.write_text(runtime_settings.compact_json(existing), encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        args = build_runtime_switch.build_parser().parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "shared-b",
                "--strategy-profile",
                "tqqq_growth_income",
                "--account-selector",
                "SHARED_ACCOUNT",
                "--account-scope",
                "shared-account",
                "--service-name",
                "interactive-brokers-shared-b-service",
                "--existing-service-targets-json-file",
                str(path),
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}
        patched = json.loads(assignments["CLOUD_RUN_SERVICE_TARGETS_JSON"])["targets"]

        self.assertEqual(patched[0]["runtime_target"]["strategy_profile"], "global_etf_rotation")
        self.assertEqual(patched[1]["runtime_target"]["strategy_profile"], "tqqq_growth_income")

    def test_build_switch_target_allow_create_appends_service_with_shared_scope(self):
        existing = [
            {
                "service": "interactive-brokers-shared-a-service",
                "ACCOUNT_GROUP": "shared-account",
                "runtime_target": {
                    "platform_id": "ibkr",
                    "strategy_profile": "global_etf_rotation",
                    "account_scope": "shared-account",
                    "service_name": "interactive-brokers-shared-a-service",
                },
            }
        ]
        path = ROOT / ".pytest_runtime_service_targets_shared_scope_create.json"
        path.write_text(runtime_settings.compact_json(existing), encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        args = build_runtime_switch.build_parser().parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "shared-b",
                "--strategy-profile",
                "tqqq_growth_income",
                "--account-scope",
                "shared-account",
                "--service-name",
                "interactive-brokers-shared-b-service",
                "--existing-service-targets-json-file",
                str(path),
                "--allow-create-service-target",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}
        patched = json.loads(assignments["CLOUD_RUN_SERVICE_TARGETS_JSON"])

        self.assertIsInstance(patched, list)
        self.assertEqual(len(patched), 2)
        self.assertEqual(
            patched[0]["runtime_target"]["service_name"],
            "interactive-brokers-shared-a-service",
        )
        self.assertEqual(
            patched[1]["runtime_target"]["service_name"],
            "interactive-brokers-shared-b-service",
        )

    def test_service_target_selection_does_not_treat_scope_as_service_identity(self):
        runtime_target = {
            "service_name": "interactive-brokers-new-service",
            "account_scope": "shared-account",
        }
        entries = [
            {
                "service": "interactive-brokers-existing-service",
                "ACCOUNT_GROUP": "shared-account",
            }
        ]

        self.assertIsNone(
            runtime_settings.select_service_target_entry_index(runtime_target, entries)
        )
        self.assertEqual(
            runtime_settings.select_service_target_entry_index(
                runtime_target,
                [{"ACCOUNT_GROUP": "shared-account"}],
            ),
            0,
        )

    def test_build_switch_target_mirrors_longbridge_service_targets_at_repository_scope(self):
        existing = {
            "targets": [
                {
                    "service": "longbridge-quant-sg-service",
                    "runtime_target": {
                        "platform_id": "longbridge",
                        "strategy_profile": "soxl_soxx_trend_income",
                        "dry_run_only": False,
                        "deployment_selector": "SG",
                        "account_selector": ["SG"],
                        "account_scope": "SG",
                        "service_name": "longbridge-quant-sg-service",
                        "execution_mode": "live",
                    },
                }
            ]
        }
        path = ROOT / ".pytest_longbridge_service_targets.json"
        path.write_text(runtime_settings.compact_json(existing), encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        args = build_runtime_switch.build_parser().parse_args(
            [
                "--platform",
                "longbridge",
                "--target-name",
                "sg",
                "--strategy-profile",
                "tqqq_growth_income",
                "--existing-service-targets-json-file",
                str(path),
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = runtime_settings.build_assignments(target)
        repository_target = next(
            item for item in assignments if item.name == "CLOUD_RUN_SERVICE_TARGETS_JSON"
        )
        patched = json.loads(repository_target.value)["targets"][0]["runtime_target"]

        self.assertEqual(target["github"]["variable_scope"], "environment")
        self.assertEqual(repository_target.variable_scope, "repository")
        self.assertIsNone(repository_target.environment)
        self.assertEqual(patched["strategy_profile"], "tqqq_growth_income")
        self.assertEqual(patched["market_calendar"], "NYSE")
        self.assertTrue(
            any(
                item.name == "LONGBRIDGE_DRY_RUN_ONLY"
                and item.variable_scope == "environment"
                for item in assignments
            )
        )
        self.assertTrue(
            any(
                item.name == "LONGBRIDGE_STRATEGY_PLUGIN_MOUNTS_JSON"
                and item.variable_scope == "environment"
                for item in assignments
            )
        )

    def test_build_switch_target_keeps_repository_service_inventory_for_environment_switches(self):
        cases = (
            ("schwab", "charles-schwab-quant-service"),
            ("firstrade", "firstrade-quant-service"),
        )
        for platform, service_name in cases:
            with self.subTest(platform=platform):
                existing = {
                    "targets": [
                        {
                            "service": service_name,
                            "runtime_target": {
                                "platform_id": platform,
                                "strategy_profile": "tqqq_growth_income",
                                "dry_run_only": False,
                                "deployment_selector": platform,
                                "account_selector": [platform],
                                "account_scope": "US",
                                "service_name": service_name,
                                "execution_mode": "live",
                            },
                        }
                    ]
                }
                path = ROOT / f".pytest_{platform}_service_targets.json"
                path.write_text(runtime_settings.compact_json(existing), encoding="utf-8")
                self.addCleanup(lambda path=path: path.unlink(missing_ok=True))
                args = build_runtime_switch.build_parser().parse_args(
                    [
                        "--platform",
                        platform,
                        "--target-name",
                        "live",
                        "--strategy-profile",
                        "soxl_soxx_trend_income",
                        "--variable-scope",
                        "environment",
                        "--existing-service-targets-json-file",
                        str(path),
                    ]
                )

                target = build_runtime_switch.build_switch_target(args)
                assignments = runtime_settings.build_assignments(target)
                service_inventory = next(
                    item for item in assignments if item.name == "CLOUD_RUN_SERVICE_TARGETS_JSON"
                )

                self.assertEqual(service_inventory.variable_scope, "repository")
                self.assertIsNone(service_inventory.environment)
                self.assertTrue(
                    any(
                        item.name == "RUNTIME_TARGET_JSON"
                        and item.variable_scope == "environment"
                        for item in assignments
                    )
                )

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
        self.assertEqual(selected["IBKR_STRATEGY_PLUGIN_MOUNTS_JSON"]["strategy_plugins"], [])

    def test_build_switch_target_updates_nested_service_controls_without_stale_overrides(self):
        existing = {
            "targets": [
                {
                    "service": "interactive-brokers-demo-ibkr-soxl-service",
                    "ACCOUNT_GROUP": "demo-ibkr-soxl",
                    "env": {
                        "RUNTIME_TARGET_ENABLED": "false",
                        "IBKR_DRY_RUN_ONLY": "false",
                    },
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
        path = ROOT / ".pytest_runtime_service_targets_nested_controls.json"
        path.write_text(runtime_settings.compact_json(existing), encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "demo-ibkr-soxl",
                "--strategy-profile",
                "soxl_soxx_trend_income",
                "--account-selector",
                "DEMO_IBKR_SOXL",
                "--service-name",
                "interactive-brokers-demo-ibkr-soxl-service",
                "--existing-service-targets-json-file",
                str(path),
                "--extra-variables-json",
                '{"RUNTIME_TARGET_ENABLED":"true"}',
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}
        selected = json.loads(assignments["CLOUD_RUN_SERVICE_TARGETS_JSON"])["targets"][0]

        self.assertEqual(selected["env"]["RUNTIME_TARGET_ENABLED"], "true")
        self.assertEqual(selected["env"]["IBKR_DRY_RUN_ONLY"], "false")
        self.assertNotIn("RUNTIME_TARGET_ENABLED", selected)
        self.assertNotIn("IBKR_DRY_RUN_ONLY", selected)

    def test_build_switch_target_rejects_unknown_ibkr_service_target_by_default(self):
        path = ROOT / ".pytest_runtime_service_targets_unknown.json"
        path.write_text('{"targets":[]}', encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "new-account",
                "--strategy-profile",
                "tqqq_growth_income",
                "--existing-service-targets-json-file",
                str(path),
            ]
        )

        with self.assertRaisesRegex(ValueError, "existing IBKR service target was not found"):
            build_runtime_switch.build_switch_target(args)

    def test_build_switch_target_rejects_non_object_service_target_entry(self):
        path = ROOT / ".pytest_runtime_service_targets_invalid_entry.json"
        path.write_text(
            '{"targets":[{"service":"interactive-brokers-demo-service",'
            '"runtime_target":{"service_name":"interactive-brokers-demo-service"}},'
            '"invalid"]}',
            encoding="utf-8",
        )
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        args = build_runtime_switch.build_parser().parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "demo",
                "--strategy-profile",
                "tqqq_growth_income",
                "--service-name",
                "interactive-brokers-demo-service",
                "--existing-service-targets-json-file",
                str(path),
            ]
        )

        with self.assertRaisesRegex(ValueError, "service target entries must be objects"):
            build_runtime_switch.build_switch_target(args)

    def test_build_switch_target_rejects_non_array_targets_wrapper(self):
        path = ROOT / ".pytest_runtime_service_targets_invalid_wrapper.json"
        path.write_text('{"targets":{}}', encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        args = build_runtime_switch.build_parser().parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "demo",
                "--strategy-profile",
                "tqqq_growth_income",
                "--existing-service-targets-json-file",
                str(path),
                "--allow-create-service-target",
            ]
        )

        with self.assertRaisesRegex(ValueError, "service targets must be an array"):
            build_runtime_switch.build_switch_target(args)

    def test_build_switch_target_can_explicitly_append_ibkr_service_target(self):
        path = ROOT / ".pytest_runtime_service_targets_create.json"
        path.write_text("{}", encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        parser = build_runtime_switch.build_parser()
        args = parser.parse_args(
            [
                "--platform",
                "ibkr",
                "--target-name",
                "new-account",
                "--strategy-profile",
                "tqqq_growth_income",
                "--existing-service-targets-json-file",
                str(path),
                "--allow-create-service-target",
            ]
        )

        target = build_runtime_switch.build_switch_target(args)
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}
        patched = json.loads(assignments["CLOUD_RUN_SERVICE_TARGETS_JSON"])

        self.assertEqual(len(patched["targets"]), 1)
        self.assertEqual(patched["targets"][0]["runtime_target"]["account_scope"], "new-account")


if __name__ == "__main__":
    unittest.main()
