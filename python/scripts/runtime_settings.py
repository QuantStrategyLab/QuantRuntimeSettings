#!/usr/bin/env python3
"""Validate and render QuantStrategyLab runtime target settings."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parents[2]
LOCAL_TARGETS_DIR = ROOT / "local" / "targets"
EXAMPLE_TARGETS_DIR = ROOT / "examples" / "targets"
LOCAL_POLICY_PATH = ROOT / "local" / "policy.json"
PLATFORM_CONFIG_PATH = ROOT / "platform-config.json"

SUPPORTED_PLATFORMS = {
    "schwab": {"plugin_mounts_prefix": "SCHWAB_", "repository": "QuantStrategyLab/CharlesSchwabPlatform"},
    "longbridge": {"plugin_mounts_prefix": "LONGBRIDGE_", "repository": "QuantStrategyLab/LongBridgePlatform"},
    "ibkr": {"plugin_mounts_prefix": "IBKR_", "repository": "QuantStrategyLab/InteractiveBrokersPlatform"},
    "firstrade": {"plugin_mounts_prefix": "FIRSTRADE_", "repository": "QuantStrategyLab/FirstradePlatform"},
    "qmt": {"plugin_mounts_prefix": "QMT_", "repository": "QuantStrategyLab/QmtPlatform"},
    "binance": {"plugin_mounts_prefix": "BINANCE_", "repository": "QuantStrategyLab/BinancePlatform"},
}
PLATFORM_REPOSITORY_ENV = {
    "schwab": "RUNTIME_SETTINGS_SCHWAB_REPO",
    "longbridge": "RUNTIME_SETTINGS_LONGBRIDGE_REPO",
    "ibkr": "RUNTIME_SETTINGS_IBKR_REPO",
    "firstrade": "RUNTIME_SETTINGS_FIRSTRADE_REPO",
    "qmt": "RUNTIME_SETTINGS_QMT_REPO",
    "binance": "RUNTIME_SETTINGS_BINANCE_REPO",
}
RUNTIME_REQUIRED_FIELDS = (
    "platform_id",
    "strategy_profile",
    "dry_run_only",
    "deployment_selector",
    "account_selector",
    "account_scope",
    "service_name",
    "execution_mode",
)
WINDOW_MODES = {
    "precheck": {"notify_only", "dry_run"},
    "execution": {"live", "paper", "dry_run"},
}
SCHEDULER_FIELDS = frozenset({"timezone", "main_time", "probe_time", "precheck_time"})
MARKET_FIELDS = ("market", "market_calendar", "market_timezone")
STRATEGY_RELEASE_REQUIRED_FIELDS = (
    "release_id",
    "manifest_sha256",
    "strategy_revision",
    "config_sha256",
    "risk_policy_sha256",
    "evidence_sha256",
    "plugin_bundle_sha256",
    "effective_session",
)
STRATEGY_RELEASE_DIGEST_FIELDS = frozenset(
    {
        "manifest_sha256",
        "config_sha256",
        "risk_policy_sha256",
        "evidence_sha256",
        "plugin_bundle_sha256",
    }
)
STRATEGY_RELEASE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$")
SHA256_PATTERN = re.compile(r"^(?:sha256:)?[0-9a-fA-F]{64}$")
LIVE_CONTINUITY_STATES = frozenset(
    {
        "ACTIVE_LKG",
        "ACTIVE_REDUCED",
        "RECONCILE_ONLY",
        "RISK_REDUCTION_ONLY",
        "PAUSED",
        "ROLLBACK_LKG",
    }
)
LIVE_CONTINUITY_BASELINE_KINDS = frozenset({"legacy_authorized", "release_attested"})
LIVE_CONTINUITY_FIELDS = frozenset(
    {
        "state",
        "baseline_kind",
        "baseline_id",
        "baseline_target_sha256",
        "captured_at",
    }
)
LIVE_CONTINUITY_BASELINE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$")
GENERATED_VARIABLES = {"RUNTIME_TARGET_JSON", "STRATEGY_PROFILE"}
SECRET_MARKERS = ("PASSWORD", "PRIVATE_KEY", "TOKEN", "API_KEY", "ACCESS_KEY", "CLIENT_SECRET", "SECRET")
LEGACY_INCOME_LAYER_VARIABLES = frozenset(
    {
        "INCOME_THRESHOLD_USD",
        "QQQI_INCOME_RATIO",
        "INCOME_LAYER_QQQI_WEIGHT",
        "INCOME_LAYER_SPYI_WEIGHT",
    }
)
OPTION_OVERLAY_VARIABLES = frozenset(
    {
        "OPTION_OVERLAY_ENABLED",
        "OPTION_GROWTH_OVERLAY_ENABLED",
        "OPTION_GROWTH_OVERLAY_RECIPE",
        "OPTION_GROWTH_OVERLAY_START_USD",
        "OPTION_GROWTH_OVERLAY_NAV_BUDGET_RATIO",
        "OPTION_INCOME_OVERLAY_ENABLED",
        "OPTION_INCOME_OVERLAY_RECIPE",
        "OPTION_INCOME_OVERLAY_START_USD",
        "OPTION_INCOME_OVERLAY_NAV_RISK_RATIO",
    }
)
OPTION_OVERLAY_ENABLED_VARIABLES = frozenset(
    {
        "OPTION_OVERLAY_ENABLED",
        "OPTION_GROWTH_OVERLAY_ENABLED",
        "OPTION_INCOME_OVERLAY_ENABLED",
    }
)
OPTION_OVERLAY_RECIPE_VARIABLES = frozenset(
    {
        "OPTION_GROWTH_OVERLAY_RECIPE",
        "OPTION_INCOME_OVERLAY_RECIPE",
    }
)
OPTION_OVERLAY_AMOUNT_VARIABLES = frozenset(
    {
        "OPTION_GROWTH_OVERLAY_START_USD",
        "OPTION_INCOME_OVERLAY_START_USD",
    }
)
OPTION_OVERLAY_RATIO_VARIABLES = frozenset(
    {
        "OPTION_GROWTH_OVERLAY_NAV_BUDGET_RATIO",
        "OPTION_INCOME_OVERLAY_NAV_RISK_RATIO",
    }
)
RESEARCH_ONLY_EXTRA_VARIABLES = LEGACY_INCOME_LAYER_VARIABLES
PLATFORM_DRY_RUN_VARIABLES = {
    "schwab": "SCHWAB_DRY_RUN_ONLY",
    "longbridge": "LONGBRIDGE_DRY_RUN_ONLY",
    "ibkr": "IBKR_DRY_RUN_ONLY",
    "firstrade": "FIRSTRADE_DRY_RUN_ONLY",
    "binance": "BINANCE_DRY_RUN",
}


@dataclass(frozen=True)
class Assignment:
    target_id: str
    repository: str
    variable_scope: str
    environment: str | None
    name: str
    value: str

    @property
    def deletes_variable(self) -> bool:
        return self.value == ""

    def gh_command(self, *, redact_body: bool = False, redact_metadata: bool = False) -> list[str]:
        repository = redacted_value() if redact_metadata else self.repository
        if self.deletes_variable:
            command = ["gh", "variable", "delete", self.name, "--repo", repository]
        else:
            body = redacted_value() if redact_body else self.value
            command = ["gh", "variable", "set", self.name, "--repo", repository, "--body", body]
        if self.variable_scope == "environment":
            environment = redacted_value() if redact_metadata else (self.environment or "")
            command.extend(["--env", environment])
        return command

    def shell_command(self, *, redact_body: bool = False, redact_metadata: bool = False) -> str:
        return " ".join(
            shlex.quote(part) for part in self.gh_command(redact_body=redact_body, redact_metadata=redact_metadata)
        )


def redacted_value() -> str:
    return "<redacted>"


def assignment_payload(assignment: Assignment, *, redact_values: bool = False) -> dict[str, Any]:
    payload = {
        "target_id": assignment.target_id,
        "repository": assignment.repository,
        "variable_scope": assignment.variable_scope,
        "environment": assignment.environment,
        "name": assignment.name,
        "action": "delete" if assignment.deletes_variable else "set",
        "value": redacted_value() if redact_values else assignment.value,
    }
    if redact_values:
        payload["value_redacted"] = True
    return payload


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def runtime_target_fingerprint(runtime_target: dict[str, Any]) -> str:
    """Fingerprint a frozen target excluding only its current continuity state."""

    payload = dict(runtime_target)
    payload.pop("live_continuity", None)
    encoded = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def env_string(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return compact_json(value)
    if value is None:
        return ""
    return str(value)


def is_repository_name(value: str) -> bool:
    if not isinstance(value, str) or "/" not in value or len(value) > 160:
        return False
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-")
    parts = value.split("/", 1)
    return all(part and set(part) <= allowed for part in parts)


def platform_repositories(env: dict[str, str] | None = None) -> dict[str, str]:
    env = env or os.environ
    repositories = {platform: config["repository"] for platform, config in SUPPORTED_PLATFORMS.items()}
    raw_json = str(env.get("RUNTIME_SETTINGS_PLATFORM_REPOSITORIES_JSON") or "").strip()
    if raw_json:
        try:
            payload = json.loads(raw_json)
        except json.JSONDecodeError as exc:
            raise ValueError("RUNTIME_SETTINGS_PLATFORM_REPOSITORIES_JSON must be valid JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError("RUNTIME_SETTINGS_PLATFORM_REPOSITORIES_JSON must be a JSON object")
        for platform, repository in payload.items():
            if platform not in SUPPORTED_PLATFORMS:
                raise ValueError(f"unsupported platform repository override: {platform}")
            repository = str(repository or "").strip()
            if not is_repository_name(repository):
                raise ValueError(f"repository override for {platform} must be owner/repo")
            repositories[platform] = repository

    for platform, env_name in PLATFORM_REPOSITORY_ENV.items():
        repository = str(env.get(env_name) or "").strip()
        if not repository:
            continue
        if not is_repository_name(repository):
            raise ValueError(f"{env_name} must be owner/repo")
        repositories[platform] = repository
    return repositories


def platform_repository(platform: str, env: dict[str, str] | None = None) -> str:
    if platform not in SUPPORTED_PLATFORMS:
        raise ValueError(f"unsupported platform: {platform}")
    return platform_repositories(env)[platform]


def platform_settings_activation(platform: str) -> str:
    if platform not in SUPPORTED_PLATFORMS:
        raise ValueError(f"unsupported platform: {platform}")
    try:
        payload = json.loads(PLATFORM_CONFIG_PATH.read_text(encoding="utf-8"))
        value = payload["platforms"][platform]["deployment"]["settings_activation"]
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError(f"platform {platform} settings_activation is not configured") from exc
    value = str(value or "").strip()
    if not value:
        raise ValueError(f"platform {platform} settings_activation is not configured")
    return value


def discover_target_paths(paths: list[str]) -> list[Path]:
    if paths:
        return [Path(path).resolve() for path in paths]
    local_targets = sorted(LOCAL_TARGETS_DIR.glob("*/*.json"))
    if local_targets:
        return local_targets
    return sorted(EXAMPLE_TARGETS_DIR.glob("*/*.json"))


def load_target(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_local_policy() -> dict[str, Any]:
    if not LOCAL_POLICY_PATH.exists():
        return {}
    with LOCAL_POLICY_PATH.open("r", encoding="utf-8") as handle:
        policy = json.load(handle)
    if not isinstance(policy, dict):
        raise ValueError("local/policy.json must contain a JSON object")
    return policy


def load_platform_config() -> dict[str, Any]:
    if not PLATFORM_CONFIG_PATH.exists():
        return {}
    with PLATFORM_CONFIG_PATH.open("r", encoding="utf-8") as handle:
        config = json.load(handle)
    return config if isinstance(config, dict) else {}


def target_path_id(path: Path) -> str | None:
    relative = None
    for base in (LOCAL_TARGETS_DIR, EXAMPLE_TARGETS_DIR):
        try:
            relative = path.resolve().relative_to(base)
            break
        except ValueError:
            continue
    if relative is None:
        return None
    if relative.suffix != ".json" or len(relative.parts) != 2:
        return None
    stem = relative.stem.removesuffix(".example")
    return f"{relative.parent.as_posix()}/{stem}"


def is_secret_variable_name(name: str) -> bool:
    upper_name = name.upper()
    allowed_secret_pointer_suffixes = (
        "_SECRET_ID",
        "_SECRET_NAME",
        "_SECRET_REF",
        "_SECRET_RESOURCE",
        "_SECRET_RESOURCE_NAME",
        "_SECRET_VERSION",
    )
    if upper_name.endswith(allowed_secret_pointer_suffixes):
        return False
    return any(marker in upper_name for marker in SECRET_MARKERS)


def validate_github(target: dict[str, Any], errors: list[str]) -> None:
    github = target.get("github")
    if not isinstance(github, dict):
        errors.append("github must be an object")
        return

    repository = github.get("repository")
    if not isinstance(repository, str) or "/" not in repository:
        errors.append("github.repository must be owner/repo")

    scope = github.get("variable_scope")
    if scope not in {"repository", "environment"}:
        errors.append("github.variable_scope must be repository or environment")
    if scope == "environment" and not str(github.get("environment") or "").strip():
        errors.append("github.environment is required for environment variable scope")
    if scope == "repository" and github.get("environment"):
        errors.append("github.environment must be omitted for repository variable scope")


def validate_runtime_target(target: dict[str, Any], errors: list[str]) -> None:
    runtime_target = target.get("runtime_target")
    if not isinstance(runtime_target, dict):
        errors.append("runtime_target must be an object")
        return

    for field in RUNTIME_REQUIRED_FIELDS:
        if field not in runtime_target:
            errors.append(f"runtime_target.{field} is required")

    platform_id = runtime_target.get("platform_id")
    if platform_id not in SUPPORTED_PLATFORMS:
        errors.append(f"runtime_target.platform_id is unsupported: {platform_id!r}")

    strategy_profile = runtime_target.get("strategy_profile")
    if not isinstance(strategy_profile, str) or not strategy_profile.strip():
        errors.append("runtime_target.strategy_profile must be a non-empty string")

    if not isinstance(runtime_target.get("dry_run_only"), bool):
        errors.append("runtime_target.dry_run_only must be boolean")

    account_selector = runtime_target.get("account_selector")
    if not isinstance(account_selector, list) or not account_selector:
        errors.append("runtime_target.account_selector must be a non-empty list")
    elif not all(isinstance(item, str) and item.strip() for item in account_selector):
        errors.append("runtime_target.account_selector must only contain non-empty strings")

    execution_mode = runtime_target.get("execution_mode")
    if execution_mode not in {"live", "paper", "dry_run"}:
        errors.append("runtime_target.execution_mode must be live, paper, or dry_run")
    else:
        dry_run_only = runtime_target.get("dry_run_only")
        if execution_mode == "live" and dry_run_only is not False:
            errors.append("runtime_target.execution_mode live requires dry_run_only false")
        if execution_mode == "dry_run" and dry_run_only is not True:
            errors.append("runtime_target.execution_mode dry_run requires dry_run_only true")
        validate_runtime_target_strategy_policy(runtime_target, errors)

    execution_windows = runtime_target.get("execution_windows")
    if execution_windows is not None:
        if not isinstance(execution_windows, dict):
            errors.append("runtime_target.execution_windows must be an object when present")
        else:
            for window_name, allowed_modes in WINDOW_MODES.items():
                window = execution_windows.get(window_name)
                if window is None:
                    continue
                if not isinstance(window, dict):
                    errors.append(f"runtime_target.execution_windows.{window_name} must be an object")
                    continue
                for field in window:
                    if field not in {"enabled", "offset_minutes", "mode"}:
                        errors.append(f"runtime_target.execution_windows.{window_name}.{field} is unsupported")
                if "enabled" in window and not isinstance(window["enabled"], bool):
                    errors.append(f"runtime_target.execution_windows.{window_name}.enabled must be boolean")
                if "offset_minutes" in window:
                    offset_minutes = window["offset_minutes"]
                    if not isinstance(offset_minutes, int) or offset_minutes < 0:
                        errors.append(
                            "runtime_target.execution_windows."
                            f"{window_name}.offset_minutes must be a non-negative integer"
                        )
                mode = window.get("mode")
                if mode is not None and mode not in allowed_modes:
                    errors.append(
                        f"runtime_target.execution_windows.{window_name}.mode must be one of {sorted(allowed_modes)}"
                    )
            for window_name in execution_windows:
                if window_name not in WINDOW_MODES:
                    errors.append("runtime_target.execution_windows only supports precheck and execution")
                    break

    scheduler = runtime_target.get("scheduler")
    if scheduler is not None:
        if not isinstance(scheduler, dict):
            errors.append("runtime_target.scheduler must be an object when present")
        else:
            for field in scheduler:
                if field not in SCHEDULER_FIELDS:
                    errors.append(f"runtime_target.scheduler.{field} is unsupported")
            timezone = scheduler.get("timezone")
            if not isinstance(timezone, str) or not timezone.strip():
                errors.append("runtime_target.scheduler.timezone must be a non-empty string")
            for field in ("main_time", "probe_time", "precheck_time"):
                value = scheduler.get(field)
                if not isinstance(value, str) or len(value.split()) not in {2, 5}:
                    errors.append(f"runtime_target.scheduler.{field} must have 2 time fields or 5 cron fields")
            validate_live_ibkr_us_scheduler(runtime_target, scheduler, errors)

    configured_market_fields = []
    for field in MARKET_FIELDS:
        value = runtime_target.get(field)
        if value is not None:
            configured_market_fields.append(field)
        if value is not None and (not isinstance(value, str) or not value.strip()):
            errors.append(f"runtime_target.{field} must be a non-empty string when present")
    if configured_market_fields and len(configured_market_fields) != len(MARKET_FIELDS):
        errors.append(
            "runtime_target market metadata must include "
            "market, market_calendar, and market_timezone together"
        )
    market_timezone = runtime_target.get("market_timezone")
    if isinstance(market_timezone, str) and market_timezone.strip():
        try:
            ZoneInfo(market_timezone)
        except (ZoneInfoNotFoundError, ValueError):
            errors.append(f"runtime_target.market_timezone is invalid: {market_timezone!r}")
    validate_strategy_release(runtime_target, errors)
    validate_live_continuity(runtime_target, errors)


def validate_strategy_release(runtime_target: dict[str, Any], errors: list[str]) -> None:
    """Validate an optional immutable release identity without enabling it.

    Existing targets intentionally remain valid without ``strategy_release``
    during the read-only migration. Once present, however, a partial identity
    is never accepted because it could be mistaken for a verified release.
    """

    release = runtime_target.get("strategy_release")
    if release is None:
        return
    if not isinstance(release, dict):
        errors.append("runtime_target.strategy_release must be an object when present")
        return
    unexpected = sorted(set(release) - set(STRATEGY_RELEASE_REQUIRED_FIELDS))
    if unexpected:
        errors.append(
            "runtime_target.strategy_release contains unsupported fields: "
            + ", ".join(unexpected)
        )
    for field in STRATEGY_RELEASE_REQUIRED_FIELDS:
        value = release.get(field)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"runtime_target.strategy_release.{field} is required")
            continue
        if field == "release_id" and not STRATEGY_RELEASE_ID_PATTERN.fullmatch(value.strip()):
            errors.append("runtime_target.strategy_release.release_id has invalid characters")
        if field in STRATEGY_RELEASE_DIGEST_FIELDS and not SHA256_PATTERN.fullmatch(value.strip()):
            errors.append(f"runtime_target.strategy_release.{field} must be a SHA-256 digest")
        if field == "effective_session":
            try:
                date.fromisoformat(value.strip())
            except ValueError:
                errors.append(
                    "runtime_target.strategy_release.effective_session must be an ISO-8601 date"
                )


def validate_live_continuity(runtime_target: dict[str, Any], errors: list[str]) -> None:
    """Validate a frozen incumbent baseline independently of candidate policy."""

    continuity = runtime_target.get("live_continuity")
    if continuity is None:
        return
    if not isinstance(continuity, dict):
        errors.append("runtime_target.live_continuity must be an object when present")
        return
    unsupported = sorted(set(continuity) - LIVE_CONTINUITY_FIELDS)
    if unsupported:
        errors.append(
            "runtime_target.live_continuity contains unsupported fields: " + ", ".join(unsupported)
        )
    for field in sorted(LIVE_CONTINUITY_FIELDS):
        value = continuity.get(field)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"runtime_target.live_continuity.{field} is required")

    state = str(continuity.get("state") or "").strip().upper()
    if state not in LIVE_CONTINUITY_STATES:
        errors.append(
            "runtime_target.live_continuity.state must be one of "
            + ", ".join(sorted(LIVE_CONTINUITY_STATES))
        )
    baseline_kind = str(continuity.get("baseline_kind") or "").strip()
    if baseline_kind not in LIVE_CONTINUITY_BASELINE_KINDS:
        errors.append(
            "runtime_target.live_continuity.baseline_kind must be one of "
            + ", ".join(sorted(LIVE_CONTINUITY_BASELINE_KINDS))
        )
    baseline_id = str(continuity.get("baseline_id") or "").strip()
    if baseline_id and not LIVE_CONTINUITY_BASELINE_ID_PATTERN.fullmatch(baseline_id):
        errors.append("runtime_target.live_continuity.baseline_id has invalid characters")
    digest = str(continuity.get("baseline_target_sha256") or "").strip().lower()
    digest = digest.removeprefix("sha256:")
    if not SHA256_PATTERN.fullmatch(digest):
        errors.append("runtime_target.live_continuity.baseline_target_sha256 must be a SHA-256 digest")
    elif digest != runtime_target_fingerprint(runtime_target):
        errors.append(
            "runtime_target.live_continuity.baseline_target_sha256 does not match the runtime target"
        )
    captured_at = str(continuity.get("captured_at") or "").strip()
    if captured_at:
        try:
            date.fromisoformat(captured_at)
        except ValueError:
            errors.append("runtime_target.live_continuity.captured_at must be an ISO-8601 date")
    if baseline_kind == "release_attested" and not isinstance(runtime_target.get("strategy_release"), dict):
        errors.append("release_attested live_continuity requires runtime_target.strategy_release")


def is_live_continuity_target(runtime_target: dict[str, Any]) -> bool:
    return isinstance(runtime_target.get("live_continuity"), dict)


def validate_live_ibkr_us_scheduler(
    runtime_target: dict[str, Any],
    scheduler: dict[str, Any],
    errors: list[str],
) -> None:
    if (
        runtime_target.get("platform_id") != "ibkr"
        or runtime_target.get("execution_mode") != "live"
        or runtime_target.get("dry_run_only") is not False
    ):
        return

    market = str(runtime_target.get("market") or "").strip().upper()
    if not market:
        config = load_platform_config()
        strategies = config.get("strategies", {})
        domains = config.get("domains", {})
        profile = str(runtime_target.get("strategy_profile") or "").strip()
        strategy = strategies.get(profile) if isinstance(strategies, dict) else None
        domain = (
            domains.get(strategy.get("domain"))
            if isinstance(strategy, dict) and isinstance(domains, dict)
            else None
        )
        market = str(domain.get("market") or "").strip().upper() if isinstance(domain, dict) else ""
    if market != "US":
        return

    for field in ("main_time", "probe_time", "precheck_time"):
        value = scheduler.get(field)
        if not isinstance(value, str):
            continue
        cron = value.split()
        if len(cron) == 2:
            continue
        if len(cron) == 5 and cron[2] == "*" and cron[4] == "1-5":
            continue
        errors.append(
            f"runtime_target.scheduler.{field} must be a two-field time or Mon-Fri cron "
            "for live IBKR US targets"
        )


def validate_runtime_target_strategy_policy(runtime_target: dict[str, Any], errors: list[str]) -> None:
    config = load_platform_config()
    strategies = config.get("strategies", {})
    platforms = config.get("platforms", {})
    domains = config.get("domains", {})
    if not isinstance(strategies, dict) or not isinstance(platforms, dict) or not isinstance(domains, dict):
        return
    profile = str(runtime_target.get("strategy_profile") or "").strip()
    strategy = strategies.get(profile)
    if not isinstance(strategy, dict):
        return

    platform_id = str(runtime_target.get("platform_id") or "").strip()
    platform = platforms.get(platform_id)
    domain = str(strategy.get("domain") or "").strip()
    domain_config = domains.get(domain)
    supported_domains = platform.get("supported_domains", []) if isinstance(platform, dict) else []
    if domain and isinstance(supported_domains, list) and supported_domains and domain not in supported_domains:
        errors.append(f"runtime_target.strategy_profile domain {domain} is not supported by {platform_id}")

    if isinstance(domain_config, dict):
        if any(runtime_target.get(field) is not None for field in MARKET_FIELDS):
            for field in MARKET_FIELDS:
                actual = runtime_target.get(field)
                expected = domain_config.get(field)
                if isinstance(actual, str) and actual.strip() and actual.strip() != expected:
                    errors.append(
                        f"runtime_target.{field} must match strategy domain {domain}: expected {expected!r}"
                    )
            scheduler = runtime_target.get("scheduler")
            if isinstance(scheduler, dict):
                actual_timezone = scheduler.get("timezone")
                expected_timezone = domain_config.get("market_timezone")
                if (
                    isinstance(actual_timezone, str)
                    and actual_timezone.strip()
                    and actual_timezone.strip() != expected_timezone
                ):
                    errors.append(
                        "runtime_target.scheduler.timezone must match strategy domain "
                        f"{domain}: expected {expected_timezone!r}"
                    )

    execution_mode = effective_execution_mode(runtime_target)
    deployment = platform.get("deployment", {}) if isinstance(platform, dict) else {}
    if (
        execution_mode == "live"
        and isinstance(deployment, dict)
        and deployment.get("live_configured") is False
    ):
        errors.append(f"platform {platform_id} has no live runtime configuration")
    supported_execution_modes = (
        normalize_allowed_execution_modes(deployment.get("supported_execution_modes"))
        if isinstance(deployment, dict)
        else []
    )
    if supported_execution_modes and execution_mode not in supported_execution_modes:
        errors.append(
            f"platform {platform_id} does not support {execution_mode} control execution"
        )
    continuity_target = is_live_continuity_target(runtime_target)
    allowed_modes = normalize_allowed_execution_modes(strategy.get("allowed_execution_modes"))
    if allowed_modes and execution_mode not in allowed_modes and not continuity_target:
        errors.append(f"runtime_target.strategy_profile {profile} does not allow {execution_mode} execution")

    if execution_mode != "live":
        return
    if continuity_target:
        continuity_policy = strategy.get("live_continuity")
        if not isinstance(continuity_policy, dict) or continuity_policy.get("eligible") is not True:
            errors.append(
                f"runtime_target.strategy_profile {profile} is not eligible for live continuity"
            )
            return
        allowed_platforms = continuity_policy.get("allowed_platforms")
        if not isinstance(allowed_platforms, list) or platform_id not in allowed_platforms:
            errors.append(
                f"runtime_target.strategy_profile {profile} live continuity is not allowed on {platform_id}"
            )
        return
    lifecycle_stage = str(strategy.get("lifecycle_stage") or "").strip()
    if strategy.get("runtime_enabled") is not True:
        errors.append(f"runtime_target.strategy_profile {profile} is not runtime_enabled")
    if strategy.get("can_switch_live") is not True:
        errors.append(f"runtime_target.strategy_profile {profile} cannot switch live")
    if lifecycle_stage not in {"live_enabled", "runtime_enabled"}:
        errors.append(
            f"runtime_target.strategy_profile {profile} lifecycle_stage must be "
            "live_enabled (or legacy runtime_enabled) for live"
        )
    if "live" not in allowed_modes:
        errors.append(
            f"runtime_target.strategy_profile {profile} must explicitly allow live execution"
        )
    blocked_reason = str(strategy.get("blocked_live_reason") or "").strip()
    if blocked_reason:
        errors.append(f"runtime_target.strategy_profile {profile} is blocked for live: {blocked_reason}")


def normalize_allowed_execution_modes(value: Any) -> list[str]:
    if isinstance(value, str):
        raw_modes = re.split(r"[,\s/|]+", value)
    elif isinstance(value, (list, tuple, set)):
        raw_modes = list(value)
    else:
        return []
    modes: list[str] = []
    for item in raw_modes:
        mode = str(item or "").strip().lower()
        if mode and mode not in modes:
            modes.append(mode)
    return modes


def effective_execution_mode(runtime_target: dict[str, Any]) -> str:
    """Return the policy mode without changing a legacy serialized target.

    ``execution_mode=paper`` combined with ``dry_run_only=true`` is the
    deployed no-order envelope, not a P4 paper-broker authorization. The
    manual switch accepts canonical ``dry_run`` and serializes that envelope
    until every platform parser has migrated.
    """
    mode = str(runtime_target.get("execution_mode") or "").strip().lower()
    if runtime_target.get("dry_run_only") is True and mode in {"paper", "dry_run"}:
        return "dry_run"
    return mode


def validate_plugin_mounts(target: dict[str, Any], errors: list[str]) -> None:
    runtime_target = target.get("runtime_target") if isinstance(target.get("runtime_target"), dict) else {}
    strategy_profile = runtime_target.get("strategy_profile")
    platform_id = runtime_target.get("platform_id")
    mounts_variable = target.get("plugin_mounts_variable")
    mounts = target.get("plugin_mounts", [])

    if mounts_variable is not None:
        if not isinstance(mounts_variable, str) or not mounts_variable.strip():
            errors.append("plugin_mounts_variable must be a non-empty string when present")
        elif platform_id in SUPPORTED_PLATFORMS:
            expected_prefix = SUPPORTED_PLATFORMS[platform_id]["plugin_mounts_prefix"]
            if not mounts_variable.startswith(expected_prefix):
                errors.append(f"plugin_mounts_variable should start with {expected_prefix!r} for {platform_id}")

    if mounts_variable is None and mounts:
        errors.append("plugin_mounts_variable is required when plugin_mounts are present")
        return

    if not isinstance(mounts, list):
        errors.append("plugin_mounts must be a list")
        return

    matching_plugins: set[str] = set()
    for index, mount in enumerate(mounts):
        if not isinstance(mount, dict):
            errors.append(f"plugin_mounts[{index}] must be an object")
            continue

        for field in ("strategy", "plugin", "signal_path", "enabled", "expected_mode"):
            if field not in mount:
                errors.append(f"plugin_mounts[{index}].{field} is required")

        if not isinstance(mount.get("enabled"), bool):
            errors.append(f"plugin_mounts[{index}].enabled must be boolean")

        expected_schema_version = mount.get("expected_schema_version")
        if expected_schema_version is not None and (
            not isinstance(expected_schema_version, str) or not expected_schema_version.strip()
        ):
            errors.append(f"plugin_mounts[{index}].expected_schema_version must be a non-empty string")

        expected_mode = mount.get("expected_mode")
        if not isinstance(expected_mode, str) or expected_mode not in {"dry_run", "paper", "shadow"}:
            errors.append(
                f"plugin_mounts[{index}].expected_mode must be dry_run, paper, or shadow; plugins cannot request live execution"
            )

        signal_path = mount.get("signal_path")
        if not isinstance(signal_path, str) or not signal_path.startswith("gs://"):
            errors.append(f"plugin_mounts[{index}].signal_path must be a gs:// URI")

        if mount.get("strategy") == strategy_profile and mount.get("enabled") is True:
            plugin = mount.get("plugin")
            if isinstance(plugin, str):
                matching_plugins.add(plugin)

    policy = load_local_policy()
    required_plugins_by_strategy = policy.get("required_plugins_by_strategy", {})
    if required_plugins_by_strategy and not isinstance(required_plugins_by_strategy, dict):
        errors.append("local policy required_plugins_by_strategy must be an object")
        return

    required_plugins = required_plugins_by_strategy.get(strategy_profile, [])
    if isinstance(required_plugins, str):
        required_plugins = [required_plugins]
    if not isinstance(required_plugins, list):
        errors.append(f"local policy required plugins for {strategy_profile} must be a list or string")
        return
    for plugin in required_plugins:
        if plugin not in matching_plugins:
            errors.append(f"{strategy_profile} requires an enabled {plugin} plugin mount")


def option_bool_value(value: Any) -> bool | None:
    text = str(value if value is not None else "").strip().lower()
    if text in {"1", "true", "yes", "y", "on"}:
        return True
    if text in {"0", "false", "no", "n", "off"}:
        return False
    return None


def validate_option_overlay_variables(extra_variables: dict[str, Any], errors: list[str]) -> None:
    if not any(name in extra_variables for name in OPTION_OVERLAY_VARIABLES):
        return

    values = {
        name: str(extra_variables.get(name) if extra_variables.get(name) is not None else "").strip()
        for name in OPTION_OVERLAY_VARIABLES
    }
    for name in OPTION_OVERLAY_ENABLED_VARIABLES:
        if values[name] and option_bool_value(values[name]) is None:
            errors.append(f"extra_variables.{name} must be true or false")
    for name in OPTION_OVERLAY_RECIPE_VARIABLES:
        if values[name] and not re.fullmatch(r"[A-Za-z0-9._=-]{1,120}", values[name]):
            errors.append(f"extra_variables.{name} must be a recipe slug")
    for name in OPTION_OVERLAY_AMOUNT_VARIABLES:
        if values[name] and not re.fullmatch(r"(?:\d+|\d*\.\d+)", values[name]):
            errors.append(f"extra_variables.{name} must be a non-negative decimal")
    for name in OPTION_OVERLAY_RATIO_VARIABLES:
        if values[name]:
            if not re.fullmatch(r"(?:\d+|\d*\.\d+)", values[name]):
                errors.append(f"extra_variables.{name} must be a ratio between 0 and 1")
                continue
            numeric = float(values[name])
            if numeric < 0 or numeric > 1:
                errors.append(f"extra_variables.{name} must be a ratio between 0 and 1")

    overlay_enabled = option_bool_value(values["OPTION_OVERLAY_ENABLED"]) if values["OPTION_OVERLAY_ENABLED"] else None
    family_enabled: dict[str, bool | None] = {}
    family_fields = {
        "GROWTH": (
            "OPTION_GROWTH_OVERLAY_ENABLED",
            "OPTION_GROWTH_OVERLAY_RECIPE",
            "OPTION_GROWTH_OVERLAY_START_USD",
            "OPTION_GROWTH_OVERLAY_NAV_BUDGET_RATIO",
        ),
        "INCOME": (
            "OPTION_INCOME_OVERLAY_ENABLED",
            "OPTION_INCOME_OVERLAY_RECIPE",
            "OPTION_INCOME_OVERLAY_START_USD",
            "OPTION_INCOME_OVERLAY_NAV_RISK_RATIO",
        ),
    }
    for family, (enabled_name, recipe_name, start_name, ratio_name) in family_fields.items():
        enabled = option_bool_value(values[enabled_name]) if values[enabled_name] else None
        family_enabled[family] = enabled
        family_payload = [values[recipe_name], values[start_name], values[ratio_name]]
        if enabled is True and not all(family_payload):
            errors.append(f"extra_variables.{enabled_name} requires recipe, start_usd, and ratio fields")
        if enabled is False and any(family_payload):
            errors.append(f"extra_variables.{enabled_name} is false but {family.lower()} overlay fields are still set")

    if overlay_enabled is True and not any(value is True for value in family_enabled.values()):
        errors.append("extra_variables.OPTION_OVERLAY_ENABLED is true but no option overlay family is enabled")
    if overlay_enabled is False and any(value is True for value in family_enabled.values()):
        errors.append("extra_variables.OPTION_OVERLAY_ENABLED is false but an option overlay family is enabled")


def validate_nonsecret_service_target_inventory(value: Any, *, path: str, errors: list[str]) -> None:
    """Reject secret-shaped keys nested in a variable-backed service inventory."""
    payload = value
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            return

    def visit(node: Any, current_path: str) -> None:
        if isinstance(node, dict):
            for key, nested in node.items():
                key_text = str(key)
                nested_path = f"{current_path}.{key_text}"
                if is_secret_variable_name(key_text):
                    errors.append(f"{nested_path} looks like a secret and must not be stored here")
                    continue
                visit(nested, nested_path)
        elif isinstance(node, list):
            for index, nested in enumerate(node):
                visit(nested, f"{current_path}[{index}]")

    if isinstance(payload, (dict, list)):
        visit(payload, path)


def validate_extra_variables(target: dict[str, Any], errors: list[str]) -> None:
    extra_variables = target.get("extra_variables", {})
    if not isinstance(extra_variables, dict):
        errors.append("extra_variables must be an object")
        return

    generated_names = set(GENERATED_VARIABLES)
    plugin_mounts_variable = target.get("plugin_mounts_variable")
    if isinstance(plugin_mounts_variable, str):
        generated_names.add(plugin_mounts_variable)

    for name, value in extra_variables.items():
        if name in generated_names:
            errors.append(f"extra_variables.{name} duplicates a generated variable")
        if name in RESEARCH_ONLY_EXTRA_VARIABLES:
            errors.append(f"extra_variables.{name} is research-only and must not be stored in live switch settings")
        if is_secret_variable_name(name):
            errors.append(f"extra_variables.{name} looks like a secret and must not be stored here")
        if isinstance(value, str) and "\n" in value:
            errors.append(f"extra_variables.{name} must be a single-line value")
        if name == "CLOUD_RUN_SERVICE_TARGETS_JSON":
            validate_nonsecret_service_target_inventory(
                value, path=f"extra_variables.{name}", errors=errors
            )

    validate_option_overlay_variables(extra_variables, errors)

    runtime_target = target.get("runtime_target") if isinstance(target.get("runtime_target"), dict) else {}
    dry_run_only = runtime_target.get("dry_run_only")
    platform_id = runtime_target.get("platform_id")
    dry_run_variable = PLATFORM_DRY_RUN_VARIABLES.get(str(platform_id or ""))
    platform_dry_run = extra_variables.get(dry_run_variable) if dry_run_variable else None
    if platform_dry_run is not None and env_string(platform_dry_run).lower() != env_string(dry_run_only):
        errors.append(f"extra_variables.{dry_run_variable} must match runtime_target.dry_run_only")


def validate_repository_variables(target: dict[str, Any], errors: list[str]) -> None:
    repository_variables = target.get("repository_variables", {})
    if not isinstance(repository_variables, dict):
        errors.append("repository_variables must be an object")
        return

    extra_variables = target.get("extra_variables")
    extra_variable_names = set(extra_variables) if isinstance(extra_variables, dict) else set()
    for name, value in repository_variables.items():
        if name in GENERATED_VARIABLES:
            errors.append(f"repository_variables.{name} duplicates a generated variable")
        if name in extra_variable_names:
            errors.append(f"repository_variables.{name} duplicates extra_variables.{name}")
        if name in RESEARCH_ONLY_EXTRA_VARIABLES:
            errors.append(
                f"repository_variables.{name} is research-only and must not be stored in live switch settings"
            )
        if is_secret_variable_name(name):
            errors.append(f"repository_variables.{name} looks like a secret and must not be stored here")
        if isinstance(value, str) and "\n" in value:
            errors.append(f"repository_variables.{name} must be a single-line value")
        if name == "CLOUD_RUN_SERVICE_TARGETS_JSON":
            validate_nonsecret_service_target_inventory(
                value, path=f"repository_variables.{name}", errors=errors
            )


def validate_target(target: dict[str, Any], path: Path | None = None) -> list[str]:
    errors: list[str] = []
    target_id = target.get("target_id")

    if not isinstance(target_id, str) or "/" not in target_id:
        errors.append("target_id must be platform/name")
    elif path is not None:
        expected_id = target_path_id(path)
        if expected_id and expected_id != target_id:
            errors.append(f"target_id {target_id!r} does not match path id {expected_id!r}")

    validate_github(target, errors)
    validate_runtime_target(target, errors)
    validate_plugin_mounts(target, errors)
    validate_extra_variables(target, errors)
    validate_repository_variables(target, errors)

    runtime_target = target.get("runtime_target") if isinstance(target.get("runtime_target"), dict) else {}
    github = target.get("github") if isinstance(target.get("github"), dict) else {}
    platform_id = runtime_target.get("platform_id")
    if platform_id in SUPPORTED_PLATFORMS:
        try:
            expected_repository = platform_repository(platform_id)
        except ValueError as exc:
            errors.append(str(exc))
        else:
            if github.get("repository") != expected_repository:
                errors.append(
                    f"github.repository does not match platform {platform_id}: expected {expected_repository}"
                )

    return errors


def build_assignments(target: dict[str, Any]) -> list[Assignment]:
    errors = validate_target(target)
    if errors:
        raise ValueError("; ".join(errors))

    target_id = target["target_id"]
    github = target["github"]
    runtime_target = target["runtime_target"]
    repository = github["repository"]
    scope = github["variable_scope"]
    environment = github.get("environment")

    assignments = [
        Assignment(target_id, repository, scope, environment, "RUNTIME_TARGET_JSON", compact_json(runtime_target)),
        Assignment(target_id, repository, scope, environment, "STRATEGY_PROFILE", runtime_target["strategy_profile"]),
    ]

    mounts_variable = target.get("plugin_mounts_variable")
    mounts = target.get("plugin_mounts") or []
    if mounts_variable:
        assignments.append(
            Assignment(
                target_id,
                repository,
                scope,
                environment,
                mounts_variable,
                compact_json({"strategy_plugins": mounts}),
            )
        )

    for name, value in sorted((target.get("extra_variables") or {}).items()):
        assignments.append(Assignment(target_id, repository, scope, environment, name, env_string(value)))

    for name, value in sorted((target.get("repository_variables") or {}).items()):
        assignments.append(
            Assignment(
                target_id,
                repository,
                "repository",
                None,
                name,
                env_string(value),
            )
        )

    return assignments


def load_targets(paths: list[str]) -> list[tuple[Path, dict[str, Any]]]:
    return [(path, load_target(path)) for path in discover_target_paths(paths)]


def command_validate(args: argparse.Namespace) -> int:
    had_errors = False
    for path, target in load_targets(args.targets):
        errors = validate_target(target, path)
        if errors:
            had_errors = True
            print(f"FAIL {display_path(path)}", file=sys.stderr)
            for error in errors:
                print(f"  - {error}", file=sys.stderr)
        else:
            print(f"OK   {display_path(path)}")
    return 1 if had_errors else 0


def command_render(args: argparse.Namespace) -> int:
    all_assignments = []
    for _, target in load_targets(args.targets):
        all_assignments.extend(build_assignments(target))

    if args.format == "json":
        print(
            json.dumps(
                [assignment_payload(assignment, redact_values=args.redact_values) for assignment in all_assignments],
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    if args.format == "gh":
        for assignment in all_assignments:
            print(assignment.shell_command(redact_body=args.redact_values, redact_metadata=args.redact_values))
        return 0

    current_target = None
    for assignment in all_assignments:
        if assignment.target_id != current_target:
            current_target = assignment.target_id
            suffix = assignment.variable_scope
            if assignment.environment:
                suffix += f":{assignment.environment}"
            print(f"# {assignment.target_id} -> {assignment.repository} ({suffix})")
        value = redacted_value() if args.redact_values else assignment.value
        print(f"{assignment.name}={shlex.quote(value)}")
    return 0


def command_apply(args: argparse.Namespace) -> int:
    all_assignments = []
    for _, target in load_targets(args.targets):
        all_assignments.extend(build_assignments(target))

    for assignment in all_assignments:
        redact_preview = not args.show_values
        print(assignment.shell_command(redact_body=redact_preview, redact_metadata=redact_preview))

    if not args.yes:
        if args.show_values:
            print("\nDry run only. Re-run with --yes to apply these GitHub variables.")
        else:
            print("\nDry run only. Re-run with --yes to apply these GitHub variables.")
            print("Values are redacted by default; add --show-values only in a private local terminal.")
        return 0

    for assignment in all_assignments:
        result = subprocess.run(
            assignment.gh_command(),
            text=True,
            capture_output=assignment.deletes_variable,
            check=False,
        )
        if result.returncode == 0:
            continue
        if assignment.deletes_variable:
            detail = f"{result.stderr}\n{result.stdout}".lower()
            if "not found" in detail or "could not find" in detail or "http 404" in detail:
                print(f"{assignment.name} was already absent; delete skipped.")
                continue
            if result.stderr:
                print(result.stderr, file=sys.stderr, end="")
            if result.stdout:
                print(result.stdout, file=sys.stderr, end="")
        raise subprocess.CalledProcessError(result.returncode, assignment.gh_command())
    return 0


def command_repository(args: argparse.Namespace) -> int:
    print(platform_repository(args.platform))
    return 0


def command_settings_activation(args: argparse.Namespace) -> int:
    print(platform_settings_activation(args.platform))
    return 0


ACCOUNT_SYNC_CONTROL_FIELDS = {
    "DCA_MODE": "dca_mode",
    "DCA_BASE_INVESTMENT_USD": "dca_base_investment_usd",
}


def _service_target_identity(entry: dict[str, Any], field: str) -> set[str]:
    entry_runtime = entry.get("runtime_target") if isinstance(entry.get("runtime_target"), dict) else {}
    if field == "service_name":
        values = (
            entry.get("service"),
            entry.get("service_name"),
            entry_runtime.get("service_name"),
        )
    else:
        values = (
            entry.get("ACCOUNT_GROUP"),
            entry.get("account_scope"),
            entry_runtime.get("account_scope"),
        )
    return {str(value or "").strip() for value in values if str(value or "").strip()}


def select_service_target_entry_index(
    runtime_target: dict[str, Any],
    entries: list[dict[str, Any]],
    *,
    allow_account_scope_fallback: bool = True,
) -> int | None:
    service_name = str(runtime_target.get("service_name") or "").strip()
    account_scope = str(runtime_target.get("account_scope") or "").strip()
    service_matches = [
        index
        for index, entry in enumerate(entries)
        if service_name and service_name in _service_target_identity(entry, "service_name")
    ]
    if len(service_matches) > 1:
        raise ValueError(f"multiple service targets match service_name {service_name!r}")
    if service_matches:
        return service_matches[0]

    if not allow_account_scope_fallback:
        return None
    scope_matches = [
        index
        for index, entry in enumerate(entries)
        if (
            account_scope
            and not _service_target_identity(entry, "service_name")
            and account_scope in _service_target_identity(entry, "account_scope")
        )
    ]
    if len(scope_matches) > 1:
        raise ValueError(
            f"multiple service targets match account_scope {account_scope!r}; "
            "service_name must match an existing target"
        )
    return scope_matches[0] if scope_matches else None


def _service_target_entry_matches(runtime_target: dict[str, Any], entry: dict[str, Any]) -> bool:
    return select_service_target_entry_index(runtime_target, [entry]) == 0


def extract_account_sync_controls(target: dict[str, Any]) -> dict[str, str]:
    extra_variables = dict(target.get("extra_variables") or {})
    controls: dict[str, str] = {}
    for source_key, payload_key in ACCOUNT_SYNC_CONTROL_FIELDS.items():
        value = extra_variables.get(source_key)
        if value not in (None, ""):
            controls[payload_key] = str(value).strip()

    service_targets = extra_variables.get("CLOUD_RUN_SERVICE_TARGETS_JSON")
    if service_targets is None:
        repository_variables = target.get("repository_variables")
        if isinstance(repository_variables, dict):
            service_targets = repository_variables.get("CLOUD_RUN_SERVICE_TARGETS_JSON")
    if isinstance(service_targets, str):
        try:
            service_targets = json.loads(service_targets)
        except json.JSONDecodeError:
            service_targets = None

    runtime_target = target.get("runtime_target") if isinstance(target.get("runtime_target"), dict) else {}
    if isinstance(service_targets, (dict, list)):
        raw_entries = service_targets.get("targets") if isinstance(service_targets, dict) else service_targets
        entries = [entry for entry in raw_entries or [] if isinstance(entry, dict)]
        matched_index = select_service_target_entry_index(runtime_target, entries)
        matched = entries[matched_index] if matched_index is not None else None
        if matched:
            for source_key, payload_key in ACCOUNT_SYNC_CONTROL_FIELDS.items():
                if payload_key in controls:
                    continue
                value = matched.get(source_key)
                if value not in (None, ""):
                    controls[payload_key] = str(value).strip()
    return controls


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate", help="validate runtime target files")
    validate.add_argument("targets", nargs="*", help="target JSON files; defaults to all targets")
    validate.set_defaults(func=command_validate)

    render = subparsers.add_parser("render", help="render generated variables")
    render.add_argument("targets", nargs="*", help="target JSON files; defaults to all targets")
    render.add_argument("--format", choices=("env", "gh", "json"), default="env")
    render.add_argument("--redact-values", action="store_true", help="hide assignment values in rendered output")
    render.set_defaults(func=command_render)

    apply = subparsers.add_parser("apply", help="preview or apply GitHub variable updates")
    apply.add_argument("targets", nargs="*", help="target JSON files; defaults to all targets")
    apply.add_argument("--yes", action="store_true", help="apply updates with gh variable set")
    apply.add_argument(
        "--show-values",
        action="store_true",
        help="print exact values in the preview; avoid this in public CI logs",
    )
    apply.set_defaults(func=command_apply)

    repository = subparsers.add_parser("repository", help="print the configured platform repository")
    repository.add_argument("platform", choices=sorted(SUPPORTED_PLATFORMS))
    repository.set_defaults(func=command_repository)

    settings_activation = subparsers.add_parser(
        "settings-activation",
        help="print how repository variable changes become active for a platform",
    )
    settings_activation.add_argument("platform", choices=sorted(SUPPORTED_PLATFORMS))
    settings_activation.set_defaults(func=command_settings_activation)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
