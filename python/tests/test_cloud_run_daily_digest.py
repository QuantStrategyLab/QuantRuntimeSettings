"""Cloud Run delivery tests use synthetic rows, clocks, storage and transport."""
import io
import json
import os
import sys
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import cloud_run_daily_digest as app
from test_daily_digest_ux import config
from test_notification_consolidation import candidate

NOW = datetime.fromisoformat('2026-10-16T07:00:00+08:00')
JOB = 'projects/synthetic/locations/synthetic/jobs/daily-digest'
HEADERS = {'X-CloudScheduler-JobName': JOB, 'X-CloudScheduler-ScheduleTime': NOW.isoformat()}
ROW = candidate()
EXPECTED = [{**{key: ROW[key] for key in app.IDENTITY}, 'candidate_slot': 'synthetic-slot'}]


class MemoryStore:
    def __init__(self, rows=None):
        self.rows = rows if rows is not None else {'schwab/2026-10-15/synthetic-slot.json': {'runs': [ROW]}}
        self.records, self.lock = {}, threading.Lock()
        self.unreadable = set()
        self.fail_finish = False

    def candidate(self, key, timeout):
        if key in self.unreadable:
            raise app.StoreUnavailable()
        return self.rows.get(key)

    def reserve(self, key, record):
        with self.lock:
            if key in self.records:
                return False, self.records[key]
            self.records[key] = dict(record)
            return True, 1

    def finish(self, key, generation, record):
        if self.fail_finish:
            raise app.StoreUnavailable()
        self.records[key] = dict(record)

    def delivery(self, key):
        return self.records.get(key)


class CloudRunDigestTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true'}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.configuration = app.Configuration(EXPECTED, JOB, 'synthetic', '2026-10-16', False, 'zh')
        self.store, self.sent = MemoryStore(), []
        self.now = NOW

    def send(self, text):
        self.sent.append(text)
        return 123

    def run_request(self, *, preview=False, headers=None, configuration=None, sender=None):
        return app.execute(headers or HEADERS, configuration or self.configuration, self.store,
                           sender or self.send, preview=preview, now=lambda: self.now,
                           platform_config=config(EXPECTED))

    def enable(self):
        from dataclasses import replace
        return replace(self.configuration, enabled=True)

    def test_preview_never_reserves_or_sends_and_returns_no_financial_body(self):
        self.store.rows[next(iter(self.store.rows))]['runs'][0] = dict(ROW, equity_usd=123456)
        status, result = self.run_request(preview=True)
        self.assertEqual((status, result['delivery']), (200, 'preview'))
        self.assertFalse(self.sent or self.store.records)
        self.assertNotIn('123456', json.dumps(result))
        self.assertNotIn('text', result)

    def test_sdk_reads_do_not_require_an_actions_candidate_status_variable(self):
        with patch.dict(os.environ, {'DIGEST_CANDIDATES_GCS_URI': 'gs://synthetic/candidates'}):
            _, result = self.run_request(configuration=self.enable())
        self.assertEqual(result['coverage'], 'complete')
        self.assertIn('订单：0', self.sent[0])
        self.assertNotIn('覆盖不完整', self.sent[0])

    def test_disabled_real_delivery_does_not_read_or_reserve(self):
        self.store.candidate = lambda *args: self.fail('disabled path read candidates')
        status, result = self.run_request()
        self.assertEqual((status, result['delivery']), (200, 'disabled'))
        self.assertFalse(self.store.records)

    def test_same_slot_and_concurrent_invocations_send_once(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.run_request(configuration=self.enable()), range(8)))
        self.assertEqual(len(self.sent), 1)
        self.assertTrue(all(status == 200 for status, _ in results))
        self.assertEqual(len(self.store.records), 1)
        self.assertEqual(next(iter(self.store.records.values()))['delivery'], 'accepted')

    def test_telegram_unknown_is_not_automatically_resent(self):
        def uncertain(text):
            self.sent.append(text)
            raise TimeoutError()
        _, first = self.run_request(configuration=self.enable(), sender=uncertain)
        _, second = self.run_request(configuration=self.enable())
        self.assertEqual((first['delivery'], second['delivery']), ('unknown', 'unknown'))
        self.assertEqual(len(self.sent), 1)

    def test_accepted_but_receipt_write_failed_stays_reserved(self):
        self.store.fail_finish = True
        _, first = self.run_request(configuration=self.enable())
        _, second = self.run_request(configuration=self.enable())
        self.assertEqual((first['delivery'], second['delivery']), ('unknown', 'unknown'))
        self.assertEqual(len(self.sent), 1)

    def test_one_missing_target_keeps_valid_target_without_a_fake_global_zero(self):
        from dataclasses import replace
        another = {**EXPECTED[0], 'target_id': 'synthetic-target-2', 'opaque_account_uid': 'synthetic-account-2',
                   'candidate_slot': 'synthetic-slot-2'}
        configuration = replace(self.enable(), expected=[*EXPECTED, another])
        _, result = self.run_request(configuration=configuration)
        self.assertEqual((result['coverage'], result['delivery']), ('partial', 'accepted'))
        self.assertIn('全窗口统计未知', self.sent[0])
        self.assertIn('未找到当日报告', self.sent[0])
        self.assertIn('本轮 0 单', self.sent[0])
        self.assertIn('Binance：未接入，运行状态未知', self.sent[0])
        self.assertNotIn('Binance：运行 0', self.sent[0])

    def test_invalid_or_unreadable_target_does_not_discard_another_platform(self):
        from dataclasses import replace
        other = {**EXPECTED[0], 'platform_id': 'ibkr', 'candidate_slot': 'other'}
        configuration = replace(self.enable(), expected=[*EXPECTED, other])
        for value in ({'runs': [{'private': 'must-not-leak'}]}, {'runs': [dict(ROW, platform_id='ibkr', target_id='wrong')]}):
            with self.subTest(value=value):
                self.store = MemoryStore({
                    'schwab/2026-10-15/synthetic-slot.json': {'runs': [ROW]},
                    'ibkr/2026-10-15/other.json': value,
                })
                _, result = self.run_request(configuration=configuration)
                self.assertEqual(result['coverage'], 'partial')
                self.assertNotIn('must-not-leak', self.sent[-1])

    def test_no_source_still_sends_explicit_unavailable_report(self):
        self.store.rows = {}
        _, result = self.run_request(configuration=self.enable())
        self.assertEqual((result['coverage'], result['delivery']), ('unavailable', 'accepted'))
        self.assertNotIn('订单：0', self.sent[0])
        self.assertIn('未知', self.sent[0])

    def test_sdk_read_failure_overrides_legacy_loaded_state(self):
        self.store.unreadable.add(next(iter(self.store.rows)))
        with patch.dict(os.environ, {'DIGEST_CANDIDATES_STORE_STATUS': 'loaded'}):
            _, result = self.run_request(configuration=self.enable())
        self.assertEqual(result['coverage'], 'unavailable')
        self.assertIn('报告读取失败', self.sent[0])
        self.assertNotIn('订单：0', self.sent[0])

    def test_explicit_non_run_is_distinct_from_missing_without_inventing_its_cause(self):
        idle = {**ROW, 'actually_ran': False}
        for key in ('notification_event', 'source_run_id'):
            idle.pop(key, None)
        self.store.rows[next(iter(self.store.rows))] = {'runs': [idle]}
        _, result = self.run_request(configuration=self.enable())
        self.assertEqual(result['coverage'], 'complete')
        self.assertIn('报告注明未运行', self.sent[0])
        self.assertNotIn('休市', self.sent[0])

    def test_retry_keeps_original_report_date_and_rejects_another_day(self):
        self.now = NOW + timedelta(days=1)
        status, result = self.run_request(configuration=self.enable())
        self.assertEqual((status, result['delivery']), (200, 'expired_slot'))
        self.assertEqual(result['report_date'], '2026-10-16')
        self.assertFalse(self.sent)

    def test_wrong_job_missing_time_future_or_wrong_slot_is_rejected(self):
        for headers in ({'X-CloudScheduler-JobName': 'wrong'},
                        {**HEADERS, 'X-CloudScheduler-ScheduleTime': '2026-10-16T08:00:00+08:00'},
                        {**HEADERS, 'X-CloudScheduler-ScheduleTime': '2026-10-17T07:00:00+08:00'}):
            status, _ = self.run_request(headers=headers, configuration=self.enable())
            self.assertEqual(status, 400)
        self.assertFalse(self.sent or self.store.records)

    def test_after_cutoff_sends_one_late_notice_without_reading_candidates(self):
        self.now = NOW + timedelta(hours=2)
        self.store.candidate = lambda *args: self.fail('late path read candidates')
        for _ in range(2):
            self.run_request(configuration=self.enable())
        self.assertEqual(len(self.sent), 1)
        self.assertIn('late', self.sent[0])

    def test_different_language_or_release_does_not_bypass_daily_reservation(self):
        from dataclasses import replace
        self.run_request(configuration=self.enable())
        self.run_request(configuration=replace(self.enable(), locale='en'))
        self.assertEqual(len(self.sent), 1)

    def test_preview_can_validate_archived_inputs_after_cutoff_without_delivery(self):
        self.now = NOW + timedelta(days=1, hours=5)
        status, result = self.run_request(preview=True)
        self.assertEqual((status, result['coverage'], result['delivery']), (200, 'complete', 'preview'))
        self.assertEqual(result['report_date'], '2026-10-16')
        self.assertFalse(self.sent or self.store.records)

    def test_transport_ack_after_deadline_is_reported_as_late(self):
        def slow_send(text):
            self.sent.append(text)
            self.now = NOW + timedelta(minutes=30, seconds=1)
            return 123
        _, result = self.run_request(configuration=self.enable(), sender=slow_send)
        self.assertTrue(result['late'])
        self.assertTrue(next(iter(self.store.records.values()))['late'])

    def test_source_budget_retains_earlier_valid_sources(self):
        from dataclasses import replace
        other = {**EXPECTED[0], 'platform_id': 'ibkr', 'candidate_slot': 'other'}
        configuration = replace(self.enable(), expected=[*EXPECTED, other])
        original = self.store.candidate
        def slow_read(key, timeout):
            value = original(key, timeout)
            self.now = NOW + timedelta(minutes=21)
            return value
        self.store.candidate = slow_read
        _, result = self.run_request(configuration=configuration)
        self.assertEqual((result['coverage'], result['delivery']), ('partial', 'accepted'))
        self.assertIn('报告读取失败', self.sent[0])

    def test_configuration_rejects_ambiguous_slots_and_target_bindings(self):
        from dataclasses import replace
        for expected in ([EXPECTED[0], EXPECTED[0]], [{**EXPECTED[0], 'candidate_slot': '../wrong'}]):
            with self.assertRaises(ValueError):
                replace(self.configuration, expected=expected)

    def test_stdout_contains_no_message_or_private_source_values(self):
        stream = io.StringIO()
        from contextlib import redirect_stdout
        with redirect_stdout(stream):
            self.run_request(configuration=self.enable())
        self.assertNotIn(ROW['opaque_account_uid'], stream.getvalue())
        self.assertNotIn('每日交易摘要', stream.getvalue())

    def test_deadline_check_confirms_persisted_receipt_without_another_send(self):
        self.run_request(configuration=self.enable())
        self.now = NOW + timedelta(minutes=30)
        headers = {**HEADERS, 'X-CloudScheduler-ScheduleTime': self.now.isoformat()}
        self.store.candidate = lambda *args: self.fail('deadline check read financial inputs')
        _, result = self.run_request(headers=headers, configuration=self.enable())
        self.assertEqual((result['delivery'], result['phase']), ('confirmed', 'deadline_check'))
        self.assertEqual(len(self.sent), 1)

    def test_deadline_check_missing_or_uncertain_receipt_does_not_send_or_reserve(self):
        self.now = NOW + timedelta(minutes=30)
        headers = {**HEADERS, 'X-CloudScheduler-ScheduleTime': self.now.isoformat()}
        _, result = self.run_request(headers=headers, configuration=self.enable())
        self.assertEqual(result['delivery'], 'receipt_unverified')
        self.assertFalse(self.sent or self.store.records)


