"""Paper boundaries and the six quantities over landed-B2 readbacks (Q6;
rows 03, 04, 05, 06, 12, 13, 14 and 18 at the reducer layer)."""
import unittest
from copy import deepcopy
from datetime import timedelta

from digest_roster_support import (
    CORPUS, FIXTURE, OBSERVED, OutboundTrap, acquire, authority, observation_bindings, preparation, prepare,
    scenario, selected,
)

import digest_roster_quantities as quantities  # noqa: E402  (path set by the support module)
from account_daily_facts import SIMULATION_MODES, collect_account_facts  # noqa: E402

DAY = '2026-11-19'
ROLES = {name: (value if isinstance(value[0], list) else [value]) for name, value in CORPUS['roles'].items()}
BINDINGS = observation_bindings(preparation('complete')['readback'])


def key(role, index=0):
    return tuple(sorted(tuple(item.split('/', 1)) for item in ROLES[role][index]))


def roster_for(name):
    return authority.compose_generation(acquire(scenario(name)), selected(prepare()[0]))


def binding_for(roster, deployments):
    group = next(group for group in roster.groups if group.deployments == deployments)
    [binding] = group.observation_bindings
    return binding


def observation(roster, deployments, facts=None, **changes):
    binding = binding_for(roster, deployments)
    return {'type': 'account_observation', **binding, 'business_day': DAY,
            'observed_at': '2026-11-19T22:30:00.000Z',
            'facts': facts if facts is not None else {'holdings': [{'symbol': 'SYN', 'quantity': 1}]}, **changes}


def bound(document):
    """A document as read through the binding it names."""
    return (document.get('binding_id'), document) if isinstance(document, dict) else (None, document)


def compute(name, observed=(), rows=()):
    roster = roster_for(name)
    admitted = quantities.admit_observations(roster, [bound(factory(roster)) for factory in observed], DAY, OBSERVED)
    return roster, admitted, quantities.roster_quantities(roster, admitted, quantities.reduce_runs(roster, rows),
                                                          domains=('holdings',))


def at(role, index=0, **kwargs):
    return lambda roster: observation(roster, key(role, index), **kwargs)


def link(index):
    return FIXTURE['enrollment_links'][index]


def run_row(index, run_id=None, profile=None, **changes):
    item = link(index)
    return {'platform_id': item['platform_id'], 'opaque_account_uid': item['opaque_account_uid'],
            'target_id': item['target_id'], 'strategy_profile': profile or f'syn_profile_{index}',
            'source_run_id': run_id, 'actually_ran': True, **changes}


class Base(unittest.TestCase):
    def setUp(self):
        self.trap = OutboundTrap().__enter__()

    def tearDown(self):
        self.trap.__exit__(None, None, None)
        self.assertEqual(self.trap.attempts, 0, 'zero outbound calls')

    def enabled(self, result):
        return {scope: (value['confirmed'], value['unknown'], value['disabled'], value['outside'])
                for scope, value in result['enabled'].items() if scope != 'all'}


