"""Offline synthetic regression tests; no production credentials or requests."""
import contextlib
import copy
import importlib.util
import io
import json
import os
import subprocess
import sys
import unittest
from email.message import Message
from pathlib import Path
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

    def test_empty_flags_match_omitted_null_or_empty_api_flags(self):
        for rendered in (compare.MISSING, []):
            for setting in (compare.MISSING, None, []):
                for runtime in (compare.MISSING, None, []):
                    with self.subTest(rendered=rendered, setting=setting, runtime=runtime):
                        self.config, self.live = fixture()
                        if rendered is not compare.MISSING:
                            self.config['compatibility_flags'] = rendered
                        for source, value in [(self.live['settings'], setting), (self.live['runtime'], runtime)]:
                            source.pop('compatibility_flags', None)
                            if value is not compare.MISSING:
                                source['compatibility_flags'] = value
                        self.assertTrue(all(row['status'] == 'match' for row in self.rows()), self.rows())

    def test_nonempty_or_invalid_flags_still_block_real_differences(self):
        for scope in ('settings', 'runtime'):
            for actual in (compare.MISSING, None, [], ['different_flag'], {}, False):
                with self.subTest(scope=scope, actual=actual):
                    self.config, self.live = fixture()
                    self.config['compatibility_flags'] = ['nodejs_compat']
                    for source in (self.live['settings'], self.live['runtime']):
                        source['compatibility_flags'] = ['nodejs_compat']
                    self.assertTrue(all(row['status'] == 'match' for row in self.rows()))
                    self.live[scope].pop('compatibility_flags')
                    if actual is not compare.MISSING:
                        self.live[scope]['compatibility_flags'] = actual
                    row = next(row for row in self.rows() if row['item'] == scope + '.compatibility_flags')
                    self.assertNotEqual(row['status'], 'match')
                    if actual is compare.MISSING:
                        self.assertEqual(row['reason'], 'missing_setting' if scope == 'settings' else 'missing_runtime_setting')
            for actual in (['nodejs_compat'], {}, False, ''):
                self.config, self.live = fixture()
                self.live[scope]['compatibility_flags'] = actual
                self.assertBlocked()
        for rendered in (None, {}, '', False, [None], ['']):
            self.config, self.live = fixture()
            self.config['compatibility_flags'] = rendered
            self.live['settings']['compatibility_flags'] = rendered
            self.live['runtime']['compatibility_flags'] = rendered
            self.assertBlocked()
        for scope in ('settings', 'runtime'):
            self.config, self.live = fixture()
            self.live[scope].pop('compatibility_date')
            self.assertBlocked()

    def test_no_placement_empty_tags_and_absent_observability_match(self):
        self.config['placement'] = {'mode': 'off'}
        self.live['settings'].update(placement={}, tags=[])
        self.live['settings'].pop('observability')
        self.live['runtime'].pop('compatibility_flags')
        self.assertTrue(all(row['status'] == 'match' for row in self.rows()), self.rows())
        self.live['settings'].pop('placement')
        self.assertTrue(all(row['status'] == 'match' for row in self.rows()))

    def test_optional_settings_absence_and_real_live_only_values(self):
        for key, value in [('placement', {'mode': 'smart'}), ('tags', ['synthetic-tag']),
                           ('observability', {'enabled': True})]:
            with self.subTest(key=key):
                self.config, self.live = fixture()
                self.live['settings'].pop(key, None)
                self.assertTrue(all(row['status'] == 'match' for row in self.rows()))
                self.live['settings'][key] = value
                row = next(row for row in self.rows() if row['item'] == 'settings.' + key)
                self.assertEqual(row['status'], 'unreadable')
                self.assertEqual(row['reason'], 'undeclared_effective_setting')
                if key == 'tags':
                    # Pinned Wrangler ignores top-level tags. Never present a
                    # fictitious declaration as an effective configuration.
                    self.config[key] = copy.deepcopy(value)
                    self.assertBlocked()
                    continue
                self.config[key] = copy.deepcopy(value)
                self.assertTrue(all(row['status'] == 'match' for row in self.rows()))
                self.live['settings'].pop(key)
                self.assertBlocked()
                self.live['settings'][key] = None
                self.assertBlocked()
        self.config, self.live = fixture()
        self.config['placement'] = {'mode': 'off'}
        self.live['settings']['placement'] = {'mode': 'smart'}
        self.assertBlocked()
        self.config['placement']['hint'] = 'synthetic-region'
        self.live['settings']['placement'] = {}
        self.assertBlocked()
        # Empty provider objects must not erase an explicit logging declaration.
        self.config, self.live = fixture()
        self.config['observability'] = {'enabled': False}
        self.live['settings'].pop('observability')
        self.assertBlocked()
        for tags in ([], ['synthetic-tag']):
            self.config, self.live = fixture()
            self.config['tags'] = tags
            self.live['settings']['tags'] = tags
            self.assertBlocked()

    def test_unsupported_fields_emit_only_sanitized_names_and_remain_blocked(self):
        cases = [('settings', 'unsupported_live_setting'), ('config', 'unsupported_config_key'),
                 ('subdomain', 'unsupported_subdomain_setting'), ('runtime', 'unmapped_runtime_setting')]
        for scope, reason in cases:
            for name in ('annotations', 'A_0.key-name', 'x' * 64, '', 'x' * 65,
                         'bad/name', 'bad=PRIVATE_TOKEN', 'bad\nPRIVATE_TOKEN', '非法字段'):
                with self.subTest(scope=scope, name=name):
                    self.config, self.live = fixture()
                    target = self.config if scope == 'config' else self.live[scope]
                    target[name] = {'token': 'PRIVATE_TOKEN_VALUE', 'account_id': 'a' * 32,
                                    'nested_secret': ['PRIVATE_SECRET_VALUE']}
                    rows = self.rows()
                    row = next(row for row in rows if row.get('reason') == reason)
                    self.assertEqual(row['status'], 'unreadable')
                    valid = name in ('annotations', 'A_0.key-name', 'x' * 64)
                    self.assertEqual(row['field'], name if valid else '<unsupported-field>')
                    output = json.dumps(rows, ensure_ascii=False)
                    for private in ('PRIVATE_TOKEN', 'PRIVATE_SECRET', 'nested_secret', 'account_id',
                                    'PRIVATE_NAME_SENTINEL', 'a' * 32):
                        self.assertNotIn(private, output)
                    if not valid and name:
                        self.assertNotIn(name, output)

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
            self.assertNotIn('PRIVATE_VALUE', json.dumps(self.rows()))

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


