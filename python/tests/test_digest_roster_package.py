"""Isolated offline package fixture tests for B9 handoff (Q7, row 22)."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = ROOT / 'python' / 'scripts' / 'digest_package_manifest.json'


def _materialize_package(pkg_dir: Path, *, role: str = 'all'):
    manifest = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
    wanted = {'generation', 'both'} if role == 'generation' else ({'preparer', 'both'} if role == 'preparer' else {'generation', 'preparer', 'both'})
    # Materialize base members first, then B3 overlay members (overlay wins on shared paths).
    for origin in ('base', 'b3_overlay'):
        for member in manifest['members']:
            if member['origin'] != origin or member['dependency_role'] not in wanted:
                continue
            src = ROOT / member['source']
            dst = pkg_dir / member['destination']
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
    return manifest


class IsolatedPackageFixtureTests(unittest.TestCase):
    def test_manifest_covers_every_member_and_isolated_generation_succeeds(self):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
        self.assertEqual(manifest['format'], 'qsl_digest_package_manifest.v1')
        self.assertEqual(manifest['entry_points']['constructor'], 'cloud_run_daily_digest.Configuration')
        self.assertEqual(manifest['entry_points']['generation'], 'cloud_run_daily_digest.execute_slot')
        self.assertEqual(manifest['preparer_runtime_binding']['artifact_format'], 'qsl_digest_enrollment_artifact.v1')

        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            pkg = tmp / 'packaged-digest'
            _materialize_package(pkg, role='all')
            work = tmp / 'outside-checkout'
            work.mkdir()

            # Write synthetic test inputs in work dir (outside checkout).
            corpus = json.loads((ROOT / 'python/tests/fixtures/digest_roster_b2_corpus.json').read_text(encoding='utf-8'))
            fixture = json.loads((ROOT / 'tests/fixtures/account-mapping-roster.synthetic.json').read_text(encoding='utf-8'))
            prepared = corpus['preparations']['complete']
            js_bundle = {
                'instances': [
                    {**item, 'kind': 'existing', 'config': {**item['config'], 'account_scope': f'SYN-SCOPE-{idx + 1:02d}'}}
                    for idx, item in enumerate(fixture['instances'])
                ],
                'enrollment_links': fixture['enrollment_links'],
                'readback': prepared['readback'],
                'effective_export': prepared['effective_export'],
                'projection': prepared['projection'],
            }
            (work / 'js_bundle.json').write_text(json.dumps(js_bundle), encoding='utf-8')
            legacy_roster = [
                {'platform_id': link['platform_id'], 'candidate_slot': link['candidate_slot'],
                 'opaque_account_uid': link['opaque_account_uid'], 'target_id': link['target_id'],
                 'strategy_profile': f'syn_profile_{idx}'}
                for idx, link in enumerate(fixture['enrollment_links'])
            ]
            (work / 'legacy_roster.json').write_text(json.dumps(legacy_roster), encoding='utf-8')
            obs_bindings = [
                {'binding_id': f'obs-{idx:02d}', 'platform': g['deployments'][0]['platform'],
                 'legacy_key': g['deployments'][0]['key'], 'opaque_account_uid': None,
                 'broker_environment': g['scope'], 'account_scope': 'account'}
                for idx, g in enumerate(prepared['readback']['groups'])
                if g['scope'] in {'paper', 'live'}
            ]
            (work / 'obs_bindings.json').write_text(json.dumps(obs_bindings), encoding='utf-8')
            (work / 'readback.json').write_text(json.dumps(corpus['scenarios']['all_on']), encoding='utf-8')

            # Step 1: Run packaged Python preparer outside checkout in isolated python3 -I.
            artifact_out = work / 'artifact.json'
            selection_out = work / 'selection.json'
            prep_proc = subprocess.run(
                [sys.executable, '-I', str(pkg / 'python/scripts/project_digest_display_roster.py'),
                 'prepare-mapping',
                 '--js-bundle', str(work / 'js_bundle.json'),
                 '--legacy-roster', str(work / 'legacy_roster.json'),
                 '--observation-bindings', str(work / 'obs_bindings.json'),
                 '--source', 'synthetic-enrollment',
                 '--version', 'v1', '--membership-version', 'm1', '--label-version', 'l1', '--link-version', 'k1',
                 '--prepared-at', corpus['observed_at'],
                 '--artifact-output', str(artifact_out),
                 '--selection-output', str(selection_out)],
                cwd=work, env={'PATH': os.environ['PATH'], 'PYTHONPATH': str(pkg / 'python/scripts')},
                capture_output=True, text=True, timeout=30,
            )
            self.assertEqual(prep_proc.returncode, 0, prep_proc.stdout + prep_proc.stderr)
            self.assertIn('digest_mapping_prepared', prep_proc.stdout)

            # Step 2: Run packaged Python preflight + constructor + 10-account generation in isolated python3 -I.
            gen_script = """
