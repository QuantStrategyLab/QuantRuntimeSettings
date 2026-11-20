"""Acquire, validate and compose one generation's account-management authority.

The only live management producer is B2's registered read
(`GET /api/admin/account-management`, format
`qsl_account_management_readback.v1`, scope `runtime_instances_sqlite`). This
module validates that envelope strictly, acquires it over a bounded,
cache-bypassing HTTPS GET with a dormant service-authentication boundary,
reads the currently selected enrollment artifact through an authenticated,
version-qualified selection, prepares that artifact offline from the full B1
projection and B2's applied-row adapter, and joins the live groups to it by
exact deployment membership.

Class, status, evidence, scope and applied values always come from the live
read; the enrollment artifact supplies membership, safe labels and bindings
only. A document handed in by a caller is never evidence of acquisition: only
an observation this module acquired, and an artifact it loaded through the
selection, can be composed. Nothing here writes, sends or reads a secret, and
no identifier is normalized: deployment keys and opaque bindings are compared
and carried byte for byte.
"""
from __future__ import annotations

import hashlib
import json
import re
import ssl
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from urllib.error import HTTPError, URLError

from display_names import safe_display_text
from project_digest_display_roster import BINDING_FIELDS, CONFIG_IDENTITY_FIELDS

READBACK_FORMAT = 'qsl_account_management_readback.v1'
EFFECTIVE_EXPORT_FORMAT = 'qsl_account_management_effective_export.v1'
PROJECTION_FORMAT = 'qsl_account_management_projection.v1'
SELECTION_FORMAT = 'qsl_digest_enrollment_selection.v1'
ARTIFACT_FORMAT = 'qsl_digest_enrollment_artifact.v1'
EVIDENCE_SCOPE = 'runtime_instances_sqlite'
MANAGEMENT_ROUTE = '/api/admin/account-management'
LEGACY_MODE, MAPPING_MODE = 'legacy', 'mapping_v1'

MAX_OBSERVATION_AGE = timedelta(seconds=300)
MAX_FUTURE_SKEW = timedelta(seconds=30)
MAX_RESPONSE_BYTES = 1 << 20
MAX_READ_TIMEOUT = 20.0

MANAGEMENT_CLASSES = frozenset({'eligible', 'display_only'})
MANAGEMENT_STATUSES = ('managed', 'management_disabled', 'not_under_management', 'unknown')
EVIDENCE_STATES = frozenset({'known', 'unknown', 'conflict', 'stale'})
SCOPES = frozenset({'paper', 'live', 'unknown'})
EFFECTIVE_FIELDS = ('platform', 'legacy_key', 'management_enabled', 'revision', 'effective_at')
RUN_BINDING_FIELDS = (*BINDING_FIELDS, 'strategy_profile')
OBSERVATION_BINDING_FIELDS = ('binding_id', 'platform', 'legacy_key', 'opaque_account_uid',
                              'broker_environment', 'account_scope')

# B2's producer-defined reason vocabulary (resolveManagement, the effective
# state reducer and storedPolicy in application/runtime_instances and
# application/account_mapping). A well-formed code outside it is not
# authority; parity with the JS sources is tested.
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
DENIAL_CODES = frozenset({*POLICY_DENIALS, 'management_disabled', 'management_not_under_management',
                          'management_status_unknown'})
# Existing legacy-binding source options, with their original validation.
RUN_BINDING_OPTIONS = {
    'snapshot_only': lambda value: value is True,
    'receipt_candidate': lambda value: value is True,
    'expected_runs': lambda value: type(value) is int and value > 0,
}
RUNTIME_TARGET_FIELDS = ('platform_id', 'opaque_account_uid', 'target_id', 'strategy_profile')

# Failure kinds keep the Q5 distinction a fallback must preserve.
UNAVAILABLE, STALE, CONFLICT = 'unavailable', 'stale', 'conflict'
CODE = re.compile(r'[a-z0-9][a-z0-9_]{0,63}')
INSTANT = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z')
VERSION = re.compile(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}')
SHA256 = re.compile(r'[0-9a-f]{64}')

READBACK_KEYS = frozenset({'ok', 'format', 'evidence_scope', 'status', 'reasons', 'observed_at',
                           'instance_revision', 'policy_revision', 'policy_status',
                           'physical_grouping_complete', 'counts', 'groups', 'uncovered_deployments',
                           'effective_export'})
COUNT_KEYS = frozenset({'physical_accounts', 'display_deployments', 'uncovered_deployments',
                        *MANAGEMENT_STATUSES})
GROUP_KEYS = frozenset({'management_class', 'management_status', 'evidence_state', 'reasons', 'scope',
                        'processing_eligible', 'processing_denial', 'applied', 'deployments'})
UNCOVERED_KEYS = frozenset({'platform', 'key', 'management_status', 'evidence_state', 'reasons',
                            'processing_eligible', 'processing_denial'})


