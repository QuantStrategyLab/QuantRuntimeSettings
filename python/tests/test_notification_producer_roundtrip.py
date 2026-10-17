"""Execute pinned real producer code through QRS's file export and receiver."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

import daily_digest_aggregator as aggregator
import merge_digest_candidates as intake
import notification_candidate_adapter as receiver
from test_daily_digest_ux import config
from producer_snapshot.firstrade import unified as producer
from producer_snapshot.firstrade.digest_snapshot.digest_candidates import cycle_evidence

SNAPSHOT = Path(__file__).with_name("producer_snapshot") / "firstrade"
NOW = datetime(2026, 10, 17, 0, tzinfo=timezone.utc)
DAY = "2026-10-16"
TARGET = dict(platform_id="firstrade", strategy_profile="synthetic", service_name="synthetic-service",
              account_scope="synthetic-scope", account_selector=["synthetic-selector"],
              deployment_selector="synthetic-slot", dry_run_only=False)
EXPECTED = dict(platform_id="firstrade", opaque_account_uid="opaque-synthetic", target_id="target-synthetic",
                strategy_profile="synthetic")
ENV = {producer.FLAG: "true", "QRS_UNIFIED_NOTIFICATION_ENABLED": "true", "RUNTIME_TARGET_ENABLED": "true",
       "RUNTIME_TARGET_JSON": json.dumps(TARGET), "DIGEST_STORE_TARGET": "synthetic",
       "DIGEST_OPAQUE_ACCOUNT_UID": EXPECTED["opaque_account_uid"], "DIGEST_TARGET_ID": EXPECTED["target_id"],
       "DIGEST_CANDIDATES_GCS_URI": "gs://synthetic/candidates", "EXECUTION_REPORT_GCS_URI": "gs://synthetic/reports"}


class Store:
    def __init__(self):
        self.data = {}

    def read(self, key):
        return deepcopy(self.data.get(key, (None, None)))

    def compare_and_set(self, key, version, value):
        current = self.data.get(key, (None, None))[0]
        if current != version:
            return False
        self.data[key] = ((current or 0) + 1, deepcopy(value))
        return True


class ProducerRoundtripTests(unittest.TestCase):
    def produce(self, observations):
        """Only report inputs and storage/sender boundaries are synthetic."""
        store, sends = Store(), []
        for run_id, orders in observations:
            result = dict(ok=True, execution_status="completed" if orders else "no_action",
                          submitted_orders=orders, orders_pending_count=0, dry_run_only=False)
            report = dict(schema_version="runtime_report.v1", runtime_target=deepcopy(TARGET),
                          platform="firstrade", strategy_profile="synthetic", service_name="synthetic-service",
                          run_id=run_id, started_at=(NOW - timedelta(hours=4)).isoformat(),
                          finished_at=(NOW - timedelta(hours=3)).isoformat(), status="ok", dry_run=False,
                          summary={"notification_digest": cycle_evidence(result, orders)})
            def send():
                sends.append(run_id)
                return True  # Transport ACK only, deliberately not a delivery receipt.
            producer.notify_cycle(report, result, settings=None, send=send, env=ENV, now=NOW, store=store)
        exported = next(value for _, value in store.data.values()
                        if value.get("schema_version") == "qsl.digest_candidates.v1")
        return exported, sends

    def roundtrip(self, exported):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"QRS_UNIFIED_NOTIFICATION_ENABLED": "true"}, clear=True):
            root = Path(directory)
            inputs = root / "producer"
            inputs.mkdir()
            (inputs / "candidate.json").write_text(json.dumps(exported))
            output = root / "merged.json"
            with redirect_stdout(io.StringIO()):
                self.assertEqual(intake.main(["--input-dir", str(inputs), "--output", str(output)]), 0)
            # Consume QRS's real exported file; never construct a receiver fixture.
            merged = json.loads(output.read_text())
            rows = intake._rows(merged)
            current, stale = receiver.partition(rows, DAY)
            self.assertEqual(stale, [])
            receiver.validate_expected([EXPECTED])
            runs, summary = receiver.aggregate(current, [EXPECTED])
            with patch.object(aggregator, "load_platform_config", return_value=config([EXPECTED])):
                payload, text, collected = aggregator.build_digest_payload(
                    business_day=DAY, candidates_path=output, include_github=False)
                receipt = aggregator.build_receipt(payload, collected, message_chars=len(text))
        return runs, summary, text, receipt

    def test_real_producer_two_healthy_runs_and_duplicate_through_qrs_export(self):
        exported, sends = self.produce([("run-a", []), ("run-b", []), ("run-a", [])])
        self.assertEqual(sends, [])
        self.assertEqual(len(exported["runs"]), 2)
        for row in exported["runs"]:
            self.assertTrue(row["source_run_id"])
            self.assertEqual((row["order_count"], row["fill_count"], row["cycle_count"]), (0, 0, 1))
            self.assertEqual({event["source_run_id"] for event in row["notification_events"]}, {row["source_run_id"]})
        runs, summary, text, receipt = self.roundtrip(exported)
        self.assertEqual(len(runs), 2)
        self.assertEqual(summary["source_inventory"]["firstrade"], dict(expected_targets=1, covered_targets=1, runs=2))
        self.assertFalse(summary["counts_unknown"])
        self.assertEqual(summary["event_count"], 2)
        self.assertEqual(receipt["run_count"], 2)
        self.assertEqual(receipt["total_fills"], 0)
        self.assertNotIn("全窗口统计未知", text)

    def test_real_zero_order_run_is_known_and_real_order_stays_immediate(self):
        zero, sends = self.produce([("zero-run", [])])
        _, summary, text, receipt = self.roundtrip(zero)
        self.assertEqual(sends, [])
        self.assertFalse(summary["counts_unknown"])
        self.assertEqual(receipt["total_fills"], 0)
        self.assertIn("本轮 0 单", text)
        self.assertNotIn("全窗口统计未知", text)
        orders = [{"status": "filled", "broker_order_id": "synthetic-order"}]
        real, sends = self.produce([("order-run", orders), ("order-run", orders)])
        runs, summary, text, receipt = self.roundtrip(real)
        self.assertEqual(sends, ["order-run"])
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["order_count"], 1)
        self.assertEqual(summary["event_count"], 1)
        self.assertEqual(summary["immediate_events"], 1)
        self.assertIn("订单：1", text)
        # Producer has no fill-count source; a filled order ACK is not a count.
        self.assertIsNone(receipt["total_fills"])

    def test_real_producer_source_bytes_match_recorded_revision(self):
        manifest = json.loads((SNAPSHOT / "source.json").read_text())
        self.assertRegex(manifest["commit"], r"^[0-9a-f]{40}$")
        for relative, expected in manifest["files"].items():
            self.assertEqual(hashlib.sha256((SNAPSHOT / relative).read_bytes()).hexdigest(), expected)
