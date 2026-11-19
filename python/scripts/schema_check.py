#!/usr/bin/env python3
"""Lightweight declarative field, type, and mapping validation helpers."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

UUID_V1_8_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
SHA256_LOWER_RE = re.compile(r"^[0-9a-f]{64}$")
SHA256_HEX_RE = re.compile(r"^(?:sha256:)?[0-9a-fA-F]{64}$")
SHA256_EXACT_HEX_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def is_dict(value: Any) -> bool:
    """Return True when ``value`` is a ``dict``."""
    return isinstance(value, dict)


def is_list(value: Any) -> bool:
    """Return True when ``value`` is a ``list``."""
    return isinstance(value, list)


def is_str(value: Any) -> bool:
    """Return True when ``value`` is a ``str``."""
    return isinstance(value, str)


def is_bool(value: Any) -> bool:
    """Return True when ``value`` is a ``bool``."""
    return isinstance(value, bool)


def is_bytes(value: Any) -> bool:
    """Return True when ``value`` is ``bytes``."""
    return isinstance(value, bytes)


def is_mapping_or_seq(value: Any) -> bool:
    """Return True when ``value`` is a ``dict`` or ``list``."""
    return isinstance(value, (dict, list))


def is_sequence_container(value: Any) -> bool:
    """Return True when ``value`` is a ``list``, ``tuple``, or ``set``."""
    return isinstance(value, (list, tuple, set))


def as_dict(value: Any) -> dict[str, Any]:
    """Return ``value`` if it is a ``dict``, otherwise an empty ``dict``."""
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> list[Any]:
    """Return ``value`` if it is a ``list``, otherwise an empty ``list``."""
    return value if isinstance(value, list) else []


def is_nonempty_str(value: Any) -> bool:
    """Return True when ``value`` is a string containing non-whitespace text."""
    return isinstance(value, str) and bool(value.strip())


def is_strict_int(value: Any, *, min_value: int | None = None, max_value: int | None = None) -> bool:
    """Return True when ``value`` is an exact ``int`` (never ``bool``) within bounds."""
    if type(value) is not int:
        return False
    if min_value is not None and value < min_value:
        return False
    if max_value is not None and value > max_value:
        return False
    return True


def is_int_value(value: Any, *, min_value: int | None = None, max_value: int | None = None) -> bool:
    """Return True when ``value`` satisfies ``isinstance(value, int)`` within bounds."""
    if not isinstance(value, int):
        return False
    if min_value is not None and value < min_value:
        return False
    if max_value is not None and value > max_value:
        return False
    return True


def is_nonempty_str_list(value: Any, *, unique: bool = False) -> bool:
    """Return True when ``value`` is a non-empty list of non-empty strings."""
    if not isinstance(value, list) or not value:
        return False
    if any(not is_nonempty_str(item) for item in value):
        return False
    if unique and len(set(value)) != len(value):
        return False
    return True


def is_list_of_dicts(value: Any, *, non_empty: bool = False) -> bool:
    """Return True when ``value`` is a list containing only ``dict`` items."""
    if not isinstance(value, list):
        return False
    if non_empty and not value:
        return False
    return all(isinstance(item, dict) for item in value)


def is_regex_str(value: Any, pattern: re.Pattern[str], *, strip: bool = True) -> bool:
    """Return True when ``value`` is a string matching ``pattern``."""
    if not isinstance(value, str):
        return False
    candidate = value.strip() if strip else value
    return pattern.fullmatch(candidate) is not None


def is_iso_date(value: Any) -> bool:
    """Return True when ``value`` is a stripped ISO-8601 ``YYYY-MM-DD`` calendar date."""
    if not is_nonempty_str(value):
        return False
    try:
        date.fromisoformat(value.strip())
    except ValueError:
        return False
    return True


def parse_utc_iso_timestamp(value: Any) -> datetime | None:
    """Parse a strict UTC ISO-8601 timestamp string or return None."""
    if not is_nonempty_str(value):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.utcoffset() != timedelta(0):
        return None
    return parsed


def is_uuid_str(value: Any) -> bool:
    """Return True when ``value`` matches a lowercase RFC-4122 UUID string."""
    return isinstance(value, str) and UUID_V1_8_RE.fullmatch(value) is not None


def is_sha256_str(
    value: Any,
    *,
    allow_prefix: bool = False,
    lowercase_only: bool = False,
    strip: bool = True,
) -> bool:
    """Validate a 64-hex SHA-256 string with configurable case and prefix policy."""
    if not isinstance(value, str):
        return False
    text = value.strip() if strip else value
    if lowercase_only:
        candidate = text.removeprefix("sha256:") if allow_prefix else text
        return SHA256_LOWER_RE.fullmatch(candidate) is not None
    pattern = SHA256_HEX_RE if allow_prefix else SHA256_EXACT_HEX_RE
    return pattern.fullmatch(text) is not None


def parse_json_payload(value: Any) -> Any:
    """Parse ``value`` when it is JSON text; return original object or None on parse error."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return value


