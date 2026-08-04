from __future__ import annotations

import copy
import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "deployment_bundle_contract.py"
MODULE_SPEC = importlib.util.spec_from_file_location("deployment_bundle_contract", MODULE_PATH)
deployment_bundle_contract = importlib.util.module_from_spec(MODULE_SPEC)
assert MODULE_SPEC.loader is not None
sys.modules[MODULE_SPEC.name] = deployment_bundle_contract
MODULE_SPEC.loader.exec_module(deployment_bundle_contract)


class DeploymentBundleContractTest(unittest.TestCase):
    @staticmethod
    def _sha(character: str) -> str:
        return character * 64

    @staticmethod
    def _revision(character: str) -> str:
        return character * 40

    def _bundle(self) -> dict[str, object]:
        bundle: dict[str, object] = {
            "schema": "qsl.deployment_bundle.v1",
            "bundle_id": "bundle.soxl-signal.ibkr-us.20260804",
            "created_at": "2026-08-04T15:30:00Z",
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

    def test_valid_bundle_has_deterministic_canonical_digest(self):
        bundle = self._bundle()

        validated = deployment_bundle_contract.validate_bundle(bundle)

        self.assertEqual(validated["bundle_sha256"], deployment_bundle_contract.calculate_bundle_sha256(bundle))
        self.assertEqual(
            deployment_bundle_contract.canonical_json(bundle),
            deployment_bundle_contract.canonical_json(dict(reversed(bundle.items()))),
        )

    def test_mutation_requires_a_recomputed_bundle_digest(self):
        bundle = self._bundle()
        bundle["config"]["revision"] = self._revision("0")

        with self.assertRaisesRegex(deployment_bundle_contract.BundleValidationError, "bundle_sha256 mismatch"):
            deployment_bundle_contract.validate_bundle(bundle)

    def test_stale_or_invalid_identity_fails_closed_even_with_recomputed_digest(self):
        bundle = self._bundle()
        bundle["strategy"]["source_id"] = "obsolete-strategy-source"
        bundle["bundle_sha256"] = deployment_bundle_contract.calculate_bundle_sha256(bundle)

        with self.assertRaisesRegex(deployment_bundle_contract.BundleValidationError, "strategy.source_id"):
            deployment_bundle_contract.validate_bundle(bundle)

    def test_unknown_field_and_uppercase_digest_fail_closed(self):
        bundle = self._bundle()
        bundle["unexpected"] = "value"
        bundle["bundle_sha256"] = deployment_bundle_contract.calculate_bundle_sha256(bundle)

        with self.assertRaisesRegex(deployment_bundle_contract.BundleValidationError, "unknown field"):
            deployment_bundle_contract.validate_bundle(bundle)

        bundle = self._bundle()
        bundle["evidence"]["artifact_sha256"] = self._sha("A")
        bundle["bundle_sha256"] = deployment_bundle_contract.calculate_bundle_sha256(bundle)
        with self.assertRaisesRegex(deployment_bundle_contract.BundleValidationError, "lowercase SHA-256"):
            deployment_bundle_contract.validate_bundle(bundle)

    def test_secret_and_authority_bearing_data_fail_closed(self):
        for key, value in (
            ("token", "not-a-real-token"),
            ("activation", "allowed"),
            ("artifact_url", "https://user:password@example.invalid/artifact"),
        ):
            with self.subTest(key=key):
                bundle = self._bundle()
                bundle[key] = value
                bundle["bundle_sha256"] = deployment_bundle_contract.calculate_bundle_sha256(bundle)
                with self.assertRaisesRegex(deployment_bundle_contract.BundleValidationError, "forbidden"):
                    deployment_bundle_contract.validate_bundle(bundle)

    def test_non_finite_values_and_duplicate_json_keys_fail_closed(self):
        bundle = self._bundle()
        bundle["unknown"] = float("nan")
        with self.assertRaisesRegex(deployment_bundle_contract.BundleValidationError, "non-finite"):
            deployment_bundle_contract.validate_bundle(bundle)

        encoded = json.dumps(self._bundle())[:-1] + ',"bundle_id":"duplicate"}'
        with self.assertRaisesRegex(deployment_bundle_contract.BundleValidationError, "duplicate JSON key"):
            deployment_bundle_contract.parse_bundle_json(encoded)

    def test_bundle_digest_excludes_only_its_own_hash_field(self):
        bundle = self._bundle()
        canonical = deployment_bundle_contract.canonical_json(bundle)
        self.assertNotIn("bundle_sha256", canonical)

        reordered = copy.deepcopy(bundle)
        reordered["bundle_sha256"] = "0" * 64
        self.assertEqual(
            deployment_bundle_contract.calculate_bundle_sha256(bundle),
            deployment_bundle_contract.calculate_bundle_sha256(reordered),
        )


if __name__ == "__main__":
    unittest.main()
