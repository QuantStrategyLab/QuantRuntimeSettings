"""Closed qsl_digest_account_roster.v1 envelope builder, strict validator and schema resources."""
from __future__ import annotations

import json
import os
from collections import Counter
from datetime import UTC
from pathlib import Path

from digest_roster_authority import (
    BINDING_FIELDS, CODE, CONFLICT, DENIAL_CODES, EVIDENCE_SCOPE, EVIDENCE_STATES, GROUP_REASON_CODES,
    MANAGEMENT_CLASSES, MANAGEMENT_ROUTE, MANAGEMENT_STATUSES, MAX_FUTURE_SKEW, MAX_OBSERVATION_AGE,
    OBSERVATION_BINDING_FIELDS, RUNTIME_TARGET_FIELDS, SCOPES, SHA256, STALE, UNAVAILABLE, AuthorityError,
    _expected_status, _fail, _identifier, _member, _revision, expected_denial, parse_instant,
    private_identities, run_binding_ok, strict_json,
)
from digest_roster_generation import CURRENT, FALLBACK, ROSTER_UNAVAILABLE, GenerationOutcome
from display_names import safe_display_text

ROSTER_FORMAT = 'qsl_digest_account_roster.v1'
GENERATION_STATUSES = frozenset({CURRENT, FALLBACK, ROSTER_UNAVAILABLE})
FAILURE_KINDS = frozenset({STALE, CONFLICT, UNAVAILABLE})

SCHEMA_FILES = (
    'qsl-digest-account-roster.v1.schema.json',
    'qsl-digest-enrollment-selection.v1.schema.json',
    'qsl-digest-enrollment-artifact.v1.schema.json',
)

ROSTER_KEYS = frozenset({
    'format', 'generation_status', 'observed_at', 'decided_at', 'observation_age_seconds',
    'live_source', 'evidence_scope', 'instance_revision', 'policy_revision', 'selection',
    'prepared_at', 'enrollment_observed_at', 'physical_grouping_complete', 'failure_code',
    'failure_kind', 'counts', 'groups', 'uncovered_deployments', 'rejected',
})
COUNT_KEYS = frozenset({
    'physical_accounts', 'display_groups', 'display_deployments', 'uncovered_deployments', *MANAGEMENT_STATUSES,
})
UNCOVERED_REASON_CODES = frozenset({*GROUP_REASON_CODES, 'deployment_uncovered'})
GROUP_KEYS = frozenset({
    'deployments', 'labels', 'scope', 'management_class', 'management_status', 'evidence_state',
    'processing_eligible', 'processing_denial', 'reasons', 'applied', 'legacy_run_bindings',
    'observation_bindings',
})
UNCOVERED_KEYS = frozenset({
    'platform', 'key', 'management_status', 'evidence_state', 'reasons',
    'processing_eligible', 'processing_denial',
})
SELECTION_KEYS = frozenset({
    'source', 'version', 'artifact_sha256', 'membership_version', 'label_version', 'link_version',
})


def _format_utc(value):
    utc = value.astimezone(UTC)
    timespec = 'microseconds' if utc.microsecond else 'seconds'
    return utc.isoformat(timespec=timespec).replace('+00:00', 'Z')


def _exact(value, keys, code='roster_shape_invalid'):
    if not isinstance(value, dict) or frozenset(value) != keys:
        _fail(code)


def _codes(value, vocabulary=None):
    return isinstance(value, list) and all(
        isinstance(item, str) and CODE.fullmatch(item) and (vocabulary is None or item in vocabulary)
        for item in value)


def _deployment_total(groups, uncovered):
    return sum(len(group['deployments']) for group in groups) + len(uncovered)


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


