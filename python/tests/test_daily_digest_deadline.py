"""Offline deadline integration: injected clock/runner/transport, no live clients."""
from contextlib import ExitStack, redirect_stdout, redirect_stderr
from datetime import datetime, timedelta
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import daily_digest_deadline as deadline
import fetch_daily_digest_candidates as fetcher
import send_daily_digest_telegram as sender
import daily_digest_resend_guard as guard
import project_public_digest_receipt as public
from test_daily_digest_ux import config

DAY = '2026-10-22'
ENV = {'DIGEST_DEADLINE_ENABLED': 'true', 'DIGEST_BUSINESS_DAY': DAY,
       'DIGEST_REPORT_DATE': '2026-10-23', 'AUTH_OUTCOME': 'success',
       'DIGEST_CANDIDATES_GCS_URI': 'gs://synthetic-private/candidates',
       'GITHUB_EVENT_NAME': 'schedule', 'DIGEST_RESEND_GUARD': 'true'}


def stamp(clock):
    return datetime.fromisoformat('2026-10-23T' + clock + '+08:00')


class Clock:
    def __init__(self, clock='07:00:00'):
        self.stamp, self.elapsed = stamp(clock), 0.0
    def now(self): return self.stamp + timedelta(seconds=self.elapsed)
    def monotonic(self): return self.elapsed
    def sleep(self, seconds): self.elapsed += seconds


class FetchTests(unittest.TestCase):
    def execute(self, runner, clock=None, env=None):
        clock = clock or Clock()
        with tempfile.TemporaryDirectory() as tmp:
            previous = os.getcwd()
            try:
                os.chdir(tmp)
                result = fetcher.fetch({**ENV, **(env or {}), 'RUNNER_TEMP': tmp}, runner=runner,
                                       now=clock.now, monotonic=clock.monotonic, sleep=clock.sleep)
                payload = json.loads(Path(result['path']).read_text()) if result.get('path') else None
                return result, payload
            finally:
                os.chdir(previous)

    def test_after_cutoff_and_late_start_never_run_upstream(self):
        for clock in ['07:20:00', '07:30:00', '08:00:00']:
            runner = mock.Mock(side_effect=AssertionError('upstream must not run'))
            result, _ = self.execute(runner, Clock(clock))
            self.assertEqual(result['attempts'], 0)
            runner.assert_not_called()

    def test_three_attempts_shared_by_empty_and_transient_failure(self):
        runner = mock.Mock(return_value=subprocess.CompletedProcess([], 0, '', ''))
        clock = Clock()
        result, _ = self.execute(runner, clock)
        self.assertEqual((result['attempts'], runner.call_count, clock.elapsed), (3, 3, 60))
        runner = mock.Mock(return_value=subprocess.CompletedProcess([], 1, '', '503 private value'))
        clock = Clock()
        result, _ = self.execute(runner, clock)
        self.assertEqual((result['attempts'], runner.call_count, clock.elapsed), (3, 3, 6))
        self.assertNotIn('private value', json.dumps(result))

    def test_permanent_auth_or_permission_error_has_no_retry(self):
        runner = mock.Mock(return_value=subprocess.CompletedProcess([], 1, '', '403 forbidden private path'))
        result, _ = self.execute(runner)
        self.assertEqual(runner.call_count, 1)
        self.assertEqual(result['attempts'], 1)
        runner.reset_mock()
        result, _ = self.execute(runner, env={'AUTH_OUTCOME': 'failure'})
        runner.assert_not_called()
        self.assertEqual(result['attempts'], 0)

    def test_total_120s_and_cutoff_cancel_further_commands(self):
        for clock, expected in [(Clock('07:19:55'), 5), (Clock(), 120)]:
            def blocked(args, **kwargs):
                self.assertLessEqual(kwargs['timeout'], 20)
                clock.sleep(kwargs['timeout'])
                raise subprocess.TimeoutExpired(args, kwargs['timeout'])
            result, _ = self.execute(blocked, clock)
            self.assertLessEqual(clock.elapsed, expected)
            self.assertLessEqual(result['attempts'], 3)

    def test_every_copy_uses_remaining_common_budget(self):
        clock = Clock()
        calls = []
        def run(args, **kwargs):
            calls.append((args[2], kwargs['timeout']))
            clock.sleep(kwargs['timeout'])
            if args[2] == 'ls':
                return subprocess.CompletedProcess(args, 0, '\n'.join(ENV['DIGEST_CANDIDATES_GCS_URI'] + f'/p/{DAY}/{i}.json' for i in range(20)), '')
            Path(args[4]).write_text('{"runs": []}')
            return subprocess.CompletedProcess(args, 0, '', '')
        result, _ = self.execute(run, clock)
        self.assertEqual(clock.elapsed, 120)
        self.assertEqual(len(calls), 6)
        self.assertEqual(result['status'], 'failed')

    def test_valid_merge_publishes_only_fresh_round_and_schema_error_is_permanent(self):
        for invalid in [False, True]:
            def run(args, **kwargs):
                if args[2] == 'ls':
                    return subprocess.CompletedProcess(args, 0, ENV['DIGEST_CANDIDATES_GCS_URI'] + f'/p/{DAY}/a.json\n', '')
                Path(args[4]).write_text('{broken' if invalid else '{"runs": []}')
                return subprocess.CompletedProcess(args, 0, '', '')
            result, payload = self.execute(run)
            self.assertEqual(result['attempts'], 1)
            self.assertEqual(result['status'], 'failed' if invalid else 'loaded')
            self.assertEqual(payload, None if invalid else {'schema_version': 'qsl.digest_candidates.v1', 'runs': []})

    def test_partial_expected_coverage_polls_then_accepts_complete_current_window(self):
        expected = [{'platform_id': 'demo', 'strategy_profile': 'demo_strategy', 'target_id': 'demo/a'},
                    {'platform_id': 'demo', 'strategy_profile': 'demo_strategy', 'target_id': 'demo/b'}]
        rounds = []
        def run(args, **kwargs):
            if args[2] == 'ls':
                rounds.append(1)
                return subprocess.CompletedProcess(args, 0, ENV['DIGEST_CANDIDATES_GCS_URI'] + f'/p/{DAY}/a.json', '')
            rows = [dict(row, business_day=DAY, actually_ran=False) for row in (expected[:1] if len(rounds) == 1 else expected)]
            Path(args[4]).write_text(json.dumps({'runs': rows}))
            return subprocess.CompletedProcess(args, 0, '', '')
        with mock.patch.dict(os.environ, {'DIGEST_EXPECTED_TARGETS_JSON': json.dumps(expected)}, clear=True):
            clock = Clock()
            result, payload = self.execute(run, clock)
        self.assertEqual((result['status'], result['attempts'], clock.elapsed), ('loaded', 2, 30))
        self.assertEqual(len(payload['runs']), 2)

    def test_cross_process_upstream_budget_does_not_reset(self):
        runner = mock.Mock(return_value=subprocess.CompletedProcess([], 0, '', ''))
        clock = Clock('07:01:59')
        result, _ = self.execute(runner, clock, {'DIGEST_UPSTREAM_END_AT': stamp('07:02:00').isoformat()})
        self.assertEqual(clock.elapsed, 1)
        self.assertLessEqual(runner.call_count, 1)


