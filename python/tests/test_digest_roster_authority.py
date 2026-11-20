"""Core authority tests: strict B2 readback validation, acquisition, the
dormant service-auth boundary, enrollment selection, preparation and the
composition join (Q1; rows 01, 02, 06, 23 consumer side)."""
import hashlib
import json
import unittest
from copy import deepcopy
from datetime import timedelta

from digest_roster_support import (
    BOOT, CORPUS, FIXTURE, OBSERVED, ORIGIN, SOURCE, VERSIONS, OutboundTrap, SyntheticAuth,
    SyntheticEnrollmentSource, SyntheticTransport, acquire, at, authority, body, legacy_roster, ok,
    preparation, prepare, scenario, selected,
)

AVAILABLE = [name for name, document in CORPUS['scenarios'].items()
             if document['status'] == 'available' and not document['reasons']]


class Trapped(unittest.TestCase):
    def setUp(self):
        self.trap = OutboundTrap().__enter__()

    def tearDown(self):
        self.trap.__exit__(None, None, None)
        self.assertEqual(self.trap.attempts, 0, 'zero outbound calls')

    def rejects(self, code, call, *args, kind=None, **kwargs):
        with self.assertRaises(authority.AuthorityError) as caught:
            call(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)
        if kind:
            self.assertEqual(caught.exception.kind, kind)
        return caught.exception


class ReadbackValidation(Trapped):
    def test_every_landed_available_scenario_validates_with_its_own_status(self):
        for name in AVAILABLE:
            with self.subTest(name):
                document = scenario(name)
                live = authority.validate_readback(document)
                self.assertEqual(len(live.groups), document['counts']['physical_accounts'])
                self.assertEqual(sum(group.management_status == 'managed' for group in live.groups),
                                 document['counts']['managed'])

    def test_unavailable_variants_supply_no_authority(self):
        self.rejects('management_read_unavailable', authority.validate_readback, scenario('uninitialized'))
        self.rejects('management_read_unavailable', authority.validate_readback, scenario('policy_missing'))
        for status in ('unavailable', 'partial'):
            document = scenario('all_on')
            document['status'] = status
            self.rejects('management_read_unavailable', authority.validate_readback, document)
        document = scenario('all_on')
        document['physical_grouping_complete'] = False
        self.rejects('physical_grouping_incomplete', authority.validate_readback, document)

    def test_row_02_tampering_rejects_with_bounded_reason(self):
        cases = {}
        document = scenario('all_on'); document['format'] = 'qsl_account_management_readback.v2'
        cases['readback_format_unsupported'] = document
        cases['readback_shape_invalid'] = [scenario('all_on')]
        document = scenario('all_on'); document['groups'][0]['management_status'] = 'enabled'
        cases['readback_group_invalid'] = document
        document = scenario('all_on'); document['authority'] = 'console'
        cases.setdefault('readback_shape_invalid#unknown', document)
        document = scenario('all_on'); del document['policy_revision']
        cases.setdefault('readback_shape_invalid#omitted', document)
        document = scenario('all_on'); document['counts']['managed'] = 10
        cases['readback_counts_inconsistent'] = document
        document = scenario('all_on'); document['instance_revision'] = True
        cases['readback_revision_invalid'] = document
        document = scenario('all_on'); document['groups'] = document['groups'][:-1]
        cases['readback_counts_inconsistent#truncated'] = document
        document = scenario('all_on'); document['groups'][0]['reasons'] = ['Free text!']
        cases['readback_group_invalid#reason'] = document
        for label, document in cases.items():
            with self.subTest(label):
                self.rejects(label.split('#')[0], authority.validate_readback, document)
        duplicate = body(scenario('all_on'))[:-1] + b', "format": "qsl_account_management_readback.v1"}'
        self.rejects('duplicate_json_key', authority.validate_readback, duplicate)
        self.rejects('json_constant_rejected', authority.validate_readback, b'{"ok": NaN}')

    def test_candidate_supplied_status_or_flag_has_no_authority(self):
        # Toggle-based reclassification and a candidate flag are inconsistent
        # with B2's reducer and reject the whole read.
        document = scenario('all_off'); document['groups'][0]['processing_eligible'] = True
        self.rejects('readback_status_inconsistent', authority.validate_readback, document, kind='conflict')
        document = scenario('all_on')
        index = next(i for i, group in enumerate(document['groups']) if group['management_class'] == 'display_only')
        document['groups'][index]['management_class'] = 'eligible'
        self.rejects('readback_status_inconsistent', authority.validate_readback, document)
        document = scenario('all_on'); document['groups'][2]['applied']['management_enabled'] = False
        self.rejects('readback_status_inconsistent', authority.validate_readback, document)

    def test_applied_effective_time_after_observation_is_not_current(self):
        document = scenario('all_on')
        document['observed_at'] = '2026-11-19T19:00:00.000Z'
        self.rejects('applied_effective_after_observation', authority.validate_readback, document, kind='stale')
        for value in ('2026-11-19T23:00:00+00:00', '2026-11-19 23:00:00Z', '', None, 'yesterday'):
            with self.subTest(value):
                self.rejects('observation_time_invalid', authority.validate_readback, at(scenario('all_on'), value)
                             if value is not None else {**scenario('all_on'), 'observed_at': None}, kind='stale')

    def test_claim_by_two_groups_and_lost_member_reject(self):
        document = scenario('all_on')
        document['groups'][1]['deployments'].append(deepcopy(document['groups'][0]['deployments'][0]))
        document['counts']['display_deployments'] += 1
        self.rejects('deployment_claimed_by_multiple_accounts', authority.validate_readback, document)
        document = scenario('all_on'); document['groups'][0]['deployments'][0]['present'] = False
        self.rejects('deployment_member_lost', authority.validate_readback, document)

    def test_sibling_tuple_disagreement_in_export_is_conflict(self):
        document = preparation('sibling_effective_time_disagree')['readback']
        self.rejects('sibling_applied_disagree', authority.validate_readback, document, kind='conflict')

    def test_identifiers_are_never_normalized(self):
        document = scenario('all_on')
        live = authority.validate_readback(document)
        raw = sorted((item['platform'], item['key']) for group in document['groups'] for item in group['deployments'])
        self.assertEqual(sorted(pair for group in live.groups for pair in group.deployments), raw)


