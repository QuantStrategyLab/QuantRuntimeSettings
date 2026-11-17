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
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from config_overlay import load_platform_config as load_platform_config_with_overlay  # noqa: E402
from runtime_control_ops import (  # noqa: E402
    _disabled_profile_expected_variables as _disabled_profile_expected_variables_impl,
    _disabled_profile_target_pair as _disabled_profile_target_pair_impl,
    _optional_stop_correlation,
    _stop_request_identity as _stop_request_identity_impl,
    apply_disabled_strategy_profile_change as _apply_disabled_strategy_profile_change_impl,
    build_stop_assignments as _build_stop_assignments_impl,
    command_runtime_control as _command_runtime_control_impl,
    command_runtime_control_readback as _command_runtime_control_readback_impl,
    command_stop as _command_stop_impl,
    dispatch_hk_stop as _dispatch_hk_stop_impl,
    dispatch_runtime_control as _dispatch_runtime_control_impl,
    execute_stop as _execute_stop_impl,
    load_stop_request,
    read_disabled_profile_apply_variables as _read_disabled_profile_apply_variables_impl,
    read_runtime_control_receipt_zip,
    read_runtime_control_result as _read_runtime_control_result_impl,
    read_stop_variables as _read_stop_variables_impl,
    recover_runtime_control_run as _recover_runtime_control_run_impl,
    require_hk_stop_target as _require_hk_stop_target_impl,
    runtime_control_workflow_preflight as _runtime_control_workflow_preflight_impl,
    validate_runtime_control_receipt as _validate_runtime_control_receipt_impl,
    write_disabled_profile_assignment as _write_disabled_profile_assignment_impl,
)
from schema_check import is_nonempty_str, is_strict_int, parse_json_payload  # noqa: E402
from strategy_policy import (  # noqa: E402
    ACCOUNT_SYNC_CONTROL_FIELDS,
    MARKET_FIELDS,
    _effective_target_plugin_mounts as _effective_target_plugin_mounts_impl,
    _service_target_entry_matches,
    _service_target_identity,
    effective_execution_mode,
    extract_account_sync_controls,
    normalize_allowed_execution_modes,
    select_service_target_entry_index,
    validate_live_ibkr_us_scheduler as _validate_live_ibkr_us_scheduler_impl,
    validate_runtime_target_strategy_policy as _validate_runtime_target_strategy_policy_impl,
)
from target_validators import (  # noqa: E402
    DECISION_DATA_ARTIFACT_FIELDS,
    DECISION_DATA_ASSURANCE_STATUSES,
    DECISION_DATA_FIELDS,
    DECISION_DATA_IDENTIFIER_PATTERN,
    DECISION_DATA_MODES,
    DECISION_DATA_REQUIRED_FIELDS,
    GENERATED_VARIABLES,
    LEGACY_INCOME_LAYER_VARIABLES,
    LIVE_CONTINUITY_BASELINE_ID_PATTERN,
    LIVE_CONTINUITY_BASELINE_KINDS,
    LIVE_CONTINUITY_FIELDS,
    LIVE_CONTINUITY_STATES,
    OPTION_OVERLAY_AMOUNT_VARIABLES,
    OPTION_OVERLAY_ENABLED_VARIABLES,
    OPTION_OVERLAY_RATIO_VARIABLES,
    OPTION_OVERLAY_RECIPE_VARIABLES,
    OPTION_OVERLAY_VARIABLES,
    PLATFORM_DRY_RUN_VARIABLES,
    RESEARCH_ONLY_EXTRA_VARIABLES,
    RUNTIME_REQUIRED_FIELDS,
    SCHEDULER_FIELDS,
    SECRET_MARKERS,
    SHA256_PATTERN,
    STRATEGY_RELEASE_DIGEST_FIELDS,
    STRATEGY_RELEASE_ID_PATTERN,
    STRATEGY_RELEASE_REQUIRED_FIELDS,
    WINDOW_MODES,
    is_live_continuity_target,
    is_secret_variable_name,
    option_bool_value,
    runtime_target_fingerprint,
    validate_account_domain,
    validate_decision_data,
    validate_extra_variables as _validate_extra_variables_impl,
    validate_github,
    validate_live_continuity,
    validate_nonsecret_service_target_inventory,
    validate_option_overlay_variables,
    validate_plugin_mounts as _validate_plugin_mounts_impl,
    validate_repository_variables,
    validate_runtime_target as _validate_runtime_target_impl,
    validate_strategy_release,
    validate_target as _validate_target_impl,
)

