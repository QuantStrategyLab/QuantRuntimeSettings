"""Slice 2 tests: FLAG-3 group identity, canonical ownership contract, raw identifier retention, B3-01/14/15/D3-P2 PREP."""
from __future__ import annotations

import hashlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python' / 'scripts'))
sys.path.insert(0, str(ROOT / 'python' / 'tests'))

import digest_roster_authority as authority  # noqa: E402
import digest_roster_validator as validator  # noqa: E402
import project_digest_display_roster as preparer  # noqa: E402

CORPUS = json.loads((ROOT / 'python/tests/fixtures/digest_roster_b2_corpus.json').read_text(encoding='utf-8'))
FIXTURE = json.loads((ROOT / 'tests/fixtures/account-mapping-roster.synthetic.json').read_text(encoding='utf-8'))
PAIR = [tuple(item.split('/', 1)) for item in CORPUS['roles']['pair']]
SOURCE = 'synthetic-enrollment'
VERSIONS = {'version': 'v1', 'membership_version': 'm1', 'label_version': 'l1', 'link_version': 'k1'}


def _instances():
    return [
        {
            **item,
            'kind': 'existing',
            'config': {**item['config'], 'account_scope': f'SYN-SCOPE-{idx + 1:02d}'},
        }
        for idx, item in enumerate(FIXTURE['instances'])
    ]


def _legacy_roster(links=None):
    return [
        {
            'platform_id': link['platform_id'],
            'candidate_slot': link['candidate_slot'],
            'opaque_account_uid': link['opaque_account_uid'],
            'target_id': link['target_id'],
            'strategy_profile': f'syn_profile_{idx}',
        }
        for idx, link in enumerate(links if links is not None else FIXTURE['enrollment_links'])
    ]


def _observation_bindings(readback):
    bindings = []
    for idx, group in enumerate(readback['groups']):
        if group['scope'] not in {'paper', 'live'}:
            continue
        first = group['deployments'][0]
        bindings.append({
            'binding_id': f'obs-{idx:02d}',
            'platform': first['platform'],
            'legacy_key': first['key'],
            'opaque_account_uid': None,
            'broker_environment': group['scope'],
            'account_scope': 'account',
        })
    return bindings


def _prepare_bundle(prep_name='complete', *, readback=None, projection=None, effective=None,
                    links=None, roster=None, instance_rows=None, bindings=None):
    prepared = CORPUS['preparations'][prep_name]
    rb = deepcopy(readback if readback is not None else prepared['readback'])
    return authority.prepare_enrollment_bundle(
        readback=rb,
        effective_records=deepcopy(effective if effective is not None else prepared['effective_export']),
        projection=deepcopy(projection if projection is not None else prepared['projection']),
        instances=deepcopy(instance_rows if instance_rows is not None else _instances()),
        enrollment_links=deepcopy(links if links is not None else FIXTURE['enrollment_links']),
        legacy_roster=deepcopy(roster if roster is not None else _legacy_roster(links)),
        observation_bindings=deepcopy(bindings if bindings is not None else _observation_bindings(rb)),
        source=SOURCE,
        versions=dict(VERSIONS),
        prepared_at=CORPUS['observed_at'],
    )


def _link_id(row):
    return tuple(row[name] for name in validator.BINDING_FIELDS)


def _relink(projection, links, roster, index, **changes):
    old = _link_id(links[index])
    for row in [*links, *roster, *(item for acc in projection['accounts'] for item in acc['enrollment_links'])]:
        if _link_id(row) == old:
            row.update(changes)


def _acquire(readback_doc):
    class _Auth:
        def assertion(self, method, path, audience, clock):
            return authority.ServiceAssertion('tok', 'syn-iss', audience, 'syn-sub',
                                              clock + timedelta(minutes=5), method, path)

    class _Transport:
        def get(self, url, headers, timeout):
            return authority.TransportResponse(
                200,
                {'content-type': 'application/json', 'cache-control': 'private, no-store'},
                json.dumps(readback_doc).encode('utf-8'),
                url,
            )

    boot = authority.RosterBootConfig(
        validator.MAPPING_MODE,
        'https://console.example.invalid',
        validator.ServiceAuthPolicy('syn-iss', 'syn-aud', frozenset({'syn-sub'})),
        SOURCE,
        'synthetic_context',
    )
    clock = validator.parse_instant(readback_doc['observed_at'])
    return authority.AcquisitionClient(boot, _Auth(), _Transport()).acquire(clock)


