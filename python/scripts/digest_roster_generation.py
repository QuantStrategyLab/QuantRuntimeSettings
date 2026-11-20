"""One digest generation's management authority, with display fallback (Q5).

A generation resolves the currently selected enrollment artifact, acquires a
fresh B2 observation before intake, composes the roster, runs the caller's
intake against that roster, and acquires a confirming observation at the
decision to render. Both observations must satisfy the time window at that
decision and agree exactly on every compared axis; the selection must be
unchanged. On a revision race or a stale read the whole attempt is retried
once if the generation deadline permits. Any other failure, or a second race,
discards every provisional result of the attempt and falls back to the last
completely validated display snapshot for the same source, configuration
context and recipient scope, with management unknown for every row.
"""
from __future__ import annotations

import itertools
import threading
from dataclasses import dataclass, field
from datetime import timedelta

from digest_roster_authority import (
    CONFLICT, STALE, UNAVAILABLE, AcquisitionClient, AuthorityError, EnrollmentArtifact, GenerationRoster,
    LiveObservation, RosterBootConfig, compose_generation, load_artifact, observation_age, parse_instant,
    read_selection, trusted_clock, within_window,
)

RETRYABLE = frozenset({STALE, CONFLICT})
CURRENT, FALLBACK, ROSTER_UNAVAILABLE = 'current', 'fallback', 'unavailable'
_sequence = itertools.count(1)


@dataclass(frozen=True)
class DisplayHeader:
    """Retained display metadata of one physical group; no status or class."""
    deployments: tuple
    labels: tuple
    scope: str


@dataclass(frozen=True)
class DisplaySnapshot:
    key: tuple
    observed_at: str
    headers: tuple
    lineage: tuple = field(repr=False)   # the validated observation vector
    started: int = 0

    @property
    def observed(self):
        return parse_instant(self.observed_at)


def compare_lineage(new, old):
    """Order two validated observation vectors on their revision axes.

    Returns `advanced` when any instance, policy or per-group applied revision
    moved forward and `same` otherwise. A backwards revision on any axis, a
    repeated applied revision with different content, or different structural
    content (membership, class or scope) at the same instance and policy
    revisions raises a conflict. A coherent management-only apply advances
    the per-group applied revision without a structural change.
    """
    new_instance, new_policy, new_groups, new_uncovered = new
    old_instance, old_policy, old_groups, old_uncovered = old
    if new_instance < old_instance or new_policy < old_policy:
        raise AuthorityError('revision_regressed', CONFLICT)
    advanced = (new_instance, new_policy) != (old_instance, old_policy)
    if not advanced and ({group[0]: (group[1], group[4]) for group in new_groups}
                         != {group[0]: (group[1], group[4]) for group in old_groups}
                         or new_uncovered != old_uncovered):
        raise AuthorityError('revision_content_mismatch', CONFLICT)
    prior = {group[0]: group[-1] for group in old_groups}
    for group in new_groups:
        applied, old_applied = group[-1], prior.get(group[0])
        if applied is None or old_applied is None:
            continue
        if applied[1] < old_applied[1]:
            raise AuthorityError('revision_regressed', CONFLICT)
        if applied[1] == old_applied[1] and applied != old_applied:
            raise AuthorityError('revision_content_mismatch', CONFLICT)
        advanced = advanced or applied[1] > old_applied[1]
    return 'advanced' if advanced else 'same'


