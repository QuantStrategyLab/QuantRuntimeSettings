#!/usr/bin/env python3
"""Unified QSL version-control command line tools.

This is the control-plane entry point for QuantStrategyLab internal version
management.  It intentionally wraps the existing compatibility checker and
internal dependency matrix generator instead of replacing them in one step.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import subprocess
import sys
import tomllib
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PROJECTS_ROOT = ROOT.parent
DEFAULT_MATRIX_PATH = ROOT / "internal_dependency_matrix.json"
DEFAULT_COMPAT_ROOT = ROOT
CHECK_QSL_COMPAT_PATH = ROOT / "scripts" / "check_qsl_compat.py"

try:  # pragma: no cover - direct script execution fallback
    from python.scripts import check_internal_dependency_matrix
except ModuleNotFoundError:  # pragma: no cover
    sys.path.insert(0, str(ROOT))
    from python.scripts import check_internal_dependency_matrix


def _load_check_qsl_compat():
    spec = importlib.util.spec_from_file_location("check_qsl_compat", CHECK_QSL_COMPAT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load checker: {CHECK_QSL_COMPAT_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(spec.name, module)
    spec.loader.exec_module(module)
    return module


check_qsl_compat = _load_check_qsl_compat()


@dataclass(frozen=True)
class RepoCheckResult:
    repo: str
    ok: bool
    issues: list[str]
    warnings: list[str]
    notes: list[str]
    repo_root: str
    bundle: str
    tier: str
    upgrade_ring: str
    enforce_bundle: bool
    checkout_branch: str | None
    default_branch: str | None
    inventory_status: str
    owner: str
    next_action: str


def _git_output(repo_dir: Path, *args: str) -> str | None:
    try:
        value = subprocess.check_output(
            ["git", "-C", str(repo_dir), *args],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    return value or None


def _checkout_context(repo_dir: Path) -> tuple[str | None, str | None]:
    """Return the local branch and configured origin default without fetching.

    A workspace report is intentionally a local-checkout view.  The optional
    mainline-only mode must therefore distinguish a feature/archive checkout
    from a locally checked-out default branch, without claiming either is
    current with remote GitHub state.
    """

    branch = _git_output(repo_dir, "symbolic-ref", "--quiet", "--short", "HEAD")
    origin_head = _git_output(repo_dir, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
    default_branch = origin_head.removeprefix("origin/") if origin_head else "main"
    return branch, default_branch


def _is_quant_repo(repo_dir: Path) -> bool:
    if not (repo_dir / ".git").exists():
        return False
    try:
        remote = subprocess.check_output(
            ["git", "-C", str(repo_dir), "remote", "get-url", "origin"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False
    prefixes = (
        "https://github.com/QuantStrategyLab/",
        "git@github.com:QuantStrategyLab/",
        "ssh://git@github.com/QuantStrategyLab/",
    )
    for prefix in prefixes:
        if remote.startswith(prefix):
            repo_name = remote[len(prefix) :].removesuffix("/")
            return bool(repo_name) and "/" not in repo_name
    return False


def iter_qsl_repos(projects_root: Path) -> list[Path]:
    repos: list[Path] = []
    for repo_dir in sorted(projects_root.iterdir()):
        if not repo_dir.is_dir() or repo_dir.name.startswith("."):
            continue
        if not (repo_dir / ".git").exists():
            continue
        if _is_quant_repo(repo_dir):
            repos.append(repo_dir)
    return repos


def check_repo(repo_root: Path, compat_root: Path) -> RepoCheckResult:
    checkout_branch, default_branch = _checkout_context(repo_root)
    if not (repo_root / "qsl.toml").exists():
        return RepoCheckResult(
            repo=repo_root.name,
            ok=False,
            issues=["missing qsl.toml for active local QuantStrategyLab repository"],
            warnings=[],
            notes=[],
            repo_root=str(repo_root),
            bundle="",
            tier="",
            upgrade_ring="",
            enforce_bundle=False,
            checkout_branch=checkout_branch,
            default_branch=default_branch,
            inventory_status="missing_qsl",
            owner="repository_maintainers",
            next_action="add qsl.toml or remove the non-active checkout from this workspace scope",
        )
    inventory_status = "configured"
    try:
        qsl_cfg = check_qsl_compat._load_qsl_config(repo_root)
    except (FileNotFoundError, ValueError, TypeError) as exc:
        ok = False
        issues = [str(exc)]
        warnings = []
        notes = []
        qsl_cfg = {"bundle": "", "tier": "", "upgrade_ring": "", "enforce_bundle": False}
        inventory_status = "invalid_qsl"
    else:
        try:
            ok, issues, warnings, notes = check_qsl_compat._check(repo_root=repo_root, compat_root=compat_root)
        except (FileNotFoundError, ValueError, TypeError) as exc:
            ok = False
            issues = [str(exc)]
            warnings = []
            notes = []
    return RepoCheckResult(
        repo=repo_root.name,
        ok=bool(ok),
        issues=list(issues),
        warnings=list(warnings),
        notes=list(notes),
        repo_root=str(repo_root),
        bundle=str(qsl_cfg["bundle"]),
        tier=str(qsl_cfg["tier"]),
        upgrade_ring=str(qsl_cfg["upgrade_ring"]),
        enforce_bundle=bool(qsl_cfg["enforce_bundle"]),
        checkout_branch=checkout_branch,
        default_branch=default_branch,
        inventory_status=inventory_status,
        owner="repository_maintainers",
        next_action=(
            "repair invalid qsl.toml before compatibility planning"
            if inventory_status == "invalid_qsl"
            else "resolve reported compatibility issues"
            if issues or warnings
            else "none"
        ),
    )


def check_all(projects_root: Path, compat_root: Path) -> list[RepoCheckResult]:
    return [check_repo(repo_root=repo, compat_root=compat_root) for repo in iter_qsl_repos(projects_root)]


def _result_payload(result: RepoCheckResult) -> dict[str, Any]:
    return {
        "repo": result.repo,
        "ok": result.ok,
        "issues": result.issues,
        "warnings": result.warnings,
        "notes": result.notes,
        "repo_root": result.repo_root,
        "bundle": result.bundle,
        "tier": result.tier,
        "upgrade_ring": result.upgrade_ring,
        "enforce_bundle": result.enforce_bundle,
        "checkout_branch": result.checkout_branch,
        "default_branch": result.default_branch,
        "is_default_branch_checkout": result.checkout_branch == result.default_branch,
        "inventory_status": result.inventory_status,
        "owner": result.owner,
        "next_action": result.next_action,
    }


def _summary_payload(results: list[RepoCheckResult]) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "total_repositories": len(results),
        "failed_repositories": sum(1 for result in results if not result.ok),
        "warning_repositories": sum(1 for result in results if result.warnings),
        "issue_count": sum(len(result.issues) for result in results),
        "warning_count": sum(len(result.warnings) for result in results),
        "repositories": [_result_payload(result) for result in results],
    }


def _load_repo_tiers(compat_root: Path) -> tuple[list[str], dict[str, str], dict[str, str]]:
    with (compat_root / "compat" / "repo-tiers.toml").open("rb") as handle:
        payload = tomllib.load(handle)
    upgrade_rings = payload.get("upgrade_rings")
    if not isinstance(upgrade_rings, dict) or not upgrade_rings:
        raise ValueError(f"repo tier manifest missing [upgrade_rings] in {compat_root / 'compat' / 'repo-tiers.toml'}")

    ring_order: list[str] = []
    ring_to_tier: dict[str, str] = {}
    for ring, tier in upgrade_rings.items():
        if not isinstance(ring, str) or not ring.strip():
            continue
        if not isinstance(tier, str) or not tier.strip():
            raise ValueError(f"repo tier manifest invalid tier for {ring}")
        ring_name = ring.strip()
        ring_order.append(ring_name)
        ring_to_tier[ring_name] = tier.strip()
    tier_to_ring = {tier: ring for ring, tier in ring_to_tier.items()}
    return ring_order, ring_to_tier, tier_to_ring


def _normalize_ring(value: str) -> str:
    ring = value.strip().lower()
    aliases = {
        "0": "ring_a",
        "ring_a": "ring_a",
        "1": "ring_b",
        "ring_b": "ring_b",
        "2": "ring_c",
        "ring_c": "ring_c",
        "3": "ring_d",
        "ring_d": "ring_d",
        "4": "ring_e",
        "ring_e": "ring_e",
    }
    return aliases.get(ring, value.strip())


def _status_bucket(result: RepoCheckResult) -> str:
    if result.issues:
        return "strict"
    if result.warnings:
        return "warning"
    return "clean"


def _issue_kind(message: str) -> str:
    if message.startswith("missing qsl.toml for active local QuantStrategyLab repository"):
        return "missing qsl.toml"
    if message.startswith("invalid qsl.tier "):
        return "invalid qsl.tier"
    if message.startswith("invalid qsl.upgrade_ring "):
        return "invalid qsl.upgrade_ring"
    if message.startswith("tier/ring mismatch "):
        return "tier/ring mismatch"
    if message.startswith("forbidden dependency direction "):
        return "forbidden dependency direction"
    if message.startswith("bundle pin mismatch for "):
        return "bundle pin mismatch"
    if message.startswith("forbidden short/invalid ref "):
        return "forbidden short/invalid ref"
    if message.startswith("forbidden ref 'main'"):
        return "forbidden ref 'main'"
    if message.startswith("legacy dependency files detected"):
        return "legacy dependency files detected"
    if message.startswith("unmanaged qsl dependency "):
        return "unmanaged qsl dependency"
    if message.startswith("non-canonical qsl.tier "):
        return "non-canonical qsl.tier"
    if message.startswith("non-canonical qsl.upgrade_ring "):
        return "non-canonical qsl.upgrade_ring"
    return "other"


def _parse_bundle_mismatch(message: str) -> tuple[str | None, str | None]:
    prefix = "bundle pin mismatch for "
    if not message.startswith(prefix):
        return None, None
    try:
        after_prefix = message[len(prefix) :]
        package, remainder = after_prefix.split(" in ", 1)
        source = remainder.split(":", 1)[0]
    except ValueError:
        return None, None
    return package.strip(), source.strip()


def _workspace_report(results: list[RepoCheckResult], compat_root: Path) -> dict[str, Any]:
    ring_order, ring_to_tier, tier_to_ring = _load_repo_tiers(compat_root)
    ring_index = {ring: idx for idx, ring in enumerate(ring_order)}
    grouped: dict[str, dict[str, Any]] = {
        ring: {
            "ring": ring,
            "tier": ring_to_tier.get(ring, "unknown"),
            "total": 0,
            "strict": 0,
            "warning": 0,
            "clean": 0,
            "repositories": [],
        }
        for ring in ring_order
    }

    issue_counts: Counter[str] = Counter()
    package_hotspots: Counter[tuple[str, str]] = Counter()

    for result in sorted(
        results,
        key=lambda item: (ring_index.get(_normalize_ring(tier_to_ring.get(item.tier, item.upgrade_ring)), len(ring_order)), item.repo),
    ):
        canonical_ring = _normalize_ring(tier_to_ring.get(result.tier, result.upgrade_ring))
        bucket = grouped.setdefault(
            canonical_ring,
            {
                "ring": canonical_ring,
                "tier": ring_to_tier.get(canonical_ring, result.tier or "unknown"),
                "total": 0,
                "strict": 0,
                "warning": 0,
                "clean": 0,
                "repositories": [],
            },
        )
        status = _status_bucket(result)
        bucket["total"] += 1
        bucket[status] += 1
        bucket["repositories"].append(
            {
                "repo": result.repo,
                "status": status,
                "issues": len(result.issues),
                "warnings": len(result.warnings),
            }
        )

        for message in result.issues + result.warnings:
            issue_counts[_issue_kind(message)] += 1
            package, source = _parse_bundle_mismatch(message)
            if package and source:
                package_hotspots[(package, source)] += 1

    rings = [grouped[ring] for ring in ring_order if ring in grouped and grouped[ring]["total"]]
    extra_rings = [grouped[ring] for ring in grouped if ring not in ring_order and grouped[ring]["total"]]

    return {
        "schema_version": 1,
        "total_repositories": len(results),
        "strict_repositories": sum(1 for result in results if result.issues),
        "warning_repositories": sum(1 for result in results if result.warnings and not result.issues),
        "clean_repositories": sum(1 for result in results if not result.issues and not result.warnings),
        "issue_counts": dict(sorted(issue_counts.items())),
        "bundle_hotspots": [
            {"package": package, "source": source, "count": count}
            for (package, source), count in package_hotspots.most_common(10)
        ],
        "rings": rings + extra_rings,
        "repositories": [_result_payload(result) for result in results],
    }


def _default_branch_results(results: list[RepoCheckResult]) -> tuple[list[RepoCheckResult], list[RepoCheckResult]]:
    included = [result for result in results if result.checkout_branch == result.default_branch]
    excluded = [result for result in results if result not in included]
    return included, excluded


def _with_workspace_scope(
    report: dict[str, Any], *, mainline_only: bool, excluded: list[RepoCheckResult]
) -> dict[str, Any]:
    report["scope"] = "local_default_branch_checkouts" if mainline_only else "all_local_checkouts"
    report["excluded_nondefault_checkouts"] = [
        {
            "repo": result.repo,
            "checkout_branch": result.checkout_branch,
            "default_branch": result.default_branch,
        }
        for result in excluded
    ]
    return report


def _dependency_convergence(
    repositories: list[dict[str, Any]], projects_root: Path, compat_root: Path
) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
    included_repositories = {item["repo"] for item in repositories}
    pins = [
        pin
        for pin in check_internal_dependency_matrix.collect_dependency_pins_from_projects(projects_root)
        if pin.consumer_repo in included_repositories
    ]
    matrix = check_internal_dependency_matrix.matrix_payload(pins)
    rendered_matrix = json.dumps(matrix, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    candidates: dict[str, dict[str, dict[str, set[str]]]] = {}
    for pin in pins:
        candidate = candidates.setdefault(pin.source_repo, {}).setdefault(
            pin.ref, {"origins": set(), "consumers": set(), "locations": set()}
        )
        candidate["origins"].add("workspace")
        candidate["consumers"].add(pin.consumer_repo)
        candidate["locations"].add(f"{pin.consumer_repo}/{pin.path}")

    authority_errors: list[str] = []
    bundle_names = sorted({item["bundle"] for item in repositories if item["bundle"]})
    for bundle_name in bundle_names:
        try:
            bundle = check_qsl_compat._load_bundle(compat_root, bundle_name)
        except (FileNotFoundError, ValueError, TypeError) as exc:
            authority_errors.append(str(exc))
            continue
        for source_repo, ref in sorted(bundle.items()):
            candidate = candidates.setdefault(source_repo, {}).setdefault(
                ref, {"origins": set(), "consumers": set(), "locations": set()}
            )
            candidate["origins"].add(f"published_bundle:{bundle_name}")

    decisions: list[dict[str, Any]] = []
    requirements = [
        "source repository gates",
        "each consumer dependency and integration gate",
        "strict QSL compatibility and dependency-matrix checks",
    ]
    for source_repo, refs in sorted(candidates.items()):
        published_refs = sorted(
            ref
            for ref, metadata in refs.items()
            if any(origin.startswith("published_bundle:") for origin in metadata["origins"])
        )
        observed_refs = sorted(
            ref for ref, metadata in refs.items() if "workspace" in metadata["origins"]
        )
        is_consistent = len(published_refs) == 1 and (not observed_refs or observed_refs == published_refs)
        decisions.append(
            {
                "source_repo": source_repo,
                "status": "CONSISTENT" if is_consistent else "HUMAN_REQUIRED",
                "published_bundle_refs": published_refs,
                "candidate_refs": [
                    {
                        "ref": ref,
                        "origins": sorted(metadata["origins"]),
                        "consumer_repositories": sorted(metadata["consumers"]),
                        "dependency_locations": sorted(metadata["locations"]),
                    }
                    for ref, metadata in sorted(refs.items())
                ],
                "consumer_repositories": sorted(
                    {consumer for metadata in refs.values() for consumer in metadata["consumers"]}
                ),
                "compatibility_test_requirements": requirements,
                "required_human_decision": (
                    None
                    if is_consistent
                    else "choose whether consumers return to a published bundle ref or authorize a new bundle cohort"
                ),
            }
        )

    matrix_summary = {
        "schema_version": matrix["schema_version"],
        "dependency_count": len(matrix["dependencies"]),
        "sha256": hashlib.sha256(rendered_matrix.encode("utf-8")).hexdigest(),
    }
    return decisions, sorted(authority_errors), matrix_summary


def _workspace_plan(
    report: dict[str, Any],
    *,
    projects_root: Path,
    compat_root: Path,
    inventory_repositories: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    phases: list[dict[str, Any]] = []
    for ring in report["rings"]:
        strict_repos = [repo for repo in ring["repositories"] if repo["status"] == "strict"]
        warning_repos = [repo for repo in ring["repositories"] if repo["status"] == "warning"]
        clean_repos = [repo for repo in ring["repositories"] if repo["status"] == "clean"]

        next_actions: list[str] = []
        if strict_repos:
            next_actions.append("先清理 strict mismatch，再推进下一 ring。")
            next_actions.extend(f"修复 {repo['repo']}（{repo['issues']} 个 issue）" for repo in strict_repos)
        elif warning_repos:
            next_actions.append("当前只有 warning；可先保持只读观察，但在 release 前需要清零。")
            next_actions.extend(f"确认 {repo['repo']} 的 warning 是否允许短期保留（{repo['warnings']} 个 warning）" for repo in warning_repos)
        else:
            next_actions.append("当前 ring 已收敛，可以作为下一 ring 的 gate。")

        phases.append(
            {
                "ring": ring["ring"],
                "tier": ring["tier"],
                "strict_repositories": strict_repos,
                "warning_repositories": warning_repos,
                "clean_repositories": clean_repos,
                "next_actions": next_actions,
            }
        )

    decisions, authority_errors, matrix_summary = _dependency_convergence(
        report["repositories"],
        projects_root=projects_root,
        compat_root=compat_root,
    )
    inventory = report["repositories"] if inventory_repositories is None else inventory_repositories
    missing_qsl = [
        {
            "repo": item["repo"],
            "owner": item["owner"],
            "next_action": item["next_action"],
        }
        for item in inventory
        if item["inventory_status"] == "missing_qsl"
    ]
    invalid_qsl = [
        {
            "repo": item["repo"],
            "owner": item["owner"],
            "next_action": item["next_action"],
        }
        for item in inventory
        if item["inventory_status"] == "invalid_qsl"
    ]
    strict_repositories = [
        {
            "repo": item["repo"],
            "issue_count": len(item["issues"]),
            "owner": item["owner"],
            "next_action": item["next_action"],
        }
        for item in inventory
        if item["issues"]
    ]
    requires_human = bool(
        strict_repositories
        or authority_errors
        or any(decision["status"] == "HUMAN_REQUIRED" for decision in decisions)
    )
    return {
        "schema_version": 1,
        "convergence_schema_version": 1,
        "decision_status": "HUMAN_REQUIRED" if requires_human else "CONSISTENT",
        "workspace_inventory": {
            "policy": "all local QuantStrategyLab origin checkouts are active in this workspace scope",
            "configured_repositories": sorted(
                item["repo"] for item in inventory if item["inventory_status"] == "configured"
            ),
            "missing_qsl": missing_qsl,
            "invalid_qsl": invalid_qsl,
            "strict_repositories": strict_repositories,
        },
        "authority_errors": authority_errors,
        "actual_dependency_matrix": matrix_summary,
        "dependency_decisions": decisions,
        "phases": phases,
        "bundle_hotspots": report["bundle_hotspots"],
        "issue_counts": report["issue_counts"],
    }


def _print_report(report: dict[str, Any]) -> None:
    print(f"Scope: {report.get('scope', 'all_local_checkouts')}")
    print(
        "QSL workspace report: "
        f"repos={report['total_repositories']} "
        f"strict={report['strict_repositories']} "
        f"warnings={report['warning_repositories']} "
        f"clean={report['clean_repositories']}"
    )
    print("Issue breakdown:")
    for kind, count in report["issue_counts"].items():
        print(f"  {kind}: {count}")
    print("Ring summary:")
    for ring in report["rings"]:
        print(
            f"  {ring['ring']} / {ring['tier']}: "
            f"total={ring['total']} strict={ring['strict']} warning={ring['warning']} clean={ring['clean']}"
        )
        repos = ", ".join(repo["repo"] for repo in ring["repositories"])
        if repos:
            print(f"    repos: {repos}")
    if report["bundle_hotspots"]:
        print("Hotspots:")
        for hotspot in report["bundle_hotspots"]:
            print(f"  {hotspot['package']} @ {hotspot['source']}: {hotspot['count']}")
    excluded = report.get("excluded_nondefault_checkouts", [])
    if excluded:
        print("Excluded non-default checkouts:")
        for item in excluded:
            print(f"  {item['repo']}: {item['checkout_branch'] or 'DETACHED'} (default {item['default_branch']})")


def _print_plan(plan: dict[str, Any]) -> None:
    print(f"Decision status: {plan['decision_status']}")
    if plan["workspace_inventory"]["missing_qsl"]:
        print("Inventory gaps:")
        for item in plan["workspace_inventory"]["missing_qsl"]:
            print(f"  - {item['repo']}: {item['next_action']} (owner: {item['owner']})")
    if plan["workspace_inventory"]["invalid_qsl"]:
        print("Invalid QSL metadata:")
        for item in plan["workspace_inventory"]["invalid_qsl"]:
            print(f"  - {item['repo']}: {item['next_action']} (owner: {item['owner']})")
    print("QSL ring-by-ring convergence plan:")
    for idx, phase in enumerate(plan["phases"], start=1):
        print(f"{idx}. {phase['ring']} / {phase['tier']}")
        for repo in phase["strict_repositories"]:
            print(f"   - strict: {repo['repo']} ({repo['issues']} issues)")
        for repo in phase["warning_repositories"]:
            print(f"   - warning: {repo['repo']} ({repo['warnings']} warnings)")
        for action in phase["next_actions"]:
            print(f"   - {action}")
    if plan["bundle_hotspots"]:
        print("Top bundle hotspots:")
        for hotspot in plan["bundle_hotspots"]:
            print(f"  - {hotspot['package']} @ {hotspot['source']}: {hotspot['count']}")


def _print_check_result(result: RepoCheckResult) -> None:
    status = "PASS" if result.ok else "FAIL"
    warning_suffix = f", warnings={len(result.warnings)}" if result.warnings else ""
    print(f"[{status}] {result.repo} issues={len(result.issues)}{warning_suffix}")
    for note in result.notes:
        print(f"  {note}")
    for issue in result.issues:
        print(f"  issue: {issue}")
    for warning in result.warnings:
        print(f"  warning: {warning}")


def _cmd_check(args: argparse.Namespace) -> int:
    result = check_repo(repo_root=args.repo_root.resolve(), compat_root=args.compat_root.resolve())
    if args.json:
        print(json.dumps(_result_payload(result), ensure_ascii=False, indent=2))
    else:
        _print_check_result(result)
    return 1 if args.strict and not result.ok else 0


def _cmd_check_all(args: argparse.Namespace) -> int:
    results = check_all(projects_root=args.projects_root.resolve(), compat_root=args.compat_root.resolve())
    payload = _summary_payload(results)
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(
            "QSL compatibility summary: "
            f"repos={payload['total_repositories']} "
            f"failed={payload['failed_repositories']} "
            f"warnings={payload['warning_repositories']} "
            f"issues={payload['issue_count']}"
        )
        for result in results:
            if not result.ok or result.warnings or args.verbose:
                _print_check_result(result)
    return 1 if args.strict and payload["failed_repositories"] else 0


def _cmd_report(args: argparse.Namespace) -> int:
    all_results = check_all(projects_root=args.projects_root.resolve(), compat_root=args.compat_root.resolve())
    results, excluded = _default_branch_results(all_results) if args.mainline_only else (all_results, [])
    report = _workspace_report(results, compat_root=args.compat_root.resolve())
    _with_workspace_scope(report, mainline_only=args.mainline_only, excluded=excluded)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        _print_report(report)
    return 0


def _cmd_plan(args: argparse.Namespace) -> int:
    all_results = check_all(projects_root=args.projects_root.resolve(), compat_root=args.compat_root.resolve())
    results, excluded = _default_branch_results(all_results) if args.mainline_only else (all_results, [])
    report = _workspace_report(results, compat_root=args.compat_root.resolve())
    _with_workspace_scope(report, mainline_only=args.mainline_only, excluded=excluded)
    plan = _workspace_plan(
        report,
        projects_root=args.projects_root.resolve(),
        compat_root=args.compat_root.resolve(),
        inventory_repositories=[_result_payload(result) for result in all_results],
    )
    plan["scope"] = report["scope"]
    plan["excluded_nondefault_checkouts"] = report["excluded_nondefault_checkouts"]
    if args.json:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
    else:
        _print_plan(plan)
    return 1 if args.strict and plan["decision_status"] == "HUMAN_REQUIRED" else 0


def _matrix_payload(projects_root: Path) -> dict[str, Any]:
    return check_internal_dependency_matrix.matrix_payload(
        check_internal_dependency_matrix.collect_dependency_pins_from_projects(projects_root)
    )


def _cmd_generate_matrix(args: argparse.Namespace) -> int:
    projects_root = args.projects_root.resolve()
    matrix_path = args.matrix.resolve()
    payload = _matrix_payload(projects_root)
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"

    if args.check:
        existing = matrix_path.read_text(encoding="utf-8") if matrix_path.exists() else ""
        ok = existing == rendered
        result = {
            "ok": ok,
            "matrix": str(matrix_path),
            "generated_dependency_count": len(payload["dependencies"]),
        }
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(
                f"internal dependency matrix {'is current' if ok else 'is stale'} "
                f"({result['generated_dependency_count']} dependencies)"
            )
        return 1 if args.strict and not ok else 0

    if args.sync:
        matrix_path.write_text(rendered, encoding="utf-8")
        if not args.json:
            print(f"synced matrix -> {matrix_path}")

    if args.json:
        print(rendered, end="")
    elif not args.sync:
        print(rendered, end="")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="QSL internal version control plane CLI.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    check = subparsers.add_parser("check", help="Check one repository against its declared QSL bundle.")
    check.add_argument("--repo-root", type=Path, default=Path("."))
    check.add_argument("--compat-root", type=Path, default=DEFAULT_COMPAT_ROOT)
    check.add_argument("--json", action="store_true")
    check.add_argument("--strict", action="store_true", help="Exit non-zero when the repo has issues.")
    check.set_defaults(func=_cmd_check)

    check_all_parser = subparsers.add_parser("check-all", help="Check all local QuantStrategyLab qsl.toml repositories.")
    check_all_parser.add_argument("--projects-root", type=Path, default=DEFAULT_PROJECTS_ROOT)
    check_all_parser.add_argument("--compat-root", type=Path, default=DEFAULT_COMPAT_ROOT)
    check_all_parser.add_argument("--json", action="store_true")
    check_all_parser.add_argument("--strict", action="store_true", help="Exit non-zero when any repo has issues.")
    check_all_parser.add_argument("--verbose", action="store_true", help="Print passing repositories too.")
    check_all_parser.set_defaults(func=_cmd_check_all)

    report = subparsers.add_parser("report", help="Summarize current QSL workspace status by ring and issue type.")
    report.add_argument("--projects-root", type=Path, default=DEFAULT_PROJECTS_ROOT)
    report.add_argument("--compat-root", type=Path, default=DEFAULT_COMPAT_ROOT)
    report.add_argument("--json", action="store_true")
    report.add_argument(
        "--mainline-only",
        action="store_true",
        help="Only include local checkouts on their configured origin default branch; never fetches or claims remote freshness.",
    )
    report.set_defaults(func=_cmd_report)

    plan = subparsers.add_parser("plan", help="Render a ring-by-ring QSL convergence plan from current workspace state.")
    plan.add_argument("--projects-root", type=Path, default=DEFAULT_PROJECTS_ROOT)
    plan.add_argument("--compat-root", type=Path, default=DEFAULT_COMPAT_ROOT)
    plan.add_argument("--json", action="store_true")
    plan.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero when inventory or dependency authority needs a human decision.",
    )
    plan.add_argument(
        "--mainline-only",
        action="store_true",
        help="Only plan against local checkouts on their configured origin default branch; never fetches or claims remote freshness.",
    )
    plan.set_defaults(func=_cmd_plan)

    matrix = subparsers.add_parser("generate-matrix", help="Generate or check the internal dependency matrix.")
    matrix.add_argument("--projects-root", type=Path, default=DEFAULT_PROJECTS_ROOT)
    matrix.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX_PATH)
    matrix.add_argument("--sync", action="store_true", help="Overwrite --matrix with generated payload.")
    matrix.add_argument("--check", action="store_true", help="Check whether --matrix equals generated payload.")
    matrix.add_argument("--json", action="store_true")
    matrix.add_argument("--strict", action="store_true", help="With --check, exit non-zero when stale.")
    matrix.set_defaults(func=_cmd_generate_matrix)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
