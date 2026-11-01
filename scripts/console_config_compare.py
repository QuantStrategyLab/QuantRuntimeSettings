#!/usr/bin/env python3
"""Compare the ordinary rendered Console config with live; GET only, no raw output.

Deliberately supports the current template, not arbitrary Wrangler configuration.
Unknown config/settings/binding shapes fail closed instead of guessing defaults.
Secret *values* are never fetched: ordinary deploy retains them, and secret names
and types are checked against the independent secret inventory.
"""
import json
import os
import re
import sys
import tomllib
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

MISSING = object()
# Only these literals may leave exception handling; never echo exception text.
SAFE_REASONS = {
    'configuration', 'redirect', 'http', 'content_type', 'response_limit', 'json',
    'envelope', 'pagination', 'result', 'deployment_shape',
    'deployment_timestamp', 'deployment_ambiguous', 'active_not_single',
    'version', 'runtime',
}
UUID_PATTERN = r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}'
KNOWN_CONFIG = {
    'name', 'main', 'account_id', 'compatibility_date', 'compatibility_flags',
    'workers_dev', 'preview_urls', 'vars', 'kv_namespaces', 'durable_objects',
    'migrations', 'triggers', 'observability', 'limits', 'placement', 'logpush',
    'tail_consumers', 'usage_model',
}
SETTING_KEYS = {
    'compatibility_date', 'compatibility_flags', 'usage_model', 'limits',
    'placement', 'logpush', 'observability', 'tail_consumers', 'tags',
    'cache_options', 'streaming_tail_consumers',
}


