from __future__ import annotations

import unittest
import tempfile
import importlib.util
import os
import re
import subprocess
import sys
import textwrap
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CHECKER_SPEC = importlib.util.spec_from_file_location("check_qsl_compat_workflow", ROOT / "scripts/check_qsl_compat.py")
assert CHECKER_SPEC.loader is not None
CHECKER = importlib.util.module_from_spec(CHECKER_SPEC)
sys.modules[CHECKER_SPEC.name] = CHECKER
CHECKER_SPEC.loader.exec_module(CHECKER)

AI_REF = "65c8bcf432f578f657c12d5dab0e16ebec0bef5a"
AI_URL = "https://github.com/QuantStrategyLab/QuantAIService.git"
AI_QSL = 'tier = "ops/tooling"\nupgrade_ring = "ring_e"\nruntime_dependency = false\n[compat]\nbundle = "2026.07.0"\n'


class QslExceptionLifecycleWorkflowTest(unittest.TestCase):
    def _identity_script(self) -> str:
        workflow = (ROOT / ".github/workflows/qsl_exception_lifecycle.yml").read_text(encoding="utf-8")
        step = workflow.split("        id: research_dependency\n", 1)[1]
        return textwrap.dedent(step.split("python3 - <<'PY'\n", 1)[1].split("          PY\n", 1)[0])

    def _write_ai_consumer(
        self, workspace: Path, name: str, extra: str, *, ref: str = AI_REF,
        repository: str = "QuantStrategyLab/QuantAIService", duplicate: bool = False,
        base: bool = False, lock_ref: str | None = None, marker: str | None = None,
    ) -> None:
        consumer = workspace / name
        consumer.mkdir(parents=True, exist_ok=True)
        requirement = f'ai-gateway-client @ git+https://github.com/{repository}.git@{ref}'
        entries = [requirement] * (2 if duplicate else 1)
        (consumer / "qsl.toml").write_text(
            'tier = "strategy-lib"\nupgrade_ring = "ring_b"\n[compat]\nbundle = "2026.07.1"\n'
            f'requires = ["{requirement}"]\n', encoding="utf-8",
        )
        (consumer / "pyproject.toml").write_text(
            '[project]\nname = "synthetic-consumer"\ndependencies = '
            + repr([requirement] if base else []) + '\n[project.optional-dependencies]\n'
            + extra + ' = ' + repr(entries) + '\n', encoding="utf-8",
        )
        lock_ref = lock_ref or ref
        marker = marker or f"extra == '{extra}'"
        (consumer / "uv.lock").write_text(
            'version = 1\n[[package]]\nname = "synthetic-consumer"\nsource = { editable = "." }\n'
            '[package.metadata]\nrequires-dist = [{ name = "ai-gateway-client", '
            f'marker = "{marker}", git = "https://github.com/{repository}.git?rev={lock_ref}" }}]\n'
            '[[package]]\nname = "ai-gateway-client"\n'
            f'source = {{ git = "https://github.com/{repository}.git?rev={lock_ref}#{lock_ref}" }}\n',
            encoding="utf-8",
        )

    def _run_identity(
        self, root: Path, *, actual: str = AI_REF, origin: str = AI_URL, qsl: str = AI_QSL,
    ) -> tuple[int, list[list[str]]]:
        # Only the identity orchestration is simulated. No gh/network operation
        # or dependency installation is allowed; the origin is a real local Git config.
        checkout = root / "checkout" / "QuantRuntimeSettings"
        checkout.mkdir(parents=True, exist_ok=True)
        calls: list[list[str]] = []
        real_run = subprocess.run

        def run(argv, **kwargs):
            calls.append(argv)
            if argv[:4] == ["gh", "repo", "clone", "QuantStrategyLab/QuantAIService"]:
                destination = Path(argv[4])
                real_run(["git", "init", "-q", str(destination)], check=True)
                real_run(["git", "-C", str(destination), "remote", "add", "origin", origin], check=True)
                (destination / "qsl.toml").write_text(qsl, encoding="utf-8")
                return subprocess.CompletedProcess(argv, 0)
            if argv[:1] == ["git"] and argv[3:] == ["checkout", "--detach", AI_REF]:
                return subprocess.CompletedProcess(argv, 0)
            raise AssertionError(f"unexpected subprocess: {argv}")

        def output(argv, **kwargs):
            if argv[:1] == ["git"] and argv[3:] == ["rev-parse", "HEAD"]:
                return actual + "\n"
            return real_run(argv, check=True, capture_output=True, text=True).stdout

        env = {"RUNNER_TEMP": str(root), "GITHUB_WORKSPACE": str(checkout)}
        previous = os.getcwd()
        with mock.patch.dict(os.environ, env), mock.patch.object(subprocess, "run", side_effect=run), \
                mock.patch.object(subprocess, "check_output", side_effect=output), \
                mock.patch("sys.path", [str(ROOT), *sys.path]):
            # The workflow's relative TSV output belongs to this isolated temp dir.
            os.chdir(root)
            try:
                try:
                    exec(compile(self._identity_script(), "workflow-identity", "exec"), {})
                except SystemExit as error:
                    return (error.code if isinstance(error.code, int) else 1), calls
            finally:
                os.chdir(previous)
        return 0, calls

    def test_qsp_ai_identity_uses_canonical_checkout_and_exact_pin(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._write_ai_consumer(root / "qsl-workspace", "QuantStrategyPlugins", "ai")
            code, calls = self._run_identity(root)
            self.assertEqual(code, 0)
            destination = root / "checkout" / "QuantAIService"
            self.assertEqual(calls, [
                ["gh", "repo", "clone", "QuantStrategyLab/QuantAIService", str(destination)],
                ["git", "-C", str(destination), "checkout", "--detach", AI_REF],
            ])
            self.assertEqual((root / "qsl-quantaiservice-identity.tsv").read_text(), f"QuantAIService\t{AI_REF}\n")
            self.assertFalse((root / "checkout" / "AIAuditBridge").exists())

    def test_cn_research_and_shared_consumers_use_one_identity_checkout(self) -> None:
        for shared in (False, True):
            with self.subTest(shared=shared), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                workspace = root / "qsl-workspace"
                self._write_ai_consumer(workspace, "CnEquityStrategies", "research")
                if shared:
                    self._write_ai_consumer(workspace, "QuantStrategyPlugins", "ai")
                code, calls = self._run_identity(root)
                self.assertEqual(code, 0)
                self.assertEqual(sum(call[0] == "gh" for call in calls), 1)
                self.assertTrue((root / "checkout" / "QuantAIService").is_dir())

    def test_no_active_optional_ai_consumer_is_noop(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            consumer = root / "qsl-workspace" / "CnEquityStrategies"
            consumer.mkdir(parents=True)
            (consumer / "pyproject.toml").write_text('[project.optional-dependencies]\nresearch = []\n')
            code, calls = self._run_identity(root)
            self.assertEqual((code, calls), (0, []))

    def test_invalid_optional_identity_is_rejected_before_clone(self) -> None:
        cases = [
            {"ref": "main"}, {"ref": AI_REF[:12]},
            {"repository": "QuantStrategyLab/UnknownAI"},
            {"repository": "Pigbibi/PersonalAIService"},
            {"duplicate": True}, {"base": True}, {"lock_ref": "a" * 40},
            {"marker": "extra == 'ai' or extra == 'test'"},
        ]
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self._write_ai_consumer(root / "qsl-workspace", "QuantStrategyPlugins", "ai", **case)
                code, calls = self._run_identity(root)
                self.assertNotEqual(code, 0)
                self.assertEqual(calls, [])

    def test_conflicting_consumer_pins_are_rejected_before_clone(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = root / "qsl-workspace"
            self._write_ai_consumer(workspace, "QuantStrategyPlugins", "ai")
            self._write_ai_consumer(workspace, "CnEquityStrategies", "research", ref="a" * 40)
            code, calls = self._run_identity(root)
            self.assertNotEqual(code, 0)
            self.assertEqual(calls, [])

    def test_identity_checkout_attestation_is_fail_closed(self) -> None:
        for case in ({"actual": "a" * 40}, {"origin": "https://github.com/Pigbibi/QuantAIService.git"},
                     {"qsl": AI_QSL.replace('false', 'true')},
                     {"qsl": AI_QSL.replace('false', '0')},
                     {"qsl": AI_QSL.replace('ops/tooling', 'core')},
                     {"qsl": AI_QSL.replace('ring_e', 'ring_a')}):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self._write_ai_consumer(root / "qsl-workspace", "QuantStrategyPlugins", "ai")
                code, calls = self._run_identity(root, **case)
                self.assertNotEqual(code, 0)
                self.assertEqual(len(calls), 2)
                self.assertFalse((root / "qsl-quantaiservice-identity.tsv").exists())

    def test_existing_identity_directory_or_symlink_is_never_overwritten(self) -> None:
        for symlink in (False, True):
            with self.subTest(symlink=symlink), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self._write_ai_consumer(root / "qsl-workspace", "QuantStrategyPlugins", "ai")
                destination = root / "checkout" / "QuantAIService"
                destination.parent.mkdir()
                if symlink:
                    destination.symlink_to(root / "missing-unrelated-target", target_is_directory=True)
                else:
                    destination.mkdir()
                    (destination / "unrelated").write_text("preserve me")
                code, calls = self._run_identity(root)
                self.assertNotEqual(code, 0)
                self.assertEqual(calls, [])
                self.assertTrue(destination.is_symlink() if symlink else (destination / "unrelated").is_file())
                self.assertFalse((root / "qsl-quantaiservice-identity-created").exists())

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
        self.assertIn('expected="$(realpath -m "${GITHUB_WORKSPACE}/../QuantAIService")"', workflow)

    def test_cleanup_shell_normalizes_resolved_identity_marker_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = root / "runner" / "work" / "QRT"
            identity = root / "runner" / "work" / "QuantAIService"
            workspace.mkdir(parents=True)
            identity.mkdir()
            workflow = (ROOT / ".github/workflows/qsl_exception_lifecycle.yml").read_text(encoding="utf-8")
            match = re.search(
                r"- name: Clean up optional AI dependency identity\n"
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
            marker = root / "runner" / "qsl-quantaiservice-identity-created"
            marker.write_text(str(identity.resolve()), encoding="utf-8")
            subprocess.run(["bash", "-c", script], check=True, env=env, capture_output=True, text=True)
            self.assertFalse(identity.exists())
            self.assertFalse(marker.exists())

            unexpected = root / "runner" / "unexpected-QuantAIService"
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