class AuthorityError(ValueError):
    """A bounded, safe failure code; never carries an identity or a payload."""

    def __init__(self, code, kind=UNAVAILABLE):
        if not CODE.fullmatch(code) or kind not in {UNAVAILABLE, STALE, CONFLICT}:
            raise ValueError('authority_error_invalid')
        super().__init__(code)
        self.code, self.kind = code, kind


def _fail(code, kind=UNAVAILABLE):
    raise AuthorityError(code, kind)


# Only this module mints these markers; a caller-built observation or artifact
# carries neither and cannot be composed.
_ACQUIRED, _SELECTED = object(), object()


def parse_instant(value):
    """A strict UTC instant (`...Z`), or None. No offsets, no rounding."""
    if not isinstance(value, str) or not INSTANT.fullmatch(value):
        return None
    try:
        return datetime.fromisoformat(value[:-1] + '+00:00')
    except ValueError:
        return None


def trusted_clock(value):
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() != timedelta(0):
        _fail('generation_clock_unavailable')
    return value.astimezone(UTC)


def within_window(observed, clock):
    """Exactly -30 s <= G - T <= 300 s, both bounds inclusive, no rounding."""
    if not isinstance(observed, datetime):
        return False
    delta = trusted_clock(clock) - observed
    return -MAX_FUTURE_SKEW <= delta <= MAX_OBSERVATION_AGE


def observation_age(observed, clock):
    """Displayed age; a within-skew future observation shows zero."""
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


def _revision(value):
    return type(value) is int and value >= 0


def _identifier(value):
    # Opaque identifiers are carried exactly: any non-empty printable string,
    # case and inner/outer whitespace preserved.
    return isinstance(value, str) and bool(value) and value.isprintable() and len(value) <= 200


def _codes(value, vocabulary=None):
    return isinstance(value, list) and all(
        isinstance(item, str) and CODE.fullmatch(item) and (vocabulary is None or item in vocabulary)
        for item in value)


def _member(value, allowed):
    """Enum membership after a type check: an unhashable or non-string value
    is simply not a member."""
    return isinstance(value, str) and value in allowed


def expected_denial(eligible, status, reasons):
    """B2's processingDenial over one resolved group or deployment."""
    if eligible:
        return None
    for reason in POLICY_DENIALS:
        if reason in reasons:
            return reason
    return {'management_disabled': 'management_disabled',
            'not_under_management': 'management_not_under_management'}.get(status, 'management_status_unknown')


def run_binding_ok(binding):
    """A legacy run binding: the five identity/profile fields exactly, plus
    any allowlisted source option with its original validation."""
    return (isinstance(binding, dict) and set(RUN_BINDING_FIELDS) <= set(binding)
            and set(binding) <= {*RUN_BINDING_FIELDS, *RUN_BINDING_OPTIONS}
            and all(_identifier(binding[name]) for name in RUN_BINDING_FIELDS)
            and all(RUN_BINDING_OPTIONS[name](binding[name]) for name in binding if name in RUN_BINDING_OPTIONS))


def private_identities(group_bindings):
    """Identity values of a group's bindings that a display label may never equal."""
    values = set()
    for binding in group_bindings:
        for name in ('opaque_account_uid', 'target_id', 'candidate_slot', 'account_hint', 'binding_id'):
            if isinstance(binding.get(name), str):
                values.add(binding[name])
    return values


def _exact(value, keys, code):
    if not isinstance(value, dict) or frozenset(value) != keys:
        _fail(code)


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
        return (self.deployments, self.management_class, self.management_status, self.evidence_state,
                self.scope, self.reasons, self.processing_eligible, self.processing_denial, self.applied)


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
        """Every compared axis: global revisions, membership/class/scope,
        status/evidence and the per-group applied tuple including nulls."""
        return (self.instance_revision, self.policy_revision,
                tuple(group.vector() for group in self.groups), self.uncovered)

    def group(self, deployments):
        key = frozenset(deployments)
        return next((group for group in self.groups if group.key == key), None)


def _expected_status(management_class, evidence, applied):
    if evidence != 'known':
        return 'unknown'
    if management_class == 'display_only':
        return 'not_under_management'
    if applied is None:
        return None
    return 'managed' if applied[0] else 'management_disabled'