class Cohorts(Base):
    def test_row_04_all_on_all_off_four_on(self):
        for name, live, paper in (('all_on', (8, 0, 0, 1), (1, 0, 0, 0)), ('all_off', (0, 0, 8, 1), (0, 0, 1, 0)),
                                  ('four_on', (3, 0, 5, 1), (1, 0, 0, 0))):
            with self.subTest(name):
                _, _, result = compute(name)
                self.assertEqual((result['display']['count'], result['eligible']['count']), (10, 9))
                self.assertEqual(self.enabled(result), {'live': live, 'paper': paper})
        _, _, result = compute('all_off')
        self.assertEqual(result['managed_coverage']['any']['live']['status'], 'not_applicable')
        self.assertEqual(result['managed_coverage']['any']['live']['reason'], 'no_managed_non_paper_accounts')
        self.assertIsNone(result['managed_coverage']['any']['live']['covered'])
        self.assertEqual(result['managed_coverage']['any']['all']['status'], 'not_applicable')

    def test_row_03_disabled_group_keeps_raw_facts_and_contributes_nothing_managed(self):
        roster, admitted, result = compute('one_off', observed=[at('live_off')])
        self.assertEqual(result['enabled']['all']['confirmed'], 8)
        self.assertEqual(self.enabled(result)['live'][2], 1)
        self.assertIn(key('live_off'), admitted.facts, 'raw facts remain visible')
        self.assertEqual(result['raw_coverage']['any']['all']['covered'], 1)
        self.assertEqual(result['managed_coverage']['any']['all']['covered'], 0)
        self.assertEqual(result['managed_coverage']['any']['all']['denominator'], 8)
        disabled = next(group for group in roster.groups if group.deployments == key('live_off'))
        self.assertFalse([binding for binding in quantities.managed_run_bindings(roster)
                          if binding in disabled.legacy_run_bindings])
        # A disabled group's own bindings stay for display, never processing.
        self.assertEqual(len(quantities.managed_run_bindings(roster_for('all_on'))), len(FIXTURE['enrollment_links']))
        self.assertEqual(quantities.managed_run_bindings(roster_for('all_off')), [])
        self.assertEqual(len(roster_for('all_off').run_bindings()), len(FIXTURE['enrollment_links']))

    def test_row_05_missing_applied_rows_leave_class_and_make_totals_indeterminate(self):
        for name, confirmed, unknown in (('missing_one', 8, 1), ('missing_all', 0, 9)):
            with self.subTest(name):
                _, _, result = compute(name)
                self.assertEqual(result['eligible']['count'], 9)
                self.assertEqual(result['enabled']['all']['confirmed'], confirmed)
                self.assertEqual(result['enabled']['all']['unknown'], unknown)
                self.assertIsNone(result['enabled']['all']['total'])
                self.assertEqual(sum(value[3] for value in self.enabled(result).values()), 1)
                self.assertFalse(result['live_totals_available'])
                self.assertEqual(result['live_totals_reason'], 'management_status_unknown')

    def test_row_06_contradictions_are_group_local_and_order_independent(self):
        base = {group.deployments: group.live.management_status for group in roster_for('all_on').groups}
        for name in ('sibling_flag_disagree', 'sibling_revision_disagree', 'sibling_missing_malformed',
                     'sibling_missing_only', 'display_only_enabled'):
            with self.subTest(name):
                roster, _, result = compute(name)
                _, _, reversed_result = compute(f'{name}_reversed')
                self.assertEqual(result, reversed_result)
                affected = [group for group in roster.groups if group.live.management_status != base[group.deployments]]
                self.assertEqual(len(affected), 1)
                [group] = affected
                self.assertEqual(group.live.management_status, 'unknown')
                self.assertEqual(group.live.evidence_state, 'unknown' if name == 'sibling_missing_only' else 'conflict')
                self.assertNotIn(group.deployments, [item.deployments for item in roster.groups
                                                     if item.live.processing_eligible])
                self.assertEqual(result['display']['count'], 10)
                self.assertEqual(result['enabled']['all']['unknown'], 1)


