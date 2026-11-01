"""Cloud-only archive audit. Configuration and source payloads stay private."""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zoneinfo import ZoneInfo

UTC = timezone.utc
PLATFORMS = {"longbridge", "firstrade", "schwab", "ibkr", "binance", "alpaca", "qmt", "ftmo"}
FIELDS = {"cash", "positions", "orders", "fills"}


class AuditError(Exception):
    """Only fixed reason codes may leave this module."""


def instant(value):
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise AuditError("timestamp_invalid")
    return result


def at(payload, path):
    for key in path.split("."):
        if not isinstance(payload, dict) or key not in payload:
            return None
        payload = payload[key]
    return payload


def expected_dates(calendar, start, end, now):
    """Independent of observed samples, including no samples and trailing loss."""
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    if last < first or (last - first).days > 365:
        raise AuditError("window_invalid")
    grace = calendar.get("grace_seconds")
    if type(grace) is not int or not 0 <= grace <= 86400:
        raise AuditError("calendar_invalid")
    if calendar.get("kind") == "continuous":
        if calendar.get("timezone") != "UTC":
            raise AuditError("calendar_invalid")
        return {str(first + timedelta(days=i)): None for i in range((last-first).days+1)
                if datetime.combine(first+timedelta(days=i+1), time(), UTC)+timedelta(seconds=grace) <= now}
    if calendar.get("kind") != "sessions" or not calendar.get("source") or not calendar.get("id"):
        raise AuditError("calendar_invalid")
    zone = ZoneInfo(calendar["timezone"])
    if date.fromisoformat(calendar["start"]) > first or date.fromisoformat(calendar["end"]) < last:
        raise AuditError("calendar_coverage_missing")
    sessions, result = set(), {}
    for row in calendar["sessions"]:
        day = date.fromisoformat(row["date"])
        close = instant(row["close_at"])
        if day in sessions or close.astimezone(zone).date() != day:
            raise AuditError("calendar_invalid")
        sessions.add(day)
        if first <= day <= last and close+timedelta(seconds=grace) <= now:
            result[str(day)] = close
    return result


def field_issues(payload, rules):
    issues = []
    if set(rules) != FIELDS:
        raise AuditError("field_contract_invalid")
    for name, rule in rules.items():
        required, numeric = rule.get("required", []), rule.get("numeric", [])
        declared = rule.get("complete_value")
        if (not required or not numeric or not (declared is True
                or isinstance(declared, str) and declared in {"complete", "complete_for_scope"})):
            raise AuditError("field_contract_invalid")
        rows = at(payload, rule["path"])
        complete = at(payload, rule["complete_path"])
        if (type(complete) is not type(rule["complete_value"])
                or complete != rule["complete_value"] or not isinstance(rows, list)):
            issues.append(name+"_incomplete")
            continue
        if not rows:
            # An empty list and a 'complete' label are not evidence of zero rows.
            proof = rule.get("empty_proof", {})
            expected = {"query_ok": True, "row_count": 0, "pagination_complete": True}
            if name == "cash" or set(proof) != set(expected) or not all(
                type(at(payload, proof[key])) is type(value) and at(payload, proof[key]) == value
                for key, value in expected.items()):
                issues.append(name+"_empty_unverified")
            continue
        for row in rows:
            if any(at(row, path) is None or at(row, path) == "" for path in required):
                issues.append(name+"_row_invalid")
                break
            try:
                if any(isinstance(at(row, path), bool) or at(row, path) is None
                       or not Decimal(str(at(row, path))).is_finite() for path in numeric):
                    raise InvalidOperation
            except (InvalidOperation, ValueError):
                issues.append(name+"_row_invalid")
                break
    return issues


