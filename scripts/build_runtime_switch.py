#!/usr/bin/env python3
"""Build a transient runtime target for a manual strategy switch."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
ROOT = SCRIPT_DIR.parent

from runtime_settings import (  # noqa: E402
    SUPPORTED_PLATFORMS,
    compact_json,
    env_string,
    platform_repository,
    validate_target,
)


DEFAULT_ARTIFACT_BUCKET_URI = "gs://qsl-runtime-logs-shared"
# Keep this list limited to strategy-scope artifacts that the publisher
# currently produces. QPK may parse broader explicit mounts for forward
# compatibility, but auto mode must not generate missing latest_signal paths.
MARKET_REGIME_CONTROL_PROFILES = frozenset(
    {
        "tqqq_growth_income",
        "soxl_soxx_trend_income",
    }
)
IBIT_ZSCORE_EXIT_STRATEGY_PROFILE = "ibit_smart_dca"
IBIT_ZSCORE_EXIT_PLUGIN = "ibit_zscore_exit"
US_DAILY_SCHEDULER = {
    "timezone": "America/New_York",
    "main_time": "45 15 * * *",
    "probe_time": "35 9,15 * * *",
    "precheck_time": "45 9 * * *",
}
US_DCA_SCHEDULER = {
    "timezone": "America/New_York",
    "main_time": "45 15 25-28 * *",
    "probe_time": "35 9,15 25-28 * *",
    "precheck_time": "45 9 25-28 * *",
}
US_SNAPSHOT_SCHEDULER = {
    "timezone": "America/New_York",
    "main_time": "45 15 1-7 * *",
    "probe_time": "35 9,15 1-7 * *",
    "precheck_time": "45 9 1-7 * *",
}
HK_DAILY_SCHEDULER = {
    "timezone": "Asia/Hong_Kong",
    "main_time": "45 15 * * *",
    "probe_time": "35 9,15 * * *",
    "precheck_time": "45 9 * * *",
}
HK_SNAPSHOT_SCHEDULER = {
    "timezone": "Asia/Hong_Kong",
    "main_time": "45 15 1-7 * *",
    "probe_time": "35 9,15 1-7 * *",
    "precheck_time": "45 9 1-7 * *",
}
CN_DAILY_SCHEDULER = {
    "timezone": "Asia/Shanghai",
    "main_time": "45 15 * * *",
    "probe_time": "35 9,15 * * *",
    "precheck_time": "45 9 * * *",
}
CN_SNAPSHOT_SCHEDULER = {
    "timezone": "Asia/Shanghai",
    "main_time": "45 15 1-7 * *",
    "probe_time": "35 9,15 1-7 * *",
    "precheck_time": "45 9 1-7 * *",
}
STRATEGY_SCHEDULER_PROFILES = {
    "nasdaq_sp500_smart_dca": US_DCA_SCHEDULER,
    "ibit_smart_dca": US_DCA_SCHEDULER,
    "russell_top50_leader_rotation": US_SNAPSHOT_SCHEDULER,
    "hk_low_vol_dividend_quality_snapshot": HK_SNAPSHOT_SCHEDULER,
    "cn_index_etf_tactical_rotation": CN_DAILY_SCHEDULER,
    "cn_industry_etf_rotation": CN_DAILY_SCHEDULER,
    "cn_industry_etf_rotation_aggressive": CN_DAILY_SCHEDULER,
    "cn_dividend_quality_snapshot": CN_SNAPSHOT_SCHEDULER,
}
PLATFORM_DRY_RUN_VARIABLES = {
    "schwab": "SCHWAB_DRY_RUN_ONLY",
    "longbridge": "LONGBRIDGE_DRY_RUN_ONLY",
    "ibkr": "IBKR_DRY_RUN_ONLY",
    "firstrade": "FIRSTRADE_DRY_RUN_ONLY",
    "qmt": "QMT_DRY_RUN_ONLY",
}
PLATFORM_RESERVED_CASH_RATIO_VARIABLES = {
    "schwab": "SCHWAB_RESERVED_CASH_RATIO",
    "longbridge": "LONGBRIDGE_RESERVED_CASH_RATIO",
    "ibkr": "IBKR_RESERVED_CASH_RATIO",
    "firstrade": "FIRSTRADE_RESERVED_CASH_RATIO",
}
PLATFORM_MIN_RESERVED_CASH_VARIABLES = {
    "schwab": "SCHWAB_MIN_RESERVED_CASH_USD",
    "longbridge": "LONGBRIDGE_MIN_RESERVED_CASH_USD",
    "ibkr": "IBKR_MIN_RESERVED_CASH_USD",
    "firstrade": "FIRSTRADE_MIN_RESERVED_CASH_USD",
}
PLATFORM_CASH_ONLY_EXECUTION_VARIABLES = {
    "schwab": "SCHWAB_CASH_ONLY_EXECUTION",
    "longbridge": "LONGBRIDGE_CASH_ONLY_EXECUTION",
    "ibkr": "IBKR_CASH_ONLY_EXECUTION",
    "firstrade": "FIRSTRADE_CASH_ONLY_EXECUTION",
}
INCOME_LAYER_VARIABLES = (
    "INCOME_LAYER_ENABLED",
    "INCOME_LAYER_START_USD",
    "INCOME_LAYER_MAX_RATIO",
)
MARKET_SIGNAL_RUNTIME_SUFFIXES = (
    "MARKET_SIGNAL_HANDOFF_INDEX_URI",
    "MARKET_SIGNAL_HANDOFF_MANIFEST_URI",
    "MARKET_SIGNAL_CONSUMPTION_AUDIT_URI",
    "MARKET_SIGNAL_CACHE_DIR",
    "MARKET_SIGNAL_REQUIRED",
    "MARKET_SIGNAL_FALLBACK_MODE",
    "MARKET_SIGNAL_MAX_STALE_DAYS",
)
PLATFORM_MARKET_SIGNAL_PREFIXES = {
    "schwab": "SCHWAB",
    "longbridge": "LONGBRIDGE",
    "ibkr": "IBKR",
    "firstrade": "FIRSTRADE",
    "qmt": "QMT",
}
MARKET_SIGNAL_RUNTIME_VARIABLES = tuple(MARKET_SIGNAL_RUNTIME_SUFFIXES) + tuple(
    f"{prefix}_{suffix}"
    for prefix in PLATFORM_MARKET_SIGNAL_PREFIXES.values()
    for suffix in MARKET_SIGNAL_RUNTIME_SUFFIXES
)
CASH_ONLY_EXECUTION_VARIABLE = "CASH_ONLY_EXECUTION"
CASH_ONLY_EXECUTION_MODES = frozenset({"current", "enabled", "disabled"})
CASH_ONLY_EXECUTION_CONTROL_FIELD = "cash_only_execution_mode"
LEGACY_INCOME_LAYER_VARIABLES = (
    "INCOME_THRESHOLD_USD",
    "QQQI_INCOME_RATIO",
    "INCOME_LAYER_QQQI_WEIGHT",
    "INCOME_LAYER_SPYI_WEIGHT",
)
LEGACY_INCOME_LAYER_CONTROL_FIELDS = (
    "income_threshold_usd",
    "qqqi_income_ratio",
    "income_layer_qqqi_weight",
    "income_layer_spyi_weight",
)
OPTION_OVERLAY_CONTROL_FIELDS = (
    "option_overlay_enabled",
    "option_growth_overlay_enabled",
    "option_growth_overlay_recipe",
    "option_growth_overlay_start_usd",
    "option_growth_overlay_nav_budget_ratio",
    "option_income_overlay_enabled",
    "option_income_overlay_recipe",
    "option_income_overlay_start_usd",
    "option_income_overlay_nav_risk_ratio",
)
OPTION_OVERLAY_VARIABLES = tuple(field.upper() for field in OPTION_OVERLAY_CONTROL_FIELDS)
OPTION_OVERLAY_MODES = frozenset({"current", "enabled", "disabled"})
OPTION_OVERLAY_PROFILE_PATH = ROOT / "web" / "strategy-switch-console" / "strategy-profiles.example.json"
RUNTIME_TARGET_VARIABLES = (
    "RUNTIME_TARGET_ENABLED",
)
DCA_PROFILES = frozenset(
    {
        "nasdaq_sp500_smart_dca",
        "ibit_smart_dca",
    }
)
DCA_MODES = frozenset({"fixed", "smart"})
DCA_MODE_VARIABLE = "DCA_MODE"
DCA_BASE_INVESTMENT_VARIABLE = "DCA_BASE_INVESTMENT_USD"
DCA_RUNTIME_VARIABLES = (
    DCA_MODE_VARIABLE,
    DCA_BASE_INVESTMENT_VARIABLE,
)
DCA_MODE_CONTROL_FIELD = "dca_mode"
DCA_BASE_INVESTMENT_CONTROL_FIELD = "dca_base_investment_usd"
IBIT_ZSCORE_EXIT_ENABLED_VARIABLE = "IBIT_ZSCORE_EXIT_ENABLED"
IBIT_ZSCORE_EXIT_MODE_VARIABLE = "IBIT_ZSCORE_EXIT_MODE"
IBIT_ZSCORE_EXIT_PARKING_SYMBOL_VARIABLE = "IBIT_ZSCORE_EXIT_PARKING_SYMBOL"
IBIT_ZSCORE_EXIT_RISK_REDUCED_EXPOSURE_VARIABLE = "IBIT_ZSCORE_EXIT_RISK_REDUCED_EXPOSURE"
IBIT_ZSCORE_EXIT_RISK_OFF_EXPOSURE_VARIABLE = "IBIT_ZSCORE_EXIT_RISK_OFF_EXPOSURE"
IBIT_ZSCORE_EXIT_ALLOW_OUTSIDE_WINDOW_VARIABLE = "IBIT_ZSCORE_EXIT_ALLOW_OUTSIDE_EXECUTION_WINDOW"
IBIT_ZSCORE_EXIT_RUNTIME_VARIABLES = (
    IBIT_ZSCORE_EXIT_ENABLED_VARIABLE,
    IBIT_ZSCORE_EXIT_MODE_VARIABLE,
    IBIT_ZSCORE_EXIT_PARKING_SYMBOL_VARIABLE,
    IBIT_ZSCORE_EXIT_RISK_REDUCED_EXPOSURE_VARIABLE,
    IBIT_ZSCORE_EXIT_RISK_OFF_EXPOSURE_VARIABLE,
    IBIT_ZSCORE_EXIT_ALLOW_OUTSIDE_WINDOW_VARIABLE,
)
IBIT_ZSCORE_EXIT_CONTROL_FIELDS = (
    "ibit_zscore_exit_mode",
    "ibit_zscore_exit_parking_symbol",
    "ibit_zscore_exit_risk_reduced_exposure",
    "ibit_zscore_exit_risk_off_exposure",
    "ibit_zscore_exit_allow_outside_execution_window",
)
DEFAULT_VARIABLE_SCOPE = {
    "longbridge": "environment",
    "ibkr": "repository",
    "schwab": "repository",
    "firstrade": "repository",
    "qmt": "repository",
}
DEFAULT_SERVICE_NAME = {
    "schwab": "charles-schwab-quant-service",
    "firstrade": "firstrade-quant-service",
    "qmt": "qmt-quant-service",
}
PLATFORM_ALIASES = {
    "firsttrade": "firstrade",
}


def _normalize_platform(value: str) -> str:
    platform = str(value or "").strip().lower()
    platform = PLATFORM_ALIASES.get(platform, platform)
    if platform not in SUPPORTED_PLATFORMS:
        supported = ", ".join(sorted(SUPPORTED_PLATFORMS))
        raise ValueError(f"unsupported platform {value!r}; supported: {supported}")
    return platform


def _normalize_target_name(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError("target_name is required")
    return re.sub(r"[^A-Za-z0-9._=-]+", "-", text).strip("-")


def _deployment_selector_default(platform: str, target_name: str) -> str:
    if platform in {"firstrade", "qmt"}:
        return platform
    return target_name.upper() if target_name.lower() in {"sg", "hk", "paper"} else target_name


def _account_scope_default(platform: str, deployment_selector: str) -> str:
    if platform == "firstrade":
        return "US"
    if platform == "qmt":
        return "CN"
    return deployment_selector


def _account_selector_default(platform: str, account_scope: str) -> list[str]:
    if platform in {"firstrade", "qmt"}:
        return [platform]
    return [account_scope]


def _default_service_name(platform: str, target_name: str) -> str:
    if platform in DEFAULT_SERVICE_NAME:
        return DEFAULT_SERVICE_NAME[platform]
    normalized = target_name.lower()
    if platform == "longbridge":
        return f"longbridge-quant-{normalized}-service"
    if platform == "ibkr":
        return f"interactive-brokers-{normalized}-service"
    raise ValueError(f"no default service_name for platform {platform!r}")


def _default_github_environment(platform: str, target_name: str, variable_scope: str) -> str | None:
    if variable_scope != "environment":
        return None
    if platform == "longbridge":
        return f"longbridge-{target_name.lower()}"
    return target_name


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.replace(";", ",").split(",") if item.strip()]


def _load_json_object(value: str, *, field_name: str) -> dict[str, Any]:
    text = str(value or "").strip()
    if not text:
        return {}
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{field_name} must be valid JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{field_name} must decode to an object")
    return payload


def _load_json_from_file(path: str | None, *, field_name: str) -> dict[str, Any]:
    if not path:
        return {}
    text = Path(path).read_text(encoding="utf-8")
    return _load_json_object(text, field_name=field_name)


def _parse_extra_variables(pairs: list[str], raw_json: str) -> dict[str, Any]:
    extras = _load_json_object(raw_json, field_name="extra_variables_json")
    for pair in pairs:
        name, sep, value = pair.partition("=")
        if not sep or not name.strip():
            raise ValueError(f"extra variable must be NAME=VALUE, got: {pair!r}")
        extras[name.strip()] = value
    return extras


def _normalize_dca_mode(value: str) -> str:
    mode = str(value or "").strip().lower()
    aliases = {
        "ordinary": "fixed",
        "ordinary_dca": "fixed",
        "fixed_dca": "fixed",
        "smart_dca": "smart",
    }
    mode = aliases.get(mode, mode)
    if mode not in DCA_MODES:
        raise ValueError("dca_mode must be fixed or smart")
    return mode


def _normalize_positive_decimal(value: str, *, field_name: str) -> str:
    text = str(value or "").strip()
    if not text or not re.fullmatch(r"(?:\d+|\d*\.\d+)", text):
        raise ValueError(f"{field_name} must be a positive decimal number")
    numeric = float(text)
    if not numeric > 0:
        raise ValueError(f"{field_name} must be greater than 0")
    return text


def _normalize_nonnegative_decimal(value: str, *, field_name: str) -> str:
    text = str(value or "").strip()
    if not text or not re.fullmatch(r"(?:\d+|\d*\.\d+)", text):
        raise ValueError(f"{field_name} must be a non-negative decimal number")
    numeric = float(text)
    if numeric < 0:
        raise ValueError(f"{field_name} must be non-negative")
    return text


def _normalize_ratio_decimal(value: str, *, field_name: str) -> str:
    text = str(value or "").strip()
    if not text or not re.fullmatch(r"(?:\d+|\d*\.\d+)", text):
        raise ValueError(f"{field_name} must be a decimal number")
    numeric = float(text)
    if numeric < 0 or numeric > 1:
        raise ValueError(f"{field_name} must be between 0 and 1")
    return text


def _normalize_optional_bool_text(value: str, *, field_name: str) -> str:
    text = str(value if value is not None else "").strip().lower()
    if text in {"1", "true", "yes", "y", "on"}:
        return "true"
    if text in {"0", "false", "no", "n", "off"}:
        return "false"
    raise ValueError(f"{field_name} must be true or false")


def _normalize_option_overlay_mode(value: str) -> str:
    mode = str(value or "current").strip().lower()
    if mode not in OPTION_OVERLAY_MODES:
        raise ValueError("option_overlay_mode must be current, enabled, or disabled")
    return mode


def _normalize_option_recipe(value: str, *, field_name: str) -> str:
    text = str(value or "").strip()
    if not text or not re.fullmatch(r"[A-Za-z0-9._=-]{1,120}", text):
        raise ValueError(f"{field_name} must be a recipe slug")
    return text


def _normalize_ibit_zscore_exit_mode(value: str) -> str:
    mode = str(value or "").strip().lower()
    aliases = {
        "off": "disabled",
        "none": "disabled",
        "false": "disabled",
        "0": "disabled",
        "disable": "disabled",
        "enabled": "live",
        "shadow": "paper",
        "dry_run": "paper",
        "dry-run": "paper",
    }
    mode = aliases.get(mode, mode)
    if mode not in {"disabled", "paper", "live"}:
        raise ValueError("ibit_zscore_exit_mode must be disabled, paper, or live")
    return mode


def _normalize_symbol_text(value: str, *, field_name: str) -> str:
    text = str(value or "").strip().upper().removesuffix(".US")
    if not text or not re.fullmatch(r"[A-Z0-9.-]{1,12}", text):
        raise ValueError(f"{field_name} must be a symbol")
    return text


def _cash_only_extra_variables(args: argparse.Namespace, platform: str) -> dict[str, str]:
    mode = str(getattr(args, "cash_only_execution_mode", None) or "current").strip().lower()
    if mode not in CASH_ONLY_EXECUTION_MODES:
        raise ValueError("cash_only_execution_mode must be current, enabled, or disabled")
    if mode == "current":
        return {}
    variable = PLATFORM_CASH_ONLY_EXECUTION_VARIABLES.get(platform)
    if not variable:
        return {}
    return {variable: env_string(mode == "enabled")}


def _extract_cash_only_control_fields(extra_variables: dict[str, Any]) -> dict[str, Any]:
    controls: dict[str, Any] = {}
    if CASH_ONLY_EXECUTION_CONTROL_FIELD in extra_variables:
        controls[CASH_ONLY_EXECUTION_CONTROL_FIELD] = extra_variables.pop(CASH_ONLY_EXECUTION_CONTROL_FIELD)
    return controls


def _extract_dca_control_fields(extra_variables: dict[str, Any]) -> dict[str, Any]:
    controls: dict[str, Any] = {}
    for field_name in (DCA_MODE_CONTROL_FIELD, DCA_BASE_INVESTMENT_CONTROL_FIELD):
        if field_name in extra_variables:
            controls[field_name] = extra_variables.pop(field_name)
    return controls


def _extract_ibit_zscore_exit_control_fields(extra_variables: dict[str, Any]) -> dict[str, Any]:
    controls: dict[str, Any] = {}
    for field_name in IBIT_ZSCORE_EXIT_CONTROL_FIELDS:
        if field_name in extra_variables:
            controls[field_name] = extra_variables.pop(field_name)
    return controls


def _disabled_option_overlay_extra_variables() -> dict[str, str]:
    values = {variable: "" for variable in OPTION_OVERLAY_VARIABLES}
    values["OPTION_OVERLAY_ENABLED"] = "false"
    values["OPTION_GROWTH_OVERLAY_ENABLED"] = "false"
    values["OPTION_INCOME_OVERLAY_ENABLED"] = "false"
    return values


def _profile_bool(item: dict[str, Any], field_name: str, *, default: bool = False) -> bool:
    if item.get(field_name) is None or str(item.get(field_name)).strip() == "":
        return default
    return _normalize_optional_bool_text(item[field_name], field_name=field_name) == "true"


def _option_family_defaults(item: dict[str, Any], family: str) -> dict[str, str]:
    control_prefix = f"option_{family}_overlay"
    env_prefix = f"OPTION_{family.upper()}_OVERLAY"
    enabled = _profile_bool(item, f"{control_prefix}_enabled", default=False)
    values = {
        f"{env_prefix}_ENABLED": "true" if enabled else "false",
        f"{env_prefix}_RECIPE": "",
        f"{env_prefix}_START_USD": "",
    }
    if family == "growth":
        ratio_field = "option_growth_overlay_nav_budget_ratio"
        ratio_variable = "OPTION_GROWTH_OVERLAY_NAV_BUDGET_RATIO"
    else:
        ratio_field = "option_income_overlay_nav_risk_ratio"
        ratio_variable = "OPTION_INCOME_OVERLAY_NAV_RISK_RATIO"
    values[ratio_variable] = ""
    if not enabled:
        return values

    values[f"{env_prefix}_RECIPE"] = _normalize_option_recipe(
        item.get(f"{control_prefix}_recipe"),
        field_name=f"{control_prefix}_recipe",
    )
    values[f"{env_prefix}_START_USD"] = _normalize_nonnegative_decimal(
        item.get(f"{control_prefix}_start_usd"),
        field_name=f"{control_prefix}_start_usd",
    )
    values[ratio_variable] = _normalize_ratio_decimal(item.get(ratio_field), field_name=ratio_field)
    return values


def _load_option_overlay_profile_defaults() -> dict[str, dict[str, str]]:
    try:
        payload = json.loads(OPTION_OVERLAY_PROFILE_PATH.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"cannot read {OPTION_OVERLAY_PROFILE_PATH}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"{OPTION_OVERLAY_PROFILE_PATH} must be valid JSON") from exc
    if not isinstance(payload, list):
        raise ValueError(f"{OPTION_OVERLAY_PROFILE_PATH} must contain a strategy profile list")

    defaults: dict[str, dict[str, str]] = {}
    for item in payload:
        if not isinstance(item, dict):
            continue
        profile = str(item.get("profile") or item.get("strategy_profile") or "").strip().lower()
        if not profile:
            continue
        if not _profile_bool(item, "option_overlay_enabled", default=False):
            continue
        values = _disabled_option_overlay_extra_variables()
        values["OPTION_OVERLAY_ENABLED"] = "true"
        values.update(_option_family_defaults(item, "growth"))
        values.update(_option_family_defaults(item, "income"))
        if values["OPTION_GROWTH_OVERLAY_ENABLED"] != "true" and values["OPTION_INCOME_OVERLAY_ENABLED"] != "true":
            raise ValueError(f"{profile} option overlay is enabled without a growth or income family")
        defaults[profile] = values
    return defaults


def _option_overlay_extra_variables(args: argparse.Namespace, strategy_profile: str) -> dict[str, str]:
    mode = _normalize_option_overlay_mode(getattr(args, "option_overlay_mode", "current"))
    if mode == "current":
        return {}
    if mode == "disabled":
        return _disabled_option_overlay_extra_variables()

    defaults = _load_option_overlay_profile_defaults().get(strategy_profile)
    if not defaults:
        raise ValueError(
            "option_overlay_mode enabled is only supported for strategies with option overlay defaults"
        )
    return dict(defaults)


def _dca_extra_variables(
    args: argparse.Namespace,
    strategy_profile: str,
    controls: dict[str, Any] | None = None,
) -> dict[str, Any]:
    controls = dict(controls or {})
    is_dca_profile = strategy_profile in DCA_PROFILES
    dca_mode = args.dca_mode if str(args.dca_mode or "").strip() else controls.get(DCA_MODE_CONTROL_FIELD, "")
    dca_base_investment_usd = (
        args.dca_base_investment_usd
        if str(args.dca_base_investment_usd or "").strip()
        else controls.get(DCA_BASE_INVESTMENT_CONTROL_FIELD, "")
    )
    has_dca_mode = bool(str(dca_mode or "").strip())
    has_dca_base = bool(str(dca_base_investment_usd or "").strip())
    if not is_dca_profile:
        if has_dca_mode or has_dca_base:
            raise ValueError("DCA settings are only supported for DCA strategy profiles")
        return {variable: "" for variable in DCA_RUNTIME_VARIABLES}

    extra_variables: dict[str, Any] = {}
    if has_dca_mode:
        extra_variables[DCA_MODE_VARIABLE] = _normalize_dca_mode(dca_mode)
    if has_dca_base:
        extra_variables[DCA_BASE_INVESTMENT_VARIABLE] = _normalize_positive_decimal(
            dca_base_investment_usd,
            field_name="dca_base_investment_usd",
        )
    return extra_variables


def _reject_direct_dca_extra_variables(extra_variables: dict[str, Any]) -> None:
    provided = [
        variable
        for variable in DCA_RUNTIME_VARIABLES
        if variable in extra_variables and str(extra_variables.get(variable) or "").strip()
    ]
    if provided:
        names = ", ".join(provided)
        raise ValueError(
            f"use dca_mode and dca_base_investment_usd control fields instead of extra_variables_json for {names}"
        )


def _reject_direct_ibit_zscore_exit_extra_variables(extra_variables: dict[str, Any]) -> None:
    provided = [
        variable
        for variable in IBIT_ZSCORE_EXIT_RUNTIME_VARIABLES
        if variable in extra_variables and str(extra_variables.get(variable) or "").strip()
    ]
    if provided:
        names = ", ".join(provided)
        raise ValueError(
            "use ibit_zscore_exit_* control fields instead of extra_variables_json "
            f"for {names}"
        )


def _reject_research_only_extra_variables(extra_variables: dict[str, Any]) -> None:
    blocked = [
        name
        for name in (
            *OPTION_OVERLAY_CONTROL_FIELDS,
            *OPTION_OVERLAY_VARIABLES,
            *LEGACY_INCOME_LAYER_CONTROL_FIELDS,
            *LEGACY_INCOME_LAYER_VARIABLES,
        )
        if name in extra_variables
    ]
    if blocked:
        names = ", ".join(blocked)
        raise ValueError(
            "direct option overlay settings and legacy income controls are research-only "
            f"and are not supported by live strategy switch settings: {names}"
        )


def _ibit_zscore_exit_extra_variables(
    args: argparse.Namespace,
    strategy_profile: str,
    plugin_mode: str,
    controls: dict[str, Any] | None = None,
) -> dict[str, Any]:
    controls = dict(controls or {})
    cli_mode = str(getattr(args, "ibit_zscore_exit_mode", "") or "").strip()
    mode_value = cli_mode or controls.get("ibit_zscore_exit_mode", "")
    has_controls = bool(mode_value) or any(
        str(controls.get(field, "") or "").strip()
        for field in IBIT_ZSCORE_EXIT_CONTROL_FIELDS
        if field != "ibit_zscore_exit_mode"
    )
    has_cli_controls = any(
        str(getattr(args, attr, "") or "").strip()
        for attr in (
            "ibit_zscore_exit_parking_symbol",
            "ibit_zscore_exit_risk_reduced_exposure",
            "ibit_zscore_exit_risk_off_exposure",
            "ibit_zscore_exit_allow_outside_execution_window",
        )
    )
    is_ibit_profile = strategy_profile == IBIT_ZSCORE_EXIT_STRATEGY_PROFILE
    if not is_ibit_profile:
        if has_controls or has_cli_controls:
            raise ValueError("IBIT Z-Score exit settings are only supported for ibit_smart_dca")
        return {variable: "" for variable in IBIT_ZSCORE_EXIT_RUNTIME_VARIABLES}

    if not mode_value:
        mode = "disabled" if plugin_mode == "none" else "live"
    else:
        mode = _normalize_ibit_zscore_exit_mode(mode_value)
    if plugin_mode == "none" and mode != "disabled":
        raise ValueError("IBIT Z-Score exit live/paper modes require plugin_mode auto or custom")

    parking_symbol = (
        getattr(args, "ibit_zscore_exit_parking_symbol", "")
        or controls.get("ibit_zscore_exit_parking_symbol")
        or "BOXX"
    )
    risk_reduced_exposure = (
        getattr(args, "ibit_zscore_exit_risk_reduced_exposure", "")
        or controls.get("ibit_zscore_exit_risk_reduced_exposure")
        or "0.50"
    )
    risk_off_exposure = (
        getattr(args, "ibit_zscore_exit_risk_off_exposure", "")
        or controls.get("ibit_zscore_exit_risk_off_exposure")
        or "0.25"
    )
    allow_outside_window = (
        getattr(args, "ibit_zscore_exit_allow_outside_execution_window", "")
        or controls.get("ibit_zscore_exit_allow_outside_execution_window")
        or "true"
    )
    return {
        IBIT_ZSCORE_EXIT_ENABLED_VARIABLE: "true" if mode != "disabled" else "false",
        IBIT_ZSCORE_EXIT_MODE_VARIABLE: "paper" if mode == "disabled" else mode,
        IBIT_ZSCORE_EXIT_PARKING_SYMBOL_VARIABLE: _normalize_symbol_text(
            parking_symbol,
            field_name="ibit_zscore_exit_parking_symbol",
        ),
        IBIT_ZSCORE_EXIT_RISK_REDUCED_EXPOSURE_VARIABLE: _normalize_ratio_decimal(
            risk_reduced_exposure,
            field_name="ibit_zscore_exit_risk_reduced_exposure",
        ),
        IBIT_ZSCORE_EXIT_RISK_OFF_EXPOSURE_VARIABLE: _normalize_ratio_decimal(
            risk_off_exposure,
            field_name="ibit_zscore_exit_risk_off_exposure",
        ),
        IBIT_ZSCORE_EXIT_ALLOW_OUTSIDE_WINDOW_VARIABLE: _normalize_optional_bool_text(
            allow_outside_window,
            field_name="ibit_zscore_exit_allow_outside_execution_window",
        ),
    }


def _auto_plugin_mounts(strategy_profile: str, artifact_bucket_uri: str) -> list[dict[str, Any]]:
    prefix = artifact_bucket_uri.rstrip("/")
    mounts: list[dict[str, Any]] = []
    if strategy_profile in MARKET_REGIME_CONTROL_PROFILES:
        mounts.append(
            {
                "strategy": strategy_profile,
                "plugin": "market_regime_control",
                "signal_path": (
                    f"{prefix}/strategy-artifacts/us_equity/{strategy_profile}"
                    "/plugins/market_regime_control/latest_signal.json"
                ),
                "enabled": True,
                "expected_mode": "shadow",
                "expected_schema_version": "market_regime_control.v1",
            }
        )
    if strategy_profile == IBIT_ZSCORE_EXIT_STRATEGY_PROFILE:
        mounts.append(
            {
                "strategy": strategy_profile,
                "plugin": IBIT_ZSCORE_EXIT_PLUGIN,
                "signal_path": (
                    f"{prefix}/strategy-artifacts/us_equity/{strategy_profile}"
                    f"/plugins/{IBIT_ZSCORE_EXIT_PLUGIN}/latest_signal.json"
                ),
                "enabled": True,
                "expected_mode": "shadow",
                "expected_schema_version": "ibit_zscore_exit.v1",
            }
        )
    return mounts


def _custom_plugin_mounts(raw_json: str) -> list[dict[str, Any]]:
    text = str(raw_json or "").strip()
    if not text:
        return []
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("custom_plugin_mounts_json must be valid JSON") from exc
    if isinstance(payload, dict):
        payload = payload.get("strategy_plugins", payload.get("plugins"))
    if not isinstance(payload, list):
        raise ValueError("custom_plugin_mounts_json must be a list or object with strategy_plugins")
    return [dict(item) for item in payload]


def _plugin_mounts(args: argparse.Namespace, strategy_profile: str) -> list[dict[str, Any]]:
    mode = str(args.plugin_mode or "auto").strip().lower()
    if mode == "none":
        return []
    if mode == "auto":
        return _auto_plugin_mounts(strategy_profile, args.artifact_bucket_uri)
    if mode == "custom":
        return _custom_plugin_mounts(args.custom_plugin_mounts_json)
    raise ValueError(f"unsupported plugin_mode {args.plugin_mode!r}")


def _execution_mode_and_dry_run(raw_mode: str) -> tuple[str, bool]:
    mode = str(raw_mode or "").strip().lower()
    if mode == "live":
        return "live", False
    if mode in {"paper", "dry_run", "dry-run"}:
        return "paper", True
    raise ValueError("execution_mode must be live or paper")


def _has_enabled_plugin_mount(
    mounts: list[dict[str, Any]] | tuple[dict[str, Any], ...],
    *,
    strategy_profile: str,
    plugin: str,
) -> bool:
    return any(
        isinstance(mount, dict)
        and mount.get("strategy") == strategy_profile
        and mount.get("plugin") == plugin
        and mount.get("enabled") is True
        for mount in mounts
    )


def _scheduler_plan_for_strategy(
    strategy_profile: str,
    plugin_mounts: list[dict[str, Any]] | tuple[dict[str, Any], ...] = (),
) -> dict[str, str]:
    profile = str(strategy_profile or "").strip().lower()
    if profile == IBIT_ZSCORE_EXIT_STRATEGY_PROFILE and _has_enabled_plugin_mount(
        plugin_mounts,
        strategy_profile=profile,
        plugin=IBIT_ZSCORE_EXIT_PLUGIN,
    ):
        return dict(US_DAILY_SCHEDULER)
    scheduler = STRATEGY_SCHEDULER_PROFILES.get(profile)
    if scheduler is None:
        if profile.startswith("cn_"):
            scheduler = CN_DAILY_SCHEDULER
        elif profile.startswith("hk_"):
            scheduler = HK_DAILY_SCHEDULER
        else:
            scheduler = US_DAILY_SCHEDULER
    return dict(scheduler)


def _build_runtime_target(args: argparse.Namespace) -> dict[str, Any]:
    platform = _normalize_platform(args.platform)
    target_name = _normalize_target_name(args.target_name)
    execution_mode, dry_run_only = _execution_mode_and_dry_run(args.execution_mode)
    deployment_selector = (
        args.deployment_selector.strip()
        if args.deployment_selector
        else _deployment_selector_default(platform, target_name)
    )
    account_scope = (
        args.account_scope.strip()
        if args.account_scope
        else _account_scope_default(platform, deployment_selector)
    )
    account_selector = _split_csv(args.account_selector) or _account_selector_default(platform, account_scope)
    service_name = args.service_name.strip() if args.service_name else _default_service_name(platform, target_name)
    strategy_profile = args.strategy_profile.strip().lower()
    runtime_target: dict[str, Any] = {
        "platform_id": platform,
        "strategy_profile": strategy_profile,
        "dry_run_only": dry_run_only,
        "deployment_selector": deployment_selector,
        "account_selector": account_selector,
        "account_scope": account_scope,
        "service_name": service_name,
        "execution_mode": execution_mode,
        "scheduler": _scheduler_plan_for_strategy(strategy_profile),
    }
    execution_windows = _load_json_object(args.execution_windows_json, field_name="execution_windows_json")
    if execution_windows:
        runtime_target["execution_windows"] = execution_windows
    return runtime_target


def _build_target_entry(
    *,
    platform: str,
    runtime_target: dict[str, Any],
    mounts_variable: str,
    mounts: list[dict[str, Any]],
    extra_variables: dict[str, Any],
) -> dict[str, Any]:
    service_name = str(runtime_target["service_name"])
    entry: dict[str, Any] = {
        "service": service_name,
        "runtime_target": dict(runtime_target),
    }
    if platform == "ibkr":
        entry["ACCOUNT_GROUP"] = runtime_target["account_scope"]
    dry_run_variable = PLATFORM_DRY_RUN_VARIABLES.get(platform)
    if dry_run_variable:
        entry[dry_run_variable] = env_string(runtime_target["dry_run_only"])
    if mounts_variable:
        entry[mounts_variable] = {"strategy_plugins": mounts}
    entry.update(extra_variables)
    return entry


def _preserve_reserved_cash_fields(
    *,
    platform: str,
    current_entry: dict[str, Any],
    replacement: dict[str, Any],
) -> None:
    for variable in (
        PLATFORM_MIN_RESERVED_CASH_VARIABLES.get(platform),
        PLATFORM_RESERVED_CASH_RATIO_VARIABLES.get(platform),
        PLATFORM_CASH_ONLY_EXECUTION_VARIABLES.get(platform),
        CASH_ONLY_EXECUTION_VARIABLE,
        *INCOME_LAYER_VARIABLES,
        *OPTION_OVERLAY_VARIABLES,
        *RUNTIME_TARGET_VARIABLES,
        *DCA_RUNTIME_VARIABLES,
        *IBIT_ZSCORE_EXIT_RUNTIME_VARIABLES,
        *MARKET_SIGNAL_RUNTIME_VARIABLES,
    ):
        if variable and variable not in replacement and variable in current_entry:
            replacement[variable] = current_entry[variable]


def _patch_service_targets(
    *,
    current_payload: dict[str, Any],
    platform: str,
    runtime_target: dict[str, Any],
    mounts_variable: str,
    mounts: list[dict[str, Any]],
    extra_variables: dict[str, Any],
) -> dict[str, Any]:
    payload = dict(current_payload)
    raw_entries = payload.get("targets") if isinstance(payload.get("targets"), list) else []
    entries = [dict(item) for item in raw_entries if isinstance(item, dict)]
    service_name = str(runtime_target["service_name"])
    account_scope = str(runtime_target["account_scope"])
    replacement = _build_target_entry(
        platform=platform,
        runtime_target=runtime_target,
        mounts_variable=mounts_variable,
        mounts=mounts,
        extra_variables=extra_variables,
    )

    replaced = False
    for index, entry in enumerate(entries):
        entry_runtime_target = entry.get("runtime_target") if isinstance(entry.get("runtime_target"), dict) else {}
        candidates = {
            str(entry.get("service") or "").strip(),
            str(entry.get("service_name") or "").strip(),
            str(entry_runtime_target.get("service_name") or "").strip(),
            str(entry_runtime_target.get("account_scope") or "").strip(),
            str(entry.get("ACCOUNT_GROUP") or "").strip(),
        }
        if service_name in candidates or account_scope in candidates:
            _preserve_reserved_cash_fields(
                platform=platform,
                current_entry=entry,
                replacement=replacement,
            )
            entries[index] = {**entry, **replacement}
            replaced = True
            break

    if not replaced:
        entries.append(replacement)
    payload["targets"] = entries
    return payload


def build_switch_target(args: argparse.Namespace) -> dict[str, Any]:
    platform = _normalize_platform(args.platform)
    target_name = _normalize_target_name(args.target_name)
    variable_scope = args.variable_scope or DEFAULT_VARIABLE_SCOPE[platform]
    if variable_scope not in {"repository", "environment"}:
        raise ValueError("variable_scope must be repository or environment")
    github_environment = args.github_environment or _default_github_environment(platform, target_name, variable_scope)
    runtime_target = _build_runtime_target(args)
    mounts = _plugin_mounts(args, runtime_target["strategy_profile"])
    runtime_target["scheduler"] = _scheduler_plan_for_strategy(runtime_target["strategy_profile"], mounts)
    mounts_variable = f"{SUPPORTED_PLATFORMS[platform]['plugin_mounts_prefix']}STRATEGY_PLUGIN_MOUNTS_JSON"
    extra_variables = _parse_extra_variables(args.extra_variable, args.extra_variables_json)
    cash_only_controls = _extract_cash_only_control_fields(extra_variables)
    dca_controls = _extract_dca_control_fields(extra_variables)
    ibit_zscore_exit_controls = _extract_ibit_zscore_exit_control_fields(extra_variables)
    if cash_only_controls.get(CASH_ONLY_EXECUTION_CONTROL_FIELD):
        args.cash_only_execution_mode = str(
            cash_only_controls[CASH_ONLY_EXECUTION_CONTROL_FIELD]
        ).strip().lower()
    _reject_direct_dca_extra_variables(extra_variables)
    _reject_direct_ibit_zscore_exit_extra_variables(extra_variables)
    _reject_research_only_extra_variables(extra_variables)

    if args.set_platform_dry_run_variable:
        extra_variables[PLATFORM_DRY_RUN_VARIABLES[platform]] = env_string(runtime_target["dry_run_only"])
    if args.reserved_cash_ratio:
        extra_variables[PLATFORM_RESERVED_CASH_RATIO_VARIABLES[platform]] = args.reserved_cash_ratio
    if args.min_reserved_cash_usd:
        extra_variables[PLATFORM_MIN_RESERVED_CASH_VARIABLES[platform]] = args.min_reserved_cash_usd
    if args.income_layer_start_usd:
        extra_variables["INCOME_LAYER_START_USD"] = args.income_layer_start_usd
    if args.income_layer_max_ratio:
        extra_variables["INCOME_LAYER_MAX_RATIO"] = args.income_layer_max_ratio
    extra_variables.update(_cash_only_extra_variables(args, platform))
    extra_variables.update(_option_overlay_extra_variables(args, runtime_target["strategy_profile"]))
    extra_variables.update(_dca_extra_variables(args, runtime_target["strategy_profile"], dca_controls))
    extra_variables.update(
        _ibit_zscore_exit_extra_variables(
            args,
            runtime_target["strategy_profile"],
            str(args.plugin_mode or "auto").strip().lower(),
            ibit_zscore_exit_controls,
        )
    )

    service_targets = _load_json_from_file(
        args.existing_service_targets_json_file,
        field_name="existing_service_targets_json_file",
    )
    top_level_mounts = mounts
    plugin_mounts_variable: str | None = mounts_variable
    if service_targets:
        patched_service_targets = _patch_service_targets(
            current_payload=service_targets,
            platform=platform,
            runtime_target=runtime_target,
            mounts_variable=mounts_variable,
            mounts=mounts,
            extra_variables=extra_variables,
        )
        extra_variables = {"CLOUD_RUN_SERVICE_TARGETS_JSON": patched_service_targets}
        top_level_mounts = []
        plugin_mounts_variable = None

    target: dict[str, Any] = {
        "target_id": f"{platform}/{target_name}",
        "description": "Generated by build_runtime_switch.py for manual workflow dispatch.",
        "github": {
            "repository": platform_repository(platform),
            "variable_scope": variable_scope,
        },
        "runtime_target": runtime_target,
        "extra_variables": extra_variables,
    }
    if github_environment:
        target["github"]["environment"] = github_environment
    if plugin_mounts_variable:
        target["plugin_mounts_variable"] = plugin_mounts_variable
        target["plugin_mounts"] = top_level_mounts
    errors = validate_target(target)
    if errors:
        raise ValueError("; ".join(errors))
    return target


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", required=True, choices=sorted((*SUPPORTED_PLATFORMS, *PLATFORM_ALIASES)))
    parser.add_argument("--target-name", required=True)
    parser.add_argument("--strategy-profile", required=True)
    parser.add_argument("--execution-mode", choices=("live", "paper", "dry_run"), default="live")
    parser.add_argument("--variable-scope", choices=("repository", "environment"))
    parser.add_argument("--github-environment", default="")
    parser.add_argument("--deployment-selector", default="")
    parser.add_argument("--account-selector", default="")
    parser.add_argument("--account-scope", default="")
    parser.add_argument("--service-name", default="")
    parser.add_argument("--execution-windows-json", default="")
    parser.add_argument("--plugin-mode", choices=("auto", "none", "custom"), default="auto")
    parser.add_argument("--custom-plugin-mounts-json", default="")
    parser.add_argument("--artifact-bucket-uri", default=DEFAULT_ARTIFACT_BUCKET_URI)
    parser.add_argument("--extra-variables-json", default="", help="JSON object of non-secret extra variables")
    parser.add_argument("--extra-variable", action="append", default=[], help="NAME=VALUE non-secret extra variable")
    parser.add_argument("--reserved-cash-ratio", default="")
    parser.add_argument("--min-reserved-cash-usd", default="")
    parser.add_argument(
        "--cash-only-execution-mode",
        choices=sorted(CASH_ONLY_EXECUTION_MODES),
        default="current",
    )
    parser.add_argument("--income-layer-start-usd", default="")
    parser.add_argument("--income-layer-max-ratio", default="")
    parser.add_argument("--option-overlay-mode", choices=sorted(OPTION_OVERLAY_MODES), default="current")
    parser.add_argument("--dca-mode", default="")
    parser.add_argument("--dca-base-investment-usd", default="")
    parser.add_argument("--ibit-zscore-exit-mode", choices=("disabled", "paper", "live"), default="")
    parser.add_argument("--ibit-zscore-exit-parking-symbol", default="")
    parser.add_argument("--ibit-zscore-exit-risk-reduced-exposure", default="")
    parser.add_argument("--ibit-zscore-exit-risk-off-exposure", default="")
    parser.add_argument("--ibit-zscore-exit-allow-outside-execution-window", default="")
    parser.add_argument("--existing-service-targets-json-file", default="")
    parser.add_argument("--no-platform-dry-run-variable", dest="set_platform_dry_run_variable", action="store_false")
    parser.set_defaults(set_platform_dry_run_variable=True)
    parser.add_argument("--output", default="-", help="output path, or '-' for stdout")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        target = build_switch_target(args)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    payload = compact_json(target)
    if args.output == "-":
        print(payload)
    else:
        Path(args.output).write_text(payload + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
