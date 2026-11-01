"""Synthetic regression tests; no broker, cloud or notification calls."""
from datetime import datetime, timezone
from pathlib import Path
import json
import tempfile
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import snapshot_completeness as guard

NOW = datetime(2026, 11, 1, 12, tzinfo=timezone.utc)


def target(platform="longbridge"):
    return {"platform": platform, "status": "active", "identity": {"account": "synthetic", "schema": "broker.v1"},
            "as_of_path": "observed_at", "archive": {"prefix": "gs://synthetic/archive/{date}/"},
            "calendar": {"kind": "continuous", "timezone": "UTC", "grace_seconds": 0},
            "fields": {name: {"path": name, "complete_path": "coverage."+name, "complete_value": "complete",
                              "required": ["asset", "quantity"], "numeric": ["quantity"],
                              "empty_proof": {"query_ok": "proof."+name+".query_ok",
                                              "row_count": "proof."+name+".row_count",
                                              "pagination_complete": "proof."+name+".pagination_complete"}}
                       for name in guard.FIELDS}}


def record(day):
    return {"account": "synthetic", "schema": "broker.v1", "observed_at": day+"T22:00:00Z",
            "coverage": {name: "complete" for name in guard.FIELDS},
            **{name: [{"asset": "SYNTH", "quantity": "1.5"}] for name in guard.FIELDS}}


class IO:
    def __init__(self, records=None, historical=None):
        self.records, self.historical = records or {}, historical
        self.writes, self.reads, self.history_calls = [], [], []

    def read_day(self, target, day):
        self.reads.append(day)
        return self.records.get(day, [])

    def history(self, target, day):
        self.history_calls.append(day)
        return self.historical

    def persist(self, target, day, payload):
        self.writes.append(payload)
        self.records[day] = [payload]