def _envelope_from_roster(roster, *, run_id='2026-11-20/07:00', generated_at='2026-11-19T23:00:30Z'):
    accounts = []
    counts_status = {s: 0 for s in validator.MANAGEMENT_STATUSES}
    for group in roster.groups:
        live = group.live
        counts_status[live.management_status] += 1
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
            'applied': (
                {'management_enabled': live.applied[0], 'revision': live.applied[1], 'effective_at': live.applied[2]}
                if live.applied is not None else None
            ),
            'legacy_run_bindings': [dict(b) for b in group.legacy_run_bindings],
            'observation_bindings': [dict(b) for b in group.observation_bindings],
        })
    obs_at = roster.observation.observed_at
    doc = {
        'format': validator.ROSTER_FORMAT,
        'schema_version': validator.ROSTER_FORMAT,
        'status': validator.STATUS_AVAILABLE,
        'run_id': run_id,
        'run_scope': {
            'namespace': f'prod:{SOURCE}:synthetic_context:syn-scope',
            'enrollment_source': SOURCE,
            'config_context': 'synthetic_context',
            'recipient_scope': 'syn-scope',
            'report_date': '2026-11-20',
            'original_slot': '07:00',
            'preview': False,
        },
        'generation_id': 'gen-slice2-01',
        'source_revision': {
            'instance_revision': roster.observation.instance_revision,
            'policy_revision': roster.observation.policy_revision,
        },
        'source_snapshot_at': obs_at,
        'generated_at': generated_at,
        'generation_window': {
            'business_day': '2026-11-19',
            'start': '2026-11-18T22:00:00Z',
            'end': '2026-11-19T22:00:00Z',
            'deadline_at': '2026-11-19T23:30:00Z',
        },
        'observation_age_seconds': 30.0,
        'live_source': validator.MANAGEMENT_ROUTE,
        'evidence_scope': validator.EVIDENCE_SCOPE,
        'acquisition': {
            'live_source': validator.MANAGEMENT_ROUTE,
            'evidence_scope': validator.EVIDENCE_SCOPE,
            'initial_read_at': '2026-11-19T23:00:10Z',
            'confirming_read_at': '2026-11-19T23:00:25Z',
            'initial_snapshot_at': obs_at,
            'confirming_snapshot_at': obs_at,
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
            'display_deployments': sum(len(a['deployments']) for a in accounts) + len(roster.observation.uncovered),
            'uncovered_deployments': len(roster.observation.uncovered),
            **counts_status,
        },
        'accounts': accounts,
        'uncovered_deployments': [
            {
                'platform': p,
                'key': k,
                'management_status': 'unknown',
                'evidence_state': 'unknown',
                'reasons': ['deployment_uncovered'],
                'processing_eligible': False,
                'processing_denial': 'management_status_unknown',
            }
            for p, k in roster.observation.uncovered
        ],
        'rejected': dict(roster.rejected),
    }
    doc['content_hash'] = validator.compute_content_hash(doc)
    return doc


