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
            'ring_e = "ops/tooling"\n'
            "\n[upgrade_rules]\n"
            "allow_drift = [\n"
            '  "ops/tooling:runtime",\n'
            '  "ops/tooling:pipeline",\n'
            '  "ops/tooling:strategy-lib",\n'
            '  "ops/tooling:core",\n'
            '  "runtime:pipeline",\n'
            '  "runtime:strategy-lib",\n'
            '  "runtime:core",\n'
            '  "pipeline:strategy-lib",\n'
            '  "pipeline:core",\n'
            '  "strategy-lib:core",\n'
            "]\n",
            encoding="utf-8",
        )

    def test_root_compat_bundle_and_ring_schema(self):
        with tempfile.TemporaryDirectory() as workspace:
            compat_root = Path(workspace)
            self._write_repo_tiers(compat_root)
            self._write_bundle(
                compat_root,
                "2026.07.2",
                {"QuantPlatformKit": "37c81901160c5b31127a27dba1c63944933fb6bf"},
            )
            repo_root = self._make_repo_root(
                qsl_toml=(
                    "tier = \"ops/tooling\"\n"
                    "ring = \"ring_e\"\n"
                    "[compat]\n"
                    'bundle = "2026.07.2"\n'
                ),
                pyproject=(
                    "dependencies = [\n"
                    '  "quant-platform-kit @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@37c81901160c5b31127a27dba1c63944933fb6bf"\n'
                    "]\n"
                ),
            )

            ok, issues, warnings, notes = check_qsl_compat._check(repo_root=repo_root, compat_root=compat_root)

            self.assertTrue(ok)
            self.assertEqual(issues, [])
            self.assertEqual(warnings, [])
            self.assertIn("bundle=2026.07.2", notes)
            self.assertIn("upgrade_ring=ring_e", notes)

    def test_not_enforced_bundle_reports_warning_for_short_sha_and_mismatch_but_main_stays_issue(self):
        with tempfile.TemporaryDirectory() as workspace:
            compat_root = Path(workspace)
            self._write_repo_tiers(compat_root)
            self._write_bundle(
                compat_root,
                "2026.07.2",
                {
                    "QuantPlatformKit": "37c81901160c5b31127a27dba1c63944933fb6bf",
                    "UsEquityStrategies": "17ddb86c72d44b2c7b78ba7a10d8f71b21180166",
                },
            )
            repo_root = self._make_repo_root(
                qsl_toml=(
                    "tier = \"ops/tooling\"\n"
                    "ring = \"ring_e\"\n"
                    "[compat]\n"
                    'bundle = "2026.07.2"\n'
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
            self.assertEqual(len(warnings), 3)
            self.assertTrue(any("forbidden short/invalid ref 'abc123'" in warning for warning in warnings))
            self.assertTrue(any("bundle pin mismatch for QuantPlatformKit" in warning for warning in warnings))
            self.assertTrue(any("missing exception metadata" in warning for warning in warnings))
            self.assertEqual(notes[0], "qsl=" + str(repo_root / "qsl.toml"))

    def test_live_constraint_files_allow_full_sha_drift_from_bundle(self):
        with tempfile.TemporaryDirectory() as workspace:
            compat_root = Path(workspace)
            self._write_repo_tiers(compat_root)
            self._write_bundle(
                compat_root,
                "2026.07.2",
                {"QuantPlatformKit": "37c81901160c5b31127a27dba1c63944933fb6bf"},
            )
            repo_root = self._make_repo_root(
                qsl_toml=(
                    'tier = "core"\n'
                    'upgrade_ring = "ring_a"\n'
                    "allow_legacy = true\n"
                    "[compat]\n"
                    'bundle = "2026.07.2"\n'
                    'live_constraint_files = ["constraints.txt"]\n'
                ),
                pyproject="",
            )
            (repo_root / "constraints.txt").write_text(
                "quant-platform-kit @ git+https://github.com/QuantStrategyLab/"
                f"QuantPlatformKit.git@{'b' * 40}\n",
                encoding="utf-8",
            )

            ok, issues, warnings, notes = check_qsl_compat._check(repo_root=repo_root, compat_root=compat_root)

            self.assertTrue(ok)
            self.assertEqual(issues, [])
            self.assertEqual(warnings, [])
            self.assertIn("live_constraint_files=constraints.txt", notes)

    def test_live_constraint_files_still_block_short_refs(self):
        with tempfile.TemporaryDirectory() as workspace:
            compat_root = Path(workspace)
            self._write_repo_tiers(compat_root)
            self._write_bundle(
                compat_root,
                "2026.07.2",
                {"QuantPlatformKit": "37c81901160c5b31127a27dba1c63944933fb6bf"},
            )
            repo_root = self._make_repo_root(
                qsl_toml=(
                    'tier = "core"\n'
                    'upgrade_ring = "ring_a"\n'
                    "allow_legacy = true\n"
                    "[compat]\n"
                    'bundle = "2026.07.2"\n'
                    'live_constraint_files = ["constraints.txt"]\n'
                ),
                pyproject="",
            )
            (repo_root / "constraints.txt").write_text(
                "quant-platform-kit @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@abc123\n",
                encoding="utf-8",
            )

            ok, issues, warnings, notes = check_qsl_compat._check(repo_root=repo_root, compat_root=compat_root)

            self.assertFalse(ok)
            self.assertEqual(len(issues), 1)
            self.assertIn("forbidden short/invalid ref 'abc123'", issues[0])
            self.assertEqual(warnings, [])


    def test_not_enforced_bundle_exception_metadata_notes(self):
        with tempfile.TemporaryDirectory() as workspace:
            compat_root = Path(workspace)
            self._write_repo_tiers(compat_root)
            self._write_bundle(
                compat_root,
                "2026.07.2",
                {"QuantPlatformKit": "37c81901160c5b31127a27dba1c63944933fb6bf"},
            )
            repo_root = self._make_repo_root(
                qsl_toml=(
                    'tier = "pipeline"\n'
                    'upgrade_ring = "ring_c"\n'
                    'owner = "pipeline-team"\n'
                    'expires_at = "2099-12-31"\n'
                    'next_action = "remove transition pin drift"\n'
                    "[compat]\n"
                    'bundle = "2026.07.2"\n'
                    "enforce_bundle = false\n"
                ),
                pyproject="",
            )

            ok, issues, warnings, notes = check_qsl_compat._check(repo_root=repo_root, compat_root=compat_root)

            self.assertTrue(ok)
            self.assertEqual(issues, [])
            self.assertEqual(warnings, [])
            self.assertIn("owner=pipeline-team", notes)
            self.assertIn("expires_at=2099-12-31", notes)
            self.assertIn("next_action=remove transition pin drift", notes)

    def test_legacy_reason_suppresses_allowed_legacy_warning(self):
        with tempfile.TemporaryDirectory() as workspace:
            compat_root = Path(workspace)
            self._write_repo_tiers(compat_root)
            self._write_bundle(
                compat_root,
                "2026.07.2",
                {"QuantPlatformKit": "37c81901160c5b31127a27dba1c63944933fb6bf"},
            )
            repo_root = self._make_repo_root(
                qsl_toml=(
                    'tier = "pipeline"\n'
                    'upgrade_ring = "ring_c"\n'
                    "allow_legacy = true\n"
                    'legacy_reason = "runtime deployment compatibility"\n'
                    'owner = "runtime-team"\n'
                    'expires_at = "2099-12-31"\n'
                    'next_action = "replace runtime deployment requirements"\n'
                    "[compat]\n"
                    'bundle = "2026.07.2"\n'
                    "enforce_bundle = false\n"
                ),
                pyproject="",
            )
            (repo_root / "requirements.txt").write_text(
                "quant-platform-kit @ git+https://github.com/QuantStrategyLab/"
                f"QuantPlatformKit.git@{'b' * 40}\n",
                encoding="utf-8",
            )

            ok, issues, warnings, notes = check_qsl_compat._check(repo_root=repo_root, compat_root=compat_root)

            self.assertTrue(ok)
            self.assertEqual(issues, [])
            self.assertEqual(len(warnings), 1)
            self.assertIn("bundle pin mismatch", warnings[0])
            self.assertIn("legacy_reason=runtime deployment compatibility", notes)

    def test_non_canonical_tier_and_ring_emit_warnings(self):
        with tempfile.TemporaryDirectory() as workspace:
            compat_root = Path(workspace)
            self._write_repo_tiers(compat_root)
            self._write_bundle(
                compat_root,
                "2026.07.2",
                {"QuantPlatformKit": "37c81901160c5b31127a27dba1c63944933fb6bf"},
            )
            repo_root = self._make_repo_root(
                qsl_toml=(
                    'tier = "strategy-library"\n'
                    "ring = 1\n"
                    "[compat]\n"
                    'bundle = "2026.07.2"\n'
                ),
                pyproject=(
                    'dependencies = ["quant-platform-kit @ '
                    'git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@37c81901160c5b31127a27dba1c63944933fb6bf"]\n'
                ),
            )

            ok, issues, warnings, _notes = check_qsl_compat._check(repo_root=repo_root, compat_root=compat_root)

            self.assertTrue(ok)
            self.assertEqual(issues, [])
            self.assertTrue(any("non-canonical qsl.tier 'strategy-library'" in item for item in warnings))
            self.assertTrue(any("non-canonical qsl.upgrade_ring '1'" in item for item in warnings))

    def test_runtime_platform_alias_maps_to_runtime_without_direction_error(self):
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            compat_root = root / "QuantRuntimeSettings"
            self._write_repo_tiers(compat_root)
            self._write_bundle(
                compat_root,
                "2026.07.2",
                {"QuantPlatformKit": "37c81901160c5b31127a27dba1c63944933fb6bf"},
            )
            (root / "QuantPlatformKit").mkdir(parents=True, exist_ok=True)
            (root / "QuantPlatformKit" / "qsl.toml").write_text(
                'tier = "core"\nupgrade_ring = "ring_a"\n[compat]\nbundle = "2026.07.2"\n',
                encoding="utf-8",
            )
            repo_root = self._make_repo_root(
                qsl_toml=(
                    'tier = "runtime-platform"\n'
                    "ring = 3\n"
                    "[compat]\n"
                    'bundle = "2026.07.2"\n'
                ),
                pyproject=(
                    'dependencies = ["quant-platform-kit @ '
                    'git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@37c81901160c5b31127a27dba1c63944933fb6bf"]\n'
                ),
            )

            ok, issues, warnings, _notes = check_qsl_compat._check(repo_root=repo_root, compat_root=compat_root)

            self.assertTrue(ok)
            self.assertEqual(issues, [])
            self.assertTrue(any("non-canonical qsl.tier 'runtime-platform'" in item for item in warnings))
            self.assertTrue(any("non-canonical qsl.upgrade_ring '3'" in item for item in warnings))

    def test_forbidden_dependency_direction_is_reported(self):
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            compat_root = root / "QuantRuntimeSettings"
            self._write_repo_tiers(compat_root)
            self._write_bundle(
                compat_root,
                "2026.07.2",
                {"UsEquityStrategies": "17ddb86c72d44b2c7b78ba7a10d8f71b21180166"},
            )
            (root / "UsEquityStrategies").mkdir(parents=True, exist_ok=True)
            (root / "UsEquityStrategies" / "qsl.toml").write_text(
                'tier = "strategy-lib"\nupgrade_ring = "ring_b"\n[compat]\nbundle = "2026.07.2"\n',
                encoding="utf-8",
            )
            repo_root = self._make_repo_root(
                qsl_toml=(
                    'tier = "core"\n'
                    'upgrade_ring = "ring_a"\n'
                    "[compat]\n"
                    'bundle = "2026.07.2"\n'
                ),
                pyproject=(
                    'dependencies = ["us-equity-strategies @ '
                    'git+https://github.com/QuantStrategyLab/UsEquityStrategies.git@17ddb86c72d44b2c7b78ba7a10d8f71b21180166"]\n'
                ),
            )

            ok, issues, warnings, _notes = check_qsl_compat._check(repo_root=repo_root, compat_root=compat_root)

            self.assertFalse(ok)
            self.assertEqual(warnings, [])
            self.assertTrue(any("forbidden dependency direction" in item for item in issues))


if __name__ == "__main__":
    unittest.main()
