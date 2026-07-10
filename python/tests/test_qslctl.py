from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "python" / "scripts" / "qslctl.py"
MODULE_SPEC = importlib.util.spec_from_file_location("qslctl", MODULE_PATH)
qslctl = importlib.util.module_from_spec(MODULE_SPEC)
assert MODULE_SPEC.loader is not None
sys.modules[MODULE_SPEC.name] = qslctl
MODULE_SPEC.loader.exec_module(qslctl)


class QslCtlTest(unittest.TestCase):
    def test_check_all_reports_repo_issues(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            compat_root = root / "QuantRuntimeSettings"
            self._write_repo_tiers(compat_root)
            self._write_bundle(compat_root, "2026.07.2", {"QuantPlatformKit": "37c81901160c5b31127a27dba1c63944933fb6bf"})
            good = root / "GoodRepo"
            bad = root / "BadRepo"
            self._write_repo(good, "2026.07.2", "37c81901160c5b31127a27dba1c63944933fb6bf", tier="strategy-lib", ring="ring_b")
            self._write_repo(bad, "2026.07.2", "b" * 40, tier="strategy-lib", ring="ring_b")

            with patch.object(qslctl, "_is_quant_repo", return_value=True):
                results = qslctl.check_all(projects_root=root, compat_root=compat_root)

        by_repo = {result.repo: result for result in results}
        self.assertTrue(by_repo["GoodRepo"].ok)
        self.assertFalse(by_repo["BadRepo"].ok)
        self.assertIn("bundle pin mismatch", by_repo["BadRepo"].issues[0])

    def test_check_all_reports_forbidden_dependency_direction(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            compat_root = root / "QuantRuntimeSettings"
            self._write_repo_tiers(compat_root)
            self._write_bundle(
                compat_root,
                "2026.07.2",
                {"UsEquityStrategies": "17ddb86c72d44b2c7b78ba7a10d8f71b21180166"},
            )
            self._write_repo(
                root / "QuantPlatformKit",
                "2026.07.2",
                "17ddb86c72d44b2c7b78ba7a10d8f71b21180166",
                package="us-equity-strategies",
                source_repo="UsEquityStrategies",
                tier="core",
                ring="ring_a",
            )
            self._write_repo(
                root / "UsEquityStrategies",
                "2026.07.2",
                "a" * 40,
                tier="strategy-lib",
                ring="ring_b",
            )

            with patch.object(qslctl, "_is_quant_repo", return_value=True):
                results = qslctl.check_all(projects_root=root, compat_root=compat_root)

        by_repo = {result.repo: result for result in results}
        self.assertFalse(by_repo["QuantPlatformKit"].ok)
        self.assertTrue(any("forbidden dependency direction" in item for item in by_repo["QuantPlatformKit"].issues))

    def test_report_groups_repositories_by_ring(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            compat_root = root / "QuantRuntimeSettings"
            self._write_bundle(
                compat_root,
                "2026.07.2",
                {"QuantPlatformKit": "37c81901160c5b31127a27dba1c63944933fb6bf"},
            )
            self._write_repo_tiers(compat_root)

            core = root / "CoreRepo"
            warning = root / "WarningRepo"
            clean = root / "CleanRepo"
            self._write_repo(core, "2026.07.2", "b" * 40, tier="core", ring="ring_a")
            self._write_repo(warning, "2026.07.2", "b" * 40, tier="strategy-lib", ring="ring_b", enforce_bundle=False)
            self._write_repo(clean, "2026.07.2", "37c81901160c5b31127a27dba1c63944933fb6bf", tier="pipeline", ring="ring_c")

            buf = io.StringIO()
            with patch.object(qslctl, "_is_quant_repo", return_value=True), contextlib.redirect_stdout(buf):
                exit_code = qslctl.main(
                    [
                        "report",
                        "--projects-root",
                        str(root),
                        "--compat-root",
                        str(compat_root),
                        "--json",
                    ]
                )

        payload = json.loads(buf.getvalue())
        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["strict_repositories"], 1)
        self.assertEqual(payload["warning_repositories"], 1)
        self.assertEqual([ring["ring"] for ring in payload["rings"]], ["ring_a", "ring_b", "ring_c"])
        self.assertEqual(payload["rings"][0]["repositories"][0]["repo"], "CoreRepo")
        self.assertEqual(payload["rings"][1]["repositories"][0]["status"], "warning")

    def test_plan_orders_rings_and_actions(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            compat_root = root / "QuantRuntimeSettings"
            self._write_bundle(
                compat_root,
                "2026.07.2",
                {"QuantPlatformKit": "37c81901160c5b31127a27dba1c63944933fb6bf"},
            )
            self._write_repo_tiers(compat_root)

            self._write_repo(root / "CoreRepo", "2026.07.2", "b" * 40, tier="core", ring="ring_a")
            self._write_repo(root / "WarningRepo", "2026.07.2", "b" * 40, tier="strategy-lib", ring="ring_b", enforce_bundle=False)
            self._write_repo(root / "CleanRepo", "2026.07.2", "37c81901160c5b31127a27dba1c63944933fb6bf", tier="pipeline", ring="ring_c")

            buf = io.StringIO()
            with patch.object(qslctl, "_is_quant_repo", return_value=True), contextlib.redirect_stdout(buf):
                exit_code = qslctl.main(
                    [
                        "plan",
                        "--projects-root",
                        str(root),
                        "--compat-root",
                        str(compat_root),
                        "--json",
                    ]
                )

        payload = json.loads(buf.getvalue())
        self.assertEqual(exit_code, 0)
        self.assertEqual([phase["ring"] for phase in payload["phases"]], ["ring_a", "ring_b", "ring_c"])
        self.assertEqual(payload["phases"][0]["strict_repositories"][0]["repo"], "CoreRepo")
        self.assertEqual(payload["phases"][1]["warning_repositories"][0]["repo"], "WarningRepo")
        self.assertTrue(payload["phases"][0]["next_actions"][0].startswith("先清理 strict mismatch"))

    def test_generate_matrix_check_reports_stale_matrix(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            (root / "Example" / ".git").mkdir(parents=True)
            (root / "Example" / "pyproject.toml").write_text(
                'dependencies = ["quant-platform-kit @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@abc123"]\n',
                encoding="utf-8",
            )
            matrix = root / "matrix.json"
            matrix.write_text(json.dumps({"schema_version": 1, "dependencies": []}, indent=2) + "\n", encoding="utf-8")

            exit_code = qslctl.main(["generate-matrix", "--projects-root", str(root), "--matrix", str(matrix), "--check", "--strict"])

        self.assertEqual(exit_code, 1)

    def _write_bundle(self, compat_root: Path, bundle_name: str, repos: dict[str, str]) -> None:
        path = compat_root / "compat" / "bundles" / f"{bundle_name}.toml"
        path.parent.mkdir(parents=True, exist_ok=True)
        lines = [f'name = "{bundle_name}"', "[repos]"]
        for repo, ref in repos.items():
            lines.append(f'{repo} = "{ref}"')
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def _write_repo_tiers(self, compat_root: Path) -> None:
        path = compat_root / "compat" / "repo-tiers.toml"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "[tiers]\n"
            'core = { name = "core" }\n'
            'strategy_lib = { name = "strategy-lib" }\n'
            'pipeline = { name = "pipeline" }\n'
            'runtime = { name = "runtime" }\n'
            'ops = { name = "ops/tooling" }\n'
            "\n[upgrade_rings]\n"
            'ring_a = "core"\n'
            'ring_b = "strategy-lib"\n'
            'ring_c = "pipeline"\n'
            'ring_d = "runtime"\n'
            'ring_e = "ops/tooling"\n',
            encoding="utf-8",
        )

    def _write_repo(
        self,
        repo_root: Path,
        bundle: str,
        ref: str,
        *,
        package: str = "quant-platform-kit",
        source_repo: str = "QuantPlatformKit",
        tier: str = "strategy-lib",
        ring: str = "ring_b",
        enforce_bundle: bool = True,
    ) -> None:
        repo_root.mkdir(parents=True, exist_ok=True)
        (repo_root / "qsl.toml").write_text(
            f'tier = "{tier}"\nupgrade_ring = "{ring}"\n[compat]\nbundle = "{bundle}"\n'
            f'enforce_bundle = {"true" if enforce_bundle else "false"}\n',
            encoding="utf-8",
        )
        (repo_root / "pyproject.toml").write_text(
            f'dependencies = ["{package} @ git+https://github.com/QuantStrategyLab/{source_repo}.git@{ref}"]\n',
            encoding="utf-8",
        )


if __name__ == "__main__":
    unittest.main()