import json, os, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
pkg = Path(sys.argv[1])
work = Path(sys.argv[2])
locale = sys.argv[3]
sys.path.insert(0, str(pkg / 'python' / 'scripts'))

import digest_package_preflight as preflight
checked = preflight.verify_package(pkg, role='generation')

import cloud_run_daily_digest as app
import digest_roster_authority as authority
import digest_roster_generation as generation

os.environ['QRS_UNIFIED_NOTIFICATION_ENABLED'] = 'true'
os.environ['DIGEST_DELIVERY_ENABLED'] = 'true'
os.environ['DIGEST_SCHEDULER_JOB_NAME'] = 'projects/synthetic/locations/synthetic/jobs/daily-digest'
os.environ['DIGEST_RECIPIENT_SCOPE'] = 'syn-scope'
os.environ['DIGEST_CUTOVER_REPORT_DATE'] = '2026-11-20'
os.environ['QSL_NOTIFY_LANG'] = locale
os.environ['DIGEST_ROSTER_BOOT_JSON'] = json.dumps({
    'mode': 'mapping_v1',
    'origin': 'https://console.example.invalid',
    'service_auth': {'issuer': 'syn-iss', 'audience': 'syn-aud', 'subjects': ['syn-sub']},
    'enrollment_source': 'synthetic-enrollment',
    'config_context': 'synthetic_context',
    'read_timeout': 10.0,
})
cfg = app.Configuration.from_environment()
readback_doc = json.loads((work / 'readback.json').read_text(encoding='utf-8'))
observed = datetime.fromisoformat(readback_doc['observed_at'].replace('Z', '+00:00'))
clock = observed + timedelta(seconds=15)

class PeerAuth:
    def assertion(self, method, path, audience, now):
        return authority.ServiceAssertion('tok', 'syn-iss', audience, 'syn-sub', now + timedelta(minutes=5), method, path)

class PeerTransport:
    def get(self, url, headers, timeout):
        return authority.TransportResponse(200, {'content-type': 'application/json', 'cache-control': 'private, no-store'},
                                          json.dumps(readback_doc).encode('utf-8'), url)

class PeerEnrollment:
    def read_selection(self):
        return authority.SourceRead('synthetic-enrollment', True, (work / 'selection.json').read_bytes())
    def read_artifact(self, sel):
        return authority.SourceRead('synthetic-enrollment', True, (work / 'artifact.json').read_bytes())

class PeerStore:
    def __init__(self):
        self.records = {}
    def candidate(self, key, timeout): return None
    def reserve(self, key, rec): self.records[key] = rec; return True, 1
    def finish(self, key, gen, rec): self.records[key] = rec
    def delivery(self, key): return self.records.get(key)

runner = generation.GenerationRunner(
    cfg.roster_boot,
    authority.AcquisitionClient(cfg.roster_boot, PeerAuth(), PeerTransport()),
    PeerEnrollment(), lambda: clock, recipient_scope='syn-scope',
)
sent = []
report_date = datetime(2026, 11, 20, 7, 0, tzinfo=app.SGT)
platform_cfg = json.loads((pkg / 'platform-config.json').read_text(encoding='utf-8'))
code, res = app.execute_slot(
    report_date.date(), '2026-11-19', False,
    {'scheduled_at': report_date.isoformat(), 'trigger_provenance': 'cloud_scheduler'},
    cfg, PeerStore(), lambda text: (sent.append(text), 1)[1],
    now=lambda: report_date, platform_config=platform_cfg, roster_runner=runner,
)
assert code == 200 and res['delivery'] == 'accepted', (code, res)
headers = [line for line in sent[0].splitlines() if line.startswith('🏦 ')]
assert len(headers) == 10, headers
origins = preflight.assert_isolated_imports(pkg)
assert all(isinstance(path, str) and not path.startswith('/') and '..' not in path for path in origins.values())
assert origins['notification_snapshot.unified_contract'] == 'python/scripts/notification_snapshot/unified_contract.py'
resources = preflight.resource_origins(pkg)
print(json.dumps({'checked': len(checked), 'headers': len(headers), 'origins': len(origins),
                  'resources': len(resources)}))
