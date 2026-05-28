from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "runtime_settings.py"
SPEC = importlib.util.spec_from_file_location("runtime_settings", MODULE_PATH)
runtime_settings = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = runtime_settings
SPEC.loader.exec_module(runtime_settings)


class RuntimeSettingsTest(unittest.TestCase):
    def load_target(self, relative_path: str):
        path = ROOT / relative_path
        return path, runtime_settings.load_target(path)

    def test_all_targets_validate(self):
        for path in sorted((ROOT / "examples" / "targets").glob("*/*.json")):
            with self.subTest(path=path):
                self.assertEqual(runtime_settings.validate_target(runtime_settings.load_target(path), path), [])

    def test_runtime_target_json_is_canonical_source_for_strategy_profile(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertIn("RUNTIME_TARGET_JSON", assignments)
        self.assertEqual(assignments["STRATEGY_PROFILE"], target["runtime_target"]["strategy_profile"])
        self.assertNotIn("STRATEGY_PROFILE", target["extra_variables"])

    def test_example_targets_have_matching_plugin_mount(self):
        for relative_path in (
            "examples/targets/schwab/live.example.json",
            "examples/targets/longbridge/sg.example.json",
        ):
            with self.subTest(relative_path=relative_path):
                _, target = self.load_target(relative_path)
                profile = target["runtime_target"]["strategy_profile"]
                self.assertTrue(
                    any(
                        mount["strategy"] == profile
                        and mount["enabled"] is True
                        for mount in target["plugin_mounts"]
                    )
                )

    def test_plugin_mount_schema_version_is_rendered_for_platform_parser(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        assignments = {item.name: item.value for item in runtime_settings.build_assignments(target)}

        self.assertIn('"expected_schema_version":"example_notification_plugin.v1"', assignments["SCHWAB_STRATEGY_PLUGIN_MOUNTS_JSON"])

    def test_plugin_mount_schema_version_must_be_non_empty_string(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        target["plugin_mounts"][0]["expected_schema_version"] = ""

        self.assertIn(
            "plugin_mounts[0].expected_schema_version must be a non-empty string",
            runtime_settings.validate_target(target),
        )

    def test_generated_variables_cannot_be_overridden(self):
        _, target = self.load_target("examples/targets/schwab/live.example.json")
        target["extra_variables"] = {"STRATEGY_PROFILE": "old_strategy"}

        self.assertIn(
            "extra_variables.STRATEGY_PROFILE duplicates a generated variable",
            runtime_settings.validate_target(target),
        )

    def test_longbridge_dry_run_flag_must_match_runtime_target(self):
        _, target = self.load_target("examples/targets/longbridge/sg.example.json")
        target["extra_variables"]["LONGBRIDGE_DRY_RUN_ONLY"] = "true"

        self.assertIn(
            "extra_variables.LONGBRIDGE_DRY_RUN_ONLY must match runtime_target.dry_run_only",
            runtime_settings.validate_target(target),
        )


if __name__ == "__main__":
    unittest.main()
