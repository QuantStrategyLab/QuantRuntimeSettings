#!/usr/bin/env python3
"""Stop, disabled-profile update, and runtime-control workflow operations."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import time
import zipfile
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from schema_check import (
    FieldRule,
    as_dict,
    is_bool,
    is_bytes,
    is_dict,
    is_list,
    is_list_of_dicts,
    is_nonempty_str,
    is_nonempty_str_list,
    is_sha256_str,
    is_str,
    is_strict_int,
    is_uuid_str,
    matches_mapping_rules,
    parse_utc_iso_timestamp,
)
from strategy_policy import _service_target_identity, select_service_target_entry_index

RUNTIME_CONTROL_WORKFLOWS = {
    "ibkr": "sync-cloud-run-env.yml",
    "schwab": "pilot-metadata-readback.yml",
}
STOP_CORRELATION_RULES = {
    "request_id": FieldRule(kind="custom", predicate=is_uuid_str),
    "source_revision": FieldRule(kind="strict_int", min_value=0, max_value=9007199254740991),
    "source_identity_sha256": FieldRule(kind="sha256", lowercase_only=True, strip=False),
}
STOP_IDENTITY_RULES = {
    "platform_id": FieldRule(kind="nonempty_str"),
    "deployment_selector": FieldRule(kind="nonempty_str"),
    "account_scope": FieldRule(kind="nonempty_str"),
    "service_name": FieldRule(kind="nonempty_str"),
    "account_selector": FieldRule(kind="nonempty_str_list", unique=True),
}


def _optional_stop_correlation(request: dict[str, Any], target_id: str) -> None:
    """HK may carry the original request correlation; other targets stay unchanged."""
    if "correlation" not in request:
        return
    if target_id != "longbridge/hk" or not matches_mapping_rules(request["correlation"], STOP_CORRELATION_RULES):
        raise ValueError("stop requires an unambiguous current target with matching identity")


def _stop_request_identity(
    request: dict[str, Any],
    *,
    supported_platforms: dict[str, dict[str, str]],
    platform_repository_fn: Callable[[str], str],
    validate_github_fn: Callable[[dict[str, Any], list[str]], None],
) -> tuple[str, dict[str, Any], dict[str, Any]]:
    error = "stop requires an unambiguous current target with matching identity"
    allowed = {"target_id", "github", "runtime_target"}
    if not is_dict(request) or set(request) not in (allowed, allowed | {"correlation"}):
        raise ValueError(error)
    identity = request["runtime_target"]
    if not matches_mapping_rules(identity, STOP_IDENTITY_RULES):
        raise ValueError(error)
    platform = identity["platform_id"]
    target_id = request["target_id"]
    if (
        platform not in supported_platforms
        or not is_str(target_id)
        or not re.fullmatch(re.escape(platform) + r"/[A-Za-z0-9][A-Za-z0-9._-]*", target_id)
    ):
        raise ValueError(error)
    github = request["github"]
    errors: list[str] = []
    validate_github_fn(request, errors)
    if (
        errors
        or set(github) - {"repository", "variable_scope", "environment"}
        or github["repository"] != platform_repository_fn(platform)
    ):
        raise ValueError(error)
    _optional_stop_correlation(request, target_id)
    return target_id, identity, github


def build_stop_assignments(
    request: dict[str, Any],
    current_variables: dict[str, str],
    *,
    enabled: bool = False,
    stop_identity_fn: Callable[[dict[str, Any]], tuple[str, dict[str, Any], dict[str, Any]]],
    validate_inventory_fn: Callable[..., None],
    compact_json_fn: Callable[[Any], str],
    assignment_cls: type[Any],
) -> list[Any]:
    """Plan one enabled setting against authoritative, caller-read variables."""
    target_id, identity, github = stop_identity_fn(request)
    if type(enabled) is not bool or (enabled and identity["platform_id"] not in {"ibkr", "schwab"}):
        raise ValueError("runtime_control_target_unsupported")
    enabled_value = "true" if enabled else "false"
    error = "stop requires an unambiguous current target with matching identity"
    errors: list[str] = []
    if not is_dict(current_variables):
        raise ValueError(error)

    def matches(current: Any) -> bool:
        return is_dict(current) and all(current.get(key) == value for key, value in identity.items())

    def parse(name: str) -> Any:
        try:
            return json.loads(current_variables[name])
        except (KeyError, TypeError, ValueError):
            raise ValueError(error) from None

    inventory_name = "CLOUD_RUN_SERVICE_TARGETS_JSON"
    if inventory_name in current_variables:
        inventory = parse(inventory_name)
        entries = inventory.get("targets") if is_dict(inventory) else inventory
        if not is_list_of_dicts(entries, non_empty=True):
            raise ValueError(error)
        validate_inventory_fn(inventory, path=inventory_name, errors=errors)
        if errors:
            raise ValueError("stop refuses a secret-bearing service inventory")
        try:
            index = select_service_target_entry_index(identity, entries, allow_account_scope_fallback=False)
        except ValueError:
            raise ValueError(error) from None
        if index is None or not matches(entries[index].get("runtime_target")):
            raise ValueError(error)
        source_service = str(current_variables.get("CLOUD_RUN_SERVICE") or "").strip()
        if (
            source_service == identity["service_name"]
            and "RUNTIME_TARGET_JSON" in current_variables
            and not matches(parse("RUNTIME_TARGET_JSON"))
        ):
            raise ValueError(error)
        entry = entries[index]
        for field in ("service_name", "account_scope"):
            if _service_target_identity(entry, field) != {identity[field]}:
                raise ValueError(error)
        if (
            identity["platform_id"] == "longbridge"
            and source_service == identity["service_name"]
            and str(current_variables.get("RUNTIME_TARGET_ENABLED") or "").strip()
        ):
            name, value = "RUNTIME_TARGET_ENABLED", enabled_value
        else:
            if identity["platform_id"] == "ibkr":
                nested = as_dict(entry.get("env"))
                candidates = [
                    (container, key)
                    for key in ("RUNTIME_TARGET_ENABLED", "runtime_target_enabled")
                    for container in (entry, nested)
                ]
                location = next(
                    (
                        (container, key)
                        for container, key in candidates
                        if key in container
                        and container[key] is not None
                        and (not is_str(container[key]) or container[key].strip())
                    ),
                    None,
                )
                container, key = location if location is not None else (entry, "RUNTIME_TARGET_ENABLED")
                current = container.get(key)
                normalized = str(current).strip().lower()
                same = normalized in ({"true", "1", "yes", "on"} if enabled else {"false", "0", "no", "off"})
                if not same:
                    container[key] = enabled if is_bool(current) else enabled_value
            else:
                entry["RUNTIME_TARGET_ENABLED"] = enabled_value
            name, value = inventory_name, compact_json_fn(inventory)
    else:
        if not matches(parse("RUNTIME_TARGET_JSON")):
            raise ValueError(error)
        for name in ("CLOUD_RUN_SERVICE", "CLOUD_RUN_SERVICES"):
            services = str(current_variables.get(name) or "").replace(",", " ").split()
            if services and set(services) != {identity["service_name"]}:
                raise ValueError(error)
        name, value = "RUNTIME_TARGET_ENABLED", enabled_value
    return [assignment_cls(target_id, github["repository"], github["variable_scope"], github.get("environment"), name, value)]


def read_stop_variables(github: dict[str, Any], *, subprocess_mod: Any = subprocess) -> dict[str, str]:
    """Read every page into memory; never expose variable values or GH errors."""
    endpoint = f"repos/{github['repository']}"
    if github["variable_scope"] == "environment":
        endpoint += f"/environments/{quote(github['environment'], safe='')}"
    else:
        endpoint += "/actions"
    endpoint += "/variables?per_page=100"
    reason = "stop_source_unavailable"
    try:
        result = subprocess_mod.run(
            ["gh", "api", "--method", "GET", "--paginate", "--slurp", endpoint],
            capture_output=True, text=True, timeout=60, check=False,
        )
        if result.returncode != 0:
            if "unknown flag: --slurp" in result.stderr:
                reason = "stop_source_cli_unsupported"
            elif "HTTP 401" in result.stderr or "HTTP 403" in result.stderr:
                reason = "stop_source_permission_denied"
            elif "HTTP 404" in result.stderr:
                reason = "stop_source_not_accessible"
            raise ValueError
        pages = json.loads(result.stdout)
        if not is_list(pages) or not pages:
            raise ValueError
        values: dict[str, str] = {}
        total = pages[0]["total_count"]
        if not is_strict_int(total, min_value=0):
            raise ValueError
        for page in pages:
            if page["total_count"] != total or not is_list(page["variables"]):
                raise ValueError
            for item in page["variables"]:
                name, value = item["name"], item["value"]
                if not is_str(name) or not name or not is_str(value) or name in values:
                    raise ValueError
                values[name] = value
        if len(values) != total:
            reason = "stop_source_incomplete"
            raise ValueError
        return values
    except subprocess_mod.TimeoutExpired:
        raise ValueError("stop_source_timeout") from None
    except (OSError, subprocess_mod.SubprocessError, ValueError, TypeError, KeyError, IndexError):
        raise ValueError(reason) from None


def read_disabled_profile_apply_variables(
    github: dict[str, Any],
    *,
    read_stop_variables_fn: Callable[[dict[str, Any]], dict[str, str]],
) -> dict[str, dict[str, str]]:
    """Read repository and target variables for the disabled profile writer."""
    repository_scope = {"repository": github["repository"], "variable_scope": "repository"}
    try:
        repository = read_stop_variables_fn(repository_scope)
        target = read_stop_variables_fn(github) if github["variable_scope"] == "environment" else dict(repository)
    except ValueError:
        raise ValueError("target_source_unavailable") from None
    return {"repository": repository, "target": target}


def write_disabled_profile_assignment(
    assignment: Any,
    *,
    subprocess_mod: Any = subprocess,
) -> subprocess.CompletedProcess[str]:
    """Write exactly one variable; caller owns all compare and readback checks."""
    command = [
        "gh", "variable", "set", assignment.name, "--repo", assignment.repository,
        "--body", assignment.value,
    ]
    if assignment.variable_scope == "environment":
        command.extend(["--env", assignment.environment or ""])
    return subprocess_mod.run(command, text=True, capture_output=True, timeout=60, check=False)


def _disabled_profile_target_pair(
    old_targets: list[dict[str, Any]],
    new_targets: list[dict[str, Any]],
    *,
    stop_identity_fn: Callable[[dict[str, Any]], tuple[str, dict[str, Any], dict[str, Any]]],
    validate_target_fn: Callable[[dict[str, Any]], list[str]],
    build_assignments_fn: Callable[..., list[Any]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not is_list(old_targets) or not is_list(new_targets) or len(old_targets) != 1 or len(new_targets) != 1:
        raise ValueError("single_target_required")
    old_target, new_target = old_targets[0], new_targets[0]
    for target in (old_target, new_target):
        if not is_dict(target):
            raise ValueError("invalid_target")
        runtime_target = target.get("runtime_target")
        identity_fields = {"platform_id", "deployment_selector", "account_selector", "account_scope", "service_name"}
        if not is_dict(runtime_target):
            raise ValueError("invalid_target")
        identity = {field: runtime_target.get(field) for field in identity_fields}
        try:
            stop_identity_fn({
                "target_id": target.get("target_id"),
                "github": target.get("github"),
                "runtime_target": identity,
            })
        except ValueError:
            raise ValueError("invalid_target_identity") from None
        errors = validate_target_fn(target)
        if target is old_target:
            old_profile = str(runtime_target.get("strategy_profile") or "").strip()
            errors = [
                error for error in errors
                if error != f"runtime_target.strategy_profile {old_profile} is frozen for new selection"
            ]
        if errors:
            raise ValueError("invalid_target")
        if "enabled" in runtime_target:
            raise ValueError("invalid_target")

    old_runtime = old_target["runtime_target"]
    new_runtime = new_target["runtime_target"]
    if old_target["target_id"] != new_target["target_id"]:
        raise ValueError("target_identity_changed")
    old_without_profile = dict(old_target)
    new_without_profile = dict(new_target)
    old_without_profile["runtime_target"] = dict(old_runtime)
    new_without_profile["runtime_target"] = dict(new_runtime)
    old_without_profile["runtime_target"].pop("strategy_profile", None)
    new_without_profile["runtime_target"].pop("strategy_profile", None)
    if old_without_profile != new_without_profile:
        raise ValueError("target_identity_changed")
    old_profile = old_runtime.get("strategy_profile")
    new_profile = new_runtime.get("strategy_profile")
    if not is_str(old_profile) or not old_profile or not is_str(new_profile) or not new_profile:
        raise ValueError("invalid_strategy_profile")
    if old_profile == new_profile:
        raise ValueError("profile_change_required")

    old_assignment_list = build_assignments_fn(old_target, _existing_disabled=True)
    new_assignment_list = build_assignments_fn(new_target)
    old_assignments = {assignment.name: assignment for assignment in old_assignment_list}
    new_assignments = {assignment.name: assignment for assignment in new_assignment_list}
    if len(old_assignments) != len(old_assignment_list) or len(new_assignments) != len(new_assignment_list):
        raise ValueError("duplicate_assignment")
    if old_assignments.keys() != new_assignments.keys():
        raise ValueError("assignment_set_changed")
    changed = {
        name for name in old_assignments
        if old_assignments[name].value != new_assignments[name].value
    }
    if changed != {"RUNTIME_TARGET_JSON", "STRATEGY_PROFILE"}:
        raise ValueError("assignment_scope_changed")
    for name in old_assignments:
        left, right = old_assignments[name], new_assignments[name]
        if (left.target_id, left.repository, left.variable_scope, left.environment) != (
            right.target_id, right.repository, right.variable_scope, right.environment,
        ):
            raise ValueError("assignment_identity_changed")
    return old_target, new_target


def _disabled_profile_expected_variables(
    snapshot: dict[str, dict[str, str]],
    target: dict[str, Any],
    *,
    existing_disabled: bool = False,
    build_assignments_fn: Callable[..., list[Any]],
) -> dict[str, dict[str, str]]:
    if (
        not is_dict(snapshot)
        or not is_dict(snapshot.get("repository"))
        or not is_dict(snapshot.get("target"))
    ):
        raise ValueError("target_source_unavailable")
    repository = snapshot["repository"]
    scoped = snapshot["target"]
    enabled = scoped.get("RUNTIME_TARGET_ENABLED", repository.get("RUNTIME_TARGET_ENABLED"))
    if enabled != "false":
        raise ValueError("target_not_disabled")

    assignments = {
        assignment.name: assignment
        for assignment in build_assignments_fn(target, _existing_disabled=existing_disabled)
    }
    current_scope = repository if target["github"]["variable_scope"] == "repository" else scoped
    observed_json = current_scope.get("RUNTIME_TARGET_JSON")
    observed_profile = current_scope.get("STRATEGY_PROFILE")
    if not is_str(observed_json) or not is_str(observed_profile):
        raise ValueError("target_source_unavailable")

    def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError
            result[key] = value
        return result

    try:
        parsed = json.loads(observed_json, object_pairs_hook=unique_object)
    except (TypeError, ValueError, json.JSONDecodeError):
        raise ValueError("target_source_unavailable") from None
    if (
        not is_dict(parsed)
        or parsed != target["runtime_target"]
        or observed_json != assignments["RUNTIME_TARGET_JSON"].value
    ):
        raise ValueError("target_source_changed")
    if observed_profile != target["runtime_target"]["strategy_profile"]:
        raise ValueError("target_source_changed")
    expected = {"repository": dict(repository), "target": dict(scoped)}
    for name in ("RUNTIME_TARGET_JSON", "STRATEGY_PROFILE"):
        expected_scope = "repository" if target["github"]["variable_scope"] == "repository" else "target"
        expected[expected_scope][name] = assignments[name].value
    if target["github"]["variable_scope"] == "repository":
        expected["target"] = dict(expected["repository"])
    return expected


def apply_disabled_strategy_profile_change(
    old_targets: list[dict[str, Any]],
    new_targets: list[dict[str, Any]],
    *,
    pair_fn: Callable[[list[dict[str, Any]], list[dict[str, Any]]], tuple[dict[str, Any], dict[str, Any]]],
    read_vars_fn: Callable[[dict[str, Any]], dict[str, dict[str, str]]],
    expected_vars_fn: Callable[..., dict[str, dict[str, str]]],
    write_assignment_fn: Callable[[Any], subprocess.CompletedProcess[str]],
    build_assignments_fn: Callable[..., list[Any]],
    require_writer_ref_fn: Callable[[], str],
    subprocess_mod: Any = subprocess,
) -> dict[str, Any]:
    """Update only a single disabled target's profile variables, never the runtime."""
    old_target, new_target = pair_fn(old_targets, new_targets)
    github = old_target["github"]
    old_snapshot = read_vars_fn(github)
    enabled = old_snapshot["target"].get(
        "RUNTIME_TARGET_ENABLED", old_snapshot["repository"].get("RUNTIME_TARGET_ENABLED"),
    )
    if enabled != "false":
        raise ValueError("target_not_disabled")
    try:
        current_new = expected_vars_fn(old_snapshot, new_target)
    except ValueError as exc:
        if str(exc) != "target_source_changed":
            raise
    else:
        if current_new == old_snapshot:
            return {"outcome": "variables_updated", "variables_updated": False, "runtime_applied": False}
    expected_old = expected_vars_fn(old_snapshot, old_target, existing_disabled=True)
    old_assignments = {item.name: item for item in build_assignments_fn(old_target, _existing_disabled=True)}
    new_assignments = {item.name: item for item in build_assignments_fn(new_target)}
    writes = [new_assignments[name] for name in ("RUNTIME_TARGET_JSON", "STRATEGY_PROFILE")]
    expected_new = {"repository": dict(expected_old["repository"]), "target": dict(expected_old["target"])}
    for assignment in writes:
        expected_scope = "repository" if assignment.variable_scope == "repository" else "target"
        expected_new[expected_scope][assignment.name] = assignment.value
    if github["variable_scope"] == "repository":
        expected_new["target"] = dict(expected_new["repository"])
    if all(
        (expected_old["repository"] if item.variable_scope == "repository" else expected_old["target"])
        .get(item.name) == item.value
        for item in writes
    ):
        return {"outcome": "variables_updated", "variables_updated": False, "runtime_applied": False}

    for item in writes:
        observed = expected_old["repository"] if item.variable_scope == "repository" else expected_old["target"]
        if observed.get(item.name) != old_assignments[item.name].value:
            raise ValueError("target_source_changed")
    require_writer_ref_fn()
    if read_vars_fn(github) != old_snapshot:
        raise ValueError("target_source_changed")

    write_failed = False
    for assignment in writes:
        try:
            result = write_assignment_fn(assignment)
            if result.returncode != 0:
                write_failed = True
                break
        except (OSError, subprocess_mod.SubprocessError):
            write_failed = True
            break

    try:
        readback = read_vars_fn(github)
    except ValueError:
        readback = None
    if write_failed or readback != expected_new:
        return {"outcome": "unknown", "variables_updated": None, "runtime_applied": False}
    return {"outcome": "variables_updated", "variables_updated": True, "runtime_applied": False}