class DisplaySnapshotStore:
    """In-process last-validated display snapshots, replaced atomically.

    Publication compares the candidate's lineage with the latest snapshot
    under the lock. A regressed or contradictory lineage is refused, and the
    generation that produced it cannot return current. An advanced lineage
    replaces the snapshot; an equal lineage replaces it only when observed
    later, or equally late by a later-started generation.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._items = {}

    def get(self, key):
        with self._lock:
            return self._items.get(key)

    def publish(self, snapshot):
        """Accept `snapshot` for publication or raise AuthorityError. Returns
        whether it replaced the retained display snapshot."""
        if not isinstance(snapshot, DisplaySnapshot):
            raise TypeError('display_snapshot_invalid')
        with self._lock:
            current = self._items.get(snapshot.key)
            if current is not None:
                relation = compare_lineage(snapshot.lineage, current.lineage)
                if relation == 'same' and (snapshot.observed, snapshot.started) <= (current.observed,
                                                                                    current.started):
                    return False
            self._items[snapshot.key] = snapshot
            return True

    def replace(self, snapshot):
        try:
            return self.publish(snapshot)
        except AuthorityError:
            return False


@dataclass(frozen=True)
class GenerationContext:
    """The immutable context pinned for constructor, source reads,
    aggregation, labels, recipient mapping and render."""
    roster: GenerationRoster
    confirmation: LiveObservation = field(repr=False)
    decided_at: object
    key: tuple
    attempts: int

    @property
    def observed_at(self):
        return self.roster.observed_at


@dataclass(frozen=True)
class GenerationOutcome:
    status: str                       # current | fallback | unavailable
    context: GenerationContext | None
    collected: object = field(default=None, repr=False)
    snapshot: DisplaySnapshot | None = None
    failure_code: str | None = None
    failure_kind: str | None = None   # stale | conflict | unavailable
    age: timedelta | None = None
    attempts: int = 0

    @property
    def management_known(self):
        return self.status == CURRENT


class GenerationRunner:
    """Per-process runner over one protected boot configuration."""

    def __init__(self, boot, client, enrollment, clock, snapshots=None, recipient_scope=''):
        if not isinstance(boot, RosterBootConfig) or not isinstance(client, AcquisitionClient):
            raise ValueError('digest_roster_mode_invalid')
        if not isinstance(recipient_scope, str) or not recipient_scope:
            raise ValueError('digest_recipient_scope_invalid')
        self._boot, self._client, self._enrollment, self._clock = boot, client, enrollment, clock
        self._snapshots = snapshots if snapshots is not None else DisplaySnapshotStore()
        self._artifacts = {}
        self.key = (boot.enrollment_source, boot.config_context, recipient_scope)

    @property
    def snapshots(self):
        return self._snapshots

    def _now(self):
        return trusted_clock(self._clock())

    def _remaining(self, deadline):
        return (deadline - self._now()).total_seconds()

    def _select(self):
        try:
            return read_selection(self._enrollment.read_selection(), self._boot.enrollment_source)
        except AuthorityError:
            raise
        except Exception:
            raise AuthorityError('enrollment_selection_unavailable') from None

    def _artifact(self, selection):
        # Validated structural bytes are reused only for the same immutable
        # selection (source, versions and digest); composition re-checks the
        # deployment sets and the instance/policy bindings every generation.
        cached = self._artifacts.get(selection)
        if isinstance(cached, EnrollmentArtifact):
            return cached
        try:
            read = self._enrollment.read_artifact(selection)
        except Exception:
            raise AuthorityError('enrollment_artifact_unavailable') from None
        artifact = load_artifact(selection, read)
        self._artifacts = {selection: artifact}
        return artifact

    @property
    def boot(self):
        return self._boot

    def _lineage(self, observation):
        baseline = self._snapshots.get(self.key)
        if baseline is not None:
            compare_lineage(observation.vector(), baseline.lineage)

    def _attempt(self, collect, deadline, attempts):
        selection = self._select()
        artifact = self._artifact(selection)
        first = self._client.acquire(self._now(), timeout=self._remaining(deadline))
        if not within_window(first.observed, self._now()):
            raise AuthorityError('observation_stale', STALE)
        self._lineage(first)
        roster = compose_generation(first, artifact)
        collected = collect(roster) if collect is not None else None
        confirmation = self._client.acquire(self._now(), timeout=self._remaining(deadline))
        final = self._select()
        # The decision to render follows the last read: both observations and
        # the generation deadline are judged at this instant.
        decided = self._now()
        if confirmation.vector() != first.vector():
            raise AuthorityError('revision_race', CONFLICT)
        if final != selection:
            raise AuthorityError('enrollment_selection_changed', CONFLICT)
        if not (within_window(first.observed, decided) and within_window(confirmation.observed, decided)):
            raise AuthorityError('observation_stale', STALE)
        if decided > deadline:
            raise AuthorityError('generation_deadline_exhausted')
        return GenerationContext(roster, confirmation, decided, self.key, attempts), collected

    def run(self, collect=None, *, deadline):
        """Run one generation. `collect(roster)` performs intake against the
        pinned roster; its result is returned only with current authority."""
        started = next(_sequence)
        deadline = trusted_clock(deadline)
        attempts, failure = 0, None
        while attempts < 2:
            attempts += 1
            try:
                if self._remaining(deadline) <= 0:
                    raise AuthorityError('generation_deadline_exhausted')
                context, collected = self._attempt(collect, deadline, attempts)
                snapshot = DisplaySnapshot(self.key, context.observed_at, tuple(
                    DisplayHeader(group.deployments, group.labels, group.live.scope)
                    for group in context.roster.groups), context.roster.observation.vector(), started)
                # Accepting the result for publication and return compares
                # lineage with the latest snapshot atomically; a regression
                # discards this attempt's provisional output.
                self._snapshots.publish(snapshot)
            except AuthorityError as error:
                failure = error
                if error.kind in RETRYABLE and attempts < 2 and self._remaining(deadline) > 0:
                    continue
                break
            return GenerationOutcome(CURRENT, context, collected, snapshot, attempts=attempts,
                                     age=observation_age(context.roster.observation.observed, context.decided_at))
        return self._fallback(failure, attempts)

    def _fallback(self, failure, attempts):
        code, kind = failure.code, failure.kind
        snapshot = self._snapshots.get(self.key)
        try:
            now = self._now()
        except AuthorityError:
            now = None
        if snapshot is None:
            return GenerationOutcome(ROSTER_UNAVAILABLE, None, failure_code=code, failure_kind=kind,
                                     attempts=attempts)
        age = observation_age(snapshot.observed, now) if now is not None else None
        return GenerationOutcome(FALLBACK, None, snapshot=snapshot, failure_code=code, failure_kind=kind,
                                 age=age, attempts=attempts)


__all__ = ['CURRENT', 'FALLBACK', 'ROSTER_UNAVAILABLE', 'UNAVAILABLE', 'DisplayHeader', 'DisplaySnapshot',
           'DisplaySnapshotStore', 'compare_lineage', 'GenerationContext', 'GenerationOutcome', 'GenerationRunner']