class Flag3CertifiedGroupIdentityTests(unittest.TestCase):
    def test_flag3_exact_key_spec_invariants_and_boundary_safety(self):
        base = [('ibkr', 'syn-acct-01'), ('ibkr', 'syn-acct-01-b')]
        gid = validator.certify_group_identity(base)
        self.assertRegex(gid, r'^grp_v1_[0-9a-f]{64}$')
        # Reordering does not change identity.
        self.assertEqual(gid, validator.certify_group_identity(list(reversed(base))))
        # Case and whitespace are preserved (never stripped or lowercased).
        self.assertNotEqual(gid, validator.certify_group_identity([('IBKR', 'syn-acct-01'), ('ibkr', 'syn-acct-01-b')]))
        self.assertNotEqual(gid, validator.certify_group_identity([('ibkr', ' syn-acct-01'), ('ibkr', 'syn-acct-01-b')]))
        # Adding or removing a member changes identity.
        self.assertNotEqual(gid, validator.certify_group_identity(base[:1]))
        self.assertNotEqual(gid, validator.certify_group_identity([*base, ('ibkr', 'syn-acct-01-c')]))
        # Length-prefixed unambiguous component and pair boundaries.
        self.assertNotEqual(
            validator.certify_group_identity([('ab', 'c')]),
            validator.certify_group_identity([('a', 'bc')]),
        )
        self.assertNotEqual(
            validator.certify_group_identity([('a', 'b'), ('c', 'd')]),
            validator.certify_group_identity([('a', 'b:c'), ('d', 'e')]),
        )
        self.assertNotEqual(
            validator.certify_group_identity([('a', 'b'), ('c', 'd')]),
            validator.certify_group_identity([('a', 'b,c,d')]),
        )
        # UTF-8 byte ordering is deterministic.
        u1 = ('ibkr', 'acct-ä')
        u2 = ('ibkr', 'acct-z')
        self.assertEqual(
            validator.certify_group_identity([u1, u2]),
            validator.certify_group_identity([u2, u1]),
        )
        # Duplicates are rejected before keying.
        with self.assertRaisesRegex(validator.AuthorityError, '^duplicate_group_deployment$'):
            validator.certify_group_identity([base[0], base[0]])

    def test_row_14_group_identity_stable_across_reordering_labels_class_scope_and_uids(self):
        prepared = CORPUS['preparations']['complete']
        proj = deepcopy(prepared['projection'])
        links = deepcopy(FIXTURE['enrollment_links'])
        roster = _legacy_roster(links)
        rows = _instances()
        for row in rows:
            row['config']['label'] = f"Safe {row['config']['key']}"
        bundle_a = _prepare_bundle(projection=proj, links=links, roster=roster, instance_rows=rows)
        doc_a = json.loads(bundle_a.artifact_bytes)

        # Distinct legacy UIDs across the two sibling deployments + reordered inputs + renamed safe labels.
        _relink(proj, links, roster, 1, opaque_account_uid='uid:SYN-Opaque/01-b==')
        proj['accounts'].reverse()
        for acc in proj['accounts']:
            acc['deployments'].reverse()
            acc['enrollment_links'].reverse()
        rb_rev = deepcopy(prepared['readback'])
        rb_rev['groups'].reverse()
        for g in rb_rev['groups']:
            g['deployments'].reverse()
        for row in rows:
            row['config']['label'] = f"Renamed {row['config']['key']}"
        bundle_b = _prepare_bundle(
            readback=rb_rev,
            effective=list(reversed(prepared['effective_export'])),
            projection=proj,
            links=list(reversed(links)),
            roster=list(reversed(roster)),
            instance_rows=list(reversed(rows)),
            bindings=list(reversed(_observation_bindings(prepared['readback']))),
        )
        doc_b = json.loads(bundle_b.artifact_bytes)

        sel = authority.EnrollmentSelection(SOURCE, **VERSIONS, artifact_sha256=bundle_a.artifact_sha256)
        sel_b = authority.EnrollmentSelection(SOURCE, **VERSIONS, artifact_sha256=bundle_b.artifact_sha256)
        art_a = authority.load_artifact(sel, authority.SourceRead(SOURCE, True, bundle_a.artifact_bytes))
        art_b = authority.load_artifact(sel_b, authority.SourceRead(SOURCE, True, bundle_b.artifact_bytes))

        live = _acquire(CORPUS['scenarios']['all_on'])
        gen_a = authority.compose_generation(live, art_a)
        gen_b = authority.compose_generation(live, art_b)

        self.assertEqual([g.group_id for g in gen_a.groups], [g.group_id for g in gen_b.groups])
        pair_a = next(g for g in gen_a.groups if len(g.deployments) == 2)
        pair_b = next(g for g in gen_b.groups if len(g.deployments) == 2)
        self.assertEqual(pair_a.group_id, pair_b.group_id)
        self.assertEqual(
            {b['opaque_account_uid'] for b in pair_b.legacy_run_bindings},
            {'uid:SYN-Opaque/01==', 'uid:SYN-Opaque/01-b=='},
        )
        self.assertNotEqual(pair_a.labels, pair_b.labels)
        self.assertEqual(len(doc_a['groups']), 10)
        self.assertEqual(len(doc_b['groups']), 10)

        # Changing class (eligible -> display_only) or scope (live -> paper) keeps the same structural group_id,
        # carrying class and scope separately.
        rb_mod = deepcopy(CORPUS['scenarios']['all_on'])
        idx_pair = next(i for i, g in enumerate(rb_mod['groups']) if len(g['deployments']) == 2)
        rb_mod['groups'][idx_pair]['scope'] = 'paper'
        live_mod = _acquire(rb_mod)
        self.assertEqual(
            validator.certify_group_identity(live_mod.groups[idx_pair].deployments),
            pair_a.group_id,
        )
        self.assertEqual(live_mod.groups[idx_pair].scope, 'paper')


