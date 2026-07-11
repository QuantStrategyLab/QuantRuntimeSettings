from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "python" / "scripts" / "check_internal_dependency_matrix.py"
SPEC = importlib.util.spec_from_file_location("check_internal_dependency_matrix", MODULE_PATH)
check_internal_dependency_matrix = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = check_internal_dependency_matrix
SPEC.loader.exec_module(check_internal_dependency_matrix)


class InternalDependencyMatrixTest(unittest.TestCase):
    def test_parse_dependency_pins_from_requirements_and_pyproject_text(self):
        text = """
quant-platform-kit @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@v0.7.35
  "us-equity-strategies @ git+https://github.com/QuantStrategyLab/UsEquityStrategies.git@abc123",
"""

        pins = check_internal_dependency_matrix.parse_dependency_pins("ExamplePlatform", "requirements.txt", text)

        self.assertEqual([pin.package for pin in pins], ["quant-platform-kit", "us-equity-strategies"])
        self.assertEqual([pin.source_repo for pin in pins], ["QuantPlatformKit", "UsEquityStrategies"])
        self.assertEqual([pin.ref for pin in pins], ["v0.7.35", "abc123"])

    def test_parse_dependency_pins_from_uv_lock_text(self):
        text = """
[[package]]
name = "example"
dependencies = [
    { name = "quant-platform-kit", git = "https://github.com/QuantStrategyLab/QuantPlatformKit.git?rev=7032cde4547e7ec59af15df8935d142461a77051" },
]
"""

        pins = check_internal_dependency_matrix.parse_dependency_pins("ExamplePlatform", "uv.lock", text)

        self.assertEqual(len(pins), 1)
        self.assertEqual(pins[0].package, "quant-platform-kit")
        self.assertEqual(pins[0].source_repo, "QuantPlatformKit")
        self.assertEqual(pins[0].ref, "7032cde4547e7ec59af15df8935d142461a77051")

    def test_check_matrix_reports_ref_drift_and_untracked_dependency(self):
        projects_root = self._make_projects_root(
            {
                "ExamplePlatform/requirements.txt": "\n".join(
                    [
                        "quant-platform-kit @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@v0.7.36",
                        "extra-package @ git+https://github.com/QuantStrategyLab/ExtraPackage.git@v1.0.0",
                    ]
                )
            }
        )
        expected = [
            check_internal_dependency_matrix.DependencyPin(
                consumer_repo="ExamplePlatform",
                path="requirements.txt",
                package="quant-platform-kit",
                source_repo="QuantPlatformKit",
                ref="v0.7.35",
            )
        ]

        report = check_internal_dependency_matrix.check_matrix(matrix_pins=expected, projects_root=projects_root)

        self.assertEqual(report.checked_files, 1)
        self.assertEqual(report.missing_files, [])
        self.assertIn(
            "ref mismatch ExamplePlatform/requirements.txt:quant-platform-kit->QuantPlatformKit: "
            "expected @v0.7.35, found @v0.7.36",
            report.issues,
        )
        self.assertIn(
            "untracked internal dependency ExamplePlatform/requirements.txt:extra-package->ExtraPackage @v1.0.0",
            report.issues,
        )

    def test_current_matrix_matches_local_workspace(self):
        matrix_pins = check_internal_dependency_matrix.load_matrix(ROOT / "internal_dependency_matrix.json")

        report = check_internal_dependency_matrix.check_matrix(
            matrix_pins=matrix_pins,
            projects_root=ROOT.parent,
        )

        if report.missing_files:
            missing_inside_checked_out_repos = [
                item for item in report.missing_files if (ROOT.parent / item.split("/", 1)[0]).exists()
            ]
            self.assertEqual(missing_inside_checked_out_repos, [])
            self.assertEqual(report.issues, [])
            return

        self.assertEqual(report.missing_files, [])
        self.assertEqual(report.issues, [])

    def test_qpk_rollout_consumers_use_canonical_pin(self):
        canonical_pin = "651c9ac4f37ce6e7fe1bac84dc7646cd5abc9e6e"
        rollout_consumers = {
            "BinancePlatform",
            "CharlesSchwabPlatform",
            "CnEquityStrategies",
            "CryptoStrategies",
            "FirstradePlatform",
            "HkEquityStrategies",
            "InteractiveBrokersPlatform",
            "LongBridgePlatform",
            "UsEquityStrategies",
        }
        matrix_pins = check_internal_dependency_matrix.load_matrix(ROOT / "internal_dependency_matrix.json")
        refs = {
            (pin.consumer_repo, pin.path): pin.ref
            for pin in matrix_pins
            if pin.consumer_repo in rollout_consumers and pin.source_repo == "QuantPlatformKit"
        }

        self.assertEqual(len(refs), len(rollout_consumers) * 2)
        self.assertEqual(set(refs.values()), {canonical_pin})

    def test_require_consumer_files_treats_missing_paths_as_issues(self):
        projects_root = self._make_projects_root({})
        expected = [
            check_internal_dependency_matrix.DependencyPin(
                consumer_repo="ExamplePlatform",
                path="requirements.txt",
                package="quant-platform-kit",
                source_repo="QuantPlatformKit",
                ref="v0.7.35",
            )
        ]

        report = check_internal_dependency_matrix.check_matrix(matrix_pins=expected, projects_root=projects_root)

        self.assertEqual(report.checked_files, 0)
        self.assertEqual(report.missing_files, ["ExamplePlatform/requirements.txt"])
        self.assertEqual(report.issues, [])

    def test_check_matrix_accepts_pyproject_for_migrated_legacy_requirements(self):
        projects_root = self._make_projects_root(
            {
                "ExamplePlatform/pyproject.toml": (
                    "quant-platform-kit @ git+https://github.com/QuantStrategyLab/"
                    "QuantPlatformKit.git@v0.7.35"
                )
            }
        )
        expected = [
            check_internal_dependency_matrix.DependencyPin(
                consumer_repo="ExamplePlatform",
                path="requirements.txt",
                package="quant-platform-kit",
                source_repo="QuantPlatformKit",
                ref="v0.7.35",
            )
        ]

        report = check_internal_dependency_matrix.check_matrix(matrix_pins=expected, projects_root=projects_root)

        self.assertEqual(report.checked_files, 0)
        self.assertEqual(report.missing_files, [])
        self.assertEqual(report.issues, [])

    def test_collect_dependency_pins_from_projects(self):
        projects_root = self._make_projects_root(
            {
                "ExampleA/pyproject.toml": "quant-platform-kit @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@a11",
                "ExampleB/requirements.txt": "us-equity-strategies @ git+https://github.com/QuantStrategyLab/UsEquityStrategies.git@b22",
                "ExampleB/requirements-lock.txt": "crypto-strategies @ git+https://github.com/QuantStrategyLab/CryptoStrategies.git@c33",
            }
        )

        pins = check_internal_dependency_matrix.collect_dependency_pins_from_projects(projects_root)
        rows = [(pin.consumer_repo, pin.path, pin.package, pin.source_repo, pin.ref) for pin in pins]

        self.assertEqual(rows, [
            ("ExampleA", "pyproject.toml", "quant-platform-kit", "QuantPlatformKit", "a11"),
            ("ExampleB", "requirements-lock.txt", "crypto-strategies", "CryptoStrategies", "c33"),
            ("ExampleB", "requirements.txt", "us-equity-strategies", "UsEquityStrategies", "b22"),
        ])

    def test_sync_rewrites_matrix_with_stable_order(self):
        projects_root = self._make_projects_root(
            {
                "ExampleB/requirements.txt": "us-equity-strategies @ git+https://github.com/QuantStrategyLab/UsEquityStrategies.git@b22",
                "ExampleA/pyproject.toml": "quant-platform-kit @ git+https://github.com/QuantStrategyLab/QuantPlatformKit.git@a11",
            }
        )
        matrix_path = projects_root / "internal_dependency_matrix.json"
        matrix_path.write_text(
            (
                "{\n"
                '  "schema_version": 1,\n'
                '  "dependencies": [\n'
                '    {\n'
                '      "consumer_repo": "ExampleB",\n'
                '      "path": "requirements.txt",\n'
                '      "package": "us-equity-strategies",\n'
                '      "source_repo": "UsEquityStrategies",\n'
                '      "ref": "b22"\n'
                "    }\n"
                "  ]\n"
                "}\n"
            ),
            encoding="utf-8",
        )

        projects_payload = check_internal_dependency_matrix.matrix_payload(
            check_internal_dependency_matrix.collect_dependency_pins_from_projects(projects_root)
        )
        exit_code = check_internal_dependency_matrix.main(
            ["--sync", "--projects-root", str(projects_root), "--matrix", str(matrix_path)]
        )
        synced_payload = json.loads(matrix_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(synced_payload["schema_version"], 1)
        self.assertEqual(synced_payload["dependencies"], projects_payload["dependencies"])
        self.assertLess(
            synced_payload["dependencies"][0]["path"],
            synced_payload["dependencies"][-1]["path"],
        )

    def _make_projects_root(self, files: dict[str, str]) -> Path:
        import tempfile

        root = Path(tempfile.mkdtemp())
        for relative_path, text in files.items():
            path = root / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        return root


if __name__ == "__main__":
    unittest.main()
