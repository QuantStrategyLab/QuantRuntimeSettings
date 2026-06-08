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

from runtime_settings import SUPPORTED_PLATFORMS, compact_json, env_string, validate_target  # noqa: E402


DEFAULT_ARTIFACT_BUCKET_URI = "gs://qsl-runtime-logs-interactivebrokersquant"
MARKET_REGIME_CONTROL_PROFILES = frozenset(
    {
        "tqqq_growth_income",
        "global_etf_rotation",
        "russell_1000_multi_factor_defensive",
        "mega_cap_leader_rotation_top50_balanced",
    }
)
PLATFORM_DRY_RUN_VARIABLES = {
    "schwab": "SCHWAB_DRY_RUN_ONLY",
    "longbridge": "LONGBRIDGE_DRY_RUN_ONLY",
    "ibkr": "IBKR_DRY_RUN_ONLY",
    "firstrade": "FIRSTRADE_DRY_RUN_ONLY",
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
DEFAULT_VARIABLE_SCOPE = {
    "longbridge": "environment",
    "ibkr": "repository",
    "schwab": "repository",
    "firstrade": "repository",
}
DEFAULT_SERVICE_NAME = {
    "schwab": "charles-schwab-quant-service",
    "firstrade": "firstrade-quant-service",
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
    if platform == "firstrade":
        return "firstrade"
    return target_name.upper() if target_name.lower() in {"sg", "hk", "paper"} else target_name


def _account_scope_default(platform: str, deployment_selector: str) -> str:
    if platform == "firstrade":
        return "US"
    return deployment_selector


def _account_selector_default(platform: str, account_scope: str) -> list[str]:
    if platform == "firstrade":
        return ["firstrade"]
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


def _auto_plugin_mounts(strategy_profile: str, artifact_bucket_uri: str) -> list[dict[str, Any]]:
    if strategy_profile not in MARKET_REGIME_CONTROL_PROFILES:
        return []
    prefix = artifact_bucket_uri.rstrip("/")
    return [
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
    ]


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
    runtime_target: dict[str, Any] = {
        "platform_id": platform,
        "strategy_profile": args.strategy_profile.strip().lower(),
        "dry_run_only": dry_run_only,
        "deployment_selector": deployment_selector,
        "account_selector": account_selector,
        "account_scope": account_scope,
        "service_name": service_name,
        "execution_mode": execution_mode,
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
    if mounts and mounts_variable:
        entry[mounts_variable] = {"strategy_plugins": mounts}
    entry.update(extra_variables)
    return entry


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
    mounts_variable = f"{SUPPORTED_PLATFORMS[platform]['plugin_mounts_prefix']}STRATEGY_PLUGIN_MOUNTS_JSON"
    extra_variables = _parse_extra_variables(args.extra_variable, args.extra_variables_json)

    if args.set_platform_dry_run_variable:
        extra_variables[PLATFORM_DRY_RUN_VARIABLES[platform]] = env_string(runtime_target["dry_run_only"])
    if args.reserved_cash_ratio:
        extra_variables[PLATFORM_RESERVED_CASH_RATIO_VARIABLES[platform]] = args.reserved_cash_ratio
    if args.min_reserved_cash_usd:
        extra_variables[PLATFORM_MIN_RESERVED_CASH_VARIABLES[platform]] = args.min_reserved_cash_usd
    if args.income_threshold_usd:
        extra_variables["INCOME_THRESHOLD_USD"] = args.income_threshold_usd
    if args.qqqi_income_ratio:
        extra_variables["QQQI_INCOME_RATIO"] = args.qqqi_income_ratio

    service_targets = _load_json_from_file(
        args.existing_service_targets_json_file,
        field_name="existing_service_targets_json_file",
    )
    top_level_mounts = mounts
    plugin_mounts_variable: str | None = mounts_variable if mounts else None
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
            "repository": SUPPORTED_PLATFORMS[platform]["repository"],
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
    parser.add_argument("--income-threshold-usd", default="")
    parser.add_argument("--qqqi-income-ratio", default="")
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
