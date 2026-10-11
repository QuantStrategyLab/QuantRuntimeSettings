from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
spec = importlib.util.spec_from_file_location("merge_digest_candidates", SCRIPTS / "merge_digest_candidates.py")
merger = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = merger
assert spec.loader is not None
spec.loader.exec_module(merger)


class MergeDigestCandidatesTests(unittest.TestCase):
    def test_merges_base_and_fetched_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "base.json").write_text(json.dumps({"runs": [{"platform_id": "schwab"}]}))
            fetched = root / "fetched" / "ibkr" / "2026-10-12"
            fetched.mkdir(parents=True)
            (fetched / "primary-live.json").write_text(
                json.dumps({"schema_version": "qsl.digest_candidates.v1", "runs": [{"platform_id": "ibkr"}]})
            )
            (fetched / "broken.json").write_text("{not json")
            payload, stats = merger.merge(root / "base.json", root / "fetched")
        self.assertEqual([r["platform_id"] for r in payload["runs"]], ["schwab", "ibkr"])
        self.assertEqual(stats, {"base_rows": 1, "files": 1, "file_rows": 1, "invalid_files": 1})
        self.assertEqual(payload["schema_version"], "qsl.digest_candidates.v1")

    def test_missing_inputs_give_empty_envelope(self):
        payload, stats = merger.merge(None, Path("/nonexistent"))
        self.assertEqual(payload["runs"], [])
        self.assertEqual(stats["files"], 0)

    def test_cli_prints_counts_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "base.json").write_text(json.dumps({"runs": [{"platform_id": "schwab", "equity": 123.45}]}))
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
        self.assertIn("if: ${{ env.DIGEST_CANDIDATES_GCS_URI != '' }}", live)
        self.assertIn("merge_digest_candidates.py", live)