def build_roster_envelope(outcome):
    """Build and strictly validate a qsl_digest_account_roster.v1 document from a GenerationOutcome."""
    if not isinstance(outcome, GenerationOutcome):
        _fail('roster_outcome_invalid')
    if outcome.status not in GENERATION_STATUSES:
        _fail('roster_shape_invalid')

    if outcome.status == CURRENT:
        context = outcome.context
        if context is None:
            _fail('roster_shape_invalid')
        roster = context.roster
        sel = roster.selection
        groups = []
        status_counts = Counter()
        for group in roster.groups:
            live = group.live
            status_counts[live.management_status] += 1
            applied = (
                {'management_enabled': live.applied[0], 'revision': live.applied[1], 'effective_at': live.applied[2]}
                if live.applied is not None else None
            )
            groups.append({
                'deployments': [{'platform': pair[0], 'legacy_key': pair[1]} for pair in group.deployments],
                'labels': [{'platform': p, 'legacy_key': k, 'label': lbl} for p, k, lbl in group.labels],
                'scope': live.scope,
                'management_class': live.management_class,
                'management_status': live.management_status,
                'evidence_state': live.evidence_state,
                'processing_eligible': live.processing_eligible,
                'processing_denial': live.processing_denial,
                'reasons': list(live.reasons),
                'applied': applied,
                'legacy_run_bindings': [dict(item) for item in group.legacy_run_bindings],
                'observation_bindings': [dict(item) for item in group.observation_bindings],
            })
        uncovered = [
            {
                'platform': pair[0],
                'key': pair[1],
                'management_status': 'unknown',
                'evidence_state': 'unknown',
                'reasons': ['deployment_uncovered'],
                'processing_eligible': False,
                'processing_denial': 'management_status_unknown',
            }
            for pair in roster.observation.uncovered
        ]
        document = {
            'format': ROSTER_FORMAT,
            'generation_status': CURRENT,
            'observed_at': context.observed_at,
            'decided_at': _format_utc(context.decided_at),
            'observation_age_seconds': round(outcome.age.total_seconds(), 6) if outcome.age is not None else None,
            'live_source': MANAGEMENT_ROUTE,
            'evidence_scope': EVIDENCE_SCOPE,
            'instance_revision': roster.observation.instance_revision,
            'policy_revision': roster.observation.policy_revision,
            'selection': {
                'source': sel.source,
                'version': sel.version,
                'artifact_sha256': sel.artifact_sha256,
                'membership_version': sel.membership_version,
                'label_version': sel.label_version,
                'link_version': sel.link_version,
            },
            'prepared_at': roster.prepared_at,
            'enrollment_observed_at': roster.enrollment_observed_at,
            'physical_grouping_complete': True,
            'failure_code': None,
            'failure_kind': None,
            'counts': {
                'physical_accounts': len(groups),
                'display_groups': len(groups),
                'display_deployments': _deployment_total(groups, uncovered),
                'uncovered_deployments': len(uncovered),
                **{status: status_counts.get(status, 0) for status in MANAGEMENT_STATUSES},
            },
            'groups': groups,
            'uncovered_deployments': uncovered,
            'rejected': dict(roster.rejected),
        }
    elif outcome.status == FALLBACK:
        snapshot = outcome.snapshot
        if snapshot is None or not snapshot.headers:
            _fail('roster_shape_invalid')
        code = outcome.failure_code or 'management_read_unavailable'
        kind = outcome.failure_kind or UNAVAILABLE
        groups = [
            {
                'deployments': [{'platform': pair[0], 'legacy_key': pair[1]} for pair in header.deployments],
                'labels': [{'platform': p, 'legacy_key': k, 'label': lbl} for p, k, lbl in header.labels],
                'scope': header.scope,
                'management_class': None,
                'management_status': 'unknown',
                'evidence_state': 'unknown',
                'processing_eligible': False,
                'processing_denial': 'management_status_unknown',
                'reasons': [code],
                'applied': None,
                'legacy_run_bindings': [],
                'observation_bindings': [],
            }
            for header in snapshot.headers
        ]
        document = {
            'format': ROSTER_FORMAT,
            'generation_status': FALLBACK,
            'observed_at': snapshot.observed_at,
            'decided_at': None,
            'observation_age_seconds': round(outcome.age.total_seconds(), 6) if outcome.age is not None else None,
            'live_source': MANAGEMENT_ROUTE,
            'evidence_scope': EVIDENCE_SCOPE,
            'instance_revision': None,
            'policy_revision': None,
            'selection': None,
            'prepared_at': None,
            'enrollment_observed_at': None,
            'physical_grouping_complete': False,
            'failure_code': code,
            'failure_kind': kind,
            'counts': {
                'physical_accounts': None,
                'display_groups': len(groups),
                'display_deployments': _deployment_total(groups, ()),
                'uncovered_deployments': 0,
                **{status: None for status in MANAGEMENT_STATUSES},
            },
            'groups': groups,
            'uncovered_deployments': [],
            'rejected': {},
        }
    else:
        code = outcome.failure_code or 'management_read_unavailable'
        kind = outcome.failure_kind or UNAVAILABLE
        document = {
            'format': ROSTER_FORMAT,
            'generation_status': ROSTER_UNAVAILABLE,
            'observed_at': None,
            'decided_at': None,
            'observation_age_seconds': None,
            'live_source': MANAGEMENT_ROUTE,
            'evidence_scope': EVIDENCE_SCOPE,
            'instance_revision': None,
            'policy_revision': None,
            'selection': None,
            'prepared_at': None,
            'enrollment_observed_at': None,
            'physical_grouping_complete': False,
            'failure_code': code,
            'failure_kind': kind,
            'counts': {
                'physical_accounts': None,
                'display_groups': 0,
                'display_deployments': 0,
                'uncovered_deployments': 0,
                **{status: None for status in MANAGEMENT_STATUSES},
            },
            'groups': [],
            'uncovered_deployments': [],
            'rejected': {},
        }
    return validate_roster_envelope(document)


