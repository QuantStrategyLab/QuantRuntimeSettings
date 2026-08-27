#!/usr/bin/env python3
"""Compose bounded long-horizon risk recommendations from frozen P3 paths.

This is a pure, offline policy-design helper.  It turns injected net-of-cost
strategy and unlevered-benchmark return paths into a small risk-scale frontier.
It has no account, capital, broker, credential, network, scheduler, policy
signing, persistence, or execution dependency.  Its recommendation is never
an active risk policy and cannot authorize P4, P5, or P6.

The human-facing input is deliberately small: one named risk preference.  The
composer calculates the concrete scale and drawdown envelope from P3 paths,
then binds the result to the candidate and its P1/P2/P3 evidence digests.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from collections.abc import Mapping, Sequence
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, localcontext
from pathlib import Path
from statistics import median_low
from typing import Any


RISK_COMPOSER_INPUT_SCHEMA_ID = "qsl.long_horizon_risk_composer_input.v1"
RISK_COMPOSER_RECOMMENDATION_SCHEMA_ID = "qsl.long_horizon_risk_composer_recommendation.v1"
RISK_OBSERVATION_SCHEMA_ID = "qsl.long_horizon_risk_observation.v1"
_IDENTITY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$")
_REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_URL_PATTERN = re.compile(r"[a-z][a-z0-9+.-]*://", re.IGNORECASE)
_FORBIDDEN_KEY_PATTERN = re.compile(
    r"credential|secret|token|password|cookie|jwt|private(?:[_-]?key)?|access[_-]?key|"
    r"broker|account(?:[_-]?(?:id|number|alias))?|endpoint|order(?:[_-]?payload)?|fill|"
    r"capital(?:[_-]?(?:amount|balance|value))?",
    re.IGNORECASE,
)
_INPUT_FIELDS = {"schema", "candidate", "source_evidence", "objective", "scenario_paths", "input_sha256"}
_OBSERVATION_FIELDS = {"schema", "candidate", "source_evidence", "benchmark", "scenario_paths", "observation_sha256"}
_CANDIDATE_FIELDS = {"candidate_id", "candidate_kind", "strategy_repository", "strategy_revision"}
_SOURCE_EVIDENCE_FIELDS = {"p1_input_digest", "p2_config_digest", "p3_evidence_sha256", "plugin_bundle_sha256"}
_OBJECTIVE_FIELDS = {"risk_preference", "benchmark_id", "benchmark_kind", "sessions_per_year"}
_BENCHMARK_FIELDS = {"benchmark_id", "benchmark_kind", "sessions_per_year"}
_SCENARIO_FIELDS = {
    "scenario_id",
    "scenario_kind",
    "session_count",
    "strategy_returns_bps",
    "benchmark_returns_bps",
}
_RECOMMENDATION_FIELDS = {
    "schema",
    "candidate",
    "source_evidence",
    "objective",
    "input_sha256",
    "status",
    "reason_codes",
    "recommended_scale_bps",
    "recommended_max_drawdown_bps",
    "frontier",
    "recommendation_sha256",
}
_FRONTIER_FIELDS = {
    "scale_bps",
    "median_log_growth_ppm",
    "positive_growth_scenarios",
    "scenario_count",
    "worst_max_drawdown_bps",
    "worst_relative_drawdown_bps",
    "worst_benchmark_drawdown_bps",
    "worst_underwater_sessions",
    "eligible",
}
_SCENARIO_KINDS = {"WALK_FORWARD", "BOOTSTRAP", "STRESS"}
_RISK_PREFERENCES = {
    "CAPITAL_PRESERVATION": 10_000,
    "BALANCED_COMPOUNDING": 12_500,
    "GROWTH_COMPOUNDING": 15_000,
}
_RISK_SCALE_GRID_BPS = tuple(range(1_000, 10_001, 1_000))
_MIN_SESSIONS_PER_SCENARIO = 252
_MAX_SCENARIOS = 12
_MAX_SESSIONS_PER_SCENARIO = 4_000
_MAX_RETURN_BPS = 100_000


class LongHorizonRiskComposerError(ValueError):
    """Raised when a policy-design input is malformed, unsafe, or ambiguous."""


def _fail(message: str) -> None:
    raise LongHorizonRiskComposerError(message)


def _expect_object(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        _fail(f"{path} must be an object")
    return value


def _expect_list(value: Any, path: str) -> Sequence[Any]:
    if not isinstance(value, list):
        _fail(f"{path} must be an array")
    return value


def _expect_exact_keys(value: Mapping[str, Any], expected: set[str], path: str) -> None:
    missing = sorted(expected - set(value))
    unknown = sorted(set(value) - expected)
    if missing:
        _fail(f"{path} missing required field(s): {', '.join(missing)}")
    if unknown:
        _fail(f"{path} has unknown field(s): {', '.join(unknown)}")


def _reject_non_finite_or_null(value: Any, path: str) -> None:
    if value is None:
        _fail(f"{path} must not be null")
    if isinstance(value, float) and not math.isfinite(value):
        _fail(f"{path} contains a non-finite number")
    if isinstance(value, Mapping):
        for key, child in value.items():
            if not isinstance(key, str):
                _fail(f"{path} contains a non-string key")
            _reject_non_finite_or_null(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_non_finite_or_null(child, f"{path}[{index}]")


def _reject_forbidden_material(value: Any, path: str) -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            if _FORBIDDEN_KEY_PATTERN.search(key):
                _fail(f"{path}.{key} is forbidden in a long-horizon risk contract")
            _reject_forbidden_material(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_forbidden_material(child, f"{path}[{index}]")
    elif isinstance(value, str) and _URL_PATTERN.search(value):
        _fail(f"{path} contains a forbidden URL")


def _expect_identity(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _IDENTITY_PATTERN.fullmatch(value):
        _fail(f"{path} must be a lowercase immutable identity")
    return value


def _expect_sha256(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _SHA256_PATTERN.fullmatch(value):
        _fail(f"{path} must be a lowercase SHA-256 digest")
    return value


def _expect_positive_integer(value: Any, path: str, *, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > maximum:
        _fail(f"{path} must be an integer between 1 and {maximum}")
    return value


def _expect_nonnegative_integer(value: Any, path: str, *, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > maximum:
        _fail(f"{path} must be an integer between 0 and {maximum}")
    return value


def _expect_return_bps(value: Any, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= -10_000 or value > _MAX_RETURN_BPS:
        _fail(f"{path} must be an integer return in (-10000, {_MAX_RETURN_BPS}] bps")
    return value


def _canonical_json(value: Mapping[str, Any], excluded_field: str, label: str) -> str:
    content = dict(value)
    content.pop(excluded_field, None)
    try:
        return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise LongHorizonRiskComposerError(f"{label} cannot be represented as canonical JSON") from exc


def calculate_risk_composer_input_sha256(value: Mapping[str, Any]) -> str:
    """Return the stable identity of one complete, injected evidence input."""
    return hashlib.sha256(_canonical_json(value, "input_sha256", "risk composer input").encode("utf-8")).hexdigest()


def calculate_risk_composer_recommendation_sha256(value: Mapping[str, Any]) -> str:
    """Return the stable digest of a non-sensitive recommendation summary."""
    return hashlib.sha256(
        _canonical_json(value, "recommendation_sha256", "risk composer recommendation").encode("utf-8")
    ).hexdigest()


def calculate_risk_observation_sha256(value: Mapping[str, Any]) -> str:
    """Return the stable identity of one private P3 return-path observation."""
    return hashlib.sha256(
        _canonical_json(value, "observation_sha256", "long-horizon risk observation").encode("utf-8")
    ).hexdigest()


def _validate_candidate(value: Any) -> dict[str, str]:
    candidate = _expect_object(value, "candidate")
    _expect_exact_keys(candidate, _CANDIDATE_FIELDS, "candidate")
    candidate_id = _expect_identity(candidate["candidate_id"], "candidate.candidate_id")
    if candidate["candidate_kind"] not in {"individual", "combo", "plugin"}:
        _fail("candidate.candidate_kind must be individual, combo, or plugin")
    repository = candidate["strategy_repository"]
    if not isinstance(repository, str) or not _REPOSITORY_PATTERN.fullmatch(repository):
        _fail("candidate.strategy_repository must be an owner/repository identity, not a URL")
    revision = candidate["strategy_revision"]
    if not isinstance(revision, str) or not _REVISION_PATTERN.fullmatch(revision):
        _fail("candidate.strategy_revision must be a lowercase 40-character revision")
    return {
        "candidate_id": candidate_id,
        "candidate_kind": candidate["candidate_kind"],
        "strategy_repository": repository,
        "strategy_revision": revision,
    }


def _validate_source_evidence(value: Any) -> dict[str, str]:
    evidence = _expect_object(value, "source_evidence")
    _expect_exact_keys(evidence, _SOURCE_EVIDENCE_FIELDS, "source_evidence")
    return {field: _expect_sha256(evidence[field], f"source_evidence.{field}") for field in _SOURCE_EVIDENCE_FIELDS}


def _validate_objective(value: Any) -> dict[str, Any]:
    objective = _expect_object(value, "objective")
    _expect_exact_keys(objective, _OBJECTIVE_FIELDS, "objective")
    preference = objective["risk_preference"]
    if preference not in _RISK_PREFERENCES:
        _fail("objective.risk_preference must be CAPITAL_PRESERVATION, BALANCED_COMPOUNDING, or GROWTH_COMPOUNDING")
    if objective["benchmark_kind"] != "unlevered_reference":
        _fail("objective.benchmark_kind must be unlevered_reference")
    return {
        "risk_preference": preference,
        "benchmark_id": _expect_identity(objective["benchmark_id"], "objective.benchmark_id"),
        "benchmark_kind": _expect_identity(objective["benchmark_kind"], "objective.benchmark_kind"),
        "sessions_per_year": _expect_positive_integer(
            objective["sessions_per_year"], "objective.sessions_per_year", maximum=366
        ),
    }


def _validate_benchmark(value: Any) -> dict[str, Any]:
    benchmark = _expect_object(value, "benchmark")
    _expect_exact_keys(benchmark, _BENCHMARK_FIELDS, "benchmark")
    if benchmark["benchmark_kind"] != "unlevered_reference":
        _fail("benchmark.benchmark_kind must be unlevered_reference")
    return {
        "benchmark_id": _expect_identity(benchmark["benchmark_id"], "benchmark.benchmark_id"),
        "benchmark_kind": _expect_identity(benchmark["benchmark_kind"], "benchmark.benchmark_kind"),
        "sessions_per_year": _expect_positive_integer(
            benchmark["sessions_per_year"], "benchmark.sessions_per_year", maximum=366
        ),
    }


def _validate_scenario(value: Any, index: int) -> dict[str, Any]:
    path = f"scenario_paths[{index}]"
    scenario = _expect_object(value, path)
    _expect_exact_keys(scenario, _SCENARIO_FIELDS, path)
    kind = scenario["scenario_kind"]
    if kind not in _SCENARIO_KINDS:
        _fail(f"{path}.scenario_kind must be WALK_FORWARD, BOOTSTRAP, or STRESS")
    strategy_returns = _expect_list(scenario["strategy_returns_bps"], f"{path}.strategy_returns_bps")
    benchmark_returns = _expect_list(scenario["benchmark_returns_bps"], f"{path}.benchmark_returns_bps")
    if len(strategy_returns) != len(benchmark_returns):
        _fail(f"{path} strategy and benchmark returns must have the same length")
    session_count = _expect_positive_integer(
        scenario["session_count"], f"{path}.session_count", maximum=_MAX_SESSIONS_PER_SCENARIO
    )
    if len(strategy_returns) != session_count - 1:
        _fail(f"{path} must contain exactly one fewer return than its observed sessions")
    if len(strategy_returns) > _MAX_SESSIONS_PER_SCENARIO - 1:
        _fail(f"{path} exceeds the bounded session count")
    return {
        "scenario_id": _expect_identity(scenario["scenario_id"], f"{path}.scenario_id"),
        "scenario_kind": kind,
        "session_count": session_count,
        "strategy_returns_bps": [
            _expect_return_bps(item, f"{path}.strategy_returns_bps[{return_index}]")
            for return_index, item in enumerate(strategy_returns)
        ],
        "benchmark_returns_bps": [
            _expect_return_bps(item, f"{path}.benchmark_returns_bps[{return_index}]")
            for return_index, item in enumerate(benchmark_returns)
        ],
    }


def validate_risk_composer_input(value: Any) -> dict[str, Any]:
    """Validate an injected evidence input without treating it as an active policy."""
    _reject_non_finite_or_null(value, "risk composer input")
    _reject_forbidden_material(value, "risk composer input")
    input_value = _expect_object(value, "risk composer input")
    _expect_exact_keys(input_value, _INPUT_FIELDS, "risk composer input")
    if input_value["schema"] != RISK_COMPOSER_INPUT_SCHEMA_ID:
        _fail(f"risk composer input.schema must be {RISK_COMPOSER_INPUT_SCHEMA_ID}")
    paths = _expect_list(input_value["scenario_paths"], "scenario_paths")
    if not paths or len(paths) > _MAX_SCENARIOS:
        _fail(f"scenario_paths must contain between 1 and {_MAX_SCENARIOS} paths")
    normalized = {
        "schema": RISK_COMPOSER_INPUT_SCHEMA_ID,
        "candidate": _validate_candidate(input_value["candidate"]),
        "source_evidence": _validate_source_evidence(input_value["source_evidence"]),
        "objective": _validate_objective(input_value["objective"]),
        "scenario_paths": [_validate_scenario(item, index) for index, item in enumerate(paths)],
        "input_sha256": _expect_sha256(input_value["input_sha256"], "risk composer input.input_sha256"),
    }
    if len({path["scenario_id"] for path in normalized["scenario_paths"]}) != len(normalized["scenario_paths"]):
        _fail("scenario_paths.scenario_id values must be unique")
    if normalized["input_sha256"] != calculate_risk_composer_input_sha256(normalized):
        _fail("risk composer input.input_sha256 mismatch")
    return normalized


def validate_long_horizon_risk_observation(value: Any) -> dict[str, Any]:
    """Validate a private P3 observation before an owner preference is bound.

    The observation contains only frozen candidate identity, evidence digests,
    a same-window unlevered reference, and paired net-return paths.  It is an
    internal ingress artifact: it is never suitable for a public console or
    AI prompt.  Unlike a composer input it intentionally contains no risk
    preference, because that is a control-plane/owner decision.
    """
    _reject_non_finite_or_null(value, "long-horizon risk observation")
    _reject_forbidden_material(value, "long-horizon risk observation")
    observation = _expect_object(value, "long-horizon risk observation")
    _expect_exact_keys(observation, _OBSERVATION_FIELDS, "long-horizon risk observation")
    if observation["schema"] != RISK_OBSERVATION_SCHEMA_ID:
        _fail(f"long-horizon risk observation.schema must be {RISK_OBSERVATION_SCHEMA_ID}")
    paths = _expect_list(observation["scenario_paths"], "observation.scenario_paths")
    if not paths or len(paths) > _MAX_SCENARIOS:
        _fail(f"observation.scenario_paths must contain between 1 and {_MAX_SCENARIOS} paths")
    normalized = {
        "schema": RISK_OBSERVATION_SCHEMA_ID,
        "candidate": _validate_candidate(observation["candidate"]),
        "source_evidence": _validate_source_evidence(observation["source_evidence"]),
        "benchmark": _validate_benchmark(observation["benchmark"]),
        "scenario_paths": [_validate_scenario(item, index) for index, item in enumerate(paths)],
        "observation_sha256": _expect_sha256(
            observation["observation_sha256"], "long-horizon risk observation.observation_sha256"
        ),
    }
    if len({path["scenario_id"] for path in normalized["scenario_paths"]}) != len(normalized["scenario_paths"]):
        _fail("observation.scenario_paths.scenario_id values must be unique")
    if normalized["observation_sha256"] != calculate_risk_observation_sha256(normalized):
        _fail("long-horizon risk observation.observation_sha256 mismatch")
    return normalized


def build_risk_composer_input_from_observation(
    observation: Any, *, risk_preference: str
) -> dict[str, Any]:
    """Attach one explicit owner preference to a frozen private observation.

    This is deliberately a pure conversion.  It does not refresh P3 data,
    choose a preference, write a policy, or authorize any lifecycle phase.
    """
    normalized = validate_long_horizon_risk_observation(observation)
    objective = _validate_objective(
        {
            "risk_preference": risk_preference,
            **normalized["benchmark"],
        }
    )
    result: dict[str, Any] = {
        "schema": RISK_COMPOSER_INPUT_SCHEMA_ID,
        "candidate": normalized["candidate"],
        "source_evidence": normalized["source_evidence"],
        "objective": objective,
        "scenario_paths": normalized["scenario_paths"],
        "input_sha256": "",
    }
    result["input_sha256"] = calculate_risk_composer_input_sha256(result)
    return validate_risk_composer_input(result)


def _scaled_return_bps(return_bps: int, scale_bps: int) -> int:
    product = return_bps * scale_bps
    return product // 10_000 if product >= 0 else -((-product + 9_999) // 10_000)


def _maximum_drawdown_bps(equity_path: Sequence[Decimal]) -> tuple[int, int]:
    peak = Decimal(1)
    current_underwater = 0
    longest_underwater = 0
    maximum_drawdown = Decimal(0)
    for equity in equity_path:
        if equity >= peak:
            peak = equity
            current_underwater = 0
        else:
            current_underwater += 1
            longest_underwater = max(longest_underwater, current_underwater)
            maximum_drawdown = max(maximum_drawdown, (peak - equity) * Decimal(10_000) / peak)
    return int(maximum_drawdown.to_integral_value(rounding=ROUND_CEILING)), longest_underwater


def _path_metrics(
    strategy_returns_bps: Sequence[int],
    benchmark_returns_bps: Sequence[int],
    scale_bps: int,
) -> dict[str, int]:
    strategy_equity = Decimal(1)
    benchmark_equity = Decimal(1)
    strategy_path: list[Decimal] = []
    relative_path: list[Decimal] = []
    benchmark_path: list[Decimal] = []
    for strategy_return, benchmark_return in zip(strategy_returns_bps, benchmark_returns_bps, strict=True):
        strategy_equity *= Decimal(10_000 + _scaled_return_bps(strategy_return, scale_bps)) / Decimal(10_000)
        benchmark_equity *= Decimal(10_000 + benchmark_return) / Decimal(10_000)
        strategy_path.append(strategy_equity)
        benchmark_path.append(benchmark_equity)
        relative_path.append(strategy_equity / benchmark_equity)
    maximum_drawdown, underwater = _maximum_drawdown_bps(strategy_path)
    relative_drawdown, _ = _maximum_drawdown_bps(relative_path)
    benchmark_drawdown, _ = _maximum_drawdown_bps(benchmark_path)
    log_growth = strategy_equity.ln() * Decimal(1_000_000) / Decimal(len(strategy_returns_bps))
    return {
        "log_growth_ppm": int(log_growth.to_integral_value(rounding=ROUND_FLOOR)),
        "max_drawdown_bps": maximum_drawdown,
        "relative_drawdown_bps": relative_drawdown,
        "benchmark_drawdown_bps": benchmark_drawdown,
        "underwater_sessions": underwater,
    }


def _profile_drawdown_cap_bps(*, benchmark_drawdown_bps: int, benchmark_multiple_bps: int) -> int:
    """Return the profile envelope for one *paired* benchmark path.

    A stress path must never relax the envelope applied to an unrelated
    walk-forward or bootstrap path.  The calculation is therefore deliberately
    per-scenario; callers must not aggregate benchmark drawdowns before they
    call this helper.
    """
    return min(10_000, (benchmark_drawdown_bps * benchmark_multiple_bps + 9_999) // 10_000)


def _family_growth_summary(
    paths: Sequence[Mapping[str, Any]], metrics: Sequence[Mapping[str, int]]
) -> tuple[int, bool]:
    """Summarize growth with equal evidence-family influence.

    A producer may emit more bootstrap paths than historical paths.  Counting
    every path in one global pool would let that implementation detail outweigh
    walk-forward or stress evidence.  We take the lower median inside each
    required family, then the lower median of the three family summaries.

    A family is growth-positive only when at least two thirds of *its* paths
    are positive.  At least two of the three independent evidence families
    must meet that test.  This retains the prior two-thirds policy while making
    the policy invariant to how many valid bootstrap replicas were supplied.
    """
    family_log_growth: dict[str, list[int]] = {kind: [] for kind in _SCENARIO_KINDS}
    for path, metric in zip(paths, metrics, strict=True):
        family_log_growth[path["scenario_kind"]].append(metric["log_growth_ppm"])

    # Coverage is checked before this helper is called, so every list is
    # non-empty.  Keeping the guard makes the pure helper fail closed if reused.
    if any(not values for values in family_log_growth.values()):
        _fail("scenario evidence family coverage is incomplete")

    family_medians = [median_low(values) for values in family_log_growth.values()]
    positive_families = sum(
        sum(value > 0 for value in values) * 3 >= len(values) * 2
        for values in family_log_growth.values()
    )
    return median_low(family_medians), positive_families * 3 >= len(_SCENARIO_KINDS) * 2


def _parked_recommendation(value: Mapping[str, Any], reasons: list[str]) -> dict[str, Any]:
    recommendation: dict[str, Any] = {
        "schema": RISK_COMPOSER_RECOMMENDATION_SCHEMA_ID,
        "candidate": dict(value["candidate"]),
        "source_evidence": dict(value["source_evidence"]),
        "objective": dict(value["objective"]),
        "input_sha256": value["input_sha256"],
        "status": "PARKED",
        "reason_codes": reasons,
        "recommended_scale_bps": None,
        "recommended_max_drawdown_bps": None,
        "frontier": [],
        "recommendation_sha256": "",
    }
    recommendation["recommendation_sha256"] = calculate_risk_composer_recommendation_sha256(recommendation)
    return recommendation


def compose_long_horizon_risk_recommendation(value: Any) -> dict[str, Any]:
    """Calculate a bounded risk frontier and an advisory scale recommendation.

    An incomplete P3 evidence set returns ``PARKED`` rather than extrapolating
    a drawdown limit.  A non-parked result is still advisory: a future policy
    author must freeze it into a new, separately signed candidate policy.
    """
    validated = validate_risk_composer_input(value)
    paths = validated["scenario_paths"]
    kinds = {path["scenario_kind"] for path in paths}
    reasons: list[str] = []
    if kinds != _SCENARIO_KINDS:
        reasons.append("SCENARIO_KIND_COVERAGE_INCOMPLETE")
    if any(path["session_count"] < _MIN_SESSIONS_PER_SCENARIO for path in paths):
        reasons.append("LONG_HORIZON_SESSION_COVERAGE_INCOMPLETE")
    if reasons:
        return _parked_recommendation(validated, reasons)

    preference = validated["objective"]["risk_preference"]
    benchmark_multiple_bps = _RISK_PREFERENCES[preference]
    with localcontext() as context:
        context.prec = 48
        frontier: list[dict[str, Any]] = []
        for scale_bps in _RISK_SCALE_GRID_BPS:
            metrics = [
                _path_metrics(path["strategy_returns_bps"], path["benchmark_returns_bps"], scale_bps)
                for path in paths
            ]
            worst_benchmark_drawdown = max(item["benchmark_drawdown_bps"] for item in metrics)
            profile_drawdown_caps = [
                _profile_drawdown_cap_bps(
                    benchmark_drawdown_bps=item["benchmark_drawdown_bps"],
                    benchmark_multiple_bps=benchmark_multiple_bps,
                )
                for item in metrics
            ]
            positive_growth = sum(item["log_growth_ppm"] > 0 for item in metrics)
            family_median_log_growth, families_meet_growth_requirement = _family_growth_summary(paths, metrics)
            eligible = (
                families_meet_growth_requirement
                and all(
                    item["max_drawdown_bps"] <= profile_drawdown_cap
                    for item, profile_drawdown_cap in zip(metrics, profile_drawdown_caps, strict=True)
                )
            )
            frontier.append(
                {
                    "scale_bps": scale_bps,
                    "median_log_growth_ppm": family_median_log_growth,
                    "positive_growth_scenarios": positive_growth,
                    "scenario_count": len(metrics),
                    "worst_max_drawdown_bps": max(item["max_drawdown_bps"] for item in metrics),
                    "worst_relative_drawdown_bps": max(item["relative_drawdown_bps"] for item in metrics),
                    "worst_benchmark_drawdown_bps": worst_benchmark_drawdown,
                    "worst_underwater_sessions": max(item["underwater_sessions"] for item in metrics),
                    "eligible": eligible,
                }
            )

    eligible_frontier = [item for item in frontier if item["eligible"]]
    if not eligible_frontier:
        return _parked_recommendation(validated, ["NO_SCALE_MEETS_COMPOUNDING_AND_DRAWDOWN_CONSTRAINTS"])
    chosen = max(eligible_frontier, key=lambda item: (item["median_log_growth_ppm"], -item["scale_bps"]))
    recommendation: dict[str, Any] = {
        "schema": RISK_COMPOSER_RECOMMENDATION_SCHEMA_ID,
        "candidate": dict(validated["candidate"]),
        "source_evidence": dict(validated["source_evidence"]),
        "objective": dict(validated["objective"]),
        "input_sha256": validated["input_sha256"],
        "status": "ADVISORY_RECOMMENDATION_READY",
        "reason_codes": [],
        "recommended_scale_bps": chosen["scale_bps"],
        # This is the maximum *observed* drawdown in the selected paired P3
        # paths.  Eligibility has already enforced a separate profile envelope
        # for every path; do not collapse those envelopes into one policy limit.
        "recommended_max_drawdown_bps": chosen["worst_max_drawdown_bps"],
        "frontier": frontier,
        "recommendation_sha256": "",
    }
    recommendation["recommendation_sha256"] = calculate_risk_composer_recommendation_sha256(recommendation)
    return recommendation


def validate_risk_composer_recommendation(value: Any) -> dict[str, Any]:
    """Validate a safe-to-publish recommendation without accepting return paths."""
    # A parked result deliberately uses null for the two absent numeric
    # recommendations.  All nested required artifacts remain non-null.
    _reject_forbidden_material(value, "risk composer recommendation")
    recommendation = _expect_object(value, "risk composer recommendation")
    _expect_exact_keys(recommendation, _RECOMMENDATION_FIELDS, "risk composer recommendation")
    if recommendation["schema"] != RISK_COMPOSER_RECOMMENDATION_SCHEMA_ID:
        _fail(f"risk composer recommendation.schema must be {RISK_COMPOSER_RECOMMENDATION_SCHEMA_ID}")
    candidate = _validate_candidate(recommendation["candidate"])
    evidence = _validate_source_evidence(recommendation["source_evidence"])
    objective = _validate_objective(recommendation["objective"])
    input_sha256 = _expect_sha256(recommendation["input_sha256"], "risk composer recommendation.input_sha256")
    status = recommendation["status"]
    reasons = _expect_list(recommendation["reason_codes"], "risk composer recommendation.reason_codes")
    if not all(isinstance(reason, str) and _IDENTITY_PATTERN.fullmatch(reason.lower()) for reason in reasons):
        _fail("risk composer recommendation.reason_codes must contain stable identifiers")
    frontier = _expect_list(recommendation["frontier"], "risk composer recommendation.frontier")
    if status == "PARKED":
        if (
            not reasons
            or recommendation["recommended_scale_bps"] is not None
            or recommendation["recommended_max_drawdown_bps"] is not None
            or frontier
        ):
            _fail("PARKED recommendation must have reasons and no frontier or numeric recommendation")
    elif status == "ADVISORY_RECOMMENDATION_READY":
        if reasons or len(frontier) != len(_RISK_SCALE_GRID_BPS):
            _fail("ready recommendation must have the complete frontier and no reason codes")
        for index, item in enumerate(frontier):
            row = _expect_object(item, f"frontier[{index}]")
            _expect_exact_keys(row, _FRONTIER_FIELDS, f"frontier[{index}]")
            if row["scale_bps"] != _RISK_SCALE_GRID_BPS[index]:
                _fail("frontier scale grid must be immutable and ordered")
            for field in (
                "positive_growth_scenarios",
                "scenario_count",
                "worst_max_drawdown_bps",
                "worst_relative_drawdown_bps",
                "worst_benchmark_drawdown_bps",
                "worst_underwater_sessions",
            ):
                _expect_nonnegative_integer(row[field], f"frontier[{index}].{field}", maximum=10_000_000)
            if isinstance(row["median_log_growth_ppm"], bool) or not isinstance(row["median_log_growth_ppm"], int):
                _fail(f"frontier[{index}].median_log_growth_ppm must be an integer")
            if not isinstance(row["eligible"], bool):
                _fail(f"frontier[{index}].eligible must be a boolean")
        _expect_positive_integer(recommendation["recommended_scale_bps"], "recommended_scale_bps", maximum=10_000)
        _expect_nonnegative_integer(
            recommendation["recommended_max_drawdown_bps"],
            "recommended_max_drawdown_bps",
            maximum=10_000,
        )
    else:
        _fail("risk composer recommendation.status must be PARKED or ADVISORY_RECOMMENDATION_READY")
    normalized = {
        "schema": RISK_COMPOSER_RECOMMENDATION_SCHEMA_ID,
        "candidate": candidate,
        "source_evidence": evidence,
        "objective": objective,
        "input_sha256": input_sha256,
        "status": status,
        "reason_codes": list(reasons),
        "recommended_scale_bps": recommendation["recommended_scale_bps"],
        "recommended_max_drawdown_bps": recommendation["recommended_max_drawdown_bps"],
        "frontier": [dict(item) for item in frontier],
        "recommendation_sha256": _expect_sha256(
            recommendation["recommendation_sha256"], "risk composer recommendation.recommendation_sha256"
        ),
    }
    if normalized["recommendation_sha256"] != calculate_risk_composer_recommendation_sha256(normalized):
        _fail("risk composer recommendation.recommendation_sha256 mismatch")
    return normalized


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _fail(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def parse_risk_composer_input_json(text: str) -> dict[str, Any]:
    try:
        return json.loads(text, object_pairs_hook=_reject_duplicate_pairs)
    except (TypeError, json.JSONDecodeError) as exc:
        raise LongHorizonRiskComposerError("invalid long-horizon risk composer JSON") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compose a non-executing long-horizon risk recommendation")
    input_source = parser.add_mutually_exclusive_group(required=True)
    input_source.add_argument("--input", type=Path, help="private, owner-bound P3 return-path evidence JSON")
    input_source.add_argument(
        "--observation",
        type=Path,
        help="private P3 observation JSON; requires an explicit --risk-preference",
    )
    parser.add_argument(
        "--risk-preference",
        choices=tuple(sorted(_RISK_PREFERENCES)),
        help="owner-selected preference when converting a private observation",
    )
    parser.add_argument("--output", type=Path, required=True, help="advisory recommendation JSON")
    args = parser.parse_args(argv)
    try:
        if args.input is not None:
            if args.risk_preference is not None:
                _fail("--risk-preference is only valid with --observation")
            composer_input = parse_risk_composer_input_json(args.input.read_text(encoding="utf-8"))
        else:
            if args.risk_preference is None:
                _fail("--observation requires --risk-preference")
            composer_input = build_risk_composer_input_from_observation(
                parse_risk_composer_input_json(args.observation.read_text(encoding="utf-8")),
                risk_preference=args.risk_preference,
            )
        recommendation = compose_long_horizon_risk_recommendation(composer_input)
        validated = validate_risk_composer_recommendation(recommendation)
        args.output.write_text(
            json.dumps(validated, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n",
            encoding="utf-8",
        )
    except (OSError, LongHorizonRiskComposerError) as exc:
        print(f"long-horizon risk composer failed: {exc}", file=sys.stderr)
        return 1
    print(
        "LONG_HORIZON_RISK_COMPOSER "
        f"status={validated['status']} candidate={validated['candidate']['candidate_id']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
