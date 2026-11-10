"""Boundary regressions for the Azure timer adapter."""
import sys
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import cloud_run_daily_digest as core
from azure_timer_digest import ScheduleUnavailable, execute_scheduled, execute_timer, resolve_slot, window_slot

NOW = datetime.fromisoformat('2026-11-10T07:31:00+08:00')


class ScheduleTests(unittest.TestCase):
    def test_next_is_original_slot_with_singapore_date(self):
        schedule = {'Last': '2026-11-08T23:30:00Z', 'Next': '2026-11-09T23:00:00Z'}
        send = resolve_slot(schedule, NOW)
        schedule['Next'] = '2026-11-09T23:30:00Z'
        check = resolve_slot(schedule, NOW)
        self.assertEqual(send[0].isoformat(), '2026-11-10')
        self.assertEqual(check[0], send[0])
        self.assertIs(send[1], False)
        self.assertIs(check[1], True)

    def test_no_schedule_never_touches_ledger_or_sender(self):
        store, send = Mock(), Mock()
        variants = [{}, None, *({'Next': stamp} for stamp in (
            None, '2026-11-09T23:00:12Z', '2026-11-09T23:00:00', '2026-11-10T23:00:00Z',
        ))]
        for schedule in variants:
            with self.subTest(schedule=schedule), self.assertRaises(ScheduleUnavailable):
                execute_timer(schedule, Mock(), store, send, now=lambda: NOW)
        self.assertEqual(store.mock_calls, [])
        send.assert_not_called()

    def test_past_due_previous_day_expires_without_touching_ledger(self):
        store, send = Mock(), Mock()
        code, result = execute_timer(
            {'Next': '2026-11-08T23:00:00Z'}, Mock(), store, send, now=lambda: NOW,
        )
        self.assertEqual((code, result['delivery']), (200, 'expired_slot'))
        self.assertEqual(store.mock_calls, [])
        send.assert_not_called()

    def test_direct_window_timestamp_preserves_slot_and_provenance(self):
        stamp = datetime.fromisoformat('2026-11-09T23:30:00+00:00')
        with patch.object(core, 'execute_slot', return_value=(200, {})) as execute:
            execute_scheduled(stamp, Mock(), Mock(), Mock(), now=lambda: NOW,
                              provenance='azure_logic_sliding_window')
        args = execute.call_args.args
        self.assertEqual((args[0].isoformat(), args[1], args[2]), ('2026-11-10', '2026-11-09', True))
        self.assertEqual(args[3], {'scheduled_at': stamp.isoformat(),
                                   'trigger_provenance': 'azure_logic_sliding_window'})

    def test_google_retains_subminute_tolerance_while_azure_rejects_it(self):
        stamp = '2026-11-09T23:00:12.123456+00:00'
        config = Mock(scheduler_job='projects/p/locations/l/jobs/j')
        result = core.report_slot({'X-CloudScheduler-JobName': 'j',
                                   'X-CloudScheduler-ScheduleTime': stamp}, config, NOW)
        self.assertEqual((result[0].isoformat(), result[1], result[3]),
                         ('2026-11-10', '2026-11-09', False))
        with self.assertRaises(ScheduleUnavailable):
            resolve_slot({'Next': stamp}, NOW)

    def test_container_window_supplies_original_time_at_the_boundary(self):
        start, end = '2026-11-08T23:00:00Z', '2026-11-09T23:00:00Z'
        stamp = window_slot(start, end, 86400, NOW)
        self.assertEqual(stamp.isoformat(), '2026-11-09T23:00:00+00:00')
        for bad_start, bad_end in ((None, end), (start, '2026-11-09T23:00:01Z'),
                                   (start, '2026-11-10T23:00:00Z')):
            with self.subTest(start=bad_start, end=bad_end), self.assertRaisesRegex(
                ValueError, 'unverified_sliding_window'
            ):
                window_slot(bad_start, bad_end, 86400, NOW)

    def test_deadline_receipt_is_separate_create_only_and_keeps_first_result(self):
        store, send = Mock(), Mock()
        store.delivery.return_value = {
            'report_date': '2026-11-10', 'business_day': '2026-11-09',
            'recipient_scope': 'synthetic', 'delivery': 'accepted', 'late': False,
        }
        configuration = Mock(recipient_scope='synthetic', cutover_date='2026-11-10', enabled=True)
        slot = datetime.fromisoformat('2026-11-09T23:30:00Z')
        store.reserve.return_value = (True, 1)
        code, result = execute_scheduled(slot, configuration, store, send, now=lambda: NOW)
        self.assertEqual((code, result['delivery'], result['deadline_receipt']), (200, 'confirmed', 'recorded'))
        key, receipt = store.reserve.call_args.args
        self.assertEqual(key, 'synthetic/deadline-checks/2026-11-10.json')
        self.assertEqual(receipt['delivery'], 'confirmed')
        store.delivery.assert_called_once_with('synthetic/2026-11-10.json')

        store.reserve.return_value = (False, {**receipt, 'delivery': 'receipt_unverified'})
        code, result = execute_scheduled(slot, configuration, store, send, now=lambda: NOW)
        self.assertEqual((code, result['delivery'], result['deadline_receipt']),
                         (200, 'receipt_unverified', 'already_recorded'))
        store.finish.assert_not_called()
        send.assert_not_called()

    def test_deadline_receipt_storage_failure_retries_check_without_sending(self):
        store, send = Mock(), Mock()
        store.delivery.return_value = None
        store.reserve.side_effect = core.StoreUnavailable()
        configuration = Mock(recipient_scope='synthetic', cutover_date='2026-11-10', enabled=True)
        slot = datetime.fromisoformat('2026-11-09T23:30:00Z')
        code, result = execute_scheduled(slot, configuration, store, send, now=lambda: NOW)
        self.assertEqual((code, result['delivery'], result['deadline_receipt']),
                         (503, 'receipt_unverified', 'unverified'))
        send.assert_not_called()
