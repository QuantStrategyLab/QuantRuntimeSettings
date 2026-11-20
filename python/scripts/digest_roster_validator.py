"""Canonical independent validation module for D2 B3 digest account rosters (FLAG-4).

Served to both preparer and generation closures through the B9 package manifest;
never imports cloud_run_daily_digest, project_digest_display_roster, or any
generation-only consumer module.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import struct
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from display_names import safe_display_text

ROSTER_FORMAT = 'qsl_digest_account_roster.v1'
SELECTION_FORMAT = 'qsl_digest_enrollment_selection.v1'
ARTIFACT_FORMAT = 'qsl_digest_enrollment_artifact.v1'
READBACK_FORMAT = 'qsl_account_management_readback.v1'
EFFECTIVE_EXPORT_FORMAT = 'qsl_account_management_effective_export.v1'
PROJECTION_FORMAT = 'qsl_account_management_projection.v1'

EVIDENCE_SCOPE = 'runtime_instances_sqlite'
MANAGEMENT_ROUTE = '/api/admin/account-management'
LEGACY_MODE, MAPPING_MODE = 'legacy', 'mapping_v1'
STATUS_AVAILABLE, STATUS_FALLBACK, STATUS_UNAVAILABLE = 'available', 'fallback', 'unavailable'
ROSTER_STATUSES = frozenset({STATUS_AVAILABLE, STATUS_FALLBACK, STATUS_UNAVAILABLE})

MAX_OBSERVATION_AGE = timedelta(seconds=300)
MAX_FUTURE_SKEW = timedelta(seconds=30)
MAX_RESPONSE_BYTES = 1 << 20
MAX_READ_TIMEOUT = 20.0

BINDING_FIELDS = ('platform_id', 'candidate_slot', 'opaque_account_uid', 'target_id')
CONFIG_IDENTITY_FIELDS = ('account_selector', 'deployment_selector', 'service_name', 'runtime_status_target_id')
RUN_BINDING_FIELDS = (*BINDING_FIELDS, 'strategy_profile')
OBSERVATION_BINDING_FIELDS = (
    'binding_id', 'platform', 'legacy_key', 'opaque_account_uid', 'broker_environment', 'account_scope',
)
PRIVATE_LOCATOR_FIELDS = (
    'opaque_account_uid', 'target_id', 'candidate_slot', 'account_hint', 'binding_id',
    *CONFIG_IDENTITY_FIELDS,
)
EFFECTIVE_FIELDS = ('platform', 'legacy_key', 'management_enabled', 'revision', 'effective_at')
RUNTIME_TARGET_FIELDS = ('platform_id', 'opaque_account_uid', 'target_id', 'strategy_profile')

MANAGEMENT_CLASSES = frozenset({'eligible', 'display_only'})
MANAGEMENT_STATUSES = ('managed', 'management_disabled', 'not_under_management', 'unknown')
EVIDENCE_STATES = frozenset({'known', 'unknown', 'conflict', 'stale'})
SCOPES = frozenset({'paper', 'live', 'unknown'})

GROUP_REASON_CODES = frozenset({
    'claimant_shadowing', 'declared_environment_differs_from_current', 'deployment_claimed_by_multiple_accounts',
    'deployment_unclassified', 'effective_state_differs_across_deployments', 'effective_state_duplicated',
    'effective_state_missing', 'effective_state_shape_rejected', 'history_identity_differs_from_current',
    'legacy_key_cross_platform_collision', 'local_history_unreadable', 'local_store_unreadable',
    'management_binding_changed', 'management_binding_invalidated', 'management_enabled_for_ineligible_class',
    'management_identity_differs_from_current', 'management_journal_unreadable', 'management_policy_invalid',
    'management_policy_unavailable', 'management_record_unreadable', 'management_schema_unverified',
    'physical_identity_changed', 'runtime_instances_not_initialized', 'sibling_duplicated', 'sibling_not_current',
    'sibling_retiring', 'stored_identity_differs_from_current', 'stored_identity_unreadable',
    'top_config_key_mismatch',
})
POLICY_DENIALS = ('management_policy_unavailable', 'management_policy_invalid')
DENIAL_CODES = frozenset({
    *POLICY_DENIALS, 'management_disabled', 'management_not_under_management', 'management_status_unknown',
})
UNCOVERED_REASON_CODES = frozenset({*GROUP_REASON_CODES, 'deployment_uncovered'})

RUN_BINDING_OPTIONS = {
    'snapshot_only': lambda value: value is True,
    'receipt_candidate': lambda value: value is True,
    'expected_runs': lambda value: type(value) is int and value > 0,
}

UNAVAILABLE, STALE, CONFLICT = 'unavailable', 'stale', 'conflict'
FAILURE_KINDS = frozenset({STALE, CONFLICT, UNAVAILABLE})

CODE = re.compile(r'[a-z0-9][a-z0-9_]{0,63}')
INSTANT = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z')
VERSION = re.compile(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}')
SHA256 = re.compile(r'[0-9a-f]{64}')
GROUP_ID = re.compile(r'grp_v1_[0-9a-f]{64}')
ORIGIN = re.compile(r'https://[A-Za-z0-9.-]{1,253}(?::[0-9]{1,5})?')

SCHEMA_FILES = (
    'qsl-digest-account-roster.v1.schema.json',
    'qsl-digest-enrollment-selection.v1.schema.json',
    'qsl-digest-enrollment-artifact.v1.schema.json',
)

READBACK_KEYS = frozenset({
    'ok', 'format', 'evidence_scope', 'status', 'reasons', 'observed_at', 'instance_revision', 'policy_revision',
    'policy_status', 'physical_grouping_complete', 'counts', 'groups', 'uncovered_deployments', 'effective_export',
})
READBACK_GROUP_KEYS = frozenset({
    'management_class', 'management_status', 'evidence_state', 'reasons', 'scope',
    'processing_eligible', 'processing_denial', 'applied', 'deployments',
})
COUNT_KEYS = frozenset({
    'physical_accounts', 'display_groups', 'display_deployments', 'uncovered_deployments', *MANAGEMENT_STATUSES,
})
READBACK_COUNT_KEYS = frozenset({
    'physical_accounts', 'display_deployments', 'uncovered_deployments', *MANAGEMENT_STATUSES,
})
UNCOVERED_KEYS = frozenset({
    'platform', 'key', 'management_status', 'evidence_state', 'reasons',
    'processing_eligible', 'processing_denial',
})
SELECTION_KEYS = frozenset({
    'source', 'version', 'artifact_sha256', 'membership_version', 'label_version', 'link_version',
})
ARTIFACT_KEYS = frozenset({
    'format', 'source', 'version', 'membership_version', 'label_version', 'link_version',
    'prepared_at', 'enrollment_observed_at', 'instance_revision', 'policy_revision', 'groups', 'rejected',
})
ARTIFACT_GROUP_KEYS = frozenset({'deployments', 'labels', 'legacy_run_bindings', 'observation_bindings'})

ROSTER_KEYS = frozenset({
    'format', 'schema_version', 'status', 'run_id', 'run_scope', 'generation_id',
    'source_revision', 'source_snapshot_at', 'generated_at', 'generation_window', 'observation_age_seconds',
    'live_source', 'evidence_scope', 'acquisition', 'selection', 'prepared_at', 'enrollment_observed_at',
    'physical_grouping_complete', 'failure_code', 'failure_kind', 'account_count', 'counts',
    'accounts', 'uncovered_deployments', 'rejected', 'content_hash',
})
ROSTER_GROUP_KEYS = frozenset({
    'group_id', 'platform', 'account_key', 'deployments', 'labels', 'scope', 'management_class',
    'management_status', 'evidence_state', 'processing_eligible', 'processing_denial', 'reasons',
    'applied', 'legacy_run_bindings', 'observation_bindings',
})
RUN_SCOPE_KEYS = frozenset({
    'namespace', 'enrollment_source', 'config_context', 'recipient_scope',
    'report_date', 'original_slot', 'preview',
})
SOURCE_REVISION_KEYS = frozenset({'instance_revision', 'policy_revision'})
GENERATION_WINDOW_KEYS = frozenset({'business_day', 'start', 'end', 'deadline_at'})
ACQUISITION_KEYS = frozenset({
    'live_source', 'evidence_scope', 'initial_read_at', 'confirming_read_at',
    'initial_snapshot_at', 'confirming_snapshot_at', 'confirmation_outcome',
})


class AuthorityError(ValueError):
    """A bounded, safe failure code; never carries an identity or a payload."""

    def __init__(self, code, kind=UNAVAILABLE):
        if not isinstance(code, str) or not CODE.fullmatch(code) or kind not in {UNAVAILABLE, STALE, CONFLICT}:
            raise ValueError('authority_error_invalid')
        super().__init__(code)
        self.code, self.kind = code, kind


def _fail(code, kind=UNAVAILABLE):
    raise AuthorityError(code, kind)


def is_strict_revision(value):
    """Non-boolean non-negative integer check (D3-P2: booleans never pass)."""
    return type(value) is int and value >= 0


def is_identifier(value):
    """Opaque identifiers preserve case and inner/outer whitespace."""
    return isinstance(value, str) and bool(value) and value.isprintable() and len(value) <= 200


def is_codes(value, vocabulary=None):
    return isinstance(value, list) and all(
        isinstance(item, str) and CODE.fullmatch(item) and (vocabulary is None or item in vocabulary)
        for item in value
    )


def is_member(value, allowed):
    return isinstance(value, str) and value in allowed


def exact_keys(value, keys, code='roster_shape_invalid'):
    if not isinstance(value, dict) or frozenset(value) != keys:
        _fail(code)


def parse_instant(value):
    """Strict UTC instant (`...Z`), or None. No offsets, no rounding."""
    if not isinstance(value, str) or not INSTANT.fullmatch(value):
        return None
    try:
        return datetime.fromisoformat(value[:-1] + '+00:00')
    except ValueError:
        return None


def format_utc(value):
    utc = value.astimezone(UTC)
    timespec = 'microseconds' if utc.microsecond else 'seconds'
    return utc.isoformat(timespec=timespec).replace('+00:00', 'Z')


def trusted_clock(value):
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() != timedelta(0):
        _fail('generation_clock_unavailable')
    return value.astimezone(UTC)


def within_window(observed, clock):
    """Exact -30 s <= G - T <= 300 s, both bounds inclusive, no rounding."""
    if not isinstance(observed, datetime):
        return False
    delta = trusted_clock(clock) - observed
    return -MAX_FUTURE_SKEW <= delta <= MAX_OBSERVATION_AGE


def observation_age(observed, clock):
    """Displayed age; a within-skew future observation reports zero."""
    return max(timedelta(0), trusted_clock(clock) - observed)


def strict_json(data):
    """Decode JSON rejecting duplicate keys, NaN/Infinity and non-UTF-8 bytes."""
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                _fail('duplicate_json_key')
            result[key] = value
        return result

    def constant(_):
        _fail('json_constant_rejected')

    try:
        text = data.decode('utf-8') if isinstance(data, (bytes, bytearray)) else data
        if not isinstance(text, str):
            _fail('json_invalid')
        return json.loads(text, object_pairs_hook=pairs, parse_constant=constant)
    except UnicodeDecodeError:
        _fail('json_invalid')
    except AuthorityError:
        raise
    except ValueError:
        _fail('json_invalid')


def run_binding_ok(binding):
    """Validate one legacy run binding and allowlisted source options."""
    return (isinstance(binding, dict) and set(RUN_BINDING_FIELDS) <= set(binding)
            and set(binding) <= {*RUN_BINDING_FIELDS, *RUN_BINDING_OPTIONS}
            and all(is_identifier(binding[name]) for name in RUN_BINDING_FIELDS)
            and all(RUN_BINDING_OPTIONS[name](binding[name]) for name in binding if name in RUN_BINDING_OPTIONS))


def private_identities(group_bindings):
    """Identity values of a group's bindings that a display label may never equal."""
    values = set()
    for binding in group_bindings:
        for name in ('opaque_account_uid', 'target_id', 'candidate_slot', 'account_hint', 'binding_id'):
            if isinstance(binding.get(name), str):
                values.add(binding[name])
    return values


