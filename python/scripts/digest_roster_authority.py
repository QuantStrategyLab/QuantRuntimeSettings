"""Acquire, validate and compose one generation's account-management authority.

Implements B2 readback validation/acquisition (dormant service-auth boundary),
authenticated enrollment selection and artifact preparation (with raw identifier
retention per RESCOPE §3.1 item 9), FLAG-3 certified physical group identity,
and the canonical ownership-validation contract (RESCOPE §3.1 item 4).

Never imports cloud_run_daily_digest or any generation-only consumer module.
"""
from __future__ import annotations

import hashlib
import json
import ssl
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from urllib.error import HTTPError, URLError

from digest_roster_validator import (
    ARTIFACT_FORMAT,
    BINDING_FIELDS,
    CONFLICT,
    CONFIG_IDENTITY_FIELDS,
    EVIDENCE_SCOPE,
    LEGACY_MODE,
    MANAGEMENT_ROUTE,
    MAPPING_MODE,
    MAX_FUTURE_SKEW,
    MAX_OBSERVATION_AGE,
    MAX_READ_TIMEOUT,
    MAX_RESPONSE_BYTES,
    OBSERVATION_BINDING_FIELDS,
    PRIVATE_LOCATOR_FIELDS,
    PROJECTION_FORMAT,
    READBACK_FORMAT,
    RUN_BINDING_FIELDS,
    RUN_BINDING_OPTIONS,
    RUNTIME_TARGET_FIELDS,
    SELECTION_FORMAT,
    SELECTION_KEYS,
    SHA256,
    STALE,
    UNAVAILABLE,
    VERSION,
    AuthorityError,
    LiveGroup,
    LiveObservation,
    PrepInputs,
    RosterBootConfig,
    ServiceAuthPolicy,
    certified_group_deployments,
    certify_group_identity,
    exact_keys,
    extract_raw_prep_inputs,
    is_identifier,
    is_member,
    observation_age,
    parse_instant,
    private_identities,
    run_binding_ok,
    strict_json,
    trusted_clock,
    validate_artifact,
    validate_effective_records,
    validate_ownership_contract,
    validate_projection_revisions,
    validate_readback,
    validate_selection_document,
    within_window,
)
from display_names import safe_display_text


def _fail(code, kind=UNAVAILABLE):
    raise AuthorityError(code, kind)


