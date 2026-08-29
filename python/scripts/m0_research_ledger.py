"""Validate and aggregate closed M0 research hypotheses as a read-only ledger.

This module deliberately has no dependency on a selector, runtime target,
platform configuration, scheduler, broker, or control-plane dispatcher.  It
only turns valid ``qsl.m0_research_hypothesis.v1`` source snapshots into a
bounded ledger suitable for a research console or a later *independent*
research-task admission step.
"""

from __future__ import annotations

import copy
import datetime as dt
import json
import re
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any


M0_HYPOTHESIS_SCHEMA = "qsl.m0_research_hypothesis.v1"
M0_SOURCE_SNAPSHOT_SCHEMA = "qsl_m0_research_source_snapshot.v1"
M0_LEDGER_SCHEMA = "qsl_m0_research_ledger.v1"
M0_AUTHORITY = "research_only"
M0_NEXT_STEP = "research_validation_only"

_M0_FIELDS = frozenset(
    {
        "schema_version",
        "artifact_type",
        "authority",
        "no_order",
        "hypothesis_id",
        "as_of",
        "generated_at",
        "expires_at",
        "subject",
        "research_context",
        "evidence",
        "provenance",
        "permitted_next_step",
    }
)
_SUBJECT_FIELDS = frozenset({"kind", "identifier"})
_RESEARCH_CONTEXT_FIELDS = frozenset(
    {"state", "primary_horizon", "suitable_horizons", "source_confidence", "source_style", "theme_ids"}
)
_EVIDENCE_FIELDS = frozenset({"source_entry_digest", "evidence_ref_count", "risk_note_count"})
_PROVENANCE_FIELDS = frozenset(
    {
        "source_project",
        "source_schema_version",
        "source_contract_version",
        "source_report_digest",
        "source_input_digest",
    }
)
_SOURCE_SNAPSHOT_FIELDS = frozenset(
    {
        "schema_version",
        "source_id",
        "source_report_digest",
        "generated_at",
        "computed_at",
        "data_status",
        "hypotheses",
        "errors",
    }
)
_ALLOWED_SUBJECT_KINDS = frozenset({"asset_idea", "theme_context", "strategy_hypothesis", "risk_context"})
_ALLOWED_RESEARCH_STATES = frozenset({"candidate", "source_verification_required", "deferred", "context_only"})
_ALLOWED_HORIZONS = frozenset({"short", "medium", "long", "not_applicable"})
_ALLOWED_SOURCE_CONFIDENCE = frozenset({"high", "medium", "low", "mixed", "no_event", "unknown"})
_ALLOWED_SOURCE_STYLES = frozenset(
    {"event_driven", "long_horizon_growth", "value_quality", "macro_context", "mixed_research"}
)
_SOURCE_STATUSES = frozenset({"ready", "unavailable", "stale"})
# Keep this byte-for-byte compatible with QuantAdvisorResearch's M0 contract.
# In particular, ``=`` is not a valid subject, theme, source, or hypothesis
# identifier there and must not be accepted by this downstream mirror.
_IDENTIFIER = re.compile(r"^[A-Za-z0-9._:/-]{1,128}$")
_ERROR_CODE = re.compile(r"^[a-z][a-z0-9_.-]{0,63}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_UTC_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$")
_FORBIDDEN_FIELD_FRAGMENTS = (
    "account",
    "allocation",
    "broker",
    "canary",
    "credential",
    "execution",
    "live",
    "order",
    "paper",
    "platform",
    "portfolio",
    "position",
    "quantity",
    "route",
    "runtime",
    "secret",
    "share",
    "switch",
    "target",
    "token",
    "trade",
    "weight",
)


class M0ResearchLedgerValidationError(ValueError):
    """Raised when an M0 source snapshot is malformed or out of scope."""