@dataclass(frozen=True)
class PrepInputs:
    """Parsed preparation inputs separating retained raw identifier strings from indexed identity resolution."""
    raw_links: tuple
    raw_roster: tuple
    raw_observations: tuple
    indexed_roster: dict
    roster_counts: Counter
    raw_identifiers_by_platform: dict
    raw_identifiers: frozenset


def extract_raw_prep_inputs(enrollment_links, legacy_roster, observation_bindings, instances=()):
    """Retain identifier-valid raw private locator strings from every parsed row,
    including rows whose identity fields are invalid, separately from the indexed resolution.
    """
    if (not isinstance(enrollment_links, (list, tuple))
            or not isinstance(legacy_roster, (list, tuple))
            or not isinstance(observation_bindings, (list, tuple))
            or not isinstance(instances, (list, tuple))):
        _fail('enrollment_artifact_invalid')

    by_platform = {}
    all_raw = set()

    def record(platform_value, value):
        if is_identifier(value):
            plat = platform_value if is_identifier(platform_value) else None
            by_platform.setdefault(plat, set()).add(value)
            all_raw.add(value)

    def scan_row(row):
        if not isinstance(row, dict):
            return
        platform_value = row.get('platform_id') if 'platform_id' in row else row.get('platform')
        for field_name in PRIVATE_LOCATOR_FIELDS:
            record(platform_value, row.get(field_name))
        for nested_name in ('config_identity', 'config'):
            nested = row.get(nested_name)
            if isinstance(nested, dict):
                for field_name in CONFIG_IDENTITY_FIELDS:
                    record(platform_value, nested.get(field_name))

    for row in enrollment_links:
        scan_row(row)
    for row in legacy_roster:
        scan_row(row)
    for row in observation_bindings:
        scan_row(row)
    for row in instances:
        scan_row(row)

    indexed_roster = {}
    roster_counts = Counter()
    for row in legacy_roster:
        if not isinstance(row, dict):
            continue
        identity = tuple(row.get(name) for name in BINDING_FIELDS)
        if all(is_identifier(value) for value in identity):
            roster_counts[identity] += 1
            if roster_counts[identity] == 1:
                indexed_roster[identity] = row
            else:
                indexed_roster.pop(identity, None)

    frozen_by_platform = {plat: frozenset(values) for plat, values in by_platform.items()}
    return PrepInputs(
        raw_links=tuple(enrollment_links),
        raw_roster=tuple(legacy_roster),
        raw_observations=tuple(observation_bindings),
        indexed_roster=indexed_roster,
        roster_counts=roster_counts,
        raw_identifiers_by_platform=frozen_by_platform,
        raw_identifiers=frozenset(all_raw),
    )


def certified_group_deployments(deployments):
    """Validate exact deployment pairs without normalization, reject duplicates,
    and return them sorted lexicographically by UTF-8 bytes of (platform, key).
    """
    if not isinstance(deployments, (list, tuple)) or not deployments:
        _fail('roster_group_invalid')
    pairs = []
    for item in deployments:
        if isinstance(item, dict):
            if frozenset(item) != frozenset({'platform', 'legacy_key'}):
                _fail('roster_group_invalid')
            pair = (item['platform'], item['legacy_key'])
        elif isinstance(item, (list, tuple)) and len(item) == 2:
            pair = (item[0], item[1])
        else:
            _fail('roster_group_invalid')
        if not is_identifier(pair[0]) or not is_identifier(pair[1]):
            _fail('roster_group_invalid')
        pairs.append(pair)
    if len(set(pairs)) != len(pairs):
        _fail('duplicate_group_deployment', CONFLICT)
    return tuple(sorted(pairs, key=lambda pair: (pair[0].encode('utf-8'), pair[1].encode('utf-8'))))


def expected_status(management_class, evidence, applied):
    if evidence != 'known':
        return 'unknown'
    if management_class == 'display_only':
        return 'not_under_management'
    if applied is None:
        return None
    return 'managed' if applied[0] else 'management_disabled'


