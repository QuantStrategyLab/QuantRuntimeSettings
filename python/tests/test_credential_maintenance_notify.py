"""Synthetic, offline maintenance channel and same-digest contracts."""
import contextlib
import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
ENV = {'GITHUB_ACTIONS': 'true', 'GITHUB_REF': 'refs/heads/main',
       'GITHUB_WORKFLOW_REF': 'QuantStrategyLab/QuantRuntimeSettings/.github/workflows/daily-digest-notify.yml@refs/heads/main',
       'STRATEGY_SWITCH_CONSOLE_URL': 'https://console.example', 'STRATEGY_SWITCH_SYNC_TOKEN': 'synthetic-sync'}
META = {'id': 'ibkr_flex', 'metadata_source': 'operator_provided', 'metadata_revision': 2,
        'expires_at': '2035-04-01T00:00:00.000Z', 'phase': '7', 'requires_action': True, 'delivery': 'not_reserved'}

class Response:
    def __init__(self, value, status=200): self.body = json.dumps(value).encode(); self.status = status
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def read(self, limit=-1): return self.body[:limit] if limit >= 0 else self.body

class CredentialMaintenanceTests(unittest.TestCase):
    def setUp(self):
        import credential_maintenance_notify as maintenance
        self.m = maintenance

    def client(self, **extra):
        return self.m.MaintenanceClient.from_environment({**ENV, **extra})

    def test_guard_missing_wrong_branch_dry_run(self):
        for env in [{}, {**ENV, 'GITHUB_REF': 'refs/heads/feature'}, {**ENV, 'GITHUB_ACTIONS': 'false'},
                    {**ENV, 'GITHUB_WORKFLOW_REF': ENV['GITHUB_WORKFLOW_REF'].replace('daily-digest', 'other')},
                    {**ENV, 'STRATEGY_SWITCH_SYNC_TOKEN': ''}, {**ENV, 'CONTROL_PLANE_SYNC_TOKEN': ENV['STRATEGY_SWITCH_SYNC_TOKEN']}, {**ENV, 'STRATEGY_SWITCH_CONSOLE_URL': 'https://user:pw@console.example'},
                    {**ENV, 'STRATEGY_SWITCH_CONSOLE_URL': 'https://console.example/unknown-route'}]:
            self.assertIsNone(self.m.MaintenanceClient.from_environment(env))
        self.assertIsNone(self.m.MaintenanceClient.from_environment(ENV, dry_run=True))

    def test_unknown_not_due_and_prior_delivery_do_not_claim(self):
        for changes in [{'phase': 'unknown', 'expires_at': None}, {'phase': 'not_due', 'requires_action': False}, {'delivery': 'reserved'}, {'delivery': 'unknown'}, {'delivery': 'delivered'}]:
            client = self.client()
            with patch.object(client, '_request', return_value={**META, **changes}) as request:
                self.assertIsNone(client.read_due())
                self.assertEqual(request.call_count, 1)

    def test_fixed_routes_claim_ack_and_single_block(self):
        client = self.client()
        with patch.object(client, '_request', side_effect=[META, {'granted': True, 'claim_id': 'synthetic-claim', 'phase': '7', 'delivery': 'reserved'}, {'phase': '7', 'delivery': 'delivered'}]) as request:
            reminder = client.read_due()
            self.assertTrue(client.reserve(reminder))
            text = reminder.block('en')
            self.assertEqual(text.count('IBKR Flex'), 1)
            self.assertIn(META['expires_at'], text)
            self.assertEqual(client.ack(reminder, 'delivered'), 'delivered')
            self.assertEqual([x.args[0] for x in request.call_args_list], ['', '/claim', '/ack'])
            self.assertNotIn(META['expires_at'], repr(reminder))
            self.assertNotIn('synthetic-claim', repr(reminder))

    def test_bad_projection_and_response_fail_closed_without_values(self):
        for changes in [{'id': 'account'}, {'metadata_revision': True}, {'expires_at': 'synthetic-token-sentinel'}, {'metadata_source': 'broker'}, {'phase': 'other'}]:
            client = self.client()
            with patch.object(client, '_request', return_value={**META, **changes}):
                self.assertIsNone(client.read_due())

    def test_uncertain_ack_and_claim_never_release(self):
        client = self.client()
        with patch.object(client, '_request', side_effect=[META, {'granted': True, 'claim_id': 'synthetic-claim', 'phase': '7', 'delivery': 'reserved'}, RuntimeError('private upstream sentinel')]):
            reminder = client.read_due(); self.assertTrue(client.reserve(reminder))
            self.assertEqual(client.ack(reminder, 'delivered'), 'reserved')

    def test_strict_telegram_ack_and_fixed_errors(self):
        good = {'ok': True, 'result': {'message_id': 4, 'chat': {'id': -123}}}
        bad = [{'ok': 'true', 'result': good['result']}, {'ok': True}, {'ok': True, 'result': {'message_id': True, 'chat': {'id': -123}}}, {'ok': True, 'result': {'message_id': 4, 'chat': {'id': -124}}}]
        for value, expected in [(good, True)] + [(x, False) for x in bad]:
            with patch.object(self.m, '_open', return_value=Response(value)):
                self.assertEqual(self.m.send_strict_telegram(token='synthetic-token', chat_id='-123', text='digest+maintenance'), expected)
        with patch.object(self.m, '_open', return_value=Response({'ok': True, 'result': {'message_id': 5, 'chat': {'id': -123, 'username': 'Synthetic_Channel'}}})):
            self.assertTrue(self.m.send_strict_telegram(token='synthetic-token', chat_id='@synthetic_channel', text='digest+maintenance'))
        out = io.StringIO()
        with patch.object(self.m, '_open', side_effect=RuntimeError('private-token-date-claim-sentinel')), contextlib.redirect_stderr(out):
            self.assertFalse(self.m.send_strict_telegram(token='synthetic-token', chat_id='-123', text='private-date'))
        self.assertNotIn('sentinel', out.getvalue())

    def test_same_digest_single_send_no_stdout_metadata(self):
        import send_daily_digest_telegram as sender
        payload = type('Payload', (), {'business_day': '2035-03-25', 'locale': 'en', 'runs': []})()
        client = self.client()
        route = {'token_source_kind': 'env', 'chat_source_kind': 'env', 'warnings': [], 'missing': [], 'token_alias_used': None, 'chat_alias_used': None, 'secret_name_contract': 'synthetic-name'}
        out = io.StringIO()
        with patch.dict(os.environ, ENV, clear=True), patch.object(sender.maintenance.MaintenanceClient, 'from_environment', return_value=client), patch.object(client, '_request', side_effect=[META, {'granted': True, 'claim_id': 'synthetic-claim', 'phase': '7', 'delivery': 'reserved'}, {'phase': '7', 'delivery': 'delivered'}]), patch.object(sender.aggregator, 'build_digest_payload', return_value=(payload, 'existing digest', [])), patch.object(sender.aggregator, 'build_receipt', return_value={'total_fills': None}), patch.object(sender, 'diagnose_telegram_route', return_value=route), patch.object(sender, 'missing_delivery_requirements', return_value=[]), patch.object(sender, 'resolve_telegram_token', return_value='synthetic-token'), patch.object(sender, 'resolve_telegram_chat_id', return_value='-123'), patch.object(sender.maintenance, 'send_strict_telegram', return_value=True) as send, patch.object(sender, 'send_telegram_message') as legacy, contextlib.redirect_stdout(out):
            self.assertEqual(sender.main(['--no-github']), 0)
        self.assertEqual(send.call_count, 1); legacy.assert_not_called()
        self.assertIn('existing digest', send.call_args.kwargs['text'])
        self.assertIn(META['expires_at'], send.call_args.kwargs['text'])
        self.assertNotIn(META['expires_at'], out.getvalue()); self.assertNotIn('synthetic-claim', out.getvalue())

    def test_dry_run_and_route_check_zero_maintenance_io(self):
        import send_daily_digest_telegram as sender
        payload = type('Payload', (), {'business_day': '2035-03-25', 'locale': 'en', 'runs': []})()
        route = {'token_source_kind': 'missing', 'chat_source_kind': 'missing', 'warnings': [], 'missing': [], 'token_alias_used': None, 'chat_alias_used': None, 'secret_name_contract': 'synthetic-name'}
        for args in [['--no-github', '--dry-run'], ['--route-check']]:
            with patch.dict(os.environ, ENV, clear=True), patch.object(sender.aggregator, 'build_digest_payload', return_value=(payload, 'existing digest', [])), patch.object(sender.aggregator, 'build_receipt', return_value={'total_fills': None}), patch.object(sender, 'diagnose_telegram_route', return_value=route), patch.object(self.m.MaintenanceClient, '_request') as request, patch.object(self.m, 'send_strict_telegram') as send, patch.object(sender, 'resolve_telegram_token') as token, patch.object(sender, '_write_receipt') as write, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(sender.main([*args, '--write-receipt', 'unused-synthetic.json']), 0)
                request.assert_not_called(); send.assert_not_called(); token.assert_not_called()
                from project_public_digest_receipt import project_public_receipt
                self.assertEqual(project_public_receipt(write.call_args.args[1])['maintenance'], {'read': 'not_attempted', 'phase': 'unknown', 'delivery': 'unknown'})

    def test_combined_capacity_and_route_before_reserve(self):
        self.assertTrue(self.m.can_combine_reminder(text='digest', chat_id='-123'))
        self.assertTrue(self.m.can_combine_reminder(text='digest', chat_id='@synthetic_channel'))
        self.assertFalse(self.m.can_combine_reminder(text='x' * 4097, chat_id='-123'))
        self.assertFalse(self.m.can_combine_reminder(text='😀' * 2049, chat_id='-123'))
        self.assertFalse(self.m.can_combine_reminder(text='digest', chat_id='unsupported-route'))
        for chat in ['00123', '-00123', '１２３', '١٢٣', '0', '-0']:
            self.assertFalse(self.m.can_combine_reminder(text='digest', chat_id=chat), 'unsupported numeric shape must be rejected before reserve')

    def test_no_redirect_and_bounded_response(self):
        import urllib.request
        request = urllib.request.Request('https://console.example')
        self.assertIsNone(self.m._NoRedirect().redirect_request(request, None, 302, '', {}, 'https://other.example'))
        with patch.object(self.m, '_open', return_value=Response({'value': 'x' * 17000})):
            with self.assertRaisesRegex(ValueError, '^maintenance_response_invalid$'): self.m._json(request)

    def test_incompatible_combined_preserves_daily_without_claim(self):
        import send_daily_digest_telegram as sender
        payload = type('Payload', (), {'business_day': '2035-03-25', 'locale': 'en', 'runs': []})()
        route = {'token_source_kind': 'env', 'chat_source_kind': 'env', 'warnings': [], 'missing': [], 'token_alias_used': None, 'chat_alias_used': None, 'secret_name_contract': 'synthetic-name'}
        for text, chat in [('x' * 4090, '-123'), ('existing digest', 'unsupported-route'), ('existing digest', '00123'), ('existing digest', '１２３')]:
            client = self.client()
            with patch.dict(os.environ, ENV, clear=True), patch.object(sender.maintenance.MaintenanceClient, 'from_environment', return_value=client), patch.object(client, '_request', return_value=META), patch.object(client, 'reserve') as reserve, patch.object(sender.aggregator, 'build_digest_payload', return_value=(payload, text, [])), patch.object(sender.aggregator, 'build_receipt', return_value={'total_fills': None}), patch.object(sender, 'diagnose_telegram_route', return_value=route), patch.object(sender, 'missing_delivery_requirements', return_value=[]), patch.object(sender, 'resolve_telegram_token', return_value='synthetic-token'), patch.object(sender, 'resolve_telegram_chat_id', return_value=chat), patch.object(sender.maintenance, 'send_strict_telegram') as strict, patch.object(sender, 'send_telegram_message', return_value=True) as legacy, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(sender.main(['--no-github']), 0)
                reserve.assert_not_called(); strict.assert_not_called()
                self.assertEqual(legacy.call_count, 1); self.assertEqual(legacy.call_args.kwargs['text'], text)

    def test_unknown_metadata_business_failure_has_no_message(self):
        import send_daily_digest_telegram as sender
        client = self.client()
        with patch.dict(os.environ, ENV, clear=True), patch.object(sender.maintenance.MaintenanceClient, 'from_environment', return_value=client), patch.object(client, '_request', return_value={**META, 'expires_at': None, 'phase': 'unknown'}), patch.object(sender.aggregator, 'build_digest_payload', side_effect=ValueError('synthetic-business-failure')), patch.object(sender.maintenance, 'send_strict_telegram') as strict, patch.object(sender, 'send_telegram_message') as legacy, patch.object(sender, 'resolve_telegram_token') as token:
            with self.assertRaisesRegex(ValueError, 'synthetic-business-failure'): sender.main(['--no-github'])
            strict.assert_not_called(); legacy.assert_not_called(); token.assert_not_called()

    def test_private_path_failure_fallback_keeps_unknown_business_counts(self):
        import send_daily_digest_telegram as sender
        client = self.client(); route = {'token_source_kind': 'env', 'chat_source_kind': 'env', 'warnings': [], 'missing': [], 'token_alias_used': None, 'chat_alias_used': None, 'secret_name_contract': 'synthetic-name'}
        with patch.dict(os.environ, {**ENV, 'DIGEST_CANDIDATES_INPUT_STATUS': 'failure'}, clear=True), patch.object(sender.maintenance.MaintenanceClient, 'from_environment', return_value=client), patch.object(client, '_request', side_effect=[META, {'granted': True, 'claim_id': 'synthetic-claim', 'phase': '7', 'delivery': 'reserved'}, {'phase': '7', 'delivery': 'delivered'}]), patch.object(sender.aggregator, 'build_digest_payload') as build, patch.object(sender, 'diagnose_telegram_route', return_value=route), patch.object(sender, 'missing_delivery_requirements', return_value=[]), patch.object(sender, 'resolve_telegram_token', return_value='synthetic-token'), patch.object(sender, 'resolve_telegram_chat_id', return_value='-123'), patch.object(sender.maintenance, 'send_strict_telegram', return_value=True) as send, patch.object(sender, '_write_receipt') as write, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(sender.main(['--no-github', '--write-receipt', 'synthetic-receipt.json']), 1)
            build.assert_not_called(); self.assertEqual(send.call_count, 1)
            receipt = write.call_args.args[1]
            self.assertIsNone(receipt['run_count']); self.assertIsNone(receipt['total_fills']); self.assertIsNone(receipt['business_day'])
            self.assertEqual(receipt['status'], 'business_digest_failed')
            self.assertNotIn(META['expires_at'], json.dumps(receipt)); self.assertNotIn('synthetic-claim', json.dumps(receipt))

    def test_business_failure_maintenance_only_retains_failure(self):
        import send_daily_digest_telegram as sender
        client = self.client(); route = {'token_source_kind': 'env', 'chat_source_kind': 'env', 'warnings': [], 'missing': [], 'token_alias_used': None, 'chat_alias_used': None, 'secret_name_contract': 'synthetic-name'}
        with patch.dict(os.environ, ENV, clear=True), patch.object(sender.maintenance.MaintenanceClient, 'from_environment', return_value=client), patch.object(client, '_request', side_effect=[META, {'granted': True, 'claim_id': 'synthetic-claim', 'phase': '7', 'delivery': 'reserved'}, {'phase': '7', 'delivery': 'delivered'}]), patch.object(sender.aggregator, 'build_digest_payload', side_effect=ValueError('private-business-sentinel')), patch.object(sender, 'diagnose_telegram_route', return_value=route), patch.object(sender, 'missing_delivery_requirements', return_value=[]), patch.object(sender, 'resolve_telegram_token', return_value='synthetic-token'), patch.object(sender, 'resolve_telegram_chat_id', return_value='-123'), patch.object(sender.maintenance, 'send_strict_telegram', return_value=True) as send, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(sender.main(['--no-github']), 1)
            self.assertEqual(send.call_count, 1)
            self.assertNotIn('runs=', send.call_args.kwargs['text'])

    def test_actual_sender_public_receipt_distinguishes_read_outcomes(self):
        import send_daily_digest_telegram as sender
        from project_public_digest_receipt import project_public_receipt
        payload = type('Payload', (), {'business_day': '2035-03-25', 'locale': 'en', 'runs': []})()
        route = {'token_source_kind': 'env', 'chat_source_kind': 'env', 'warnings': [], 'missing': []}
        marker = 'synthetic-private-date-token-claim-account-sentinel'
        cases = [
            (ENV, {**META, 'phase': 'not_due', 'requires_action': False}, {'read': 'ready', 'phase': 'not_due', 'delivery': 'not_reserved'}),
            (ENV, {**META, 'phase': 'unknown', 'expires_at': None}, {'read': 'ready', 'phase': 'unknown', 'delivery': 'not_reserved'}),
            (ENV, {**META, 'delivery': 'reserved'}, {'read': 'ready', 'phase': '7', 'delivery': 'reserved'}),
            (ENV, {**META, 'delivery': 'delivered'}, {'read': 'ready', 'phase': '7', 'delivery': 'delivered'}),
            (ENV, RuntimeError(marker), {'read': 'failed', 'phase': 'unknown', 'delivery': 'unknown'}),
            (ENV, {**META, 'expires_at': marker}, {'read': 'invalid', 'phase': 'unknown', 'delivery': 'unknown'}),
            (ENV, {**META, 'phase': 'unknown', 'expires_at': None, 'delivery': 'delivered'}, {'read': 'invalid', 'phase': 'unknown', 'delivery': 'unknown'}),
            (ENV, {**META, 'phase': 'not_due', 'requires_action': False, 'delivery': 'reserved'}, {'read': 'invalid', 'phase': 'unknown', 'delivery': 'unknown'}),
            ({**ENV, 'STRATEGY_SWITCH_SYNC_TOKEN': ''}, META, {'read': 'not_attempted', 'phase': 'unknown', 'delivery': 'unknown'}),
            ({**ENV, 'GITHUB_REF': 'refs/heads/feature'}, META, {'read': 'not_attempted', 'phase': 'unknown', 'delivery': 'unknown'}),
        ]
        for env, upstream, expected in cases:
            with self.subTest(expected=expected), patch.dict(os.environ, env, clear=True), patch.object(self.m.MaintenanceClient, '_request', side_effect=[upstream]) as request, patch.object(sender.aggregator, 'build_digest_payload', return_value=(payload, 'synthetic digest', [])), patch.object(sender.aggregator, 'build_receipt', return_value={'total_fills': None}), patch.object(sender, 'diagnose_telegram_route', return_value=route), patch.object(sender, 'missing_delivery_requirements', return_value=[]), patch.object(sender, 'resolve_telegram_token', return_value='synthetic-token'), patch.object(sender, 'resolve_telegram_chat_id', return_value='-123'), patch.object(sender, 'send_telegram_message', return_value=True) as legacy, patch.object(self.m, 'send_strict_telegram') as strict, patch.object(sender, '_write_receipt') as write, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(sender.main(['--no-github', '--write-receipt', 'unused-synthetic.json']), 0)
                public = project_public_receipt(write.call_args.args[1])
                self.assertEqual(public.get('maintenance'), expected)
                self.assertNotIn(marker, json.dumps(public))
                self.assertNotIn(META['expires_at'], json.dumps(public))
                self.assertEqual(legacy.call_count, 1)
                strict.assert_not_called()
                self.assertEqual(request.call_count, 0 if expected['read'] == 'not_attempted' else 1)

    def test_due_phase_and_ack_delivery_survive_actual_public_projection(self):
        import send_daily_digest_telegram as sender
        from project_public_digest_receipt import project_public_receipt
        payload = type('Payload', (), {'business_day': '2035-03-25', 'locale': 'en', 'runs': []})()
        route = {'token_source_kind': 'env', 'chat_source_kind': 'env', 'warnings': [], 'missing': []}
        for phase in ['30', '7', '1', 'expired']:
            for delivery in ['delivered', 'reserved', 'unknown']:
                responses = [{**META, 'phase': phase}, {'granted': True, 'claim_id': 'synthetic-private-claim', 'phase': phase, 'delivery': 'reserved'}, {'phase': phase, 'delivery': delivery}]
                with self.subTest(phase=phase, delivery=delivery), patch.dict(os.environ, ENV, clear=True), patch.object(self.m.MaintenanceClient, '_request', side_effect=responses) as request, patch.object(sender.aggregator, 'build_digest_payload', return_value=(payload, 'synthetic digest', [])), patch.object(sender.aggregator, 'build_receipt', return_value={'total_fills': None}), patch.object(sender, 'diagnose_telegram_route', return_value=route), patch.object(sender, 'missing_delivery_requirements', return_value=[]), patch.object(sender, 'resolve_telegram_token', return_value='synthetic-token'), patch.object(sender, 'resolve_telegram_chat_id', return_value='-123'), patch.object(self.m, 'send_strict_telegram', return_value=True) as strict, patch.object(sender, 'send_telegram_message') as legacy, patch.object(sender, '_write_receipt') as write, contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(sender.main(['--no-github', '--write-receipt', 'unused-synthetic.json']), 0)
                    raw = write.call_args.args[1]
                    public = project_public_receipt(raw)
                    self.assertEqual(public.get('maintenance'), {'read': 'ready', 'phase': phase, 'delivery': delivery})
                    self.assertNotIn(META['expires_at'], json.dumps(public))
                    self.assertNotIn('synthetic-private-claim', json.dumps(public))
                    self.assertEqual(request.call_count, 3)
                    self.assertEqual(strict.call_count, 1)
                    legacy.assert_not_called()

if __name__ == '__main__': unittest.main()