def validate_readback(document):
    """Validate one B2 readback as current authority, or raise AuthorityError.

    Authority requires the exact format, `status: available` with no global
    reasons, an available policy and complete physical grouping. Every group
    must be internally consistent with B2's reducer, every deployment claimed
    once, declared counts must match the enumerated contents and the applied
    export must agree with the groups it came from.
    """
    if isinstance(document, (bytes, bytearray, str)):
        document = strict_json(document)
    _exact(document, READBACK_KEYS, 'readback_shape_invalid')
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
    if not _revision(document['instance_revision']) or not _revision(document['policy_revision']):
        _fail('readback_revision_invalid')
    if not isinstance(document['groups'], list) or not isinstance(document['uncovered_deployments'], list):
        _fail('readback_shape_invalid')

    claims = Counter()
    groups = []
    for raw in document['groups']:
        _exact(raw, GROUP_KEYS, 'readback_group_invalid')
        if (not _member(raw['management_class'], MANAGEMENT_CLASSES)
                or not _member(raw['management_status'], MANAGEMENT_STATUSES)
                or not _member(raw['evidence_state'], EVIDENCE_STATES) or not _member(raw['scope'], SCOPES)
                or not _codes(raw['reasons'], GROUP_REASON_CODES) or type(raw['processing_eligible']) is not bool
                or not (raw['processing_denial'] is None or _member(raw['processing_denial'], DENIAL_CODES))):
            _fail('readback_group_invalid')
        if not isinstance(raw['deployments'], list) or not raw['deployments']:
            _fail('readback_group_invalid')
        pairs = []
        for item in raw['deployments']:
            _exact(item, frozenset({'platform', 'key', 'present'}), 'readback_group_invalid')
            if not _identifier(item['platform']) or not _identifier(item['key']):
                _fail('readback_group_invalid')
            if item['present'] is not True:
                _fail('deployment_member_lost')
            pairs.append((item['platform'], item['key']))
        claims.update(pairs)
        applied = raw['applied']
        if applied is not None:
            _exact(applied, frozenset({'management_enabled', 'revision', 'effective_at'}), 'readback_applied_invalid')
            effective = parse_instant(applied['effective_at'])
            if (type(applied['management_enabled']) is not bool or not _revision(applied['revision'])
                    or effective is None):
                _fail('readback_applied_invalid')
            if effective > observed:
                _fail('applied_effective_after_observation', STALE)
            applied = (applied['management_enabled'], applied['revision'], applied['effective_at'])
        status = _expected_status(raw['management_class'], raw['evidence_state'], applied)
        processing = (raw['management_class'] == 'eligible' and raw['evidence_state'] == 'known'
                      and raw['management_status'] == 'managed')
        if (status != raw['management_status'] or raw['processing_eligible'] is not processing
                or raw['processing_denial'] != expected_denial(processing, status, raw['reasons'])):
            _fail('readback_status_inconsistent', CONFLICT)
        groups.append(LiveGroup(tuple(sorted(pairs)), raw['management_class'], raw['management_status'],
                                raw['evidence_state'], raw['scope'], tuple(raw['reasons']), processing,
                                raw['processing_denial'], applied))
    uncovered = []
    for raw in document['uncovered_deployments']:
        _exact(raw, UNCOVERED_KEYS, 'readback_uncovered_invalid')
        if (not _identifier(raw['platform']) or not _identifier(raw['key'])
                or raw['management_status'] != 'unknown' or raw['evidence_state'] != 'unknown'
                or raw['processing_eligible'] is not False
                or not _codes(raw['reasons'], GROUP_REASON_CODES) or not _member(raw['processing_denial'], DENIAL_CODES)):
            _fail('readback_uncovered_invalid')
        uncovered.append((raw['platform'], raw['key']))
    claims.update(uncovered)
    if any(count > 1 for count in claims.values()):
        _fail('deployment_claimed_by_multiple_accounts', CONFLICT)

    counts = document['counts']
    _exact(counts, COUNT_KEYS, 'readback_counts_invalid')
    enumerated = Counter(group.management_status for group in groups)
    declared = {'physical_accounts': len(groups), 'display_deployments': sum(claims.values()),
                'uncovered_deployments': len(uncovered),
                **{status: enumerated.get(status, 0) for status in MANAGEMENT_STATUSES}}
    if any(type(counts[name]) is not int or counts[name] != value for name, value in declared.items()):
        _fail('readback_counts_inconsistent', CONFLICT)

    export = document['effective_export']
    _exact(export, frozenset({'format', 'instance_revision', 'policy_revision', 'records'}), 'effective_export_invalid')
    if (export['format'] != EFFECTIVE_EXPORT_FORMAT or export['instance_revision'] != document['instance_revision']
            or export['policy_revision'] != document['policy_revision'] or not isinstance(export['records'], list)):
        _fail('effective_export_invalid')
    records = validate_effective_records(export['records'])
    owner = {pair: group for group in groups for pair in group.deployments}
    # Siblings share one applied tuple; a disagreement B2 did not surface in
    # the group (for example effective times alone) is still a contradiction.
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

    return LiveObservation(document['observed_at'], document['instance_revision'], document['policy_revision'],
                           tuple(sorted(groups, key=lambda group: group.deployments)), tuple(sorted(uncovered)),
                           tuple(sorted(records)))


def validate_effective_records(rows):
    """B2's applied-row adapter output: exactly the five fields, strict types,
    one record per deployment. A duplicate is never resolved by a winner."""
    if not isinstance(rows, list):
        _fail('effective_records_invalid')
    records = []
    for row in rows:
        _exact(row, frozenset(EFFECTIVE_FIELDS), 'effective_records_invalid')
        if (not _identifier(row['platform']) or not _identifier(row['legacy_key'])
                or type(row['management_enabled']) is not bool or not _revision(row['revision'])
                or parse_instant(row['effective_at']) is None):
            _fail('effective_records_invalid')
        records.append(tuple(row[name] for name in EFFECTIVE_FIELDS))
    if len({record[:2] for record in records}) != len(records):
        _fail('effective_record_duplicate', CONFLICT)
    return records


