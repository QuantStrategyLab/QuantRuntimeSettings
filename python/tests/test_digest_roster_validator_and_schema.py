"""Slice 1 tests: closed v1 schema, FLAG-4 canonical validator, constructor modes, and D3-P2."""
from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
import unittest
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

try:
    import jsonschema
except ImportError:  # pragma: no cover
    jsonschema = None

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python' / 'scripts'))
sys.path.insert(0, str(ROOT / 'python' / 'tests'))

import cloud_run_daily_digest as app  # noqa: E402
import digest_roster_validator as validator  # noqa: E402

CORPUS = json.loads((ROOT / 'python/tests/fixtures/digest_roster_b2_corpus.json').read_text(encoding='utf-8'))
FIXTURE = json.loads((ROOT / 'tests/fixtures/account-mapping-roster.synthetic.json').read_text(encoding='utf-8'))


def _sample_available_envelope(readback=None):
    rb = deepcopy(readback or CORPUS['scenarios']['all_on'])
    accounts = []
    for group in rb['groups']:
        pairs = [(d['platform'], d['key']) for d in group['deployments']]
        gid = validator.certify_group_identity(pairs)
        accounts.append({
            'group_id': gid,
            'platform': pairs[0][0],
            'account_key': pairs[0][1],
            'deployments': [{'platform': p, 'legacy_key': k} for p, k in pairs],
            'labels': [],
            'scope': group['scope'],
            'management_class': group['management_class'],
            'management_status': group['management_status'],
            'evidence_state': group['evidence_state'],
            'processing_eligible': group['processing_eligible'],
            'processing_denial': group['processing_denial'],
            'reasons': list(group['reasons']),
            'applied': deepcopy(group['applied']),
            'legacy_run_bindings': [],
            'observation_bindings': [],
        })
    doc = {
        'format': validator.ROSTER_FORMAT,
        'schema_version': validator.ROSTER_FORMAT,
        'status': validator.STATUS_AVAILABLE,
        'run_id': '2026-11-20/07:00',
        'run_scope': {
            'namespace': 'prod:synthetic-enrollment:synthetic_context:syn-scope',
            'enrollment_source': 'synthetic-enrollment',
            'config_context': 'synthetic_context',
            'recipient_scope': 'syn-scope',
            'report_date': '2026-11-20',
            'original_slot': '07:00',
            'preview': False,
        },
        'generation_id': 'gen-0001',
        'source_revision': {
            'instance_revision': rb['instance_revision'],
            'policy_revision': rb['policy_revision'],
        },
        'source_snapshot_at': rb['observed_at'],
        'generated_at': '2026-11-19T23:00:30.000Z',
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
            'initial_read_at': '2026-11-19T23:00:10.000Z',
            'confirming_read_at': '2026-11-19T23:00:25.000Z',
            'initial_snapshot_at': rb['observed_at'],
            'confirming_snapshot_at': rb['observed_at'],
            'confirmation_outcome': 'confirmed',
        },
        'selection': {
            'source': 'synthetic-enrollment',
            'version': 'v1',
            'artifact_sha256': 'a' * 64,
            'membership_version': 'm1',
            'label_version': 'l1',
            'link_version': 'k1',
        },
        'prepared_at': rb['observed_at'],
        'enrollment_observed_at': rb['observed_at'],
        'physical_grouping_complete': True,
        'failure_code': None,
        'failure_kind': None,
        'account_count': len(accounts),
        'counts': {
            'physical_accounts': rb['counts']['physical_accounts'],
            'display_groups': len(accounts),
            'display_deployments': rb['counts']['display_deployments'],
            'uncovered_deployments': rb['counts']['uncovered_deployments'],
            'managed': rb['counts']['managed'],
            'management_disabled': rb['counts']['management_disabled'],
            'not_under_management': rb['counts']['not_under_management'],
            'unknown': rb['counts']['unknown'],
        },
        'accounts': accounts,
        'uncovered_deployments': [],
        'rejected': {},
    }
    doc['content_hash'] = validator.compute_content_hash(doc)
    return doc


