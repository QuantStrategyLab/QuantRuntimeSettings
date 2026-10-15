"""Read-only Actions receipt guard. No delivery, credentials lookup, or state writes."""
from __future__ import annotations

import io
import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import zipfile
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Mapping
from pathlib import Path
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Decision:
    decision: str
    reason: str
    test_message: bool = False
    previous_failures: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def log(self, day: str, event: str) -> str:
        return (f"digest_resend_guard decision={self.decision} reason={self.reason} "
                f"business_day={day} event={event} test={str(self.test_message).lower()}")


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is not None and urllib.parse.urlsplit(req.full_url).netloc != urllib.parse.urlsplit(newurl).netloc:
            redirected.remove_header("Authorization")
        return redirected


def api_get(url: str, token: str, *, binary: bool = False) -> Any:
    request = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.build_opener(_SafeRedirect()).open(request, timeout=20) as response:
        data = response.read(1_048_577)
    if len(data) > 1_048_576:
        raise ValueError("guard_response_too_large")
    return data if binary else json.loads(data)


def _pages(url: str, token: str, key: str, max_pages: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        payload = api_get(f"{url}{'&' if '?' in url else '?'}per_page=100&page={page}", token)
        total = payload.get("total_count")
        batch = payload.get(key)
        if (type(total) is not int or total < 0 or total > max_pages * 100
                or not isinstance(batch, list) or not all(isinstance(x, dict) for x in batch)):
            raise ValueError("guard_history_incomplete")
        items.extend(batch)
        if len(items) == total:
            return items
        if not batch or len(batch) < 100 or len(items) > total:
            raise ValueError("guard_history_incomplete")
    raise ValueError("guard_history_incomplete")


def _read_marker(data: bytes) -> dict[str, Any]:
    # Never extract files, follow archive paths, or read private receipts.
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) != 1 or entries[0].filename != "receipt-public.json" or entries[0].file_size > 65536:
            raise ValueError("guard_marker_invalid")
        receipt = json.loads(archive.read(entries[0]))
    if (not isinstance(receipt, dict) or type(receipt.get("delivered")) is not bool
            or type(receipt.get("dry_run")) is not bool or not isinstance(receipt.get("status"), str)):
        raise ValueError("guard_marker_invalid")
    if receipt.get("business_day") is not None:
        date.fromisoformat(receipt["business_day"])
    elif receipt.get("delivered") is True or receipt.get("status") == "send_failed":
        raise ValueError("guard_marker_business_day_missing")
    if "test_message" in receipt and type(receipt["test_message"]) is not bool:
        raise ValueError("guard_marker_invalid")
    return receipt


def read_history(business_day: str, env: Mapping[str, str]) -> list[tuple[int, dict[str, Any]]]:
    repo = env.get("GITHUB_REPOSITORY", "")
    api = env.get("GITHUB_API_URL", "").rstrip("/")
    token = env.get("DIGEST_GUARD_TOKEN") or env.get("GITHUB_TOKEN", "")
    workflow = env.get("DIGEST_GUARD_WORKFLOW") or env.get("GITHUB_WORKFLOW_REF", "").split("@", 1)[0].rsplit("/", 1)[-1]
    current = int(env["GITHUB_RUN_ID"])
    attempt = int(env.get("GITHUB_RUN_ATTEMPT", "1"))
    max_pages = int(env.get("DIGEST_GUARD_MAX_PAGES", "10"))
    lookback = int(env.get("DIGEST_GUARD_LOOKBACK_DAYS", "7"))
    if (not re.fullmatch(r"[\w.-]+/[\w.-]+", repo) or not api.startswith("https://")
            or not token or not workflow or not 1 <= max_pages <= 100 or not 1 <= lookback <= 90):
        raise ValueError("guard_configuration_invalid")
    day = date.fromisoformat(business_day)
    # Reject future dates: a send cannot predate the date covered by this scan.
    if day > datetime.now(timezone.utc).astimezone(ZoneInfo("America/New_York")).date():
        raise ValueError("guard_future_business_day")
    start = day - timedelta(days=lookback)
    root = f"{api}/repos/{repo}/actions"
    query = urllib.parse.urlencode({"created": f">={start.isoformat()}"})
    runs = _pages(f"{root}/workflows/{urllib.parse.quote(workflow, safe='')}/runs?{query}", token, "workflow_runs", max_pages)
    history = []
    seen = set()
    for run in runs:
        run_id = int(run["id"])
        if run_id in seen or (run_id == current and attempt == 1):
            continue
        if not isinstance(run.get("event"), str):
            raise ValueError("guard_run_invalid")
        if run["event"] not in {"schedule", "workflow_dispatch"}:
            continue
        seen.add(run_id)
        if run.get("status") == "queued":
            continue
        if run.get("status") != "completed" and run_id != current:
            raise ValueError("guard_prior_run_in_progress")
        artifacts = _pages(f"{root}/runs/{run_id}/artifacts", token, "artifacts", max_pages)
        markers = [a for a in artifacts if a.get("name") == env.get("DIGEST_GUARD_ARTIFACT", "daily-digest-receipt")]
        if not markers:
            stamp = datetime.fromisoformat(run["created_at"].replace("Z", "+00:00"))
            if stamp.astimezone(ZoneInfo("America/New_York")).date() < day:
                continue
            # Maintenance-only or failed-before-send jobs cannot have delivered.
            jobs = _pages(f"{root}/runs/{run_id}/jobs", token, "jobs", max_pages)
            if not jobs:
                raise ValueError("guard_job_history_missing")
            send_step = env.get("DIGEST_GUARD_SEND_STEP", "Aggregate, render, and send daily digest")
            if any(step.get("name") == send_step and step.get("conclusion") != "skipped"
                   for job in jobs for step in job.get("steps", [])):
                raise ValueError("guard_send_receipt_missing")
            continue
        for marker in markers:
            if marker.get("expired") is not False:
                raise ValueError("guard_send_receipt_expired")
            receipt = _read_marker(api_get(f"{root}/artifacts/{int(marker['id'])}/zip", token, binary=True))
            history.append((run_id, receipt))
    return history


