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
ingress_v2 = _load_module("long_horizon_risk_observation_ingress_v2")


class LongHorizonRiskObservationV2IngressTest(unittest.TestCase):
    @staticmethod
    def _returns(gain_bps: int, drawdown_bps: int) -> list[int]:
        return [gain_bps] * 240 + [-drawdown_bps] * 12

    def _profile(self) -> dict[str, object]:
        value: dict[str, object] = {
            "schema": "qsl.risk_profile_selection.v1",
            "profile_id": "balanced_compounding_v1",
            "risk_preference": "BALANCED_COMPOUNDING",
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

    def test_reads_one_exact_v2_object_then_returns_only_a_redacted_recommendation(self):
        observation = self._observation()
        raw = json.dumps(observation, sort_keys=True, separators=(",", ":")).encode("utf-8")
        calls: list[str] = []

        result = ingress_v2.compose_from_private_long_horizon_risk_observation_v2(
            candidate_id="soxl_soxx_longterm_compounding",
            p3_evidence_sha256="3" * 64,
            profile_selection=self._profile(),
            read_exact=lambda object_name: calls.append(object_name) or raw,
        )

        self.assertEqual(
            calls,
            [
                "long-horizon-risk-observations/v2/soxl_soxx_longterm_compounding/"
                + ("3" * 64)
                + ".json"
            ],
        )
        self.assertEqual(result["status"], "ADVISORY_RECOMMENDATION_READY")
        rendered = json.dumps(result, sort_keys=True).lower()
        self.assertNotIn("strategy_returns", rendered)
        self.assertNotIn("benchmark_returns", rendered)
        self.assertNotIn("account", rendered)
        self.assertNotIn("broker", rendered)

    def test_invalid_profile_or_tampered_observation_fails_closed_without_fallback(self):
        observation = self._observation()
        raw = json.dumps(observation).encode("utf-8")
        invalid_profile = self._profile()
        invalid_profile["selection_sha256"] = "0" * 64
        with self.assertRaisesRegex(ingress_v2.LongHorizonRiskObservationV2IngressError, "unavailable"):
            ingress_v2.compose_from_private_long_horizon_risk_observation_v2(
                candidate_id="soxl_soxx_longterm_compounding",
                p3_evidence_sha256="3" * 64,
                profile_selection=invalid_profile,
                read_exact=lambda _object_name: raw,
            )

        tampered = copy.deepcopy(observation)
        tampered["scenario_paths"][0]["strategy_returns_bps"][0] = 99
        with self.assertRaisesRegex(ingress_v2.LongHorizonRiskObservationV2IngressError, "unavailable"):
            ingress_v2.load_private_long_horizon_risk_observation_v2(
                candidate_id="soxl_soxx_longterm_compounding",
                p3_evidence_sha256="3" * 64,
                read_exact=lambda _object_name: json.dumps(tampered).encode("utf-8"),
            )

    def test_invalid_identity_never_reaches_the_injected_reader(self):
        calls: list[str] = []
        with self.assertRaisesRegex(ingress_v2.LongHorizonRiskObservationV2IngressError, "unavailable"):
            ingress_v2.load_private_long_horizon_risk_observation_v2(
                candidate_id="../latest",
                p3_evidence_sha256="3" * 64,
                read_exact=lambda object_name: calls.append(object_name) or b"{}",
            )
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