class Unreadable(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Unreadable('redirect')


class Reader:
    def __init__(self, account, token):
        self.root = f'https://api.cloudflare.com/client/v4/accounts/{account}/'
        self.token = token
        self.stage = 'configuration'
        self.status = None
        self.opener = urllib.request.build_opener(NoRedirect())

    def get(self, stage, path):
        self.stage, self.status = stage, None
        request = urllib.request.Request(self.root + path, method='GET', headers={
            'Authorization': f'Bearer {self.token}', 'Accept': 'application/json',
            'Accept-Encoding': 'identity',
        })
        try:
            with self.opener.open(request, timeout=30) as response:
                self.status = response.status
                if response.headers.get_content_type() != 'application/json':
                    raise Unreadable('content_type')
                raw = response.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise Unreadable('response_limit')
                try:
                    body = json.loads(raw)
                except (ValueError, UnicodeError):
                    raise Unreadable('json') from None
        except urllib.error.HTTPError as exc:
            self.status = exc.code
            raise Unreadable('http') from None
        if not isinstance(body, dict) or body.get('success') is not True or body.get('errors') not in (None, []):
            raise Unreadable('envelope')
        if 'result' not in body:
            raise Unreadable('result')
        result = body['result']
        # List Deployments is newest-first: its first page identifies active
        # traffic even when older history spans more pages. This exception is
        # scoped to the documented endpoint and result shape, never inventories.
        latest = (stage == 'deployment'
                  and re.fullmatch(r'workers/scripts/[a-z0-9-]+/deployments', path)
                  and isinstance(result, dict) and set(result) == {'deployments'})
        check_pagination(body.get('result_info', {}), latest=bool(latest))
        return result


def check_pagination(info, *, latest=False):
    if info is None and latest:
        # No history metadata is needed to identify the first-page deployment.
        return
    if not isinstance(info, dict) or set(info) - {
            'cursor', 'cursors', 'page', 'per_page', 'count', 'total_count', 'total_pages'}:
        raise Unreadable('pagination')
    cursors = info.get('cursors', {})
    if info.get('cursor') or not isinstance(cursors, dict) or any(cursors.values()):
        raise Unreadable('pagination')
    for key in ('page', 'per_page', 'count', 'total_count', 'total_pages'):
        if key in info and (type(info[key]) is not int or info[key] < 0):
            raise Unreadable('pagination')
    if ('per_page' in info and info['per_page'] < 1
            or 'total_pages' in info and info['total_pages'] < 1
            or 'count' in info and 'total_count' in info and info['count'] > info['total_count']):
        raise Unreadable('pagination')
    if latest:
        # Reject a later/unknown page if the metadata describes partial history.
        partial = (info.get('total_pages', 1) > 1
                   or info.get('total_count', 0) > info.get('count', 0))
        if info.get('page', 1) != 1 or partial and info.get('page') != 1:
            raise Unreadable('pagination')
    elif (info.get('page', 1) not in (0, 1) or info.get('total_pages', 1) > 1
          or info.get('total_count', 0) > info.get('count', 0)):
        # Binding/secret/route inventories still require complete listings.
        raise Unreadable('pagination')


def active(deployments):
    # `deployments` is documented and used by pinned Wrangler. `items` is
    # accepted for a complete alternate listing, never conflicting list keys or
    # an unverified `latest` hint. Unknown selection metadata fails closed.
    if not isinstance(deployments, dict) or set(deployments) not in ({'deployments'}, {'items'}):
        raise Unreadable('deployment_shape')
    items = next(iter(deployments.values()))
    if not isinstance(items, list) or not items or any(not isinstance(item, dict) for item in items):
        raise Unreadable('deployment_shape')
    if len(items) > 1 or 'created_on' in items[0]:
        times = []
        for item in items:
            timestamp = item.get('created_on')
            try:
                stamp = datetime.fromisoformat(timestamp) if isinstance(timestamp, str) else None
                if stamp is None or stamp.tzinfo is None:
                    raise ValueError
            except ValueError:
                raise Unreadable('deployment_timestamp') from None
            times.append(stamp)
        newest = max(times)
        if times.count(newest) != 1 or len(items) > 1 and (
                len({item.get('id') for item in items if isinstance(item.get('id'), str)}) != len(items)):
            raise Unreadable('deployment_ambiguous')
        entry = items[times.index(newest)]
    else:
        entry = items[0]
    versions = entry.get('versions')
    if (entry.get('strategy') != 'percentage'
            or not isinstance(entry.get('id'), str) or not re.fullmatch(UUID_PATTERN, entry['id'])
            or not isinstance(versions, list) or len(versions) != 1
            or not isinstance(versions[0], dict) or versions[0].get('percentage') != 100
            or not isinstance(versions[0].get('version_id'), str)
            or not re.fullmatch(UUID_PATTERN, versions[0]['version_id'])):
        raise Unreadable('active_not_single')
    return entry['id'], versions[0]['version_id']


def snapshot(reader, name):
    script = f'workers/scripts/{name}'
    deployment = active(reader.get('deployment', script + '/deployments'))
    version = reader.get('version', script + '/versions/' + deployment[1])
    if not isinstance(version, dict) or version.get('id') != deployment[1]:
        raise Unreadable('version')
    resources = version.get('resources')
    if not isinstance(resources, dict) or not isinstance(resources.get('script_runtime'), dict):
        raise Unreadable('runtime')
    return {
        'deployment': deployment,
        'runtime': resources['script_runtime'],
        'version_bindings': resources.get('bindings'),
        'namespaces': reader.get('namespaces', 'workers/durable_objects/namespaces?per_page=1000'),
        'settings': reader.get('settings', script + '/settings'),
        'schedules': reader.get('schedules', script + '/schedules'),
        'subdomain': reader.get('subdomain', script + '/subdomain'),
        'secrets': reader.get('secrets', script + '/secrets'),
        # Same routes endpoint used by pinned Wrangler's fetchWorkerConfig.
        'routes': reader.get('routes', f'workers/services/{name}/environments/production/routes?show_zonename=true'),
        'domains': reader.get('domains', f'workers/domains/records?page=0&per_page=100&service={name}&environment=production'),
    }


def compare(config, live):
    rows = []

    def row(item, expected=MISSING, actual=MISSING, reason=None, *, field=MISSING):
        status = 'unreadable' if reason else ('match' if expected == actual else 'mismatch')
        rows.append({'item': item, 'status': status,
                     'rendered': 'absent' if expected is MISSING else '<redacted>',
                     'live': 'absent' if actual is MISSING else '<redacted>',
                     **({'reason': reason} if reason else {}),
                     **({'field': field if isinstance(field, str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', field)
                         else '<unsupported-field>'} if field is not MISSING else {})})

    for index, key in enumerate(sorted(set(config) - KNOWN_CONFIG)):
        row(f'config.unsupported[{index}]', reason='unsupported_config_key', field=key)
    # These identify the request target and build entrypoint, not deployed code.
    row('target.account', config.get('account_id'), os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
    if config.get('main') != 'worker.js':
        row('source.main', reason='unsupported_entrypoint')
    settings, runtime = live.get('settings'), live.get('runtime')
    if not isinstance(settings, dict) or not isinstance(runtime, dict):
        row('settings', reason='missing_settings_or_runtime')
        return rows
    bindings = settings.get('bindings')
    if not isinstance(bindings, list):
        row('bindings', reason='missing_binding_inventory')
        bindings = []
    desired = {}
    for name, value in config.get('vars', {}).items():
        desired[name] = {'type': 'plain_text', 'name': name, 'text': value} if isinstance(value, str) else {'type': 'json', 'name': name, 'json': value}
    for binding in config.get('kv_namespaces', []):
        if set(binding) != {'binding', 'id'} or not re.fullmatch(r'[0-9a-f]{32}', binding.get('id', '')):
            row('kv.config', reason='unsupported_kv_config')
        desired[binding['binding']] = {'name': binding['binding'], 'type': 'kv_namespace', 'namespace_id': binding['id']}
    do_config = config.get('durable_objects', {})
    if set(do_config) != {'bindings'}:
        row('durable_objects.config', reason='unsupported_durable_objects_config')
    for binding in do_config.get('bindings', []):
        if set(binding) != {'name', 'class_name'}:
            row('durable_objects.config', reason='unsupported_durable_object_binding')
        desired[binding['name']] = dict(binding, type='durable_object_namespace')
    row('bindings.active_version', bindings, live.get('version_bindings', MISSING),
        'missing_version_bindings' if not isinstance(live.get('version_bindings'), list) else None)
    inventory = live.get('secrets')
    secret_names = {}
    if not isinstance(inventory, list):
        row('secrets', reason='missing_secret_inventory')
    else:
        for index, secret in enumerate(inventory):
            if (not isinstance(secret, dict) or set(secret) != {'name', 'type'}
                    or secret.get('type') != 'secret_text' or not isinstance(secret.get('name'), str)
                    or secret['name'] in secret_names):
                row(f'secrets[{index}]', reason='unsupported_secret_shape')
            else:
                secret_names[secret['name']] = secret
    seen = set()
    for index, binding in enumerate(bindings):
        name = binding.get('name') if isinstance(binding, dict) else None
        # Only local names may appear in logs. Remote-only names may be private.
        label = f'bindings.{name}' if name in desired else f'bindings.remote[{index}]'
        if not isinstance(name, str) or name in seen:
            row(label, reason='invalid_or_duplicate_binding')
            continue
        seen.add(name)
        if binding.get('type') == 'secret_text' and name not in desired:
            row(label + '.retained_secret', secret_names.pop(name, MISSING), binding)
            continue
        wanted = desired.get(name, MISSING)
        if binding.get('type') == 'durable_object_namespace' and wanted is not MISSING:
            # Local DO names resolve to an existing namespace. Verify its mapping
            # separately; never pretend the opaque namespace id came from TOML.
            actual = dict(binding)
            namespace = actual.pop('namespace_id', None)
            script_name = actual.pop('script_name', config['name'])
            row(label + '.script_name', config['name'], script_name)
            namespaces = live.get('namespaces')
            matches = [entry for entry in namespaces if isinstance(entry, dict) and entry.get('id') == namespace] if isinstance(namespaces, list) else []
            if len(matches) != 1 or not isinstance(namespace, str) or not re.fullmatch(r'[0-9a-f]{32}', namespace):
                row(label + '.namespace_id', reason='unreadable_namespace_identity')
            else:
                entry = matches[0]
                row(label + '.namespace_class', wanted.get('class_name'), entry.get('class', MISSING))
                row(label + '.namespace_script', config['name'], entry.get('script', MISSING))
                row(label + '.namespace_sqlite', True, entry.get('use_sqlite', MISSING),
                    'unreadable_storage_type' if 'use_sqlite' not in entry else None)
            row(label, wanted, actual)
        else:
            row(label, wanted, binding)
    for name in sorted(set(desired) - seen):
        row('bindings.' + name, desired[name], MISSING)
    for index, _ in enumerate(secret_names):
        row(f'secrets.unmatched[{index}]', reason='secret_inventory_disagrees')
    # A date is required. Only empty flags have an equivalent omitted/null form
    # in API responses; never invent a flag when the rendered list is nonempty.
    row('settings.compatibility_date', config.get('compatibility_date', MISSING),
        settings.get('compatibility_date', MISSING),
        'missing_setting' if 'compatibility_date' not in settings else None)
    row('runtime.compatibility_date', settings.get('compatibility_date', MISSING),
        runtime.get('compatibility_date', MISSING),
        'missing_runtime_setting' if 'compatibility_date' not in runtime else None)
    flags = config.get('compatibility_flags', [])
    if not isinstance(flags, list) or any(not isinstance(flag, str) or not flag for flag in flags):
        row('config.compatibility_flags', reason='unsupported_compatibility_flags')
    for scope, source, reason in [('settings', settings, 'missing_setting'),
                                   ('runtime', runtime, 'missing_runtime_setting')]:
        actual = source.get('compatibility_flags', MISSING)
        if flags == [] and (actual is MISSING or actual is None or actual == []):
            row(scope + '.compatibility_flags', [], [])
        else:
            row(scope + '.compatibility_flags', flags, actual, reason if actual is MISSING else None)
    # Known implicit upload behavior; other provider defaults are NOT guessed.
    for key in SETTING_KEYS - {'compatibility_date', 'compatibility_flags'}:
        expected = config.get(key, MISSING)
        actual = settings.get(key, MISSING)
        # Pinned Wrangler's parseConfigPlacement omits placement for mode=off.
        # The API can return that no-placement state as an empty object.
        if key == 'placement' and expected == {'mode': 'off'}:
            expected = {} if actual is not MISSING else MISSING
        # An omitted observability config disables logging. Pinned Wrangler
        # documents this as a no-op when it is already absent/disabled on live.
        if key == 'observability' and expected is MISSING and actual == {'enabled': False}:
            expected = actual
        # Pinned Wrangler has no top-level tags option. With no configured
        # environments, its service/environment tag transform preserves [].
        # Nonempty live-only tags still require review rather than inference.
        if key == 'tags' and expected is MISSING and actual == []:
            expected = []
        # Pinned ordinary deploy omits these settings when not configured:
        # logpush/tail consumers are omitted from PATCH, usage_model is never
        # uploaded. No secret sync or special release mode runs here.
        if key in {'logpush', 'tail_consumers', 'usage_model'} and expected is MISSING and actual is not MISSING:
            row('settings.' + key + '.retained', actual, actual)
        elif expected is MISSING and actual is not MISSING:
            row('settings.' + key, expected, actual, 'undeclared_effective_setting')
        else:
            row('settings.' + key, expected, actual)
    for index, key in enumerate(sorted(set(settings) - SETTING_KEYS - {'bindings'})):
        row(f'settings.unsupported[{index}]', reason='unsupported_live_setting', field=key)
    migrations = config.get('migrations', [])
    if len(migrations) != 1 or set(migrations[0]) != {'tag', 'new_sqlite_classes'}:
        row('migrations', reason='unsupported_migrations')
    else:
        row('migrations.tag', migrations[0]['tag'], runtime.get('migration_tag', MISSING),
            'missing_migration_tag' if 'migration_tag' not in runtime else None)
        row('migrations.sqlite_classes', sorted(migrations[0]['new_sqlite_classes']),
            sorted(b['class_name'] for b in do_config.get('bindings', [])))
        if 'exports' in runtime:
            exports = runtime['exports']
            expected_exports = {name: {'type': 'durable-object', 'storage': 'sqlite', 'state': 'created'}
                                for name in migrations[0]['new_sqlite_classes']}
            expected_exports['default'] = {'type': 'worker', 'state': 'created'}
            if isinstance(exports, dict) and all(isinstance(value, dict) for value in exports.values()):
                normalized = {name: dict(value, state=value.get('state', 'created')) for name, value in exports.items()}
                row('runtime.exports', expected_exports, normalized)
            else:
                row('runtime.exports', reason='unsupported_runtime_exports')
    for key in sorted({'usage_model', 'limits'}):
        if key in config and key not in runtime:
            row('runtime.' + key, reason='missing_runtime_setting')
    for key in sorted(set(runtime) - {'compatibility_date', 'compatibility_flags', 'migration_tag', 'exports'}):
        label = key if key in SETTING_KEYS else 'unsupported'
        row('runtime.' + label, settings.get(key, MISSING), runtime[key],
            'unmapped_runtime_setting' if key not in SETTING_KEYS or key not in settings else None,
            field=key if label == 'unsupported' else MISSING)
    subdomain = live.get('subdomain')
    if not isinstance(subdomain, dict):
        row('subdomain', reason='missing_subdomain')
    else:
        for key, local in [('enabled', 'workers_dev'), ('previews_enabled', 'preview_urls')]:
            actual = subdomain.get(key, MISSING)
            # Pinned Wrangler omits previews_enabled when preview_urls is not
            # configured; the API retains an existing setting, even when it
            # differs from workers_dev. Only a readable boolean may be retained.
            retained = local == 'preview_urls' and local not in config
            expected = actual if retained else config.get(local, MISSING)
            row('subdomain.' + key + ('.retained' if retained else ''), expected, actual,
                'unreadable_subdomain_setting' if not isinstance(actual, bool) else None)
        for index, key in enumerate(sorted(set(subdomain) - {'enabled', 'previews_enabled'})):
            row(f'subdomain.unsupported[{index}]', reason='unsupported_subdomain_setting', field=key)
    schedules = live.get('schedules')
    crons = schedules.get('schedules') if isinstance(schedules, dict) else None
    if (not isinstance(crons, list) or any(not isinstance(c, dict) or not isinstance(c.get('cron'), str)
            or set(c) - {'cron', 'created_on', 'modified_on'} for c in crons)
            or set(schedules) != {'schedules'} or set(config.get('triggers', {})) != {'crons'}):
        row('triggers.crons', reason='unreadable_schedules')
    else:
        row('triggers.crons', sorted(config['triggers']['crons']), sorted(c['cron'] for c in crons))
    for key in ('routes', 'domains'):
        actual = live.get(key)
        row(key, [], actual, 'unreadable_route_inventory' if not isinstance(actual, list) else None)
    return rows


def run(config, reader):
    before = snapshot(reader, config['name'])
    rows = compare(config, before)
    after = snapshot(reader, config['name'])
    rows.append({'item': 'observation.stable', 'status': 'match' if before == after else 'mismatch'})
    return rows


def main():
    reader = None
    try:
        config = tomllib.loads(Path('web/strategy-switch-console/wrangler.toml').read_text())
        account, token = os.environ.get('CLOUDFLARE_ACCOUNT_ID', ''), os.environ.get('CLOUDFLARE_API_TOKEN', '')
        if (not re.fullmatch(r'[0-9a-f]{32}', account) or not token
                or not re.fullmatch(r'[a-z0-9-]+', config.get('name', ''))
                or config.get('account_id') != account):
            raise Unreadable('configuration')
        reader = Reader(account, token)
        rows = run(config, reader)
    except Exception as exc:
        # Exception messages, request URLs, TOML parse errors and response bodies
        # can contain private data. Only allowlisted literals and HTTP status escape.
        reason = 'request_or_schema_unreadable'
        if isinstance(exc, Unreadable) and len(exc.args) == 1 and isinstance(exc.args[0], str) and exc.args[0] in SAFE_REASONS:
            code = exc.args[0]
            reason = ('deployment_schema:' + code if reader and reader.stage == 'deployment'
                      and code != 'http' else code)
        rows = [{'item': reader.stage if reader else 'configuration', 'status': 'unreadable',
                 'reason': reason, 'http_status': reader.status if reader else None}]
    passed = bool(rows) and all(row['status'] == 'match' for row in rows)
    report = {'read_only': True, 'writes': 0, 'all_match': passed, 'items': rows}
    print(json.dumps(report, ensure_ascii=True, indent=2))
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