def _sample_fallback_envelope(available_doc):
    fallback_accounts = [
        {
            'group_id': acc['group_id'],
            'platform': acc['platform'],
            'account_key': acc['account_key'],
            'deployments': deepcopy(acc['deployments']),
            'labels': [],
            'scope': acc['scope'],
            'management_class': None,
            'management_status': 'unknown',
            'evidence_state': 'unknown',
            'processing_eligible': False,
            'processing_denial': 'management_status_unknown',
            'reasons': ['management_read_denied'],
            'applied': None,
            'legacy_run_bindings': [],
            'observation_bindings': [],
        }
        for acc in available_doc['accounts']
    ]
    doc = {
        'format': validator.ROSTER_FORMAT,
        'schema_version': validator.ROSTER_FORMAT,
        'status': validator.STATUS_FALLBACK,
        'run_id': available_doc['run_id'],
        'run_scope': deepcopy(available_doc['run_scope']),
        'generation_id': None,
        'source_revision': None,
        'source_snapshot_at': available_doc['source_snapshot_at'],
        'generated_at': None,
        'generation_window': deepcopy(available_doc['generation_window']),
        'observation_age_seconds': 120.0,
        'live_source': validator.MANAGEMENT_ROUTE,
        'evidence_scope': validator.EVIDENCE_SCOPE,
        'acquisition': None,
        'selection': None,
        'prepared_at': None,
        'enrollment_observed_at': None,
        'physical_grouping_complete': False,
        'failure_code': 'management_read_denied',
        'failure_kind': validator.UNAVAILABLE,
        'account_count': len(fallback_accounts),
        'counts': {
            'physical_accounts': None,
            'display_groups': len(fallback_accounts),
            'display_deployments': available_doc['counts']['display_deployments'],
            'uncovered_deployments': 0,
            'managed': None,
            'management_disabled': None,
            'not_under_management': None,
            'unknown': None,
        },
        'accounts': fallback_accounts,
        'uncovered_deployments': [],
        'rejected': {},
    }
    doc['content_hash'] = validator.compute_content_hash(doc)
    return doc


def _sample_unavailable_envelope(run_id='2026-11-20/07:00', run_scope=None):
    doc = {
        'format': validator.ROSTER_FORMAT,
        'schema_version': validator.ROSTER_FORMAT,
        'status': validator.STATUS_UNAVAILABLE,
        'run_id': run_id,
        'run_scope': run_scope,
        'generation_id': None,
        'source_revision': None,
        'source_snapshot_at': None,
        'generated_at': None,
        'generation_window': None,
        'observation_age_seconds': None,
        'live_source': validator.MANAGEMENT_ROUTE,
        'evidence_scope': validator.EVIDENCE_SCOPE,
        'acquisition': None,
        'selection': None,
        'prepared_at': None,
        'enrollment_observed_at': None,
        'physical_grouping_complete': False,
        'failure_code': 'management_read_unavailable',
        'failure_kind': validator.UNAVAILABLE,
        'account_count': 0,
        'counts': {
            'physical_accounts': None,
            'display_groups': 0,
            'display_deployments': 0,
            'uncovered_deployments': 0,
            'managed': None,
            'management_disabled': None,
            'not_under_management': None,
            'unknown': None,
        },
        'accounts': [],
        'uncovered_deployments': [],
        'rejected': {},
    }
    doc['content_hash'] = validator.compute_content_hash(doc)
    return doc