class Paper(Base):
    def test_row_12_paper_group_without_strategy_stays_visible_on_and_off(self):
        results = {}
        for name in ('all_on', 'paper_off'):
            roster, admitted, result = compute(name, observed=[at('paper')])
            paper = next(group for group in roster.groups if group.deployments == key('paper'))
            self.assertFalse(paper.legacy_run_bindings)
            self.assertEqual(result['raw_coverage']['any']['paper'], {'covered': 1, 'denominator': 1,
                                                                       'status': 'complete', 'reason': None})
            results[name] = result
        on, off = (results[name]['enabled']['paper']['confirmed'] for name in ('all_on', 'paper_off'))
        self.assertEqual(on - off, 1)
        self.assertEqual(results['all_on']['enabled']['live'], results['paper_off']['enabled']['live'])
        self.assertEqual(results['all_on']['runs'], results['paper_off']['runs'])
        self.assertEqual(results['all_on']['managed_coverage']['any']['live'],
                         results['paper_off']['managed_coverage']['any']['live'])

    def test_row_12_misbound_observations_contribute_nothing(self):
        cases = {'source': {'binding_id': 'obs-unknown'}, 'owner': {'legacy_key': 'syn-acct-99'},
                 'day': {'business_day': '2026-11-18'}, 'scope': {'broker_environment': 'live'}}
        for label, change in cases.items():
            with self.subTest(label):
                _, admitted, result = compute('all_on', observed=[at('paper', **change)])
                self.assertEqual(admitted.facts, {})
                self.assertEqual(sum(admitted.rejected.values()), 1)
                self.assertEqual(result['raw_coverage']['any']['paper']['covered'], 0)
                self.assertEqual(result['display']['count'], 10)

    def test_row_12_time_type_and_shape_rules(self):
        future = (OBSERVED + timedelta(seconds=31)).isoformat().replace('+00:00', '.000Z')
        cases = {'observation_time_invalid': at('paper', observed_at=future),
                 'observation_time_invalid#bad': at('paper', observed_at='yesterday'),
                 'run_as_observation': lambda roster: {**observation(roster, key('paper')), 'type': 'run',
                                                       'source_run_id': 'r1'},
                 'observation_facts_invalid': at('paper', facts={}),
                 'observation_shape_invalid': lambda roster: {**observation(roster, key('paper')), 'extra': 1}}
        for label, factory in cases.items():
            with self.subTest(label):
                _, admitted, _ = compute('all_on', observed=[factory])
                self.assertEqual(admitted.rejected, {label.split('#')[0]: 1})
        _, admitted, result = compute('all_on', observed=[at('paper', facts={'holdings': []})])
        self.assertEqual(result['raw_coverage']['holdings']['paper']['covered'], 1, 'explicit empty observation')

    def test_row_13_simulated_rows_never_enter_live_activity(self):
        fills = {'fills': [{'id': 'f1', 'occurred_at': '2026-11-19T02:00:00Z', 'symbol': 'SYN', 'quantity': 1,
                            'price': 1}]}
        rows = [run_row(0, f'sim-{mode}', execution_mode=mode, account_daily_facts=fills, business_day=DAY)
                for mode in sorted(SIMULATION_MODES)]
        rows.append(run_row(1, 'live-1', execution_mode='live', account_daily_facts=fills, business_day=DAY))
        _, admitted, result = compute('all_on', observed=[at('paper')], rows=rows)
        live = result['runs']['live']
        self.assertEqual((live.observed_runs, live.simulated_excluded), (1, 4))
        self.assertEqual(result['runs']['paper'].observed_runs, 0)
        self.assertEqual(result['raw_coverage']['any']['live']['covered'], 0, 'runs never cover raw facts')
        self.assertEqual(result['raw_coverage']['any']['paper']['covered'], 1)
        self.assertEqual(len(admitted.facts[key('paper')]), 1)
        # The existing collector honors the same exclusions.
        expected = [{name: row[name] for name in ('platform_id', 'opaque_account_uid', 'target_id', 'strategy_profile')}
                    for row in rows]
        collected = collect_account_facts(rows, expected, DAY)
        fills_seen = [fill for account in collected.values() for fill in account['fills']]
        self.assertEqual(len(fills_seen), 1)


