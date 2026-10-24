from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[2]


class RepositoryArchiveTest(unittest.TestCase):
    def test_source_archive_excludes_host_dependencies_and_runs_action_projection(self):
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            objects = temporary / "objects"
            objects.mkdir()
            repository_objects = subprocess.check_output(
                ["git", "rev-parse", "--git-path", "objects"], cwd=ROOT, text=True
            ).strip()
            env = dict(
                os.environ,
                GIT_INDEX_FILE=str(temporary / "index"),
                GIT_OBJECT_DIRECTORY=str(objects),
                GIT_ALTERNATE_OBJECT_DIRECTORIES=str((ROOT / repository_objects).resolve()),
            )

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=ROOT, env=env)

            # HEAD alone omits pending removals and this new regression test.
            git("read-tree", "HEAD")
            git("add", "--update", "--", ".")
            git("add", "--", "python/tests/test_repository_archive.py")
            tree = git("write-tree").decode().strip()
            tracked = git("ls-tree", "-r", "--name-only", "-z", tree).decode().split("\0")
            self.assertEqual([name for name in tracked if "node_modules" in PurePosixPath(name).parts], [])

            with tarfile.open(fileobj=io.BytesIO(git("archive", "--format=tar", tree))) as archive:
                members = archive.getmembers()
                self.assertEqual([
                    member.name for member in members
                    if "node_modules" in PurePosixPath(member.name).parts
                    or ((member.issym() or member.islnk()) and PurePosixPath(member.linkname).is_absolute())
                ], [])
                snapshot = (temporary / "snapshot").resolve()
                archive.extractall(snapshot, filter="data")

            action_path = Path("actions/publish-runtime-execution-evidence/action.yml")
            script_path = Path("python/scripts/execution_evidence_projection.py")
            for relative in (action_path, script_path):
                self.assertEqual((snapshot / relative).read_bytes(), (ROOT / relative).read_bytes())
            self.assertIn(
                '"$GITHUB_ACTION_PATH/../../python/scripts/execution_evidence_projection.py"',
                (snapshot / action_path).read_text(encoding="utf-8"),
            )
            output = temporary / "projection.json"
            subprocess.run(
                [sys.executable, "-I", str(snapshot / script_path),
                 "--source-id", "archive-regression", "--output", str(output)],
                cwd=snapshot, env={"PATH": ""}, check=True, capture_output=True,
            )
            projection = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(projection["schema_version"], "qsl_execution_evidence_source_snapshot.v1")
            self.assertEqual(projection["source_id"], "archive-regression")
            self.assertEqual(projection["data_status"], "unavailable")
            self.assertEqual(projection["deployments"], [])
            self.assertEqual(projection["errors"], ["runtime_report_no_eligible_records"])

            lifecycle_action = snapshot / "actions/publish-runtime-target-lifecycle/action.yml"
            lifecycle_script = (lifecycle_action.parent / "../../python/scripts/runtime_target_lifecycle.py").resolve()
            self.assertTrue(lifecycle_script.is_relative_to(snapshot))
            metadata = lifecycle_action.read_text(encoding="utf-8")
            self.assertIn('"$GITHUB_ACTION_PATH/../../python/scripts/runtime_target_lifecycle.py"', metadata)
            self.assertIn('"$GITHUB_ACTION_PATH/gcp_observation.py"', metadata)
            self.assertTrue((lifecycle_action.parent / "gcp_observation.py").is_file())
            self.assertEqual(lifecycle_action.read_bytes(), (ROOT / lifecycle_action.relative_to(snapshot)).read_bytes())

            # Both consumers must work from the extracted tree alone, without
            # a host checkout, installed package, or node_modules target.
            for platform in ("binance", "qmt"):
                with self.subTest(platform=platform):
                    subprocess.run(
                        [sys.executable, "-I", str(lifecycle_script),
                         "--source-id", "archive-regression", "--target-id", f"{platform}.synthetic",
                         "--platform", platform, "--configured-state", "disabled",
                         "--execution-mode", "dry_run", "--runtime-guard", "pass",
                         "--execution-heartbeat", "not_applicable", "--output", str(output)],
                        cwd=snapshot, env={"PATH": ""}, check=True, capture_output=True,
                    )
                    lifecycle = json.loads(output.read_text(encoding="utf-8"))
                    self.assertEqual(lifecycle["schema_version"], "qsl_runtime_target_lifecycle_source_snapshot.v1")
                    target = lifecycle["targets"][0]
                    self.assertEqual(target["target"]["configured_state"], "disabled")
                    self.assertEqual(target["target"]["execution_mode"], "dry_run")
                    self.assertEqual(target["disposition"]["code"], "continue_disabled_validation")
                    self.assertIs(target["no_order"], True)


if __name__ == "__main__":
    unittest.main()
