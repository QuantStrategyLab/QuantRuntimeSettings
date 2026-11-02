"""Fake identities may reach transport, never logs or public artifacts."""
from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

import daily_digest_aggregator as aggregator
from project_public_digest_receipt import project_public_receipt
import send_daily_digest_telegram as sender
from test_unified_daily_digest_presentation import payload, row
from unified_daily_digest import render


class DigestIdentityPrivacyTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true'}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.identity = 'U0000099'
        os.environ['QSL_DISPLAY_NAMES_JSON'] = json.dumps({
            'accounts': {'ibkr': {'opaque-' + self.identity: self.identity}}})
        self.payload = payload(row(self.identity, platform_id='ibkr'))
        self.text = render(self.payload)
        self.collected = aggregator.CollectResult(list(self.payload.runs), self.payload.evidence_coverage)
        self.built = (self.payload, self.text, self.collected)
        self.assertIn(self.identity, self.text)

    def test_aggregator_cli_logs_and_both_output_files_withhold_account_identity(self):
        output, errors = io.StringIO(), io.StringIO()
        with (tempfile.TemporaryDirectory() as directory,
              patch.object(aggregator, 'build_digest_payload', return_value=self.built),
              redirect_stdout(output), redirect_stderr(errors)):
            text_path, json_path = Path(directory) / 'digest.txt', Path(directory) / 'receipt.json'
            code = aggregator.main(['--no-github', '--write-text', str(text_path), '--write-json', str(json_path)])
            exported = text_path.read_text() + json_path.read_text()
            receipt = json.loads(json_path.read_text())
        self.assertEqual(code, 0)
        self.assertEqual(receipt['projection'], 'public_summary')
        self.assertEqual(receipt['total_fills'], 1)
        self.assertNotIn('runs', receipt)
        self.assertNotIn(self.identity, output.getvalue() + errors.getvalue() + exported)
        self.assertIn('withheld', output.getvalue())

    def test_sender_dry_run_logs_and_public_receipt_withhold_account_identity(self):
        output, errors = io.StringIO(), io.StringIO()
        with (tempfile.TemporaryDirectory() as directory,
              patch.object(sender.aggregator, 'build_digest_payload', return_value=self.built),
              patch.object(sender, 'send_telegram_message') as transport,
              redirect_stdout(output), redirect_stderr(errors)):
            receipt_path = Path(directory) / 'private-receipt.json'
            code = sender.main(['--dry-run', '--no-github', '--business-day', self.payload.business_day,
                                '--write-receipt', str(receipt_path)])
            private = json.loads(receipt_path.read_text())
            public = project_public_receipt(private)
        self.assertEqual(code, 0)
        transport.assert_not_called()
        self.assertIn('dry-run', output.getvalue())
        self.assertNotIn(self.identity, output.getvalue() + errors.getvalue() + json.dumps(public))
        self.assertNotIn('每日交易摘要', output.getvalue())

    def test_transport_http_error_never_reads_or_prints_echoed_message(self):
        output, errors = io.StringIO(), io.StringIO()
        error = urllib.error.HTTPError('https://synthetic.invalid', 400, self.identity, {},
                                       io.BytesIO(self.text.encode()))
        with (patch.object(sender.urllib.request, 'urlopen', side_effect=error),
              patch.object(error, 'read', side_effect=AssertionError('private error body was read')),
              redirect_stdout(output), redirect_stderr(errors)):
            accepted = sender.send_telegram_message(token='fake-token', chat_id='fake-chat', text=self.text)
        self.assertFalse(accepted)
        self.assertIn('HTTP 400', errors.getvalue())
        self.assertNotIn(self.identity, output.getvalue() + errors.getvalue())
