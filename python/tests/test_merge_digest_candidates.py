from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
spec = importlib.util.spec_from_file_location("merge_digest_candidates", SCRIPTS / "merge_digest_candidates.py")
merger = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = merger
assert spec.loader is not None
spec.loader.exec_module(merger)


def _row(platform, **extra):
    return {"platform_id": platform, "strategy_profile": "synthetic-profile", "actually_ran": True, **extra}


class MergeDigestCandidatesTests(unittest.TestCase):
    def test_merges_base_and_fetched_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "base.json").write_text(json.dumps({"runs": [_row("schwab")]}))
            fetched = root / "fetched" / "ibkr" / "2026-10-12"
            fetched.mkdir(parents=True)
            (fetched / "primary-live.json").write_text(
                json.dumps({"schema_version": "qsl.digest_candidates.v1", "runs": [_row("ibkr")]})
            )
            payload, stats = merger.merge(root / "base.json", root / "fetched")
        self.assertEqual([r["platform_id"] for r in payload["runs"]], ["schwab", "ibkr"])
        self.assertEqual(stats, {"base_rows": 1, "files": 1, "file_rows": 1, "invalid_files": 0})
        self.assertEqual(payload["schema_version"], "qsl.digest_candidates.v1")

    def test_unconfigured_inputs_are_rejected(self):
        with self.assertRaises(ValueError):
            merger.merge(None, None)
        with tempfile.TemporaryDirectory() as tmp:
            from contextlib import redirect_stderr
            from io import StringIO

            output = Path(tmp) / "output.json"
            with redirect_stderr(StringIO()):
                self.assertEqual(merger.main(["--output", str(output)]), 2)
            self.assertFalse(output.exists())

    def test_explicit_successfully_read_empty_directory_stays_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload, stats = merger.merge(None, Path(tmp))
        self.assertEqual(payload["runs"], [])
        self.assertEqual(stats["files"], 0)

    def test_valid_empty_producer_still_proves_idle_after_roundtrip(self):
        if str(SCRIPTS) not in sys.path:
            sys.path.insert(0, str(SCRIPTS))
        import daily_digest_aggregator as aggregator

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fetched = root / "fetched"
            fetched.mkdir()
            (fetched / "empty.json").write_text(json.dumps({
                "schema_version": merger.SCHEMA_VERSION,
                "runs": [],
                "producer_status": "empty",
                "producer_reason": "no_covering_runs",
            }))
            output = root / "merged.json"
            self.assertEqual(merger.main(["--input-dir", str(fetched), "--output", str(output)]), 0)
            payload, text, collected = aggregator.build_digest_payload(
                business_day="2026-10-12", candidates_path=output,
                include_github=False, layout="sections_v2",
            )
            receipt = aggregator.build_receipt(payload, collected, message_chars=len(text))
        self.assertEqual(receipt["evidence_status"], "verified_idle")
        self.assertEqual(receipt["total_fills"], 0)
        self.assertEqual(receipt["total_fills_status"], "known")

    def test_invalid_fetched_input_never_produces_successful_partial_envelope(self):
        invalid_payloads = [
            "{not json",
            json.dumps({"schema_version": merger.SCHEMA_VERSION}),
            json.dumps({"schema_version": "unsupported.v2", "runs": []}),
            json.dumps({"schema_version": merger.SCHEMA_VERSION, "runs": [], "producer_status": "skipped"}),
            json.dumps({"schema_version": merger.SCHEMA_VERSION, "runs": [], "producer_status": "failed"}),
            json.dumps({"schema_version": merger.SCHEMA_VERSION, "runs": [], "producer_status": "unsupported"}),
            json.dumps({"schema_version": merger.SCHEMA_VERSION, "runs": [], "producer_status": None}),
        ]
        for bad in invalid_payloads:
            with self.subTest(payload=bad), tempfile.TemporaryDirectory() as tmp:
                fetched = Path(tmp)
                (fetched / "good.json").write_text(json.dumps({"runs": [_row("schwab")]}))
                (fetched / "bad.json").write_text(bad)
                with self.assertRaises(ValueError):
                    merger.merge(None, fetched)

    def test_nonempty_rows_require_identity_and_explicit_boolean_run_evidence(self):
        valid = {"platform_id": "synthetic-platform", "strategy_profile": "synthetic-strategy", "actually_ran": True}
        for field in valid:
            bad = {key: value for key, value in valid.items() if key != field}
            with self.subTest(missing=field), tempfile.TemporaryDirectory() as tmp:
                base = Path(tmp) / "base.json"
                base.write_text(json.dumps({"runs": [bad]}))
                with self.assertRaises(ValueError):
                    merger.merge(base, None)

    def test_missing_configured_paths_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "private-target.json"
            for base, fetched in [(missing, None), (None, missing)]:
                with self.subTest(base=base, fetched=fetched), self.assertRaises(ValueError):
                    merger.merge(base, fetched)

    def test_unreadable_base_and_fetched_inputs_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            candidate = root / "private-target.json"
            candidate.write_text(json.dumps({"runs": []}))
            for base, fetched in [(candidate, None), (None, root)]:
                with self.subTest(base=base, fetched=fetched):
                    with mock.patch.object(Path, "read_text", side_effect=PermissionError("private-target")):
                        with self.assertRaises(ValueError):
                            merger.merge(base, fetched)

    def test_unreadable_directory_is_not_treated_as_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(merger.os, "scandir", side_effect=PermissionError("private-target")):
                with self.assertRaisesRegex(ValueError, "candidate_input_directory_unavailable"):
                    merger.merge(None, Path(tmp))

    def test_cli_failure_preserves_existing_output_and_redacts_private_paths(self):
        from contextlib import redirect_stdout, redirect_stderr
        from io import StringIO

        for previous in [None, '{"runs":[{"equity":123.45}]}']:
            with self.subTest(previous=previous), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                output = root / "merged.json"
                if previous is not None:
                    output.write_text(previous)
                buf = StringIO()
                with redirect_stdout(buf), redirect_stderr(buf):
                    code = merger.main([
                        "--base", str(root / "secret-account-target.json"), "--output", str(output),
                    ])
                self.assertEqual(code, 2)
                self.assertNotIn("secret-account-target", buf.getvalue())
                self.assertNotIn("123.45", buf.getvalue())
                if previous is None:
                    self.assertFalse(output.exists())
                else:
                    self.assertEqual(output.read_text(), previous)

    def test_cli_prints_counts_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "base.json").write_text(json.dumps({"runs": [_row("schwab", equity=123.45)]}))
            from io import StringIO
            from contextlib import redirect_stdout

            buf = StringIO()
            with redirect_stdout(buf):
                merger.main(["--base", str(root / "base.json"), "--output", str(root / "out.json")])
            self.assertNotIn("123.45", buf.getvalue())
            self.assertEqual(json.loads((root / "out.json").read_text())["runs"][0]["equity"], 123.45)


if __name__ == "__main__":
    unittest.main()


class WorkflowWiringTests(unittest.TestCase):
    def test_store_fetch_is_gated_on_variable_and_copies_match(self):
        root = Path(__file__).resolve().parents[2]
        live = (root / ".github/workflows/daily-digest-notify.yml").read_text(encoding="utf-8")
        self.assertEqual(live, (root / "docs/workflows/daily-digest-notify.yml").read_text(encoding="utf-8"))
        self.assertIn("DIGEST_CANDIDATES_GCS_URI: ${{ vars.DIGEST_CANDIDATES_GCS_URI || '' }}", live)
        self.assertIn("if: ${{ steps.resend_guard.outputs.proceed == 'true' && env.DIGEST_CANDIDATES_GCS_URI != '' }}", live)
        self.assertIn("merge_digest_candidates.py", live)
