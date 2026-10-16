#!/usr/bin/env python3
"""Generate display-only snapshots from platform-config.json. Never sync at runtime."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DESTINATIONS = {
    "QuantPlatformKit": "src/quant_platform_kit/common/display_names",
    "BinancePlatform": "notifications/display_names",
    "CharlesSchwabPlatform": "notifications/display_names",
    "InteractiveBrokersPlatform": "notifications/display_names",
    "FirstradePlatform": "notifications/display_names",
    "LongBridgePlatform": "notifications/display_names",
    "CryptoLivePoolPipelines": "scripts/display_names",
}


def snapshot(config):
    names = json.loads((ROOT / "display-names.config.json").read_text(encoding="utf-8"))
    return {
        "strategies": {**names.get("legacy_strategies", {}), **{key: {"zh": value.get("label", key), "en": value.get("label_en", key)} for key, value in config["strategies"].items()}},
        "platforms": {key: value.get("label", key) for key, value in config["platforms"].items()},
        "senders": {"quant_sentinel": {"zh": config["notifications"]["quant_sentinel"]["label_zh"], "en": config["notifications"]["quant_sentinel"]["label_en"]}},
        "accounts": names.get("accounts", {}),
        "lanes": names.get("lanes", {}),
        "strategy_aliases": names.get("strategy_aliases", {}),
    }


def outputs(repos_root=None):
    data = snapshot(json.loads((ROOT / "platform-config.json").read_text(encoding="utf-8")))
    payload = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    result = {ROOT / "python/scripts/display_names.json": payload,
              ROOT / "web/strategy-switch-console/display_names_data.js": "// Generated from platform-config.json; display only.\nexport const DISPLAY_NAMES = " + payload.rstrip() + ";\n"}
    if repos_root:
        helper = (ROOT / "python/scripts/display_names.py").read_text(encoding="utf-8")
        for repo, relative in DESTINATIONS.items():
            base = Path(repos_root) / repo / relative
            result[base.with_suffix(".json")] = payload
            result[base.with_suffix(".py")] = helper
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repos-root", type=Path, help="Explicit sibling source checkouts to refresh, never production")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    stale = []
    for path, content in outputs(args.repos_root).items():
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                stale.append(str(path))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
    if stale:
        raise SystemExit("Stale display snapshots: " + ", ".join(stale))
    print("Display snapshots match platform-config.json" if args.check else "Generated display snapshots")


if __name__ == "__main__":
    main()