def execute_stop(
    request: dict[str, Any],
    *,
    apply: bool = False,
    enabled: bool = False,
    stop_identity_fn: Callable[[dict[str, Any]], tuple[str, dict[str, Any], dict[str, Any]]],
    read_stop_variables_fn: Callable[[dict[str, Any]], dict[str, str]],
    build_stop_assignments_fn: Callable[..., list[Any]],
    require_writer_ref_fn: Callable[[], str],
    production_resource_key_fn: Callable[..., str],
    build_audit_fn: Callable[..., dict[str, Any]],
    assignment_cls: type[Any],
    subprocess_mod: Any = subprocess,
) -> dict[str, Any]:
    """Save the enabled setting under the single configuration writer; no platform sync."""
    _, _, github = stop_identity_fn(request)
    repository_scope = {"repository": github["repository"], "variable_scope": "repository"}

    def read() -> tuple[dict[str, str], dict[str, str]]:
        repository = read_stop_variables_fn(repository_scope)
        environment = read_stop_variables_fn(github) if github["variable_scope"] == "environment" else {}
        return repository, environment

    before = read()
    effective = {**before[0], **before[1]}
    inventory = "CLOUD_RUN_SERVICE_TARGETS_JSON"
    assignment = build_stop_assignments_fn(request, effective, enabled=enabled)[0]
    owner = github
    if assignment.name == inventory and inventory not in before[1]:
        owner = repository_scope
        assignment = assignment_cls(
            assignment.target_id, assignment.repository, "repository", None,
            assignment.name, assignment.value,
        )
    resource_key = production_resource_key_fn(
        repository=assignment.repository,
        variable_scope=assignment.variable_scope,
        environment=assignment.environment,
        name=assignment.name,
    )
    if not apply:
        return {
            "configured": False,
            "platform_applied": False,
            "preview": True,
            "resource_key": resource_key,
        }
    require_writer_ref_fn()
    if read() != before:
        raise ValueError("stop_source_changed")
    owner_index = 1 if owner["variable_scope"] == "environment" else 0
    current_value = before[owner_index].get(assignment.name)
    unchanged = current_value == assignment.value
    if assignment.name == inventory and current_value is not None:
        unchanged = json.loads(current_value) == json.loads(assignment.value)
    readback = "skipped_unchanged"
    if not unchanged:
        command = ["gh", "variable", "set", assignment.name, "--repo", assignment.repository]
        if assignment.variable_scope == "environment":
            command.extend(["--env", assignment.environment or ""])
        try:
            result = subprocess_mod.run(
                command, input=assignment.value, text=True, capture_output=True,
                timeout=60, check=False,
            )
            if result.returncode != 0:
                raise ValueError
        except (OSError, subprocess_mod.SubprocessError, ValueError):
            raise ValueError("stop_write_outcome_unverified") from None
        expected = [dict(before[0]), dict(before[1])]
        expected[owner_index][assignment.name] = assignment.value
        try:
            after = read()
        except ValueError:
            raise ValueError("stop_readback_unverified") from None
        if after != tuple(expected):
            raise ValueError("stop_readback_unverified")
        readback = "matched"
    return {
        "configured": True,
        "platform_applied": False,
        "preview": False,
        "resource_write_audit": build_audit_fn(
            resource_key=resource_key,
            reason="runtime_enable" if enabled else "runtime_stop",
            old_value=current_value,
            new_value=assignment.value,
            readback=readback,
        ),
    }


