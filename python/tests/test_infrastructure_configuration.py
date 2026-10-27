"""Missing infrastructure configuration fails before external operations."""

import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python/scripts"))
import promotion_signature

SPEC = importlib.util.spec_from_file_location("review_configuration", ROOT / "scripts/provision_soxl_v7_review_credential.py")
review = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(review)


class InfrastructureConfigurationTests(unittest.TestCase):
    def test_missing_console_stops_before_credential_or_github_access(self):
        command, opener = Mock(), Mock()
        with self.assertRaisesRegex(ValueError, "STRATEGY_SWITCH_CONSOLE_URL is required"):
            review.provision(env={}, run=command, opener=opener)
        command.assert_not_called()
        opener.assert_not_called()

    def test_invalid_console_origins_stop_before_external_access(self):
        for value in ("http://example.invalid", "https://user@example.invalid", "https://example.invalid/path", "https://example.invalid?query=1"):
            with self.subTest(value=value):
                command, opener = Mock(), Mock()
                with self.assertRaisesRegex(ValueError, "STRATEGY_SWITCH_CONSOLE_URL"):
                    review.provision(env={"STRATEGY_SWITCH_CONSOLE_URL": value}, run=command, opener=opener)
                command.assert_not_called()
                opener.assert_not_called()

    def test_missing_benchmark_url_stops_before_fetching_prices(self):
        result = subprocess.run(
            ["node", str(ROOT / "scripts/sync_market_benchmark_closes.mjs")],
            env={"PATH": os.environ["PATH"]}, capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("MARKET_BENCHMARK_SYNC_URL is required", result.stderr)
        self.assertNotIn("fetched series=", result.stdout)

    def test_missing_or_invalid_promotion_project_mapping_fails_closed(self):
        for value in ("", "[]", '{"ibkr":"../../other"}', '{"ibkr":null}'):
            with self.subTest(value=value), patch.dict(os.environ, {"QSL_PROMOTION_ROOT_PROJECTS_JSON": value}):
                with self.assertRaisesRegex(ValueError, "QSL_PROMOTION_ROOT_PROJECTS_JSON"):
                    promotion_signature.load_trusted_root("ibkr", {"ibkr": "a" * 64})

    def test_digest_preflight_requires_configured_store(self):
        for name in (".github/workflows/daily-digest-notify.yml",):
            workflow = (ROOT / name).read_text()
            self.assertIn("DIGEST_CANDIDATES_GCS_URI is required for private store preflight", workflow)
            self.assertIn("Require digest infrastructure variables", workflow)
            self.assertLess(workflow.index("Require digest infrastructure variables"), workflow.index("google-github-actions/auth@"))
