#!/usr/bin/env python3
"""Build pipeline: platform-config.json → all derived files.

Usage:
    python3 python/scripts/build_config.py            # full build
    python3 python/scripts/build_config.py --check    # only validate config

Adds/modifies:
    web/strategy-switch-console/strategy-profiles.example.json
    web/strategy-switch-console/strategy_profiles_asset.js
    web/strategy-switch-console/page_asset.js  (via sync script)
    platforms CSS block for index.html
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT / "platform-config.json"
STRATEGY_PROFILES_PATH = ROOT / "web" / "strategy-switch-console" / "strategy-profiles.example.json"
STRATEGY_PROFILES_ASSET = ROOT / "web" / "strategy-switch-console" / "strategy_profiles_asset.js"
INDEX_HTML = ROOT / "web" / "strategy-switch-console" / "index.html"
LIVE_CANDIDATE_QUEUE_STAGES = {"ai_monitored_candidate", "shadow_candidate", "live_candidate"}
AUTOMATION_REGISTRY_SCHEMA_VERSION = "strategy_automation_registry.v1"
CRITICAL_STRATEGY_PROFILE_FIELDS = {
    "profile",
    "domain",
    "runtime_enabled",
    "lifecycle_stage",
    "can_switch_live",
    "allowed_execution_modes",
    "blocked_live_reason",
}
SCHEDULER_FIELDS = {"timezone", "main_time", "probe_time", "precheck_time"}


def load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return json.load(f)


def validate(config: dict) -> list[str]:
    errors: list[str] = []
    scheduling = config.get("scheduling")
    scheduler_profiles = scheduling.get("profiles") if isinstance(scheduling, dict) else None
    if not isinstance(scheduler_profiles, dict) or not scheduler_profiles:
        errors.append("scheduling.profiles must be a non-empty object")
        scheduler_profiles = {}
    for profile, scheduler in scheduler_profiles.items():
        if not isinstance(scheduler, dict):
            errors.append(f"scheduler profile {profile}: must be an object")
            continue
        if set(scheduler) != SCHEDULER_FIELDS:
            errors.append(
                f"scheduler profile {profile}: fields must be {sorted(SCHEDULER_FIELDS)}"
            )
            continue
        timezone = scheduler.get("timezone")
        try:
            ZoneInfo(str(timezone or ""))
        except (ZoneInfoNotFoundError, ValueError):
            errors.append(f"scheduler profile {profile}: invalid timezone {timezone!r}")
        for field in SCHEDULER_FIELDS - {"timezone"}:
            value = scheduler.get(field)
            if not isinstance(value, str) or len(value.split()) not in {2, 5}:
                errors.append(
                    f"scheduler profile {profile}: {field} must have 2 time fields or 5 cron fields"
                )
    for pid, pdata in config.get("platforms", {}).items():
        if "capabilities" not in pdata:
            errors.append(f"platform {pid}: missing capabilities")
        if "default_account" not in pdata:
            errors.append(f"platform {pid}: missing default_account")
        if "supported_domains" not in pdata:
            errors.append(f"platform {pid}: missing supported_domains")
    domains = config.get("domains", {})
    for domain, domain_data in domains.items():
        scheduler_profile = domain_data.get("scheduler_profile")
        if not isinstance(scheduler_profile, str) or scheduler_profile not in scheduler_profiles:
            errors.append(
                f"domain {domain}: unknown scheduler_profile {scheduler_profile!r}"
            )
    for sid, sdata in config.get("strategies", {}).items():
        if "domain" not in sdata:
            errors.append(f"strategy {sid}: missing domain")
            continue
        domain_data = domains.get(sdata["domain"], {})
        strategy_scheduler_profile = sdata.get("scheduler_profile")
        if strategy_scheduler_profile is not None and not isinstance(strategy_scheduler_profile, str):
            errors.append(
                f"strategy {sid}: scheduler_profile must be a string"
            )
            scheduler_profile = None
        else:
            scheduler_profile = strategy_scheduler_profile or domain_data.get("scheduler_profile")
        if not isinstance(scheduler_profile, str) or scheduler_profile not in scheduler_profiles:
            errors.append(
                f"strategy {sid}: unknown scheduler_profile {scheduler_profile!r}"
            )
        plugin_overrides = sdata.get("scheduler_profile_by_plugin", {})
        if not isinstance(plugin_overrides, dict):
            errors.append(f"strategy {sid}: scheduler_profile_by_plugin must be an object")
        else:
            for plugin, override in plugin_overrides.items():
                if not isinstance(override, str) or override not in scheduler_profiles:
                    errors.append(
                        f"strategy {sid}: plugin {plugin} references unknown scheduler_profile {override!r}"
                    )
    return errors


def _strategy_catalog_by_profile(strategy_catalog: object | None) -> dict[str, dict]:
    if strategy_catalog is None:
        if not STRATEGY_PROFILES_PATH.exists():
            return {}
        try:
            strategy_catalog = json.loads(STRATEGY_PROFILES_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    if isinstance(strategy_catalog, dict):
        if all(isinstance(value, dict) for value in strategy_catalog.values()):
            return {str(profile): value for profile, value in strategy_catalog.items()}
        return {}
    if not isinstance(strategy_catalog, list):
        return {}

    catalog: dict[str, dict] = {}
    for item in strategy_catalog:
        if not isinstance(item, dict):
            continue
        profile = item.get("profile")
        if isinstance(profile, str) and profile.strip():
            catalog[profile] = item
    return catalog


def build_live_candidate_queue(strategy_catalog: object | None = None) -> list[dict[str, object]]:
    """Build a control-plane queue of profiles that may need live-promotion review."""
    catalog = _strategy_catalog_by_profile(strategy_catalog)
    queue: list[dict[str, object]] = []
    stage_rank = {
        "live_candidate": 0,
        "shadow_candidate": 1,
        "ai_monitored_candidate": 2,
    }

    for profile, strategy in catalog.items():
        lifecycle_stage = str(strategy.get("lifecycle_stage") or "").strip()
        if lifecycle_stage not in LIVE_CANDIDATE_QUEUE_STAGES:
            continue
        can_switch_live = strategy.get("can_switch_live") is True
        blocked_reason = str(strategy.get("blocked_live_reason") or "").strip()
        if lifecycle_stage == "live_candidate":
            recommended_action = "review_evidence_package"
        elif lifecycle_stage == "shadow_candidate":
            recommended_action = "collect_shadow_evidence"
        else:
            recommended_action = "continue_ai_monitoring"
        queue.append(
            {
                "profile": profile,
                "label": strategy.get("label_zh") or strategy.get("label") or profile,
                "domain": strategy.get("domain", ""),
                "lifecycle_stage": lifecycle_stage,
                "can_switch_live": can_switch_live,
                "allowed_execution_modes": strategy.get("allowed_execution_modes") or [],
                "blocked_live_reason": blocked_reason,
                "approval_required": not can_switch_live,
                "recommended_action": recommended_action,
            }
        )

    return sorted(queue, key=lambda item: (stage_rank.get(str(item["lifecycle_stage"]), 99), str(item["domain"]), str(item["profile"])))


def _automation_policy_for_strategy(profile: str, strategy: dict) -> dict[str, object]:
    lifecycle_stage = str(strategy.get("lifecycle_stage") or "").strip()
    can_switch_live = strategy.get("can_switch_live") is True
    runtime_enabled = strategy.get("runtime_enabled") is True
    blocked_reason = str(strategy.get("blocked_live_reason") or "").strip()
    features = strategy.get("features") if isinstance(strategy.get("features"), dict) else {}
    if runtime_enabled and can_switch_live and lifecycle_stage == "runtime_enabled":
        lane = "live_equivalent_optimization"
        triggers = ["health_degradation", "parameter_drift", "scheduled_retest", "market_regime_shift"]
        max_autonomy = "auto_pr_or_trusted_live_equivalent"
        approval_required = False
        evidence_required = ["backtest", "shadow_or_regression", "rollback_plan"]
    elif lifecycle_stage == "live_candidate":
        lane = "promotion_review"
        triggers = ["evidence_package_ready", "shadow_outperformance"]
        max_autonomy = "human_review_required"
        approval_required = True
        evidence_required = ["live_candidate_evidence", "operator_approval"]
    elif lifecycle_stage in {"shadow_candidate", "ai_monitored_candidate"}:
        lane = "shadow_research"
        triggers = ["shadow_disagreement", "web_research_signal", "scheduled_retest"]
        max_autonomy = "auto_pr_research_only"
        approval_required = True
        evidence_required = ["shadow_metrics", "risk_review"]
    else:
        lane = "research_backlog"
        triggers = ["web_research_signal", "manual_request", "scheduled_research"]
        max_autonomy = "auto_pr_research_only"
        approval_required = True
        evidence_required = ["backtest", "design_review"]
    return {
        "profile": profile,
        "label": strategy.get("label_zh") or strategy.get("label") or profile,
        "domain": strategy.get("domain", ""),
        "lifecycle_stage": lifecycle_stage,
        "automation_lane": lane,
        "max_autonomy": max_autonomy,
        "approval_required": approval_required,
        "can_switch_live": can_switch_live,
        "blocked_live_reason": blocked_reason,
        "triggers": triggers,
        "evidence_required": evidence_required,
        "position_control_sensitive": bool(features.get("combo") or features.get("option_overlay")),
    }


def build_strategy_automation_registry(config: dict | None = None) -> dict[str, object]:
    """Build strategy-level automation policy for AIAuditBridge and management UIs."""
    config = config if config is not None else load_config()
    profiles = [
        _automation_policy_for_strategy(profile, strategy)
        for profile, strategy in sorted(config.get("strategies", {}).items())
        if isinstance(strategy, dict)
    ]
    lane_counts: dict[str, int] = {}
    for item in profiles:
        lane = str(item["automation_lane"])
        lane_counts[lane] = lane_counts.get(lane, 0) + 1
    return {
        "schema_version": AUTOMATION_REGISTRY_SCHEMA_VERSION,
        "summary": {
            "strategy_profile_count": len(profiles),
            "lane_counts": lane_counts,
            "live_switchable_count": sum(1 for item in profiles if item["can_switch_live"]),
            "approval_required_count": sum(1 for item in profiles if item["approval_required"]),
        },
        "profiles": profiles,
        "guardrails": [
            "Do not auto-promote new or reconstructed strategies to live.",
            "Live-equivalent optimization still requires trusted proof before auto-merge.",
            "Position-control-sensitive changes require human review unless service proof explicitly narrows the change.",
        ],
    }


def report_strategy_profile_derivation_drift(config: dict, strategy_catalog: object | None = None) -> list[str]:
    """Report whether the generated strategy profile catalog drifts from platform-config.json."""
    expected = strategy_to_json_compat(config.get("strategies", {}))
    expected_by_profile = {entry["profile"]: entry for entry in expected}
    catalog = _strategy_catalog_by_profile(strategy_catalog)
    missing = [entry["profile"] for entry in expected if entry["profile"] not in catalog]
    errors: list[str] = []
    if missing:
        errors.append(f"strategy_profiles: missing generated profiles: {', '.join(sorted(missing))}")
    if len(catalog) != len(expected):
        errors.append(f"strategy_profiles: profile count {len(catalog)} does not match platform-config strategies {len(expected)}")
    for profile, expected_entry in expected_by_profile.items():
        actual_entry = catalog.get(profile)
        if actual_entry is None:
            continue
        for field in sorted(CRITICAL_STRATEGY_PROFILE_FIELDS):
            if actual_entry.get(field) != expected_entry.get(field):
                errors.append(
                    f"strategy_profiles: {profile}.{field}={actual_entry.get(field)!r} "
                    f"does not match platform-config value {expected_entry.get(field)!r}"
                )
                break
        if errors and errors[-1].startswith(f"strategy_profiles: {profile}."):
            break
    unexpected = sorted(set(catalog) - set(expected_by_profile))
    if unexpected:
        errors.append(f"strategy_profiles: unexpected generated profiles: {', '.join(unexpected)}")
    return errors


def build_platform_health_report(
    config: dict | None = None,
    strategy_catalog: object | None = None,
) -> dict[str, object]:
    """Build a machine-readable platform health report for scheduled automation."""
    config = config if config is not None else load_config()
    catalog = _strategy_catalog_by_profile(strategy_catalog)
    config_errors = validate(config)
    derivation_errors = report_strategy_profile_derivation_drift(config, catalog)
    live_candidate_queue = build_live_candidate_queue(catalog)
    automation_registry = build_strategy_automation_registry(config)
    runtime_enabled_profiles = [
        profile
        for profile, strategy in catalog.items()
        if strategy.get("runtime_enabled") is True and strategy.get("can_switch_live") is True
    ]
    checks = [
        {
            "name": "platform_config_schema",
            "status": "fail" if config_errors else "pass",
            "severity": "critical",
            "messages": config_errors,
        },
        {
            "name": "strategy_profile_derivation",
            "status": "fail" if derivation_errors else "pass",
            "severity": "critical",
            "messages": derivation_errors,
        },
        {
            "name": "live_candidate_queue",
            "status": "warn" if live_candidate_queue else "pass",
            "severity": "warning",
            "messages": [
                f"{len(live_candidate_queue)} profiles require promotion/shadow review"
            ]
            if live_candidate_queue
            else [],
        },
    ]
    failed_checks = [check for check in checks if check["status"] == "fail"]
    warning_checks = [check for check in checks if check["status"] == "warn"]
    status = "unhealthy" if failed_checks else "attention_required" if warning_checks else "healthy"
    recommended_action = (
        "attempt_codex_fix"
        if failed_checks
        else "review_candidates"
        if warning_checks
        else "continue"
    )
    return {
        "schema_version": "platform_health_report.v1",
        "status": status,
        "recommended_action": recommended_action,
        "checks": checks,
        "summary": {
            "platform_count": len(config.get("platforms", {})),
            "strategy_profile_count": len(catalog),
            "runtime_enabled_switchable_count": len(runtime_enabled_profiles),
            "live_candidate_queue_count": len(live_candidate_queue),
            "automation_lane_counts": automation_registry["summary"]["lane_counts"],
        },
        "live_candidate_queue": live_candidate_queue,
        "automation_registry": automation_registry,
        "codex_repair_context": {
            "safe_to_attempt": bool(failed_checks),
            "scope": "QuantRuntimeSettings platform-config and generated strategy switch assets",
            "suggested_commands": [
                "python3 python/scripts/build_config.py --check",
                "python3 python/scripts/runtime_settings.py validate",
                "python3 python/scripts/build_config.py",
                "node tests/strategy_switch_worker_validation.mjs",
            ],
            "instructions": [
                "Keep fixes limited to platform-config, generated strategy profile assets, tests, or docs unless a failing check proves a wider change is required.",
                "Do not enable live switching for research, shadow, or live_candidate profiles without an evidence package and explicit approval.",
                "If the failure affects secrets, broker credentials, or live execution permissions, stop and request human review.",
            ],
        },
    }


def strategy_to_json_compat(strategies: dict) -> list[dict]:
    """Convert internal config format to strategy-profiles.example.json format."""
    out = []
    for sid, s in sorted(strategies.items(), key=lambda x: _sort_key(x[1])):
        entry = {
            "profile": sid,
            "label": s.get("label_en", s["label"]),
            "label_en": s.get("label_en", s["label"]),
            "label_zh": s["label"],
            "domain": s["domain"],
            "runtime_enabled": s.get("runtime_enabled", True),
        }
        entry.update(_strategy_profile_gate_fields(s))
        f = s.get("features", {})
        if f.get("income_layer"):
            entry["income_layer_enabled"] = True
            defaults = s.get("income_layer_defaults", {})
            entry["income_layer_start_usd"] = defaults.get("start_usd", "250000")
            entry["income_layer_max_ratio"] = defaults.get("max_ratio", "0.55")
            if defaults.get("allocations"):
                entry["income_layer_allocations"] = defaults["allocations"]
        if f.get("option_overlay"):
            entry["option_overlay_enabled"] = True
            od = s.get("option_overlay_defaults", {})
            entry["option_overlay_live_gate"] = od.get("live_gate", "promotion_required")
            entry["option_overlay_live_status"] = od.get("live_status", "research_only")
            if od.get("growth_enabled"):
                entry["option_growth_overlay_enabled"] = True
                entry["option_growth_overlay_recipe"] = od["growth_recipe"]
                entry["option_growth_overlay_start_usd"] = od.get("growth_start_usd", "250000")
                entry["option_growth_overlay_nav_budget_ratio"] = od.get("nav_budget_ratio", 0.03)
            if od.get("income_enabled"):
                entry["option_income_overlay_enabled"] = True
                entry["option_income_overlay_recipe"] = od["income_recipe"]
                entry["option_income_overlay_start_usd"] = od.get("income_start_usd", "150000")
                entry["option_income_overlay_nav_risk_ratio"] = od.get("nav_risk_ratio", 0.01)
        if f.get("dca"):
            entry["dca_enabled"] = True
            dca_defaults = s.get("dca_defaults", {})
            entry["dca_default_mode"] = dca_defaults.get("default_mode", "fixed")
            entry["dca_default_base_investment_usd"] = dca_defaults.get("default_base_investment_usd", "1000")
        if f.get("combo"):
            entry["combo_enabled"] = True
            entry["combo_mode"] = f.get("combo_mode", "dynamic")

        out.append(entry)
    return out


def _sort_key(sdata: dict) -> tuple[int, str]:
    domain_order = {"us_equity": 0, "hk_equity": 1, "cn_equity": 2, "crypto": 3}
    return (domain_order.get(sdata.get("domain", ""), 99), sdata.get("label", ""))


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


def build_css_vars(config: dict) -> str:
    """Generate :root CSS variables block for index.html."""
    lines = []
    for pid, pdata in config.get("platforms", {}).items():
        css_var = pdata.get("css_var", "")
        if css_var:
            lines.append(f"      {css_var};")
    return "\n".join(lines) if lines else ""


def build_platform_meta_js(config: dict) -> str:
    """Generate platformMeta + capabilities + domain labels + default repos."""
    platforms = config.get("platforms", {})
    domains = config.get("domains", {})
    lines = []
    lines.append("    let platformMeta = {")
    for pid, pdata in sorted(platforms.items()):
        lines.append(
            f'      {pid}: {{ label: "{pdata["label"]}", code: "{pdata["code"]}", accent: "{pdata["accent_color"]}" }},'
        )
    lines.append("    };")
    lines.append("")
    lines.append("    const platformRepositories = {")
    for pid, pdata in sorted(platforms.items()):
        lines.append(f'      {pid}: "{pdata["repository"]}",')
    lines.append("    };")
    lines.append("    // Alias for backward compatibility")
    lines.append("    const defaultRepositories = platformRepositories;")
    lines.append("")
    lines.append("    const defaultAccountOptions = {")
    for pid, pdata in sorted(platforms.items()):
        acct = dict(pdata["default_account"])
        dep = pdata.get("deployment", {})
        # Inject service_name into each account
        if dep.get("service_name") and "service_name" not in acct:
            acct["service_name"] = dep["service_name"]
        lines.append(f"      {pid}: [{json.dumps(acct, ensure_ascii=False)}],")
    lines.append("    };")
    # Domain labels for i18n
    lines.append("")
    lines.append("    const domainLabels = {")
    for did, ddata in sorted(domains.items()):
        lines.append(f'      {did}: {{ zh: "{ddata["label_zh"]}", en: "{ddata["label_en"]}" }},')
    lines.append("    };")
    # Platform capabilities for behavior functions
    lines.append("")
    lines.append("    const platformConfig = {")
    for pid, pdata in sorted(platforms.items()):
        caps = pdata.get("capabilities", {})
        dep = pdata.get("deployment", {})
        lines.append(f"      {pid}: {{")
        lines.append(f"        dry_run_only: {'true' if dep.get('dry_run_only') else 'false'},")
        lines.append(f"        margin_policy: {'true' if caps.get('margin_policy') else 'false'},")
        lines.append(f"        reserved_cash: {'true' if caps.get('reserved_cash') else 'false'},")
        lines.append(f"        income_layer: {'true' if caps.get('income_layer') else 'false'},")
        lines.append(f"        option_overlay: {'true' if caps.get('option_overlay') else 'false'},")
        lines.append(f"        dca: {'true' if caps.get('dca') else 'false'},")
        lines.append(f'        execution_mode: "{dep.get("default_execution_mode", "live")}",')
        lines.append(f'        service_name: "{dep.get("service_name", "")}",')
        lines.append(f'        default_execution_mode: "{dep.get("default_execution_mode", "live")}"')
        lines.append("      },")
    lines.append("    };")
    return "\n".join(lines)


def write_strategy_profiles(strategies: list[dict]) -> None:
    with open(STRATEGY_PROFILES_PATH, "w") as f:
        json.dump(strategies, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"  Generated: {STRATEGY_PROFILES_PATH.relative_to(ROOT)} ({len(strategies)} profiles)")


def inject_into_index_html(config: dict) -> None:
    """Generate and inject platform JS blocks into index.html."""
    import re

    with open(INDEX_HTML) as f:
        html = f.read()

    # Generate platform JS
    js_block = build_platform_meta_js(config)

    # Remove ALL old hardcoded platform blocks (count=0 = replace all).
    for pattern in [
        r"    const defaultRepositories = \{[\s\S]*?\n    \};\n(?:\s*// Alias for backward compatibility\n\s*const defaultRepositories = platformRepositories;\n)?",
        r"    const platformRepositories = \{[\s\S]*?\n    \};\n(?:\s*// Alias for backward compatibility\n\s*const defaultRepositories = platformRepositories;\n)?",
        r"    let platformMeta = \{[\s\S]*?\n    \};\n",
        r"    const defaultAccountOptions = \{[\s\S]*?\n    \};\n",
        r"    const domainLabels = \{[\s\S]*?\n    \};\n",
        r"    const platformConfig = \{[\s\S]*?\n    \};\n",
    ]:
        html = re.sub(pattern, "", html, count=0)

    # Collapse runs of 3+ blank lines to 2 so builds are idempotent.
    html = re.sub(r"\n{4,}", "\n\n\n", html)

    # Insert generated JS: right after the <script> tag opening
    script_marker = "\n  <script>\n"
    insert_pos = html.find(script_marker)
    if insert_pos >= 0:
        eol = insert_pos + len(script_marker)
        html = html[:eol] + "\n" + js_block + "\n" + html[eol:]

    with open(INDEX_HTML, "w") as f:
        f.write(html)
    print(f"  Updated: {INDEX_HTML.relative_to(ROOT)}")


def run_sync_script() -> None:
    """Run the existing sync script to regenerate page_asset.js + strategy_profiles_asset.js."""
    build_platform_config_script = ROOT / "python" / "scripts" / "build_platform_config.py"
    if build_platform_config_script.exists():
        subprocess.run([sys.executable, str(build_platform_config_script)], cwd=ROOT, check=True)
        print("  Ran build_platform_config.py")
    inject_platform_config_script = ROOT / "python" / "scripts" / "inject_platform_config.py"
    if inject_platform_config_script.exists():
        subprocess.run([sys.executable, str(inject_platform_config_script)], cwd=ROOT, check=True)
        print("  Ran inject_platform_config.py")
    sync_script = ROOT / "python" / "scripts" / "sync_strategy_switch_page_asset.py"
    if sync_script.exists():
        subprocess.run([sys.executable, str(sync_script)], cwd=ROOT, check=True)
        print("  Ran sync_strategy_switch_page_asset.py")
    else:
        print("  WARNING: sync script not found")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build all derived config files from platform-config.json")
    parser.add_argument("--check", action="store_true", help="Only validate config, don't write files")
    parser.add_argument("--live-candidate-queue", action="store_true", help="Print live-candidate queue JSON and exit")
    parser.add_argument("--platform-health-report", action="store_true", help="Print platform health report JSON and exit")
    parser.add_argument("--automation-registry", action="store_true", help="Print strategy automation registry JSON and exit")
    args = parser.parse_args()

    config = load_config()
    if args.platform_health_report:
        report = build_platform_health_report(config)
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
        return 0 if report["status"] != "unhealthy" else 1
    if args.automation_registry:
        print(json.dumps(build_strategy_automation_registry(config), ensure_ascii=False, indent=2, sort_keys=True))
        return 0

    errors = validate(config)
    if errors:
        print("Validation ERRORS:")
        for e in errors:
            print(f"  ❌ {e}")
        return 1

    if args.live_candidate_queue:
        print(json.dumps(build_live_candidate_queue(), ensure_ascii=False, indent=2, sort_keys=True))
        return 0

    print("✅ Config validation passed")

    if args.check:
        return 0

    # Generate strategy profiles JSON
    strategies = strategy_to_json_compat(config["strategies"])
    write_strategy_profiles(strategies)

    # Inject into index.html
    inject_into_index_html(config)

    # Run sync script
    run_sync_script()

    print("\nBuild complete. Run `git diff` to review changes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
