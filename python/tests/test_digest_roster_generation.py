"""Generation tests: two reads, the pinned context, the time window, the one
retry on a revision race and the atomic display fallback (Q5; rows 07, 08,
09, 10, 11 at the generation-authority layer)."""
import json
import unittest
from datetime import timedelta

from digest_roster_support import (
    BOOT, OBSERVED, OutboundTrap, SyntheticAuth, SyntheticEnrollmentSource, SyntheticTransport, at, authority,
    ok, preparation, prepare, scenario,
)

import digest_roster_generation as generation  # noqa: E402  (path set by the support module)


class Clock:
    def __init__(self, value=OBSERVED):
        self.value = value

    def __call__(self):
        return self.value

    def advance(self, seconds):
        self.value += timedelta(seconds=seconds)


def statuses(outcome):
    return sorted(group.live.management_status for group in outcome.context.roster.groups)


def managed(outcome):
    return sum(group.live.management_status == 'managed' for group in outcome.context.roster.groups)


class Harness(unittest.TestCase):
    def setUp(self):
        self.trap = OutboundTrap().__enter__()
        self.clock = Clock()
        self.transport = SyntheticTransport()
        self.data = prepare()[0]
        self.source = SyntheticEnrollmentSource(self.data)
        self.store = generation.DisplaySnapshotStore()
        self.runner = self.make()

    def tearDown(self):
        self.trap.__exit__(None, None, None)
        self.assertEqual(self.trap.attempts, 0, 'zero outbound calls')

    def make(self, scope='synthetic_recipient', auth=None):
        client = authority.AcquisitionClient(BOOT, auth or SyntheticAuth(), self.transport)
        return generation.GenerationRunner(BOOT, client, self.source, self.clock, self.store, scope)

    def reads(self, *documents):
        self.transport.responses.extend(ok(document) for document in documents)

    def run_once(self, collect=None, runner=None, budget=60):
        return (runner or self.runner).run(collect, deadline=self.clock() + timedelta(seconds=budget))

    def baseline(self):
        self.reads(scenario('all_on'), scenario('all_on'))
        outcome = self.run_once()
        self.assertEqual(outcome.status, generation.CURRENT)
        return outcome

    def assert_fallback(self, outcome, kind, code=None, attempts=None):
        self.assertEqual(outcome.status, generation.FALLBACK)
        self.assertFalse(outcome.management_known)
        self.assertIsNone(outcome.context)
        self.assertIsNone(outcome.collected)
        self.assertEqual(outcome.failure_kind, kind)
        if code:
            self.assertEqual(outcome.failure_code, code)
        if attempts:
            self.assertEqual(outcome.attempts, attempts)
        self.assertEqual(len(outcome.snapshot.headers), 10)
        self.assertEqual(outcome.snapshot.observed_at, '2026-11-19T23:00:00.000Z')
        self.assertFalse(hasattr(outcome.snapshot.headers[0], 'management_status'))


class Current(Harness):
    def test_both_reads_and_the_selection_bind_one_context(self):
        self.reads(scenario('all_on'), scenario('all_on'))
        seen = []
        outcome = self.run_once(lambda roster: seen.append(roster) or 'intake')
        self.assertEqual(outcome.status, generation.CURRENT)
        self.assertEqual(outcome.collected, 'intake')
        self.assertIs(seen[0], outcome.context.roster)
        self.assertEqual(len(self.transport.requests), 2)
        self.assertEqual(self.source.selection_reads, 2)
        self.assertEqual(managed(outcome), 9)
        self.assertIsNotNone(self.store.get(self.runner.key))


