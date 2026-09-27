import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import tomllib
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_PATH = REPO_ROOT / ".github/workflows/deploy-strategy-switch-console.yml"
EVIDENCE_KEYS = (
    "r7_policy_sha256",
    "r8_policy_sha256",
    "capital_policy_sha256",
    "settlement_policy_sha256",
    "raw_manifest_sha256",
    "r6_manifest_sha256",
    "r6_materialized_file_sha256",
)


def prepare_config_script():
    workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
    prepare_step = workflow.split("      - name: Prepare Wrangler config\n", 1)[1].split(
        "      - name:", 1
    )[0]
    run_block = prepare_step.split("        run: |\n", 1)[1]
    run_lines = [line[10:] if line.startswith("          ") else line for line in run_block.splitlines()]
    run_text = "\n".join(run_lines)
    match = re.search(r"python3 - <<'PY'\n(.*?)\nPY(?:\n|$)", run_text, re.DOTALL)
    if not match:
        raise AssertionError("Prepare Wrangler config must contain its inline Python config generator")
    return match.group(1)


class Ux1DeployWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = prepare_config_script()

    def run_config_generator(self, ux1_env):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        temp_root = Path(temporary.name)
        worker_dir = temp_root / "worker"
        worker_dir.mkdir()
        (worker_dir / "wrangler.toml.example").write_text(
            '[vars]\nEXISTING = "retained"\n\n'
            '# [[kv_namespaces]]\n'
            '# binding = "STRATEGY_SWITCH_CONFIG"\n'
            '# id = "replace-with-cloudflare-kv-namespace-id"\n\n',
            encoding="utf-8",
        )
        env = {
            **os.environ,
            "WORKER_DIR": str(worker_dir),
            "CLOUDFLARE_API_TOKEN": "synthetic-cloudflare-token",
            "STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID": "a" * 32,
            **ux1_env,
        }
        result = subprocess.run(
            [sys.executable, "-c", self.script],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        return result, worker_dir / "wrangler.toml"

    @staticmethod
    def valid_enabled_config():
        return {
            "UX1_PREVIEW_MODE": "github_actions",
            "UX1_UES_REVISION": "a" * 40,
            "UX1_RUNTIME_EPOCH": "b" * 32,
            "UX1_EXPECTED_EVIDENCE_HASHES": json.dumps(
                {key: "c" * 64 for key in EVIDENCE_KEYS}, separators=(",", ":")
            ),
            "UX1_RESEARCH_JOB_TOKEN": "synthetic-dedicated-token-value",
        }

    def test_enabled_config_is_toml_serialized_without_secret(self):
        result, config_path = self.run_config_generator(self.valid_enabled_config())

        self.assertEqual(result.returncode, 0, result.stderr)
        config_text = config_path.read_text(encoding="utf-8")
        config = tomllib.loads(config_text)
        variables = config["vars"]
        self.assertEqual(variables["EXISTING"], "retained")
        self.assertEqual(variables["UX1_PREVIEW_MODE"], "github_actions")
        self.assertEqual(variables["UX1_UES_REVISION"], "a" * 40)
        self.assertEqual(variables["UX1_RUNTIME_EPOCH"], "b" * 32)
        self.assertEqual(
            json.loads(variables["UX1_EXPECTED_EVIDENCE_HASHES"]),
            {key: "c" * 64 for key in EVIDENCE_KEYS},
        )
        self.assertNotIn("UX1_RESEARCH_JOB_TOKEN", config_text)
        self.assertNotIn("synthetic-dedicated-token-value", config_text)

    def test_empty_mode_preserves_local_binding_config(self):
        result, config_path = self.run_config_generator(
            {"UX1_PREVIEW_MODE": "", "UX1_RESEARCH_JOB_TOKEN": ""}
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        config = tomllib.loads(config_path.read_text(encoding="utf-8"))
        self.assertEqual(config["vars"]["EXISTING"], "retained")
        self.assertFalse(any(key.startswith("UX1_") for key in config["vars"]))

    def test_invalid_or_incomplete_enabled_config_fails(self):
        invalid_configs = [
            {"UX1_PREVIEW_MODE": "unexpected"},
            {"UX1_PREVIEW_MODE": " github_actions "},
            {"UX1_PREVIEW_MODE": "github_actions"},
            {
                **self.valid_enabled_config(),
                "UX1_UES_REVISION": "not-a-sha",
            },
            {
                **self.valid_enabled_config(),
                "UX1_EXPECTED_EVIDENCE_HASHES": "{}",
            },
            {
                **self.valid_enabled_config(),
                "UX1_RESEARCH_JOB_TOKEN": "short",
            },
            {
                **self.valid_enabled_config(),
                "UX1_RESEARCH_JOB_TOKEN": "synthetic-token-value\n",
            },
        ]
        for values in invalid_configs:
            with self.subTest(keys=tuple(sorted(values))):
                result, config_path = self.run_config_generator(values)
                self.assertNotEqual(result.returncode, 0)
                token = values.get("UX1_RESEARCH_JOB_TOKEN", "")
                if token:
                    self.assertNotIn(token, result.stdout + result.stderr)
                self.assertFalse(config_path.exists(), "invalid configuration must fail before writing deploy config")


if __name__ == "__main__":
    unittest.main()