class CanonicalOwnershipContractTests(unittest.TestCase):
    def setUp(self):
        self.bundle = _prepare_bundle()
        self.sel = authority.EnrollmentSelection(SOURCE, **VERSIONS, artifact_sha256=self.bundle.artifact_sha256)
        self.art = authority.load_artifact(self.sel, authority.SourceRead(SOURCE, True, self.bundle.artifact_bytes))
        self.live = _acquire(CORPUS['scenarios']['all_on'])
        self.roster = authority.compose_generation(self.live, self.art)
        self.doc = _envelope_from_roster(self.roster)

    def test_ownership_contract_validates_all_six_invariants_and_rejects_violations(self):
        validator.validate_ownership_contract(self.doc, self.live)

        # 1) Source revision mismatch.
        rev_bad = deepcopy(self.doc)
        rev_bad['source_revision']['policy_revision'] += 1
        rev_bad['content_hash'] = validator.compute_content_hash(rev_bad)
        with self.assertRaisesRegex(validator.AuthorityError, '^ownership_revision_mismatch$'):
            validator.validate_ownership_contract(rev_bad, self.live)

        # 2) Silent omission from purported complete snapshot.
        omitted = deepcopy(self.doc)
        removed_deps = len(omitted['accounts'][-1]['deployments'])
        omitted['accounts'].pop()
        omitted['account_count'] -= 1
        omitted['counts']['physical_accounts'] -= 1
        omitted['counts']['display_groups'] -= 1
        omitted['counts']['display_deployments'] -= removed_deps
        omitted['counts']['managed'] -= 1
        omitted['content_hash'] = validator.compute_content_hash(omitted)
        with self.assertRaisesRegex(validator.AuthorityError, '^ownership_omission_detected$'):
            validator.validate_ownership_contract(omitted, self.live)

        # 3) Status mismatch against source.
        status_bad = deepcopy(self.doc)
        target_acc = next(a for a in status_bad['accounts'] if a['management_status'] == 'managed')
        target_acc['management_status'] = 'management_disabled'
        target_acc['processing_eligible'] = False
        target_acc['processing_denial'] = 'management_disabled'
        target_acc['applied']['management_enabled'] = False
        status_bad['counts']['managed'] -= 1
        status_bad['counts']['management_disabled'] += 1
        status_bad['content_hash'] = validator.compute_content_hash(status_bad)
        with self.assertRaisesRegex(validator.AuthorityError, '^ownership_status_mismatch$'):
            validator.validate_ownership_contract(status_bad, self.live)

        # 4) Account does not exist in source (forged deployment key with valid group_id).
        forged_acc = deepcopy(self.doc)
        forged_acc['accounts'][-1]['deployments'][0]['legacy_key'] = 'forged-acct'
        forged_acc['accounts'][-1]['account_key'] = 'forged-acct'
        forged_acc['accounts'][-1]['group_id'] = validator.certify_group_identity(
            forged_acc['accounts'][-1]['deployments']
        )
        forged_acc['accounts'][-1]['observation_bindings'] = []
        forged_acc['content_hash'] = validator.compute_content_hash(forged_acc)
        with self.assertRaisesRegex(validator.AuthorityError, '^ownership_account_mismatch$'):
            validator.validate_ownership_contract(forged_acc, self.live)

        # 5) Duplicate physical account (rejected by envelope & ownership checks).
        dup_acc = deepcopy(self.doc)
        dup_acc['accounts'][-1] = deepcopy(dup_acc['accounts'][0])
        dup_acc['accounts'][-1]['legacy_run_bindings'] = []
        dup_acc['accounts'][-1]['observation_bindings'] = []
        dup_acc['content_hash'] = validator.compute_content_hash(dup_acc)
        with self.assertRaisesRegex(validator.AuthorityError, '^duplicate_physical_account$'):
            validator.validate_ownership_contract(dup_acc, self.live)

    def test_consumer_provenance_checks_integrity_and_freshness_without_source_readback(self):
        clock = validator.parse_instant(self.doc['source_snapshot_at']) + timedelta(seconds=300)
        validator.validate_consumer_provenance(
            self.doc,
            clock=clock,
            expected_run_id=self.doc['run_id'],
            expected_run_scope=self.doc['run_scope'],
            expected_selection=self.doc['selection'],
        )
        with self.assertRaisesRegex(validator.AuthorityError, '^observation_stale$'):
            validator.validate_consumer_provenance(self.doc, clock=clock + timedelta(milliseconds=1))