LOCAL_TARGETS_DIR = ROOT / "local" / "targets"
EXAMPLE_TARGETS_DIR = ROOT / "examples" / "targets"
LOCAL_POLICY_PATH = ROOT / "local" / "policy.json"
PLATFORM_CONFIG_PATH = ROOT / "platform-config.json"
DISPLAY_NAMES_PATH = ROOT / "python" / "scripts" / "display_names.json"

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
PRODUCTION_WRITER_REF = "refs/heads/main"


@dataclass(frozen=True)
class Assignment:
    """One deterministic GitHub Actions variable write derived from a target."""

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


def production_resource_key(
    *,
    repository: str,
    variable_scope: str,
    environment: str | None,
    name: str,
) -> str:
    """Stable identity for one GitHub Actions variable write destination."""
    return f"{repository}|{variable_scope}|{environment or ''}|{name}"


def require_production_writer_ref(ref: str | None = None) -> str:
    """Reject writes from feature branches or other stale workflow refs."""
    actual = os.environ.get("GITHUB_REF", "") if ref is None else ref
    if actual != PRODUCTION_WRITER_REF:
        raise ValueError("stale_writer_ref_rejected")
    return actual


def value_audit_token(value: str | None) -> str:
    if value is None:
        return "absent"
    if value in {"true", "false"}:
        return value
    return "sha256:" + hashlib.sha256(value.encode()).hexdigest()


def related_run_from_env() -> str:
    run_id = os.environ.get("GITHUB_RUN_ID", "").strip()
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "").strip() or "1"
    if not run_id:
        return "local"
    return f"{run_id}/{attempt}"


def build_resource_write_audit(
    *,
    resource_key: str,
    reason: str,
    old_value: str | None,
    new_value: str | None,
    readback: str,
    operator: str | None = None,
    related_run: str | None = None,
) -> dict[str, Any]:
    return {
        "resource_key": resource_key,
        "operator": operator or os.environ.get("GITHUB_ACTOR") or "unknown",
        "reason": reason,
        "related_run": related_run or related_run_from_env(),
        "old_value": value_audit_token(old_value),
        "new_value": value_audit_token(new_value),
        "readback": readback,
        "concurrency_complete_lock": False,
        "writer_sha": os.environ.get("GITHUB_SHA") or "unknown",
        "writer_workflow": os.environ.get("GITHUB_WORKFLOW") or "unknown",
        "writer_ref": os.environ.get("GITHUB_REF") or "unknown",
    }


