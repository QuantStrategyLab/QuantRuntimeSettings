"""The legacy resume setting cannot replace a target or grant recovery authority."""
import copy
import contextlib
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import resume_binance_runtime as resume


class ResumeBinanceRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.identity = dict(platform_id="binance", deployment_selector="synthetic",
                             account_selector=["synthetic"], account_scope="synthetic",
                             service_name="synthetic-service")
        target = dict(self.identity, strategy_profile="crypto_live_pool_rotation",
                      execution_mode="live", dry_run_only=False,
                      live_continuity=dict(state="RECONCILE_ONLY", baseline_kind="legacy_authorized",
                                           baseline_id="synthetic-baseline", captured_at="2026-08-30",
                                           baseline_target_sha256="a" * 64))
        self.variables = {"RUNTIME_TARGET_JSON": json.dumps(target), "RUNTIME_TARGET_ENABLED": "false",
                          "STRATEGY_PROFILE": "crypto_live_pool_rotation", "BINANCE_DRY_RUN": "false",
                          "BINANCE_RECOVERY_CONTROL_ENABLED": "true", "UNRELATED_SETTING": "retain"}
        self.request = dict(target_id="binance/synthetic", runtime_target=self.identity,
                            github=dict(repository="QuantStrategyLab/BinancePlatform", variable_scope="repository"),
                            runtime_target_sha256=hashlib.sha256(self.variables["RUNTIME_TARGET_JSON"].encode()).hexdigest())

    def test_preview_is_read_only_and_does_not_claim_active_recovery(self):
        with patch.object(resume, "read_stop_variables", return_value=self.variables), \
                patch.object(resume.subprocess, "run") as write:
            result = resume.execute_resume(self.request)
        self.assertEqual(result, dict(configured=False, platform_applied=False, preview=True))
        write.assert_not_called()

    def test_save_only_changes_existing_switch_and_checks_complete_readback(self):
        after = dict(self.variables, RUNTIME_TARGET_ENABLED="true")
        before = copy.deepcopy(self.variables)
        with patch.object(resume, "read_stop_variables", side_effect=[before, before, after]), \
                patch.object(resume.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as write:
            result = resume.execute_resume(self.request, apply=True)
        self.assertEqual(result, dict(configured=True, platform_applied=False, preview=False))
        self.assertEqual(write.call_count, 1)
        self.assertEqual(write.call_args.args[0], ["gh", "variable", "set", "RUNTIME_TARGET_ENABLED",
                                                  "--repo", "QuantStrategyLab/BinancePlatform"])
        self.assertEqual(write.call_args.kwargs["input"], "true")
        self.assertEqual(self.variables, before)

    def test_mismatch_missing_guard_or_ambiguous_source_never_writes(self):
        mutations = [{"RUNTIME_TARGET_ENABLED": "true"}, {"RUNTIME_TARGET_ENABLED": ""},
                     {"BINANCE_RECOVERY_CONTROL_ENABLED": "false"}, {"BINANCE_DRY_RUN": "true"},
                     {"STRATEGY_PROFILE": "other"}, {"CLOUD_RUN_SERVICE_TARGETS_JSON": "[]"},
                     {"RUNTIME_TARGET_JSON": "{}"}]
        for mutation in mutations:
            with self.subTest(fields=list(mutation)), \
                    patch.object(resume, "read_stop_variables", return_value={**self.variables, **mutation}), \
                    patch.object(resume.subprocess, "run") as write, self.assertRaises(ValueError):
                resume.execute_resume(self.request, apply=True)
            write.assert_not_called()

    def test_request_cannot_change_strategy_cash_scope_or_destination(self):
        invalid = [{**self.request, "extra_variables": {"RUNTIME_TARGET_ENABLED": "true"}},
                   {**self.request, "runtime_target_sha256": "b" * 64},
                   {**self.request, "runtime_target": {**self.identity, "strategy_profile": "other"}},
                   {**self.request, "runtime_target": {**self.identity, "account_scope": "other"}},
                   {**self.request, "github": {**self.request["github"], "repository": "other/repo"}},
                   {**self.request, "github": {**self.request["github"], "variable_scope": "environment",
                                                "environment": "other"}}]
        for request in invalid:
            with self.subTest(index=invalid.index(request)), \
                    patch.object(resume, "read_stop_variables", return_value=self.variables), \
                    patch.object(resume.subprocess, "run") as write, self.assertRaises(ValueError):
                resume.execute_resume(request, apply=True)
            write.assert_not_called()

    def test_nonlegacy_or_other_continuity_states_are_rejected(self):
        for field, value in [("state", "PAUSED"), ("state", "RISK_REDUCTION_ONLY"),
                             ("baseline_kind", "release_attested"), ("baseline_id", ""),
                             ("baseline_target_sha256", "invalid"), ("captured_at", "")]:
            target = json.loads(self.variables["RUNTIME_TARGET_JSON"])
            target["live_continuity"][field] = value
            variables = dict(self.variables, RUNTIME_TARGET_JSON=json.dumps(target))
            request = dict(self.request, runtime_target_sha256=hashlib.sha256(variables["RUNTIME_TARGET_JSON"].encode()).hexdigest())
            with self.subTest(field=field, value=value), \
                    patch.object(resume, "read_stop_variables", return_value=variables), \
                    patch.object(resume.subprocess, "run") as write, self.assertRaises(ValueError):
                resume.execute_resume(request, apply=True)
            write.assert_not_called()

    def test_racing_configuration_or_unknown_write_outcome_is_not_retried(self):
        with patch.object(resume, "read_stop_variables", side_effect=[self.variables, dict(self.variables, OTHER="changed")]), \
                patch.object(resume.subprocess, "run") as write, self.assertRaisesRegex(ValueError, "source_changed"):
            resume.execute_resume(self.request, apply=True)
        write.assert_not_called()
        for failure in [subprocess.TimeoutExpired("synthetic", 60), OSError("synthetic-private")]:
            with patch.object(resume, "read_stop_variables", return_value=self.variables), \
                    patch.object(resume.subprocess, "run", side_effect=failure) as write, \
                    self.assertRaisesRegex(ValueError, "write_outcome_unverified"):
                resume.execute_resume(self.request, apply=True)
            self.assertEqual(write.call_count, 1)
        with patch.object(resume, "read_stop_variables", side_effect=[self.variables, self.variables, self.variables]), \
                patch.object(resume.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as write, \
                self.assertRaisesRegex(ValueError, "readback_unverified"):
            resume.execute_resume(self.request, apply=True)
        self.assertEqual(write.call_count, 1)

    def test_workflow_event_requires_main_and_explicit_confirmation_before_io(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "event.json"
            for ref, apply, confirm, expected in [
                ("refs/heads/main", "false", "", 0),
                ("refs/heads/main", "true", "RESUME_EXISTING", 0),
                ("refs/heads/main", "true", "", 2),
                ("refs/heads/feature", "true", "RESUME_EXISTING", 2),
            ]:
                path.write_text(json.dumps({"inputs": {"apply": apply, "confirm": confirm,
                                                       "resume_request": json.dumps(self.request)}}))
                with self.subTest(ref=ref, apply=apply, confirm=confirm), \
                        patch.dict(os.environ, {"GITHUB_REF": ref, "GITHUB_EVENT_PATH": str(path)}, clear=True), \
                        patch.object(resume, "execute_resume", return_value={"platform_applied": False}) as execute, \
                        contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(resume.main(), expected)
                if expected:
                    execute.assert_not_called()
                else:
                    execute.assert_called_once_with(self.request, apply=apply == "true")

    def test_unverified_readback_does_not_leak_details_or_retry(self):
        after = dict(self.variables, RUNTIME_TARGET_ENABLED="true", UNRELATED_SETTING="unexpected")
        with patch.object(resume, "read_stop_variables", side_effect=[self.variables, self.variables, after]), \
                patch.object(resume.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as write, \
                self.assertRaisesRegex(ValueError, "^resume_readback_unverified$"):
            resume.execute_resume(self.request, apply=True)
        self.assertEqual(write.call_count, 1)


if __name__ == "__main__":
    unittest.main()