# --- Boot configuration ------------------------------------------------------

ORIGIN = re.compile(r'https://[A-Za-z0-9.-]{1,253}(?::[0-9]{1,5})?')


@dataclass(frozen=True)
class ServiceAuthPolicy:
    """What a workload assertion must prove for the one registered read."""
    issuer: str
    audience: str
    subjects: frozenset
    max_lifetime: timedelta = timedelta(minutes=10)

    def __post_init__(self):
        if (not _identifier(self.issuer) or not _identifier(self.audience)
                or not isinstance(self.subjects, frozenset) or not self.subjects
                or not all(_identifier(subject) for subject in self.subjects)):
            raise ValueError('service_auth_policy_invalid')


@dataclass(frozen=True)
class RosterBootConfig:
    """Protected boot configuration. The mode is always explicit; mapping
    mode validates its reader settings and never requires the legacy array."""
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
        """Build from a protected configuration mapping; a missing mode is an
        error, never an implicit legacy or mapping default."""
        if not isinstance(raw, dict) or 'mode' not in raw:
            raise ValueError('digest_roster_mode_required')
        if raw['mode'] != MAPPING_MODE:
            return cls(raw['mode'])
        auth = raw.get('service_auth')
        if not isinstance(auth, dict) or not isinstance(auth.get('subjects'), list):
            raise ValueError('service_auth_policy_invalid')
        return cls(MAPPING_MODE, raw.get('origin'),
                   ServiceAuthPolicy(auth.get('issuer'), auth.get('audience'), frozenset(auth['subjects'])),
                   raw.get('enrollment_source'), raw.get('config_context'), raw.get('read_timeout', 10.0))


# --- Service authentication (dormant boundary) --------------------------------

@dataclass(frozen=True)
class ServiceAssertion:
    token: str = field(repr=False)
    issuer: str
    audience: str
    subject: str
    expires_at: datetime
    method: str
    path: str


class DormantServiceAuth:
    """The shipped authenticator: no workload credential exists for this read
    (the landed route authenticates an interactive admin session only), so
    acquisition fails closed into the Q5 fallback. Provisioning is F2."""

    def assertion(self, method, path, audience, clock):
        _fail('service_auth_unavailable')


def verify_assertion(assertion, policy, clock):
    """Check the assertion is for exactly this read before presenting it."""
    clock = trusted_clock(clock)
    if (not isinstance(assertion, ServiceAssertion) or not isinstance(assertion.token, str)
            or not assertion.token or any(char in assertion.token for char in '\r\n ')):
        _fail('service_auth_invalid')
    if assertion.issuer != policy.issuer or assertion.audience != policy.audience:
        _fail('service_auth_audience_rejected')
    if assertion.subject not in policy.subjects:
        _fail('service_auth_subject_rejected')
    if assertion.method != 'GET' or assertion.path != MANAGEMENT_ROUTE:
        _fail('service_auth_scope_rejected')
    expires = assertion.expires_at
    if (not isinstance(expires, datetime) or expires.tzinfo is None
            or not clock < expires <= clock + policy.max_lifetime):
        _fail('service_auth_expired')


# --- Transport and acquisition -------------------------------------------------

@dataclass(frozen=True)
class TransportResponse:
    status: int
    headers: dict          # lower-case names
    body: bytes = field(repr=False)
    url: str


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HttpsTransport:
    """Server-authenticated TLS, no redirects, bounded body and time. Never
    used by tests (the outbound trap rejects any socket)."""

    def get(self, url, headers, timeout):
        context = ssl.create_default_context()
        opener = urllib.request.build_opener(_NoRedirect(), urllib.request.HTTPSHandler(context=context))
        request = urllib.request.Request(url, headers=headers, method='GET')
        try:
            with opener.open(request, timeout=timeout) as response:
                body = response.read(MAX_RESPONSE_BYTES + 1)
                return TransportResponse(response.status, {k.lower(): v for k, v in response.headers.items()},
                                         body, response.geturl())
        except HTTPError as error:
            return TransportResponse(error.code, {k.lower(): v for k, v in (error.headers or {}).items()},
                                     b'', url)
        except TimeoutError:
            _fail('management_read_timeout')
        except (URLError, OSError, ValueError):
            _fail('management_read_unreachable')


