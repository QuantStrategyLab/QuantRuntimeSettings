"""Offline sender -> public ZIP -> Actions history regressions; no real delivery."""
import contextlib
import copy
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import daily_digest_aggregator as aggregator
import daily_digest_resend_guard as guard
import project_public_digest_receipt as public
import send_daily_digest_telegram as sender
from test_daily_digest_resend_guard import environment

DAY = '2026-10-22'
ROUTE = {'token_source_kind': 'env', 'chat_source_kind': 'env', 'warnings': [],
         'missing': [], 'secret_name_contract': 'synthetic'}


class HistoryClock(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 10, 24, 12, tzinfo=timezone.utc).astimezone(tz)


def archive(receipt, legacy=False):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as output:
        output.writestr('receipt.json' if legacy else 'receipt-public.json', json.dumps(receipt))
    return data.getvalue()


def history_api(data, *, event='schedule', mode='valid'):
    def get(url, token, **kwargs):
        if '/workflows/' in url:
            return {'total_count': 1, 'workflow_runs': [
                {'id': 90, 'status': 'in_progress' if mode == 'in_progress' else 'completed',
                 'conclusion': 'failure', 'event': event, 'created_at': DAY + 'T23:10:00Z'}]}
        if '/artifacts?' in url:
            return {'total_count': 0, 'artifacts': []} if mode == 'missing' else {
                'total_count': 1, 'artifacts': [
                    {'id': 4, 'name': 'daily-digest-receipt', 'expired': mode == 'expired'}]}
        if '/jobs?' in url:
            return {'total_count': 1, 'jobs': [{'steps': [
                {'name': 'Aggregate, render, and send daily digest', 'conclusion': 'failure'}]}]}
        if url.endswith('/4/zip'):
            return b'broken' if mode == 'corrupt' else data
        raise AssertionError('unexpected history route')
    return get


