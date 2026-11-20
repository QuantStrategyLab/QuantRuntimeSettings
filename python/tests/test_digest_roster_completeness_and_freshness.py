"""Slice 3 tests: completeness contract (RESCOPE §3.1 item 2) and B3-08 preparer freshness."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from copy import deepcopy
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python' / 'scripts'))
sys.path.insert(0, str(ROOT / 'python' / 'tests'))

import digest_roster_authority as authority  # noqa: E402
import digest_roster_validator as validator  # noqa: E402
import project_digest_display_roster as preparer  # noqa: E402
from test_digest_roster_identity_and_ownership import (  # noqa: E402
    FIXTURE,
    SOURCE,
    VERSIONS,
    _instances,
    _legacy_roster,
    _observation_bindings,
    _prepare_bundle,
)

CORPUS = json.loads((ROOT / 'python/tests/fixtures/digest_roster_b2_corpus.json').read_text(encoding='utf-8'))
OBSERVED = validator.parse_instant(CORPUS['observed_at'])


class _Clock:
    def __init__(self, value=OBSERVED):
        self.value = value

    def __call__(self):
        return self.value

    def advance(self, seconds=0, *, milliseconds=0):
        self.value += timedelta(seconds=seconds, milliseconds=milliseconds)


class _Auth:
    def assertion(self, method, path, audience, clock):
        return authority.ServiceAssertion(
            'tok', 'syn-iss', audience, 'syn-sub', clock + timedelta(minutes=5), method, path,
        )


class _Transport:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def get(self, url, headers, timeout):
        self.requests.append({'url': url, 'headers': headers, 'timeout': timeout})
        if not self.responses:
            raise AssertionError('unexpected_transport_get')
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return authority.TransportResponse(
            200,
            {'content-type': 'application/json', 'cache-control': 'private, no-store'},
            json.dumps(item).encode('utf-8'),
            url,
        )


class _Enrollment:
    def __init__(self, artifact_bytes, versions=None):
        import hashlib
        self.artifact_bytes = artifact_bytes
        self.selection_doc = {
            'format': validator.SELECTION_FORMAT,
            'source': SOURCE,
            **(versions or VERSIONS),
            'artifact_sha256': hashlib.sha256(artifact_bytes).hexdigest(),
        }

    def read_selection(self):
        return authority.SourceRead(SOURCE, True, json.dumps(self.selection_doc).encode('utf-8'))

    def read_artifact(self, selection):
        return authority.SourceRead(SOURCE, True, self.artifact_bytes)


def _boot():
    return authority.RosterBootConfig(
        validator.MAPPING_MODE,
        'https://console.example.invalid',
        validator.ServiceAuthPolicy('syn-iss', 'syn-aud', frozenset({'syn-sub'})),
        SOURCE,
        'synthetic_context',
    )


def _run_scope(slot='07:00', preview=False):
    return authority.make_run_scope(
        _boot(), recipient_scope='syn-scope', report_date='2026-11-20', original_slot=slot, preview=preview,
    )


def _window():
    return {
        'business_day': '2026-11-19',
        'start': '2026-11-18T22:00:00Z',
        'end': '2026-11-19T22:00:00Z',
        'deadline_at': '2026-11-19T23:30:00Z',
    }


def _at(doc, instant):
    copy = deepcopy(doc)
    copy['observed_at'] = validator.format_utc(instant) if not isinstance(instant, str) else instant
    return copy


class CompletenessContractTests(unittest.TestCase):
    def setUp(self):
        self.bundle = _prepare_bundle()
        self.enrollment = _Enrollment(self.bundle.artifact_bytes)

    def _accept(self, *responses, clock=None, collect=None, deadline=None):
        clk = clock or _Clock()
        transport = _Transport(*responses)
        client = authority.AcquisitionClient(_boot(), _Auth(), transport)
        return authority.acquire_and_validate_roster(
            boot=_boot(),
            client=client,
            enrollment_source=self.enrollment,
            clock=clk,
            deadline=deadline or (clk() + timedelta(minutes=5)),
            run_scope=_run_scope(),
            generation_window=_window(),
            collect=collect,
        )

    def test_row_05_missing_applied_retains_header_and_class_with_group_local_unknown(self):
        for name, expected_managed, expected_unknown in (
            ('missing_one', 8, 1),
            ('missing_all', 0, 9),
        ):
            with self.subTest(scenario=name):
                rb = CORPUS['scenarios'][name]
                accepted = self._accept(rb, rb)
                doc = accepted.envelope
                self.assertEqual(doc['status'], validator.STATUS_AVAILABLE)
                self.assertTrue(doc['physical_grouping_complete'])
                self.assertEqual(doc['account_count'], 10)
                self.assertEqual(doc['counts']['managed'], expected_managed)
                self.assertEqual(doc['counts']['unknown'], expected_unknown)
                self.assertEqual(doc['counts']['not_under_management'], 1)
                eligible = [a for a in doc['accounts'] if a['management_class'] == 'eligible']
                outside = [a for a in doc['accounts'] if a['management_class'] == 'display_only']
                self.assertEqual(len(eligible), 9)
                self.assertEqual(len(outside), 1)
                self.assertEqual(outside[0]['management_status'], 'not_under_management')
                self.assertIsNone(outside[0]['applied'])
                unknown_groups = [a for a in eligible if a['management_status'] == 'unknown']
                self.assertEqual(len(unknown_groups), expected_unknown)
                self.assertTrue(all(a['applied'] is None and not a['processing_eligible'] for a in unknown_groups))

    def test_row_06_contradictions_retain_ten_groups_and_order_independence(self):
        contradiction_names = (
            'sibling_flag_disagree',
            'sibling_revision_disagree',
            'sibling_missing_malformed',
            'display_only_enabled',
            'sibling_missing_only',
        )
        for name in contradiction_names:
            with self.subTest(scenario=name):
                fwd = self._accept(CORPUS['scenarios'][name], CORPUS['scenarios'][name]).envelope
                rev = self._accept(
                    CORPUS['scenarios'][f'{name}_reversed'], CORPUS['scenarios'][f'{name}_reversed'],
                ).envelope
                self.assertEqual(fwd['account_count'], 10)
                self.assertEqual(fwd['counts'], rev['counts'])
                self.assertEqual(
                    [(a['group_id'], a['management_status'], a['evidence_state'], a['processing_eligible'])
                     for a in fwd['accounts']],
                    [(a['group_id'], a['management_status'], a['evidence_state'], a['processing_eligible'])
                     for a in rev['accounts']],
                )
                expected_ev = 'unknown' if name == 'sibling_missing_only' else 'conflict'
                affected = [a for a in fwd['accounts'] if a['management_status'] == 'unknown']
                self.assertEqual(len(affected), 1)
                self.assertEqual(affected[0]['evidence_state'], expected_ev)
                self.assertFalse(affected[0]['processing_eligible'])
                self.assertIsNone(affected[0]['applied'])

        # Separate preparation case: inconsistent sibling effective times under agreeing revision rejects PREP.
        with self.assertRaisesRegex(validator.AuthorityError, '^sibling_applied_disagree$'):
            _prepare_bundle('sibling_effective_time_disagree')

    def test_truncated_response_and_repeated_counts_cannot_establish_completeness(self):
        # Case A: truncated groups with repeated self-declared count (10 vs 9).
        trunc_a = deepcopy(CORPUS['scenarios']['all_on'])
        trunc_a['groups'].pop()
        with self.assertRaisesRegex(validator.AuthorityError, '^readback_counts_inconsistent$'):
            self._accept(trunc_a, trunc_a)

        # Case B: truncated groups AND self-declared counts + effective_export consistently adjusted to 9.
        # B2 readback alone is self-consistent, yet completeness fails against the validated structural inventory!
        trunc_b = deepcopy(CORPUS['scenarios']['all_on'])
        dropped = trunc_b['groups'].pop()
        dropped_keys = {(d['platform'], d['key']) for d in dropped['deployments']}
        trunc_b['counts']['physical_accounts'] -= 1
        trunc_b['counts']['display_deployments'] -= len(dropped_keys)
        trunc_b['counts'][dropped['management_status']] -= 1
        trunc_b['effective_export']['records'] = [
            r for r in trunc_b['effective_export']['records']
            if (r['platform'], r['legacy_key']) not in dropped_keys
        ]
        # Verify validate_readback alone accepts trunc_b...
        live_trunc = validator.validate_readback(trunc_b)
        self.assertEqual(len(live_trunc.groups), 9)
        # ...but completeness against the validated structural inventory REJECTS it!
        with self.assertRaisesRegex(validator.AuthorityError, '^grouping_mismatch$'):
            self._accept(trunc_b, trunc_b)

        # Case C: forged physical_grouping_complete=True while uncovered_deployments is non-empty.
        forged_uncovered = deepcopy(CORPUS['scenarios']['all_on'])
        dropped_group = forged_uncovered['groups'].pop()
        d0 = dropped_group['deployments'][0]
        forged_uncovered['counts']['physical_accounts'] = 9
        forged_uncovered['counts']['managed'] -= 1
        forged_uncovered['counts']['uncovered_deployments'] = 1
        forged_uncovered['uncovered_deployments'] = [{
            'platform': d0['platform'],
            'key': d0['key'],
            'management_status': 'unknown',
            'evidence_state': 'unknown',
            'reasons': ['deployment_unclassified'],
            'processing_eligible': False,
            'processing_denial': 'management_status_unknown',
        }]
        forged_uncovered['effective_export']['records'] = [
            r for r in forged_uncovered['effective_export']['records']
            if (r['platform'], r['legacy_key']) != (d0['platform'], d0['key'])
        ]
        with self.assertRaisesRegex(validator.AuthorityError, '^physical_grouping_incomplete$'):
            self._accept(forged_uncovered, forged_uncovered)

        # Case D: missing last #1173 pass via real JS preparer fails inventory completeness even if statuses match.
        node = shutil.which('node')
        if node:
            with tempfile.TemporaryDirectory() as directory:
                tmp = Path(directory)
                obs_file = tmp / 'obs_incomplete.json'
                bundle_file = tmp / 'js_bundle.json'
                js_script = f"""
