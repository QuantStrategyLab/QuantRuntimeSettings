"""Offline contracts for the isolated, manual maintenance GET diagnostic."""
import contextlib
import hashlib
from http.client import HTTPMessage
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import unittest
import urllib.error
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python/scripts'))
import credential_maintenance_notify as maintenance

ENV = {'GITHUB_ACTIONS': 'true', 'GITHUB_REF': 'refs/heads/main',
       'GITHUB_WORKFLOW_REF': 'QuantStrategyLab/QuantRuntimeSettings/.github/workflows/daily-digest-notify.yml@refs/heads/main',
       'STRATEGY_SWITCH_CONSOLE_URL': 'https://console.example', 'STRATEGY_SWITCH_SYNC_TOKEN': 'synthetic-sync'}
META = {'id': 'ibkr_flex', 'metadata_source': 'operator_provided', 'metadata_revision': 1,
        'expires_at': '2035-04-01T00:00:00.000Z', 'phase': 'not_due', 'requires_action': False, 'delivery': 'not_reserved'}


class MaintenanceReadCheckTests(unittest.TestCase):
    def module(self):
        path = ROOT / 'python/scripts/check_credential_maintenance_read.py'
        spec = importlib.util.spec_from_file_location('maintenance_read_check', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def run_check(self, env, response):
        out, err = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, env, clear=True), patch.object(maintenance.MaintenanceClient, '_request', side_effect=[response]) as request, patch.object(maintenance.MaintenanceClient, 'reserve') as reserve, patch.object(maintenance.MaintenanceClient, 'ack') as ack, patch.object(maintenance, 'send_strict_telegram') as send, contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            status = self.module().main([])
        reserve.assert_not_called(); ack.assert_not_called(); send.assert_not_called()
        self.assertEqual(err.getvalue(), '')
        return status, json.loads(out.getvalue()), request

    def test_workflow_isolated_from_digest_with_minimum_existing_authority(self):
        source = (ROOT / '.github/workflows/daily-digest-notify.yml').read_text()
        template = (ROOT / 'docs/workflows/daily-digest-notify.yml').read_text()
        self.assertEqual(source.split('\n  maintenance-read-check:', 1)[1],
                         template.split('\n  maintenance-read-check:', 1)[1])
        # Check this workflow's fixed text contract; actionlint validates YAML.
        self.assertIn('''      maintenance_read_check:
        description: "Independent main-only maintenance GET check; never sends notifications or runs the digest job."
        required: true
        type: boolean
        default: false
''', source)
        self.assertIn('''  schedule:
    # Asia/Shanghai Tue–Sat 07:10 → UTC Mon–Fri 23:10, after 22:20 producers
    - cron: "10 23 * * 1-5"
''', source)
        digest, check = source.split('jobs:\n  digest:\n', 1)[1].split('\n  maintenance-read-check:\n', 1)
        exclude_check = "github.event_name != 'workflow_dispatch' || inputs.maintenance_read_check != true"
        self.assertIn(exclude_check, digest)
        # Digest admission now has its own read-only history permission. Freeze
        # the independent maintenance job, whose authority and steps must not change.
        self.assertIn('      actions: read', digest)
        self.assertEqual(hashlib.sha256(check.encode()).hexdigest(),
                         '768c7a6e975c9ad3f7c24d29d6835733d4288f9da4096c5de40605f87432cd8c')
        self.assertIn("    if: ${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.maintenance_read_check == true }}\n", check)
        self.assertIn('    permissions:\n      contents: read\n    runs-on:', check)
        self.assertIn('    environment: runtime-strategy-switch\n', check)
        env, steps = check.split('    env:\n', 1)[1].split('    steps:\n', 1)
        self.assertEqual(env, '''      STRATEGY_SWITCH_CONSOLE_URL: ${{ vars.STRATEGY_SWITCH_CONSOLE_URL }}
      STRATEGY_SWITCH_SYNC_TOKEN: ${{ secrets.STRATEGY_SWITCH_SYNC_TOKEN }}
      # Same injected token aliases as the digest; compare only, never use them.
      TELEGRAM_TOKEN: ${{ secrets.TELEGRAM_TOKEN }}
      TG_TOKEN: ${{ secrets.TG_TOKEN }}
      GH_TOKEN: ${{ secrets.RUNTIME_SETTINGS_GH_TOKEN || github.token }}
      DIGEST_GH_TOKEN: ${{ secrets.RUNTIME_SETTINGS_GH_TOKEN || github.token }}
''')
        self.assertEqual(steps, '''      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - name: Read once and print fixed public status
        run: python3 python/scripts/check_credential_maintenance_read.py
''')

    def test_main_only_one_get_for_valid_not_due_and_unknown(self):
        for meta in [META, {**META, 'phase': 'unknown', 'expires_at': None, 'requires_action': True}]:
            status, public, request = self.run_check(ENV, meta)
            self.assertEqual(status, 0)
            self.assertEqual(public, {'read': 'ready', 'phase': meta['phase'], 'delivery': 'not_reserved'})
            request.assert_called_once_with('')
            self.assertNotIn(META['expires_at'], json.dumps(public))

    def test_wrong_context_missing_or_aliased_token_never_reads(self):
        cases = [{}, {**ENV, 'GITHUB_REF': 'refs/heads/topic'}, {**ENV, 'GITHUB_ACTIONS': 'false'},
                 {**ENV, 'GITHUB_WORKFLOW_REF': ENV['GITHUB_WORKFLOW_REF'].replace('daily-digest-notify', 'other')},
                 {**ENV, 'STRATEGY_SWITCH_SYNC_TOKEN': ''}]
        cases += [{**ENV, key: ENV['STRATEGY_SWITCH_SYNC_TOKEN']} for key in ['TELEGRAM_TOKEN', 'TG_TOKEN', 'GH_TOKEN', 'DIGEST_GH_TOKEN']]
        for env in cases:
            status, public, request = self.run_check(env, META)
            self.assertEqual(status, 1)
            self.assertEqual(public, {'read': 'not_attempted', 'phase': 'unknown', 'delivery': 'unknown'})
            request.assert_not_called()

    def test_failed_and_invalid_read_never_leak_upstream_or_send(self):
        marker = 'synthetic-private-date-claim-token-account-sentinel'
        for response, read in [(RuntimeError(marker), 'failed'), ({**META, 'id': marker}, 'invalid')]:
            status, public, request = self.run_check(ENV, response)
            self.assertEqual(status, 1)
            self.assertEqual(public, {'read': read, 'phase': 'unknown', 'delivery': 'unknown'})
            request.assert_called_once_with('')
            self.assertNotIn(marker, json.dumps(public))

    def test_wire_request_is_get_and_never_claim_or_ack(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, limit): return json.dumps(META).encode()
        out = io.StringIO()
        with patch.dict(os.environ, ENV, clear=True), patch.object(maintenance, '_open', return_value=Response()) as opened, contextlib.redirect_stdout(out):
            self.assertEqual(self.module().main([]), 0)
        opened.assert_called_once()
        request = opened.call_args.args[0]
        self.assertEqual(request.method, 'GET')
        self.assertEqual(request.full_url, 'https://console.example/api/internal/credential-maintenance')
        self.assertIsNone(request.data)
        self.assertEqual(set(json.loads(out.getvalue())), {'read', 'phase', 'delivery'})

    def test_http_codes_are_fixed_public_enums_without_private_error_access(self):
        marker = 'synthetic-private-http-body-url-token-sentinel'
        for code, read in [(401, 'http_401'), (403, 'http_403'), (503, 'http_503'), (500, 'failed')]:
            body = io.BytesIO(marker.encode())
            error = urllib.error.HTTPError('https://console.example/' + marker, code, marker, {}, body)
            out, err = io.StringIO(), io.StringIO()
            with self.subTest(code=code), patch.dict(os.environ, ENV, clear=True), patch.object(maintenance, '_open', side_effect=error) as opened, patch.object(error, 'read', side_effect=AssertionError('error body must not be read')) as read_body, patch.object(urllib.error.HTTPError, '__str__', side_effect=AssertionError('error text must not be read')) as read_text, patch.object(error, 'geturl', side_effect=AssertionError('error URL must not be read')) as read_url, contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                self.assertEqual(self.module().main([]), 1)
            self.assertEqual(json.loads(out.getvalue()), {'read': read, 'phase': 'unknown', 'delivery': 'unknown'})
            self.assertEqual(err.getvalue(), '')
            self.assertNotIn(marker, out.getvalue() + err.getvalue())
            self.assertEqual(body.tell(), 0)
            read_body.assert_not_called(); read_text.assert_not_called(); read_url.assert_not_called()
            opened.assert_called_once()
            request = opened.call_args.args[0]
            self.assertEqual(request.method, 'GET')
            self.assertIsNone(request.data)

        status, public, request = self.run_check(ENV, urllib.error.URLError(marker))
        self.assertEqual(status, 1)
        self.assertEqual(public, {'read': 'failed', 'phase': 'unknown', 'delivery': 'unknown'})
        request.assert_called_once_with('')

    def test_only_unique_challenge_header_on_403_changes_public_classification(self):
        marker = 'synthetic-private-response-header-body-url-token-sentinel'
        cases = [(403, ['challenge'], False, 'http_403_challenge'),
                 (403, [], False, 'http_403'), (403, ['other'], False, 'http_403'),
                 (403, ['challenge', 'challenge'], False, 'http_403'),
                 (403, ['challenge, challenge'], False, 'http_403'),
                 (403, [None], False, 'http_403'),
                 (403, ['Challenge'], False, 'http_403'), (403, [' challenge'], False, 'http_403'),
                 (403, [marker], False, 'http_403'), (403, ['challenge'], True, 'http_403'),
                 (401, ['challenge'], False, 'http_401'), (503, ['challenge'], False, 'http_503')]
        for code, values, broken, read in cases:
            headers = HTTPMessage()
            for value in values: headers['Cf-Mitigated'] = value
            headers['X-Private'] = marker
            original_get_all = headers.get_all
            def lookup(name):
                self.assertEqual(name, 'cf-mitigated', 'only the fixed challenge header may be inspected')
                if broken: raise ValueError(marker)
                return original_get_all(name)
            body = io.BytesIO(marker.encode())
            error = urllib.error.HTTPError('https://console.example/' + marker, code, marker, headers, body)
            out, err = io.StringIO(), io.StringIO()
            with self.subTest(code=code, values=values, broken=broken), patch.dict(os.environ, ENV, clear=True), patch.object(maintenance, '_open', side_effect=error) as opened, patch.object(headers, 'get_all', side_effect=lookup) as lookup_header, patch.object(headers, 'get', side_effect=AssertionError('other header access is forbidden')), patch.object(HTTPMessage, '__iter__', side_effect=AssertionError('headers must not be enumerated')), patch.object(headers, 'items', side_effect=AssertionError('headers must not be enumerated')), patch.object(headers, 'keys', side_effect=AssertionError('headers must not be enumerated')), patch.object(headers, 'values', side_effect=AssertionError('headers must not be enumerated')), patch.object(error, 'read', side_effect=AssertionError('error body must not be read')) as read_body, patch.object(urllib.error.HTTPError, '__str__', side_effect=AssertionError('error text must not be read')) as read_text, patch.object(error, 'geturl', side_effect=AssertionError('error URL must not be read')) as read_url, contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                self.assertEqual(self.module().main([]), 1)
            self.assertEqual(json.loads(out.getvalue()), {'read': read, 'phase': 'unknown', 'delivery': 'unknown'})
            self.assertEqual(err.getvalue(), '')
            self.assertNotIn(marker, out.getvalue())
            self.assertEqual(body.tell(), 0)
            read_body.assert_not_called(); read_text.assert_not_called(); read_url.assert_not_called()
            if code == 403: lookup_header.assert_called_once_with('cf-mitigated')
            else: lookup_header.assert_not_called()
            opened.assert_called_once()
            self.assertEqual(opened.call_args.args[0].method, 'GET')
            self.assertIsNone(opened.call_args.args[0].data)


if __name__ == '__main__': unittest.main()
