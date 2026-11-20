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

import json
import re
from copy import deepcopy

from digest_roster_support import (
    BOOT, FIXTURE, OBSERVED, ROOT, OutboundTrap, SyntheticAuth, SyntheticEnrollmentSource, SyntheticTransport, at,
    authority, instances, legacy_roster, ok, prepare, scenario,
)

import cloud_run_daily_digest as app  # noqa: E402
import digest_roster_envelope as envelope  # noqa: E402
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


class Group2ClosedV1(Base):
    """F06-F08, F14-F16: closed v1 validation and the enrollment join."""

    def baseline(self):
        runner = self.runner()
        self.reads(scenario('all_on'), scenario('all_on'))
        self.assertEqual(runner.run(deadline=self.clock() + timedelta(seconds=60)).status, generation.CURRENT)
        return runner

    def assert_dated_unknowns(self, outcome):
        self.assertEqual(outcome.status, generation.FALLBACK)
        self.assertIsNone(outcome.collected)
        document = envelope.build_roster_envelope(outcome)
        self.assertEqual(len(document['groups']), 10)
        self.assertTrue(all(group['management_status'] == 'unknown' for group in document['groups']))
        self.assertIsNone(document['counts']['managed'])

    def test_f06_untyped_enum_values_reject_into_dated_fallback(self):
        for field, value in (('evidence_state', ['known']), ('management_class', {'x': 1}), ('scope', ['live']),
                             ('management_status', ['managed']), ('processing_denial', ['x'])):
            with self.subTest(field=field):
                self.setUp()
                runner = self.baseline()
                document = scenario('all_on')
                document['groups'][3][field] = value
                self.reads(*[document] * 2)
                calls = []
                outcome = runner.run(lambda roster: calls.append(1), deadline=self.clock() + timedelta(seconds=60))
                self.assert_dated_unknowns(outcome)
                self.assertEqual((outcome.failure_code, calls), ('readback_group_invalid', []))
                self.tearDown()

    def test_f07_unlisted_reason_codes_are_not_authority(self):
        for where in ('group', 'uncovered'):
            with self.subTest(where=where):
                self.setUp()
                runner = self.baseline()
                document = scenario('all_on')
                if where == 'group':
                    document['groups'][3]['reasons'] = ['synthetic_unlisted_reason']
                else:
                    document['uncovered_deployments'] = [{
                        'platform': 'ibkr', 'key': 'syn-loose', 'management_status': 'unknown',
                        'evidence_state': 'unknown', 'reasons': ['synthetic_unlisted_reason'],
                        'processing_eligible': False, 'processing_denial': 'management_status_unknown'}]
                    document['counts']['uncovered_deployments'] = 1
                    document['counts']['display_deployments'] += 1
                self.reads(*[document] * 2)
                self.assert_dated_unknowns(runner.run(deadline=self.clock() + timedelta(seconds=60)))
                self.tearDown()

    def test_f07_reason_vocabulary_matches_the_b2_producers(self):
        application = ROOT / 'web/strategy-switch-console/application'
        produced = set()
        resolver = (application / 'runtime_instances/account_management.js').read_text(encoding='utf-8')
        produced.update(re.findall(r'flag\("([a-z0-9_]+)"', resolver))
        produced.update(*re.findall(r'flag\(name === "[a-z_]+" \? "([a-z0-9_]+)" : "([a-z0-9_]+)"', resolver))
        policy = (application / 'account_mapping/policy.js').read_text(encoding='utf-8')
        produced.update(re.findall(r'rejected: "([a-z0-9_]+)"', policy))
        produced.update(re.findall(r'conflicts\.push\("([a-z0-9_]+)"\)', policy))
        produced.update(re.findall(r'reasons: \["([a-z0-9_]+)"\]', policy))
        produced.update(re.findall(r'reason: "([a-z0-9_]+)"', resolver))
        self.assertEqual(produced, set(authority.GROUP_REASON_CODES))
        denials = set(re.findall(r'return "([a-z0-9_]+)"', resolver[resolver.index('export function processingDenial'):]
                                 .split('\n}\n')[0]))
        self.assertEqual(denials | set(authority.POLICY_DENIALS), set(authority.DENIAL_CODES))

    def current_document(self, readback=None):
        runner = self.runner()
        document = readback or scenario('all_on')
        self.reads(document, document)
        outcome = runner.run(deadline=self.clock() + timedelta(seconds=60))
        return envelope.build_roster_envelope(outcome)

    def test_f08_current_envelope_coherence(self):
        document = self.current_document()
        self.assertEqual((document['counts']['display_groups'], document['counts']['display_deployments']), (10, 11))
        self.assertEqual(scenario('all_on')['counts']['display_deployments'], 11, 'producer agrees')
        schema = envelope.load_roster_schema()
        import jsonschema
        jsonschema.validate(document, schema)
        cases = {
            'null_age': lambda d: d.__setitem__('observation_age_seconds', None),
            'age_disagrees': lambda d: d.__setitem__('observation_age_seconds', 999.0),
            'decided_long_after': lambda d: d.__setitem__('decided_at', '2026-11-19T23:30:00Z'),
            'future_apply': lambda d: next(g for g in d['groups'] if g['applied'])['applied'].__setitem__(
                'effective_at', '2026-11-20T00:00:00Z'),
            'binding_environment': lambda d: next(g for g in d['groups'] if g['observation_bindings'])[
                'observation_bindings'][0].__setitem__(
                'broker_environment', 'paper' if next(g for g in d['groups'] if g['observation_bindings'])[
                    'scope'] == 'live' else 'live'),
            'deployment_total': lambda d: d['counts'].__setitem__('display_deployments', 10),
            'unlisted_reason': lambda d: d['groups'][0].__setitem__('reasons', ['synthetic_unlisted_reason']),
            'list_enum': lambda d: d['groups'][0].__setitem__('evidence_state', ['known']),
            'denial_incoherent': lambda d: d['groups'][0].__setitem__('processing_denial', 'management_disabled'),
        }
        for name, mutate in cases.items():
            with self.subTest(name):
                tampered = deepcopy(document)
                mutate(tampered)
                with self.assertRaises(authority.AuthorityError):
                    envelope.validate_roster_envelope(tampered)

    def test_f08_malformed_current_authority_renders_ten_dated_unknowns(self):
        with patch.dict(os.environ, e2e._boot_env({'QSL_NOTIFY_LANG': 'en'}), clear=True):
            cfg = app.Configuration.from_environment()
        transport = SyntheticTransport(ok(scenario('all_on')), ok(scenario('all_on')))
        client = authority.AcquisitionClient(BOOT, SyntheticAuth(), transport)
        runner = generation.GenerationRunner(BOOT, client, self.source, lambda: e2e.OBS_CLOCK, self.store,
                                             recipient_scope='syn-scope')
        e2e._slot_args(cfg, MemoryStore({}), [], runner=runner)
        bad = scenario('all_on')
        bad['groups'][0]['evidence_state'] = ['known']
        transport.responses.extend([ok(bad)] * 2)
        sent = []
        code, result = e2e._slot_args(cfg, MemoryStore({}), sent, runner=runner)
        self.assertEqual((code, result['coverage']), (200, 'unavailable'))
        self.assertEqual(sent[0].count('🏦 '), 10)
        self.assertEqual(sent[0].count('Quant management status unknown'), 10)
        self.assertNotIn('Live managed', sent[0])

    def test_f14_duplicate_runtime_target_has_no_winner(self):
        links = deepcopy(FIXTURE['enrollment_links'])
        original = links[1]['target_id']
        links[1]['target_id'] = links[0]['target_id']
        roster = legacy_roster(links)
        roster[1]['strategy_profile'] = roster[0]['strategy_profile']
        # The projection accepted both links (distinct enrollment and slot).
        projection = deepcopy(e2e.support.preparation('complete')['projection'])
        for account in projection['accounts']:
            for item in account.get('enrollment_links') or []:
                if item.get('target_id') == original:
                    item['target_id'] = links[0]['target_id']
        for order in (1, -1):
            with self.subTest(order=order):
                data, _ = prepare(links=links[::order], roster=roster[::order], projection=projection)
                artifact = json.loads(data)
                runs = [run for group in artifact['groups'] for run in group['legacy_run_bindings']]
                targets = [tuple(run[name] for name in authority.RUNTIME_TARGET_FIELDS) for run in runs]
                self.assertEqual(len(targets), len(set(targets)))
                self.assertEqual(sorted(run['platform_id'] for run in runs), ['firstrade', 'schwab'])
                self.assertEqual(len(artifact['groups']), 10, 'the certified display group remains')
                self.assertGreaterEqual(artifact['rejected'].get('link_ambiguous', 0), 2)

    def test_f15_allowlisted_source_options_reach_collection(self):
        roster = legacy_roster()
        roster[2].update(receipt_candidate=True, expected_runs=2)
        roster[3]['snapshot_only'] = True
        data, _ = prepare(roster=roster)
        self.source = SyntheticEnrollmentSource(data)
        document = self.current_document()
        runs = {run['platform_id']: run for group in document['groups'] for run in group['legacy_run_bindings']}
        self.assertEqual((runs['schwab'].get('receipt_candidate'), runs['schwab'].get('expected_runs')), (True, 2))
        self.assertIs(runs['firstrade'].get('snapshot_only'), True)
        envelope.validate_roster_envelope(document)
        import jsonschema
        jsonschema.validate(document, envelope.load_roster_schema())
        # Original validation still applies to each option.
        bad = legacy_roster()
        bad[2]['snapshot_only'] = False
        artifact = json.loads(prepare(roster=bad)[0])
        self.assertNotIn('schwab', {run['platform_id'] for group in artifact['groups']
                                    for run in group['legacy_run_bindings']})
        self.assertEqual(artifact['rejected'].get('link_option_invalid'), 1)

    def test_f16_private_identity_label_never_reaches_a_header(self):
        rows = instances()
        link = FIXTURE['enrollment_links'][2]
        for row in rows:
            if (row['platform'], row['config']['key']) == ('schwab', link['account_key']):
                row['config']['label'] = link['target_id']
        artifact = json.loads(prepare(instance_rows=rows)[0])
        labels = [item[2] for group in artifact['groups'] for item in group['labels']]
        self.assertNotIn(link['target_id'], labels)
        self.assertEqual(artifact['rejected'].get('label_rejected'), 1)
        document = self.current_document()
        group = next(g for g in document['groups'] if g['legacy_run_bindings'])
        group['labels'] = [{'platform': group['deployments'][0]['platform'],
                            'legacy_key': group['deployments'][0]['legacy_key'],
                            'label': group['legacy_run_bindings'][0]['target_id']}]
        with self.assertRaises(authority.AuthorityError):
            envelope.validate_roster_envelope(document)


if __name__ == '__main__':
    unittest.main()
