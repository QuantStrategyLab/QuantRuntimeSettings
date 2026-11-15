"""Unit tests for generic platform-config overlay loading and 23x5/multi-market validation."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python" / "scripts"))

import build_config
import build_platform_config
import build_runtime_switch
import config_overlay
import runtime_settings


class ConfigOverlayTests(unittest.TestCase):
    def test_default_load_without_overlay_matches_base_file(self):
        base = json.loads((ROOT / "platform-config.json").read_text(encoding="utf-8"))
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("QSL_CONFIG_OVERLAY_PATH", None)
            os.environ.pop("QSL_CONFIG_OVERLAY_JSON", None)
            loaded = build_config.load_config()
        self.assertEqual(loaded, base)
        self.assertEqual(build_config.validate(loaded), [])

    def test_inline_json_overlay_merges_and_validates_multi_market_and_23x5(self):
        overlay_text = (ROOT / "examples" / "platform-config.overlay.example.json").read_text(
            encoding="utf-8"
        )
        loaded = config_overlay.load_platform_config(
            ROOT / "platform-config.json",
            env={"QSL_CONFIG_OVERLAY_JSON": overlay_text},
        )
        self.assertEqual(
            loaded["platforms"]["ibkr"]["default_account"]["target_name"],
            "acct_example_01",
        )
        self.assertEqual(
            loaded["platforms"]["ibkr"]["repository"],
            "QuantStrategyLab/InteractiveBrokersPlatform",
        )
        self.assertIn("futures_us", loaded["domains"])
        self.assertIn("us_23x5_overnight", loaded["scheduling"]["profiles"])
        self.assertEqual(build_config.validate(loaded), [])

    def test_file_path_overlay_applies_cleanly(self):
        overlay = {
            "scheduling": {
                "profiles": {
                    "us_23x5_night_only": {
                        "timezone": "America/New_York",
                        "main_time": "10 21 * * 0,1-5",
                        "probe_time": "5 21 * * 0,1-5",
                        "precheck_time": "0 21 * * 0,1-5",
                    }
                }
            }
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "overlay.json"
            path.write_text(json.dumps(overlay), encoding="utf-8")
            loaded = config_overlay.load_platform_config(
                ROOT / "platform-config.json",
                env={"QSL_CONFIG_OVERLAY_PATH": str(path)},
            )
        self.assertEqual(build_config.validate(loaded), [])

    def test_rejects_secret_bearing_keys(self):
        for bad_key in ("API_KEY", "CLIENT_SECRET", "BOT_TOKEN", "private_key", "password_hash"):
            with self.subTest(bad_key=bad_key):
                payload = json.dumps({"platforms": {"ibkr": {bad_key: "synthetic"}}})
                with self.assertRaisesRegex(ValueError, "secret-bearing"):
                    config_overlay.load_platform_config(
                        ROOT / "platform-config.json",
                        env={"QSL_CONFIG_OVERLAY_JSON": payload},
                    )

    def test_rejects_conflicting_overlay_env_vars_and_non_object_payloads(self):
        with self.assertRaisesRegex(ValueError, "at most one"):
            config_overlay.load_overlay_payload(
                {
                    "QSL_CONFIG_OVERLAY_PATH": "/tmp/a.json",
                    "QSL_CONFIG_OVERLAY_JSON": "{}",
                }
            )
        with self.assertRaisesRegex(ValueError, "JSON object"):
            config_overlay.load_overlay_payload({"QSL_CONFIG_OVERLAY_JSON": "[]"})

    def test_overlay_propagates_across_console_and_runtime_consumers(self):
        base = json.loads((ROOT / "platform-config.json").read_text(encoding="utf-8"))
        overlay = json.loads(
            (ROOT / "examples" / "platform-config.overlay.example.json").read_text(encoding="utf-8")
        )
        strategy_key = next(iter(base["strategies"]))
        base_strategy = dict(base["strategies"][strategy_key])
        overlay["strategies"] = {
            strategy_key: {
                **base_strategy,
                "domain": "futures_us",
                "scheduler_profile": "us_23x5_overnight",
            }
        }
        env_patch = {"QSL_CONFIG_OVERLAY_JSON": json.dumps(overlay)}
        with tempfile.TemporaryDirectory(dir=ROOT) as tmp, patch.dict(os.environ, env_patch, clear=False):
            os.environ.pop("QSL_CONFIG_OVERLAY_PATH", None)
            tmp_dir = Path(tmp)
            profiles_path = tmp_dir / "profiles_from_build_config.json"
            target_js = tmp_dir / "config.js"
            strategy_js = tmp_dir / "strategy_profiles_asset.js"
            strategy_json = tmp_dir / "strategy-profiles.example.json"
            projection_json = tmp_dir / "runtime-catalog-projection.json"

            with (
                patch.object(build_config, "STRATEGY_PROFILES_PATH", profiles_path),
                patch.object(build_platform_config, "TARGET", target_js),
                patch.object(build_platform_config, "STRATEGY_TARGET", strategy_js),
                patch.object(build_platform_config, "STRATEGY_EXAMPLE_TARGET", strategy_json),
                patch.object(build_platform_config, "RUNTIME_CATALOG_PROJECTION_TARGET", projection_json),
                patch.object(
                    build_config,
                    "run_sync_script",
                    side_effect=lambda: self.assertEqual(build_platform_config.main(), 0),
                ),
                patch.object(sys, "argv", ["build_config.py"]),
            ):
                self.assertEqual(build_config.main(), 0)

            self.assertIn('"target_name": "acct_example_01"', target_js.read_text(encoding="utf-8"))
            self.assertIn('"domain": "futures_us"', strategy_js.read_text(encoding="utf-8"))
            rendered_profiles = {
                entry["profile"]: entry
                for entry in json.loads(strategy_json.read_text(encoding="utf-8"))
            }
            self.assertEqual(rendered_profiles[strategy_key]["domain"], "futures_us")
            projection = json.loads(projection_json.read_text(encoding="utf-8"))
            projection_strategies = {
                entry["profile"]: entry for entry in projection["strategies"]
            }
            self.assertEqual(
                projection_strategies[strategy_key]["domain"],
                "futures_us",
            )

            with patch.object(sys, "argv", ["build_platform_config.py", "--check"]):
                with (
                    patch.object(build_platform_config, "TARGET", target_js),
                    patch.object(build_platform_config, "STRATEGY_TARGET", strategy_js),
                    patch.object(build_platform_config, "STRATEGY_EXAMPLE_TARGET", strategy_json),
                    patch.object(build_platform_config, "RUNTIME_CATALOG_PROJECTION_TARGET", projection_json),
                ):
                    self.assertEqual(build_platform_config.main(), 0)

            scheduler = build_runtime_switch._scheduler_plan_for_strategy(strategy_key)
            self.assertEqual(scheduler["main_time"], "15 21 * * 0-5")
            market = build_runtime_switch._market_plan_for_strategy(strategy_key)
            self.assertEqual(market["market"], "CME")
            self.assertEqual(market["market_calendar"], "CME_GLOBEX")
            loaded_settings = runtime_settings.load_platform_config()
            self.assertEqual(
                loaded_settings["platforms"]["ibkr"]["default_account"]["target_name"],
                "acct_example_01",
            )

    def test_relative_overlay_path_survives_build_subprocess_cwd(self):
        with tempfile.TemporaryDirectory() as outside_tmp:
            outside_dir = Path(outside_tmp)
            overlay_file = outside_dir / "overlay.json"
            overlay_file.write_text('{"scheduling": {"profiles": {}}}', encoding="utf-8")
            original_cwd = Path.cwd()
            try:
                os.chdir(outside_dir)
                child_env = config_overlay.normalized_overlay_environ(
                    {**os.environ, "QSL_CONFIG_OVERLAY_PATH": "overlay.json"}
                )
            finally:
                os.chdir(original_cwd)

            resolved_path = Path(child_env["QSL_CONFIG_OVERLAY_PATH"])
            self.assertTrue(resolved_path.is_absolute())
            self.assertEqual(resolved_path, overlay_file.resolve())
            result = subprocess.run(
                [sys.executable, str(ROOT / "python" / "scripts" / "build_platform_config.py"), "--check"],
                cwd=ROOT,
                env=child_env,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_us_23x5_overlay_allows_live_ibkr_target_validation(self):
        base = json.loads((ROOT / "platform-config.json").read_text(encoding="utf-8"))
        overlay = json.loads(
            (ROOT / "examples" / "platform-config.overlay.example.json").read_text(encoding="utf-8")
        )
        strategy_key = "tqqq_growth_income"
        base_strategy = dict(base["strategies"][strategy_key])
        base_strategy["scheduler_profile"] = "us_23x5_overnight"
        overlay["strategies"] = {strategy_key: base_strategy}

        with patch.dict(os.environ, {"QSL_CONFIG_OVERLAY_JSON": json.dumps(overlay)}, clear=False):
            os.environ.pop("QSL_CONFIG_OVERLAY_PATH", None)
            args = build_runtime_switch.build_parser().parse_args(
                [
                    "--platform",
                    "ibkr",
                    "--target-name",
                    "live",
                    "--strategy-profile",
                    strategy_key,
                ]
            )
            target = build_runtime_switch.build_switch_target(args)
            self.assertEqual(target["runtime_target"]["scheduler"]["main_time"], "15 21 * * 0-5")
            self.assertEqual(runtime_settings.validate_target(target), [])

            target["runtime_target"]["scheduler"]["main_time"] = "15 21 * * *"
            self.assertIn(
                "runtime_target.scheduler.main_time must be a two-field time or Sun-Fri 23x5 cron for live IBKR US 23x5 targets",
                runtime_settings.validate_target(target),
            )


if __name__ == "__main__":
    unittest.main()