def load_stop_request() -> dict[str, Any]:
    """Use GitHub's event file without interpolating private inputs into step logs."""
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if event_path:
        path = Path(event_path)
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
            raise ValueError("stop_event_unverified")
        with path.open() as source:
            return json.loads(json.load(source)["inputs"]["stop_request"])
    return json.loads(os.environ.get("RUNTIME_STOP_REQUEST_JSON", ""))


def require_hk_stop_target(
    request: dict[str, Any],
    *,
    stop_identity_fn: Callable[[dict[str, Any]], tuple[str, dict[str, Any], dict[str, Any]]],
) -> None:
    """The first platform consumer is the existing HK stop, never activation."""
    target_id, identity, github = stop_identity_fn(request)
    if (
        target_id != "longbridge/hk"
        or identity["account_scope"] != "HK"
        or identity["service_name"] != "longbridge-quant-hk-service"
        or github != {
            "repository": "QuantStrategyLab/LongBridgePlatform",
            "variable_scope": "environment",
            "environment": "longbridge-hk",
        }
    ):
        raise ValueError("stop_platform_target_unsupported")


def runtime_control_workflow_preflight(
    request: dict[str, Any],
    *,
    stop_identity_fn: Callable[[dict[str, Any]], tuple[str, dict[str, Any], dict[str, Any]]],
    subprocess_mod: Any = subprocess,
) -> str:
    """Verify the fixed platform workflow is readable and active before any setting write."""
    _, identity, github = stop_identity_fn(request)
    workflow = RUNTIME_CONTROL_WORKFLOWS.get(identity["platform_id"])
    if identity["platform_id"] == "schwab" and identity["service_name"] != "charles-schwab-quant-service":
        raise ValueError("runtime_control_target_unsupported")
    if workflow is None:
        raise ValueError("runtime_control_target_unsupported")
    endpoint = f"repos/{github['repository']}/actions/workflows/{workflow}"
    try:
        result = subprocess_mod.run(
            ["gh", "api", "--method", "GET", endpoint],
            capture_output=True, text=True, timeout=30, check=False,
        )
        if result.returncode:
            if "HTTP 403" in result.stderr or "HTTP 401" in result.stderr:
                raise ValueError("runtime_control_workflow_permission_denied")
            raise ValueError("runtime_control_workflow_unavailable")
        document = json.loads(result.stdout)
        if document.get("state") != "active" or document.get("path") != f".github/workflows/{workflow}":
            raise ValueError("runtime_control_workflow_unavailable")
    except (OSError, subprocess_mod.SubprocessError, TypeError, AttributeError, json.JSONDecodeError):
        raise ValueError("runtime_control_workflow_unavailable") from None
    return workflow


