"""Offline contracts for the isolated, manual maintenance GET diagnostic."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import yaml

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
        self.assertEqual(source, (ROOT / 'docs/workflows/daily-digest-notify.yml').read_text())
        config = yaml.safe_load(source)
        triggers = config.get('on', config.get(True))
        inputs = triggers['workflow_dispatch']['inputs']
        self.assertIn('maintenance_read_check', inputs, 'a separate manual check must not execute the sending job')
        self.assertEqual(inputs['maintenance_read_check']['default'], False)
        self.assertEqual(triggers['schedule'], [{'cron': '0 22 * * 1-5'}])
        jobs = config['jobs']
        self.assertEqual(jobs['digest']['if'], "${{ github.event_name != 'workflow_dispatch' || inputs.maintenance_read_check != true }}")
        check = jobs['maintenance-read-check']
        self.assertEqual(check['if'], "${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.maintenance_read_check == true }}")
        self.assertEqual(check['permissions'], {'contents': 'read'})
        self.assertEqual(check['environment'], jobs['digest']['environment'])
        self.assertEqual(set(check['env']), {'STRATEGY_SWITCH_CONSOLE_URL', 'STRATEGY_SWITCH_SYNC_TOKEN', 'TELEGRAM_TOKEN', 'TG_TOKEN', 'GH_TOKEN', 'DIGEST_GH_TOKEN'})
        self.assertEqual(check['env']['STRATEGY_SWITCH_CONSOLE_URL'], '${{ vars.STRATEGY_SWITCH_CONSOLE_URL }}')
        self.assertEqual(check['env']['STRATEGY_SWITCH_SYNC_TOKEN'], '${{ secrets.STRATEGY_SWITCH_SYNC_TOKEN }}')
        for name in ['TELEGRAM_TOKEN', 'TG_TOKEN', 'GH_TOKEN', 'DIGEST_GH_TOKEN']:
            self.assertEqual(check['env'][name], jobs['digest']['env'][name])
        self.assertEqual(check['steps'][0]['with']['persist-credentials'], False)
        self.assertEqual([step.get('run') for step in check['steps'] if 'run' in step], ['python3 python/scripts/check_credential_maintenance_read.py'])
        self.assertEqual(len(check['steps']), 3)

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


if __name__ == '__main__': unittest.main()