class RawIdentifierRetentionAndPrepTests(unittest.TestCase):
    def test_raw_identifier_retention_blocks_label_even_when_row_identity_is_invalid(self):
        # RESCOPE §3.1 item 9 / R3 §2(f): rows with invalid identity fields are omitted from
        # indexed_roster, yet their valid raw private locator strings stay in raw_identifiers
        # and block configured labels matching them.
        rows = _instances()
        schwab = next(r for r in rows if r['platform'] == 'schwab')
        ibkr = next(r for r in rows if r['platform'] == 'ibkr' and r['config']['key'] == 'syn-acct-02')
        firstrade = next(r for r in rows if r['platform'] == 'firstrade')
        schwab['config']['label'] = 'RawInvalidRosterUid'
        ibkr['config']['label'] = 'RejectedObsBindingId'
        firstrade['config']['label'] = 'InvalidLinkTargetId'

        roster = _legacy_roster()
        roster.append({
            'platform_id': 'schwab',
            'candidate_slot': 'syn-slot-extra',
            'opaque_account_uid': 'RawInvalidRosterUid',
            'target_id': None,  # invalid identity field -> omitted from indexed_roster
            'strategy_profile': 'ignored_profile',
        })
        links = deepcopy(FIXTURE['enrollment_links'])
        links.append({
            'platform_id': 'firstrade',
            'candidate_slot': '',  # invalid link
            'opaque_account_uid': 'uid:bad-link',
            'target_id': 'InvalidLinkTargetId',
        })
        obs = _observation_bindings(CORPUS['preparations']['complete']['readback'])
        # Make an invalid/rejected observation binding on ibkr syn-acct-02 (wrong scope -> rejected).
        obs.append({
            'binding_id': 'RejectedObsBindingId',
            'platform': 'ibkr',
            'legacy_key': 'syn-acct-02',
            'opaque_account_uid': 'uid:unenrolled',
            'broker_environment': 'paper',  # conflicts with live scope -> rejected
            'account_scope': 'account',
        })

        bundle = _prepare_bundle(links=links, roster=roster, instance_rows=rows, bindings=obs)
        prep = bundle.prep_inputs
        # Invalid-identity roster row is excluded from indexed_roster...
        self.assertEqual(len(prep.indexed_roster), len(FIXTURE['enrollment_links']))
        # ...yet its raw identifier strings are retained separately on PrepInputs!
        self.assertIn('RawInvalidRosterUid', prep.raw_identifiers)
        self.assertIn('RejectedObsBindingId', prep.raw_identifiers)
        self.assertIn('InvalidLinkTargetId', prep.raw_identifiers)
        self.assertIn('RawInvalidRosterUid', prep.raw_identifiers_by_platform['schwab'])

        artifact = json.loads(bundle.artifact_bytes)
        all_labels = [item[2] for g in artifact['groups'] for item in g['labels']]
        self.assertNotIn('RawInvalidRosterUid', all_labels)
        self.assertNotIn('RejectedObsBindingId', all_labels)
        self.assertNotIn('InvalidLinkTargetId', all_labels)
        self.assertEqual(artifact['rejected'].get('label_rejected'), 3)

    def test_row_01_prep_complete_empty_runs_and_absent_null_controls(self):
        bundle = _prepare_bundle()
        doc = json.loads(bundle.artifact_bytes)
        self.assertEqual(len(doc['groups']), 10)
        self.assertEqual(doc['rejected'], {})
        bindings = [b for g in doc['groups'] for b in g['legacy_run_bindings']]
        self.assertEqual(
            {tuple(b[k] for k in validator.RUN_BINDING_FIELDS) for b in bindings},
            {tuple(r[k] for k in validator.RUN_BINDING_FIELDS) for r in _legacy_roster()},
        )
        # Empty run lists keep all 10 display groups and admit raw observation bindings.
        empty_bundle = _prepare_bundle(links=[], roster=[])
        empty_doc = json.loads(empty_bundle.artifact_bytes)
        self.assertEqual(len(empty_doc['groups']), 10)
        self.assertTrue(all(g['legacy_run_bindings'] == [] for g in empty_doc['groups']))
        self.assertEqual(sum(len(g['observation_bindings']) for g in empty_doc['groups']), 7)
        # Absent/null B1 projection controls confer zero authority.
        for ctrl in ('absent', 'null'):
            self.assertEqual(CORPUS['controls'][ctrl]['accounts'], [])
            with self.assertRaisesRegex(validator.AuthorityError, '^projection_grouping_mismatch$'):
                _prepare_bundle(projection=CORPUS['controls'][ctrl])

    def test_row_15_and_f14_same_group_duplicate_references_have_no_winner(self):
        prepared = CORPUS['preparations']['complete']
        proj = deepcopy(prepared['projection'])
        links = deepcopy(FIXTURE['enrollment_links'])
        roster = _legacy_roster(links)
        # F14: identical reference repeated inside one group (single raw link, two identical refs in projection).
        acct = next(a for a in proj['accounts'] if a['enrollment_links'])
        acct['enrollment_links'].append(deepcopy(acct['enrollment_links'][0]))
        for rev in (False, True):
            p = deepcopy(proj)
            l = deepcopy(links)
            r = deepcopy(roster)
            if rev:
                p['accounts'].reverse(); l.reverse(); r.reverse()
            doc = json.loads(_prepare_bundle(projection=p, links=l, roster=r).artifact_bytes)
            self.assertEqual(len(doc['groups']), 10)
            self.assertEqual(doc['rejected'].get('link_ambiguous'), 2)
            self.assertEqual(
                sum(len(g['legacy_run_bindings']) for g in doc['groups']),
                len(FIXTURE['enrollment_links']) - 1,
            )

        # Row 15: same-slot/different-platform positive control retains both bindings.
        proj2 = deepcopy(prepared['projection'])
        links2 = deepcopy(FIXTURE['enrollment_links'])
        roster2 = _legacy_roster(links2)
        _relink(proj2, links2, roster2, 2, candidate_slot=links2[0]['candidate_slot'])
        doc2 = json.loads(_prepare_bundle(projection=proj2, links=links2, roster=roster2).artifact_bytes)
        self.assertEqual(doc2['rejected'], {})
        self.assertEqual(sum(len(g['legacy_run_bindings']) for g in doc2['groups']), len(FIXTURE['enrollment_links']))

    def test_d3_p2_full_prep_rejects_boolean_true_revisions_before_equality(self):
        rb_ok = deepcopy(CORPUS['scenarios']['all_on'])
        rb_ok['instance_revision'] = 1
        rb_ok['policy_revision'] = 1
        rb_ok['effective_export']['instance_revision'] = 1
        rb_ok['effective_export']['policy_revision'] = 1
        proj_ok = deepcopy(CORPUS['preparations']['complete']['projection'])
        for acc in proj_ok['accounts']:
            acc['configuration_revision']['instances'] = 1
            acc['configuration_revision']['mapping_policy'] = 1

        # Positive control: genuine integer 1 succeeds through full PREP.
        ok_bundle = _prepare_bundle(readback=rb_ok, projection=proj_ok, effective=rb_ok['effective_export']['records'])
        self.assertEqual(json.loads(ok_bundle.artifact_bytes)['instance_revision'], 1)

        for field_name in ('instance_revision', 'policy_revision'):
            mut_rb = deepcopy(rb_ok)
            mut_rb['effective_export'][field_name] = True
            with self.assertRaisesRegex(validator.AuthorityError, '^readback_revision_invalid$'):
                _prepare_bundle(readback=mut_rb, projection=proj_ok, effective=rb_ok['effective_export']['records'])

        for field_name in ('instances', 'mapping_policy'):
            mut_proj = deepcopy(proj_ok)
            mut_proj['accounts'][0]['configuration_revision'][field_name] = True
            with self.assertRaisesRegex(validator.AuthorityError, '^projection_revision_invalid$'):
                _prepare_bundle(readback=rb_ok, projection=mut_proj, effective=rb_ok['effective_export']['records'])

    def test_js_preparer_and_python_cli_emit_raw_identifiers_separately(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('node not available')
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            obs_file = tmp / 'do_obs.json'
            roster_file = tmp / 'roster.json'
            bindings_file = tmp / 'obs.json'
            artifact_file = tmp / 'artifact.json'
            selection_file = tmp / 'selection.json'
            raw_ids_file = tmp / 'raw_ids.json'
            js_script = f"""
import {{ writeFile }} from "node:fs/promises";
const ROOT = {json.dumps(ROOT.as_uri() + "/")};
const harness = await import(new URL("tests/helpers/account_management_harness.mjs", ROOT));
const {{ collectInventory, instanceStateRow }} = await import(new URL("tests/helpers/account_identity_inventory_collect.mjs", ROOT));
const store = await harness.baselineStore();
try {{
  const inventory = (await collectInventory({{ statements: [instanceStateRow(harness.INSTANCE_REVISION, harness.INSTANCES)] }})).private;
  const applied = store.db.prepare("SELECT * FROM account_management_applied ORDER BY platform, account_key").all();
  const nowIso = new Date(Date.now() + 1000).toISOString();
  const obs = {{
    observed_at: nowIso,
    instance_revision: harness.INSTANCE_REVISION,
    instances: harness.INSTANCES,
    policy: harness.policyOf(harness.FIXTURE_ACCOUNTS),
    applied_rows: applied,
    inventory,
    collection: {{ observedAt: nowIso, sourceRef: "inventory_export:synthetic-b3" }},
    enrollment_links: {json.dumps(FIXTURE['enrollment_links'])},
  }};
  await writeFile({json.dumps(str(obs_file))}, JSON.stringify(obs));
}} finally {{
  store.close();
}}
"""
            proc = subprocess.run([node, '--input-type=module', '-e', js_script],
                                  capture_output=True, text=True, timeout=30)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            obs_payload = json.loads(obs_file.read_text(encoding='utf-8'))
            roster_rows = _legacy_roster()
            roster_rows.append({'platform_id': 'schwab', 'opaque_account_uid': 'InvalidRowPrivateLoc'})
            roster_file.write_text(json.dumps(roster_rows), encoding='utf-8')
            bindings_file.write_text(json.dumps(_observation_bindings(CORPUS['scenarios']['all_on'])), encoding='utf-8')
            out = io.StringIO()
            with redirect_stdout(out):
                rc = preparer.main([
                    'prepare-mapping',
                    '--do-observation', str(obs_file),
                    '--legacy-roster', str(roster_file),
                    '--observation-bindings', str(bindings_file),
                    '--source', SOURCE,
                    '--version', 'v1', '--membership-version', 'm1', '--label-version', 'l1', '--link-version', 'k1',
                    '--prepared-at', obs_payload['observed_at'],
                    '--artifact-output', str(artifact_file),
                    '--selection-output', str(selection_file),
                    '--raw-identifiers-output', str(raw_ids_file),
                ])
            self.assertEqual(rc, 0, out.getvalue())
            self.assertIn('digest_mapping_prepared', out.getvalue())
            raw_ids = json.loads(raw_ids_file.read_text(encoding='utf-8'))
            self.assertIn('InvalidRowPrivateLoc', raw_ids['raw_identifiers'])
            self.assertEqual(
                json.loads(selection_file.read_text(encoding='utf-8'))['artifact_sha256'],
                hashlib.sha256(artifact_file.read_bytes()).hexdigest(),
            )


if __name__ == '__main__':
    unittest.main()