class CanonicalValidatorAndSchemaTests(unittest.TestCase):
    def test_closed_schemas_validate_available_fallback_and_unavailable_forms(self):
        self.assertIsNotNone(jsonschema, 'jsonschema must be installed')
        schemas = validator.verify_packaged_schemas()
        self.assertEqual(set(schemas), set(validator.SCHEMA_FILES))
        for schema in schemas.values():
            jsonschema.Draft202012Validator.check_schema(schema)
        roster_schema = schemas['qsl-digest-account-roster.v1.schema.json']

        avail = _sample_available_envelope()
        fallback = _sample_fallback_envelope(avail)
        unavail = _sample_unavailable_envelope()

        for doc in (avail, fallback, unavail):
            jsonschema.validate(doc, roster_schema)
            validator.validate_roster_envelope(doc)

        # Authority rule (B4 fact 1): format match AND status == "available".
        self.assertEqual(avail['format'], 'qsl_digest_account_roster.v1')
        self.assertEqual(avail['status'], 'available')
        self.assertEqual(fallback['status'], 'fallback')
        self.assertEqual(unavail['status'], 'unavailable')

    def test_row_02_tampering_rejects_with_bounded_codes_and_schema(self):
        doc = _sample_available_envelope()
        roster_schema = validator.load_roster_schema()

        # Unsupported version/format
        bad_format = {**doc, 'format': 'qsl_digest_account_roster.v2'}
        bad_format['content_hash'] = validator.compute_content_hash(bad_format)
        with self.assertRaisesRegex(validator.AuthorityError, '^roster_format_unsupported$'):
            validator.validate_roster_envelope(bad_format)
        self.assertFalse(jsonschema.Draft202012Validator(roster_schema).is_valid(bad_format))

        # Wrong root, wrong group/list type, bad status, unknown field, omitted time, unauthenticated scope,
        # inconsistent declared count, hash tamper
        mutators = [
            (lambda d: d.__setitem__('accounts', {}), 'roster_shape_invalid'),
            (lambda d: d['accounts'][0].__setitem__('management_status', 'enabled'), 'roster_group_invalid'),
            (lambda d: d.__setitem__('unknown_authority_field', 1), 'roster_shape_invalid'),
            (lambda d: d.pop('source_snapshot_at'), 'roster_shape_invalid'),
            (lambda d: d['source_revision'].pop('policy_revision'), 'roster_revision_invalid'),
            (lambda d: d.__setitem__('live_source', '/api/unauthenticated/export'), 'roster_scope_invalid'),
            (lambda d: d.__setitem__('account_count', 9), 'roster_counts_inconsistent'),
            (lambda d: d['counts'].__setitem__('managed', 10), 'roster_counts_inconsistent'),
            (lambda d: d.__setitem__('content_hash', '0' * 64), 'roster_hash_mismatch'),
        ]
        for mutate, expected_code in mutators:
            tampered = deepcopy(doc)
            mutate(tampered)
            if expected_code != 'roster_hash_mismatch' and 'content_hash' in tampered and expected_code != 'roster_shape_invalid':
                tampered['content_hash'] = validator.compute_content_hash(tampered)
            with self.subTest(expected_code=expected_code):
                with self.assertRaisesRegex(validator.AuthorityError, f'^{expected_code}$'):
                    validator.validate_roster_envelope(tampered)

        with self.assertRaisesRegex(validator.AuthorityError, '^duplicate_json_key$'):
            validator.validate_roster_envelope(
                '{"format":"qsl_digest_account_roster.v1","format":"qsl_digest_account_roster.v1"}'
            )
        with self.assertRaisesRegex(validator.AuthorityError, '^roster_shape_invalid$'):
            validator.validate_roster_envelope('[]')

        # Status-specific closed schema & validator parity checks (available/fallback/unavailable).
        avail_bad = deepcopy(doc)
        avail_bad['source_revision'] = None
        avail_bad['content_hash'] = validator.compute_content_hash(avail_bad)
        self.assertFalse(jsonschema.Draft202012Validator(roster_schema).is_valid(avail_bad))
        with self.assertRaisesRegex(validator.AuthorityError, '^roster_shape_invalid$'):
            validator.validate_roster_envelope(avail_bad)

        fallback_bad = _sample_fallback_envelope(doc)
        fallback_bad['accounts'] = []
        fallback_bad['account_count'] = 0
        fallback_bad['counts']['display_groups'] = 0
        fallback_bad['counts']['display_deployments'] = 0
        fallback_bad['content_hash'] = validator.compute_content_hash(fallback_bad)
        self.assertFalse(jsonschema.Draft202012Validator(roster_schema).is_valid(fallback_bad))
        with self.assertRaisesRegex(validator.AuthorityError, '^roster_shape_invalid$'):
            validator.validate_roster_envelope(fallback_bad)

        unavail_bad = _sample_unavailable_envelope()
        unavail_bad['source_snapshot_at'] = doc['source_snapshot_at']
        unavail_bad['content_hash'] = validator.compute_content_hash(unavail_bad)
        self.assertFalse(jsonschema.Draft202012Validator(roster_schema).is_valid(unavail_bad))
        with self.assertRaisesRegex(validator.AuthorityError, '^roster_shape_invalid$'):
            validator.validate_roster_envelope(unavail_bad)

        bad_run_id = deepcopy(doc)
        bad_run_id['run_id'] = '2026-11-20/07:00/attempt-2'
        bad_run_id['content_hash'] = validator.compute_content_hash(bad_run_id)
        with self.assertRaisesRegex(validator.AuthorityError, '^roster_scope_invalid$'):
            validator.validate_roster_envelope(bad_run_id)

    def test_flag4_validator_is_independent_of_cloud_entry_and_preparer(self):
        source = (ROOT / 'python/scripts/digest_roster_validator.py').read_text(encoding='utf-8')
        tree = ast.parse(source)
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split('.')[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split('.')[0])
        forbidden = {
            'cloud_run_daily_digest', 'daily_digest_aggregator', 'account_daily_digest',
            'account_daily_facts', 'project_digest_display_roster', 'digest_roster_generation',
            'digest_roster_publication', 'urllib',
        }
        self.assertEqual(imported & forbidden, set())
        # Verify in an isolated Python subprocess that importing digest_roster_validator
        # does not pull in cloud_run_daily_digest or project_digest_display_roster.
        probe = (
            "import sys; sys.path.insert(0, sys.argv[1]); "
            "import digest_roster_validator; "
            "assert 'cloud_run_daily_digest' not in sys.modules; "
            "assert 'project_digest_display_roster' not in sys.modules; "
            "print('OK')"
        )
        proc = subprocess.run(
            [sys.executable, '-I', '-c', probe, str(ROOT / 'python' / 'scripts')],
            capture_output=True, text=True, check=True, timeout=15,
        )
        self.assertEqual(proc.stdout.strip(), 'OK')


