"""Physical grouping, byte identity and recipient isolation (Q4; rows 14,
15, 16 at the preparation/composition layer, row 01 identity)."""
import json
import unittest
from copy import deepcopy

from digest_roster_support import (
    FIXTURE, OutboundTrap, acquire, authority, instances, legacy_roster, observation_bindings, preparation,
    prepare, scenario, selected,
)

import cloud_run_daily_digest as app  # noqa: E402  (path set by the support module)

KEY = tuple(authority.BINDING_FIELDS)
PAIR = [tuple(item.split('/', 1)) for item in __import__('digest_roster_support').CORPUS['roles']['pair']]


def identity(row):
    return tuple(row[name] for name in KEY)


def inputs():
    """Mutable copies of the preparation inputs that carry links."""
    prepared = preparation('complete')
    return prepared['projection'], deepcopy(FIXTURE['enrollment_links']), legacy_roster(), instances()


def build(projection, links, roster, instance_rows, **kwargs):
    data, _ = prepare(projection=projection, links=links, roster=roster, instance_rows=instance_rows, **kwargs)
    return json.loads(data)


def bindings(document):
    return [binding for group in document['groups'] for binding in group['legacy_run_bindings']]


def account_of(projection, link):
    return next(account for account in projection['accounts']
                if any(identity(item) == identity(link) for item in account['enrollment_links']))


def relink(projection, links, roster, index, **changes):
    """Change one enrollment consistently in the projection, the full link
    and the protected roster (a legitimate synthetic enrollment)."""
    old = identity(links[index])
    for row in [*links, *roster, *(item for account in projection['accounts'] for item in account['enrollment_links'])]:
        if identity(row) == old:
            row.update(changes)


class Base(unittest.TestCase):
    def setUp(self):
        self.trap = OutboundTrap().__enter__()

    def tearDown(self):
        self.trap.__exit__(None, None, None)
        self.assertEqual(self.trap.attempts, 0, 'zero outbound calls')


class ByteIdentity(Base):
    def test_row_01_opaque_identities_and_slots_pass_byte_for_byte(self):
        projection, links, roster, rows = inputs()
        relink(projection, links, roster, 3, opaque_account_uid=' uid:Syn-MiXed 10 ', target_id='Syn Run/10')
        document = build(projection, links, roster, rows)
        roster_ids = {identity(row) for row in roster}
        self.assertEqual({identity(row) for row in bindings(document)}, roster_ids)
        composed = authority.compose_generation(acquire(scenario('all_on')), selected(prepare(
            projection=projection, links=links, roster=roster, instance_rows=rows)[0]))
        self.assertIn(' uid:Syn-MiXed 10 ', {row['opaque_account_uid'] for row in composed.run_bindings()})
        self.assertEqual({identity(row) for row in composed.run_bindings()}, roster_ids)

    def test_row_14_one_group_for_two_deployments_with_same_or_distinct_uids(self):
        projection, links, roster, rows = inputs()
        document = build(projection, links, roster, rows)
        [pair] = [group for group in document['groups'] if len(group['deployments']) == 2]
        self.assertEqual(sorted(tuple(item) for item in pair['deployments']), sorted(PAIR))
        same = {row['opaque_account_uid'] for row in pair['legacy_run_bindings']}
        self.assertEqual(len(pair['legacy_run_bindings']), 2)
        self.assertEqual(len(same), 1, 'one shared opaque UID, no canonical ID allocated')
        relink(projection, links, roster, 1, opaque_account_uid='uid:SYN-Opaque/01-b==')
        document = build(projection, links, roster, rows)
        [pair] = [group for group in document['groups'] if len(group['deployments']) == 2]
        self.assertEqual({row['opaque_account_uid'] for row in pair['legacy_run_bindings']},
                         {'uid:SYN-Opaque/01==', 'uid:SYN-Opaque/01-b=='})
        self.assertEqual(len(document['groups']), 10)

    def test_row_14_sibling_and_input_order_never_change_the_result(self):
        forward = prepare()[0]
        projection, links, roster, rows = inputs()
        projection['accounts'].reverse()
        for account in projection['accounts']:
            account['deployments'].reverse()
            account['enrollment_links'].reverse()
        readback = preparation('complete')['readback']
        readback['groups'].reverse()
        for group in readback['groups']:
            group['deployments'].reverse()
        effective = list(reversed(preparation('complete')['effective_export']))
        reverse = prepare(readback=readback, projection=projection, links=list(reversed(links)),
                          roster=list(reversed(roster)), instance_rows=list(reversed(rows)), effective=effective,
                          bindings=list(reversed(observation_bindings(preparation('complete')['readback']))))[0]
        self.assertEqual(forward, reverse)
        live = scenario('all_on')
        for group in live['groups']:
            group['deployments'].reverse()
        live['groups'].reverse()
        self.assertEqual(authority.validate_readback(live).vector(), authority.validate_readback(scenario('all_on')).vector())

    def test_row_14_safe_label_changes_without_changing_identity(self):
        projection, links, roster, rows = inputs()
        for row in rows:
            row['config']['label'] = f"Synthetic {row['config']['key']}"
        first = build(projection, links, roster, deepcopy(rows))
        for row in rows:
            row['config']['label'] = f"Renamed {row['config']['key']}"
        second = build(projection, links, roster, rows)
        self.assertEqual(bindings(first), bindings(second))
        self.assertNotEqual([group['labels'] for group in first['groups']],
                            [group['labels'] for group in second['groups']])
        for row in rows:
            row['config']['label'] = 'https://example.invalid/x'
        self.assertTrue(all(group['labels'] == [] for group in build(projection, links, roster, rows)['groups']))


