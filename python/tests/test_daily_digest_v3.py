"""Synthetic v3 renderer regressions; no storage, credentials or transport."""
from copy import deepcopy
from dataclasses import asdict, replace
import json
import os
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from daily_digest_notify import DigestHolding
from test_unified_daily_digest_presentation import payload, row
from unified_daily_digest import render


class DigestV3Tests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true',
            'QSL_DISPLAY_NAMES_JSON': json.dumps({'accounts': {
                'ibkr': {'synthetic-a': '增长***甲'},
                'schwab': {'synthetic-b': '趋势***乙', 'synthetic-idle': '静默***丙'}}}, ensure_ascii=False)}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_active_accounts_are_flat_and_idle_account_is_omitted(self):
        text = render(payload(row(platform_id='ibkr', order_count=1, fill_count=1, section='us_daily'),
            row('synthetic-b', order_count=1, fill_count=0, section='dca'),
            row('synthetic-idle', order_count=0, fill_count=0, cycle_count=24, section='crypto_intraday')))
        self.assertIn('IBKR·增长***甲', text)
        self.assertIn('Schwab·趋势***乙', text)
        self.assertIn('提交1笔/成交1笔', text)
        self.assertIn('提交1笔/成交0笔', text)
        for absent in ('静默***丙', '美股日策略', '定投', '加密小时策略', '提交订单', '单1/成1'):
            self.assertNotIn(absent, text)

    def test_verified_idle_is_exactly_one_line_even_with_cycles_or_observations(self):
        item = row(order_count=0, fill_count=0, cycle_count=24, equity=1234, holdings=(DigestHolding('SYN', quantity=2),))
        self.assertEqual(render(payload(item)), '今日全部账号无交易')
        self.assertEqual(render(payload()), '今日全部账号无交易')
        self.assertEqual(render(payload(replace(item, status='alert', rebalance_conclusion='blocked'))),
                         '今日全部账号无交易')

    def test_only_provided_observation_fields_are_rendered_without_mutation(self):
        item = row(order_count=1, fill_count=1, equity=569.2,
            holdings=(DigestHolding('TQQQ', market_value=312.4, quantity=4),))
        before = deepcopy(asdict(item))
        text = render(payload(item))
        self.assertIn('策略：半导体趋势收益', text)
        self.assertIn('总资产 USD 569.20', text)
        self.assertIn('TQQQ', text)
        self.assertIn('4股', text)
        self.assertIn('$312.40', text)
        bare = render(payload(replace(item, equity=None, holdings=())))
        for absent in ('总资产', '持仓', '现金', '较昨'):
            self.assertNotIn(absent, bare)
        self.assertEqual(asdict(item), before)

    def test_multiple_runs_of_one_account_have_one_header_and_summed_counts(self):
        item = row('synthetic-b', order_count=1, fill_count=2)
        text = render(payload(item, replace(item, order_count=2, fill_count=1, source_run_id='synthetic-run-b')))
        self.assertEqual(text.count('Schwab·趋势***乙'), 1)
        self.assertIn('提交3笔/成交3笔', text)

    def test_unknown_evidence_cannot_be_reported_as_idle(self):
        text = render(payload(row(order_count=1, fill_count=None, fill_count_status='unknown')))
        self.assertIn('提交1笔/成交未知笔', text)
        self.assertNotIn('今日全部账号无交易', text)
        from daily_digest_notify import EvidenceCoverage
        text = render(replace(payload(), evidence_coverage=EvidenceCoverage(candidate_failures=({'reason': 'read_failed'},))))
        self.assertNotIn('今日全部账号无交易', text)
        self.assertIn('未知', text)

    def test_holdings_are_sorted_capped_and_counted(self):
        holdings = tuple(DigestHolding(f'SYN{i}', market_value=i, quantity=i) for i in range(7))
        text = render(payload(row(order_count=1, holdings=holdings)))
        self.assertIn('共7项', text)
        self.assertIn('SYN6', text)
        self.assertNotIn('SYN0', text)
        self.assertLess(text.index('SYN6'), text.index('SYN5'))

    def test_accounts_are_never_raw_numbers_in_any_display_field(self):
        for alias in ('Account 123456789', '1234-5678', 'Account 1234 5678', '1234.5678'):
            env = {'QSL_DISPLAY_NAMES_JSON': json.dumps({'accounts': {'schwab': {'synthetic-a': alias}}})}
            with self.subTest(alias=alias), patch.dict(os.environ, env):
                text = render(payload(row(order_count=1)))
            self.assertNotIn(alias, text)
            self.assertIn('Schwab·账户', text)

    def test_optional_holdings_cannot_displace_active_accounts_under_budget(self):
        holdings = tuple(DigestHolding(f'SYN{i}', market_value=100 + i, quantity=2) for i in range(5))
        rows = [row(f'synthetic-{index}', order_count=1, fill_count=1, equity=1000, holdings=holdings)
                for index in range(6)]
        text = render(payload(*rows), max_units=600)
        self.assertEqual(text.count('Schwab·'), 6)
        self.assertEqual(text.count('提交1笔/成交1笔'), 6)
        self.assertIn('省略', text)
        self.assertLessEqual(len(text.encode('utf-16-le')) // 2, 600)

    def test_distinct_producer_snapshots_are_shown_without_claiming_latest(self):
        item = row(order_count=1, equity=100, holdings=(DigestHolding('SYN', quantity=1),))
        other = replace(item, source_run_id='synthetic-b', equity=200, holdings=(DigestHolding('SYN', quantity=2),))
        text = render(payload(item, other))
        self.assertIn('运行快照 1', text)
        self.assertIn('运行快照 2', text)
        self.assertIn('总资产 USD 100.00', text)
        self.assertIn('总资产 USD 200.00', text)
        self.assertNotIn('300.00', text)
        self.assertNotIn('策略：', render(payload(row(strategy_profile='synthetic-unknown-profile'))))

    def test_display_collisions_cannot_merge_different_platform_identities(self):
        mapping = {'platforms': {'ibkr': 'Demo', 'schwab': 'Demo'},
                   'accounts': {'ibkr': {'synthetic-a': 'Masked'}, 'schwab': {'synthetic-a': 'Masked'}}}
        with patch.dict(os.environ, QSL_DISPLAY_NAMES_JSON=json.dumps(mapping)):
            text = render(payload(row(platform_id='ibkr'), row(platform_id='schwab')))
        self.assertEqual(text.count('Demo·Masked'), 2)
        self.assertEqual(text.count('提交1笔/成交1笔'), 2)
