#!/usr/bin/env python3
"""Read one exact private long-horizon P3 observation through an injected port.

This module deliberately has no cloud SDK, credential, network, bucket,
listing, write, delete, broker, account, scheduler, policy-write, or execution
dependency.  A future runtime may inject a narrowly scoped reader with access
to one protected storage namespace.  This core only derives an immutable name,
reads that exact object once, validates the hash-bound observation, and can
produce a non-sensitive Composer recommendation.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from long_horizon_risk_composer import (
    LongHorizonRiskComposerError,
    build_risk_composer_input_from_observation,
    compose_long_horizon_risk_recommendation,
    parse_risk_composer_input_json,
    validate_long_horizon_risk_observation,
)


PRIVATE_OBSERVATION_OBJECT_PREFIX = "long-horizon-risk-observations/v1"
MAX_PRIVATE_OBSERVATION_BYTES = 2 * 1024 * 1024
_IDENTITY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class LongHorizonRiskObservationIngressError(ValueError):
    """Fail-closed ingress error that contains no object name or path data."""


def _fail() -> None:
    raise LongHorizonRiskObservationIngressError("private long-horizon risk observation unavailable")


def private_observation_object_name(*, candidate_id: str, p3_evidence_sha256: str) -> str:
    """Return the only readable object name for one candidate/P3 identity."""
    if not _IDENTITY_PATTERN.fullmatch(candidate_id) or not _SHA256_PATTERN.fullmatch(p3_evidence_sha256):
        _fail()
    return f"{PRIVATE_OBSERVATION_OBJECT_PREFIX}/{candidate_id}/{p3_evidence_sha256}.json"


def load_private_long_horizon_risk_observation(
    *,
    candidate_id: str,
    p3_evidence_sha256: str,
    read_exact: Callable[[str], bytes],
) -> dict[str, Any]:
    """Read and validate one exact observation; unavailable input never falls back.

    ``read_exact`` must be a capability-scoped dependency.  This function calls
    it once with the deterministic object name and has no mechanism to list,
    search, retry with another name, write, overwrite, or delete objects.
    """
    if not callable(read_exact):
        _fail()
    object_name = private_observation_object_name(
        candidate_id=candidate_id,
        p3_evidence_sha256=p3_evidence_sha256,
    )
    try:
        raw = read_exact(object_name)
    except Exception as exc:  # pragma: no cover - injected I/O boundary
        raise LongHorizonRiskObservationIngressError(
            "private long-horizon risk observation unavailable"
        ) from exc
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_PRIVATE_OBSERVATION_BYTES:
        _fail()
    try:
        observation = validate_long_horizon_risk_observation(parse_risk_composer_input_json(raw.decode("utf-8")))
    except (UnicodeDecodeError, LongHorizonRiskComposerError) as exc:
        raise LongHorizonRiskObservationIngressError(
            "private long-horizon risk observation unavailable"
        ) from exc
    if (
        observation["candidate"]["candidate_id"] != candidate_id
        or observation["source_evidence"]["p3_evidence_sha256"] != p3_evidence_sha256
    ):
        _fail()
    return observation


def compose_from_private_long_horizon_risk_observation(
    *,
    candidate_id: str,
    p3_evidence_sha256: str,
    risk_preference: str,
    read_exact: Callable[[str], bytes],
) -> dict[str, Any]:
    """Return only the Composer's safe recommendation from one private object."""
    observation = load_private_long_horizon_risk_observation(
        candidate_id=candidate_id,
        p3_evidence_sha256=p3_evidence_sha256,
        read_exact=read_exact,
    )
    try:
        composer_input = build_risk_composer_input_from_observation(
            observation,
            risk_preference=risk_preference,
        )
        return compose_long_horizon_risk_recommendation(composer_input)
    except LongHorizonRiskComposerError as exc:
        raise LongHorizonRiskObservationIngressError(
            "private long-horizon risk observation unavailable"
        ) from exc


__all__ = [
    "LongHorizonRiskObservationIngressError",
    "MAX_PRIVATE_OBSERVATION_BYTES",
    "PRIVATE_OBSERVATION_OBJECT_PREFIX",
    "compose_from_private_long_horizon_risk_observation",
    "load_private_long_horizon_risk_observation",
    "private_observation_object_name",
]
