from __future__ import annotations

import copy
import importlib.util
import json
import sys
import tempfile
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


composer = _load_module("long_horizon_risk_composer")


class LongHorizonRiskComposerTest(unittest.TestCase):
    @staticmethod
    def _sha(character: str) -> str:
        return character * 64

    @staticmethod
    def _revision(character: str) -> str:
        return character * 40

    @staticmethod
    def _returns(gain_bps: int, drawdown_bps: int) -> list[int]:
        return [gain_bps] * 240 + [-drawdown_bps] * 12

    def _input(self, *, preference: str = "BALANCED_COMPOUNDING") -> dict[str, object]:
        paths = []
        for index, kind in enumerate(("WALK_FORWARD", "BOOTSTRAP", "STRESS"), start=1):
            paths.append(
                {
                    "scenario_id": f"soxl_soxx_longterm_{kind.lower()}_{index}",
                    "scenario_kind": kind,
                    "session_count": 253,
                    "strategy_returns_bps": self._returns(16 - index, 124 + index),
                    "benchmark_returns_bps": self._returns(10 - index, 100 + index),
                }
            )
        value: dict[str, object] = {
            "schema": "qsl.long_horizon_risk_composer_input.v1",
            "candidate": {
                "candidate_id": "soxl_soxx_longterm_compounding",
                "candidate_kind": "individual",
                "strategy_repository": "QuantStrategyLab/UsEquityStrategies",
                "strategy_revision": self._revision("a"),
            },
            "source_evidence": {
                "p1_input_digest": self._sha("1"),
                "p2_config_digest": self._sha("2"),
                "p3_evidence_sha256": self._sha("3"),
                "plugin_bundle_sha256": self._sha("4"),
            },
            "objective": {
                "risk_preference": preference,
                "benchmark_id": "soxx",
                "benchmark_kind": "unlevered_reference",
                "sessions_per_year": 252,
            },
            "scenario_paths": paths,
            "input_sha256": "",
        }
        value["input_sha256"] = composer.calculate_risk_composer_input_sha256(value)
        return value

    def _observation(self) -> dict[str, object]:
        composer_input = self._input()
        value: dict[str, object] = {
            "schema": "qsl.long_horizon_risk_observation.v1",
            "candidate": composer_input["candidate"],
            "source_evidence": composer_input["source_evidence"],
            "benchmark": {
                "benchmark_id": "soxx",
                "benchmark_kind": "unlevered_reference",
                "sessions_per_year": 252,
            },
            "scenario_paths": composer_input["scenario_paths"],
            "observation_sha256": "",
        }
        value["observation_sha256"] = composer.calculate_risk_observation_sha256(value)
        return value

    def test_balanced_composer_selects_the_highest_robust_growth_scale_within_benchmark_drawdown_envelope(self):
        recommendation = composer.compose_long_horizon_risk_recommendation(self._input())

        self.assertEqual(recommendation["status"], "ADVISORY_RECOMMENDATION_READY")
        self.assertEqual(recommendation["objective"]["risk_preference"], "BALANCED_COMPOUNDING")
        self.assertEqual(recommendation["recommended_scale_bps"], 10_000)
        self.assertGreater(recommendation["recommended_max_drawdown_bps"], 0)
        self.assertEqual(len(recommendation["frontier"]), 10)
        self.assertTrue(recommendation["frontier"][-1]["eligible"])
        self.assertEqual(
            recommendation,
            composer.validate_risk_composer_recommendation(recommendation),
        )
        rendered = json.dumps(recommendation, sort_keys=True).lower()
        self.assertNotIn("strategy_returns", rendered)
        self.assertNotIn("benchmark_returns", rendered)
        self.assertNotIn("broker", rendered)
        self.assertNotIn("account", rendered)

    def test_capital_preservation_reduces_scale_without_changing_the_frozen_evidence(self):
        balanced = composer.compose_long_horizon_risk_recommendation(self._input())
        capital = composer.compose_long_horizon_risk_recommendation(
            self._input(preference="CAPITAL_PRESERVATION")
        )

        self.assertEqual(capital["status"], "ADVISORY_RECOMMENDATION_READY")
        self.assertLess(capital["recommended_scale_bps"], balanced["recommended_scale_bps"])
        self.assertLess(capital["recommended_max_drawdown_bps"], balanced["recommended_max_drawdown_bps"])

    def test_a_severe_stress_benchmark_cannot_relax_a_paired_walk_forward_drawdown_limit(self):
        risk_input = self._input(preference="CAPITAL_PRESERVATION")
        for path in risk_input["scenario_paths"]:
            path["strategy_returns_bps"] = self._returns(25, 300)
            path["benchmark_returns_bps"] = self._returns(
                25,
                5_000 if path["scenario_kind"] == "STRESS" else 100,
            )
        risk_input["input_sha256"] = composer.calculate_risk_composer_input_sha256(risk_input)

        recommendation = composer.compose_long_horizon_risk_recommendation(risk_input)

        # The old global-worst-benchmark calculation would have accepted this
        # row because STRESS has an almost total benchmark drawdown.  The
        # walk-forward and bootstrap paths must each enforce their own paired
        # unlevered benchmark envelope instead.
        self.assertFalse(recommendation["frontier"][-1]["eligible"])
        self.assertLess(recommendation["recommended_scale_bps"], 10_000)

    def test_bootstrap_replica_count_cannot_outvote_two_negative_evidence_families(self):
        risk_input = self._input()
        paths: list[dict[str, object]] = []
        for kind in ("WALK_FORWARD", "STRESS"):
            returns = [0] * 240 + [-10] * 12
            paths.append(
                {
                    "scenario_id": f"family_growth_{kind.lower()}",
                    "scenario_kind": kind,
                    "session_count": 253,
                    "strategy_returns_bps": returns,
                    "benchmark_returns_bps": list(returns),
                }
            )
        for index in range(8):
            returns = [20] * 240 + [-10] * 12
            paths.append(
                {
                    "scenario_id": f"family_growth_bootstrap_{index + 1}",
                    "scenario_kind": "BOOTSTRAP",
                    "session_count": 253,
                    "strategy_returns_bps": returns,
                    "benchmark_returns_bps": list(returns),
                }
            )
        risk_input["scenario_paths"] = paths
        risk_input["input_sha256"] = composer.calculate_risk_composer_input_sha256(risk_input)

        recommendation = composer.compose_long_horizon_risk_recommendation(risk_input)

        # Eight positive bootstrap replicas are one evidence family, not eight
        # votes that can hide negative walk-forward and stress results.
        self.assertEqual(recommendation["status"], "PARKED")
        self.assertEqual(
            recommendation["reason_codes"],
            ["NO_SCALE_MEETS_COMPOUNDING_AND_DRAWDOWN_CONSTRAINTS"],
        )

    def test_missing_long_horizon_scenario_kind_parks_instead_of_extrapolating_a_limit(self):
        risk_input = self._input()
        risk_input["scenario_paths"] = risk_input["scenario_paths"][:2]
        risk_input["input_sha256"] = composer.calculate_risk_composer_input_sha256(risk_input)

        recommendation = composer.compose_long_horizon_risk_recommendation(risk_input)

        self.assertEqual(recommendation["status"], "PARKED")
        self.assertEqual(recommendation["reason_codes"], ["SCENARIO_KIND_COVERAGE_INCOMPLETE"])
        self.assertIsNone(recommendation["recommended_scale_bps"])
        self.assertIsNone(recommendation["recommended_max_drawdown_bps"])
        self.assertEqual(recommendation, composer.validate_risk_composer_recommendation(recommendation))

    def test_short_or_duplicate_scenarios_cannot_supply_a_long_horizon_recommendation(self):
        short = self._input()
        short["scenario_paths"][0]["strategy_returns_bps"] = [10] * 251
        short["scenario_paths"][0]["benchmark_returns_bps"] = [8] * 251
        short["scenario_paths"][0]["session_count"] = 252
        short["input_sha256"] = composer.calculate_risk_composer_input_sha256(short)
        recommendation = composer.compose_long_horizon_risk_recommendation(short)
        self.assertEqual(recommendation["status"], "ADVISORY_RECOMMENDATION_READY")

        insufficient_sessions = self._input()
        insufficient_sessions["scenario_paths"][0]["strategy_returns_bps"] = [10] * 250
        insufficient_sessions["scenario_paths"][0]["benchmark_returns_bps"] = [8] * 250
        insufficient_sessions["scenario_paths"][0]["session_count"] = 251
        insufficient_sessions["input_sha256"] = composer.calculate_risk_composer_input_sha256(insufficient_sessions)
        recommendation = composer.compose_long_horizon_risk_recommendation(insufficient_sessions)
        self.assertEqual(recommendation["status"], "PARKED")
        self.assertIn("LONG_HORIZON_SESSION_COVERAGE_INCOMPLETE", recommendation["reason_codes"])

        duplicate = self._input()
        duplicate["scenario_paths"][1]["scenario_id"] = duplicate["scenario_paths"][0]["scenario_id"]
        duplicate["input_sha256"] = composer.calculate_risk_composer_input_sha256(duplicate)
        with self.assertRaisesRegex(composer.LongHorizonRiskComposerError, "scenario_id values must be unique"):
            composer.compose_long_horizon_risk_recommendation(duplicate)

    def test_tampering_with_evidence_or_smuggling_capital_fails_closed(self):
        risk_input = self._input()
        tampered = copy.deepcopy(risk_input)
        tampered["scenario_paths"][0]["strategy_returns_bps"][0] = 99
        with self.assertRaisesRegex(composer.LongHorizonRiskComposerError, "input_sha256 mismatch"):
            composer.compose_long_horizon_risk_recommendation(tampered)

        unsafe = self._input()
        unsafe["candidate"]["capital_amount"] = 1
        unsafe["input_sha256"] = composer.calculate_risk_composer_input_sha256(unsafe)
        with self.assertRaisesRegex(composer.LongHorizonRiskComposerError, "capital_amount is forbidden"):
            composer.compose_long_horizon_risk_recommendation(unsafe)

    def test_private_observation_needs_an_explicit_preference_before_composition(self):
        observation = self._observation()
        validated = composer.validate_long_horizon_risk_observation(observation)
        composer_input = composer.build_risk_composer_input_from_observation(
            validated,
            risk_preference="CAPITAL_PRESERVATION",
        )

        self.assertEqual(composer_input["objective"]["risk_preference"], "CAPITAL_PRESERVATION")
        self.assertEqual(composer_input["objective"]["benchmark_id"], "soxx")
        self.assertEqual(composer_input, composer.validate_risk_composer_input(composer_input))
        self.assertEqual(
            composer.compose_long_horizon_risk_recommendation(composer_input)["status"],
            "ADVISORY_RECOMMENDATION_READY",
        )

        tampered = copy.deepcopy(observation)
        tampered["benchmark"]["benchmark_id"] = "qqq"
        with self.assertRaisesRegex(composer.LongHorizonRiskComposerError, "observation_sha256 mismatch"):
            composer.build_risk_composer_input_from_observation(
                tampered,
                risk_preference="BALANCED_COMPOUNDING",
            )

    def test_cli_accepts_private_observation_but_not_an_implicit_preference(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            observation = root / "observation.json"
            output = root / "recommendation.json"
            observation.write_text(json.dumps(self._observation()), encoding="utf-8")

            self.assertEqual(
                composer.main(["--observation", str(observation), "--output", str(output)]),
                1,
            )
            self.assertFalse(output.exists())
            self.assertEqual(
                composer.main(
                    [
                        "--observation",
                        str(observation),
                        "--risk-preference",
                        "GROWTH_COMPOUNDING",
                        "--output",
                        str(output),
                    ]
                ),
                0,
            )
            result = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(result["objective"]["risk_preference"], "GROWTH_COMPOUNDING")
            self.assertNotIn("strategy_returns", json.dumps(result))

    def test_recommendation_digest_binds_the_frontier_and_prevents_policy_promotion_by_mutation(self):
        recommendation = composer.compose_long_horizon_risk_recommendation(self._input())
        tampered = copy.deepcopy(recommendation)
        tampered["frontier"][-1]["eligible"] = False
        with self.assertRaisesRegex(composer.LongHorizonRiskComposerError, "recommendation_sha256 mismatch"):
            composer.validate_risk_composer_recommendation(tampered)


if __name__ == "__main__":
    unittest.main()
