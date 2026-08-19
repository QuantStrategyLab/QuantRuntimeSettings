from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
AS_OF = "2026-08-20T12:00:00Z"


def _load_module(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


forward_observation_risk_control = _load_module("forward_observation_risk_control")


class ForwardObservationRiskControlTest(unittest.TestCase):
    @staticmethod
    def _sha(character: str) -> str:
        return character * 64

    @staticmethod
    def _revision(character: str) -> str:
        return character * 40

    def _risk_control(self, *, stage: str = "PAPER_DRY_RUN") -> dict[str, object]:
        execution_lane = "PAPER_BROKER" if stage == "PAPER_DRY_RUN" else "SHADOW_LEDGER"
        risk_control: dict[str, object] = {
            "schema": "qsl.forward_observation_risk_control.v1",
            "risk_policy_id": "tqqq-core-only-forward-observation",
            "risk_policy_version": "v1",
            "created_at": "2026-08-20T11:00:00Z",
            "effective_at": "2026-08-20T12:00:00Z",
            "expires_at": "2026-08-21T12:00:00Z",
            "digest_algorithm": "sha256",
            "stage": stage,
            "execution_lane": execution_lane,
            "candidate": {
                "candidate_id": "tqqq-core-only-p2-v5",
                "candidate_kind": "individual",
                "domain": "us-equity",
                "strategy_repository": "QuantStrategyLab/UsEquityStrategies",
                "strategy_revision": self._revision("a"),
            },
            "source_evidence": {
                "p1_input_digest": self._sha("b"),
                "p2_config_digest": self._sha("c"),
                "p3_evidence_id": self._sha("d"),
                "producer_revision": self._revision("e"),
            },
            "limits": {
                "allowed_symbols_sha256": self._sha("f"),
                "max_open_positions": 3,
                "max_gross_notional_cents": 100_000,
                "max_single_decision_notional_cents": 50_000,
                "max_daily_turnover_notional_cents": 100_000,
                "max_decisions_per_session": 4,
                "max_consecutive_failures": 2,
            },
            "circuit_breaker": {
                "require_market_session": True,
                "halt_on_data_unavailable": True,
                "halt_on_evidence_mismatch": True,
                "halt_on_reconciliation_failure": True,
                "halt_on_execution_error": True,
                "halt_on_unknown_execution_outcome": True,
                "require_reconciliation_before_next_cycle": True,
            },
            "risk_policy_sha256": "",
        }
        risk_control["risk_policy_sha256"] = forward_observation_risk_control.calculate_risk_policy_sha256(risk_control)
        return risk_control

    def _validated(self, risk_control: dict[str, object]) -> object:
        return forward_observation_risk_control.validate_forward_observation_risk_control(risk_control, as_of=AS_OF)

    def test_valid_paper_and_shadow_controls_are_canonical_and_non_executing(self):
        paper = self._risk_control()
        shadow = self._risk_control(stage="SHADOW")

        self.assertEqual(self._validated(paper)["execution_lane"], "PAPER_BROKER")
        self.assertEqual(self._validated(shadow)["execution_lane"], "SHADOW_LEDGER")
        self.assertEqual(
            forward_observation_risk_control.canonical_risk_control_json(paper),
            forward_observation_risk_control.canonical_risk_control_json(dict(reversed(paper.items()))),
        )
        self.assertEqual(
            paper["risk_policy_sha256"],
            forward_observation_risk_control.calculate_risk_policy_sha256(paper),
        )

    def test_stage_lane_digest_and_lifetime_mismatch_fail_closed(self):
        mismatched_lane = self._risk_control()
        mismatched_lane["execution_lane"] = "SHADOW_LEDGER"
        mismatched_lane["risk_policy_sha256"] = forward_observation_risk_control.calculate_risk_policy_sha256(
            mismatched_lane
        )
        with self.assertRaisesRegex(
            forward_observation_risk_control.ForwardObservationRiskControlError, "execution_lane"
        ):
            self._validated(mismatched_lane)

        bad_digest = self._risk_control()
        bad_digest["limits"]["max_open_positions"] = 2
        with self.assertRaisesRegex(
            forward_observation_risk_control.ForwardObservationRiskControlError, "risk_policy_sha256 mismatch"
        ):
            self._validated(bad_digest)

        overlong = self._risk_control()
        overlong["expires_at"] = "2026-09-21T12:00:01Z"
        overlong["risk_policy_sha256"] = forward_observation_risk_control.calculate_risk_policy_sha256(overlong)
        with self.assertRaisesRegex(forward_observation_risk_control.ForwardObservationRiskControlError, "31 days"):
            self._validated(overlong)

    def test_limits_and_circuit_breaker_must_bound_each_cycle(self):
        bad_turnover = self._risk_control()
        bad_turnover["limits"]["max_daily_turnover_notional_cents"] = 49_999
        bad_turnover["risk_policy_sha256"] = forward_observation_risk_control.calculate_risk_policy_sha256(bad_turnover)
        with self.assertRaisesRegex(
            forward_observation_risk_control.ForwardObservationRiskControlError, "cover one decision"
        ):
            self._validated(bad_turnover)

        disabled_circuit = self._risk_control()
        disabled_circuit["circuit_breaker"]["halt_on_unknown_execution_outcome"] = False
        disabled_circuit["risk_policy_sha256"] = forward_observation_risk_control.calculate_risk_policy_sha256(
            disabled_circuit
        )
        with self.assertRaisesRegex(
            forward_observation_risk_control.ForwardObservationRiskControlError, "must be true"
        ):
            self._validated(disabled_circuit)

    def test_secrets_urls_financial_payloads_unknowns_and_duplicate_keys_are_rejected(self):
        for key, value in (
            ("broker_endpoint", "https://paper-api.example"),
            ("api_token", "not-a-real-token"),
            ("account_number", "123456"),
        ):
            unsafe = self._risk_control()
            unsafe[key] = value
            unsafe["risk_policy_sha256"] = forward_observation_risk_control.calculate_risk_policy_sha256(unsafe)
            with self.assertRaises(forward_observation_risk_control.ForwardObservationRiskControlError):
                self._validated(unsafe)

        with self.assertRaisesRegex(
            forward_observation_risk_control.ForwardObservationRiskControlError, "duplicate JSON key"
        ):
            forward_observation_risk_control.parse_risk_control_json('{"schema":"a","schema":"b"}')

    def test_cli_emits_only_a_safe_policy_summary(self):
        risk_control = self._risk_control()
        with tempfile.TemporaryDirectory(prefix="qsl-forward-observation-") as directory:
            path = Path(directory) / "risk-control.json"
            path.write_text(json.dumps(risk_control), encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "forward_observation_risk_control.py"),
                    "--risk-control",
                    str(path),
                    "--as-of",
                    AS_OF,
                ],
                capture_output=True,
                check=False,
                text=True,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout.strip(),
            "FORWARD_OBSERVATION_RISK_CONTROL_VALID "
            "stage=PAPER_DRY_RUN lane=PAPER_BROKER candidate=tqqq-core-only-p2-v5",
        )
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
