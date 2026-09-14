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

    def test_current_scope_accepts_declared_manifest_ref_even_when_bundle_differs(self):
        with tempfile.TemporaryDirectory() as workspace:
            compat_root = Path(workspace)
            self._write_repo_tiers(compat_root)
            self._write_bundle(compat_root, "2026.07.2", {"QuantPlatformKit": "a" * 40})
            repo_root = self._make_repo_root(
                qsl_toml=(
                    'tier = "ops/tooling"\n'
                    'upgrade_ring = "ring_e"\n'
                    '[compat]\n'
                    'bundle = "2026.07.2"\n'
                    'requires = ["quant-platform-kit @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@'
                    + "b" * 40
                    + '"]\n'
                ),
                pyproject=(
                    'dependencies = ["quant-platform-kit @ git+https://github.com/QuantStrategyLab/'
                    "QuantPlatformKit.git@"
                    + "b" * 40
                    + '"]\n'
                ),
            )

            (repo_root / "uv.lock").write_text(
                'source = "git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@' + "b" * 40 + '"\n',
                encoding="utf-8",
            )
            current = check_qsl_compat._check(repo_root=repo_root, compat_root=compat_root, scope="current")
            frozen = check_qsl_compat._check(repo_root=repo_root, compat_root=compat_root, scope="frozen")

            self.assertTrue(current[0])
            self.assertIn("scope=current", current[3])
            self.assertFalse(frozen[0])
            self.assertTrue(any("bundle pin mismatch" in issue for issue in frozen[1]))

    def test_current_scope_rejects_short_main_unmanaged_and_manifest_conflicts(self):
        with tempfile.TemporaryDirectory() as workspace:
            compat_root = Path(workspace)
            self._write_repo_tiers(compat_root)
            repo_root = self._make_repo_root(
                qsl_toml=(
                    'tier = "ops/tooling"\n'
                    'upgrade_ring = "ring_e"\n'
                    '[compat]\n'
                    'bundle = "2026.07.2"\n'
                    'requires = [\n'
                    '"quant-platform-kit @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@abc123",\n'
                    '"malformed @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@",\n'
                    '"other @ git+https://github.com/QuantStrategyLab/Other.git@' + "c" * 40 + '"\n]\n'
                ),
                pyproject=(
                    'dependencies = [\n'
                    '"quant-platform-kit @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@abc123",\n'
                    '"quant-platform-kit @ https://github.com/QuantStrategyLab/QuantPlatformKit.git?rev=main",\n'
                    '"other @ git+https://github.com/QuantStrategyLab/Other.git@' + "c" * 40 + '"\n]\n'
                ),
            )
            (repo_root / "uv.lock").write_text(
                'source = "git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@' + "d" * 40 + '"\n',
                encoding="utf-8",
            )

            ok, issues, _warnings, _notes = check_qsl_compat._check(
                repo_root=repo_root, compat_root=compat_root, scope="current"
            )

            self.assertFalse(ok)
            self.assertTrue(any("forbidden short/invalid ref 'abc123'" in issue for issue in issues))
            self.assertTrue(any("malformed current qsl.requires entry" in issue for issue in issues))
            self.assertTrue(any("forbidden ref 'main'" in issue for issue in issues))
            self.assertTrue(any("unmanaged" in issue for issue in issues))
            self.assertTrue(any("manifest/lock refs disagree" in issue for issue in issues))

    def test_current_rejects_missing_direct_dependency_from_lock(self):
        with tempfile.TemporaryDirectory() as workspace:
            compat_root = Path(workspace)
            self._write_repo_tiers(compat_root)
            self._write_bundle(compat_root, "2026.07.2", {"QuantPlatformKit": "a" * 40})
            repo_root = self._make_repo_root(
                qsl_toml=(
                    'tier = "ops/tooling"\nupgrade_ring = "ring_e"\n[compat]\n'
                    'bundle = "2026.07.2"\nrequires = ["quant-platform-kit @ git+https://github.com/QuantStrategyLab/'
                    + "QuantPlatformKit.git@" + "b" * 40 + '"]\n'
                ),
                pyproject=(
                    'dependencies = ["quant-platform-kit @ git+https://github.com/QuantStrategyLab/'
                    + "QuantPlatformKit.git@" + "b" * 40 + '"]\n'
                ),
            )
            (repo_root / "uv.lock").write_text('version = 1\n', encoding="utf-8")
            ok, issues, _warnings, _notes = check_qsl_compat._check(
                repo_root=repo_root, compat_root=compat_root, scope="current"
            )
            self.assertFalse(ok)
            self.assertTrue(any("current lock missing direct dependency" in issue for issue in issues))

    def test_current_allows_research_only_ops_dependency_but_base_dependency_is_blocked(self):
        def run(base_dependency: bool, marker: str = "extra == 'research'"):
            with tempfile.TemporaryDirectory() as workspace:
                root = Path(workspace)
                compat_root = root / "QuantRuntimeSettings"
                self._write_repo_tiers(compat_root)
                ref = "a" * 40
                self._write_bundle(compat_root, "2026.07.2", {"AIAuditBridge": ref})
                dependency_root = root / "AIAuditBridge"
                dependency_root.mkdir()
                (dependency_root / "qsl.toml").write_text(
                    'tier = "ops/tooling"\nupgrade_ring = "ring_e"\n[compat]\n'
                    'bundle = "2026.07.2"\n', encoding="utf-8"
                )
                repo_root = root / "Consumer"
                repo_root.mkdir()
                (repo_root / "qsl.toml").write_text(
                    'tier = "core"\nupgrade_ring = "ring_a"\n[compat]\n'
                    'bundle = "2026.07.2"\nrequires = ["ai-gateway-client @ git+https://github.com/QuantStrategyLab/'
                    + "AIAuditBridge.git@" + ref + '"]\n', encoding="utf-8"
                )
                base = ('"ai-gateway-client @ git+https://github.com/QuantStrategyLab/AIAuditBridge.git@' + ref + '"') if base_dependency else ''
                deps = (base + ',') if base else ''
                (repo_root / "pyproject.toml").write_text(
                    '[project]\nname = "consumer"\ndependencies = [' + deps + ']\n'
                    '[project.optional-dependencies]\nresearch = ["ai-gateway-client @ git+https://github.com/QuantStrategyLab/'
                    + "AIAuditBridge.git@" + ref + '"]\n', encoding="utf-8"
                )
                (repo_root / "uv.lock").write_text(
                    'version = 1\n[[package]]\nname = "consumer"\nsource = { editable = "." }\n'
                    '[package.metadata]\nrequires-dist = [{ name = "ai-gateway-client", marker = "' + marker + '", git = "https://github.com/QuantStrategyLab/AIAuditBridge.git?rev='
                    + ref + '" }]\n\n[[package]]\nname = "ai-gateway-client"\nsource = { git = "https://github.com/QuantStrategyLab/AIAuditBridge.git?rev='
                    + ref + '" }\n', encoding="utf-8"
                )
                return check_qsl_compat._check(repo_root=repo_root, compat_root=compat_root, scope="current")

        allowed = run(False)
        self.assertTrue(allowed[0], allowed[1])
        blocked = run(True)
        self.assertFalse(blocked[0])
        self.assertTrue(any("forbidden dependency direction" in issue for issue in blocked[1]))
        complex_marker = run(False, "extra == 'research' or extra == 'test'")
        self.assertFalse(complex_marker[0])
        self.assertTrue(any("forbidden dependency direction" in issue for issue in complex_marker[1]))

    def test_frozen_scope_keeps_historical_2026090_b13_mismatch_blocked(self):
        with tempfile.TemporaryDirectory() as workspace:
            compat_root = Path(workspace)
            self._write_repo_tiers(compat_root)
            self._write_bundle(compat_root, "2026.09.0", {"QuantPlatformKit": "0" * 40})
            repo_root = self._make_repo_root(
                qsl_toml=(
                    'tier = "strategy-lib"\n'
                    'upgrade_ring = "ring_b"\n'
                    '[compat]\n'
                    'bundle = "2026.09.0"\n'
                    'requires = ["quant-platform-kit @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@'
                    + "b" * 40
                    + '"]\n'
                ),
                pyproject=(
                    'dependencies = ["quant-platform-kit @ git+https://github.com/QuantStrategyLab/'
                    "QuantPlatformKit.git@"
                    + "b" * 40
                    + '"]\n'
                ),
            )

            ok, issues, _warnings, _notes = check_qsl_compat._check(
                repo_root=repo_root, compat_root=compat_root, scope="frozen"
            )

            self.assertFalse(ok)
            self.assertTrue(any("bundle pin mismatch" in issue for issue in issues))

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
