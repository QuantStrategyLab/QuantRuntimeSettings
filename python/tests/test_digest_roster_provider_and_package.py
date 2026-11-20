"""Slice 7 tests: RESCOPE §7 provider surface, manifest delta, B3-22 PKG fixture, and §11 item 7 inventory."""
from __future__ import annotations

import json
import os
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

import digest_package_preflight as preflight  # noqa: E402
import digest_roster_authority as authority  # noqa: E402
import digest_roster_provider as provider  # noqa: E402
import digest_roster_publication as publication  # noqa: E402
import digest_roster_validator as validator  # noqa: E402
from test_digest_roster_completeness_and_freshness import (  # noqa: E402
    CORPUS,
    OBSERVED,
    _Auth,
    _Clock,
    _Enrollment,
    _Transport,
    _boot,
    _run_scope,
    _window,
)
from test_digest_roster_identity_and_ownership import FIXTURE, SOURCE, VERSIONS, _prepare_bundle  # noqa: E402
from test_digest_roster_validator_and_schema import (  # noqa: E402
    _sample_available_envelope,
    _sample_fallback_envelope,
    _sample_unavailable_envelope,
)


def _materialize_manifest(pkg_dir: Path, *, roles=('preparer', 'generation', 'both')) -> dict:
    manifest = preflight.load_manifest()
    role_set = set(roles)
    for origin in ('base', 'b3_overlay'):
        for member in manifest['members']:
            if member['origin'] != origin or member['dependency_role'] not in role_set:
                continue
            src = ROOT / member['source']
            dst = pkg_dir / member['destination']
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
    return manifest


