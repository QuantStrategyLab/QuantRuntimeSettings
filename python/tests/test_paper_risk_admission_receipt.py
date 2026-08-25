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
paper_risk_admission_receipt = _load_module("paper_risk_admission_receipt")


class PaperRiskAdmissionReceiptTest(unittest.TestCase):
    @staticmethod
    def _sha(character: str) -> str:
        return character * 64

    def _policy(self) -> dict[str, object]:
        policy: dict[str, object] = {
            "schema": "qsl.deterministic_risk_gate_policy.v1",
            "risk_policy_id": "soxl-paper-risk-gate",
            "risk_policy_version": "v1",
            "source_risk_control": {
                "schema": "qsl.forward_observation_risk_control.v1",
                "risk_policy_id": "soxl-forward-observation",
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
            "evaluation_id": "risk-eval.soxl.paper.20260825.001",
            "observed_at": "2026-08-25T12:00:00Z",
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
                "symbol_gross_notionals_cents": {"SOXL": 30_000, "SOXX": 10_000},
                "strategy_gross_notionals_cents": {"soxl-soxx": 30_000, "soxx-observer": 10_000},
            },
            "new_risk_request": {
                "symbol": "SOXL",
                "strategy_id": "soxl-soxx",
                "additional_gross_notional_cents": 10_000,
            },
        }

    def _receipt(self, decision: dict[str, object]) -> dict[str, object]:
        return paper_risk_admission_receipt.build_paper_risk_admission_receipt(
            decision=decision,
            strategy_profile="soxl-soxx-trend-income",
            release_id="SOXL.SOXX.PAPER.20260825",
            effective_session="2026-08-25",
        )

    def test_allow_receipt_is_canonical_and_omits_projected_risk_details(self):
        policy = self._policy()
        decision = deterministic_risk_gate.evaluate_new_risk(policy, self._input(policy))

        receipt = self._receipt(decision)

        self.assertEqual(receipt["schema_version"], "paper_risk_admission_receipt.v1")
        self.assertEqual(receipt["disposition"], "allow_new_risk")
        self.assertEqual(receipt["reason_codes"], [])
        self.assertEqual(receipt["decision_digest"], decision["decision_sha256"])
        self.assertEqual(
            receipt["receipt_sha256"],
            paper_risk_admission_receipt.calculate_paper_risk_admission_receipt_sha256(receipt),
        )
        self.assertEqual(
            set(receipt),
            {
                "schema_version",
                "strategy_profile",
                "release_id",
                "risk_policy_sha256",
                "decision_digest",
                "effective_session",
                "disposition",
                "reason_codes",
                "receipt_sha256",
            },
        )
        for forbidden in ("account", "position", "notional", "cents", "projected", "broker", "order"):
            self.assertNotIn(forbidden, receipt)

    def test_prohibited_new_risk_maps_to_reducing_only_with_stable_reason_codes(self):
        policy = self._policy()
        risk_input = self._input(policy)
        risk_input["snapshot"]["observation_status"] = "STALE"
        decision = deterministic_risk_gate.evaluate_new_risk(policy, risk_input)

        receipt = self._receipt(decision)

        self.assertEqual(decision["decision"], "NEW_RISK_PROHIBITED")
        self.assertEqual(receipt["disposition"], "reducing_only")
        self.assertEqual(receipt["reason_codes"], ["OBSERVATION_NOT_COMPLETE"])
        paper_risk_admission_receipt.validate_paper_risk_admission_receipt(receipt)

    def test_unknown_but_digest_valid_decision_is_halted_with_one_redacted_reason(self):
        policy = self._policy()
        decision = deterministic_risk_gate.evaluate_new_risk(policy, self._input(policy))
        decision["decision"] = "FUTURE_DECISION"
        decision["decision_sha256"] = deterministic_risk_gate.calculate_risk_gate_decision_sha256(decision)

        receipt = self._receipt(decision)

        self.assertEqual(receipt["disposition"], "halted")
        self.assertEqual(receipt["reason_codes"], ["UNKNOWN_DETERMINISTIC_RISK_DECISION"])

        unknown_reason = deterministic_risk_gate.evaluate_new_risk(policy, self._input(policy))
        unknown_reason["decision"] = "NEW_RISK_PROHIBITED"
        unknown_reason["reason_codes"] = ["FUTURE_RISK_CONDITION"]
        unknown_reason["next_circuit_breaker_state"] = "OPEN"
        unknown_reason["decision_sha256"] = deterministic_risk_gate.calculate_risk_gate_decision_sha256(unknown_reason)
        halted_unknown_reason = self._receipt(unknown_reason)
        self.assertEqual(halted_unknown_reason["disposition"], "halted")
        self.assertEqual(halted_unknown_reason["reason_codes"], ["UNKNOWN_DETERMINISTIC_RISK_DECISION"])

    def test_tampered_or_leaky_source_and_receipt_fail_closed(self):
        policy = self._policy()
        decision = deterministic_risk_gate.evaluate_new_risk(policy, self._input(policy))

        tampered = copy.deepcopy(decision)
        tampered["projected"]["gross_notional_cents"] += 1
        with self.assertRaisesRegex(paper_risk_admission_receipt.PaperRiskAdmissionReceiptError, "decision_sha256 mismatch"):
            self._receipt(tampered)

        receipt = self._receipt(decision)
        leaky = dict(receipt)
        leaky["projected_notional_cents"] = 50_000
        with self.assertRaisesRegex(paper_risk_admission_receipt.PaperRiskAdmissionReceiptError, "unknown field"):
            paper_risk_admission_receipt.validate_paper_risk_admission_receipt(leaky)


if __name__ == "__main__":
    unittest.main()