class WindowTests(unittest.TestCase):
    def test_fixed_date_dst_and_weekend(self):
        for value in ['2026-01-03T07:10:00+08:00', '2026-07-04T07:10:00+08:00', '2026-10-25T07:10:00+08:00']:
            now = datetime.fromisoformat(value)
            with mock.patch.dict(os.environ, {}, clear=True):
                frozen = deadline.freeze({'INPUT_EVENT_NAME': 'schedule'}, now=now)
            self.assertEqual(frozen['DIGEST_REPORT_DATE'], now.date().isoformat())
            self.assertEqual(deadline.cutoff(frozen, 7, 30).hour, 7)
            self.assertEqual(frozen['DIGEST_BUSINESS_DAY'], (now.date() - timedelta(days=1)).isoformat())

    def test_cross_date_schedule_is_unknown_and_explicit_manual_date_is_preserved(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, 'schedule_identity_unknown'):
                deadline.freeze({'INPUT_EVENT_NAME': 'schedule', 'INPUT_BUSINESS_DAY': '2026-10-20'}, now=stamp('07:10:00'))
            frozen = deadline.freeze({'INPUT_EVENT_NAME': 'workflow_dispatch', 'INPUT_BUSINESS_DAY': '2026-10-20'}, now=stamp('07:10:00'))
        self.assertEqual(frozen['DIGEST_REPORT_DATE'], '2026-10-21')

    def test_guard_uses_frozen_report_date_even_after_midnight(self):
        with mock.patch.dict(os.environ, ENV, clear=True):
            self.assertEqual(guard.report_date(), ENV['DIGEST_REPORT_DATE'])

    def test_blocking_read_timer_interrupts_and_restores_handler(self):
        import signal
        import time
        before = signal.getsignal(signal.SIGALRM)
        with self.assertRaisesRegex(deadline.ReadBudgetExceeded, 'digest_read_budget_exhausted'):
            with deadline.read_budget(0.01):
                time.sleep(1)
        self.assertEqual(signal.getsignal(signal.SIGALRM), before)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))


