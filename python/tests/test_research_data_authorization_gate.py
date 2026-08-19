from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
AS_OF = "2026-08-19T12:00:00Z"
OPENSSL = shutil.which("openssl")


def _load_module(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_load_module("deployment_bundle_contract")
_load_module("activation_contract")
_load_module("autonomous_policy_gate")
gcp_kms_policy_gate = _load_module("gcp_kms_policy_gate")
research_data_authorization_gate = _load_module("research_data_authorization_gate")


@unittest.skipUnless(OPENSSL, "OpenSSL is required to verify a Cloud KMS P-256 authorization signature")
class ResearchDataAuthorizationGateTest(unittest.TestCase):
    @staticmethod
    def _sha(character: str) -> str:
        return character * 64

    @staticmethod
    def _revision(character: str) -> str:
        return character * 40

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="qsl-research-data-authorization-test-")
        self.directory = Path(self.temporary.name)
        self.private_key = self.directory / "research-data-root.pem"
        self.public_key = self.directory / "research-data-root.pub.pem"
        private_key_result = subprocess.run(
            [
                str(OPENSSL),
                "genpkey",
                "-algorithm",
                "EC",
                "-pkeyopt",
                "ec_paramgen_curve:prime256v1",
                "-out",
                str(self.private_key),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        self.assertEqual(private_key_result.returncode, 0)
        public_key_result = subprocess.run(
            [str(OPENSSL), "pkey", "-in", str(self.private_key), "-pubout", "-out", str(self.public_key)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        self.assertEqual(public_key_result.returncode, 0)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _root(self) -> dict[str, object]:
        public_key_pem = self.public_key.read_text(encoding="utf-8")
        root: dict[str, object] = {
            "schema": "qsl.gcp_kms_policy_root.v1",
            "root_id": "qsl-research-data-root-2026",
            "created_at": "2026-08-01T00:00:00Z",
            "effective_at": "2026-08-01T00:00:00Z",
            "expires_at": "2027-08-01T00:00:00Z",
            "digest_algorithm": "sha256",
            "kms_key_version": "projects/quantstrategy-2026/locations/us-central1/keyRings/qsl-root/cryptoKeys/research-data-root/cryptoKeyVersions/1",
            "signature_algorithm": "EC_SIGN_P256_SHA256",
            "public_key_pem": public_key_pem,
            "public_key_sha256": hashlib.sha256(public_key_pem.encode("utf-8")).hexdigest(),
        }
        root["trusted_policy_root_sha256"] = gcp_kms_policy_gate.calculate_trusted_policy_root_sha256(root)
        return root

    def _authorization(self) -> dict[str, object]:
        authorization: dict[str, object] = {
            "schema": "qsl.research_data_authorization.v1",
            "authorization_id": "tqqq-p1-p3-alpaca-inputs",
            "authorization_version": "v1",
            "created_at": "2026-08-19T10:00:00Z",
            "effective_at": "2026-08-19T10:00:00Z",
            "expires_at": "2026-08-20T10:00:00Z",
            "digest_algorithm": "sha256",
            "repository": "QuantStrategyLab/UsEquitySnapshotPipelines",
            "revision": self._revision("a"),
            "runner_environment": "tqqq-p1-p3-nonlive",
            "candidate_config": {
                "candidate_sha256": self._sha("b"),
                "config_sha256": self._sha("c"),
            },
            "provider": {"provider_id": "alpaca-market-data"},
            "retention_policy_sha256": self._sha("d"),
            "allowed_operations": [
                "historical_market_data_read",
                "offline_replay",
                "p1_private_input_root_create_only_write",
                "p3_private_evidence_metadata_create_only_write",
                "p3_private_input_root_read",
            ],
            "forbidden_capabilities": [
                "credential_access",
                "paper_execution",
                "shadow_execution",
                "live_execution",
                "order_submission",
                "capital_allocation",
            ],
        }
        authorization["authorization_sha256"] = research_data_authorization_gate.calculate_research_data_authorization_sha256(
            authorization
        )
        return authorization

    def _sign(self, authorization: dict[str, object]) -> bytes:
        payload = self.directory / f"authorization-{authorization['authorization_sha256']}.json"
        signature = self.directory / f"authorization-{authorization['authorization_sha256']}.der"
        payload.write_text(
            research_data_authorization_gate.canonical_research_data_authorization_json(authorization),
            encoding="utf-8",
        )
        result = subprocess.run(
            [str(OPENSSL), "dgst", "-sha256", "-sign", str(self.private_key), "-out", str(signature), str(payload)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        self.assertEqual(result.returncode, 0)
        return signature.read_bytes()

    def _validate(self, authorization, signature, root, **kwargs):
        return research_data_authorization_gate.validate_research_data_authorization_gate(
            authorization=authorization,
            signature=signature,
            trusted_policy_root=root,
            expected_root_sha256=kwargs.pop("expected_root_sha256", root["trusted_policy_root_sha256"]),
            expected_repository=kwargs.pop("expected_repository", authorization["repository"]),
            expected_revision=kwargs.pop("expected_revision", authorization["revision"]),
            expected_runner_environment=kwargs.pop("expected_runner_environment", authorization["runner_environment"]),
            expected_candidate_sha256=kwargs.pop("expected_candidate_sha256", authorization["candidate_config"]["candidate_sha256"]),
            expected_config_sha256=kwargs.pop("expected_config_sha256", authorization["candidate_config"]["config_sha256"]),
            expected_provider_id=kwargs.pop("expected_provider_id", authorization["provider"]["provider_id"]),
            expected_retention_policy_sha256=kwargs.pop(
                "expected_retention_policy_sha256",
                authorization["retention_policy_sha256"],
            ),
            as_of=AS_OF,
            **kwargs,
        )

    def test_valid_signature_binds_exact_non_trading_research_scope(self):
        root = self._root()
        authorization = self._authorization()
        signature = self._sign(authorization)

        result = self._validate(authorization, signature, root)

        self.assertEqual(result["authorization"]["authorization_sha256"], authorization["authorization_sha256"])
        self.assertEqual(result["signature_sha256"], hashlib.sha256(signature).hexdigest())
        self.assertEqual(result["authorization"]["runner_environment"], "tqqq-p1-p3-nonlive")
        self.assertEqual(result["authorization"]["retention_policy_sha256"], self._sha("d"))
        self.assertEqual(
            result["authorization"]["allowed_operations"],
            [
                "historical_market_data_read",
                "offline_replay",
                "p1_private_input_root_create_only_write",
                "p3_private_evidence_metadata_create_only_write",
                "p3_private_input_root_read",
            ],
        )
        self.assertEqual(result["authorization"]["forbidden_capabilities"], [
            "credential_access",
            "paper_execution",
            "shadow_execution",
            "live_execution",
            "order_submission",
            "capital_allocation",
        ])

    def test_signature_root_and_each_expected_binding_fail_closed(self):
        root = self._root()
        authorization = self._authorization()
        signature = self._sign(authorization)

        with self.assertRaisesRegex(research_data_authorization_gate.ResearchDataAuthorizationValidationError, "externally pinned"):
            self._validate(authorization, signature, root, expected_root_sha256=self._sha("0"))

        altered = copy.deepcopy(authorization)
        altered["authorization_version"] = "v2"
        altered["authorization_sha256"] = research_data_authorization_gate.calculate_research_data_authorization_sha256(altered)
        with self.assertRaisesRegex(research_data_authorization_gate.ResearchDataAuthorizationValidationError, "signature verification"):
            self._validate(altered, signature, root)

        bindings = {
            "expected_repository": "QuantStrategyLab/OtherRepository",
            "expected_revision": self._revision("d"),
            "expected_runner_environment": "other-nonlive",
            "expected_candidate_sha256": self._sha("e"),
            "expected_config_sha256": self._sha("f"),
            "expected_provider_id": "other-market-data",
            "expected_retention_policy_sha256": self._sha("0"),
        }
        for name, value in bindings.items():
            with self.subTest(binding=name):
                with self.assertRaisesRegex(
                    research_data_authorization_gate.ResearchDataAuthorizationValidationError,
                    "does not match the exact expected",
                ):
                    self._validate(authorization, signature, root, **{name: value})

    def test_closed_schema_rejects_execution_raw_data_urls_and_overlong_lifetime(self):
        authorization = self._authorization()
        variants: list[tuple[str, dict[str, object], str]] = []

        raw_data = copy.deepcopy(authorization)
        raw_data["raw_data"] = "not-permitted"
        variants.append(("raw_data", raw_data, "forbidden"))

        endpoint = copy.deepcopy(authorization)
        endpoint["provider"] = {"provider_id": "alpaca-market-data", "endpoint": "https://example.invalid"}
        variants.append(("endpoint", endpoint, "forbidden"))

        live_operation = copy.deepcopy(authorization)
        live_operation["allowed_operations"] = ["live_execution"]
        live_operation["authorization_sha256"] = research_data_authorization_gate.calculate_research_data_authorization_sha256(
            live_operation
        )
        variants.append(("live_operation", live_operation, "complete P1/P3"))

        missing_p3_read = copy.deepcopy(authorization)
        missing_p3_read["allowed_operations"] = [
            "historical_market_data_read",
            "offline_replay",
            "p1_private_input_root_create_only_write",
            "p3_private_evidence_metadata_create_only_write",
        ]
        missing_p3_read["authorization_sha256"] = research_data_authorization_gate.calculate_research_data_authorization_sha256(
            missing_p3_read
        )
        variants.append(("missing_p3_read", missing_p3_read, "complete P1/P3"))

        missing_execution_denial = copy.deepcopy(authorization)
        missing_execution_denial["forbidden_capabilities"] = ["credential_access"]
        missing_execution_denial["authorization_sha256"] = (
            research_data_authorization_gate.calculate_research_data_authorization_sha256(missing_execution_denial)
        )
        variants.append(("missing_execution_denial", missing_execution_denial, "must deny credentials"))

        overlong = copy.deepcopy(authorization)
        overlong["expires_at"] = "2026-09-20T10:00:01Z"
        overlong["authorization_sha256"] = research_data_authorization_gate.calculate_research_data_authorization_sha256(overlong)
        variants.append(("overlong", overlong, "validity window exceeds"))

        for name, variant, message in variants:
            with self.subTest(variant=name):
                with self.assertRaisesRegex(research_data_authorization_gate.ResearchDataAuthorizationValidationError, message):
                    research_data_authorization_gate.validate_research_data_authorization(variant, as_of=AS_OF)

    def test_cli_uses_independent_root_digest_and_emits_only_safe_summary(self):
        root = self._root()
        authorization = self._authorization()
        signature = self._sign(authorization)
        authorization_path = self.directory / "authorization.json"
        signature_path = self.directory / "authorization.der"
        root_path = self.directory / "trusted-root.json"
        authorization_path.write_text(json.dumps(authorization), encoding="utf-8")
        signature_path.write_bytes(signature)
        root_path.write_text(json.dumps(root), encoding="utf-8")
        command = [
            sys.executable,
            str(SCRIPTS / "research_data_authorization_gate.py"),
            "--authorization",
            str(authorization_path),
            "--authorization-signature",
            str(signature_path),
            "--trusted-policy-root",
            str(root_path),
            "--expected-repository",
            str(authorization["repository"]),
            "--expected-revision",
            str(authorization["revision"]),
            "--expected-runner-environment",
            str(authorization["runner_environment"]),
            "--expected-candidate-sha256",
            str(authorization["candidate_config"]["candidate_sha256"]),
            "--expected-config-sha256",
            str(authorization["candidate_config"]["config_sha256"]),
            "--expected-provider-id",
            str(authorization["provider"]["provider_id"]),
            "--expected-retention-policy-sha256",
            str(authorization["retention_policy_sha256"]),
            "--as-of",
            AS_OF,
        ]
        environment = {**os.environ, "QSL_RESEARCH_DATA_POLICY_ROOT_SHA256": str(root["trusted_policy_root_sha256"])}
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
            env=environment,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["authorization_id"], authorization["authorization_id"])
        self.assertEqual(summary["provider_id"], authorization["provider"]["provider_id"])
        self.assertEqual(summary["runner_environment"], authorization["runner_environment"])
        self.assertEqual(summary["retention_policy_sha256"], authorization["retention_policy_sha256"])
        self.assertNotIn("public_key_pem", summary)
        self.assertNotIn("forbidden_capabilities", summary)

        no_root_environment = dict(os.environ)
        no_root_environment.pop("QSL_RESEARCH_DATA_POLICY_ROOT_SHA256", None)
        missing_root = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
            env=no_root_environment,
        )
        self.assertEqual(missing_root.returncode, 1)
        self.assertIn("must be injected by the independent data control", missing_root.stderr)

    def test_duplicate_json_and_execution_gate_entrypoints_are_not_accepted_or_used(self):
        duplicate = '{"schema":"qsl.research_data_authorization.v1","schema":"qsl.research_data_authorization.v1"}'
        with self.assertRaisesRegex(research_data_authorization_gate.ResearchDataAuthorizationValidationError, "duplicate JSON key"):
            research_data_authorization_gate.parse_research_data_authorization_json(duplicate)

        source = (SCRIPTS / "research_data_authorization_gate.py").read_text(encoding="utf-8")
        self.assertNotIn("validate_gcp_kms_policy_gate", source)
        self.assertNotIn("validate_policy_gate", source)
        self.assertNotIn("validate_activation", source)

        schema = json.loads((ROOT.parent / "schemas" / "qsl-research-data-authorization.v1.schema.json").read_text())
        self.assertEqual(schema["$id"], "qsl.research_data_authorization.v1")
        self.assertFalse(schema["additionalProperties"])
        self.assertIn("does not authorize paper", schema["description"])
        self.assertIn("runner_environment", schema["required"])
        self.assertIn("retention_policy_sha256", schema["required"])


if __name__ == "__main__":
    unittest.main()
