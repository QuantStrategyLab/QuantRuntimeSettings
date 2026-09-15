from __future__ import annotations

import unittest
import tempfile
import importlib.util
import os
import re
import subprocess
import sys
import textwrap
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CHECKER_SPEC = importlib.util.spec_from_file_location("check_qsl_compat_workflow", ROOT / "scripts/check_qsl_compat.py")
assert CHECKER_SPEC.loader is not None
CHECKER = importlib.util.module_from_spec(CHECKER_SPEC)
sys.modules[CHECKER_SPEC.name] = CHECKER
CHECKER_SPEC.loader.exec_module(CHECKER)


class QslExceptionLifecycleWorkflowTest(unittest.TestCase):
    def test_manual_scope_and_schedule_current_are_explicit(self) -> None:
        workflow = (ROOT / ".github/workflows/qsl_exception_lifecycle.yml").read_text(encoding="utf-8")
        self.assertIn("scope:", workflow)
        self.assertIn("default: current", workflow)
        self.assertIn("- current", workflow)
        self.assertIn("- frozen", workflow)
        self.assertIn("QSL_SCOPE: ${{ github.event_name == 'schedule' && 'current' || inputs.scope || 'current' }}", workflow)
        self.assertIn('--scope "${{ steps.workspace.outputs.scope }}"', workflow)

    def test_workflow_keeps_frozen_checkout_and_current_main_sha_recording(self) -> None:
        workflow = (ROOT / ".github/workflows/qsl_exception_lifecycle.yml").read_text(encoding="utf-8")
        self.assertIn('if [ "${QSL_SCOPE}" = "frozen" ]; then', workflow)
        self.assertIn('git -C "$workspace/$repo" checkout --detach "$ref"', workflow)
        self.assertIn('git -C "$workspace/$repo" checkout --detach origin/main', workflow)
        self.assertIn('git -C "$workspace/$repo" rev-parse HEAD', workflow)
        self.assertIn('if report["strict_repositories"] or report["warning_repositories"]:', workflow)
        self.assertIn('destination="$(realpath -m "$(cat "$marker")")"', workflow)
        self.assertIn('expected="$(realpath -m "${GITHUB_WORKSPACE}/../AIAuditBridge")"', workflow)

    def test_cleanup_shell_normalizes_resolved_identity_marker_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = root / "runner" / "work" / "QRT"
            identity = root / "runner" / "work" / "AIAuditBridge"
            workspace.mkdir(parents=True)
            identity.mkdir()
            workflow = (ROOT / ".github/workflows/qsl_exception_lifecycle.yml").read_text(encoding="utf-8")
            match = re.search(
                r"- name: Clean up research dependency identity\n"
                r"\s+if: always\(\)\n\s+run: \|\n((?:\s{10}.*\n)+)",
                workflow,
            )
            self.assertIsNotNone(match)
            script = textwrap.dedent(match.group(1))
            # macOS ships a realpath without GNU's -m; provide the same tiny
            # command surface locally while exercising the workflow shell.
            bin_dir = root / "bin"
            bin_dir.mkdir()
            (bin_dir / "realpath").write_text(
                "#!/usr/bin/env python3\n"
                "import os, sys\n"
                "args = sys.argv[1:]\n"
                "if args and args[0] == '-m': args = args[1:]\n"
                "print(os.path.abspath(os.path.normpath(args[0])))\n",
                encoding="utf-8",
            )
            (bin_dir / "realpath").chmod(0o755)
            env = {
                "RUNNER_TEMP": str(root / "runner"),
                "GITHUB_WORKSPACE": str(workspace.resolve()),
                "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}",
            }
            marker = root / "runner" / "qsl-aiauditbridge-identity-created"
            marker.write_text(str(identity.resolve()), encoding="utf-8")
            subprocess.run(["bash", "-c", script], check=True, env=env, capture_output=True, text=True)
            self.assertFalse(identity.exists())
            self.assertFalse(marker.exists())

            unexpected = root / "runner" / "unexpected-AIAuditBridge"
            unexpected.mkdir()
            marker.write_text(str(unexpected.resolve()), encoding="utf-8")
            result = subprocess.run(["bash", "-c", script], check=False, env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(unexpected.exists())
            self.assertTrue(marker.exists())

    def test_workflow_layout_current_checks_four_consumers_and_keeps_direction_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "qsl-workspace"
            workspace.mkdir()
            compat_root = ROOT
            ref = "4664c2b283e9409a7dae4febf8571260c9f72724"
            for name in ("CnEquityStrategies", "UsEquityStrategies", "HkEquityStrategies", "CryptoStrategies"):
                repo = workspace / name
                repo.mkdir()
                (repo / "qsl.toml").write_text(
                    'tier = "strategy-lib"\nupgrade_ring = "ring_b"\n[compat]\n'
                    'bundle = "2026.09.1"\nrequires = ["quant-platform-kit @ git+https://github.com/QuantStrategyLab/'
                    f'QuantPlatformKit.git@{ref}"]\n', encoding="utf-8"
                )
                (repo / "pyproject.toml").write_text(
                    'dependencies = ["quant-platform-kit @ git+https://github.com/QuantStrategyLab/'
                    f'QuantPlatformKit.git@{ref}"]\n', encoding="utf-8"
                )
                (repo / "uv.lock").write_text(
                    f'source = "git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@{ref}"\n', encoding="utf-8"
                )
            results = {
                name: CHECKER._check(repo_root=workspace / name, compat_root=compat_root, scope="current")
                for name in ("CnEquityStrategies", "UsEquityStrategies", "HkEquityStrategies", "CryptoStrategies")
            }
            for name, result in results.items():
                self.assertTrue(result[0], (name, result[1]))

            probe = workspace / "CoreProbe"
            probe.mkdir()
            ref = "18dc01711f0776a07903a7a6524bab5455c09fb1"
            dependency = workspace / "UsEquityStrategies"
            (dependency / "qsl.toml").write_text(
                'tier = "strategy-lib"\nupgrade_ring = "ring_b"\n[compat]\n'
                'bundle = "2026.09.1"\n', encoding="utf-8"
            )
            (probe / "qsl.toml").write_text(
                'tier = "core"\nupgrade_ring = "ring_a"\n[compat]\n'
                'bundle = "2026.09.1"\nrequires = ["us-equity-strategies @ git+https://github.com/QuantStrategyLab/'
                f'UsEquityStrategies.git@{ref}"]\n', encoding="utf-8"
            )
            (probe / "pyproject.toml").write_text(
                'dependencies = ["us-equity-strategies @ git+https://github.com/QuantStrategyLab/'
                f'UsEquityStrategies.git@{ref}"]\n', encoding="utf-8"
            )
            (probe / "uv.lock").write_text(
                f'source = "git+https://github.com/QuantStrategyLab/UsEquityStrategies.git@{ref}"\n', encoding="utf-8"
            )
            blocked = CHECKER._check(repo_root=probe, compat_root=compat_root, scope="current")
            self.assertFalse(blocked[0])
            self.assertTrue(any("forbidden dependency direction" in issue for issue in blocked[1]))


if __name__ == "__main__":
    unittest.main()