def validate_snapshot(payload, target, day, close):
    """Never infer identity/date/completeness from a filename or HTTP 200."""
    identity = target["identity"]
    if not identity or not all(type(at(payload, key)) is type(value) and at(payload, key) == value
                               for key, value in identity.items()):
        return ["identity_mismatch"]
    try:
        observed = instant(at(payload, target["as_of_path"]))
        zone = ZoneInfo(target["calendar"]["timezone"])
        if str(observed.astimezone(zone).date()) != day or (close and observed < close):
            return ["observation_date_mismatch"]
    except (ValueError, TypeError, AttributeError):
        return ["observation_time_invalid"]
    return field_issues(payload, target["fields"])


def day_prefix(template, day):
    d = date.fromisoformat(day)
    return template.format(date=day, yyyy=f"{d.year:04}", mm=f"{d.month:02}", dd=f"{d.day:02}")


def audit_target(target, start, end, now, io, backfill=False):
    platform = target["platform"]
    if platform not in PLATFORMS:
        raise AuditError("platform_invalid")
    if target.get("status") != "active":
        return {"platform": platform, "status": "not_configured", "days": []}
    expected = expected_dates(target["calendar"], start, end, now)
    days = []
    for day, close in expected.items():
        item = {"date": day, "issues": [], "backfill": "not_needed"}
        try:
            records = io.read_day(target, day)
            if not records:
                item["issues"] = ["archive_missing"]
            else:
                # Do not hide a bad latest observation behind a good old one.
                try:
                    latest = max(records, key=lambda p: instant(at(p, target["as_of_path"])))
                except (ValueError, TypeError, AttributeError):
                    raise AuditError("archive_invalid") from None
                item["issues"] = validate_snapshot(latest, target, day, close)
            if item["issues"]:
                item["backfill"] = "unavailable"
                # Identity/read failures are never repair triggers.
                if backfill and target.get("history") and item["issues"] == ["archive_missing"]:
                    candidate = io.history(target, day)
                    if candidate is not None:
                        problems = validate_snapshot(candidate, target, day, close)
                        if problems:
                            item["backfill"] = "source_incomplete"
                        else:
                            io.persist(target, day, candidate)
                            readback = io.read_day(target, day)
                            encoded = json.dumps(candidate, sort_keys=True)
                            if not any(json.dumps(row, sort_keys=True) == encoded for row in readback):
                                raise AuditError("archive_readback_failed")
                            latest = max(readback, key=lambda p: instant(at(p, target["as_of_path"])))
                            item["issues"] = validate_snapshot(latest, target, day, close)
                            item["backfill"] = "verified" if not item["issues"] else "readback_incomplete"
        except AuditError as exc:
            item["issues"], item["backfill"] = [str(exc)], "stopped"
        days.append(item)
        if set(item["issues"]) & {"access_denied", "identity_mismatch", "source_restricted", "source_read_failed",
                                  "archive_listing_truncated", "archive_readback_failed", "archive_write_conflict"}:
            # Stop the affected source; do not retry permission or identity failures per day.
            return {"platform": platform, "status": "unknown", "expected_count": len(expected),
                    "reason": "source_stopped", "days": days}
    return {"platform": platform, "status": "incomplete" if any(x["issues"] for x in days) else "complete",
            "expected_count": len(expected), "days": days}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_json(url, *, headers=None, data=None, method="GET", missing=False, conflict=False):
    try:
        request = Request(url, headers=headers or {}, data=data, method=method)
        with build_opener(NoRedirect()).open(request, timeout=30) as response:
            raw = response.read(4*1024*1024+1)
        if len(raw) > 4*1024*1024:
            raise AuditError("response_too_large")
        return json.loads(raw)
    except HTTPError as exc:
        if exc.code == 404 and missing:
            return None
        if exc.code == 412 and conflict:
            return False
        if exc.code == 451:
            raise AuditError("source_restricted") from None
        raise AuditError("access_denied" if exc.code in (401, 403) else "source_read_failed") from None
    except AuditError:
        raise
    except Exception:
        raise AuditError("source_read_failed") from None


