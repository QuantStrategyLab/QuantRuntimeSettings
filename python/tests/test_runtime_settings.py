from __future__ import annotations
# ruff: noqa: E701, E702  # Keep the frozen 105-case matrix within its 310-line cap.

import importlib.util
import json
import os
import re
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

QRS_EXPECTED_CASE_IDS = frozenset("""
C_FIXED_POINT.producer_schema_each_accepted P_PRODUCER.canonical_baseline P_PRODUCER.closed.binding_extra_private P_PRODUCER.closed.profile_extra_account
P_PRODUCER.closed.top_extra_account P_PRODUCER.cross.enabled_false_mode_live P_PRODUCER.cross.enabled_true_mode_off P_PRODUCER.determinism.repeat_same_input
P_PRODUCER.digest.artifact_config.generated_lower_exact P_PRODUCER.digest.config_digest.lower_exact P_PRODUCER.digest.config_digest.nonhex
P_PRODUCER.digest.config_digest.uppercase P_PRODUCER.digest.config_digest.wrong_length P_PRODUCER.duplicate.binding_case P_PRODUCER.duplicate.profile_case
P_PRODUCER.enum.catalog_stage.invalid P_PRODUCER.enum.catalog_stage.live_candidate P_PRODUCER.enum.catalog_stage.research_backtest_only
P_PRODUCER.enum.catalog_stage.runtime_enabled P_PRODUCER.enum.catalog_stage.shadow_candidate P_PRODUCER.enum.deployment_scope.disabled
P_PRODUCER.enum.deployment_scope.invalid P_PRODUCER.enum.deployment_scope.paper P_PRODUCER.enum.deployment_scope.production P_PRODUCER.enum.deployment_scope.research
P_PRODUCER.enum.domain.cn_equity P_PRODUCER.enum.domain.crypto P_PRODUCER.enum.domain.hk_equity P_PRODUCER.enum.domain.invalid P_PRODUCER.enum.domain.us_equity
P_PRODUCER.enum.execution_mode.dry_run P_PRODUCER.enum.execution_mode.invalid P_PRODUCER.enum.execution_mode.live P_PRODUCER.enum.execution_mode.off
P_PRODUCER.enum.execution_mode.paper P_PRODUCER.enum.operating_state.invalid P_PRODUCER.enum.operating_state.normal P_PRODUCER.enum.operating_state.quarantined
P_PRODUCER.enum.operating_state.reduced P_PRODUCER.enum.operating_state.retired P_PRODUCER.enum.operating_state.unknown P_PRODUCER.enum.operating_state.watch
P_PRODUCER.enum.platform_id.binance P_PRODUCER.enum.platform_id.firstrade P_PRODUCER.enum.platform_id.ibkr P_PRODUCER.enum.platform_id.invalid
P_PRODUCER.enum.platform_id.longbridge P_PRODUCER.enum.platform_id.qmt P_PRODUCER.enum.platform_id.schwab P_PRODUCER.order.binding.alpha_beta
P_PRODUCER.order.binding.beta_alpha P_PRODUCER.order.profile.alpha_beta P_PRODUCER.order.profile.beta_alpha P_PRODUCER.pipeline.closed_exact_keys
P_PRODUCER.pipeline.forbidden_field_scan P_PRODUCER.pipeline.local_handoff_fixture P_PRODUCER.pipeline.reject_no_artifact_each
P_PRODUCER.pipeline.validator_schema_each_accepted P_PRODUCER.readback.later_1ms P_PRODUCER.readback.minus_7d P_PRODUCER.readback.older_1ms P_PRODUCER.readback.plus_5m
P_PRODUCER.revision.readback_revision.lower_exact P_PRODUCER.revision.readback_revision.nonhex P_PRODUCER.revision.readback_revision.uppercase
P_PRODUCER.revision.readback_revision.wrong_length P_PRODUCER.revision.source_revision.lower_exact P_PRODUCER.revision.source_revision.nonhex
P_PRODUCER.revision.source_revision.uppercase P_PRODUCER.revision.source_revision.wrong_length P_PRODUCER.revision.strategy_revision.lower_exact
P_PRODUCER.revision.strategy_revision.nonhex P_PRODUCER.revision.strategy_revision.uppercase P_PRODUCER.revision.strategy_revision.wrong_length
P_PRODUCER.runtime_enabled.false P_PRODUCER.runtime_enabled.true P_PRODUCER.runtime_enabled.type_invalid P_PRODUCER.shape.binding_item_nonobject
P_PRODUCER.shape.bindings_missing P_PRODUCER.shape.bindings_nonobject P_PRODUCER.shape.bindings_null P_PRODUCER.source.assignment.api_key
P_PRODUCER.source.assignment.cookie P_PRODUCER.source.assignment.password P_PRODUCER.source.assignment.private_key P_PRODUCER.source.assignment.secret
P_PRODUCER.source.assignment.token P_PRODUCER.source.bearer P_PRODUCER.source.blank P_PRODUCER.source.canary.gho P_PRODUCER.source.canary.ghp
P_PRODUCER.source.canary.ghr P_PRODUCER.source.canary.ghs P_PRODUCER.source.canary.ghu P_PRODUCER.source.canary.jwt P_PRODUCER.source.canary.sk P_PRODUCER.source.local
P_PRODUCER.source.markup P_PRODUCER.source.overlength P_PRODUCER.source.posix_home P_PRODUCER.source.posix_users P_PRODUCER.source.root P_PRODUCER.source.safe_url
P_PRODUCER.source.trim P_PRODUCER.source.windows
""".split())
def _qrs_baseline() -> dict:
    revision, digest, now = "b" * 40, "a" * 64, "2026-08-01T00:00:00Z"
    return {"deployment_bindings": [{
        "strategy_profile": "alpha", "domain": "us_equity", "catalog_stage": "runtime_enabled",
        "runtime_enabled": True, "bindings": [{
            "binding_id": "alpha-live", "platform_id": "ibkr", "strategy_revision": revision,
            "execution_mode": "live", "enabled": True, "deployment_scope": "production",
            "config_digest": digest, "readback_revision": revision, "readback_at": now,
            "readback_source": "local-qrs-readback", "operating_state": "normal",
        }],
    }]}
