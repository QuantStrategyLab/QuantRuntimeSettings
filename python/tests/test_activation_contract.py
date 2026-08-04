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


deployment_bundle_contract = _load_module("deployment_bundle_contract")
activation_contract = _load_module("activation_contract")


class ActivationContractTest(unittest.TestCase):
    @staticmethod
    def _sha(character: str) -> str:
        return character * 64

    @staticmethod
    def _revision(character: str) -> str:
        return character * 40

    def _bundle(self) -> dict[str, object]:
        bundle: dict[str, object] = {
            "schema": "qsl.deployment_bundle.v1",
            "bundle_id": "bundle.soxl-signal.ibkr-us.20260805",
            "created_at": "2026-08-05T08:00:00Z",
            "digest_algorithm": "sha256",
            "strategy": {
                "id": "soxl-signal",
                "source_id": "us-equity-strategies",
                "revision": self._revision("a"),
                "artifact_sha256": self._sha("b"),
            },
            "profile": {
                "id": "research-profile",
                "revision": self._revision("c"),
                "artifact_sha256": self._sha("d"),
            },
            "config": {
                "id": "ibkr-us-config",
                "revision": self._revision("e"),
                "artifact_sha256": self._sha("f"),
            },
            "evidence": {
                "id": "soxl-evidence",
                "revision": self._revision("1"),
                "artifact_sha256": self._sha("2"),
            },
            "target": {"id": "ibkr-us", "platform_id": "interactive-brokers"},
            "dependencies": {
                "qpk": {
                    "id": "quant-platform-kit",
                    "revision": self._revision("3"),
                    "artifact_sha256": self._sha("4"),
                },
                "strategy": {
                    "id": "us-equity-strategies",
                    "revision": self._revision("a"),
                    "artifact_sha256": self._sha("5"),
                },
                "pipeline": {
                    "id": "crypto-live-pool-pipelines",
                    "revision": self._revision("6"),
                    "artifact_sha256": self._sha("7"),
                },
                "platform": {
                    "id": "interactive-brokers",
                    "revision": self._revision("8"),
                    "artifact_sha256": self._sha("9"),
                },
            },
        }
        bundle["bundle_sha256"] = deployment_bundle_contract.calculate_bundle_sha256(bundle)
        return bundle

    def _activation(self, *, stage: str = "PAPER_DRY_RUN") -> dict[str, object]:
        bundle = self._bundle()
        activation: dict[str, object] = {
            "schema": "qsl.activation.v1",
            "activation_id": "activation.soxl-signal.ibkr-us.paper.20260805",
            "created_at": "2026-08-05T09:00:00Z",
            "digest_algorithm": "sha256",
            "contract_only": True,
            "deployment_bundle": {
                "schema": bundle["schema"],
                "bundle_id": bundle["bundle_id"],
                "bundle_sha256": bundle["bundle_sha256"],
            },
            "stage": stage,
            "effective_at": "2026-08-05T10:00:00Z",
            "expires_at": "2026-08-05T18:00:00Z",
            "human_authority": {
                "stage": stage,
                "authority_id": f"human-authority.{stage.lower().replace('_', '-')}.20260805",
                "authority_version": "v1",
                "authority_receipt_sha256": self._sha("c"),
            },
            "target": {
                "platform": "interactive-brokers",
                "repository": "QuantStrategyLab/InteractiveBrokersPlatform",
                "revision": self._revision("8"),
                "environment": "ibkr-paper",
                "account_alias": "ibkr-research",
                "account_digest_sha256": self._sha("d"),
            },
        }
        activation["activation_sha256"] = activation_contract.calculate_activation_sha256(activation)
        return activation

    def _validate(self, activation: dict[str, object], **kwargs):
        return activation_contract.validate_activation(
            activation,
            as_of="2026-08-05T12:00:00Z",
            expected_bundle=kwargs.pop("expected_bundle", self._bundle()),
            **kwargs,
        )

    def test_schema_is_closed_contract_only_and_uses_canonical_stages(self):
        schema = json.loads((ROOT.parent / "schemas" / "qsl-activation.v1.schema.json").read_text())
        self.assertEqual(schema["$id"], "qsl.activation.v1")
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(schema["properties"]["contract_only"], {"const": True})
        self.assertEqual(
            schema["properties"]["stage"]["enum"],
            ["DISABLED", "PAPER_DRY_RUN", "SHADOW", "LIMITED_LIVE", "FULL_LIVE"],
        )
        self.assertIn("does not prove", schema["description"])
        for field in ("created_at", "effective_at", "expires_at"):
            self.assertEqual(schema["properties"][field]["format"], "date-time")

    def test_valid_activation_binds_bundle_authority_target_and_digest(self):
        activation = self._activation()
        validated = self._validate(activation)
        self.assertEqual(validated["activation_sha256"], activation_contract.calculate_activation_sha256(activation))
        self.assertEqual(
            activation_contract.canonical_json(activation),
            activation_contract.canonical_json(dict(reversed(activation.items()))),
        )

    def test_every_canonical_stage_requires_matching_human_authority(self):
        for stage in ("DISABLED", "PAPER_DRY_RUN", "SHADOW", "LIMITED_LIVE", "FULL_LIVE"):
            with self.subTest(stage=stage):
                activation = self._activation(stage=stage)
                self._validate(activation)
                activation["human_authority"]["stage"] = "DISABLED" if stage != "DISABLED" else "SHADOW"
                activation["activation_sha256"] = activation_contract.calculate_activation_sha256(activation)
                with self.assertRaisesRegex(activation_contract.ActivationValidationError, "authority stage"):
                    self._validate(activation)

    def test_missing_unknown_and_invalid_contract_only_fields_fail_closed(self):
        for mutate, message in (
            (lambda value: value.pop("target"), "missing required field"),
            (lambda value: value.pop("human_authority"), "missing required field"),
            (lambda value: value.update({"applied": True}), "forbidden"),
            (lambda value: value.update({"contract_only": False}), "contract_only"),
        ):
            with self.subTest(message=message):
                activation = self._activation()
                mutate(activation)
                activation["activation_sha256"] = activation_contract.calculate_activation_sha256(activation)
                with self.assertRaisesRegex(activation_contract.ActivationValidationError, message):
                    self._validate(activation)

    def test_bundle_reference_and_platform_revision_mismatch_fail_closed(self):
        for mutate, message in (
            (lambda value: value["deployment_bundle"].update({"bundle_sha256": self._sha("0")}), "bundle reference"),
            (lambda value: value["deployment_bundle"].update({"bundle_id": "bundle.other"}), "bundle reference"),
            (lambda value: value["target"].update({"platform": "binance-platform"}), "bundle target"),
            (lambda value: value["target"].update({"revision": self._revision("0")}), "platform revision"),
        ):
            with self.subTest(message=message):
                activation = self._activation()
                mutate(activation)
                activation["activation_sha256"] = activation_contract.calculate_activation_sha256(activation)
                with self.assertRaisesRegex(activation_contract.ActivationValidationError, message):
                    self._validate(activation)

    def test_time_window_is_calendar_valid_ordered_current_and_injectable(self):
        for field, timestamp in (
            ("created_at", "2026-02-30T09:00:00Z"),
            ("effective_at", "2026-08-05T10:00:00+00:00"),
            ("expires_at", "2026-13-05T18:00:00Z"),
        ):
            with self.subTest(field=field):
                activation = self._activation()
                activation[field] = timestamp
                activation["activation_sha256"] = activation_contract.calculate_activation_sha256(activation)
                with self.assertRaisesRegex(activation_contract.ActivationValidationError, "timestamp"):
                    self._validate(activation)

        activation = self._activation()
        activation["expires_at"] = activation["effective_at"]
        activation["activation_sha256"] = activation_contract.calculate_activation_sha256(activation)
        with self.assertRaisesRegex(activation_contract.ActivationValidationError, "after effective_at"):
            self._validate(activation)
        with self.assertRaisesRegex(activation_contract.ActivationValidationError, "not yet effective"):
            activation_contract.validate_activation(
                self._activation(), as_of="2026-08-05T09:59:59Z", expected_bundle=self._bundle()
            )
        with self.assertRaisesRegex(activation_contract.ActivationValidationError, "expired"):
            activation_contract.validate_activation(
                self._activation(), as_of="2026-08-05T18:00:00Z", expected_bundle=self._bundle()
            )

    def test_authority_expectation_and_cross_stage_reuse_fail_closed(self):
        activation = self._activation()
        expected = copy.deepcopy(activation["human_authority"])
        expected["authority_receipt_sha256"] = self._sha("0")
        with self.assertRaisesRegex(activation_contract.ActivationValidationError, "authority reference"):
            self._validate(activation, expected_authority=expected)

        previous = self._activation(stage="PAPER_DRY_RUN")
        current = self._activation(stage="SHADOW")
        current["human_authority"] = copy.deepcopy(previous["human_authority"])
        current["human_authority"]["stage"] = "SHADOW"
        current["activation_sha256"] = activation_contract.calculate_activation_sha256(current)
        with self.assertRaisesRegex(activation_contract.ActivationValidationError, "cross-stage authority reuse"):
            self._validate(current, previous_activation=previous)

        fresh = self._activation(stage="SHADOW")
        fresh["human_authority"]["authority_receipt_sha256"] = self._sha("e")
        fresh["activation_sha256"] = activation_contract.calculate_activation_sha256(fresh)
        self._validate(fresh, previous_activation=previous)

    def test_mutation_requires_recomputed_activation_digest(self):
        activation = self._activation()
        activation["target"]["environment"] = "ibkr-shadow"
        with self.assertRaisesRegex(activation_contract.ActivationValidationError, "activation_sha256 mismatch"):
            self._validate(activation)

    def test_digest_identity_and_repository_formats_are_strict(self):
        for mutate, message in (
            (lambda value: value["target"].update({"account_digest_sha256": self._sha("A")}), "lowercase SHA-256"),
            (lambda value: value["target"].update({"revision": "main"}), "40-character revision"),
            (lambda value: value["target"].update({"repository": "https://github.com/org/repo"}), "forbidden URL"),
            (lambda value: value["target"].update({"account_alias": "12345678"}), "account_alias"),
        ):
            with self.subTest(message=message):
                activation = self._activation()
                mutate(activation)
                activation["activation_sha256"] = activation_contract.calculate_activation_sha256(activation)
                with self.assertRaisesRegex(activation_contract.ActivationValidationError, message):
                    self._validate(activation)

    def test_secret_order_capital_fill_and_credential_url_material_fail_closed(self):
        for key, value in (
            ("token", "not-a-real-token"),
            ("password", "not-a-real-password"),
            ("order_id", "no-order"),
            ("capital", 0),
            ("fill", {}),
            ("credential_url", "https://user:password@example.invalid"),
        ):
            with self.subTest(key=key):
                activation = self._activation()
                activation[key] = value
                activation["activation_sha256"] = activation_contract.calculate_activation_sha256(activation)
                with self.assertRaisesRegex(activation_contract.ActivationValidationError, "forbidden"):
                    self._validate(activation)

    def test_non_finite_and_duplicate_json_keys_fail_closed(self):
        activation = self._activation()
        activation["unknown"] = float("nan")
        with self.assertRaisesRegex(activation_contract.ActivationValidationError, "non-finite"):
            self._validate(activation)
        encoded = json.dumps(self._activation())[:-1] + ',"stage":"SHADOW"}'
        with self.assertRaisesRegex(activation_contract.ActivationValidationError, "duplicate JSON key"):
            activation_contract.parse_activation_json(encoded, as_of="2026-08-05T12:00:00Z")

    def test_activation_digest_excludes_only_its_own_hash(self):
        activation = self._activation()
        canonical = activation_contract.canonical_json(activation)
        self.assertNotIn("activation_sha256", canonical)
        replacement = copy.deepcopy(activation)
        replacement["activation_sha256"] = self._sha("0")
        self.assertEqual(
            activation_contract.calculate_activation_sha256(activation),
            activation_contract.calculate_activation_sha256(replacement),
        )


if __name__ == "__main__":
    unittest.main()