class AcquisitionClient:
    """One bounded, cache-bypassing authenticated GET of B2's registered read."""

    def __init__(self, boot, authenticator=None, transport=None):
        if not isinstance(boot, RosterBootConfig) or boot.mode != MAPPING_MODE:
            raise ValueError('digest_roster_mode_invalid')
        self._boot = boot
        self._authenticator = authenticator or DormantServiceAuth()
        self._transport = transport or HttpsTransport()

    def acquire(self, clock, timeout=None):
        clock = trusted_clock(clock)
        bound = self._boot.read_timeout if timeout is None else min(timeout, self._boot.read_timeout)
        if bound <= 0:
            _fail('generation_deadline_exhausted')
        url = self._boot.origin + MANAGEMENT_ROUTE
        assertion = self._authenticator.assertion('GET', MANAGEMENT_ROUTE, self._boot.auth_policy.audience, clock)
        verify_assertion(assertion, self._boot.auth_policy, clock)
        headers = {'Accept': 'application/json', 'Cache-Control': 'no-cache, no-store', 'Pragma': 'no-cache',
                   'Authorization': f'Bearer {assertion.token}'}
        response = self._transport.get(url, headers, bound)
        if not isinstance(response, TransportResponse):
            _fail('management_read_failed')
        if 300 <= response.status < 400 or response.url != url:
            _fail('management_read_redirect_rejected')
        if response.status in {401, 403}:
            _fail('management_read_denied')
        if response.status != 200:
            _fail('management_read_failed')
        content_type = response.headers.get('content-type', '').split(';')[0].strip().lower()
        cache = {part.strip().lower() for part in response.headers.get('cache-control', '').split(',')}
        if content_type != 'application/json' or not {'private', 'no-store'} <= cache:
            _fail('management_read_headers_invalid')
        if len(response.body) > MAX_RESPONSE_BYTES:
            _fail('management_read_oversized')
        try:
            observation = validate_readback(strict_json(response.body))
        except AuthorityError:
            raise
        except (TypeError, KeyError, AttributeError, ValueError):
            _fail('readback_shape_invalid')
        return LiveObservation(observation.observed_at, observation.instance_revision, observation.policy_revision,
                               observation.groups, observation.uncovered, observation.effective_records, _ACQUIRED)


# --- Enrollment selection and artifact ------------------------------------------

@dataclass(frozen=True)
class SourceRead:
    """One read from the protected enrollment source. `authenticated` is set
    by the protected source adapter after verifying the read, never by data."""
    source: str
    authenticated: bool
    payload: bytes = field(repr=False)


@dataclass(frozen=True)
class EnrollmentSelection:
    source: str
    version: str
    artifact_sha256: str
    membership_version: str
    label_version: str
    link_version: str


@dataclass(frozen=True)
class EnrollmentArtifact:
    selection: EnrollmentSelection
    document: dict = field(repr=False)
    _origin: object = field(default=None, repr=False, compare=False)

    @property
    def instance_revision(self):
        return self.document['instance_revision']

    @property
    def policy_revision(self):
        return self.document['policy_revision']


def read_selection(source, expected_source):
    """The currently selected enrollment version, authenticated and exact."""
    if not isinstance(source, SourceRead) or source.authenticated is not True or source.source != expected_source:
        _fail('enrollment_selection_unauthenticated')
    document = strict_json(source.payload)
    keys = frozenset({'format', 'source', 'version', 'artifact_sha256', 'membership_version',
                      'label_version', 'link_version'})
    _exact(document, keys, 'enrollment_selection_invalid')
    if document['format'] != SELECTION_FORMAT or document['source'] != expected_source:
        _fail('enrollment_selection_invalid')
    if (not all(isinstance(document[name], str) and VERSION.fullmatch(document[name])
                for name in ('version', 'membership_version', 'label_version', 'link_version'))
            or not isinstance(document['artifact_sha256'], str) or not SHA256.fullmatch(document['artifact_sha256'])):
        _fail('enrollment_selection_invalid')
    return EnrollmentSelection(document['source'], document['version'], document['artifact_sha256'],
                               document['membership_version'], document['label_version'], document['link_version'])


def load_artifact(selection, source):
    """Validate the selected artifact's bytes against the selection."""
    if not isinstance(selection, EnrollmentSelection):
        _fail('enrollment_selection_invalid')
    if not isinstance(source, SourceRead) or source.authenticated is not True or source.source != selection.source:
        _fail('enrollment_artifact_unauthenticated')
    if hashlib.sha256(source.payload).hexdigest() != selection.artifact_sha256:
        _fail('enrollment_artifact_version_mismatch')
    document = strict_json(source.payload)
    try:
        validate_artifact(document)
    except AuthorityError:
        raise
    except (TypeError, KeyError, AttributeError, ValueError):
        _fail('enrollment_artifact_invalid')
    if (document['source'] != selection.source or document['version'] != selection.version
            or document['membership_version'] != selection.membership_version
            or document['label_version'] != selection.label_version
            or document['link_version'] != selection.link_version):
        _fail('enrollment_artifact_version_mismatch')
    return EnrollmentArtifact(selection, document, _SELECTED)


ARTIFACT_KEYS = frozenset({'format', 'source', 'version', 'membership_version', 'label_version', 'link_version',
                           'prepared_at', 'enrollment_observed_at', 'instance_revision', 'policy_revision',
                           'groups', 'rejected'})
