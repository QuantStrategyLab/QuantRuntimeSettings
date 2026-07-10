#!/usr/bin/env python3
"""Validate repository QSL compatibility policy against a central bundle manifest."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - py<3.11 compatibility fallback
    import toml as tomllib  # type: ignore[import-not-found]


GITHUB_OWNER = "QuantStrategyLab"
LEGACY_TIER_ALIASES = {
    "strategy-library": "strategy-lib",
    "strategy_lib": "strategy-lib",
    "runtime-platform": "runtime",
    "runtime_plaform": "runtime",
    "runtime-ops": "ops/tooling",
    "platform-tooling": "ops/tooling",
    "ops-tooling": "ops/tooling",
    "research": "pipeline",
}
LEGACY_RING_ALIASES = {
    "0": "ring_a",
    "1": "ring_b",
    "2": "ring_c",
    "3": "ring_d",
    "4": "ring_e",
}


@dataclass(frozen=True)
class GitRef:
    repo: str
    ref: str
    source: str
    line_no: int | None


PATTERNS = (
    re.compile(
        r"git\+https://github\.com/" + re.escape(GITHUB_OWNER) + r"/(?P<repo>[A-Za-z0-9_.-]+)\.git@(?P<ref>[A-Za-z0-9_.-]+)"
    ),
    re.compile(
        r"https://github\.com/" + re.escape(GITHUB_OWNER) + r"/(?P<repo>[A-Za-z0-9_.-]+)\.git\?rev=(?P<ref>[A-Za-z0-9_.-]+)"
    ),
)


def _read_toml(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def _get_bundle(config: dict[str, Any]) -> str:
    bundle = config.get("bundle") or config.get("compat")
    if isinstance(bundle, dict):
        bundle = bundle.get("bundle")
    if not isinstance(bundle, str) or not bundle.strip():
        raise ValueError("qsl.bundle (or qsl.compat.bundle) is required")
    return bundle.strip()


def _get_upgrade_ring(config: dict[str, Any]) -> str:
    upgrade_ring = config.get("upgrade_ring", config.get("ring"))
    if upgrade_ring is None or str(upgrade_ring).strip() == "":
        raise ValueError("qsl.upgrade_ring (or qsl.ring) is required")
    return str(upgrade_ring).strip()


def _get_enforce_bundle(config: dict[str, Any]) -> bool:
    compat = config.get("compat")
    if isinstance(compat, dict) and "enforce_bundle" in compat:
        return bool(compat["enforce_bundle"])
    return bool(config.get("enforce_bundle", True))


def _compat_value(config: dict[str, Any], name: str, default: str = "") -> str:
    compat = config.get("compat")
    if isinstance(compat, dict) and name in compat:
        return str(compat.get(name, default)).strip()
    return str(config.get(name, default)).strip()


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _load_qsl_config(repo_root: Path) -> dict[str, str | bool | list[str]]:
    qsl_path = repo_root / "qsl.toml"
    if not qsl_path.exists():
        raise FileNotFoundError(f"missing qsl.toml: {qsl_path}")

    payload = _read_toml(qsl_path)
    config = payload.get("qsl", payload)
    if not isinstance(config, dict):
        raise TypeError("qsl section must be a table")

    bundle = _get_bundle(config)

    tier = config.get("tier")
    if not isinstance(tier, str) or not tier.strip():
        raise ValueError("qsl.tier is required")

    upgrade_ring = _get_upgrade_ring(config)

    allow_legacy = bool(config.get("allow_legacy", False))
    legacy_reason = str(config.get("legacy_reason", "")).strip()
    enforce_bundle = _get_enforce_bundle(config)
    exception_owner = _compat_value(config, "owner")
    exception_expires_at = _compat_value(config, "expires_at")
    exception_next_action = _compat_value(config, "next_action")
    live_constraint_files = _string_list(config.get("live_constraint_files"))
    compat = config.get("compat")
    if isinstance(compat, dict):
        live_constraint_files.extend(_string_list(compat.get("live_constraint_files")))

    return {
        "bundle": bundle,
        "tier": tier.strip(),
        "upgrade_ring": upgrade_ring,
        "allow_legacy": allow_legacy,
        "legacy_reason": legacy_reason,
        "enforce_bundle": enforce_bundle,
        "owner": exception_owner,
        "expires_at": exception_expires_at,
        "next_action": exception_next_action,
        "live_constraint_files": sorted(set(live_constraint_files)),
        "qsl_path": qsl_path.as_posix(),
    }


def _load_bundle(compat_root: Path, bundle: str) -> dict[str, str]:
    bundle_path = compat_root / "compat" / "bundles" / f"{bundle}.toml"
    if not bundle_path.exists():
        raise FileNotFoundError(f"bundle manifest not found: {bundle_path}")

    payload = _read_toml(bundle_path)
    repos = payload.get("repos")
    if not isinstance(repos, dict) or not repos:
        raise ValueError(f"bundle manifest missing [repos] in {bundle_path}")

    parsed: dict[str, str] = {}
    for repo_name, ref in repos.items():
        if not isinstance(repo_name, str) or not repo_name.strip():
            continue
        if not isinstance(ref, str) or not ref.strip():
            raise ValueError(f"bundle manifest invalid ref for {repo_name}")
        parsed[repo_name.strip()] = ref.strip()

    return parsed


def _load_repo_tier_policy(compat_root: Path) -> tuple[set[str], dict[str, str], set[tuple[str, str]]]:
    manifest_path = compat_root / "compat" / "repo-tiers.toml"
    payload = _read_toml(manifest_path)

    tiers = payload.get("tiers")
    if not isinstance(tiers, dict) or not tiers:
        raise ValueError(f"repo tier manifest missing [tiers] in {manifest_path}")
    canonical_tiers: set[str] = set()
    for name, meta in tiers.items():
        if isinstance(meta, dict) and str(meta.get("name") or "").strip():
            canonical_tiers.add(str(meta["name"]).strip())
        elif isinstance(name, str) and name.strip():
            canonical_tiers.add(name.strip())

    upgrade_rings = payload.get("upgrade_rings")
    if not isinstance(upgrade_rings, dict) or not upgrade_rings:
        raise ValueError(f"repo tier manifest missing [upgrade_rings] in {manifest_path}")
    ring_to_tier: dict[str, str] = {}
    for ring, tier in upgrade_rings.items():
        ring_name = str(ring or "").strip()
        tier_name = str(tier or "").strip()
        if not ring_name or not tier_name:
            continue
        ring_to_tier[ring_name] = tier_name

    allowed_directions: set[tuple[str, str]] = set()
    upgrade_rules = payload.get("upgrade_rules")
    if isinstance(upgrade_rules, dict):
        allow_drift = upgrade_rules.get("allow_drift")
        if isinstance(allow_drift, list):
            for item in allow_drift:
                consumer_tier, _, dependency_tier = str(item or "").partition(":")
                consumer_name = consumer_tier.strip()
                dependency_name = dependency_tier.strip()
                if consumer_name and dependency_name:
                    allowed_directions.add((consumer_name, dependency_name))

    return canonical_tiers, ring_to_tier, allowed_directions


def _canonical_tier(value: str) -> str:
    normalized = value.strip()
    return LEGACY_TIER_ALIASES.get(normalized, normalized)


def _canonical_ring(value: str) -> str:
    normalized = value.strip().lower()
    return LEGACY_RING_ALIASES.get(normalized, value.strip())


def _resolve_repo_declared_tier(repo_root: Path) -> str | None:
    qsl_path = repo_root / "qsl.toml"
    if not qsl_path.exists():
        return None
    try:
        payload = _read_toml(qsl_path)
    except Exception:
        return None
    config = payload.get("qsl", payload)
    if not isinstance(config, dict):
        return None
    tier = config.get("tier")
    if not isinstance(tier, str) or not tier.strip():
        return None
    return _canonical_tier(tier)


def _validate_repo_taxonomy(
    *,
    repo_root: Path,
    compat_root: Path,
    tier: str,
    upgrade_ring: str,
    issues: list[str],
    warnings: list[str],
) -> str:
    canonical_tiers, ring_to_tier, _ = _load_repo_tier_policy(compat_root)
    canonical_tier = _canonical_tier(tier)
    canonical_ring = _canonical_ring(upgrade_ring)

    if canonical_tier not in canonical_tiers:
        issues.append(
            f"invalid qsl.tier '{tier}' in {repo_root / 'qsl.toml'}; allowed: {', '.join(sorted(canonical_tiers))}"
        )
        return canonical_tier
    if canonical_ring not in ring_to_tier:
        issues.append(
            f"invalid qsl.upgrade_ring '{upgrade_ring}' in {repo_root / 'qsl.toml'}; allowed: {', '.join(sorted(ring_to_tier))}"
        )
        return canonical_tier

    expected_tier = ring_to_tier[canonical_ring]
    if canonical_tier != expected_tier:
        issues.append(
            f"tier/ring mismatch in {repo_root / 'qsl.toml'}: tier={tier} upgrade_ring={upgrade_ring} "
            f"resolves to {canonical_tier}/{canonical_ring}, expected tier {expected_tier}"
        )
    if tier.strip() != canonical_tier:
        warnings.append(f"non-canonical qsl.tier '{tier}' in {repo_root / 'qsl.toml'}; use '{canonical_tier}'")
    if upgrade_ring.strip() != canonical_ring:
        warnings.append(
            f"non-canonical qsl.upgrade_ring '{upgrade_ring}' in {repo_root / 'qsl.toml'}; use '{canonical_ring}'"
        )
    return canonical_tier


def _validate_dependency_direction(
    *,
    consumer_repo: str,
    consumer_tier: str,
    pin: GitRef,
    compat_root: Path,
    issues: list[str],
) -> None:
    _, _, allowed_directions = _load_repo_tier_policy(compat_root)
    dependency_repo_root = compat_root.parent / pin.repo
    dependency_tier = _resolve_repo_declared_tier(dependency_repo_root)
    if not dependency_tier or dependency_tier == consumer_tier:
        return
    if (consumer_tier, dependency_tier) in allowed_directions:
        return
    issues.append(
        f"forbidden dependency direction {consumer_repo}({consumer_tier}) -> "
        f"{pin.repo}({dependency_tier}) in {pin.source}:{pin.line_no}"
    )


def _extract_git_refs(path: Path) -> list[GitRef]:
    refs: list[GitRef] = []
    if not path.exists():
        return refs

    for index, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        for pattern in PATTERNS:
            for match in pattern.finditer(line):
                refs.append(
                    GitRef(
                        repo=match.group("repo"),
                        ref=match.group("ref"),
                        source=f"{path.name}",
                        line_no=index,
                    )
                )

    return refs


def _gather_repo_refs(repo_root: Path) -> list[GitRef]:
    refs = []
    refs.extend(_extract_git_refs(repo_root / "pyproject.toml"))
    refs.extend(_extract_git_refs(repo_root / "uv.lock"))
    return refs


def _gather_legacy_refs(repo_root: Path) -> list[GitRef]:
    refs = []
    for legacy in ("requirements.txt", "constraints.txt"):
        refs.extend(_extract_git_refs(repo_root / legacy))
    return refs


def _is_full_sha(value: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-f]{40}", value.lower()))


def _is_main_ref(value: str) -> bool:
    return value.lower() == "main"


def _check(repo_root: Path, compat_root: Path) -> tuple[bool, list[str], list[str], list[str]]:
    issues: list[str] = []
    warnings: list[str] = []
    notes: list[str] = []

    qsl_cfg = _load_qsl_config(repo_root)
    bundle = str(qsl_cfg["bundle"])
    tier = str(qsl_cfg["tier"])
    upgrade_ring = str(qsl_cfg["upgrade_ring"])
    allow_legacy = bool(qsl_cfg["allow_legacy"])
    enforce_bundle = bool(qsl_cfg["enforce_bundle"])
    legacy_reason = str(qsl_cfg["legacy_reason"])
    exception_owner = str(qsl_cfg["owner"])
    exception_expires_at = str(qsl_cfg["expires_at"])
    exception_next_action = str(qsl_cfg["next_action"])
    live_constraint_files = set(qsl_cfg["live_constraint_files"]) if isinstance(qsl_cfg["live_constraint_files"], list) else set()
    qsl_path = str(qsl_cfg["qsl_path"])

    notes.append(f"qsl={qsl_path}")
    notes.append(f"bundle={bundle}")
    notes.append(f"tier={tier}")
    notes.append(f"upgrade_ring={upgrade_ring}")
    notes.append(f"enforce_bundle={enforce_bundle}")
    if legacy_reason:
        notes.append("legacy_reason=" + legacy_reason)
    if exception_owner:
        notes.append("owner=" + exception_owner)
    if exception_expires_at:
        notes.append("expires_at=" + exception_expires_at)
    if exception_next_action:
        notes.append("next_action=" + exception_next_action)
    if live_constraint_files:
        notes.append("live_constraint_files=" + ",".join(sorted(live_constraint_files)))

    if not enforce_bundle:
        _validate_bundle_exception_metadata(
            owner=exception_owner,
            expires_at=exception_expires_at,
            next_action=exception_next_action,
            warnings=warnings,
        )

    canonical_tier = _validate_repo_taxonomy(
        repo_root=repo_root,
        compat_root=compat_root,
        tier=tier,
        upgrade_ring=upgrade_ring,
        issues=issues,
        warnings=warnings,
    )

    bundle_refs = _load_bundle(compat_root, bundle)

    if not allow_legacy:
        for legacy_file in ("requirements.txt", "constraints.txt"):
            if (repo_root / legacy_file).exists():
                issues.append(f"legacy file forbidden: {legacy_file}")
    else:
        legacy_refs = _gather_legacy_refs(repo_root)
        if legacy_refs:
            static_legacy_refs = [ref for ref in legacy_refs if ref.source not in live_constraint_files]
            if static_legacy_refs and not legacy_reason:
                warnings.append("legacy dependency files detected but allowed by qsl.allow_legacy=true")
            for legacy_ref in legacy_refs:
                if legacy_ref.repo not in bundle_refs:
                    issues.append(
                        f"unmanaged qsl dependency in {legacy_ref.source}:{legacy_ref.line_no}: "
                        f"{legacy_ref.repo}@{legacy_ref.ref}"
                    )
                    continue
                if legacy_ref.source in live_constraint_files:
                    _validate_live_ref(legacy_ref, issues, warnings, enforce_bundle)
                else:
                    _validate_ref(legacy_ref, bundle_refs[legacy_ref.repo], issues, warnings, enforce_bundle)
                    _validate_dependency_direction(
                        consumer_repo=repo_root.name,
                        consumer_tier=canonical_tier,
                        pin=legacy_ref,
                        compat_root=compat_root,
                        issues=issues,
                    )

    discovered = _gather_repo_refs(repo_root)
    for pin in discovered:
        if pin.repo not in bundle_refs:
            issues.append(f"unmanaged qsl dependency in {pin.source}:{pin.line_no}: {pin.repo}@{pin.ref}")
            continue
        expected_ref = bundle_refs[pin.repo]
        _validate_ref(pin, expected_ref, issues, warnings, enforce_bundle)
        _validate_dependency_direction(
            consumer_repo=repo_root.name,
            consumer_tier=canonical_tier,
            pin=pin,
            compat_root=compat_root,
            issues=issues,
        )

    return (len(issues) == 0, issues, warnings, notes)


def _validate_bundle_exception_metadata(*, owner: str, expires_at: str, next_action: str, warnings: list[str]) -> None:
    missing = [
        field
        for field, value in (("owner", owner), ("expires_at", expires_at), ("next_action", next_action))
        if not value
    ]
    if missing:
        warnings.append("enforce_bundle=false missing exception metadata: " + ", ".join(missing))
    if expires_at:
        try:
            expiry = date.fromisoformat(expires_at)
        except ValueError:
            warnings.append("enforce_bundle=false expires_at must use YYYY-MM-DD")
        else:
            if expiry < date.today():
                warnings.append(f"enforce_bundle=false exception expired on {expires_at}")


def _validate_ref(pin: GitRef, expected_ref: str, issues: list[str], warnings: list[str], enforce_bundle: bool) -> None:
    if _is_main_ref(pin.ref):
        issues.append(f"forbidden ref 'main' in {pin.source}:{pin.line_no}: {pin.repo}")
        return
    if not _is_full_sha(pin.ref):
        message = f"forbidden short/invalid ref '{pin.ref}' in {pin.source}:{pin.line_no}: {pin.repo}"
        if enforce_bundle:
            issues.append(message)
        else:
            warnings.append(message)
        return
    if pin.ref != expected_ref:
        message = (
            f"bundle pin mismatch for {pin.repo} in {pin.source}:{pin.line_no}: "
            f"expected {expected_ref}, found {pin.ref}"
        )
        if enforce_bundle:
            issues.append(message)
        else:
            warnings.append(message)


def _validate_live_ref(pin: GitRef, issues: list[str], warnings: list[str], enforce_bundle: bool) -> None:
    if _is_main_ref(pin.ref):
        issues.append(f"forbidden ref 'main' in {pin.source}:{pin.line_no}: {pin.repo}")
        return
    if not _is_full_sha(pin.ref):
        message = f"forbidden short/invalid ref '{pin.ref}' in {pin.source}:{pin.line_no}: {pin.repo}"
        if enforce_bundle:
            issues.append(message)
        else:
            warnings.append(message)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Check repo QSL compatibility against the central manifest.")
    parser.add_argument("--repo-root", default=".", type=Path, help="Repository root to check")
    parser.add_argument(
        "--compat-root",
        type=Path,
        default=None,
        help="Path to QuantRuntimeSettings checkout (defaults to checker script parent)",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON payload")
    parser.add_argument("--non-strict", action="store_true", help="Exit 0 even when issues exist")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    repo_root = args.repo_root.resolve()
    compat_root = args.compat_root
    if compat_root is None:
        compat_root = Path(__file__).resolve().parents[1]
    else:
        compat_root = compat_root.resolve()

    try:
        ok, issues, warnings, notes = _check(repo_root=repo_root, compat_root=compat_root)
    except (FileNotFoundError, ValueError, TypeError) as exc:
        if args.json:
            payload = {"ok": False, "issues": [str(exc)], "repo_root": str(repo_root), "compat_root": str(compat_root)}
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print(f"[qsl-compat] ERROR: {exc}")
        return 2

    if args.json:
        print(
            json.dumps(
                {
                    "ok": ok,
                    "issues": issues,
                    "warnings": warnings,
                    "notes": notes,
                    "repo_root": str(repo_root),
                    "compat_root": str(compat_root),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(f"Repository: {repo_root.name}")
        for note in notes:
            print(note)
        if issues:
            print("Issues:")
            for issue in issues:
                print(f"- {issue}")
        if warnings:
            print("Warnings:")
            for warning in warnings:
                print(f"- {warning}")
        print(f"Result: {'pass' if ok else 'fail'}")

    if issues and not args.non_strict:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
