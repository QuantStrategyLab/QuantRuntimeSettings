from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import math
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
reconciliation_record_contract = _load_module("reconciliation_record_contract")


class ReconciliationRecordContractTest(unittest.TestCase):
    IDENTITY_BINDING_FIELDS = (
        "deployment_bundle_sha256",
        "activation_id",
        "activation_sha256",
        "platform",
        "repository",
        "revision",
        "environment",
        "account_alias",
        "account_digest_sha256",
    )

    @staticmethod
    def _sha(character: str) -> str:
        return character * 64

    @staticmethod
    def _revision(character: str) -> str:
        return character * 40

    @staticmethod
    def _self_excluded_sha256(value: dict[str, object], excluded_field: str) -> str:
        content = dict(value)
        content.pop(excluded_field, None)
        canonical = json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

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

    def _activation(self) -> dict[str, object]:
        bundle = self._bundle()
        activation: dict[str, object] = {
            "schema": "qsl.activation.v2",
            "activation_id": "activation.soxl-signal.ibkr-us.paper.20260805",
            "created_at": "2026-08-05T09:00:00Z",
            "digest_algorithm": "sha256",
            "contract_only": True,
            "deployment_bundle": {
                "schema": bundle["schema"],
                "bundle_id": bundle["bundle_id"],
                "bundle_sha256": bundle["bundle_sha256"],
            },
            "stage": "PAPER_DRY_RUN",
            "effective_at": "2026-08-05T10:00:00Z",
            "expires_at": "2026-08-05T18:00:00Z",
            "operating_authority": {
                "mode": "PREAUTHORIZED_AUTONOMY",
                "stage": "PAPER_DRY_RUN",
                "policy_id": "autonomous-policy.paper-dry-run.20260805",
                "policy_version": "v2",
                "policy_receipt_sha256": self._sha("c"),
                "allowed_ai_actions": ["evidence_validation", "monitor_readonly", "release_evaluation", "research_candidate_generation"],
                "forbidden_ai_actions": ["credential_access", "direct_order_submission", "kill_switch_reset", "policy_mutation", "risk_limit_mutation"],
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

    def _missing(self) -> dict[str, object]:
        return reconciliation_record_contract.build_missing_record(
            record_id="reconciliation.soxl-signal.ibkr-us.20260805",
            produced_at="2026-08-05T12:00:00Z",
            expires_at="2026-08-05T13:00:00Z",
            expected_bundle=self._bundle(),
            expected_activation=self._activation(),
            as_of="2026-08-05T12:00:00Z",
        )

    def _observed(self, expected: dict[str, object]) -> dict[str, object]:
        observed = {
            **{key: value for key, value in expected.items() if key != "expected_identity_sha256"},
            "producer_id": "interactive-brokers.runtime-report",
            "producer_revision": self._revision("8"),
            "artifact_sha256": self._sha("e"),
            "observed_at": "2026-08-05T11:55:00Z",
        }
        observed["observed_identity_sha256"] = self._self_excluded_sha256(observed, "observed_identity_sha256")
        return observed

    def _observer_receipt(self, observed: dict[str, object]) -> dict[str, object]:
        receipt = {
            "schema": "qsl.reconciliation_observer_receipt.v1",
            "observer_id": "qsl-independent-observer",
            "observer_revision": self._revision("f"),
            "created_at": "2026-08-05T11:58:00Z",
            "observed_identity": copy.deepcopy(observed),
        }
        receipt["observer_receipt_sha256"] = self._self_excluded_sha256(receipt, "observer_receipt_sha256")
        return receipt

    def _comparison(self, expected: dict[str, object], observed: dict[str, object]) -> dict[str, object]:
        fields = {}
        for field in self.IDENTITY_BINDING_FIELDS:
            fields[field] = {
                "expected": expected[field],
                "observed": observed[field],
                "equal": expected[field] == observed[field],
            }
        return {"complete": True, "fields": fields}

    def _record_with_observation(self, status: str = "MATCHED") -> dict[str, object]:
        record = self._missing()
        expected = record["expected_identity"]
        observed = self._observed(expected)
        if status == "MISMATCHED":
            observed["revision"] = self._revision("0")
            observed["observed_identity_sha256"] = self._self_excluded_sha256(observed, "observed_identity_sha256")
        record["status"] = status
        record["observed_identity"] = observed
        record["observer_receipt"] = self._observer_receipt(observed)
        record["comparison"] = self._comparison(expected, observed)
        record["reconciliation_sha256"] = reconciliation_record_contract.calculate_reconciliation_sha256(record)
        return record

    def _validate(self, record: dict[str, object], *, as_of: str = "2026-08-05T12:00:00Z"):
        return reconciliation_record_contract.validate_reconciliation_record(
            record,
            expected_bundle=self._bundle(),
            expected_activation=self._activation(),
            as_of=as_of,
        )

    def test_schema_is_closed_contract_only_and_uses_canonical_statuses(self):
        schema = json.loads((ROOT.parent / "schemas" / "qsl-reconciliation-record.v2.schema.json").read_text())
        self.assertEqual(schema["$id"], "qsl.reconciliation_record.v2")
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(schema["properties"]["contract_only"], {"const": True})
        self.assertEqual(schema["properties"]["status"], {"const": "MISSING"})
        self.assertNotIn("observed_identity", schema["properties"])
        self.assertNotIn("observer_receipt", schema["properties"])
        self.assertNotIn("comparison", schema["properties"])
        self.assertIn("generation time", schema["description"])

    def test_valid_missing_is_default_deterministic_and_binds_exact_inputs(self):
        record = self._missing()
        validated = self._validate(record)
        self.assertEqual(validated["status"], "MISSING")
        self.assertEqual(validated["produced_at"], "2026-08-05T12:00:00Z")
        self.assertNotIn("observed_identity", record)
        self.assertFalse(validated["assertions"]["runtime_active_verified"])
        self.assertEqual(
            reconciliation_record_contract.canonical_json(record),
            reconciliation_record_contract.canonical_json(dict(reversed(record.items()))),
        )
        self.assertEqual(
            record["reconciliation_sha256"],
            reconciliation_record_contract.calculate_reconciliation_sha256(record),
        )

    def test_missing_rejects_all_observer_comparison_and_freshness_material(self):
        for field, value in (
            ("observer_id", "self-asserted-observer"),
            ("observer_receipt", {"observer_id": "self-asserted-observer"}),
            ("observation", {"observed_at": "2026-08-05T11:55:00Z"}),
            ("observed_identity", self._observed(self._missing()["expected_identity"])),
            ("comparison", {"complete": False}),
            ("comparisons", []),
            ("mismatch_list", []),
            ("max_age_seconds", 300),
        ):
            with self.subTest(field=field):
                record = self._missing()
                record[field] = value
                record["reconciliation_sha256"] = reconciliation_record_contract.calculate_reconciliation_sha256(record)
                with self.assertRaises(reconciliation_record_contract.ReconciliationValidationError):
                    self._validate(record)

        nested = self._missing()
        nested["expected_identity"]["metadata"] = {"observer_id": "self-asserted-observer"}
        nested["reconciliation_sha256"] = reconciliation_record_contract.calculate_reconciliation_sha256(nested)
        with self.assertRaisesRegex(reconciliation_record_contract.ReconciliationValidationError, "forbidden"):
            self._validate(nested)

    def test_all_legacy_non_missing_statuses_are_rejected(self):
        for status in ("MATCHED", "MISMATCHED", "UNKNOWN", "matched", ""):
            with self.subTest(status=status):
                record = (
                    self._record_with_observation(status) if status in {"MATCHED", "MISMATCHED"} else self._missing()
                )
                record["status"] = status
                record["reconciliation_sha256"] = reconciliation_record_contract.calculate_reconciliation_sha256(record)
                with self.assertRaisesRegex(
                    reconciliation_record_contract.ReconciliationValidationError, "MISSING-only"
                ):
                    self._validate(record)

    def test_missing_only_rejects_self_asserted_observer_forgery(self):
        record = self._record_with_observation()
        record["observer_receipt"]["observer_id"] = "attacker-asserted-observer"
        record["observer_receipt"]["observer_revision"] = self._revision("0")
        record["observer_receipt"]["observer_receipt_sha256"] = self._self_excluded_sha256(
            record["observer_receipt"], "observer_receipt_sha256"
        )
        record["reconciliation_sha256"] = reconciliation_record_contract.calculate_reconciliation_sha256(record)

        with self.assertRaisesRegex(reconciliation_record_contract.ReconciliationValidationError, "MISSING-only"):
            self._validate(record)

    def test_missing_only_rejects_fresh_wrapper_around_stale_observation(self):
        record = self._record_with_observation()
        record["observed_identity"]["observed_at"] = "2026-08-05T10:01:00Z"
        record["observed_identity"]["observed_identity_sha256"] = self._self_excluded_sha256(
            record["observed_identity"], "observed_identity_sha256"
        )
        record["observer_receipt"] = self._observer_receipt(record["observed_identity"])
        record["reconciliation_sha256"] = reconciliation_record_contract.calculate_reconciliation_sha256(record)

        with self.assertRaisesRegex(reconciliation_record_contract.ReconciliationValidationError, "MISSING-only"):
            self._validate(record)

    def test_stale_expired_future_and_invalid_calendar_times_fail_closed(self):
        with self.assertRaisesRegex(reconciliation_record_contract.ReconciliationValidationError, "expired"):
            self._validate(self._missing(), as_of="2026-08-05T13:00:00Z")

        future = self._missing()
        future["produced_at"] = "2026-08-05T12:01:00Z"
        future["reconciliation_sha256"] = reconciliation_record_contract.calculate_reconciliation_sha256(future)
        with self.assertRaisesRegex(reconciliation_record_contract.ReconciliationValidationError, "future"):
            self._validate(future)

        for field, timestamp in (
            ("produced_at", "2026-02-30T12:00:00Z"),
            ("expires_at", "2026-08-05T25:00:00Z"),
        ):
            with self.subTest(field=field):
                record = self._missing()
                record[field] = timestamp
                record["reconciliation_sha256"] = reconciliation_record_contract.calculate_reconciliation_sha256(record)
                with self.assertRaisesRegex(reconciliation_record_contract.ReconciliationValidationError, "timestamp"):
                    self._validate(record)

        with self.assertRaisesRegex(reconciliation_record_contract.ReconciliationValidationError, "timestamp"):
            self._validate(self._missing(), as_of="2026-08-05T12:00:00+00:00")

    def test_cross_bundle_activation_target_and_expected_identity_fail_closed(self):
        mutations = (
            lambda value: value["deployment_bundle"].update({"bundle_sha256": self._sha("0")}),
            lambda value: value["activation"].update({"activation_id": "activation.other"}),
            lambda value: value["target"].update({"platform": "binance-platform"}),
            lambda value: value["expected_identity"].update({"revision": self._revision("0")}),
        )
        for mutate in mutations:
            record = self._missing()
            mutate(record)
            if record["expected_identity"]["revision"] == self._revision("0"):
                record["expected_identity"]["expected_identity_sha256"] = (
                    reconciliation_record_contract.calculate_expected_identity_sha256(record["expected_identity"])
                )
            record["reconciliation_sha256"] = reconciliation_record_contract.calculate_reconciliation_sha256(record)
            with self.assertRaises(reconciliation_record_contract.ReconciliationValidationError):
                self._validate(record)

    def test_mutation_and_nested_digest_mismatch_fail_closed(self):
        record = self._missing()
        record["target"]["environment"] = "ibkr-shadow"
        with self.assertRaisesRegex(
            reconciliation_record_contract.ReconciliationValidationError, "reconciliation_sha256"
        ):
            self._validate(record)

        record = self._missing()
        record["expected_identity"]["activation_sha256"] = self._sha("0")
        record["reconciliation_sha256"] = reconciliation_record_contract.calculate_reconciliation_sha256(record)
        with self.assertRaisesRegex(
            reconciliation_record_contract.ReconciliationValidationError, "expected_identity_sha256"
        ):
            self._validate(record)

    def test_secret_provider_and_financial_material_is_rejected_recursively(self):
        for key, value in (
            ("api_token", "not-a-real-token"),
            ("credential_url", "https://user:pass@example.invalid"),
            ("raw_payload", {"value": "redacted"}),
            ("provider_rows", [{"close": 1.0}]),
            ("account", {"alias": "not-allowed-here"}),
            ("account_number", "00000000"),
            ("balance", 100.0),
            ("positions", [{"symbol": "SPY"}]),
            ("orders", []),
            ("fills", []),
            ("capital_value", 1.0),
        ):
            with self.subTest(key=key):
                record = self._missing()
                record["expected_identity"]["nested"] = {key: value}
                record["reconciliation_sha256"] = reconciliation_record_contract.calculate_reconciliation_sha256(record)
                with self.assertRaisesRegex(reconciliation_record_contract.ReconciliationValidationError, "forbidden"):
                    self._validate(record)

    def test_unknown_null_non_finite_duplicate_and_malformed_json_fail_closed(self):
        for mutate in (
            lambda value: value.update({"unknown": "x"}),
            lambda value: value.update({"status": None}),
        ):
            record = self._missing()
            mutate(record)
            record["reconciliation_sha256"] = reconciliation_record_contract.calculate_reconciliation_sha256(record)
            with self.assertRaises(reconciliation_record_contract.ReconciliationValidationError):
                self._validate(record)

        record = self._missing()
        record["assertions"]["runtime_active_verified"] = math.nan
        with self.assertRaises(reconciliation_record_contract.ReconciliationValidationError):
            self._validate(record)

        duplicate = json.dumps(self._missing()).replace(
            '"status": "MISSING"', '"status": "MISSING", "status": "MATCHED"'
        )
        with self.assertRaisesRegex(reconciliation_record_contract.ReconciliationValidationError, "duplicate JSON key"):
            reconciliation_record_contract.parse_reconciliation_json(
                duplicate,
                expected_bundle=self._bundle(),
                expected_activation=self._activation(),
                as_of="2026-08-05T12:00:00Z",
            )


if __name__ == "__main__":
    unittest.main()
