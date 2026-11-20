"""Slice 6 tests: FLAG-6 edge removal, shared recipient leaf, and B3-16 producer checks."""
from __future__ import annotations

import ast
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python' / 'scripts'))
sys.path.insert(0, str(ROOT / 'python' / 'tests'))

import cloud_run_daily_digest as app  # noqa: E402
import digest_roster_authority as authority  # noqa: E402
import digest_roster_recipient as recipient_leaf  # noqa: E402
import digest_roster_validator as validator  # noqa: E402
from test_digest_roster_identity_and_ownership import (  # noqa: E402
    FIXTURE,
    SOURCE,
    VERSIONS,
    _acquire,
    _prepare_bundle,
)

CORPUS = json.loads((ROOT / 'python/tests/fixtures/digest_roster_b2_corpus.json').read_text(encoding='utf-8'))


def _direct_imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding='utf-8'))
    mods = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods.update(alias.name.split('.')[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            mods.add(node.module.split('.')[0])
    return mods


class Flag6EdgeRemovalAndRoleClosureTests(unittest.TestCase):
    def test_authority_to_cloud_edge_is_removed_from_all_prep_modules(self):
        prep_or_shared = (
            'python/scripts/digest_roster_validator.py',
            'python/scripts/digest_roster_recipient.py',
            'python/scripts/digest_roster_compatibility.py',
            'python/scripts/digest_roster_authority.py',
            'python/scripts/project_digest_display_roster.py',
        )
        generation_only = {
            'cloud_run_daily_digest',
            'daily_digest_aggregator',
            'account_daily_digest',
            'account_daily_facts',
            'unified_daily_digest',
            'digest_roster_publication',
        }
        for rel in prep_or_shared:
            imported = _direct_imports(ROOT / rel)
            self.assertEqual(imported & generation_only, set(), f'{rel} must not import generation-only modules')

        # Isolated Python subprocess verifying importing the entire PREP Python stack
        # never loads cloud_run_daily_digest or any generation-only module into sys.modules.
        probe = (
            "import sys; sys.path.insert(0, sys.argv[1]); "
            "import project_digest_display_roster, digest_roster_authority, "
            "digest_roster_compatibility, digest_roster_recipient, digest_roster_validator; "
            "forbidden = {'cloud_run_daily_digest', 'daily_digest_aggregator', 'account_daily_digest', "
            "'account_daily_facts', 'unified_daily_digest', 'digest_roster_publication'}; "
            "assert not (set(sys.modules) & forbidden), sorted(set(sys.modules) & forbidden); "
            "print('PREP_CLOSURE_CLEAN')"
        )
        proc = subprocess.run(
            [sys.executable, '-I', '-c', probe, str(ROOT / 'python' / 'scripts')],
            capture_output=True, text=True, check=True, timeout=15,
        )
        self.assertEqual(proc.stdout.strip(), 'PREP_CLOSURE_CLEAN')

    def test_shared_recipient_leaf_has_minimal_dependencies_and_manifest_declaration(self):
        imported = _direct_imports(ROOT / 'python/scripts/digest_roster_recipient.py') - {'__future__'}
        self.assertEqual(imported, {'json', 'display_names'})
        manifest = json.loads((ROOT / 'python/scripts/digest_package_manifest.json').read_text(encoding='utf-8'))
        by_dest = {m['destination']: m for m in manifest['members']}
        leaf = by_dest['python/scripts/digest_roster_recipient.py']
        self.assertEqual(leaf['dependency_role'], 'both')
        self.assertEqual(leaf['imports'], ['display_names'])
        self.assertIn('digest_roster_recipient', by_dest['python/scripts/digest_roster_authority.py']['imports'])
        self.assertIn('digest_roster_recipient', by_dest['python/scripts/cloud_run_daily_digest.py']['imports'])


class Row16SharedRecipientPredicateTests(unittest.TestCase):
    def setUp(self):
        self.bundle = _prepare_bundle()
        self.sel = authority.EnrollmentSelection(SOURCE, **VERSIONS, artifact_sha256=self.bundle.artifact_sha256)
        self.art = authority.load_artifact(self.sel, authority.SourceRead(SOURCE, True, self.bundle.artifact_bytes))
        self.live = _acquire(CORPUS['scenarios']['all_on'])
        self.roster = authority.compose_generation(self.live, self.art)
        self.ibkr_bindings = [b for b in self.roster.run_bindings() if b['platform_id'] == 'ibkr']
        self.b0 = self.ibkr_bindings[0]
        self.b1 = self.ibkr_bindings[1]

    @staticmethod
    def _payload(recipient, accounts):
        return json.dumps({'recipient_id': recipient, 'accounts': accounts})

    def test_authorized_non_preview_positive_control_and_failure_matrix_on_both_callers(self):
        good_raw = self._payload('rcpt-ok', [{
            'candidate_slot': self.b0['candidate_slot'],
            'opaque_account_uid': self.b0['opaque_account_uid'],
            'target_id': self.b0['target_id'],
            'account_id': 'U1234567',
        }])
        expected_map = {self.b0['opaque_account_uid']: 'U1234567'}

        # Both callers (Cloud legacy entry + Authority generation_recipient_accounts) agree.
        self.assertEqual(app._ibkr_telegram_accounts(self.ibkr_bindings, good_raw, 'rcpt-ok'), expected_map)
        self.assertEqual(
            authority.generation_recipient_accounts(
                self.roster, good_raw, 'rcpt-ok',
                preview=False, trigger_provenance=recipient_leaf.AUTHORIZED_TRIGGER_PROVENANCE,
            ),
            expected_map,
        )

        # Preview or non-authorized sender provenance must yield empty map on generation path.
        self.assertEqual(
            authority.generation_recipient_accounts(
                self.roster, good_raw, 'rcpt-ok',
                preview=True, trigger_provenance=recipient_leaf.AUTHORIZED_TRIGGER_PROVENANCE,
            ),
            {},
        )
        for bad_prov in (None, '', 'cloud_scheduler', 'manual_dispatch', 'unknown'):
            self.assertEqual(
                authority.generation_recipient_accounts(
                    self.roster, good_raw, 'rcpt-ok',
                    preview=False, trigger_provenance=bad_prov,
                ),
                {},
            )

        # Both directions of conflicting ownership must empty the ENTIRE map (even with a valid entry present!).
        # Build a roster variant with distinct opaque_account_uids across the two IBKR sibling links
        # so both conflict directions exercise genuine distinct enrolled bindings.
        from copy import deepcopy
        from test_digest_roster_identity_and_ownership import _legacy_roster, _relink  # noqa: E402
        proj_d = deepcopy(CORPUS['preparations']['complete']['projection'])
        links_d = deepcopy(FIXTURE['enrollment_links'])
        roster_d = _legacy_roster(links_d)
        _relink(proj_d, links_d, roster_d, 1, opaque_account_uid='uid:SYN-Opaque/01-b==')
        bundle_d = _prepare_bundle(projection=proj_d, links=links_d, roster=roster_d)
        sel_d = authority.EnrollmentSelection(SOURCE, **VERSIONS, artifact_sha256=bundle_d.artifact_sha256)
        art_d = authority.load_artifact(sel_d, authority.SourceRead(SOURCE, True, bundle_d.artifact_bytes))
        gen_d = authority.compose_generation(self.live, art_d)
        ibkr_d = [b for b in gen_d.run_bindings() if b['platform_id'] == 'ibkr']
        d0, d1 = ibkr_d[0], ibkr_d[1]

        conflict_same_uid = self._payload('rcpt-ok', [
            {
                'candidate_slot': self.b0['candidate_slot'],
                'opaque_account_uid': self.b0['opaque_account_uid'],
                'target_id': self.b0['target_id'],
                'account_id': 'U1234567',
            },
            {
                'candidate_slot': self.b1['candidate_slot'],
                'opaque_account_uid': self.b0['opaque_account_uid'],
                'target_id': self.b1['target_id'],
                'account_id': 'U7654321',
            },
        ])
        conflict_same_account = self._payload('rcpt-ok', [
            {
                'candidate_slot': d0['candidate_slot'],
                'opaque_account_uid': d0['opaque_account_uid'],
                'target_id': d0['target_id'],
                'account_id': 'U1234567',
            },
            {
                'candidate_slot': d1['candidate_slot'],
                'opaque_account_uid': d1['opaque_account_uid'],
                'target_id': d1['target_id'],
                'account_id': 'U1234567',
            },
        ])

        bad_cases = [
            ('missing_recipient', self.ibkr_bindings, self.roster, good_raw, ''),
            ('wrong_recipient', self.ibkr_bindings, self.roster, good_raw, 'rcpt-wrong'),
            ('wrong_slot', self.ibkr_bindings, self.roster, self._payload('rcpt-ok', [{
                'candidate_slot': 'wrong-slot',
                'opaque_account_uid': self.b0['opaque_account_uid'],
                'target_id': self.b0['target_id'],
                'account_id': 'U1234567',
            }]), 'rcpt-ok'),
            ('wrong_uid', self.ibkr_bindings, self.roster, self._payload('rcpt-ok', [{
                'candidate_slot': self.b0['candidate_slot'],
                'opaque_account_uid': 'uid:wrong',
                'target_id': self.b0['target_id'],
                'account_id': 'U1234567',
            }]), 'rcpt-ok'),
            ('wrong_target', self.ibkr_bindings, self.roster, self._payload('rcpt-ok', [{
                'candidate_slot': self.b0['candidate_slot'],
                'opaque_account_uid': self.b0['opaque_account_uid'],
                'target_id': 'wrong-target',
                'account_id': 'U1234567',
            }]), 'rcpt-ok'),
            ('malformed_broker_id_masked', self.ibkr_bindings, self.roster, self._payload('rcpt-ok', [{
                'candidate_slot': self.b0['candidate_slot'],
                'opaque_account_uid': self.b0['opaque_account_uid'],
                'target_id': self.b0['target_id'],
                'account_id': '***67',
            }]), 'rcpt-ok'),
            ('malformed_broker_id_label', self.ibkr_bindings, self.roster, self._payload('rcpt-ok', [{
                'candidate_slot': self.b0['candidate_slot'],
                'opaque_account_uid': self.b0['opaque_account_uid'],
                'target_id': self.b0['target_id'],
                'account_id': 'live',
            }]), 'rcpt-ok'),
            ('conflict_one_uid_two_accounts', self.ibkr_bindings, self.roster, conflict_same_uid, 'rcpt-ok'),
            ('conflict_two_uids_one_account', ibkr_d, gen_d, conflict_same_account, 'rcpt-ok'),
        ]
        for label, bindings, gen_roster, raw, rcpt in bad_cases:
            with self.subTest(case=label):
                self.assertEqual(app._ibkr_telegram_accounts(bindings, raw, rcpt), {})
                self.assertEqual(
                    authority.generation_recipient_accounts(
                        gen_roster, raw, rcpt,
                        preview=False, trigger_provenance=recipient_leaf.AUTHORIZED_TRIGGER_PROVENANCE,
                    ),
                    {},
                )

    def test_no_expanded_permission_from_physical_grouping_or_observation_binding(self):
        # Empty run bindings with populated observation bindings cannot authorize any private IBKR ID.
        empty_run_bundle = _prepare_bundle(links=[], roster=[])
        sel = authority.EnrollmentSelection(SOURCE, **VERSIONS, artifact_sha256=empty_run_bundle.artifact_sha256)
        art = authority.load_artifact(sel, authority.SourceRead(SOURCE, True, empty_run_bundle.artifact_bytes))
        empty_roster = authority.compose_generation(self.live, art)
        self.assertEqual(empty_roster.run_bindings(), [])
        obs_only = next(
            b for g in empty_roster.groups for b in g.observation_bindings if b['platform'] == 'ibkr'
        )
        attempt = self._payload('rcpt-ok', [{
            'candidate_slot': obs_only['binding_id'],
            'opaque_account_uid': 'uid:SYN-Opaque/01==',
            'target_id': obs_only['binding_id'],
            'account_id': 'U1234567',
        }])
        self.assertEqual(
            authority.generation_recipient_accounts(
                empty_roster, attempt, 'rcpt-ok',
                preview=False, trigger_provenance=recipient_leaf.AUTHORIZED_TRIGGER_PROVENANCE,
            ),
            {},
        )
        # Non-GenerationRoster inputs are refused fail-closed.
        self.assertEqual(
            authority.generation_recipient_accounts(
                {'not': 'a_roster'}, attempt, 'rcpt-ok',
                preview=False, trigger_provenance=recipient_leaf.AUTHORIZED_TRIGGER_PROVENANCE,
            ),
            {},
        )


if __name__ == '__main__':
    unittest.main()
