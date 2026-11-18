#!/usr/bin/env python3
"""Strategy policy, scheduler, execution mode, and service target selection rules."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any

from schema_check import (
    as_dict,
    as_list,
    is_dict,
    is_list,
    is_list_of_dicts,
    is_mapping_or_seq,
    is_nonempty_str,
    is_sequence_container,
    is_str,
    parse_json_payload,
)

MARKET_FIELDS = ("market", "market_calendar", "market_timezone")

ACCOUNT_SYNC_CONTROL_FIELDS = {
    "DCA_MODE": "dca_mode",
    "DCA_BASE_INVESTMENT_USD": "dca_base_investment_usd",
}


def normalize_allowed_execution_modes(value: Any) -> list[str]:
    """Normalize a string or sequence of execution mode names into unique lowercase items."""
    if is_str(value):
        raw_modes = re.split(r"[,\s/|]+", value)
    elif is_sequence_container(value):
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
    """Return the policy mode without changing a legacy serialized target."""
    mode = str(runtime_target.get("execution_mode") or "").strip().lower()
    if runtime_target.get("dry_run_only") is True and mode in {"paper", "dry_run"}:
        return "dry_run"
    return mode


def _service_target_identity(entry: dict[str, Any], field: str) -> set[str]:
    entry_runtime = as_dict(entry.get("runtime_target"))
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
    """Select a single service target entry matching ``service_name`` or fallback scope."""
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


def _effective_target_plugin_mounts(
    target: dict[str, Any],
    runtime_target: dict[str, Any],
    *,
    supported_platforms: dict[str, dict[str, str]],
) -> Any:
    """Resolve strategy plugin mounts from top-level target or matched service inventory entry."""
    if is_list(target.get("plugin_mounts")):
        return target["plugin_mounts"]
    platform = str(runtime_target.get("platform_id") or "").strip()
    platform_cfg = as_dict(supported_platforms.get(platform))
    if not platform_cfg:
        return None
    mounts_variable = f"{platform_cfg.get('plugin_mounts_prefix', '')}STRATEGY_PLUGIN_MOUNTS_JSON"
    for scope_key in ("extra_variables", "repository_variables"):
        variables = as_dict(target.get(scope_key))
        if "CLOUD_RUN_SERVICE_TARGETS_JSON" not in variables:
            continue
        inventory = parse_json_payload(variables.get("CLOUD_RUN_SERVICE_TARGETS_JSON"))
        raw_entries = inventory.get("targets") if is_dict(inventory) else inventory
        if not is_list_of_dicts(raw_entries):
            continue
        try:
            matched_index = select_service_target_entry_index(runtime_target, raw_entries)
        except ValueError:
            continue
        if matched_index is None:
            continue
        entry = raw_entries[matched_index]
        raw_mounts = entry.get(mounts_variable)
        if raw_mounts is None and is_dict(entry.get("env")):
            raw_mounts = entry["env"].get(mounts_variable)
        if is_str(raw_mounts):
            raw_mounts = parse_json_payload(raw_mounts)
        if is_dict(raw_mounts) and is_list(raw_mounts.get("strategy_plugins")):
            return raw_mounts["strategy_plugins"]
        if is_list(raw_mounts):
            return raw_mounts
    return None


def _resolve_strategy_entry(
    strategies: Any,
    profile: str,
    aliases: dict[str, str],
) -> tuple[str, dict[str, Any] | None]:
    normalized_profile = profile.lower().replace("-", "_")
    canonical_profile = aliases.get(normalized_profile, normalized_profile)
    strategies_map = as_dict(strategies)
    strategy = strategies_map.get(canonical_profile) if strategies_map else None
    if not is_dict(strategy) and strategies_map and canonical_profile != profile:
        strategy = strategies_map.get(profile)
    return canonical_profile, strategy if is_dict(strategy) else None


def validate_live_ibkr_us_scheduler(
    runtime_target: dict[str, Any],
    scheduler: dict[str, Any],
    errors: list[str],
    *,
    plugin_mounts: Any = None,
    load_config_fn: Callable[[], dict[str, Any]] | None = None,
    aliases_fn: Callable[[], dict[str, str]] | None = None,
) -> None:
    """Validate Weekday/Sun-Fri cron rules for live IBKR US runtime targets."""
    if (
        runtime_target.get("platform_id") != "ibkr"
        or runtime_target.get("execution_mode") != "live"
        or runtime_target.get("dry_run_only") is not False
    ):
        return

    config = load_config_fn() if load_config_fn else {}
    strategies = config.get("strategies", {})
    domains = as_dict(config.get("domains", {}))
    profile = str(runtime_target.get("strategy_profile") or "").strip()
    aliases = aliases_fn() if aliases_fn else {}
    canonical_profile, strategy = _resolve_strategy_entry(strategies, profile, aliases)
    domain = as_dict(domains.get(strategy.get("domain"))) if (strategy is not None and domains) else {}

    market = str(runtime_target.get("market") or "").strip().upper()
    if not market and domain:
        market = str(domain.get("market") or "").strip().upper()
    if market != "US":
        return

    scheduler_profile = None
    if strategy is not None:
        scheduler_profile = strategy.get("scheduler_profile")
        plugin_overrides = as_dict(strategy.get("scheduler_profile_by_plugin"))
        if plugin_overrides and is_list(plugin_mounts):
            for mount in plugin_mounts:
                if (
                    is_dict(mount)
                    and mount.get("strategy") in {canonical_profile, profile}
                    and mount.get("enabled") is True
                ):
                    plugin = str(mount.get("plugin") or "").strip()
                    if plugin in plugin_overrides:
                        scheduler_profile = plugin_overrides[plugin]
    if not scheduler_profile and domain:
        scheduler_profile = domain.get("scheduler_profile")

    allow_23x5 = str(scheduler_profile or "").strip().startswith("us_23x5_")
    allowed_weekdays = {"1-5", "0-5", "0,1-5"} if allow_23x5 else {"1-5"}

    for field in ("main_time", "probe_time", "precheck_time"):
        value = scheduler.get(field)
        if not is_str(value):
            continue
        cron = value.split()
        if len(cron) == 2:
            continue
        if len(cron) == 5 and cron[2] == "*" and cron[4] in allowed_weekdays:
            continue
        if allow_23x5:
            errors.append(
                f"runtime_target.scheduler.{field} must be a two-field time or Sun-Fri 23x5 cron "
                "for live IBKR US 23x5 targets"
            )
        else:
            errors.append(
                f"runtime_target.scheduler.{field} must be a two-field time or Mon-Fri cron "
                "for live IBKR US targets"
            )


def validate_runtime_target_strategy_policy(
    runtime_target: dict[str, Any],
    errors: list[str],
    *,
    load_config_fn: Callable[[], dict[str, Any]] | None = None,
    aliases_fn: Callable[[], dict[str, str]] | None = None,
    validate_live_continuity_fn: Callable[[dict[str, Any], list[str]], None] | None = None,
    is_live_continuity_target_fn: Callable[[dict[str, Any]], bool] | None = None,
) -> None:
    """Validate runtime target platform, domain, execution mode, and continuity gates."""
    config = load_config_fn() if load_config_fn else {}
    strategies = config.get("strategies", {})
    platforms = config.get("platforms", {})
    domains = config.get("domains", {})
    if not (is_dict(strategies) and is_dict(platforms) and is_dict(domains)):
        return
    profile = str(runtime_target.get("strategy_profile") or "").strip()
    aliases = aliases_fn() if aliases_fn else {}
    _, strategy = _resolve_strategy_entry(strategies, profile, aliases)
    if strategy is None:
        return

    platform_id = str(runtime_target.get("platform_id") or "").strip()
    platform = as_dict(platforms.get(platform_id))
    domain = str(strategy.get("domain") or "").strip()
    domain_config = as_dict(domains.get(domain))
    supported_domains = as_list(platform.get("supported_domains", []))
    if domain and supported_domains and domain not in supported_domains:
        errors.append(f"runtime_target.strategy_profile domain {domain} is not supported by {platform_id}")

    if domain_config:
        if any(runtime_target.get(field) is not None for field in MARKET_FIELDS):
            for field in MARKET_FIELDS:
                actual = runtime_target.get(field)
                expected = domain_config.get(field)
                if is_nonempty_str(actual) and actual.strip() != expected:
                    errors.append(
                        f"runtime_target.{field} must match strategy domain {domain}: expected {expected!r}"
                    )
            scheduler = as_dict(runtime_target.get("scheduler"))
            if scheduler:
                actual_timezone = scheduler.get("timezone")
                expected_timezone = domain_config.get("market_timezone")
                if is_nonempty_str(actual_timezone) and actual_timezone.strip() != expected_timezone:
                    errors.append(
                        "runtime_target.scheduler.timezone must match strategy domain "
                        f"{domain}: expected {expected_timezone!r}"
                    )

    execution_mode = effective_execution_mode(runtime_target)
    deployment = as_dict(platform.get("deployment"))
    if execution_mode == "live" and deployment.get("live_configured") is False:
        errors.append(f"platform {platform_id} has no live runtime configuration")
    supported_execution_modes = normalize_allowed_execution_modes(deployment.get("supported_execution_modes"))
    if supported_execution_modes and execution_mode not in supported_execution_modes:
        errors.append(
            f"platform {platform_id} does not support {execution_mode} control execution"
        )

    continuity_target = (
        is_live_continuity_target_fn(runtime_target)
        if is_live_continuity_target_fn
        else is_dict(runtime_target.get("live_continuity"))
    )
    if strategy.get("frozen") is True:
        continuity = as_dict(runtime_target.get("live_continuity"))
        continuity_errors: list[str] = []
        if validate_live_continuity_fn is not None:
            validate_live_continuity_fn(runtime_target, continuity_errors)
        allowed_continuity = (
            execution_mode == "live"
            and bool(continuity)
            and continuity.get("state") in {"RECONCILE_ONLY", "RISK_REDUCTION_ONLY"}
            and not continuity_errors
        )
        if not allowed_continuity:
            errors.append(f"runtime_target.strategy_profile {profile} is frozen for new selection")

    allowed_modes = normalize_allowed_execution_modes(strategy.get("allowed_execution_modes"))
    if allowed_modes and execution_mode not in allowed_modes and not continuity_target:
        errors.append(f"runtime_target.strategy_profile {profile} does not allow {execution_mode} execution")

    if execution_mode != "live":
        return
    if continuity_target:
        continuity_policy = as_dict(strategy.get("live_continuity"))
        if continuity_policy.get("eligible") is not True:
            errors.append(
                f"runtime_target.strategy_profile {profile} is not eligible for live continuity"
            )
            return
        allowed_platforms = continuity_policy.get("allowed_platforms")
        if not is_list(allowed_platforms) or platform_id not in allowed_platforms:
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


def extract_account_sync_controls(target: dict[str, Any]) -> dict[str, str]:
    """Extract DCA control variables from extra or service target inventory variables."""
    extra_variables = dict(target.get("extra_variables") or {})
    controls: dict[str, str] = {}
    for source_key, payload_key in ACCOUNT_SYNC_CONTROL_FIELDS.items():
        value = extra_variables.get(source_key)
        if value not in (None, ""):
            controls[payload_key] = str(value).strip()

    service_targets = extra_variables.get("CLOUD_RUN_SERVICE_TARGETS_JSON")
    if service_targets is None:
        repository_variables = as_dict(target.get("repository_variables"))
        if repository_variables:
            service_targets = repository_variables.get("CLOUD_RUN_SERVICE_TARGETS_JSON")
    if is_str(service_targets):
        service_targets = parse_json_payload(service_targets)

    runtime_target = as_dict(target.get("runtime_target"))
    if is_mapping_or_seq(service_targets):
        raw_entries = service_targets.get("targets") if is_dict(service_targets) else service_targets
        entries = [entry for entry in raw_entries or [] if is_dict(entry)]
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