class CloudIO:
    def __init__(self, env):
        self.env = env
        self.token = request_json(
            "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
            headers={"Metadata-Flavor": "Google"})["access_token"]

    def gcs(self, uri):
        parsed = urlsplit(uri)
        if parsed.scheme != "gs" or not parsed.netloc or parsed.query or parsed.fragment:
            raise AuditError("archive_configuration_invalid")
        return parsed.netloc, parsed.path.lstrip("/")

    def get(self, uri):
        bucket, key = self.gcs(uri)
        return request_json(f"https://storage.googleapis.com/storage/v1/b/{quote(bucket, safe='')}/o/{quote(key, safe='')}?alt=media",
                            headers={"Authorization": "Bearer "+self.token}, missing=True)

    def create(self, uri, payload):
        bucket, key = self.gcs(uri)
        query = urlencode({"uploadType": "media", "name": key, "ifGenerationMatch": "0"})
        result = request_json(f"https://storage.googleapis.com/upload/storage/v1/b/{quote(bucket, safe='')}/o?{query}",
                              headers={"Authorization": "Bearer "+self.token, "Content-Type": "application/json"},
                              data=json.dumps(payload, sort_keys=True).encode(), method="POST", conflict=True)
        return result is not False

    def read_day(self, target, day):
        if target["archive"].get("kind") == "binance_detail":
            result = self.read_endpoint(target["archive"], day)
            return [] if result is None else [result["report"]]
        bucket, prefix = self.gcs(day_prefix(target["archive"]["prefix"], day))
        if not prefix.endswith("/"):
            raise AuditError("archive_configuration_invalid")
        records, page = [], None
        for _ in range(10):
            query = {"prefix": prefix, "maxResults": 100}
            if page:
                query["pageToken"] = page
            listing = request_json(f"https://storage.googleapis.com/storage/v1/b/{quote(bucket, safe='')}/o?{urlencode(query)}",
                                   headers={"Authorization": "Bearer "+self.token})
            for obj in listing.get("items", []):
                if not obj["name"].endswith(".json"):
                    continue
                # Pin the listed generation; a concurrent overwrite is not a valid readback.
                query = urlencode({"alt": "media", "generation": obj["generation"]})
                record = request_json(f"https://storage.googleapis.com/storage/v1/b/{quote(bucket, safe='')}/o/{quote(obj['name'], safe='')}?{query}",
                                      headers={"Authorization": "Bearer "+self.token})
                records.append(at(record, target["payload_path"]) if target.get("payload_path") else record)
            page = listing.get("nextPageToken")
            if not page:
                return records
        raise AuditError("archive_listing_truncated")

    def read_endpoint(self, config, day):
        parsed = urlsplit(config["url"])
        if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.query or parsed.fragment
                or not parsed.path.endswith(("/history", "/archive"))):
            raise AuditError("history_configuration_invalid")
        token = self.env.get(config["token_env"])
        if not token:
            raise AuditError("history_credentials_unavailable")
        return request_json(config["url"]+"?"+urlencode({"date": day}),
                            headers={"Authorization": "Bearer "+token}, missing=True)

    def history(self, target, day):
        if target["history"].get("kind") != "broker_readable_history":
            raise AuditError("history_configuration_invalid")
        result = self.read_endpoint(target["history"], day)
        return None if result is None else at(result, target["history"]["payload_path"])

    def persist(self, target, day, payload):
        # Canonical archive is append-only; failed/conflicting writes are never overwritten.
        if target.get("payload_path"):
            raise AuditError("backfill_envelope_adapter_required")
        uri = day_prefix(target["archive"]["prefix"], day)+"broker-history-backfill.json"
        if not self.create(uri, payload) and self.get(uri) != payload:
            raise AuditError("archive_write_conflict")

    def alert(self, prefix, report, now):
        content = json.dumps(report, sort_keys=True, separators=(",", ":"))
        key = hashlib.sha256(content.encode()).hexdigest()
        root = prefix.rstrip("/")+f"/alerts/{now.date()}/{key}"
        if self.get(root+".ack.json"):
            return "sender_acknowledged"
        if not self.env.get("TELEGRAM_TOKEN") or not self.env.get("GLOBAL_TELEGRAM_CHAT_ID"):
            raise AuditError("notification_configuration_missing")
        # Claim before send: an uncertain send is never blindly repeated.
        if not self.create(root+".claim.json", {"at": now.isoformat()}):
            return "delivery_unknown"
        text = "快照完整性检查异常\n"+"\n".join(
            f"{r['platform']} target#{i+1}: {r['status']}; "+", ".join(
                f"{d['date']}:{'/'.join(d['issues'])}" for d in r.get("days", []) if d["issues"])
            for i, r in enumerate(report["targets"]) if r["status"] != "complete")
        send_notification(self.env, text)
        self.create(root+".ack.json", {"at": now.isoformat(), "sender_ack": True, "receiver_receipt": None})
        return "sender_acknowledged"