class ProviderSurfaceTests(unittest.TestCase):
    """RESCOPE §7 (a)-(e) and §8 facts 1-5 generation-context provider surface."""

    def setUp(self):
        self.bundle = _prepare_bundle()
        self.enrollment = _Enrollment(self.bundle.artifact_bytes)
        self.selection_dict = authority.read_selection(
            self.enrollment.read_selection(), SOURCE,
        ).as_dict()

    def _publish_available(self, scenario='four_on', *, slot='07:00'):
        store = publication.InMemoryConditionalRosterStore()
        rb = CORPUS['scenarios'][scenario]
        clk = _Clock(OBSERVED + timedelta(seconds=15))
        client = authority.AcquisitionClient(_boot(), _Auth(), _Transport(rb, rb))
        pub = publication.ConditionalRosterPublisher(
            _boot(), client, self.enrollment, store, clk, 'syn-scope',
        )
        outcome = pub.publish_generation(
            report_date='2026-11-20',
            original_slot=slot,
            generation_window=_window(),
            deadline=clk() + timedelta(minutes=5),
            generation_id='gen-slice7-01',
        )
        self.assertEqual(outcome.status, 'available')
        return store, outcome, clk

    def test_provider_exposes_all_rescope_section7_items_a_through_e(self):
        store, outcome, clk = self._publish_available('four_on')
        ctx = publication.provide_generation_context(
            outcome,
            clock=clk(),
            expected_run_id='2026-11-20/07:00',
            expected_run_scope=_run_scope(),
            expected_selection=self.selection_dict,
        )
        self.assertTrue(ctx.authoritative)
        self.assertEqual(ctx.format, validator.ROSTER_FORMAT)
        self.assertEqual(ctx.status, validator.STATUS_AVAILABLE)
        self.assertEqual(ctx.generation_id, 'gen-slice7-01')
        self.assertEqual(
            ctx.source_revision,
            (CORPUS['scenarios']['four_on']['instance_revision'], CORPUS['scenarios']['four_on']['policy_revision']),
        )

        # (a) Certified group identity + (platform, account_key) bindings + paper/live/display-only scope
        self.assertEqual(len(ctx.groups), 10)
        scopes_seen = {g.effective_scope for g in ctx.groups}
        self.assertEqual(scopes_seen, {'live', 'paper', 'display_only', 'unknown'})
        self.assertTrue({'live', 'paper', 'display_only'} <= scopes_seen)
        for g in ctx.groups:
            self.assertRegex(g.group_id, r'^grp_v1_[0-9a-f]{64}$')
            self.assertEqual(
                g.deployment_bindings,
                tuple({'platform': p, 'account_key': k} for p, k in g.deployments),
            )
            self.assertEqual(ctx.group_by_id(g.group_id), g)
            for p, k in g.deployments:
                self.assertEqual(ctx.group_for_deployment(p, k), g)

        # (b) Per-group applied tuple (management_enabled, revision, effective_at) unchanged from B2
        rb_by_gid = {
            validator.certify_group_identity([(d['platform'], d['key']) for d in raw['deployments']]): raw
            for raw in CORPUS['scenarios']['four_on']['groups']
        }
        for g in ctx.groups:
            raw_applied = rb_by_gid[g.group_id]['applied']
            expected_tuple = (
                (raw_applied['management_enabled'], raw_applied['revision'], raw_applied['effective_at'])
                if raw_applied is not None else None
            )
            self.assertEqual(g.applied, expected_tuple)
            if g.management_class == 'display_only':
                self.assertIsNone(g.applied)
                self.assertEqual(g.effective_scope, 'display_only')

        # (c) Roster acquisition facts + independent 300 s / 30 s B3-08 source-snapshot reproduction
        acq = ctx.acquisition
        self.assertIsNotNone(acq)
        self.assertEqual(acq.live_source, validator.MANAGEMENT_ROUTE)
        self.assertEqual(acq.evidence_scope, validator.EVIDENCE_SCOPE)
        self.assertEqual(acq.scope, validator.EVIDENCE_SCOPE)
        self.assertEqual(acq.confirmation_outcome, 'confirmed')
        self.assertEqual(acq.initial_snapshot_at, CORPUS['observed_at'])
        self.assertEqual(acq.confirming_snapshot_at, CORPUS['observed_at'])
        self.assertEqual(acq.source_snapshot_at, CORPUS['observed_at'])
        self.assertTrue(acq.verify_freshness(OBSERVED + timedelta(seconds=300)))
        self.assertFalse(acq.verify_freshness(OBSERVED + timedelta(seconds=300, milliseconds=1)))
        self.assertTrue(acq.verify_freshness(OBSERVED - timedelta(seconds=30)))
        self.assertFalse(acq.verify_freshness(OBSERVED - timedelta(seconds=30, milliseconds=1)))

        # (d) Typed observation links in original Q4 shape
        obs_links = ctx.observation_bindings()
        self.assertGreater(len(obs_links), 0)
        for link in obs_links:
            self.assertEqual(set(link), set(validator.OBSERVATION_BINDING_FIELDS))
        self.assertGreater(len(ctx.run_bindings()), 0)

        # (e) Generation window, trusted generated_at, and §5 rule 1 run_scope
        self.assertEqual(ctx.generation_window.as_dict(), _window())
        self.assertEqual(ctx.generated_at, validator.format_utc(clk()))
        self.assertEqual(ctx.run_id, '2026-11-20/07:00')
        self.assertEqual(ctx.run_scope.as_dict(), _run_scope())
        self.assertEqual(ctx.run_scope.run_key, publication.run_publication_key(_run_scope()))

        # Consumer store read path yields identical GenerationContext without re-deriving ownership.
        consumed_ctx = publication.consume_generation_context(
            store,
            boot=_boot(),
            recipient_scope='syn-scope',
            report_date='2026-11-20',
            original_slot='07:00',
            expected_selection=self.selection_dict,
            clock=clk(),
        )
        self.assertEqual(consumed_ctx, ctx)

    def test_provider_freshness_depends_only_on_source_snapshot_never_generated_at_or_read_at(self):
        # Envelope whose generated_at and read_at appear fresh at G, while source_snapshot_at is stale (>300 s).
        avail = _sample_available_envelope()
        snap = validator.parse_instant(avail['source_snapshot_at'])
        # Advance generated_at to snap + 286s (valid at generation), then evaluate consumer clock G = snap + 300.001s.
        avail['generated_at'] = validator.format_utc(snap + timedelta(seconds=286))
        avail['observation_age_seconds'] = 286.0
        avail['acquisition']['initial_read_at'] = validator.format_utc(snap + timedelta(seconds=285))
        avail['acquisition']['confirming_read_at'] = validator.format_utc(snap + timedelta(seconds=286))
        avail['content_hash'] = validator.compute_content_hash(avail)

        # Even build_generation_context at G = snap + 300.001s must REJECT!
        g_stale = snap + timedelta(seconds=300, milliseconds=1)
        with self.assertRaisesRegex(validator.AuthorityError, '^observation_stale$'):
            provider.build_generation_context(avail, clock=g_stale)

        # At exact inclusive boundary G = snap + 300s, both build_generation_context and acq.verify_freshness pass,
        # and advancing clock by 1ms fails independently of generated_at / read_at.
        g_exact = snap + timedelta(seconds=300)
        ctx = provider.build_generation_context(avail, clock=g_exact)
        self.assertTrue(ctx.verify_freshness(g_exact))
        self.assertFalse(ctx.verify_freshness(g_stale))
        with self.assertRaisesRegex(validator.AuthorityError, '^observation_stale$'):
            ctx.require_authoritative(g_stale)

    def test_authority_rule_and_non_authoritative_forms(self):
        avail = _sample_available_envelope()
        fallback = _sample_fallback_envelope(avail)
        unavail = _sample_unavailable_envelope(run_id='2026-11-20/07:00', run_scope=_run_scope())
        clk = validator.parse_instant(avail['source_snapshot_at']) + timedelta(seconds=10)

        for non_auth in (fallback, unavail):
            with self.assertRaisesRegex(validator.AuthorityError, '^roster_not_authoritative$'):
                provider.build_generation_context(non_auth, clock=clk)
            ctx = provider.build_generation_context(
                non_auth, clock=clk, allow_non_authoritative=True,
            )
            self.assertFalse(ctx.authoritative)
            self.assertEqual(ctx.format, validator.ROSTER_FORMAT)
            self.assertIn(ctx.status, {'fallback', 'unavailable'})
            self.assertIsNone(ctx.acquisition)
            self.assertIsNone(ctx.generated_at)
            self.assertEqual(ctx.observation_bindings(), [])
            self.assertEqual(ctx.run_bindings(), [])
            self.assertFalse(ctx.verify_freshness(clk))

        # Provenance mismatches and hash tamper reject fail-closed.
        with self.assertRaisesRegex(validator.AuthorityError, '^roster_scope_invalid$'):
            provider.build_generation_context(avail, clock=clk, expected_run_id='2026-11-20/07:30')
        tampered = deepcopy(avail)
        tampered['content_hash'] = '0' * 64
        with self.assertRaisesRegex(validator.AuthorityError, '^roster_hash_mismatch$'):
            provider.build_generation_context(tampered, clock=clk)


