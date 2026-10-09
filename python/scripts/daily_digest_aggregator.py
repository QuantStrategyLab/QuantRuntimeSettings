#!/usr/bin/env python3
"""Cross-platform daily digest aggregator (evidence in → render out).

Collects only platforms/strategies that actually ran from:
  1) candidates JSON file / DIGEST_CANDIDATES_JSON (preferred; producer-authored)
  2) optional GitHub Actions workflow conclusions (allowlisted; existence only —
     fill/order counts stay unknown unless a candidate row supplies them)

Does not trade, does not embed tokens, does not invent missing platforms.
Aggregation keys include account/target identity. Source read failures are
recorded in coverage/receipt and must not render as “link healthy / no runs”.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
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

_OBSERVATION_FIELDS = (
    "strategy_label",
    "equity",
    "equity_usd",
    "equity_currency",
    "currency",
    "holdings",
    "positions",
    "signal_summary",
    "rebalance_kind",
    "rebalance_conclusion",
    "tips",
    "tip",
    "account_hint",
)


@dataclass
class GithubEvidenceResult:
    rows: list[dict[str, Any]] = field(default_factory=list)
    failures: list[dict[str, Any]] = field(default_factory=list)
    sources_queried: int = 0
    sources_matched: int = 0


@dataclass
class CollectResult:
    runs: list[digest.DigestRunEntry]
    coverage: digest.EvidenceCoverage
    merged_rows: list[dict[str, Any]] = field(default_factory=list)


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
        row = dict(item)
        if not str(row.get("evidence_provenance") or "").strip():
            row["evidence_provenance"] = "candidates"
        out.append(row)
    return out


def load_candidates_from_file(path: Path | None) -> tuple[list[dict[str, Any]], bool, bool]:
    """Return (rows, configured, loaded).

    configured: env/path asked for candidates.
    loaded: file/JSON was successfully parsed (may be empty list).
    """

    configured = False
    if path is None:
        env_path = (os.environ.get("DIGEST_CANDIDATES_PATH") or "").strip()
        path = Path(env_path) if env_path else None
    if path is not None:
        configured = True
        if not path.is_file():
            raise FileNotFoundError(f"candidates file not found: {path}")
        return _as_candidate_rows(json.loads(path.read_text(encoding="utf-8"))), True, True
    inline = (os.environ.get("DIGEST_CANDIDATES_JSON") or "").strip()
    if inline:
        configured = True
        return _as_candidate_rows(json.loads(inline)), True, True
    return [], False, False


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

    Counts remain unknown unless a candidates file supplies them. Heartbeat-only
    monitor workflows are intentionally omitted.
    """

    platforms = config.get("platforms") or {}
    rows: list[dict[str, str]] = []
    defaults: dict[str, tuple[str, str]] = {
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
) -> GithubEvidenceResult:
    """Include a platform only when an allowlisted workflow succeeded that day.

    Never invents fill/order counts (null + counts_unknown). API errors are
    recorded as source failures — callers must not treat empty rows alone as
    verified idle / link-healthy.
    """

    result = GithubEvidenceResult()
    gh_token = (
        token or os.environ.get("DIGEST_GH_TOKEN") or os.environ.get("GH_TOKEN") or ""
    ).strip()
    entries = list(allowlist or default_workflow_allowlist(config))
    if not entries:
        return result
    if not gh_token:
        result.failures.append(
            {
                "platform_id": "*",
                "workflow": "*",
                "repository": "*",
                "reason_code": "github_token_missing",
                "message": "DIGEST_GH_TOKEN/GH_TOKEN absent; github evidence not queried",
            }
        )
        return result

    start_utc, end_utc = business_day_utc_window(business_day)
    seen: set[tuple[str, str, str, str]] = set()
    for entry in entries:
        platform_id = entry["platform_id"]
        repository = entry["repository"]
        workflow = entry["workflow"]
        strategy = entry["strategy_profile"]
        owner_repo = repository.split("/", 1)
        if len(owner_repo) != 2:
            result.failures.append(
                {
                    "platform_id": platform_id,
                    "workflow": workflow,
                    "repository": repository,
                    "reason_code": "invalid_repository",
                    "message": f"repository must be owner/repo, got {repository!r}",
                }
            )
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
        result.sources_queried += 1
        try:
            payload = _gh_api_get(url, gh_token)
        except RuntimeError as exc:
            failure = {
                "platform_id": platform_id,
                "workflow": workflow,
                "repository": repository,
                "reason_code": "github_api_error",
                "message": str(exc)[:300],
            }
            result.failures.append(failure)
            print(
                f"digest evidence failure {platform_id}/{workflow}: {exc}",
                file=sys.stderr,
            )
            continue
        runs = payload.get("workflow_runs") if isinstance(payload, Mapping) else None
        if not isinstance(runs, list):
            result.failures.append(
                {
                    "platform_id": platform_id,
                    "workflow": workflow,
                    "repository": repository,
                    "reason_code": "github_payload_invalid",
                    "message": "workflow_runs missing or not a list",
                }
            )
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
        stub = {
            "platform_id": platform_id,
            "strategy_profile": strategy,
            "opaque_account_uid": "",
            "target_id": "",
            "actually_ran": True,
            # Existence only — do not assert verified zero fills/orders.
            "fill_count": None,
            "order_count": None,
            "cycle_count": 1,
            "status": "ok",
            "note": f"github_workflow:{workflow}",
            "field_status": {
                "fill_count": "counts_unknown",
                "order_count": "counts_unknown",
                "cycle_count": "known",
            },
            "reason_code": "github_workflow_existence_only",
            "evidence_provenance": "github_workflow_stub",
        }
        key = digest.identity_key(stub)
        if key in seen:
            continue
        seen.add(key)
        result.sources_matched += 1
        result.rows.append(stub)
    return result


