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
    def test_is_quant_repo_accepts_exact_org_https_and_ssh_origins(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            repo_root = Path(workspace) / "Repo"
            (repo_root / ".git").mkdir(parents=True)

            accepted = [
                "https://github.com/QuantStrategyLab/Repo.git",
                "git@github.com:QuantStrategyLab/Repo.git",
                "ssh://git@github.com/QuantStrategyLab/Repo.git",
            ]
            for remote in accepted:
                with self.subTest(remote=remote), patch.object(
                    qslctl.subprocess, "check_output", return_value=remote
                ):
                    self.assertTrue(qslctl._is_quant_repo(repo_root))

            with patch.object(
                qslctl.subprocess,
                "check_output",
                return_value="git@github.com:OtherOwner/QuantStrategyLab-Repo.git",
            ):
                self.assertFalse(qslctl._is_quant_repo(repo_root))

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

    def test_check_all_reports_quant_repo_missing_qsl_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            compat_root = root / "QuantRuntimeSettings"
            self._write_repo_tiers(compat_root)
            missing = root / "MissingRepo"
            (missing / ".git").mkdir(parents=True)

            with patch.object(qslctl, "_is_quant_repo", return_value=True):
                results = qslctl.check_all(projects_root=root, compat_root=compat_root)

        result = next(item for item in results if item.repo == "MissingRepo")
        payload = qslctl._result_payload(result)
        self.assertFalse(result.ok)
        self.assertEqual(payload["inventory_status"], "missing_qsl")
        self.assertEqual(payload["owner"], "repository_maintainers")
        self.assertEqual(payload["next_action"], "add qsl.toml or remove the non-active checkout from this workspace scope")
        self.assertIn("missing qsl.toml for active local QuantStrategyLab repository", result.issues)

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

    def test_mainline_only_report_excludes_nondefault_local_checkouts(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            compat_root = root / "QuantRuntimeSettings"
            self._write_bundle(
                compat_root,
                "2026.07.2",
                {"QuantPlatformKit": "37c81901160c5b31127a27dba1c63944933fb6bf"},
            )
            self._write_repo_tiers(compat_root)
            self._write_repo(root / "MainRepo", "2026.07.2", "37c81901160c5b31127a27dba1c63944933fb6bf")
            self._write_repo(root / "FeatureRepo", "2026.07.2", "b" * 40)

            def checkout_context(repo_root: Path) -> tuple[str | None, str | None]:
                return ("main", "main") if repo_root.name == "MainRepo" else ("agent/archived", "main")

            buf = io.StringIO()
            with (
                patch.object(qslctl, "_is_quant_repo", return_value=True),
                patch.object(qslctl, "_checkout_context", side_effect=checkout_context),
                contextlib.redirect_stdout(buf),
            ):
                exit_code = qslctl.main(
                    [
                        "report",
                        "--projects-root",
                        str(root),
                        "--compat-root",
                        str(compat_root),
                        "--mainline-only",
                        "--json",
                    ]
                )

        payload = json.loads(buf.getvalue())
        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["scope"], "local_default_branch_checkouts")
        self.assertEqual(payload["total_repositories"], 1)
        self.assertEqual(payload["strict_repositories"], 0)
        self.assertEqual(payload["excluded_nondefault_checkouts"], [
            {"repo": "FeatureRepo", "checkout_branch": "agent/archived", "default_branch": "main"}
        ])

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

    def test_plan_emits_byte_stable_human_required_dependency_decision(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            compat_root = root / "QuantRuntimeSettings"
            self._write_repo_tiers(compat_root)
            self._write_bundle(compat_root, "2026.07.2", {"QuantPlatformKit": "a" * 40})
            self._write_repo(root / "ConsumerB", "2026.07.2", "b" * 40)
            self._write_repo(root / "ConsumerA", "2026.07.2", "a" * 40)

            outputs = []
            for _ in range(2):
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
                            "--strict",
                        ]
                    )
                outputs.append(buf.getvalue())

        self.assertEqual(exit_code, 1)
        self.assertEqual(outputs[0], outputs[1])
        payload = json.loads(outputs[0])
        self.assertEqual(payload["decision_status"], "HUMAN_REQUIRED")
        decision = next(item for item in payload["dependency_decisions"] if item["source_repo"] == "QuantPlatformKit")
        self.assertEqual(decision["status"], "HUMAN_REQUIRED")
        self.assertEqual([item["ref"] for item in decision["candidate_refs"]], ["a" * 40, "b" * 40])
        self.assertEqual(decision["consumer_repositories"], ["ConsumerA", "ConsumerB"])
        self.assertEqual(
            decision["compatibility_test_requirements"],
            [
                "source repository gates",
                "each consumer dependency and integration gate",
                "strict QSL compatibility and dependency-matrix checks",
            ],
        )

    def test_plan_strict_accepts_one_published_observed_ref(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            compat_root = root / "QuantRuntimeSettings"
            self._write_repo_tiers(compat_root)
            self._write_bundle(compat_root, "2026.07.2", {"QuantPlatformKit": "a" * 40})
            self._write_repo(root / "Consumer", "2026.07.2", "a" * 40)

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
                        "--strict",
                    ]
                )

        payload = json.loads(buf.getvalue())
        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["decision_status"], "CONSISTENT")
        self.assertEqual(payload["dependency_decisions"][0]["status"], "CONSISTENT")

    def test_plan_strict_fails_closed_when_configured_bundle_manifest_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            compat_root = root / "QuantRuntimeSettings"
            self._write_repo_tiers(compat_root)
            self._write_repo(root / "Consumer", "missing-bundle", "a" * 40, include_dependency=False)

            result = qslctl.check_repo(root / "Consumer", compat_root)
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
                        "--strict",
                    ]
                )

        payload = json.loads(buf.getvalue())
        self.assertEqual(result.bundle, "missing-bundle")
        self.assertEqual(exit_code, 1)
        self.assertEqual(payload["decision_status"], "HUMAN_REQUIRED")
        self.assertTrue(payload["authority_errors"])

    def test_plan_strict_accepts_bundle_only_single_published_ref(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            compat_root = root / "QuantRuntimeSettings"
            self._write_repo_tiers(compat_root)
            self._write_bundle(compat_root, "2026.07.2", {"QuantPlatformKit": "a" * 40})
            self._write_repo(root / "Consumer", "2026.07.2", "a" * 40, include_dependency=False)

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
                        "--strict",
                    ]
                )

        payload = json.loads(buf.getvalue())
        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["decision_status"], "CONSISTENT")
        self.assertEqual(payload["dependency_decisions"][0]["status"], "CONSISTENT")

    def test_plan_strict_reports_invalid_qsl_inventory_and_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            compat_root = root / "QuantRuntimeSettings"
            self._write_repo_tiers(compat_root)
            invalid = root / "InvalidRepo"
            (invalid / ".git").mkdir(parents=True)
            (invalid / "qsl.toml").write_text(
                'tier = "strategy-lib"\nupgrade_ring = "ring_b"\n',
                encoding="utf-8",
            )

            result = qslctl.check_repo(invalid, compat_root)
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
                        "--strict",
                    ]
                )

        payload = json.loads(buf.getvalue())
        self.assertEqual(result.inventory_status, "invalid_qsl")
        self.assertEqual(exit_code, 1)
        self.assertEqual(payload["decision_status"], "HUMAN_REQUIRED")
        self.assertEqual(
            payload["workspace_inventory"]["invalid_qsl"],
            [
                {
                    "repo": "InvalidRepo",
                    "owner": "repository_maintainers",
                    "next_action": "repair invalid qsl.toml before compatibility planning",
                }
            ],
        )

    def test_plan_strict_fails_closed_for_any_strict_repository_issue(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            compat_root = root / "QuantRuntimeSettings"
            self._write_repo_tiers(compat_root)
            self._write_bundle(compat_root, "2026.07.2", {"QuantPlatformKit": "a" * 40})
            self._write_repo(
                root / "StrictRepo",
                "2026.07.2",
                "a" * 40,
                tier="invalid-tier",
                include_dependency=False,
            )

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
                        "--strict",
                    ]
                )

        payload = json.loads(buf.getvalue())
        self.assertEqual(exit_code, 1)
        self.assertEqual(payload["decision_status"], "HUMAN_REQUIRED")
        self.assertEqual(payload["dependency_decisions"][0]["status"], "CONSISTENT")
        self.assertEqual(payload["workspace_inventory"]["strict_repositories"][0]["repo"], "StrictRepo")

    def test_plan_mainline_only_keeps_all_checkout_inventory_gate(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            compat_root = root / "QuantRuntimeSettings"
            self._write_repo_tiers(compat_root)
            self._write_bundle(compat_root, "2026.07.2", {"QuantPlatformKit": "a" * 40})
            self._write_repo(root / "MainRepo", "2026.07.2", "a" * 40, include_dependency=False)
            feature = root / "FeatureRepo"
            (feature / ".git").mkdir(parents=True)

            def checkout_context(repo_root: Path) -> tuple[str | None, str | None]:
                return ("main", "main") if repo_root.name == "MainRepo" else ("agent/review", "main")

            buf = io.StringIO()
            with (
                patch.object(qslctl, "_is_quant_repo", return_value=True),
                patch.object(qslctl, "_checkout_context", side_effect=checkout_context),
                contextlib.redirect_stdout(buf),
            ):
                exit_code = qslctl.main(
                    [
                        "plan",
                        "--projects-root",
                        str(root),
                        "--compat-root",
                        str(compat_root),
                        "--mainline-only",
                        "--json",
                        "--strict",
                    ]
                )

        payload = json.loads(buf.getvalue())
        self.assertEqual(exit_code, 1)
        self.assertEqual(payload["decision_status"], "HUMAN_REQUIRED")
        self.assertEqual(payload["scope"], "local_default_branch_checkouts")
        self.assertEqual(payload["workspace_inventory"]["missing_qsl"][0]["repo"], "FeatureRepo")
        self.assertEqual(
            payload["excluded_nondefault_checkouts"],
            [{"repo": "FeatureRepo", "checkout_branch": "agent/review", "default_branch": "main"}],
        )
        self.assertEqual([phase["ring"] for phase in payload["phases"]], ["ring_b"])
        self.assertEqual(payload["dependency_decisions"][0]["status"], "CONSISTENT")

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
        include_dependency: bool = True,
    ) -> None:
        repo_root.mkdir(parents=True, exist_ok=True)
        (repo_root / ".git").mkdir(exist_ok=True)
        (repo_root / "qsl.toml").write_text(
            f'tier = "{tier}"\nupgrade_ring = "{ring}"\n[compat]\nbundle = "{bundle}"\n'
            f'enforce_bundle = {"true" if enforce_bundle else "false"}\n',
            encoding="utf-8",
        )
        if include_dependency:
            (repo_root / "pyproject.toml").write_text(
                f'dependencies = ["{package} @ git+https://github.com/QuantStrategyLab/{source_repo}.git@{ref}"]\n',
                encoding="utf-8",
            )


if __name__ == "__main__":
    unittest.main()
