#!/usr/bin/env python3
"""Generate config.js from platform-config.json — single source of truth.

Reads platform-config.json and produces:
  web/strategy-switch-console/config.js

This file is imported by BOTH index.html (frontend) and worker.js (backend),
replacing the previously hardcoded platformConfig, defaultAccountOptions,
fallbackIncomeLayerDefaults, fallbackOptionOverlayDefaults, and DCA_SUPPORTED_PLATFORMS.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "platform-config.json"
TARGET = ROOT / "web" / "strategy-switch-console" / "config.js"
STRATEGY_TARGET = ROOT / "web" / "strategy-switch-console" / "strategy_profiles_asset.js"
STRATEGY_EXAMPLE_TARGET = ROOT / "web" / "strategy-switch-console" / "strategy-profiles.example.json"


def build_config_module(config: dict) -> str:
    platforms = config["platforms"]
    strategies = config["strategies"]
    domains = config.get("domains", {})

    # ── platformConfig (replaces hardcoded in index.html) ──
    platform_config = {}
    default_accounts = {}
    repositories = {}
    dcaplat = []
    variable_scopes = {}

    for pid, pdata in platforms.items():
        caps = pdata["capabilities"]
        depl = pdata["deployment"]
        platform_config[pid] = {
            "dry_run_only": depl.get("dry_run_only", False),
            "margin_policy": caps.get("margin_policy", False),
            "reserved_cash": caps.get("reserved_cash", False),
            "income_layer": caps.get("income_layer", False),
            "option_overlay": caps.get("option_overlay", False),
            "dca": caps.get("dca", False),
            "execution_mode": depl.get("default_execution_mode", "live"),
            "service_name": depl.get("service_name", ""),
            "default_execution_mode": depl.get("default_execution_mode", "live"),
        }
        if caps.get("dca"):
            dcaplat.append(pid)
        repositories[pid] = pdata["repository"]
        variable_scopes[pid] = pdata.get("variable_scope", "repository")

        # default account options
        acct = pdata.get("default_account", {})
        entry = {
            "key": acct.get("key", pid),
            "label": acct.get("label", pdata.get("label", pid)),
            "target_name": acct.get("target_name", acct.get("key", pid)),
            "supported_domains": acct.get("supported_domains", pdata.get("supported_domains", [])),
            "cash_currency": acct.get("cash_currency", "USD"),
        }
        for fld in (
            "default_strategy_profile",
            "service_name",
            "account_scope",
            "deployment_selector",
            "account_selector",
            "default_execution_mode",
            "min_reserved_cash_usd",
            "reserved_cash_ratio",
            "cash_only_execution_mode",
            "dca_mode",
            "dca_base_investment_usd",
        ):
            if fld in acct:
                entry[fld] = acct[fld]
        if "service_name" not in entry:
            entry["service_name"] = depl.get("service_name", "")
        if "default_execution_mode" not in entry:
            entry["default_execution_mode"] = depl.get("default_execution_mode", "live")
        default_accounts[pid] = [entry]

    # ── strategy features ──
    income_layer_defaults = {}
    option_overlay_defaults = {}
    strategy_features = {}
    dca_profile_defaults = {}

    for sid, sdata in strategies.items():
        feat = sdata.get("features", {})
        strategy_features[sid] = {
            "income_layer": feat.get("income_layer", False),
            "option_overlay": feat.get("option_overlay", False),
            "dca": feat.get("dca", False),
            "combo": feat.get("combo", False),
        }

        inc = sdata.get("income_layer_defaults")
        if inc:
            income_layer_defaults[sid] = {
                "startUsd": int(inc.get("start_usd", 0)),
                "maxRatio": str(inc.get("max_ratio", "")),
                "allocations": inc.get("allocations", {}),
            }

        opt = sdata.get("option_overlay_defaults")
        if opt:
            families = []
            if opt.get("growth_enabled"):
                families.append(
                    {
                        "family": "growth",
                        "recipe": opt["growth_recipe"],
                        "startUsd": opt["growth_start_usd"],
                        "ratio": str(opt.get("nav_budget_ratio", "")),
                        "ratioKind": "budget",
                    }
                )
            if opt.get("income_enabled"):
                families.append(
                    {
                        "family": "income",
                        "recipe": opt["income_recipe"],
                        "startUsd": opt["income_start_usd"],
                        "ratio": str(opt.get("nav_risk_ratio", "")),
                        "ratioKind": "risk",
                    }
                )
            option_overlay_defaults[sid] = {
                "liveGate": opt.get("live_gate", ""),
                "liveStatus": opt.get("live_status", ""),
                "families": families,
            }

        dca = sdata.get("dca_defaults")
        if dca:
            dca_profile_defaults[sid] = {
                "defaultMode": dca.get("default_mode", "fixed"),
                "defaultBaseInvestmentUsd": str(dca.get("default_base_investment_usd", "1000")),
            }

    # ── domain labels ──
    domain_labels = {}
    for did, ddata in domains.items():
        domain_labels[did] = {
            "zh": ddata.get("label_zh", did),
            "en": ddata.get("label_en", did),
        }

    # ── reserved cash variable names ──
    min_cash_vars = {}
    ratio_vars = {}
    var_prefixes = {
        "longbridge": "LONGBRIDGE",
        "ibkr": "IBKR",
        "schwab": "SCHWAB",
        "firstrade": "FIRSTRADE",
    }
    for pid, prefix in var_prefixes.items():
        min_cash_vars[pid] = f"{prefix}_MIN_RESERVED_CASH_USD"
        ratio_vars[pid] = f"{prefix}_RESERVED_CASH_RATIO"

    # ── Generate JS module ──
    lines = [
        "// Generated by python/scripts/build_platform_config.py; single source of truth.",
        "// Source: platform-config.json",
        "",
        f"export const PLATFORM_CONFIG = {json.dumps(platform_config, indent=2, ensure_ascii=False)};",
        "",
        f"export const DEFAULT_ACCOUNT_OPTIONS = {json.dumps(default_accounts, indent=2, ensure_ascii=False)};",
        "",
        f"export const PLATFORM_REPOSITORIES = {json.dumps(repositories, indent=2, ensure_ascii=False)};",
        "",
        f"export const DCA_SUPPORTED_PLATFORMS = new Set({json.dumps(dcaplat)});",
        "",
        f"export const DEFAULT_VARIABLE_SCOPES = {json.dumps(variable_scopes, indent=2, ensure_ascii=False)};",
        "",
        f"export const DOMAIN_LABELS = {json.dumps(domain_labels, indent=2, ensure_ascii=False)};",
        "",
        f"export const FALLBACK_INCOME_LAYER_DEFAULTS = {json.dumps(income_layer_defaults, indent=2, ensure_ascii=False)};",
        "",
        f"export const FALLBACK_OPTION_OVERLAY_DEFAULTS = {json.dumps(option_overlay_defaults, indent=2, ensure_ascii=False)};",
        "",
        f"export const DCA_PROFILE_DEFAULTS = {json.dumps(dca_profile_defaults, indent=2, ensure_ascii=False)};",
        "",
        f"export const STRATEGY_FEATURES = {json.dumps(strategy_features, indent=2, ensure_ascii=False)};",
        "",
        f"export const PLATFORM_MIN_RESERVED_CASH_VARIABLES = {json.dumps(min_cash_vars, indent=2, ensure_ascii=False)};",
        "",
        f"export const PLATFORM_RESERVED_CASH_RATIO_VARIABLES = {json.dumps(ratio_vars, indent=2, ensure_ascii=False)};",
        "",
    ]
    return "\n".join(lines)


def build_strategy_profiles(config: dict) -> str:
    """Generate strategy_profiles_asset.js — the strategy catalog."""
    profiles = build_strategy_profile_entries(config)
    payload = (
        "// Generated by python/scripts/build_platform_config.py from platform-config.json\n"
        f"export const DEFAULT_STRATEGY_PROFILES = {json.dumps(profiles, indent=2, ensure_ascii=False)};\n"
    )
    return payload


def build_strategy_profile_entries(config: dict) -> list[dict]:
    """Collect strategy profile entries from platform-config.json."""
    strategies = config["strategies"]
    profiles = []
    for sid, sdata in strategies.items():
        feat = sdata.get("features", {})
        entry = {
            "profile": sid,
            "label": sdata.get("label", sid),
            "label_en": sdata.get("label_en", sid),
            "label_zh": sdata.get("label", sid),
            "domain": sdata.get("domain", ""),
            "runtime_enabled": sdata.get("runtime_enabled", True),
            "income_layer_enabled": feat.get("income_layer", False),
            "option_overlay_enabled": feat.get("option_overlay", False),
            "combo_enabled": feat.get("combo", False),
        }
        entry.update(_strategy_profile_gate_fields(sdata))
        if feat.get("combo"):
            entry["combo_mode"] = feat.get("combo_mode", "dynamic")
        inc = sdata.get("income_layer_defaults")
        if inc:
            entry["income_layer_start_usd"] = str(inc.get("start_usd", ""))
            entry["income_layer_max_ratio"] = str(inc.get("max_ratio", ""))
            entry["income_layer_allocations"] = inc.get("allocations", {})
        opt = sdata.get("option_overlay_defaults")
        if opt:
            entry["option_overlay_live_gate"] = opt.get("live_gate", "")
            entry["option_overlay_live_status"] = opt.get("live_status", "")
            if opt.get("growth_enabled"):
                entry["option_growth_overlay_enabled"] = True
                entry["option_growth_overlay_recipe"] = opt["growth_recipe"]
                entry["option_growth_overlay_start_usd"] = opt["growth_start_usd"]
                entry["option_growth_overlay_nav_budget_ratio"] = str(opt.get("nav_budget_ratio", ""))
            if opt.get("income_enabled"):
                entry["option_income_overlay_enabled"] = True
                entry["option_income_overlay_recipe"] = opt["income_recipe"]
                entry["option_income_overlay_start_usd"] = opt["income_start_usd"]
                entry["option_income_overlay_nav_risk_ratio"] = str(opt.get("nav_risk_ratio", ""))
        dca = sdata.get("dca_defaults")
        if dca or feat.get("dca"):
            entry["dca_enabled"] = True
            entry["dca_default_mode"] = (dca or {}).get("default_mode", "fixed")
            entry["dca_default_base_investment_usd"] = str((dca or {}).get("default_base_investment_usd", "1000"))
        profiles.append(entry)
    return profiles


def _normalize_allowed_execution_modes(raw_modes: object) -> list[str]:
    if raw_modes is None:
        return ["live", "paper", "dry_run"]
    if isinstance(raw_modes, str):
        modes = [raw_modes.strip()]
    elif isinstance(raw_modes, list):
        modes = [str(mode).strip() for mode in raw_modes]
    elif isinstance(raw_modes, tuple):
        modes = [str(mode).strip() for mode in raw_modes]
    elif isinstance(raw_modes, set):
        modes = [str(mode).strip() for mode in sorted(raw_modes)]
    else:
        modes = ["live", "paper", "dry_run"]
    modes = [mode for mode in modes if mode]
    return modes if modes else ["live", "paper", "dry_run"]


def _strategy_profile_gate_fields(sdata: dict) -> dict[str, object]:
    runtime_enabled = sdata.get("runtime_enabled", True)
    lifecycle_stage = str(
        sdata.get("lifecycle_stage") or ("runtime_enabled" if runtime_enabled else "research_backtest_only")
    ).strip()
    blocked_live_reason = sdata.get("blocked_live_reason")
    can_switch_live = sdata.get("can_switch_live", runtime_enabled and lifecycle_stage == "runtime_enabled")
    if blocked_live_reason is None and not can_switch_live:
        blocked_live_reason = lifecycle_stage or "not_runtime_enabled"
    return {
        "lifecycle_stage": lifecycle_stage,
        "can_switch_live": can_switch_live,
        "allowed_execution_modes": _normalize_allowed_execution_modes(sdata.get("allowed_execution_modes")),
        "blocked_live_reason": "" if blocked_live_reason is None else str(blocked_live_reason).strip(),
    }


def main() -> int:
    config = json.loads(SOURCE.read_text(encoding="utf-8"))

    # Generate config.js
    module = build_config_module(config)
    TARGET.write_text(module, encoding="utf-8")

    # Generate strategy_profiles_asset.js and keep strategy-profiles.example.json aligned.
    profiles = build_strategy_profile_entries(config)
    STRATEGY_TARGET.write_text(
        "// Generated by python/scripts/build_platform_config.py from platform-config.json\n"
        f"export const DEFAULT_STRATEGY_PROFILES = {json.dumps(profiles, indent=2, ensure_ascii=False)};\n",
        encoding="utf-8",
    )
    STRATEGY_EXAMPLE_TARGET.write_text(
        json.dumps(profiles, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    print(f"Generated: {TARGET}")
    print(f"Generated: {STRATEGY_TARGET}")
    print(f"Generated: {STRATEGY_EXAMPLE_TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
