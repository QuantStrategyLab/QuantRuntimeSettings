#!/usr/bin/env python3
"""Declarative runtime target schema and security boundary validators."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from schema_check import (
    FieldRule,
    as_dict,
    check_field_value,
    is_bool,
    is_dict,
    is_int_value,
    is_iso_date,
    is_list,
    is_mapping_or_seq,
    is_nonempty_str,
    is_nonempty_str_list,
    is_sha256_str,
    is_str,
    matches_mapping_rules,
    parse_json_payload,
    parse_utc_iso_timestamp,
    validate_mapping_schema,
    validate_variable_mapping,
)
from strategy_policy import (
    MARKET_FIELDS,
    _effective_target_plugin_mounts as _default_effective_target_plugin_mounts,
    validate_live_ibkr_us_scheduler as _default_validate_live_ibkr_us_scheduler,
    validate_runtime_target_strategy_policy as _default_validate_runtime_target_strategy_policy,
)

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
DECISION_DATA_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$")
DECISION_DATA_MODES = frozenset(
    {"legacy_runtime_fetch", "artifact_optional", "artifact_required"}
)
DECISION_DATA_ASSURANCE_STATUSES = frozenset({"LEGACY", "VERIFIED", "DEGRADED", "PARKED"})
DECISION_DATA_REQUIRED_FIELDS = frozenset(
    {"binding_id", "binding_sha256", "strategy_scope", "mode", "source_ids", "assurance_status"}
)
DECISION_DATA_ARTIFACT_FIELDS = frozenset({"as_of", "adjustment_basis", "artifact_sha256"})
DECISION_DATA_FIELDS = DECISION_DATA_REQUIRED_FIELDS | DECISION_DATA_ARTIFACT_FIELDS
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

ACCOUNT_DOMAIN_IDENTITY_FIELDS = frozenset(
    {"environment", "platform_id", "server", "account_id_fingerprint", "lifecycle_id"}
)
ACCOUNT_DOMAIN_POLICY_FIELDS = frozenset(
    {
        "capital_kind",
        "product",
        "phase",
        "account_type",
        "style",
        "preference",
        "currency",
        "source",
        "effective_at",
        "valid_until",
        "version",
    }
)
ACCOUNT_DOMAIN_IDENTITY_RULES = {field: FieldRule(kind="nonempty_str") for field in ACCOUNT_DOMAIN_IDENTITY_FIELDS}
ACCOUNT_DOMAIN_POLICY_RULES = {field: FieldRule(kind="nonempty_str") for field in ACCOUNT_DOMAIN_POLICY_FIELDS}
ACCOUNT_DOMAIN_FINGERPRINT_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
STRATEGY_RELEASE_RULES = {
    field: FieldRule(
        kind="nonempty_str",
        required_error=f"runtime_target.strategy_release.{field} is required",
        invalid_error=f"runtime_target.strategy_release.{field} is required",
    )
    for field in STRATEGY_RELEASE_REQUIRED_FIELDS
}
SCHEDULER_RULES = {
    "timezone": FieldRule(
        kind="nonempty_str",
        required_error="runtime_target.scheduler.timezone must be a non-empty string",
        invalid_error="runtime_target.scheduler.timezone must be a non-empty string",
    ),
    **{
        field: FieldRule(
            kind="cron_or_time",
            required_error=f"runtime_target.scheduler.{field} must have 2 time fields or 5 cron fields",
            invalid_error=f"runtime_target.scheduler.{field} must have 2 time fields or 5 cron fields",
        )
        for field in ("main_time", "probe_time", "precheck_time")
    },
}
EXECUTION_WINDOW_RULES = {
    window_name: {
        "enabled": FieldRule(
            kind="bool",
            required=False,
            invalid_error=f"runtime_target.execution_windows.{window_name}.enabled must be boolean",
        ),
        "offset_minutes": FieldRule(
            kind="int",
            required=False,
            min_value=0,
            invalid_error=f"runtime_target.execution_windows.{window_name}.offset_minutes must be a non-negative integer",
        ),
        "mode": FieldRule(
            kind="custom",
            required=False,
            predicate=lambda v, allowed=allowed_modes: v is None or v in allowed,
            invalid_error=f"runtime_target.execution_windows.{window_name}.mode must be one of {sorted(allowed_modes)}",
        ),
    }
    for window_name, allowed_modes in WINDOW_MODES.items()
}


def runtime_target_fingerprint(runtime_target: dict[str, Any]) -> str:
    """Fingerprint a frozen target excluding only its current continuity state."""
    payload = dict(runtime_target)
    payload.pop("live_continuity", None)
    encoded = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def is_secret_variable_name(name: str) -> bool:
    """Return True if a GitHub Actions variable name looks like raw secret material."""
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
    """Validate the ``github`` destination block of a target descriptor."""
    github = target.get("github")
    if not is_dict(github):
        errors.append("github must be an object")
        return

    repository = github.get("repository")
    if not is_str(repository) or "/" not in repository:
        errors.append("github.repository must be owner/repo")

    scope = github.get("variable_scope")
    if scope not in {"repository", "environment"}:
        errors.append("github.variable_scope must be repository or environment")
    if scope == "environment" and not str(github.get("environment") or "").strip():
        errors.append("github.environment is required for environment variable scope")
    if scope == "repository" and github.get("environment"):
        errors.append("github.environment must be omitted for repository variable scope")


def validate_account_domain(domain: Any, errors: list[str]) -> None:
    """Validate optional ``runtime_target.account_domain`` identity and policy claims."""
    if not is_dict(domain) or set(domain) != {"identity", "policy"}:
        errors.append("runtime_target.account_domain must contain identity and policy")
        return
    identity, policy = domain["identity"], domain["policy"]
    if not matches_mapping_rules(identity, ACCOUNT_DOMAIN_IDENTITY_RULES):
        errors.append("runtime_target.account_domain.identity is invalid")
        return
    if not ACCOUNT_DOMAIN_FINGERPRINT_RE.fullmatch(identity["account_id_fingerprint"]):
        errors.append("runtime_target.account_domain.identity fingerprint is invalid")
    if not matches_mapping_rules(policy, ACCOUNT_DOMAIN_POLICY_RULES):
        errors.append("runtime_target.account_domain.policy is invalid")
        return
    ftmo = (policy["capital_kind"], policy["product"], policy["phase"], identity["environment"]) == (
        "FTMO_SIMULATED",
        "FTMO_CFD_2_STEP",
        "FREE_TRIAL",
        "DEMO",
    ) and policy["account_type"] in {"STANDARD", "SWING"}
    own = (policy["capital_kind"], policy["product"], policy["phase"], identity["environment"]) == (
        "OWN_REAL",
        "BROKERAGE",
        "LIVE",
        "LIVE",
    ) and policy["account_type"] in {"CASH", "MARGIN"}
    if not (ftmo or own):
        errors.append("runtime_target.account_domain policy combination is invalid")
    if policy["preference"] not in {"CAPITAL_PRESERVATION", "BALANCED_COMPOUNDING", "GROWTH_COMPOUNDING"}:
        errors.append("runtime_target.account_domain preference is invalid")
    if not re.fullmatch(r"[A-Z]{3}", policy["currency"]):
        errors.append("runtime_target.account_domain currency is invalid")
    effective = parse_utc_iso_timestamp(policy["effective_at"])
    expiry = parse_utc_iso_timestamp(policy["valid_until"])
    if effective is None or expiry is None or expiry <= effective:
        errors.append("runtime_target.account_domain policy validity interval is invalid")


def validate_strategy_release(runtime_target: dict[str, Any], errors: list[str]) -> None:
    """Validate an optional immutable release identity without enabling it."""
    release = runtime_target.get("strategy_release")
    if release is None:
        return
    if not validate_mapping_schema(
        release,
        STRATEGY_RELEASE_RULES,
        errors=errors,
        prefix="runtime_target.strategy_release",
        not_dict_error="runtime_target.strategy_release must be an object when present",
    ):
        return
    for field in STRATEGY_RELEASE_REQUIRED_FIELDS:
        value = release.get(field)
        if not is_nonempty_str(value):
            continue
        if field == "release_id" and not STRATEGY_RELEASE_ID_PATTERN.fullmatch(value.strip()):
            errors.append("runtime_target.strategy_release.release_id has invalid characters")
        if field in STRATEGY_RELEASE_DIGEST_FIELDS and not is_sha256_str(value, allow_prefix=True):
            errors.append(f"runtime_target.strategy_release.{field} must be a SHA-256 digest")
        if field == "effective_session" and not is_iso_date(value):
            errors.append(
                "runtime_target.strategy_release.effective_session must be an ISO-8601 date"
            )


def _is_decision_identifier(value: Any) -> bool:
    return check_field_value(value, FieldRule(kind="regex", pattern=DECISION_DATA_IDENTIFIER_PATTERN))


def validate_decision_data(runtime_target: dict[str, Any], errors: list[str]) -> None:
    """Validate an optional public-safe decision-data binding summary."""
    decision_data = runtime_target.get("decision_data")
    if decision_data is None:
        return
    if not is_dict(decision_data):
        errors.append("runtime_target.decision_data must be an object when present")
        return

    unsupported = sorted(set(decision_data) - DECISION_DATA_FIELDS)
    if unsupported:
        errors.append(
            "runtime_target.decision_data contains unsupported fields: " + ", ".join(unsupported)
        )
    for field in sorted(DECISION_DATA_REQUIRED_FIELDS):
        if field not in decision_data:
            errors.append(f"runtime_target.decision_data.{field} is required")

    for field in ("binding_id", "strategy_scope"):
        if not _is_decision_identifier(decision_data.get(field)):
            errors.append(f"runtime_target.decision_data.{field} must be a stable identifier")

    if not is_sha256_str(decision_data.get("binding_sha256"), allow_prefix=True):
        errors.append("runtime_target.decision_data.binding_sha256 must be a SHA-256 digest")

    mode = decision_data.get("mode")
    if mode not in DECISION_DATA_MODES:
        errors.append(
            "runtime_target.decision_data.mode must be one of " + ", ".join(sorted(DECISION_DATA_MODES))
        )

    source_ids = decision_data.get("source_ids")
    if not is_list(source_ids) or not source_ids:
        errors.append("runtime_target.decision_data.source_ids must be a non-empty list")
    elif not all(_is_decision_identifier(value) for value in source_ids) or len(set(source_ids)) != len(source_ids):
        errors.append("runtime_target.decision_data.source_ids must contain unique stable identifiers")

    assurance_status = decision_data.get("assurance_status")
    if assurance_status not in DECISION_DATA_ASSURANCE_STATUSES:
        errors.append(
            "runtime_target.decision_data.assurance_status must be one of "
            + ", ".join(sorted(DECISION_DATA_ASSURANCE_STATUSES))
        )

    if mode == "legacy_runtime_fetch":
        unexpected = sorted(field for field in DECISION_DATA_ARTIFACT_FIELDS if field in decision_data)
        if unexpected:
            errors.append(
                "runtime_target.decision_data.legacy_runtime_fetch must not contain " + ", ".join(unexpected)
            )
        if assurance_status != "LEGACY":
            errors.append("runtime_target.decision_data.legacy_runtime_fetch requires assurance_status LEGACY")
        return

    for field in sorted(DECISION_DATA_ARTIFACT_FIELDS):
        if not is_nonempty_str(decision_data.get(field)):
            errors.append(f"runtime_target.decision_data.{field} is required for artifact modes")
    artifact_sha256 = decision_data.get("artifact_sha256")
    if is_nonempty_str(artifact_sha256) and not is_sha256_str(artifact_sha256, allow_prefix=True):
        errors.append("runtime_target.decision_data.artifact_sha256 must be a SHA-256 digest")
    adjustment_basis = decision_data.get("adjustment_basis")
    if is_nonempty_str(adjustment_basis) and not _is_decision_identifier(adjustment_basis):
        errors.append("runtime_target.decision_data.adjustment_basis must be a stable identifier")
    as_of = decision_data.get("as_of")
    if is_nonempty_str(as_of) and not is_iso_date(as_of):
        errors.append("runtime_target.decision_data.as_of must be an ISO-8601 date")
    if assurance_status == "LEGACY":
        errors.append("runtime_target.decision_data artifact modes must not use LEGACY assurance_status")
    if mode == "artifact_required" and assurance_status != "VERIFIED":
        errors.append("runtime_target.decision_data artifact_required requires assurance_status VERIFIED")


def validate_live_continuity(runtime_target: dict[str, Any], errors: list[str]) -> None:
    """Validate a frozen incumbent baseline independently of candidate policy."""
    continuity = runtime_target.get("live_continuity")
    if continuity is None:
        return
    if not is_dict(continuity):
        errors.append("runtime_target.live_continuity must be an object when present")
        return
    unsupported = sorted(set(continuity) - LIVE_CONTINUITY_FIELDS)
    if unsupported:
        errors.append(
            "runtime_target.live_continuity contains unsupported fields: " + ", ".join(unsupported)
        )
    for field in sorted(LIVE_CONTINUITY_FIELDS):
        if not is_nonempty_str(continuity.get(field)):
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
    digest = str(continuity.get("baseline_target_sha256") or "").strip().lower().removeprefix("sha256:")
    if not is_sha256_str(digest, allow_prefix=True):
        errors.append("runtime_target.live_continuity.baseline_target_sha256 must be a SHA-256 digest")
    elif digest != runtime_target_fingerprint(runtime_target):
        errors.append(
            "runtime_target.live_continuity.baseline_target_sha256 does not match the runtime target"
        )
    captured_at = str(continuity.get("captured_at") or "").strip()
    if captured_at and not is_iso_date(captured_at):
        errors.append("runtime_target.live_continuity.captured_at must be an ISO-8601 date")
    if baseline_kind == "release_attested" and not is_dict(runtime_target.get("strategy_release")):
        errors.append("release_attested live_continuity requires runtime_target.strategy_release")


def is_live_continuity_target(runtime_target: dict[str, Any]) -> bool:
    """Return True when ``runtime_target`` carries a dict ``live_continuity`` section."""
    return is_dict(runtime_target.get("live_continuity"))


def _validate_execution_windows(execution_windows: Any, errors: list[str]) -> None:
    if execution_windows is None:
        return
    if not is_dict(execution_windows):
        errors.append("runtime_target.execution_windows must be an object when present")
        return
    for window_name, window_rules in EXECUTION_WINDOW_RULES.items():
        window = execution_windows.get(window_name)
        if window is None:
            continue
        validate_mapping_schema(
            window,
            window_rules,
            errors=errors,
            prefix=f"runtime_target.execution_windows.{window_name}",
            not_dict_error=f"runtime_target.execution_windows.{window_name} must be an object",
            unsupported_template="{prefix}.{field} is unsupported",
        )
    for window_name in execution_windows:
        if window_name not in WINDOW_MODES:
            errors.append("runtime_target.execution_windows only supports precheck and execution")
            break


def validate_runtime_target(
    target: dict[str, Any],
    errors: list[str],
    *,
    supported_platforms: dict[str, dict[str, str]],
    strategy_policy_validator: Callable[[dict[str, Any], list[str]], None] | None = None,
    scheduler_validator: Callable[..., None] | None = None,
    effective_mounts_fn: Callable[[dict[str, Any], dict[str, Any]], Any] | None = None,
) -> None:
    """Validate the ``runtime_target`` section of a target configuration."""
    runtime_target = target.get("runtime_target")
    if not is_dict(runtime_target):
        errors.append("runtime_target must be an object")
        return

    if "account_domain" in runtime_target:
        validate_account_domain(runtime_target["account_domain"], errors)
        domain = as_dict(runtime_target["account_domain"])
        identity = as_dict(domain.get("identity"))
        if identity and identity.get("platform_id") != runtime_target.get("platform_id"):
            errors.append("runtime_target.account_domain platform_id must match runtime_target.platform_id")

    for field in RUNTIME_REQUIRED_FIELDS:
        if field not in runtime_target:
            errors.append(f"runtime_target.{field} is required")

    platform_id = runtime_target.get("platform_id")
    if platform_id not in supported_platforms:
        errors.append(f"runtime_target.platform_id is unsupported: {platform_id!r}")

    if not is_nonempty_str(runtime_target.get("strategy_profile")):
        errors.append("runtime_target.strategy_profile must be a non-empty string")

    if not is_bool(runtime_target.get("dry_run_only")):
        errors.append("runtime_target.dry_run_only must be boolean")

    account_selector = runtime_target.get("account_selector")
    if not is_list(account_selector) or not account_selector:
        errors.append("runtime_target.account_selector must be a non-empty list")
    elif not is_nonempty_str_list(account_selector):
        errors.append("runtime_target.account_selector must only contain non-empty strings")

    execution_mode = runtime_target.get("execution_mode")
    domain = as_dict(runtime_target.get("account_domain"))
    policy = as_dict(domain.get("policy"))
    if policy:
        kind = policy.get("capital_kind")
        if runtime_target.get("dry_run_only") is False:
            required_mode = {"FTMO_SIMULATED": "paper", "OWN_REAL": "live"}.get(kind)
            if required_mode is None or execution_mode != required_mode:
                errors.append("runtime_target.execution_mode conflicts with account_domain capital_kind")

    if execution_mode not in {"live", "paper", "dry_run"}:
        errors.append("runtime_target.execution_mode must be live, paper, or dry_run")
    else:
        dry_run_only = runtime_target.get("dry_run_only")
        if execution_mode == "live" and dry_run_only is not False:
            errors.append("runtime_target.execution_mode live requires dry_run_only false")
        if execution_mode == "dry_run" and dry_run_only is not True:
            errors.append("runtime_target.execution_mode dry_run requires dry_run_only true")
        policy_fn = strategy_policy_validator or (
            lambda rt, errs: _default_validate_runtime_target_strategy_policy(
                rt,
                errs,
                validate_live_continuity_fn=validate_live_continuity,
                is_live_continuity_target_fn=is_live_continuity_target,
            )
        )
        policy_fn(runtime_target, errors)

    _validate_execution_windows(runtime_target.get("execution_windows"), errors)

    scheduler = runtime_target.get("scheduler")
    if scheduler is not None:
        if validate_mapping_schema(
            scheduler,
            SCHEDULER_RULES,
            errors=errors,
            prefix="runtime_target.scheduler",
            not_dict_error="runtime_target.scheduler must be an object when present",
            unsupported_template="{prefix}.{field} is unsupported",
        ):
            mounts = (
                effective_mounts_fn(target, runtime_target)
                if effective_mounts_fn
                else _default_effective_target_plugin_mounts(
                    target, runtime_target, supported_platforms=supported_platforms
                )
            )
            sched_fn = scheduler_validator or _default_validate_live_ibkr_us_scheduler
            sched_fn(runtime_target, scheduler, errors, plugin_mounts=mounts)

    configured_market_fields = []
    for field in MARKET_FIELDS:
        value = runtime_target.get(field)
        if value is not None:
            configured_market_fields.append(field)
        if value is not None and not is_nonempty_str(value):
            errors.append(f"runtime_target.{field} must be a non-empty string when present")
    if configured_market_fields and len(configured_market_fields) != len(MARKET_FIELDS):
        errors.append(
            "runtime_target market metadata must include "
            "market, market_calendar, and market_timezone together"
        )
    market_timezone = runtime_target.get("market_timezone")
    if is_nonempty_str(market_timezone):
        try:
            ZoneInfo(market_timezone)
        except (ZoneInfoNotFoundError, ValueError):
            errors.append(f"runtime_target.market_timezone is invalid: {market_timezone!r}")
    validate_strategy_release(runtime_target, errors)
    validate_decision_data(runtime_target, errors)
    validate_live_continuity(runtime_target, errors)


def validate_plugin_mounts(
    target: dict[str, Any],
    errors: list[str],
    *,
    supported_platforms: dict[str, dict[str, str]],
    load_local_policy_fn: Callable[[], dict[str, Any]],
) -> None:
    """Validate optional strategy plugin mounts and local policy plugin requirements."""
    runtime_target = as_dict(target.get("runtime_target"))
    strategy_profile = runtime_target.get("strategy_profile")
    platform_id = runtime_target.get("platform_id")
    mounts_variable = target.get("plugin_mounts_variable")
    mounts = target.get("plugin_mounts", [])

    if mounts_variable is not None:
        if not is_nonempty_str(mounts_variable):
            errors.append("plugin_mounts_variable must be a non-empty string when present")
        elif platform_id in supported_platforms:
            expected_prefix = supported_platforms[platform_id]["plugin_mounts_prefix"]
            if not mounts_variable.startswith(expected_prefix):
                errors.append(f"plugin_mounts_variable should start with {expected_prefix!r} for {platform_id}")

    if mounts_variable is None and mounts:
        errors.append("plugin_mounts_variable is required when plugin_mounts are present")
        return

    if not is_list(mounts):
        errors.append("plugin_mounts must be a list")
        return

    matching_plugins: set[str] = set()
    for index, mount in enumerate(mounts):
        if not is_dict(mount):
            errors.append(f"plugin_mounts[{index}] must be an object")
            continue

        for field in ("strategy", "plugin", "signal_path", "enabled", "expected_mode"):
            if field not in mount:
                errors.append(f"plugin_mounts[{index}].{field} is required")

        if not is_bool(mount.get("enabled")):
            errors.append(f"plugin_mounts[{index}].enabled must be boolean")

        expected_schema_version = mount.get("expected_schema_version")
        if expected_schema_version is not None and not is_nonempty_str(expected_schema_version):
            errors.append(f"plugin_mounts[{index}].expected_schema_version must be a non-empty string")

        expected_mode = mount.get("expected_mode")
        if not check_field_value(expected_mode, FieldRule(kind="choice", choices={"dry_run", "paper", "shadow"})):
            errors.append(
                f"plugin_mounts[{index}].expected_mode must be dry_run, paper, or shadow; plugins cannot request live execution"
            )

        if not check_field_value(mount.get("signal_path"), FieldRule(kind="prefix", prefix="gs://")):
            errors.append(f"plugin_mounts[{index}].signal_path must be a gs:// URI")

        if mount.get("strategy") == strategy_profile and mount.get("enabled") is True:
            plugin = mount.get("plugin")
            if is_str(plugin):
                matching_plugins.add(plugin)

    policy = load_local_policy_fn()
    required_plugins_by_strategy = policy.get("required_plugins_by_strategy", {})
    if required_plugins_by_strategy and not is_dict(required_plugins_by_strategy):
        errors.append("local policy required_plugins_by_strategy must be an object")
        return

    required_plugins = required_plugins_by_strategy.get(strategy_profile, [])
    if is_str(required_plugins):
        required_plugins = [required_plugins]
    if not is_list(required_plugins):
        errors.append(f"local policy required plugins for {strategy_profile} must be a list or string")
        return
    for plugin in required_plugins:
        if plugin not in matching_plugins:
            errors.append(f"{strategy_profile} requires an enabled {plugin} plugin mount")


def option_bool_value(value: Any) -> bool | None:
    """Parse truthy/falsy option marker text or return None."""
    text = str(value if value is not None else "").strip().lower()
    if text in {"1", "true", "yes", "y", "on"}:
        return True
    if text in {"0", "false", "no", "n", "off"}:
        return False
    return None


def validate_option_overlay_variables(extra_variables: dict[str, Any], errors: list[str]) -> None:
    """Reject legacy option requests while allowing explicit disabled markers."""
    for name in sorted(OPTION_OVERLAY_VARIABLES):
        if name not in extra_variables:
            continue
        value = extra_variables[name]
        text = str(value if value is not None else "").strip()
        if not text:
            continue
        if name in OPTION_OVERLAY_ENABLED_VARIABLES and option_bool_value(value) is False:
            continue
        errors.append(f"extra_variables.{name}: option overlay retired; migrate existing settings explicitly")


def validate_nonsecret_service_target_inventory(value: Any, *, path: str, errors: list[str]) -> None:
    """Reject secret-shaped keys nested in a variable-backed service inventory."""
    payload = parse_json_payload(value)

    def visit(node: Any, current_path: str) -> None:
        if is_dict(node):
            for key, nested in node.items():
                key_text = str(key)
                nested_path = f"{current_path}.{key_text}"
                if is_secret_variable_name(key_text):
                    errors.append(f"{nested_path} looks like a secret and must not be stored here")
                    continue
                visit(nested, nested_path)
        elif is_list(node):
            for index, nested in enumerate(node):
                visit(nested, f"{current_path}[{index}]")

    if is_mapping_or_seq(payload):
        visit(payload, path)


def validate_extra_variables(
    target: dict[str, Any],
    errors: list[str],
    *,
    env_string_fn: Callable[[Any], str],
) -> None:
    """Validate ``extra_variables`` and enforce platform dry-run parity."""
    extra_variables = target.get("extra_variables", {})
    generated_names = set(GENERATED_VARIABLES)
    plugin_mounts_variable = target.get("plugin_mounts_variable")
    if is_str(plugin_mounts_variable):
        generated_names.add(plugin_mounts_variable)

    if not validate_variable_mapping(
        extra_variables,
        scope_name="extra_variables",
        generated_names=generated_names,
        research_only_names=RESEARCH_ONLY_EXTRA_VARIABLES,
        is_secret_fn=is_secret_variable_name,
        validate_inventory_fn=validate_nonsecret_service_target_inventory,
        errors=errors,
    ):
        return

    validate_option_overlay_variables(extra_variables, errors)

    runtime_target = as_dict(target.get("runtime_target"))
    dry_run_only = runtime_target.get("dry_run_only")
    platform_id = runtime_target.get("platform_id")
    dry_run_variable = PLATFORM_DRY_RUN_VARIABLES.get(str(platform_id or ""))
    platform_dry_run = extra_variables.get(dry_run_variable) if dry_run_variable else None
    if platform_dry_run is not None and env_string_fn(platform_dry_run).lower() != env_string_fn(dry_run_only):
        errors.append(f"extra_variables.{dry_run_variable} must match runtime_target.dry_run_only")


def validate_repository_variables(target: dict[str, Any], errors: list[str]) -> None:
    """Validate ``repository_variables`` against duplicates, secrets, and research-only keys."""
    repository_variables = target.get("repository_variables", {})
    extra_variables = target.get("extra_variables")
    extra_variable_names = set(extra_variables) if is_dict(extra_variables) else set()
    validate_variable_mapping(
        repository_variables,
        scope_name="repository_variables",
        generated_names=set(GENERATED_VARIABLES),
        research_only_names=RESEARCH_ONLY_EXTRA_VARIABLES,
        is_secret_fn=is_secret_variable_name,
        validate_inventory_fn=validate_nonsecret_service_target_inventory,
        errors=errors,
        duplicate_names=extra_variable_names,
        duplicate_label="extra_variables",
    )


def validate_target(
    target: dict[str, Any],
    path: Path | None = None,
    *,
    supported_platforms: dict[str, dict[str, str]],
    target_path_id_fn: Callable[[Path], str | None],
    platform_repository_fn: Callable[[str], str],
    validate_github_fn: Callable[[dict[str, Any], list[str]], None] | None = None,
    validate_runtime_target_fn: Callable[[dict[str, Any], list[str]], None] | None = None,
    validate_plugin_mounts_fn: Callable[[dict[str, Any], list[str]], None] | None = None,
    validate_extra_variables_fn: Callable[[dict[str, Any], list[str]], None] | None = None,
    validate_repository_variables_fn: Callable[[dict[str, Any], list[str]], None] | None = None,
) -> list[str]:
    """Validate a complete runtime target descriptor and return accumulated errors."""
    errors: list[str] = []
    target_id = target.get("target_id")

    if not is_str(target_id) or "/" not in target_id:
        errors.append("target_id must be platform/name")
    elif path is not None:
        expected_id = target_path_id_fn(path)
        if expected_id and expected_id != target_id:
            errors.append(f"target_id {target_id!r} does not match path id {expected_id!r}")

    (validate_github_fn or validate_github)(target, errors)
    if validate_runtime_target_fn is not None:
        validate_runtime_target_fn(target, errors)
    else:
        validate_runtime_target(target, errors, supported_platforms=supported_platforms)
    if validate_plugin_mounts_fn is not None:
        validate_plugin_mounts_fn(target, errors)
    (validate_extra_variables_fn or (lambda t, e: None))(target, errors)
    (validate_repository_variables_fn or validate_repository_variables)(target, errors)

    runtime_target = as_dict(target.get("runtime_target"))
    github = as_dict(target.get("github"))
    platform_id = runtime_target.get("platform_id")
    if platform_id in supported_platforms:
        try:
            expected_repository = platform_repository_fn(platform_id)
        except ValueError as exc:
            errors.append(str(exc))
        else:
            if github.get("repository") != expected_repository:
                errors.append(
                    f"github.repository does not match platform {platform_id}: expected {expected_repository}"
                )

    return errors