def validate_roster_envelope(document):
    """Strictly validate one qsl_digest_account_roster.v1 document, or raise AuthorityError."""
    if isinstance(document, (bytes, bytearray, str)):
        document = strict_json(document)
    if not isinstance(document, dict):
        _fail('roster_shape_invalid')
    if 'format' in document and document['format'] != ROSTER_FORMAT:
        _fail('roster_format_unsupported')
    _exact(document, ROSTER_KEYS, 'roster_shape_invalid')
    status = document['generation_status']
    if not _member(status, GENERATION_STATUSES):
        _fail('roster_shape_invalid')
    if document['live_source'] != MANAGEMENT_ROUTE or document['evidence_scope'] != EVIDENCE_SCOPE:
        _fail('roster_scope_invalid')
    if type(document['physical_grouping_complete']) is not bool:
        _fail('roster_shape_invalid')

    for field_name in ('observed_at', 'decided_at', 'prepared_at', 'enrollment_observed_at'):
        val = document[field_name]
        if val is not None and parse_instant(val) is None:
            _fail('roster_time_invalid', STALE)
    age = document['observation_age_seconds']
    if age is not None and (isinstance(age, bool) or not isinstance(age, (int, float)) or age < 0):
        _fail('roster_time_invalid', STALE)
    for field_name in ('instance_revision', 'policy_revision'):
        val = document[field_name]
        if val is not None and not _revision(val):
            _fail('roster_revision_invalid')
    if document['failure_code'] is not None and (
            not isinstance(document['failure_code'], str) or not CODE.fullmatch(document['failure_code'])):
        _fail('roster_shape_invalid')
    if document['failure_kind'] is not None and not _member(document['failure_kind'], FAILURE_KINDS):
        _fail('roster_shape_invalid')

    selection = document['selection']
    if selection is not None:
        _exact(selection, SELECTION_KEYS, 'roster_selection_invalid')
        if not isinstance(selection['artifact_sha256'], str) or not SHA256.fullmatch(selection['artifact_sha256']):
            _fail('roster_selection_invalid')
        if not all(isinstance(selection[name], str) and selection[name] for name in SELECTION_KEYS - {'artifact_sha256'}):
            _fail('roster_selection_invalid')

    if not isinstance(document['groups'], list) or not isinstance(document['uncovered_deployments'], list):
        _fail('roster_shape_invalid')
    if not isinstance(document['rejected'], dict) or not all(
            isinstance(k, str) and CODE.fullmatch(k) and type(v) is int and v > 0
            for k, v in document['rejected'].items()):
        _fail('roster_shape_invalid')

    claims = Counter()
    runs, slots, targets, obs_sources = set(), set(), set(), set()
    reasons_vocabulary = GROUP_REASON_CODES if status == CURRENT else None
    group_statuses = Counter()
    for raw in document['groups']:
        _exact(raw, GROUP_KEYS, 'roster_group_invalid')
        if not isinstance(raw['deployments'], list) or not raw['deployments']:
            _fail('roster_group_invalid')
        pairs = []
        for item in raw['deployments']:
            _exact(item, frozenset({'platform', 'legacy_key'}), 'roster_group_invalid')
            if not _identifier(item['platform']) or not _identifier(item['legacy_key']):
                _fail('roster_group_invalid')
            pairs.append((item['platform'], item['legacy_key']))
        if len(set(pairs)) != len(pairs):
            _fail('deployment_claimed_by_multiple_accounts', CONFLICT)
        claims.update(pairs)
        pair_set = set(pairs)

        if (not _member(raw['scope'], SCOPES)
                or (raw['management_class'] is not None and not _member(raw['management_class'], MANAGEMENT_CLASSES))
                or not _member(raw['management_status'], MANAGEMENT_STATUSES)
                or not _member(raw['evidence_state'], EVIDENCE_STATES)
                or type(raw['processing_eligible']) is not bool
                or not (raw['processing_denial'] is None or _member(raw['processing_denial'], DENIAL_CODES))
                or not _codes(raw['reasons'], reasons_vocabulary)
                or not isinstance(raw['labels'], list)
                or not isinstance(raw['legacy_run_bindings'], list)
                or not isinstance(raw['observation_bindings'], list)):
            _fail('roster_group_invalid')
        private = private_identities([binding for binding in (*raw['legacy_run_bindings'],
                                                              *raw['observation_bindings'])
                                      if isinstance(binding, dict)])
        for lbl in raw['labels']:
            _exact(lbl, frozenset({'platform', 'legacy_key', 'label'}), 'roster_group_invalid')
            if ((lbl['platform'], lbl['legacy_key']) not in pair_set
                    or not isinstance(lbl['label'], str) or not lbl['label']
                    or len(lbl['label']) > 70 or safe_display_text(lbl['label']) != lbl['label']):
                _fail('roster_group_invalid')
            if lbl['label'] in private:
                _fail('roster_label_private_identity', CONFLICT)

        applied = raw['applied']
        if applied is not None:
            _exact(applied, frozenset({'management_enabled', 'revision', 'effective_at'}), 'roster_group_invalid')
            effective = parse_instant(applied['effective_at'])
            if (type(applied['management_enabled']) is not bool or not _revision(applied['revision'])
                    or effective is None):
                _fail('roster_group_invalid')
            observed = parse_instant(document['observed_at'])
            if observed is not None and effective > observed:
                _fail('applied_effective_after_observation', STALE)
            applied_tuple = (applied['management_enabled'], applied['revision'], applied['effective_at'])
        else:
            applied_tuple = None

        if raw['management_class'] is not None:
            expected_status = _expected_status(raw['management_class'], raw['evidence_state'], applied_tuple)
            processing = (raw['management_class'] == 'eligible' and raw['evidence_state'] == 'known'
                          and raw['management_status'] == 'managed')
            if (expected_status != raw['management_status'] or raw['processing_eligible'] is not processing
                    or raw['processing_denial'] != expected_denial(processing, expected_status, raw['reasons'])):
                _fail('roster_status_inconsistent', CONFLICT)
        elif raw['management_status'] != 'unknown' or raw['processing_eligible'] is not False or applied is not None:
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
            _exact(binding, frozenset(OBSERVATION_BINDING_FIELDS), 'roster_binding_invalid')
            if (not isinstance(binding['binding_id'], str) or binding['binding_id'] in obs_sources
                    or (binding['platform'], binding['legacy_key']) not in pair_set
                    or not _member(binding['broker_environment'], {'paper', 'live'})
                    or binding['broker_environment'] != raw['scope']
                    or not all(_identifier(binding[name]) for name in OBSERVATION_BINDING_FIELDS
                               if name != 'opaque_account_uid')
                    or not (binding['opaque_account_uid'] is None or _identifier(binding['opaque_account_uid']))):
                _fail('roster_binding_invalid', CONFLICT)
            obs_sources.add(binding['binding_id'])
        group_statuses[raw['management_status']] += 1

    uncovered = []
    for raw in document['uncovered_deployments']:
        _exact(raw, UNCOVERED_KEYS, 'roster_uncovered_invalid')
        if (not _identifier(raw['platform']) or not _identifier(raw['key'])
                or raw['management_status'] != 'unknown' or raw['evidence_state'] != 'unknown'
                or raw['processing_eligible'] is not False or not _codes(raw['reasons'], UNCOVERED_REASON_CODES)
                or not _member(raw['processing_denial'], DENIAL_CODES)):
            _fail('roster_uncovered_invalid')
        uncovered.append((raw['platform'], raw['key']))
    claims.update(uncovered)
    if any(count > 1 for count in claims.values()):
        _fail('deployment_claimed_by_multiple_accounts', CONFLICT)

    counts = document['counts']
    _exact(counts, COUNT_KEYS, 'roster_counts_invalid')
    if type(counts['display_groups']) is not int or counts['display_groups'] != len(document['groups']):
        _fail('roster_counts_inconsistent', CONFLICT)
    if type(counts['uncovered_deployments']) is not int or counts['uncovered_deployments'] != len(uncovered):
        _fail('roster_counts_inconsistent', CONFLICT)
    if type(counts['display_deployments']) is not int or counts['display_deployments'] != sum(claims.values()):
        _fail('roster_counts_inconsistent', CONFLICT)

    if status == CURRENT:
        if (document['observed_at'] is None or document['decided_at'] is None
                or document['instance_revision'] is None or document['policy_revision'] is None
                or document['selection'] is None or document['prepared_at'] is None
                or document['enrollment_observed_at'] is None
                or document['physical_grouping_complete'] is not True
                or document['failure_code'] is not None or document['failure_kind'] is not None):
            _fail('roster_shape_invalid')
        if any(group['management_class'] is None for group in document['groups']):
            _fail('roster_status_inconsistent', CONFLICT)
        # A current document is coherent in time: the decision falls within
        # -30 s <= G - T <= 300 s of the observation and the age it reports
        # is exactly the displayed age at that decision.
        observed, decided = parse_instant(document['observed_at']), parse_instant(document['decided_at'])
        delta = decided - observed
        if (not -MAX_FUTURE_SKEW <= delta <= MAX_OBSERVATION_AGE or age is None
                or abs(age - max(0.0, delta.total_seconds())) > 1e-6):
            _fail('roster_time_invalid', STALE)
        if type(counts['physical_accounts']) is not int or counts['physical_accounts'] != len(document['groups']):
            _fail('roster_counts_inconsistent', CONFLICT)
        for name in MANAGEMENT_STATUSES:
            if type(counts[name]) is not int or counts[name] != group_statuses.get(name, 0):
                _fail('roster_counts_inconsistent', CONFLICT)
    elif status == FALLBACK:
        if (document['observed_at'] is None or document['decided_at'] is not None
                or document['instance_revision'] is not None or document['policy_revision'] is not None
                or document['selection'] is not None or document['prepared_at'] is not None
                or document['enrollment_observed_at'] is not None
                or document['physical_grouping_complete'] is not False
                or document['failure_code'] is None or document['failure_kind'] is None
                or not document['groups'] or document['uncovered_deployments'] or document['rejected']):
            _fail('roster_shape_invalid')
        for group in document['groups']:
            if (group['management_class'] is not None or group['management_status'] != 'unknown'
                    or group['evidence_state'] != 'unknown' or group['legacy_run_bindings']
                    or group['observation_bindings']):
                _fail('roster_status_inconsistent', CONFLICT)
        if any(counts[name] is not None for name in ('physical_accounts', *MANAGEMENT_STATUSES)):
            _fail('roster_counts_inconsistent', CONFLICT)
    else:
        if (document['observed_at'] is not None or document['decided_at'] is not None
                or document['observation_age_seconds'] is not None
                or document['instance_revision'] is not None or document['policy_revision'] is not None
                or document['selection'] is not None or document['prepared_at'] is not None
                or document['enrollment_observed_at'] is not None
                or document['physical_grouping_complete'] is not False
                or document['failure_code'] is None or document['failure_kind'] is None
                or document['groups'] or document['uncovered_deployments'] or document['rejected']):
            _fail('roster_shape_invalid')
        if any(counts[name] is not None for name in ('physical_accounts', *MANAGEMENT_STATUSES)):
            _fail('roster_counts_inconsistent', CONFLICT)

    return document


__all__ = [
    'ROSTER_FORMAT', 'SCHEMA_FILES', 'build_roster_envelope', 'load_roster_schema',
    'validate_roster_envelope', 'verify_packaged_schemas',
]