def expected_denial(eligible, status, reasons):
    """B2's processingDenial over one resolved group or deployment."""
    if eligible:
        return None
    for reason in POLICY_DENIALS:
        if reason in reasons:
            return reason
    return {'management_disabled': 'management_disabled',
            'not_under_management': 'management_not_under_management'}.get(status, 'management_status_unknown')


def certify_group_identity(deployments):
    """Compute FLAG-3 private structural group identity over exact deployment pairs.

    Pairs are validated without stripping/lowercasing, checked for duplicates
    before keying, ordered lexicographically by UTF-8 bytes of (platform, key),
    and encoded as length-prefixed components with unambiguous pair boundaries.
    """
    ordered_pairs = certified_group_deployments(deployments)
    encoded_pairs = [(p.encode('utf-8'), k.encode('utf-8')) for p, k in ordered_pairs]
    buf = bytearray(b'qsl.group.v1\x00')
    buf.extend(struct.pack('>I', len(encoded_pairs)))
    for p_bytes, k_bytes in encoded_pairs:
        buf.extend(b'\x1e')
        buf.extend(struct.pack('>I', len(p_bytes)))
        buf.extend(p_bytes)
        buf.extend(b'\x1f')
        buf.extend(struct.pack('>I', len(k_bytes)))
        buf.extend(k_bytes)
    return 'grp_v1_' + hashlib.sha256(bytes(buf)).hexdigest()


@dataclass(frozen=True)
class ServiceAuthPolicy:
    """What a workload assertion must prove for the one registered read."""
    issuer: str
    audience: str
    subjects: frozenset
    max_lifetime: timedelta = timedelta(minutes=10)

    def __post_init__(self):
        if (not is_identifier(self.issuer) or not is_identifier(self.audience)
                or not isinstance(self.subjects, frozenset) or not self.subjects
                or not all(is_identifier(subject) for subject in self.subjects)):
            raise ValueError('service_auth_policy_invalid')


@dataclass(frozen=True)
class RosterBootConfig:
    """Protected boot configuration. Mode is explicit; mapping mode validates
    its reader settings and never requires the legacy array."""
    mode: str
    origin: str = ''
    auth_policy: ServiceAuthPolicy | None = None
    enrollment_source: str = ''
    config_context: str = ''
    read_timeout: float = 10.0

    def __post_init__(self):
        if self.mode == LEGACY_MODE:
            return
        if self.mode != MAPPING_MODE:
            raise ValueError('digest_roster_mode_invalid')
        if not isinstance(self.origin, str) or not ORIGIN.fullmatch(self.origin):
            raise ValueError('digest_roster_origin_invalid')
        if not isinstance(self.auth_policy, ServiceAuthPolicy):
            raise ValueError('service_auth_policy_invalid')
        if not isinstance(self.enrollment_source, str) or not VERSION.fullmatch(self.enrollment_source):
            raise ValueError('enrollment_source_invalid')
        if not isinstance(self.config_context, str) or not CODE.fullmatch(self.config_context):
            raise ValueError('digest_roster_context_invalid')
        if (isinstance(self.read_timeout, bool) or not isinstance(self.read_timeout, (int, float))
                or not 0 < self.read_timeout <= MAX_READ_TIMEOUT):
            raise ValueError('digest_roster_timeout_invalid')

    @classmethod
    def from_protected(cls, raw):
        if not isinstance(raw, dict) or 'mode' not in raw:
            raise ValueError('digest_roster_mode_required')
        if raw['mode'] != MAPPING_MODE:
            return cls(raw['mode'])
        auth = raw.get('service_auth')
        if not isinstance(auth, dict) or not isinstance(auth.get('subjects'), list):
            raise ValueError('service_auth_policy_invalid')
        return cls(
            MAPPING_MODE,
            raw.get('origin'),
            ServiceAuthPolicy(auth.get('issuer'), auth.get('audience'), frozenset(auth['subjects'])),
            raw.get('enrollment_source'),
            raw.get('config_context'),
            raw.get('read_timeout', 10.0),
        )


def _schemas_dir():
    env_dir = os.environ.get('QSL_DIGEST_SCHEMAS_DIR')
    if env_dir:
        return Path(env_dir)
    here = Path(__file__).resolve()
    for candidate in (here.parent / 'schemas', here.parents[2] / 'schemas'):
        if candidate.is_dir():
            return candidate
    return here.parents[2] / 'schemas'


def load_roster_schema(name='qsl-digest-account-roster.v1.schema.json'):
    if name not in SCHEMA_FILES:
        raise FileNotFoundError(f'unknown_roster_schema:{name}')
    path = _schemas_dir() / name
    if not path.is_file():
        raise FileNotFoundError(f'missing_roster_schema:{name}')
    return json.loads(path.read_text(encoding='utf-8'))


def verify_packaged_schemas():
    """Preflight check verifying every closed B3 schema exists relative to package root."""
    return {name: load_roster_schema(name) for name in SCHEMA_FILES}


@dataclass(frozen=True)
class LiveGroup:
    deployments: tuple            # sorted exact (platform, legacy_key) pairs
    management_class: str
    management_status: str
    evidence_state: str
    scope: str
    reasons: tuple
    processing_eligible: bool
    processing_denial: str | None
    applied: tuple | None         # (management_enabled, revision, effective_at) or None

    @property
    def key(self):
        return frozenset(self.deployments)

    def vector(self):
        return (
            self.deployments, self.management_class, self.management_status, self.evidence_state,
            self.scope, self.reasons, self.processing_eligible, self.processing_denial, self.applied,
        )


@dataclass(frozen=True)
class LiveObservation:
    observed_at: str
    instance_revision: int
    policy_revision: int
    groups: tuple
    uncovered: tuple
    effective_records: tuple
    _origin: object = field(default=None, repr=False, compare=False)

    @property
    def observed(self):
        return parse_instant(self.observed_at)

    def vector(self):
        return (
            self.instance_revision, self.policy_revision,
            tuple(group.vector() for group in self.groups), self.uncovered,
        )

    def group(self, deployments):
        key = frozenset(deployments)
        return next((group for group in self.groups if group.key == key), None)


def validate_effective_records(rows):
    """Validate B2 applied-row adapter output: exact five fields, strict types."""
    if not isinstance(rows, list):
        _fail('effective_records_invalid')
    records = []
    for row in rows:
        exact_keys(row, frozenset(EFFECTIVE_FIELDS), 'effective_records_invalid')
        if (not is_identifier(row['platform']) or not is_identifier(row['legacy_key'])
                or type(row['management_enabled']) is not bool or not is_strict_revision(row['revision'])
                or parse_instant(row['effective_at']) is None):
            _fail('effective_records_invalid')
        records.append(tuple(row[name] for name in EFFECTIVE_FIELDS))
    if len({record[:2] for record in records}) != len(records):
        _fail('effective_record_duplicate', CONFLICT)
    return records