def dispatch_runtime_control(
    request: dict[str, Any],
    operation: str,
    request_id: str,
    workflow: str,
    *,
    stop_identity_fn: Callable[[dict[str, Any]], tuple[str, dict[str, Any], dict[str, Any]]],
    subprocess_mod: Any = subprocess,
) -> dict[str, Any]:
    """Send once; a missing run id is unknown and must never trigger a second dispatch."""
    _, identity, github = stop_identity_fn(request)
    if operation not in {"enable", "disable"} or not is_uuid_str(request_id):
        raise ValueError("runtime_control_request_invalid")
    if RUNTIME_CONTROL_WORKFLOWS.get(identity["platform_id"]) != workflow:
        raise ValueError("runtime_control_target_unsupported")
    if identity["platform_id"] == "ibkr":
        inputs = {
            "target": "configured",
            "configured_service": identity["service_name"],
            "runtime_switch_only": "true",
            "request_id": request_id,
            "deploy_image": "false",
            "sync_env": "true",
            "approve_traffic_shift": "true",
            "approve_scheduler_sync": "true",
        }
    else:
        inputs = {"resume_operation": operation, "request_id": request_id}
    payload = {"ref": "main", "inputs": inputs, "return_run_details": True}
    endpoint = f"repos/{github['repository']}/actions/workflows/{workflow}/dispatches"
    try:
        result = subprocess_mod.run(
            ["gh", "api", "--method", "POST", endpoint, "--input", "-"],
            input=json.dumps(payload), text=True, capture_output=True, timeout=45, check=False,
        )
        if result.returncode:
            if re.search(r"HTTP (?:400|401|403|404|422)\b", result.stderr):
                return {"status": "rejected", "run_id": None}
            return {"status": "unknown", "run_id": None}
        body = json.loads(result.stdout)
        run_id = body.get("workflow_run_id")
        if is_strict_int(run_id, min_value=1):
            return {"status": "accepted", "run_id": run_id}
        return {"status": "unknown", "run_id": None}
    except (OSError, subprocess_mod.SubprocessError, ValueError, TypeError, AttributeError):
        return {"status": "unknown", "run_id": None}


