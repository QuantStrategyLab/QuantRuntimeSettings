"""Caller-supplied generation-context provider surface for B3-B and B4 (RESCOPE §7).

Exposes one immutable, pre-validated GenerationContext built solely from a
validated qsl_digest_account_roster.v1 envelope without re-deriving ownership,
reading live sources, or importing any generation consumer module.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from types import MappingProxyType

from digest_roster_validator import (
    CONFLICT,
    ROSTER_FORMAT,
    STALE,
    STATUS_AVAILABLE,
    UNAVAILABLE,
    AuthorityError,
    check_envelope_freshness,
    parse_instant,
    strict_json,
    trusted_clock,
    validate_roster_envelope,
    verify_content_hash,
    within_window,
)


def _freeze_dict(mapping):
    return MappingProxyType(deepcopy(dict(mapping)))


def _unwrap_envelope(source):
    """Extract raw envelope dict/bytes/str from an envelope or producer outcome."""
    if isinstance(source, (bytes, bytearray, str, dict)):
        return source
    if hasattr(source, 'envelope_bytes') and source.envelope_bytes is not None:
        return source.envelope_bytes
    if hasattr(source, 'envelope') and source.envelope is not None:
        return source.envelope
    raise AuthorityError('roster_shape_invalid', UNAVAILABLE)


@dataclass(frozen=True)
class RunScope:
    """Protected §5 rule 1 run scope carried on the generation context."""
    namespace: str
    enrollment_source: str
    config_context: str
    recipient_scope: str
    report_date: str
    original_slot: str
    preview: bool

    @property
    def run_id(self) -> str:
        return f'{self.report_date}/{self.original_slot}'

    @property
    def run_key(self) -> str:
        return f'{self.namespace}::{self.run_id}'

    def as_dict(self) -> dict:
        return {
            'namespace': self.namespace,
            'enrollment_source': self.enrollment_source,
            'config_context': self.config_context,
            'recipient_scope': self.recipient_scope,
            'report_date': self.report_date,
            'original_slot': self.original_slot,
            'preview': self.preview,
        }


@dataclass(frozen=True)
class GenerationWindow:
    """Generation reporting window carried on the generation context (RESCOPE §7e)."""
    business_day: str
    start: str
    end: str
    deadline_at: str

    def as_dict(self) -> dict:
        return {
            'business_day': self.business_day,
            'start': self.start,
            'end': self.end,
            'deadline_at': self.deadline_at,
        }


@dataclass(frozen=True)
class AcquisitionFacts:
    """Authenticated initial + confirming roster acquisition facts (RESCOPE §7c, §8 fact 4).

    `verify_freshness` reproduces the 300 s age / 30 s skew checks on the
    source snapshot timestamps independently of fetch completion times.
    """
    live_source: str
    evidence_scope: str
    initial_read_at: str
    confirming_read_at: str
    initial_snapshot_at: str
    confirming_snapshot_at: str
    source_snapshot_at: str
    confirmation_outcome: str

    @property
    def scope(self) -> str:
        return self.evidence_scope

    def verify_freshness(self, acceptance_clock) -> bool:
        """Reproduce both 300 s / 30 s bounds on source snapshot times at `acceptance_clock`."""
        try:
            clock = trusted_clock(acceptance_clock)
        except AuthorityError:
            return False
        for raw_ts in (self.initial_snapshot_at, self.confirming_snapshot_at, self.source_snapshot_at):
            snap = parse_instant(raw_ts)
            if snap is None or not within_window(snap, clock):
                return False
        return True

    def require_freshness(self, acceptance_clock) -> None:
        clock = trusted_clock(acceptance_clock)
        for raw_ts in (self.initial_snapshot_at, self.confirming_snapshot_at, self.source_snapshot_at):
            snap = parse_instant(raw_ts)
            if snap is None:
                raise AuthorityError('observation_time_invalid', STALE)
            if not within_window(snap, clock):
                raise AuthorityError('observation_stale', STALE)


@dataclass(frozen=True)
class GroupContext:
    """Per-physical-group provider view (RESCOPE §7a, §7b, §7d)."""
    group_id: str
    platform: str
    account_key: str
    deployments: tuple[tuple[str, str], ...]
    scope: str
    management_class: str | None
    management_status: str
    evidence_state: str
    processing_eligible: bool
    processing_denial: str | None
    reasons: tuple[str, ...]
    labels: tuple[tuple[str, str, str], ...]
    applied: tuple[bool, int, str] | None
    legacy_run_bindings: tuple[MappingProxyType, ...]
    observation_bindings: tuple[MappingProxyType, ...]

    @property
    def effective_scope(self) -> str:
        """Paper / live / display-only scope view for downstream consumers."""
        if self.management_class == 'display_only':
            return 'display_only'
        return self.scope

    @property
    def deployment_bindings(self) -> tuple[dict[str, str], ...]:
        return tuple({'platform': plat, 'account_key': key} for plat, key in self.deployments)


@dataclass(frozen=True)
class GenerationContext:
    """Immutable downstream seam exposing RESCOPE §7 (a)-(e) and §8 facts 1-5."""
    format: str
    schema_version: str
    status: str
    run_id: str | None
    run_scope: RunScope | None
    generation_id: str | None
    source_revision: tuple[int, int] | None
    source_snapshot_at: str | None
    generated_at: str | None
    generation_window: GenerationWindow | None
    acquisition: AcquisitionFacts | None
    selection: MappingProxyType | None
    prepared_at: str | None
    enrollment_observed_at: str | None
    physical_grouping_complete: bool
    groups: tuple[GroupContext, ...]
    uncovered_deployments: tuple[MappingProxyType, ...]
    counts: MappingProxyType
    rejected: MappingProxyType
    failure_code: str | None
    failure_kind: str | None
    content_hash: str

    @property
    def authoritative(self) -> bool:
        """Authority rule (RESCOPE §8 fact 1): exact v1 format AND status == 'available'."""
        return self.format == ROSTER_FORMAT and self.status == STATUS_AVAILABLE

    def group_by_id(self, group_id: str) -> GroupContext | None:
        return next((group for group in self.groups if group.group_id == group_id), None)

    def group_for_deployment(self, platform: str, account_key: str) -> GroupContext | None:
        target = (platform, account_key)
        return next((group for group in self.groups if target in group.deployments), None)

    def observation_bindings(self) -> list[dict]:
        """Typed observation links in original Q4 shape across all groups (RESCOPE §7d)."""
        return [deepcopy(dict(binding)) for group in self.groups for binding in group.observation_bindings]

    def run_bindings(self) -> list[dict]:
        """Accepted legacy run bindings across all groups."""
        return [deepcopy(dict(binding)) for group in self.groups for binding in group.legacy_run_bindings]

    def verify_freshness(self, acceptance_clock) -> bool:
        if not self.authoritative or self.acquisition is None:
            return False
        return self.acquisition.verify_freshness(acceptance_clock)

    def require_authoritative(self, acceptance_clock) -> GenerationContext:
        if not self.authoritative or self.acquisition is None:
            raise AuthorityError('roster_not_authoritative', UNAVAILABLE)
        self.acquisition.require_freshness(acceptance_clock)
        return self


def _build_group_context(raw: dict) -> GroupContext:
    applied_raw = raw['applied']
    applied = (
        (applied_raw['management_enabled'], applied_raw['revision'], applied_raw['effective_at'])
        if applied_raw is not None else None
    )
    return GroupContext(
        group_id=raw['group_id'],
        platform=raw['platform'],
        account_key=raw['account_key'],
        deployments=tuple((item['platform'], item['legacy_key']) for item in raw['deployments']),
        scope=raw['scope'],
        management_class=raw['management_class'],
        management_status=raw['management_status'],
        evidence_state=raw['evidence_state'],
        processing_eligible=raw['processing_eligible'],
        processing_denial=raw['processing_denial'],
        reasons=tuple(raw['reasons']),
        labels=tuple((item['platform'], item['legacy_key'], item['label']) for item in raw['labels']),
        applied=applied,
        legacy_run_bindings=tuple(_freeze_dict(item) for item in raw['legacy_run_bindings']),
        observation_bindings=tuple(_freeze_dict(item) for item in raw['observation_bindings']),
    )


def build_generation_context(
    source,
    *,
    clock,
    expected_run_id: str | None = None,
    expected_run_scope: dict | RunScope | None = None,
    expected_selection: dict | None = None,
    allow_non_authoritative: bool = False,
) -> GenerationContext:
    """Validate a qsl_digest_account_roster.v1 envelope and expose RESCOPE §7 context.

    Checks closed schema, content_hash, provenance bindings, and B3-08 source
    snapshot freshness at `clock` without re-deriving ownership.
    """
    payload = _unwrap_envelope(source)
    doc = strict_json(payload) if isinstance(payload, (bytes, bytearray, str)) else payload
    validate_roster_envelope(doc)
    verify_content_hash(doc)

    scope_dict = expected_run_scope.as_dict() if isinstance(expected_run_scope, RunScope) else expected_run_scope
    if expected_run_id is not None and doc['run_id'] != expected_run_id:
        raise AuthorityError('roster_scope_invalid', CONFLICT)
    if scope_dict is not None and doc['run_scope'] != scope_dict:
        raise AuthorityError('roster_scope_invalid', CONFLICT)

    is_authoritative = doc['format'] == ROSTER_FORMAT and doc['status'] == STATUS_AVAILABLE
    if not is_authoritative and not allow_non_authoritative:
        raise AuthorityError('roster_not_authoritative', UNAVAILABLE)

    if is_authoritative:
        if expected_selection is not None and doc['selection'] != expected_selection:
            raise AuthorityError('enrollment_selection_invalid', CONFLICT)
        check_envelope_freshness(doc, clock)
    else:
        trusted_clock(clock)

    run_scope = RunScope(**doc['run_scope']) if doc['run_scope'] is not None else None
    gen_window = GenerationWindow(**doc['generation_window']) if doc['generation_window'] is not None else None
    acq_raw = doc['acquisition']
    acquisition = (
        AcquisitionFacts(
            live_source=acq_raw['live_source'],
            evidence_scope=acq_raw['evidence_scope'],
            initial_read_at=acq_raw['initial_read_at'],
            confirming_read_at=acq_raw['confirming_read_at'],
            initial_snapshot_at=acq_raw['initial_snapshot_at'],
            confirming_snapshot_at=acq_raw['confirming_snapshot_at'],
            source_snapshot_at=doc['source_snapshot_at'],
            confirmation_outcome=acq_raw['confirmation_outcome'],
        )
        if acq_raw is not None else None
    )
    rev_raw = doc['source_revision']
    source_rev = (rev_raw['instance_revision'], rev_raw['policy_revision']) if rev_raw is not None else None
    return GenerationContext(
        format=doc['format'],
        schema_version=doc['schema_version'],
        status=doc['status'],
        run_id=doc['run_id'],
        run_scope=run_scope,
        generation_id=doc['generation_id'],
        source_revision=source_rev,
        source_snapshot_at=doc['source_snapshot_at'],
        generated_at=doc['generated_at'],
        generation_window=gen_window,
        acquisition=acquisition,
        selection=_freeze_dict(doc['selection']) if doc['selection'] is not None else None,
        prepared_at=doc['prepared_at'],
        enrollment_observed_at=doc['enrollment_observed_at'],
        physical_grouping_complete=doc['physical_grouping_complete'],
        groups=tuple(_build_group_context(raw) for raw in doc['accounts']),
        uncovered_deployments=tuple(_freeze_dict(item) for item in doc['uncovered_deployments']),
        counts=_freeze_dict(doc['counts']),
        rejected=_freeze_dict(doc['rejected']),
        failure_code=doc['failure_code'],
        failure_kind=doc['failure_kind'],
        content_hash=doc['content_hash'],
    )


__all__ = [
    'AcquisitionFacts',
    'GenerationContext',
    'GenerationWindow',
    'GroupContext',
    'RunScope',
    'build_generation_context',
]