def validate_readback(document):
    """Validate one B2 readback as current authority, or raise AuthorityError."""
    if isinstance(document, (bytes, bytearray, str)):
        document = strict_json(document)
    exact_keys(document, READBACK_KEYS, 'readback_shape_invalid')
    if document['format'] != READBACK_FORMAT:
        _fail('readback_format_unsupported')
    if document['ok'] is not True or document['evidence_scope'] != EVIDENCE_SCOPE:
        _fail('readback_scope_invalid')
    if document['status'] != 'available' or document['reasons'] != []:
        _fail('management_read_unavailable')
    if document['policy_status'] != 'available':
        _fail('management_policy_unavailable')
    if document['physical_grouping_complete'] is not True:
        _fail('physical_grouping_incomplete')
    observed = parse_instant(document['observed_at'])
    if observed is None:
        _fail('observation_time_invalid', STALE)
    if not is_strict_revision(document['instance_revision']) or not is_strict_revision(document['policy_revision']):
        _fail('readback_revision_invalid')
    if not isinstance(document['groups'], list) or not isinstance(document['uncovered_deployments'], list):
        _fail('readback_shape_invalid')

    claims = Counter()
    groups = []
    for raw in document['groups']:
        exact_keys(raw, READBACK_GROUP_KEYS, 'readback_group_invalid')
        if (not is_member(raw['management_class'], MANAGEMENT_CLASSES)
                or not is_member(raw['management_status'], MANAGEMENT_STATUSES)
                or not is_member(raw['evidence_state'], EVIDENCE_STATES) or not is_member(raw['scope'], SCOPES)
                or not is_codes(raw['reasons'], GROUP_REASON_CODES)
                or type(raw['processing_eligible']) is not bool
                or not (raw['processing_denial'] is None or is_member(raw['processing_denial'], DENIAL_CODES))):
            _fail('readback_group_invalid')
        if not isinstance(raw['deployments'], list) or not raw['deployments']:
            _fail('readback_group_invalid')
        pairs = []
        for item in raw['deployments']:
            exact_keys(item, frozenset({'platform', 'key', 'present'}), 'readback_group_invalid')
            if not is_identifier(item['platform']) or not is_identifier(item['key']):
                _fail('readback_group_invalid')
            if item['present'] is not True:
                _fail('deployment_member_lost')
            pairs.append((item['platform'], item['key']))
        if len(set(pairs)) != len(pairs):
            _fail('deployment_claimed_by_multiple_accounts', CONFLICT)
        claims.update(pairs)
        applied = raw['applied']
        if applied is not None:
            exact_keys(applied, frozenset({'management_enabled', 'revision', 'effective_at'}), 'readback_applied_invalid')
            effective = parse_instant(applied['effective_at'])
            if (type(applied['management_enabled']) is not bool
                    or not is_strict_revision(applied['revision']) or effective is None):
                _fail('readback_applied_invalid')
            if effective > observed:
                _fail('applied_effective_after_observation', STALE)
            applied = (applied['management_enabled'], applied['revision'], applied['effective_at'])
        status = expected_status(raw['management_class'], raw['evidence_state'], applied)
        processing = (raw['management_class'] == 'eligible' and raw['evidence_state'] == 'known'
                      and raw['management_status'] == 'managed')
        if (status != raw['management_status'] or raw['processing_eligible'] is not processing
                or raw['processing_denial'] != expected_denial(processing, status, raw['reasons'])):
            _fail('readback_status_inconsistent', CONFLICT)
        ordered = tuple(sorted(pairs, key=lambda pair: (pair[0].encode('utf-8'), pair[1].encode('utf-8'))))
        groups.append(LiveGroup(
            ordered, raw['management_class'], raw['management_status'],
            raw['evidence_state'], raw['scope'], tuple(raw['reasons']), processing,
            raw['processing_denial'], applied,
        ))
    uncovered = []
    for raw in document['uncovered_deployments']:
        exact_keys(raw, UNCOVERED_KEYS, 'readback_uncovered_invalid')
        if (not is_identifier(raw['platform']) or not is_identifier(raw['key'])
                or raw['management_status'] != 'unknown' or raw['evidence_state'] != 'unknown'
                or raw['processing_eligible'] is not False
                or not is_codes(raw['reasons'], GROUP_REASON_CODES)
                or not is_member(raw['processing_denial'], DENIAL_CODES)):
            _fail('readback_uncovered_invalid')
        uncovered.append((raw['platform'], raw['key']))
    if uncovered:
        _fail('physical_grouping_incomplete')
    claims.update(uncovered)
    if any(count > 1 for count in claims.values()):
        _fail('deployment_claimed_by_multiple_accounts', CONFLICT)

    counts = document['counts']
    exact_keys(counts, READBACK_COUNT_KEYS, 'readback_counts_invalid')
    enumerated = Counter(group.management_status for group in groups)
    declared = {
        'physical_accounts': len(groups), 'display_deployments': sum(claims.values()),
        'uncovered_deployments': len(uncovered),
        **{status: enumerated.get(status, 0) for status in MANAGEMENT_STATUSES},
    }
    if any(type(counts[name]) is not int or counts[name] != value for name, value in declared.items()):
        _fail('readback_counts_inconsistent', CONFLICT)

    export = document['effective_export']
    exact_keys(export, frozenset({'format', 'instance_revision', 'policy_revision', 'records'}), 'effective_export_invalid')
    # D3-P2: strict non-boolean integer checks on both embedded revisions precede equality.
    if (not is_strict_revision(export['instance_revision'])
            or not is_strict_revision(export['policy_revision'])):
        _fail('readback_revision_invalid')
    if (export['format'] != EFFECTIVE_EXPORT_FORMAT
            or export['instance_revision'] != document['instance_revision']
            or export['policy_revision'] != document['policy_revision']
            or not isinstance(export['records'], list)):
        _fail('effective_export_invalid')
    records = validate_effective_records(export['records'])
    owner = {pair: group for group in groups for pair in group.deployments}
    for group in groups:
        if len({record[2:] for record in records if record[:2] in group.deployments}) > 1:
            _fail('sibling_applied_disagree', CONFLICT)
    for record in records:
        group = owner.get(record[:2])
        if group is None or group.applied != record[2:]:
            _fail('effective_export_inconsistent', CONFLICT)
    for group in groups:
        if group.management_class == 'eligible' and group.evidence_state == 'known':
            if any(pair not in {record[:2] for record in records} for pair in group.deployments):
                _fail('effective_export_inconsistent', CONFLICT)

    return LiveObservation(
        document['observed_at'], document['instance_revision'], document['policy_revision'],
        tuple(sorted(groups, key=lambda group: group.deployments)), tuple(sorted(uncovered)),
        tuple(sorted(records)),
    )


def validate_projection_revisions(projection, expected_instance_revision, expected_policy_revision):
    """Validate B1 projection format and strict non-boolean embedded revisions before equality (D3-P2)."""
    if not isinstance(projection, dict) or projection.get('format') != PROJECTION_FORMAT:
        _fail('projection_invalid')
    accounts = projection.get('accounts')
    if not isinstance(accounts, list):
        _fail('projection_invalid')
    if not is_strict_revision(expected_instance_revision) or not is_strict_revision(expected_policy_revision):
        _fail('readback_revision_invalid')
    for account in accounts:
        if not isinstance(account, dict):
            _fail('projection_invalid')
        revision = account.get('configuration_revision')
        if not isinstance(revision, dict):
            _fail('projection_revision_invalid', CONFLICT)
        inst_rev = revision.get('instances')
        pol_rev = revision.get('mapping_policy')
        # D3-P2: reject booleans on both embedded revision fields BEFORE equality.
        if not is_strict_revision(inst_rev) or not is_strict_revision(pol_rev):
            _fail('projection_revision_invalid', CONFLICT)
        if inst_rev != expected_instance_revision or pol_rev != expected_policy_revision:
            _fail('projection_revision_mismatch', CONFLICT)
    return accounts


def validate_selection_document(document, expected_source=None):
    """Validate one qsl_digest_enrollment_selection.v1 document."""
    exact_keys(document, frozenset({'format', *SELECTION_KEYS}), 'enrollment_selection_invalid')
    if document['format'] != SELECTION_FORMAT:
        _fail('enrollment_selection_invalid')
    if expected_source is not None and document['source'] != expected_source:
        _fail('enrollment_selection_unauthenticated')
    if (not all(isinstance(document[name], str) and VERSION.fullmatch(document[name])
                for name in ('source', 'version', 'membership_version', 'label_version', 'link_version'))
            or not isinstance(document['artifact_sha256'], str) or not SHA256.fullmatch(document['artifact_sha256'])):
        _fail('enrollment_selection_invalid')
    return document