def validate_runtime_control_receipt(
    request: dict[str, Any],
    operation: str,
    request_id: str,
    run_id: int,
    receipt: dict[str, Any],
    *,
    stop_identity_fn: Callable[[dict[str, Any]], tuple[str, dict[str, Any], dict[str, Any]]],
) -> str:
    """Only a matching platform receipt can prove adoption of this request."""
    _, identity, _ = stop_identity_fn(request)
    if (
        not is_dict(receipt)
        or receipt.get("request_id") != request_id
        or str(receipt.get("run_id")) != str(run_id)
        or str(receipt.get("attempt")) != "1"
        or receipt.get("operation") != operation
        or operation not in {"enable", "disable"}
    ):
        return "unknown"
    if identity["platform_id"] == "ibkr":
        if receipt.get("target_sha256") != hashlib.sha256(identity["service_name"].encode("utf-8")).hexdigest():
            return "unknown"
    elif identity["platform_id"] != "schwab":
        return "unknown"
    status = receipt.get("status")
    if is_str(status) and status in {"partial", "protected", "unknown"}:
        return status
    if status != "applied":
        return "unknown"
    if identity["platform_id"] == "ibkr":
        if (
            receipt.get("target_sha256") != hashlib.sha256(identity["service_name"].encode("utf-8")).hexdigest()
            or receipt.get("platform_applied") is not True
            or receipt.get("enabled") is not (operation == "enable")
            or not is_sha256_str(receipt.get("revision_sha256") or "", lowercase_only=True, strip=False)
        ):
            return "unknown"
        if operation == "enable" and receipt.get("continuity") not in {"ACTIVE_LKG", "ROLLBACK_LKG"}:
            return "protected" if receipt.get("continuity") in {"PAUSED", "RECONCILE_ONLY"} else "unknown"
        if receipt.get("scheduler_state") != ("ENABLED" if operation == "enable" else "PAUSED"):
            return "partial"
    elif identity["platform_id"] == "schwab":
        expected_state = "enabled" if operation == "enable" else "disabled"
        if (
            receipt.get("operator_state") != expected_state
            or receipt.get("effective_state") != expected_state
            or not is_sha256_str(receipt.get("serving_revision_sha256") or "", lowercase_only=True, strip=False)
        ):
            return "unknown"
        if operation == "enable" and receipt.get("continuity_state") != "ACTIVE_LKG":
            return "protected" if receipt.get("continuity_state") in {"PAUSED", "RECONCILE_ONLY"} else "unknown"
        if operation == "enable" and receipt.get("scheduler_state") != "enabled":
            return "partial"
    else:
        return "unknown"
    return "applied"


def read_runtime_control_receipt_zip(archive: bytes, platform: str) -> dict[str, Any]:
    """Read exactly one fixed, bounded public result from an Actions artifact."""
    filenames = {"ibkr": "ibkr-runtime-switch-result.json", "schwab": "schwab-runtime-switch.safe.json"}
    name = filenames.get(platform)
    if not name or not is_bytes(archive) or len(archive) > 262144:
        raise ValueError("runtime_control_receipt_invalid")
    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
            entries = zipped.infolist()
            matches = [entry for entry in entries if entry.filename == name]
            if len(entries) > 16 or len(matches) != 1 or matches[0].file_size > 65536 or matches[0].flag_bits & 1:
                raise ValueError("runtime_control_receipt_invalid")
            with zipped.open(matches[0]) as member:
                content = member.read(65537)
            if len(content) > 65536 or len(content) != matches[0].file_size:
                raise ValueError("runtime_control_receipt_invalid")
            value = json.loads(content)
            if not is_dict(value):
                raise ValueError("runtime_control_receipt_invalid")
            return value
    except (zipfile.BadZipFile, OSError, UnicodeError, json.JSONDecodeError, RuntimeError, NotImplementedError):
        raise ValueError("runtime_control_receipt_invalid") from None


