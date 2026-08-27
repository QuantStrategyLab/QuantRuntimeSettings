from __future__ import annotations

import copy
import importlib.util
import json
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


composer = _load_module("long_horizon_risk_composer")
composer_v2 = _load_module("long_horizon_risk_composer_v2")


class LongHorizonRiskObservationV2Test(unittest.TestCase):
    @staticmethod
    def _returns(gain_bps: int, drawdown_bps: int) -> list[int]:
        return [gain_bps] * 240 + [-drawdown_bps] * 12

    def _profile(self, preference: str = "BALANCED_COMPOUNDING") -> dict[str, object]:
        value: dict[str, object] = {
            "schema": "qsl.risk_profile_selection.v1",
            "profile_id": {
                "CAPITAL_PRESERVATION": "capital_preservation_v1",
                "BALANCED_COMPOUNDING": "balanced_compounding_v1",
                "GROWTH_COMPOUNDING": "growth_compounding_v1",
            }[preference],
            "risk_preference": preference,
            "selection_sha256": "",
        }
        value["selection_sha256"] = composer_v2.calculate_risk_profile_selection_sha256(value)
        return value

    def _observation(self) -> dict[str, object]:
        paths = [
            {
                "scenario_id": f"soxl_soxx_{kind.lower()}_{index}",
                "scenario_kind": kind,
                "session_count": 253,
                "strategy_returns_bps": self._returns(16 - index, 124 + index),
                "benchmark_returns_bps": self._returns(10 - index, 100 + index),
            }
            for index, kind in enumerate(("WALK_FORWARD", "BOOTSTRAP", "STRESS"), start=1)
        ]
        value: dict[str, object] = {
            "schema": "qsl.long_horizon_risk_observation.v2",
            "candidate": {
                "candidate_id": "soxl_soxx_longterm_compounding",
                "candidate_kind": "individual",
                "strategy_repository": "QuantStrategyLab/UsEquityStrategies",
                "strategy_revision": "a" * 40,
            },
            "source_evidence": {
                "p1_input_digest": "1" * 64,
                "p2_config_digest": "2" * 64,
                "p3_evidence_sha256": "3" * 64,
                "plugin_bundle_sha256": "4" * 64,
            },
            "risk_capability": {
                "portfolio_scope": "SINGLE_CANDIDATE",
                "return_evaluation": "LINEAR_NET_RETURN",
                "cashflow_treatment": "NOT_APPLICABLE",
                "risk_factor_coverage": ["CONCENTRATION", "LIQUIDITY"],
            },
            "benchmark_policy": {
                "benchmark_id": "soxx",
                "benchmark_kind": "UNLEVERED_REFERENCE",
                "calendar_id": "XNYS",
                "currency": "USD",
                "return_basis": "TOTAL_RETURN_NET_OF_COST",
                "definition_sha256": "5" * 64,
                "sessions_per_year": 252,
            },
            "scenario_paths": paths,
            "observation_sha256": "",
        }
        value["observation_sha256"] = composer_v2.calculate_risk_observation_v2_sha256(value)
        return value

    def test_portable_profile_and_supported_observation_produce_a_redacted_advisory(self):
        observation = self._observation()
        profile = self._profile()

        recommendation = composer_v2.compose_long_horizon_risk_recommendation_v2(observation, profile)

        self.assertEqual(recommendation["status"], "ADVISORY_RECOMMENDATION_READY")
        self.assertEqual(recommendation["risk_profile"], profile)
        self.assertEqual(recommendation["benchmark_policy"]["benchmark_kind"], "UNLEVERED_REFERENCE")
        self.assertEqual(recommendation, composer_v2.validate_risk_recommendation_v2(recommendation))
        rendered = json.dumps(recommendation, sort_keys=True).lower()
        self.assertNotIn("strategy_returns", rendered)
        self.assertNotIn("benchmark_returns", rendered)
        self.assertNotIn("account", rendered)
        self.assertNotIn("broker", rendered)

    def test_profile_is_hashed_and_cannot_claim_a_different_named_posture(self):
        profile = self._profile()
        tampered = copy.deepcopy(profile)
        tampered["risk_preference"] = "GROWTH_COMPOUNDING"
        with self.assertRaisesRegex(composer.LongHorizonRiskComposerError, "profile_id does not match"):
            composer_v2.validate_risk_profile_selection(tampered)

        tampered = copy.deepcopy(profile)
        tampered["profile_id"] = "growth_compounding_v1"
        tampered["selection_sha256"] = composer_v2.calculate_risk_profile_selection_sha256(tampered)
        with self.assertRaisesRegex(composer.LongHorizonRiskComposerError, "profile_id does not match"):
            composer_v2.validate_risk_profile_selection(tampered)

    def test_nonlinear_replay_requirement_parks_instead_of_scaling_return_paths(self):
        observation = self._observation()
        observation["risk_capability"]["return_evaluation"] = "REPLAY_REQUIRED"
        observation["observation_sha256"] = composer_v2.calculate_risk_observation_v2_sha256(observation)

        recommendation = composer_v2.compose_long_horizon_risk_recommendation_v2(observation, self._profile())

        self.assertEqual(recommendation["status"], "PARKED")
        self.assertEqual(recommendation["reason_codes"], ["RETURN_SCALE_REPLAY_REQUIRED"])
        self.assertIsNone(recommendation["recommended_scale_bps"])

    def test_portfolios_require_correlation_coverage_and_a_dedicated_portfolio_composer(self):
        observation = self._observation()
        observation["candidate"]["candidate_kind"] = "combo"
        observation["risk_capability"]["portfolio_scope"] = "PORTFOLIO"
        observation["observation_sha256"] = composer_v2.calculate_risk_observation_v2_sha256(observation)
        with self.assertRaisesRegex(composer.LongHorizonRiskComposerError, "must cover CORRELATION"):
            composer_v2.validate_long_horizon_risk_observation_v2(observation)

        observation["risk_capability"]["risk_factor_coverage"] = ["CONCENTRATION", "CORRELATION", "LIQUIDITY"]
        observation["benchmark_policy"]["benchmark_kind"] = "POLICY_BLEND"
        observation["observation_sha256"] = composer_v2.calculate_risk_observation_v2_sha256(observation)
        recommendation = composer_v2.compose_long_horizon_risk_recommendation_v2(observation, self._profile())
        self.assertEqual(recommendation["status"], "PARKED")
        self.assertEqual(
            recommendation["reason_codes"],
            ["PORTFOLIO_COMPOSER_REQUIRED", "BENCHMARK_POLICY_COMPOSER_REQUIRED"],
        )

    def test_cashflow_matched_strategies_cannot_be_coerced_to_time_weighted_linear_math(self):
        observation = self._observation()
        observation["risk_capability"]["cashflow_treatment"] = "CASHFLOW_MATCHED"
        observation["benchmark_policy"]["return_basis"] = "CASHFLOW_MATCHED_RETURN"
        observation["observation_sha256"] = composer_v2.calculate_risk_observation_v2_sha256(observation)

        recommendation = composer_v2.compose_long_horizon_risk_recommendation_v2(observation, self._profile())

        self.assertEqual(recommendation["status"], "PARKED")
        self.assertEqual(
            recommendation["reason_codes"],
            ["CASHFLOW_COMPOSER_REQUIRED", "BENCHMARK_RETURN_BASIS_COMPOSER_REQUIRED"],
        )

        invalid = copy.deepcopy(observation)
        invalid["benchmark_policy"]["return_basis"] = "TOTAL_RETURN_NET_OF_COST"
        invalid["observation_sha256"] = composer_v2.calculate_risk_observation_v2_sha256(invalid)
        with self.assertRaisesRegex(composer.LongHorizonRiskComposerError, "requires CASHFLOW_MATCHED_RETURN"):
            composer_v2.validate_long_horizon_risk_observation_v2(invalid)

    def test_split_adjusted_price_benchmark_is_represented_but_not_mislabeled_as_total_return(self):
        observation = self._observation()
        observation["benchmark_policy"]["return_basis"] = "SPLIT_ADJUSTED_PRICE_RETURN"
        observation["observation_sha256"] = composer_v2.calculate_risk_observation_v2_sha256(observation)

        recommendation = composer_v2.compose_long_horizon_risk_recommendation_v2(observation, self._profile())

        self.assertEqual(recommendation["status"], "PARKED")
        self.assertEqual(recommendation["reason_codes"], ["BENCHMARK_RETURN_BASIS_COMPOSER_REQUIRED"])
        self.assertIsNone(recommendation["recommended_scale_bps"])


if __name__ == "__main__":
    unittest.main()
