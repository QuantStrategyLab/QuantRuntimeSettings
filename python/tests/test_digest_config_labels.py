"""Config labels use synthetic bindings only, without external IO."""
from copy import deepcopy
from dataclasses import replace
import io
import json
import os
import unittest
from contextlib import redirect_stdout, redirect_stderr
from unittest.mock import patch

import cloud_run_daily_digest as app
import daily_digest_aggregator as aggregator
from test_cloud_run_daily_digest import EXPECTED, JOB
from test_notification_consolidation import candidate, build
from test_unified_daily_digest_presentation import payload, row
from unified_daily_digest import render
from project_public_digest_receipt import project_public_receipt


class ConfigLabelTests(unittest.TestCase):
    def test_projection_precedence_and_no_mutation(self):
        for option, expected in (({'label': 'Custom', 'key': 'live', 'target_name': 'sg'}, 'Custom'),
                                 ({'label': '', 'key': 'paper', 'target_name': 'sg'}, 'paper'),
                                 ({'target_name': 'hk'}, 'hk'), ({}, '')):
            before = deepcopy(option)
            binding = deepcopy(EXPECTED[0])
            result = app.project_expected_target_label(binding, option)
            self.assertEqual(result.get('account_label', ''), expected)
            self.assertEqual(option, before)
            self.assertEqual(binding, EXPECTED[0])
        for label in ('live', 'paper', 'sg', 'hk', 'u166xxx', '实盘'):
            result = app.Configuration([{**EXPECTED[0], 'label': label}], JOB, 'synthetic', '2026-10-16')
            self.assertEqual(result.expected[0]['account_label'], label)

    def test_environment_intake_and_projected_label_are_authoritative(self):
        binding = app.project_expected_target_label({**EXPECTED[0], 'label': 'old'}, {'label': 'paper'})
        env = {'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true',
               'DIGEST_EXPECTED_TARGETS_JSON': json.dumps([binding]),
               'DIGEST_SCHEDULER_JOB_NAME': JOB, 'DIGEST_RECIPIENT_SCOPE': 'synthetic',
               'DIGEST_CUTOVER_REPORT_DATE': '2026-10-16'}
        with patch.dict(os.environ, env, clear=True):
            configuration = app.Configuration.from_environment()
            self.assertEqual(configuration.expected[0]['account_label'], 'paper')
            text, _ = app._report(configuration,
                [candidate(kind='order_submitted', order_count=1)], ['present'], '2026-10-15', None)
            self.assertIn('Schwab·paper', text)
            self.assertNotIn('Schwab·old', text)
        empty = app.Configuration([{**EXPECTED[0], 'account_label': ''}], JOB, 'synthetic', '2026-10-16')
        self.assertFalse(empty.expected[0].get('account_label'))

    def test_unsafe_config_values_never_become_labels(self):
        for value in ('U0000099', '00000099', '0000-0099', 'https://fake.invalid',
                      'bad\nlabel', 'bad\tlabel', 'bad\x00label', 'x' * 71, 12, None):
            result = app.project_expected_target_label(EXPECTED[0], {'label': value, 'key': 'paper'})
            self.assertEqual(result['account_label'], 'paper')
        for value in (12, None, 'x' * 71, 'U0000099', 'bad\nlabel'):
            with self.assertRaisesRegex(ValueError, '^digest_account_label_invalid$'):
                app.Configuration([{**EXPECTED[0], 'account_label': value}], JOB, 'synthetic', '2026-10-16')

    def test_binding_projection_to_actual_digest_without_alias_map(self):
        for locale in ('zh', 'en'):
            binding = app.Configuration([{**EXPECTED[0], 'label': 'paper'}], JOB, 'synthetic', '2026-10-16').expected
            item = candidate(kind='order_submitted', order_count=1, account_label='spoofed', account_hint='00000099')
            with patch.dict(os.environ, {'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true'}, clear=True):
                text, coverage = app._report(
                    app.Configuration(binding, JOB, 'synthetic', '2026-10-16', locale=locale),
                    [item], ['present'], '2026-10-15', None)
            self.assertIn('Schwab·paper', text)
            self.assertNotIn('spoofed', text)
            self.assertNotIn('00000099', text)
            self.assertEqual(coverage, 'partial')

    def test_each_binding_axis_must_match_and_candidate_cannot_supply_label(self):
        item = candidate(kind='order_submitted', order_count=1, account_label='spoofed', account_hint='00000099')
        binding = {**EXPECTED[0], 'account_label': 'private-label'}
        for axis in app.IDENTITY:
            other = {**binding, axis: 'ibkr' if axis == 'platform_id' else 'synthetic-other'}
            # A foreign binding cannot authorize this row at all.
            with self.assertRaisesRegex(ValueError, '^notification_candidate_target_unexpected$'):
                build([item], [other])
            # With its actual unlabeled binding alongside, it stays unlabeled.
            result, text, _, _ = build([item], [EXPECTED[0], other])
            self.assertNotIn('private-label', text)
            self.assertNotIn('spoofed', text)
            self.assertTrue(all(not entry.account_label for entry in result.runs))
        result, text, _, receipt = build([item], [binding])
        self.assertIn('Schwab·private-label', text)
        self.assertEqual(result.runs[0].account_label, 'private-label')
        with patch.dict(os.environ, {'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true'}, clear=True):
            self.assertNotIn('account_label', aggregator._run_receipt_dict(result.runs[0]))
        self.assertNotIn('private-label', json.dumps(project_public_receipt(receipt)))

    def test_labels_win_and_masked_fallback_and_collisions_remain(self):
        with patch.dict(os.environ, {'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true'}, clear=True):
            active = row(platform_id='ibkr', account_label='sg', account_hint='U0000099', order_count=1)
            text = render(payload(active, replace(active, opaque_account_uid='synthetic-other')))
            self.assertIn('IBKR·sg 1', text)
            self.assertIn('IBKR·sg 2', text)
            self.assertNotIn('U0000099', text)
            self.assertIn('IBKR·***99', render(payload(replace(active, account_label=''))))
            self.assertIn('😴 已核验目标无交易', render(payload(replace(active, order_count=0, fill_count=0))))

    def test_cli_withholds_private_labels_and_fake_ids(self):
        with patch.dict(os.environ, {'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true'}, clear=True):
            value = payload(row(account_label='private-label', account_hint='00000099'))
            collected = aggregator.CollectResult(list(value.runs), value.evidence_coverage)
            output, errors = io.StringIO(), io.StringIO()
            with patch.object(aggregator, 'build_digest_payload', return_value=(value, render(value), collected)), \
                    redirect_stdout(output), redirect_stderr(errors):
                code = aggregator.main(['--no-github'])
            self.assertEqual(code, 0)
            self.assertNotIn('private-label', output.getvalue() + errors.getvalue())
            self.assertNotIn('00000099', output.getvalue() + errors.getvalue())
