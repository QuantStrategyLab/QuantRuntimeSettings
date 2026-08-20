from __future__ import annotations

import copy
import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def _load_module(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


deterministic_risk_gate = _load_module("deterministic_risk_gate")


class DeterministicRiskGateTest(unittest.TestCase):
    @staticmethod
    def _sha(character: str) -> str:
        return character * 64

    def _policy(self) -> dict[str, object]:
        policy: dict[str, object] = {
            "schema": "qsl.deterministic_risk_gate_policy.v1",
            "risk_policy_id": "tqqq-paper-risk-gate",
            "risk_policy_version": "v1",
            "source_risk_control": {
                "schema": "qsl.forward_observation_risk_control.v1",
                "risk_policy_id": "tqqq-core-only-forward-observation",
                "risk_policy_version": "v1",
                "risk_policy_sha256": self._sha("a"),
            },
            "limits": {
                "max_gross_notional_cents": 90_000,
                "max_single_symbol_notional_cents": 50_000,
                "max_single_strategy_notional_cents": 70_000,
                "max_leverage_bps": 12_500,
                "max_daily_loss_cents": 10_000,
                "max_decisions_per_session": 4,
            },
            "circuit_breaker": {"manual_reset_required": True},
            "risk_policy_sha256": "",
        }
        policy["risk_policy_sha256"] = deterministic_risk_gate.calculate_risk_gate_policy_sha256(policy)
        return policy

    def _input(self, policy: dict[str, object]) -> dict[str, object]:
        return {
            "schema": "qsl.deterministic_risk_gate_input.v1",
            "evaluation_id": "risk-eval.tqqq.paper.20260821.001",
            "observed_at": "2026-08-21T12:00:00Z",
            "policy": {
                "risk_policy_id": policy["risk_policy_id"],
                "risk_policy_version": policy["risk_policy_version"],
                "risk_policy_sha256": policy["risk_policy_sha256"],
            },
            "snapshot": {
                "observation_status": "COMPLETE",
                "reconciliation_status": "VERIFIED",
                "circuit_breaker_state": "CLOSED",
                "equity_cents": 100_000,
                "gross_notional_cents": 40_000,
                "daily_loss_cents": 1_000,
                "decisions_in_session": 2,
                "symbol_gross_notionals_cents": {"QQQ": 10_000, "TQQQ": 30_000},
                "strategy_gross_notionals_cents": {"qqq-observer": 10_000, "tqqq-core-only": 30_000},
            },
            "new_risk_request": {
                "symbol": "TQQQ",
                "strategy_id": "tqqq-core-only",
                "additional_gross_notional_cents": 10_000,
            },
        }

    @staticmethod
    def _set_exposures(
        risk_input: dict[str, object],
        *,
        symbols: dict[str, int],
        strategies: dict[str, int],
    ) -> None:
        assert sum(symbols.values()) == sum(strategies.values())
        snapshot = risk_input["snapshot"]
        assert isinstance(snapshot, dict)
        snapshot["symbol_gross_notionals_cents"] = symbols
        snapshot["strategy_gross_notionals_cents"] = strategies
        snapshot["gross_notional_cents"] = sum(symbols.values())

    def test_all_limits_pass_returns_a_canonical_allow_without_execution_capability(self):
        policy = self._policy()
        risk_input = self._input(policy)

        decision = deterministic_risk_gate.evaluate_new_risk(policy, risk_input)

        self.assertEqual(decision["schema"], "qsl.deterministic_risk_gate_decision.v1")
        self.assertEqual(decision["decision"], "ALLOW_NEW_RISK")
        self.assertEqual(decision["reason_codes"], [])
        self.assertEqual(decision["next_circuit_breaker_state"], "CLOSED")
        self.assertTrue(decision["manual_reset_required"])
        self.assertEqual(decision["projected"]["gross_notional_cents"], 50_000)
        self.assertEqual(decision["projected"]["leverage_bps"], 5_000)
        self.assertEqual(
            decision["decision_sha256"],
            deterministic_risk_gate.calculate_risk_gate_decision_sha256(decision),
        )
        self.assertNotIn("broker", str(decision).lower())
        self.assertNotIn("account", str(decision).lower())
        self.assertNotIn("credential", str(decision).lower())

    def test_any_risk_or_health_failure_prohibits_new_risk_and_opens_the_breaker(self):
        cases = {
            "observation": lambda value: value["snapshot"].update({"observation_status": "STALE"}),
            "reconciliation": lambda value: value["snapshot"].update({"reconciliation_status": "FAILED"}),
            "breaker": lambda value: value["snapshot"].update({"circuit_breaker_state": "OPEN"}),
            "daily_loss": lambda value: value["snapshot"].update({"daily_loss_cents": 10_000}),
            "session_frequency": lambda value: value["snapshot"].update({"decisions_in_session": 4}),
            "gross": lambda value: self._set_exposures(
                value,
                symbols={"QQQ": 10_000, "TQQQ": 80_000},
                strategies={"qqq-observer": 10_000, "tqqq-core-only": 80_000},
            ),
            "single_symbol": lambda value: self._set_exposures(
                value,
                symbols={"QQQ": 10_000, "TQQQ": 45_000},
                strategies={"qqq-observer": 10_000, "tqqq-core-only": 45_000},
            ),
            "single_strategy": lambda value: self._set_exposures(
                value,
                symbols={"QQQ": 10_000, "TQQQ": 45_000},
                strategies={"qqq-observer": 10_000, "tqqq-core-only": 45_000},
            ),
            "leverage": lambda value: value["snapshot"].update({"equity_cents": 4_000}),
        }
        expected_reason = {
            "observation": "OBSERVATION_NOT_COMPLETE",
            "reconciliation": "RECONCILIATION_NOT_VERIFIED",
            "breaker": "CIRCUIT_BREAKER_OPEN",
            "daily_loss": "DAILY_LOSS_LIMIT_EXCEEDED",
            "session_frequency": "SESSION_DECISION_LIMIT_EXCEEDED",
            "gross": "GROSS_EXPOSURE_LIMIT_EXCEEDED",
            "single_symbol": "SINGLE_SYMBOL_LIMIT_EXCEEDED",
            "single_strategy": "SINGLE_STRATEGY_LIMIT_EXCEEDED",
            "leverage": "LEVERAGE_LIMIT_EXCEEDED",
        }

        for name, mutate in cases.items():
            with self.subTest(name=name):
                policy = self._policy()
                if name == "single_strategy":
                    policy["limits"]["max_single_symbol_notional_cents"] = 90_000
                    policy["limits"]["max_single_strategy_notional_cents"] = 50_000
                    policy["risk_policy_sha256"] = deterministic_risk_gate.calculate_risk_gate_policy_sha256(policy)
                mutate_input = self._input(policy)
                mutate(mutate_input)

                decision = deterministic_risk_gate.evaluate_new_risk(policy, mutate_input)

                self.assertEqual(decision["decision"], "NEW_RISK_PROHIBITED")
                self.assertIn(expected_reason[name], decision["reason_codes"])
                self.assertEqual(decision["next_circuit_breaker_state"], "OPEN")
                self.assertTrue(decision["manual_reset_required"])

    def test_policy_reference_and_snapshot_integrity_fail_closed_before_evaluation(self):
        policy = self._policy()

        for mutate, message in (
            (
                lambda value: value["policy"].update({"risk_policy_sha256": self._sha("0")}),
                "input policy does not match",
            ),
            (
                lambda value: value["snapshot"].update({"gross_notional_cents": 39_999}),
                "does not equal symbol exposure total",
            ),
        ):
            with self.subTest(mutate=mutate):
                invalid_input = copy.deepcopy(self._input(policy))
                mutate(invalid_input)
                with self.assertRaisesRegex(deterministic_risk_gate.DeterministicRiskGateError, message):
                    deterministic_risk_gate.evaluate_new_risk(policy, invalid_input)

        unsafe_policy = self._policy()
        unsafe_policy["circuit_breaker"]["manual_reset_required"] = False
        unsafe_policy["risk_policy_sha256"] = deterministic_risk_gate.calculate_risk_gate_policy_sha256(unsafe_policy)
        with self.assertRaisesRegex(deterministic_risk_gate.DeterministicRiskGateError, "manual_reset_required"):
            deterministic_risk_gate.evaluate_new_risk(unsafe_policy, self._input(unsafe_policy))

        invalid_timestamp = self._input(policy)
        invalid_timestamp["observed_at"] = "2026-02-30T12:00:00Z"
        with self.assertRaisesRegex(deterministic_risk_gate.DeterministicRiskGateError, "valid calendar timestamp"):
            deterministic_risk_gate.evaluate_new_risk(policy, invalid_timestamp)


if __name__ == "__main__":
    unittest.main()