def validate_artifact(document):
    """Validate one qsl_digest_enrollment_artifact.v1 document."""
    exact_keys(document, ARTIFACT_KEYS, 'enrollment_artifact_invalid')
    if document['format'] != ARTIFACT_FORMAT:
        _fail('enrollment_artifact_invalid')
    if (not all(isinstance(document[name], str) and VERSION.fullmatch(document[name])
                for name in ('source', 'version', 'membership_version', 'label_version', 'link_version'))
            or not is_strict_revision(document['instance_revision'])
            or not is_strict_revision(document['policy_revision'])
            or parse_instant(document['prepared_at']) is None
            or parse_instant(document['enrollment_observed_at']) is None
            or not isinstance(document['groups'], list) or not isinstance(document['rejected'], dict)):
        _fail('enrollment_artifact_invalid')
    seen, runs, slots, targets, sources = set(), set(), set(), set(), set()
    for group in document['groups']:
        exact_keys(group, ARTIFACT_GROUP_KEYS, 'enrollment_artifact_invalid')
        pairs = group['deployments']
        if (not isinstance(pairs, list) or not pairs
                or not all(isinstance(pair, list) and len(pair) == 2 and all(map(is_identifier, pair))
                           for pair in pairs)):
            _fail('enrollment_artifact_invalid')
        pairs = [tuple(pair) for pair in pairs]
        if seen & set(pairs) or len(set(pairs)) != len(pairs):
            _fail('enrollment_artifact_invalid')
        seen.update(pairs)
        if not isinstance(group['legacy_run_bindings'], list) or not isinstance(group['observation_bindings'], list):
            _fail('enrollment_artifact_invalid')
        for binding in group['legacy_run_bindings']:
            if not run_binding_ok(binding):
                _fail('enrollment_artifact_invalid')
            identity = tuple(binding[name] for name in BINDING_FIELDS)
            slot = binding['platform_id'], binding['candidate_slot']
            target = tuple(binding[name] for name in RUNTIME_TARGET_FIELDS)
            if (identity in runs or slot in slots or target in targets
                    or binding['platform_id'] not in {pair[0] for pair in pairs}):
                _fail('enrollment_artifact_invalid')
            runs.add(identity)
            slots.add(slot)
            targets.add(target)
        labels = group['labels']
        private = private_identities([*group['legacy_run_bindings'], *group['observation_bindings']])
        if not isinstance(labels, list) or not all(
                isinstance(item, list) and len(item) == 3 and tuple(item[:2]) in pairs
                and isinstance(item[2], str) and safe_display_text(item[2]) == item[2] and item[2]
                and len(item[2]) <= 70 and item[2] not in private
                for item in labels):
            _fail('enrollment_artifact_invalid')
        if len({tuple(item[:2]) for item in labels}) != len(labels):
            _fail('enrollment_artifact_invalid')
        for binding in group['observation_bindings']:
            exact_keys(binding, frozenset(OBSERVATION_BINDING_FIELDS), 'enrollment_artifact_invalid')
            if (not isinstance(binding['binding_id'], str) or binding['binding_id'] in sources
                    or (binding['platform'], binding['legacy_key']) not in pairs
                    or not is_member(binding['broker_environment'], {'paper', 'live'})
                    or not all(is_identifier(binding[name]) for name in OBSERVATION_BINDING_FIELDS
                               if name != 'opaque_account_uid')
                    or not (binding['opaque_account_uid'] is None or is_identifier(binding['opaque_account_uid']))):
                _fail('enrollment_artifact_invalid')
            if binding['opaque_account_uid'] is not None and binding['opaque_account_uid'] not in {
                run['opaque_account_uid'] for run in group['legacy_run_bindings']
                if run['platform_id'] == binding['platform']
            }:
                _fail('observation_identity_unenrolled', CONFLICT)
            sources.add(binding['binding_id'])
    if not all(isinstance(name, str) and CODE.fullmatch(name) and type(count) is int and count > 0
               for name, count in document['rejected'].items()):
        _fail('enrollment_artifact_invalid')
    return document


def canonical_envelope_payload(document):
    """Canonical UTF-8 bytes of a roster envelope excluding its own content_hash field."""
    if not isinstance(document, dict):
        _fail('roster_shape_invalid')
    body = {key: value for key, value in document.items() if key != 'content_hash'}
    return json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def compute_content_hash(document):
    return hashlib.sha256(canonical_envelope_payload(document)).hexdigest()


def verify_content_hash(document):
    if not isinstance(document, dict) or not isinstance(document.get('content_hash'), str):
        _fail('roster_hash_invalid', CONFLICT)
    if not SHA256.fullmatch(document['content_hash']):
        _fail('roster_hash_invalid', CONFLICT)
    if compute_content_hash(document) != document['content_hash']:
        _fail('roster_hash_mismatch', CONFLICT)


def check_envelope_freshness(document, clock):
    """Verify source snapshot freshness against `clock` (-30s <= G - T <= 300s).

    Never substitutes generated_at or fetch completion times for source snapshot times.
    """
    if isinstance(document, (bytes, bytearray, str)):
        document = strict_json(document)
    if not isinstance(document, dict):
        _fail('roster_shape_invalid')
    if document.get('format') != ROSTER_FORMAT:
        _fail('roster_format_unsupported')
    if document.get('status') != STATUS_AVAILABLE:
        _fail('roster_not_authoritative')
    clock = trusted_clock(clock)
    snapshot_at = parse_instant(document.get('source_snapshot_at'))
    if snapshot_at is None:
        _fail('observation_time_invalid', STALE)
    if not within_window(snapshot_at, clock):
        _fail('observation_stale', STALE)
    acq = document.get('acquisition')
    if not isinstance(acq, dict):
        _fail('roster_shape_invalid')
    for field_name in ('initial_snapshot_at', 'confirming_snapshot_at'):
        ts = parse_instant(acq.get(field_name))
        if ts is None:
            _fail('observation_time_invalid', STALE)
        if not within_window(ts, clock):
            _fail('observation_stale', STALE)
    return True


def _validate_run_scope(value):
    exact_keys(value, RUN_SCOPE_KEYS, 'roster_scope_invalid')
    if (not is_identifier(value['namespace'])
            or not (isinstance(value['enrollment_source'], str) and VERSION.fullmatch(value['enrollment_source']))
            or not (isinstance(value['config_context'], str) and CODE.fullmatch(value['config_context']))
            or not is_identifier(value['recipient_scope'])
            or value['original_slot'] not in {'07:00', '07:30'}
            or type(value['preview']) is not bool):
        _fail('roster_scope_invalid')
    try:
        if date.fromisoformat(value['report_date']).isoformat() != value['report_date']:
            _fail('roster_scope_invalid')
    except (TypeError, ValueError):
        _fail('roster_scope_invalid')


def _validate_generation_window(value):
    exact_keys(value, GENERATION_WINDOW_KEYS, 'roster_shape_invalid')
    try:
        if date.fromisoformat(value['business_day']).isoformat() != value['business_day']:
            _fail('roster_shape_invalid')
    except (TypeError, ValueError):
        _fail('roster_shape_invalid')
    start = parse_instant(value['start'])
    end = parse_instant(value['end'])
    deadline = parse_instant(value['deadline_at'])
    if start is None or end is None or deadline is None or not start < end:
        _fail('roster_time_invalid', STALE)


def _validate_acquisition(value, expected_snapshot_at):
    exact_keys(value, ACQUISITION_KEYS, 'roster_shape_invalid')
    if (value['live_source'] != MANAGEMENT_ROUTE
            or value['evidence_scope'] != EVIDENCE_SCOPE
            or value['confirmation_outcome'] != 'confirmed'):
        _fail('roster_scope_invalid')
    t1_read = parse_instant(value['initial_read_at'])
    t2_read = parse_instant(value['confirming_read_at'])
    t1_snap = parse_instant(value['initial_snapshot_at'])
    t2_snap = parse_instant(value['confirming_snapshot_at'])
    if None in (t1_read, t2_read, t1_snap, t2_snap):
        _fail('roster_time_invalid', STALE)
    if t1_snap != expected_snapshot_at and t2_snap != expected_snapshot_at:
        _fail('roster_time_invalid', STALE)
    return t1_snap, t2_snap