def _exact_mapping(value: object, fields: frozenset[str], label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != fields:
        raise M0ResearchLedgerValidationError(f"{label}_keys_invalid")
    return dict(value)


def _require_identifier(value: object, label: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise M0ResearchLedgerValidationError(f"{label}_invalid")
    return value


def _require_sha256(value: object, label: str, *, nullable: bool = False) -> str | None:
    if nullable and value is None:
        return None
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise M0ResearchLedgerValidationError(f"{label}_invalid")
    return value


def _parse_timestamp(value: object, label: str, *, nullable: bool = False) -> dt.datetime | None:
    if nullable and value is None:
        return None
    if not isinstance(value, str) or not _UTC_TIMESTAMP.fullmatch(value):
        raise M0ResearchLedgerValidationError(f"{label}_invalid")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise M0ResearchLedgerValidationError(f"{label}_invalid") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != dt.timedelta(0):
        raise M0ResearchLedgerValidationError(f"{label}_invalid")
    return parsed


def _utc_timestamp(value: dt.datetime) -> str:
    normalized = value.astimezone(dt.UTC)
    return normalized.isoformat().replace("+00:00", "Z")


def _reject_forbidden_semantic_fields(value: object, *, is_hypothesis_root: bool = True) -> None:
    """Reject escape hatches even when a future nested object is added."""

    if isinstance(value, Mapping):
        for key, nested in value.items():
            if not isinstance(key, str):
                raise M0ResearchLedgerValidationError("field_name_invalid")
            normalized = "".join(character for character in key.casefold() if character.isalnum())
            is_explicit_no_order = is_hypothesis_root and key == "no_order"
            if not is_explicit_no_order and any(fragment in normalized for fragment in _FORBIDDEN_FIELD_FRAGMENTS):
                raise M0ResearchLedgerValidationError("forbidden_semantic_field")
            _reject_forbidden_semantic_fields(nested, is_hypothesis_root=False)
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        for nested in value:
            _reject_forbidden_semantic_fields(nested, is_hypothesis_root=False)


def _canonical_json(value: object) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise M0ResearchLedgerValidationError("m0_record_not_canonicalizable") from exc


def validate_m0_research_hypothesis(payload: object) -> dict[str, Any]:
    """Validate the QAR-owned M0 contract without importing its application code."""

    hypothesis = _exact_mapping(payload, _M0_FIELDS, "hypothesis")
    _reject_forbidden_semantic_fields(hypothesis)
    if hypothesis["schema_version"] != M0_HYPOTHESIS_SCHEMA:
        raise M0ResearchLedgerValidationError("schema_version_invalid")
    if hypothesis["artifact_type"] != "research_hypothesis":
        raise M0ResearchLedgerValidationError("artifact_type_invalid")
    if hypothesis["authority"] != M0_AUTHORITY:
        raise M0ResearchLedgerValidationError("authority_invalid")
    if hypothesis["no_order"] is not True:
        raise M0ResearchLedgerValidationError("no_order_invalid")
    if hypothesis["permitted_next_step"] != M0_NEXT_STEP:
        raise M0ResearchLedgerValidationError("permitted_next_step_invalid")
    _require_identifier(hypothesis["hypothesis_id"], "hypothesis_id")

    if not isinstance(hypothesis["as_of"], str):
        raise M0ResearchLedgerValidationError("as_of_invalid")
    try:
        as_of = dt.date.fromisoformat(hypothesis["as_of"])
    except ValueError as exc:
        raise M0ResearchLedgerValidationError("as_of_invalid") from exc
    generated_at = _parse_timestamp(hypothesis["generated_at"], "generated_at")
    expires_at = _parse_timestamp(hypothesis["expires_at"], "expires_at")
    assert generated_at is not None and expires_at is not None
    if expires_at != generated_at + dt.timedelta(days=7) or as_of > generated_at.date():
        raise M0ResearchLedgerValidationError("hypothesis_time_invalid")

    subject = _exact_mapping(hypothesis["subject"], _SUBJECT_FIELDS, "subject")
    if subject["kind"] not in _ALLOWED_SUBJECT_KINDS:
        raise M0ResearchLedgerValidationError("subject_kind_invalid")
    _require_identifier(subject["identifier"], "subject_identifier")

    context = _exact_mapping(hypothesis["research_context"], _RESEARCH_CONTEXT_FIELDS, "research_context")
    if context["state"] not in _ALLOWED_RESEARCH_STATES:
        raise M0ResearchLedgerValidationError("research_state_invalid")
    if context["primary_horizon"] not in _ALLOWED_HORIZONS:
        raise M0ResearchLedgerValidationError("primary_horizon_invalid")
    suitable_horizons = context["suitable_horizons"]
    if (
        not isinstance(suitable_horizons, list)
        or not suitable_horizons
        or len(suitable_horizons) > len(_ALLOWED_HORIZONS)
        or len(set(suitable_horizons)) != len(suitable_horizons)
        or context["primary_horizon"] not in suitable_horizons
        or any(horizon not in _ALLOWED_HORIZONS for horizon in suitable_horizons)
    ):
        raise M0ResearchLedgerValidationError("suitable_horizons_invalid")
    if context["source_confidence"] not in _ALLOWED_SOURCE_CONFIDENCE:
        raise M0ResearchLedgerValidationError("source_confidence_invalid")
    if context["source_style"] not in _ALLOWED_SOURCE_STYLES:
        raise M0ResearchLedgerValidationError("source_style_invalid")
    theme_ids = context["theme_ids"]
    if not isinstance(theme_ids, list) or len(theme_ids) > 24 or len(set(theme_ids)) != len(theme_ids):
        raise M0ResearchLedgerValidationError("theme_ids_invalid")
    for theme_id in theme_ids:
        _require_identifier(theme_id, "theme_id")

    evidence = _exact_mapping(hypothesis["evidence"], _EVIDENCE_FIELDS, "evidence")
    _require_sha256(evidence["source_entry_digest"], "source_entry_digest")
    for key in ("evidence_ref_count", "risk_note_count"):
        if isinstance(evidence[key], bool) or not isinstance(evidence[key], int) or evidence[key] < 0:
            raise M0ResearchLedgerValidationError(f"{key}_invalid")

    provenance = _exact_mapping(hypothesis["provenance"], _PROVENANCE_FIELDS, "provenance")
    if provenance["source_project"] != "QuantAdvisorResearch":
        raise M0ResearchLedgerValidationError("source_project_invalid")
    if provenance["source_schema_version"] not in {"5", "6"}:
        raise M0ResearchLedgerValidationError("source_schema_version_invalid")
    expected_contract = f"model_recommendations.v{provenance['source_schema_version']}"
    if provenance["source_contract_version"] != expected_contract:
        raise M0ResearchLedgerValidationError("source_contract_version_invalid")
    _require_sha256(provenance["source_report_digest"], "source_report_digest")
    source_input_digest = _require_sha256(
        provenance["source_input_digest"],
        "source_input_digest",
        nullable=provenance["source_schema_version"] == "5",
    )
    if provenance["source_schema_version"] == "5" and source_input_digest is not None:
        raise M0ResearchLedgerValidationError("source_input_digest_invalid")
    return copy.deepcopy(hypothesis)


def validate_m0_research_source_snapshot(payload: object) -> dict[str, Any]:
    """Validate a single closed, read-only M0 source snapshot."""

    snapshot = _exact_mapping(payload, _SOURCE_SNAPSHOT_FIELDS, "source_snapshot")
    if snapshot["schema_version"] != M0_SOURCE_SNAPSHOT_SCHEMA:
        raise M0ResearchLedgerValidationError("source_snapshot_schema_invalid")
    _require_identifier(snapshot["source_id"], "source_id")
    if snapshot["data_status"] not in _SOURCE_STATUSES:
        raise M0ResearchLedgerValidationError("source_data_status_invalid")
    generated_at = _parse_timestamp(snapshot["generated_at"], "source_generated_at", nullable=True)
    computed_at = _parse_timestamp(snapshot["computed_at"], "source_computed_at", nullable=True)
    if generated_at is not None and computed_at is not None and computed_at < generated_at:
        raise M0ResearchLedgerValidationError("source_time_invalid")
    source_report_digest = _require_sha256(
        snapshot["source_report_digest"], "source_report_digest", nullable=True
    )
    hypotheses = snapshot["hypotheses"]
    if not isinstance(hypotheses, list) or len(hypotheses) > 500:
        raise M0ResearchLedgerValidationError("source_hypotheses_invalid")
    errors = snapshot["errors"]
    if not isinstance(errors, list) or len(errors) > 20 or any(
        not isinstance(error, str) or not _ERROR_CODE.fullmatch(error) for error in errors
    ):
        raise M0ResearchLedgerValidationError("source_errors_invalid")

    if snapshot["data_status"] == "ready" and (
        source_report_digest is None or generated_at is None or computed_at is None
    ):
        raise M0ResearchLedgerValidationError("ready_source_metadata_invalid")
    if snapshot["data_status"] == "ready" and errors:
        raise M0ResearchLedgerValidationError("ready_source_errors_invalid")
    if snapshot["data_status"] == "unavailable" and hypotheses:
        raise M0ResearchLedgerValidationError("unavailable_source_hypotheses_invalid")
    if hypotheses and source_report_digest is None:
        raise M0ResearchLedgerValidationError("source_report_digest_invalid")

    validated_hypotheses: list[dict[str, Any]] = []
    for hypothesis in hypotheses:
        validated = validate_m0_research_hypothesis(hypothesis)
        if validated["provenance"]["source_report_digest"] != source_report_digest:
            raise M0ResearchLedgerValidationError("source_report_digest_mismatch")
        if computed_at is not None:
            hypothesis_generated_at = _parse_timestamp(validated["generated_at"], "generated_at")
            assert hypothesis_generated_at is not None
            if hypothesis_generated_at > computed_at:
                raise M0ResearchLedgerValidationError("source_hypothesis_time_invalid")
        validated_hypotheses.append(validated)
    snapshot["hypotheses"] = validated_hypotheses
    return copy.deepcopy(snapshot)


def _freshness(hypothesis: Mapping[str, Any], source_status: str, now: dt.datetime) -> dict[str, Any]:
    generated_at = _parse_timestamp(hypothesis["generated_at"], "generated_at")
    expires_at = _parse_timestamp(hypothesis["expires_at"], "expires_at")
    assert generated_at is not None and expires_at is not None
    age_seconds = max(0, int((now - generated_at).total_seconds()))
    if generated_at > now:
        return {"status": "unknown", "age_seconds": None}
    if source_status != "ready" or now >= expires_at:
        return {"status": "stale", "age_seconds": age_seconds}
    return {"status": "fresh", "age_seconds": age_seconds}


def _source_error(error_set: set[str], code: str) -> None:
    if len(error_set) < 20:
        error_set.add(code)


def _snapshot_time_is_future(snapshot: Mapping[str, Any], now: dt.datetime) -> bool:
    """Return whether source metadata could have been produced after this ledger.

    A future source clock is not merely displayed as an ``unknown`` freshness
    state.  The entire source is omitted so a clock-skewed or replayed source
    cannot become a current research input by accident.
    """

    for field, label in (("generated_at", "source_generated_at"), ("computed_at", "source_computed_at")):
        value = _parse_timestamp(snapshot[field], label, nullable=True)
        if value is not None and value > now:
            return True
    return False


def _horizon_views(observations: Sequence[Mapping[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Separate present disagreement from non-actionable historical drift."""

    fresh_horizons = sorted(
        {
            observation["research_context"]["primary_horizon"]
            for observation in observations
            if observation["freshness"]["status"] == "fresh"
        }
    )
    stale_horizons = sorted(
        {
            observation["research_context"]["primary_horizon"]
            for observation in observations
            if observation["freshness"]["status"] == "stale"
        }
    )
    current = {
        "status": "conflict" if len(fresh_horizons) > 1 else "none",
        "primary_horizons": fresh_horizons,
    }
    if fresh_horizons:
        stale_status = "drift" if stale_horizons and stale_horizons != fresh_horizons else "none"
    else:
        # A stale-only subject has no current primary horizon against which to
        # call a drift.  It remains visible for audit, but is not an alert.
        stale_status = "unavailable" if stale_horizons else "none"
    historical_stale = {"status": stale_status, "primary_horizons": stale_horizons}
    return current, historical_stale


def aggregate_m0_research_sources(
    snapshots: Sequence[object], *, now: str | dt.datetime
) -> dict[str, Any]:
    """Build a deterministic, no-order ledger from independent source snapshots.

    Exact duplicates are collapsed by ``(subject.kind, subject.identifier,
    source_report_digest)``.  Differing payloads under that same identity are
    treated as a source collision and omitted fail-closed.  Different source
    reports for one subject remain visible and produce a horizon-conflict flag
    when their primary horizons disagree.
    """

    if not isinstance(snapshots, Sequence) or isinstance(snapshots, (str, bytes)) or len(snapshots) > 100:
        raise M0ResearchLedgerValidationError("source_snapshots_invalid")
    if isinstance(now, dt.datetime) and (now.tzinfo is None or now.utcoffset() is None):
        raise M0ResearchLedgerValidationError("ledger_now_invalid")
    now_at = _parse_timestamp(
        _utc_timestamp(now) if isinstance(now, dt.datetime) else now,
        "ledger_now",
    )
    assert now_at is not None

    error_set: set[str] = set()
    observations_by_key: dict[tuple[str, str, str], list[tuple[str, dict[str, Any], str]]] = defaultdict(list)
    for raw_snapshot in snapshots:
        try:
            snapshot = validate_m0_research_source_snapshot(raw_snapshot)
        except M0ResearchLedgerValidationError:
            _source_error(error_set, "m0_source_invalid")
            continue
        if _snapshot_time_is_future(snapshot, now_at):
            _source_error(error_set, "m0_source_future_timestamp")
            continue
        if snapshot["data_status"] == "unavailable":
            _source_error(error_set, "m0_source_unavailable")
            continue
        for hypothesis in snapshot["hypotheses"]:
            subject = hypothesis["subject"]
            key = (subject["kind"], subject["identifier"], hypothesis["provenance"]["source_report_digest"])
            observations_by_key[key].append((snapshot["source_id"], hypothesis, snapshot["data_status"]))

    subject_entries: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for (subject_kind, subject_identifier, source_report_digest), candidates in observations_by_key.items():
        canonical_payloads = {_canonical_json(candidate[1]) for candidate in candidates}
        if len(canonical_payloads) != 1:
            _source_error(error_set, "m0_source_subject_collision")
            continue
        source_ids = sorted({candidate[0] for candidate in candidates})
        source_statuses = {candidate[2] for candidate in candidates}
        hypothesis = copy.deepcopy(candidates[0][1])
        source_status = "ready" if source_statuses == {"ready"} else "stale"
        fresh = _freshness(hypothesis, source_status, now_at)
        observation = {
            "source_ids": source_ids,
            "source_report_digest": source_report_digest,
            "source_entry_digest": hypothesis["evidence"]["source_entry_digest"],
            "hypothesis_id": hypothesis["hypothesis_id"],
            "as_of": hypothesis["as_of"],
            "generated_at": hypothesis["generated_at"],
            "expires_at": hypothesis["expires_at"],
            "research_context": copy.deepcopy(hypothesis["research_context"]),
            "freshness": fresh,
        }
        subject_entries[(subject_kind, subject_identifier)].append(observation)

    subjects: list[dict[str, Any]] = []
    fresh_count = 0
    stale_count = 0
    unknown_count = 0
    current_conflict_count = 0
    historical_stale_drift_count = 0
    for (kind, identifier), observations in sorted(subject_entries.items()):
        observations.sort(key=lambda entry: (entry["source_report_digest"], entry["source_entry_digest"]))
        horizon_conflict, historical_stale_horizon_drift = _horizon_views(observations)
        if horizon_conflict["status"] == "conflict":
            current_conflict_count += 1
        if historical_stale_horizon_drift["status"] == "drift":
            historical_stale_drift_count += 1
        for observation in observations:
            status = observation["freshness"]["status"]
            if status == "fresh":
                fresh_count += 1
            elif status == "stale":
                stale_count += 1
            else:
                unknown_count += 1
        subjects.append(
            {
                "subject": {"kind": kind, "identifier": identifier},
                "observations": observations,
                "horizon_conflict": horizon_conflict,
                "historical_stale_horizon_drift": historical_stale_horizon_drift,
            }
        )

    observation_count = fresh_count + stale_count + unknown_count
    data_status = "ready" if fresh_count else "stale" if observation_count else "unavailable"
    ledger = {
        "schema_version": M0_LEDGER_SCHEMA,
        "generated_at": _utc_timestamp(now_at),
        "computed_at": _utc_timestamp(now_at),
        "data_status": data_status,
        "summary": {
            "subject_count": len(subjects),
            "observation_count": observation_count,
            "fresh_observation_count": fresh_count,
            "stale_observation_count": stale_count,
            "unknown_observation_count": unknown_count,
            "horizon_conflict_count": current_conflict_count,
            "historical_stale_horizon_drift_count": historical_stale_drift_count,
        },
        "subjects": subjects,
        "policy": {
            "authority": M0_AUTHORITY,
            "no_order": True,
            "permitted_next_step": M0_NEXT_STEP,
            "notice": "Read-only M0 research ledger; it cannot select, route, or execute a strategy.",
        },
        "errors": sorted(error_set),
    }
    return ledger


__all__ = [
    "M0_AUTHORITY",
    "M0_HYPOTHESIS_SCHEMA",
    "M0_LEDGER_SCHEMA",
    "M0_NEXT_STEP",
    "M0_SOURCE_SNAPSHOT_SCHEMA",
    "M0ResearchLedgerValidationError",
    "aggregate_m0_research_sources",
    "validate_m0_research_hypothesis",
    "validate_m0_research_source_snapshot",
]
