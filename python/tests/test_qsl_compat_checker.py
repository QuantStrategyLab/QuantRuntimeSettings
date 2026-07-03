from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "check_qsl_compat.py"
MODULE_SPEC = importlib.util.spec_from_file_location("check_qsl_compat", MODULE_PATH)
check_qsl_compat = importlib.util.module_from_spec(MODULE_SPEC)
assert MODULE_SPEC.loader is not None
sys.modules[MODULE_SPEC.name] = check_qsl_compat
MODULE_SPEC.loader.exec_module(check_qsl_compat)


class QSLCompatCheckerTest(unittest.TestCase):
    def _make_repo_root(self, qsl_toml: str, pyproject: str) -> Path:
        root = Path(tempfile.mkdtemp())
        (root / "qsl.toml").write_text(qsl_toml, encoding="utf-8")
        (root / "pyproject.toml").write_text(pyproject, encoding="utf-8")
        return root

    def _write_bundle(self, compat_root: Path, bundle_name: str, repos: dict[str, str]) -> None:
        bundle_path = compat_root / "compat" / "bundles" / f"{bundle_name}.toml"
        bundle_path.parent.mkdir(parents=True, exist_ok=True)
        block = [f'name = "{bundle_name}"', "[repos]"]
        for repo, ref in repos.items():
            block.append(f'{repo} = "{ref}"')
        bundle_path.write_text("\n".join(block) + "\n", encoding="utf-8")

    def test_root_compat_bundle_and_ring_schema(self):
        with tempfile.TemporaryDirectory() as workspace:
            compat_root = Path(workspace)
            self._write_bundle(
                compat_root,
                "2026.07.1",
                {"QuantPlatformKit": "7032cde4547e7ec59af15df8935d142461a77051"},
            )
            repo_root = self._make_repo_root(
                qsl_toml=(
                    "tier = \"ops/tooling\"\n"
                    "ring = \"ring_e\"\n"
                    "[compat]\n"
                    'bundle = "2026.07.1"\n'
                ),
                pyproject=(
                    "dependencies = [\n"
                    '  "quant-platform-kit @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@7032cde4547e7ec59af15df8935d142461a77051"\n'
                    "]\n"
                ),
            )

            ok, issues, warnings, notes = check_qsl_compat._check(repo_root=repo_root, compat_root=compat_root)

            self.assertTrue(ok)
            self.assertEqual(issues, [])
            self.assertEqual(warnings, [])
            self.assertIn("bundle=2026.07.1", notes)
            self.assertIn("upgrade_ring=ring_e", notes)

    def test_not_enforced_bundle_reports_warning_for_short_sha_and_mismatch_but_main_stays_issue(self):
        with tempfile.TemporaryDirectory() as workspace:
            compat_root = Path(workspace)
            self._write_bundle(
                compat_root,
                "2026.07.1",
                {
                    "QuantPlatformKit": "7032cde4547e7ec59af15df8935d142461a77051",
                    "UsEquityStrategies": "9f0e5e2deca8a9c16d711eb4772f08a7901da101",
                },
            )
            repo_root = self._make_repo_root(
                qsl_toml=(
                    "tier = \"ops/tooling\"\n"
                    "ring = \"ring_e\"\n"
                    "[compat]\n"
                    'bundle = "2026.07.1"\n'
                    "enforce_bundle = false\n"
                ),
                pyproject=(
                    "dependencies = [\n"
                    '  "quant-platform-kit @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@abc123"\n'
                    '  "quant-platform-kit @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@'
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"\n'
                    '  "us-equity-strategies @ https://github.com/QuantStrategyLab/UsEquityStrategies.git?rev=main"\n'
                    "]\n"
                ),
            )

            ok, issues, warnings, notes = check_qsl_compat._check(repo_root=repo_root, compat_root=compat_root)

            self.assertFalse(ok)
            self.assertEqual(len(issues), 1)
            self.assertIn("forbidden ref 'main'", issues[0])
            self.assertEqual(len(warnings), 2)
            self.assertTrue(any("forbidden short/invalid ref 'abc123'" in warning for warning in warnings))
            self.assertTrue(any("bundle pin mismatch for QuantPlatformKit" in warning for warning in warnings))
            self.assertEqual(notes[0], "qsl=" + str(repo_root / "qsl.toml"))


if __name__ == "__main__":
    unittest.main()
