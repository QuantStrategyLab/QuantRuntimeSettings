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

try:
    import jsonschema
except ImportError:  # jsonschema is not installed in hosted CI
    jsonschema = None

from digest_roster_support import (
    BOOT, FIXTURE, OBSERVED, ROOT, OutboundTrap, SyntheticAuth, SyntheticEnrollmentSource, SyntheticTransport, at,
    authority, instances, legacy_roster, ok, prepare, scenario,
)

import cloud_run_daily_digest as app  # noqa: E402
import daily_digest_aggregator as aggregator  # noqa: E402
import unified_daily_digest as unified  # noqa: E402
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
        if jsonschema is not None:
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
        if jsonschema is not None:
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


IN_WINDOW = '2026-11-19T10:00:00Z'


def _fill(fill_id, symbol='MSFT'):
    return {'id': fill_id, 'order_id': f'o-{fill_id}', 'symbol': symbol, 'side': 'buy', 'quantity': 1,
            'asset_type': 'stock', 'price': 10, 'currency': 'USD', 'occurred_at': IN_WINDOW}


class Group3Facts(Base):
    """F09-F13 and the payload/label bot cases at the Cloud generation path."""

    def setUp(self):
        super().setUp()
        with patch.dict(os.environ, e2e._boot_env({'QSL_NOTIFY_LANG': 'en'}), clear=True):
            self.cfg = app.Configuration.from_environment()

    def generate(self, readback='all_on', rows=None, observations=(), filed=None, data=None, locale='en'):
        if locale != 'en':
            with patch.dict(os.environ, e2e._boot_env({'QSL_NOTIFY_LANG': locale}), clear=True):
                cfg = app.Configuration.from_environment()
        else:
            cfg = self.cfg
        source = SyntheticEnrollmentSource(data) if data is not None else self.source
        transport = SyntheticTransport(ok(scenario(readback)), ok(scenario(readback)))
        client = authority.AcquisitionClient(BOOT, SyntheticAuth(), transport)
        runner = generation.GenerationRunner(BOOT, client, source, lambda: e2e.OBS_CLOCK,
                                             generation.DisplaySnapshotStore(), recipient_scope='syn-scope')
        store = MemoryStore(dict(rows or {}))
        for path, document in (filed or {}).items():
            store.rows.setdefault(path, {'observations': []})['observations'].append(document)
        sent = []
        code, result = e2e._slot_args(cfg, store, sent, runner=runner, raw_observations=observations)
        self.assertEqual((code, result['delivery']), (200, 'accepted'))
        return sent[0]

    def binding(self, pair, readback='all_on'):
        bindings = e2e.support.observation_bindings(scenario(readback))
        return next(item for item in bindings if (item['platform'], item['legacy_key']) == pair)

    @staticmethod
    def path(binding):
        return f"observations/{binding['platform']}/{e2e.DAY}/{binding['binding_id']}.json"

    def coverage(self, text, scope):
        line = next(line for line in text.splitlines() if line.startswith('Live coverage'))
        if scope == 'paper':
            return 'managed ' + line.split('Paper managed ')[1]
        return line.split('Live coverage: ')[1].split(' | Paper')[0]

    def test_f09_document_from_another_bindings_source_earns_nothing(self):
        paper = self.binding(PAPER_PAIR)
        live = self.binding(('ibkr', 'syn-acct-03'))
        document = e2e._obs(paper, facts={'holdings': [{'symbol': 'AAPL', 'quantity': 2, 'asset_type': 'stock'}]})
        text = self.generate(filed={self.path(live): document})
        self.assertIn('managed 0/1, raw 0/1', self.coverage(text, 'paper'))
        self.assertNotIn('AAPL', text)
        control = self.generate(observations=[document])
        self.assertIn('managed 1/1, raw 1/1', self.coverage(control, 'paper'))

    def test_f10_stale_unsupported_or_malformed_observations_earn_nothing(self):
        paper = self.binding(PAPER_PAIR)
        live = self.binding(('ibkr', 'syn-acct-03'))
        good = e2e._obs(live, facts={'holdings': [{'symbol': 'SPY', 'quantity': 3, 'asset_type': 'stock'}]})
        cases = {
            'four_days_old': e2e._obs(paper, facts={'holdings': [{'symbol': 'AAPL', 'quantity': 2}]},
                                      observed_at='2026-11-15T23:00:00Z'),
            'unsupported_domain': e2e._obs(paper, facts={'positions_v9': [{'symbol': 'AAPL'}]}),
            'malformed_activity': e2e._obs(paper, facts={'activity': {'orders': 1}}),
            'malformed_snapshot': e2e._obs(paper, facts={'snapshots': [None]}),
            'malformed_position': e2e._obs(paper, facts={'holdings': [{'quantity': 'x'}]}),
        }
        for name, document in cases.items():
            with self.subTest(name):
                text = self.generate(observations=[document, good])
                self.assertIn('managed 0/1, raw 0/1', self.coverage(text, 'paper'))
                self.assertIn('SPY 3 shares', text, 'the other groups still render')
                self.assertEqual(text.count('🏦 '), 10)
        empty = self.generate(observations=[e2e._obs(paper, facts={'holdings': []})])
        self.assertIn('managed 1/1, raw 1/1', self.coverage(empty, 'paper'), 'explicit empty observation')

    def pair_rows(self, fills_by_slot):
        links = FIXTURE['enrollment_links']
        rows = {}
        for index, fills in fills_by_slot.items():
            link = links[index]
            binding = {**{name: link[name] for name in authority.BINDING_FIELDS},
                       'strategy_profile': f'syn_profile_{index}'}
            rows[f"ibkr/{e2e.DAY}/{link['candidate_slot']}.json"] = {'runs': [e2e._run_row(
                binding, run_id=f'run-{index}', fills=len(fills), orders=len(fills),
                extra={'account_daily_facts': {'fills': fills}})]}
        return rows

    def test_f11_one_legacy_fill_contributes_once_across_group_and_account(self):
        text = self.generate(rows=self.pair_rows({0: [_fill('f-1')]}))
        self.assertIn('Fills: 1', text)
        self.assertNotIn('Fills: 2', text)
        # The same fact presented by both sibling deployments is one fact;
        # two distinct facts remain two.
        self.assertIn('Fills: 1', self.generate(rows=self.pair_rows({0: [_fill('f-1')], 1: [_fill('f-1')]})))
        self.assertIn('Fills: 2', self.generate(rows=self.pair_rows({0: [_fill('f-1')], 1: [_fill('f-2')]})))

    def test_f11_distinct_sibling_uids_keep_both_identities_once(self):
        links = deepcopy(FIXTURE['enrollment_links'])
        original = links[1]['opaque_account_uid']
        links[1]['opaque_account_uid'] = 'uid:SYN-Opaque/01-sibling'
        projection = deepcopy(e2e.support.preparation('complete')['projection'])
        for account in projection['accounts']:
            for item in account.get('enrollment_links') or []:
                if item.get('candidate_slot') == links[1]['candidate_slot']:
                    item['opaque_account_uid'] = links[1]['opaque_account_uid']
        data, _ = prepare(links=links, roster=legacy_roster(links), projection=projection)
        artifact = json.loads(data)
        pair_group = next(group for group in artifact['groups'] if len(group['deployments']) == 2)
        self.assertEqual({run['opaque_account_uid'] for run in pair_group['legacy_run_bindings']},
                         {links[0]['opaque_account_uid'], links[1]['opaque_account_uid']})
        self.assertNotEqual(original, links[1]['opaque_account_uid'])
        rows = {}
        for index, fill in ((0, _fill('f-1')), (1, _fill('f-2'))):
            link = links[index]
            binding = {**{name: link[name] for name in authority.BINDING_FIELDS},
                       'strategy_profile': f'syn_profile_{index}'}
            rows[f"ibkr/{e2e.DAY}/{link['candidate_slot']}.json"] = {'runs': [e2e._run_row(
                binding, run_id=f'run-{index}', fills=1, orders=1, extra={'account_daily_facts': {'fills': [fill]}})]}
        text = self.generate(rows=rows, data=data)
        self.assertIn('Fills: 2', text)
        self.assertEqual(text.count('🏦 '), 10)

    def test_f12_all_positions_of_one_observation_render(self):
        live = self.binding(('ibkr', 'syn-acct-03'))
        positions = [{'symbol': symbol, 'quantity': 1, 'asset_type': 'stock'} for symbol in ('AAPL', 'MSFT', 'NVDA')]
        text = self.generate(observations=[e2e._obs(live, facts={'holdings': positions})])
        for symbol in ('AAPL', 'MSFT', 'NVDA'):
            self.assertIn(f'{symbol} 1 share', text)

    def test_f12_240_holdings_are_all_accounted_in_both_locales(self):
        rows = instances()
        for index, row in enumerate(rows):
            row['config']['label'] = f'🌟Acct-{index:02d}-' + 'L' * (70 - len(f'🌟Acct-{index:02d}-'))
        data, _ = prepare(instance_rows=rows)
        readback = scenario('missing_one')
        bindings = e2e.support.observation_bindings(readback)
        observations = [e2e._obs(binding, facts={'holdings': [
            {'symbol': f'S{number:02d}P{position:02d}', 'quantity': position + 1, 'asset_type': 'stock'}
            for position in range(30)]}) for number, binding in enumerate(bindings)]
        self.assertEqual(len(observations), 7)
        link = FIXTURE['enrollment_links'][3]          # an unknown-scope group with a run binding
        binding = {**{name: link[name] for name in authority.BINDING_FIELDS}, 'strategy_profile': 'syn_profile_3'}
        snapshot = {'as_of': '2026-11-19T21:00:00Z', 'holdings': [
            {'symbol': f'L{position:02d}', 'quantity': 1, 'asset_type': 'stock'} for position in range(30)]}
        legacy = {f"{link['platform_id']}/{e2e.DAY}/{link['candidate_slot']}.json": {'runs': [e2e._run_row(
            binding, run_id='run-l', extra={'account_daily_facts': {'snapshots': [snapshot]}})]}}
        for locale, pattern in (('en', r'(\d+) items omitted \(holdings: (\d+) shown, (\d+) omitted\)'),
                                ('zh', r'另有 (\d+) 项省略（持仓展示 (\d+) 项、省略 (\d+) 项）')):
            with self.subTest(locale=locale):
                text = self.generate('missing_one', rows=legacy, observations=observations, data=data,
                                     locale=locale)
                self.assertLessEqual(len(text.encode('utf-16-le')) // 2, 3850)
                headers = [line for line in text.splitlines() if line.startswith('🏦 ')]
                self.assertEqual((len(headers), len(set(headers))), (10, 10))
                rendered = sum(1 for line in text.splitlines() if re.match(r'(S\d\dP\d\d|L\d\d) ', line))
                match = re.search(pattern, text)
                shown, omitted = (int(match.group(2)), int(match.group(3))) if match else (rendered, 0)
                self.assertEqual((shown, shown + omitted), (rendered, 240))
                self.assertGreater(shown, 8)

    def test_f13_paper_only_unknown_counts_one_paper_group(self):
        text = self.generate('four_on_paper_missing')
        self.assertIn('Paper scope: display 1 |', text)
        self.assertIn('Live coverage: managed 0/3', text)
        self.assertNotIn('live totals unavailable', text)

    def test_label_suffixes_stay_distinct_against_existing_labels(self):
        for labels in (('Account', 'Account', 'Account 1'), (None, None, 'Account 1')):
            for locale in ('en', 'zh'):
                with self.subTest(labels=labels, locale=locale):
                    rows = instances()
                    ibkr = [row for row in rows if row['platform'] == 'ibkr' and row['config']['key'] in
                            ('syn-acct-02', 'syn-acct-03', 'syn-acct-04')]
                    default = '账户' if locale == 'zh' else 'Account'
                    for row, label in zip(ibkr, labels, strict=True):
                        row['config']['label'] = (label.replace('Account', default) if label else None)
                    text = self.generate(data=prepare(instance_rows=rows)[0], locale=locale)
                    headers = [line for line in text.splitlines() if line.startswith('🏦 ')]
                    self.assertEqual((len(headers), len(set(headers))), (10, 10))
                    self.assertEqual(sum('quant management' in line.lower() or '量化管理' in line
                                         for line in text.splitlines()), 10)


class Group4ExplicitRoster(Base):
    """F17, F19: the explicit roster at shared aggregation, and standalone
    support decided before legacy intake."""

    def outcomes(self):
        empty, _ = prepare(links=[], roster=[])
        result = {}
        for name, data, responses in (('current', self.data, [ok(scenario('all_on'))] * 2),
                                      ('empty', empty, [ok(scenario('all_on'))] * 2),
                                      ('unavailable', self.data, [(403, {}, b'')])):
            transport = SyntheticTransport(*responses)
            client = authority.AcquisitionClient(BOOT, SyntheticAuth(), transport)
            runner = generation.GenerationRunner(BOOT, client, SyntheticEnrollmentSource(data), self.clock,
                                                 generation.DisplaySnapshotStore(), 'synthetic_recipient')
            result[name] = runner.run(deadline=self.clock() + timedelta(seconds=60))
        return result

    @staticmethod
    def row(binding, run_id):
        return e2e._run_row(binding, run_id=run_id)

    def candidates(self, rows):
        import tempfile
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = os.path.join(directory.name, 'candidates.json')
        with open(path, 'w', encoding='utf-8') as handle:
            json.dump({'runs': rows}, handle)
        from pathlib import Path
        return Path(path)

    def collect(self, context, rows, consolidation, github=()):
        env = {'DIGEST_EXPECTED_TARGETS_JSON': json.dumps([{
            'platform_id': 'binance', 'candidate_slot': 'foreign-slot', 'opaque_account_uid': 'foreign-uid',
            'target_id': 'foreign-target', 'strategy_profile': 'foreign_profile'}])}
        if consolidation:
            env['QRS_UNIFIED_NOTIFICATION_ENABLED'] = 'true'
        github_result = aggregator.GithubEvidenceResult(rows=list(github))
        with patch.dict(os.environ, env, clear=True), \
                patch.object(aggregator, 'collect_from_github_workflows', return_value=github_result):
            return aggregator.collect_digest_runs(business_day=e2e.DAY, config=e2e.ux_config([]),
                                                  candidates_path=self.candidates(rows),
                                                  include_github=bool(github), roster_context=context)

    def test_f17_explicit_roster_is_the_allowlist_in_either_mode(self):
        outcomes = self.outcomes()
        foreign = {'platform_id': 'binance', 'candidate_slot': 'foreign-slot', 'opaque_account_uid': 'foreign-uid',
                   'target_id': 'foreign-target', 'strategy_profile': 'foreign_profile'}
        bound = outcomes['current'].context.roster.run_bindings()[0]
        for consolidation in (False, True):
            with self.subTest(consolidation=consolidation):
                empty = self.collect(outcomes['empty'], [self.row(foreign, 'run-f')], consolidation,
                                     github=[self.row(foreign, 'run-g')])
                self.assertEqual((len(empty.runs), len(empty.merged_rows)), (0, 0))
                self.assertEqual(empty.coverage.missing_targets, ())
                current = self.collect(outcomes['current'], [self.row(foreign, 'run-f'), self.row(bound, 'run-b')],
                                       consolidation, github=[self.row(foreign, 'run-g')])
                self.assertEqual({run.target_id for run in current.runs}, {bound['target_id']})
                unavailable = self.collect(outcomes['unavailable'], [self.row(bound, 'run-b')], consolidation)
                self.assertEqual(unavailable.runs, [])
                self.assertIn('management_roster', {item['source_kind']
                                                    for item in unavailable.coverage.candidate_failures})
        # Legacy-only control: no explicit roster keeps the environment roster.
        with patch.dict(os.environ, {'DIGEST_EXPECTED_TARGETS_JSON': json.dumps([foreign])}, clear=True):
            legacy = aggregator.collect_digest_runs(business_day=e2e.DAY, config=e2e.ux_config([]),
                                                    candidates_path=self.candidates([self.row(foreign, 'run-f')]),
                                                    include_github=False)
        self.assertEqual({run.target_id for run in legacy.runs}, {'foreign-target'})

    def test_f17_cloud_shared_collection_admits_its_bound_inputs(self):
        outcome = self.outcomes()['current']
        bound = outcome.context.roster.run_bindings()[0]
        with patch.dict(os.environ, {'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true', 'DIGEST_ROSTER_MODE': 'mapping_v1'},
                        clear=True):
            payload, text, collected = aggregator.build_digest_payload(
                business_day=e2e.DAY, config=e2e.ux_config([]), include_github=False,
                candidates_path=self.candidates([self.row(bound, 'run-b')]), render_text=False,
                roster_context=outcome)
        self.assertEqual((text, len(collected.runs)), ('', 1))

    def test_f19_standalone_mapped_presentation_refuses_before_legacy_intake(self):
        valid = json.dumps([{'platform_id': 'schwab', 'candidate_slot': 'syn-slot', 'opaque_account_uid': 'uid-1',
                             'target_id': 'target-1', 'strategy_profile': 'synthetic_core'}])
        for legacy in (valid, '{not-json'):
            for request in ({'DIGEST_ROSTER_MODE': 'mapping_v1'},
                            {'DIGEST_ROSTER_BOOT_JSON': json.dumps({'mode': 'mapping_v1'})}):
                with self.subTest(legacy=legacy[:2], request=sorted(request)), patch.dict(os.environ, {
                        'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true', 'DIGEST_EXPECTED_TARGETS_JSON': legacy,
                        **request}, clear=True), patch.object(aggregator, 'collect_digest_runs',
                                                              side_effect=AssertionError('legacy intake')):
                    payload, text, collected = aggregator.build_digest_payload(
                        business_day=e2e.DAY, config=e2e.ux_config([]), include_github=False)
                    self.assertIsInstance(text, unified.UnsupportedConsolidatedPresentation)
                    self.assertEqual((payload.runs, collected.runs), ((), []))
        # Explicit context or mode is refused before intake as well.
        with patch.dict(os.environ, {'DIGEST_EXPECTED_TARGETS_JSON': '{not-json'}, clear=True), \
                patch.object(aggregator, 'collect_digest_runs', side_effect=AssertionError('legacy intake')):
            _, text, _ = aggregator.build_digest_payload(business_day=e2e.DAY, config=e2e.ux_config([]),
                                                         include_github=False, roster_mode='mapping_v1')
            self.assertIsInstance(text, unified.UnsupportedConsolidatedPresentation)

    def test_f19_legacy_only_controls_and_the_q6_deferral(self):
        valid = json.dumps([{'platform_id': 'schwab', 'candidate_slot': 'syn-slot', 'opaque_account_uid': 'uid-1',
                             'target_id': 'target-1', 'strategy_profile': 'synthetic_core'}])
        with patch.dict(os.environ, {'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true',
                                     'DIGEST_EXPECTED_TARGETS_JSON': valid}, clear=True):
            _, text, _ = aggregator.build_digest_payload(business_day=e2e.DAY, config=e2e.ux_config([]),
                                                         include_github=False)
        self.assertIsInstance(text, str)
        with patch.dict(os.environ, {'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true',
                                     'DIGEST_EXPECTED_TARGETS_JSON': '{not-json'}, clear=True):
            with self.assertRaises(ValueError):
                aggregator.build_digest_payload(business_day=e2e.DAY, config=e2e.ux_config([]),
                                                include_github=False)
        # Consolidation off: an environment-only mapping request keeps the
        # ordinary non-consolidated text (standalone presentation deferred).
        with patch.dict(os.environ, {'DIGEST_ROSTER_MODE': 'mapping_v1', 'DIGEST_EXPECTED_TARGETS_JSON': valid},
                        clear=True):
            _, text, _ = aggregator.build_digest_payload(business_day=e2e.DAY, config=e2e.ux_config([]),
                                                         include_github=False)
        self.assertIsInstance(text, str)


if __name__ == '__main__':
    unittest.main()
