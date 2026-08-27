#!/usr/bin/env python3
"""Validate and compose generic, private long-horizon risk observations.

V2 is deliberately parallel to the v1 observation contract.  It separates a
portable owner risk-profile selection from a candidate's risk capability and
benchmark policy.  It has no storage, account, broker, credential, network,
policy-write, scheduler, or execution dependency.

Only the subset whose economics can be evaluated safely by the proven v1
linear return-path engine is composed today.  All other declared capabilities
return a redacted ``PARKED`` recommendation instead of pretending that a
leveraged, cash-flow, portfolio, or nonlinear strategy can be linearly scaled.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any

from long_horizon_risk_composer import (
    RISK_COMPOSER_INPUT_SCHEMA_ID,
    _FRONTIER_FIELDS,
    _IDENTITY_PATTERN,
    _RISK_PREFERENCES,
    _RISK_SCALE_GRID_BPS,
    _canonical_json,
    _expect_exact_keys,
    _expect_identity,
    _expect_list,
    _expect_nonnegative_integer,
    _expect_object,
    _expect_positive_integer,
    _expect_sha256,
    _fail,
    _reject_forbidden_material,
    _reject_non_finite_or_null,
    _validate_candidate,
    _validate_scenario,
    _validate_source_evidence,
    calculate_risk_composer_input_sha256,
    compose_long_horizon_risk_recommendation,
)


RISK_PROFILE_SELECTION_SCHEMA_ID = "qsl.risk_profile_selection.v1"
RISK_OBSERVATION_V2_SCHEMA_ID = "qsl.long_horizon_risk_observation.v2"
RISK_RECOMMENDATION_V2_SCHEMA_ID = "qsl.long_horizon_risk_recommendation.v2"

_PROFILE_SELECTION_FIELDS = {"schema", "profile_id", "risk_preference", "selection_sha256"}
_RISK_CAPABILITY_FIELDS = {
    "portfolio_scope",
    "return_evaluation",
    "cashflow_treatment",
    "risk_factor_coverage",
}
_BENCHMARK_POLICY_FIELDS = {
    "benchmark_id",
    "benchmark_kind",
    "calendar_id",
    "currency",
    "return_basis",
    "definition_sha256",
    "sessions_per_year",
}
_OBSERVATION_V2_FIELDS = {
    "schema",
    "candidate",
    "source_evidence",
    "risk_capability",
    "benchmark_policy",
    "scenario_paths",
    "observation_sha256",
}
_RECOMMENDATION_V2_FIELDS = {
    "schema",
    "candidate",
    "source_evidence",
    "risk_profile",
    "risk_capability",
    "benchmark_policy",
    "observation_sha256",
    "status",
    "reason_codes",
    "recommended_scale_bps",
    "recommended_max_drawdown_bps",
    "frontier",
    "recommendation_sha256",
}
_PROFILE_IDS = {
    "CAPITAL_PRESERVATION": "capital_preservation_v1",
    "BALANCED_COMPOUNDING": "balanced_compounding_v1",
    "GROWTH_COMPOUNDING": "growth_compounding_v1",
}
_PORTFOLIO_SCOPES = {"SINGLE_CANDIDATE", "PORTFOLIO"}
_RETURN_EVALUATIONS = {"LINEAR_NET_RETURN", "REPLAY_REQUIRED"}
_CASHFLOW_TREATMENTS = {"NOT_APPLICABLE", "TIME_WEIGHTED", "CASHFLOW_MATCHED"}
_BENCHMARK_KINDS = {
    "UNLEVERED_REFERENCE",
    "POLICY_BLEND",
    "CASH_EQUIVALENT",
    "ABSOLUTE_RETURN_HURDLE",
}
_RETURN_BASES = {
    "TOTAL_RETURN_NET_OF_COST",
    "TIME_WEIGHTED_TOTAL_RETURN",
    # Some verified research lanes intentionally retain only split-adjusted
    # closes.  They must be representable without being mislabeled as a total
    # return series; the generic v1-compatible composer still parks them.
    "SPLIT_ADJUSTED_PRICE_RETURN",
    "CASHFLOW_MATCHED_RETURN",
}
_RISK_FACTORS = {
    "CONCENTRATION",
    "CORRELATION",
    "FINANCING",
    "GAP",
    "LEVERAGE",
    "LIQUIDITY",
    "MARGIN",
    "OPTIONS_ASSIGNMENT",
    "VOLATILITY",
}


def _calculate_digest(value: Mapping[str, Any], digest_field: str, label: str) -> str:
    return hashlib.sha256(_canonical_json(value, digest_field, label).encode("utf-8")).hexdigest()


def calculate_risk_profile_selection_sha256(value: Mapping[str, Any]) -> str:
    """Return the immutable digest of one owner-selected generic profile."""
    return _calculate_digest(value, "selection_sha256", "risk profile selection")


def calculate_risk_observation_v2_sha256(value: Mapping[str, Any]) -> str:
    """Return the immutable digest of one private v2 P3 observation."""
    return _calculate_digest(value, "observation_sha256", "long-horizon risk observation v2")


def calculate_risk_recommendation_v2_sha256(value: Mapping[str, Any]) -> str:
    """Return the digest of one redacted v2 advisory recommendation."""
    return _calculate_digest(value, "recommendation_sha256", "long-horizon risk recommendation v2")


def validate_risk_profile_selection(value: Any) -> dict[str, str]:
    """Validate a portable named profile, without binding it to an account or policy.

    The control plane attaches this digest to an account or portfolio outside
    this contract.  Keeping account identity out of the artifact prevents a
    risk recommendation from becoming an execution instruction.
    """
    _reject_non_finite_or_null(value, "risk profile selection")
    _reject_forbidden_material(value, "risk profile selection")
    selection = _expect_object(value, "risk profile selection")
    _expect_exact_keys(selection, _PROFILE_SELECTION_FIELDS, "risk profile selection")
    if selection["schema"] != RISK_PROFILE_SELECTION_SCHEMA_ID:
        _fail(f"risk profile selection.schema must be {RISK_PROFILE_SELECTION_SCHEMA_ID}")
    preference = selection["risk_preference"]
    if preference not in _RISK_PREFERENCES:
        _fail("risk profile selection.risk_preference is not supported")
    expected_profile_id = _PROFILE_IDS[preference]
    if selection["profile_id"] != expected_profile_id:
        _fail("risk profile selection.profile_id does not match risk_preference")
    normalized = {
        "schema": RISK_PROFILE_SELECTION_SCHEMA_ID,
        "profile_id": _expect_identity(selection["profile_id"], "risk profile selection.profile_id"),
        "risk_preference": preference,
        "selection_sha256": _expect_sha256(selection["selection_sha256"], "risk profile selection.selection_sha256"),
    }
    if normalized["selection_sha256"] != calculate_risk_profile_selection_sha256(normalized):
        _fail("risk profile selection.selection_sha256 mismatch")
    return normalized


def _validate_risk_factor_coverage(value: Any) -> list[str]:
    factors = _expect_list(value, "risk_capability.risk_factor_coverage")
    if not factors or len(factors) > len(_RISK_FACTORS):
        _fail("risk_capability.risk_factor_coverage must be a non-empty bounded array")
    if not all(isinstance(item, str) and item in _RISK_FACTORS for item in factors):
        _fail("risk_capability.risk_factor_coverage contains an unsupported risk factor")
    if list(factors) != sorted(set(factors)):
        _fail("risk_capability.risk_factor_coverage must be sorted and unique")
    return list(factors)


def _validate_risk_capability(value: Any, *, candidate_kind: str) -> dict[str, Any]:
    capability = _expect_object(value, "risk_capability")
    _expect_exact_keys(capability, _RISK_CAPABILITY_FIELDS, "risk_capability")
    portfolio_scope = capability["portfolio_scope"]
    if portfolio_scope not in _PORTFOLIO_SCOPES:
        _fail("risk_capability.portfolio_scope is not supported")
    if candidate_kind == "combo" and portfolio_scope != "PORTFOLIO":
        _fail("combo candidates must declare PORTFOLIO scope")
    return_evaluation = capability["return_evaluation"]
    if return_evaluation not in _RETURN_EVALUATIONS:
        _fail("risk_capability.return_evaluation is not supported")
    cashflow_treatment = capability["cashflow_treatment"]
    if cashflow_treatment not in _CASHFLOW_TREATMENTS:
        _fail("risk_capability.cashflow_treatment is not supported")
    factors = _validate_risk_factor_coverage(capability["risk_factor_coverage"])
    if portfolio_scope == "PORTFOLIO" and "CORRELATION" not in factors:
        _fail("PORTFOLIO risk capability must cover CORRELATION")
    return {
        "portfolio_scope": portfolio_scope,
        "return_evaluation": return_evaluation,
        "cashflow_treatment": cashflow_treatment,
        "risk_factor_coverage": factors,
    }


def _validate_benchmark_policy(value: Any, *, cashflow_treatment: str) -> dict[str, Any]:
    policy = _expect_object(value, "benchmark_policy")
    _expect_exact_keys(policy, _BENCHMARK_POLICY_FIELDS, "benchmark_policy")
    if policy["benchmark_kind"] not in _BENCHMARK_KINDS:
        _fail("benchmark_policy.benchmark_kind is not supported")
    if (
        not isinstance(policy["calendar_id"], str)
        or not policy["calendar_id"].isupper()
        or not policy["calendar_id"].isalnum()
    ):
        _fail("benchmark_policy.calendar_id must be an uppercase calendar identity")
    if not isinstance(policy["currency"], str) or len(policy["currency"]) != 3 or not policy["currency"].isupper():
        _fail("benchmark_policy.currency must be a three-letter uppercase currency")
    return_basis = policy["return_basis"]
    if return_basis not in _RETURN_BASES:
        _fail("benchmark_policy.return_basis is not supported")
    if cashflow_treatment == "CASHFLOW_MATCHED" and return_basis != "CASHFLOW_MATCHED_RETURN":
        _fail("CASHFLOW_MATCHED capability requires CASHFLOW_MATCHED_RETURN benchmark basis")
    if cashflow_treatment != "CASHFLOW_MATCHED" and return_basis == "CASHFLOW_MATCHED_RETURN":
        _fail("CASHFLOW_MATCHED_RETURN benchmark basis requires CASHFLOW_MATCHED capability")
    return {
        "benchmark_id": _expect_identity(policy["benchmark_id"], "benchmark_policy.benchmark_id"),
        "benchmark_kind": policy["benchmark_kind"],
        "calendar_id": policy["calendar_id"],
        "currency": policy["currency"],
        "return_basis": return_basis,
        "definition_sha256": _expect_sha256(policy["definition_sha256"], "benchmark_policy.definition_sha256"),
        "sessions_per_year": _expect_positive_integer(
            policy["sessions_per_year"], "benchmark_policy.sessions_per_year", maximum=366
        ),
    }


def validate_long_horizon_risk_observation_v2(value: Any) -> dict[str, Any]:
    """Validate a generic private P3 observation without choosing a profile."""
    _reject_non_finite_or_null(value, "long-horizon risk observation v2")
    _reject_forbidden_material(value, "long-horizon risk observation v2")
    observation = _expect_object(value, "long-horizon risk observation v2")
    _expect_exact_keys(observation, _OBSERVATION_V2_FIELDS, "long-horizon risk observation v2")
    if observation["schema"] != RISK_OBSERVATION_V2_SCHEMA_ID:
        _fail(f"long-horizon risk observation v2.schema must be {RISK_OBSERVATION_V2_SCHEMA_ID}")
    candidate = _validate_candidate(observation["candidate"])
    capability = _validate_risk_capability(observation["risk_capability"], candidate_kind=candidate["candidate_kind"])
    paths = _expect_list(observation["scenario_paths"], "observation.scenario_paths")
    if not paths or len(paths) > 12:
        _fail("observation.scenario_paths must contain between 1 and 12 paths")
    normalized = {
        "schema": RISK_OBSERVATION_V2_SCHEMA_ID,
        "candidate": candidate,
        "source_evidence": _validate_source_evidence(observation["source_evidence"]),
        "risk_capability": capability,
        "benchmark_policy": _validate_benchmark_policy(
            observation["benchmark_policy"], cashflow_treatment=capability["cashflow_treatment"]
        ),
        "scenario_paths": [_validate_scenario(item, index) for index, item in enumerate(paths)],
        "observation_sha256": _expect_sha256(
            observation["observation_sha256"], "long-horizon risk observation v2.observation_sha256"
        ),
    }
    if len({path["scenario_id"] for path in normalized["scenario_paths"]}) != len(normalized["scenario_paths"]):
        _fail("observation.scenario_paths.scenario_id values must be unique")
    if normalized["observation_sha256"] != calculate_risk_observation_v2_sha256(normalized):
        _fail("long-horizon risk observation v2.observation_sha256 mismatch")
    return normalized


def _parked_recommendation(
    observation: Mapping[str, Any], profile: Mapping[str, str], reasons: list[str]
) -> dict[str, Any]:
    recommendation: dict[str, Any] = {
        "schema": RISK_RECOMMENDATION_V2_SCHEMA_ID,
        "candidate": dict(observation["candidate"]),
        "source_evidence": dict(observation["source_evidence"]),
        "risk_profile": dict(profile),
        "risk_capability": dict(observation["risk_capability"]),
        "benchmark_policy": dict(observation["benchmark_policy"]),
        "observation_sha256": observation["observation_sha256"],
        "status": "PARKED",
        "reason_codes": reasons,
        "recommended_scale_bps": None,
        "recommended_max_drawdown_bps": None,
        "frontier": [],
        "recommendation_sha256": "",
    }
    recommendation["recommendation_sha256"] = calculate_risk_recommendation_v2_sha256(recommendation)
    return recommendation


def _v1_compatibility_reasons(observation: Mapping[str, Any]) -> list[str]:
    capability = observation["risk_capability"]
    policy = observation["benchmark_policy"]
    reasons: list[str] = []
    if capability["return_evaluation"] != "LINEAR_NET_RETURN":
        reasons.append("RETURN_SCALE_REPLAY_REQUIRED")
    if capability["portfolio_scope"] != "SINGLE_CANDIDATE":
        reasons.append("PORTFOLIO_COMPOSER_REQUIRED")
    if capability["cashflow_treatment"] != "NOT_APPLICABLE":
        reasons.append("CASHFLOW_COMPOSER_REQUIRED")
    if policy["benchmark_kind"] != "UNLEVERED_REFERENCE":
        reasons.append("BENCHMARK_POLICY_COMPOSER_REQUIRED")
    if policy["return_basis"] != "TOTAL_RETURN_NET_OF_COST":
        reasons.append("BENCHMARK_RETURN_BASIS_COMPOSER_REQUIRED")
    return reasons


def compose_long_horizon_risk_recommendation_v2(
    observation: Any, profile_selection: Any
) -> dict[str, Any]:
    """Produce a redacted advisory or a fail-closed v2 parked result.

    This function is intentionally a facade around the v1 algorithm for its
    narrow verified subset.  Unsupported economics are identified by stable
    reason codes; they are never coerced to a linear equity calculation.
    """
    validated_observation = validate_long_horizon_risk_observation_v2(observation)
    validated_profile = validate_risk_profile_selection(profile_selection)
    reasons = _v1_compatibility_reasons(validated_observation)
    if reasons:
        return _parked_recommendation(validated_observation, validated_profile, reasons)

    legacy_input: dict[str, Any] = {
        "schema": RISK_COMPOSER_INPUT_SCHEMA_ID,
        "candidate": validated_observation["candidate"],
        "source_evidence": validated_observation["source_evidence"],
        "objective": {
            "risk_preference": validated_profile["risk_preference"],
            "benchmark_id": validated_observation["benchmark_policy"]["benchmark_id"],
            "benchmark_kind": "unlevered_reference",
            "sessions_per_year": validated_observation["benchmark_policy"]["sessions_per_year"],
        },
        "scenario_paths": validated_observation["scenario_paths"],
        "input_sha256": "",
    }
    legacy_input["input_sha256"] = calculate_risk_composer_input_sha256(legacy_input)
    legacy = compose_long_horizon_risk_recommendation(legacy_input)
    recommendation: dict[str, Any] = {
        "schema": RISK_RECOMMENDATION_V2_SCHEMA_ID,
        "candidate": dict(validated_observation["candidate"]),
        "source_evidence": dict(validated_observation["source_evidence"]),
        "risk_profile": dict(validated_profile),
        "risk_capability": dict(validated_observation["risk_capability"]),
        "benchmark_policy": dict(validated_observation["benchmark_policy"]),
        "observation_sha256": validated_observation["observation_sha256"],
        "status": legacy["status"],
        "reason_codes": list(legacy["reason_codes"]),
        "recommended_scale_bps": legacy["recommended_scale_bps"],
        "recommended_max_drawdown_bps": legacy["recommended_max_drawdown_bps"],
        "frontier": legacy["frontier"],
        "recommendation_sha256": "",
    }
    recommendation["recommendation_sha256"] = calculate_risk_recommendation_v2_sha256(recommendation)
    return validate_risk_recommendation_v2(recommendation)


def _validate_reason_codes(value: Any) -> list[str]:
    reasons = _expect_list(value, "risk recommendation v2.reason_codes")
    if not all(isinstance(reason, str) and _IDENTITY_PATTERN.fullmatch(reason.lower()) for reason in reasons):
        _fail("risk recommendation v2.reason_codes must contain stable identifiers")
    return list(reasons)


def _validate_frontier(value: Any) -> list[dict[str, Any]]:
    frontier = _expect_list(value, "risk recommendation v2.frontier")
    if len(frontier) != len(_RISK_SCALE_GRID_BPS):
        _fail("ready v2 recommendation must have the complete frontier")
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(frontier):
        row = _expect_object(item, f"risk recommendation v2.frontier[{index}]")
        _expect_exact_keys(row, _FRONTIER_FIELDS, f"risk recommendation v2.frontier[{index}]")
        if row["scale_bps"] != _RISK_SCALE_GRID_BPS[index]:
            _fail("v2 frontier scale grid must be immutable and ordered")
        for field in (
            "positive_growth_scenarios",
            "scenario_count",
            "worst_max_drawdown_bps",
            "worst_relative_drawdown_bps",
            "worst_benchmark_drawdown_bps",
            "worst_underwater_sessions",
        ):
            _expect_nonnegative_integer(
                row[field],
                f"risk recommendation v2.frontier[{index}].{field}",
                maximum=10_000_000,
            )
        if isinstance(row["median_log_growth_ppm"], bool) or not isinstance(row["median_log_growth_ppm"], int):
            _fail(f"risk recommendation v2.frontier[{index}].median_log_growth_ppm must be an integer")
        if not isinstance(row["eligible"], bool):
            _fail(f"risk recommendation v2.frontier[{index}].eligible must be a boolean")
        normalized.append(dict(row))
    return normalized


def validate_risk_recommendation_v2(value: Any) -> dict[str, Any]:
    """Validate a safe-to-publish v2 recommendation without return paths."""
    _reject_non_finite_or_null(value, "risk recommendation v2")
    _reject_forbidden_material(value, "risk recommendation v2")
    recommendation = _expect_object(value, "risk recommendation v2")
    _expect_exact_keys(recommendation, _RECOMMENDATION_V2_FIELDS, "risk recommendation v2")
    if recommendation["schema"] != RISK_RECOMMENDATION_V2_SCHEMA_ID:
        _fail(f"risk recommendation v2.schema must be {RISK_RECOMMENDATION_V2_SCHEMA_ID}")
    candidate = _validate_candidate(recommendation["candidate"])
    capability = _validate_risk_capability(
        recommendation["risk_capability"], candidate_kind=candidate["candidate_kind"]
    )
    normalized = {
        "schema": RISK_RECOMMENDATION_V2_SCHEMA_ID,
        "candidate": candidate,
        "source_evidence": _validate_source_evidence(recommendation["source_evidence"]),
        "risk_profile": validate_risk_profile_selection(recommendation["risk_profile"]),
        "risk_capability": capability,
        "benchmark_policy": _validate_benchmark_policy(
            recommendation["benchmark_policy"], cashflow_treatment=capability["cashflow_treatment"]
        ),
        "observation_sha256": _expect_sha256(
            recommendation["observation_sha256"], "risk recommendation v2.observation_sha256"
        ),
        "status": recommendation["status"],
        "reason_codes": _validate_reason_codes(recommendation["reason_codes"]),
        "recommended_scale_bps": recommendation["recommended_scale_bps"],
        "recommended_max_drawdown_bps": recommendation["recommended_max_drawdown_bps"],
        "frontier": [],
        "recommendation_sha256": _expect_sha256(
            recommendation["recommendation_sha256"], "risk recommendation v2.recommendation_sha256"
        ),
    }
    if normalized["status"] == "PARKED":
        if (
            not normalized["reason_codes"]
            or normalized["recommended_scale_bps"] is not None
            or normalized["recommended_max_drawdown_bps"] is not None
            or recommendation["frontier"]
        ):
            _fail("PARKED v2 recommendation must have reasons and no frontier or numeric recommendation")
    elif normalized["status"] == "ADVISORY_RECOMMENDATION_READY":
        if normalized["reason_codes"]:
            _fail("ready v2 recommendation must not have reason codes")
        normalized["frontier"] = _validate_frontier(recommendation["frontier"])
        _expect_positive_integer(normalized["recommended_scale_bps"], "recommended_scale_bps", maximum=10_000)
        _expect_nonnegative_integer(
            normalized["recommended_max_drawdown_bps"], "recommended_max_drawdown_bps", maximum=10_000
        )
    else:
        _fail("risk recommendation v2.status must be PARKED or ADVISORY_RECOMMENDATION_READY")
    if normalized["recommendation_sha256"] != calculate_risk_recommendation_v2_sha256(normalized):
        _fail("risk recommendation v2.recommendation_sha256 mismatch")
    return normalized


__all__ = [
    "RISK_OBSERVATION_V2_SCHEMA_ID",
    "RISK_PROFILE_SELECTION_SCHEMA_ID",
    "RISK_RECOMMENDATION_V2_SCHEMA_ID",
    "calculate_risk_observation_v2_sha256",
    "calculate_risk_profile_selection_sha256",
    "calculate_risk_recommendation_v2_sha256",
    "compose_long_horizon_risk_recommendation_v2",
    "validate_long_horizon_risk_observation_v2",
    "validate_risk_profile_selection",
    "validate_risk_recommendation_v2",
]