@dataclass(frozen=True)
class FieldRule:
    """Declarative field specification for mapping validation."""

    kind: str = "nonempty_str"
    required: bool = True
    choices: frozenset[str] | set[str] | tuple[str, ...] = ()
    pattern: re.Pattern[str] | None = None
    min_value: int | None = None
    max_value: int | None = None
    unique: bool = False
    allow_prefix: bool = False
    lowercase_only: bool = False
    strip: bool = True
    prefix: str | None = None
    predicate: Callable[[Any], bool] | None = None
    required_error: str | None = None
    invalid_error: str | None = None


def check_field_value(value: Any, rule: FieldRule) -> bool:
    """Check one field value against a declarative ``FieldRule``."""
    kind = rule.kind
    if kind == "str":
        return is_str(value)
    if kind == "nonempty_str":
        return is_nonempty_str(value)
    if kind == "bool":
        return is_bool(value)
    if kind == "strict_int":
        return is_strict_int(value, min_value=rule.min_value, max_value=rule.max_value)
    if kind == "int":
        return is_int_value(value, min_value=rule.min_value, max_value=rule.max_value)
    if kind == "list":
        return is_list(value)
    if kind == "nonempty_str_list":
        return is_nonempty_str_list(value, unique=rule.unique)
    if kind == "dict":
        return is_dict(value)
    if kind == "choice":
        return is_str(value) and value in rule.choices
    if kind == "regex":
        return rule.pattern is not None and is_regex_str(value, rule.pattern, strip=rule.strip)
    if kind == "iso_date":
        return is_iso_date(value)
    if kind == "sha256":
        return is_sha256_str(
            value,
            allow_prefix=rule.allow_prefix,
            lowercase_only=rule.lowercase_only,
            strip=rule.strip,
        )
    if kind == "prefix":
        return is_str(value) and rule.prefix is not None and value.startswith(rule.prefix)
    if kind == "cron_or_time":
        return is_str(value) and len(value.split()) in {2, 5}
    if kind == "custom":
        return rule.predicate is not None and rule.predicate(value)
    raise ValueError(f"unsupported schema rule kind: {kind}")


def matches_mapping_rules(
    value: Any,
    rules: dict[str, FieldRule],
    *,
    exact_keys: bool = True,
) -> bool:
    """Return True when ``value`` is a dict matching all ``FieldRule`` entries."""
    if not isinstance(value, dict):
        return False
    if exact_keys and set(value) != set(rules):
        return False
    for field, rule in rules.items():
        if field not in value:
            if rule.required:
                return False
            continue
        if not check_field_value(value[field], rule):
            return False
    return True


def validate_mapping_schema(
    value: Any,
    rules: dict[str, FieldRule],
    *,
    errors: list[str],
    prefix: str,
    not_dict_error: str | None = None,
    allow_extra: bool = False,
    unsupported_error: str | None = None,
    unsupported_template: str | None = None,
) -> bool:
    """Validate a mapping against declarative field rules, appending exact errors."""
    if not isinstance(value, dict):
        errors.append(not_dict_error or f"{prefix} must be an object")
        return False

    if not allow_extra:
        unexpected = sorted(set(value) - set(rules))
        if unsupported_template is not None:
            for field in unexpected:
                errors.append(unsupported_template.format(prefix=prefix, field=field))
        elif unexpected:
            errors.append(
                unsupported_error or f"{prefix} contains unsupported fields: " + ", ".join(unexpected)
            )

    for field, rule in rules.items():
        if field not in value:
            if rule.required:
                errors.append(rule.required_error or f"{prefix}.{field} is required")
            continue
        if not check_field_value(value[field], rule):
            errors.append(rule.invalid_error or f"{prefix}.{field} is invalid")
    return True


def validate_variable_mapping(
    variables: Any,
    *,
    scope_name: str,
    generated_names: set[str],
    research_only_names: frozenset[str] | set[str],
    is_secret_fn: Callable[[str], bool],
    validate_inventory_fn: Callable[..., None],
    errors: list[str],
    duplicate_names: set[str] | None = None,
    duplicate_label: str | None = None,
) -> bool:
    """Validate an extra or repository variables mapping using uniform safety rules."""
    if not isinstance(variables, dict):
        errors.append(f"{scope_name} must be an object")
        return False

    for name, value in variables.items():
        if name in generated_names:
            errors.append(f"{scope_name}.{name} duplicates a generated variable")
        if duplicate_names and name in duplicate_names:
            errors.append(f"{scope_name}.{name} duplicates {duplicate_label}.{name}")
        if name in research_only_names:
            detail = (
                f"{scope_name}.{name} is research-only and must not be stored in live switch settings"
            )
            errors.append(detail)
        if is_secret_fn(name):
            errors.append(f"{scope_name}.{name} looks like a secret and must not be stored here")
        if isinstance(value, str) and "\n" in value:
            errors.append(f"{scope_name}.{name} must be a single-line value")
        if name == "CLOUD_RUN_SERVICE_TARGETS_JSON":
            validate_inventory_fn(value, path=f"{scope_name}.{name}", errors=errors)
    return True
