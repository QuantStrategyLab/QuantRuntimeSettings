"""Display-only resolver; generated defaults come from QRS platform-config.json.

Never use resolved names for execution identity, bindings, keys or deduplication.
QSL_DISPLAY_NAMES_JSON accepts an optional JSON object with per-section overrides.
Invalid overrides fall back to bundled names so an urgent alert can still render.
"""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def _defaults():
    return json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf-8"))


@lru_cache(maxsize=8)
def _overrides(raw):
    try:
        value = json.loads(raw or "{}")
    except (ValueError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


def _text(value, locale):
    if isinstance(value, dict):
        language = "zh" if str(locale).lower().startswith("zh") else "en"
        value = value.get(language) or value.get("en")
    return value.strip() if isinstance(value, str) else ""


def display_name(kind, key, locale="en", *, fallback="", platform=""):
    """Resolve an explicit display key, retaining unknown operator labels."""
    key = str(key or "").strip()
    defaults = _defaults()
    overrides = _overrides(os.environ.get("QSL_DISPLAY_NAMES_JSON", ""))
    aliases = {**defaults.get("strategy_aliases", {}), **(overrides.get("strategy_aliases", {}) if isinstance(overrides.get("strategy_aliases"), dict) else {})}
    canonical = aliases.get(key, key) if kind == "strategies" else key
    if not isinstance(canonical, str):
        canonical = key
    for source in (overrides, defaults):
        section = source.get(kind, {})
        if kind == "accounts" and isinstance(section, dict):
            section = section.get(str(platform).lower(), {})
        if isinstance(section, dict):
            first, second = (key, canonical) if source is overrides else (canonical, key)
            result = _text(section.get(first), locale) or _text(section.get(second), locale)
            if result:
                return result
    return str(fallback or key)


def runtime_account_names(keys, *, platform, locale="en"):
    """Read account identities only from the protected runtime override.

    Bundled account/lane aliases are public presentation defaults, not broker
    identities. Never use this mapping in a frontend build or generated file.
    """
    accounts = _overrides(os.environ.get("QSL_DISPLAY_NAMES_JSON", "")).get("accounts", {})
    section = accounts.get(str(platform).lower(), {}) if isinstance(accounts, dict) else {}
    if isinstance(section, dict):
        for key in dict.fromkeys(keys):
            if key:
                value = _text(section.get(key), locale)
                if value:
                    yield value


def broker_account_identity(platform, value):
    """Validate a display identity without mistaking a mask for a full ID."""
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if (not value or len(value) > 70 or not value.isprintable() or "://" in value
            or any(char in value for char in "*•·…<>\\\n\r")
            or re.search(r"(?i)x{2,}|masked|redacted", value)
            or value.lower() in {"live", "paper", "shadow", "default", "account", "实盘", "模拟", "账户"}):
        return ""
    if platform == "ibkr":
        return value.upper() if re.fullmatch(r"(?i)D?U[0-9]{5,16}", value) else ""
    if platform in {"schwab", "firstrade"}:
        return value if re.fullmatch(r"(?:Account )?[0-9][0-9 .-]{4,24}[0-9]", value) else ""
    return value if platform in {"longbridge", "binance"} else ""


def safe_display_text(value: object) -> str:
    """Only display labels; never fall back to broker, storage or binding IDs."""
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    if (not text.isprintable() or "://" in text
            or re.search(r"[Dd]?[Uu][0-9]{5,}", text)
            or text.isdecimal()
            or re.search(r"\d{5,}", text)
            or re.search(r"\d(?:[\s.-]*\d){4,}", text)
            or re.fullmatch(r"[0-9a-fA-F-]{12,}", text)):
        return ""
    return text[:70]


def configured_account_label(option):
    """Selected account config only; invalid fields fall through in order."""
    for name in ('account_label', 'label', 'key', 'target_name'):
        value = option.get(name)
        if (isinstance(value, str) and len(value.strip()) <= 70
                and value.isprintable() and (label := safe_display_text(value))):
            return label
    return ''
