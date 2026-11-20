"""Acquire, validate and compose one generation's account-management authority.

Implements B2 readback validation/acquisition (dormant service-auth boundary),
authenticated enrollment selection and artifact preparation (with raw identifier
retention per RESCOPE §3.1 item 9), FLAG-3 certified physical group identity,
and the canonical ownership-validation contract (RESCOPE §3.1 item 4).

Never imports cloud_run_daily_digest or any generation-only consumer module.
"""
from __future__ import annotations

import hashlib
import itertools
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
    MANAGEMENT_STATUSES,
    MAPPING_MODE,
    MAX_FUTURE_SKEW,
    MAX_OBSERVATION_AGE,
    MAX_READ_TIMEOUT,
    MAX_RESPONSE_BYTES,
    OBSERVATION_BINDING_FIELDS,
    PRIVATE_LOCATOR_FIELDS,
    PROJECTION_FORMAT,
    READBACK_FORMAT,
    ROSTER_FORMAT,
    RUN_BINDING_FIELDS,
    RUN_BINDING_OPTIONS,
    RUNTIME_TARGET_FIELDS,
    SELECTION_FORMAT,
    SELECTION_KEYS,
    SHA256,
    STALE,
    STATUS_AVAILABLE,
    STATUS_FALLBACK,
    STATUS_UNAVAILABLE,
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
    compute_content_hash,
    exact_keys,
    extract_raw_prep_inputs,
    format_utc,
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
    validate_roster_envelope,
    validate_selection_document,
    verify_completeness_contract,
    verify_inventory_authority,
    within_window,
)
from digest_roster_compatibility import (
    HistoricalExceptionEntry,
    HistoricalExceptionRegister,
    HistoricalPresentation,
    accept_current_enrollment_artifact,
    accept_current_roster,
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
                              legacy_roster, observation_bindings, source, versions, prepared_at,
                              authority_input=None):
    """Build the enrollment artifact and retained raw PrepInputs from one coherent observation."""
    live = validate_readback(readback)
    if authority_input is not None:
        verify_inventory_authority(authority_input, live.instance_revision, live.policy_revision)
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
    structure = verify_completeness_contract(observation, artifact.document)

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


# --- Envelope builders and preparer acceptance (completeness + B3-08) ---------

_generation_sequence = itertools.count(1)


def canonical_json_bytes(document):
    return json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(',', ':'),
                      allow_nan=False).encode('utf-8')


def make_run_scope(boot, *, recipient_scope, report_date, original_slot, preview=False):
    if not isinstance(boot, RosterBootConfig) or boot.mode != MAPPING_MODE:
        raise ValueError('digest_roster_mode_invalid')
    namespace = (
        f"{'preview' if preview else 'prod'}:{boot.origin}:{boot.enrollment_source}"
        f":{boot.config_context}:{recipient_scope}"
    )
    return {
        'namespace': namespace,
        'enrollment_source': boot.enrollment_source,
        'config_context': boot.config_context,
        'recipient_scope': recipient_scope,
        'report_date': report_date,
        'original_slot': original_slot,
        'preview': bool(preview),
    }


def _run_id_for_scope(run_scope):
    return f"{run_scope['report_date']}/{run_scope['original_slot']}"


@dataclass(frozen=True)
class DisplayHeader:
    """Retained display metadata for Q5 warm fallback; carries no class or management status."""
    group_id: str
    platform: str
    account_key: str
    deployments: tuple
    labels: tuple
    scope: str


def headers_from_roster(roster):
    if not isinstance(roster, GenerationRoster):
        _fail('roster_shape_invalid')
    return tuple(
        DisplayHeader(
            group_id=group.group_id,
            platform=group.platform,
            account_key=group.account_key,
            deployments=group.deployments,
            labels=group.labels,
            scope=group.live.scope,
        )
        for group in roster.groups
    )


