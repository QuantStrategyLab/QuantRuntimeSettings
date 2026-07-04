from __future__ import annotations

import importlib.util
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
            self._write_bundle(compat_root, "2026.07.1", {"QuantPlatformKit": "a" * 40})
            good = root / "GoodRepo"
            bad = root / "BadRepo"
            self._write_repo(good, "2026.07.1", "a" * 40)
            self._write_repo(bad, "2026.07.1", "b" * 40)

            with patch.object(qslctl, "_is_quant_repo", return_value=True):
                results = qslctl.check_all(projects_root=root, compat_root=compat_root)

        by_repo = {result.repo: result for result in results}
        self.assertTrue(by_repo["GoodRepo"].ok)
        self.assertFalse(by_repo["BadRepo"].ok)
        self.assertIn("bundle pin mismatch", by_repo["BadRepo"].issues[0])

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

    def _write_repo(self, repo_root: Path, bundle: str, ref: str) -> None:
        repo_root.mkdir(parents=True, exist_ok=True)
        (repo_root / "qsl.toml").write_text(
            f'tier = "strategy-library"\nring = 1\n[compat]\nbundle = "{bundle}"\n',
            encoding="utf-8",
        )
        (repo_root / "pyproject.toml").write_text(
            f'dependencies = ["quant-platform-kit @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@{ref}"]\n',
            encoding="utf-8",
        )


if __name__ == "__main__":
    unittest.main()