class DeploymentReaderTests(unittest.TestCase):
    def setUp(self):
        self.reader = compare.Reader('a' * 32, 'PRIVATE_TOKEN_SENTINEL')
        self.requests = []
        self.body = {'success': True, 'errors': [], 'result': {'deployments': [self.entry()]}}
        self.headers = Message()
        self.headers['Content-Type'] = 'application/json; charset=utf-8'
        self.status = 200
        self.raw = None

        def opened(request, timeout):
            self.requests.append(request)
            response = unittest.mock.MagicMock()
            response.__enter__.return_value = response
            response.status, response.headers = self.status, self.headers
            response.read.return_value = self.raw if self.raw is not None else json.dumps(self.body).encode()
            return response

        self.open_patch = patch.object(self.reader.opener, 'open', side_effect=opened)
        self.open_patch.start()
        self.addCleanup(self.open_patch.stop)

    @staticmethod
    def entry(**values):
        return dict({'id': '11111111-1111-4111-8111-111111111111',
                     'created_on': '2026-01-02T00:00:00.000000Z', 'strategy': 'percentage',
                     'versions': [{'version_id': '22222222-2222-4222-8222-222222222222',
                                   'percentage': 100.0}]}, **values)

    def read_active(self):
        return compare.active(self.reader.get('deployment', 'workers/scripts/demo-console/deployments'))

    def output_failure(self):
        with patch.object(Path, 'read_text', return_value='name = "demo-console"\naccount_id = "' + 'a' * 32 + '"'), \
                patch.dict(os.environ, {'CLOUDFLARE_ACCOUNT_ID': 'a' * 32, 'CLOUDFLARE_API_TOKEN': 'PRIVATE_TOKEN_SENTINEL'}), \
                patch.object(compare, 'Reader', return_value=self.reader), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(compare.main(), 1)
        report = json.loads(out.getvalue())
        self.assertFalse(report['all_match'])
        self.assertTrue(report['read_only'])
        self.assertEqual(report['writes'], 0)
        self.assertNotIn('PRIVATE_', out.getvalue())
        self.assertNotIn('https://', out.getvalue())
        self.assertNotIn('a' * 32, out.getvalue())
        self.assertTrue(all(r.method == 'GET' and r.data is None for r in self.requests))
        return report['items'][0]

    def test_documented_first_page_with_more_history_is_readable(self):
        # The endpoint guarantees the latest deployment on the first page;
        # deployment history is not a binding/secret/route inventory.
        self.body['result_info'] = {'page': 1, 'count': 1, 'per_page': 20,
                                    'total_count': 2000, 'total_pages': 100}
        self.assertEqual(self.read_active(), (self.entry()['id'], self.entry()['versions'][0]['version_id']))

    def test_optional_pagination_counts_are_not_zero(self):
        for info in ({'page': 1, 'total_count': 2000}, None, {}):
            with self.subTest(info=info):
                self.body['result_info'] = info
                self.assertEqual(self.read_active()[0], self.entry()['id'])

    def test_both_list_shapes_and_both_orders_use_latest_timestamp(self):
        old = self.entry(id='33333333-3333-4333-8333-333333333333', created_on='2026-01-01T01:00:00+01:00')
        for key in ('deployments', 'items'):
            for entries in ([old, self.entry()], [self.entry(), old]):
                with self.subTest(key=key, first=entries[0]['created_on']):
                    self.body['result'] = {key: entries}
                    self.assertEqual(self.read_active()[0], self.entry()['id'])

    def test_latest_multi_version_cannot_fall_back_to_older_single_version(self):
        old = self.entry(id='33333333-3333-4333-8333-333333333333', created_on='2026-01-01T00:00:00Z')
        split = self.entry(versions=[
            dict(self.entry()['versions'][0], percentage=50),
            {'version_id': '44444444-4444-4444-8444-444444444444', 'percentage': 50},
        ])
        for entries in ([old, split], [split, old]):
            self.body['result'] = {'deployments': entries}
            self.assertEqual(self.output_failure()['reason'], 'deployment_schema:active_not_single')

    def test_single_entry_without_timestamp_needs_no_ordering(self):
        entry = self.entry()
        del entry['created_on']
        self.body['result'] = {'deployments': [entry]}
        self.assertEqual(self.read_active()[0], entry['id'])

    def test_ambiguous_or_unknown_deployment_results_block(self):
        old = self.entry(id='33333333-3333-4333-8333-333333333333', created_on='2026-01-01T00:00:00Z')
        missing = self.entry()
        del missing['created_on']
        cases = [
            ({'deployments': [], 'items': [self.entry()]}, 'deployment_shape'),
            ({'deployments': [self.entry()], 'latest': old}, 'deployment_shape'),
            ({'items': [self.entry()], 'has_more': True}, 'deployment_shape'),
            ({'latest': self.entry()}, 'deployment_shape'),
            ([self.entry()], 'deployment_shape'),
            ({'deployments': []}, 'deployment_shape'),
            ({'deployments': [None]}, 'deployment_shape'),
            ({'deployments': [old, missing]}, 'deployment_timestamp'),
            ({'deployments': [old, self.entry(created_on='PRIVATE_DATE')]}, 'deployment_timestamp'),
            ({'deployments': [self.entry(created_on='2026-01-02T00:00:00')]}, 'deployment_timestamp'),
            ({'deployments': [self.entry(), self.entry(id=old['id'])]}, 'deployment_ambiguous'),
            ({'deployments': [self.entry(), self.entry()]}, 'deployment_ambiguous'),
            ({'deployments': [self.entry(strategy='PRIVATE_STRATEGY')]}, 'active_not_single'),
            ({'deployments': [self.entry(id=123)]}, 'active_not_single'),
            ({'deployments': [self.entry(id='-' * 36)]}, 'active_not_single'),
            ({'deployments': [self.entry(versions=[None])]}, 'active_not_single'),
            ({'deployments': [self.entry(versions=[{'version_id': 123, 'percentage': 100}])]}, 'active_not_single'),
            ({'deployments': [self.entry(versions=[{'version_id': '-' * 36, 'percentage': 100}])]}, 'active_not_single'),
            ({'deployments': [self.entry(versions=self.entry()['versions'] * 2)]}, 'active_not_single'),
            ({'deployments': [self.entry(versions=[dict(self.entry()['versions'][0], percentage='100')])]}, 'active_not_single'),
            ({'deployments': [self.entry(versions=[dict(self.entry()['versions'][0], percentage=99.9)])]}, 'active_not_single'),
        ]
        for result, code in cases:
            with self.subTest(code=code, result=result):
                self.body['result'] = result
                self.assertEqual(self.output_failure()['reason'], 'deployment_schema:' + code)

    def test_first_page_validation_and_inventory_pagination_remain_closed(self):
        for info in ({'page': 2}, {'cursor': 'PRIVATE_CURSOR'}, {'cursors': {'after': 'PRIVATE_CURSOR'}},
                     {'cursors': None}, {'total_pages': 'PRIVATE_VALUE'}, [], {'page': True},
                     {'count': -1}, {'count': 3, 'total_count': 1}):
            with self.subTest(info=info):
                self.body['result_info'] = info
                self.assertEqual(self.output_failure()['reason'], 'deployment_schema:pagination')
        self.body['result'] = {'items': [self.entry()]}
        self.body['result_info'] = {'page': 1, 'count': 1, 'total_count': 2, 'total_pages': 2}
        self.assertEqual(self.output_failure()['reason'], 'deployment_schema:pagination')
        # Merely naming a stage 'deployment' must not exempt another endpoint.
        for path in ('workers/scripts/demo-console/versions',
                     'workers/scripts/demo-console/deployments?page=2'):
            with self.subTest(path=path), self.assertRaisesRegex(compare.Unreadable, '^pagination$'):
                self.reader.get('deployment', path)
        for stage in ('namespaces', 'routes', 'secrets', 'domains'):
            for info in ({'page': 1, 'count': 1, 'total_count': 2}, None, {'total_count': 2}):
                with self.subTest(stage=stage, info=info):
                    self.body['result_info'] = info
                    with self.assertRaisesRegex(compare.Unreadable, '^pagination$'):
                        self.reader.get(stage, 'workers/scripts/demo-console/' + stage)

    def test_reader_failures_have_fixed_safe_codes(self):
        for field, value, code in (
            ('content_type', 'text/html', 'content_type'),
            ('raw', b'PRIVATE_RESPONSE', 'json'),
            ('raw', b'P' * (2 * 1024 * 1024 + 1), 'response_limit'),
            ('body', {'success': False, 'errors': [{'message': 'PRIVATE_RESPONSE'}]}, 'envelope'),
            ('body', {'success': True, 'errors': [], 'PRIVATE_KEY': 'PRIVATE_RESPONSE'}, 'result'),
        ):
            with self.subTest(code=code):
                saved = self.body, self.raw, self.headers['Content-Type']
                if field == 'content_type':
                    self.headers.replace_header('Content-Type', value)
                else:
                    setattr(self, field, value)
                row = self.output_failure()
                self.assertEqual(row['http_status'], 200)
                self.assertEqual(row['reason'], 'deployment_schema:' + code)
                self.body, self.raw, content_type = saved
                self.headers.replace_header('Content-Type', content_type)

    def test_unknown_exception_messages_never_become_reasons(self):
        for exc in (compare.Unreadable('PRIVATE_RESPONSE'), ValueError('PRIVATE_RESPONSE'),
                    compare.Unreadable('content_type', 'PRIVATE_RESPONSE')):
            with self.subTest(exception=type(exc).__name__), patch.object(compare, 'active', side_effect=exc):
                self.assertEqual(self.output_failure()['reason'], 'request_or_schema_unreadable')

    def test_http_failures_remain_distinct(self):
        import urllib.error
        for status in (401, 403):
            with self.subTest(status=status), patch.object(self.reader.opener, 'open', side_effect=
                    urllib.error.HTTPError('https://PRIVATE_URL', status, 'PRIVATE_RESPONSE', {}, None)):
                row = self.output_failure()
                self.assertEqual(row['reason'], 'http')
                self.assertEqual(row['http_status'], status)


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