def recover_runtime_control_run(
    request: dict[str, Any],
    request_id: str,
    workflow: str,
    since: str,
    *,
    stop_identity_fn: Callable[[dict[str, Any]], tuple[str, dict[str, Any], dict[str, Any]]],
    subprocess_mod: Any = subprocess,
) -> int | None:
    """Recover a missing dispatch response by exact run title, never by time."""
    _, identity, github = stop_identity_fn(request)
    if not is_uuid_str(request_id) or RUNTIME_CONTROL_WORKFLOWS.get(identity["platform_id"]) != workflow:
        return None
    title = ("Runtime switch " if identity["platform_id"] == "ibkr" else "Schwab runtime switch ") + request_id
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", since):
        return None
    endpoint = f"repos/{github['repository']}/actions/workflows/{workflow}/runs?event=workflow_dispatch&branch=main&per_page=100&created={quote('>=' + since, safe='')}"
    try:
        runs = []
        page = 0
        while True:
            page += 1
            response = subprocess_mod.run(
                ["gh", "api", "--method", "GET", f"{endpoint}&page={page}"],
                capture_output=True, timeout=30, check=False,
            )
            if response.returncode or len(response.stdout) > 524288:
                return None
            listing = json.loads(response.stdout)
            total = listing.get("total_count")
            current = listing.get("workflow_runs")
            if type(total) is not int or not is_list(current):
                return None
            runs.extend(current)
            if len(runs) >= total:
                break
            if not current:
                return None
        if len(runs) != total:
            return None
        matches = [
            run for run in runs
            if run.get("display_title") == title
            and run.get("event") == "workflow_dispatch"
            and run.get("head_branch") == "main"
            and run.get("run_attempt") == 1
        ]
        if len(matches) != 1 or not is_strict_int(matches[0].get("id"), min_value=1):
            return None
        return matches[0]["id"]
    except (OSError, subprocess_mod.SubprocessError, ValueError, TypeError, AttributeError, UnicodeError):
        return None


def read_runtime_control_result(
    request: dict[str, Any],
    operation: str,
    request_id: str,
    run_id: int,
    workflow: str,
    diagnostics: dict[str, Any] | None = None,
    *,
    stop_identity_fn: Callable[[dict[str, Any]], tuple[str, dict[str, Any], dict[str, Any]]],
    read_receipt_zip_fn: Callable[[bytes, str], dict[str, Any]],
    validate_receipt_fn: Callable[[dict[str, Any], str, str, int, dict[str, Any]], str],
    subprocess_mod: Any = subprocess,
) -> str:
    """Read only this run and its uniquely named safe artifact, with no side effects."""
    _, identity, github = stop_identity_fn(request)
    if (
        not is_strict_int(run_id, min_value=1)
        or RUNTIME_CONTROL_WORKFLOWS.get(identity["platform_id"]) != workflow
    ):
        return "unknown"
    prefix = f"repos/{github['repository']}"

    def get(path: str, binary: bool = False, allow_log_colours: bool = False) -> Any:
        try:
            command = ["gh", "api", "--method", "GET"]
            if allow_log_colours:
                version = subprocess_mod.run(["gh", "--version"], capture_output=True, timeout=10, check=False)
                match = re.match(rb"gh version (\d+)\.(\d+)\.(\d+)(?:\s|$)", version.stdout or b"")
                if version.returncode == 0 and match and tuple(map(int, match.groups())) >= (2, 97, 0):
                    command.append("--allow-escape-sequences")
            response = subprocess_mod.run(
                [*command, f"{prefix}/{path}"],
                capture_output=True, timeout=30, check=False,
            )
            if response.returncode or len(response.stdout) > (262144 if binary else 524288):
                if diagnostics is not None:
                    diagnostics["failure_kind"] = "command_failed" if response.returncode else "response_too_large"
                    if response.returncode:
                        stderr = (response.stderr or b"").lower()
                        diagnostics["exit_code"] = response.returncode if -255 <= response.returncode <= 255 else None
                        diagnostics["stderr_empty"] = not bool(stderr)
                        categories = (
                            (b"redirect", "redirect"), (b"no such host", "dns"),
                            (b"resolve host", "dns"), (b"tls", "tls"),
                            (b"certificate", "tls"), (b"unexpected eof", "eof"),
                            (b"unauthorized", "auth"), (b"not logged", "auth"),
                            (b"authentication", "auth"), (b"forbidden", "auth"),
                            (b"rate limit", "rate_limit"), (b"connection", "network"),
                            (b"network", "network"), (b"timeout", "timeout"),
                            (b"unknown flag", "cli"), (b"unknown command", "cli"),
                            (b"command not found", "cli"), (b"not found", "not_found"),
                        )
                        diagnostics["error_category"] = next((name for marker, name in categories if marker in stderr), "other")
                        match = re.search(rb"http ([1-5][0-9]{2})", stderr)
                        if match:
                            diagnostics["http_status"] = int(match.group(1))
                        try:
                            version = subprocess_mod.run(["gh", "--version"], capture_output=True, timeout=10, check=False)
                            match = re.match(rb"gh version (\d+\.\d+\.\d+)(?:\s|$)", version.stdout or b"")
                            if version.returncode == 0 and match:
                                diagnostics["gh_version"] = match.group(1).decode("ascii")
                        except (OSError, subprocess_mod.SubprocessError, TypeError):
                            pass
                raise ValueError("runtime_control_read_unavailable")
            return response.stdout if binary else json.loads(response.stdout)
        except subprocess_mod.TimeoutExpired:
            if diagnostics is not None:
                diagnostics["failure_kind"] = "timeout"
            raise ValueError("runtime_control_read_unavailable") from None
        except (OSError, subprocess_mod.SubprocessError, TypeError, UnicodeError, json.JSONDecodeError):
            if diagnostics is not None:
                diagnostics["failure_kind"] = "read_failed"
            raise ValueError("runtime_control_read_unavailable") from None

    try:
        if diagnostics is not None:
            diagnostics["stage"] = "workflow"
        meta = get(f"actions/workflows/{workflow}")
        if diagnostics is not None:
            diagnostics["stage"] = "run"
        run = get(f"actions/runs/{run_id}")
        title = ("Runtime switch " if identity["platform_id"] == "ibkr" else "Schwab runtime switch ") + request_id
        if (
            meta.get("path") != f".github/workflows/{workflow}"
            or run.get("workflow_id") != meta.get("id")
            or run.get("id") != run_id
            or run.get("run_attempt") != 1
            or run.get("event") != "workflow_dispatch"
            or run.get("head_branch") != "main"
            or run.get("display_title") != title
            or run.get("status") != "completed"
        ):
            return "unknown"
        if diagnostics is not None:
            diagnostics["stage"] = "artifacts"
        listing = get(f"actions/runs/{run_id}/artifacts?per_page=100")
        artifact_name = (
            f"ibkr-runtime-switch-result-{run_id}-1"
            if identity["platform_id"] == "ibkr"
            else "schwab-runtime-switch-safe"
        )
        if not is_list(listing.get("artifacts")) or listing.get("total_count", 101) > 100:
            return "unknown"
        matches = [item for item in listing["artifacts"] if item.get("name") == artifact_name and not item.get("expired")]
        if (
            len(matches) != 1
            or type(matches[0].get("id")) is not int
            or type(matches[0].get("size_in_bytes")) is not int
            or matches[0]["size_in_bytes"] > 262144
        ):
            return "unknown"
        if diagnostics is not None:
            diagnostics["stage"] = "receipt"
        archive = get(f"actions/artifacts/{matches[0]['id']}/zip", binary=True)
        receipt = read_receipt_zip_fn(archive, identity["platform_id"])
        result = validate_receipt_fn(request, operation, request_id, run_id, receipt)
        if diagnostics is not None:
            diagnostics["stage"] = "receipt_match"
        reviewed_failures = {
            "49af5187aabace9dec41059620ecc4f16aa76daf": "error: switch candidate changed service annotations or labels",
            "c0bd4c01b9db95d61785e9e20dceea8f750c72a2": "ValueError: traffic candidate has not passed its application startup probe",
            "bf0077ea3a12ca78337c49cf61316467af5d1dea": "ValueError: traffic candidate has not passed its application startup probe",
        }
        if (
            result == "unknown"
            and identity["platform_id"] == "ibkr"
            and operation == "enable"
            and run.get("head_sha") in reviewed_failures
            and run.get("conclusion") == "failure"
            and receipt.get("status") == "unknown"
            and receipt.get("request_id") == request_id
            and str(receipt.get("run_id")) == str(run_id)
            and str(receipt.get("attempt")) == "1"
            and receipt.get("operation") == operation
            and receipt.get("target_sha256") == hashlib.sha256(identity["service_name"].encode("utf-8")).hexdigest()
        ):
            if diagnostics is not None:
                diagnostics["stage"] = "jobs"
            jobs = get(f"actions/runs/{run_id}/jobs?per_page=100")
            if not is_list(jobs.get("jobs")) or jobs.get("total_count", 101) > 100:
                return "unknown"
            candidates = [
                job for job in jobs["jobs"]
                if job.get("conclusion") == "failure"
                and job.get("run_id") == run_id
                and job.get("run_attempt") == 1
            ]
            if len(candidates) != 1 or type(candidates[0].get("id")) is not int:
                return "unknown"
            steps = candidates[0].get("steps")
            if not is_list(steps):
                return "unknown"
            traffic = [step for step in steps if step.get("name") == "Reconcile Cloud Run traffic"]
            scheduler = [step for step in steps if step.get("name") == "Reconcile existing runtime switch scheduler"]
            prepare = [step for step in steps if step.get("name") == "Prepare env-only revision and runtime switch"]
            if (
                len(traffic) != 1 or traffic[0].get("conclusion") != "failure"
                or len(scheduler) != 1 or scheduler[0].get("conclusion") != "skipped"
                or len(prepare) != 1 or prepare[0].get("conclusion") != "success"
            ):
                return "unknown"
            start = parse_utc_iso_timestamp(traffic[0].get("started_at"))
            end = parse_utc_iso_timestamp(traffic[0].get("completed_at"))
            if start is None or end is None or end < start:
                return "unknown"
            if diagnostics is not None:
                diagnostics["stage"] = "job_log"
            raw_log = get(f"actions/jobs/{candidates[0]['id']}/logs", binary=True, allow_log_colours=True)
            if diagnostics is not None:
                diagnostics["stage"] = "job_log_decode"
            if raw_log.startswith(b"PK\x03\x04"):
                if diagnostics is not None:
                    diagnostics["failure_kind"] = "unexpected_zip"
                return "unknown"
            log = raw_log.decode("utf-8")
            if diagnostics is not None:
                diagnostics["stage"] = "log_match"
            pattern = re.compile(
                r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?Z "
                + re.escape(reviewed_failures[run["head_sha"]])
                + r"$"
            )
            found = [match for line in log.splitlines() if (match := pattern.fullmatch(line))]
            if len(found) == 1:
                when = datetime.fromisoformat(found[0].group(1) + "+00:00")
                if start.replace(microsecond=0) <= when <= end.replace(microsecond=0):
                    return "rejected"
        return result
    except (ValueError, TypeError, AttributeError, KeyError):
        return "unknown"