def assignment_payload(assignment: Assignment, *, redact_values: bool = False) -> dict[str, Any]:
    payload = {
        "target_id": assignment.target_id,
        "repository": assignment.repository,
        "variable_scope": assignment.variable_scope,
        "environment": assignment.environment,
        "name": assignment.name,
        "action": "delete" if assignment.deletes_variable else "set",
        "value": redacted_value() if redact_values else assignment.value,
        "resource_key": production_resource_key(
            repository=assignment.repository,
            variable_scope=assignment.variable_scope,
            environment=assignment.environment,
            name=assignment.name,
        ),
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
        payload = load_platform_config_with_overlay(PLATFORM_CONFIG_PATH)
        value = payload["platforms"][platform]["deployment"]["settings_activation"]
    except (KeyError, TypeError, OSError, json.JSONDecodeError, ValueError) as exc:
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
    config = load_platform_config_with_overlay(PLATFORM_CONFIG_PATH)
    return config if isinstance(config, dict) else {}


def strategy_aliases() -> dict[str, str]:
    """Load the generated display aliases so alias spellings cannot skip policy checks."""
    if not DISPLAY_NAMES_PATH.exists():
        return {}
    with DISPLAY_NAMES_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    aliases = payload.get("strategy_aliases") if isinstance(payload, dict) else None
    if not isinstance(aliases, dict):
        return {}
    return {str(key): str(value) for key, value in aliases.items() if isinstance(value, str)}


def target_path_id(path: Path) -> str | None:
    relative = None
    for base in (LOCAL_TARGETS_DIR, EXAMPLE_TARGETS_DIR):
        try:
            relative = path.resolve().relative_to(base)
            break
        except ValueError:
            continue
    if relative is None or relative.suffix != ".json" or len(relative.parts) != 2:
        return None
    stem = relative.stem.removesuffix(".example")
    return f"{relative.parent.as_posix()}/{stem}"


def _effective_target_plugin_mounts(target: dict[str, Any], runtime_target: dict[str, Any]) -> Any:
    return _effective_target_plugin_mounts_impl(
        target,
        runtime_target,
        supported_platforms=SUPPORTED_PLATFORMS,
    )


def validate_live_ibkr_us_scheduler(
    runtime_target: dict[str, Any],
    scheduler: dict[str, Any],
    errors: list[str],
    *,
    plugin_mounts: Any = None,
) -> None:
    _validate_live_ibkr_us_scheduler_impl(
        runtime_target,
        scheduler,
        errors,
        plugin_mounts=plugin_mounts,
        load_config_fn=load_platform_config,
        aliases_fn=strategy_aliases,
    )


def validate_runtime_target_strategy_policy(runtime_target: dict[str, Any], errors: list[str]) -> None:
    _validate_runtime_target_strategy_policy_impl(
        runtime_target,
        errors,
        load_config_fn=load_platform_config,
        aliases_fn=strategy_aliases,
        validate_live_continuity_fn=validate_live_continuity,
        is_live_continuity_target_fn=is_live_continuity_target,
    )


def validate_runtime_target(target: dict[str, Any], errors: list[str]) -> None:
    _validate_runtime_target_impl(
        target,
        errors,
        supported_platforms=SUPPORTED_PLATFORMS,
        strategy_policy_validator=validate_runtime_target_strategy_policy,
        scheduler_validator=validate_live_ibkr_us_scheduler,
        effective_mounts_fn=_effective_target_plugin_mounts,
    )


def validate_plugin_mounts(target: dict[str, Any], errors: list[str]) -> None:
    _validate_plugin_mounts_impl(
        target,
        errors,
        supported_platforms=SUPPORTED_PLATFORMS,
        load_local_policy_fn=load_local_policy,
    )


def validate_extra_variables(target: dict[str, Any], errors: list[str]) -> None:
    _validate_extra_variables_impl(target, errors, env_string_fn=env_string)


def validate_target(target: dict[str, Any], path: Path | None = None) -> list[str]:
    return _validate_target_impl(
        target,
        path,
        supported_platforms=SUPPORTED_PLATFORMS,
        target_path_id_fn=target_path_id,
        platform_repository_fn=platform_repository,
        validate_github_fn=validate_github,
        validate_runtime_target_fn=validate_runtime_target,
        validate_plugin_mounts_fn=validate_plugin_mounts,
        validate_extra_variables_fn=validate_extra_variables,
        validate_repository_variables_fn=validate_repository_variables,
    )


def build_assignments(target: dict[str, Any], *, _existing_disabled: bool = False) -> list[Assignment]:
    errors = validate_target(target)
    if _existing_disabled:
        profile = str(target.get("runtime_target", {}).get("strategy_profile") or "").strip()
        errors = [
            error for error in errors
            if error != f"runtime_target.strategy_profile {profile} is frozen for new selection"
        ]
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


def _stop_request_identity(request: dict[str, Any]) -> tuple[str, dict[str, Any], dict[str, Any]]:
    return _stop_request_identity_impl(
        request,
        supported_platforms=SUPPORTED_PLATFORMS,
        platform_repository_fn=platform_repository,
        validate_github_fn=validate_github,
    )


def build_stop_assignments(
    request: dict[str, Any],
    current_variables: dict[str, str],
    *,
    enabled: bool = False,
) -> list[Assignment]:
    return _build_stop_assignments_impl(
        request,
        current_variables,
        enabled=enabled,
        stop_identity_fn=_stop_request_identity,
        validate_inventory_fn=validate_nonsecret_service_target_inventory,
        compact_json_fn=compact_json,
        assignment_cls=Assignment,
    )


def read_stop_variables(github: dict[str, Any]) -> dict[str, str]:
    return _read_stop_variables_impl(github, subprocess_mod=subprocess)


def read_disabled_profile_apply_variables(github: dict[str, Any]) -> dict[str, dict[str, str]]:
    return _read_disabled_profile_apply_variables_impl(github, read_stop_variables_fn=read_stop_variables)


def write_disabled_profile_assignment(assignment: Assignment) -> subprocess.CompletedProcess[str]:
    return _write_disabled_profile_assignment_impl(assignment, subprocess_mod=subprocess)


def _disabled_profile_target_pair(
    old_targets: list[dict[str, Any]],
    new_targets: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    return _disabled_profile_target_pair_impl(
        old_targets,
        new_targets,
        stop_identity_fn=_stop_request_identity,
        validate_target_fn=validate_target,
        build_assignments_fn=build_assignments,
    )


def _disabled_profile_expected_variables(
    snapshot: dict[str, dict[str, str]],
    target: dict[str, Any],
    *,
    existing_disabled: bool = False,
) -> dict[str, dict[str, str]]:
    return _disabled_profile_expected_variables_impl(
        snapshot,
        target,
        existing_disabled=existing_disabled,
        build_assignments_fn=build_assignments,
    )


def apply_disabled_strategy_profile_change(
    old_targets: list[dict[str, Any]],
    new_targets: list[dict[str, Any]],
) -> dict[str, Any]:
    return _apply_disabled_strategy_profile_change_impl(
        old_targets,
        new_targets,
        pair_fn=_disabled_profile_target_pair,
        read_vars_fn=read_disabled_profile_apply_variables,
        expected_vars_fn=_disabled_profile_expected_variables,
        write_assignment_fn=write_disabled_profile_assignment,
        build_assignments_fn=build_assignments,
        require_writer_ref_fn=require_production_writer_ref,
        subprocess_mod=subprocess,
    )


def execute_stop(request: dict[str, Any], *, apply: bool = False, enabled: bool = False) -> dict[str, Any]:
    return _execute_stop_impl(
        request,
        apply=apply,
        enabled=enabled,
        stop_identity_fn=_stop_request_identity,
        read_stop_variables_fn=read_stop_variables,
        build_stop_assignments_fn=build_stop_assignments,
        require_writer_ref_fn=require_production_writer_ref,
        production_resource_key_fn=production_resource_key,
        build_audit_fn=build_resource_write_audit,
        assignment_cls=Assignment,
        subprocess_mod=subprocess,
    )


def require_hk_stop_target(request: dict[str, Any]) -> None:
    _require_hk_stop_target_impl(request, stop_identity_fn=_stop_request_identity)


def runtime_control_workflow_preflight(request: dict[str, Any]) -> str:
    return _runtime_control_workflow_preflight_impl(
        request,
        stop_identity_fn=_stop_request_identity,
        subprocess_mod=subprocess,
    )


def dispatch_runtime_control(
    request: dict[str, Any],
    operation: str,
    request_id: str,
    workflow: str,
) -> dict[str, Any]:
    return _dispatch_runtime_control_impl(
        request,
        operation,
        request_id,
        workflow,
        stop_identity_fn=_stop_request_identity,
        subprocess_mod=subprocess,
    )


def validate_runtime_control_receipt(
    request: dict[str, Any],
    operation: str,
    request_id: str,
    run_id: int,
    receipt: dict[str, Any],
) -> str:
    return _validate_runtime_control_receipt_impl(
        request,
        operation,
        request_id,
        run_id,
        receipt,
        stop_identity_fn=_stop_request_identity,
    )


def recover_runtime_control_run(request: dict[str, Any], request_id: str, workflow: str, since: str) -> int | None:
    return _recover_runtime_control_run_impl(
        request,
        request_id,
        workflow,
        since,
        stop_identity_fn=_stop_request_identity,
        subprocess_mod=subprocess,
    )


def read_runtime_control_result(
    request: dict[str, Any],
    operation: str,
    request_id: str,
    run_id: int,
    workflow: str,
    diagnostics: dict[str, Any] | None = None,
) -> str:
    return _read_runtime_control_result_impl(
        request,
        operation,
        request_id,
        run_id,
        workflow,
        diagnostics,
        stop_identity_fn=_stop_request_identity,
        read_receipt_zip_fn=read_runtime_control_receipt_zip,
        validate_receipt_fn=validate_runtime_control_receipt,
        subprocess_mod=subprocess,
    )


def command_runtime_control(args: argparse.Namespace) -> int:
    return _command_runtime_control_impl(
        args,
        load_stop_request_fn=load_stop_request,
        preflight_fn=runtime_control_workflow_preflight,
        execute_stop_fn=execute_stop,
        dispatch_fn=dispatch_runtime_control,
        recover_fn=recover_runtime_control_run,
        read_result_fn=read_runtime_control_result,
        time_mod=time,
    )


def command_runtime_control_readback(args: argparse.Namespace) -> int:
    return _command_runtime_control_readback_impl(
        args,
        load_stop_request_fn=load_stop_request,
        preflight_fn=runtime_control_workflow_preflight,
        read_result_fn=read_runtime_control_result,
    )


def dispatch_hk_stop(request: dict[str, Any]) -> None:
    _dispatch_hk_stop_impl(
        request,
        require_hk_fn=require_hk_stop_target,
        read_stop_variables_fn=read_stop_variables,
        subprocess_mod=subprocess,
    )


def command_stop(args: argparse.Namespace) -> int:
    return _command_stop_impl(
        args,
        load_stop_request_fn=load_stop_request,
        require_hk_fn=require_hk_stop_target,
        require_writer_ref_fn=require_production_writer_ref,
        execute_stop_fn=execute_stop,
        dispatch_hk_fn=dispatch_hk_stop,
    )


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
        print("\nDry run only. Re-run with --yes to apply these GitHub variables.")
        if not args.show_values:
            print("Values are redacted by default; add --show-values only in a private local terminal.")
        return 0

    require_production_writer_ref()
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

    stop = subparsers.add_parser("stop", help="save only an existing target's disable setting; never activate or sync")
    stop.add_argument("--yes", action="store_true")
    stop.add_argument("--confirm", default="")
    stop.add_argument(
        "--apply-hk-stop",
        action="store_true",
        help="apply an already-saved LongBridge HK stop; never writes configuration or enables a target",
    )
    stop.set_defaults(func=command_stop)

    runtime_control = subparsers.add_parser("runtime-control", help="apply one correlated platform enabled setting")
    runtime_control.add_argument("--operation", choices=("enable", "disable"), required=True)
    runtime_control.add_argument("--request-id", required=True)
    runtime_control.set_defaults(func=command_runtime_control)

    readback = subparsers.add_parser("runtime-control-readback", help="read an original platform run without writes")
    readback.add_argument("--operation", choices=("enable", "disable"), required=True)
    readback.add_argument("--request-id", required=True)
    readback.add_argument("--check-id", required=True)
    readback.add_argument("--platform-run-id", required=True)
    readback.set_defaults(func=command_runtime_control_readback)

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
