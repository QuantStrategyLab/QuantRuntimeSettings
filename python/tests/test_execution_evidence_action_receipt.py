"""Exercise projection and receipt handling in the composite sender."""

import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
ACTION = ROOT / "actions/publish-runtime-execution-evidence"

CURL_FIXTURE = r"""
import json
import os
from pathlib import Path
import sys

args = sys.argv[1:]
mode = os.environ["TEST_RESPONSE"]
# The former action discarded its body and did not ask curl for the status.
if "--output" not in args:
    sys.exit(0)
assert "synthetic-bearer" not in " ".join(args)
header_args = [args[i + 1] for i, value in enumerate(args) if value == "--header"]
assert "@-" in header_args
header_lines = [line for line in header_args if line != "@-"] + sys.stdin.read().splitlines()
headers = dict(line.split(": ", 1) for line in header_lines)
assert headers["Authorization"] == "Bearer synthetic-bearer"
snapshot = json.loads(Path(args[args.index("--data-binary") + 1][1:]).read_text())
receipt = {
    "ok": True,
    "source_id": snapshot["source_id"],
    "schema_version": snapshot["schema_version"],
    "deployment_count": len(snapshot["deployments"]),
    "generated_at": snapshot["generated_at"],
    "receipt_id": headers["X-QSL-Execution-Evidence-Receipt"],
    "ignored": "synthetic-untrusted-body",
}
if mode == "wrong-id":
    receipt["receipt_id"] = "other"
if mode == "wrong-source":
    receipt["source_id"] = "other"
if mode == "wrong-schema":
    receipt["schema_version"] = "other"
if mode == "wrong-count":
    receipt["deployment_count"] = 1
if mode == "wrong-time":
    receipt["generated_at"] = "2020-01-01T00:00:00Z"
if mode == "missing-time":
    del receipt["generated_at"]
if mode == "wrong-ok":
    receipt["ok"] = False
body = json.dumps(receipt)
if mode == "html":
    body = "<html>synthetic-untrusted-body</html>"
if mode == "multiple":
    body += "\n" + body
Path(args[args.index("--output") + 1]).write_text(body)
print("302" if mode == "redirect" else "200", end="")
if mode == "transport-failure":
    sys.exit(7)
"""


class ExecutionEvidenceActionReceiptTest(unittest.TestCase):
    def run_sender(self, response):
        action = (ACTION / "action.yml").read_text()
        # Skip cloud enumeration and run the shipped projection and transport.
        projection = action.split("        snapshot_path=", 1)[1]
        script = (
            'set -euo pipefail\nwork_dir="$TEST_WORK_DIR"\nreport_args=(--runtime-report "$work_dir/fixture.json")\n'
            'snapshot_path=' + projection
        )
        with tempfile.TemporaryDirectory() as directory:
            executable_dir = Path(directory)
            (executable_dir / "fixture.json").write_text("{}")
            path = executable_dir / "curl"
            path.write_text(f"#!{sys.executable}\n" + CURL_FIXTURE)
            path.chmod(0o700)
            env = dict(
                os.environ,
                PATH=f"{executable_dir}{os.pathsep}{os.environ['PATH']}",
                GITHUB_ACTION_PATH=str(ACTION),
                INPUT_SOURCE_ID="synthetic-source",
                INPUT_SYNC_URL="https://synthetic.example",
                INPUT_MAX_REPORT_AGE_HOURS="24",
                EXECUTION_EVIDENCE_SYNC_TOKEN="synthetic-bearer",
                TEST_RESPONSE=response,
                TEST_WORK_DIR=directory,
            )
            return subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True)

    def test_emits_only_bound_receipt_metadata(self):
        result = self.run_sender("ok")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(re.fullmatch(
            r"Execution-evidence receipt: http=200 deployments=0 id=[0-9a-f-]{36}\n",
            result.stdout,
        ))
        self.assertEqual(result.stderr, "")

    def test_rejects_redirects_and_unbound_receipts_without_exposing_response(self):
        for mode in ("redirect", "html", "multiple", "wrong-id", "wrong-source", "wrong-schema",
                     "wrong-count", "wrong-time", "missing-time", "wrong-ok", "transport-failure"):
            with self.subTest(mode=mode):
                result = self.run_sender(mode)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, "")
                self.assertIn("execution-evidence", result.stderr)
                self.assertNotIn("synthetic", result.stderr)