class ConstructorPlumbingTests(unittest.TestCase):
    def test_constructor_supports_mapping_mode_and_preserves_legacy_array_mode(self):
        boot_json = json.dumps({
            'mode': 'mapping_v1',
            'origin': 'https://console.example.invalid',
            'service_auth': {'issuer': 'syn-iss', 'audience': 'syn-aud', 'subjects': ['syn-sub']},
            'enrollment_source': 'synthetic-enrollment',
            'config_context': 'synthetic_context',
            'read_timeout': 10.0,
        })
        env = {
            'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true',
            'DIGEST_DELIVERY_ENABLED': 'false',
            'DIGEST_SCHEDULER_JOB_NAME': 'projects/synthetic/locations/synthetic/jobs/daily-digest',
            'DIGEST_RECIPIENT_SCOPE': 'syn-scope',
            'DIGEST_CUTOVER_REPORT_DATE': '2026-11-20',
            'DIGEST_ROSTER_BOOT_JSON': boot_json,
        }
        with patch.dict(os.environ, env, clear=True):
            cfg = app.Configuration.from_environment()
        self.assertTrue(cfg.is_mapping_mode)
        self.assertEqual(cfg.expected, [])
        self.assertEqual(cfg.roster_boot.enrollment_source, 'synthetic-enrollment')

        # Passing a v1 roster document into legacy array mode must reject before array parser.
        v1_doc = _sample_available_envelope()
        with self.assertRaisesRegex(ValueError, '^digest_roster_mode_required$'):
            app.Configuration(v1_doc, 'projects/p/locations/l/jobs/j', 'syn-scope', '2026-11-20')

        # Legacy array duplicate still rejects at constructor (B3-15 control).
        row = {
            'platform_id': 'ibkr', 'candidate_slot': 'syn-slot-01',
            'opaque_account_uid': 'uid:a', 'target_id': 'syn-run-01', 'strategy_profile': 'syn_profile',
        }
        with self.assertRaisesRegex(ValueError, '^digest_duplicate_target_binding$'):
            app.Configuration([row, dict(row)], 'projects/p/locations/l/jobs/j', 'syn-scope', '2026-11-20')

        # Legacy array mode still works unchanged.
        legacy_cfg = app.Configuration([row], 'projects/p/locations/l/jobs/j', 'syn-scope', '2026-11-20')
        self.assertFalse(legacy_cfg.is_mapping_mode)
        self.assertEqual(len(legacy_cfg.expected), 1)

        # Conflicting DIGEST_ROSTER_BOOT_JSON and DIGEST_ROSTER_MODE must reject.
        with patch.dict(os.environ, {**env, 'DIGEST_ROSTER_MODE': 'legacy'}, clear=True):
            with self.assertRaisesRegex(ValueError, '^digest_roster_mode_invalid$'):
                app.Configuration.from_environment()