class Window(Trapped):
    def test_row_08_bounds_are_inclusive_without_rounding(self):
        T = OBSERVED
        within = authority.within_window
        self.assertTrue(within(T, T + timedelta(seconds=300)))
        self.assertFalse(within(T, T + timedelta(seconds=300, milliseconds=1)))
        self.assertTrue(within(T, T - timedelta(seconds=30)))
        self.assertFalse(within(T, T - timedelta(seconds=30, milliseconds=1)))
        self.assertFalse(within(None, T))
        self.assertEqual(authority.observation_age(T, T - timedelta(seconds=10)), timedelta(0))
        self.rejects('generation_clock_unavailable', within, T, T.replace(tzinfo=None))
        self.rejects('generation_clock_unavailable', within, T, None)


class Boot(Trapped):
    def test_mode_is_explicit_and_mapping_mode_needs_no_legacy_array(self):
        self.assertRaisesRegex(ValueError, 'digest_roster_mode_required', authority.RosterBootConfig.from_protected, {})
        self.assertRaisesRegex(ValueError, 'digest_roster_mode_invalid', authority.RosterBootConfig.from_protected,
                               {'mode': 'auto'})
        self.assertEqual(authority.RosterBootConfig.from_protected({'mode': 'legacy'}).mode, 'legacy')
        raw = {'mode': 'mapping_v1', 'origin': ORIGIN, 'enrollment_source': SOURCE, 'config_context': 'ctx',
               'service_auth': {'issuer': 'i', 'audience': 'a', 'subjects': ['s']}}
        self.assertEqual(authority.RosterBootConfig.from_protected(raw).mode, 'mapping_v1')
        for origin in ('http://console.example.invalid', 'https://console.example.invalid/api',
                       'https://user@console.example.invalid', 'https://console.example.invalid?x=1'):
            with self.subTest(origin):
                self.assertRaisesRegex(ValueError, 'digest_roster_origin_invalid',
                                       authority.RosterBootConfig.from_protected, {**raw, 'origin': origin})