class SenderTests(unittest.TestCase):
    def execute(self, clock='07:31:00', *, missing=False, decision=None, accepted=True,
                builder=None, maintenance_client=None, write_failure=False, phase_clock=None):
        captured = []
        env = dict(ENV)
        def send(**kwargs):
            captured.append(kwargs['text'])
            return accepted
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            path = Path(tmp) / 'receipt.json'
            stack.enter_context(mock.patch.dict(os.environ, env, clear=True))
            stack.enter_context(mock.patch.object(deadline, 'utc_now', side_effect=phase_clock or (lambda: stamp(clock))))
            stack.enter_context(mock.patch.object(sender.resend_guard, 'evaluate', return_value=decision or guard.Decision('send', 'FIRST_SEND')))
            stack.enter_context(mock.patch.object(sender, 'diagnose_telegram_route', return_value={'warnings': []}))
            stack.enter_context(mock.patch.object(sender, 'missing_delivery_requirements', return_value=['synthetic missing'] if missing else []))
            token = stack.enter_context(mock.patch.object(sender, 'resolve_telegram_token', return_value='synthetic-token'))
            stack.enter_context(mock.patch.object(sender, 'resolve_telegram_chat_id', return_value='12345'))
            stack.enter_context(mock.patch.object(sender, 'send_telegram_message', side_effect=send))
            stack.enter_context(mock.patch.object(sender.maintenance, 'send_strict_telegram', side_effect=send))
            stack.enter_context(mock.patch.object(sender.maintenance.MaintenanceClient, 'from_environment', return_value=maintenance_client))
            aggregate = stack.enter_context(mock.patch.object(sender.aggregator, 'build_digest_payload', side_effect=builder or AssertionError('late must not aggregate')))
            writes = []
            real_write = sender._write_receipt
            def write(receipt_path, receipt):
                writes.append(dict(receipt))
                if write_failure and receipt.get('status') == 'delivered':
                    raise OSError('synthetic persistence failure')
                real_write(receipt_path, receipt)
            stack.enter_context(mock.patch.object(sender, '_write_receipt', side_effect=write))
            stack.enter_context(redirect_stdout(io.StringIO()))
            stack.enter_context(redirect_stderr(io.StringIO()))
            try:
                code = sender.main(['--business-day', DAY, '--locale', 'zh', '--no-github', '--write-receipt', str(path)])
            except OSError:
                code = 'persistence_failed'
            receipt = json.loads(path.read_text()) if path.exists() else None
            return code, receipt, captured, aggregate.call_count, token.call_count, writes

    def test_late_start_sends_one_failure_without_upstream_or_maintenance(self):
        code, receipt, sent, calls, _, writes = self.execute()
        self.assertEqual((code, calls, len(sent)), (1, 0, 1))
        self.assertIn('late', sent[0])
        self.assertEqual(receipt['status'], 'delivered')
        self.assertTrue(receipt['business_digest_failed'])
        self.assertEqual(receipt['business_day'], DAY)
        self.assertEqual([row['status'] for row in writes], ['sending', 'delivered'])
        self.assertIsNone(receipt['total_fills'])
        self.assertIn('accepted_at', receipt)
        self.assertNotIn('receipt_persisted_at', receipt)

    def test_before_deadline_cutoff_failure_is_single_nonlate_notice(self):
        code, receipt, sent, calls, _, _ = self.execute('07:20:00')
        self.assertEqual((code, calls, len(sent)), (1, 0, 1))
        self.assertNotIn('late', sent[0])
        self.assertFalse(receipt['late'])

    def test_late_reminder_reserve_ack_are_preserved_and_never_retried(self):
        from types import SimpleNamespace
        reminder = SimpleNamespace(phase='7', block=lambda locale: 'synthetic maintenance')
        for granted in [True, False]:
            client = SimpleNamespace(diagnostic=sender.maintenance.empty_diagnostic(),
                read_due=mock.Mock(return_value=reminder), reserve=mock.Mock(return_value=granted),
                ack=mock.Mock(return_value='delivered'))
            code, receipt, sent, _, _, _ = self.execute(maintenance_client=client)
            self.assertEqual((code, len(sent)), (1, 1))
            client.read_due.assert_called_once()
            client.reserve.assert_called_once_with(reminder)
            self.assertEqual(client.ack.call_count, 1 if granted else 0)
            self.assertEqual('synthetic maintenance' in sent[0], granted)

    def test_api_acceptance_time_is_captured_before_maintenance_ack(self):
        from types import SimpleNamespace
        clock = Clock('07:20:00')
        reminder = SimpleNamespace(phase='7', block=lambda locale: 'synthetic maintenance')
        def ack(*args):
            clock.sleep(660)
            return 'delivered'
        client = SimpleNamespace(diagnostic=sender.maintenance.empty_diagnostic(),
            read_due=lambda: reminder, reserve=lambda reminder: True, ack=ack)
        code, receipt, sent, _, _, _ = self.execute(maintenance_client=client, phase_clock=clock.now)
        self.assertEqual(receipt['accepted_at'], stamp('07:20:00').isoformat())
        self.assertFalse(receipt['late'])
        self.assertEqual(len(sent), 1)

    def test_guard_skip_and_missing_credentials_block_late(self):
        code, receipt, sent, calls, tokens, _ = self.execute(decision=guard.Decision('skip', 'ALREADY_DELIVERED'))
        self.assertEqual((code, len(sent), calls, tokens), (0, 0, 0, 0))
        code, receipt, sent, _, _, _ = self.execute(missing=True)
        self.assertEqual((code, receipt['status'], len(sent)), (2, 'blocked_missing_secrets', 0))

    def test_timeout_rejection_and_unknown_have_no_retry(self):
        code, receipt, sent, _, _, writes = self.execute(accepted=False)
        self.assertEqual(len(sent), 1)
        self.assertEqual(receipt['status'], 'send_failed')
        self.assertEqual(receipt['delivery_outcome'], 'unknown')
        self.assertEqual(len(writes), 2)

    def test_accepted_then_receipt_write_failure_never_sends_again(self):
        code, receipt, sent, _, _, _ = self.execute(write_failure=True)
        self.assertEqual((code, len(sent), receipt['status']), ('persistence_failed', 1, 'sending'))

    def test_complete_digest_rendered_early_is_replaced_before_send(self):
        from types import SimpleNamespace
        payload = SimpleNamespace(locale='zh', business_day=DAY, runs=[], notification_summary={})
        def builder(**kwargs):
            return payload, 'synthetic normal digest', []
        times = iter([stamp('07:10:00'), stamp('07:10:00'), stamp('07:10:00'), stamp('07:29:31')])
        now = lambda: next(times, stamp('07:29:31'))
        with mock.patch.object(sender.aggregator, 'build_receipt', return_value={'total_fills': 0, 'total_fills_status': 'known'}):
            code, receipt, sent, calls, _, _ = self.execute('07:10:00', builder=builder, phase_clock=now)
        self.assertEqual((calls, len(sent), code), (1, 1, 1))
        self.assertIn('late', sent[0])
        self.assertNotIn('normal digest', sent[0])

    def test_late_and_normal_share_same_original_guard_in_all_modes(self):
        for mode in ['immediate', 'daily_digest']:
            env = {**ENV, 'QSL_ROUTINE_NOTIFICATION_MODE': mode}
            for status, delivered in [('delivered', True), ('sending', False), ('send_failed', False), ('business_digest_failed', False)]:
                marker = {'business_day': DAY, 'report_date': ENV['DIGEST_REPORT_DATE'], 'recipient_scope': 'default',
                          'status': status, 'dry_run': False, 'delivered': delivered, 'late': True}
                with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(guard, 'read_history', return_value=[(1, marker)]):
                    result = guard.evaluate(DAY, env)
                self.assertEqual(result.decision, 'skip' if delivered else 'blocked')

    def test_guard_budget_exhaustion_is_terminal_without_retry(self):
        with mock.patch.dict(os.environ, ENV, clear=True), mock.patch.object(guard, 'read_history', side_effect=TimeoutError('guard_read_budget_exhausted')) as read:
            result = guard.evaluate(DAY, ENV)
        self.assertEqual(read.call_count, 1)
        self.assertEqual(result.history_error, 'guard_read_budget_exhausted')

    def test_public_timing_fields_never_copy_private_prose(self):
        projected = public.project_public_receipt({'accepted_at': 'private-token', 'deadline_at': stamp('07:30:00').astimezone(deadline.timezone.utc).isoformat(), 'late': True, 'business_digest_failed': True})
        self.assertIsNone(projected['accepted_at'])
        self.assertTrue(projected['late'])
        self.assertNotIn('private-token', json.dumps(projected))

    def test_normal_transport_requires_valid_message_and_keeps_frozen_timeout(self):
        for payload, expected in [({'ok': True}, False), ({'ok': True, 'result': {'message_id': 1, 'chat': {'id': 12345}}}, True)]:
            response = mock.MagicMock()
            response.__enter__.return_value.read.return_value = json.dumps(payload).encode()
            with mock.patch.object(sender.urllib.request, 'urlopen', return_value=response) as open_request:
                self.assertEqual(sender.send_telegram_message(token='synthetic', chat_id='12345', text='synthetic'), expected)
                self.assertEqual(open_request.call_args.kwargs['timeout'], 30)


if __name__ == '__main__':
    unittest.main()
