"""Render from only Docker COPY inputs; the checkout must not supply missing assets."""
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class DigestImageBundleTests(unittest.TestCase):
    def test_notification_bundle_renders_without_the_source_checkout(self):
        dockerfile = (ROOT / 'python/Dockerfile.digest').read_text().replace('\\\n', ' ')
        with tempfile.TemporaryDirectory() as directory:
            bundle = Path(directory)
            for line in dockerfile.splitlines():
                if not line.startswith('COPY '):
                    continue
                tokens = shlex.split(line)[1:]
                destination = bundle / tokens[-1].lstrip('/')
                destination.mkdir(parents=True, exist_ok=True)
                for name in tokens[:-1]:
                    source = ROOT / name
                    if source.is_dir():
                        shutil.copytree(source, destination, dirs_exist_ok=True)
                    else:
                        shutil.copy2(source, destination / source.name)
            script = '''
import os, sys
sys.path.insert(0, sys.argv[1])
os.environ['QRS_UNIFIED_NOTIFICATION_ENABLED'] = 'true'
import cloud_run_daily_digest as app
expected = [{'platform_id':'ibkr', 'opaque_account_uid':'synthetic-account',
             'target_id':'synthetic-target', 'strategy_profile':'synthetic-strategy',
             'candidate_slot':'synthetic-slot'}]
configuration = app.Configuration(expected, 'projects/demo/locations/demo/jobs/digest',
                                  'synthetic', '2026-10-16')
text, coverage = app._report(configuration, [], ['missing'], '2026-10-15', None)
assert coverage == 'unavailable' and '未知' in text
print('bundle_render_verified')
'''
            result = subprocess.run([sys.executable, '-I', '-c', script, str(bundle / 'app/python/scripts')],
                                    cwd=bundle, env={'PATH': os.environ['PATH']},
                                    text=True, capture_output=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), 'bundle_render_verified')
            for obsolete in ('send_daily_digest_telegram.py', 'daily_digest_resend_guard.py'):
                self.assertFalse((bundle / 'app/python/scripts' / obsolete).exists())


if __name__ == '__main__':
    unittest.main()
