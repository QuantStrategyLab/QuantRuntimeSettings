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
AS_OF = "2026-08-05T12:00:00Z"
SSH_KEYGEN = shutil.which("ssh-keygen")
OPENSSL = shutil.which("openssl")


def _load_module(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


deployment_bundle_contract = _load_module("deployment_bundle_contract")
activation_contract = _load_module("activation_contract")
autonomous_policy_gate = _load_module("autonomous_policy_gate")
gcp_kms_policy_gate = _load_module("gcp_kms_policy_gate")
reconcile_only_admission_gate = _load_module("reconcile_only_admission_gate")


@unittest.skipUnless(SSH_KEYGEN, "OpenSSH ssh-keygen is required to verify a policy signature")
@unittest.skipUnless(OPENSSL, "OpenSSL is required to verify a Cloud KMS P-256 policy signature")
class AutonomousPolicyGateTest(unittest.TestCase):
    @staticmethod
    def _sha(character: str) -> str:
        return character * 64

    @staticmethod
    def _revision(character: str) -> str:
        return character * 40

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="qsl-policy-gate-test-")
        self.directory = Path(self.temporary.name)
        self.private_key = self.directory / "policy-root"
        result = subprocess.run(
            [
                str(SSH_KEYGEN),
                "-q",
                "-t",
                "ed25519",
                "-N",
                "",
                "-C",
                "qsl-policy-root@quantstrategylab",
                "-f",
                str(self.private_key),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        self.assertEqual(result.returncode, 0)
        self.kms_private_key = self.directory / "kms-policy-root.pem"
        self.kms_public_key = self.directory / "kms-policy-root.pub.pem"
        private_key_result = subprocess.run(
            [
                str(OPENSSL),
                "genpkey",
                "-algorithm",
                "EC",
                "-pkeyopt",
                "ec_paramgen_curve:prime256v1",
                "-out",
                str(self.kms_private_key),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        self.assertEqual(private_key_result.returncode, 0)
        public_key_result = subprocess.run(
            [str(OPENSSL), "pkey", "-in", str(self.kms_private_key), "-pubout", "-out", str(self.kms_public_key)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        self.assertEqual(public_key_result.returncode, 0)

    def tearDown(self) -> None:
        self.temporary.cleanup()

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
            "profile": {"id": "research-profile", "revision": self._revision("c"), "artifact_sha256": self._sha("d")},
            "config": {"id": "ibkr-us-config", "revision": self._revision("e"), "artifact_sha256": self._sha("f")},
            "evidence": {"id": "soxl-evidence", "revision": self._revision("1"), "artifact_sha256": self._sha("2")},
            "target": {"id": "ibkr-us", "platform_id": "interactive-brokers"},
            "dependencies": {
                "qpk": {"id": "quant-platform-kit", "revision": self._revision("3"), "artifact_sha256": self._sha("4")},
                "strategy": {"id": "us-equity-strategies", "revision": self._revision("a"), "artifact_sha256": self._sha("5")},
                "pipeline": {"id": "crypto-live-pool-pipelines", "revision": self._revision("6"), "artifact_sha256": self._sha("7")},
                "platform": {"id": "interactive-brokers", "revision": self._revision("8"), "artifact_sha256": self._sha("9")},
            },
        }
        bundle["bundle_sha256"] = deployment_bundle_contract.calculate_bundle_sha256(bundle)
        return bundle

    def _target(self) -> dict[str, str]:
        return {
            "platform": "interactive-brokers",
            "repository": "QuantStrategyLab/InteractiveBrokersPlatform",
            "revision": self._revision("8"),
            "environment": "ibkr-paper",
            "account_alias": "ibkr-research",
            "account_digest_sha256": self._sha("d"),
        }

    def _root(self) -> dict[str, object]:
        public_key = Path(f"{self.private_key}.pub").read_text(encoding="utf-8").strip()
        root: dict[str, object] = {
            "schema": "qsl.trusted_policy_root.v1",
            "root_id": "qsl-autonomy-root-2026",
            "created_at": "2026-08-01T00:00:00Z",
            "effective_at": "2026-08-01T00:00:00Z",
            "expires_at": "2027-08-01T00:00:00Z",
            "digest_algorithm": "sha256",
            "signer_identity": "qsl-policy-root@quantstrategylab",
            "signature_namespace": "qsl-policy-v1@quantstrategylab",
            "public_key": public_key,
            "public_key_sha256": hashlib.sha256(public_key.encode("utf-8")).hexdigest(),
        }
        root["trusted_policy_root_sha256"] = autonomous_policy_gate.calculate_trusted_policy_root_sha256(root)
        return root

    def _kms_root(self) -> dict[str, object]:
        public_key_pem = self.kms_public_key.read_text(encoding="utf-8")
        root: dict[str, object] = {
            "schema": "qsl.gcp_kms_policy_root.v1",
            "root_id": "qsl-kms-root-2026",
            "created_at": "2026-08-01T00:00:00Z",
            "effective_at": "2026-08-01T00:00:00Z",
            "expires_at": "2027-08-01T00:00:00Z",
            "digest_algorithm": "sha256",
            "kms_key_version": "projects/quantstrategy-2026/locations/us-central1/keyRings/qsl-root/cryptoKeys/policy-root/cryptoKeyVersions/1",
            "signature_algorithm": "EC_SIGN_P256_SHA256",
            "public_key_pem": public_key_pem,
            "public_key_sha256": hashlib.sha256(public_key_pem.encode("utf-8")).hexdigest(),
        }
        gcp_kms_policy_gate = sys.modules["gcp_kms_policy_gate"]
        root["trusted_policy_root_sha256"] = gcp_kms_policy_gate.calculate_trusted_policy_root_sha256(root)
        return root

    def _policy(
        self,
        bundle: dict[str, object],
        *,
        target: dict[str, str] | None = None,
        risk_policy_id: str = "ibkr-paper-risk-cap",
        risk_policy_version: str = "v1",
        risk_policy_sha256: str | None = None,
    ) -> dict[str, object]:
        policy: dict[str, object] = {
            "schema": "qsl.autonomous_operating_policy.v1",
            "policy_id": "ibkr-paper-nonexecution-policy",
            "policy_version": "v1",
            "created_at": "2026-08-05T09:00:00Z",
            "effective_at": "2026-08-05T09:00:00Z",
            "expires_at": "2026-08-06T09:00:00Z",
            "digest_algorithm": "sha256",
            "stage": "PAPER_DRY_RUN",
            "deployment_bundle": {
                "schema": bundle["schema"],
                "bundle_id": bundle["bundle_id"],
                "bundle_sha256": bundle["bundle_sha256"],
            },
            "target": target or self._target(),
            "risk_control": {
                "risk_policy_id": risk_policy_id,
                "risk_policy_version": risk_policy_version,
                "risk_policy_sha256": risk_policy_sha256 or self._sha("a"),
            },
            "allowed_ai_actions": [
                "evidence_validation",
                "monitor_readonly",
                "release_evaluation",
                "research_candidate_generation",
            ],
            "forbidden_ai_actions": [
                "credential_access",
                "direct_order_submission",
                "kill_switch_reset",
                "policy_mutation",
                "risk_limit_mutation",
            ],
        }
        policy["policy_sha256"] = autonomous_policy_gate.calculate_policy_sha256(policy)
        return policy

    def _risk_control(self) -> dict[str, object]:
        risk_control: dict[str, object] = {
            "schema": "qsl.reconcile_only_risk_control.v1",
            "risk_policy_id": "ibkr-paper-risk-cap",
            "risk_policy_version": "v1",
            "created_at": "2026-08-05T09:00:00Z",
            "effective_at": "2026-08-05T09:00:00Z",
            "expires_at": "2026-08-05T19:00:00Z",
            "digest_algorithm": "sha256",
            "admission_mode": "RECONCILE_ONLY",
            "new_risk_ceiling": 0,
            "write_action_ceiling": 0,
        }
        risk_control["risk_policy_sha256"] = reconcile_only_admission_gate.calculate_risk_policy_sha256(risk_control)
        return risk_control

    def _admission(self, *, target: dict[str, str] | None = None) -> dict[str, object]:
        admission: dict[str, object] = {
            "schema": "qsl.reconcile_only_admission.v1",
            "admission_id": "admission.ibkr-paper.reconcile.20260805",
            "created_at": "2026-08-05T10:00:00Z",
            "effective_at": "2026-08-05T10:00:00Z",
            "expires_at": "2026-08-05T18:00:00Z",
            "digest_algorithm": "sha256",
            "admission_mode": "RECONCILE_ONLY",
            "target": target or self._target(),
        }
        admission["admission_sha256"] = reconcile_only_admission_gate.calculate_admission_sha256(admission)
        return admission

    def _sign(self, policy: dict[str, object]) -> bytes:
        payload = self.directory / f"policy-{policy['policy_sha256']}.json"
        payload.write_text(autonomous_policy_gate.canonical_policy_json(policy), encoding="utf-8")
        result = subprocess.run(
            [
                str(SSH_KEYGEN),
                "-Y",
                "sign",
                "-f",
                str(self.private_key),
                "-n",
                "qsl-policy-v1@quantstrategylab",
                str(payload),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        self.assertEqual(result.returncode, 0)
        return Path(f"{payload}.sig").read_bytes()

    def _sign_kms(self, policy: dict[str, object]) -> bytes:
        payload = self.directory / f"kms-policy-{policy['policy_sha256']}.json"
        signature = self.directory / f"kms-policy-{policy['policy_sha256']}.der"
        payload.write_text(autonomous_policy_gate.canonical_policy_json(policy), encoding="utf-8")
        result = subprocess.run(
            [str(OPENSSL), "dgst", "-sha256", "-sign", str(self.kms_private_key), "-out", str(signature), str(payload)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        self.assertEqual(result.returncode, 0)
        return signature.read_bytes()

    def _activation(self, bundle: dict[str, object], signature: bytes) -> dict[str, object]:
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
                "policy_id": "ibkr-paper-nonexecution-policy",
                "policy_version": "v1",
                "policy_receipt_sha256": hashlib.sha256(signature).hexdigest(),
                "allowed_ai_actions": [
                    "evidence_validation",
                    "monitor_readonly",
                    "release_evaluation",
                    "research_candidate_generation",
                ],
                "forbidden_ai_actions": [
                    "credential_access",
                    "direct_order_submission",
                    "kill_switch_reset",
                    "policy_mutation",
                    "risk_limit_mutation",
                ],
            },
            "target": self._target(),
        }
        activation["activation_sha256"] = activation_contract.calculate_activation_sha256(activation)
        return activation

    def _validate(self, bundle, activation, policy, signature, root, **kwargs):
        return autonomous_policy_gate.validate_policy_gate(
            bundle=bundle,
            activation=activation,
            policy=policy,
            signature=signature,
            trusted_policy_root=root,
            expected_root_sha256=kwargs.pop("expected_root_sha256", root["trusted_policy_root_sha256"]),
            as_of=AS_OF,
            **kwargs,
        )

    def _validate_kms(self, bundle, activation, policy, signature, root, **kwargs):
        gcp_kms_policy_gate = sys.modules["gcp_kms_policy_gate"]
        return gcp_kms_policy_gate.validate_gcp_kms_policy_gate(
            bundle=bundle,
            activation=activation,
            policy=policy,
            signature=signature,
            trusted_policy_root=root,
            expected_root_sha256=kwargs.pop("expected_root_sha256", root["trusted_policy_root_sha256"]),
            as_of=AS_OF,
            **kwargs,
        )

    def test_valid_signed_external_root_binds_policy_bundle_activation_and_risk_hash(self):
        bundle = self._bundle()
        policy = self._policy(bundle)
        signature = self._sign(policy)
        activation = self._activation(bundle, signature)
        root = self._root()

        result = self._validate(bundle, activation, policy, signature, root)

        self.assertEqual(result["policy"]["policy_sha256"], policy["policy_sha256"])
        self.assertEqual(result["signature_sha256"], hashlib.sha256(signature).hexdigest())
        self.assertEqual(result["activation"]["operating_authority"]["policy_id"], policy["policy_id"])

    def test_gcp_kms_p256_root_verifies_der_signature_and_zero_risk_admission(self):
        bundle = self._bundle()
        risk_control = self._risk_control()
        policy = self._policy(bundle, risk_policy_sha256=str(risk_control["risk_policy_sha256"]))
        signature = self._sign_kms(policy)
        activation = self._activation(bundle, signature)
        root = self._kms_root()
        gcp_kms_policy_gate = sys.modules["gcp_kms_policy_gate"]

        verified = self._validate_kms(bundle, activation, policy, signature, root)
        self.assertEqual(verified["trusted_policy_root"]["signature_algorithm"], "EC_SIGN_P256_SHA256")
        self.assertEqual(verified["signature_sha256"], hashlib.sha256(signature).hexdigest())

        admitted = reconcile_only_admission_gate.admit_reconcile_only_gcp_kms(
            bundle=bundle,
            activation=activation,
            policy=policy,
            signature=signature,
            trusted_policy_root=root,
            expected_root_sha256=root["trusted_policy_root_sha256"],
            risk_control=risk_control,
            admission=self._admission(),
            as_of=AS_OF,
        )
        self.assertEqual(admitted["status"], "RECONCILE_ONLY")
        self.assertFalse(admitted["new_risk_allowed"])

        altered_policy = copy.deepcopy(policy)
        altered_policy["policy_version"] = "v2"
        altered_policy["policy_sha256"] = autonomous_policy_gate.calculate_policy_sha256(altered_policy)
        with self.assertRaisesRegex(gcp_kms_policy_gate.GcpKmsPolicyValidationError, "signature verification"):
            self._validate_kms(bundle, activation, altered_policy, signature, root)

    def test_cli_returns_only_safe_gate_summary(self):
        bundle = self._bundle()
        policy = self._policy(bundle)
        signature = self._sign(policy)
        activation = self._activation(bundle, signature)
        root = self._root()
        bundle_path = self.directory / "bundle.json"
        activation_path = self.directory / "activation.json"
        policy_path = self.directory / "policy.json"
        signature_path = self.directory / "policy.sshsig"
        root_path = self.directory / "trusted-root.json"
        bundle_path.write_text(json.dumps(bundle), encoding="utf-8")
        activation_path.write_text(json.dumps(activation), encoding="utf-8")
        policy_path.write_text(json.dumps(policy), encoding="utf-8")
        signature_path.write_bytes(signature)
        root_path.write_text(json.dumps(root), encoding="utf-8")

        command = [
            sys.executable,
            str(SCRIPTS / "autonomous_policy_gate.py"),
            "--bundle",
            str(bundle_path),
            "--activation",
            str(activation_path),
            "--policy",
            str(policy_path),
            "--policy-signature",
            str(signature_path),
            "--trusted-policy-root",
            str(root_path),
            "--as-of",
            AS_OF,
        ]
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
            env={**os.environ, "QSL_TRUSTED_POLICY_ROOT_SHA256": str(root["trusted_policy_root_sha256"])},
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["policy_id"], policy["policy_id"])
        self.assertEqual(summary["stage"], "PAPER_DRY_RUN")
        self.assertNotIn("public_key", summary)
        self.assertNotIn("risk_control", summary)

        missing_root_environment = dict(os.environ)
        missing_root_environment.pop("QSL_TRUSTED_POLICY_ROOT_SHA256", None)
        missing_root = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
            env=missing_root_environment,
        )
        self.assertEqual(missing_root.returncode, 1)
        self.assertIn("must be injected by the independent execution control", missing_root.stderr)

    def test_root_policy_signature_target_and_lifetime_fail_closed(self):
        bundle = self._bundle()
        root = self._root()
        policy = self._policy(bundle)
        signature = self._sign(policy)
        activation = self._activation(bundle, signature)

        with self.assertRaisesRegex(autonomous_policy_gate.AutonomousPolicyValidationError, "externally pinned"):
            self._validate(bundle, activation, policy, signature, root, expected_root_sha256=self._sha("0"))

        altered_policy = copy.deepcopy(policy)
        altered_policy["risk_control"]["risk_policy_sha256"] = self._sha("b")
        altered_policy["policy_sha256"] = autonomous_policy_gate.calculate_policy_sha256(altered_policy)
        with self.assertRaisesRegex(autonomous_policy_gate.AutonomousPolicyValidationError, "signature verification"):
            self._validate(bundle, activation, altered_policy, signature, root)

        other_target = self._target()
        other_target["environment"] = "ibkr-shadow"
        target_policy = self._policy(bundle, target=other_target)
        target_signature = self._sign(target_policy)
        target_activation = self._activation(bundle, target_signature)
        with self.assertRaisesRegex(autonomous_policy_gate.AutonomousPolicyValidationError, "policy target"):
            self._validate(bundle, target_activation, target_policy, target_signature, root)

        expired_policy = self._policy(bundle)
        expired_policy["expires_at"] = "2026-08-05T11:00:00Z"
        expired_policy["policy_sha256"] = autonomous_policy_gate.calculate_policy_sha256(expired_policy)
        expired_signature = self._sign(expired_policy)
        expired_activation = self._activation(bundle, expired_signature)
        with self.assertRaisesRegex(autonomous_policy_gate.AutonomousPolicyValidationError, "not currently effective"):
            self._validate(bundle, expired_activation, expired_policy, expired_signature, root)

        short_lived_root = copy.deepcopy(root)
        short_lived_root["expires_at"] = "2026-08-05T20:00:00Z"
        short_lived_root["trusted_policy_root_sha256"] = autonomous_policy_gate.calculate_trusted_policy_root_sha256(short_lived_root)
        with self.assertRaisesRegex(autonomous_policy_gate.AutonomousPolicyValidationError, "policy validity window"):
            self._validate(
                bundle,
                activation,
                policy,
                signature,
                short_lived_root,
                expected_root_sha256=short_lived_root["trusted_policy_root_sha256"],
            )

    def test_zero_risk_admission_can_only_allow_reconcile_only(self):
        bundle = self._bundle()
        risk_control = self._risk_control()
        policy = self._policy(bundle, risk_policy_sha256=str(risk_control["risk_policy_sha256"]))
        signature = self._sign(policy)
        activation = self._activation(bundle, signature)
        root = self._root()
        admission = self._admission()

        result = reconcile_only_admission_gate.admit_reconcile_only(
            bundle=bundle,
            activation=activation,
            policy=policy,
            signature=signature,
            trusted_policy_root=root,
            expected_root_sha256=root["trusted_policy_root_sha256"],
            risk_control=risk_control,
            admission=admission,
            as_of=AS_OF,
        )

        self.assertEqual(result["status"], "RECONCILE_ONLY")
        self.assertFalse(result["new_risk_allowed"])
        self.assertFalse(result["write_action_allowed"])

        nonzero_risk = copy.deepcopy(risk_control)
        nonzero_risk["new_risk_ceiling"] = 1
        nonzero_risk["risk_policy_sha256"] = reconcile_only_admission_gate.calculate_risk_policy_sha256(nonzero_risk)
        with self.assertRaisesRegex(reconcile_only_admission_gate.ReconcileOnlyAdmissionError, "must be zero"):
            reconcile_only_admission_gate.admit_reconcile_only(
                bundle=bundle,
                activation=activation,
                policy=policy,
                signature=signature,
                trusted_policy_root=root,
                expected_root_sha256=root["trusted_policy_root_sha256"],
                risk_control=nonzero_risk,
                admission=admission,
                as_of=AS_OF,
            )

        non_reconcile_admission = copy.deepcopy(admission)
        non_reconcile_admission["admission_mode"] = "PAPER_DRY_RUN"
        non_reconcile_admission["admission_sha256"] = reconcile_only_admission_gate.calculate_admission_sha256(non_reconcile_admission)
        with self.assertRaisesRegex(reconcile_only_admission_gate.ReconcileOnlyAdmissionError, "admission_mode"):
            reconcile_only_admission_gate.admit_reconcile_only(
                bundle=bundle,
                activation=activation,
                policy=policy,
                signature=signature,
                trusted_policy_root=root,
                expected_root_sha256=root["trusted_policy_root_sha256"],
                risk_control=risk_control,
                admission=non_reconcile_admission,
                as_of=AS_OF,
            )

        unsafe_admission = copy.deepcopy(admission)
        unsafe_admission["orders"] = []
        unsafe_admission["admission_sha256"] = reconcile_only_admission_gate.calculate_admission_sha256(unsafe_admission)
        with self.assertRaisesRegex(reconcile_only_admission_gate.ReconcileOnlyAdmissionError, "forbidden"):
            reconcile_only_admission_gate.admit_reconcile_only(
                bundle=bundle,
                activation=activation,
                policy=policy,
                signature=signature,
                trusted_policy_root=root,
                expected_root_sha256=root["trusted_policy_root_sha256"],
                risk_control=risk_control,
                admission=unsafe_admission,
                as_of=AS_OF,
            )

        overlong_admission = copy.deepcopy(admission)
        overlong_admission["expires_at"] = "2026-08-05T18:30:00Z"
        overlong_admission["admission_sha256"] = reconcile_only_admission_gate.calculate_admission_sha256(overlong_admission)
        with self.assertRaisesRegex(reconcile_only_admission_gate.ReconcileOnlyAdmissionError, "every policy and activation window"):
            reconcile_only_admission_gate.admit_reconcile_only(
                bundle=bundle,
                activation=activation,
                policy=policy,
                signature=signature,
                trusted_policy_root=root,
                expected_root_sha256=root["trusted_policy_root_sha256"],
                risk_control=risk_control,
                admission=overlong_admission,
                as_of=AS_OF,
            )

    def test_reconcile_only_cli_parks_without_an_independent_root_digest(self):
        missing_root_environment = dict(os.environ)
        missing_root_environment.pop("QSL_TRUSTED_POLICY_ROOT_SHA256", None)
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "reconcile_only_admission_gate.py"),
                "--bundle",
                "missing-bundle.json",
                "--activation",
                "missing-activation.json",
                "--policy",
                "missing-policy.json",
                "--policy-signature",
                "missing-policy.sshsig",
                "--trusted-policy-root",
                "missing-root.json",
                "--risk-control",
                "missing-risk.json",
                "--admission",
                "missing-admission.json",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
            env=missing_root_environment,
        )

        self.assertEqual(result.returncode, 2)
        self.assertEqual(
            json.loads(result.stdout),
            {
                "new_risk_allowed": False,
                "reason_code": "ADMISSION_DENIED",
                "status": "PARKED",
                "write_action_allowed": False,
            },
        )
        self.assertIn("must be injected by the independent execution control", result.stderr)

    def test_contract_schemas_are_closed_and_do_not_claim_runtime_authority(self):
        policy_schema = json.loads((ROOT.parent / "schemas" / "qsl-autonomous-operating-policy.v1.schema.json").read_text())
        root_schema = json.loads((ROOT.parent / "schemas" / "qsl-trusted-policy-root.v1.schema.json").read_text())

        self.assertEqual(policy_schema["$id"], "qsl.autonomous_operating_policy.v1")
        self.assertFalse(policy_schema["additionalProperties"])
        self.assertIn("does not sign", policy_schema["description"])
        self.assertEqual(root_schema["$id"], "qsl.trusted_policy_root.v1")
        self.assertFalse(root_schema["additionalProperties"])
        self.assertIn("no private key", root_schema["description"])
        risk_schema = json.loads((ROOT.parent / "schemas" / "qsl-reconcile-only-risk-control.v1.schema.json").read_text())
        admission_schema = json.loads((ROOT.parent / "schemas" / "qsl-reconcile-only-admission.v1.schema.json").read_text())
        kms_schema = json.loads((ROOT.parent / "schemas" / "qsl-gcp-kms-policy-root.v1.schema.json").read_text())
        self.assertEqual(risk_schema["$id"], "qsl.reconcile_only_risk_control.v1")
        self.assertEqual(risk_schema["properties"]["new_risk_ceiling"], {"const": 0})
        self.assertEqual(admission_schema["$id"], "qsl.reconcile_only_admission.v1")
        self.assertFalse(admission_schema["additionalProperties"])
        self.assertEqual(kms_schema["$id"], "qsl.gcp_kms_policy_root.v1")
        self.assertEqual(kms_schema["properties"]["signature_algorithm"], {"const": "EC_SIGN_P256_SHA256"})


if __name__ == "__main__":
    unittest.main()
