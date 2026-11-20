"""Slice 5 tests: RESCOPE §9 compatibility register, status suppression, and §11 item 9 label fixtures."""
from __future__ import annotations

import json
import sys
import unittest
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python' / 'scripts'))
sys.path.insert(0, str(ROOT / 'python' / 'tests'))

import digest_roster_authority as authority  # noqa: E402
import digest_roster_compatibility as compat  # noqa: E402
import digest_roster_validator as validator  # noqa: E402
import project_digest_display_roster as preparer  # noqa: E402
from test_digest_roster_identity_and_ownership import (  # noqa: E402
    FIXTURE,
    _instances,
    _legacy_roster,
    _prepare_bundle,
)
from test_digest_roster_validator_and_schema import _sample_available_envelope  # noqa: E402


def _all_general_text(presentation: compat.HistoricalPresentation) -> str:
    return '\n'.join([
        *presentation.headers,
        json.dumps(presentation.general_envelope, ensure_ascii=False),
        json.dumps(presentation.log_record, ensure_ascii=False),
        json.dumps(presentation.receipt_record, ensure_ascii=False),
        json.dumps(presentation.preview_record, ensure_ascii=False),
    ])


class CompatibilityRegisterAndLabelSafetyTests(unittest.TestCase):
    def test_strict_current_acceptance_never_repairs_invalid_or_non_available_envelopes(self):
        avail = _sample_available_envelope()
        self.assertEqual(compat.accept_current_roster(avail)['status'], 'available')

        # Non-available (fallback / unavailable) and tampered envelopes reject strictly.
        for bad_status in ('fallback', 'unavailable'):
            doc = deepcopy(avail)
            doc['status'] = bad_status
            doc['content_hash'] = validator.compute_content_hash(doc)
            with self.assertRaises(validator.AuthorityError):
                compat.accept_current_roster(doc)

        legacy_shape = {'format': 'qsl_digest_account_roster.v1', 'generation_status': 'current', 'groups': []}
        with self.assertRaisesRegex(validator.AuthorityError, '^roster_shape_invalid$'):
            compat.accept_current_roster(json.dumps(legacy_shape))

    def test_item9_legacy_fallback_empty_bindings_with_private_locator_suppressed_in_both_locales(self):
        private_locator = 'SYN-PRIV-LOC-EMPTY-991'
        fallback_doc = {
            'format': 'qsl_digest_account_roster.v1',
            'generation_status': 'fallback',
            'observed_at': '2026-11-19T23:00:00Z',
            'accounts': [
                {
                    'deployments': [{'platform': 'ibkr', 'legacy_key': 'syn-acct-02'}],
                    'labels': [{'platform': 'ibkr', 'legacy_key': 'syn-acct-02', 'label': private_locator}],
                    'account_label': private_locator,
                    'management_status': 'managed',
                    'evidence_state': 'known',
                    'legacy_run_bindings': [],
                    'observation_bindings': [],
                },
                {
                    'deployments': [{'platform': 'schwab', 'legacy_key': 'syn-acct-05'}],
                    'labels': [{'platform': 'schwab', 'legacy_key': 'syn-acct-05', 'label': 'SecondOldLbl'}],
                    'management_status': 'management_disabled',
                    'evidence_state': 'known',
                    'legacy_run_bindings': [],
                    'observation_bindings': [],
                },
            ],
        }
        raw_bytes = json.dumps(fallback_doc, ensure_ascii=False).encode('utf-8')

        # Current acceptance must reject it.
        with self.assertRaises(validator.AuthorityError):
            compat.accept_current_roster(raw_bytes)

        reg = compat.HistoricalExceptionRegister()
        entry = reg.register_historical_artifact(
            raw_bytes,
            exception_class='legacy_fallback_empty_bindings',
            reason_for_exception='legacy_fallback_retained_for_audit',
        )
        # Exact seven register fields required by RESCOPE §9 item 2.
        self.assertEqual(tuple(entry.as_dict()), compat.EXCEPTION_ENTRY_FIELDS)
        self.assertEqual(entry.permitted_usage, ('historical_inspection_only',))
        self.assertIn('label_safety_unproven_empty_bindings', entry.known_validation_failures)
        self.assertIn('unsupported_legacy_status_claim', entry.known_validation_failures)
        # Display-label safety and management-status authority recorded separately (§9 item 4).
        self.assertFalse(entry.label_and_status_trust['display_labels_safe'])
        self.assertFalse(entry.label_and_status_trust['management_status_authoritative'])
        self.assertFalse(entry.label_and_status_trust['verified'])
        self.assertNotIn(private_locator, json.dumps(entry.as_dict(), ensure_ascii=False))

        # Raw historical record retains the private locator for registered historical inspection only.
        raw_inspected = reg.inspect_raw_historical_record(
            entry.identity, purpose=compat.HISTORICAL_INSPECTION_ONLY,
        )
        self.assertIn(private_locator, raw_inspected.decode('utf-8'))

        # All non-historical purposes are forbidden.
        for bad_purpose in compat.FORBIDDEN_HISTORICAL_PURPOSES:
            with self.assertRaisesRegex(validator.AuthorityError, '^historical_usage_forbidden$'):
                reg.inspect_raw_historical_record(entry.identity, purpose=bad_purpose)
            with self.assertRaisesRegex(validator.AuthorityError, '^historical_usage_forbidden$'):
                reg.authorize_operational_use(entry.identity, operation=bad_purpose)

        # Final headers & all general outputs in both locales have ZERO occurrences of private_locator,
        # use bounded neutral headers, and suppress unsupported status claims.
        for locale, expected_neutral, expected_status in (
            ('en', ('Account 1', 'Account 2'), 'Quant management status unknown'),
            ('zh', ('账户 1', '账户 2'), '量化管理状态未知'),
        ):
            with self.subTest(locale=locale):
                pres = reg.present_historical(entry.identity, locale=locale)
                self.assertEqual(pres.neutral_labels, expected_neutral)
                self.assertEqual(pres.suppressed_status_code, 'unknown')
                self.assertFalse(pres.verified)
                all_text = _all_general_text(pres)
                self.assertNotIn(private_locator, all_text)
                self.assertNotIn('SecondOldLbl', all_text)
                self.assertIn(expected_neutral[0], all_text)
                self.assertIn(expected_status, all_text)
                self.assertNotIn('Under quant management', all_text)
                self.assertNotIn('已纳入量化管理', all_text)

    def test_item9_selected_prep_only_artifact_with_private_locator_suppressed_in_both_locales(self):
        private_locator = 'SYN-PRIV-PREP-77402'
        prep_only_doc = {
            'format': 'qsl_digest_enrollment_artifact.v1',
            'source': 'synthetic-enrollment',
            'version': 'legacy-v0',
            'membership_version': 'm0',
            'label_version': 'l0',
            'link_version': 'k0',
            'prepared_at': '2026-11-18T00:00:00Z',
            'enrollment_observed_at': '2026-11-18T00:00:00Z',
            'instance_revision': 10,
            'policy_revision': 1,
            'groups': [
                {
                    'deployments': [['ibkr', 'syn-acct-02']],
                    'labels': [['ibkr', 'syn-acct-02', private_locator]],
                    'legacy_run_bindings': [
                        {
                            'platform_id': 'ibkr',
                            'candidate_slot': 'syn-slot-02',
                            'opaque_account_uid': private_locator,
                            'target_id': 'syn-run-02',
                            'strategy_profile': 'syn_profile_2',
                        },
                    ],
                    'observation_bindings': [],
                },
            ],
            'rejected': {},
        }
        raw_bytes = json.dumps(prep_only_doc, ensure_ascii=False).encode('utf-8')

        # Strict artifact validation rejects private locator as label.
        with self.assertRaisesRegex(validator.AuthorityError, '^enrollment_artifact_invalid$'):
            compat.accept_current_enrollment_artifact(raw_bytes)

        # Even if affirmative_safe_labels=True was claimed without source bytes (or on prep-only class),
        # lack of source bytes is insufficient evidence -> labels stay suppressed!
        reg = compat.HistoricalExceptionRegister()
        entry = reg.register_historical_artifact(
            raw_bytes,
            exception_class='legacy_selected_prep_only_labels',
            affirmative_safe_labels=True,
            affirmative_source_bytes=None,
        )
        self.assertFalse(entry.label_and_status_trust['display_labels_safe'])
        self.assertFalse(entry.label_and_status_trust['management_status_authoritative'])
        self.assertEqual(
            entry.label_and_status_trust['label_safety_evidence'],
            'prep_only_match_without_source_bytes',
        )

        # Raw record retains the private locator for historical inspection only.
        raw_inspected = reg.inspect_raw_historical_record(
            entry.identity, purpose=compat.HISTORICAL_INSPECTION_ONLY,
        )
        self.assertIn(private_locator, raw_inspected.decode('utf-8'))

        # Neutral headers must not depend on hidden label contents.
        alt_doc = deepcopy(prep_only_doc)
        alt_doc['groups'][0]['labels'][0][2] = 'SYN-PRIV-DIFFERENT-999'
        alt_entry = reg.register_historical_artifact(
            json.dumps(alt_doc).encode('utf-8'),
            exception_class='legacy_selected_prep_only_labels',
        )

        for locale, expected_lbl in (('en', 'Account 1'), ('zh', '账户 1')):
            with self.subTest(locale=locale):
                pres = reg.present_historical(entry.identity, locale=locale)
                alt_pres = reg.present_historical(alt_entry.identity, locale=locale)
                self.assertEqual(pres.headers, alt_pres.headers)
                self.assertEqual(pres.neutral_labels, (expected_lbl,))
                all_text = _all_general_text(pres)
                self.assertNotIn(private_locator, all_text)
                self.assertIn(expected_lbl, all_text)

    def test_item9_head_generated_f08_case_current_rejection_and_historical_only_use(self):
        # F08 case (RESCOPE §9 item 5, first class; §11 item 9):
        # Head-generated / PR #1211-era envelope from digest-matched bytes whose bindings
        # fail the current contract (e.g. observation_identity_unenrolled + PR #1211 envelope shape).
        bundle = _prepare_bundle()
        bad_artifact = json.loads(bundle.artifact_bytes)
        # Inject an observation binding with an unenrolled opaque_account_uid (F08 class).
        bad_artifact['groups'][0]['observation_bindings'] = [{
            'binding_id': 'obs-f08',
            'platform': bad_artifact['groups'][0]['deployments'][0][0],
            'legacy_key': bad_artifact['groups'][0]['deployments'][0][1],
            'opaque_account_uid': 'uid:SYN-F08-UNENROLLED',
            'broker_environment': 'live',
            'account_scope': 'account',
        }]
        bad_art_bytes = json.dumps(bad_artifact).encode('utf-8')
        with self.assertRaisesRegex(validator.AuthorityError, '^observation_identity_unenrolled$'):
            compat.accept_current_enrollment_artifact(bad_art_bytes)

        # Also test a PR #1211-era roster envelope shape carrying contract-invalid bindings.
        pr1211_doc = {
            'format': 'qsl_digest_account_roster.v1',
            'generation_status': 'current',
            'observed_at': '2026-11-19T23:00:00Z',
            'decided_at': '2026-11-19T23:00:10Z',
            'observation_age_seconds': 10.0,
            'live_source': '/api/admin/account-management',
            'evidence_scope': 'runtime_instances_sqlite',
            'instance_revision': 41,
            'policy_revision': 3,
            'physical_grouping_complete': True,
            'counts': {'physical_accounts': 1, 'display_groups': 1, 'display_deployments': 1,
                       'uncovered_deployments': 0, 'managed': 1, 'management_disabled': 0,
                       'not_under_management': 0, 'unknown': 0},
            'groups': [{
                'deployments': [{'platform': 'ibkr', 'legacy_key': 'syn-acct-02'}],
                'labels': [],
                'scope': 'live',
                'management_class': 'eligible',
                'management_status': 'managed',
                'evidence_state': 'known',
                'processing_eligible': True,
                'processing_denial': None,
                'reasons': [],
                'applied': {'management_enabled': True, 'revision': 1, 'effective_at': '2026-11-19T20:00:00Z'},
                'legacy_run_bindings': [],
                'observation_bindings': [{
                    'binding_id': 'obs-f08',
                    'platform': 'ibkr',
                    'legacy_key': 'syn-acct-02',
                    'opaque_account_uid': 'uid:SYN-F08-UNENROLLED',
                    'broker_environment': 'live',
                    'account_scope': 'account',
                }],
            }],
            'uncovered_deployments': [],
            'rejected': {},
        }
        pr1211_bytes = json.dumps(pr1211_doc).encode('utf-8')
        with self.assertRaises(validator.AuthorityError):
            compat.accept_current_roster(pr1211_bytes)

        reg = compat.HistoricalExceptionRegister()
        f08_entry = reg.register_historical_artifact(
            pr1211_bytes,
            exception_class='pr1211_contract_invalid_envelope',
            reason_for_exception='f08_pr1211_contract_invalid_bytes',
        )
        self.assertEqual(f08_entry.permitted_usage, ('historical_inspection_only',))
        self.assertFalse(f08_entry.label_and_status_trust['management_status_authoritative'])
        self.assertFalse(f08_entry.label_and_status_trust['verified'])
        # Historical inspection succeeds; operational uses reject.
        self.assertEqual(
            reg.inspect_raw_historical_record(f08_entry.identity, purpose=compat.HISTORICAL_INSPECTION_ONLY),
            pr1211_bytes,
        )
        for op in compat.FORBIDDEN_HISTORICAL_PURPOSES:
            with self.assertRaisesRegex(validator.AuthorityError, '^historical_usage_forbidden$'):
                reg.authorize_operational_use(f08_entry.identity, operation=op)

        # Positive control: a B3-conformant current envelope cannot be misregistered under F08 exception class.
        avail_bytes = json.dumps(_sample_available_envelope()).encode('utf-8')
        compat.accept_current_roster(avail_bytes)
        with self.assertRaisesRegex(ValueError, '^current_conformant_artifact_cannot_use_exception_register$'):
            reg.register_historical_artifact(avail_bytes, exception_class='pr1211_contract_invalid_envelope')

    def test_authorized_recipient_positive_control_and_prep_private_locator_suppression(self):
        # Original authorized recipient positive control in project_telegram_display_settings.
        rows = _instances()
        links = deepcopy(FIXTURE['enrollment_links'])
        ibkr_idx = 0
        for idx, row in enumerate(rows):
            if row['platform'] == 'ibkr':
                ibkr_idx += 1
                sel = f'U000100{ibkr_idx}'
                row['config']['account_selector'] = sel
                for lnk in links:
                    if lnk['platform_id'] == 'ibkr' and lnk['account_key'] == row['config']['key']:
                        lnk['config_identity']['account_selector'] = sel
            elif row['platform'] == 'longbridge':
                row['config']['label'] = row['config'].get('label') or 'sg'
            else:
                row['config']['label'] = f'Safe Account {idx + 1}'
        roster = _legacy_roster(links)
        management = {'initialized': True, 'instances': rows}
        settings = preparer.project_telegram_display_settings(roster, management, links, 'recipient-chat-1')
        ibkr_cfg = json.loads(settings['DIGEST_TELEGRAM_IBKR_ACCOUNT_IDS_JSON'])
        self.assertEqual(ibkr_cfg['recipient_id'], 'recipient-chat-1')
        self.assertGreater(len(ibkr_cfg['accounts']), 0)
        for item in ibkr_cfg['accounts']:
            self.assertNotIn(item['account_id'], settings['DIGEST_EXPECTED_TARGETS_JSON'])

        # Producer compatibility: placing a private locator on config.label strips it from artifact & general envelope.
        rows_leak = deepcopy(rows)
        first_link = links[0]
        target_row = next(
            r for r in rows_leak
            if r['platform'] == first_link['platform_id'] and r['config']['key'] == first_link['account_key']
        )
        private_id = first_link['target_id']
        target_row['config']['label'] = private_id
        bundle = _prepare_bundle(instance_rows=rows_leak)
        artifact = json.loads(bundle.artifact_bytes)
        all_labels = [item[2] for grp in artifact['groups'] for item in grp['labels']]
        self.assertNotIn(private_id, all_labels)
        self.assertEqual(artifact['rejected'].get('label_rejected'), 1)


if __name__ == '__main__':
    unittest.main()
