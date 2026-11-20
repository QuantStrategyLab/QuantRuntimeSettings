"""Schema, envelope constructor, status-table parity and preparer CLI tests."""
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
from datetime import timedelta
from pathlib import Path

try:
    import jsonschema
except ImportError:
    jsonschema = None

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python' / 'scripts'))
sys.path.insert(0, str(ROOT / 'python' / 'tests'))

import digest_roster_authority as authority  # noqa: E402
import digest_roster_envelope as envelope  # noqa: E402
import digest_roster_generation as generation  # noqa: E402
import digest_roster_status_text as status_text  # noqa: E402
import digest_roster_support as support  # noqa: E402
import project_digest_display_roster as preparer  # noqa: E402


def _current_outcome():
    artifact_bytes, _ = support.prepare()
    source = support.SyntheticEnrollmentSource(artifact_bytes)
    client = authority.AcquisitionClient(
        support.BOOT, support.SyntheticAuth(),
        support.SyntheticTransport(support.ok(support.scenario('all_on')), support.ok(support.scenario('all_on'))),
    )
    clock = support.OBSERVED + timedelta(seconds=30)
    runner = generation.GenerationRunner(support.BOOT, client, source, lambda: clock, recipient_scope='syn-scope')
    return runner, runner.run(deadline=clock + timedelta(seconds=10))


@unittest.skipIf(jsonschema is None, 'jsonschema is not installed')
class ClosedSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validators = {}
        for name in envelope.SCHEMA_FILES:
            schema = envelope.load_roster_schema(name)
            jsonschema.Draft202012Validator.check_schema(schema)
            cls.validators[name] = jsonschema.Draft202012Validator(schema)

    def test_selection_and_artifact_schemas_accept_prepared_and_reject_tampering(self):
        artifact_bytes, digest = support.prepare()
        artifact = json.loads(artifact_bytes.decode('utf-8'))
        selection = {
            'format': authority.SELECTION_FORMAT,
            'source': support.SOURCE,
            **support.VERSIONS,
            'artifact_sha256': digest,
        }
        self.validators['qsl-digest-enrollment-selection.v1.schema.json'].validate(selection)
        self.validators['qsl-digest-enrollment-artifact.v1.schema.json'].validate(artifact)

        bad_selection = {**selection, 'format': 'qsl_digest_enrollment_selection.v2'}
        self.assertFalse(self.validators['qsl-digest-enrollment-selection.v1.schema.json'].is_valid(bad_selection))
        bad_artifact = {**artifact, 'extra_field': True}
        self.assertFalse(self.validators['qsl-digest-enrollment-artifact.v1.schema.json'].is_valid(bad_artifact))

    def test_roster_v1_envelope_current_fallback_unavailable_match_schema_and_validator(self):
        runner, current = _current_outcome()
        self.assertEqual(current.status, generation.CURRENT)
        current_doc = envelope.build_roster_envelope(current)
        self.validators['qsl-digest-account-roster.v1.schema.json'].validate(current_doc)
        self.assertEqual(current_doc['counts']['physical_accounts'], 10)
        self.assertEqual(current_doc['counts']['managed'], 9)
        self.assertEqual(current_doc['counts']['not_under_management'], 1)

        # Fallback: denied read keeps dated display headers with unknown management and null revisions/counts.
        failing_client = authority.AcquisitionClient(
            support.BOOT, support.SyntheticAuth(),
            support.SyntheticTransport((403, support.OK_HEADERS, b'{}')),
        )
        fallback_runner = generation.GenerationRunner(
            support.BOOT, failing_client, support.SyntheticEnrollmentSource(support.prepare()[0]),
            lambda: support.OBSERVED + timedelta(seconds=120),
            snapshots=runner.snapshots, recipient_scope='syn-scope',
        )
        fallback = fallback_runner.run(deadline=support.OBSERVED + timedelta(seconds=130))
        self.assertEqual(fallback.status, generation.FALLBACK)
        fallback_doc = envelope.build_roster_envelope(fallback)
        self.validators['qsl-digest-account-roster.v1.schema.json'].validate(fallback_doc)
        self.assertEqual(fallback_doc['observed_at'], current_doc['observed_at'])
        self.assertEqual(fallback_doc['counts']['display_groups'], 10)
        self.assertIsNone(fallback_doc['counts']['physical_accounts'])
        self.assertTrue(all(g['management_status'] == 'unknown' and g['management_class'] is None
                            for g in fallback_doc['groups']))

        # Unavailable: fresh store with no baseline.
        empty_client = authority.AcquisitionClient(
            support.BOOT, support.SyntheticAuth(),
            support.SyntheticTransport((403, support.OK_HEADERS, b'{}')),
        )
        empty_runner = generation.GenerationRunner(
            support.BOOT, empty_client, support.SyntheticEnrollmentSource(support.prepare()[0]),
            lambda: support.OBSERVED + timedelta(seconds=120), recipient_scope='syn-scope',
        )
        unavail = empty_runner.run(deadline=support.OBSERVED + timedelta(seconds=130))
        self.assertEqual(unavail.status, generation.ROSTER_UNAVAILABLE)
        unavail_doc = envelope.build_roster_envelope(unavail)
        self.validators['qsl-digest-account-roster.v1.schema.json'].validate(unavail_doc)
        self.assertEqual(unavail_doc['groups'], [])
        self.assertIsNone(unavail_doc['observed_at'])

    def test_row_02_envelope_tampering_rejects_strictly_with_bounded_codes(self):
        _, current = _current_outcome()
        doc = envelope.build_roster_envelope(current)

        bad_version = {**doc, 'format': 'qsl_digest_account_roster.v2'}
        with self.assertRaisesRegex(authority.AuthorityError, '^roster_format_unsupported$'):
            envelope.validate_roster_envelope(bad_version)

        for mutator, code in (
            (lambda d: d.pop('observed_at'), '^roster_shape_invalid$'),
            (lambda d: d.__setitem__('groups', {}), '^roster_shape_invalid$'),
            (lambda d: d['groups'][0].__setitem__('management_status', 'active'), '^roster_group_invalid$'),
            (lambda d: d.__setitem__('unknown_authority_field', 1), '^roster_shape_invalid$'),
            (lambda d: d['counts'].__setitem__('managed', 1), '^roster_counts_inconsistent$'),
            (lambda d: d.__setitem__('observed_at', None), '^roster_shape_invalid$'),
        ):
            copy = deepcopy(doc)
            mutator(copy)
            with self.assertRaisesRegex(authority.AuthorityError, code):
                envelope.validate_roster_envelope(copy)

        raw_dup = '{"format":"qsl_digest_account_roster.v1","format":"qsl_digest_account_roster.v1"}'
        with self.assertRaisesRegex(authority.AuthorityError, '^duplicate_json_key$'):
            envelope.validate_roster_envelope(raw_dup)

        with self.assertRaisesRegex(authority.AuthorityError, '^roster_shape_invalid$'):
            envelope.validate_roster_envelope('[]')