def validate_roster_envelope(document):
    """Strictly validate one qsl_digest_account_roster.v1 document, or raise AuthorityError."""
    if isinstance(document, (bytes, bytearray, str)):
        document = strict_json(document)
    if not isinstance(document, dict):
        _fail('roster_shape_invalid')
    if 'format' in document and document['format'] != ROSTER_FORMAT:
        _fail('roster_format_unsupported')
    if 'schema_version' in document and document['schema_version'] != ROSTER_FORMAT:
        _fail('roster_format_unsupported')
    exact_keys(document, ROSTER_KEYS, 'roster_shape_invalid')
    status = document['status']
    if not is_member(status, ROSTER_STATUSES):
        _fail('roster_shape_invalid')
    if document['live_source'] != MANAGEMENT_ROUTE or document['evidence_scope'] != EVIDENCE_SCOPE:
        _fail('roster_scope_invalid')
    if type(document['physical_grouping_complete']) is not bool:
        _fail('roster_shape_invalid')
    if document['run_id'] is not None and not is_identifier(document['run_id']):
        _fail('roster_scope_invalid')
    if document['run_scope'] is not None:
        _validate_run_scope(document['run_scope'])
        expected_run_id = f"{document['run_scope']['report_date']}/{document['run_scope']['original_slot']}"
        if document['run_id'] != expected_run_id:
            _fail('roster_scope_invalid')
    if document['generation_id'] is not None and not is_identifier(document['generation_id']):
        _fail('roster_shape_invalid')

    source_rev = document['source_revision']
    if source_rev is not None:
        exact_keys(source_rev, SOURCE_REVISION_KEYS, 'roster_revision_invalid')
        if (not is_strict_revision(source_rev['instance_revision'])
                or not is_strict_revision(source_rev['policy_revision'])):
            _fail('roster_revision_invalid')

    for field_name in ('source_snapshot_at', 'generated_at', 'prepared_at', 'enrollment_observed_at'):
        val = document[field_name]
        if val is not None and parse_instant(val) is None:
            _fail('roster_time_invalid', STALE)
    if document['generation_window'] is not None:
        _validate_generation_window(document['generation_window'])
    age = document['observation_age_seconds']
    if age is not None and (isinstance(age, bool) or not isinstance(age, (int, float)) or age < 0):
        _fail('roster_time_invalid', STALE)

    if document['failure_code'] is not None and (
            not isinstance(document['failure_code'], str) or not CODE.fullmatch(document['failure_code'])):
        _fail('roster_shape_invalid')
    if document['failure_kind'] is not None and not is_member(document['failure_kind'], FAILURE_KINDS):
        _fail('roster_shape_invalid')

    selection = document['selection']
    if selection is not None:
        exact_keys(selection, SELECTION_KEYS, 'roster_selection_invalid')
        if not isinstance(selection['artifact_sha256'], str) or not SHA256.fullmatch(selection['artifact_sha256']):
            _fail('roster_selection_invalid')
        if not all(isinstance(selection[name], str) and VERSION.fullmatch(selection[name])
                   for name in SELECTION_KEYS - {'artifact_sha256'}):
            _fail('roster_selection_invalid')

    if not isinstance(document['accounts'], list) or not isinstance(document['uncovered_deployments'], list):
        _fail('roster_shape_invalid')
    if type(document['account_count']) is not int or document['account_count'] != len(document['accounts']):
        _fail('roster_counts_inconsistent', CONFLICT)
    if not isinstance(document['rejected'], dict) or not all(
            isinstance(k, str) and CODE.fullmatch(k) and type(v) is int and v > 0
            for k, v in document['rejected'].items()):
        _fail('roster_shape_invalid')

    claims = Counter()
    group_ids = set()
    runs, slots, targets, obs_sources = set(), set(), set(), set()
    reasons_vocabulary = GROUP_REASON_CODES if status == STATUS_AVAILABLE else None
    group_statuses = Counter()
    snapshot_instant = parse_instant(document['source_snapshot_at']) if document['source_snapshot_at'] else None

    for raw in document['accounts']:
        exact_keys(raw, ROSTER_GROUP_KEYS, 'roster_group_invalid')
        if not isinstance(raw['deployments'], list) or not raw['deployments']:
            _fail('roster_group_invalid')
        pairs = []
        for item in raw['deployments']:
            exact_keys(item, frozenset({'platform', 'legacy_key'}), 'roster_group_invalid')
            if not is_identifier(item['platform']) or not is_identifier(item['legacy_key']):
                _fail('roster_group_invalid')
            pairs.append((item['platform'], item['legacy_key']))
        if len(set(pairs)) != len(pairs):
            _fail('deployment_claimed_by_multiple_accounts', CONFLICT)
        if not is_identifier(raw['platform']) or not is_identifier(raw['account_key']):
            _fail('roster_group_invalid')
        if (raw['platform'], raw['account_key']) not in set(pairs):
            _fail('roster_group_invalid')
        expected_gid = certify_group_identity(pairs)
        if raw['group_id'] is not None:
            if not isinstance(raw['group_id'], str) or not GROUP_ID.fullmatch(raw['group_id']):
                _fail('roster_group_invalid')
            if raw['group_id'] != expected_gid:
                _fail('roster_group_identity_mismatch', CONFLICT)
            if raw['group_id'] in group_ids:
                _fail('duplicate_physical_account', CONFLICT)
            group_ids.add(raw['group_id'])
        claims.update(pairs)
        pair_set = set(pairs)

        if (not is_member(raw['scope'], SCOPES)
                or (raw['management_class'] is not None and not is_member(raw['management_class'], MANAGEMENT_CLASSES))
                or not is_member(raw['management_status'], MANAGEMENT_STATUSES)
                or not is_member(raw['evidence_state'], EVIDENCE_STATES)
                or type(raw['processing_eligible']) is not bool
                or not (raw['processing_denial'] is None or is_member(raw['processing_denial'], DENIAL_CODES))
                or not is_codes(raw['reasons'], reasons_vocabulary)
                or not isinstance(raw['labels'], list)
                or not isinstance(raw['legacy_run_bindings'], list)
                or not isinstance(raw['observation_bindings'], list)):
            _fail('roster_group_invalid')
        private = private_identities([
            binding for binding in (*raw['legacy_run_bindings'], *raw['observation_bindings'])
            if isinstance(binding, dict)
        ])
        seen_labels = set()
        for lbl in raw['labels']:
            exact_keys(lbl, frozenset({'platform', 'legacy_key', 'label'}), 'roster_group_invalid')
            pair = (lbl['platform'], lbl['legacy_key'])
            if (pair not in pair_set or pair in seen_labels
                    or not isinstance(lbl['label'], str) or not lbl['label']
                    or len(lbl['label']) > 70 or safe_display_text(lbl['label']) != lbl['label']):
                _fail('roster_group_invalid')
            seen_labels.add(pair)
            if lbl['label'] in private:
                _fail('roster_label_private_identity', CONFLICT)

        applied = raw['applied']
        if applied is not None:
            exact_keys(applied, frozenset({'management_enabled', 'revision', 'effective_at'}), 'roster_group_invalid')
            effective = parse_instant(applied['effective_at'])
            if (type(applied['management_enabled']) is not bool
                    or not is_strict_revision(applied['revision']) or effective is None):
                _fail('roster_group_invalid')
            if snapshot_instant is not None and effective > snapshot_instant:
                _fail('applied_effective_after_observation', STALE)
            applied_tuple = (applied['management_enabled'], applied['revision'], applied['effective_at'])
        else:
            applied_tuple = None

        if raw['management_class'] is not None:
            exp_status = expected_status(raw['management_class'], raw['evidence_state'], applied_tuple)
            processing = (raw['management_class'] == 'eligible' and raw['evidence_state'] == 'known'
                          and raw['management_status'] == 'managed')
            if (exp_status != raw['management_status'] or raw['processing_eligible'] is not processing
                    or raw['processing_denial'] != expected_denial(processing, exp_status, raw['reasons'])):
                _fail('roster_status_inconsistent', CONFLICT)
        elif (raw['management_status'] != 'unknown' or raw['processing_eligible'] is not False
              or applied is not None
              or raw['processing_denial'] != expected_denial(False, 'unknown', raw['reasons'])):
            _fail('roster_status_inconsistent', CONFLICT)

        for binding in raw['legacy_run_bindings']:
            if not run_binding_ok(binding):
                _fail('roster_binding_invalid')
            identity = tuple(binding[name] for name in BINDING_FIELDS)
            slot = (binding['platform_id'], binding['candidate_slot'])
            target = tuple(binding[name] for name in RUNTIME_TARGET_FIELDS)
            if (identity in runs or slot in slots or target in targets
                    or binding['platform_id'] not in {p for p, _ in pairs}):
                _fail('roster_binding_invalid', CONFLICT)
            runs.add(identity)
            slots.add(slot)
            targets.add(target)

        for binding in raw['observation_bindings']:
            exact_keys(binding, frozenset(OBSERVATION_BINDING_FIELDS), 'roster_binding_invalid')
            if (not isinstance(binding['binding_id'], str) or binding['binding_id'] in obs_sources
                    or (binding['platform'], binding['legacy_key']) not in pair_set
                    or not is_member(binding['broker_environment'], {'paper', 'live'})
                    or binding['broker_environment'] != raw['scope']
                    or not all(is_identifier(binding[name]) for name in OBSERVATION_BINDING_FIELDS
                               if name != 'opaque_account_uid')
                    or not (binding['opaque_account_uid'] is None or is_identifier(binding['opaque_account_uid']))):
                _fail('roster_binding_invalid', CONFLICT)
            if binding['opaque_account_uid'] is not None and binding['opaque_account_uid'] not in {
                run['opaque_account_uid'] for run in raw['legacy_run_bindings']
                if run['platform_id'] == binding['platform']
            }:
                _fail('observation_identity_unenrolled', CONFLICT)
            obs_sources.add(binding['binding_id'])
        group_statuses[raw['management_status']] += 1

    uncovered = []
    for raw in document['uncovered_deployments']:
        exact_keys(raw, UNCOVERED_KEYS, 'roster_uncovered_invalid')
        if (not is_identifier(raw['platform']) or not is_identifier(raw['key'])
                or raw['management_status'] != 'unknown' or raw['evidence_state'] != 'unknown'
                or raw['processing_eligible'] is not False
                or not is_codes(raw['reasons'], UNCOVERED_REASON_CODES)
                or not is_member(raw['processing_denial'], DENIAL_CODES)):
            _fail('roster_uncovered_invalid')
        uncovered.append((raw['platform'], raw['key']))
    claims.update(uncovered)
    if any(count > 1 for count in claims.values()):
        _fail('deployment_claimed_by_multiple_accounts', CONFLICT)

    counts = document['counts']
    exact_keys(counts, COUNT_KEYS, 'roster_counts_invalid')
    if type(counts['display_groups']) is not int or counts['display_groups'] != len(document['accounts']):
        _fail('roster_counts_inconsistent', CONFLICT)
    if type(counts['uncovered_deployments']) is not int or counts['uncovered_deployments'] != len(uncovered):
        _fail('roster_counts_inconsistent', CONFLICT)
    if type(counts['display_deployments']) is not int or counts['display_deployments'] != sum(claims.values()):
        _fail('roster_counts_inconsistent', CONFLICT)

    if status == STATUS_AVAILABLE:
        if (document['run_id'] is None or document['run_scope'] is None or document['generation_id'] is None
                or document['source_revision'] is None or document['source_snapshot_at'] is None
                or document['generated_at'] is None or document['generation_window'] is None
                or document['acquisition'] is None or document['selection'] is None
                or document['prepared_at'] is None or document['enrollment_observed_at'] is None
                or document['physical_grouping_complete'] is not True
                or document['failure_code'] is not None or document['failure_kind'] is not None):
            _fail('roster_shape_invalid')
        if any(group['management_class'] is None or group['group_id'] is None for group in document['accounts']):
            _fail('roster_status_inconsistent', CONFLICT)
        if document['run_scope']['enrollment_source'] != document['selection']['source']:
            _fail('roster_scope_invalid')
        generated = parse_instant(document['generated_at'])
        t1_snap, t2_snap = _validate_acquisition(document['acquisition'], snapshot_instant)
        if not (within_window(t1_snap, generated) and within_window(t2_snap, generated)):
            _fail('roster_time_invalid', STALE)
        delta = generated - snapshot_instant
        if (not -MAX_FUTURE_SKEW <= delta <= MAX_OBSERVATION_AGE or age is None
                or abs(age - max(0.0, delta.total_seconds())) > 1e-6):
            _fail('roster_time_invalid', STALE)
        if type(counts['physical_accounts']) is not int or counts['physical_accounts'] != len(document['accounts']):
            _fail('roster_counts_inconsistent', CONFLICT)
        for name in MANAGEMENT_STATUSES:
            if type(counts[name]) is not int or counts[name] != group_statuses.get(name, 0):
                _fail('roster_counts_inconsistent', CONFLICT)
    elif status == STATUS_FALLBACK:
        if (document['generation_id'] is not None
                or document['source_snapshot_at'] is None or document['generated_at'] is not None
                or document['source_revision'] is not None or document['acquisition'] is not None
                or document['selection'] is not None or document['prepared_at'] is not None
                or document['enrollment_observed_at'] is not None
                or document['physical_grouping_complete'] is not False
                or document['failure_code'] is None or document['failure_kind'] is None
                or not document['accounts'] or document['uncovered_deployments'] or document['rejected']):
            _fail('roster_shape_invalid')
        for group in document['accounts']:
            if (group['management_class'] is not None or group['management_status'] != 'unknown'
                    or group['evidence_state'] != 'unknown' or group['legacy_run_bindings']
                    or group['observation_bindings']):
                _fail('roster_status_inconsistent', CONFLICT)
        if any(counts[name] is not None for name in ('physical_accounts', *MANAGEMENT_STATUSES)):
            _fail('roster_counts_inconsistent', CONFLICT)
    else:
        if (document['generation_id'] is not None
                or document['source_snapshot_at'] is not None or document['generated_at'] is not None
                or document['observation_age_seconds'] is not None
                or document['source_revision'] is not None or document['acquisition'] is not None
                or document['selection'] is not None or document['prepared_at'] is not None
                or document['enrollment_observed_at'] is not None
                or document['physical_grouping_complete'] is not False
                or document['failure_code'] is None or document['failure_kind'] is None
                or document['accounts'] or document['uncovered_deployments'] or document['rejected']):
            _fail('roster_shape_invalid')
        if any(counts[name] is not None for name in ('physical_accounts', *MANAGEMENT_STATUSES)):
            _fail('roster_counts_inconsistent', CONFLICT)

    verify_content_hash(document)
    return document


