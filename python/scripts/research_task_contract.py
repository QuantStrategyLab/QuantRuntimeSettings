"""Validate immutable, no-order research tasks shared with AI automation.

This contract represents a bounded request to run an offline research
experiment.  It cannot represent a paper/shadow/live activation, credentials,
orders, capital, a runtime target, or a policy mutation.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from datetime import datetime
from typing import Any, Mapping


SCHEMA = "qsl.research_task.v1"
_FIELDS = frozenset(
    {
        "schema",
        "task_id",
        "created_at",
        "digest_algorithm",
        "task_type",
        "target",
        "evidence",
        "experiment",
        "authority",
        "task_sha256",
    }
)
_IDENTITY = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_REPOSITORY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_REVISION = re.compile(r"^[0-9a-f]{40}$")
_TASK_TYPES = frozenset(
    {
        "strategy_diagnosis",
        "hypothesis_evaluation",
        "parameter_challenge",
        "strategy_candidate",
        "portfolio_candidate",
        "plugin_candidate",
    }
)
_CANDIDATE_KINDS = frozenset({"individual", "portfolio", "plugin"})
_DOMAINS = frozenset({"us_equity", "hk_equity", "cn_equity", "crypto"})
_OBJECTIVES = frozenset({"diagnose_degradation", "test_hypothesis", "challenge_parameters", "evaluate_candidate"})
_FORBIDDEN_WORDS = re.compile(r"(?:secret|token|password|credential|api[_-]?key|order|fill|capital|account|broker)", re.IGNORECASE)
_SAFE_AUTHORITY_KEYS = frozenset({"no_order"})


class ResearchTaskValidationError(ValueError):
    """Raised when a proposed research task is malformed or out of scope."""


def _canonical_json(value: object) -> str:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ResearchTaskValidationError("research task must use finite JSON values") from exc


def calculate_task_sha256(payload: Mapping[str, Any]) -> str:
    """Hash every field except the self-referential task digest."""
    material = copy.deepcopy(dict(payload))
    material.pop("task_sha256", None)
    return hashlib.sha256(_canonical_json(material).encode("utf-8")).hexdigest()


def _exact_mapping(value: object, fields: frozenset[str], label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != fields:
        raise ResearchTaskValidationError(f"{label} has invalid fields")
    return dict(value)


def _identity(value: object, label: str) -> str:
    if not isinstance(value, str) or not _IDENTITY.fullmatch(value):
        raise ResearchTaskValidationError(f"{label} must be a stable identity")
    return value


def _sha256(value: object, label: str, *, nullable: bool = False) -> str | None:
    if nullable and value is None:
        return None
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise ResearchTaskValidationError(f"{label} must be a lowercase SHA-256")
    return value


def _revision(value: object, label: str) -> str:
    if not isinstance(value, str) or not _REVISION.fullmatch(value):
        raise ResearchTaskValidationError(f"{label} must be a 40-character revision")
    return value


def _timestamp(value: object, label: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value):
        raise ResearchTaskValidationError(f"{label} must be a UTC timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ResearchTaskValidationError(f"{label} must be a UTC timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ResearchTaskValidationError(f"{label} must be a UTC timestamp")
    return value


def _forbid_unsafe_material(value: object, label: str = "research task") -> None:
    if isinstance(value, Mapping):
        for key, nested in value.items():
            text = str(key)
            if text not in _SAFE_AUTHORITY_KEYS and _FORBIDDEN_WORDS.search(text):
                raise ResearchTaskValidationError(f"{label} contains forbidden execution or secret material")
            _forbid_unsafe_material(nested, f"{label}.{text}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _forbid_unsafe_material(nested, f"{label}[{index}]")
    elif isinstance(value, float) and not math.isfinite(value):
        raise ResearchTaskValidationError(f"{label} contains a non-finite value")


def validate_research_task(payload: object) -> dict[str, Any]:
    """Validate and return a deep-copied, strictly research-only task."""
    task = _exact_mapping(payload, _FIELDS, "research task")
    _forbid_unsafe_material(task)
    if task["schema"] != SCHEMA:
        raise ResearchTaskValidationError("unsupported research task schema")
    _identity(task["task_id"], "task_id")
    _timestamp(task["created_at"], "created_at")
    if task["digest_algorithm"] != "sha256":
        raise ResearchTaskValidationError("digest_algorithm must be sha256")
    if task["task_type"] not in _TASK_TYPES:
        raise ResearchTaskValidationError("unsupported task_type")

    target = _exact_mapping(
        task["target"],
        frozenset({"candidate_id", "candidate_kind", "domain", "repository", "strategy_revision"}),
        "target",
    )
    _identity(target["candidate_id"], "target.candidate_id")
    if target["candidate_kind"] not in _CANDIDATE_KINDS:
        raise ResearchTaskValidationError("target.candidate_kind is unsupported")
    if target["domain"] not in _DOMAINS:
        raise ResearchTaskValidationError("target.domain is unsupported")
    if not isinstance(target["repository"], str) or not _REPOSITORY.fullmatch(target["repository"]):
        raise ResearchTaskValidationError("target.repository is invalid")
    _revision(target["strategy_revision"], "target.strategy_revision")

    evidence = _exact_mapping(
        task["evidence"],
        frozenset({"p1_input_digest", "p2_config_digest", "p3_evidence_id", "producer_revision"}),
        "evidence",
    )
    _sha256(evidence["p1_input_digest"], "evidence.p1_input_digest", nullable=True)
    _sha256(evidence["p2_config_digest"], "evidence.p2_config_digest", nullable=True)
    _sha256(evidence["p3_evidence_id"], "evidence.p3_evidence_id", nullable=True)
    _revision(evidence["producer_revision"], "evidence.producer_revision")

    experiment = _exact_mapping(
        task["experiment"],
        frozenset({"objective", "hypothesis", "parameter_bounds_sha256", "max_runs", "max_wall_seconds"}),
        "experiment",
    )
    if experiment["objective"] not in _OBJECTIVES:
        raise ResearchTaskValidationError("experiment.objective is unsupported")
    if not isinstance(experiment["hypothesis"], str) or not experiment["hypothesis"].strip() or len(experiment["hypothesis"]) > 800:
        raise ResearchTaskValidationError("experiment.hypothesis must be a bounded non-empty statement")
    _sha256(experiment["parameter_bounds_sha256"], "experiment.parameter_bounds_sha256", nullable=True)
    for field, maximum in (("max_runs", 100), ("max_wall_seconds", 86_400)):
        value = experiment[field]
        if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > maximum:
            raise ResearchTaskValidationError(f"experiment.{field} is outside its safe bound")

    authority = _exact_mapping(
        task["authority"],
        frozenset({"research_only", "no_order", "size_zero_required", "p4_p5_p6_authorized"}),
        "authority",
    )
    if authority != {
        "research_only": True,
        "no_order": True,
        "size_zero_required": True,
        "p4_p5_p6_authorized": False,
    }:
        raise ResearchTaskValidationError("authority must be fixed to offline research only")
    if _sha256(task["task_sha256"], "task_sha256") != calculate_task_sha256(task):
        raise ResearchTaskValidationError("task_sha256 mismatch")
    return copy.deepcopy(task)


def parse_research_task_json(value: str) -> dict[str, Any]:
    """Parse JSON without silently accepting duplicate keys."""
    try:
        payload = json.loads(value, object_pairs_hook=_reject_duplicate_keys)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ResearchTaskValidationError("invalid research task JSON") from exc
    return validate_research_task(payload)


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


__all__ = [
    "ResearchTaskValidationError",
    "SCHEMA",
    "calculate_task_sha256",
    "parse_research_task_json",
    "validate_research_task",
]
