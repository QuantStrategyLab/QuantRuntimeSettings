from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "python" / "shell" / "checkout_internal_dependency_consumers.sh"
SECRET = "checkout-test-secret-must-not-appear"


class CheckoutInternalDependencyConsumersTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.consumers = self.root / "consumers"
        self.consumers.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.calls = self.root / "gh-calls.jsonl"
        self.git_calls = self.root / "git-calls.jsonl"
        real_git = shutil.which("git")
        self.assertIsNotNone(real_git)
        fake_git = self.bin / "git"
        fake_git.write_text(
            """#!/usr/bin/env python3
import json, os, subprocess, sys
from pathlib import Path
with Path(os.environ['TEST_GIT_CALLS']).open('a') as stream:
    stream.write(json.dumps({'args': sys.argv[1:], 'no_lazy_fetch': os.environ.get('GIT_NO_LAZY_FETCH')}) + '\\n')
sys.exit(subprocess.run([os.environ['TEST_REAL_GIT'], *sys.argv[1:]]).returncode)
""",
            encoding="utf-8",
        )
        fake_git.chmod(0o755)
        fake_gh = self.bin / "gh"
        fake_gh.write_text(
            """#!/usr/bin/env python3
import json, os, subprocess, sys
from pathlib import Path
args = sys.argv[1:]
with Path(os.environ['TEST_GH_CALLS']).open('a') as stream:
    stream.write(json.dumps(args) + '\\n')
if args[:1] == ['api']:
    sys.exit(0 if args[1].endswith('/branches/' + os.environ['TEST_AVAILABLE_REF']) else 1)
if args[:2] == ['repo', 'clone']:
    if os.environ.get('TEST_CLONE_ERROR'):
        print(os.environ['GH_TOKEN'], file=sys.stderr)
        sys.exit(1)
    ref = args[args.index('--branch') + 1]
    result = subprocess.run(['git', 'clone', '--branch', ref, os.environ['TEST_CLONE_SOURCE'], args[3]], capture_output=True)
    if result.returncode == 0:
        subprocess.run(['git', '-C', args[3], 'remote', 'set-url', 'origin', 'https://github.com/' + args[2] + '.git'], check=True, capture_output=True)
    sys.exit(result.returncode)
sys.exit(2)
""",
            encoding="utf-8",
        )
        fake_gh.chmod(0o755)
        self.env = dict(os.environ)
        self.env.update(
            PATH=str(self.bin) + os.pathsep + os.environ["PATH"],
            GH_TOKEN=SECRET,
            QSL_CONSUMER_REF="candidate",
            TEST_AVAILABLE_REF="main",
            TEST_GH_CALLS=str(self.calls),
            TEST_GIT_CALLS=str(self.git_calls),
            TEST_REAL_GIT=real_git,
        )
        self.env.pop("GITHUB_TOKEN", None)
        self.matrix = self.root / "matrix.json"
        self.write_matrix()

    def write_matrix(self, *, repo="Example", path="pyproject.toml"):
        self.matrix.write_text(
            json.dumps({"schema_version": 1, "dependencies": [{"consumer_repo": repo, "path": path}]}),
            encoding="utf-8",
        )

    def git(self, path, *args):
        return subprocess.run(
            ["git", "-C", str(path), *args], check=True, text=True, capture_output=True
        ).stdout.strip()

    def make_repo(self, *, path=None, origin=None):
        path = path or self.consumers / "Example"
        path.mkdir()
        self.git(path, "init", "-b", "main")
        self.git(path, "config", "user.name", "Fixture")
        self.git(path, "config", "user.email", "fixture@example.invalid")
        (path / "pyproject.toml").write_text("manifest-private-content\n", encoding="utf-8")
        (path / "uv.lock").write_text("lock-private-content\n", encoding="utf-8")
        self.git(path, "add", ".")
        self.git(path, "commit", "-m", "fixture")
        self.git(path, "remote", "add", "origin", origin or "https://github.com/QuantStrategyLab/Example.git")
        return path

    def run_checkout(self):
        return subprocess.run(
            ["bash", str(SCRIPT), "--output-root", str(self.consumers), "--matrix", str(self.matrix)],
            env=self.env, text=True, capture_output=True,
        )

    def evidence(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(SECRET, result.stdout + result.stderr)
        self.assertNotIn("private-content", result.stdout + result.stderr)
        return [json.loads(line) for line in result.stdout.splitlines()]

    def test_existing_checkout_records_real_head_and_dirty_hashes_without_mutation(self):
        path = self.make_repo(origin=f"https://x-access-token:{SECRET}@github.com/QuantStrategyLab/Example.git")
        self.git(path, "checkout", "-b", "local-changes")
        head = self.git(path, "rev-parse", "HEAD")
        original = (path / "pyproject.toml").read_bytes()
        changed = b"changed-private-content\n"
        (path / "pyproject.toml").write_bytes(changed)
        result = self.run_checkout()
        record, = self.evidence(result)
        self.assertEqual(record["origin"], "QuantStrategyLab/Example")
        self.assertEqual(record["head_sha"], head)
        self.assertEqual(record["selected_ref"], "local-changes")
        self.assertEqual(record["requested_ref"], "candidate")
        self.assertEqual(record["checkout_kind"], "existing")
        self.assertTrue(record["worktree_dirty"])
        files = {item["path"]: item for item in record["dependency_files"]}
        self.assertEqual(files["pyproject.toml"]["sha256"], hashlib.sha256(changed).hexdigest())
        self.assertEqual(files["pyproject.toml"]["head_sha256"], hashlib.sha256(original).hexdigest())
        self.assertEqual(files["uv.lock"]["status"], "present")
        self.assertEqual((path / "pyproject.toml").read_bytes(), changed)
        self.assertEqual(self.git(path, "rev-parse", "HEAD"), head)
        self.assertFalse(self.calls.exists(), "existing checkouts must not fetch or pull")

    def test_detached_linked_worktree_is_preserved_and_reports_exact_ref(self):
        source = self.make_repo(path=self.root / "source", origin="git@github.com:QuantStrategyLab/Example.git")
        path = self.consumers / "Example"
        self.git(source, "worktree", "add", "--detach", str(path), "HEAD")
        self.assertTrue((path / ".git").is_file())
        record, = self.evidence(self.run_checkout())
        self.assertEqual(record["selected_ref"], self.git(path, "rev-parse", "HEAD"))
        self.assertFalse(record["worktree_dirty"])
        self.assertFalse(self.calls.exists())

    def test_clone_fallback_records_main_and_actual_full_head(self):
        source = self.make_repo(path=self.root / "source")
        self.env["TEST_CLONE_SOURCE"] = str(source)
        record, = self.evidence(self.run_checkout())
        self.assertEqual(record["checkout_kind"], "cloned")
        self.assertEqual(record["selected_ref"], "main")
        self.assertEqual(record["head_sha"], self.git(source, "rev-parse", "HEAD"))
        self.assertRegex(record["head_sha"], r"^[0-9a-f]{40}$")

    def test_clone_uses_available_requested_branch(self):
        source = self.make_repo(path=self.root / "source")
        self.git(source, "checkout", "-b", "candidate")
        self.env.update(TEST_CLONE_SOURCE=str(source), TEST_AVAILABLE_REF="candidate")
        record, = self.evidence(self.run_checkout())
        self.assertEqual(record["selected_ref"], "candidate")

    def test_wrong_origin_fails_without_leaking_credentials(self):
        self.make_repo(origin=f"https://{SECRET}@github.com/OtherOwner/OtherRepo.git")
        result = self.run_checkout()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("repository identity", result.stderr)
        self.assertNotIn(SECRET, result.stdout + result.stderr)
        self.assertNotIn("OtherOwner", result.stdout + result.stderr)
        self.assertFalse(self.calls.exists())

    def test_clone_errors_and_ambiguous_origins_never_leak_remote_details(self):
        self.env["TEST_CLONE_ERROR"] = "1"
        result = self.run_checkout()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(SECRET, result.stdout + result.stderr)
        path = self.make_repo()
        self.git(path, "config", "--add", "remote.origin.url", f"https://{SECRET}@example.invalid/OtherRepo")
        result = self.run_checkout()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(SECRET, result.stdout + result.stderr)
        self.assertNotIn("example.invalid", result.stdout + result.stderr)

    def test_ssh_and_case_insensitive_https_origins_emit_only_canonical_identity(self):
        path = self.make_repo()
        for origin in ("ssh://git@github.com/QuantStrategyLab/Example.git", "https://github.com/quantstrategylab/example"):
            with self.subTest(origin=origin):
                self.git(path, "remote", "set-url", "origin", origin)
                record, = self.evidence(self.run_checkout())
                self.assertEqual(record["origin"], "QuantStrategyLab/Example")

    def test_evidence_git_calls_inherit_no_lazy_fetch(self):
        path = self.make_repo()
        self.env["GIT_NO_LAZY_FETCH"] = "0"
        self.evidence(self.run_checkout())
        calls = [json.loads(line) for line in self.git_calls.read_text().splitlines()]
        evidence_calls = [call for call in calls if call["args"][:2] == ["-C", str(path)]]
        self.assertTrue(evidence_calls)
        self.assertTrue(all(call["no_lazy_fetch"] == "1" for call in evidence_calls))

    def test_missing_head_blob_fails_closed_without_fetching(self):
        path = self.make_repo()
        blob = self.git(path, "rev-parse", "HEAD:pyproject.toml")
        (path / ".git" / "objects" / blob[:2] / blob[2:]).unlink()
        result = self.run_checkout()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn("integrity check failed", result.stderr)
        calls = [json.loads(line) for line in self.git_calls.read_text().splitlines()]
        evidence_calls = [call for call in calls if call["args"][:2] == ["-C", str(path)]]
        self.assertTrue(all(call["no_lazy_fetch"] == "1" for call in evidence_calls))
        self.assertFalse(any("fetch" in call["args"] for call in calls))
        self.assertFalse(self.calls.exists())

    def test_existing_non_repository_and_invalid_head_fail(self):
        path = self.consumers / "Example"
        path.mkdir()
        (path / "keep.txt").write_text("keep", encoding="utf-8")
        self.assertNotEqual(self.run_checkout().returncode, 0)
        self.assertEqual((path / "keep.txt").read_text(), "keep")
        self.git(path, "init", "-b", "main")
        self.git(path, "remote", "add", "origin", "https://github.com/QuantStrategyLab/Example.git")
        result = self.run_checkout()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("HEAD", result.stderr)
        self.assertFalse(self.calls.exists())

    def test_missing_manifest_is_explicit_and_untracked_lock_is_hashed(self):
        path = self.make_repo()
        (path / "pyproject.toml").unlink()
        (path / "requirements-lock.txt").write_text("new-private-content\n", encoding="utf-8")
        record, = self.evidence(self.run_checkout())
        files = {item["path"]: item for item in record["dependency_files"]}
        self.assertEqual(files["pyproject.toml"]["status"], "missing")
        self.assertIsNone(files["pyproject.toml"]["sha256"])
        self.assertIsNotNone(files["pyproject.toml"]["head_sha256"])
        self.assertIsNone(files["requirements-lock.txt"]["head_sha256"])
        self.assertEqual(files["requirements-lock.txt"]["status"], "present")

    def test_symlinked_manifest_fails_without_reading_target_content(self):
        path = self.make_repo()
        external = self.root / "external"
        external.write_text(SECRET, encoding="utf-8")
        (path / "pyproject.toml").unlink()
        (path / "pyproject.toml").symlink_to(external)
        result = self.run_checkout()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(SECRET, result.stdout + result.stderr)

    def test_invalid_matrix_repository_or_path_fails_before_checkout(self):
        for repo, path in (("../escape", "pyproject.toml"), ("Example", "../secret")):
            with self.subTest(repo=repo, path=path):
                self.write_matrix(repo=repo, path=path)
                result = self.run_checkout()
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(list(self.consumers.iterdir()), [])
                self.assertFalse(self.calls.exists())


if __name__ == "__main__":
    unittest.main()