class OldSenderRetirementTests(unittest.TestCase):
    def test_cloud_run_owner_blocks_legacy_real_delivery_before_history_or_credentials(self):
        from contextlib import redirect_stderr

        import send_daily_digest_telegram as legacy
        with patch.dict(os.environ, {'DIGEST_DELIVERY_RUNTIME': 'cloud_run'}, clear=True), \
             patch.object(legacy.resend_guard, 'evaluate', side_effect=AssertionError('history was read')), \
             patch.object(legacy, 'resolve_telegram_token', side_effect=AssertionError('credential was read')), \
             redirect_stderr(io.StringIO()):
            self.assertEqual(legacy.main([]), 2)

    def test_cloud_run_owner_allows_only_manual_preview_in_actions(self):
        import subprocess
        import tempfile
        import textwrap
        source = (Path(__file__).resolve().parents[2] / '.github/workflows/daily-digest-notify.yml').read_text()
        step = source.split('      - name: Require explicit manual preview', 1)[1].split('\n      - name:', 1)[0]
        script = textwrap.dedent(step.split('        run: |\n', 1)[1])
        for event, dry, expected in (('schedule', 'false', False), ('workflow_dispatch', 'false', False),
                                      ('workflow_dispatch', 'true', True)):
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'output'
                environment = {'PATH': os.environ['PATH'], 'DIGEST_DELIVERY_RUNTIME': 'cloud_run',
                               'DIGEST_EVENT_NAME': event, 'DIGEST_INPUT_DRY_RUN': dry,
                               'DIGEST_EVENT_SCHEDULE': '0 23 * * *', 'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true',
                               'GITHUB_OUTPUT': str(output)}
                result = subprocess.run(['bash', '-c', script], env=environment, capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(output.read_text(), f'proceed={str(expected).lower()}\n')


if __name__ == '__main__':
    unittest.main()