def _merge_count_field(
    winner: dict[str, Any],
    loser: dict[str, Any],
    field_name: str,
) -> None:
    """Fill known counts into unknown winner slots; never invent 0 from stub."""

    w_value, w_status = digest.resolve_count_field(
        winner, field_name, legacy_default_zero=False
    )
    l_value, l_status = digest.resolve_count_field(
        loser, field_name, legacy_default_zero=False
    )
    if w_status == "known" and w_value is not None:
        return
    if l_status == "known" and l_value is not None:
        winner[field_name] = l_value
        status_map = dict(winner.get("field_status") or {})
        status_map[field_name] = "known"
        winner["field_status"] = status_map
        # Drop existence-only reason if we now have a known producer count.
        if str(winner.get("reason_code") or "") == "github_workflow_existence_only":
            if field_name in {"fill_count", "order_count"}:
                winner["reason_code"] = str(loser.get("reason_code") or "") or (
                    "merged_known_counts"
                )


def _should_cross_fill_observation(winner: Mapping[str, Any], loser: Mapping[str, Any]) -> bool:
    """Only cross-fill observation fields when both sides share a real identity."""

    if digest.identity_is_unknown(winner) or digest.identity_is_unknown(loser):
        return False
    return digest.identity_key(winner) == digest.identity_key(loser)


