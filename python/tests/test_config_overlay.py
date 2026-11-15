"""Unit tests for generic platform-config overlay loading and 23x5/multi-market validation."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python" / "scripts"))

import build_config
import config_overlay


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


if __name__ == "__main__":
    unittest.main()