def dispatch_hk_stop(
    request: dict[str, Any],
    *,
    require_hk_fn: Callable[[dict[str, Any]], None],
    read_stop_variables_fn: Callable[[dict[str, Any]], dict[str, str]],
    subprocess_mod: Any = subprocess,
) -> None:
    """Dispatch the fixed LongBridge HK stop workflow after saved state verification."""
    require_hk_fn(request)
    if read_stop_variables_fn(request["github"]).get("RUNTIME_TARGET_ENABLED") != "false":
        raise ValueError("stop_saved_configuration_required")
    payload = {"ref": "main", "inputs": {"stop_request": json.dumps(request), "confirm": "STOP_ONLY"}}
    try:
        result = subprocess_mod.run(
            [
                "gh", "api", "--method", "POST",
                "repos/QuantStrategyLab/LongBridgePlatform/actions/workflows/stop-hk-runtime.yml/dispatches",
                "--input", "-",
            ],
            input=json.dumps(payload), text=True, capture_output=True, timeout=45, check=False,
        )
        if result.returncode:
            raise ValueError
    except (ValueError, OSError, subprocess_mod.SubprocessError):
        raise ValueError("stop_platform_dispatch_unverified") from None


def command_runtime_control(
    args: argparse.Namespace,
    *,
    load_stop_request_fn: Callable[[], dict[str, Any]],
    preflight_fn: Callable[[dict[str, Any]], str],
    execute_stop_fn: Callable[..., dict[str, Any]],
    dispatch_fn: Callable[[dict[str, Any], str, str, str], dict[str, Any]],
    recover_fn: Callable[[dict[str, Any], str, str, str], int | None],
    read_result_fn: Callable[..., str],
    time_mod: Any = time,
) -> int:
    """Run one already-authorized request through the existing protected writer."""
    request_id = args.request_id
    operation = args.operation
    summary = {
        "request_id": request_id,
        "operation": operation,
        "status": "unknown",
        "platform_run_id": None,
        "run_id": os.environ.get("GITHUB_RUN_ID"),
        "attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
        "reason": None,
    }
    stage = "request"
    try:
        if operation not in {"enable", "disable"} or not is_uuid_str(request_id):
            raise ValueError("runtime_control_request_invalid")
        request = load_stop_request_fn()
        stage = "workflow_preflight"
        workflow = preflight_fn(request)
        stage = "configuration"
        execute_stop_fn(request, apply=True, enabled=operation == "enable")
        stage = "platform_dispatch"
        since = (datetime.now(timezone.utc) - timedelta(seconds=60)).strftime("%Y-%m-%dT%H:%M:%SZ")
        dispatched = dispatch_fn(request, operation, request_id, workflow)
        if dispatched["status"] == "rejected":
            summary["status"] = "partial"
            summary["reason"] = "platform_dispatch_rejected"
        else:
            run_id = dispatched["run_id"]
            for attempt in range(10):
                if run_id is None:
                    run_id = recover_fn(request, request_id, workflow, since)
                if run_id is not None:
                    summary["platform_run_id"] = run_id
                    outcome = read_result_fn(request, operation, request_id, run_id, workflow)
                    if outcome != "unknown":
                        summary["status"] = outcome
                        break
                if attempt < 9:
                    time_mod.sleep(10)
            if summary["status"] == "unknown":
                summary["reason"] = "platform_result_unavailable" if run_id else "platform_dispatch_unverified"
    except (OSError, ValueError, TypeError, KeyError) as error:
        reason = str(error)
        summary["reason"] = (
            reason
            if reason in {
                "runtime_control_workflow_permission_denied",
                "runtime_control_workflow_unavailable",
                "runtime_control_target_unsupported",
                "stop_source_permission_denied",
                "stop_source_not_accessible",
            }
            else stage + "_unverified"
        )
        if stage in {"request", "workflow_preflight"}:
            summary["status"] = "rejected"
    result_path = os.environ.get("RUNTIME_CONTROL_RESULT_PATH")
    if result_path:
        with open(result_path, "w", encoding="utf-8") as output:
            json.dump(summary, output)
    return 0 if summary["status"] == "applied" else 1


