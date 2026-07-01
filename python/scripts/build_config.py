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

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT / "platform-config.json"
STRATEGY_PROFILES_PATH = ROOT / "web" / "strategy-switch-console" / "strategy-profiles.example.json"
STRATEGY_PROFILES_ASSET = ROOT / "web" / "strategy-switch-console" / "strategy_profiles_asset.js"
INDEX_HTML = ROOT / "web" / "strategy-switch-console" / "index.html"


def load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return json.load(f)


def validate(config: dict) -> list[str]:
    errors: list[str] = []
    for pid, pdata in config.get("platforms", {}).items():
        if "capabilities" not in pdata:
            errors.append(f"platform {pid}: missing capabilities")
        if "default_account" not in pdata:
            errors.append(f"platform {pid}: missing default_account")
        if "supported_domains" not in pdata:
            errors.append(f"platform {pid}: missing supported_domains")
    for sid, sdata in config.get("strategies", {}).items():
        if "domain" not in sdata:
            errors.append(f"strategy {sid}: missing domain")
    return errors


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
        json.dump(strategies, f, indent=2, ensure_ascii=False)
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
    sync_script = ROOT / "python" / "scripts" / "sync_strategy_switch_page_asset.py"
    if sync_script.exists():
        subprocess.run([sys.executable, str(sync_script)], cwd=ROOT, check=True)
        print("  Ran sync_strategy_switch_page_asset.py")
    else:
        print("  WARNING: sync script not found")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build all derived config files from platform-config.json")
    parser.add_argument("--check", action="store_true", help="Only validate config, don't write files")
    args = parser.parse_args()

    config = load_config()
    errors = validate(config)
    if errors:
        print("Validation ERRORS:")
        for e in errors:
            print(f"  ❌ {e}")
        return 1
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
