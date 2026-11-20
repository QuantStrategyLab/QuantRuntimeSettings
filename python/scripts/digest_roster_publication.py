"""Conditional, idempotent, run-scoped publication of digest rosters (RESCOPE §5).

Implements rules 1-6 verbatim:
1. Run key = (report_date, validated original slot) inside a protected
   namespace binding authenticated source, protected config, recipient scope,
   and preview vs production isolation. Attempt/generation IDs never extend the key.
2. Atomic create-if-absent store shared across independent executions; winning
   record stores the complete immutable validated qsl_digest_account_roster.v1
   envelope with unique generation_id bound once and verified content_hash.
3. Idempotent replay returns exact original stored bytes and generation_id for
   matching authority-bearing content (timestamps/attempt clocks alone do not
   constitute an authority change), after re-verifying integrity, scope, and
   freshness. Same-revision content conflict and different-revision replay are
   refused leaving the record intact, entering Q5 warm/cold fallback.
4. Consumer re-checks integrity, provenance, run binding, and B3-08 freshness
   on the committed record; never polls, elects, or re-derives ownership.
5. Dated display metadata is stored separately and advances atomically ONLY on
   strictly newer confirming source time from committed, accepted publications
   in the same protected display scope; equal, older, or failed attempts retain
   the existing record.
"""
from __future__ import annotations

import itertools
import json
import threading
from dataclasses import dataclass, field
from datetime import datetime

from digest_roster_authority import (
    DisplayHeader,
    acquire_and_validate_roster,
    build_fallback_roster_envelope,
    build_unavailable_roster_envelope,
    headers_from_roster,
    make_run_scope,
)
from digest_roster_validator import (
    CONFLICT,
    ROSTER_FORMAT,
    STALE,
    STATUS_AVAILABLE,
    UNAVAILABLE,
    AuthorityError,
    RosterBootConfig,
    check_envelope_freshness,
    observation_age,
    parse_instant,
    strict_json,
    trusted_clock,
    validate_consumer_provenance,
    validate_roster_envelope,
    verify_content_hash,
)

_pub_sequence = itertools.count(1)


class PublicationStoreUnavailable(Exception):
    """Raised when conditional store write/read fails or create acknowledgement is lost."""

    def __init__(self, code='publication_store_unavailable'):
        super().__init__(code)
        self.code = code


def display_scope_key(boot, *, recipient_scope, preview=False):
    """Protected display metadata scope: same authenticated source, config context,
    recipient scope, and preview vs production separation."""
    if not isinstance(boot, RosterBootConfig):
        raise ValueError('digest_roster_mode_invalid')
    return (
        f"{'preview' if preview else 'prod'}:{boot.origin}:{boot.enrollment_source}"
        f":{boot.config_context}:{recipient_scope}"
    )


def run_publication_key(run_scope):
    """Exact run key under §5 rule 1: protected namespace + (report_date, original_slot)."""
    return f"{run_scope['namespace']}::{run_scope['report_date']}/{run_scope['original_slot']}"


def authority_bearing_projection(document):
    """Canonical projection of authority-bearing fields for §5 rule 3 replay equality.

    Excludes independent acquisition timestamps, attempt-local clocks,
    generated generation_id, and content_hash.
    """
    acq = document.get('acquisition') or {}
    return {
        'format': document['format'],
        'schema_version': document['schema_version'],
        'status': document['status'],
        'run_id': document['run_id'],
        'run_scope': document['run_scope'],
        'source_revision': document['source_revision'],
        'generation_window': document['generation_window'],
        'live_source': document['live_source'],
        'evidence_scope': document['evidence_scope'],
        'acquisition_contract': {
            'live_source': acq.get('live_source'),
            'evidence_scope': acq.get('evidence_scope'),
            'confirmation_outcome': acq.get('confirmation_outcome'),
        },
        'selection': document['selection'],
        'prepared_at': document['prepared_at'],
        'enrollment_observed_at': document['enrollment_observed_at'],
        'physical_grouping_complete': document['physical_grouping_complete'],
        'account_count': document['account_count'],
        'counts': document['counts'],
        'accounts': document['accounts'],
        'uncovered_deployments': document['uncovered_deployments'],
        'rejected': document['rejected'],
    }