import {{ writeFile }} from "node:fs/promises";
const ROOT = {json.dumps(ROOT.as_uri() + "/")};
const harness = await import(new URL("tests/helpers/account_management_harness.mjs", ROOT));
const {{ collectInventory, instanceStateRow }} = await import(new URL("tests/helpers/account_identity_inventory_collect.mjs", ROOT));
const store = await harness.baselineStore();
try {{
  const inventory = (await collectInventory({{ statements: [instanceStateRow(harness.INSTANCE_REVISION, harness.INSTANCES)], kvPasses: 1 }})).private;
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
                subprocess.run([node, '--input-type=module', '-e', js_script], check=True, timeout=30)
                subprocess.run(
                    [node, str(ROOT / 'scripts/prepare_digest_enrollment_inputs.mjs'),
                     '--input', str(obs_file), '--output', str(bundle_file)],
                    check=True, timeout=30,
                )
                js_bundle = json.loads(bundle_file.read_text(encoding='utf-8'))
                self.assertIs(js_bundle['authority']['authoritative'], False)
                self.assertIn('kv:not_stable', js_bundle['authority']['reasons'])
                with self.assertRaisesRegex(validator.AuthorityError, '^inventory_incomplete$'):
                    preparer.prepare_mapping_enrollment_bundle(
                        js_bundle=js_bundle,
                        legacy_roster=_legacy_roster(),
                        observation_bindings=_observation_bindings(js_bundle['readback']),
                        source=SOURCE,
                        versions=dict(VERSIONS),
                        prepared_at=js_bundle['readback']['observed_at'],
                    )

    def test_row_07_revision_races_and_same_revision_content_change_retry_once_then_reject(self):
        # Transient race on attempt 1 followed by coherent attempt 2 succeeds in 2 attempts.
        accepted = self._accept(
            CORPUS['scenarios']['all_on'],
            CORPUS['scenarios']['one_off'],
            CORPUS['scenarios']['one_off'],
            CORPUS['scenarios']['one_off'],
        )
        self.assertEqual(accepted.attempts, 2)
        self.assertEqual(accepted.envelope['counts']['managed'], 8)

        # Held applied revision race across both attempts rejects with zero provisional leak.
        with self.assertRaisesRegex(validator.AuthorityError, '^revision_race$'):
            self._accept(
                CORPUS['scenarios']['all_on'],
                CORPUS['scenarios']['one_off'],
                CORPUS['scenarios']['all_on'],
                CORPUS['scenarios']['one_off'],
            )

        # Same-revision changed content between initial and confirming reads rejects.
        altered = deepcopy(CORPUS['scenarios']['all_on'])
        altered['groups'][2]['scope'] = 'paper'
        with self.assertRaisesRegex(validator.AuthorityError, '^revision_race$'):
            self._accept(
                CORPUS['scenarios']['all_on'], altered,
                CORPUS['scenarios']['all_on'], altered,
            )

        # Instance or policy revision mismatch against structural artifact rejects.
        for scen in ('instance_bumped', 'policy_bumped'):
            with self.subTest(scenario=scen):
                with self.assertRaisesRegex(validator.AuthorityError, '^structural_revision_mismatch$'):
                    self._accept(CORPUS['scenarios'][scen], CORPUS['scenarios'][scen])


class DeterministicFreshnessTests(unittest.TestCase):
    def setUp(self):
        self.bundle = _prepare_bundle()
        self.enrollment = _Enrollment(self.bundle.artifact_bytes)

    def _accept_at(self, clock, obs1, obs2, *, collect=None, deadline=None):
        client = authority.AcquisitionClient(_boot(), _Auth(), _Transport(obs1, obs2, obs1, obs2))
        return authority.acquire_and_validate_roster(
            boot=_boot(),
            client=client,
            enrollment_source=self.enrollment,
            clock=clock,
            deadline=deadline or (clock() + timedelta(minutes=10)),
            run_scope=_run_scope(),
            generation_window=_window(),
            collect=collect,
        )

    def test_amended_b3_08_exact_inclusive_bounds_at_preparer_and_consumer_acceptance(self):
        # Fix acceptance clock G at the roster acceptance decision.
        G = OBSERVED + timedelta(seconds=120)
        base = CORPUS['scenarios']['all_on']

        # Inclusive lower bound: G - 300 s passes preparer acceptance.
        t_low = G - timedelta(seconds=300)
        res_low = self._accept_at(_Clock(G), _at(base, t_low), _at(base, t_low))
        self.assertEqual(res_low.envelope['observation_age_seconds'], 300.0)
        self.assertEqual(res_low.envelope['source_snapshot_at'], validator.format_utc(t_low))

        # Outside lower bound: G - 300.001 s fails preparer acceptance (even when generated_at / fetch is G).
        t_too_old = G - timedelta(seconds=300, milliseconds=1)
        with self.assertRaisesRegex(validator.AuthorityError, '^observation_stale$'):
            self._accept_at(_Clock(G), _at(base, t_too_old), _at(base, t_too_old))

        # Inclusive upper future skew bound: G + 30 s passes with age 0.
        t_skew = G + timedelta(seconds=30)
        res_skew = self._accept_at(_Clock(G), _at(base, t_skew), _at(base, t_skew))
        self.assertEqual(res_skew.envelope['observation_age_seconds'], 0.0)
        self.assertEqual(res_skew.envelope['source_snapshot_at'], validator.format_utc(t_skew))

        # Outside upper future skew bound: G + 30.001 s fails preparer acceptance.
        t_too_future = G + timedelta(seconds=30, milliseconds=1)
        with self.assertRaisesRegex(validator.AuthorityError, '^observation_stale$'):
            self._accept_at(_Clock(G), _at(base, t_too_future), _at(base, t_too_future))

        # Malformed or absent source snapshot times reject.
        for bad_ts in ('2026-11-19T23:00:00+00:00', '2026-11-19 23:00:00Z', '', None, 'not-a-timestamp'):
            with self.subTest(bad_ts=bad_ts):
                bad_doc = deepcopy(base)
                bad_doc['observed_at'] = bad_ts
                with self.assertRaisesRegex(validator.AuthorityError, '^observation_time_invalid$'):
                    self._accept_at(_Clock(G), bad_doc, bad_doc)

        # Fresh observation of an old valid apply passes.
        old_apply = deepcopy(base)
        for grp in old_apply['groups']:
            if grp['applied'] is not None:
                grp['applied']['effective_at'] = '2026-11-12T10:00:00.000Z'
        for rec in old_apply['effective_export']['records']:
            rec['effective_at'] = '2026-11-12T10:00:00.000Z'
        res_old_apply = self._accept_at(_Clock(G), _at(old_apply, G - timedelta(seconds=5)),
                                        _at(old_apply, G - timedelta(seconds=5)))
        self.assertEqual(res_old_apply.envelope['status'], validator.STATUS_AVAILABLE)

        # Consumer clock advancing past bound after preparer acceptance rejects on source_snapshot_at,
        # never substituting envelope generated_at (even when generated_at is still fresh!).
        accepted_mid = self._accept_at(_Clock(G), _at(base, G - timedelta(seconds=250)),
                                       _at(base, G - timedelta(seconds=250)))
        env = accepted_mid.envelope
        # Consumer clock at source_snapshot_at + 300s passes.
        t_snap = validator.parse_instant(env['source_snapshot_at'])
        validator.validate_consumer_provenance(env, clock=t_snap + timedelta(seconds=300))
        # Consumer clock at source_snapshot_at + 300.001s (while generated_at is only 50.001s old!) REJECTS.
        g_cons_expired = t_snap + timedelta(seconds=300, milliseconds=1)
        self.assertLess((g_cons_expired - validator.parse_instant(env['generated_at'])).total_seconds(), 60)
        with self.assertRaisesRegex(validator.AuthorityError, '^observation_stale$'):
            validator.validate_consumer_provenance(env, clock=g_cons_expired)

    def test_first_observation_expires_during_collection_triggers_retry_and_recovery(self):
        # At collection start, initial snapshot is 295 s old (valid).
        # Collection advances clock by 10 s -> initial snapshot is 305 s old at acceptance G!
        clk = _Clock(OBSERVED + timedelta(seconds=295))
        base = CORPUS['scenarios']['all_on']
        stale_initial = _at(base, OBSERVED)
        fresh_after_retry = _at(base, OBSERVED + timedelta(seconds=300))

        def slow_collect(_roster):
            if clk() < OBSERVED + timedelta(seconds=305):
                clk.advance(10)
            return 'collected'

        client = authority.AcquisitionClient(
            _boot(),
            _Auth(),
            _Transport(stale_initial, fresh_after_retry, fresh_after_retry, fresh_after_retry),
        )
        accepted = authority.acquire_and_validate_roster(
            boot=_boot(),
            client=client,
            enrollment_source=self.enrollment,
            clock=clk,
            deadline=OBSERVED + timedelta(minutes=10),
            run_scope=_run_scope(),
            generation_window=_window(),
            collect=slow_collect,
        )
        self.assertEqual(accepted.attempts, 2)
        self.assertEqual(accepted.collected, 'collected')

        # If attempt 2 also expires while collecting, preparer rejects with observation_stale.
        clk2 = _Clock(OBSERVED + timedelta(seconds=295))
        client2 = authority.AcquisitionClient(
            _boot(),
            _Auth(),
            _Transport(stale_initial, fresh_after_retry, stale_initial, fresh_after_retry),
        )
        with self.assertRaisesRegex(validator.AuthorityError, '^observation_stale$'):
            authority.acquire_and_validate_roster(
                boot=_boot(),
                client=client2,
                enrollment_source=self.enrollment,
                clock=clk2,
                deadline=OBSERVED + timedelta(minutes=10),
                run_scope=_run_scope(),
                generation_window=_window(),
                collect=lambda _r: clk2.advance(10),
            )


if __name__ == '__main__':
    unittest.main()