class IsolatedProducerPackageTests(unittest.TestCase):
    """B3-22 isolated PKG fixture for producer closures + one-file-at-a-time omissions."""

    def _write_synthetic_work_inputs(self, work: Path):
        prepared = CORPUS['preparations']['complete']
        obs = {
            'observed_at': CORPUS['observed_at'],
            'instance_revision': CORPUS['fixture']['instance_revision'],
            'instances': [
                {
                    **item,
                    'kind': 'existing',
                    'config': {**item['config'], 'account_scope': f'SYN-SCOPE-{idx + 1:02d}'},
                }
                for idx, item in enumerate(FIXTURE['instances'])
            ],
            'policy': {
                'format': 'qsl_account_mapping_policy.v1',
                'policy_revision': CORPUS['fixture']['policy_revision'],
                'accounts': [],
            },
            'readback': prepared['readback'],
            'effective_export': prepared['effective_export'],
            'projection': prepared['projection'],
            'enrollment_links': FIXTURE['enrollment_links'],
        }
        # Build real DO observation using node + account_management_harness inside checkout test fixture
        node = shutil.which('node')
        self.assertIsNotNone(node, 'node >= 22 required for isolated JS preparer tests')
        build_obs_js = f"""
import {{ writeFile }} from "node:fs/promises";
const ROOT = {json.dumps(ROOT.as_uri() + "/")};
const RealDate = Date;
let tick = RealDate.parse("2026-11-19T20:00:00.000Z");
globalThis.Date = class extends RealDate {{
  constructor(...args) {{ if (args.length) super(...args); else {{ super(tick); tick += 1000; }} }}
  static now() {{ tick += 1000; return tick - 1000; }}
}};
const harness = await import(new URL("tests/helpers/account_management_harness.mjs", ROOT));
const {{ collectInventory, instanceStateRow }} = await import(new URL("tests/helpers/account_identity_inventory_collect.mjs", ROOT));
const store = await harness.baselineStore();
try {{
  const inventory = (await collectInventory({{ statements: [instanceStateRow(harness.INSTANCE_REVISION, harness.INSTANCES)] }})).private;
  const applied = store.db.prepare("SELECT * FROM account_management_applied ORDER BY platform, account_key").all();
  const observedAt = {json.dumps(CORPUS['observed_at'])};
  const doObs = {{
    observed_at: observedAt,
    instance_revision: harness.INSTANCE_REVISION,
    instances: harness.INSTANCES,
    policy: harness.policyOf(harness.FIXTURE_ACCOUNTS),
    applied_rows: applied,
    inventory,
    collection: {{ observedAt, sourceRef: "inventory_export:synthetic-b3" }},
    enrollment_links: {json.dumps(FIXTURE['enrollment_links'])},
  }};
  const readRes = await store.read();
  await writeFile({json.dumps(str(work / 'do_obs.json'))}, JSON.stringify(doObs));
  await writeFile({json.dumps(str(work / 'live_readback.json'))}, JSON.stringify(readRes.body));
}} finally {{
  store.close();
}}
"""
        subprocess.run([node, '--input-type=module', '-e', build_obs_js], check=True, timeout=30)
        legacy_roster = [
            {
                'platform_id': link['platform_id'],
                'candidate_slot': link['candidate_slot'],
                'opaque_account_uid': link['opaque_account_uid'],
                'target_id': link['target_id'],
                'strategy_profile': f'syn_profile_{idx}',
            }
            for idx, link in enumerate(FIXTURE['enrollment_links'])
        ]
        (work / 'legacy_roster.json').write_text(json.dumps(legacy_roster), encoding='utf-8')
        obs_bindings = [
            {
                'binding_id': f'obs-{idx:02d}',
                'platform': g['deployments'][0]['platform'],
                'legacy_key': g['deployments'][0]['key'],
                'opaque_account_uid': None,
                'broker_environment': g['scope'],
                'account_scope': 'account',
            }
            for idx, g in enumerate(prepared['readback']['groups'])
            if g['scope'] in {'paper', 'live'}
        ]
        (work / 'obs_bindings.json').write_text(json.dumps(obs_bindings), encoding='utf-8')
        (work / 'readback.json').write_text(json.dumps(CORPUS['scenarios']['all_on']), encoding='utf-8')
        return obs

    def test_isolated_producer_closures_positive_and_package_relative_origins(self):
        node = shutil.which('node')
        self.assertIsNotNone(node)
        with tempfile.TemporaryDirectory(prefix='qsl-b3a-pkg-') as directory:
            tmp = Path(directory)
            pkg = tmp / 'pkg'
            work = tmp / 'outside-checkout'
            work.mkdir()
            _materialize_manifest(pkg)
            self._write_synthetic_work_inputs(work)

            # 1. Isolated preflight (all, preparer, generation) with QSL_DIGEST_SCHEMAS_DIR unset.
            pf_script = """
import json, sys
from pathlib import Path
pkg = Path(sys.argv[1])
sys.path.insert(0, str(pkg / 'python' / 'scripts'))
import digest_package_preflight as preflight
checked_all = preflight.verify_package(pkg, role='all')
checked_prep = preflight.verify_package(pkg, role='preparer')
checked_gen = preflight.verify_package(pkg, role='generation')
resources = preflight.resource_origins(pkg, role='all')
print(json.dumps({
    'all': len(checked_all), 'prep': len(checked_prep), 'gen': len(checked_gen),
    'resources': resources,
}))
"""
            pf_proc = subprocess.run(
                [sys.executable, '-I', '-c', pf_script, str(pkg)],
                cwd=work, env={'PATH': os.environ['PATH']},
                capture_output=True, text=True, check=True, timeout=30,
            )
            pf_res = json.loads(pf_proc.stdout)
            self.assertEqual(pf_res['all'], 51)
            self.assertEqual(
                pf_res['resources']['schema:qsl-digest-account-roster.v1.schema.json'],
                'schemas/qsl-digest-account-roster.v1.schema.json',
            )
            self.assertEqual(pf_res['resources']['data:display_names.json'], 'python/scripts/display_names.json')
            self.assertEqual(pf_res['resources']['data:platform-config.json'], 'platform-config.json')
            self.assertEqual(
                pf_res['resources']['status:account_management_text.js'],
                'web/strategy-switch-console/application/runtime_instances/account_management_text.js',
            )

            # 2. Isolated JS preparer: package-relative (no QSL_DIGEST_CONSOLE_DIR) AND explicit QSL_DIGEST_CONSOLE_DIR.
            subprocess.run(
                [node, str(pkg / 'scripts/prepare_digest_enrollment_inputs.mjs'),
                 '--input', str(work / 'do_obs.json'), '--output', str(work / 'js_bundle_rel.json')],
                cwd=work, env={'PATH': os.environ['PATH']},
                capture_output=True, text=True, check=True, timeout=30,
            )
            subprocess.run(
                [node, str(pkg / 'scripts/prepare_digest_enrollment_inputs.mjs'),
                 '--input', str(work / 'do_obs.json'), '--output', str(work / 'js_bundle_env.json')],
                cwd=work,
                env={
                    'PATH': os.environ['PATH'],
                    'QSL_DIGEST_CONSOLE_DIR': str(pkg / 'web/strategy-switch-console'),
                },
                capture_output=True, text=True, check=True, timeout=30,
            )
            self.assertEqual(
                (work / 'js_bundle_rel.json').read_text(encoding='utf-8'),
                (work / 'js_bundle_env.json').read_text(encoding='utf-8'),
            )

            # 3. Isolated Python preparer invoking packaged JS preparer package-relatively (--do-observation).
            prep_proc = subprocess.run(
                [
                    sys.executable, '-I',
                    str(pkg / 'python/scripts/project_digest_display_roster.py'),
                    'prepare-mapping',
                    '--do-observation', str(work / 'do_obs.json'),
                    '--legacy-roster', str(work / 'legacy_roster.json'),
                    '--observation-bindings', str(work / 'obs_bindings.json'),
                    '--source', SOURCE,
                    '--version', 'v1', '--membership-version', 'm1', '--label-version', 'l1', '--link-version', 'k1',
                    '--prepared-at', CORPUS['observed_at'],
                    '--artifact-output', str(work / 'artifact.json'),
                    '--selection-output', str(work / 'selection.json'),
                    '--raw-identifiers-output', str(work / 'raw_ids.json'),
                ],
                cwd=work, env={'PATH': os.environ['PATH'], 'PYTHONPATH': str(pkg / 'python/scripts')},
                capture_output=True, text=True, check=True, timeout=30,
            )
            self.assertIn('digest_mapping_prepared', prep_proc.stdout)

            # 4. Isolated Python generation closures:
            #    validator + 3 digest files + constructor (mapping & legacy) + publication + provider surface.
            gen_probe = """
import json, os, sys
from datetime import timedelta
from pathlib import Path

pkg = Path(sys.argv[1])
work = Path(sys.argv[2])
sys.path.insert(0, str(pkg / 'python' / 'scripts'))

import digest_package_preflight as preflight
preflight.verify_package(pkg, role='generation')

import account_daily_digest as digest_render
import account_daily_facts as digest_facts
import cloud_run_daily_digest as app
import daily_digest_aggregator as aggregator
import digest_roster_authority as authority
import digest_roster_provider as provider
import digest_roster_publication as publication
import digest_roster_validator as validator

# Package-relative platform-config load (no QSL_PLATFORM_CONFIG override)
loaded_cfg = aggregator.load_platform_config()
assert isinstance(loaded_cfg, dict) and 'platforms' in loaded_cfg
assert hasattr(digest_render, 'render_account_daily')
assert hasattr(digest_facts, 'collect_account_facts')

# Constructor in mapping mode (no credentials, synthetic boot)
os.environ.update({
    'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true',
    'DIGEST_DELIVERY_ENABLED': 'false',
    'DIGEST_SCHEDULER_JOB_NAME': 'projects/synthetic/locations/synthetic/jobs/daily-digest',
    'DIGEST_RECIPIENT_SCOPE': 'syn-scope',
    'DIGEST_CUTOVER_REPORT_DATE': '2026-11-20',
    'QSL_NOTIFY_LANG': 'en',
    'DIGEST_ROSTER_BOOT_JSON': json.dumps({
        'mode': 'mapping_v1',
        'origin': 'https://console.example.invalid',
        'service_auth': {'issuer': 'syn-iss', 'audience': 'syn-aud', 'subjects': ['syn-sub']},
        'enrollment_source': 'synthetic-enrollment',
        'config_context': 'synthetic_context',
        'read_timeout': 10.0,
    }),
})
mapping_cfg = app.Configuration.from_environment()
assert mapping_cfg.is_mapping_mode

# Legacy mode control still intact
legacy_cfg = app.Configuration(
    [{'platform_id': 'ibkr', 'opaque_account_uid': 'uid:SYN-1', 'target_id': 'tgt-1',
      'strategy_profile': 'syn_prof', 'candidate_slot': 'slot-1'}],
    'projects/synthetic/locations/synthetic/jobs/daily-digest',
    'syn-scope',
    '2026-11-20',
)
assert not legacy_cfg.is_mapping_mode

# Producer conditional publication + RESCOPE §7 GenerationContext provider surface
readback_doc = json.loads((work / 'readback.json').read_text(encoding='utf-8'))
observed = validator.parse_instant(readback_doc['observed_at'])
accept_at = observed + timedelta(seconds=15)

class PeerAuth:
    def assertion(self, method, path, audience, now):
        return authority.ServiceAssertion('tok', 'syn-iss', audience, 'syn-sub', now + timedelta(minutes=5), method, path)

class PeerTransport:
    def get(self, url, headers, timeout):
        return authority.TransportResponse(
            200, {'content-type': 'application/json', 'cache-control': 'private, no-store'},
            json.dumps(readback_doc).encode('utf-8'), url,
        )

class PeerEnrollment:
    def read_selection(self):
        return authority.SourceRead('synthetic-enrollment', True, (work / 'selection.json').read_bytes())
    def read_artifact(self, sel):
        return authority.SourceRead('synthetic-enrollment', True, (work / 'artifact.json').read_bytes())

store = publication.InMemoryConditionalRosterStore()
client = authority.AcquisitionClient(mapping_cfg.roster_boot, PeerAuth(), PeerTransport())
pub = publication.ConditionalRosterPublisher(
    mapping_cfg.roster_boot, client, PeerEnrollment(), store, lambda: accept_at, 'syn-scope',
)
outcome = pub.publish_generation(
    report_date='2026-11-20',
    original_slot='07:00',
    generation_window={
        'business_day': '2026-11-19',
        'start': '2026-11-18T22:00:00Z',
        'end': '2026-11-19T22:00:00Z',
        'deadline_at': '2026-11-19T23:30:00Z',
    },
    deadline=accept_at + timedelta(minutes=5),
    generation_id='gen-pkg-01',
)
assert outcome.status == 'available' and outcome.committed
sel_doc = json.loads((work / 'selection.json').read_text(encoding='utf-8'))
sel_doc.pop('format', None)
ctx = publication.consume_generation_context(
    store,
    boot=mapping_cfg.roster_boot,
    recipient_scope='syn-scope',
    report_date='2026-11-20',
    original_slot='07:00',
    expected_selection=sel_doc,
    clock=accept_at,
)
assert ctx.authoritative and len(ctx.groups) == 10
assert ctx.acquisition.verify_freshness(observed + timedelta(seconds=300))
assert not ctx.acquisition.verify_freshness(observed + timedelta(seconds=300, milliseconds=1))

origins = preflight.assert_isolated_imports(pkg)
assert all(isinstance(v, str) and not v.startswith('/') and '..' not in v for v in origins.values())
assert origins.get('digest_roster_provider') == 'python/scripts/digest_roster_provider.py'
assert origins.get('account_daily_digest') == 'python/scripts/account_daily_digest.py'
assert origins.get('account_daily_facts') == 'python/scripts/account_daily_facts.py'
assert origins.get('cloud_run_daily_digest') == 'python/scripts/cloud_run_daily_digest.py'
assert origins.get('notification_snapshot.unified_contract') == 'python/scripts/notification_snapshot/unified_contract.py'
resources = preflight.resource_origins(pkg, role='generation')
print(json.dumps({
    'origins': origins,
    'resources': resources,
    'groups': len(ctx.groups),
    'obs_links': len(ctx.observation_bindings()),
}))
"""
            gen_proc = subprocess.run(
                [sys.executable, '-I', '-c', gen_probe, str(pkg), str(work)],
                cwd=work, env={'PATH': os.environ['PATH']},
                capture_output=True, text=True, check=True, timeout=30,
            )
            gen_res = json.loads(gen_proc.stdout)
            self.assertEqual(gen_res['groups'], 10)
            self.assertGreater(gen_res['obs_links'], 0)
            self.assertEqual(gen_res['resources']['data:platform-config.json'], 'platform-config.json')
            self.assertEqual(
                gen_res['resources']['schema:qsl-digest-account-roster.v1.schema.json'],
                'schemas/qsl-digest-account-roster.v1.schema.json',
            )

    def test_one_file_at_a_time_omission_rejects_every_manifest_member_and_base_tamper(self):
        manifest = preflight.load_manifest()
        with tempfile.TemporaryDirectory(prefix='qsl-b3a-omit-') as directory:
            tmp = Path(directory)
            base_pkg = tmp / 'base-pkg'
            _materialize_manifest(base_pkg)

            check_script = """
import sys
from pathlib import Path
pkg = Path(sys.argv[1])
sys.path.insert(0, str(pkg / 'python' / 'scripts'))
import digest_package_preflight as preflight
preflight.verify_package(pkg, role='all')
"""
            # Reuse ONE omitted copy directory and restore the single unlinked file after each case.
            omitted_pkg = tmp / 'omitted-pkg'
            shutil.copytree(base_pkg, omitted_pkg)
            results = []
            for member in manifest['members']:
                dest_rel = member['destination']
                with self.subTest(omitted=dest_rel):
                    target = omitted_pkg / dest_rel
                    saved = target.read_bytes()
                    target.unlink()
                    try:
                        proc = subprocess.run(
                            [sys.executable, '-I', '-c', check_script, str(omitted_pkg)],
                            cwd=tmp, env={'PATH': os.environ['PATH']},
                            capture_output=True, text=True, timeout=15,
                        )
                        self.assertNotEqual(proc.returncode, 0, f'omitting {dest_rel} unexpectedly passed')
                        combined = proc.stderr + proc.stdout
                        if dest_rel == 'python/scripts/digest_package_preflight.py':
                            self.assertIn('ModuleNotFoundError', combined)
                        else:
                            self.assertIn(f'missing_package_member:{dest_rel}', combined)
                        results.append({'member': dest_rel, 'rejected': True})
                    finally:
                        target.write_bytes(saved)
            self.assertEqual(len(results), len(manifest['members']))

            # Also prove direct runtime isolation rejects missing digest / provider / schema / JS members
            # even without calling verify_package first (zero absent-file substitution).
            direct_probes = [
                ('python/scripts/digest_roster_validator.py', [sys.executable, '-I', '-c',
                    f"import sys; sys.path.insert(0, {json.dumps(str(omitted_pkg / 'python/scripts'))}); import cloud_run_daily_digest"]),
                ('python/scripts/digest_roster_provider.py', [sys.executable, '-I', '-c',
                    f"import sys; sys.path.insert(0, {json.dumps(str(omitted_pkg / 'python/scripts'))}); import digest_roster_publication"]),
                ('python/scripts/account_daily_digest.py', [sys.executable, '-I', '-c',
                    f"import sys; sys.path.insert(0, {json.dumps(str(omitted_pkg / 'python/scripts'))}); import cloud_run_daily_digest"]),
                ('python/scripts/account_daily_facts.py', [sys.executable, '-I', '-c',
                    f"import sys; sys.path.insert(0, {json.dumps(str(omitted_pkg / 'python/scripts'))}); import cloud_run_daily_digest"]),
                ('schemas/qsl-digest-account-roster.v1.schema.json', [sys.executable, '-I', '-c',
                    f"import sys; sys.path.insert(0, {json.dumps(str(omitted_pkg / 'python/scripts'))}); import digest_roster_validator as v; v.verify_packaged_schemas()"]),
                ('web/strategy-switch-console/application/account_mapping/policy.js', [shutil.which('node'),
                    str(omitted_pkg / 'scripts/prepare_digest_enrollment_inputs.mjs'), '--input', str(tmp / 'missing.json')]),
            ]
            for dest_rel, cmd in direct_probes:
                with self.subTest(direct_omit=dest_rel):
                    target = omitted_pkg / dest_rel
                    saved = target.read_bytes()
                    target.unlink()
                    try:
                        proc = subprocess.run(cmd, cwd=tmp, env={'PATH': os.environ['PATH']},
                                              capture_output=True, text=True, timeout=15)
                        self.assertNotEqual(proc.returncode, 0, f'direct omission {dest_rel} passed')
                    finally:
                        target.write_bytes(saved)

            # Base-member version pin mismatch
            pinned = next(m for m in manifest['members'] if m['origin'] == 'base')
            target = omitted_pkg / pinned['destination']
            saved = target.read_bytes()
            target.write_bytes(saved + b'\n')
            try:
                proc = subprocess.run(
                    [sys.executable, '-I', '-c', check_script, str(omitted_pkg)],
                    cwd=tmp, env={'PATH': os.environ['PATH']},
                    capture_output=True, text=True, timeout=15,
                )
                self.assertNotEqual(proc.returncode, 0)
                self.assertIn(f"package_member_version_mismatch:{pinned['destination']}", proc.stderr)
            finally:
                target.write_bytes(saved)


