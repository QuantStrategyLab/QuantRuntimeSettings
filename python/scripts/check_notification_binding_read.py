"""Inspect injected expected bindings without network, assets, or notifications."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any, Mapping

ROOT = Path(__file__).resolve().parents[2]
IDENTITY = ("platform_id", "opaque_account_uid", "target_id", "strategy_profile")
PLATFORMS = {"ibkr", "schwab", "longbridge", "binance", "firstrade", "qrs"}


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def inspect_bindings(env: Mapping[str, str], fallback: Any) -> dict[str, Any]:
    """Return only counts, booleans, hashes, and fixed status codes."""
    raw = env.get("DIGEST_EXPECTED_TARGETS_JSON", "").strip()
    result: dict[str, Any] = {
        "schema_version": 1,
        "status": "read_complete",
        "source": "injected_expected" if raw else "source_fallback",
        "source_sha": env.get("GITHUB_SHA", "") if re.fullmatch(r"[a-f0-9]{40}", env.get("GITHUB_SHA", "")) else None,
        "selected_membership": None,
        "runtime_marker_authority": "not_tested",
        "reader_access": "not_tested",
        "candidate_completeness": "not_tested",
        "notification_delivery": "not_attempted",
    }
    selected_platform = env.get("BINDING_SELECTED_PLATFORM", "ibkr") or "ibkr"
    selected_hash = env.get("BINDING_SELECTED_IDENTITY_SHA256", "").strip()
    if selected_platform not in {"ibkr", "schwab"} or (selected_hash and not re.fullmatch(r"[a-f0-9]{64}", selected_hash)):
        return dict(result, status="invalid", reason="selected_identity_invalid")
    if len(raw) > 1048576:
        return dict(result, status="invalid", reason="expected_size_limit")
    try:
        rows = json.loads(raw) if raw else fallback
    except (ValueError, TypeError, RecursionError):
        return dict(result, status="invalid", reason="expected_json_invalid")
    if not isinstance(rows, list) or len(rows) > 5000:
        return dict(result, status="invalid", reason="expected_shape_invalid")
    identities: list[tuple[str, ...]] = []
    for row in rows:
        if not isinstance(row, dict) or any(not isinstance(row.get(k), str) or not row[k].strip() for k in IDENTITY):
            return dict(result, status="invalid", reason="expected_identity_missing")
        identity = tuple(row[k] for k in IDENTITY)
        if identity[0] not in PLATFORMS:
            return dict(result, status="invalid", reason="expected_platform_invalid")
        identities.append(identity)
    if len(set(identities)) != len(identities):
        return dict(result, status="invalid", reason="expected_duplicate_identity")
    identities.sort()
    result.update(
        expected_count=len(identities),
        expected_set_sha256=_hash(identities),
        per_platform={platform: {"expected_count": sum(x[0] == platform for x in identities),
                                 "expected_set_sha256": _hash([x for x in identities if x[0] == platform])}
                      for platform in sorted({x[0] for x in identities})},
        selected_platform=selected_platform,
        selected_membership=any(x[0] == selected_platform and _hash(x) == selected_hash for x in identities) if selected_hash else None,
    )
    for name, key in (("candidate_namespace", "DIGEST_CANDIDATES_GCS_URI"),
                      ("reader_principal", "DIGEST_CANDIDATES_READER_SERVICE_ACCOUNT")):
        value = env.get(key, "").strip()
        result[name] = {"configured": bool(value), "value_sha256": hashlib.sha256(value.encode()).hexdigest() if value else None}
    # Only these known ordinary route literals may leave the protected job.
    result["route"] = {
        "unified_literal": env.get("QRS_UNIFIED_NOTIFICATION_ENABLED", "") if env.get("QRS_UNIFIED_NOTIFICATION_ENABLED", "") in {"true", "false"} else "other_or_missing",
        "routine_mode": env.get("QSL_ROUTINE_NOTIFICATION_MODE", "") if env.get("QSL_ROUTINE_NOTIFICATION_MODE", "") in {"immediate", "daily_digest"} else "other_or_missing",
    }
    if not identities:
        result.update(status="missing", reason="expected_targets_required")
    elif selected_hash and result["selected_membership"] is not True:
        result.update(status="mismatch", reason="selected_identity_not_expected")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        fallback = []
        if not os.environ.get("DIGEST_EXPECTED_TARGETS_JSON", "").strip():
            config_path = ROOT / "platform-config.json"
            fallback = json.loads(config_path.read_text())["notifications"]["quant_sentinel"]["daily_digest"].get("aggregator", {}).get("expected_targets", [])
        result = inspect_bindings(os.environ, fallback)
    except (OSError, ValueError, TypeError, KeyError):
        result = {"schema_version": 1, "status": "invalid", "reason": "source_configuration_unreadable"}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["status"] == "read_complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
