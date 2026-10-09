#!/usr/bin/env python3
"""Cross-platform daily digest aggregator (evidence in → render out).

Collects only platforms/strategies that actually ran from:
  1) candidates JSON file / DIGEST_CANDIDATES_JSON (preferred; producer-authored)
  2) optional GitHub Actions workflow conclusions (allowlisted; counts stay 0
     unless the candidate row supplies them — never invent fills/orders)

Does not trade, does not embed tokens, does not invent missing platforms.
Empty evidence → heartbeat body via ``daily_digest_notify.render_daily_digest``.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import daily_digest_notify as digest  # noqa: E402

DEFAULT_PLATFORM_CONFIG = ROOT / "platform-config.json"
NY_TZ = ZoneInfo("America/New_York")
SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")


def resolve_business_day(
    *,
    explicit: str | None = None,
    now: datetime | None = None,
) -> str:
    """US equity session date for post-close digest (America/New_York calendar day)."""

    if explicit and str(explicit).strip():
        value = str(explicit).strip()
        date.fromisoformat(value)
        return value
    stamp = now or datetime.now(tz=timezone.utc)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.astimezone(NY_TZ).date().isoformat()


def resolve_locale(raw: str | None = None) -> digest.DigestLocale:
    return digest.normalize_locale(
        raw
        or os.environ.get("QSL_NOTIFY_LANG")
        or os.environ.get("NOTIFY_LANG")
        or "zh"
    )


def load_platform_config(path: Path | None = None) -> dict[str, Any]:
    config_path = path or Path(
        os.environ.get("QSL_PLATFORM_CONFIG") or DEFAULT_PLATFORM_CONFIG
    )
    return json.loads(config_path.read_text(encoding="utf-8"))


def digest_contract(config: Mapping[str, Any]) -> dict[str, Any]:
    return dict(config["notifications"]["quant_sentinel"]["daily_digest"])


def window_label_for(contract: Mapping[str, Any]) -> str:
    schedule = contract.get("schedule") or {}
    tz = str(schedule.get("timezone") or "Asia/Shanghai")
    cron = str(schedule.get("cron") or "0 6 * * 2-6")
    return f"{tz} cron `{cron}`"


def _as_candidate_rows(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if isinstance(raw, Mapping):
        if "runs" in raw:
            raw = raw["runs"]
        elif "candidates" in raw:
            raw = raw["candidates"]
        else:
            raise ValueError("candidates object must contain runs or candidates")
    if not isinstance(raw, list):
        raise ValueError("candidates must be a list")
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, Mapping):
            raise ValueError("each candidate must be an object")
        out.append(dict(item))
    return out


def load_candidates_from_file(path: Path | None) -> list[dict[str, Any]]:
    if path is None:
        env_path = (os.environ.get("DIGEST_CANDIDATES_PATH") or "").strip()
        path = Path(env_path) if env_path else None
    if path is None:
        inline = (os.environ.get("DIGEST_CANDIDATES_JSON") or "").strip()
        if inline:
            return _as_candidate_rows(json.loads(inline))
        return []
    if not path.is_file():
        raise FileNotFoundError(f"candidates file not found: {path}")
    return _as_candidate_rows(json.loads(path.read_text(encoding="utf-8")))


def _gh_api_get(url: str, token: str) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "QuantRuntimeSettings-daily-digest-aggregator",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"GitHub API HTTP {exc.code} for {url}: {body}") from exc


def business_day_utc_window(business_day: str) -> tuple[datetime, datetime]:
    """Inclusive NY business-day window expressed in UTC."""

    day = date.fromisoformat(business_day)
    start_ny = datetime(day.year, day.month, day.day, 0, 0, 0, tzinfo=NY_TZ)
    end_ny = start_ny + timedelta(days=1)
    return start_ny.astimezone(timezone.utc), end_ny.astimezone(timezone.utc)


def default_workflow_allowlist(config: Mapping[str, Any]) -> list[dict[str, str]]:
    """Allowlisted workflows that may contribute *run existence* evidence only.

    Counts remain zero unless a candidates file supplies them. Heartbeat-only
    monitor workflows are intentionally omitted.
    """

    platforms = config.get("platforms") or {}
    rows: list[dict[str, str]] = []
    defaults: dict[str, tuple[str, str]] = {
        # workflow file stem/path → default strategy_profile label for digest line
        "longbridge": (
            "publish-runtime-daily-once.yml",
            "russell_top50_leader_rotation",
        ),
        "schwab": (
            "publish-runtime-daily-once.yml",
            "soxl_soxx_trend_income",
        ),
        "ibkr": (
            "publish-runtime-daily-once.yml",
            "soxl_soxx_trend_income",
        ),
        "firstrade": (
            "publish-runtime-daily-once.yml",
            "unspecified",
        ),
        "binance": (
            "publish-runtime-daily-once.yml",
            "crypto_equity_combo",
        ),
    }
    configured = (
        (config.get("notifications") or {})
        .get("quant_sentinel", {})
        .get("daily_digest", {})
        .get("aggregator", {})
        .get("github_workflow_allowlist")
    )
    if isinstance(configured, list) and configured:
        for item in configured:
            if not isinstance(item, Mapping):
                continue
            platform_id = str(item.get("platform_id") or "").strip()
            workflow = str(item.get("workflow") or "").strip()
            strategy = str(item.get("strategy_profile") or "unspecified").strip()
            repo = str(item.get("repository") or "").strip()
            if not platform_id or not workflow:
                continue
            if not repo and platform_id in platforms:
                repo = str(platforms[platform_id].get("repository") or "").strip()
            if not repo:
                continue
            rows.append(
                {
                    "platform_id": platform_id,
                    "repository": repo,
                    "workflow": workflow,
                    "strategy_profile": strategy or "unspecified",
                }
            )
        return rows

    for platform_id, (workflow, strategy) in defaults.items():
        meta = platforms.get(platform_id) or {}
        repo = str(meta.get("repository") or "").strip()
        if not repo:
            continue
        rows.append(
            {
                "platform_id": platform_id,
                "repository": repo,
                "workflow": workflow,
                "strategy_profile": strategy,
            }
        )
    return rows


def collect_from_github_workflows(
    *,
    business_day: str,
    config: Mapping[str, Any],
    token: str | None = None,
    allowlist: Sequence[Mapping[str, str]] | None = None,
) -> list[dict[str, Any]]:
    """Include a platform only when an allowlisted workflow succeeded that day.

    Never invents fill/order counts. Missing workflows or API errors skip that
    source row (fail open toward heartbeat, not toward fake runs).
    """

    gh_token = (token or os.environ.get("DIGEST_GH_TOKEN") or os.environ.get("GH_TOKEN") or "").strip()
    if not gh_token:
        return []

    start_utc, end_utc = business_day_utc_window(business_day)
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for entry in allowlist or default_workflow_allowlist(config):
        platform_id = entry["platform_id"]
        repository = entry["repository"]
        workflow = entry["workflow"]
        strategy = entry["strategy_profile"]
        owner_repo = repository.split("/", 1)
        if len(owner_repo) != 2:
            continue
        owner, repo = owner_repo
        query = urllib.parse.urlencode(
            {
                "event": "schedule,workflow_dispatch",
                "status": "completed",
                "per_page": "20",
                "created": f">={start_utc.date().isoformat()}",
            }
        )
        url = (
            f"https://api.github.com/repos/{owner}/{repo}/actions/workflows/"
            f"{urllib.parse.quote(workflow)}/runs?{query}"
        )
        try:
            payload = _gh_api_get(url, gh_token)
        except RuntimeError as exc:
            print(f"digest evidence skip {platform_id}/{workflow}: {exc}", file=sys.stderr)
            continue
        runs = payload.get("workflow_runs") if isinstance(payload, Mapping) else None
        if not isinstance(runs, list):
            continue
        matched = False
        for run in runs:
            if not isinstance(run, Mapping):
                continue
            if str(run.get("conclusion") or "") != "success":
                continue
            updated = str(run.get("updated_at") or run.get("created_at") or "")
            try:
                stamp = datetime.fromisoformat(updated.replace("Z", "+00:00"))
            except ValueError:
                continue
            if stamp < start_utc or stamp >= end_utc:
                continue
            matched = True
            break
        if not matched:
            continue
        key = (platform_id, strategy)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "platform_id": platform_id,
                "strategy_profile": strategy,
                "actually_ran": True,
                "fill_count": 0,
                "order_count": 0,
                "cycle_count": 1,
                "status": "ok",
                "note": f"github_workflow:{workflow}",
            }
        )
    return rows


def merge_candidates(*groups: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Merge evidence; file/API rows with explicit counts win over workflow stubs."""

    merged: dict[tuple[str, str], dict[str, Any]] = {}
    for group in groups:
        for raw in group:
            platform_id = str(raw.get("platform_id") or "").strip()
            strategy = str(raw.get("strategy_profile") or "").strip()
            if not platform_id or not strategy:
                continue
            key = (platform_id, strategy)
            existing = merged.get(key)
            candidate = dict(raw)
            if existing is None:
                merged[key] = candidate
                continue
            # Prefer the row that carries more concrete activity counts.
            def score(row: Mapping[str, Any]) -> int:
                return (
                    int(row.get("fill_count", 0) or 0)
                    + int(row.get("order_count", 0) or 0)
                    + int(row.get("cycle_count", 0) or 0)
                )

            if score(candidate) >= score(existing):
                merged[key] = candidate
    return list(merged.values())