class PrepEdgeInventoryTests(unittest.TestCase):
    """RESCOPE §11 item 7 independent edge/resource-load inventory comparison on PREP + producer."""

    def test_prep_and_producer_entries_pass_independent_inventory_and_role_closure(self):
        with tempfile.TemporaryDirectory(prefix='qsl-b3a-inv-') as directory:
            pkg = Path(directory) / 'pkg'
            manifest = _materialize_manifest(pkg)
            exercised = {
                'web/strategy-switch-console/application/runtime_instances/account_management.js',
                'web/strategy-switch-console/application/runtime_instances/account_management_readback.js',
                'web/strategy-switch-console/application/account_mapping/inventory_adapter.js',
                'web/strategy-switch-console/application/runtime_instances/mapping_projection.js',
                'schemas/qsl-digest-account-roster.v1.schema.json',
                'schemas/qsl-digest-enrollment-selection.v1.schema.json',
                'schemas/qsl-digest-enrollment-artifact.v1.schema.json',
            }
            for entry, allowed_roles in (
                ('js_preparer', {'preparer', 'both'}),
                ('python_preparer', {'preparer', 'both'}),
                ('preflight', {'preparer', 'both'}),
                ('provider', {'generation', 'both'}),
                ('producer_publication', {'generation', 'both'}),
            ):
                with self.subTest(entry=entry):
                    res = preflight.verify_entry_inventory(
                        pkg, manifest, entry, allowed_roles=allowed_roles, exercised_nonliteral=exercised,
                    )
                    self.assertGreater(len(res['edges']), 0)

            # Unexercised closed-mapping target must fail.
            with self.assertRaisesRegex(ValueError, '^unexercised_nonliteral_target:'):
                preflight.verify_entry_inventory(
                    pkg, manifest, 'js_preparer',
                    exercised_nonliteral=exercised - {'web/strategy-switch-console/application/runtime_instances/mapping_projection.js'},
                )

    def test_delete_declaration_with_both_endpoints_installed_fails_for_every_shipped_edge_class(self):
        with tempfile.TemporaryDirectory(prefix='qsl-b3a-edge-') as directory:
            pkg = Path(directory) / 'pkg'
            base_manifest = _materialize_manifest(pkg)

            # 1-5: Shipped edge classes in the actual manifest (both endpoints stay installed on disk!)
            shipped_deletions = [
                ('python_static_import', 'python_preparer', 'python/scripts/project_digest_display_roster.py', 'digest_roster_authority'),
                ('js_static_import', 'js_preparer', 'web/strategy-switch-console/application/account_mapping/inventory_adapter.js', 'web/strategy-switch-console/application/account_mapping/policy.js'),
                ('js_mapped_dynamic_import', 'js_preparer', 'scripts/prepare_digest_enrollment_inputs.mjs', 'web/strategy-switch-console/application/runtime_instances/mapping_projection.js'),
                ('data_load', 'python_preparer', 'python/scripts/display_names.py', 'python/scripts/display_names.json'),
                ('schema_load', 'python_preparer', 'python/scripts/digest_roster_validator.py', 'schemas/qsl-digest-account-roster.v1.schema.json'),
                ('status_load', 'preflight', 'python/scripts/digest_package_preflight.py', 'web/strategy-switch-console/application/runtime_instances/account_management_text.js'),
                ('js_script_load', 'python_preparer', 'python/scripts/project_digest_display_roster.py', 'scripts/prepare_digest_enrollment_inputs.mjs'),
            ]
            for edge_class, entry, src_dest, removed_imp in shipped_deletions:
                with self.subTest(edge_class=edge_class):
                    mut = deepcopy(base_manifest)
                    member = next(m for m in mut['members'] if m['destination'] == src_dest)
                    self.assertIn(removed_imp, member['imports'])
                    member['imports'].remove(removed_imp)
                    with self.assertRaisesRegex(ValueError, '^undeclared_package_edge:'):
                        preflight.verify_entry_inventory(pkg, mut, entry)

            # Role-crossing violation: PREP entry reaching a generation-only member fails even when present.
            mut_role = deepcopy(base_manifest)
            auth = next(m for m in mut_role['members'] if m['destination'] == 'python/scripts/digest_roster_authority.py')
            auth['imports'].append('digest_roster_provider')
            prov = next(m for m in mut_role['members'] if m['destination'] == 'python/scripts/digest_roster_provider.py')
            prov['suppliers']['python_preparer'] = 'b3_overlay:preparer_inventory'
            with self.assertRaisesRegex(ValueError, '^role_closure_violation:'):
                preflight.verify_entry_inventory(pkg, mut_role, 'python_preparer', allowed_roles={'preparer', 'both'})

            # Probe additional §11 item 7 edge classes on synthetic isolated modules inside pkg:
            # - nested Python import, literal importlib.import_module & __import__,
            # - JS export-from re-export, literal dynamic import & require,
            # - JSON schema external $ref,
            # - JS comment ignoring (commented import does NOT trigger false edge).
            probe_dir = pkg / 'python/scripts'
            (probe_dir / 'probe_target.py').write_text('VALUE = 1\n', encoding='utf-8')
            (probe_dir / 'probe_entry.py').write_text(
                'import importlib\n'
                'def nested():\n'
                '    import probe_target\n'
                '    importlib.import_module("display_names")\n'
                '    __import__("digest_roster_validator")\n'
                '    return probe_target.VALUE\n',
                encoding='utf-8',
            )
            (pkg / 'scripts/probe_dep.mjs').write_text('export const x = 1;\n', encoding='utf-8')
            (pkg / 'scripts/probe_entry.mjs').write_text(
                '// import "./nonexistent_comment_only.mjs";\n'
                '/* require("./also_comment.mjs") */\n'
                'export { x } from "./probe_dep.mjs";\n'
                'const mod = await import("./probe_dep.mjs");\n'
                'const req = require("./probe_dep.mjs");\n',
                encoding='utf-8',
            )
            (pkg / 'schemas/probe-parent.schema.json').write_text(
                json.dumps({'$ref': './qsl-digest-enrollment-selection.v1.schema.json'}), encoding='utf-8',
            )

            probe_manifest = deepcopy(base_manifest)
            probe_manifest['entry_points']['probe_py'] = 'probe_entry.main'
            probe_manifest['entry_points']['probe_js'] = 'scripts/probe_entry.mjs'
            for m in probe_manifest['members']:
                if m['destination'] in {
                    'python/scripts/display_names.py',
                    'python/scripts/display_names.json',
                    'python/scripts/digest_roster_validator.py',
                    'schemas/qsl-digest-account-roster.v1.schema.json',
                    'schemas/qsl-digest-enrollment-selection.v1.schema.json',
                    'schemas/qsl-digest-enrollment-artifact.v1.schema.json',
                }:
                    m['suppliers']['probe_py'] = 'test:probe'
            probe_manifest['members'].extend([
                {
                    'source': 'python/scripts/probe_target.py',
                    'destination': 'python/scripts/probe_target.py',
                    'origin': 'b3_overlay', 'dependency_role': 'preparer', 'kind': 'module',
                    'suppliers': {'probe_py': 'test:probe'}, 'imports': [],
                },
                {
                    'source': 'python/scripts/probe_entry.py',
                    'destination': 'python/scripts/probe_entry.py',
                    'origin': 'b3_overlay', 'dependency_role': 'preparer', 'kind': 'module',
                    'suppliers': {'probe_py': 'test:probe'},
                    'imports': ['probe_target', 'display_names', 'digest_roster_validator'],
                },
                {
                    'source': 'scripts/probe_dep.mjs',
                    'destination': 'scripts/probe_dep.mjs',
                    'origin': 'b3_overlay', 'dependency_role': 'preparer', 'kind': 'js_module',
                    'suppliers': {'probe_js': 'test:probe'}, 'imports': [],
                },
                {
                    'source': 'scripts/probe_entry.mjs',
                    'destination': 'scripts/probe_entry.mjs',
                    'origin': 'b3_overlay', 'dependency_role': 'preparer', 'kind': 'js_module',
                    'suppliers': {'probe_js': 'test:probe'}, 'imports': ['scripts/probe_dep.mjs'],
                },
            ])
            py_res = preflight.verify_entry_inventory(pkg, probe_manifest, 'probe_py')
            edge_classes_py = {e.edge_class for e in py_res['edges'] if e.source == 'python/scripts/probe_entry.py'}
            self.assertEqual(edge_classes_py, {'python_import', 'python_dynamic_import'})

            js_res = preflight.verify_entry_inventory(pkg, probe_manifest, 'probe_js')
            edge_classes_js = {e.edge_class for e in js_res['edges'] if e.source == 'scripts/probe_entry.mjs'}
            self.assertEqual(edge_classes_js, {'js_static_import', 'js_dynamic_import', 'js_require'})

            schema_edges = preflight.scan_schema_edges('schemas/probe-parent.schema.json', pkg)
            self.assertEqual(
                [(e.edge_class, e.target) for e in schema_edges],
                [('schema_ref', 'schemas/qsl-digest-enrollment-selection.v1.schema.json')],
            )

            # Deleting each probe declaration fails undeclared_package_edge while both endpoints remain installed.
            for imp_name in ('probe_target', 'display_names', 'digest_roster_validator'):
                mut_p = deepcopy(probe_manifest)
                next(m for m in mut_p['members'] if m['destination'] == 'python/scripts/probe_entry.py')['imports'].remove(imp_name)
                with self.assertRaisesRegex(ValueError, '^undeclared_package_edge:'):
                    preflight.verify_entry_inventory(pkg, mut_p, 'probe_py')

            mut_j = deepcopy(probe_manifest)
            next(m for m in mut_j['members'] if m['destination'] == 'scripts/probe_entry.mjs')['imports'].remove('scripts/probe_dep.mjs')
            with self.assertRaisesRegex(ValueError, '^undeclared_package_edge:'):
                preflight.verify_entry_inventory(pkg, mut_j, 'probe_js')

            # Unmapped nonliteral Python/JS imports fail.
            (probe_dir / 'probe_bad.py').write_text('import importlib\nx = "display_names"\nimportlib.import_module(x)\n', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, '^unresolved_nonliteral_import:'):
                preflight.scan_python_edges('python/scripts/probe_bad.py', pkg, None, {m['destination']: m for m in probe_manifest['members']})
            (pkg / 'scripts/probe_bad.mjs').write_text('const p = "./probe_dep.mjs"; await import(p);\n', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, '^unresolved_nonliteral_import:'):
                preflight.scan_js_edges('scripts/probe_bad.mjs', pkg, None)


if __name__ == '__main__':
    unittest.main()