class Coverage(Base):
    def row_18(self, name='four_on', observed=None):
        observed = observed if observed is not None else [
            at('live_on', 0), at('live_on', 1), at('paper'), at('live_off'), at('display_only')]
        rows = [run_row(0, 'run-a'), run_row(1, 'run-b'), run_row(1, 'run-b'),
                run_row(2, 'not-due', actually_ran=False)]
        return compute(name, observed=observed, rows=rows)

    def test_row_18_initial_quantities(self):
        _, _, result = self.row_18()
        self.assertEqual((result['display']['count'], result['eligible']['count'],
                          result['enabled']['all']['confirmed']), (10, 9, 4))
        managed = result['managed_coverage']['any']
        self.assertEqual([(managed[s]['covered'], managed[s]['denominator']) for s in ('all', 'live', 'paper')],
                         [(3, 4), (2, 3), (1, 1)])
        raw = result['raw_coverage']['any']
        self.assertEqual([(raw[s]['covered'], raw[s]['denominator']) for s in ('all', 'live', 'paper')],
                         [(5, 10), (4, 9), (1, 1)])
        runs = result['runs']['live']
        self.assertEqual((runs.observed_runs, runs.covered_targets, runs.non_run_targets, runs.expected_targets),
                         (2, 3, 1, 4))
        self.assertTrue(result['live_totals_available'])

    def test_row_18_removing_disabled_evidence_changes_raw_only(self):
        _, _, before = self.row_18()
        _, _, after = self.row_18(observed=[at('live_on', 0), at('live_on', 1), at('paper'), at('display_only')])
        self.assertEqual(after['raw_coverage']['any']['all']['covered'], 4)
        self.assertEqual(before['managed_coverage'], after['managed_coverage'])
        self.assertEqual(before['enabled'], after['enabled'])
        self.assertEqual(before['runs'], after['runs'])

    def test_row_18_unknown_live_versus_paper_only_uncertainty(self):
        _, _, live = self.row_18('four_on_live_missing')
        self.assertFalse(live['live_totals_available'])
        self.assertEqual(live['managed_coverage']['any']['live']['status'], 'confirmed_subset')
        self.assertIsNone(live['enabled']['live']['total'])
        _, _, paper = self.row_18('four_on_paper_missing')
        self.assertTrue(paper['live_totals_available'], 'paper-only uncertainty leaves the live cohort intact')
        self.assertEqual(paper['managed_coverage']['any']['live'],
                         {'covered': 2, 'denominator': 3, 'status': 'complete', 'reason': None})
        self.assertEqual(paper['managed_coverage']['any']['paper']['status'], 'confirmed_subset')

    def test_row_18_unknown_run_evidence_and_missing_targets(self):
        rows = [run_row(0, 'run-a'), run_row(1, None)]
        _, _, result = compute('four_on', rows=rows)
        runs = result['runs']['live']
        self.assertIsNone(runs.observed_runs)
        self.assertEqual((runs.confirmed_runs, runs.unknown_evidence, runs.covered_targets), (1, 1, 1))
        rows = [run_row(0, 'run-a'), run_row(0, 'run-a', actually_ran=False)]
        self.assertIsNone(compute('four_on', rows=rows)[2]['runs']['live'].observed_runs)
        unbound = [run_row(0, 'run-a', profile='other_profile'), {**run_row(0, 'run-z'), 'target_id': 'syn-run-xx'}]
        self.assertEqual(compute('four_on', rows=unbound)[2]['runs']['live'].observed_runs, 0)

    def test_row_14_duplicate_observation_contributes_once(self):
        _, admitted, result = compute('all_on', observed=[at('live_on', 0), at('live_on', 0)])
        self.assertEqual(len(admitted.facts[key('live_on', 0)]), 1)
        self.assertEqual(result['raw_coverage']['any']['all']['covered'], 1)
        self.assertEqual(result['managed_coverage']['any']['all']['covered'], 1)

    def test_unresolved_deployments_are_live_unknown_never_paper(self):
        document = scenario('all_on')
        document['uncovered_deployments'] = [{'platform': 'ibkr', 'key': 'syn-loose', 'management_status': 'unknown',
                                              'evidence_state': 'unknown', 'reasons': ['deployment_unclassified'],
                                              'processing_eligible': False,
                                              'processing_denial': 'management_status_unknown'}]
        document['counts']['uncovered_deployments'] = 1
        document['counts']['display_deployments'] += 1
        roster = authority.compose_generation(acquire(document), selected(prepare()[0]))
        admitted = quantities.admit_observations(roster, [], DAY, OBSERVED)
        result = quantities.roster_quantities(roster, admitted, quantities.reduce_runs(roster, []))
        self.assertEqual((result['display']['unresolved_deployments'], result['eligible']['total']), (1, None))
        self.assertEqual(result['enabled']['live']['unknown'], 1)
        self.assertEqual(result['enabled']['paper']['unknown'], 0)
        self.assertFalse(result['live_totals_available'])

    def test_fallback_quantities_are_unavailable(self):
        result = quantities.unavailable_quantities(10)
        self.assertEqual(result['display'], {'count': 10, 'unresolved_deployments': None, 'last_known': True})
        self.assertIsNone(result['enabled'])
        self.assertIsNone(quantities.unavailable_quantities()['display']['count'])


if __name__ == '__main__':
    unittest.main()
