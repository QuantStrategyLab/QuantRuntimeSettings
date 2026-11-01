"""Offline synthetic regression tests; no production credentials or requests."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('console_config_compare', ROOT / 'scripts/console_config_compare.py')
compare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compare)


def fixture():
    config = {
        'name': 'demo-console', 'account_id': 'a' * 32, 'main': 'worker.js',
        'compatibility_date': '2026-06-08', 'workers_dev': True, 'preview_urls': True,
        'vars': {'FEATURE': 'true'},
        'kv_namespaces': [{'binding': 'CACHE', 'id': 'b' * 32}],
        'durable_objects': {'bindings': [{'name': 'STATE', 'class_name': 'State'}]},
        'migrations': [{'tag': 'v1', 'new_sqlite_classes': ['State']}],
        'triggers': {'crons': ['*/5 * * * *']},
    }
    bindings = [
        {'name': 'FEATURE', 'type': 'plain_text', 'text': 'true'},
        {'name': 'CACHE', 'type': 'kv_namespace', 'namespace_id': 'b' * 32},
        {'name': 'STATE', 'type': 'durable_object_namespace', 'class_name': 'State', 'namespace_id': 'c' * 32},
        {'name': 'PRIVATE_NAME_SENTINEL', 'type': 'secret_text'},
    ]
    live = {
        'settings': {'bindings': bindings, 'compatibility_date': '2026-06-08',
                     'compatibility_flags': [], 'observability': {'enabled': False}},
        'version_bindings': copy.deepcopy(bindings),
        'runtime': {'compatibility_date': '2026-06-08', 'compatibility_flags': [], 'migration_tag': 'v1'},
        'secrets': [{'name': 'PRIVATE_NAME_SENTINEL', 'type': 'secret_text'}],
        'namespaces': [{'id': 'c' * 32, 'class': 'State', 'script': 'demo-console', 'use_sqlite': True}],
        'subdomain': {'enabled': True, 'previews_enabled': True},
        'schedules': {'schedules': [{'cron': '*/5 * * * *'}]},
        'routes': [], 'domains': [],
    }
    return config, live


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.config, self.live = fixture()
        self.env = patch.dict(os.environ, {'CLOUDFLARE_ACCOUNT_ID': 'a' * 32})
        self.env.start()
        self.addCleanup(self.env.stop)

    def rows(self):
        return compare.compare(self.config, self.live)

    def assertBlocked(self):
        self.assertTrue(any(row['status'] != 'match' for row in self.rows()))

    def mutate_bindings(self, mutation):
        mutation(self.live['settings']['bindings'])
        mutation(self.live['version_bindings'])

    def assertBindingCheckBlocked(self):
        rows = self.rows()
        self.assertEqual(next(row for row in rows if row['item'] == 'bindings.active_version')['status'], 'match')
        self.assertTrue(any(row['status'] != 'match' and row['item'] != 'bindings.active_version' for row in rows), rows)

    def test_all_match_and_no_private_output(self):
        rows = self.rows()
        self.assertTrue(all(row['status'] == 'match' for row in rows), rows)
        output = json.dumps(rows)
        for private in ['PRIVATE_NAME_SENTINEL', 'a' * 32, 'b' * 32, 'c' * 32, 'demo-console']:
            self.assertNotIn(private, output)

    def test_each_binding_value_change_or_removal_blocks(self):
        for index, field in [(0, 'text'), (1, 'namespace_id'), (2, 'class_name'), (3, 'name')]:
            with self.subTest(index=index):
                _, self.live = fixture()
                self.mutate_bindings(lambda bindings: bindings[index].__setitem__(field, 'PRIVATE_VALUE_SENTINEL'))
                self.assertBindingCheckBlocked()
                self.assertNotIn('PRIVATE_VALUE_SENTINEL', json.dumps(self.rows()))
                _, self.live = fixture()
                self.mutate_bindings(lambda bindings: bindings.pop(index))
                self.assertBindingCheckBlocked()

    def test_remote_only_binding_duplicate_and_secret_collision_block(self):
        for binding in [
            {'name': 'EXTRA_PRIVATE', 'type': 'plain_text', 'text': 'PRIVATE_VALUE'},
            {'name': 'CACHE', 'type': 'kv_namespace', 'namespace_id': 'b' * 32},
        ]:
            with self.subTest(binding=binding['type']):
                _, self.live = fixture()
                self.mutate_bindings(lambda bindings: bindings.append(dict(binding)))
                self.assertBindingCheckBlocked()
                self.assertNotIn('EXTRA_PRIVATE', json.dumps(self.rows()))

        def secret_collision(bindings):
            bindings[0]['type'] = 'secret_text'

        _, self.live = fixture()
        self.mutate_bindings(secret_collision)
        self.assertBindingCheckBlocked()

    def test_declared_runtime_settings_require_active_version_values(self):
        for key, value in [('usage_model', 'standard'), ('limits', {'cpu_ms': 10})]:
            with self.subTest(key=key):
                self.config, self.live = fixture()
                self.config[key] = value
                self.live['settings'][key] = value
                rows = {row['item']: row for row in self.rows()}
                self.assertEqual(rows['settings.' + key]['status'], 'match')
                self.assertIn('runtime.' + key, rows)
                self.assertEqual(rows['runtime.' + key]['reason'], 'missing_runtime_setting')
                self.assertEqual(rows['runtime.' + key]['status'], 'unreadable')
                self.live['runtime'][key] = copy.deepcopy(value)
                self.assertTrue(all(row['status'] == 'match' for row in self.rows()))
                self.live['runtime'][key] = 'PRIVATE_VALUE_SENTINEL'
                self.assertBlocked()
                self.assertNotIn('PRIVATE_VALUE_SENTINEL', json.dumps(self.rows()))

    def test_settings_cron_routes_and_inventory_gaps_block(self):
        mutations = [
            lambda x: x['settings'].update(compatibility_date='2020-01-01'),
            lambda x: x['settings'].update(observability={'enabled': True}),
            lambda x: x['settings'].update(PRIVATE_KEY='PRIVATE_VALUE'),
            lambda x: x['settings'].update(limits={'cpu_ms': 10}),
            lambda x: x['settings'].pop('bindings'),
            lambda x: x.pop('secrets'),
            lambda x: x['runtime'].pop('migration_tag'),
            lambda x: x['subdomain'].update(previews_enabled=False),
            lambda x: x['schedules'].update(schedules=[{'cron': '* * * * *'}]),
            lambda x: x.update(routes=[{'pattern': 'PRIVATE_ROUTE'}]),
            lambda x: x.update(domains=[{'hostname': 'PRIVATE_DOMAIN'}]),
            lambda x: x['namespaces'][0].update(use_sqlite=False),
            lambda x: x['namespaces'][0].update(script='other-worker'),
            lambda x: x['version_bindings'].pop(),
        ]
        for mutation in mutations:
            _, self.live = fixture()
            mutation(self.live)
            self.assertBlocked()
            self.assertNotIn('PRIVATE_', json.dumps(self.rows()))

    def test_unknown_local_configuration_is_not_ignored(self):
        self.config['unsafe'] = {'metadata': {'PRIVATE_KEY': 'PRIVATE_VALUE'}}
        self.assertBlocked()

    def test_omitted_preview_setting_retains_only_readable_live_boolean(self):
        self.config.pop('preview_urls')
        for value in (True, False):
            self.live['subdomain']['previews_enabled'] = value
            self.assertTrue(all(row['status'] == 'match' for row in self.rows()))
        self.live['subdomain'].pop('previews_enabled')
        self.assertBlocked()
        self.live['subdomain']['previews_enabled'] = None
        self.assertBlocked()

    def test_exports_are_compared_when_present(self):
        self.live['runtime']['exports'] = {'State': {'type': 'durable-object', 'storage': 'sqlite'}, 'default': {'type': 'worker'}}
        self.assertTrue(all(row['status'] == 'match' for row in self.rows()))
        self.live['runtime']['exports']['State']['storage'] = 'legacy-kv'
        self.assertBlocked()

    def test_observation_change_blocks(self):
        after = copy.deepcopy(self.live)
        after['schedules']['schedules'] = []
        with patch.object(compare, 'snapshot', side_effect=[self.live, after]):
            rows = compare.run(self.config, object())
        self.assertEqual(rows[-1]['status'], 'mismatch')

    def test_http_reader_get_only_and_incomplete_inventory(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, limit): return json.dumps(self.body).encode()
            class headers:
                @staticmethod
                def get_content_type(): return 'application/json'
        response = Response()
        response.body = {'success': True, 'result': []}
        reader = compare.Reader('a' * 32, 'PRIVATE_TOKEN')
        requests = []
        def opened(request, timeout):
            requests.append(request)
            return response
        with patch.object(reader.opener, 'open', side_effect=opened):
            self.assertEqual(reader.get('secrets', 'workers/scripts/demo/secrets'), [])
            response.body['result_info'] = {'count': 1, 'total_count': 2, 'total_pages': 2}
            with self.assertRaises(compare.Unreadable):
                reader.get('secrets', 'workers/scripts/demo/secrets')
        self.assertTrue(all(request.method == 'GET' and request.data is None for request in requests))

    def test_exception_never_prints_secrets(self):
        with patch.object(Path, 'read_text', side_effect=ValueError('PRIVATE_TOKEN')), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(compare.main(), 1)
        self.assertNotIn('PRIVATE_TOKEN', out.getvalue())
        self.assertFalse(json.loads(out.getvalue())['all_match'])


class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = (ROOT / '.github/workflows/deploy-strategy-switch-console.yml').read_text()

    def test_dry_run_skips_every_existing_write_and_all_other_jobs(self):
        import re
        deploy = self.text.split('\n  deploy:\n')[1].split('\n  rollback:\n')[0]
        allowed = {'Checkout', 'Validate render-only inputs', 'Setup Python', 'Prepare Wrangler config',
                   'Compare rendered config with live without publishing', 'Remove render-only private config'}
        for step in re.split(r'\n      - name: ', deploy)[1:]:
            name = step.splitlines()[0]
            if name not in allowed:
                gate = re.search(r'^        if: (.+)$', step, re.M)
                self.assertIsNotNone(gate, name)
                self.assertIn('!inputs.render_and_compare_only', gate[1], name)
        for name, job in re.findall(r'^  (\w+):\n(.*?)(?=^  \w+:\n|\Z)', self.text.split('\njobs:\n')[1], re.M | re.S):
            if name != 'deploy':
                self.assertIn('!inputs.render_and_compare_only', job.split('runs-on:')[0], name)

    def test_conflicting_inputs_are_rejected_before_renderer(self):
        import re
        code = re.search(r"python3 - <<'PYINPUT'\n(.*?)\n          PYINPUT", self.text, re.S)[1]
        code = '\n'.join(line[10:] for line in code.splitlines())
        defaults = dict.fromkeys(['sync_secrets', 'sync_strategy_profiles', 'external_flow_enable',
                                 'read_only_preflight', 'diagnose_restore_target', 'check_explicit_version_inherit',
                                 'release_frontend_assets', 'backend_only_release', 'rollback_to_pre_release'], False)
        defaults.update(source_sha='', private_release_check='off', ibkr_candidate_resume='off')
        for key, value in [(None, None)] + [(k, True) for k, v in defaults.items() if v is False] + [('source_sha', 'old'), ('private_release_check', 'baseline'), ('ibkr_candidate_resume', 'activate')]:
            inputs = dict(defaults)
            if key: inputs[key] = value
            result = subprocess.run([sys.executable, '-c', code], env={'GITHUB_REF': 'refs/heads/main', 'DISPATCH_INPUTS': json.dumps(inputs)}, capture_output=True)
            self.assertEqual(result.returncode == 0, key is None, key)
        self.assertLess(self.text.index('Validate render-only inputs'), self.text.index('Prepare Wrangler config'))
        self.assertIn('[ "${RENDER_AND_COMPARE_ONLY:-false}" != true ]', self.text)


if __name__ == '__main__':
    unittest.main()
