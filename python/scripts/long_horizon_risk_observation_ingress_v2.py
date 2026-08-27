#!/usr/bin/env python3
"""Read one exact private v2 P3 observation through an injected read port.

This is the v2 counterpart to the v1 ingress.  It has no cloud SDK,
credential, network, bucket, listing, write, delete, policy, or execution
dependency.  The caller injects one exact-object reader; profile selection is
passed separately by the control plane and cannot be discovered from storage.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from long_horizon_risk_composer import LongHorizonRiskComposerError, parse_risk_composer_input_json
from long_horizon_risk_composer_v2 import (
    compose_long_horizon_risk_recommendation_v2,
    validate_long_horizon_risk_observation_v2,
)


PRIVATE_OBSERVATION_V2_OBJECT_PREFIX = "long-horizon-risk-observations/v2"
MAX_PRIVATE_OBSERVATION_V2_BYTES = 2 * 1024 * 1024
_IDENTITY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class LongHorizonRiskObservationV2IngressError(ValueError):
    """Fail-closed v2 ingress error without path or backend information."""


def _fail() -> None:
    raise LongHorizonRiskObservationV2IngressError("private long-horizon risk observation unavailable")


def private_observation_v2_object_name(*, candidate_id: str, p3_evidence_sha256: str) -> str:
    """Return the only readable v2 object name for one candidate/P3 identity."""
    if not _IDENTITY_PATTERN.fullmatch(candidate_id) or not _SHA256_PATTERN.fullmatch(p3_evidence_sha256):
        _fail()
    return f"{PRIVATE_OBSERVATION_V2_OBJECT_PREFIX}/{candidate_id}/{p3_evidence_sha256}.json"


def load_private_long_horizon_risk_observation_v2(
    *,
    candidate_id: str,
    p3_evidence_sha256: str,
    read_exact: Callable[[str], bytes],
) -> dict[str, Any]:
    """Read and validate one exact v2 object; no fallback object is possible."""
    if not callable(read_exact):
        _fail()
    object_name = private_observation_v2_object_name(
        candidate_id=candidate_id,
        p3_evidence_sha256=p3_evidence_sha256,
    )
    try:
        raw = read_exact(object_name)
    except Exception as exc:  # pragma: no cover - injected I/O boundary
        raise LongHorizonRiskObservationV2IngressError(
            "private long-horizon risk observation unavailable"
        ) from exc
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_PRIVATE_OBSERVATION_V2_BYTES:
        _fail()
    try:
        observation = validate_long_horizon_risk_observation_v2(
            parse_risk_composer_input_json(raw.decode("utf-8"))
        )
    except (UnicodeDecodeError, LongHorizonRiskComposerError) as exc:
        raise LongHorizonRiskObservationV2IngressError(
            "private long-horizon risk observation unavailable"
        ) from exc
    if (
        observation["candidate"]["candidate_id"] != candidate_id
        or observation["source_evidence"]["p3_evidence_sha256"] != p3_evidence_sha256
    ):
        _fail()
    return observation


def compose_from_private_long_horizon_risk_observation_v2(
    *,
    candidate_id: str,
    p3_evidence_sha256: str,
    profile_selection: Any,
    read_exact: Callable[[str], bytes],
) -> dict[str, Any]:
    """Return a v2 redacted advisory or parked result from one exact object."""
    observation = load_private_long_horizon_risk_observation_v2(
        candidate_id=candidate_id,
        p3_evidence_sha256=p3_evidence_sha256,
        read_exact=read_exact,
    )
    try:
        return compose_long_horizon_risk_recommendation_v2(observation, profile_selection)
    except LongHorizonRiskComposerError as exc:
        raise LongHorizonRiskObservationV2IngressError(
            "private long-horizon risk observation unavailable"
        ) from exc


__all__ = [
    "LongHorizonRiskObservationV2IngressError",
    "MAX_PRIVATE_OBSERVATION_V2_BYTES",
    "PRIVATE_OBSERVATION_V2_OBJECT_PREFIX",
    "compose_from_private_long_horizon_risk_observation_v2",
    "load_private_long_horizon_risk_observation_v2",
    "private_observation_v2_object_name",
]