ARTIFACT_GROUP_KEYS = frozenset({'deployments', 'labels', 'legacy_run_bindings', 'observation_bindings'})


def validate_artifact(document):
    _exact(document, ARTIFACT_KEYS, 'enrollment_artifact_invalid')
    if document['format'] != ARTIFACT_FORMAT:
        _fail('enrollment_artifact_invalid')
    if (not _revision(document['instance_revision']) or not _revision(document['policy_revision'])
            or parse_instant(document['prepared_at']) is None
            or parse_instant(document['enrollment_observed_at']) is None
            or not isinstance(document['groups'], list) or not isinstance(document['rejected'], dict)):
        _fail('enrollment_artifact_invalid')
    seen, runs, slots, targets, sources = set(), set(), set(), set(), set()
    for group in document['groups']:
        _exact(group, ARTIFACT_GROUP_KEYS, 'enrollment_artifact_invalid')
        pairs = group['deployments']
        if (not isinstance(pairs, list) or not pairs
                or not all(isinstance(pair, list) and len(pair) == 2 and all(map(_identifier, pair))
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
        for binding in group['observation_bindings']:
            _exact(binding, frozenset(OBSERVATION_BINDING_FIELDS), 'enrollment_artifact_invalid')
            if (not isinstance(binding['binding_id'], str) or binding['binding_id'] in sources
                    or (binding['platform'], binding['legacy_key']) not in pairs
                    or not _member(binding['broker_environment'], {'paper', 'live'})
                    or not all(_identifier(binding[name]) for name in OBSERVATION_BINDING_FIELDS
                               if name != 'opaque_account_uid')
                    or not (binding['opaque_account_uid'] is None or _identifier(binding['opaque_account_uid']))):
                _fail('enrollment_artifact_invalid')
            sources.add(binding['binding_id'])
    if not all(CODE.fullmatch(name) and type(count) is int and count > 0
               for name, count in document['rejected'].items()):
        _fail('enrollment_artifact_invalid')


# --- Protected preparation (offline) -------------------------------------------

def _projection_groups(projection, live):
    if not isinstance(projection, dict) or projection.get('format') != PROJECTION_FORMAT:
        _fail('projection_invalid')
    accounts = projection.get('accounts')
    if not isinstance(accounts, list):
        _fail('projection_invalid')
    groups = []
    for account in accounts:
        pairs = tuple(sorted((item.get('platform'), item.get('legacy_key'))
                             for item in account.get('deployments') or []))
        revision = account.get('configuration_revision') or {}
        if (revision.get('instances') != live.instance_revision
                or revision.get('mapping_policy') != live.policy_revision):
            _fail('projection_revision_mismatch', CONFLICT)
        groups.append((pairs, account))
    if sorted(pairs for pairs, _ in groups) != [group.deployments for group in live.groups]:
        _fail('projection_grouping_mismatch', CONFLICT)
    return dict(groups)


def prepare_enrollment_artifact(*, readback, effective_records, projection, instances, enrollment_links,
                                legacy_roster, observation_bindings, source, versions, prepared_at):
    """Build the enrollment artifact from one coherent observation.

    `readback` and `effective_records` are B2's read and applied-row adapter
    output from the same DO observation; `projection` is the full B1
    projection over the assembled #1173 inventory at the same revisions (the
    parity oracle). Any disagreement refuses publication: no partial artifact
    is ever produced. Returns (artifact_bytes, sha256).
    """
    live = validate_readback(readback)
    records = validate_effective_records(effective_records)
    if sorted(records) != list(live.effective_records):
        _fail('effective_export_mismatch', CONFLICT)
    by_pair = {record[:2]: record[2:] for record in records}
    for group in live.groups:
        tuples = {by_pair.get(pair) for pair in group.deployments}
        if len(tuples) > 1 and tuples != {None} and None not in tuples:
            _fail('sibling_applied_disagree', CONFLICT)
    accounts = _projection_groups(projection, live)
    for group in live.groups:
        account = accounts[group.deployments]
        if (account.get('management_status'), account.get('evidence_state')) != (
                group.management_status, group.evidence_state):
            _fail('projection_parity_mismatch', CONFLICT)
    if not isinstance(versions, dict) or set(versions) != {'version', 'membership_version', 'label_version',
                                                           'link_version'}:
        _fail('enrollment_artifact_invalid')

    rejected = Counter()
    configured = {}
    for instance in instances:
        if isinstance(instance, dict) and instance.get('kind', 'existing') == 'existing':
            config = instance.get('config') or {}
            pair = (instance.get('platform'), config.get('key'))
            if pair in configured:
                _fail('duplicate_configured_account', CONFLICT)
            configured[pair] = config

    # Enumerate every claimant before indexing: a duplicate full binding, a
    # same-platform slot collision or a binding claimed by two groups yields
    # no winner.
    full_links = [link for link in enrollment_links if isinstance(link, dict)]
    claim_counts = Counter(tuple(link.get(name) for name in BINDING_FIELDS) for link in full_links)
    slot_counts = Counter((link.get('platform_id'), link.get('candidate_slot')) for link in full_links)
    roster_counts = Counter(tuple(row.get(name) for name in BINDING_FIELDS) for row in legacy_roster)
    roster = {tuple(row.get(name) for name in BINDING_FIELDS): row for row in legacy_roster}
    accepted_by_group = {}
    for pairs, account in accounts.items():
        for link in account.get('enrollment_links') or []:
            accepted_by_group.setdefault(pairs, []).append(tuple(link.get(name) for name in BINDING_FIELDS))
    group_claims = Counter(identity for identities in accepted_by_group.values() for identity in identities)

    groups, candidates = [], []
    for group in live.groups:
        pairs = group.deployments
        platforms = {pair[0] for pair in pairs}
        runs = []
        for identity in accepted_by_group.get(pairs, []):
            links = [link for link in full_links if tuple(link.get(name) for name in BINDING_FIELDS) == identity]
            reason = None
            if (claim_counts[identity] != 1 or group_claims[identity] != 1 or len(links) != 1
                    or slot_counts[identity[:2]] != 1):
                reason = 'link_ambiguous'
            elif not all(_identifier(value) for value in identity) or identity[0] not in platforms:
                reason = 'link_invalid'
            else:
                link = links[0]
                pair = (identity[0], link.get('account_key'))
                config = configured.get(pair)
                if pair not in pairs or config is None:
                    reason = 'link_owner_mismatch'
                elif {name: config.get(name) for name in CONFIG_IDENTITY_FIELDS} != link.get('config_identity'):
                    reason = 'link_config_changed'
                elif roster_counts[identity] != 1:
                    reason = 'link_roster_mismatch'
                else:
                    profile = roster[identity].get('strategy_profile')
                    options = {name: roster[identity][name] for name in RUN_BINDING_OPTIONS
                               if name in roster[identity]}
                    if not _identifier(profile):
                        reason = 'link_profile_missing'
                    elif not run_binding_ok({**dict(zip(BINDING_FIELDS, identity)), 'strategy_profile': profile,
                                             **options}):
                        reason = 'link_option_invalid'
            if reason:
                rejected[reason] += 1
                continue
            runs.append({**dict(zip(BINDING_FIELDS, identity)), 'strategy_profile': profile, **options})
        candidates.append(runs)
        labels = []
        for pair in pairs:
            label = _configured_label(pair, configured.get(pair) or {}, [*full_links, *legacy_roster])
            if label is None and (configured.get(pair) or {}).get('label') not in (None, ''):
                rejected['label_rejected'] += 1
            elif label is not None:
                labels.append([*pair, label])
        groups.append({'deployments': [list(pair) for pair in pairs], 'labels': labels,
                       'legacy_run_bindings': [], 'observation_bindings': []})

    # A four-axis runtime target claimed by more than one accepted link has
    # no winner either: every claimant is excluded.
    target_counts = Counter(tuple(run[name] for name in RUNTIME_TARGET_FIELDS) for runs in candidates for run in runs)
    for group, runs in zip(groups, candidates, strict=True):
        for run in runs:
            if target_counts[tuple(run[name] for name in RUNTIME_TARGET_FIELDS)] != 1:
                rejected['link_ambiguous'] += 1
                continue
            group['legacy_run_bindings'].append(run)
        group['legacy_run_bindings'].sort(key=lambda row: tuple(row[name] for name in RUN_BINDING_FIELDS))

    owners = {pair: index for index, group in enumerate(live.groups) for pair in group.deployments}
    source_counts = Counter(binding.get('binding_id') for binding in observation_bindings if isinstance(binding, dict))
    for binding in observation_bindings:
        if not isinstance(binding, dict) or frozenset(binding) != frozenset(OBSERVATION_BINDING_FIELDS):
            rejected['observation_binding_invalid'] += 1
            continue
        pair = (binding['platform'], binding['legacy_key'])
        index = owners.get(pair)
        reason = None
        if source_counts[binding['binding_id']] != 1:
            reason = 'observation_source_ambiguous'
        elif index is None:
            reason = 'observation_owner_unknown'
        elif binding['broker_environment'] != live.groups[index].scope:
            reason = 'observation_scope_inconsistent'
        elif binding['opaque_account_uid'] is not None and binding['opaque_account_uid'] not in {
                run['opaque_account_uid'] for run in groups[index]['legacy_run_bindings']
                if run['platform_id'] == pair[0]}:
            reason = 'observation_identity_unenrolled'
        elif not all(_identifier(binding[name]) for name in OBSERVATION_BINDING_FIELDS if name != 'opaque_account_uid'):
            reason = 'observation_binding_invalid'
        if reason:
            rejected[reason] += 1
            continue
        groups[index]['observation_bindings'].append(dict(binding))
    for group in groups:
        group['observation_bindings'].sort(key=lambda item: item['binding_id'])

    observed_at = {account.get('observed_at') for account in accounts.values()}
    if len(observed_at) != 1 or parse_instant(next(iter(observed_at))) is None:
        _fail('projection_observation_invalid')
    if parse_instant(prepared_at) is None:
        _fail('enrollment_artifact_invalid')
    document = {'format': ARTIFACT_FORMAT, 'source': source, **versions, 'prepared_at': prepared_at,
                'enrollment_observed_at': next(iter(observed_at)), 'instance_revision': live.instance_revision,
                'policy_revision': live.policy_revision, 'groups': groups, 'rejected': dict(sorted(rejected.items()))}
    validate_artifact(document)
    data = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return data, hashlib.sha256(data).hexdigest()


def _configured_label(pair, config, bindings):
    """A configured label safe for a general header, or None. It may never
    equal a private identity of a binding on the same platform or of the
    configured account (the existing projection rule)."""
    label = config.get('label')
    if not isinstance(label, str) or not label or safe_display_text(label) != label or len(label) > 70:
        return None
    # The two channel names are display text even when the private LongBridge
    # target uses the same lowercase abbreviation (existing projection rule).
    if pair[0] == 'longbridge' and label in {'hk', 'sg'}:
        return label.upper()
    private = private_identities(binding for binding in bindings
                                 if isinstance(binding, dict) and binding.get('platform_id') == pair[0])
    private.update(value for name in CONFIG_IDENTITY_FIELDS if isinstance(value := config.get(name), str))
    return None if label in private else label


# --- Composition ---------------------------------------------------------------

@dataclass(frozen=True)
class RosterGroup:
    live: LiveGroup
    labels: tuple                 # ((platform, legacy_key, safe_label), ...)
    legacy_run_bindings: tuple    # dicts with RUN_BINDING_FIELDS
    observation_bindings: tuple   # dicts with OBSERVATION_BINDING_FIELDS

    @property
    def deployments(self):
        return self.live.deployments


@dataclass(frozen=True)
class GenerationRoster:
    """One generation's validated roster: the live read joined to the selected
    artifact. The only object the generation consumers may use as authority."""
    observation: LiveObservation
    selection: EnrollmentSelection
    prepared_at: str
    enrollment_observed_at: str
    groups: tuple
    rejected: tuple

    @property
    def observed_at(self):
        return self.observation.observed_at

    def run_bindings(self):
        return [dict(binding) for group in self.groups for binding in group.legacy_run_bindings]


def compose_generation(observation, artifact):
    """Join the acquired live groups to the selected artifact by exact
    deployment membership. Status and applied values come from the live read
    only; the artifact's structure must be at the same instance/policy
    revisions and the same complete deployment sets."""
    if not isinstance(observation, LiveObservation) or observation._origin is not _ACQUIRED:
        _fail('observation_not_acquired')
    if not isinstance(artifact, EnrollmentArtifact) or artifact._origin is not _SELECTED:
        _fail('enrollment_artifact_unselected')
    if (artifact.instance_revision != observation.instance_revision
            or artifact.policy_revision != observation.policy_revision):
        _fail('structural_revision_mismatch', CONFLICT)
    structural = artifact.document['groups']
    structure = {frozenset(tuple(pair) for pair in group['deployments']): group for group in structural}
    if len(structure) != len(structural) or set(structure) != {group.key for group in observation.groups}:
        _fail('grouping_mismatch', CONFLICT)
    groups = []
    for live in observation.groups:
        prepared = structure[live.key]
        # Bindings were certified against the structure at these revisions;
        # a live group whose owner or environment no longer matches them is
        # a contradiction, never a silent move of facts between scopes.
        platforms = {pair[0] for pair in live.deployments}
        if any(binding['platform_id'] not in platforms for binding in prepared['legacy_run_bindings']) or any(
                (binding['platform'], binding['legacy_key']) not in live.deployments
                or binding['broker_environment'] != live.scope for binding in prepared['observation_bindings']):
            _fail('binding_scope_mismatch', CONFLICT)
        private = private_identities([*prepared['legacy_run_bindings'], *prepared['observation_bindings']])
        if any(item[2] in private for item in prepared['labels']):
            _fail('label_private_identity', CONFLICT)
        groups.append(RosterGroup(live, tuple(tuple(item) for item in prepared['labels']),
                                  tuple(dict(item) for item in prepared['legacy_run_bindings']),
                                  tuple(dict(item) for item in prepared['observation_bindings'])))
    return GenerationRoster(observation, artifact.selection, artifact.document['prepared_at'],
                            artifact.document['enrollment_observed_at'], tuple(groups),
                            tuple(sorted(artifact.document['rejected'].items())))


def generation_recipient_accounts(roster, raw, recipient):
    """The existing private recipient map, revalidated against this
    generation's accepted legacy enrollments only. Any invalid entry empties
    the whole map (the existing safeguard); nothing here is logged."""
    if not isinstance(roster, GenerationRoster):
        return {}
    from cloud_run_daily_digest import _ibkr_telegram_accounts
    return _ibkr_telegram_accounts(roster.run_bindings(), raw, recipient)