def collect_digest_runs(
    *,
    business_day: str,
    config: Mapping[str, Any],
    candidates_path: Path | None = None,
    include_github: bool = True,
) -> list[digest.DigestRunEntry]:
    file_rows = load_candidates_from_file(candidates_path)
    github_rows: list[dict[str, Any]] = []
    if include_github:
        github_rows = collect_from_github_workflows(
            business_day=business_day, config=config
        )
    merged = merge_candidates(file_rows, github_rows)
    return digest.filter_runs_for_digest(merged)


def build_digest_payload(
    *,
    business_day: str | None = None,
    locale: str | None = None,
    candidates_path: Path | None = None,
    include_github: bool = True,
    config_path: Path | None = None,
) -> tuple[digest.DailyDigestInput, str]:
    config = load_platform_config(config_path)
    contract = digest_contract(config)
    day = resolve_business_day(explicit=business_day)
    loc = resolve_locale(locale)
    runs = collect_digest_runs(
        business_day=day,
        config=config,
        candidates_path=candidates_path,
        include_github=include_github,
    )
    payload = digest.DailyDigestInput(
        business_day=day,
        window_label=window_label_for(contract),
        locale=loc,
        runs=tuple(runs),
    )
    return payload, digest.render_daily_digest(payload)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Aggregate QuantSentinel daily digest evidence and render message body."
    )
    parser.add_argument("--business-day", default=os.environ.get("DIGEST_BUSINESS_DAY"))
    parser.add_argument("--locale", default=None)
    parser.add_argument("--candidates", type=Path, default=None)
    parser.add_argument(
        "--no-github",
        action="store_true",
        help="Do not query GitHub Actions workflow conclusions.",
    )
    parser.add_argument(
        "--platform-config",
        type=Path,
        default=None,
        help="Override platform-config.json path.",
    )
    parser.add_argument(
        "--write-json",
        type=Path,
        default=None,
        help="Optional path to write structured digest receipt (no secrets).",
    )
    parser.add_argument(
        "--write-text",
        type=Path,
        default=None,
        help="Optional path to write rendered Telegram body.",
    )
    args = parser.parse_args(argv)

    payload, text = build_digest_payload(
        business_day=args.business_day,
        locale=args.locale,
        candidates_path=args.candidates,
        include_github=not args.no_github,
        config_path=args.platform_config,
    )
    if args.write_text:
        args.write_text.parent.mkdir(parents=True, exist_ok=True)
        args.write_text.write_text(text + "\n", encoding="utf-8")
    if args.write_json:
        receipt = {
            "schema_version": "qsl.daily_digest_receipt.v1",
            "business_day": payload.business_day,
            "window_label": payload.window_label,
            "locale": digest.normalize_locale(str(payload.locale)),
            "run_count": len(payload.runs),
            "total_fills": digest.total_fills(payload.runs),
            "runs": [asdict(entry) for entry in payload.runs],
            "message_chars": len(text),
        }
        args.write_json.parent.mkdir(parents=True, exist_ok=True)
        args.write_json.write_text(
            json.dumps(receipt, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
