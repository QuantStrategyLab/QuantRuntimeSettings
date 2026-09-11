import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
import urllib.error

path = Path(__file__).resolve().parents[2] / "scripts/provision_soxl_v7_review_credential.py"
spec = importlib.util.spec_from_file_location("v7_credential", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class V7CredentialTests(unittest.TestCase):
    def execute(self, *, ref="refs/heads/main", branch="main", status=404, write_error=False, malformed_404=False):
        writes = []
        reads = []
        env = {"GITHUB_REPOSITORY": "QuantStrategyLab/QuantRuntimeSettings", "GITHUB_REF": ref,
               "GH_TOKEN": "synthetic-management", module.SECRET: "synthetic-review"}

        def run(args, **kw):
            if args[1] == "secret":
                writes.append((args, kw.get("input")))
                if write_error:
                    raise subprocess.TimeoutExpired(args, 30)
                return subprocess.CompletedProcess(args, 0, stdout="")
            if args[-1].endswith("deployment-branch-policies"):
                payload = {"branch_policies": [{"name": branch, "type": "branch"}]}
            elif args[-1].endswith(module.SECRET):
                payload = {"name": module.SECRET}
            else:
                payload = {"deployment_branch_policy": {"protected_branches": False, "custom_branch_policies": True}}
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps(payload))

        def opener(request, timeout):
            reads.append(request)
            payload = {} if malformed_404 else {"ok": False, "error": "research promotion ticket not found"}
            raise urllib.error.HTTPError(request.full_url, status, "synthetic", {}, io.BytesIO(json.dumps(payload).encode()))

        try:
            module.provision(env=env, run=run, opener=opener)
            error = None
        except Exception as exc:
            error = exc
        return error, writes, reads

    def test_single_fixed_secret_uses_stdin_after_read_only_verification(self):
        error, writes, reads = self.execute()
        self.assertIsNone(error)
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0], (["gh", "secret", "set", module.SECRET, "--repo", "QuantStrategyLab/UsEquitySnapshotPipelines", "--env", "market-data-nonlive"], "synthetic-review"))
        self.assertEqual(reads[0].get_method(), "GET")
        self.assertNotIn("synthetic-review", reads[0].full_url)

    def test_branch_tag_and_wildcard_never_write(self):
        for arguments in ({"ref": "refs/heads/feature"}, {"ref": "refs/tags/main"}, {"branch": "*"}):
            error, writes, _ = self.execute(**arguments)
            self.assertIsNotNone(error)
            self.assertEqual(writes, [])

    def test_authentication_failure_and_nonapplication_404_never_write(self):
        for arguments in ({"status": 401}, {"status": 403}, {"status": 503}, {"malformed_404": True}):
            error, writes, _ = self.execute(**arguments)
            self.assertIsNotNone(error)
            self.assertEqual(writes, [])

    def test_unknown_write_is_not_retried(self):
        error, writes, _ = self.execute(write_error=True)
        self.assertIsInstance(error, subprocess.TimeoutExpired)
        self.assertEqual(len(writes), 1)


if __name__ == "__main__":
    unittest.main()