class StatusTableParityTests(unittest.TestCase):
    def test_b2_status_and_evidence_tables_match_corpus_and_js_module(self):
        self.assertEqual(status_text.MANAGEMENT_STATUS_TEXT, support.CORPUS['status_text']['status'])
        self.assertEqual(status_text.MANAGEMENT_EVIDENCE_TEXT, support.CORPUS['status_text']['evidence'])
        node = shutil.which('node')
        if node:
            js_path = (ROOT / 'web/strategy-switch-console/application/runtime_instances/account_management_text.js').as_uri()
            proc = subprocess.run(
                [node, '--input-type=module', '-e',
                 f'import * as m from "{js_path}"; console.log(JSON.stringify({{status: m.MANAGEMENT_STATUS_TEXT, evidence: m.MANAGEMENT_EVIDENCE_TEXT}}));'],
                capture_output=True, text=True, check=True, timeout=15,
            )
            exported = json.loads(proc.stdout)
            self.assertEqual(status_text.MANAGEMENT_STATUS_TEXT, exported['status'])
            self.assertEqual(status_text.MANAGEMENT_EVIDENCE_TEXT, exported['evidence'])

    def test_format_management_status_locale_default_and_expectation_mismatch(self):
        self.assertEqual(status_text.format_management_status('managed', 'known'), 'Under quant management')
        self.assertEqual(status_text.format_management_status('managed', 'known', 'zh'), '已纳入量化管理')
        self.assertEqual(
            status_text.format_management_status('unknown', 'conflict', 'en'),
            'Quant management status unknown (Conflicting evidence)',
        )
        self.assertEqual(
            status_text.format_management_status('unknown', 'stale', 'zh'),
            '量化管理状态未知（证据已过期）',
        )
        self.assertEqual(
            status_text.format_management_status('managed', 'known', 'en', expected_enabled=False, observed_enabled=True),
            'Under quant management (differs from expectation)',
        )
        self.assertEqual(
            status_text.format_management_status('managed', 'known', 'en', expected_enabled=True, observed_enabled=True),
            'Under quant management',
        )


