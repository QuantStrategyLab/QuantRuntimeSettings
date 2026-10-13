from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
spec = importlib.util.spec_from_file_location("digest_store_permission_check", SCRIPTS / "digest_store_permission_check.py")
probe = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = probe
assert spec.loader is not None
spec.loader.exec_module(probe)


class DigestStorePermissionCheckTests(unittest.TestCase):
    def run_probe(self, code=200, listing=None):
        replies = [
            (200, {"permissions": ["storage.objects.get", "storage.objects.list"]}),
            (403, {}), (403, {}), (code, listing or {}),
        ]
        if code == 200 and (listing or {}).get("items"):
            replies.append((200, {}))
        replies.append((401, {}))
        output = StringIO()
        with mock.patch.object(probe.subprocess, "run", return_value=mock.Mock(stdout="synthetic-token")):
            with mock.patch.object(probe, "_get", side_effect=replies) as get:
                with redirect_stdout(output):
                    self.assertEqual(probe.main(), 0)
        return json.loads(output.getvalue()), output.getvalue(), get.call_args_list

    def test_object_metadata_probe_keeps_private_names_out_of_summary(self):
        name = "digest-candidates/ibkr/2026-10-12/private-target-account.json"
        result, output, calls = self.run_probe(listing={
            "items": [{"name": name, "size": "123", "updated": "2026-10-12T21:00:00Z"}],
            "nextPageToken": "private-page-token",
        })
        self.assertNotIn(name, output)
        self.assertNotIn("private-target-account", output)
        self.assertNotIn("private-page-token", output)
        self.assertNotIn("prefix_objects", result)
        self.assertNotIn("prefix", result)
        self.assertTrue(result["prefix_configured"])
        self.assertEqual(result["prefix_objects_count"], 1)
        self.assertFalse(result["prefix_listing_complete"])
        self.assertEqual(result["object_metadata_get_http"], 200)
        self.assertIn("private-target-account.json", calls[-2].args[0])
        self.assertNotIn("alt=media", calls[-2].args[0])

    def test_empty_and_failed_list_are_distinct(self):
        empty, _, _ = self.run_probe()
        self.assertFalse(empty["prefix_has_objects"])
        self.assertEqual(empty["prefix_objects_count"], 0)
        self.assertTrue(empty["prefix_listing_complete"])
        failed, _, _ = self.run_probe(code=403)
        self.assertIsNone(failed["prefix_has_objects"])
        self.assertIsNone(failed["prefix_objects_count"])
        self.assertIsNone(failed["prefix_listing_complete"])


if __name__ == "__main__":
    unittest.main()
