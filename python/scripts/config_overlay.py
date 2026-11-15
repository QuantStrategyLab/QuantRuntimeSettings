"""Generic overlay loader for platform-config.json.

Allows open-source repositories to ship generic configuration defaults while private
deployments override scheduler profiles, market domains, account selectors, and
non-secret deployment flags via QSL_CONFIG_OVERLAY_PATH or QSL_CONFIG_OVERLAY_JSON.
"""

from __future__ import annotations

import copy
import json
import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any

SECRET_KEY_MARKERS = (
    "PASSWORD",
    "PRIVATE_KEY",
    "TOKEN",
    "API_KEY",
    "ACCESS_KEY",
    "CLIENT_SECRET",
    "SECRET",
)


def validate_no_secret_keys(node: Any, *, path: str = "<overlay>") -> None:
    """Reject any dictionary key containing credential markers inside an overlay."""
    if isinstance(node, dict):
        for key, value in node.items():
            key_text = str(key)
            upper = key_text.upper()
            if any(marker in upper for marker in SECRET_KEY_MARKERS):
                raise ValueError(
                    f"Config overlay cannot store secret-bearing key at {path}.{key_text}"
                )
            validate_no_secret_keys(value, path=f"{path}.{key_text}")
    elif isinstance(node, list):
        for idx, item in enumerate(node):
            validate_no_secret_keys(item, path=f"{path}[{idx}]")


def normalized_overlay_environ(env: Mapping[str, str] | None = None) -> dict[str, str]:
    """Return an environment copy with QSL_CONFIG_OVERLAY_PATH resolved to an absolute path."""
    source = dict(os.environ if env is None else env)
    raw_path = (source.get("QSL_CONFIG_OVERLAY_PATH") or "").strip()
    if raw_path:
        source["QSL_CONFIG_OVERLAY_PATH"] = str(Path(raw_path).expanduser().resolve())
    return source


def load_overlay_payload(env: Mapping[str, str] | None = None) -> dict[str, Any] | None:
    """Load an optional non-secret overlay object from environment configuration."""
    source = os.environ if env is None else env
    raw_path = (source.get("QSL_CONFIG_OVERLAY_PATH") or "").strip()
    raw_json = (source.get("QSL_CONFIG_OVERLAY_JSON") or "").strip()

    if raw_path and raw_json:
        raise ValueError(
            "Specify at most one of QSL_CONFIG_OVERLAY_PATH and QSL_CONFIG_OVERLAY_JSON"
        )
    if not raw_path and not raw_json:
        return None

    if raw_path:
        overlay_path = Path(raw_path).expanduser()
        if not overlay_path.is_file():
            raise ValueError(f"QSL_CONFIG_OVERLAY_PATH does not exist: {raw_path}")
        payload = json.loads(overlay_path.read_text(encoding="utf-8"))
    else:
        payload = json.loads(raw_json)

    if not isinstance(payload, dict):
        raise ValueError("Config overlay must decode to a JSON object")
    validate_no_secret_keys(payload)
    return payload


def deep_merge_overlay(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge overlay dictionaries onto a copy of base."""
    merged = copy.deepcopy(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge_overlay(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def load_platform_config(
    config_path: Path, *, env: Mapping[str, str] | None = None
) -> dict[str, Any]:
    """Load base platform-config.json and apply an optional validated overlay."""
    with open(config_path, encoding="utf-8") as fh:
        base = json.load(fh)
    if not isinstance(base, dict):
        raise ValueError("Base platform config must be a JSON object")
    overlay = load_overlay_payload(env)
    if overlay is None:
        return base
    return deep_merge_overlay(base, overlay)