# Only this module mints these markers; a caller-built observation or artifact
# carries neither and cannot be composed.
_ACQUIRED, _SELECTED = object(), object()


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
    acquisition fails closed into Q5 fallback. Provisioning is F2."""

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


# --- Transport and acquisition ------------------------------------------------

@dataclass(frozen=True)
class TransportResponse:
    status: int
    headers: dict
    body: bytes = field(repr=False)
    url: str


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HttpsTransport:
    """Server-authenticated TLS, no redirects, bounded body and time."""

    def get(self, url, headers, timeout):
        context = ssl.create_default_context()
        opener = urllib.request.build_opener(_NoRedirect(), urllib.request.HTTPSHandler(context=context))
        request = urllib.request.Request(url, headers=headers, method='GET')
        try:
            with opener.open(request, timeout=timeout) as response:
                body = response.read(MAX_RESPONSE_BYTES + 1)
                return TransportResponse(
                    response.status,
                    {k.lower(): v for k, v in response.headers.items()},
                    body,
                    response.geturl(),
                )
        except HTTPError as error:
            return TransportResponse(
                error.code,
                {k.lower(): v for k, v in (error.headers or {}).items()},
                b'',
                url,
            )
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
        headers = {
            'Accept': 'application/json',
            'Cache-Control': 'no-cache, no-store',
            'Pragma': 'no-cache',
            'Authorization': f'Bearer {assertion.token}',
        }
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
        return LiveObservation(
            observation.observed_at,
            observation.instance_revision,
            observation.policy_revision,
            observation.groups,
            observation.uncovered,
            observation.effective_records,
            _ACQUIRED,
        )


# --- Enrollment selection and artifact ----------------------------------------

@dataclass(frozen=True)
class SourceRead:
    """One read from the protected enrollment source."""
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

    def as_dict(self):
        return {
            'source': self.source,
            'version': self.version,
            'artifact_sha256': self.artifact_sha256,
            'membership_version': self.membership_version,
            'label_version': self.label_version,
            'link_version': self.link_version,
        }


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
    """Read and strictly validate the currently selected enrollment version."""
    if not isinstance(source, SourceRead) or source.authenticated is not True or source.source != expected_source:
        _fail('enrollment_selection_unauthenticated')
    document = strict_json(source.payload)
    validate_selection_document(document, expected_source=expected_source)
    return EnrollmentSelection(
        document['source'],
        document['version'],
        document['artifact_sha256'],
        document['membership_version'],
        document['label_version'],
        document['link_version'],
    )


def load_artifact(selection, source):
    """Validate the selected artifact bytes against the selection pointer."""
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
    if (document['source'] != selection.source
            or document['version'] != selection.version
            or document['membership_version'] != selection.membership_version
            or document['label_version'] != selection.label_version
            or document['link_version'] != selection.link_version):
        _fail('enrollment_artifact_version_mismatch')
    return EnrollmentArtifact(selection, document, _SELECTED)


# --- Protected preparation (offline) ------------------------------------------

@dataclass(frozen=True)
class PreparedEnrollment:
    """Offline preparation output separating the artifact bytes from retained raw identifiers."""
    artifact_bytes: bytes = field(repr=False)
    artifact_sha256: str
    prep_inputs: PrepInputs


def _projection_groups(projection, live):
    accounts_list = validate_projection_revisions(projection, live.instance_revision, live.policy_revision)
    groups = []
    for account in accounts_list:
        raw_deployments = account.get('deployments')
        if not isinstance(raw_deployments, list) or not raw_deployments:
            _fail('projection_invalid')
        pairs = certified_group_deployments([
            {'platform': item.get('platform'), 'legacy_key': item.get('legacy_key')}
            if isinstance(item, dict) else item
            for item in raw_deployments
        ])
        groups.append((pairs, account))
    if sorted(pairs for pairs, _ in groups) != [group.deployments for group in live.groups]:
        _fail('projection_grouping_mismatch', CONFLICT)
    return dict(groups)


def _configured_label(pair, config, prep_inputs):
    """Return a configured label safe for a general header, or None.

    Checks all retained raw private locators (including invalid-identity rows
    and rejected observation bindings) plus configured account identity fields.
    """
    label = config.get('label')
    if not isinstance(label, str) or not label or safe_display_text(label) != label or len(label) > 70:
        return None
    raw_platform = prep_inputs.raw_identifiers_by_platform.get(pair[0], frozenset())
    raw_unscoped = prep_inputs.raw_identifiers_by_platform.get(None, frozenset())
    raw_locators = raw_platform | raw_unscoped
    # The two channel names are display text even when the private LongBridge
    # target uses the same lowercase abbreviation (existing projection rule).
    if pair[0] == 'longbridge' and label in {'hk', 'sg'}:
        upper = label.upper()
        # Still block if an explicit non-account_selector private locator equals HK/SG.
        non_selector = set(raw_unscoped)
        for row in (*prep_inputs.raw_links, *prep_inputs.raw_roster, *prep_inputs.raw_observations):
            if not isinstance(row, dict):
                continue
            plat = row.get('platform_id') if 'platform_id' in row else row.get('platform')
            if plat not in (pair[0], None) and is_identifier(plat):
                continue
            for name in ('opaque_account_uid', 'target_id', 'candidate_slot', 'account_hint', 'binding_id'):
                if is_identifier(row.get(name)):
                    non_selector.add(row[name])
        return None if upper in non_selector else upper
    private = set(raw_locators)
    private.update(value for name in CONFIG_IDENTITY_FIELDS if is_identifier(value := config.get(name)))
    return None if label in private else label


def prepare_enrollment_bundle(*, readback, effective_records, projection, instances, enrollment_links,
                              legacy_roster, observation_bindings, source, versions, prepared_at):
    """Build the enrollment artifact and retained raw PrepInputs from one coherent observation."""
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

    prep_inputs = extract_raw_prep_inputs(enrollment_links, legacy_roster, observation_bindings, instances)
    rejected = Counter()
    configured = {}
    for instance in instances:
        if isinstance(instance, dict) and instance.get('kind', 'existing') == 'existing':
            config = instance.get('config') or {}
            pair = (instance.get('platform'), config.get('key'))
            if pair in configured:
                _fail('duplicate_configured_account', CONFLICT)
            configured[pair] = config

    full_links = [link for link in prep_inputs.raw_links if isinstance(link, dict)]
    claim_counts = Counter(tuple(link.get(name) for name in BINDING_FIELDS) for link in full_links)
    slot_counts = Counter((link.get('platform_id'), link.get('candidate_slot')) for link in full_links)
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
        refs = accepted_by_group.get(pairs, [])
        # RESCOPE §10 (F14 same-group duplicate references): resolve duplicate
        # references within a group before binding uniqueness checks.
        same_group_ref_counts = Counter(refs)
        for identity in refs:
            links = [link for link in full_links if tuple(link.get(name) for name in BINDING_FIELDS) == identity]
            reason = None
            if same_group_ref_counts[identity] != 1:
                reason = 'link_ambiguous'
            elif (claim_counts[identity] != 1 or group_claims[identity] != 1 or len(links) != 1
                    or slot_counts[identity[:2]] != 1):
                reason = 'link_ambiguous'
            elif not all(is_identifier(value) for value in identity) or identity[0] not in platforms:
                reason = 'link_invalid'
            else:
                link = links[0]
                pair = (identity[0], link.get('account_key'))
                config = configured.get(pair)
                if pair not in pairs or config is None:
                    reason = 'link_owner_mismatch'
                elif {name: config.get(name) for name in CONFIG_IDENTITY_FIELDS} != link.get('config_identity'):
                    reason = 'link_config_changed'
                elif prep_inputs.roster_counts[identity] != 1 or identity not in prep_inputs.indexed_roster:
                    reason = 'link_roster_mismatch'
                else:
                    roster_row = prep_inputs.indexed_roster[identity]
                    profile = roster_row.get('strategy_profile')
                    options = {name: roster_row[name] for name in RUN_BINDING_OPTIONS if name in roster_row}
                    if not is_identifier(profile):
                        reason = 'link_profile_missing'
                    elif not run_binding_ok({**dict(zip(BINDING_FIELDS, identity)),
                                             'strategy_profile': profile, **options}):
                        reason = 'link_option_invalid'
            if reason:
                rejected[reason] += 1
                continue
            runs.append({**dict(zip(BINDING_FIELDS, identity)), 'strategy_profile': profile, **options})
        candidates.append(runs)
        groups.append({
            'deployments': [list(pair) for pair in pairs],
            'labels': [],
            'legacy_run_bindings': [],
            'observation_bindings': [],
        })

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

    # Process observation bindings BEFORE label selection so all observation
    # exclusions and raw identifiers are accounted for before labels are chosen.
    owners = {pair: index for index, group in enumerate(live.groups) for pair in group.deployments}
    source_counts = Counter(
        binding.get('binding_id') for binding in prep_inputs.raw_observations if isinstance(binding, dict)
    )
    for binding in prep_inputs.raw_observations:
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
        elif not all(is_identifier(binding[name]) for name in OBSERVATION_BINDING_FIELDS if name != 'opaque_account_uid'):
            reason = 'observation_binding_invalid'
        if reason:
            rejected[reason] += 1
            continue
        groups[index]['observation_bindings'].append(dict(binding))
    for group in groups:
        group['observation_bindings'].sort(key=lambda item: item['binding_id'])

    # Label selection runs last, checking against full PrepInputs raw identifiers
    # (including rows whose identity fields were invalid or rejected).
    for live_group, group in zip(live.groups, groups, strict=True):
        labels = []
        for pair in live_group.deployments:
            config = configured.get(pair) or {}
            label = _configured_label(pair, config, prep_inputs)
            if label is None and config.get('label') not in (None, ''):
                rejected['label_rejected'] += 1
            elif label is not None:
                labels.append([*pair, label])
        group['labels'] = labels

    observed_at = {account.get('observed_at') for account in accounts.values()}
    if len(observed_at) != 1 or parse_instant(next(iter(observed_at))) is None:
        _fail('projection_observation_invalid')
    if parse_instant(prepared_at) is None:
        _fail('enrollment_artifact_invalid')
    document = {
        'format': ARTIFACT_FORMAT,
        'source': source,
        **versions,
        'prepared_at': prepared_at,
        'enrollment_observed_at': next(iter(observed_at)),
        'instance_revision': live.instance_revision,
        'policy_revision': live.policy_revision,
        'groups': groups,
        'rejected': dict(sorted(rejected.items())),
    }
    validate_artifact(document)
    data = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return PreparedEnrollment(data, hashlib.sha256(data).hexdigest(), prep_inputs)


def prepare_enrollment_artifact(**kwargs):
    """Build the enrollment artifact bytes and SHA-256 digest."""
    bundle = prepare_enrollment_bundle(**kwargs)
    return bundle.artifact_bytes, bundle.artifact_sha256


# --- Composition --------------------------------------------------------------

@dataclass(frozen=True)
class RosterGroup:
    group_id: str
    live: LiveGroup
    labels: tuple
    legacy_run_bindings: tuple
    observation_bindings: tuple

    @property
    def platform(self):
        return self.live.deployments[0][0]

    @property
    def account_key(self):
        return self.live.deployments[0][1]

    @property
    def deployments(self):
        return self.live.deployments


@dataclass(frozen=True)
class GenerationRoster:
    """One generation's validated roster joining acquired live groups to the selected artifact."""
    observation: LiveObservation
    selection: EnrollmentSelection
    prepared_at: str
    enrollment_observed_at: str
    groups: tuple
    rejected: tuple

    @property
    def observed_at(self):
        return self.observation.observed_at

    def group_by_id(self, group_id):
        return next((group for group in self.groups if group.group_id == group_id), None)

    def run_bindings(self):
        return [dict(binding) for group in self.groups for binding in group.legacy_run_bindings]