class D3P2BooleanRevisionTests(unittest.TestCase):
    """RESCOPE §11 item 5 / D3-P2: boolean True mutated onto embedded revisions where integer 1 agrees."""

    @staticmethod
    def _rev1_readback_and_projection():
        rb = deepcopy(CORPUS['scenarios']['all_on'])
        rb['instance_revision'] = 1
        rb['policy_revision'] = 1
        rb['effective_export']['instance_revision'] = 1
        rb['effective_export']['policy_revision'] = 1

        proj = deepcopy(CORPUS['preparations']['complete']['projection'])
        for acct in proj['accounts']:
            acct['configuration_revision']['instances'] = 1
            acct['configuration_revision']['mapping_policy'] = 1
        return rb, proj

    def test_d3_p2_boolean_true_embedded_revisions_rejected_before_equality_vs_integer_1(self):
        rb_ok, proj_ok = self._rev1_readback_and_projection()

        # Positive control: genuine integer 1 passes both readback and projection checks.
        live = validator.validate_readback(rb_ok)
        self.assertEqual((live.instance_revision, live.policy_revision), (1, 1))
        accounts = validator.validate_projection_revisions(proj_ok, live.instance_revision, live.policy_revision)
        self.assertEqual(len(accounts), 10)

        # Mutate embedded effective_export.instance_revision and policy_revision separately to boolean True.
        for field_name in ('instance_revision', 'policy_revision'):
            with self.subTest(surface='effective_export', field=field_name):
                mutated = deepcopy(rb_ok)
                mutated['effective_export'][field_name] = True
                self.assertEqual(mutated['effective_export'][field_name] == 1, True)
                with self.assertRaisesRegex(validator.AuthorityError, '^readback_revision_invalid$'):
                    validator.validate_readback(mutated)

        # Mutate embedded projection configuration_revision.instances and mapping_policy separately to boolean True.
        for field_name in ('instances', 'mapping_policy'):
            with self.subTest(surface='projection', field=field_name):
                mutated_proj = deepcopy(proj_ok)
                mutated_proj['accounts'][0]['configuration_revision'][field_name] = True
                self.assertEqual(mutated_proj['accounts'][0]['configuration_revision'][field_name] == 1, True)
                with self.assertRaisesRegex(validator.AuthorityError, '^projection_revision_invalid$'):
                    validator.validate_projection_revisions(mutated_proj, 1, 1)


if __name__ == '__main__':
    unittest.main()