def send_notification(env, text):
    token, chat = env.get("TELEGRAM_TOKEN"), env.get("GLOBAL_TELEGRAM_CHAT_ID")
    if not token or not chat:
        raise AuditError("notification_configuration_missing")
    import io
    from notification_transport import send_intent

    def opener(request, **_kwargs):
        value = request_json(request.full_url, method="POST",
                             headers={"Content-Type": "application/json"}, data=request.data)
        response = io.BytesIO(json.dumps(value).encode())
        response.status = 200
        return response

    if not send_intent(text[:3900], token=token, chat_id=chat, opener=opener)["ok"]:
        raise AuditError("notification_failed")


def run(config, io, now):
    targets = []
    for target in config["targets"]:
        try:
            targets.append(audit_target(target, config["start"], config["end"], now, io,
                                        backfill=config.get("backfill_enabled") is True))
        except Exception:
            platform = target.get("platform") if target.get("platform") in PLATFORMS else "unknown"
            targets.append({"platform": platform, "status": "unknown", "reason": "configuration_or_calendar_invalid", "days": []})
    for missing in sorted(PLATFORMS - {t["platform"] for t in targets}):
        targets.append({"platform": missing, "status": "not_configured", "days": []})
    report = {"schema_version": "snapshot_completeness.v1", "targets": targets,
              "status": "complete" if targets and all(t["status"] == "complete" for t in targets) else "incomplete"}
    return report


def main():
    from notification_snapshot.log_redaction import install_log_redaction
    install_log_redaction()
    cloud = bool(os.environ.get("CLOUD_RUN_JOB"))
    notification_attempted = False
    try:
        if not cloud:
            raise AuditError("cloud_run_job_required")
        config = json.loads(Path(os.environ["SNAPSHOT_COMPLETENESS_CONFIG"]).read_text())
        now = datetime.now(UTC)
        # Rolling window is anchored to the clock, never to the latest stored sample.
        window = config.get("window_days", 30)
        if type(window) is not int or not 1 <= window <= 366:
            raise AuditError("window_invalid")
        end = now.date()-timedelta(days=1)
        config["end"] = str(end)
        config["start"] = str(end-timedelta(days=window-1))
        io = CloudIO(os.environ)
        report = run(config, io, now)
        uri = config["state_prefix"].rstrip("/")+f"/reports/{now.strftime('%Y%m%dT%H%M%S%fZ')}.json"
        if not io.create(uri, report) or io.get(uri) != report:
            raise AuditError("report_readback_failed")
        notification_attempted = report["status"] != "complete"
        delivery = "not_needed" if not notification_attempted else io.alert(config["state_prefix"], report, now)
        print(json.dumps({"status": report["status"], "notification": delivery, "targets": len(report["targets"])}))
        return 0 if report["status"] == "complete" else 1
    except Exception:
        # Exception strings, account identifiers, URIs and provider bodies are private.
        if cloud and not notification_attempted:
            try:
                send_notification(os.environ, "快照完整性检查失败：配置或归档不可读；持久去重状态未知。请检查云端任务。")
            except Exception:
                pass
        print(json.dumps({"status": "unknown", "reason": "snapshot_guard_failed"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
