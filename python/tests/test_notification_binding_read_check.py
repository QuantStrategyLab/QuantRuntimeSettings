"""Synthetic privacy and isolation regressions for the manual binding reader."""
import ast
import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python/scripts"))
import check_notification_binding_read as check


def row(platform="ibkr", uid="synthetic-opaque-a", target="synthetic-target-a", profile="synthetic-profile"):
    return dict(zip(check.IDENTITY, (platform, uid, target, profile)))


def identity_hash(member):
    value = [member[key] for key in check.IDENTITY]
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


class NotificationBindingReadCheckTests(unittest.TestCase):
    def inspect(self, rows, **env):
        return check.inspect_bindings({"DIGEST_EXPECTED_TARGETS_JSON": json.dumps(rows), **env}, [])

    def test_anonymous_counts_and_selected_membership(self):
        selected = row()
        result = self.inspect([selected, row("schwab")],
                              BINDING_SELECTED_IDENTITY_SHA256=identity_hash(selected))
        self.assertEqual(result["expected_count"], 2)
        self.assertEqual(result["per_platform"]["ibkr"]["expected_count"], 1)
        self.assertIs(result["selected_membership"], True)
        self.assertEqual(result["source"], "injected_expected")

    def test_same_profile_different_identity_is_not_coverage(self):
        selected = row()
        for changed in (row(uid="different-opaque"), row(target="different-target"),
                        row(profile="different-profile"), row("schwab")):
            with self.subTest(changed=changed):
                result = self.inspect([changed], BINDING_SELECTED_IDENTITY_SHA256=identity_hash(selected))
                self.assertEqual(result["status"], "mismatch")
                self.assertIs(result["selected_membership"], False)

    def test_missing_hash_never_claims_membership(self):
        result = self.inspect([row()])
        self.assertEqual(result["status"], "read_complete")
        self.assertIsNone(result["selected_membership"])
        self.assertEqual(result["runtime_marker_authority"], "not_tested")
        self.assertEqual(result["reader_access"], "not_tested")
        self.assertEqual(result["notification_delivery"], "not_attempted")

    def test_empty_expected_remains_missing(self):
        result = self.inspect([])
        self.assertEqual(result["status"], "missing")
        self.assertEqual(result["expected_count"], 0)
        self.assertIsNone(result["selected_membership"])

    def test_secret_precedence_and_empty_secret_fallback(self):
        self.assertEqual(check.inspect_bindings({"DIGEST_EXPECTED_TARGETS_JSON": " "}, [row()])["source"], "source_fallback")
        self.assertEqual(self.inspect([row()])["source"], "injected_expected")
        self.assertEqual(self.inspect([])["expected_count"], 0)

    def test_invalid_data_and_duplicate_never_fall_back(self):
        invalids = ["not-json-synthetic-private", "[" * 1200, "{}", "[null]",
                    json.dumps([{"platform_id": "ibkr"}]), json.dumps([row("unknown")]),
                    json.dumps([row(), row()])]
        for raw in invalids:
            with self.subTest(raw_hash=hashlib.sha256(raw.encode()).hexdigest()):
                result = check.inspect_bindings({"DIGEST_EXPECTED_TARGETS_JSON": raw}, [row()])
                self.assertEqual(result["status"], "invalid")
                self.assertIsNone(result["selected_membership"])

    def test_raw_identity_extra_data_reader_and_invalid_values_are_not_emitted(self):
        member = row()
        member["ignored_private_fact"] = "synthetic-private-fact"
        result = self.inspect([member], DIGEST_CANDIDATES_GCS_URI="gs://synthetic-private-location/prefix",
                              DIGEST_CANDIDATES_READER_SERVICE_ACCOUNT="synthetic-reader@example.invalid",
                              QRS_UNIFIED_NOTIFICATION_ENABLED="synthetic-invalid-literal",
                              QSL_ROUTINE_NOTIFICATION_MODE="synthetic-invalid-mode")
        encoded = json.dumps(result)
        for forbidden in [*member.values(), "gs://synthetic-private-location/prefix", "synthetic-reader@example.invalid",
                          "synthetic-invalid-literal", "synthetic-invalid-mode"]:
            if forbidden == "ibkr":
                continue
            self.assertNotIn(forbidden, encoded)
        self.assertTrue(result["reader_principal"]["configured"])
        self.assertEqual(result["reader_access"], "not_tested")

    def test_invalid_selector_never_echoes_input(self):
        for env in ({"BINDING_SELECTED_PLATFORM": "synthetic-private-invalid"},
                    {"BINDING_SELECTED_IDENTITY_SHA256": "synthetic-private-invalid"}):
            result = self.inspect([row()], **env)
            self.assertEqual(result["reason"], "selected_identity_invalid")
            self.assertNotIn("synthetic-private-invalid", json.dumps(result))

    def test_set_hash_is_order_invariant_and_identity_sensitive(self):
        original = self.inspect([row(), row("schwab")])
        reverse = self.inspect([row("schwab"), row()])
        changed = self.inspect([row(), row("schwab", uid="changed")])
        self.assertEqual(original["expected_set_sha256"], reverse["expected_set_sha256"])
        self.assertNotEqual(original["expected_set_sha256"], changed["expected_set_sha256"])

    def test_membership_hash_uses_documented_utf8_identity(self):
        selected = row(profile="synthetic-测试-profile")
        result = self.inspect([selected], BINDING_SELECTED_IDENTITY_SHA256=identity_hash(selected))
        self.assertIs(result["selected_membership"], True)

    def test_platforms_match_existing_unified_contract(self):
        import notification_candidate_adapter as adapter
        self.assertEqual(check.PLATFORMS, set(adapter.PLATFORMS))

    def test_cli_writes_same_safe_certificate_without_loading_unused_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "certificate.json"
            console = io.StringIO()
            with patch.dict(check.os.environ, {"DIGEST_EXPECTED_TARGETS_JSON": json.dumps([row()])}, clear=True), \
                    patch.object(sys, "argv", ["check", "--out", str(out)]), \
                    patch.object(check, "ROOT", Path(directory) / "missing-fallback"), \
                    contextlib.redirect_stdout(console):
                self.assertEqual(check.main(), 0)
            self.assertEqual(json.loads(console.getvalue()), json.loads(out.read_text()))
            self.assertNotIn("synthetic-opaque-a", out.read_text())

    def test_cli_fallback_errors_still_write_anonymous_certificate(self):
        fallback_sources = [
            {"notifications": {"quant_sentinel": {"daily_digest": value}}}
            for value in (None, [])
        ] + [
            {"notifications": {"quant_sentinel": {"daily_digest": {"aggregator": value}}}}
            for value in (None, [])
        ]
        expected = {"schema_version": 1, "status": "invalid", "reason": "source_configuration_unreadable"}
        for fallback in fallback_sources:
            with self.subTest(fallback=fallback), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "platform-config.json").write_text(json.dumps(fallback))
                out = root / "certificate.json"
                console = io.StringIO()
                with patch.dict(check.os.environ, {}, clear=True), \
                        patch.object(sys, "argv", ["check", "--out", str(out)]), \
                        patch.object(check, "ROOT", root), contextlib.redirect_stdout(console):
                    self.assertEqual(check.main(), 1)
                self.assertEqual(json.loads(out.read_text()), expected)
                self.assertEqual(json.loads(console.getvalue()), expected)
        # Deterministic across Python implementations with different recursion limits.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "platform-config.json").write_text("synthetic-private-malformed-source")
            out = root / "certificate.json"
            console = io.StringIO()
            with patch.dict(check.os.environ, {}, clear=True), \
                    patch.object(sys, "argv", ["check", "--out", str(out)]), \
                    patch.object(check, "ROOT", root), \
                    patch.object(check.json, "loads", side_effect=RecursionError("synthetic-private-error")), \
                    contextlib.redirect_stdout(console):
                self.assertEqual(check.main(), 1)
            self.assertEqual(json.loads(out.read_text()), expected)
            self.assertEqual(json.loads(console.getvalue()), expected)
            self.assertNotIn("synthetic-private", out.read_text())

    def test_read_only_workflow_uses_only_existing_named_configuration(self):
        source = (ROOT / ".github/workflows/notification-binding-read-check.yml").read_text()
        self.assertIn("workflow_dispatch:", source)
        self.assertNotIn("  schedule:", source)
        self.assertNotIn("  push:", source)
        self.assertIn("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'", source)
        self.assertIn("permissions:\n  contents: read", source)
        self.assertIn("environment: runtime-strategy-switch", source)
        self.assertIn("persist-credentials: false", source)
        for forbidden in ("id-token:", "google-github-actions", "TELEGRAM", "SYNC_TOKEN", "GH_TOKEN",
                          "send_daily_digest", "gcloud", "curl", "check_credential_maintenance"):
            self.assertNotIn(forbidden, source)
        self.assertEqual(source.count("secrets."), 1)
        self.assertIn("secrets.DIGEST_EXPECTED_TARGETS_JSON", source)
        self.assertIn("if: ${{ always() }}", source)

    def test_checker_has_no_network_process_or_credential_import(self):
        tree = ast.parse((ROOT / "python/scripts/check_notification_binding_read.py").read_text())
        names = {node.module.split(".")[0] for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
        names.update(alias.name.split(".")[0] for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names)
        self.assertFalse(names & {"requests", "urllib", "google", "subprocess", "socket", "daily_digest_notify"})


if __name__ == "__main__":
    unittest.main()