"""
            for locale in ('en', 'zh'):
                gen_proc = subprocess.run(
                    [sys.executable, '-I', '-c', gen_script, str(pkg), str(work), locale],
                    cwd=work, env={'PATH': os.environ['PATH']},
                    capture_output=True, text=True, timeout=30,
                )
                self.assertEqual(gen_proc.returncode, 0, gen_proc.stdout + gen_proc.stderr)
                result = json.loads(gen_proc.stdout.strip())
                self.assertEqual(result['headers'], 10)
                self.assertGreater(result['origins'], 10)

    def test_single_member_omission_rejects_every_required_generation_member(self):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
        gen_members = [m for m in manifest['members'] if m['dependency_role'] in {'generation', 'both'}]
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            base_pkg = tmp / 'base-pkg'
            _materialize_package(base_pkg, role='generation')
            work = tmp / 'work'
            work.mkdir()

            check_script = """
import sys
from pathlib import Path
pkg = Path(sys.argv[1])
sys.path.insert(0, str(pkg / 'python' / 'scripts'))
import digest_package_preflight as preflight
preflight.verify_package(pkg, role='generation')
"""
            for member in gen_members:
                dest_rel = member['destination']
                with self.subTest(omitted=dest_rel):
                    omitted_pkg = tmp / 'omitted'
                    if omitted_pkg.exists():
                        shutil.rmtree(omitted_pkg)
                    shutil.copytree(base_pkg, omitted_pkg)
                    (omitted_pkg / dest_rel).unlink()
                    proc = subprocess.run(
                        [sys.executable, '-I', '-c', check_script, str(omitted_pkg)],
                        cwd=work, env={'PATH': os.environ['PATH']},
                        capture_output=True, text=True, timeout=15,
                    )
                    self.assertNotEqual(proc.returncode, 0, f'omission of {dest_rel} unexpectedly passed')
                    if dest_rel != 'python/scripts/digest_package_preflight.py':
                        self.assertIn(dest_rel, proc.stderr + proc.stdout)

    def test_all_role_omission_and_base_pin_are_rejected_by_member(self):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
        check_script = """
import sys
from pathlib import Path
pkg = Path(sys.argv[1])
sys.path.insert(0, str(pkg / 'python' / 'scripts'))
import digest_package_preflight as preflight
preflight.verify_package(pkg, role='all')
"""
        kinds = {member['kind'] for member in manifest['members']}
        self.assertIn('status_resource', kinds)
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            base_pkg = tmp / 'base-pkg'
            _materialize_package(base_pkg, role='all')

            def run(pkg):
                return subprocess.run([sys.executable, '-I', '-c', check_script, str(pkg)], cwd=tmp,
                                      env={'PATH': os.environ['PATH']}, capture_output=True, text=True, timeout=15)
            self.assertEqual(run(base_pkg).returncode, 0)
            rejected = 0
            for member in manifest['members']:
                with self.subTest(omitted=member['destination']):
                    omitted = tmp / 'omitted'
                    if omitted.exists():
                        shutil.rmtree(omitted)
                    shutil.copytree(base_pkg, omitted)
                    (omitted / member['destination']).unlink()
                    proc = run(omitted)
                    self.assertNotEqual(proc.returncode, 0)
                    if member['destination'] != 'python/scripts/digest_package_preflight.py':
                        self.assertIn(f"missing_package_member:{member['destination']}", proc.stderr)
                    rejected += 1
            self.assertEqual(rejected, len(manifest['members']))
            # A base member that differs from the pinned synthetic base.
            pinned = next(member for member in manifest['members'] if member['origin'] == 'base')
            self.assertRegex(pinned['sha256'], '^[0-9a-f]{64}$')
            with open(base_pkg / pinned['destination'], 'ab') as handle:
                handle.write(b'\n')
            proc = run(base_pkg)
            self.assertIn(f"package_member_version_mismatch:{pinned['destination']}", proc.stderr)


if __name__ == '__main__':
    unittest.main()