class Links(Base):
    def assert_excluded(self, document, count, reason, claims=None):
        self.assertEqual(len(document['groups']), 10, 'a link failure never removes a display group')
        self.assertEqual(len(bindings(document)), len(FIXTURE['enrollment_links']) - count)
        # Every competing claimant is rejected; none wins.
        self.assertEqual(document['rejected'], {reason: claims or count})

    def test_row_15_competing_or_invalid_links_have_no_winner(self):
        cases = {}
        projection, links, roster, rows = inputs()
        links.append(deepcopy(links[0]))
        account_of(projection, links[0])['enrollment_links'].append({name: links[0][name] for name in KEY})
        cases['duplicate_full_binding'] = ((projection, links, roster, rows), 1, 'link_ambiguous', 2)
        projection, links, roster, rows = inputs()
        relink(projection, links, roster, 1, candidate_slot=links[0]['candidate_slot'])
        cases['same_platform_slot_collision'] = ((projection, links, roster, rows), 2, 'link_ambiguous')
        projection, links, roster, rows = inputs()
        next(row for row in rows if row['config']['key'] == links[2]['account_key'])['config']['account_selector'] = 'changed'
        cases['changed_config_selector'] = ((projection, links, roster, rows), 1, 'link_config_changed')
        projection, links, roster, rows = inputs()
        other = next(account for account in projection['accounts'] if not account['enrollment_links'])
        other['enrollment_links'].append({name: links[3][name] for name in KEY})
        cases['multi_owner_binding'] = ((projection, links, roster, rows), 1, 'link_ambiguous', 2)
        for target, field in (('wrong_target', 'target_id'), ('wrong_uid', 'opaque_account_uid'),
                              ('wrong_slot', 'candidate_slot')):
            projection, links, roster, rows = inputs()
            roster[2][field] = roster[2][field] + '-x'
            cases[target] = ((projection, links, roster, rows), 1, 'link_roster_mismatch')
        projection, links, roster, rows = inputs()
        roster[2]['strategy_profile'] = ''
        cases['missing_profile'] = ((projection, links, roster, rows), 1, 'link_profile_missing')
        for label, (args, count, reason, *claims) in cases.items():
            for reverse in (False, True):
                with self.subTest(label, reverse=reverse):
                    projection, links, roster, rows = deepcopy(args)
                    if reverse:
                        links.reverse(); roster.reverse(); projection['accounts'].reverse()
                    self.assert_excluded(build(projection, links, roster, rows), count, reason, *claims)

    def test_row_15_same_slot_on_another_platform_is_a_positive_control(self):
        projection, links, roster, rows = inputs()
        relink(projection, links, roster, 2, candidate_slot=links[0]['candidate_slot'])
        document = build(projection, links, roster, rows)
        self.assertEqual(len(bindings(document)), len(FIXTURE['enrollment_links']))
        self.assertEqual(document['rejected'], {})

    def test_row_15_duplicate_typed_source_across_groups_is_excluded(self):
        live = preparation('complete')['readback']
        typed = observation_bindings(live)
        typed[1]['binding_id'] = typed[0]['binding_id']
        document = json.loads(prepare(bindings=typed)[0])
        self.assertEqual(document['rejected'], {'observation_source_ambiguous': 2})
        self.assertEqual(sum(len(group['observation_bindings']) for group in document['groups']), len(typed) - 2)
        for mutate, reason in (({'broker_environment': 'paper' if typed[2]['broker_environment'] == 'live' else 'live'},
                                'observation_scope_inconsistent'),
                               ({'legacy_key': 'syn-not-a-deployment'}, 'observation_owner_unknown'),
                               ({'opaque_account_uid': 'uid:not-enrolled'}, 'observation_identity_unenrolled')):
            with self.subTest(reason):
                typed = observation_bindings(live)
                typed[2].update(mutate)
                self.assertEqual(json.loads(prepare(bindings=typed)[0])['rejected'], {reason: 1})

    def test_row_15_legacy_duplicate_array_still_rejects_at_constructor(self):
        row = {'platform_id': 'ibkr', 'candidate_slot': 'syn-slot-01', 'opaque_account_uid': 'uid:a',
               'target_id': 'syn-run-01', 'strategy_profile': 'syn_profile'}
        with self.assertRaisesRegex(ValueError, 'digest_duplicate_target_binding'):
            app.Configuration([row, dict(row)], 'projects/p/locations/l/jobs/j', 'scope', '2026-01-01')