def build_available_roster_envelope(
    roster,
    *,
    confirmation,
    run_scope,
    generation_id,
    generated_at,
    generation_window,
    initial_read_at,
    confirming_read_at,
):
    """Build, ownership-validate, and hash one authoritative qsl_digest_account_roster.v1 envelope."""
    if not isinstance(roster, GenerationRoster):
        _fail('roster_shape_invalid')
    if not isinstance(confirmation, LiveObservation) or confirmation._origin is not _ACQUIRED:
        _fail('observation_not_acquired')
    accepted_at = parse_instant(generated_at) if isinstance(generated_at, str) else trusted_clock(generated_at)
    if accepted_at is None:
        _fail('roster_time_invalid', STALE)
    generated_iso = format_utc(accepted_at)
    accounts = []
    status_counts = Counter()
    for group in roster.groups:
        live = group.live
        status_counts[live.management_status] += 1
        applied = (
            {'management_enabled': live.applied[0], 'revision': live.applied[1], 'effective_at': live.applied[2]}
            if live.applied is not None else None
        )
        accounts.append({
            'group_id': group.group_id,
            'platform': group.platform,
            'account_key': group.account_key,
            'deployments': [{'platform': p, 'legacy_key': k} for p, k in group.deployments],
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
            'platform': p,
            'key': k,
            'management_status': 'unknown',
            'evidence_state': 'unknown',
            'reasons': ['deployment_uncovered'],
            'processing_eligible': False,
            'processing_denial': 'management_status_unknown',
        }
        for p, k in confirmation.uncovered
    ]
    age_seconds = round(observation_age(confirmation.observed, accepted_at).total_seconds(), 6)
    document = {
        'format': ROSTER_FORMAT,
        'schema_version': ROSTER_FORMAT,
        'status': STATUS_AVAILABLE,
        'run_id': _run_id_for_scope(run_scope),
        'run_scope': dict(run_scope),
        'generation_id': generation_id,
        'source_revision': {
            'instance_revision': confirmation.instance_revision,
            'policy_revision': confirmation.policy_revision,
        },
        'source_snapshot_at': confirmation.observed_at,
        'generated_at': generated_iso,
        'generation_window': dict(generation_window),
        'observation_age_seconds': age_seconds,
        'live_source': MANAGEMENT_ROUTE,
        'evidence_scope': EVIDENCE_SCOPE,
        'acquisition': {
            'live_source': MANAGEMENT_ROUTE,
            'evidence_scope': EVIDENCE_SCOPE,
            'initial_read_at': format_utc(initial_read_at) if not isinstance(initial_read_at, str) else initial_read_at,
            'confirming_read_at': (
                format_utc(confirming_read_at) if not isinstance(confirming_read_at, str) else confirming_read_at
            ),
            'initial_snapshot_at': roster.observation.observed_at,
            'confirming_snapshot_at': confirmation.observed_at,
            'confirmation_outcome': 'confirmed',
        },
        'selection': roster.selection.as_dict(),
        'prepared_at': roster.prepared_at,
        'enrollment_observed_at': roster.enrollment_observed_at,
        'physical_grouping_complete': True,
        'failure_code': None,
        'failure_kind': None,
        'account_count': len(accounts),
        'counts': {
            'physical_accounts': len(accounts),
            'display_groups': len(accounts),
            'display_deployments': sum(len(a['deployments']) for a in accounts) + len(uncovered),
            'uncovered_deployments': len(uncovered),
            **{status: status_counts.get(status, 0) for status in MANAGEMENT_STATUSES},
        },
        'accounts': accounts,
        'uncovered_deployments': uncovered,
        'rejected': dict(roster.rejected),
    }
    document['content_hash'] = compute_content_hash(document)
    validate_roster_envelope(document)
    validate_ownership_contract(document, confirmation)
    return document, canonical_json_bytes(document)