def compose_generation(observation, artifact):
    """Join acquired live groups to the selected artifact by certified group identity."""
    if not isinstance(observation, LiveObservation) or observation._origin is not _ACQUIRED:
        _fail('observation_not_acquired')
    if not isinstance(artifact, EnrollmentArtifact) or artifact._origin is not _SELECTED:
        _fail('enrollment_artifact_unselected')
    if (artifact.instance_revision != observation.instance_revision
            or artifact.policy_revision != observation.policy_revision):
        _fail('structural_revision_mismatch', CONFLICT)
    structural = artifact.document['groups']
    structure = {}
    for group in structural:
        pairs = certified_group_deployments(group['deployments'])
        gid = certify_group_identity(pairs)
        if gid in structure:
            _fail('grouping_mismatch', CONFLICT)
        structure[gid] = (pairs, group)
    live_gids = {certify_group_identity(live.deployments): live for live in observation.groups}
    if set(structure) != set(live_gids):
        _fail('grouping_mismatch', CONFLICT)

    groups = []
    for live in observation.groups:
        gid = certify_group_identity(live.deployments)
        pairs, prepared = structure[gid]
        if pairs != live.deployments:
            _fail('grouping_mismatch', CONFLICT)
        platforms = {pair[0] for pair in live.deployments}
        if any(binding['platform_id'] not in platforms for binding in prepared['legacy_run_bindings']) or any(
                (binding['platform'], binding['legacy_key']) not in live.deployments
                or binding['broker_environment'] != live.scope for binding in prepared['observation_bindings']):
            _fail('binding_scope_mismatch', CONFLICT)
        private = private_identities([*prepared['legacy_run_bindings'], *prepared['observation_bindings']])
        if any(item[2] in private for item in prepared['labels']):
            _fail('label_private_identity', CONFLICT)
        groups.append(RosterGroup(
            group_id=gid,
            live=live,
            labels=tuple(tuple(item) for item in prepared['labels']),
            legacy_run_bindings=tuple(dict(item) for item in prepared['legacy_run_bindings']),
            observation_bindings=tuple(dict(item) for item in prepared['observation_bindings']),
        ))
    return GenerationRoster(
        observation,
        artifact.selection,
        artifact.document['prepared_at'],
        artifact.document['enrollment_observed_at'],
        tuple(groups),
        tuple(sorted(artifact.document['rejected'].items())),
    )


__all__ = [
    'AcquisitionClient',
    'DormantServiceAuth',
    'EnrollmentArtifact',
    'EnrollmentSelection',
    'GenerationRoster',
    'HttpsTransport',
    'PreparedEnrollment',
    'RosterGroup',
    'ServiceAssertion',
    'SourceRead',
    'TransportResponse',
    'compose_generation',
    'load_artifact',
    'prepare_enrollment_artifact',
    'prepare_enrollment_bundle',
    'read_selection',
    'verify_assertion',
]
