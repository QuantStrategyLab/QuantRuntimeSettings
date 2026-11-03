"""Private infrastructure configuration must fail before authentication."""
import os
from pathlib import Path
import re
import subprocess
import unittest
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def workflow_source(name):
    return (ROOT / ".github/workflows" / f"{name}.yml").read_text()


def signer_source():
    return (ROOT / "python/scripts/sign_promotion_manifest.sh").read_text()


class PrivateInfrastructureInputsTest(unittest.TestCase):
    def test_workflow_missing_inputs_fail_before_cloud_authentication(self):
        for name in ("digest-store-permission-check", "runtime-artifact-evidence-gate"):
            source = workflow_source(name)
            self.assertLess(source.index("Require private infrastructure configuration"), source.index("google-github-actions/auth@"))
            block = re.search(r"- name: Require private infrastructure configuration\n.*?run: \|\n(.*?)(?=\n      -)", source, re.S).group(1)
            script = "\n".join(line[10:] for line in block.splitlines())
            keys = ["GCP_PROJECT_ID", "GCP_WORKLOAD_IDENTITY_PROVIDER", "GCP_WORKLOAD_IDENTITY_SERVICE_ACCOUNT"]
            if name.startswith("digest"):
                keys.append("DIGEST_STORE_BUCKET")
            configured = {key: "synthetic-input" for key in keys}
            for missing in keys:
                env = {**configured, "PATH": os.environ["PATH"]}
                del env[missing]
                result = subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stderr.strip(), f"{missing} is required")
                self.assertEqual(result.stdout, "")
            self.assertEqual(subprocess.run(["bash", "-c", script], env=configured, capture_output=True).returncode, 0)
            for key in keys:
                self.assertIn(f"{key}: ${{{{ secrets.{key} }}}}", source)

    def test_manual_promotion_uses_private_mapping_and_records_but_independent_pin(self):
        source = workflow_source("manual-strategy-switch")
        for key in ("QSL_PROMOTION_ROOT_PROJECTS_JSON", "QSL_PROMOTION_ROOT_RECORDS_JSON"):
            self.assertIn(f"{key}: ${{{{ secrets.{key} }}}}", source)
        self.assertIn("QSL_PROMOTION_TRUSTED_ROOTS_JSON: ${{ vars.QSL_PROMOTION_TRUSTED_ROOTS_JSON }}", source)

    def test_signer_requires_private_project_and_suppresses_provider_diagnostics(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            marker = directory / "called"
            for name, text in {
                "python3": '#!/bin/sh\n: > "$6"\n',
                "gcloud": f'#!/bin/sh\ntouch "{marker}"\necho synthetic-private-provider-detail >&2\nexit 1\n',
            }.items():
                path = directory / name
                path.write_text(text)
                path.chmod(0o700)
            env = {"PATH": f"{directory}:{os.environ['PATH']}"}
            command = ["bash", "-c", signer_source(), str(ROOT / "python/scripts/sign_promotion_manifest.sh"),
                       "longbridge", "synthetic.json", str(directory / "signature.b64")]
            missing = subprocess.run(command, env=env, capture_output=True, text=True)
            self.assertNotEqual(missing.returncode, 0)
            self.assertFalse(marker.exists(), "missing project must fail before the provider")
            configured = subprocess.run(command, env={**env, "GCP_PROJECT_ID": "example-signing-project"}, capture_output=True, text=True)
            self.assertEqual(configured.returncode, 2)
            self.assertTrue(marker.exists())
            self.assertEqual(configured.stderr.strip(), "KMS signing failed")
            self.assertEqual(configured.stdout, "")
            self.assertFalse((directory / "signature.b64").exists())

    def test_digest_provider_has_no_embedded_project_number_fallback(self):
        source = workflow_source("daily-digest-notify")
        self.assertFalse(re.search(r"projects/[0-9]+/", source), "provider must come from private configuration")
        self.assertIn("vars.DIGEST_GCP_WORKLOAD_IDENTITY_PROVIDER", source)
