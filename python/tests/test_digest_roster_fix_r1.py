"""Deciding controls for the round-1 review findings (F01-F19).

Each test reproduces the reviewer's probe shape at its deciding entry and
asserts the outcome the adjudicated property requires. Output carries only
named outcome codes and counts.
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest.mock import patch

from digest_roster_support import (
    BOOT, OBSERVED, OutboundTrap, SyntheticAuth, SyntheticEnrollmentSource, SyntheticTransport, at, authority,
    ok, prepare, scenario,
)

import cloud_run_daily_digest as app  # noqa: E402
import digest_roster_generation as generation  # noqa: E402
import test_digest_roster_gen_e2e as e2e  # noqa: E402
from test_cloud_run_daily_digest import MemoryStore  # noqa: E402

PAPER_PAIR = tuple(e2e.support.CORPUS['roles']['paper'][0].split('/', 1))


class Clock:
    def __init__(self, value=OBSERVED):
        self.value = value

    def __call__(self):
        return self.value

    def advance(self, seconds):
        self.value += timedelta(seconds=seconds)


def managed(outcome):
    return sum(group.live.management_status == 'managed' for group in outcome.context.roster.groups)


class Base(unittest.TestCase):
    def setUp(self):
        self.trap = OutboundTrap().__enter__()
        self.clock = Clock()
        self.transport = SyntheticTransport()
        self.data = prepare()[0]
        self.source = SyntheticEnrollmentSource(self.data)
        self.store = generation.DisplaySnapshotStore()

    def tearDown(self):
        self.trap.__exit__(None, None, None)
        self.assertEqual(self.trap.attempts, 0, 'zero outbound calls')

    def runner(self, scope='synthetic_recipient', transport=None, source=None, clock=None):
        client = authority.AcquisitionClient(BOOT, SyntheticAuth(), transport or self.transport)
        return generation.GenerationRunner(BOOT, client, source or self.source, clock or self.clock,
                                           self.store, scope)

    def reads(self, *documents, transport=None):
        (transport or self.transport).responses.extend(ok(document) for document in documents)


def _paper_moved_to_live():
    document = scenario('all_on')
    for group in document['groups']:
        if [(item['platform'], item['key']) for item in group['deployments']] == [PAPER_PAIR]:
            group['scope'] = 'live'
    return document


class Group1Binding(Base):
    """F01-F05: acquisition, confirmation and publication bound to one slot."""

    def cloud(self, locale='en'):
        with patch.dict(os.environ, e2e._boot_env({'QSL_NOTIFY_LANG': locale}), clear=True):
            return app.Configuration.from_environment()

    def cloud_runner(self, transport, scope='syn-scope', snapshots=None):
        client = authority.AcquisitionClient(BOOT, SyntheticAuth(), transport)
        return generation.GenerationRunner(BOOT, client, self.source, lambda: e2e.OBS_CLOCK,
                                           snapshots or self.store, recipient_scope=scope)

    def test_f01_no_supplied_outcome_reaches_the_generation_entry(self):
        cfg = self.cloud()
        self.assertFalse(hasattr(cfg, 'roster_outcome'))
        self.assertFalse(hasattr(cfg, 'roster_envelope'))
        prior = self.cloud_runner(SyntheticTransport(ok(scenario('all_on')), ok(scenario('all_on'))))
        outcome = prior.run(deadline=e2e.OBS_CLOCK + timedelta(seconds=30))
        self.assertEqual(outcome.status, generation.CURRENT)
        with self.assertRaises(TypeError):
            e2e.app.execute_slot(e2e.REPORT_DATE.date(), e2e.DAY, False, {'scheduled_at': 'x'}, cfg,
                                 MemoryStore({}), lambda body: 1, preview=True, roster_outcome=outcome)

    def test_f01_every_generation_including_preview_owns_both_reads(self):
        cfg = self.cloud()
        transport = SyntheticTransport()
        runner = self.cloud_runner(transport)
        for preview in (False, True, True):
            with self.subTest(preview=preview):
                before, selections = len(transport.requests), self.source.selection_reads
                self.reads(scenario('all_on'), scenario('all_on'), transport=transport)
                sent = []
                code, result = e2e._slot_args(cfg, MemoryStore({}), sent, preview=preview, runner=runner)
                self.assertEqual(code, 200)
                self.assertEqual(len(transport.requests) - before, 2, 'initial and confirming B2 reads')
                self.assertEqual(self.source.selection_reads - selections, 2, 'initial and final selection')
        # A later preview with no fresh authority available renders no
        # current status and starts no intake on the retained bindings.
        transport.responses.append((403, {}, b''))
        store = MemoryStore({})
        reads = []
        store.candidate = lambda *args, **kwargs: reads.append(1)
        code, result = e2e._slot_args(cfg, store, [], preview=True, runner=runner)
        self.assertEqual((code, result['delivery'], reads), (200, 'preview', []))

    def test_f02_runner_for_another_recipient_is_never_consulted(self):
        cfg = self.cloud()
        transport = SyntheticTransport(ok(scenario('all_on')), ok(scenario('all_on')))
        foreign = self.cloud_runner(transport, scope='other-recipient')
        self.assertEqual(foreign.run(deadline=e2e.OBS_CLOCK + timedelta(seconds=30)).status, generation.CURRENT)
        transport.responses.append((403, {}, b''))
        before = len(transport.requests)
        sent = []
        code, result = e2e._slot_args(cfg, MemoryStore({}), sent, runner=foreign)
        self.assertEqual(code, 200)
        self.assertEqual(sent[0].count('🏦 '), 0, 'no cached headers from another recipient')
        self.assertIn('Account roster unavailable', sent[0])
        self.assertEqual(len(transport.requests), before, 'zero reads through the foreign runner')

    def test_f02_runner_for_another_boot_context_is_never_consulted(self):
        cfg = self.cloud()
        other_boot = authority.RosterBootConfig(authority.MAPPING_MODE, BOOT.origin, BOOT.auth_policy,
                                                BOOT.enrollment_source, 'other_context')
        transport = SyntheticTransport(ok(scenario('all_on')), ok(scenario('all_on')))
        client = authority.AcquisitionClient(other_boot, SyntheticAuth(), transport)
        runner = generation.GenerationRunner(other_boot, client, self.source, lambda: e2e.OBS_CLOCK,
                                             self.store, recipient_scope='syn-scope')
        sent = []
        e2e._slot_args(cfg, MemoryStore({}), sent, runner=runner)
        self.assertEqual((sent[0].count('🏦 '), len(transport.requests)), (0, 0))

    def test_f03_slow_final_selection_cannot_return_current(self):
        runner = self.runner()
        self.reads(scenario('all_on'), scenario('all_on'))
        self.assertEqual(runner.run(deadline=self.clock() + timedelta(seconds=60)).status, generation.CURRENT)
        original = self.source.read_selection

        def slow():
            if self.source.selection_reads % 2 == 1:   # the final read of each attempt
                self.clock.advance(360)
            return original()
        self.source.read_selection = slow
        self.reads(*[at(scenario('all_on'), self.clock())] * 4)
        outcome = runner.run(deadline=self.clock() + timedelta(seconds=600))
        self.assertNotEqual(outcome.status, generation.CURRENT)
        self.assertEqual(outcome.failure_kind, 'stale')

    def test_f03_final_selection_past_the_deadline_cannot_return_current(self):
        runner = self.runner()
        original = self.source.read_selection

        def slow():
            if self.source.selection_reads % 2 == 1:
                self.clock.advance(20)
            return original()
        self.source.read_selection = slow
        self.reads(scenario('all_on'), scenario('all_on'))
        outcome = runner.run(deadline=self.clock() + timedelta(seconds=10))
        self.assertEqual((outcome.status, outcome.failure_code),
                         (generation.ROSTER_UNAVAILABLE, 'generation_deadline_exhausted'))

    def test_f04_scope_change_at_fixed_revisions_never_validates(self):
        moved = _paper_moved_to_live()
        # Against a validated lineage.
        runner = self.runner()
        self.reads(scenario('all_on'), scenario('all_on'))
        self.assertEqual(runner.run(deadline=self.clock() + timedelta(seconds=60)).status, generation.CURRENT)
        self.reads(*[moved] * 4)
        outcome = runner.run(deadline=self.clock() + timedelta(seconds=60))
        self.assertEqual((outcome.status, outcome.failure_kind), (generation.FALLBACK, 'conflict'))
        self.assertEqual(len(outcome.snapshot.headers), 10)
        # Without a baseline the composition recheck refuses the paper binding.
        self.store = generation.DisplaySnapshotStore()
        fresh = self.runner()
        calls = []
        self.reads(*[moved] * 4)
        outcome = fresh.run(lambda roster: calls.append(1), deadline=self.clock() + timedelta(seconds=60))
        self.assertEqual((outcome.status, outcome.failure_code, calls),
                         (generation.ROSTER_UNAVAILABLE, 'binding_scope_mismatch', []))

    def test_f04_management_only_advance_is_coherent(self):
        runner = self.runner()
        self.reads(scenario('all_on'), scenario('all_on'))
        self.assertEqual(managed(runner.run(deadline=self.clock() + timedelta(seconds=60))), 9)
        self.reads(scenario('one_off'), scenario('one_off'))
        self.assertEqual(managed(runner.run(deadline=self.clock() + timedelta(seconds=60))), 8)

    def test_f05_overlapping_older_completion_cannot_return_or_publish(self):
        newer_transport = SyntheticTransport(ok(at(scenario('one_off'), OBSERVED)),
                                             ok(at(scenario('one_off'), OBSERVED)))
        newer = self.runner(transport=newer_transport)
        older = self.runner()
        late = at(scenario('all_on'), OBSERVED + timedelta(seconds=1))   # older vector, later timestamp
        self.reads(late, late, late, late)

        def overlap(_roster):
            if not newer_transport.requests:
                self.assertEqual(managed(newer.run(deadline=self.clock() + timedelta(seconds=60))), 8)
            return 'provisional'
        self.clock.advance(2)
        outcome = older.run(overlap, deadline=self.clock() + timedelta(seconds=60))
        self.assertNotEqual(outcome.status, generation.CURRENT)
        self.assertIsNone(outcome.collected, 'provisional output discarded')
        self.assertEqual(outcome.failure_code, 'revision_regressed')
        retained = self.store.get(older.key)
        self.assertEqual(sum(group[2] == 'managed' for group in retained.lineage[2]), 8)

    def test_f05_publication_refuses_a_regressed_lineage_atomically(self):
        runner = self.runner()
        self.reads(scenario('one_off'), scenario('one_off'))
        runner.run(deadline=self.clock() + timedelta(seconds=60))
        current = self.store.get(runner.key)
        stale_vector = authority.validate_readback(scenario('all_on')).vector()
        regressed = generation.DisplaySnapshot(current.key, '2026-11-19T23:00:05.000Z', current.headers,
                                               stale_vector, current.started + 1)
        with self.assertRaises(authority.AuthorityError):
            self.store.publish(regressed)
        self.assertIs(self.store.get(runner.key), current)


if __name__ == '__main__':
    unittest.main()