def validate_ownership_contract(roster_document, live_observation):
    """Canonical ownership-validation contract owned by the preparer (RESCOPE §3.1 item 4).

    Verifies that for an authoritative roster:
    1) every roster account exists in the source observation;
    2) platform + key identify the exact same physical account;
    3) management class, status, evidence, scope, eligibility, reasons and applied match source;
    4) no physical account appears twice;
    5) no account is silently omitted from the complete snapshot;
    6) the roster names the exact source revision it was validated against.
    """
    doc = validate_roster_envelope(roster_document)
    if doc['format'] != ROSTER_FORMAT or doc['status'] != STATUS_AVAILABLE:
        _fail('roster_not_authoritative')
    if not isinstance(live_observation, LiveObservation):
        _fail('observation_not_acquired')
    expected_rev = {
        'instance_revision': live_observation.instance_revision,
        'policy_revision': live_observation.policy_revision,
    }
    if doc['source_revision'] != expected_rev:
        _fail('ownership_revision_mismatch', CONFLICT)
    if doc['physical_grouping_complete'] is not True:
        _fail('physical_grouping_incomplete')
    expected_uncovered = tuple(sorted(
        ((u['platform'], u['key']) for u in doc['uncovered_deployments']),
        key=lambda pair: (pair[0].encode('utf-8'), pair[1].encode('utf-8')),
    ))
    live_uncovered = tuple(sorted(
        live_observation.uncovered,
        key=lambda pair: (pair[0].encode('utf-8'), pair[1].encode('utf-8')),
    ))
    if expected_uncovered != live_uncovered:
        _fail('ownership_uncovered_mismatch', CONFLICT)
    if doc['account_count'] != len(live_observation.groups) or len(doc['accounts']) != len(live_observation.groups):
        _fail('ownership_omission_detected', CONFLICT)

    live_by_gid = {certify_group_identity(group.deployments): group for group in live_observation.groups}
    if len(live_by_gid) != len(live_observation.groups):
        _fail('duplicate_physical_account', CONFLICT)
    seen_gids = set()
    seen_pairs = set()
    for account in doc['accounts']:
        pairs = certified_group_deployments(account['deployments'])
        gid = certify_group_identity(pairs)
        if account['group_id'] != gid:
            _fail('roster_group_identity_mismatch', CONFLICT)
        if gid in seen_gids:
            _fail('duplicate_physical_account', CONFLICT)
        live_group = live_by_gid.get(gid)
        if live_group is None or pairs != live_group.deployments:
            _fail('ownership_account_mismatch', CONFLICT)
        seen_gids.add(gid)
        if seen_pairs & set(pairs):
            _fail('deployment_claimed_by_multiple_accounts', CONFLICT)
        seen_pairs.update(pairs)
        expected_applied = (
            {
                'management_enabled': live_group.applied[0],
                'revision': live_group.applied[1],
                'effective_at': live_group.applied[2],
            }
            if live_group.applied is not None else None
        )
        if (account['management_class'] != live_group.management_class
                or account['management_status'] != live_group.management_status
                or account['evidence_state'] != live_group.evidence_state
                or account['scope'] != live_group.scope
                or account['processing_eligible'] is not live_group.processing_eligible
                or account['processing_denial'] != live_group.processing_denial
                or tuple(account['reasons']) != live_group.reasons
                or account['applied'] != expected_applied):
            _fail('ownership_status_mismatch', CONFLICT)
    if seen_gids != set(live_by_gid):
        _fail('ownership_omission_detected', CONFLICT)
    return doc


