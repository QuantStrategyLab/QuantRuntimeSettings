from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "runtime_control_drift_report", ROOT / "scripts" / "runtime_control_drift_report.py"
)
drift = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = drift
spec.loader.exec_module(drift)

POLICY = {
    "policy_id": "demo_profile/ref",
    "strategy_profile": "demo_profile",
    "nominal_caps": {"AAA": 0.5, "BBB": 0.97},
    "total_nominal_exposure_cap": 0.97,
    "total_effective_exposure_cap": 1.97,
    "max_positions": 4,
    "cash_policy": {"cash_only": True, "reserved_cash_ratio": 0.03},
}
LIMITS = {k: POLICY[k] for k in ("nominal_caps", "total_nominal_exposure_cap", "total_effective_exposure_cap", "max_positions")}


def _target(**changes):
    target = {"platform_id": "longbridge", "strategy_profile": "demo_profile", "dry_run_only": False,
              "execution_mode": "live", "runtime_risk_limits": LIMITS}
    target.update(changes)
    return json.dumps(target)


def _inventory(env_vars, repo_vars=None, secrets=(), manifest=None):
    entry = {
        "repo_vars": repo_vars or {},
        "repo_secret_names": [],
        "environments": {"lb-a": {"vars": env_vars, "secret_names": list(secrets)}},
    }
    if manifest is not None:
        entry["manifest"] = manifest
    return {"repositories": {"Org/LongBridgePlatform": entry}}


CLEAN_ENV = {
    "RUNTIME_TARGET_JSON": _target(),
    "RUNTIME_TARGET_ENABLED": "true",
    "LONGBRIDGE_DRY_RUN_ONLY": "false",
    "LONGBRIDGE_CASH_ONLY_EXECUTION": "true",
    "LONGBRIDGE_RESERVED_CASH_RATIO": "0.03",
    "STRATEGY_PROFILE": "demo_profile",
}


def _rules(inventory):
    return {f.rule for f in drift.run_rules(inventory, {"demo_profile": POLICY})}


class DriftReportTest(unittest.TestCase):
    def test_clean_target_has_no_findings(self) -> None:
        self.assertEqual(_rules(_inventory(dict(CLEAN_ENV))), set())

    def test_var_secret_collision(self) -> None:
        self.assertIn("var_secret_collision", _rules(_inventory(dict(CLEAN_ENV), secrets=["RUNTIME_TARGET_JSON"])))

    def test_repo_value_shadowed_by_every_environment(self) -> None:
        inventory = _inventory(dict(CLEAN_ENV), repo_vars={"RUNTIME_TARGET_ENABLED": "false"})
        self.assertIn("repo_fallback_only", _rules(inventory))

    def test_non_strict_safety_flag(self) -> None:
        self.assertIn("safety_flag_not_strict_bool", _rules(_inventory({**CLEAN_ENV, "LONGBRIDGE_DRY_RUN_ONLY": ""})))
        self.assertIn("safety_flag_not_strict_bool", _rules(_inventory({**CLEAN_ENV, "RUNTIME_TARGET_ENABLED": "ture"})))

    def test_dry_run_disagreement(self) -> None:
        env = {**CLEAN_ENV, "RUNTIME_TARGET_JSON": _target(dry_run_only=True, execution_mode="paper")}
        self.assertIn("dry_run_disagreement", _rules(_inventory(env)))

    def test_cash_only_alias_disagreement_and_policy_drift(self) -> None:
        env = {**CLEAN_ENV, "LONGBRIDGE_CASH_ONLY_EXECUTION": "false"}
        rules = _rules(_inventory(env, repo_vars={"CASH_ONLY_EXECUTION": "true"}))
        self.assertIn("cash_only_alias_disagreement", rules)
        self.assertIn("cash_only_drift", rules)

    def test_missing_risk_limits_and_reserve(self) -> None:
        env = {k: v for k, v in CLEAN_ENV.items() if k != "LONGBRIDGE_RESERVED_CASH_RATIO"}
        env["RUNTIME_TARGET_JSON"] = _target(runtime_risk_limits=None)
        rules = _rules(_inventory(env))
        self.assertIn("risk_limits_missing", rules)
        self.assertIn("reserved_cash_drift", rules)

    def test_risk_limits_drift(self) -> None:
        env = {**CLEAN_ENV, "RUNTIME_TARGET_JSON": _target(runtime_risk_limits={**LIMITS, "total_nominal_exposure_cap": 1.0})}
        self.assertIn("risk_limits_drift", _rules(_inventory(env)))

    def test_strategy_profile_mismatch_with_manifest(self) -> None:
        manifest = {"targets": [{"environment": "lb-a", "strategy_profile": "other_profile"}]}
        self.assertIn("strategy_profile_mismatch", _rules(_inventory(dict(CLEAN_ENV), manifest=manifest)))

    def test_per_service_targets_are_expanded(self) -> None:
        services = {"targets": [
            {"runtime_target": json.loads(_target(platform_id="ibkr")),
             "env": {"IBKR_DRY_RUN_ONLY": "false", "IBKR_RESERVED_CASH_RATIO": "0.03", "IBKR_CASH_ONLY_EXECUTION": "true"}},
            {"runtime_target": json.loads(_target(platform_id="ibkr", runtime_risk_limits=None)),
             "env": {"IBKR_DRY_RUN_ONLY": "false", "IBKR_RESERVED_CASH_RATIO": "0.03", "IBKR_CASH_ONLY_EXECUTION": "true"}},
        ]}
        inventory = {"repositories": {"Org/InteractiveBrokersPlatform": {
            "repo_vars": {"CLOUD_RUN_SERVICE_TARGETS_JSON": json.dumps(services)}, "repo_secret_names": [], "environments": {}}}}
        findings = drift.run_rules(inventory, {"demo_profile": POLICY})
        self.assertEqual([(f.rule, f.scope.endswith("service#1")) for f in findings], [("risk_limits_missing", True)])

    def test_report_never_prints_values(self) -> None:
        secret_like = "U99999999"
        env = {**CLEAN_ENV, "RUNTIME_TARGET_JSON": _target(account_selector=[secret_like], runtime_risk_limits=None)}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "inventory.json"
            path.write_text(json.dumps(_inventory(env, secrets=["RUNTIME_TARGET_JSON"])), encoding="utf-8")
            buffer = io.StringIO()
            with redirect_stdout(buffer):
                code = drift.main(["report", str(path), "--fail-on", "high"])
        self.assertEqual(code, 1)
        self.assertNotIn(secret_like, buffer.getvalue())
        self.assertIn("var_secret_collision", buffer.getvalue())


if __name__ == "__main__":
    unittest.main()