class Acquisition(Trapped):
    def test_acquires_one_cache_bypassing_authenticated_get(self):
        transport = SyntheticTransport(ok(scenario('all_on')))
        live = authority.AcquisitionClient(BOOT, SyntheticAuth(), transport).acquire(OBSERVED)
        self.assertEqual(len(live.groups), 10)
        [request] = transport.requests
        self.assertEqual(request['url'], ORIGIN + '/api/admin/account-management')
        self.assertEqual(request['headers']['Authorization'], 'Bearer synthetic-token')
        self.assertIn('no-cache', request['headers']['Cache-Control'])
        self.assertNotIn('Cookie', request['headers'])
        self.assertLessEqual(request['timeout'], BOOT.read_timeout)

    def test_dormant_authenticator_fails_closed_without_a_request(self):
        transport = SyntheticTransport(ok(scenario('all_on')))
        client = authority.AcquisitionClient(BOOT, transport=transport)
        self.rejects('service_auth_unavailable', client.acquire, OBSERVED, kind='unavailable')
        self.assertEqual(transport.requests, [])

    def test_assertion_must_be_for_exactly_this_read(self):
        cases = {'service_auth_audience_rejected': {'audience': 'other'},
                 'service_auth_audience_rejected#issuer': {'issuer': 'other'},
                 'service_auth_subject_rejected': {'subject': 'someone-else'},
                 'service_auth_scope_rejected': {'path': '/api/admin/account-settings'},
                 'service_auth_expired': {'expires_at': OBSERVED - timedelta(seconds=1)},
                 'service_auth_expired#long': {'expires_at': OBSERVED + timedelta(hours=2)},
                 'service_auth_invalid': {'token': 'a b'}}
        for label, override in cases.items():
            with self.subTest(label):
                transport = SyntheticTransport(ok(scenario('all_on')))
                client = authority.AcquisitionClient(BOOT, SyntheticAuth(**override), transport)
                self.rejects(label.split('#')[0], client.acquire, OBSERVED)
                self.assertEqual(transport.requests, [])

    def test_denied_redirect_header_and_transport_failures_supply_no_authority(self):
        cases = {'management_read_denied': (401, {}, b''),
                 'management_read_denied#admin': (403, {}, b''),
                 'management_read_redirect_rejected': (302, {'location': ORIGIN + '/elsewhere'}, b''),
                 'management_read_failed': (503, {}, b''),
                 'management_read_headers_invalid': (200, {'content-type': 'application/json',
                                                           'cache-control': 'max-age=60'}, body(scenario('all_on'))),
                 'management_read_headers_invalid#type': (200, {'content-type': 'text/html',
                                                                'cache-control': 'private, no-store'}, b'{}'),
                 'management_read_oversized': (200, {'content-type': 'application/json',
                                                     'cache-control': 'private, no-store'},
                                               b' ' * (authority.MAX_RESPONSE_BYTES + 1))}
        for label, response in cases.items():
            with self.subTest(label):
                client = authority.AcquisitionClient(BOOT, SyntheticAuth(), SyntheticTransport(response))
                self.rejects(label.split('#')[0], client.acquire, OBSERVED)
        moved = SyntheticTransport(ok(scenario('all_on')), url=ORIGIN + '/login')
        self.rejects('management_read_redirect_rejected',
                     authority.AcquisitionClient(BOOT, SyntheticAuth(), moved).acquire, OBSERVED)
        timeout = SyntheticTransport(authority.AuthorityError('management_read_timeout'))
        self.rejects('management_read_timeout',
                     authority.AcquisitionClient(BOOT, SyntheticAuth(), timeout).acquire, OBSERVED)
        self.rejects('generation_deadline_exhausted',
                     authority.AcquisitionClient(BOOT, SyntheticAuth(), SyntheticTransport()).acquire,
                     OBSERVED, timeout=0)

    def test_legacy_mode_cannot_build_an_acquisition_client(self):
        self.assertRaises(ValueError, authority.AcquisitionClient, authority.RosterBootConfig('legacy'))


