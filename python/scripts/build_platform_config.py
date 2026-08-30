#!/usr/bin/env python3
"""Generate config.js from platform-config.json — single source of truth.

Reads platform-config.json and produces:
  web/strategy-switch-console/config.js

This file is imported by BOTH index.html (frontend) and worker.js (backend),
replacing the previously hardcoded platformConfig, defaultAccountOptions,
fallbackIncomeLayerDefaults, fallbackOptionOverlayDefaults, and DCA_SUPPORTED_PLATFORMS.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "platform-config.json"
TARGET = ROOT / "web" / "strategy-switch-console" / "config.js"
STRATEGY_TARGET = ROOT / "web" / "strategy-switch-console" / "strategy_profiles_asset.js"
STRATEGY_EXAMPLE_TARGET = ROOT / "web" / "strategy-switch-console" / "strategy-profiles.example.json"
RUNTIME_CATALOG_PROJECTION_TARGET = ROOT / "web" / "strategy-switch-console" / "runtime-catalog-projection.json"
RUNTIME_CATALOG_PROJECTION_SCHEMA_VERSION = "qsl.runtime_catalog_projection.v1"


def build_config_module(config: dict) -> str:
    platforms = config["platforms"]
    strategies = config["strategies"]
    domains = config.get("domains", {})
    meta = config.get("meta", {})
    runtime_authority = meta.get("runtime_authority", {}) if isinstance(meta, dict) else {}
    runtime_catalog_projection = build_runtime_catalog_projection(config)

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
            "supported_execution_modes": depl.get("supported_execution_modes", []),
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
        f"export const RUNTIME_AUTHORITY_STATUS = {json.dumps(runtime_authority, indent=2, ensure_ascii=False)};",
        "",
        f"export const RUNTIME_CATALOG_PROJECTION = {json.dumps(runtime_catalog_projection, indent=2, ensure_ascii=False)};",
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
            "runtime_enabled": sdata.get("runtime_enabled", False),
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
        return ["paper", "dry_run"]
    if isinstance(raw_modes, str):
        modes = [raw_modes.strip()]
    elif isinstance(raw_modes, list):
        modes = [str(mode).strip() for mode in raw_modes]
    elif isinstance(raw_modes, tuple):
        modes = [str(mode).strip() for mode in raw_modes]
    elif isinstance(raw_modes, set):
        modes = [str(mode).strip() for mode in sorted(raw_modes)]
    else:
        modes = ["paper", "dry_run"]
    modes = [mode for mode in modes if mode]
    return modes if modes else ["paper", "dry_run"]


def _strategy_profile_gate_fields(sdata: dict) -> dict[str, object]:
    runtime_enabled = sdata.get("runtime_enabled", False)
    lifecycle_stage = str(
        sdata.get("lifecycle_stage") or ("runtime_enabled" if runtime_enabled else "research_active")
    ).strip()
    blocked_live_reason = sdata.get("blocked_live_reason")
    can_switch_live = sdata.get(
        "can_switch_live",
        runtime_enabled and lifecycle_stage in {"live_enabled", "runtime_enabled"},
    )
    if blocked_live_reason is None and not can_switch_live:
        blocked_live_reason = lifecycle_stage or "not_runtime_enabled"
    continuity = sdata.get("live_continuity") if isinstance(sdata.get("live_continuity"), dict) else {}
    return {
        "lifecycle_stage": lifecycle_stage,
        "can_switch_live": can_switch_live,
        "allowed_execution_modes": _normalize_allowed_execution_modes(sdata.get("allowed_execution_modes")),
        "blocked_live_reason": "" if blocked_live_reason is None else str(blocked_live_reason).strip(),
        "live_continuity": {
            "eligible": continuity.get("eligible") is True,
            "allowed_platforms": list(continuity.get("allowed_platforms") or []),
        },
    }


def _config_content_sha256(config: dict) -> str:
    canonical = json.dumps(config, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build_runtime_catalog_projection(config: dict) -> dict[str, object]:
    """Project catalog gates without claiming an observed runtime state.

    This is deliberately separate from control-plane and execution-evidence
    snapshots.  A checked-in strategy catalog can describe which modes a
    workflow may consider, but cannot prove that a target is deployed, healthy,
    funded, or permitted to trade.
    """
    profiles = build_strategy_profile_entries(config)
    status_profiles = [
        {
            field: profile[field]
            for field in (
                "profile",
                "label",
                "label_en",
                "label_zh",
                "domain",
                "lifecycle_stage",
                "runtime_enabled",
                "can_switch_live",
                "allowed_execution_modes",
                "blocked_live_reason",
            )
        }
        for profile in profiles
    ]
    lifecycle_stage_counts: dict[str, int] = {}
    for profile in status_profiles:
        stage = str(profile["lifecycle_stage"])
        lifecycle_stage_counts[stage] = lifecycle_stage_counts.get(stage, 0) + 1

    meta = config.get("meta", {})
    return {
        "schema_version": RUNTIME_CATALOG_PROJECTION_SCHEMA_VERSION,
        "data_status": "catalog_only",
        "source": {
            "path": "platform-config.json",
            "content_sha256": _config_content_sha256(config),
            "catalog_as_of": meta.get("last_updated") if isinstance(meta, dict) else None,
        },
        "policy": {
            "catalog_is_runtime_observation": False,
            "catalog_can_authorize_promotion_or_trading": False,
            "historical_lifecycle_inventory_is_authoritative": False,
            "observed_state_sources": [
                "qsl_control_plane_dashboard.v1",
                "qsl_execution_evidence_dashboard.v1",
            ],
        },
        "runtime_authority": meta.get("runtime_authority", {}) if isinstance(meta, dict) else {},
        "summary": {
            "strategy_profile_count": len(status_profiles),
            "runtime_enabled_count": sum(1 for profile in status_profiles if profile["runtime_enabled"]),
            "live_switchable_count": sum(1 for profile in status_profiles if profile["can_switch_live"]),
            "lifecycle_stage_counts": dict(sorted(lifecycle_stage_counts.items())),
        },
        "strategies": status_profiles,
    }


def _generated_outputs(config: dict) -> dict[Path, str]:
    profiles = build_strategy_profile_entries(config)
    projection = build_runtime_catalog_projection(config)
    return {
        TARGET: build_config_module(config),
        STRATEGY_TARGET: (
            "// Generated by python/scripts/build_platform_config.py from platform-config.json\n"
            f"export const DEFAULT_STRATEGY_PROFILES = {json.dumps(profiles, indent=2, ensure_ascii=False)};\n"
        ),
        STRATEGY_EXAMPLE_TARGET: json.dumps(profiles, ensure_ascii=False, separators=(",", ":")) + "\n",
        RUNTIME_CATALOG_PROJECTION_TARGET: json.dumps(projection, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate strategy-switch console assets from platform-config.json")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail when the generated runtime catalog projection does not match platform-config.json",
    )
    args = parser.parse_args()
    config = json.loads(SOURCE.read_text(encoding="utf-8"))
    outputs = _generated_outputs(config)

    if args.check:
        # sync_strategy_switch_page_asset.py intentionally renders the strategy
        # JS asset with a different (but semantically equivalent) formatter.
        # The projection has one generator, so it is safe to use as a strict
        # source-freshness guard even after the full console build pipeline.
        checkable = {RUNTIME_CATALOG_PROJECTION_TARGET: outputs[RUNTIME_CATALOG_PROJECTION_TARGET]}
        stale = [path for path, expected in checkable.items() if not path.exists() or path.read_text(encoding="utf-8") != expected]
        if stale:
            for path in stale:
                print(f"Generated asset is stale: {path.relative_to(ROOT)}")
            return 1
        print("Generated runtime catalog projection matches platform-config.json")
        return 0

    for path, content in outputs.items():
        path.write_text(content, encoding="utf-8")

    print(f"Generated: {TARGET}")
    print(f"Generated: {STRATEGY_TARGET}")
    print(f"Generated: {STRATEGY_EXAMPLE_TARGET}")
    print(f"Generated: {RUNTIME_CATALOG_PROJECTION_TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