class MappingPreparerCliTests(unittest.TestCase):
    def test_prepare_mapping_cli_with_bundle_and_check_mode(self):
        prepared = support.preparation('complete')
        bundle = {
            'instances': support.instances(),
            'enrollment_links': deepcopy(support.FIXTURE['enrollment_links']),
            'readback': prepared['readback'],
            'effective_export': prepared['effective_export'],
            'projection': prepared['projection'],
        }
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            bundle_path = tmp / 'bundle.json'
            roster_path = tmp / 'legacy_roster.json'
            obs_path = tmp / 'obs_bindings.json'
            artifact_path = tmp / 'artifact.json'
            selection_path = tmp / 'selection.json'
            bundle_path.write_text(json.dumps(bundle), encoding='utf-8')
            roster_path.write_text(json.dumps(support.legacy_roster()), encoding='utf-8')
            obs_path.write_text(json.dumps(support.observation_bindings(prepared['readback'])), encoding='utf-8')

            out = io.StringIO()
            with redirect_stdout(out):
                rc = preparer.main([
                    'prepare-mapping',
                    '--js-bundle', str(bundle_path),
                    '--legacy-roster', str(roster_path),
                    '--observation-bindings', str(obs_path),
                    '--source', support.SOURCE,
                    '--version', support.VERSIONS['version'],
                    '--membership-version', support.VERSIONS['membership_version'],
                    '--label-version', support.VERSIONS['label_version'],
                    '--link-version', support.VERSIONS['link_version'],
                    '--prepared-at', support.CORPUS['observed_at'],
                    '--artifact-output', str(artifact_path),
                    '--selection-output', str(selection_path),
                ])
            self.assertEqual(rc, 0)
            self.assertIn('digest_mapping_prepared', out.getvalue())

            expected_bytes, expected_sha = support.prepare()
            self.assertEqual(artifact_path.read_bytes(), expected_bytes)
            selection = json.loads(selection_path.read_text(encoding='utf-8'))
            self.assertEqual(selection['artifact_sha256'], expected_sha)

            check_out = io.StringIO()
            with redirect_stdout(check_out):
                rc_check = preparer.main([
                    'prepare-mapping',
                    '--js-bundle', str(bundle_path),
                    '--legacy-roster', str(roster_path),
                    '--observation-bindings', str(obs_path),
                    '--source', support.SOURCE,
                    '--version', support.VERSIONS['version'],
                    '--membership-version', support.VERSIONS['membership_version'],
                    '--label-version', support.VERSIONS['label_version'],
                    '--link-version', support.VERSIONS['link_version'],
                    '--prepared-at', support.CORPUS['observed_at'],
                    '--artifact-output', str(artifact_path),
                    '--selection-output', str(selection_path),
                    '--check',
                ])
            self.assertEqual(rc_check, 0)
            self.assertIn('digest_mapping_current', check_out.getvalue())

    def test_js_preparer_composes_coherent_observation_and_feeds_python_cli(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('node not available')
        # Drive the real JS #1173 inventory collector + B2 baseline store, export a coherent DO observation,
        # run scripts/prepare_digest_enrollment_inputs.mjs, and feed it into project_digest_display_roster.py prepare-mapping.
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            obs_file = tmp / 'do_obs.json'
            roster_file = tmp / 'legacy_roster.json'
            bindings_file = tmp / 'obs_bindings.json'
            artifact_file = tmp / 'artifact.json'
            selection_file = tmp / 'selection.json'

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
    enrollment_links: harness.FIXTURE_ACCOUNTS && {json.dumps(support.FIXTURE['enrollment_links'])},
  }};
  await writeFile({json.dumps(str(obs_file))}, JSON.stringify(obs));
}} finally {{
  store.close();
}}
"""
            node_proc = subprocess.run(
                [node, '--input-type=module', '-e', js_script],
                capture_output=True, text=True, timeout=30,
            )
            self.assertEqual(node_proc.returncode, 0, node_proc.stderr)

            roster_file.write_text(json.dumps(support.legacy_roster()), encoding='utf-8')
            bindings_file.write_text(
                json.dumps(support.observation_bindings(support.preparation('complete')['readback'])),
                encoding='utf-8',
            )
            out = io.StringIO()
            with redirect_stdout(out):
                rc = preparer.main([
                    'prepare-mapping',
                    '--do-observation', str(obs_file),
                    '--legacy-roster', str(roster_file),
                    '--observation-bindings', str(bindings_file),
                    '--source', support.SOURCE,
                    '--version', support.VERSIONS['version'],
                    '--membership-version', support.VERSIONS['membership_version'],
                    '--label-version', support.VERSIONS['label_version'],
                    '--link-version', support.VERSIONS['link_version'],
                    '--prepared-at', support.CORPUS['observed_at'],
                    '--artifact-output', str(artifact_file),
                    '--selection-output', str(selection_file),
                ])
            self.assertEqual(rc, 0, out.getvalue())
            self.assertIn('digest_mapping_prepared', out.getvalue())
            artifact_doc = json.loads(artifact_file.read_text(encoding='utf-8'))
            self.assertEqual(artifact_doc['format'], authority.ARTIFACT_FORMAT)
            self.assertEqual(len(artifact_doc['groups']), 10)
            expected_sha = hashlib.sha256(artifact_file.read_bytes()).hexdigest()
            self.assertEqual(json.loads(selection_file.read_text(encoding='utf-8'))['artifact_sha256'], expected_sha)


if __name__ == '__main__':
    unittest.main()
