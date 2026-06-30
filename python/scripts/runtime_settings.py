#!/usr/bin/env python3
"""Validate and render QuantStrategyLab runtime target settings."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
LOCAL_TARGETS_DIR = ROOT / "local" / "targets"
EXAMPLE_TARGETS_DIR = ROOT / "examples" / "targets"
LOCAL_POLICY_PATH = ROOT / "local" / "policy.json"

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
            shlex.quote(part)
            for part in self.gh_command(redact_body=redact_body, redact_metadata=redact_metadata)
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
    repositories = {
        platform: config["repository"]
        for platform, config in SUPPORTED_PLATFORMS.items()
    }
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
                        errors.append(
                            f"runtime_target.execution_windows.{window_name}.{field} is unsupported"
                        )
                if "enabled" in window and not isinstance(window["enabled"], bool):
                    errors.append(
                        f"runtime_target.execution_windows.{window_name}.enabled must be boolean"
                    )
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
                    errors.append(
                        "runtime_target.execution_windows only supports precheck and execution"
                    )
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
                    errors.append(
                        f"runtime_target.scheduler.{field} must have 2 time fields or 5 cron fields"
                    )


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
            errors.append(
                f"extra_variables.{name} is research-only and must not be stored in live switch settings"
            )
        if is_secret_variable_name(name):
            errors.append(f"extra_variables.{name} looks like a secret and must not be stored here")
        if isinstance(value, str) and "\n" in value:
            errors.append(f"extra_variables.{name} must be a single-line value")

    validate_option_overlay_variables(extra_variables, errors)

    runtime_target = target.get("runtime_target") if isinstance(target.get("runtime_target"), dict) else {}
    dry_run_only = runtime_target.get("dry_run_only")
    platform_id = runtime_target.get("platform_id")
    dry_run_variable = PLATFORM_DRY_RUN_VARIABLES.get(str(platform_id or ""))
    platform_dry_run = extra_variables.get(dry_run_variable) if dry_run_variable else None
    if platform_dry_run is not None and env_string(platform_dry_run).lower() != env_string(dry_run_only):
        errors.append(f"extra_variables.{dry_run_variable} must match runtime_target.dry_run_only")


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
                    "github.repository does not match platform "
                    f"{platform_id}: expected {expected_repository}"
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
                [
                    assignment_payload(assignment, redact_values=args.redact_values)
                    for assignment in all_assignments
                ],
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


ACCOUNT_SYNC_CONTROL_FIELDS = {
    "DCA_MODE": "dca_mode",
    "DCA_BASE_INVESTMENT_USD": "dca_base_investment_usd",
    "IBIT_ZSCORE_EXIT_MODE": "ibit_zscore_exit_mode",
}


def _service_target_entry_matches(runtime_target: dict[str, Any], entry: dict[str, Any]) -> bool:
    service_name = str(runtime_target.get("service_name") or "").strip()
    account_scope = str(runtime_target.get("account_scope") or "").strip()
    entry_runtime = entry.get("runtime_target") if isinstance(entry.get("runtime_target"), dict) else {}
    candidates = {
        str(entry.get("service") or "").strip(),
        str(entry.get("service_name") or "").strip(),
        str(entry_runtime.get("service_name") or "").strip(),
        str(entry_runtime.get("account_scope") or "").strip(),
        str(entry.get("ACCOUNT_GROUP") or "").strip(),
    }
    return service_name in candidates or account_scope in candidates


def extract_account_sync_controls(target: dict[str, Any]) -> dict[str, str]:
    extra_variables = dict(target.get("extra_variables") or {})
    controls: dict[str, str] = {}
    for source_key, payload_key in ACCOUNT_SYNC_CONTROL_FIELDS.items():
        value = extra_variables.get(source_key)
        if value not in (None, ""):
            controls[payload_key] = str(value).strip()

    service_targets = extra_variables.get("CLOUD_RUN_SERVICE_TARGETS_JSON")
    if isinstance(service_targets, str):
        try:
            service_targets = json.loads(service_targets)
        except json.JSONDecodeError:
            service_targets = None

    runtime_target = target.get("runtime_target") if isinstance(target.get("runtime_target"), dict) else {}
    if isinstance(service_targets, dict):
        entries = service_targets.get("targets") if isinstance(service_targets.get("targets"), list) else []
        matched = next(
            (
                entry
                for entry in entries
                if isinstance(entry, dict) and _service_target_entry_matches(runtime_target, entry)
            ),
            None,
        )
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

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
