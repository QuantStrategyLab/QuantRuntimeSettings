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
ingress = _load_module("long_horizon_risk_observation_ingress")


class LongHorizonRiskObservationIngressTest(unittest.TestCase):
    @staticmethod
    def _returns(gain_bps: int, drawdown_bps: int) -> list[int]:
        return [gain_bps] * 240 + [-drawdown_bps] * 12

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
        result: dict[str, object] = {
            "schema": "qsl.long_horizon_risk_observation.v1",
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
            "benchmark": {
                "benchmark_id": "soxx",
                "benchmark_kind": "unlevered_reference",
                "sessions_per_year": 252,
            },
            "scenario_paths": paths,
            "observation_sha256": "",
        }
        result["observation_sha256"] = composer.calculate_risk_observation_sha256(result)
        return result

    def test_reads_only_the_exact_candidate_and_p3_object_then_returns_a_redacted_recommendation(self):
        observation = self._observation()
        raw = json.dumps(observation, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        calls: list[str] = []

        result = ingress.compose_from_private_long_horizon_risk_observation(
            candidate_id="soxl_soxx_longterm_compounding",
            p3_evidence_sha256="3" * 64,
            risk_preference="BALANCED_COMPOUNDING",
            read_exact=lambda object_name: calls.append(object_name) or raw,
        )

        self.assertEqual(
            calls,
            [
                "long-horizon-risk-observations/v1/soxl_soxx_longterm_compounding/"
                + ("3" * 64)
                + ".json"
            ],
        )
        self.assertEqual(result["status"], "ADVISORY_RECOMMENDATION_READY")
        serialized = json.dumps(result, sort_keys=True).lower()
        self.assertNotIn("strategy_returns", serialized)
        self.assertNotIn("benchmark_returns", serialized)
        self.assertNotIn("broker", serialized)
        self.assertNotIn("account", serialized)

    def test_reader_failure_tampering_and_identity_mismatch_fail_closed_without_fallback(self):
        observation = self._observation()
        raw = json.dumps(observation).encode("utf-8")
        with self.assertRaisesRegex(ingress.LongHorizonRiskObservationIngressError, "unavailable"):
            ingress.load_private_long_horizon_risk_observation(
                candidate_id="soxl_soxx_longterm_compounding",
                p3_evidence_sha256="3" * 64,
                read_exact=lambda _object_name: (_ for _ in ()).throw(RuntimeError("storage hostname")),
            )

        tampered = copy.deepcopy(observation)
        tampered["scenario_paths"][0]["strategy_returns_bps"][0] = 99
        with self.assertRaisesRegex(ingress.LongHorizonRiskObservationIngressError, "unavailable"):
            ingress.load_private_long_horizon_risk_observation(
                candidate_id="soxl_soxx_longterm_compounding",
                p3_evidence_sha256="3" * 64,
                read_exact=lambda _object_name: json.dumps(tampered).encode("utf-8"),
            )

        with self.assertRaisesRegex(ingress.LongHorizonRiskObservationIngressError, "unavailable"):
            ingress.load_private_long_horizon_risk_observation(
                candidate_id="soxl_soxx_longterm_compounding",
                p3_evidence_sha256="4" * 64,
                read_exact=lambda _object_name: raw,
            )

    def test_invalid_identities_and_oversized_input_never_reach_the_reader(self):
        calls: list[str] = []
        with self.assertRaisesRegex(ingress.LongHorizonRiskObservationIngressError, "unavailable"):
            ingress.load_private_long_horizon_risk_observation(
                candidate_id="../latest",
                p3_evidence_sha256="3" * 64,
                read_exact=lambda object_name: calls.append(object_name) or b"{}",
            )
        self.assertEqual(calls, [])

        with self.assertRaisesRegex(ingress.LongHorizonRiskObservationIngressError, "unavailable"):
            ingress.load_private_long_horizon_risk_observation(
                candidate_id="soxl_soxx_longterm_compounding",
                p3_evidence_sha256="3" * 64,
                read_exact=lambda _object_name: b"x" * (ingress.MAX_PRIVATE_OBSERVATION_BYTES + 1),
            )


if __name__ == "__main__":
    unittest.main()