def evaluate(business_day: str, env: Mapping[str, str], *, dry_run: bool = False) -> Decision:
    if dry_run:
        return Decision("preview", "DRY_RUN")
    event = env.get("GITHUB_EVENT_NAME", "local")
    enabled = env.get("DIGEST_RESEND_GUARD", "true" if env.get("GITHUB_ACTIONS") == "true" else "false")
    force = env.get("DIGEST_FORCE_RESEND", "false")
    if enabled not in {"true", "false"} or force not in {"true", "false"}:
        return Decision("blocked", "CONFIGURATION_INVALID")
    if enabled == "false":
        return Decision("send", "LOCAL_EXECUTION")
    if event not in {"schedule", "workflow_dispatch"}:
        return Decision("blocked", "UNSUPPORTED_EVENT")
    if event == "workflow_dispatch" and force == "true":
        return Decision("send", "EXPLICIT_TEST_RESEND", test_message=True)
    try:
        history = read_history(business_day, env)
        deliveries = [run for run, receipt in history if receipt.get("delivered") is True
                      and receipt.get("dry_run") is False and receipt.get("status") == "delivered"
                      and receipt.get("test_message", False) is False]
        failures = [run for run, receipt in history if receipt.get("status") == "blocked_resend_guard"]
        previous_failures = sum(run > max(deliveries, default=0) for run in failures)
        same_day = [receipt for _, receipt in history if receipt.get("business_day") == business_day
                    and receipt.get("dry_run") is False and not receipt.get("test_message", False)]
        if any(receipt.get("delivered") is True and receipt.get("status") == "delivered" for receipt in same_day):
            return Decision("skip", "ALREADY_DELIVERED", previous_failures=previous_failures)
        if any(receipt.get("status") == "send_failed" for receipt in same_day):
            return Decision("blocked", "DELIVERY_UNCERTAIN", previous_failures=previous_failures)
        return Decision("send", "FIRST_SEND", previous_failures=previous_failures)
    except Exception:
        # Never echo HTTP errors, URLs, tokens, or artifact contents.
        return Decision("blocked", "HISTORY_UNAVAILABLE")


def skip_receipt(day: str, locale: str, decision: Decision) -> dict[str, Any]:
    return {
        "schema_version": "qsl.daily_digest_delivery_receipt.v1", "business_day": day,
        "locale": "en" if locale.lower().startswith("en") else "zh", "dry_run": False, "delivered": False,
        "status": "skipped_duplicate" if decision.decision == "skip" else "blocked_resend_guard",
        "resend_guard": decision.to_dict(), "test_message": False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-receipt", type=Path, required=True)
    args = parser.parse_args(argv)
    day = os.environ.get("DIGEST_BUSINESS_DAY") or datetime.now(timezone.utc).astimezone(ZoneInfo("America/New_York")).date().isoformat()
    date.fromisoformat(day)
    decision = evaluate(day, os.environ, dry_run=os.environ.get("DIGEST_DRY_RUN") == "true")
    print(decision.log(day, os.environ.get("GITHUB_EVENT_NAME", "local")))
    if decision.decision in {"skip", "blocked"}:
        args.write_receipt.parent.mkdir(parents=True, exist_ok=True)
        locale = os.environ.get("DIGEST_LOCALE") or os.environ.get("QSL_NOTIFY_LANG") or os.environ.get("NOTIFY_LANG", "zh")
        args.write_receipt.write_text(json.dumps(skip_receipt(day, locale, decision)) + "\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write(f"proceed={str(decision.decision in {'send', 'preview'}).lower()}\n")
    if decision.decision == "blocked":
        print(f"::error::Daily digest not sent: resend guard {decision.reason}.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
