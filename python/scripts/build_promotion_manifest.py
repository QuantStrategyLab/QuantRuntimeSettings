"""Build an unsigned qsl.activation.v2 Promotion Manifest (no network, no secrets).

config_sha256 must be the target-file digest printed by a manual-strategy-switch
preview run with the exact same inputs. Sign the result with
sign_promotion_manifest.sh; never edit it after signing.
"""
from __future__ import annotations

import argparse
import json
import secrets
from datetime import UTC, datetime, timedelta

from activation_contract import SCHEMA_ID, calculate_promotion_sha256

MAX_TTL_HOURS = 24


def build(*, platform: str, target_name: str, execution_mode: str, strategy_profile: str,
          source_revision: str, artifact_sha256: str, config_sha256: str, risk_sha256: str,
          ttl_hours: int, single_use_id: str | None = None, now: datetime | None = None) -> dict:
    if not 1 <= ttl_hours <= MAX_TTL_HOURS:
        raise ValueError(f"ttl_hours must be 1..{MAX_TTL_HOURS}")
    issued = (now or datetime.now(UTC)).replace(microsecond=0)
    manifest = {
        "schema": SCHEMA_ID,
        "manifest_kind": "promotion",
        "single_use_id": single_use_id or f"{platform}-{target_name}-{secrets.token_hex(8)}",
        "issued_at": issued.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_at": (issued + timedelta(hours=ttl_hours)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "digest_algorithm": "sha256",
        "contract_only": True,
        "candidate": {
            "strategy_profile": strategy_profile,
            "source_revision": source_revision,
            "artifact_sha256": artifact_sha256,
            "config_sha256": config_sha256,
            "risk_sha256": risk_sha256,
        },
        "target": {"platform": platform, "target_name": target_name, "execution_mode": execution_mode},
    }
    manifest["promotion_sha256"] = calculate_promotion_sha256(manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("platform", "target-name", "execution-mode", "strategy-profile", "source-revision",
                 "artifact-sha256", "config-sha256", "risk-sha256", "output"):
        parser.add_argument(f"--{name}", required=True)
    parser.add_argument("--ttl-hours", type=int, default=6)
    args = parser.parse_args()
    manifest = build(platform=args.platform, target_name=args.target_name, execution_mode=args.execution_mode,
                     strategy_profile=args.strategy_profile, source_revision=args.source_revision,
                     artifact_sha256=args.artifact_sha256, config_sha256=args.config_sha256,
                     risk_sha256=args.risk_sha256, ttl_hours=args.ttl_hours)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, sort_keys=True, separators=(",", ":"))
    print(json.dumps({"single_use_id": manifest["single_use_id"], "promotion_sha256": manifest["promotion_sha256"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
