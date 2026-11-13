"""Cloud Run delivery tests use synthetic rows, clocks, storage and transport."""
import io
import json
import os
import sys
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from http.client import IncompleteRead
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

    def run_request(self, *, preview=False, headers=None, configuration=None, sender=None, platform_config=None):
        return app.execute(headers or HEADERS, configuration or self.configuration, self.store,
                           sender or self.send, preview=preview, now=lambda: self.now,
                           platform_config=platform_config or config(EXPECTED))

    def enable(self):
        from dataclasses import replace
        return replace(self.configuration, enabled=True)

    def test_report_lists_unbound_platforms_without_reading_them(self):
        platform_config = {**config(EXPECTED), 'platforms': {'qmt': {}}}
        read = self.store.candidate

        def only_bound_candidate(key, timeout):
            self.assertEqual(key, 'schwab/2026-10-15/synthetic-slot.json')
            return read(key, timeout)

        self.store.candidate = only_bound_candidate
        self.run_request(configuration=self.enable(), platform_config=platform_config)
        text = self.sent[0]
        self.assertIn('未接入日报来源：IBKR、LongBridge、Binance、Firstrade、QMT', text)
        self.assertIn('管理站汇总平台数据', text)
        self.assertEqual(text.count('🏦 '), 1)

    def test_binance_snapshot_shows_holdings_and_keeps_trade_counts_unknown(self):
        from dataclasses import replace

        binding = {**EXPECTED[0], 'platform_id': 'binance', 'snapshot_only': True,
                   'account_label': 'Binance'}
        cfg = replace(self.enable(), expected=[binding],
                      binance_snapshot_endpoint='https://console.example' + app.BINANCE_SNAPSHOT_PATH,
                      binance_snapshot_token='synthetic-read-only-token-for-tests')
        response = {'ok': True, 'business_day': '2026-10-15', 'as_of': '2026-10-15T16:00:00Z',
                    'account_key': binding['opaque_account_uid'], 'target_id': binding['target_id'],
                    'holdings': [{'asset': 'BTC', 'quantity': '0.0125'}, {'asset': '币', 'quantity': '1.5'},
                                 {'asset': 'A' * 128, 'quantity': '3'}]}
        with patch.object(app.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = io.BytesIO(json.dumps(response).encode())
            self.run_request(configuration=cfg, platform_config=config([binding]))
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, cfg.binance_snapshot_endpoint + '?business_day=2026-10-15&include_valuation=1')
            self.assertEqual(request.get_header('User-agent'), 'QSL-Daily-Digest/1.0')
            self.assertIsNone(opener.call_args.args[0].redirect_request(None, None, 302, None, None, None))
        text, = self.sent
        self.assertIn('🏦 Binance · 账户 · 账户快照', text)
        self.assertIn('仅核实持仓快照，交易情况未知', text)
        self.assertIn('BTC 0.0125', text)
        self.assertIn('币 1.5', text)
        self.assertIn('A' * 128 + ' 3', text)
        self.assertIn('提交订单 未知｜成交回报 未知', text)
        self.assertNotIn('策略未运行', text)

    def test_binance_wallet_valuation_is_dated_and_separate_from_holdings(self):
        from dataclasses import replace

        binding = {**EXPECTED[0], 'platform_id': 'binance', 'snapshot_only': True}
        cfg = replace(self.enable(), expected=[binding],
                      binance_snapshot_endpoint='https://console.example' + app.BINANCE_SNAPSHOT_PATH,
                      binance_snapshot_token='synthetic-read-only-token-for-tests')
        valuation = {'amount': '25.5', 'currency': 'USDT', 'as_of': '2026-10-15T15:59:00Z'}
        response = {'ok': True, 'business_day': '2026-10-15', 'as_of': '2026-10-15T16:00:00Z',
                    'account_key': binding['opaque_account_uid'], 'target_id': binding['target_id'],
                    'holdings': [{'asset': 'BTC', 'quantity': '0.0125'}]}
        for change, expected in (({}, '钱包估值（券商返回范围）：USDT 25.50 · 快照 2026-10-15 23:59'),
                                 ({'amount': '1234.12345678901234567890123456789'},
                                  '钱包估值（券商返回范围）：USDT 1,234.12345678901234567890123456789'),
                                 ({'currency': 'USD'}, '总资产：未知'),
                                 ({'as_of': '2026-10-15T16:00:01Z'}, '总资产：未知')):
            with self.subTest(change=change), patch.object(app.urllib.request, 'build_opener') as opener:
                self.store, self.sent = MemoryStore(), []
                opener.return_value.open.return_value = io.BytesIO(json.dumps({
                    **response, 'wallet_valuation': {**valuation, **change},
                }).encode())
                self.run_request(configuration=cfg, platform_config=config([binding]))
                text, = self.sent
                self.assertIn(expected, text)
                self.assertIn('BTC 0.0125', text)
                self.assertIn('提交订单 未知｜成交回报 未知', text)

    def test_binance_snapshot_rejects_wrong_account_or_out_of_window(self):
        from dataclasses import replace

        binding = {**EXPECTED[0], 'platform_id': 'binance', 'snapshot_only': True}
        cfg = replace(self.configuration, expected=[binding],
                      binance_snapshot_endpoint='https://console.example' + app.BINANCE_SNAPSHOT_PATH,
                      binance_snapshot_token='synthetic-read-only-token-for-tests')
        valid = {'ok': True, 'business_day': '2026-10-15', 'as_of': '2026-10-15T16:00:00Z',
                 'account_key': binding['opaque_account_uid'], 'target_id': binding['target_id'],
                 'holdings': []}
        for fields in ({'account_key': 'wrong-account'}, {'as_of': '2026-10-15T22:00:00Z'}):
            with self.subTest(fields=fields), patch.object(app.urllib.request, 'build_opener') as opener:
                opener.return_value.open.return_value = io.BytesIO(json.dumps({**valid, **fields}).encode())
                with self.assertRaises(ValueError):
                    app._binance_snapshot(cfg, binding, '2026-10-15', 20)

    def test_missing_binance_credentials_do_not_block_existing_accounts(self):
        from dataclasses import replace

        binding = {**EXPECTED[0], 'platform_id': 'binance', 'snapshot_only': True}
        expected = [*EXPECTED, binding]
        cfg = replace(self.enable(), expected=expected)
        self.run_request(configuration=cfg, platform_config=config(expected))
        text, = self.sent
        self.assertIn('🏦 Schwab', text)
        self.assertIn('🏦 Binance', text)
        self.assertIn('报告读取失败', text)

    def test_incomplete_binance_http_body_does_not_block_other_accounts(self):
        from dataclasses import replace

        binding = {**EXPECTED[0], 'platform_id': 'binance', 'snapshot_only': True}
        expected = [*EXPECTED, binding]
        cfg = replace(self.enable(), expected=expected,
                      binance_snapshot_endpoint='https://console.example' + app.BINANCE_SNAPSHOT_PATH,
                      binance_snapshot_token='synthetic-read-only-token-for-tests')
        with patch.object(app.urllib.request, 'build_opener') as opener:
            response = opener.return_value.open.return_value.__enter__.return_value
            response.read.side_effect = IncompleteRead(b'{')
            self.run_request(configuration=cfg, platform_config=config(expected))
        text, = self.sent
        self.assertIn('🏦 Schwab', text)
        self.assertIn('报告读取失败', text)

    def test_filled_orders_count_distinct_orders_and_preserve_unknown_totals(self):
        key = next(iter(self.store.rows))
        fill = {'order_id': 'synthetic-order', 'occurred_at': '2026-10-15T22:00:00+08:00'}
        fills = [{**fill, 'id': 'synthetic-fill-a'}, {**fill, 'id': 'synthetic-fill-b'}]
        row = {**ROW, 'order_count': 1, 'fill_count': 2}
        row.pop('notification_event')
        for records, count in ((fills, '已见 1 笔，总数未知'), (fills[:1], '已见 1 笔，总数未知'), ([], '未知')):
            with self.subTest(records=len(records)):
                self.store = MemoryStore({key: {'runs': [
                    {**row, 'account_daily_facts': {'fills': records}},
                ]}})
                self.sent = []
                self.run_request(configuration=self.enable())
                text = self.sent[0]
                self.assertIn('成交回报 2笔', text)
                self.assertIn(f'成交订单 {count}', text)
                self.assertNotIn('synthetic-order', text)

    def test_report_keeps_execution_and_evidence_failures_distinct(self):
        key = next(iter(self.store.rows))
        row = {**ROW, 'execution_status': 'blocked', 'evidence_persistence_status': 'persistence_failed',
               'evidence_delivery_status': 'delivery_failed'}
        self.store = MemoryStore({key: {'runs': [row]}})
        self.run_request(configuration=self.enable())
        text = self.sent[0]
        self.assertIn('执行已拦截', text)
        self.assertIn('证据留存失败', text)
        self.assertIn('证据传递失败', text)

    def test_schwab_confirmed_risk_block_keeps_run_scope(self):
        row = {**ROW, 'status': 'alert', 'execution_status': 'blocked',
               'order_count': None, 'fill_count': None,
               'block_reason': {'reason_code': 'strategy_risk_rejected',
                                'order_submitted_this_run': False}}
        row.pop('notification_event')
        self.store.rows[next(iter(self.store.rows))] = {'runs': [row]}
        self.run_request(configuration=self.enable())
        text, = self.sent
        self.assertIn('策略风控拦截 · 本轮 0 单', text)
        self.assertNotIn('执行异常', text)
        self.assertIn('提交订单 未知｜成交回报 未知', text)

    def test_platform_order_and_longbridge_snapshot_do_not_depend_on_roster_order(self):
        from dataclasses import replace

        longbridge = {**EXPECTED[0], 'platform_id': 'longbridge', 'account_label': 'HK'}
        fact = {k: longbridge[k] for k in app.IDENTITY}
        fact.update(business_day=ROW['business_day'], actually_ran=False,
                    account_daily_facts={'snapshots': [{
                        'as_of': '2026-10-16T05:55:00+08:00',
                        'equity': 250, 'equity_currency': 'HKD', 'holdings_scope': 'stocks_only',
                        'holdings': [
                            {'symbol': 'AAPL261120C345000.US', 'quantity': -1, 'asset_type': 'stock'},
                            {'symbol': 'SYN.US', 'quantity': 3, 'asset_type': 'stock'},
                        ],
                    }]})
        self.store.rows['longbridge/2026-10-15/synthetic-slot.json'] = {'runs': [fact]}
        self.run_request(configuration=replace(self.enable(), expected=[longbridge, *EXPECTED]))
        text, = self.sent
        self.assertLess(text.index('🏦 Schwab'), text.index('🏦 LongBridge'))
        self.assertIn('仅核实账户快照，交易情况未知', text)
        self.assertIn('AAPL261120C345000.US -1张', text)
        self.assertIn('SYN.US 3股', text)
        self.assertNotIn('空仓', text)

    def test_legacy_reported_assets_retain_unknown_snapshot_time(self):
        key = next(iter(self.store.rows))
        self.store = MemoryStore({key: {'runs': [
            {**ROW, 'equity': 250, 'equity_currency': 'USD', 'as_of': NOW.isoformat()},
        ]}})
        self.run_request(configuration=self.enable())
        self.assertIn('总资产：未知 · 来源报告 USD 250.00，快照时间未知', self.sent[0])
        self.assertIn('持仓：未知', self.sent[0])

    def test_account_snapshot_keeps_independently_verified_fields(self):
        position = {'symbol': 'TQQQ', 'asset_type': 'etf', 'quantity': 3}
        snapshot = {'as_of': '2026-10-16T05:10:00+08:00', 'equity': 250,
                    'equity_currency': 'USD', 'holdings_scope': 'account',
                    'holdings_complete': True, 'holdings': [position]}
        cases = (
            ({'equity_currency': None}, ('总资产：未知', 'TQQQ 3股'), ('USD 250.00',)),
            ({'holdings': None}, ('总资产：USD 250.00', '持仓：未知'), ('空仓',)),
            ({'holdings': [position, {'symbol': 'BOXX'}]},
             ('总资产：USD 250.00', '仅列已核实持仓', 'TQQQ 3股'), ('空仓',)),
        )
        for changes, included, excluded in cases:
            with self.subTest(changes=changes):
                key = 'schwab/2026-10-15/synthetic-slot.json'
                row = {**ROW, 'account_daily_facts': {'snapshots': [{**snapshot, **changes}]}}
                self.store, self.sent = MemoryStore({key: {'runs': [row]}}), []
                status, result = self.run_request(configuration=self.enable())
                self.assertEqual((status, result['delivery']), (200, 'accepted'))
                self.assertIn('2026-10-16 05:10 UTC+8', self.sent[0])
                for part in included:
                    self.assertIn(part, self.sent[0])
                for part in excluded:
                    self.assertNotIn(part, self.sent[0])

    def test_ibkr_empty_stock_snapshot_does_not_claim_full_account_empty(self):
        from dataclasses import replace

        binding = {**EXPECTED[0], 'platform_id': 'ibkr'}
        configuration = replace(self.enable(), expected=[binding])
        key = f"ibkr/{ROW['business_day']}/{binding['candidate_slot']}.json"
        snapshot = {'as_of': '2026-10-16T05:10:00+08:00',
                    'holdings_scope': 'stocks_only', 'holdings': []}
        for complete, label in ((True, '已核实无股票持仓；其他资产未知'), (False, '持仓：未知')):
            with self.subTest(complete=complete):
                row = {**ROW, 'platform_id': 'ibkr', 'account_daily_facts': {
                    'snapshots': [{**snapshot, 'holdings_complete': complete}],
                }}
                row.pop('notification_event')
                self.store, self.sent = MemoryStore({key: {'runs': [row]}}), []
                self.run_request(configuration=configuration)
                self.assertIn(label, self.sent[0])
                self.assertNotIn('持仓：空仓', self.sent[0])

    def test_ibkr_account_report_reads_cash_without_changing_run_coverage(self):
        from dataclasses import replace
        binding = {**EXPECTED[0], 'platform_id': 'ibkr'}
        configuration = replace(self.enable(), expected=[binding])
        key = f"ibkr/{ROW['business_day']}/{binding['candidate_slot']}.json"
        snapshot = {'as_of': (NOW - timedelta(hours=2)).isoformat(),
                    'equity': 250, 'equity_currency': 'USD',
                    'holdings': [{'symbol': 'TQQQ', 'quantity': 3, 'asset_type': 'etf'}]}
        row = {**ROW, 'platform_id': 'ibkr', 'fill_count': None,
               'account_daily_facts': {'snapshots': [snapshot]}}
        row.pop('notification_event')
        cash_key = f"ibkr/flex-cash/{binding['candidate_slot']}.json"
        cash = {'schema_version': 'ibkr_digest_settled_cash.v1', 'currency': 'USD', 'amount': '0.00',
                'statement_date': '2026-10-14', 'target_id': binding['target_id'],
                'opaque_account_uid': binding['opaque_account_uid']}
        self.store = MemoryStore({key: {'runs': [row]}, cash_key: cash})
        read = self.store.candidate

        def ordinary_candidate(requested, timeout):
            self.assertIn(requested, (key, cash_key))
            return read(requested, timeout)

        self.store.candidate = ordinary_candidate
        self.assertEqual(self.run_request(configuration=configuration)[1]['delivery'], 'accepted')
        self.assertEqual(self.run_request(configuration=configuration)[1]['delivery'], 'duplicate')
        self.now = NOW + timedelta(minutes=30)
        headers = {**HEADERS, 'X-CloudScheduler-ScheduleTime': self.now.isoformat()}
        self.store.candidate = lambda *args: self.fail('deadline check read financial inputs')
        self.assertEqual(self.run_request(configuration=configuration, headers=headers)[1]['delivery'], 'confirmed')
        self.assertEqual(len(self.sent), 1)
        self.assertIn('总资产：USD 250.00', self.sent[0])
        self.assertIn('期末已结算现金：USD 0.00 · 2026-10-14', self.sent[0])
        self.assertIn('TQQQ 3股', self.sent[0])
        self.assertIn('成交回报 未知', self.sent[0])
        self.assertNotIn('成交回报 0笔', self.sent[0])

    def test_ibkr_cash_rejects_wrong_identity_future_date_and_non_decimal(self):
        binding = {**EXPECTED[0], 'platform_id': 'ibkr'}
        cash = {'schema_version': 'ibkr_digest_settled_cash.v1', 'currency': 'USD', 'amount': '-12.34',
                'statement_date': '2026-10-15', 'target_id': binding['target_id'],
                'opaque_account_uid': binding['opaque_account_uid']}
        for change in ({'opaque_account_uid': 'different'}, {'target_id': 'different'},
                       {'statement_date': '2026-10-16'}, {'amount': '1e4'}, {'currency': 'HKD'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                app._ibkr_settled_cash({**cash, **change}, binding, '2026-10-15')

    def test_locale_variants_are_normalized_at_the_production_boundary(self):
        from dataclasses import replace
        for locale, expected in (("zh", "zh"), ("zh-CN", "zh"), (" ZH_hans ", "zh"),
                                 ("en", "en"), ("en-US", "en"), (" EN_gb ", "en")):
            with self.subTest(locale=locale):
                self.assertEqual(replace(self.configuration, locale=locale).locale, expected)
                env = dict(DIGEST_EXPECTED_TARGETS_JSON=json.dumps(EXPECTED),
                           DIGEST_SCHEDULER_JOB_NAME=JOB, DIGEST_RECIPIENT_SCOPE="synthetic",
                           DIGEST_CUTOVER_REPORT_DATE="2026-10-16", QSL_NOTIFY_LANG=locale)
                with patch.dict(os.environ, env):
                    self.assertEqual(app.Configuration.from_environment().locale, expected)
        for locale in ("", "fr", "zh-", "english", "zh/secret", None, True):
            with self.subTest(invalid_locale=locale):
                with self.assertRaisesRegex(ValueError, "^digest_locale_invalid$"):
                    replace(self.configuration, locale=locale)

    def test_locale_change_does_not_create_a_second_daily_delivery(self):
        from dataclasses import replace
        first = replace(self.enable(), locale="EN-us")
        second = replace(self.enable(), locale="zh-CN")
        self.run_request(configuration=first)
        self.run_request(configuration=second)
        self.assertEqual(len(self.sent), 1)
        self.assertNotRegex(self.sent[0], r"[\u4e00-\u9fff]")
        self.assertEqual(list(self.store.records), ["synthetic/2026-10-16.json"])

    def test_candidate_source_map_is_optional_and_validated_at_startup(self):
        env = {'DIGEST_EXPECTED_TARGETS_JSON': json.dumps(EXPECTED),
               'DIGEST_SCHEDULER_JOB_NAME': JOB, 'DIGEST_RECIPIENT_SCOPE': 'synthetic',
               'DIGEST_CUTOVER_REPORT_DATE': '2026-10-16'}
        with patch.dict(os.environ, env):
            self.assertEqual(app.Configuration.from_environment().candidate_uris, {})
            source = {ROW['platform_id']: 'gs://synthetic-isolated/candidates'}
            with patch.dict(os.environ, DIGEST_CANDIDATES_BY_PLATFORM_JSON=json.dumps(source)):
                self.assertEqual(app.Configuration.from_environment().candidate_uris, source)
            for raw in ('', '{private', 'null', '[]', 'true',
                        '{"unknown": "gs://synthetic/candidates"}',
                        json.dumps({ROW['platform_id']: None}),
                        json.dumps({ROW['platform_id']: 'gs://synthetic'}),
                        json.dumps({ROW['platform_id']: 'gs://synthetic/a/../b'})):
                with (self.subTest(raw=raw), patch.dict(os.environ, DIGEST_CANDIDATES_BY_PLATFORM_JSON=raw),
                      self.assertRaisesRegex(ValueError, '^digest_candidate_sources_invalid$')):
                    app.Configuration.from_environment()

    def test_candidate_source_change_preserves_preview_and_delivery_reservation(self):
        from dataclasses import replace
        self.run_request(configuration=self.enable())
        isolated = replace(self.enable(), candidate_uris={ROW['platform_id']: 'gs://synthetic-isolated/candidates'})
        _, preview = self.run_request(preview=True, configuration=isolated)
        self.assertEqual(preview['delivery'], 'preview')
        _, repeated = self.run_request(configuration=isolated)
        self.assertEqual(repeated['delivery'], 'duplicate')
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(list(self.store.records), ['synthetic/2026-10-16.json'])

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
        self.assertIn('😴 无交易（已核验策略范围）', self.sent[0])
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
        self.assertIn('成交回报 未知', self.sent[0])
        self.assertIn('报告缺失', self.sent[0])
        self.assertIn('成交回报 0笔', self.sent[0])
        self.assertEqual(self.sent[0].count('🏦 Schwab · '), 2)
        self.assertNotIn('全部已核验账户无交易', self.sent[0])

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
        self.assertIn('策略未运行，账户交易未知', self.sent[0])
        self.assertIn('未运行', self.sent[0])
        self.assertNotIn('无交易', self.sent[0])
        self.assertNotIn('成交回报 0笔', self.sent[0])
        self.assertNotIn('休市', self.sent[0])

    def test_partial_non_run_reports_do_not_establish_window_outcome(self):
        from dataclasses import replace
        idle = {**ROW, 'actually_ran': False}
        for key in ('notification_event', 'source_run_id'):
            idle.pop(key, None)
        self.store.rows[next(iter(self.store.rows))] = {'runs': [idle]}
        missing = {**EXPECTED[0], 'target_id': 'fixture-missing', 'candidate_slot': 'fixture-missing'}
        _, result = self.run_request(configuration=replace(self.enable(), expected=[*EXPECTED, missing]))
        self.assertEqual(result['coverage'], 'partial')
        text = self.sent[0]
        self.assertIn('未运行', text)
        self.assertIn('报告缺失', text)
        self.assertIn('成交回报 未知', text)
        self.assertNotIn('全部已核验账户无交易', text)
        self.assertNotIn('无交易', text)

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

    def test_scheduler_seconds_and_fraction_preserve_send_slot_and_deduplication(self):
        self.now = NOW + timedelta(seconds=5)
        stamp = NOW + timedelta(seconds=2, microseconds=131439)
        headers = {**HEADERS, 'X-CloudScheduler-ScheduleTime': stamp.isoformat()}
        status, result = self.run_request(headers=headers, configuration=self.enable())
        self.assertEqual((status, result['delivery']), (200, 'accepted'))
        record = self.store.records['synthetic/2026-10-16.json']
        self.assertEqual(record['scheduled_at'], stamp.isoformat())
        _, repeated = self.run_request(headers=headers, configuration=self.enable())
        self.assertEqual(repeated['delivery'], 'duplicate')
        self.assertEqual(len(self.sent), 1)

    def test_exact_short_job_name_shares_full_name_reservation(self):
        headers = {**HEADERS, 'X-CloudScheduler-JobName': JOB.rsplit('/', 1)[-1]}
        status, result = self.run_request(headers=headers, configuration=self.enable())
        self.assertEqual((status, result['delivery']), (200, 'accepted'))
        _, repeated = self.run_request(configuration=self.enable())
        self.assertEqual(repeated['delivery'], 'duplicate')
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(list(self.store.records), ['synthetic/2026-10-16.json'])

    def test_short_job_receipt_slot_remains_read_only(self):
        self.run_request(configuration=self.enable())
        self.now = NOW + timedelta(minutes=30, seconds=5)
        headers = {'X-CloudScheduler-JobName': JOB.rsplit('/', 1)[-1],
                   'X-CloudScheduler-ScheduleTime': self.now.isoformat()}
        self.store.candidate = lambda *args: self.fail('receipt slot read financial inputs')
        self.store.reserve = lambda *args: self.fail('receipt slot reserved a new send')
        status, result = self.run_request(headers=headers, configuration=self.enable())
        self.assertEqual((status, result['delivery']), (200, 'confirmed'))
        self.assertEqual(len(self.sent), 1)

    def test_other_full_names_and_near_short_names_remain_rejected(self):
        for job in ('projects/other/locations/synthetic/jobs/daily-digest',
                    'projects/synthetic/locations/other/jobs/daily-digest',
                    'daily-digest-other', ' daily-digest', 'daily-digest ', 'jobs/daily-digest'):
            with self.subTest(job=job):
                headers = {**HEADERS, 'X-CloudScheduler-JobName': job}
                status, result = self.run_request(headers=headers, configuration=self.enable())
                self.assertEqual((status, result['reason_code']), (400, 'digest_scheduler_job_mismatch'))
        self.assertFalse(self.sent or self.store.records)

    def test_fractional_receipt_slot_remains_read_only(self):
        self.run_request(configuration=self.enable())
        self.now = NOW + timedelta(minutes=30, seconds=5)
        stamp = NOW + timedelta(minutes=30, seconds=2, microseconds=131439)
        headers = {**HEADERS, 'X-CloudScheduler-ScheduleTime': stamp.isoformat()}
        self.store.candidate = lambda *args: self.fail('receipt slot read financial inputs')
        self.store.reserve = lambda *args: self.fail('receipt slot reserved a new send')
        status, result = self.run_request(headers=headers, configuration=self.enable())
        self.assertEqual((status, result['delivery']), (200, 'confirmed'))
        self.assertEqual(len(self.sent), 1)

    def test_fractional_time_does_not_allow_other_minutes_or_future_time(self):
        self.now = NOW + timedelta(minutes=3)
        for stamp in (NOW + timedelta(minutes=1, seconds=2), NOW + timedelta(minutes=4)):
            with self.subTest(stamp=stamp):
                headers = {**HEADERS, 'X-CloudScheduler-ScheduleTime': stamp.isoformat()}
                status, result = self.run_request(headers=headers, configuration=self.enable())
                self.assertEqual((status, result['delivery']), (400, 'invalid_slot'))
        self.assertFalse(self.sent or self.store.records)

    def test_slot_errors_expose_only_fixed_reason_codes(self):
        private = 'private-header-value-not-for-logs'
        for headers, expected in (
            ({'X-CloudScheduler-ScheduleTime': NOW.isoformat()}, 'digest_scheduler_job_missing'),
            ({'X-CloudScheduler-JobName': private}, 'digest_scheduler_job_mismatch'),
            ({'X-CloudScheduler-JobName': JOB}, 'digest_schedule_header_missing'),
            ({**HEADERS, 'X-CloudScheduler-ScheduleTime': private}, 'digest_schedule_header_invalid'),
        ):
            with self.subTest(reason=expected):
                status, result = self.run_request(headers=headers, configuration=self.enable())
                self.assertEqual(status, 400)
                self.assertEqual(result['reason_code'], expected)
                self.assertNotIn(private, json.dumps(result))
        self.assertFalse(self.sent or self.store.records)

    def test_after_cutoff_sends_one_late_notice_without_reading_candidates(self):
        self.now = NOW + timedelta(hours=2)
        self.store.candidate = lambda *args: self.fail('late path read candidates')
        for _ in range(2):
            self.run_request(configuration=self.enable())
        self.assertEqual(len(self.sent), 1)
        self.assertIn('交易、资产和持仓无法确认', self.sent[0])

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
        self.assertNotIn('昨日账户日报', stream.getvalue())

    def test_five_platform_raw_account_ids_are_not_rendered(self):
        from contextlib import redirect_stdout, redirect_stderr
        from dataclasses import replace
        identities = {'ibkr': 'U0000001', 'schwab': '00000002', 'firstrade': '00000003',
                      'longbridge': 'LB000004', 'binance': 'fake-binance-user'}
        expected, sources, mappings = [], {}, {}
        for platform, identity in identities.items():
            item = {**ROW, 'platform_id': platform, 'order_count': 1, 'fill_count': 1}
            item.pop('notification_event')
            expected.append({**{key: item[key] for key in app.IDENTITY}, 'candidate_slot': 'synthetic-slot'})
            sources[f'{platform}/2026-10-15/synthetic-slot.json'] = {'runs': [item]}
            mappings[platform] = {item['opaque_account_uid']: identity}
        self.store = MemoryStore(sources)
        configuration = replace(self.enable(), expected=expected)
        output, errors = io.StringIO(), io.StringIO()
        with (patch.dict(os.environ, QSL_DISPLAY_NAMES_JSON=json.dumps({'accounts': mappings})),
              redirect_stdout(output), redirect_stderr(errors)):
            code, result = self.run_request(configuration=configuration)
        self.assertEqual((code, result['delivery']), (200, 'accepted'))
        public = output.getvalue() + errors.getvalue() + json.dumps(result) + json.dumps(self.store.records)
        for identity in identities.values():
            self.assertNotIn(identity, self.sent[0])
            self.assertNotIn(identity, public)
        self.assertEqual(self.sent[0].count('提交订单 1笔｜成交回报 1笔'), 5)

    def test_approved_private_binding_hint_is_applied_to_its_exact_target(self):
        from dataclasses import replace
        active = {**ROW, 'order_count': 1, 'fill_count': 1}
        active.pop('notification_event')
        self.store = MemoryStore({'schwab/2026-10-15/synthetic-slot.json': {'runs': [active]}})
        configured = replace(self.enable(), expected=[{**EXPECTED[0], 'account_hint': '00000007'}])
        self.run_request(configuration=configured)
        self.assertIn('Schwab · ***07', self.sent[0])
        self.assertNotIn('00000007', self.sent[0])

    def test_binding_hint_cannot_replace_valid_producer_identity(self):
        from dataclasses import replace
        for hint in ('****0007', 'XXXX0007', '00000007'):
            with self.subTest(binding_hint=hint):
                active = {**ROW, 'order_count': 1, 'fill_count': 1, 'account_hint': '00000008'}
                active.pop('notification_event')
                self.store = MemoryStore({'schwab/2026-10-15/synthetic-slot.json': {'runs': [active]}})
                self.sent = []
                configured = replace(self.enable(), expected=[{**EXPECTED[0], 'account_hint': hint}])
                self.run_request(configuration=configured)
                self.assertIn('Schwab · ***08', self.sent[0])
                self.assertNotIn('00000008', self.sent[0])
                self.assertNotIn('·' + hint, self.sent[0])

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
