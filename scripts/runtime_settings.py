#!/usr/bin/env python3
"""Validate and render QuantStrategyLab runtime target settings."""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
LOCAL_TARGETS_DIR = ROOT / "local" / "targets"
EXAMPLE_TARGETS_DIR = ROOT / "examples" / "targets"
LOCAL_POLICY_PATH = ROOT / "local" / "policy.json"

SUPPORTED_PLATFORMS = {
    "schwab": {"plugin_mounts_prefix": "SCHWAB_", "repository": "QuantStrategyLab/CharlesSchwabPlatform"},
    "longbridge": {"plugin_mounts_prefix": "LONGBRIDGE_", "repository": "QuantStrategyLab/LongBridgePlatform"},
    "ibkr": {"plugin_mounts_prefix": "IBKR_", "repository": "QuantStrategyLab/InteractiveBrokersPlatform"},
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
GENERATED_VARIABLES = {"RUNTIME_TARGET_JSON", "STRATEGY_PROFILE"}
SECRET_MARKERS = ("PASSWORD", "PRIVATE_KEY", "TOKEN", "API_KEY")


@dataclass(frozen=True)
class Assignment:
    target_id: str
    repository: str
    variable_scope: str
    environment: str | None
    name: str
    value: str

    def gh_command(self) -> list[str]:
        command = ["gh", "variable", "set", self.name, "--repo", self.repository, "--body", self.value]
        if self.variable_scope == "environment":
            command.extend(["--env", self.environment or ""])
        return command

    def shell_command(self) -> str:
        return " ".join(shlex.quote(part) for part in self.gh_command())


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
    if upper_name.endswith("_SECRET_NAME"):
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
                            f"runtime_target.execution_windows.{window_name}.offset_minutes must be a non-negative integer"
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
        if is_secret_variable_name(name):
            errors.append(f"extra_variables.{name} looks like a secret and must not be stored here")
        if isinstance(value, str) and "\n" in value:
            errors.append(f"extra_variables.{name} must be a single-line value")

    runtime_target = target.get("runtime_target") if isinstance(target.get("runtime_target"), dict) else {}
    dry_run_only = runtime_target.get("dry_run_only")
    longbridge_dry_run = extra_variables.get("LONGBRIDGE_DRY_RUN_ONLY")
    if longbridge_dry_run is not None and env_string(longbridge_dry_run).lower() != env_string(dry_run_only):
        errors.append("extra_variables.LONGBRIDGE_DRY_RUN_ONLY must match runtime_target.dry_run_only")


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
    if platform_id in SUPPORTED_PLATFORMS and github.get("repository") != SUPPORTED_PLATFORMS[platform_id]["repository"]:
        errors.append(
            "github.repository does not match platform "
            f"{platform_id}: expected {SUPPORTED_PLATFORMS[platform_id]['repository']}"
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
            print(f"FAIL {path.relative_to(ROOT)}", file=sys.stderr)
            for error in errors:
                print(f"  - {error}", file=sys.stderr)
        else:
            print(f"OK   {path.relative_to(ROOT)}")
    return 1 if had_errors else 0


def command_render(args: argparse.Namespace) -> int:
    all_assignments = []
    for _, target in load_targets(args.targets):
        all_assignments.extend(build_assignments(target))

    if args.format == "json":
        print(
            json.dumps(
                [
                    {
                        "target_id": assignment.target_id,
                        "repository": assignment.repository,
                        "variable_scope": assignment.variable_scope,
                        "environment": assignment.environment,
                        "name": assignment.name,
                        "value": assignment.value,
                    }
                    for assignment in all_assignments
                ],
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    if args.format == "gh":
        for assignment in all_assignments:
            print(assignment.shell_command())
        return 0

    current_target = None
    for assignment in all_assignments:
        if assignment.target_id != current_target:
            current_target = assignment.target_id
            suffix = assignment.variable_scope
            if assignment.environment:
                suffix += f":{assignment.environment}"
            print(f"# {assignment.target_id} -> {assignment.repository} ({suffix})")
        print(f"{assignment.name}={shlex.quote(assignment.value)}")
    return 0


def command_apply(args: argparse.Namespace) -> int:
    all_assignments = []
    for _, target in load_targets(args.targets):
        all_assignments.extend(build_assignments(target))

    for assignment in all_assignments:
        print(assignment.shell_command())

    if not args.yes:
        print("\nDry run only. Re-run with --yes to apply these GitHub variables.")
        return 0

    for assignment in all_assignments:
        subprocess.run(assignment.gh_command(), check=True)
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
    render.set_defaults(func=command_render)

    apply = subparsers.add_parser("apply", help="preview or apply GitHub variable updates")
    apply.add_argument("targets", nargs="*", help="target JSON files; defaults to all targets")
    apply.add_argument("--yes", action="store_true", help="apply updates with gh variable set")
    apply.set_defaults(func=command_apply)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