class FallbackDedupTests(unittest.TestCase):
    def run_sender(self, path, *, event='schedule', ok=True, reserve=True,
                   ack_error=False, send_error=False, dry_run=False, history=None, missing=False):
        client = mock.Mock()
        client.read_due.return_value = mock.Mock()
        reminder = client.read_due.return_value
        reminder.block.return_value = 'synthetic maintenance reminder'
        reminder.phase = '7'
        client.reserve.return_value = reserve
        client.ack.side_effect = RuntimeError('synthetic ack crash') if ack_error else None
        client.ack.return_value = 'delivered' if ok else 'unknown'
        client.diagnostic = {'read': 'ready', 'phase': '7', 'delivery': 'not_reserved'}
        env = environment(event, DIGEST_GUARD_READ_ATTEMPTS='1', DIGEST_FORCE_RESEND='false',
                          QSL_ROUTINE_NOTIFICATION_MODE='immediate', QRS_UNIFIED_NOTIFICATION_ENABLED='false')
        writes = []
        original_write = sender._write_receipt
        def write(dest, receipt):
            writes.append(copy.deepcopy(receipt))
            original_write(dest, receipt)
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.dict(os.environ, env, clear=True))
            stack.enter_context(mock.patch.object(guard, 'datetime', HistoryClock))
            stack.enter_context(mock.patch.object(sender.maintenance.MaintenanceClient, 'from_environment', return_value=client))
            stack.enter_context(mock.patch.object(guard, 'api_get', side_effect=history_api(history)))
            if history is None:
                stack.enter_context(mock.patch.object(guard, 'read_history', return_value=[]))
            stack.enter_context(mock.patch.object(sender.aggregator, 'build_digest_payload', side_effect=ValueError('synthetic construction failure')))
            stack.enter_context(mock.patch.object(sender, 'diagnose_telegram_route', return_value=ROUTE))
            stack.enter_context(mock.patch.object(sender, 'missing_delivery_requirements', return_value=['synthetic'] if missing else []))
            stack.enter_context(mock.patch.object(sender, 'resolve_telegram_token', return_value='synthetic'))
            stack.enter_context(mock.patch.object(sender, 'resolve_telegram_chat_id', return_value='-123'))
            send = stack.enter_context(mock.patch.object(sender.maintenance, 'send_strict_telegram', return_value=ok,
                                                       side_effect=RuntimeError('synthetic send crash') if send_error else None))
            legacy = stack.enter_context(mock.patch.object(sender, 'send_telegram_message', side_effect=AssertionError('unexpected transport')))
            stack.enter_context(mock.patch.object(sender, '_write_receipt', side_effect=write))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
            args = ['--no-github', '--business-day', DAY, '--write-receipt', str(path)]
            if dry_run:
                args.append('--dry-run')
            if ack_error or send_error:
                with self.assertRaises(RuntimeError):
                    sender.main(args)
                code = None
            else:
                code = sender.main(args)
        legacy.assert_not_called()
        receipt = public.project_public_receipt(json.loads(path.read_text()))
        return code, receipt, send.call_count, writes, client

    def decision(self, receipt, *, day=DAY, event='schedule', prior='workflow_dispatch', mode='valid', legacy=False):
        env = environment(event, DIGEST_GUARD_READ_ATTEMPTS='1')
        with mock.patch.object(guard, 'datetime', HistoryClock), \
             mock.patch.object(guard, 'api_get', side_effect=history_api(archive(receipt, legacy), event=prior, mode=mode)):
            return guard.evaluate(day, env)

    def test_fallback_success_and_unknown_share_cron_late_history_in_both_orders(self):
        for first, second in [('schedule', 'workflow_dispatch'), ('workflow_dispatch', 'schedule')]:
            for ok, expected in [(True, 'ALREADY_DELIVERED'), (False, 'DELIVERY_UNCERTAIN')]:
                with self.subTest(first=first, ok=ok), tempfile.TemporaryDirectory() as tmp:
                    code, receipt, calls, writes, client = self.run_sender(Path(tmp)/'first.json', event=first, ok=ok)
                    self.assertEqual(code, 1)  # Business failure remains failure, even on Telegram acceptance.
                    self.assertEqual(calls, 1)
                    self.assertEqual(receipt['business_day'], DAY)
                    self.assertTrue(receipt['business_digest_failed'])
                    self.assertEqual(receipt['status'], 'delivered' if ok else 'send_failed')
                    self.assertEqual(writes[0]['status'], 'sending')
                    self.assertEqual(self.decision(receipt, event=second, prior=first).reason, expected)
                    code2, receipt2, calls2, _, client2 = self.run_sender(Path(tmp)/'second.json', event=second, history=archive(receipt))
                    self.assertEqual(calls + calls2, 1)
                    client2.read_due.assert_not_called()
                    self.assertEqual(receipt2['status'], 'skipped_duplicate' if ok else 'blocked_resend_guard')
                    client.reserve.assert_called_once()
                    client.ack.assert_called_once()

    def test_transport_crash_and_ack_crash_leave_safe_marker(self):
        for ok, ack_error, send_error, status, reason in [
            (True, True, False, 'delivered', 'ALREADY_DELIVERED'),
            (False, True, False, 'send_failed', 'DELIVERY_UNCERTAIN'),
            (True, False, True, 'sending', 'DELIVERY_UNCERTAIN'),
        ]:
            with self.subTest(status=status), tempfile.TemporaryDirectory() as tmp:
                _, receipt, calls, _, _ = self.run_sender(Path(tmp)/'receipt.json', ok=ok, ack_error=ack_error, send_error=send_error)
                self.assertEqual(calls, 1)
                self.assertEqual(receipt['status'], status)
                self.assertEqual(self.decision(receipt).reason, reason)

    def test_unreserved_and_missing_configuration_are_genuinely_unsent(self):
        for reserve, missing, status in [(False, False, 'skipped_empty'), (True, True, 'blocked_missing_secrets')]:
            with self.subTest(status=status), tempfile.TemporaryDirectory() as tmp:
                code, receipt, calls, _, client = self.run_sender(Path(tmp)/'receipt.json', reserve=reserve, missing=missing)
                self.assertNotEqual(code, 0)
                self.assertEqual(calls, 0)
                self.assertEqual(receipt['status'], status)
                self.assertTrue(receipt['business_digest_failed'])
                self.assertEqual(self.decision(receipt).reason, 'FIRST_SEND')
                client.ack.assert_not_called()

    def test_legacy_fallback_markers_with_day_and_without_day(self):
        for legacy in [False, True]:
            for day in [DAY, None]:
                for ok in [True, False]:
                    with self.subTest(legacy=legacy, day=day, ok=ok):
                        receipt = {'schema_version': 'qsl.daily_digest_delivery_receipt.v1',
                                   'business_day': day, 'delivered': ok, 'dry_run': False,
                                   'status': 'business_digest_failed'}
                        result = self.decision(receipt, legacy=legacy)
                        self.assertEqual(result.reason, ('ALREADY_DELIVERED' if ok else 'DELIVERY_UNCERTAIN') if day else 'HISTORY_UNAVAILABLE')
                        if day is None:
                            self.assertEqual(result.history_error, 'guard_marker_business_day_missing')
        for status in ['blocked_missing_secrets', 'skipped_empty', 'blocked_resend_guard']:
            self.assertEqual(self.decision({'business_day': None, 'delivered': False, 'dry_run': False, 'status': status}).reason, 'FIRST_SEND')

    def test_missing_expired_corrupt_and_in_progress_history_block(self):
        receipt = {'business_day': DAY, 'delivered': True, 'dry_run': False, 'status': 'delivered'}
        for mode in ['missing', 'expired', 'corrupt', 'in_progress']:
            with self.subTest(mode=mode):
                self.assertEqual(self.decision(receipt, mode=mode).decision, 'blocked')

    def test_dry_run_and_existing_force_resend_boundaries(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, receipt, calls, _, client = self.run_sender(Path(tmp)/'receipt.json', dry_run=True)
            self.assertEqual(code, 0)
            self.assertEqual(calls, 0)
            client.reserve.assert_not_called()
            client.ack.assert_not_called()
            self.assertEqual(self.decision(receipt).reason, 'FIRST_SEND')
        receipt = {'business_day': DAY, 'delivered': True, 'dry_run': False, 'status': 'delivered'}
        with mock.patch.object(guard, 'api_get', side_effect=history_api(archive(receipt))):
            self.assertEqual(guard.evaluate(DAY, environment('workflow_dispatch', DIGEST_FORCE_RESEND='true')).reason, 'EXPLICIT_TEST_RESEND')
            self.assertEqual(guard.evaluate(DAY, environment('schedule', DIGEST_FORCE_RESEND='true')).reason, 'ALREADY_DELIVERED')


class DateBoundaryOptionsTests(unittest.TestCase):
    """Compare existing boundary coverage with a frozen-day contract; no scheduler implementation."""
    def resolve(self, stamp, explicit=None):
        with mock.patch.dict(os.environ, {'QSL_ROUTINE_NOTIFICATION_MODE': 'immediate',
                                         'QRS_UNIFIED_NOTIFICATION_ENABLED': 'false'}, clear=True):
            return aggregator.resolve_business_day(explicit=explicit, now=datetime.fromisoformat(stamp))

    def test_option_a_existing_same_day_coverage_exposes_new_york_midnight_gap(self):
        # SGT 07:10/07:30 = previous UTC 23:10/23:30. UTC midnight itself is not the B boundary.
        for stamp in ['2026-10-22T23:10:00+00:00', '2026-10-22T23:30:00+00:00', '2026-10-23T00:00:00+00:00']:
            self.assertEqual(self.resolve(stamp), DAY)
        self.assertEqual(self.resolve('2026-10-23T03:59:59+00:00'), DAY)  # SGT11:59:59 / NY23:59:59 EDT
        self.assertEqual(self.resolve('2026-10-23T04:00:00+00:00'), '2026-10-23')  # SGT12:00 / NY00:00
        # Winter boundary is 05:00 UTC = SGT13:00 (EST), so a fixed UTC cutoff is incorrect.
        self.assertEqual(self.resolve('2026-11-03T04:59:59+00:00'), '2026-11-02')
        self.assertEqual(self.resolve('2026-11-03T05:00:00+00:00'), '2026-11-03')

    def test_both_options_duplicate_boundary_via_real_public_marker(self):
        receipt = {'business_day': DAY, 'delivered': True, 'dry_run': False, 'status': 'delivered'}
        check = FallbackDedupTests().decision
        # A: same B skips; late execution recomputing B after NY midnight can regain send eligibility.
        self.assertEqual(check(receipt, day=self.resolve('2026-10-22T23:30:00+00:00')).reason, 'ALREADY_DELIVERED')
        self.assertEqual(check(receipt, day=self.resolve('2026-10-23T04:00:00+00:00')).reason, 'FIRST_SEND')
        # B: explicit immutable plan day keeps cron/late/early/sender on the same key across midnight.
        for stamp in ['2026-10-22T23:10:00+00:00', '2026-10-23T00:00:00+00:00', '2026-10-23T04:00:00+00:00']:
            self.assertEqual(check(receipt, day=self.resolve(stamp, explicit=DAY)).reason, 'ALREADY_DELIVERED')
        # Missing/late plan date must stop in the future admission layer; not inferred here from now.
        with self.assertRaises(ValueError):
            self.resolve('2026-10-23T04:00:00+00:00', explicit='unknown-plan-day')


if __name__ == '__main__':
    unittest.main()