class Preparation(Trapped):
    def test_row_01_complete_preparation_preserves_identity_and_profiles(self):
        data, digest = prepare()
        self.assertEqual(hashlib.sha256(data).hexdigest(), digest)
        document = json.loads(data)
        self.assertEqual(len(document['groups']), 10)
        bindings = [binding for group in document['groups'] for binding in group['legacy_run_bindings']]
        roster = {tuple(row[name] for name in authority.RUN_BINDING_FIELDS) for row in legacy_roster()}
        self.assertEqual({tuple(row[name] for name in authority.RUN_BINDING_FIELDS) for row in bindings}, roster)
        self.assertEqual(len(bindings), len(FIXTURE['enrollment_links']))
        self.assertNotIn('management_status', json.dumps(document))
        self.assertNotIn('management_class', json.dumps(document))
        # No profile is made up: a link without a protected roster row is excluded.
        data, _ = prepare(roster=legacy_roster()[1:])
        document = json.loads(data)
        self.assertEqual(sum(len(group['legacy_run_bindings']) for group in document['groups']),
                         len(FIXTURE['enrollment_links']) - 1)
        self.assertEqual(document['rejected'], {'link_roster_mismatch': 1})

    def test_row_01_empty_run_lists_keep_display_and_observation_bindings(self):
        data, _ = prepare(roster=[], links=[])
        document = json.loads(data)
        self.assertEqual(len(document['groups']), 10)
        self.assertTrue(all(group['legacy_run_bindings'] == [] for group in document['groups']))
        self.assertEqual(sum(len(group['observation_bindings']) for group in document['groups']), 7)

    def test_row_01_absent_and_null_projection_controls_confer_no_authority(self):
        for name in ('absent', 'null'):
            with self.subTest(name):
                control = deepcopy(CORPUS['controls'][name])
                self.assertEqual(control['accounts'], [])
                self.rejects('projection_grouping_mismatch', prepare, projection=control)

    def test_row_06_preparation_refuses_contradictory_or_incomplete_inputs(self):
        self.rejects('projection_parity_mismatch', prepare, 'inventory_incomplete')
        self.rejects('effective_record_duplicate', prepare, 'duplicate_record')
        self.rejects('sibling_applied_disagree', prepare, 'sibling_effective_time_disagree')
        prepared = preparation('complete')
        rows = deepcopy(prepared['effective_export']); rows[0]['management_enabled'] = 1
        self.rejects('effective_records_invalid', prepare, effective=rows)
        rows = deepcopy(prepared['effective_export'])[1:]
        self.rejects('effective_export_mismatch', prepare, effective=rows)
        rows = deepcopy(prepared['effective_export']); rows[0]['source'] = 'x'
        self.rejects('effective_records_invalid', prepare, effective=rows)
        projection = deepcopy(prepared['projection'])
        projection['accounts'][0]['configuration_revision']['instances'] += 1
        self.rejects('projection_revision_mismatch', prepare, projection=projection)

    def test_preparation_never_publishes_against_an_unavailable_read(self):
        self.rejects('management_read_unavailable', prepare, readback=scenario('uninitialized'))


class Composition(Trapped):
    def setUp(self):
        super().setUp()
        self.artifact = selected(prepare()[0])

    def test_composes_live_status_with_prepared_structure(self):
        roster = authority.compose_generation(acquire(scenario('one_off')), self.artifact)
        self.assertEqual(len(roster.groups), 10)
        self.assertEqual(sum(group.live.management_status == 'management_disabled' for group in roster.groups), 1)
        self.assertEqual(len(roster.run_bindings()), len(FIXTURE['enrollment_links']))

    def test_caller_built_envelope_is_not_evidence_of_acquisition(self):
        self.rejects('observation_not_acquired', authority.compose_generation,
                     authority.validate_readback(scenario('all_on')), self.artifact)
        live = acquire(scenario('all_on'))
        forged = authority.EnrollmentArtifact(self.artifact.selection, self.artifact.document)
        self.rejects('enrollment_artifact_unselected', authority.compose_generation, live, forged)

    def test_structural_revisions_must_match_the_live_read(self):
        for name in ('policy_bumped', 'instance_bumped'):
            with self.subTest(name):
                self.rejects('structural_revision_mismatch', authority.compose_generation,
                             acquire(scenario(name)), self.artifact, kind='conflict')

    def test_grouping_must_match_exactly(self):
        document = json.loads(prepare()[0])
        document['groups'][0]['deployments'] = document['groups'][0]['deployments'] + [['ibkr', 'syn-extra']]
        data = json.dumps(document).encode()
        self.rejects('grouping_mismatch', authority.compose_generation, acquire(scenario('all_on')), selected(data))


class Selection(Trapped):
    def test_selection_must_be_authenticated_and_version_exact(self):
        data, _ = prepare()
        source = SyntheticEnrollmentSource(data, authenticated=False)
        self.rejects('enrollment_selection_unauthenticated', authority.read_selection, source.read_selection(), SOURCE)
        source = SyntheticEnrollmentSource(data, source='other-source')
        self.rejects('enrollment_selection_unauthenticated', authority.read_selection, source.read_selection(), SOURCE)
        source = SyntheticEnrollmentSource(data)
        selection = authority.read_selection(source.read_selection(), SOURCE)
        tampered = authority.SourceRead(SOURCE, True, data + b' ')
        self.rejects('enrollment_artifact_version_mismatch', authority.load_artifact, selection, tampered)
        source = SyntheticEnrollmentSource(data, versions={**VERSIONS, 'version': 'v2'})
        selection = authority.read_selection(source.read_selection(), SOURCE)
        self.rejects('enrollment_artifact_version_mismatch', authority.load_artifact, selection,
                     source.read_artifact(selection))
        source.current['artifact_sha256'] = 'x'
        self.rejects('enrollment_selection_invalid', authority.read_selection, source.read_selection(), SOURCE)


if __name__ == '__main__':
    unittest.main()
