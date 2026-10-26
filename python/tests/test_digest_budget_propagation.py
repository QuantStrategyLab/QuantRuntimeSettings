"""L12-R1: real alarms must leave source/page and read-fallback boundaries."""
from datetime import timedelta
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import daily_digest_deadline as deadline
import daily_digest_aggregator as aggregator
import daily_digest_resend_guard as guard
import fetch_daily_digest_candidates as fetcher
import merge_digest_candidates as merger
from test_daily_digest_deadline import SenderTests, ENV, stamp

ENTRIES = [{'platform_id': f'p{i}', 'repository': 'synthetic/only', 'workflow': f'w{i}.yml', 'strategy_profile': 'synthetic'} for i in (1, 2)]


class BudgetPropagationTests(unittest.TestCase):
    def test_real_alarm_in_first_source_prevents_next_source_and_event(self):
        calls = []
        def get(url, token):
            calls.append(url)
            time.sleep(.15)
            return {'workflow_runs': [], 'total_count': 0}
        with mock.patch.object(aggregator, '_gh_api_get', side_effect=get):
            with self.assertRaises(deadline.ReadBudgetExceeded):
                with deadline.read_budget(.03):
                    aggregator.collect_from_github_workflows(business_day='2026-10-22', config={}, token='synthetic', allowlist=ENTRIES)
        self.assertEqual(len(calls), 1)

    def test_real_alarm_on_page_two_prevents_next_page_and_source(self):
        calls = []
        def get(url, token):
            calls.append(url)
            if len(calls) == 1:
                return {'workflow_runs': [{'conclusion': 'failure'} for _ in range(100)], 'total_count': 201}
            time.sleep(.15)
            return {'workflow_runs': [{'conclusion': 'failure'} for _ in range(100)], 'total_count': 201}
        with mock.patch.object(aggregator, '_gh_api_get', side_effect=get):
            with self.assertRaises(deadline.ReadBudgetExceeded):
                with deadline.read_budget(.03):
                    aggregator.collect_from_github_workflows(business_day='2026-10-22', config={}, token='synthetic', allowlist=ENTRIES)
        self.assertEqual(len(calls), 2)
        self.assertTrue(all('/w1.yml/' in value for value in calls))
        self.assertIn('page=2', calls[1])

    def test_ordinary_network_timeout_still_degrades_one_source_and_continues(self):
        calls = []
        def get(url, token):
            calls.append(url)
            if len(calls) == 1:
                raise TimeoutError('synthetic transport timeout')
            return {'workflow_runs': [], 'total_count': 0}
        with mock.patch.object(aggregator, '_gh_api_get', side_effect=get), deadline.read_budget(1):
            result = aggregator.collect_from_github_workflows(business_day='2026-10-22', config={}, token='synthetic', allowlist=ENTRIES)
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(result.failures), 1)
        self.assertEqual(result.failures[0]['reason_code'], 'github_api_error')

    def test_candidate_oserror_fallback_does_not_swallow_phase_expiry(self):
        def read(_path):
            time.sleep(.15)
            return [], True, True
        with mock.patch.dict(os.environ, {'DIGEST_CANDIDATES_STORE_STATUS': 'failed'}, clear=True), \
             mock.patch.object(aggregator, 'load_candidates_from_file', side_effect=read), \
             mock.patch.object(aggregator, 'collect_from_github_workflows') as later:
            with self.assertRaises(deadline.ReadBudgetExceeded), deadline.read_budget(.03):
                aggregator.collect_digest_runs(business_day='2026-10-22', config={})
            later.assert_not_called()

    def test_merge_oserror_fallback_does_not_turn_phase_expiry_into_schema_failure(self):
        def read(*args, **kwargs):
            time.sleep(.15)
            return '{"runs": []}'
        with mock.patch.object(Path, 'read_text', side_effect=read):
            with self.assertRaises(deadline.ReadBudgetExceeded), deadline.read_budget(.03):
                merger._read_rows(Path('synthetic.json'))

    def test_guard_broad_exception_handler_rethrows_expiry_to_terminal_boundary(self):
        original_budget = deadline.read_budget
        def read(*args):
            time.sleep(.15)
            return []
        with mock.patch.dict(os.environ, ENV, clear=True), \
             mock.patch.object(guard, 'read_history', side_effect=read) as history, \
             mock.patch.object(deadline, 'read_budget', side_effect=lambda seconds, reason: original_budget(.03, reason)):
            result = guard.evaluate('2026-10-22', ENV)
        self.assertEqual(history.call_count, 1)
        self.assertEqual((result.decision, result.history_error), ('blocked', 'guard_read_budget_exhausted'))

    def test_fetch_boundary_records_expiry_without_retry_or_schema_downgrade(self):
        start = stamp('07:10:00')
        env = {**ENV, 'DIGEST_UPSTREAM_END_AT': (start + timedelta(seconds=.03)).isoformat()}
        calls = []
        def run(args, **kwargs):
            calls.append(args[2])
            if args[2] == 'ls':
                return subprocess.CompletedProcess(args, 0, ENV['DIGEST_CANDIDATES_GCS_URI'] + '/p/2026-10-22/x.json', '')
            Path(args[4]).write_text('{"runs": []}')
            return subprocess.CompletedProcess(args, 0, '', '')
        def merge(*args):
            time.sleep(.15)
            return {'runs': []}, {}
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(fetcher, 'merge', side_effect=merge):
            result = fetcher.fetch({**env, 'RUNNER_TEMP': tmp}, runner=run, now=lambda: start)
        self.assertEqual(calls, ['ls', 'cp'])
        self.assertEqual((result['attempts'], result['reason']), (1, 'candidate_store_wait_stopped'))

    def test_real_alarm_reaches_existing_sender_failure_notice_path(self):
        original_budget = deadline.read_budget
        calls = []
        def get(url, token):
            calls.append(url)
            time.sleep(.15)
            return {'workflow_runs': [], 'total_count': 0}
        def build(**kwargs):
            aggregator.collect_from_github_workflows(business_day='2026-10-22', config={}, token='synthetic', allowlist=ENTRIES)
            raise AssertionError('phase expiry should have reached sender before this line')
        with mock.patch.object(aggregator, '_gh_api_get', side_effect=get), \
             mock.patch.object(deadline, 'read_budget', side_effect=lambda seconds, reason='digest_read_budget_exhausted': original_budget(.03, reason)):
            code, receipt, sent, _, _, _ = SenderTests().execute('07:10:00', builder=build)
        self.assertEqual(len(calls), 1)
        self.assertEqual((code, len(sent), receipt['status']), (1, 1, 'delivered'))
        self.assertTrue(receipt['business_digest_failed'])
        self.assertIsNone(receipt['total_fills'])


if __name__ == '__main__':
    unittest.main()
