from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
OPENSSL = shutil.which("openssl")
AS_OF = datetime(2026, 8, 19, 12, 0, 0, tzinfo=UTC)


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
_load_module("gcp_kms_policy_gate")
bootstrap = _load_module("provision_gcp_kms_policy_roots")


@unittest.skipUnless(OPENSSL, "OpenSSL is required to validate a P-256 public root")
class ProvisionGcpKmsPolicyRootsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="qsl-kms-root-bootstrap-test-")
        self.directory = Path(self.temporary.name)
        private = self.directory / "private.pem"
        public = self.directory / "public.pem"
        generated = subprocess.run(
            [str(OPENSSL), "genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-out", str(private)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        self.assertEqual(generated.returncode, 0)
        exported = subprocess.run(
            [str(OPENSSL), "pkey", "-in", str(private), "-pubout", "-out", str(public)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        self.assertEqual(exported.returncode, 0)
        self.public_key_pem = public.read_text(encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_build_root_is_pinned_to_one_project_key_version_and_one_year_window(self):
        root = bootstrap.build_root_record(project="firstradequant", public_key_pem=self.public_key_pem, as_of=AS_OF)

        self.assertEqual(root["root_id"], "qsl-firstradequant-p0-root-v1")
        self.assertEqual(root["signature_algorithm"], "EC_SIGN_P256_SHA256")
        self.assertEqual(
            root["kms_key_version"],
            "projects/firstradequant/locations/global/keyRings/qsl-p0-policy-root/cryptoKeys/autonomy-policy-root-v1/cryptoKeyVersions/1",
        )
        self.assertEqual(root["effective_at"], "2026-08-19T12:00:00Z")
        self.assertEqual(root["expires_at"], "2027-08-19T12:00:00Z")

    def test_existing_public_record_is_idempotent_but_a_changed_public_key_is_rejected(self):
        root = bootstrap.build_root_record(project="binancequant", public_key_pem=self.public_key_pem, as_of=AS_OF)
        destination = self.directory / "roots" / "binancequant.json"

        first = bootstrap.write_or_validate_root_record(destination=destination, root=root, as_of=AS_OF)
        second = bootstrap.write_or_validate_root_record(destination=destination, root=root, as_of=AS_OF)
        self.assertEqual(first, root["trusted_policy_root_sha256"])
        self.assertEqual(second, first)
        serialized = json.loads(destination.read_text(encoding="utf-8"))
        self.assertNotIn("private", json.dumps(serialized).lower())

        altered = dict(root)
        altered["public_key_pem"] = root["public_key_pem"].replace("PUBLIC KEY", "PUBLIC KEY ", 1)
        with self.assertRaisesRegex(bootstrap.BootstrapError, "conflicts on public_key_pem"):
            bootstrap.write_or_validate_root_record(destination=destination, root=altered, as_of=AS_OF)

    def test_checked_in_public_root_records_are_closed_and_self_validating(self):
        root_directory = ROOT.parent / "docs" / "p0_control_roots" / "gcp"
        records = {path.stem: json.loads(path.read_text(encoding="utf-8")) for path in root_directory.glob("*.json")}
        self.assertEqual(
            set(records),
            {
                "alpaca-shadow-control",
                "binancequant",
                "charlesschwabquant",
                "firstradequant",
                "interactivebrokersquant",
                "longbridgequant",
                "qslresearchquant",
            },
        )
        for project, root in records.items():
            with self.subTest(project=project):
                self.assertEqual(root["root_id"], f"qsl-{project}-p0-root-v1")
                self.assertEqual(root["signature_algorithm"], "EC_SIGN_P256_SHA256")
                self.assertNotIn("private", json.dumps(root).lower())
                bootstrap.validate_gcp_kms_policy_root(
                    root,
                    expected_root_sha256=root["trusted_policy_root_sha256"],
                    as_of=root["effective_at"],
                )

    def test_default_invocation_is_an_apply_required_plan_without_cloud_mutation(self):
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "provision_gcp_kms_policy_roots.py"),
                "--project",
                "binancequant",
                "--project",
                "firstradequant",
                "--root-record-dir",
                str(self.directory / "planned-roots"),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(result.stdout)
        self.assertTrue(plan["apply_required"])
        self.assertEqual([item["project"] for item in plan["operations"]], ["binancequant", "firstradequant"])
        self.assertFalse((self.directory / "planned-roots").exists())

    def test_only_known_kms_api_propagation_errors_are_retryable(self):
        self.assertTrue(bootstrap._is_kms_api_propagation_error(bootstrap.BootstrapError("Cloud KMS API has not been used")))
        self.assertTrue(bootstrap._is_kms_api_propagation_error(bootstrap.BootstrapError("cloudkms.googleapis.com is disabled")))
        self.assertFalse(bootstrap._is_kms_api_propagation_error(bootstrap.BootstrapError("permission denied to create a key")))

    def test_create_already_exists_is_idempotent_but_other_creation_errors_raise(self):
        calls: list[tuple[object, ...]] = []
        original = bootstrap._gcloud

        def existing(arguments, *, check=True):
            calls.append(tuple(arguments))
            raise bootstrap.BootstrapError("ALREADY_EXISTS: delayed response")

        bootstrap._gcloud = existing
        try:
            bootstrap._create_or_accept_existing(("kms", "keys", "create"))
            self.assertEqual(calls, [("kms", "keys", "create")])

            def denied(arguments, *, check=True):
                raise bootstrap.BootstrapError("PERMISSION_DENIED")

            bootstrap._gcloud = denied
            with self.assertRaisesRegex(bootstrap.BootstrapError, "PERMISSION_DENIED"):
                bootstrap._create_or_accept_existing(("kms", "keys", "create"))
        finally:
            bootstrap._gcloud = original


if __name__ == "__main__":
    unittest.main()
