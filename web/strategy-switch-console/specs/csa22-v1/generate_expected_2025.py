"""Standalone C-SA-22 expected-2025 vector generator (does not import consumer)."""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _to_utc_ms(d: date, hhmm: str, tz: ZoneInfo) -> str:
    hour, minute = map(int, hhmm.split(":"))
    local_dt = datetime.combine(d, time(hour, minute), tzinfo=tz)
    utc_dt = local_dt.astimezone(timezone.utc)
    return utc_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def generate(spec_dir: Path) -> None:
    """Generate expected-2025.json and manifest.json directly from spec data."""
    spec_path = spec_dir / "SPEC.md"
    exc_path = spec_dir / "exceptions-2025.json"
    gen_path = spec_dir / "generate_expected_2025.py"
    out_path = spec_dir / "expected-2025.json"
    manifest_path = spec_dir / "manifest.json"

    exc = json.loads(exc_path.read_text(encoding="utf-8"))
    tz = ZoneInfo(exc["timezone"])
    start_d = date.fromisoformat(exc["coverage_start_date"])
    end_d = date.fromisoformat(exc["coverage_end_date"])

    holidays: dict[str, str] = exc["holidays"]
    unscheduled: dict[str, str] = exc["unscheduled_closures"]
    early_closes: dict[str, dict[str, str]] = exc["early_closes"]

    spec_digest = hashlib.sha256(
        spec_path.read_bytes() + exc_path.read_bytes()
    ).hexdigest()

    sessions: dict[str, dict] = {}
    cur = start_d
    while cur <= end_d:
        ds = cur.isoformat()
        noon_local = datetime.combine(cur, time(12, 0), tzinfo=tz)
        is_dst = noon_local.dst() != timedelta(0)

        base = {
            "exchange": exc["exchange"],
            "trade_date": ds,
            "timezone": exc["timezone"],
            "calendar_version": exc["calendar_version"],
            "coverage_start_date": exc["coverage_start_date"],
            "coverage_end_date": exc["coverage_end_date"],
            "spec_digest": spec_digest,
            "is_dst": is_dst,
        }

        if ds in unscheduled:
            name = unscheduled[ds]
            entry = {
                **base,
                "session_state": "unscheduled_closure",
                "is_trading_day": False,
                "reason": f"unscheduled_closure: {name}",
                "holiday_name": name,
                "open_local": None,
                "close_local": None,
                "cutoff_local": None,
                "open_utc": None,
                "close_utc": None,
                "order_cutoff_utc": None,
                "order_window": None,
                "blocks_orders": True,
                "blocks_eligibility": True,
            }
        elif ds in holidays:
            name = holidays[ds]
            entry = {
                **base,
                "session_state": "closed",
                "is_trading_day": False,
                "reason": f"holiday: {name}",
                "holiday_name": name,
                "open_local": None,
                "close_local": None,
                "cutoff_local": None,
                "open_utc": None,
                "close_utc": None,
                "order_cutoff_utc": None,
                "order_window": None,
                "blocks_orders": True,
                "blocks_eligibility": True,
            }
        elif cur.weekday() >= 5:
            entry = {
                **base,
                "session_state": "closed",
                "is_trading_day": False,
                "reason": "weekend",
                "holiday_name": None,
                "open_local": None,
                "close_local": None,
                "cutoff_local": None,
                "open_utc": None,
                "close_utc": None,
                "order_cutoff_utc": None,
                "order_window": None,
                "blocks_orders": True,
                "blocks_eligibility": True,
            }
        elif ds in early_closes:
            info = early_closes[ds]
            open_local = exc["regular_open_local"]
            close_local = info["close_local"]
            open_utc = _to_utc_ms(cur, open_local, tz)
            close_utc = _to_utc_ms(cur, close_local, tz)
            entry = {
                **base,
                "session_state": "half_day",
                "is_trading_day": True,
                "reason": f"early_close: {info['name']}",
                "holiday_name": info["name"],
                "open_local": open_local,
                "close_local": close_local,
                "cutoff_local": close_local,
                "open_utc": open_utc,
                "close_utc": close_utc,
                "order_cutoff_utc": close_utc,
                "order_window": {
                    "start_utc": open_utc,
                    "end_utc": close_utc,
                    "half_open": True,
                },
                "blocks_orders": False,
                "blocks_eligibility": False,
            }
        else:
            open_local = exc["regular_open_local"]
            close_local = exc["regular_close_local"]
            open_utc = _to_utc_ms(cur, open_local, tz)
            close_utc = _to_utc_ms(cur, close_local, tz)
            entry = {
                **base,
                "session_state": "regular",
                "is_trading_day": True,
                "reason": None,
                "holiday_name": None,
                "open_local": open_local,
                "close_local": close_local,
                "cutoff_local": close_local,
                "open_utc": open_utc,
                "close_utc": close_utc,
                "order_cutoff_utc": close_utc,
                "order_window": {
                    "start_utc": open_utc,
                    "end_utc": close_utc,
                    "half_open": True,
                },
                "blocks_orders": False,
                "blocks_eligibility": False,
            }

        sessions[ds] = entry
        cur += timedelta(days=1)

    payload = {
        "calendar_version": exc["calendar_version"],
        "status": exc["status"],
        "exchange": exc["exchange"],
        "timezone": exc["timezone"],
        "coverage_start_date": exc["coverage_start_date"],
        "coverage_end_date": exc["coverage_end_date"],
        "spec_digest": spec_digest,
        "day_count": len(sessions),
        "sessions": sessions,
    }
    out_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    manifest = {
        "calendar_version": exc["calendar_version"],
        "status": exc["status"],
        "spec_digest": spec_digest,
        "files": {
            "SPEC.md": _sha256_file(spec_path),
            "exceptions-2025.json": _sha256_file(exc_path),
            "expected-2025.json": _sha256_file(out_path),
            "generate_expected_2025.py": _sha256_file(gen_path),
        },
    }
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    generate(Path(__file__).resolve().parent)
