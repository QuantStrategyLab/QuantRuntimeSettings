from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "check_internal_dependency_matrix.py"
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
        matrix_pins = check_internal_dependency_matrix.load_matrix(
            ROOT / "internal_dependency_matrix.json"
        )

        report = check_internal_dependency_matrix.check_matrix(
            matrix_pins=matrix_pins,
            projects_root=ROOT.parent,
        )

        expected_paths = sorted({f"{pin.consumer_repo}/{pin.path}" for pin in matrix_pins})
        if report.missing_files:
            self.assertEqual(sorted(report.missing_files), expected_paths)
            self.assertEqual(report.checked_files, 0)
            self.assertEqual(report.issues, [])
            return

        self.assertEqual(report.missing_files, [])
        self.assertEqual(report.issues, [])

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