class Recipient(Base):
    ACCOUNT = 'U7654321'

    def setUp(self):
        super().setUp()
        self.data = prepare()[0]
        self.roster = authority.compose_generation(acquire(scenario('all_on')), selected(self.data))
        self.link = FIXTURE['enrollment_links'][0]

    def raw(self, recipient='synthetic-chat', **changes):
        account = {'candidate_slot': self.link['candidate_slot'], 'opaque_account_uid': self.link['opaque_account_uid'],
                   'target_id': self.link['target_id'], 'account_id': self.ACCOUNT, **changes}
        return json.dumps({'recipient_id': recipient, 'accounts': [account]})

    def test_row_16_only_the_accepted_generation_binding_maps(self):
        self.assertEqual(authority.generation_recipient_accounts(self.roster, self.raw(), 'synthetic-chat'),
                         {self.link['opaque_account_uid']: self.ACCOUNT})
        cases = {'wrong_recipient': (self.raw(recipient='other-chat'), 'synthetic-chat'),
                 'missing_recipient': (self.raw(), ''),
                 'wrong_slot': (self.raw(candidate_slot='syn-slot-99'), 'synthetic-chat'),
                 'wrong_uid': (self.raw(opaque_account_uid='uid:other'), 'synthetic-chat'),
                 'wrong_target': (self.raw(target_id='syn-run-99'), 'synthetic-chat'),
                 'malformed_broker_id': (self.raw(account_id='U12***'), 'synthetic-chat'),
                 'malformed_json': ('{', 'synthetic-chat')}
        for label, (raw, recipient) in cases.items():
            with self.subTest(label):
                self.assertEqual(authority.generation_recipient_accounts(self.roster, raw, recipient), {})

    def test_row_16_conflicting_ownership_in_either_direction_empties_the_map(self):
        second = FIXTURE['enrollment_links'][1]
        base = {'candidate_slot': self.link['candidate_slot'], 'opaque_account_uid': self.link['opaque_account_uid'],
                'target_id': self.link['target_id'], 'account_id': self.ACCOUNT}
        one_uid_two_accounts = [base, {**base, 'candidate_slot': second['candidate_slot'],
                                       'target_id': second['target_id'], 'account_id': 'U7654322'}]
        other_uid = {'candidate_slot': second['candidate_slot'], 'opaque_account_uid': 'uid:other-owner',
                     'target_id': second['target_id'], 'account_id': self.ACCOUNT}
        for accounts in (one_uid_two_accounts, [base, other_uid]):
            raw = json.dumps({'recipient_id': 'synthetic-chat', 'accounts': accounts})
            self.assertEqual(authority.generation_recipient_accounts(self.roster, raw, 'synthetic-chat'), {})

    def test_row_16_excluded_or_foreign_bindings_never_map(self):
        projection, links, roster, rows = inputs()
        roster[0]['target_id'] += '-x'
        excluded = authority.compose_generation(acquire(scenario('all_on')), selected(prepare(
            projection=projection, links=links, roster=roster, instance_rows=rows)[0]))
        self.assertEqual(authority.generation_recipient_accounts(excluded, self.raw(), 'synthetic-chat'), {})
        self.assertEqual(authority.generation_recipient_accounts(None, self.raw(), 'synthetic-chat'), {})
        self.assertEqual(authority.generation_recipient_accounts(roster, self.raw(), 'synthetic-chat'), {})

    def test_row_16_broker_id_never_enters_the_general_document(self):
        mapped = authority.generation_recipient_accounts(self.roster, self.raw(), 'synthetic-chat')
        self.assertTrue(mapped)
        for surface in (self.data.decode(), repr(self.roster), json.dumps(self.roster.run_bindings())):
            self.assertNotIn(self.ACCOUNT, surface)
        selector = {row['config']['account_selector'] for row in instances()}
        self.assertFalse(any(value and value in self.data.decode() for value in selector),
                         'no private locator in the artifact')


if __name__ == '__main__':
    unittest.main()