class Window(Harness):
    def test_row_08_exact_inclusive_bounds_at_the_decision_to_render(self):
        G = OBSERVED
        for offset, accepted in ((timedelta(seconds=-300), True), (timedelta(seconds=-300, milliseconds=-1), False),
                                 (timedelta(seconds=30), True), (timedelta(seconds=30, milliseconds=1), False)):
            with self.subTest(offset=offset):
                self.setUp()
                self.baseline()
                document = at(scenario('all_on'), G + offset)
                self.reads(*[document] * 4)
                outcome = self.run_once()
                if accepted:
                    self.assertEqual(outcome.status, generation.CURRENT)
                    self.assertEqual(outcome.age, max(timedelta(0), -offset))
                else:
                    self.assert_fallback(outcome, 'stale', 'observation_stale', attempts=2)
                    self.assertEqual(outcome.age, timedelta(0))
                self.tearDown()

    def test_row_08_malformed_or_absent_time_passes_nothing(self):
        for value in ('2026-11-19T23:00:00', None):
            with self.subTest(value):
                self.setUp()
                self.baseline()
                document = scenario('all_on')
                document['observed_at'] = value
                self.reads(*[document] * 4)
                self.assert_fallback(self.run_once(), 'stale', 'observation_time_invalid', attempts=2)
                self.tearDown()

    def test_row_08_first_read_expiring_during_collection_retries_once(self):
        self.reads(scenario('all_on'), at(scenario('all_on'), OBSERVED + timedelta(seconds=301)))
        self.reads(at(scenario('all_on'), OBSERVED + timedelta(seconds=301)),
                   at(scenario('all_on'), OBSERVED + timedelta(seconds=301)))
        collected = []

        def collect(roster):
            collected.append(roster.observed_at)
            if len(collected) == 1:
                self.clock.advance(301)
            return len(collected)
        outcome = self.run_once(collect, budget=600)
        self.assertEqual(outcome.status, generation.CURRENT)
        self.assertEqual(outcome.attempts, 2)
        self.assertEqual(outcome.collected, 2, 'the first attempt intake is discarded')

    def test_row_08_untrusted_clock_is_unavailable(self):
        self.clock.value = OBSERVED.replace(tzinfo=None)
        with self.assertRaises(authority.AuthorityError):
            self.run_once()


class Races(Harness):
    def test_row_09_successive_slots_draft_apply_and_stable_reacquisition(self):
        self.reads(scenario('all_on'), scenario('all_on'))
        self.assertEqual(managed(self.run_once()), 9)
        self.reads(scenario('draft_off_only'), scenario('draft_off_only'))
        self.assertEqual(managed(self.run_once()), 9, 'a saved draft changes nothing')
        self.reads(scenario('one_off'), scenario('one_off'))
        outcome = self.run_once()
        self.assertEqual(managed(outcome), 8)
        self.assertIn(2, {group.live.applied[1] for group in outcome.context.roster.groups if group.live.applied})
        # Apply OFF between the source read and render confirmation, then one
        # stable reacquisition reports the new vector.
        self.setUp()
        self.reads(scenario('all_on'), scenario('one_off'), scenario('one_off'), scenario('one_off'))
        outcome = self.run_once()
        self.assertEqual((outcome.status, outcome.attempts, managed(outcome)), (generation.CURRENT, 2, 8))

    def test_row_09_second_race_on_reacquisition_falls_back(self):
        self.baseline()
        self.reads(scenario('all_on'), scenario('one_off'), scenario('one_off'), scenario('all_off'))
        self.assert_fallback(self.run_once(), 'conflict', 'revision_race', attempts=2)

    def test_row_07_instance_and_policy_revision_against_structure(self):
        for name in ('instance_bumped', 'policy_bumped'):
            with self.subTest(name):
                self.setUp()
                self.baseline()
                self.reads(*[scenario(name)] * 4)
                self.assert_fallback(self.run_once(), 'conflict', 'structural_revision_mismatch', attempts=2)
                # A coherent new generation with a newly validated structural
                # input at the new revisions agrees with B2 on every group.
                live = scenario(name)
                projection = preparation('complete')['projection']
                for account in projection['accounts']:
                    account['configuration_revision'].update(instances=live['instance_revision'],
                                                             mapping_policy=live['policy_revision'])
                data, _ = prepare(readback=live, projection=projection,
                                  effective=live['effective_export']['records'],
                                  versions={'version': 'v2', 'membership_version': 'm2', 'label_version': 'l1',
                                            'link_version': 'k1'})
                self.source.select(data, {'version': 'v2', 'membership_version': 'm2', 'label_version': 'l1',
                                          'link_version': 'k1'})
                self.reads(live, live)
                outcome = self.run_once()
                self.assertEqual(outcome.status, generation.CURRENT)
                self.assertEqual([group.live.vector() for group in outcome.context.roster.groups],
                                 [group.vector() for group in authority.validate_readback(live).groups])
                self.tearDown()

    def test_row_07_applied_revision_and_same_revision_content_change(self):
        self.baseline()
        self.reads(*[scenario('all_on'), scenario('one_off')] * 2)
        self.assert_fallback(self.run_once(), 'conflict', 'revision_race', attempts=2)
        changed = scenario('all_on')
        index = next(i for i, group in enumerate(changed['groups']) if len(group['deployments']) == 1
                     and group['applied'])
        new_time = '2026-11-19T21:00:00.000Z'
        old_time = changed['groups'][index]['applied']['effective_at']
        changed['groups'][index]['applied']['effective_at'] = new_time
        pair = (changed['groups'][index]['deployments'][0]['platform'], changed['groups'][index]['deployments'][0]['key'])
        for record in changed['effective_export']['records']:
            if (record['platform'], record['legacy_key']) == pair:
                self.assertEqual(record['effective_at'], old_time)
                record['effective_at'] = new_time
        self.reads(*[scenario('all_on'), changed] * 2)
        self.assert_fallback(self.run_once(), 'conflict', 'revision_race', attempts=2)
        # Against the validated lineage the same revision with other content
        # cannot validate either, even when both reads agree.
        self.reads(*[changed] * 4)
        self.assert_fallback(self.run_once(), 'conflict', 'revision_content_mismatch', attempts=2)

    def test_backwards_revision_cannot_validate(self):
        self.reads(scenario('one_off'), scenario('one_off'))
        self.assertEqual(self.run_once().status, generation.CURRENT)
        self.reads(*[scenario('all_on')] * 4)
        outcome = self.run_once()
        self.assertEqual((outcome.status, outcome.failure_code), (generation.FALLBACK, 'revision_regressed'))