def build_fallback_roster_envelope(
    *,
    run_scope,
    source_snapshot_at,
    observation_age_seconds,
    generation_window,
    headers,
    failure_code,
    failure_kind=UNAVAILABLE,
):
    """Build and hash one non-authoritative fallback qsl_digest_account_roster.v1 envelope."""
    if not headers:
        _fail('roster_shape_invalid')
    accounts = [
        {
            'group_id': header.group_id,
            'platform': header.platform,
            'account_key': header.account_key,
            'deployments': [{'platform': p, 'legacy_key': k} for p, k in header.deployments],
            'labels': [{'platform': p, 'legacy_key': k, 'label': lbl} for p, k, lbl in header.labels],
            'scope': header.scope,
            'management_class': None,
            'management_status': 'unknown',
            'evidence_state': 'unknown',
            'processing_eligible': False,
            'processing_denial': 'management_status_unknown',
            'reasons': [failure_code],
            'applied': None,
            'legacy_run_bindings': [],
            'observation_bindings': [],
        }
        for header in headers
    ]
    document = {
        'format': ROSTER_FORMAT,
        'schema_version': ROSTER_FORMAT,
        'status': STATUS_FALLBACK,
        'run_id': _run_id_for_scope(run_scope),
        'run_scope': dict(run_scope),
        'generation_id': None,
        'source_revision': None,
        'source_snapshot_at': source_snapshot_at,
        'generated_at': None,
        'generation_window': dict(generation_window) if generation_window is not None else None,
        'observation_age_seconds': (
            round(float(observation_age_seconds), 6) if observation_age_seconds is not None else None
        ),
        'live_source': MANAGEMENT_ROUTE,
        'evidence_scope': EVIDENCE_SCOPE,
        'acquisition': None,
        'selection': None,
        'prepared_at': None,
        'enrollment_observed_at': None,
        'physical_grouping_complete': False,
        'failure_code': failure_code,
        'failure_kind': failure_kind,
        'account_count': len(accounts),
        'counts': {
            'physical_accounts': None,
            'display_groups': len(accounts),
            'display_deployments': sum(len(a['deployments']) for a in accounts),
            'uncovered_deployments': 0,
            **{status: None for status in MANAGEMENT_STATUSES},
        },
        'accounts': accounts,
        'uncovered_deployments': [],
        'rejected': {},
    }
    document['content_hash'] = compute_content_hash(document)
    validate_roster_envelope(document)
    return document, canonical_json_bytes(document)


def build_unavailable_roster_envelope(
    *,
    run_scope,
    generation_window,
    failure_code,
    failure_kind=UNAVAILABLE,
):
    """Build and hash one non-authoritative unavailable qsl_digest_account_roster.v1 envelope."""
    document = {
        'format': ROSTER_FORMAT,
        'schema_version': ROSTER_FORMAT,
        'status': STATUS_UNAVAILABLE,
        'run_id': _run_id_for_scope(run_scope) if run_scope is not None else None,
        'run_scope': dict(run_scope) if run_scope is not None else None,
        'generation_id': None,
        'source_revision': None,
        'source_snapshot_at': None,
        'generated_at': None,
        'generation_window': dict(generation_window) if generation_window is not None else None,
        'observation_age_seconds': None,
        'live_source': MANAGEMENT_ROUTE,
        'evidence_scope': EVIDENCE_SCOPE,
        'acquisition': None,
        'selection': None,
        'prepared_at': None,
        'enrollment_observed_at': None,
        'physical_grouping_complete': False,
        'failure_code': failure_code,
        'failure_kind': failure_kind,
        'account_count': 0,
        'counts': {
            'physical_accounts': None,
            'display_groups': 0,
            'display_deployments': 0,
            'uncovered_deployments': 0,
            **{status: None for status in MANAGEMENT_STATUSES},
        },
        'accounts': [],
        'uncovered_deployments': [],
        'rejected': {},
    }
    document['content_hash'] = compute_content_hash(document)
    validate_roster_envelope(document)
    return document, canonical_json_bytes(document)


@dataclass(frozen=True)
class AcceptedRoster:
    """Result of successful preparer acceptance (two-read coherence + B3-08 source freshness)."""
    envelope: dict = field(repr=False)
    envelope_bytes: bytes = field(repr=False)
    roster: GenerationRoster
    confirmation: LiveObservation = field(repr=False)
    collected: object = field(default=None, repr=False)
    accepted_at: datetime = field(default=None)
    attempts: int = 1