def merge_candidates(*groups: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Merge evidence by identity key; do not mix different accounts/targets.

    Same identity: dedupe, prefer richer known evidence. Unknown-identity rows
    do not cross-fill observation fields onto each other. Different identities
    never merge.
    """

    merged: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    unknown_rows: list[dict[str, Any]] = []

    for group in groups:
        for raw in group:
            platform_id = str(raw.get("platform_id") or "").strip()
            strategy = str(raw.get("strategy_profile") or "").strip()
            if not platform_id or not strategy:
                continue
            candidate = dict(raw)
            key = digest.identity_key(candidate)

            if digest.identity_is_unknown(candidate):
                # Keep unknown-identity rows separate unless exact duplicate key
                # already present with identical provenance note (dedupe only).
                existing_unknown = None
                for idx, row in enumerate(unknown_rows):
                    if digest.identity_key(row) == key and str(row.get("note") or "") == str(
                        candidate.get("note") or ""
                    ) and str(row.get("evidence_provenance") or "") == str(
                        candidate.get("evidence_provenance") or ""
                    ):
                        existing_unknown = (idx, row)
                        break
                if existing_unknown is None:
                    unknown_rows.append(candidate)
                    continue
                idx, existing = existing_unknown
                if digest.observation_score(candidate) >= digest.observation_score(existing):
                    # Replace whole row; do not patch fields across unknowns.
                    unknown_rows[idx] = candidate
                continue

            existing = merged.get(key)
            if existing is None:
                merged[key] = candidate
                continue
            if digest.observation_score(candidate) >= digest.observation_score(existing):
                winner = dict(candidate)
                loser = existing
            else:
                winner = dict(existing)
                loser = candidate
            if _should_cross_fill_observation(winner, loser):
                for field_name in _OBSERVATION_FIELDS:
                    if winner.get(field_name) in (None, "", [], ()):
                        if loser.get(field_name) not in (None, "", [], ()):
                            winner[field_name] = loser[field_name]
                for count_field in ("fill_count", "order_count", "cycle_count"):
                    _merge_count_field(winner, loser, count_field)
                # Preserve identity fields from either side if winner omitted.
                for id_field in ("opaque_account_uid", "target_id"):
                    if not str(winner.get(id_field) or "").strip():
                        if str(loser.get(id_field) or "").strip():
                            winner[id_field] = loser[id_field]
            merged[key] = winner

    return list(merged.values()) + unknown_rows


def strategy_label_from_config(
    config: Mapping[str, Any],
    strategy_profile: str,
    *,
    locale: str = "zh",
) -> str:
    """Public display label from platform-config (not invented numbers)."""

    strategies = config.get("strategies") or {}
    meta = strategies.get(strategy_profile) or {}
    if not isinstance(meta, Mapping):
        return ""
    if str(locale).lower().startswith("en"):
        return str(meta.get("label_en") or meta.get("label") or "").strip()
    return str(meta.get("label") or meta.get("label_en") or "").strip()


def enrich_candidate_labels(
    rows: Sequence[Mapping[str, Any]],
    config: Mapping[str, Any],
    *,
    locale: str = "zh",
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in rows:
        row = dict(raw)
        if not str(row.get("strategy_label") or "").strip():
            label = strategy_label_from_config(
                config, str(row.get("strategy_profile") or ""), locale=locale
            )
            if label:
                row["strategy_label"] = label
        out.append(row)
    return out


def collect_digest_runs(
    *,
    business_day: str,
    config: Mapping[str, Any],
    candidates_path: Path | None = None,
    include_github: bool = True,
    locale: str = "zh",
) -> CollectResult:
    file_rows, candidates_configured, candidates_loaded = load_candidates_from_file(
        candidates_path
    )
    github_result = GithubEvidenceResult()
    if include_github:
        github_result = collect_from_github_workflows(
            business_day=business_day, config=config
        )
    merged = merge_candidates(file_rows, github_result.rows)
    enriched = enrich_candidate_labels(merged, config, locale=locale)
    runs = digest.filter_runs_for_digest(enriched)
    coverage = digest.EvidenceCoverage(
        candidates_configured=candidates_configured,
        candidates_loaded=candidates_loaded,
        candidates_count=len(file_rows),
        github_enabled=include_github,
        github_sources_queried=github_result.sources_queried,
        github_sources_matched=github_result.sources_matched,
        github_failures=tuple(github_result.failures),
    )
    return CollectResult(runs=runs, coverage=coverage, merged_rows=enriched)


def _run_receipt_dict(entry: digest.DigestRunEntry) -> dict[str, Any]:
    payload = asdict(entry)
    # holdings are nested dataclasses already flattened by asdict
    payload["identity"] = {
        "platform_id": entry.platform_id,
        "strategy_profile": entry.strategy_profile,
        "opaque_account_uid": entry.opaque_account_uid
        or digest.UNKNOWN_ACCOUNT_UID,
        "target_id": entry.target_id or digest.UNKNOWN_TARGET_ID,
    }
    provenance = entry.evidence_provenance or "unknown"
    payload["field_provenance"] = {
        "fill_count": (
            "unknown"
            if entry.fill_count_status == "unknown"
            else ("github_stub" if provenance.startswith("github") else "candidates")
        ),
        "order_count": (
            "unknown"
            if entry.order_count_status == "unknown"
            else ("github_stub" if provenance.startswith("github") else "candidates")
        ),
        "cycle_count": (
            "unknown"
            if entry.cycle_count_status == "unknown"
            else ("github_stub" if provenance.startswith("github") else "candidates")
        ),
        "equity": "candidates" if entry.equity is not None else "absent",
        "holdings": "candidates" if entry.holdings else "absent",
        "signal_summary": "candidates" if entry.signal_summary else "absent",
        "rebalance": (
            "candidates"
            if entry.rebalance_kind or entry.rebalance_conclusion
            else "absent"
        ),
        "evidence_provenance": provenance,
    }
    return payload


def build_digest_payload(
    *,
    business_day: str | None = None,
    locale: str | None = None,
    candidates_path: Path | None = None,
    include_github: bool = True,
    config_path: Path | None = None,
) -> tuple[digest.DailyDigestInput, str, CollectResult]:
    config = load_platform_config(config_path)
    contract = digest_contract(config)
    day = resolve_business_day(explicit=business_day)
    loc = resolve_locale(locale)
    collected = collect_digest_runs(
        business_day=day,
        config=config,
        candidates_path=candidates_path,
        include_github=include_github,
        locale=loc,
    )
    evidence_status = "has_runs" if collected.runs else (
        "verified_idle"
        if collected.coverage.is_complete_for_verified_idle
        else "evidence_unknown"
    )
    payload = digest.DailyDigestInput(
        business_day=day,
        window_label=window_label_for(contract),
        locale=loc,
        runs=tuple(collected.runs),
        evidence_coverage=collected.coverage,
        evidence_status=evidence_status,
    )
    return payload, digest.render_daily_digest(payload), collected


def build_receipt(
    payload: digest.DailyDigestInput,
    collected: CollectResult,
    *,
    message_chars: int,
) -> dict[str, Any]:
    fills = digest.total_fills(payload.runs)
    return {
        "schema_version": "qsl.daily_digest_receipt.v1",
        "business_day": payload.business_day,
        "window_label": payload.window_label,
        "locale": digest.normalize_locale(str(payload.locale)),
        "run_count": len(payload.runs),
        "total_fills": fills,
        "total_fills_status": "unknown" if fills is None else "known",
        "evidence_status": digest.resolve_evidence_status(payload),
        "source_coverage": collected.coverage.to_dict(),
        "failures": list(collected.coverage.github_failures),
        "runs": [_run_receipt_dict(entry) for entry in payload.runs],
        "message_chars": message_chars,
    }


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

    payload, text, collected = build_digest_payload(
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
        receipt = build_receipt(payload, collected, message_chars=len(text))
        args.write_json.parent.mkdir(parents=True, exist_ok=True)
        args.write_json.write_text(
            json.dumps(receipt, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
