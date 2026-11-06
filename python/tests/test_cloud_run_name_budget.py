from __future__ import annotations

import contextlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import build_runtime_switch as switch


class CloudRunNameBudgetTest(unittest.TestCase):
    def args(self, *extra, platform="ibkr", target="paper"):
        return switch.build_parser().parse_args([
            "--platform", platform, "--target-name", target,
            "--strategy-profile", "tqqq_growth_income", "--execution-mode", "dry_run", *extra,
        ])

    def test_impossible_override_refuses_without_echo_or_output(self):
        name = "interactive-brokers-" + "x" * 20 + "-service"
        self.assertEqual(len(name), 48)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "target.json"
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                status = switch.main([
                    "--platform", "ibkr", "--target-name", "paper",
                    "--strategy-profile", "tqqq_growth_income", "--execution-mode", "dry_run",
                    "--service-name", name, "--output", str(output),
                ])
            self.assertEqual(status, 2)
            self.assertFalse(output.exists())
            self.assertIn("TAG_IMPOSSIBLE", stderr.getvalue())
            self.assertNotIn(name, stderr.getvalue())

    def test_tight_names_refuse_fixed_candidate_contract(self):
        for length in (34, 37, 45):
            with self.subTest(length=length), self.assertRaisesRegex(ValueError, "TAG_TIGHT"):
                switch.build_switch_target(self.args("--service-name", "s" * length))

    def test_generated_and_fixed_names_use_same_gate(self):
        for platform in ("ibkr", "longbridge"):
            with self.subTest(platform=platform), self.assertRaisesRegex(ValueError, "TAG_IMPOSSIBLE"):
                switch.build_switch_target(self.args(platform=platform, target="x" * 30))
        with patch.dict(switch.DEFAULT_SERVICE_NAME, {"firstrade": "s" * 48}):
            with self.assertRaisesRegex(ValueError, "TAG_IMPOSSIBLE"):
                switch.build_switch_target(self.args(platform="firstrade"))

    def test_invalid_names_fail_without_echo(self):
        for name in (" ", "Bad-Service", "-bad", "bad-", "bad_name", "é-service", "bad\nname"):
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, "service_name") as caught:
                    switch.build_switch_target(self.args("--service-name=" + name))
                if name.strip():
                    self.assertNotIn(name, str(caught.exception))

    def test_short_names_pass_unchanged_at_exact_boundary(self):
        for name in ("s", "demo-service", "s" * 33):
            with self.subTest(name=name):
                target = switch.build_switch_target(self.args("--service-name", name))
                self.assertEqual(target["runtime_target"]["service_name"], name)
        for platform in switch.SUPPORTED_PLATFORMS:
            with self.subTest(platform=platform):
                target = switch._build_runtime_target(self.args(platform=platform))
                self.assertLessEqual(len(target["service_name"]), 33)

    def test_retained_inventory_aliases_cannot_bypass_gate(self):
        for alias in ("service", "service_name", "cloud_run_service", "runtime_target"):
            bad = {alias: {"service_name": "s" * 48} if alias == "runtime_target" else "s" * 48}
            with self.subTest(alias=alias), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "inventory.json"
                path.write_text(json.dumps({"targets": [bad]}))
                before = path.read_bytes()
                with self.assertRaisesRegex(ValueError, "TAG_IMPOSSIBLE"):
                    switch.build_switch_target(self.args(
                        "--service-name", "demo-service", "--allow-create-service-target",
                        "--existing-service-targets-json-file", str(path),
                    ))
                self.assertEqual(path.read_bytes(), before)

    def test_workflow_only_forwards_validated_target(self):
        root = SCRIPTS.parents[1]
        workflow = (root / ".github/workflows/manual-strategy-switch.yml").read_text()
        step = workflow.split("      - name: Build switch target\n", 1)[1].split("      - name:", 1)[0]
        script = "\n".join(line[10:] for line in step.split("        run: |\n", 1)[1].splitlines())
        for name, status in (("s" * 48, 2), ("demo-service", 0)):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                env = {**os.environ, **{key: "" for key in re.findall(r"\$\{([A-Z_]+)", script)}}
                env.update(PLATFORM="ibkr", TARGET_NAME="paper", STRATEGY_PROFILE="tqqq_growth_income",
                           EXECUTION_MODE="dry_run", PLUGIN_MODE="none", OPTION_OVERLAY_MODE="current",
                           VARIABLE_SCOPE="default", SERVICE_NAME=name, RUNNER_TEMP=directory,
                           GITHUB_ENV=str(Path(directory) / "env"))
                result = subprocess.run(["bash", "-c", script], cwd=root, env=env,
                                        capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, status, result.stderr)
                output = Path(directory) / "runtime-switch-target.json"
                self.assertEqual(output.exists(), status == 0)
                if status:
                    self.assertIn("::error::Switch target refused", result.stdout)
                    self.assertFalse(Path(env["GITHUB_ENV"]).exists())
                    self.assertNotIn(name, result.stdout + result.stderr)
                else:
                    self.assertIn("TARGET_FILE=", Path(env["GITHUB_ENV"]).read_text())
                    self.assertEqual(json.loads(output.read_text())["runtime_target"]["service_name"], name)

    def test_separate_cli_processes_refuse_same_invalid_name(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "target.json"
            command = [sys.executable, str(SCRIPTS / "build_runtime_switch.py"),
                       "--platform", "ibkr", "--target-name", "paper", "--strategy-profile",
                       "tqqq_growth_income", "--execution-mode", "dry_run", "--service-name",
                       "s" * 48, "--output", str(output)]
            processes = [subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                         for _ in range(2)]
            results = [(process, process.communicate(timeout=30)) for process in processes]
            for process, (stdout, stderr) in results:
                self.assertEqual(process.returncode, 2)
                self.assertEqual(stdout, "")
                self.assertIn("TAG_IMPOSSIBLE", stderr)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