def _qrs_schema_errors(payload: dict) -> list[str]:
    from jsonschema import Draft202012Validator
    path = ROOT / "schemas" / "strategy-deployment-bindings.v1.schema.json"; schema = json.loads(path.read_text(encoding="utf-8"))
    if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
        return ["deployment Schema must declare Draft 2020-12"]
    Draft202012Validator.check_schema(schema)
    return [error.message for error in Draft202012Validator(schema).iter_errors(payload)]

class RuntimeSettingsTest(unittest.TestCase):
    qrs_case_records: list[dict] = []
    def _run_qrs_case(self, case_id: str, config: dict, disposition: str, mutation: str, exact_expected: str, *,
                      generated_at: str = "2026-08-01T00:00:00Z", source_revision: str = "b" * 40,
                      config_digest: str = "a" * 64, no_echo: str | None = None, reference_now: str = "2026-08-01T00:00:00Z") -> dict | None:
        record = {
            "case_id": case_id, "group": case_id.split(".", 1)[0],
            "test_path": "python/tests/test_runtime_settings.py",
            "production_entrypoint": "build_strategy_deployment_bindings -> validate_deployment_bindings_payload",
            "input_mutation": mutation, "exact_expected": exact_expected, "disposition": disposition,
            "assertion_result": "FAIL", "schema_target": "strategy-deployment-bindings.v1.schema.json",
            "schema_result": "NOT_APPLICABLE" if disposition == "reject" or case_id.endswith("reject_no_artifact_each") else "MISSING",
        }
        artifact = None
        try:
            try:
                artifact = build_config.build_strategy_deployment_bindings(
                    config, generated_at=generated_at, source_revision=source_revision, config_digest=config_digest, now=reference_now)
                errors = runtime_settings.validate_deployment_bindings_payload(artifact, now="2026-08-01T00:00:00Z")
            except ValueError as exc:
                if disposition != "reject" and not case_id.endswith("reject_no_artifact_each"):
                    raise
                errors = [str(exc)]
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "bindings.json"
                if disposition == "reject" or case_id.endswith("reject_no_artifact_each"):
                    self.assertTrue(errors, exact_expected)
                    with self.assertRaises(ValueError, msg=exact_expected):
                        build_config.write_strategy_deployment_bindings(
                            output, config, generated_at=generated_at, source_revision=source_revision, config_digest=config_digest, now=reference_now)
                    self.assertFalse(output.exists(), exact_expected)
                    if no_echo:
                        self.assertNotIn(no_echo, " ".join(errors), exact_expected)
                else:
                    self.assertEqual(errors, [], exact_expected)
                    schema_errors = _qrs_schema_errors(artifact)
                    self.assertEqual(schema_errors, [], exact_expected)
                    record["schema_result"] = "PASS"
                    build_config.write_strategy_deployment_bindings(
                        output, config, generated_at=generated_at, source_revision=source_revision, config_digest=config_digest, now=reference_now)
                    self.assertEqual(json.loads(output.read_text(encoding="utf-8")), artifact, exact_expected)
            record["assertion_result"] = "PASS"
        except Exception as exc:
            record["failure"] = f"{type(exc).__name__}: {exc}"
            self.fail(f"{case_id}: {record['failure']}")
        finally:
            type(self).qrs_case_records.append(record)
            print("QRS_CASE " + json.dumps(record, ensure_ascii=True, sort_keys=True))
        return artifact
    @classmethod
    def tearDownClass(cls):
        ids = [record["case_id"] for record in cls.qrs_case_records]
        if not ids: return
        actual = set(ids)
        summary = {
            "expected": len(QRS_EXPECTED_CASE_IDS), "executed": len(ids), "executed_unique": len(actual),
            "missing": sorted(QRS_EXPECTED_CASE_IDS - actual), "duplicate": sorted({x for x in ids if ids.count(x) > 1}),
            "unexpected": sorted(actual - QRS_EXPECTED_CASE_IDS),
            "failed": sum(record["assertion_result"] != "PASS" for record in cls.qrs_case_records),
        }
        print("QRS_CASE_SUMMARY " + json.dumps(summary, sort_keys=True))
        if summary["expected"] != 105 or summary["executed"] != 105 or any(summary[key] for key in ("missing", "duplicate", "unexpected")):
            raise AssertionError(summary)
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
        self.assertEqual(queue[0]["recommended_action"], "review_evidence_package")
        self.assertEqual(queue[0]["label"], "候选")
        self.assertTrue(queue[0]["approval_required"])
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

        lanes = {item["profile"]: item["automation_lane"] for item in registry["profiles"]}
        self.assertEqual(registry["schema_version"], "strategy_automation_registry.v1")
        self.assertEqual(lanes["live"], "live_equivalent_optimization")
        self.assertEqual(lanes["candidate"], "promotion_review")
        self.assertEqual(lanes["research"], "research_backlog")
        self.assertTrue(next(item for item in registry["profiles"] if item["profile"] == "live")["position_control_sensitive"])

    def test_automation_registry_cli_outputs_json(self):
        with (
            patch.object(sys, "argv", ["build_config.py", "--automation-registry"]),
            patch.object(build_config, "load_config", return_value={"strategies": {}}),
            patch("builtins.print") as printed,
        ):
            self.assertEqual(build_config.main(), 0)

        printed.assert_called_once()
        self.assertEqual(json.loads(printed.call_args.args[0])["schema_version"], "strategy_automation_registry.v1")

    def test_platform_health_report_summarizes_current_config(self):
        config = json.loads((ROOT / "platform-config.json").read_text(encoding="utf-8"))
        catalog = json.loads(
            (ROOT / "web" / "strategy-switch-console" / "strategy-profiles.example.json").read_text(encoding="utf-8")
        )

        report = build_config.build_platform_health_report(config, catalog)

        self.assertIn(report["status"], {"healthy", "attention_required"})
        self.assertEqual(report["schema_version"], "platform_health_report.v1")
        self.assertGreaterEqual(report["summary"]["runtime_enabled_switchable_count"], 1)
        self.assertIn("codex_repair_context", report)
        self.assertIn("automation_registry", report)
        self.assertIn("automation_lane_counts", report["summary"])
        self.assertIn("python3 python/scripts/build_config.py --check", report["codex_repair_context"]["suggested_commands"])

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

        self.assertEqual(profile["lifecycle_stage"], "runtime_enabled")
        self.assertTrue(profile["can_switch_live"])
        self.assertEqual(profile["allowed_execution_modes"], ["live", "paper", "dry_run"])
        self.assertEqual(profile["blocked_live_reason"], "")

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
        self.assertEqual(target["runtime_target"]["market"], "US")
        self.assertEqual(target["runtime_target"]["market_calendar"], "NYSE")
        self.assertEqual(target["runtime_target"]["market_timezone"], "America/New_York")
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
        self.assertEqual(runtime_settings.validate_target(target), [])

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
                "main_time": "45 15 25-29 * *",
                "probe_time": "35 9,15 25-29 * *",
                "precheck_time": "45 9 25-29 * *",
            },
        )

    def test_build_switch_target_uses_daily_scheduler_when_ibit_smart_dca_is_smart(self):
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

        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_ENABLED"], "true")
        self.assertEqual(assignments["IBIT_ZSCORE_EXIT_MODE"], "live")
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
        self.assertEqual(
            selected["IBKR_STRATEGY_PLUGIN_MOUNTS_JSON"]["strategy_plugins"][0]["plugin"],
            "market_regime_control",
        )
        self.assertEqual(
            selected["IBKR_STRATEGY_PLUGIN_MOUNTS_JSON"]["strategy_plugins"][0]["signal_path"],
            "gs://qsl-runtime-logs-shared/strategy-artifacts/us_equity/"
            "soxl_soxx_trend_income/plugins/market_regime_control/latest_signal.json",
        )

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

    def test_qrs_producer_baseline_closed_cross_digest_and_order(self):
        config = _qrs_baseline()
        with self.subTest(case_id="P_PRODUCER.canonical_baseline"):
            artifact = self._run_qrs_case("P_PRODUCER.canonical_baseline", config, "accept", "canonical baseline", "exact closed canonical artifact")
            self.assertEqual(set(artifact), {"schema_version", "generated_at", "source_revision", "config_digest", "profiles"})
        for case_id, level, key in (
            ("P_PRODUCER.closed.top_extra_account", "top", "account"),
            ("P_PRODUCER.closed.profile_extra_account", "profile", "account"),
            ("P_PRODUCER.closed.binding_extra_private", "binding", "private"),
        ):
            with self.subTest(case_id=case_id):
                config = _qrs_baseline()
                target = config if level == "top" else config["deployment_bindings"][0]
                target = target if level != "binding" else target["bindings"][0]
                target[key] = "synthetic-canary"
                artifact = self._run_qrs_case(case_id, config, "accept", f"{level} extra {key}", "extra omitted from closed output")
                self.assertNotIn("synthetic-canary", json.dumps(artifact, sort_keys=True))
        for case_id, enabled, mode in (
            ("P_PRODUCER.cross.enabled_false_mode_live", False, "live"),
            ("P_PRODUCER.cross.enabled_true_mode_off", True, "off"),
        ):
            with self.subTest(case_id=case_id):
                config = _qrs_baseline(); binding = config["deployment_bindings"][0]["bindings"][0]
                binding.update(enabled=enabled, execution_mode=mode)
                self._run_qrs_case(case_id, config, "reject", f"enabled={enabled}, mode={mode}", "mode/enabled conflict; no artifact")
        with self.subTest(case_id="P_PRODUCER.determinism.repeat_same_input"):
            first = self._run_qrs_case("P_PRODUCER.determinism.repeat_same_input", _qrs_baseline(), "accept", "same input twice", "deep and byte equality")
            second = build_config.build_strategy_deployment_bindings(
                _qrs_baseline(), generated_at="2026-08-01T00:00:00Z", source_revision="b" * 40, config_digest="a" * 64, now="2026-08-01T00:00:00Z")
            self.assertEqual(first, second); self.assertEqual(json.dumps(first, sort_keys=True), json.dumps(second, sort_keys=True))
        digest_cases = (("lower_exact", "a" * 64, "accept"), ("uppercase", "A" * 64, "reject"),
                        ("wrong_length", "a" * 63, "reject"), ("nonhex", "a" * 63 + "g", "reject"))
        for suffix, value, disposition in digest_cases:
            case_id = f"P_PRODUCER.digest.config_digest.{suffix}"
            with self.subTest(case_id=case_id):
                artifact = self._run_qrs_case(case_id, _qrs_baseline(), disposition, f"config_digest={suffix}",
                                              "preserve lowercase digest" if disposition == "accept" else "reject; no artifact", config_digest=value)
                if disposition == "accept": self.assertEqual(artifact["config_digest"], value)
        with self.subTest(case_id="P_PRODUCER.digest.artifact_config.generated_lower_exact"):
            config = _qrs_baseline(); digest = __import__("hashlib").sha256(json.dumps(config, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            artifact = self._run_qrs_case("P_PRODUCER.digest.artifact_config.generated_lower_exact", config, "accept",
                                          "producer-generated digest", "exact deterministic lowercase 64-hex", config_digest=digest)
            self.assertRegex(artifact["config_digest"], r"^[a-f0-9]{64}$")
        for kind in ("profile", "binding"):
            case_id = f"P_PRODUCER.duplicate.{kind}_case"
            with self.subTest(case_id=case_id):
                config = _qrs_baseline()
                if kind == "profile":
                    other = json.loads(json.dumps(config["deployment_bindings"][0])); other["strategy_profile"] = "ALPHA"
                    other["bindings"][0]["binding_id"] = "other"; config["deployment_bindings"].append(other)
                else:
                    other = dict(config["deployment_bindings"][0]["bindings"][0]); other["binding_id"] = "ALPHA-LIVE"
                    config["deployment_bindings"][0]["bindings"].append(other)
                self._run_qrs_case(case_id, config, "reject", f"duplicate {kind} ID after case normalization", "reject; no artifact")
        for kind in ("profile", "binding"):
            for order in (("alpha", "beta"), ("beta", "alpha")):
                case_id = f"P_PRODUCER.order.{kind}.{order[0]}_{order[1]}"
                with self.subTest(case_id=case_id):
                    config = _qrs_baseline(); profile = config["deployment_bindings"][0]
                    if kind == "profile":
                        other = json.loads(json.dumps(profile)); other["strategy_profile"] = "beta"; other["bindings"][0]["binding_id"] = "beta-live"
                        config["deployment_bindings"] = [profile, other] if order[0] == "alpha" else [other, profile]
                    else:
                        other = dict(profile["bindings"][0]); other["binding_id"] = "beta-live"
                        profile["bindings"] = [profile["bindings"][0], other] if order[0] == "alpha" else [other, profile["bindings"][0]]
                    artifact = self._run_qrs_case(case_id, config, "accept", f"{kind} input order {order}", "case-normalized ascending order")
                    items = artifact["profiles"] if kind == "profile" else artifact["profiles"][0]["bindings"]
                    field = "strategy_profile" if kind == "profile" else "binding_id"
                    self.assertEqual([item[field].split("-")[0] for item in items], ["alpha", "beta"])
    def test_qrs_producer_enum_runtime_shape_time_revision_vectors(self):
        enum_dimensions = (
            ("catalog_stage", ("research_backtest_only", "shadow_candidate", "live_candidate", "runtime_enabled")),
            ("deployment_scope", ("disabled", "research", "paper", "production")),
            ("domain", ("us_equity", "hk_equity", "cn_equity", "crypto")),
            ("execution_mode", ("off", "dry_run", "paper", "live")),
            ("operating_state", ("normal", "watch", "reduced", "quarantined", "retired", "unknown")),
            ("platform_id", ("longbridge", "ibkr", "schwab", "firstrade", "qmt", "binance")),
        )
        profile_fields = {"catalog_stage", "domain"}
        for field, values in enum_dimensions:
            for value in (*values, "invalid"):
                case_id = f"P_PRODUCER.enum.{field}.{value}"
                with self.subTest(case_id=case_id):
                    config = _qrs_baseline(); profile = config["deployment_bindings"][0]; binding = profile["bindings"][0]
                    (profile if field in profile_fields else binding)[field] = value
                    if field == "execution_mode" and value == "off": binding["enabled"] = False
                    disposition = "reject" if value == "invalid" else "accept"
                    artifact = self._run_qrs_case(case_id, config, disposition, f"{field}={value}",
                                                  f"canonical {field} equals {value}" if disposition == "accept" else "reject invalid enum; no artifact")
                    if disposition == "accept":
                        actual = artifact["profiles"][0] if field in profile_fields else artifact["profiles"][0]["bindings"][0]
                        self.assertEqual(actual[field], value)
        for value, suffix, disposition in ((False, "false", "accept"), (True, "true", "accept"), ("true", "type_invalid", "reject")):
            case_id = f"P_PRODUCER.runtime_enabled.{suffix}"
            with self.subTest(case_id=case_id):
                config = _qrs_baseline(); config["deployment_bindings"][0]["runtime_enabled"] = value
                artifact = self._run_qrs_case(case_id, config, disposition, f"runtime_enabled={value!r}",
                                              "exact boolean" if disposition == "accept" else "reject non-boolean; no artifact")
                if disposition == "accept": self.assertIs(artifact["profiles"][0]["runtime_enabled"], value)
        shape_cases = (
            ("bindings_missing", "missing"), ("bindings_null", None), ("bindings_nonobject", "invalid"),
            ("binding_item_nonobject", ["invalid"]),
        )
        for suffix, value in shape_cases:
            case_id = f"P_PRODUCER.shape.{suffix}"
            with self.subTest(case_id=case_id):
                config = _qrs_baseline(); profile = config["deployment_bindings"][0]
                if value == "missing": profile.pop("bindings")
                else: profile["bindings"] = value
                self._run_qrs_case(case_id, config, "reject", f"bindings={value!r}", "reject malformed shape; no artifact")
        times = (("minus_7d", "2026-07-25T00:00:00Z", "accept"), ("older_1ms", "2026-07-24T23:59:59.999Z", "reject"),
                 ("plus_5m", "2026-08-01T00:05:00Z", "accept"), ("later_1ms", "2026-08-01T00:05:00.001Z", "reject"))
        for suffix, value, disposition in times:
            case_id = f"P_PRODUCER.readback.{suffix}"
            with self.subTest(case_id=case_id):
                config = _qrs_baseline(); config["deployment_bindings"][0]["bindings"][0]["readback_at"] = value
                artifact = self._run_qrs_case(case_id, config, disposition, f"readback_at={value}",
                                              "inclusive boundary" if disposition == "accept" else "reject outside time window; no artifact")
                if disposition == "accept": self.assertEqual(artifact["profiles"][0]["bindings"][0]["readback_at"], value)
                canonical = build_config.build_strategy_deployment_bindings(
                    _qrs_baseline(), generated_at="2026-08-01T00:00:00Z", source_revision="b" * 40, config_digest="a" * 64, now="2026-08-01T00:00:00Z")
                if suffix == "minus_7d": self.assertEqual(runtime_settings.validate_deployment_bindings_payload(canonical, now="2026-08-01T00:00:00Z"), [])
                if suffix == "plus_5m": canonical["generated_at"] = value; self.assertEqual(runtime_settings.validate_deployment_bindings_payload(canonical, now="2026-08-01T00:00:00Z"), [])
                if suffix == "later_1ms":
                    canonical["generated_at"] = value; self.assertTrue(runtime_settings.validate_deployment_bindings_payload(canonical, now="2026-08-01T00:00:00Z"))
                    with tempfile.TemporaryDirectory() as directory: self.assertRaises(ValueError, build_config.write_strategy_deployment_bindings,
                        Path(directory) / "future.json", _qrs_baseline(), generated_at="2099-01-01T00:00:00Z", source_revision="b" * 40, config_digest="a" * 64, now="2026-08-01T00:00:00Z")
                if suffix == "older_1ms":
                    invalid = ("2026-08-01 00:00:00Z", "2026-02-30T00:00:00Z", "2026-08-01T24:00:00Z", "2026-08-01T00:60:00Z", "2026-08-01T00:00:00+24:00", "٢٠٢٦-08-01T00:00:00Z")
                    for timestamp in invalid:
                        canonical["generated_at"] = timestamp; self.assertTrue(runtime_settings.validate_deployment_bindings_payload(canonical, now="2026-08-01T00:00:00Z"))
                    self.assertTrue(_qrs_schema_errors(canonical)); canonical["generated_at"] = "2026-08-01 00:00:00Z"; self.assertTrue(_qrs_schema_errors(canonical))
        for field in ("source_revision", "strategy_revision", "readback_revision"):
            for suffix, value, disposition in (("lower_exact", "b" * 40, "accept"), ("uppercase", "B" * 40, "reject"),
                                               ("wrong_length", "b" * 39, "reject"), ("nonhex", "b" * 39 + "g", "reject")):
                case_id = f"P_PRODUCER.revision.{field}.{suffix}"
                with self.subTest(case_id=case_id):
                    config = _qrs_baseline(); kwargs = {}
                    if field == "source_revision": kwargs["source_revision"] = value
                    else: config["deployment_bindings"][0]["bindings"][0][field] = value
                    artifact = self._run_qrs_case(case_id, config, disposition, f"{field}={suffix}",
                                                  "preserve exact lowercase revision" if disposition == "accept" else "reject invalid revision; no artifact", **kwargs)
                    if disposition == "accept":
                        actual = artifact[field] if field == "source_revision" else artifact["profiles"][0]["bindings"][0][field]; self.assertEqual(actual, value)
    def test_qrs_readback_freshness_uses_reference_now(self):
        artifact = build_config.build_strategy_deployment_bindings(_qrs_baseline(), generated_at="2026-08-01T00:00:00Z", source_revision="b" * 40, config_digest="a" * 64)
        artifact["generated_at"] = artifact["profiles"][0]["bindings"][0]["readback_at"] = "2020-08-01T00:00:00Z"
        errors = runtime_settings.validate_deployment_bindings_payload(artifact, now="2026-08-01T00:00:00Z")
        self.assertNotIn("generated_at is outside the allowed window", errors)
        self.assertIn("binding readback_at is outside the allowed window", errors)
    def test_qrs_producer_source_and_pipeline_vectors(self):
        source_cases = (
            ("assignment.api_key", "api_key=synthetic-value", "reject", None),
            ("assignment.cookie", "cookie=synthetic-value", "reject", None),
            ("assignment.password", "password=synthetic-value", "reject", None),
            ("assignment.private_key", "private_key=synthetic-value", "reject", None),
            ("assignment.secret", "secret=synthetic-value", "reject", None),
            ("assignment.token", "token=synthetic-value", "reject", None),
            ("bearer", "Bearer synthetic-credential", "reject", None), ("blank", "   ", "reject", None),
            ("canary.gho", "gho_" + "A" * 36, "reject", None), ("canary.ghp", "ghp_" + "A" * 36, "reject", None),
            ("canary.ghr", "ghr_" + "A" * 36, "reject", None), ("canary.ghs", "ghs_" + "A" * 36, "reject", None),
            ("canary.ghu", "ghu_" + "A" * 36, "reject", None),
            ("canary.jwt", "eyJhbGciOiJIUzI1NiJ9.synthetic.signature", "reject", None),
            ("canary.sk", "sk-test-" + "A" * 32, "reject", None),
            ("local", "local-qrs-readback", "accept", "local-qrs-readback"), ("markup", "<unsafe>", "reject", None),
            ("overlength", "x" * 121, "reject", None), ("posix_home", "/home/demo/private", "reject", None),
            ("posix_users", "/Users/demo/private", "reject", None), ("root", "/", "reject", None),
            ("safe_url", "https://control.example.invalid/readback", "accept", "https://control.example.invalid/readback"),
            ("trim", "  surrounding safe text  ", "accept", "surrounding safe text"),
            ("windows", r"C:\private\file", "reject", None),
        )
        for suffix, value, disposition, expected in source_cases:
            case_id = f"P_PRODUCER.source.{suffix}"
            with self.subTest(case_id=case_id):
                config = _qrs_baseline(); config["deployment_bindings"][0]["bindings"][0]["readback_source"] = value
                artifact = self._run_qrs_case(case_id, config, disposition, f"readback_source={suffix}",
                                              "trim and preserve safe canonical text" if disposition == "accept" else "reject, no write and no echo",
                                              no_echo=value if disposition == "reject" else None)
                if disposition == "accept": self.assertEqual(artifact["profiles"][0]["bindings"][0]["readback_source"], expected)
        proof_cases = (
            ("C_FIXED_POINT.producer_schema_each_accepted", "every accepted artifact validator and Schema PASS"),
            ("P_PRODUCER.pipeline.closed_exact_keys", "exact top/profile/binding key sets"),
            ("P_PRODUCER.pipeline.forbidden_field_scan", "forbidden fields and canary absent"),
            ("P_PRODUCER.pipeline.local_handoff_fixture", "local handoff write equals canonical artifact"),
            ("P_PRODUCER.pipeline.validator_schema_each_accepted", "validator and Draft 2020-12 Schema PASS"),
        )
        for case_id, expected in proof_cases:
            with self.subTest(case_id=case_id):
                config = _qrs_baseline(); config["account"] = "synthetic-account-canary"
                artifact = self._run_qrs_case(case_id, config, "proof", "canonical baseline plus forbidden top extra", expected)
                binding = artifact["profiles"][0]["bindings"][0]
                self.assertEqual(set(artifact["profiles"][0]), {"strategy_profile", "domain", "catalog_stage", "runtime_enabled", "bindings"})
                self.assertEqual(set(binding), {"binding_id", "platform_id", "strategy_revision", "execution_mode", "enabled", "deployment_scope",
                                                "config_digest", "readback_revision", "readback_at", "readback_source", "operating_state"})
                self.assertNotIn("synthetic-account-canary", json.dumps(artifact, sort_keys=True))
        case_id = "P_PRODUCER.pipeline.reject_no_artifact_each"
        with self.subTest(case_id=case_id):
            config = _qrs_baseline(); config["deployment_bindings"][0]["domain"] = "invalid"
            self._run_qrs_case(case_id, config, "proof", "invalid domain representative rejected producer", "no target artifact created")

if __name__ == "__main__":
    unittest.main()
