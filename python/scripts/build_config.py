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
import datetime as dt
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
AUTOMATION_REGISTRY_SCHEMA_VERSION = "strategy_automation_registry.v2"
CRITICAL_STRATEGY_PROFILE_FIELDS = {
    "profile",
    "domain",
    "runtime_enabled",
    "lifecycle_stage",
    "can_switch_live",
    "allowed_execution_modes",
    "blocked_live_reason",
    "live_continuity",
}
LIVE_CONTINUITY_POLICY_FIELDS = {"eligible", "allowed_platforms"}
SCHEDULER_FIELDS = {"timezone", "main_time", "probe_time", "precheck_time"}
MARKET_FIELDS = {"market", "market_calendar", "market_timezone"}
FEATURE_SNAPSHOT_FIELDS = {"required", "path", "manifest_path", "max_age_days"}
# These platforms have a runtime variable pair through which an immutable
# feature snapshot and its manifest can be supplied to a generated target.
# Keep this small, explicit set next to the config validation so coverage does
# not claim that a strategy needing data artifacts is runnable on an unwired
# platform.
FEATURE_SNAPSHOT_RUNTIME_PLATFORMS = {"schwab", "longbridge", "ibkr", "firstrade"}
RUNTIME_MODELS = {"cloud_run", "oracle_vps_self_hosted", "not_configured"}
EXECUTION_MODES = {"live", "paper", "dry_run"}
# ``paper`` remains a future P4 capability. The executable non-live path is
# the no-order ``dry_run`` route declared by every registered platform.
CONTROL_EXECUTION_MODES = {"live", "dry_run"}
SETTINGS_ACTIVATION_MODES = {
    "cloud_run_sync_workflow",
    "next_runtime_workflow_dispatch",
    "not_wired",
}
RUNTIME_AUTHORITY_STATUS_FIELDS = {
    "schema_version",
    "scope",
    "status",
    "status_as_of",
    "active_preauthorized_autonomy_policy",
    "execution_metadata_is_runtime_authority",
    "p1_p3_non_live_data_acquisition_authority",
    "p4_p6_definition",
}
CURRENT_RUNTIME_AUTHORITY_STATUS = {
    "schema_version": "qsl.runtime_authority_status.v1",
    "scope": "p0_p6_control_plane",
    "status": "P0_CONTROL_PLANE_NOT_RUNTIME_WIRED",
    "active_preauthorized_autonomy_policy": False,
    "execution_metadata_is_runtime_authority": False,
    "p1_p3_non_live_data_acquisition_authority": "INDEPENDENT_CONTRACT_REQUIRED",
    "p4_p6_definition": "UNDEFINED",
}

TELEGRAM_CHAT_ID_ROUTE_SOURCE = "runtime_environment"
TELEGRAM_CHAT_ID_PREFERRED_ENV = "QSL_GLOBAL_TELEGRAM_CHAT_ID"
TELEGRAM_CHAT_ID_FALLBACK_ENVS = (
    "GLOBAL_TELEGRAM_CHAT_ID",
    "STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS",
)


def load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return json.load(f)