def acquire_and_validate_roster(
    *,
    boot,
    client,
    enrollment_source,
    clock,
    deadline,
    run_scope,
    generation_window,
    generation_id=None,
    collect=None,
):
    """Acquire initial + confirming B2 reads, validate completeness + ownership, and
    enforce amended B3-08 freshness on source snapshot times at preparer acceptance G.

    Retries the whole acquisition/build at most once on retryable STALE/CONFLICT errors
    when the generation deadline permits; provisional reads are discarded on failure.
    """
    if not isinstance(boot, RosterBootConfig) or boot.mode != MAPPING_MODE:
        raise ValueError('digest_roster_mode_invalid')
    if not isinstance(client, AcquisitionClient):
        raise ValueError('digest_roster_mode_invalid')
    deadline = trusted_clock(deadline)

    def _select():
        try:
            return read_selection(enrollment_source.read_selection(), boot.enrollment_source)
        except AuthorityError:
            raise
        except Exception:
            _fail('enrollment_selection_unavailable')

    def _load(selection):
        try:
            read = enrollment_source.read_artifact(selection)
        except AuthorityError:
            raise
        except Exception:
            _fail('enrollment_artifact_unavailable')
        return load_artifact(selection, read)

    artifact_cache = {}
    attempts = 0
    last_error = None
    while attempts < 2:
        attempts += 1
        try:
            now = trusted_clock(clock())
            remaining = (deadline - now).total_seconds()
            if remaining <= 0:
                _fail('generation_deadline_exhausted')
            selection = _select()
            artifact = artifact_cache.get(selection)
            if artifact is None:
                artifact = _load(selection)
                artifact_cache = {selection: artifact}
            t1_read = trusted_clock(clock())
            first = client.acquire(t1_read, timeout=remaining)
            if t1_read - first.observed > MAX_OBSERVATION_AGE:
                _fail('observation_stale', STALE)
            roster = compose_generation(first, artifact)
            collected = collect(roster) if collect is not None else None
            t2_read = trusted_clock(clock())
            rem2 = (deadline - t2_read).total_seconds()
            if rem2 <= 0:
                _fail('generation_deadline_exhausted')
            confirmation = client.acquire(t2_read, timeout=rem2)
            final_selection = _select()
            # Acceptance clock G at the roster acceptance decision.
            accepted_at = trusted_clock(clock())
            if confirmation.vector() != first.vector():
                _fail('revision_race', CONFLICT)
            if final_selection != selection:
                _fail('enrollment_selection_changed', CONFLICT)
            # Amended B3-08: check BOTH source snapshot timestamps against G;
            # never substitute generated_at or fetch completion times (t1_read/t2_read).
            if not (within_window(first.observed, accepted_at)
                    and within_window(confirmation.observed, accepted_at)):
                _fail('observation_stale', STALE)
            if accepted_at > deadline:
                _fail('generation_deadline_exhausted')
            gen_id = generation_id or f"gen-{next(_generation_sequence):06d}"
            envelope, envelope_bytes = build_available_roster_envelope(
                roster,
                confirmation=confirmation,
                run_scope=run_scope,
                generation_id=gen_id,
                generated_at=accepted_at,
                generation_window=generation_window,
                initial_read_at=t1_read,
                confirming_read_at=t2_read,
            )
            return AcceptedRoster(
                envelope=envelope,
                envelope_bytes=envelope_bytes,
                roster=roster,
                confirmation=confirmation,
                collected=collected,
                accepted_at=accepted_at,
                attempts=attempts,
            )
        except AuthorityError as error:
            last_error = error
            if error.kind in {STALE, CONFLICT} and attempts < 2:
                now_after = trusted_clock(clock())
                if (deadline - now_after).total_seconds() > 0:
                    continue
            raise
    raise last_error


__all__ = [
    'AcceptedRoster',
    'AcquisitionClient',
    'DisplayHeader',
    'DormantServiceAuth',
    'EnrollmentArtifact',
    'EnrollmentSelection',
    'GenerationRoster',
    'HistoricalExceptionEntry',
    'HistoricalExceptionRegister',
    'HistoricalPresentation',
    'HttpsTransport',
    'PreparedEnrollment',
    'RosterGroup',
    'ServiceAssertion',
    'SourceRead',
    'TransportResponse',
    'accept_current_enrollment_artifact',
    'accept_current_roster',
    'acquire_and_validate_roster',
    'build_available_roster_envelope',
    'build_fallback_roster_envelope',
    'build_unavailable_roster_envelope',
    'canonical_json_bytes',
    'compose_generation',
    'headers_from_roster',
    'load_artifact',
    'make_run_scope',
    'prepare_enrollment_artifact',
    'prepare_enrollment_bundle',
    'read_selection',
    'verify_assertion',
]