def verify_inventory_authority(authority_input, expected_instance_revision, expected_policy_revision):
    """Verify the #1173 inventory authority completeness summary (RESCOPE §3.1 item 2)."""
    if not isinstance(authority_input, dict):
        _fail('inventory_incomplete', CONFLICT)
    if authority_input.get('format') != 'qsl_account_mapping_authority_input.v1':
        _fail('inventory_incomplete', CONFLICT)
    if (authority_input.get('authoritative') is not True
            or authority_input.get('reasons') != []
            or authority_input.get('policy_error') is not None):
        _fail('inventory_incomplete', CONFLICT)
    inst_rev = authority_input.get('instance_revision')
    pol_rev = authority_input.get('policy_revision')
    if not is_strict_revision(inst_rev) or not is_strict_revision(pol_rev):
        _fail('inventory_incomplete', CONFLICT)
    if inst_rev != expected_instance_revision or pol_rev != expected_policy_revision:
        _fail('inventory_revision_mismatch', CONFLICT)
    return authority_input


def verify_completeness_contract(live_observation, artifact_document):
    """Verify readback completeness: B2 indicator at declared scope + validated structural inventory."""
    if not isinstance(live_observation, LiveObservation):
        _fail('observation_not_acquired')
    if live_observation.uncovered:
        _fail('physical_grouping_incomplete')
    if not isinstance(artifact_document, dict):
        _fail('enrollment_artifact_invalid')
    if (artifact_document.get('instance_revision') != live_observation.instance_revision
            or artifact_document.get('policy_revision') != live_observation.policy_revision):
        _fail('structural_revision_mismatch', CONFLICT)
    structural = artifact_document.get('groups')
    if not isinstance(structural, list):
        _fail('enrollment_artifact_invalid')
    structure = {}
    for group in structural:
        pairs = certified_group_deployments(group['deployments'])
        gid = certify_group_identity(pairs)
        if gid in structure:
            _fail('grouping_mismatch', CONFLICT)
        structure[gid] = (pairs, group)
    live_gids = {certify_group_identity(live.deployments): live for live in live_observation.groups}
    if len(live_gids) != len(live_observation.groups) or set(structure) != set(live_gids):
        _fail('grouping_mismatch', CONFLICT)
    for gid, live in live_gids.items():
        if structure[gid][0] != live.deployments:
            _fail('grouping_mismatch', CONFLICT)
    return structure


def validate_consumer_provenance(roster_document, *, clock, expected_run_id=None, expected_run_scope=None,
                                 expected_selection=None):
    """Consumer-side integrity, provenance, run-binding, and freshness check only.

    Never re-derives ownership or reads live source records.
    """
    doc = validate_roster_envelope(roster_document)
    if doc['format'] != ROSTER_FORMAT or doc['status'] != STATUS_AVAILABLE:
        _fail('roster_not_authoritative')
    check_envelope_freshness(doc, clock)
    if expected_run_id is not None and doc['run_id'] != expected_run_id:
        _fail('roster_scope_invalid')
    if expected_run_scope is not None and doc['run_scope'] != expected_run_scope:
        _fail('roster_scope_invalid')
    if expected_selection is not None and doc['selection'] != expected_selection:
        _fail('enrollment_selection_invalid')
    return doc


__all__ = [
    'ACQUISITION_KEYS', 'ARTIFACT_FORMAT', 'ARTIFACT_GROUP_KEYS', 'ARTIFACT_KEYS', 'AuthorityError',
    'BINDING_FIELDS', 'CODE', 'CONFIG_IDENTITY_FIELDS', 'CONFLICT', 'COUNT_KEYS', 'DENIAL_CODES',
    'EFFECTIVE_EXPORT_FORMAT', 'EFFECTIVE_FIELDS', 'EVIDENCE_SCOPE', 'EVIDENCE_STATES', 'FAILURE_KINDS',
    'GENERATION_WINDOW_KEYS', 'GROUP_ID', 'GROUP_REASON_CODES', 'INSTANT', 'LEGACY_MODE', 'MANAGEMENT_CLASSES',
    'MANAGEMENT_ROUTE', 'MANAGEMENT_STATUSES', 'MAPPING_MODE', 'MAX_FUTURE_SKEW', 'MAX_OBSERVATION_AGE',
    'MAX_READ_TIMEOUT', 'MAX_RESPONSE_BYTES', 'OBSERVATION_BINDING_FIELDS', 'ORIGIN', 'POLICY_DENIALS',
    'PRIVATE_LOCATOR_FIELDS', 'PROJECTION_FORMAT', 'PrepInputs', 'READBACK_FORMAT', 'READBACK_GROUP_KEYS',
    'READBACK_KEYS', 'ROSTER_FORMAT', 'ROSTER_GROUP_KEYS', 'ROSTER_KEYS', 'ROSTER_STATUSES', 'RUN_BINDING_FIELDS',
    'RUN_BINDING_OPTIONS', 'RUN_SCOPE_KEYS', 'RUNTIME_TARGET_FIELDS', 'RosterBootConfig', 'SCHEMA_FILES', 'SCOPES',
    'SELECTION_FORMAT', 'SELECTION_KEYS', 'SHA256', 'SOURCE_REVISION_KEYS', 'STALE', 'STATUS_AVAILABLE',
    'STATUS_FALLBACK', 'STATUS_UNAVAILABLE', 'ServiceAuthPolicy', 'UNAVAILABLE', 'UNCOVERED_KEYS',
    'UNCOVERED_REASON_CODES', 'VERSION', 'canonical_envelope_payload', 'certified_group_deployments',
    'certify_group_identity', 'check_envelope_freshness', 'compute_content_hash', 'exact_keys',
    'expected_denial', 'expected_status', 'extract_raw_prep_inputs', 'format_utc', 'is_codes', 'is_identifier',
    'is_member', 'is_strict_revision', 'load_roster_schema', 'observation_age', 'parse_instant',
    'private_identities', 'run_binding_ok', 'strict_json', 'trusted_clock', 'validate_artifact',
    'validate_consumer_provenance', 'validate_effective_records', 'validate_ownership_contract',
    'validate_projection_revisions', 'validate_readback', 'validate_roster_envelope', 'validate_selection_document',
    'verify_completeness_contract', 'verify_content_hash', 'verify_inventory_authority', 'verify_packaged_schemas',
    'within_window',
]
