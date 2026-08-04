from __future__ import annotations

import importlib.util
import json
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
AS_OF = "2026-08-05T12:00:00Z"


def _load_module(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


deployment_bundle_contract = _load_module("deployment_bundle_contract")
activation_contract = _load_module("activation_contract")
reconciliation_record_contract = _load_module("reconciliation_record_contract")


class ControlContractCompositionTest(unittest.TestCase):
    @staticmethod
    def _sha(character: str) -> str:
        return character * 64

    @staticmethod
    def _revision(character: str) -> str:
        return character * 40

    def _bundle(self, *, platform: str = "interactive-brokers") -> dict[str, object]:
        bundle: dict[str, object] = {
            "schema": "qsl.deployment_bundle.v1",
            "bundle_id": f"bundle.synthetic.{platform}.20260805",
            "created_at": "2026-08-05T08:00:00Z",
            "digest_algorithm": "sha256",
            "strategy": {
                "id": "synthetic-strategy",
                "source_id": "synthetic-strategy-source",
                "revision": self._revision("a"),
                "artifact_sha256": self._sha("b"),
            },
            "profile": {
                "id": "synthetic-profile",
                "revision": self._revision("c"),
                "artifact_sha256": self._sha("d"),
            },
            "config": {
                "id": "synthetic-config",
                "revision": self._revision("e"),
                "artifact_sha256": self._sha("f"),
            },
            "evidence": {
                "id": "synthetic-evidence",
                "revision": self._revision("1"),
                "artifact_sha256": self._sha("2"),
            },
            "target": {"id": f"synthetic-{platform}", "platform_id": platform},
            "dependencies": {
                "qpk": {"id": "quant-platform-kit", "revision": self._revision("3"), "artifact_sha256": self._sha("4")},
                "strategy": {"id": "synthetic-strategy-source", "revision": self._revision("a"), "artifact_sha256": self._sha("5")},
                "pipeline": {"id": "synthetic-pipeline", "revision": self._revision("6"), "artifact_sha256": self._sha("7")},
                "platform": {"id": platform, "revision": self._revision("8"), "artifact_sha256": self._sha("9")},
            },
        }
        bundle["bundle_sha256"] = deployment_bundle_contract.calculate_bundle_sha256(bundle)
        return bundle

    def _activation(self, bundle: dict[str, object]) -> dict[str, object]:
        activation: dict[str, object] = {
            "schema": "qsl.activation.v1",
            "activation_id": "activation.synthetic.disabled.20260805",
            "created_at": "2026-08-05T09:00:00Z",
            "digest_algorithm": "sha256",
            "contract_only": True,
            "deployment_bundle": {
                "schema": bundle["schema"],
                "bundle_id": bundle["bundle_id"],
                "bundle_sha256": bundle["bundle_sha256"],
            },
            "stage": "DISABLED",
            "effective_at": "2026-08-05T10:00:00Z",
            "expires_at": "2026-08-05T18:00:00Z",
            "human_authority": {
                "stage": "DISABLED",
                "authority_id": "synthetic-human-authority.disabled.20260805",
                "authority_version": "v1",
                "authority_receipt_sha256": self._sha("c"),
            },
            "target": {
                "platform": bundle["target"]["platform_id"],
                "repository": "QuantStrategyLab/InteractiveBrokersPlatform",
                "revision": bundle["dependencies"]["platform"]["revision"],
                "environment": "synthetic-disabled",
                "account_alias": "synthetic-research",
                "account_digest_sha256": self._sha("d"),
            },
        }
        activation["activation_sha256"] = activation_contract.calculate_activation_sha256(activation)
        return activation

    def _composition(self) -> tuple[dict[str, object], dict[str, object], dict[str, object]]:
        bundle = self._bundle()
        activation = self._activation(bundle)
        record = reconciliation_record_contract.build_missing_record(
            record_id="reconciliation.synthetic.disabled.20260805",
            produced_at="2026-08-05T11:00:00Z",
            expires_at="2026-08-05T17:00:00Z",
            expected_bundle=bundle,
            expected_activation=activation,
            as_of=AS_OF,
        )
        return bundle, activation, record

    def _validate(self, bundle, activation, record):
        deployment_bundle_contract.validate_bundle(bundle)
        activation_contract.validate_activation(activation, expected_bundle=bundle, as_of=AS_OF)
        return reconciliation_record_contract.validate_reconciliation_record(
            record,
            expected_bundle=bundle,
            expected_activation=activation,
            as_of=AS_OF,
        )

    def test_synthetic_disabled_composition_is_exact_and_deterministic(self):
        bundle, activation, record = self._composition()
        validated = self._validate(bundle, activation, record)
        self.assertEqual(activation["stage"], "DISABLED")
        self.assertTrue(activation["contract_only"])
        self.assertEqual(record["status"], "MISSING")
        self.assertTrue(record["contract_only"])
        self.assertEqual(
            record["assertions"],
            {
                "apply_performed": False,
                "config_sync_performed": False,
                "runtime_mutation_performed": False,
                "runtime_active_verified": False,
                "fills_verified": False,
                "capital_use_verified": False,
            },
        )
        self.assertEqual(validated["deployment_bundle"]["bundle_sha256"], bundle["bundle_sha256"])
        self.assertEqual(validated["activation"]["activation_sha256"], activation["activation_sha256"])
        self.assertEqual(validated["expected_identity"]["deployment_bundle_sha256"], bundle["bundle_sha256"])
        self.assertEqual(validated["expected_identity"]["activation_sha256"], activation["activation_sha256"])
        self.assertEqual(
            deployment_bundle_contract.calculate_bundle_sha256(bundle),
            deployment_bundle_contract.calculate_bundle_sha256(dict(reversed(bundle.items()))),
        )
        self.assertEqual(
            activation_contract.calculate_activation_sha256(activation),
            activation_contract.calculate_activation_sha256(dict(reversed(activation.items()))),
        )
        self.assertEqual(
            reconciliation_record_contract.calculate_reconciliation_sha256(record),
            reconciliation_record_contract.calculate_reconciliation_sha256(dict(reversed(record.items()))),
        )
        rebuilt = self._composition()
        self.assertEqual(json.dumps((bundle, activation, record), sort_keys=True), json.dumps(rebuilt, sort_keys=True))

    def test_bundle_mutations_fail_closed_through_activation_and_reconciliation_chain(self):
        for mutate in (
            lambda value: value["strategy"].update({"id": "mutated-strategy"}),
            lambda value: value["dependencies"]["strategy"].update({"artifact_sha256": self._sha("0")}),
            lambda value: value["evidence"].update({"artifact_sha256": self._sha("0")}),
        ):
            with self.subTest(mutate=mutate):
                bundle, activation, record = self._composition()
                mutate(bundle)
                with self.assertRaises((activation_contract.ActivationValidationError, reconciliation_record_contract.ReconciliationValidationError)):
                    activation_contract.validate_activation(activation, expected_bundle=bundle, as_of=AS_OF)
                with self.assertRaises(reconciliation_record_contract.ReconciliationValidationError):
                    reconciliation_record_contract.validate_reconciliation_record(
                        record, expected_bundle=bundle, expected_activation=activation, as_of=AS_OF
                    )

    def test_activation_mutations_fail_closed_through_reconciliation_chain(self):
        mutations = (
            lambda value: value.update({"activation_id": "activation.synthetic.other.20260805"}),
            lambda value: value.update({"activation_sha256": self._sha("0")}),
            lambda value: value["target"].update({"environment": "synthetic-other"}),
            lambda value: value.update({"stage": "PAPER_DRY_RUN"}),
            lambda value: value.update({"effective_at": "2026-08-05T11:30:00Z"}),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                bundle, activation, record = self._composition()
                mutate(activation)
                if activation["stage"] != activation["human_authority"]["stage"]:
                    activation["human_authority"]["stage"] = activation["stage"]
                if activation["activation_sha256"] != self._sha("0"):
                    activation["activation_sha256"] = activation_contract.calculate_activation_sha256(activation)
                with self.assertRaises(reconciliation_record_contract.ReconciliationValidationError):
                    reconciliation_record_contract.validate_reconciliation_record(
                        record, expected_bundle=bundle, expected_activation=activation, as_of=AS_OF
                    )

    def test_non_missing_observer_and_comparison_material_is_rejected(self):
        for field, value in (
            ("status", "MATCHED"),
            ("status", "MISMATCHED"),
            ("observer", {"id": "synthetic-observer"}),
            ("observation", {"observed_at": "2026-08-05T11:00:00Z"}),
            ("comparison", {"complete": False}),
        ):
            with self.subTest(field=field):
                bundle, activation, record = self._composition()
                record[field] = value
                record["reconciliation_sha256"] = reconciliation_record_contract.calculate_reconciliation_sha256(record)
                with self.assertRaises(reconciliation_record_contract.ReconciliationValidationError):
                    self._validate(bundle, activation, record)

    def test_unsafe_material_and_invalid_synthetic_inputs_fail_closed(self):
        for key, value in (
            ("unknown", {"nested": True}),
            ("credential", "not-a-credential"),
            ("raw_payload", {"synthetic": True}),
            ("account", {"number": "00000000"}),
            ("order", {"id": "synthetic-order"}),
            ("fill", {"id": "synthetic-fill"}),
            ("capital", {"amount": 1}),
        ):
            with self.subTest(key=key):
                bundle, activation, record = self._composition()
                record["expected_identity"][key] = value
                record["reconciliation_sha256"] = reconciliation_record_contract.calculate_reconciliation_sha256(record)
                with self.assertRaises(reconciliation_record_contract.ReconciliationValidationError):
                    self._validate(bundle, activation, record)

        bundle, activation, record = self._composition()
        bundle["created_at"] = "2026-02-30T08:00:00Z"
        bundle["bundle_sha256"] = deployment_bundle_contract.calculate_bundle_sha256(bundle)
        with self.assertRaises(deployment_bundle_contract.BundleValidationError):
            deployment_bundle_contract.validate_bundle(bundle)

        bundle, activation, record = self._composition()
        record["produced_at"] = "2026-02-30T11:00:00Z"
        record["reconciliation_sha256"] = reconciliation_record_contract.calculate_reconciliation_sha256(record)
        with self.assertRaises(reconciliation_record_contract.ReconciliationValidationError):
            self._validate(bundle, activation, record)

        bundle, activation, record = self._composition()
        record["assertions"]["runtime_active_verified"] = math.nan
        with self.assertRaises(reconciliation_record_contract.ReconciliationValidationError):
            self._validate(bundle, activation, record)

        bundle, activation, record = self._composition()
        other_bundle = self._bundle(platform="binance-platform")
        with self.assertRaises(reconciliation_record_contract.ReconciliationValidationError):
            reconciliation_record_contract.validate_reconciliation_record(
                record, expected_bundle=other_bundle, expected_activation=activation, as_of=AS_OF
            )

    def test_serialized_synthetic_composition_has_no_credentials_or_business_payload(self):
        composition = json.dumps(self._composition(), sort_keys=True)
        for forbidden in ("credential", "secret", "token", "password", "raw_payload", "orders", "capital_value"):
            self.assertNotIn(forbidden, composition.lower())


if __name__ == "__main__":
    unittest.main()
