"""Offline dependency-install regression; never triggers a workflow or npm install."""
from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[2]


class PlatformHealthMonitorWorkflowTest(unittest.TestCase):
    def test_web_validation_installs_both_locked_test_dependencies_before_node(self):
        workflow = (ROOT / ".github/workflows/platform-health-monitor.yml").read_text()
        ci = (ROOT / ".github/workflows/validate.yml").read_text()
        section = workflow.split("      - name: Validate strategy switch assets\n", 1)[1].split("      - name: Summarize platform health\n", 1)[0]
        worker_install = "npm ci --prefix web/strategy-switch-console\n"
        frontend_install = "npm ci --prefix web/strategy-switch-console/frontend\n"
        self.assertIn(worker_install, section)
        self.assertIn(frontend_install, section)
        first_node = section.index("node --experimental-default-type=module tests/strategy_switch_worker_validation.mjs")
        self.assertLess(section.index(worker_install), first_node)
        self.assertLess(section.index(frontend_install), first_node)
        self.assertIn("working-directory: web/strategy-switch-console\n        run: npm ci", ci)
        self.assertIn("npm ci --prefix web/strategy-switch-console/frontend", ci)
        self.assertIn("id: web_validation\n        continue-on-error: true", section)
        self.assertIn("node tests/console_presentation_validation.mjs", section)
        self.assertIn("steps.web_validation.outcome == 'failure'", workflow)
        self.assertNotIn("npm install", section)
        worker = ROOT / "web/strategy-switch-console"
        for directory in (worker, worker / "frontend"):
            package = json.loads((directory / "package.json").read_text())
            lock = json.loads((directory / "package-lock.json").read_text())
            for field in ("dependencies", "devDependencies"):
                self.assertEqual(package.get(field, {}), lock["packages"][""].get(field, {}))
            for entry in lock["packages"].values():
                if "resolved" in entry:
                    self.assertTrue(entry["resolved"].startswith("https://registry.npmjs.org/"))
                    self.assertTrue(entry.get("integrity"))


if __name__ == "__main__":
    unittest.main()