@dataclass(frozen=True)
class DisplayMetadataRecord:
    display_scope: str
    observed_at: str
    headers: tuple  # tuple[DisplayHeader, ...]


class InMemoryConditionalRosterStore:
    """Thread-safe shared atomic create-if-absent run store + separate display metadata store.

    Simulates a shared external conditional store across independent producers (§5 rules 2, 5, 6).
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._runs: dict[str, bytes] = {}
        self._display: dict[str, DisplayMetadataRecord] = {}
        self.lose_next_create_ack = False
        self.fail_reads = False
        self.fail_writes = False
        self.create_calls = 0

    def create_if_absent(self, run_key: str, payload: bytes) -> tuple[bool, bytes]:
        if not isinstance(payload, (bytes, bytearray)):
            raise TypeError('publication_payload_bytes_required')
        with self._lock:
            self.create_calls += 1
            if self.fail_writes:
                raise PublicationStoreUnavailable('publication_write_failed')
            if run_key in self._runs:
                return False, self._runs[run_key]
            immutable = bytes(payload)
            self._runs[run_key] = immutable
            if self.lose_next_create_ack:
                self.lose_next_create_ack = False
                raise PublicationStoreUnavailable('publication_ack_lost')
            return True, immutable

    def read_run(self, run_key: str) -> bytes | None:
        with self._lock:
            if self.fail_reads:
                raise PublicationStoreUnavailable('publication_read_failed')
            return self._runs.get(run_key)

    def advance_display_metadata(
        self,
        scope_key: str,
        *,
        confirming_snapshot_at: str,
        headers: tuple[DisplayHeader, ...],
    ) -> bool:
        """Atomically advance display metadata only on strictly newer confirming source time."""
        cand_ts = parse_instant(confirming_snapshot_at)
        if cand_ts is None:
            raise AuthorityError('observation_time_invalid', STALE)
        with self._lock:
            current = self._display.get(scope_key)
            if current is not None:
                cur_ts = parse_instant(current.observed_at)
                if cur_ts is not None and cand_ts <= cur_ts:
                    return False
            self._display[scope_key] = DisplayMetadataRecord(
                display_scope=scope_key,
                observed_at=confirming_snapshot_at,
                headers=tuple(headers),
            )
            return True

    def read_display_metadata(self, scope_key: str) -> DisplayMetadataRecord | None:
        with self._lock:
            return self._display.get(scope_key)


class GCSConditionalRosterStore:
    """GCS-backed atomic create-if-absent run store + conditional display metadata store."""

    def __init__(self, prefix_uri, *, client=None):
        from daily_digest_delivery_store import location
        from google.cloud import storage

        self.client = client or storage.Client()
        self.bucket, self.prefix = location(prefix_uri)

    def _blob(self, key):
        return self.client.bucket(self.bucket).blob(f'{self.prefix}/{key}')

    def create_if_absent(self, run_key: str, payload: bytes) -> tuple[bool, bytes]:
        from google.api_core.exceptions import PreconditionFailed

        blob = self._blob(f'runs/{run_key}.json')
        try:
            blob.upload_from_string(
                payload,
                content_type='application/json',
                if_generation_match=0,
                retry=None,
                timeout=10,
            )
            if blob.generation is None:
                raise PublicationStoreUnavailable('publication_ack_lost')
            return True, bytes(payload)
        except PreconditionFailed:
            try:
                return False, blob.download_as_bytes(retry=None, timeout=10)
            except Exception:
                raise PublicationStoreUnavailable('publication_read_failed') from None
        except PublicationStoreUnavailable:
            raise
        except Exception:
            raise PublicationStoreUnavailable('publication_write_failed') from None

    def read_run(self, run_key: str) -> bytes | None:
        from google.api_core.exceptions import NotFound

        blob = self._blob(f'runs/{run_key}.json')
        try:
            return blob.download_as_bytes(retry=None, timeout=10)
        except NotFound:
            return None
        except Exception:
            raise PublicationStoreUnavailable('publication_read_failed') from None

    def read_display_metadata(self, scope_key: str) -> DisplayMetadataRecord | None:
        from google.api_core.exceptions import NotFound

        blob = self._blob(f'display/{scope_key}.json')
        try:
            doc = json.loads(blob.download_as_bytes(retry=None, timeout=10))
            return DisplayMetadataRecord(
                display_scope=doc['display_scope'],
                observed_at=doc['observed_at'],
                headers=tuple(
                    DisplayHeader(
                        group_id=h['group_id'],
                        platform=h['platform'],
                        account_key=h['account_key'],
                        deployments=tuple(tuple(p) for p in h['deployments']),
                        labels=tuple(tuple(lbl) for lbl in h['labels']),
                        scope=h['scope'],
                    )
                    for h in doc['headers']
                ),
            )
        except NotFound:
            return None
        except Exception:
            return None

    def advance_display_metadata(
        self,
        scope_key: str,
        *,
        confirming_snapshot_at: str,
        headers: tuple[DisplayHeader, ...],
    ) -> bool:
        from google.api_core.exceptions import NotFound, PreconditionFailed

        cand_ts = parse_instant(confirming_snapshot_at)
        if cand_ts is None:
            raise AuthorityError('observation_time_invalid', STALE)
        blob = self._blob(f'display/{scope_key}.json')
        payload = json.dumps({
            'display_scope': scope_key,
            'observed_at': confirming_snapshot_at,
            'headers': [
                {
                    'group_id': h.group_id,
                    'platform': h.platform,
                    'account_key': h.account_key,
                    'deployments': [list(p) for p in h.deployments],
                    'labels': [list(lbl) for lbl in h.labels],
                    'scope': h.scope,
                }
                for h in headers
            ],
        }, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
        for _ in range(3):
            try:
                raw = blob.download_as_bytes(retry=None, timeout=10)
                gen = blob.generation
                cur = json.loads(raw)
                cur_ts = parse_instant(cur.get('observed_at'))
                if cur_ts is not None and cand_ts <= cur_ts:
                    return False
                blob.upload_from_string(payload, content_type='application/json',
                                        if_generation_match=gen, retry=None, timeout=10)
                return True
            except NotFound:
                try:
                    blob.upload_from_string(payload, content_type='application/json',
                                            if_generation_match=0, retry=None, timeout=10)
                    return True
                except PreconditionFailed:
                    continue
            except PreconditionFailed:
                continue
            except Exception:
                return False
        return False


@dataclass(frozen=True)
class PublicationOutcome:
    """Result of one conditional publication attempt."""
    status: str  # available | fallback | unavailable
    envelope: dict = field(repr=False)
    envelope_bytes: bytes = field(repr=False)
    generation_id: str | None
    run_key: str
    display_scope: str
    replayed: bool = False
    committed: bool = False
    failure_code: str | None = None
    failure_kind: str | None = None
    attempts: int = 0
    collected: object = field(default=None, repr=False)


class ConditionalRosterPublisher:
    """Independent producer client executing §5 rules 1-5 against a shared CAS store."""

    def __init__(self, boot, client, enrollment_source, store, clock, recipient_scope):
        if not isinstance(boot, RosterBootConfig) or boot.mode != 'mapping_v1':
            raise ValueError('digest_roster_mode_invalid')
        if not isinstance(recipient_scope, str) or not recipient_scope:
            raise ValueError('digest_recipient_scope_invalid')
        self._boot = boot
        self._client = client
        self._enrollment_source = enrollment_source
        self._store = store
        self._clock = clock
        self._recipient_scope = recipient_scope

    def publish_generation(
        self,
        *,
        report_date: str,
        original_slot: str,
        generation_window: dict,
        deadline: datetime,
        preview: bool = False,
        collect=None,
        generation_id: str | None = None,
    ) -> PublicationOutcome:
        run_scope = make_run_scope(
            self._boot,
            recipient_scope=self._recipient_scope,
            report_date=report_date,
            original_slot=original_slot,
            preview=preview,
        )
        run_key = run_publication_key(run_scope)
        d_scope = display_scope_key(self._boot, recipient_scope=self._recipient_scope, preview=preview)
        gen_id = generation_id or f"gen-{next(_pub_sequence):06d}"
        attempts = 0
        try:
            accepted = acquire_and_validate_roster(
                boot=self._boot,
                client=self._client,
                enrollment_source=self._enrollment_source,
                clock=self._clock,
                deadline=deadline,
                run_scope=run_scope,
                generation_window=generation_window,
                generation_id=gen_id,
                collect=collect,
            )
            attempts = accepted.attempts
            created, stored_bytes = self._store.create_if_absent(run_key, accepted.envelope_bytes)
            if created:
                self._store.advance_display_metadata(
                    d_scope,
                    confirming_snapshot_at=accepted.envelope['source_snapshot_at'],
                    headers=headers_from_roster(accepted.roster),
                )
                return PublicationOutcome(
                    status=STATUS_AVAILABLE,
                    envelope=accepted.envelope,
                    envelope_bytes=accepted.envelope_bytes,
                    generation_id=accepted.envelope['generation_id'],
                    run_key=run_key,
                    display_scope=d_scope,
                    replayed=False,
                    committed=True,
                    attempts=attempts,
                    collected=accepted.collected,
                )

            # Record already exists for this run_key: apply §5 rule 3 strictly.
            existing = self._validate_existing_and_compare(
                stored_bytes,
                candidate=accepted.envelope,
                run_scope=run_scope,
                acceptance_clock=accepted.accepted_at,
            )
            headers = tuple(
                DisplayHeader(
                    group_id=acc['group_id'],
                    platform=acc['platform'],
                    account_key=acc['account_key'],
                    deployments=tuple((d['platform'], d['legacy_key']) for d in acc['deployments']),
                    labels=tuple((lbl['platform'], lbl['legacy_key'], lbl['label']) for lbl in acc['labels']),
                    scope=acc['scope'],
                )
                for acc in existing['accounts']
            )
            self._store.advance_display_metadata(
                d_scope,
                confirming_snapshot_at=existing['acquisition']['confirming_snapshot_at'],
                headers=headers,
            )
            return PublicationOutcome(
                status=STATUS_AVAILABLE,
                envelope=existing,
                envelope_bytes=stored_bytes,
                generation_id=existing['generation_id'],
                run_key=run_key,
                display_scope=d_scope,
                replayed=True,
                committed=True,
                attempts=attempts,
                collected=accepted.collected,
            )
        except AuthorityError as error:
            return self._fallback_outcome(
                run_scope=run_scope,
                run_key=run_key,
                display_scope=d_scope,
                generation_window=generation_window,
                failure_code=error.code,
                failure_kind=error.kind,
                attempts=attempts or 1,
            )
        except PublicationStoreUnavailable as error:
            return self._fallback_outcome(
                run_scope=run_scope,
                run_key=run_key,
                display_scope=d_scope,
                generation_window=generation_window,
                failure_code=error.code,
                failure_kind=UNAVAILABLE,
                attempts=attempts or 1,
            )

    @staticmethod
    def _validate_existing_and_compare(stored_bytes, *, candidate, run_scope, acceptance_clock):
        try:
            existing = strict_json(stored_bytes)
            validate_roster_envelope(existing)
            verify_content_hash(existing)
        except AuthorityError:
            raise AuthorityError('publication_record_corrupt', CONFLICT) from None
        if existing['format'] != ROSTER_FORMAT or existing['status'] != STATUS_AVAILABLE:
            raise AuthorityError('publication_record_corrupt', CONFLICT)
        if existing['run_id'] != candidate['run_id'] or existing['run_scope'] != run_scope:
            raise AuthorityError('publication_scope_mismatch', CONFLICT)
        if (existing['source_revision'] != candidate['source_revision']
                or existing['selection'] != candidate['selection']):
            raise AuthorityError('publication_revision_conflict', CONFLICT)
        if authority_bearing_projection(existing) != authority_bearing_projection(candidate):
            raise AuthorityError('publication_content_conflict', CONFLICT)
        # Validate both original source times at actual acceptance: replay cannot refresh stale bytes.
        check_envelope_freshness(existing, acceptance_clock)
        return existing

    def _fallback_outcome(self, *, run_scope, run_key, display_scope, generation_window,
                          failure_code, failure_kind, attempts):
        baseline = self._store.read_display_metadata(display_scope)
        if baseline is None:
            doc, raw_bytes = build_unavailable_roster_envelope(
                run_scope=run_scope,
                generation_window=generation_window,
                failure_code=failure_code,
                failure_kind=failure_kind,
            )
            return PublicationOutcome(
                status=doc['status'],
                envelope=doc,
                envelope_bytes=raw_bytes,
                generation_id=None,
                run_key=run_key,
                display_scope=display_scope,
                replayed=False,
                committed=False,
                failure_code=failure_code,
                failure_kind=failure_kind,
                attempts=attempts,
            )
        try:
            now = trusted_clock(self._clock())
            snap_ts = parse_instant(baseline.observed_at)
            age_seconds = observation_age(snap_ts, now).total_seconds() if snap_ts is not None else None
        except AuthorityError:
            age_seconds = None
        doc, raw_bytes = build_fallback_roster_envelope(
            run_scope=run_scope,
            source_snapshot_at=baseline.observed_at,
            observation_age_seconds=age_seconds,
            generation_window=generation_window,
            headers=baseline.headers,
            failure_code=failure_code,
            failure_kind=failure_kind,
        )
        return PublicationOutcome(
            status=doc['status'],
            envelope=doc,
            envelope_bytes=raw_bytes,
            generation_id=None,
            run_key=run_key,
            display_scope=display_scope,
            replayed=False,
            committed=False,
            failure_code=failure_code,
            failure_kind=failure_kind,
            attempts=attempts,
        )


def consume_run_roster(store, *, boot, recipient_scope, report_date, original_slot,
                       expected_selection, clock, preview=False):
    """Consumer-side read of the committed run record (§5 rule 4): checks integrity,
    provenance, run binding, and B3-08 source freshness without polling, electing,
    or re-deriving ownership.
    """
    run_scope = make_run_scope(
        boot,
        recipient_scope=recipient_scope,
        report_date=report_date,
        original_slot=original_slot,
        preview=preview,
    )
    run_key = run_publication_key(run_scope)
    stored_bytes = store.read_run(run_key)
    if stored_bytes is None:
        raise AuthorityError('roster_not_published', UNAVAILABLE)
    return validate_consumer_provenance(
        stored_bytes,
        clock=clock,
        expected_run_id=f'{report_date}/{original_slot}',
        expected_run_scope=run_scope,
        expected_selection=expected_selection,
    )


__all__ = [
    'ConditionalRosterPublisher',
    'DisplayMetadataRecord',
    'GCSConditionalRosterStore',
    'InMemoryConditionalRosterStore',
    'PublicationOutcome',
    'PublicationStoreUnavailable',
    'authority_bearing_projection',
    'consume_run_roster',
    'display_scope_key',
    'run_publication_key',
]
