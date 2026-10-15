#!/usr/bin/env python3
"""Read-only drift report for broker runtime-control configuration.

The same control (on/off, dry-run, cash-only, reserved cash, risk caps) is
spread over repository variables, environment variables, secrets and per-service
JSON.  This tool builds an *effective view* per runtime target and runs a set of
independent rules over it.  It never writes anything and never reads secret
values: only secret *names* are used.

Usage:
  # 1. Collect an inventory with the GitHub CLI (read-only API calls).
  python3 runtime_control_drift_report.py collect --repo QuantStrategyLab/LongBridgePlatform > inventory.json
  # 2. Report (offline).
  python3 runtime_control_drift_report.py report inventory.json [--format json] [--fail-on high]

Reports print variable *names* and booleans only, never account selectors or
other values, so they are safe to paste into issues.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

ROOT = Path(__file__).resolve().parents[2]
RISK_POLICY_DIR = ROOT / "examples" / "risk_policies"

# Broker-specific variable names.  New brokers only need an entry here.
PLATFORM_FLAG_NAMES: dict[str, dict[str, str]] = {
    "longbridge": {"dry_run": "LONGBRIDGE_DRY_RUN_ONLY", "cash_only": "LONGBRIDGE_CASH_ONLY_EXECUTION",
                   "reserve": "LONGBRIDGE_RESERVED_CASH_RATIO"},
    "ibkr": {"dry_run": "IBKR_DRY_RUN_ONLY", "cash_only": "IBKR_CASH_ONLY_EXECUTION",
             "reserve": "IBKR_RESERVED_CASH_RATIO"},
    "schwab": {"dry_run": "SCHWAB_DRY_RUN_ONLY", "cash_only": "SCHWAB_CASH_ONLY_EXECUTION",
               "reserve": "SCHWAB_RESERVED_CASH_RATIO"},
    "firstrade": {"dry_run": "FIRSTRADE_DRY_RUN_ONLY", "cash_only": "FIRSTRADE_CASH_ONLY_EXECUTION",
                  "reserve": "FIRSTRADE_RESERVED_CASH_RATIO"},
    "binance": {"dry_run": "BINANCE_DRY_RUN"},
    "qmt": {"dry_run": "QMT_DRY_RUN_ONLY"},
}
LEGACY_CASH_ONLY = "CASH_ONLY_EXECUTION"
TARGET_JSON_NAMES = ("RUNTIME_TARGET_JSON", "CLOUD_RUN_SERVICE_TARGETS_JSON")
SAFETY_FLAG_SUFFIXES = ("_DRY_RUN_ONLY", "_DRY_RUN", "_CASH_ONLY_EXECUTION", "RUNTIME_TARGET_ENABLED")
STRICT_BOOLS = {"true": True, "false": False}
SEVERITY_ORDER = {"low": 0, "medium": 1, "high": 2}


@dataclass(frozen=True)
class Finding:
    rule: str
    severity: str
    scope: str
    message: str


@dataclass
class Scope:
    """One GitHub variable scope (repository or environment)."""

    repo: str
    environment: str | None
    variables: dict[str, str]
    secret_names: set[str]

    @property
    def label(self) -> str:
        return f"{self.repo}" + (f" env:{self.environment}" if self.environment else " (repo)")


@dataclass
class Target:
    """Effective configuration for one runtime target after GitHub precedence."""

    label: str
    platform_id: str | None
    runtime_target: dict[str, Any]
    env: dict[str, str]
    manifest_profile: str | None = None
    sources: dict[str, str] = field(default_factory=dict)


def _parse_json(value: str | None) -> Any:
    try:
        return json.loads(value) if value else None
    except json.JSONDecodeError:
        return None


def _strict_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    return STRICT_BOOLS.get(str(value).strip().lower()) if value is not None else None


def _scopes(repo: str, entry: Mapping[str, Any]) -> list[Scope]:
    scopes = [Scope(repo, None, dict(entry.get("repo_vars") or {}), set(entry.get("repo_secret_names") or []))]
    for name, env in sorted((entry.get("environments") or {}).items()):
        scopes.append(Scope(repo, name, dict(env.get("vars") or {}), set(env.get("secret_names") or [])))
    return scopes


def build_targets(repo: str, entry: Mapping[str, Any]) -> list[Target]:
    """Apply GitHub precedence (environment var > repository var) per target."""
    scopes = _scopes(repo, entry)
    repo_scope = scopes[0]
    manifest_profiles = {
        str(item.get("environment")): item.get("strategy_profile")
        for item in ((entry.get("manifest") or {}).get("targets") or [])
        if isinstance(item, Mapping)
    }
    # Only environments that declare their own target are runtime targets; other
    # environments (for example publisher/controller identities) are ignored.
    target_markers = set(TARGET_JSON_NAMES) | {"RUNTIME_TARGET_ENABLED"}
    candidates = [scope for scope in scopes[1:] if target_markers & set(scope.variables)] or [repo_scope]
    targets: list[Target] = []
    for scope in candidates:
        merged = {**repo_scope.variables, **scope.variables}
        sources = {name: ("env" if name in scope.variables and scope.environment else "repo") for name in merged}
        services = _parse_json(merged.get("CLOUD_RUN_SERVICE_TARGETS_JSON"))
        service_targets = services.get("targets") if isinstance(services, Mapping) else None
        if isinstance(service_targets, list) and service_targets:
            for index, item in enumerate(service_targets):
                if not isinstance(item, Mapping):
                    continue
                env = {**merged, **{k: v if isinstance(v, str) else json.dumps(v) for k, v in (item.get("env") or {}).items()}}
                runtime_target = dict(item.get("runtime_target") or {})
                item_sources = {**sources, **{k: "service" for k in (item.get("env") or {})}}
                targets.append(Target(
                    f"{scope.label} service#{index}", runtime_target.get("platform_id"), runtime_target, env,
                    manifest_profiles.get(str(scope.environment)), item_sources,
                ))
            continue
        runtime_target = dict(_parse_json(merged.get("RUNTIME_TARGET_JSON")) or {})
        targets.append(Target(
            scope.label, runtime_target.get("platform_id") or entry.get("platform_id"), runtime_target, merged,
            manifest_profiles.get(str(scope.environment)), sources,
        ))
    return targets


def load_risk_policies(directory: Path = RISK_POLICY_DIR) -> dict[str, Mapping[str, Any]]:
    policies: dict[str, Mapping[str, Any]] = {}
    for path in sorted(directory.rglob("*.json")) if directory.is_dir() else []:
        doc = json.loads(path.read_text(encoding="utf-8"))
        policies[str(doc.get("strategy_profile"))] = doc
    return policies


# --------------------------------------------------------------------------- rules
ScopeRule = Callable[[list[Scope]], Iterable[Finding]]
TargetRule = Callable[[Target, Mapping[str, Mapping[str, Any]]], Iterable[Finding]]


def rule_var_secret_collision(scopes: list[Scope]) -> Iterable[Finding]:
    """A name defined as both variable and secret resolves differently per workflow."""
    var_names = {name for scope in scopes for name in scope.variables}
    for scope in scopes:
        for name in sorted(scope.secret_names & var_names):
            critical = name in TARGET_JSON_NAMES or name.endswith(SAFETY_FLAG_SUFFIXES)
            yield Finding("var_secret_collision", "high" if critical else "medium", scope.label,
                          f"{name} exists as a secret here and as a variable in this repository; "
                          "workflows using `vars.X || secrets.X` and `secrets.X` can see different values")


def rule_repo_fallback_only(scopes: list[Scope]) -> Iterable[Finding]:
    """A repository value overridden in every environment is only used by env-less jobs."""
    envs = scopes[1:]
    if not envs:
        return
    repo = scopes[0]
    for name in sorted(repo.variables):
        overriding = [env for env in envs if name in env.variables]
        if len(overriding) == len(envs) and any(env.variables[name] != repo.variables[name] for env in envs):
            yield Finding("repo_fallback_only", "medium", repo.label,
                          f"{name} at repository level is shadowed by every environment; it only affects jobs "
                          "without `environment:` and is easy to misread as the account switch")


def rule_safety_flag_strict(target: Target, _: Mapping[str, Mapping[str, Any]]) -> Iterable[Finding]:
    for name, value in sorted(target.env.items()):
        if name.endswith(SAFETY_FLAG_SUFFIXES) and _strict_bool(value) is None:
            yield Finding("safety_flag_not_strict_bool", "high", target.label,
                          f"{name} is not exactly true/false; some readers treat this as live")


def rule_dry_run_disagreement(target: Target, _: Mapping[str, Mapping[str, Any]]) -> Iterable[Finding]:
    names = PLATFORM_FLAG_NAMES.get(str(target.platform_id), {})
    flag = names.get("dry_run")
    declared = _strict_bool(target.runtime_target.get("dry_run_only"))
    actual = _strict_bool(target.env.get(flag)) if flag else None
    if flag and declared is not None and actual is not None and declared != actual:
        yield Finding("dry_run_disagreement", "high", target.label,
                      f"RUNTIME_TARGET_JSON.dry_run_only={str(declared).lower()} but {flag}={str(actual).lower()}; "
                      "the environment flag wins at runtime")


def rule_cash_only_alias(target: Target, _: Mapping[str, Mapping[str, Any]]) -> Iterable[Finding]:
    flag = PLATFORM_FLAG_NAMES.get(str(target.platform_id), {}).get("cash_only")
    if not flag or flag not in target.env or LEGACY_CASH_ONLY not in target.env:
        return
    specific, legacy = _strict_bool(target.env[flag]), _strict_bool(target.env[LEGACY_CASH_ONLY])
    if specific is not None and legacy is not None and specific != legacy:
        yield Finding("cash_only_alias_disagreement", "medium", target.label,
                      f"{flag}={str(specific).lower()} overrides {LEGACY_CASH_ONLY}={str(legacy).lower()}")


def rule_strategy_profile(target: Target, _: Mapping[str, Mapping[str, Any]]) -> Iterable[Finding]:
    declared = target.runtime_target.get("strategy_profile")
    values = {"RUNTIME_TARGET_JSON": declared, "STRATEGY_PROFILE": target.env.get("STRATEGY_PROFILE"),
              "manifest": target.manifest_profile}
    present = {k: v for k, v in values.items() if v}
    if len(set(present.values())) > 1:
        yield Finding("strategy_profile_mismatch", "medium", target.label,
                      "strategy profile differs between " + ", ".join(f"{k}={v}" for k, v in sorted(present.items())))


def rule_risk_policy(target: Target, policies: Mapping[str, Mapping[str, Any]]) -> Iterable[Finding]:
    profile = target.runtime_target.get("strategy_profile")
    policy = policies.get(str(profile))
    if policy is None:
        return
    limits = target.runtime_target.get("runtime_risk_limits")
    if not isinstance(limits, Mapping):
        yield Finding("risk_limits_missing", "high", target.label,
                      f"{profile} has a reviewed risk policy but this target carries no runtime_risk_limits")
    else:
        for key in ("nominal_caps", "total_nominal_exposure_cap", "total_effective_exposure_cap", "max_positions"):
            if limits.get(key) != policy.get(key):
                yield Finding("risk_limits_drift", "high", target.label,
                              f"runtime_risk_limits.{key} differs from {policy.get('policy_id')}")
    cash = policy.get("cash_policy") or {}
    names = PLATFORM_FLAG_NAMES.get(str(target.platform_id), {})
    reserve_name = names.get("reserve")
    if reserve_name:
        raw = target.env.get(reserve_name)
        try:
            reserve = float(raw) if raw not in (None, "") else None
        except ValueError:
            reserve = None
        if reserve != cash.get("reserved_cash_ratio"):
            yield Finding("reserved_cash_drift", "high", target.label,
                          f"{reserve_name} is {'unset' if raw in (None, '') else raw} but policy requires "
                          f"{cash.get('reserved_cash_ratio')}")
    cash_flag = names.get("cash_only")
    if cash.get("cash_only") is True and cash_flag:
        effective = _strict_bool(target.env.get(cash_flag, target.env.get(LEGACY_CASH_ONLY, "true")))
        if effective is not True:
            yield Finding("cash_only_drift", "high", target.label,
                          f"policy requires cash-only but effective {cash_flag} is not true")


SCOPE_RULES: Sequence[ScopeRule] = (rule_var_secret_collision, rule_repo_fallback_only)
TARGET_RULES: Sequence[TargetRule] = (
    rule_safety_flag_strict, rule_dry_run_disagreement, rule_cash_only_alias, rule_strategy_profile, rule_risk_policy,
)


def run_rules(inventory: Mapping[str, Any], policies: Mapping[str, Mapping[str, Any]]) -> list[Finding]:
    findings: list[Finding] = []
    for repo, entry in sorted((inventory.get("repositories") or {}).items()):
        scopes = _scopes(repo, entry)
        for scope_rule in SCOPE_RULES:
            findings.extend(scope_rule(scopes))
        for target in build_targets(repo, entry):
            for target_rule in TARGET_RULES:
                findings.extend(target_rule(target, policies))
    return sorted(findings, key=lambda f: (-SEVERITY_ORDER[f.severity], f.scope, f.rule, f.message))


def render_markdown(findings: list[Finding]) -> str:
    lines = ["# Runtime-control drift report", "", f"Findings: {len(findings)}", "",
             "| Severity | Rule | Scope | Detail |", "|---|---|---|---|"]
    lines += [f"| {f.severity} | {f.rule} | {f.scope} | {f.message} |" for f in findings]
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- collect
def _gh_json(args: list[str]) -> Any:
    output = subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout
    return json.loads(output or "null")


def collect(repos: Sequence[str]) -> dict[str, Any]:
    """Read variables and secret *names* with the GitHub CLI.  Read-only."""
    inventory: dict[str, Any] = {"repositories": {}}
    for repo in repos:
        entry: dict[str, Any] = {
            "repo_vars": {v["name"]: v["value"] for v in _gh_json(["variable", "list", "-R", repo, "--json", "name,value"])},
            "repo_secret_names": [s["name"] for s in _gh_json(["secret", "list", "-R", repo, "--json", "name"])],
            "environments": {},
        }
        environments = _gh_json(["api", f"repos/{repo}/environments"]) or {}
        for env in environments.get("environments") or []:
            name = env["name"]
            entry["environments"][name] = {
                "vars": {v["name"]: v["value"] for v in _gh_json(["variable", "list", "-R", repo, "-e", name, "--json", "name,value"])},
                "secret_names": [s["name"] for s in _gh_json(["secret", "list", "-R", repo, "-e", name, "--json", "name"])],
            }
        inventory["repositories"][repo] = entry
    return inventory


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only runtime-control drift report")
    sub = parser.add_subparsers(dest="command", required=True)
    collect_parser = sub.add_parser("collect", help="collect variables and secret names with gh (read-only)")
    collect_parser.add_argument("--repo", action="append", required=True)
    report_parser = sub.add_parser("report", help="report findings for a collected inventory (offline)")
    report_parser.add_argument("inventory")
    report_parser.add_argument("--manifest", action="append", default=[], metavar="REPO=PATH",
                               help="attach a platform runtime_targets.manifest.json to a repository")
    report_parser.add_argument("--format", choices=("markdown", "json"), default="markdown")
    report_parser.add_argument("--fail-on", choices=tuple(SEVERITY_ORDER), default=None)
    args = parser.parse_args(argv)

    if args.command == "collect":
        json.dump(collect(args.repo), sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
        return 0

    inventory = json.loads(Path(args.inventory).read_text(encoding="utf-8"))
    for item in args.manifest:
        repo, _, path = item.partition("=")
        inventory["repositories"].setdefault(repo, {})["manifest"] = json.loads(Path(path).read_text(encoding="utf-8"))
    findings = run_rules(inventory, load_risk_policies())
    if args.format == "json":
        json.dump([asdict(f) for f in findings], sys.stdout, indent=2)
        sys.stdout.write("\n")
    else:
        sys.stdout.write(render_markdown(findings))
    if args.fail_on and any(SEVERITY_ORDER[f.severity] >= SEVERITY_ORDER[args.fail_on] for f in findings):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