class CoverageTests(unittest.TestCase):
    def test_trailing_leading_and_no_samples(self):
        io = IO({"2026-10-03": [record("2026-10-03")]})
        result = guard.audit_target(target(), "2026-10-02", "2026-10-05", NOW, io)
        self.assertEqual([d["date"] for d in result["days"] if d["issues"]],
                         ["2026-10-02", "2026-10-04", "2026-10-05"])
        self.assertEqual(guard.audit_target(target(), "2026-10-02", "2026-10-05", NOW, IO())["expected_count"], 4)

    def test_longbridge_audit_gaps(self):
        for gaps in (["2026-10-20"], [f"2026-10-{d:02}" for d in range(2, 9)]+["2026-10-20"]):
            io = IO({f"2026-10-{d:02}": [record(f"2026-10-{d:02}")] for d in range(2, 32)
                     if f"2026-10-{d:02}" not in gaps})
            result = guard.audit_target(target(), "2026-10-02", "2026-10-31", NOW, io)
            self.assertEqual([d["date"] for d in result["days"] if d["issues"]], gaps)

    def test_sessions_holiday_weekend_and_deadline(self):
        calendar = {"kind": "sessions", "id": "synthetic-exchange", "source": "synthetic-exchange-calendar",
                    "timezone": "Asia/Hong_Kong", "start": "2026-10-01", "end": "2026-10-31",
                    "grace_seconds": 3600, "sessions": [
                        {"date": "2026-10-02", "close_at": "2026-10-02T16:00:00+08:00"},
                        {"date": "2026-10-05", "close_at": "2026-10-05T16:00:00+08:00"}]}
        expected = guard.expected_dates(calendar, "2026-10-01", "2026-10-05", guard.instant("2026-10-05T08:59:59Z"))
        self.assertEqual(list(expected), ["2026-10-02"])
        self.assertEqual(list(guard.expected_dates(calendar, "2026-10-01", "2026-10-05", NOW)),
                         ["2026-10-02", "2026-10-05"])
        with self.assertRaises(guard.AuditError):
            guard.expected_dates(calendar, "2026-09-30", "2026-10-05", NOW)

    def test_dst_and_early_close_use_published_instants(self):
        calendar = {"kind": "sessions", "id": "synthetic-us", "source": "synthetic", "timezone": "America/New_York",
                    "start": "2026-10-30", "end": "2026-11-27", "grace_seconds": 0,
                    "sessions": [{"date": "2026-10-30", "close_at": "2026-10-30T20:00:00Z"},
                                 {"date": "2026-11-02", "close_at": "2026-11-02T21:00:00Z"},
                                 {"date": "2026-11-27", "close_at": "2026-11-27T18:00:00Z"}]}
        self.assertEqual(len(guard.expected_dates(calendar, "2026-10-30", "2026-11-27",
                                                  guard.instant("2026-11-27T18:00:00Z"))), 3)

    def test_crypto_does_not_use_stock_weekends_or_today(self):
        result = guard.expected_dates(target()["calendar"], "2026-10-30", "2026-11-01", NOW)
        self.assertEqual(list(result), ["2026-10-30", "2026-10-31"])

    def test_empty_positions_needs_real_zero_proof(self):
        payload = record("2026-10-20")
        payload["positions"] = []
        self.assertIn("positions_empty_unverified", guard.field_issues(payload, target()["fields"]))
        payload["proof"] = {"positions": {"query_ok": True, "row_count": 0, "pagination_complete": True}}
        self.assertEqual(guard.field_issues(payload, target()["fields"]), [])
        payload["proof"]["positions"]["row_count"] = False
        self.assertIn("positions_empty_unverified", guard.field_issues(payload, target()["fields"]))

    def test_missing_fields_null_nan_and_legitimate_zero(self):
        for name in guard.FIELDS:
            for value in (None, "NaN", "Infinity", True):
                payload = record("2026-10-20")
                payload[name][0]["quantity"] = value
                self.assertIn(name+"_row_invalid", guard.field_issues(payload, target()["fields"]))
        payload = record("2026-10-20")
        payload["cash"][0]["quantity"] = "0"
        self.assertEqual(guard.field_issues(payload, target()["fields"]), [])
        del payload["orders"]
        self.assertIn("orders_incomplete", guard.field_issues(payload, target()["fields"]))

    def test_identity_failure_stops_target(self):
        payload = record("2026-10-20")
        payload["account"] = "other-synthetic"
        io = IO({"2026-10-20": [payload]})
        result = guard.audit_target(target(), "2026-10-20", "2026-10-22", NOW, io, True)
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(io.reads, ["2026-10-20"])
        self.assertEqual(io.history_calls, [])

    def test_permission_failure_is_not_a_gap_and_stops(self):
        io = IO()
        io.read_day = lambda *_: (_ for _ in ()).throw(guard.AuditError("access_denied"))
        result = guard.audit_target(target(), "2026-10-20", "2026-10-22", NOW, io, True)
        self.assertEqual(result["days"][0]["issues"], ["access_denied"])
        self.assertEqual(len(result["days"]), 1)

    def test_old_good_sample_cannot_hide_new_incomplete_sample(self):
        old, latest = record("2026-10-20"), record("2026-10-20")
        latest["observed_at"] = "2026-10-20T23:00:00Z"
        latest["positions"] = []
        result = guard.audit_target(target(), "2026-10-20", "2026-10-20", NOW,
                                    IO({"2026-10-20": [old, latest]}))
        self.assertEqual(result["status"], "incomplete")

    def test_backfill_requires_real_matching_date_and_readback(self):
        configured = target()
        configured["history"] = {"kind": "broker_readable_history"}
        for source in (None, record("2026-10-21")):
            io = IO(historical=source)
            result = guard.audit_target(configured, "2026-10-20", "2026-10-20", NOW, io, True)
            self.assertEqual(result["status"], "incomplete")
            self.assertEqual(io.writes, [])
        io = IO(historical=record("2026-10-20"))
        result = guard.audit_target(configured, "2026-10-20", "2026-10-20", NOW, io, True)
        self.assertEqual(result["days"][0]["backfill"], "verified")
        self.assertEqual(len(io.reads), 2)
        io = IO(historical=record("2026-10-20"))
        io.persist = lambda *_: None
        result = guard.audit_target(configured, "2026-10-20", "2026-10-20", NOW, io, True)
        self.assertEqual(result["days"][0]["issues"], ["archive_readback_failed"])

    def test_every_platform_and_unconfigured_account_are_explicit(self):
        configured = [target(platform) for platform in sorted(guard.PLATFORMS)]
        result = guard.run({"targets": configured, "start": "2026-10-20", "end": "2026-10-20"}, IO(), NOW)
        self.assertEqual(len(result["targets"]), len(guard.PLATFORMS))
        self.assertTrue(all(t["status"] == "incomplete" for t in result["targets"]))
        configured[0]["status"] = "unverified"
        result = guard.run({"targets": configured, "start": "2026-10-20", "end": "2026-10-20"}, IO(), NOW)
        self.assertEqual(result["targets"][0]["status"], "not_configured")

    def test_real_runner_refuses_mac(self):
        with patch.dict(guard.os.environ, {}, clear=True), patch("builtins.print") as output:
            self.assertEqual(guard.main(), 1)
        self.assertNotIn("token", str(output.call_args))

    def test_generation_precondition_and_redacted_transport_errors(self):
        io = object.__new__(guard.CloudIO)
        io.token = "synthetic-secret"
        with patch.object(guard, "request_json", return_value={}) as request:
            self.assertTrue(io.create("gs://synthetic/new.json", {}))
            self.assertIn("ifGenerationMatch=0", request.call_args.args[0])
        with patch.object(guard, "build_opener", side_effect=RuntimeError("synthetic-secret")):
            with self.assertRaisesRegex(guard.AuditError, "^source_read_failed$"):
                guard.request_json("https://synthetic.invalid")

    def test_cloud_window_keeps_thirty_completed_dates(self):
        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return NOW
        config = {"window_days": 30, "state_prefix": "gs://synthetic/state", "targets": []}
        class Store:
            def __init__(self, env):
                self.saved = None
            def create(self, uri, value):
                self.saved = value
                return True
            def get(self, uri):
                return self.saved
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(config))
            with patch.dict(guard.os.environ, {"CLOUD_RUN_JOB": "synthetic", "SNAPSHOT_COMPLETENESS_CONFIG": str(path)}, clear=True), \
                    patch.object(guard, "CloudIO", Store), patch.object(guard, "datetime", Clock), \
                    patch.object(guard, "run", return_value={"status": "complete", "targets": []}) as audit, \
                    patch("builtins.print"):
                self.assertEqual(guard.main(), 0)
            self.assertEqual(audit.call_args.args[0]["start"], "2026-10-02")
            self.assertEqual(audit.call_args.args[0]["end"], "2026-10-31")

    def test_cloud_failure_alert_contains_no_exception_or_account(self):
        with patch.dict(guard.os.environ, {"CLOUD_RUN_JOB": "synthetic"}, clear=True), \
                patch.object(guard, "send_notification") as send, patch("builtins.print") as output:
            self.assertEqual(guard.main(), 1)
        self.assertEqual(send.call_count, 1)
        self.assertEqual(output.call_args.args[0], '{"status": "unknown", "reason": "snapshot_guard_failed"}')

    def test_uncertain_telegram_send_is_not_retried(self):
        io = object.__new__(guard.CloudIO)
        io.env = {"TELEGRAM_TOKEN": "synthetic", "GLOBAL_TELEGRAM_CHAT_ID": "synthetic"}
        io.get = lambda _: None
        io.create = lambda *_: False
        with patch.object(guard, "request_json") as request:
            self.assertEqual(io.alert("gs://synthetic/state", {"targets": []}, NOW), "delivery_unknown")
            request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
