"""Stop-only changes must preserve the current configuration, not activate it."""

from __future__ import annotations

import copy
import contextlib
import io
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import runtime_settings


class RuntimeStopTests(unittest.TestCase):
    def setUp(self):
        self.identity = {
            "platform_id": "ibkr",
            "deployment_selector": "synthetic-one",
            "account_selector": ["synthetic-account"],
            "account_scope": "synthetic-group",
            "service_name": "synthetic-service",
        }
        self.request = {
            "target_id": "ibkr/synthetic-one",
            "github": {
                "repository": "QuantStrategyLab/InteractiveBrokersPlatform",
                "variable_scope": "repository",
            },
            "runtime_target": copy.deepcopy(self.identity),
        }
        self.current = {
            **self.identity,
            "strategy_profile": "retired-synthetic-profile",
            "execution_mode": "live",
            "dry_run_only": False,
            "overrides": {"risk_limit": 0.01},
            "live_continuity": {"state": "RECONCILE_ONLY"},
        }

    def build(self, variables):
        # No catalog admission or new activation may be needed to stop.
        with patch.object(runtime_settings, "load_platform_config", side_effect=AssertionError("catalog used")):
            return runtime_settings.build_stop_assignments(self.request, variables)

    def test_single_target_changes_only_enable_variable(self):
        variables = {"RUNTIME_TARGET_JSON": json.dumps(self.current), "STRATEGY_PROFILE": "unchanged"}
        before = copy.deepcopy(variables)
        result = self.build(variables)
        self.assertEqual([(item.name, item.value) for item in result], [("RUNTIME_TARGET_ENABLED", "false")])
        self.assertEqual(result[0].repository, self.request["github"]["repository"])
        self.assertEqual(variables, before)

    def test_inventory_preserves_other_entries_defaults_and_current_policy(self):
        entry = {"service": self.identity["service_name"], "runtime_target": self.current,
                 "RUNTIME_TARGET_ENABLED": "true", "IBKR_STRATEGY_PLUGIN_MOUNTS_JSON": {"keep": True}}
        other = {"service": "synthetic-other", "runtime_target": {"service_name": "synthetic-other"},
                 "RUNTIME_TARGET_ENABLED": "true"}
        for use_list in (True, False):
            with self.subTest(use_list=use_list):
                inventory = [entry, other] if use_list else {"targets": [entry, other], "defaults": {"keep": 42}}
                variables = {"CLOUD_RUN_SERVICE_TARGETS_JSON": json.dumps(inventory)}
                before = copy.deepcopy(variables)
                result = self.build(variables)
                expected = copy.deepcopy(inventory)
                entries = expected if use_list else expected["targets"]
                entries[0]["RUNTIME_TARGET_ENABLED"] = "false"
                self.assertEqual(len(result), 1)
                self.assertEqual(result[0].name, "CLOUD_RUN_SERVICE_TARGETS_JSON")
                self.assertEqual(json.loads(result[0].value), expected)
                self.assertEqual(variables, before)

    def test_missing_corrupt_ambiguous_or_mismatched_current_source_is_rejected(self):
        valid = {"service": self.identity["service_name"], "runtime_target": self.current}
        invalid_sources = [{}, {"RUNTIME_TARGET_JSON": "{"}, {"RUNTIME_TARGET_JSON": "null"},
                           {"CLOUD_RUN_SERVICE_TARGETS_JSON": ""},
                           {"CLOUD_RUN_SERVICE_TARGETS_JSON": "{}"},
                           {"CLOUD_RUN_SERVICE_TARGETS_JSON": json.dumps([valid, valid])},
                           {"CLOUD_RUN_SERVICE_TARGETS_JSON": json.dumps([None, valid])},
                           {"CLOUD_RUN_SERVICE_TARGETS_JSON": json.dumps([{
                               **valid, "ACCOUNT_GROUP": "synthetic-wrong-group"}])}]
        for key in self.identity:
            changed = {**self.current, key: ["wrong"] if key == "account_selector" else "wrong"}
            invalid_sources.append({"RUNTIME_TARGET_JSON": json.dumps(changed)})
        for source in invalid_sources:
            with self.subTest(source_index=invalid_sources.index(source)), self.assertRaises(ValueError):
                self.build(source)

    def test_other_controls_cannot_be_smuggled_into_stop_request(self):
        for field in ("strategy_profile", "execution_mode", "dry_run_only", "overrides", "enabled"):
            with self.subTest(field=field):
                self.request["runtime_target"][field] = "changed"
                with self.assertRaises(ValueError):
                    self.build({"RUNTIME_TARGET_JSON": json.dumps(self.current)})
                self.request["runtime_target"].pop(field)
        self.request["extra_variables"] = {"RUNTIME_TARGET_ENABLED": True}
        with self.assertRaises(ValueError):
            self.build({"RUNTIME_TARGET_JSON": json.dumps(self.current)})

    def test_wrong_repository_or_target_platform_cannot_redirect_write(self):
        for field, value in (("repository", "other/repository"), ("variable_scope", "default")):
            before = copy.deepcopy(self.request)
            self.request["github"][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.build({"RUNTIME_TARGET_JSON": json.dumps(self.current)})
            self.request = before
        self.request["target_id"] = "longbridge/synthetic-one"
        with self.assertRaises(ValueError):
            self.build({"RUNTIME_TARGET_JSON": json.dumps(self.current)})

    def test_environment_scope_is_preserved_and_no_new_settings_created(self):
        self.request["github"].update(variable_scope="environment", environment="synthetic-env")
        variables = {"RUNTIME_TARGET_JSON": json.dumps(self.current), "RUNTIME_TARGET_ENABLED": "false"}
        result = self.build(variables)
        self.assertEqual(result[0].variable_scope, "environment")
        self.assertEqual(result[0].environment, "synthetic-env")
        self.assertEqual(result[0].value, "false")

    def test_single_target_rejects_shared_service_scope(self):
        variables = {"RUNTIME_TARGET_JSON": json.dumps(self.current),
                     "CLOUD_RUN_SERVICES": "synthetic-service,synthetic-other"}
        with self.assertRaises(ValueError):
            self.build(variables)

    def test_inventory_rejects_conflicting_effective_environment_target(self):
        inventory = [{"service": self.identity["service_name"], "runtime_target": self.current}]
        variables = {"CLOUD_RUN_SERVICE_TARGETS_JSON": json.dumps(inventory),
                     "CLOUD_RUN_SERVICE": self.identity["service_name"],
                     "RUNTIME_TARGET_JSON": json.dumps({**self.current, "account_selector": ["other-account"]})}
        with self.assertRaises(ValueError):
            self.build(variables)

    def test_inventory_checks_consumer_normalized_service_before_account_binding(self):
        inventory = [{"service": self.identity["service_name"], "runtime_target": self.current}]
        variables = {"CLOUD_RUN_SERVICE_TARGETS_JSON": json.dumps(inventory),
                     "CLOUD_RUN_SERVICE": f" {self.identity['service_name']} ",
                     "RUNTIME_TARGET_JSON": json.dumps({**self.current, "account_selector": ["other-account"]})}
        with self.assertRaises(ValueError):
            self.build(variables)

    def test_longbridge_stop_updates_effective_environment_enable_override(self):
        self.request["github"].update(repository="QuantStrategyLab/LongBridgePlatform",
                                      variable_scope="environment", environment="synthetic-env")
        self.request["target_id"] = "longbridge/synthetic-one"
        self.request["runtime_target"]["platform_id"] = "longbridge"
        self.current["platform_id"] = "longbridge"
        inventory = [{"service": self.identity["service_name"], "runtime_target": self.current,
                      "RUNTIME_TARGET_ENABLED": "true"}]
        repo = {"CLOUD_RUN_SERVICE_TARGETS_JSON": json.dumps(inventory)}
        env = {"CLOUD_RUN_SERVICE": self.identity["service_name"], "RUNTIME_TARGET_JSON": json.dumps(self.current),
               "RUNTIME_TARGET_ENABLED": "true"}
        after = {**env, "RUNTIME_TARGET_ENABLED": "false"}
        with patch.object(runtime_settings, "read_stop_variables", side_effect=[repo, env, repo, env, repo, after]), \
                patch.object(runtime_settings.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            result = runtime_settings.execute_stop(self.request, apply=True)
        self.assertTrue(result["configured"])
        self.assertEqual(run.call_args.args[0][:4], ["gh", "variable", "set", "RUNTIME_TARGET_ENABLED"])
        self.assertIn("--env", run.call_args.args[0])
        self.assertEqual(run.call_args.kwargs["input"], "false")

    def test_stop_does_not_change_generic_activation_validation(self):
        target = {**self.request, "runtime_target": {**self.current, "runtime_target_enabled": False}}
        target["runtime_target"].pop("live_continuity")
        config = {"strategies": {self.current["strategy_profile"]: {"runtime_enabled": False}},
                  "platforms": {}, "domains": {}}
        with patch.object(runtime_settings, "load_platform_config", return_value=config):
            errors = runtime_settings.validate_target(target)
        self.assertTrue(any("not runtime_enabled" in message for message in errors))

    def test_execute_preview_reads_authoritative_scope_but_never_writes(self):
        variables = {"RUNTIME_TARGET_JSON": json.dumps(self.current)}
        with patch.object(runtime_settings, "read_stop_variables", return_value=variables) as read, \
                patch.object(runtime_settings.subprocess, "run") as run:
            result = runtime_settings.execute_stop(self.request, apply=False)
        read.assert_called_once_with(self.request["github"])
        run.assert_not_called()
        self.assertEqual(result, {"configured": False, "platform_applied": False, "preview": True})

    def test_execute_writes_once_using_stdin_then_checks_exact_readback(self):
        before = {"RUNTIME_TARGET_JSON": json.dumps(self.current), "KEEP": "synthetic-unrelated"}
        after = {**before, "RUNTIME_TARGET_ENABLED": "false"}
        with patch.object(runtime_settings, "read_stop_variables", side_effect=[before, before, after]), \
                patch.object(runtime_settings.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            result = runtime_settings.execute_stop(self.request, apply=True)
        self.assertTrue(result["configured"])
        self.assertFalse(result["platform_applied"])
        run.assert_called_once()
        command = run.call_args.args[0]
        self.assertEqual(command[:4], ["gh", "variable", "set", "RUNTIME_TARGET_ENABLED"])
        self.assertNotIn("--body", command)
        self.assertEqual(run.call_args.kwargs["input"], "false")
        self.assertTrue(run.call_args.kwargs["capture_output"])

    def test_changed_source_is_not_overwritten(self):
        before = {"RUNTIME_TARGET_JSON": json.dumps(self.current)}
        with patch.object(runtime_settings, "read_stop_variables", side_effect=[before, {**before, "KEEP": "changed"}]), \
                patch.object(runtime_settings.subprocess, "run") as run, self.assertRaisesRegex(ValueError, "changed"):
            runtime_settings.execute_stop(self.request, apply=True)
        run.assert_not_called()

    def test_write_failure_has_no_retry_and_does_not_expose_provider_output(self):
        before = {"RUNTIME_TARGET_JSON": json.dumps(self.current)}
        failures = [subprocess.TimeoutExpired(["synthetic-sensitive-command"], 30),
                    subprocess.CompletedProcess([], 1, "synthetic-sensitive-output", "synthetic-sensitive-error")]
        for failure in failures:
            with self.subTest(failure_type=type(failure).__name__), \
                    patch.object(runtime_settings, "read_stop_variables", return_value=before) as read, \
                    patch.object(runtime_settings.subprocess, "run") as run:
                if isinstance(failure, Exception):
                    run.side_effect = failure
                else:
                    run.return_value = failure
                with self.assertRaisesRegex(ValueError, "^stop_write_outcome_unverified$"):
                    runtime_settings.execute_stop(self.request, apply=True)
                self.assertEqual(run.call_count, 1)
                self.assertEqual(read.call_count, 2)

    def test_readback_mismatch_is_not_reported_as_configured(self):
        before = {"RUNTIME_TARGET_JSON": json.dumps(self.current)}
        after = {**before, "RUNTIME_TARGET_ENABLED": "false", "UNRELATED": "changed"}
        with patch.object(runtime_settings, "read_stop_variables", side_effect=[before, before, after]), \
                patch.object(runtime_settings.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)), \
                self.assertRaisesRegex(ValueError, "^stop_readback_unverified$"):
            runtime_settings.execute_stop(self.request, apply=True)

    def test_environment_inherits_inventory_without_creating_shadow_copy(self):
        self.request["github"].update(variable_scope="environment", environment="synthetic-env")
        inventory = [{"service": self.identity["service_name"], "runtime_target": self.current}]
        repo = {"CLOUD_RUN_SERVICE_TARGETS_JSON": json.dumps(inventory)}
        env = {"RUNTIME_TARGET_JSON": json.dumps(self.current), "CLOUD_RUN_SERVICE": self.identity["service_name"]}
        expected = copy.deepcopy(inventory)
        expected[0]["RUNTIME_TARGET_ENABLED"] = "false"
        after = {"CLOUD_RUN_SERVICE_TARGETS_JSON": runtime_settings.compact_json(expected)}
        with patch.object(runtime_settings, "read_stop_variables", side_effect=[repo, env, repo, env, after, env]), \
                patch.object(runtime_settings.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            result = runtime_settings.execute_stop(self.request, apply=True)
        self.assertTrue(result["configured"])
        self.assertNotIn("--env", run.call_args.args[0])
        self.assertEqual(json.loads(run.call_args.kwargs["input"]), expected)

    def test_variable_read_checks_complete_pagination_without_output(self):
        good = json.dumps([{"total_count": 2, "variables": [{"name": "ONE", "value": "one"}]},
                           {"total_count": 2, "variables": [{"name": "TWO", "value": "two"}]}])
        with patch.object(runtime_settings.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, good, "")):
            self.assertEqual(runtime_settings.read_stop_variables(self.request["github"]), {"ONE": "one", "TWO": "two"})
        bad = ["not-json", "[]", "{}", json.dumps([{"total_count": 2, "variables": []}]),
               json.dumps([{"total_count": 2, "variables": [{"name": "ONE", "value": "one"}]*2}])]
        for output in bad:
            with self.subTest(output=output), patch.object(runtime_settings.subprocess, "run", return_value=
                    subprocess.CompletedProcess([], 0, output, "synthetic-sensitive-error")), \
                    self.assertRaisesRegex(ValueError, "^stop_source_unavailable$"):
                runtime_settings.read_stop_variables(self.request["github"])

    def test_variable_reader_uses_actions_for_repository_and_encodes_environment(self):
        repository = "QuantStrategyLab/BinancePlatform"
        for scope, expected in [
            ({"repository": repository, "variable_scope": "repository"},
             f"repos/{repository}/actions/variables?per_page=100"),
            ({"repository": repository, "variable_scope": "environment", "environment": "test/env"},
             f"repos/{repository}/environments/test%2Fenv/variables?per_page=100"),
        ]:
            def source(command, **kwargs):
                if command != ["gh", "api", "--method", "GET", "--paginate", "--slurp", expected]:
                    return subprocess.CompletedProcess(command, 1, "", "not found")
                return subprocess.CompletedProcess(command, 0, '[{"total_count":0,"variables":[]}]', "")
            with self.subTest(scope=scope["variable_scope"]), \
                    patch.object(runtime_settings.subprocess, "run", side_effect=source):
                self.assertEqual(runtime_settings.read_stop_variables(scope), {})

    def test_cli_requires_explicit_stop_confirmation_before_read_or_write(self):
        with patch.dict(os.environ, {"RUNTIME_STOP_REQUEST_JSON": json.dumps(self.request)}, clear=True), \
                patch.object(runtime_settings, "execute_stop") as execute, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(runtime_settings.main(["stop", "--yes"]), 2)
        execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