def command_runtime_control_readback(
    args: argparse.Namespace,
    *,
    load_stop_request_fn: Callable[[], dict[str, Any]],
    preflight_fn: Callable[[dict[str, Any]], str],
    read_result_fn: Callable[..., str],
) -> int:
    """Read the persisted original platform run without changing configuration or dispatching it."""
    summary = {
        "request_id": args.request_id,
        "check_id": args.check_id,
        "operation": args.operation,
        "status": "unknown",
        "platform_run_id": args.platform_run_id,
        "run_id": os.environ.get("GITHUB_RUN_ID"),
        "attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
        "reason": None,
    }
    try:
        for value in (args.request_id, args.check_id):
            if not is_uuid_str(value):
                raise ValueError("runtime_control_request_invalid")
        if args.operation not in {"enable", "disable"} or not re.fullmatch(r"[1-9][0-9]*", args.platform_run_id):
            raise ValueError("runtime_control_request_invalid")
        request = load_stop_request_fn()
        workflow = preflight_fn(request)
        diagnostics: dict[str, Any] = {}
        summary["status"] = read_result_fn(
            request, args.operation, args.request_id, int(args.platform_run_id), workflow, diagnostics
        )
        if summary["status"] == "unknown":
            summary["reason"] = "platform_result_unavailable"
            summary["readback_stage"] = diagnostics.get("stage")
            summary["http_status"] = diagnostics.get("http_status")
            summary["failure_kind"] = diagnostics.get("failure_kind")
            summary["error_category"] = diagnostics.get("error_category")
            summary["gh_version"] = diagnostics.get("gh_version")
            summary["exit_code"] = diagnostics.get("exit_code")
            summary["stderr_empty"] = diagnostics.get("stderr_empty")
    except (OSError, ValueError, TypeError, KeyError):
        summary["reason"] = "platform_result_unavailable"
    result_path = os.environ.get("RUNTIME_CONTROL_RESULT_PATH")
    if result_path:
        with open(result_path, "w", encoding="utf-8") as output:
            json.dump(summary, output)
    return 0 if summary["status"] == "applied" else 1


def command_stop(
    args: argparse.Namespace,
    *,
    load_stop_request_fn: Callable[[], dict[str, Any]],
    require_hk_fn: Callable[[dict[str, Any]], None],
    require_writer_ref_fn: Callable[[], str],
    execute_stop_fn: Callable[..., dict[str, Any]],
    dispatch_hk_fn: Callable[[dict[str, Any]], None],
) -> int:
    """CLI handler for ``stop`` preview and confirmed stop writes."""
    if args.yes and args.confirm != "STOP_ONLY":
        print("stop requires --confirm STOP_ONLY for writes", file=sys.stderr)
        return 2
    stage = "event"
    try:
        request = load_stop_request_fn()
        stage = "configuration"
        apply_hk_stop = getattr(args, "apply_hk_stop", False)
        if apply_hk_stop:
            if not args.yes:
                raise ValueError("stop_platform_apply_requires_saved_stop")
            require_hk_fn(request)
            require_writer_ref_fn()
            saved = execute_stop_fn(request, apply=True)
            stage = "platform_dispatch"
            dispatch_hk_fn(request)
            result = {
                **saved,
                "platform_apply_requested": True,
                "platform_applied": False,
                "resource_key": saved["resource_write_audit"]["resource_key"],
            }
        else:
            result = execute_stop_fn(request, apply=args.yes)
    except (OSError, ValueError, TypeError, KeyError) as error:
        safe_reasons = {
            "stop_event_unverified", "stop_source_unavailable", "stop_source_cli_unsupported",
            "stop_source_permission_denied", "stop_source_not_accessible", "stop_source_incomplete",
            "stop_source_timeout", "stop_source_changed", "stop_write_outcome_unverified",
            "stop_readback_unverified", "stale_writer_ref_rejected", "stop_platform_target_unsupported",
            "stop_saved_configuration_required", "stop_platform_dispatch_unverified",
            "stop_platform_apply_requires_saved_stop",
        }
        reason = str(error)
        if reason == "stop requires an unambiguous current target with matching identity":
            reason = "stop_identity_mismatch"
        elif reason not in safe_reasons:
            reason = "stop_event_unverified" if stage == "event" else "stop_configuration_unverified"
        print(f"stop_not_verified; stage={stage}; reason={reason}; do not retry or infer platform state", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0