def validate(config: dict) -> list[str]:
    errors: list[str] = []
    validate_runtime_authority_status(config, errors)
    validate_notification_references(config, errors)
    platforms = config.get("platforms", {})
    if not isinstance(platforms, dict):
        errors.append("platforms must be an object")
        platforms = {}
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
                continue
            if profile.startswith("us_"):
                cron = value.split()
                if len(cron) != 5 or cron[2] != "*" or cron[4] != "1-5":
                    errors.append(
                        f"scheduler profile {profile}: {field} must be Mon-Fri cron with day-of-month '*'"
                    )
    for pid, pdata in platforms.items():
        if "capabilities" not in pdata:
            errors.append(f"platform {pid}: missing capabilities")
        if "default_account" not in pdata:
            errors.append(f"platform {pid}: missing default_account")
        if "supported_domains" not in pdata:
            errors.append(f"platform {pid}: missing supported_domains")
        deployment = pdata.get("deployment")
        if not isinstance(deployment, dict):
            errors.append(f"platform {pid}: missing deployment")
            continue
        runtime_model = deployment.get("runtime_model")
        settings_activation = deployment.get("settings_activation")
        if runtime_model not in RUNTIME_MODELS:
            errors.append(f"platform {pid}: unsupported runtime_model {runtime_model!r}")
        if settings_activation not in SETTINGS_ACTIVATION_MODES:
            errors.append(
                f"platform {pid}: unsupported settings_activation {settings_activation!r}"
            )
        if not isinstance(deployment.get("live_configured"), bool):
            errors.append(f"platform {pid}: live_configured must be boolean")
        supported_execution_modes = deployment.get("supported_execution_modes")
        if not isinstance(supported_execution_modes, list) or not supported_execution_modes:
            errors.append(f"platform {pid}: supported_execution_modes must be a non-empty list")
            supported_execution_modes = []
        elif any(
            not isinstance(mode, str) or mode not in CONTROL_EXECUTION_MODES
            for mode in supported_execution_modes
        ):
            errors.append(
                f"platform {pid}: supported_execution_modes must only contain "
                f"{sorted(CONTROL_EXECUTION_MODES)}"
            )
        elif len(set(supported_execution_modes)) != len(supported_execution_modes):
            errors.append(f"platform {pid}: supported_execution_modes must not contain duplicates")
        default_execution_mode = deployment.get("default_execution_mode")
        if default_execution_mode not in EXECUTION_MODES:
            errors.append(f"platform {pid}: unsupported default_execution_mode {default_execution_mode!r}")
        elif default_execution_mode not in supported_execution_modes:
            errors.append(
                f"platform {pid}: default_execution_mode {default_execution_mode!r} "
                "must be listed in supported_execution_modes"
            )
        if deployment.get("live_configured") is False and "live" in supported_execution_modes:
            errors.append(f"platform {pid}: live_configured false cannot advertise live execution")
        if deployment.get("dry_run_only") is True and supported_execution_modes != ["dry_run"]:
            errors.append(
                f"platform {pid}: dry_run_only true requires supported_execution_modes ['dry_run']"
            )
        if settings_activation == "cloud_run_sync_workflow" and runtime_model != "cloud_run":
            errors.append(
                f"platform {pid}: settings_activation {settings_activation!r} "
                "requires runtime_model 'cloud_run'"
            )
        if settings_activation == "next_runtime_workflow_dispatch" and runtime_model != "oracle_vps_self_hosted":
            errors.append(
                f"platform {pid}: settings_activation {settings_activation!r} "
                "requires runtime_model 'oracle_vps_self_hosted'"
            )
        if settings_activation == "not_wired" and deployment.get("live_configured") is not False:
            errors.append(
                f"platform {pid}: settings_activation 'not_wired' requires live_configured false"
            )
    domains = config.get("domains", {})
    for domain, domain_data in domains.items():
        if not isinstance(domain_data, dict):
            errors.append(f"domain {domain}: must be an object")
            continue
        scheduler_profile = domain_data.get("scheduler_profile")
        if not isinstance(scheduler_profile, str) or scheduler_profile not in scheduler_profiles:
            errors.append(
                f"domain {domain}: unknown scheduler_profile {scheduler_profile!r}"
            )
        for field in MARKET_FIELDS:
            value = domain_data.get(field)
            if not isinstance(value, str) or not value.strip():
                errors.append(f"domain {domain}: {field} must be a non-empty string")
        market_timezone = domain_data.get("market_timezone")
        try:
            ZoneInfo(str(market_timezone or ""))
        except (ZoneInfoNotFoundError, ValueError):
            errors.append(f"domain {domain}: invalid market_timezone {market_timezone!r}")
        scheduler_data = (
            scheduler_profiles.get(scheduler_profile)
            if isinstance(scheduler_profile, str)
            else None
        )
        if isinstance(scheduler_data, dict):
            scheduler_timezone = scheduler_data.get("timezone")
            if (
                isinstance(scheduler_timezone, str)
                and isinstance(market_timezone, str)
                and scheduler_timezone != market_timezone
            ):
                errors.append(
                    f"domain {domain}: scheduler timezone {scheduler_timezone!r} "
                    f"must match market_timezone {market_timezone!r}"
                )
    for sid, sdata in config.get("strategies", {}).items():
        validate_live_continuity_policy(sid, sdata, platforms, errors)
        if "domain" not in sdata:
            errors.append(f"strategy {sid}: missing domain")
            continue
        domain_ref = sdata["domain"]
        if not isinstance(domain_ref, str):
            errors.append(f"strategy {sid}: domain must be a string")
            domain_data = {}
        elif domain_ref not in domains:
            errors.append(f"strategy {sid}: unknown domain {domain_ref!r}")
            domain_data = {}
        else:
            domain_data = domains[domain_ref]
            if not isinstance(domain_data, dict):
                domain_data = {}
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
        else:
            scheduler_data = scheduler_profiles.get(scheduler_profile)
            scheduler_timezone = (
                scheduler_data.get("timezone")
                if isinstance(scheduler_data, dict)
                else None
            )
            market_timezone = domain_data.get("market_timezone")
            if (
                isinstance(scheduler_timezone, str)
                and isinstance(market_timezone, str)
                and scheduler_timezone != market_timezone
            ):
                errors.append(
                    f"strategy {sid}: scheduler timezone {scheduler_timezone!r} "
                    f"must match market_timezone {market_timezone!r}"
                )
        allowed_execution_modes = _normalize_allowed_execution_modes(sdata.get("allowed_execution_modes"))
        if not allowed_execution_modes:
            errors.append(f"strategy {sid}: allowed_execution_modes must be a non-empty list")
        elif any(mode not in EXECUTION_MODES for mode in allowed_execution_modes):
            errors.append(
                f"strategy {sid}: allowed_execution_modes must only contain {sorted(EXECUTION_MODES)}"
            )
        elif "dry_run" not in allowed_execution_modes:
            errors.append(
                f"strategy {sid}: allowed_execution_modes must include dry_run for the universal no-order path"
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
                    continue
                scheduler_data = scheduler_profiles.get(override)
                scheduler_timezone = (
                    scheduler_data.get("timezone")
                    if isinstance(scheduler_data, dict)
                    else None
                )
                market_timezone = domain_data.get("market_timezone")
                if (
                    isinstance(scheduler_timezone, str)
                    and isinstance(market_timezone, str)
                    and scheduler_timezone != market_timezone
                ):
                    errors.append(
                        f"strategy {sid}: plugin {plugin} scheduler timezone "
                        f"{scheduler_timezone!r} must match market_timezone "
                        f"{market_timezone!r}"
                    )
        runtime_artifacts = sdata.get("runtime_artifacts")
        if runtime_artifacts is None:
            continue
        if not isinstance(runtime_artifacts, dict):
            errors.append(f"strategy {sid}: runtime_artifacts must be an object")
            continue
        unsupported_artifacts = sorted(set(runtime_artifacts) - {"feature_snapshot"})
        if unsupported_artifacts:
            errors.append(
                f"strategy {sid}: unsupported runtime_artifacts {unsupported_artifacts}"
            )
        feature_snapshot = runtime_artifacts.get("feature_snapshot")
        if feature_snapshot is None:
            continue
        if not isinstance(feature_snapshot, dict):
            errors.append(
                f"strategy {sid}: runtime_artifacts.feature_snapshot must be an object"
            )
            continue
        unsupported_fields = sorted(set(feature_snapshot) - FEATURE_SNAPSHOT_FIELDS)
        if unsupported_fields:
            errors.append(
                f"strategy {sid}: unsupported feature snapshot fields {unsupported_fields}"
            )
        required = feature_snapshot.get("required")
        if not isinstance(required, bool):
            errors.append(
                f"strategy {sid}: runtime_artifacts.feature_snapshot.required must be boolean"
            )
        snapshot_path = feature_snapshot.get("path")
        manifest_path = feature_snapshot.get("manifest_path")
        for field, value in (("path", snapshot_path), ("manifest_path", manifest_path)):
            if value is not None and (
                not isinstance(value, str) or not value.startswith("gs://")
            ):
                errors.append(
                    f"strategy {sid}: runtime_artifacts.feature_snapshot.{field} must be a gs:// URI"
                )
        has_snapshot_path = isinstance(snapshot_path, str) and bool(snapshot_path.strip())
        has_manifest_path = isinstance(manifest_path, str) and bool(manifest_path.strip())
        if has_snapshot_path != has_manifest_path:
            errors.append(
                f"strategy {sid}: feature snapshot path and manifest_path must be configured together"
            )
        if required is True and sdata.get("can_switch_live") is True and not (
            has_snapshot_path and has_manifest_path
        ):
            errors.append(
                f"strategy {sid}: live feature snapshot requires path and manifest_path"
            )
        max_age_days = feature_snapshot.get("max_age_days")
        if required is True and not isinstance(max_age_days, int):
            errors.append(
                f"strategy {sid}: required feature snapshot max_age_days must be an integer"
            )
        elif isinstance(max_age_days, bool) or (
            isinstance(max_age_days, int) and max_age_days < 1
        ):
            errors.append(
                f"strategy {sid}: feature snapshot max_age_days must be at least 1"
            )
    return errors


def validate_live_continuity_policy(
    strategy_id: str,
    strategy: object,
    platforms: dict,
    errors: list[str],
) -> None:
    """Validate optional incumbent-continuity metadata independently of P0--P6."""

    if not isinstance(strategy, dict):
        return
    continuity = strategy.get("live_continuity")
    if continuity is None:
        return
    if not isinstance(continuity, dict):
        errors.append(f"strategy {strategy_id}: live_continuity must be an object")
        return
    unsupported = sorted(set(continuity) - LIVE_CONTINUITY_POLICY_FIELDS)
    if unsupported:
        errors.append(f"strategy {strategy_id}: unsupported live_continuity fields {unsupported}")
    eligible = continuity.get("eligible")
    if not isinstance(eligible, bool):
        errors.append(f"strategy {strategy_id}: live_continuity.eligible must be boolean")
    allowed_platforms = continuity.get("allowed_platforms")
    if not isinstance(allowed_platforms, list) or not all(
        isinstance(platform, str) and platform in platforms for platform in allowed_platforms
    ):
        errors.append(
            f"strategy {strategy_id}: live_continuity.allowed_platforms must contain configured platforms"
        )
    elif len(set(allowed_platforms)) != len(allowed_platforms):
        errors.append(f"strategy {strategy_id}: live_continuity.allowed_platforms must not contain duplicates")
    elif eligible is True and not allowed_platforms:
        errors.append(f"strategy {strategy_id}: live_continuity.eligible requires allowed_platforms")


def build_strategy_platform_dry_run_coverage(config: dict | None = None) -> dict[str, object]:
    """Report declared and default-buildable no-order platform routes.

    This is a control-plane coverage proof, not a claim that P4 paper, P5
    shadow, broker credentials, or a scheduler is active. A route exists only
    when the strategy domain and both sides' ``dry_run`` declarations agree.
    A route is *buildable* only when every required runtime artifact has a
    safe configured default.  A manually supplied artifact can make a parked
    route buildable for that invocation, but is intentionally not treated as
    an always-ready automation route here.
    """
    config = config if config is not None else load_config()
    platforms = config.get("platforms", {})
    strategies = config.get("strategies", {})
    rows: list[dict[str, object]] = []
    declared_uncovered_profiles: list[str] = []
    uncovered_profiles: list[str] = []
    artifact_blocked_profiles: list[str] = []
    declared_route_count = 0
    buildable_route_count = 0

    for profile, strategy in sorted(strategies.items()):
        if not isinstance(strategy, dict):
            declared_uncovered_profiles.append(str(profile))
            uncovered_profiles.append(str(profile))
            continue
        domain = str(strategy.get("domain") or "")
        strategy_modes = _normalize_allowed_execution_modes(strategy.get("allowed_execution_modes"))
        declared_platforms: list[str] = []
        for platform_id, platform in sorted(platforms.items()):
            if not isinstance(platform, dict) or domain not in platform.get("supported_domains", []):
                continue
            deployment = platform.get("deployment")
            platform_modes = (
                deployment.get("supported_execution_modes", [])
                if isinstance(deployment, dict)
                else []
            )
            if "dry_run" in strategy_modes and "dry_run" in platform_modes:
                declared_platforms.append(str(platform_id))

        required_artifact_reason = ""
        runtime_artifacts = strategy.get("runtime_artifacts")
        feature_snapshot = (
            runtime_artifacts.get("feature_snapshot")
            if isinstance(runtime_artifacts, dict)
            else None
        )
        if isinstance(feature_snapshot, dict) and feature_snapshot.get("required") is True:
            snapshot_path = feature_snapshot.get("path")
            manifest_path = feature_snapshot.get("manifest_path")
            has_snapshot_path = isinstance(snapshot_path, str) and snapshot_path.startswith("gs://")
            has_manifest_path = isinstance(manifest_path, str) and manifest_path.startswith("gs://")
            if not (has_snapshot_path and has_manifest_path):
                required_artifact_reason = "required_feature_snapshot_artifact_unconfigured"

        buildable_platforms = declared_platforms.copy()
        if required_artifact_reason:
            buildable_platforms = []
            if declared_platforms:
                artifact_blocked_profiles.append(str(profile))
        elif isinstance(feature_snapshot, dict) and feature_snapshot.get("required") is True:
            unwired_platforms = sorted(
                platform_id
                for platform_id in declared_platforms
                if platform_id not in FEATURE_SNAPSHOT_RUNTIME_PLATFORMS
            )
            if unwired_platforms:
                required_artifact_reason = (
                    "required_feature_snapshot_platform_unwired: "
                    + ", ".join(unwired_platforms)
                )
                buildable_platforms = [
                    platform_id
                    for platform_id in declared_platforms
                    if platform_id in FEATURE_SNAPSHOT_RUNTIME_PLATFORMS
                ]
                artifact_blocked_profiles.append(str(profile))

        declared_route_count += len(declared_platforms)
        buildable_route_count += len(buildable_platforms)
        if not declared_platforms:
            declared_uncovered_profiles.append(str(profile))
        if not buildable_platforms:
            uncovered_profiles.append(str(profile))
        rows.append(
            {
                "profile": str(profile),
                "domain": domain,
                # Retained as the safe default for existing report consumers.
                "dry_run_platforms": buildable_platforms,
                "declared_dry_run_platforms": declared_platforms,
                "buildable_dry_run_platforms": buildable_platforms,
                "blocked_reason": required_artifact_reason,
            }
        )

    return {
        "schema_version": "strategy_platform_dry_run_coverage.v1",
        "summary": {
            "strategy_count": len(rows),
            "covered_strategy_count": len(rows) - len(uncovered_profiles),
            "uncovered_strategy_count": len(uncovered_profiles),
            "declared_covered_strategy_count": len(rows) - len(declared_uncovered_profiles),
            "declared_uncovered_strategy_count": len(declared_uncovered_profiles),
            "dry_run_route_count": buildable_route_count,
            "declared_dry_run_route_count": declared_route_count,
            "buildable_dry_run_route_count": buildable_route_count,
        },
        "declared_uncovered_profiles": declared_uncovered_profiles,
        "uncovered_profiles": uncovered_profiles,
        "artifact_blocked_profiles": artifact_blocked_profiles,
        "profiles": rows,
        "boundary": (
            "Buildable no-order dry_run coverage only; it does not assert P4/P5/P6 "
            "runtime authority, broker connectivity, or artifact content quality."
        ),
    }


def build_runtime_artifact_evidence_registry(config: dict | None = None) -> dict[str, object]:
    """Build the immutable, no-order verification plan for required snapshots.

    This registry deliberately describes only controller-declared artifacts.  It
    never publishes data, rewrites a URI, or grants a strategy a higher
    lifecycle stage.  The verifier consumes it using a read-only cloud
    identity and reports failures back to the operator.
    """
    config = config if config is not None else load_config()
    coverage_by_profile = {
        str(row["profile"]): row
        for row in build_strategy_platform_dry_run_coverage(config)["profiles"]
        if isinstance(row, dict) and isinstance(row.get("profile"), str)
    }
    entries: list[dict[str, object]] = []
    for profile, strategy in sorted(config.get("strategies", {}).items()):
        if not isinstance(strategy, dict):
            continue
        runtime_artifacts = strategy.get("runtime_artifacts")
        feature_snapshot = (
            runtime_artifacts.get("feature_snapshot")
            if isinstance(runtime_artifacts, dict)
            else None
        )
        if not isinstance(feature_snapshot, dict) or feature_snapshot.get("required") is not True:
            continue
        snapshot_path = feature_snapshot.get("path")
        manifest_path = feature_snapshot.get("manifest_path")
        max_age_days = feature_snapshot.get("max_age_days")
        if not (
            isinstance(snapshot_path, str)
            and snapshot_path.startswith("gs://")
            and isinstance(manifest_path, str)
            and manifest_path.startswith("gs://")
            and isinstance(max_age_days, int)
            and not isinstance(max_age_days, bool)
            and max_age_days >= 1
        ):
            continue
        coverage = coverage_by_profile.get(str(profile), {})
        entries.append(
            {
                "profile": str(profile),
                "domain": str(strategy.get("domain") or ""),
                "snapshot_path": snapshot_path,
                "manifest_path": manifest_path,
                "max_age_days": max_age_days,
                "dry_run_platforms": list(coverage.get("buildable_dry_run_platforms", [])),
                "boundary": "read_only_evidence_check_no_publish_no_execution",
            }
        )
    return {
        "schema_version": "runtime_artifact_evidence_registry.v1",
        "entries": entries,
        "summary": {"required_artifact_count": len(entries)},
        "boundary": (
            "Read-only validation plan. A passing entry proves the declared object, "
            "manifest digest, and freshness contract; it does not authorize paper, "
            "shadow, or live execution."
        ),
    }


def validate_notification_references(config: dict, errors: list[str]) -> None:
    """Keep every Telegram notification route in runtime configuration."""
    notifications = config.get("notifications")
    if notifications is None:
        return
    if not isinstance(notifications, dict):
        errors.append("notifications must be an object")
        return
    for notification_name, notification in notifications.items():
        path = f"notifications.{notification_name}"
        if not isinstance(notification, dict):
            errors.append(f"{path} must be an object")
            continue
        if "telegram_chat_id" in notification:
            errors.append(
                f"{path} must not contain telegram_chat_id; use telegram_chat_id_ref"
            )
        if "telegram_chat_id_ref" not in notification:
            continue
        reference = notification["telegram_chat_id_ref"]
        if not isinstance(reference, dict):
            errors.append(f"{path}.telegram_chat_id_ref must be an object")
            continue
        if reference.get("source") != TELEGRAM_CHAT_ID_ROUTE_SOURCE:
            errors.append(
                f"{path}.telegram_chat_id_ref.source must be "
                f"{TELEGRAM_CHAT_ID_ROUTE_SOURCE!r}"
            )
        if reference.get("preferred_env") != TELEGRAM_CHAT_ID_PREFERRED_ENV:
            errors.append(
                f"{path}.telegram_chat_id_ref.preferred_env must be "
                f"{TELEGRAM_CHAT_ID_PREFERRED_ENV!r}"
            )
        if reference.get("fallback_envs") != list(TELEGRAM_CHAT_ID_FALLBACK_ENVS):
            errors.append(
                f"{path}.telegram_chat_id_ref.fallback_envs must be "
                f"{list(TELEGRAM_CHAT_ID_FALLBACK_ENVS)!r}"
            )
        aliases = notification.get("env_aliases")
        if not isinstance(aliases, dict) or aliases.get("chat_id") != [
            TELEGRAM_CHAT_ID_PREFERRED_ENV,
            *TELEGRAM_CHAT_ID_FALLBACK_ENVS,
        ]:
            errors.append(
                f"{path}.env_aliases.chat_id must match telegram_chat_id_ref"
            )


def validate_runtime_authority_status(config: dict, errors: list[str]) -> None:
    """Keep legacy execution metadata distinct from P0--P6 runtime authority."""
    meta = config.get("meta")
    authority = meta.get("runtime_authority") if isinstance(meta, dict) else None
    if not isinstance(authority, dict):
        errors.append("meta.runtime_authority must be an object")
        return
    if set(authority) != RUNTIME_AUTHORITY_STATUS_FIELDS:
        errors.append(
            "meta.runtime_authority fields must be "
            f"{sorted(RUNTIME_AUTHORITY_STATUS_FIELDS)}"
        )
        return
    for field, expected in CURRENT_RUNTIME_AUTHORITY_STATUS.items():
        if authority.get(field) != expected:
            errors.append(f"meta.runtime_authority.{field} must be {expected!r}")
    status_as_of = authority.get("status_as_of")
    if not isinstance(status_as_of, str):
        errors.append("meta.runtime_authority.status_as_of must be an ISO date")
        return
    try:
        dt.date.fromisoformat(status_as_of)
    except ValueError:
        errors.append("meta.runtime_authority.status_as_of must be an ISO date")


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
    """Build a control-plane queue of profiles that need policy-and-evidence verification."""
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
            recommended_action = "verify_preauthorized_policy_and_evidence"
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
                "operating_policy_required": True,
                "operating_policy_status": "UNVERIFIED",
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
    continuity = strategy.get("live_continuity") if isinstance(strategy.get("live_continuity"), dict) else {}
    if runtime_enabled and can_switch_live and lifecycle_stage == "runtime_enabled":
        lane = "live_equivalent_optimization"
        triggers = ["health_degradation", "parameter_drift", "scheduled_retest", "market_regime_shift"]
        max_autonomy = "auto_pr_or_trusted_live_equivalent"
        operating_policy_required = True
        operating_policy_status = "UNVERIFIED"
        evidence_required = ["backtest", "shadow_or_regression", "rollback_plan"]
    elif lifecycle_stage == "live_candidate":
        lane = "promotion_review"
        triggers = ["evidence_package_ready"]
        max_autonomy = "preauthorized_policy_and_evidence_required"
        operating_policy_required = True
        operating_policy_status = "UNVERIFIED"
        evidence_required = ["live_candidate_evidence", "preauthorized_operating_policy_receipt"]
    elif lifecycle_stage in {"shadow_candidate", "ai_monitored_candidate"}:
        lane = "shadow_research"
        triggers = ["shadow_disagreement", "web_research_signal", "scheduled_retest"]
        max_autonomy = "auto_pr_research_only"
        operating_policy_required = True
        operating_policy_status = "UNVERIFIED"
        evidence_required = ["shadow_metrics", "preauthorized_operating_policy_receipt"]
    else:
        lane = "research_backlog"
        triggers = ["web_research_signal", "manual_request", "scheduled_research"]
        max_autonomy = "auto_pr_research_only"
        operating_policy_required = False
        operating_policy_status = "NOT_APPLICABLE_RESEARCH_ONLY"
        evidence_required = ["backtest", "design_review"]
    return {
        "profile": profile,
        "label": strategy.get("label_zh") or strategy.get("label") or profile,
        "domain": strategy.get("domain", ""),
        "lifecycle_stage": lifecycle_stage,
        "automation_lane": lane,
        "max_autonomy": max_autonomy,
        "operating_policy_required": operating_policy_required,
        "operating_policy_status": operating_policy_status,
        "can_switch_live": can_switch_live,
        "blocked_live_reason": blocked_reason,
        "live_continuity": {
            "eligible": continuity.get("eligible") is True,
            "allowed_platforms": list(continuity.get("allowed_platforms") or []),
        },
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
            "operating_policy_required_count": sum(1 for item in profiles if item["operating_policy_required"]),
        },
        "profiles": profiles,
        "guardrails": [
            "Do not auto-promote new or reconstructed strategies to live.",
            "Live-equivalent optimization still requires trusted proof before auto-merge.",
            "Position-control-sensitive changes require deterministic risk-policy proof; AI has no delegated discretion to widen them.",
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
    dry_run_coverage = build_strategy_platform_dry_run_coverage(config)
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
            "name": "strategy_platform_dry_run_coverage",
            "status": "fail" if dry_run_coverage["uncovered_profiles"] else "pass",
            "severity": "critical",
            "messages": (
                [
                    "no default-buildable no-order platform route for: "
                    + ", ".join(dry_run_coverage["uncovered_profiles"])
                ]
                if dry_run_coverage["uncovered_profiles"]
                else []
            )
            + (
                [
                    "required external runtime artifact is not configured for: "
                    + ", ".join(dry_run_coverage["artifact_blocked_profiles"])
                ]
                if dry_run_coverage["artifact_blocked_profiles"]
                else []
            ),
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
    external_artifact_blocked = bool(dry_run_coverage["artifact_blocked_profiles"])
    repairable_config_failure = bool(
        config_errors
        or derivation_errors
        or dry_run_coverage["declared_uncovered_profiles"]
    )
    recommended_action = (
        "supply_verified_runtime_artifact"
        if external_artifact_blocked and not repairable_config_failure
        else "attempt_codex_fix"
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
            "dry_run_covered_strategy_count": dry_run_coverage["summary"]["covered_strategy_count"],
            "dry_run_uncovered_strategy_count": dry_run_coverage["summary"]["uncovered_strategy_count"],
            "dry_run_route_count": dry_run_coverage["summary"]["dry_run_route_count"],
            "declared_dry_run_route_count": dry_run_coverage["summary"]["declared_dry_run_route_count"],
            "buildable_dry_run_route_count": dry_run_coverage["summary"]["buildable_dry_run_route_count"],
            "artifact_blocked_strategy_count": len(dry_run_coverage["artifact_blocked_profiles"]),
            "automation_lane_counts": automation_registry["summary"]["lane_counts"],
        },
        "live_candidate_queue": live_candidate_queue,
        "strategy_platform_dry_run_coverage": dry_run_coverage,
        "automation_registry": automation_registry,
        "codex_repair_context": {
            "safe_to_attempt": bool(failed_checks) and not external_artifact_blocked,
            "scope": "QuantRuntimeSettings platform-config and generated strategy switch assets",
            "suggested_commands": [
                "python3 python/scripts/build_config.py --check",
                "python3 python/scripts/runtime_settings.py validate",
                "python3 python/scripts/build_config.py",
                "node tests/strategy_switch_worker_validation.mjs",
            ],
            "instructions": [
                "Keep fixes limited to platform-config, generated strategy profile assets, tests, or docs unless a failing check proves a wider change is required.",
                "Do not enable paper, shadow, or live switching without fresh evidence and a verified preauthorized operating policy.",
                "If the failure affects secrets, broker credentials, or live execution permissions, park execution and preserve the evidence boundary.",
                "Never invent a missing required artifact URI. Publish and validate the artifact and its manifest through its owning pipeline before configuring a default route.",
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
            "runtime_enabled": s.get("runtime_enabled", False),
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
    parser.add_argument(
        "--runtime-artifact-evidence-registry",
        action="store_true",
        help="Print the read-only verification registry for required runtime artifacts and exit",
    )
    args = parser.parse_args()

    config = load_config()
    if args.platform_health_report:
        report = build_platform_health_report(config)
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
        return 0 if report["status"] != "unhealthy" else 1
    if args.automation_registry:
        print(json.dumps(build_strategy_automation_registry(config), ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    if args.runtime_artifact_evidence_registry:
        print(
            json.dumps(
                build_runtime_artifact_evidence_registry(config),
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
        )
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