class Fallback(Harness):
    def test_row_10_failures_keep_the_validated_baseline_whole(self):
        truncated = scenario('all_on')
        truncated['groups'] = truncated['groups'][:7]
        incomplete = scenario('all_on')
        incomplete['physical_grouping_complete'] = False
        cases = {
            'management_read_timeout': ('unavailable', 1, [authority.AuthorityError('management_read_timeout')]),
            'management_read_denied': ('unavailable', 1, [(403, {}, b'')]),
            'physical_grouping_incomplete': ('unavailable', 1, [ok(incomplete)]),
            'readback_counts_inconsistent': ('conflict', 2, [ok(truncated)] * 2),
            'observation_stale': ('stale', 2, [ok(scenario('all_on'))] * 2),
        }
        for code, (kind, attempts, responses) in cases.items():
            with self.subTest(code):
                self.setUp()
                self.baseline()
                if code == 'observation_stale':
                    self.clock.advance(600)    # replay of the stale prior success
                self.transport.responses.extend(responses)
                calls = []
                outcome = self.run_once(lambda roster: calls.append(1))
                self.assert_fallback(outcome, kind, code, attempts=attempts)
                if code != 'observation_stale':
                    self.assertEqual(calls, [], 'no intake reads using old bindings')
                self.assertEqual(len(self.store.get(self.runner.key).headers), 10)
                # A later successful generation restores current status.
                self.reads(at(scenario('all_on'), self.clock()), at(scenario('all_on'), self.clock()))
                self.assertEqual(self.run_once().status, generation.CURRENT)
                self.tearDown()

    def test_row_10_wrong_or_unprepared_source_version_is_unavailable(self):
        self.baseline()
        # A newly selected artifact whose preparation was refused (#1173
        # incomplete) is never published; the selection names bytes that do
        # not exist, and the older artifact cannot stand in for it.
        with self.assertRaises(authority.AuthorityError):
            prepare('inventory_incomplete')
        self.source.current = {**self.source.current, 'version': 'v9', 'artifact_sha256': 'f' * 64}
        self.reads(scenario('all_on'), scenario('all_on'))
        outcome = self.run_once()
        self.assert_fallback(outcome, 'unavailable', 'enrollment_artifact_version_mismatch', attempts=1)
        self.assertEqual(self.transport.requests[2:], [], 'no read before the selection validates')

    def test_row_10_selection_changing_before_render_is_a_race(self):
        self.baseline()
        other = json.loads(self.data)
        other['label_version'] = 'l2'
        data = json.dumps(other).encode()
        reads = {'n': 0}
        original = self.source.read_selection

        def flip():
            reads['n'] += 1
            if reads['n'] == 2:
                self.source.select(data, {'version': 'v1', 'membership_version': 'm1', 'label_version': 'l2',
                                          'link_version': 'k1'})
            return original()
        self.source.read_selection = flip
        self.reads(*[scenario('all_on')] * 4)
        outcome = self.run_once()
        self.assertEqual((outcome.status, outcome.attempts), (generation.CURRENT, 2))
        self.assertEqual(outcome.context.roster.selection.label_version, 'l2')

    def test_row_10_older_completion_cannot_regress_the_cache(self):
        self.baseline()
        newer = self.store.get(self.runner.key)
        older = generation.DisplaySnapshot(newer.key, '2026-11-19T22:59:00.000Z', newer.headers[:3], newer.lineage,
                                           newer.started + 1)
        self.assertFalse(self.store.replace(older))
        concurrent = generation.DisplaySnapshot(newer.key, newer.observed_at, newer.headers[:3], newer.lineage,
                                                newer.started - 1)
        self.assertFalse(self.store.replace(concurrent))
        self.assertIs(self.store.get(self.runner.key), newer)

    def test_row_10_unavailable_selection_source(self):
        self.baseline()

        def broken():
            raise OSError('source down')
        self.source.read_selection = broken
        self.assert_fallback(self.run_once(), 'unavailable', 'enrollment_selection_unavailable', attempts=1)

    def test_row_11_no_baseline_or_other_context_is_roster_unavailable(self):
        self.transport.responses.append((403, {}, b''))
        outcome = self.run_once()
        self.assertEqual((outcome.status, outcome.snapshot, outcome.context), (generation.ROSTER_UNAVAILABLE, None, None))
        self.baseline()
        other = self.make(scope='other_recipient')
        self.transport.responses.append((403, {}, b''))
        outcome = self.run_once(runner=other)
        self.assertEqual(outcome.status, generation.ROSTER_UNAVAILABLE)
        self.assertIsNone(outcome.snapshot, 'no cross-context disclosure')

    def test_dormant_shipped_authenticator_falls_back(self):
        self.baseline()
        runner = generation.GenerationRunner(BOOT, authority.AcquisitionClient(BOOT, transport=self.transport),
                                             self.source, self.clock, self.store, 'synthetic_recipient')
        self.assert_fallback(self.run_once(runner=runner), 'unavailable', 'service_auth_unavailable', attempts=1)

    def test_exhausted_deadline_enters_fallback_without_retry(self):
        self.baseline()
        # The race is detected with the deadline already spent: no retry.
        self.reads(scenario('all_on'))
        self.transport.responses.append(lambda: (self.clock.advance(2), ok(scenario('one_off')))[1])
        outcome = self.runner.run(lambda roster: self.clock.advance(59), deadline=self.clock() + timedelta(seconds=60))
        self.assert_fallback(outcome, 'conflict', 'revision_race', attempts=1)
        # A confirming read with no time left is not attempted at all.
        self.reads(scenario('all_on'))
        outcome = self.runner.run(lambda roster: self.clock.advance(61), deadline=self.clock() + timedelta(seconds=60))
        self.assert_fallback(outcome, 'unavailable', 'generation_deadline_exhausted', attempts=1)


if __name__ == '__main__':
    unittest.main()
