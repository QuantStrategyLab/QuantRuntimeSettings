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
                'ibkr': {'synthetic-a': 'U0000001'},
                'schwab': {'synthetic-b': '00000002', 'synthetic-idle': '00000003'}}}, ensure_ascii=False)}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_active_accounts_are_flat_and_idle_account_is_omitted(self):
        text = render(payload(row(platform_id='ibkr', order_count=1, fill_count=1, section='us_daily'),
            row('synthetic-b', order_count=1, fill_count=0, section='dca'),
            row('synthetic-idle', order_count=0, fill_count=0, cycle_count=24, section='crypto_intraday')))
        self.assertIn('IBKR·U0000001', text)
        self.assertIn('Schwab·00000002', text)
        self.assertIn('提交1笔/成交1笔', text)
        self.assertIn('提交1笔/成交0笔', text)
        for absent in ('00000003', '美股日策略', '定投', '加密小时策略', '提交订单', '单1/成1'):
            self.assertNotIn(absent, text)

    def test_verified_idle_keeps_scoped_summary_with_cycles_or_observations(self):
        item = row(order_count=0, fill_count=0, cycle_count=24, equity=1234, holdings=(DigestHolding('SYN', quantity=2),))
        self.assertIn('😴 已核验目标无交易', render(payload(item)))
        empty = render(payload())
        self.assertNotIn('已核验目标无交易', empty)
        self.assertIn('全窗口统计未知', empty)
        blocked = render(payload(replace(item, status='alert', rebalance_conclusion='blocked')))
        self.assertNotIn('已核验目标无交易', blocked)
        self.assertIn('已拦截', blocked)

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
        self.assertEqual(text.count('Schwab·00000002'), 1)
        self.assertIn('提交3笔/成交3笔', text)

    def test_unknown_evidence_cannot_be_reported_as_idle(self):
        text = render(payload(row(order_count=1, fill_count=None, fill_count_status='unknown')))
        self.assertIn('提交1笔/成交未知笔', text)
        self.assertNotIn('已核验目标无交易', text)
        from daily_digest_notify import EvidenceCoverage
        text = render(replace(payload(), evidence_coverage=EvidenceCoverage(candidate_failures=({'reason': 'read_failed'},))))
        self.assertNotIn('已核验目标无交易', text)
        self.assertIn('未知', text)

    def test_holdings_are_sorted_capped_and_counted(self):
        holdings = tuple(DigestHolding(f'SYN{i}', market_value=i, quantity=i) for i in range(7))
        text = render(payload(row(order_count=1, holdings=holdings)))
        self.assertIn('共7项', text)
        self.assertIn('SYN6', text)
        self.assertNotIn('SYN0', text)
        self.assertLess(text.index('SYN6'), text.index('SYN5'))

    def test_runtime_full_account_ids_are_allowed_only_in_account_labels(self):
        for identity in ('00000001', '0000-0001', 'Account 0000 0001'):
            env = {'QSL_DISPLAY_NAMES_JSON': json.dumps({'accounts': {'schwab': {'synthetic-a': identity}}})}
            with self.subTest(identity=identity), patch.dict(os.environ, env):
                text = render(payload(row(order_count=1)))
            self.assertIn('Schwab·' + identity, text)

    def test_all_platforms_resolve_private_mapping_by_opaque_uid(self):
        identities = {'ibkr': 'U0000001', 'schwab': '00000002', 'firstrade': '00000003',
                      'longbridge': 'LB000004', 'binance': 'fake-binance-user'}
        names = {'accounts': {platform: {'opaque-synthetic-a': identity}
                             for platform, identity in identities.items()}}
        with patch.dict(os.environ, QSL_DISPLAY_NAMES_JSON=json.dumps(names)):
            text = render(payload(*(row(platform_id=platform) for platform in identities)))
        for platform, identity in identities.items():
            self.assertIn('·' + identity, text)
        self.assertEqual(text.count('🏦 '), 5)
        self.assertNotIn('opaque-synthetic-a', text)

    def test_unmapped_runtime_hints_are_masked_when_private_mapping_is_unusable(self):
        for platform, identity in (('ibkr', 'U0000099'), ('schwab', '00000099'),
                                   ('firstrade', '00000099')):
            for mapping in (None, '{}', '{invalid', json.dumps({'accounts': {
                    platform: {'synthetic-other': identity}}})):
                for locale in ('zh', 'en'):
                    with self.subTest(platform=platform, mapping=mapping, locale=locale), patch.dict(os.environ):
                        os.environ.pop('QSL_DISPLAY_NAMES_JSON', None)
                        if mapping is not None:
                            os.environ['QSL_DISPLAY_NAMES_JSON'] = mapping
                        text = render(payload(row(identity, platform_id=platform), locale=locale))
                        self.assertIn('·***99', text)
                        self.assertNotIn(identity, text)

    def test_scope_and_binding_ids_are_lookup_keys_only(self):
        item = row('U0000099', platform_id='ibkr')
        for field in ('account_scope', 'opaque_account_uid', 'target_id', 'account_alias'):
            with self.subTest(field=field):
                text = render(payload(replace(item, account_hint='', **{field: 'U0000099'})))
                self.assertNotIn('U0000099', text)

    def test_placeholder_names_and_public_lane_aliases_keep_runtime_hint_masked(self):
        for alias in ('增长***甲', 'UXXXX0099', 'U···0099', 'Growth account', '实盘', 'live', 'https://synthetic.invalid', 'fake\naccount'):
            names = {'accounts': {'ibkr': {'opaque-U0000099': alias}}}
            with self.subTest(alias=alias), patch.dict(os.environ, QSL_DISPLAY_NAMES_JSON=json.dumps(names)):
                text = render(payload(row('U0000099', platform_id='ibkr')))
                self.assertIn('IBKR·***99', text)
                self.assertNotIn('U0000099', text)
                self.assertNotIn('·' + alias, text)
        with patch.dict(os.environ, QSL_DISPLAY_NAMES_JSON='{}'):
            text = render(payload(row('crypto_combo', platform_id='binance', execution_mode='live')))
            self.assertIn('Binance·账户', text)
            self.assertNotIn('实盘', text)

    def test_accounts_without_known_activity_are_omitted_without_claiming_idle(self):
        unknown_runs = (
            row('synthetic-idle', order_count=0, fill_count=None, fill_count_status='unknown'),
            row('synthetic-idle', order_count=None, order_count_status='unknown', fill_count=0),
            row('synthetic-idle', order_count=None, order_count_status='unknown',
                fill_count=None, fill_count_status='unknown'),
            row('synthetic-idle', order_count=2, order_count_status='unknown',
                fill_count=3, fill_count_status='unknown'),
        )
        for item in unknown_runs:
            for locale in ('zh', 'en'):
                for active in ((), (row(),)):
                    with self.subTest(orders=item.order_count, fills=item.fill_count,
                                      locale=locale, active=bool(active)):
                        text = render(payload(*active, item, locale=locale))
                        self.assertNotIn('00000003', text)
                        self.assertEqual(text.count('🏦 '), len(active))
                        self.assertIn('全窗口统计未知' if locale == 'zh' else 'whole-window count unknown', text)
                        self.assertNotIn('已核验目标无交易', text)
                        self.assertNotIn('No trades in verified targets', text)

    def test_active_account_retains_unknown_counts_from_another_run(self):
        active = row(order_count=1, fill_count=0)
        unknown = replace(active, source_run_id='synthetic-unknown-run', order_count=0,
                          fill_count=None, fill_count_status='unknown')
        text = render(payload(active, unknown))
        self.assertEqual(text.count('🏦 '), 1)
        self.assertIn('提交1笔/成交未知笔', text)

    def test_nontrading_observations_cannot_displace_active_account(self):
        decisions = tuple(dict(reason_code='min_notional', observed_value=i, limit=1000,
                               currency='USD', symbol=f'SYN{i}') for i in range(100))
        unknown = row('synthetic-idle', order_count=0, fill_count=None,
                      fill_count_status='unknown', routine_decisions=decisions)
        text = render(payload(unknown, row()), max_units=600)
        self.assertEqual(text.count('🏦 '), 1)
        self.assertIn('提交1笔/成交1笔', text)
        self.assertNotIn('00000003', text)
        self.assertIn('省略', text)
        self.assertLessEqual(len(text.encode('utf-16-le')) // 2, 600)

    def test_private_uid_mapping_precedes_legacy_alias_and_is_platform_scoped(self):
        names = {'accounts': {'ibkr': {'opaque-synthetic-a': 'U0000001', 'synthetic-a': 'U0000002'},
                              'schwab': {'opaque-synthetic-a': '00000003'}}}
        with patch.dict(os.environ, QSL_DISPLAY_NAMES_JSON=json.dumps(names)):
            text = render(payload(row(platform_id='ibkr'), row(platform_id='schwab')))
        self.assertIn('IBKR·U0000001', text)
        self.assertIn('Schwab·00000003', text)
        self.assertNotIn('U0000002', text)

    def test_emoji_preserve_exact_trade_count_wording(self):
        text = render(payload(row(equity=100, holdings=(DigestHolding('SYN', quantity=1),))))
        for marker in ('📊 每日交易摘要', '🕒 统计区间', '🏦 Schwab·', '🎯 策略：',
                       '📝 提交1笔/成交1笔', '💰 总资产', '💼 持仓'):
            self.assertIn(marker, text)
        self.assertNotIn('💼 💼', text)

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
        mapping = {'platforms': {'longbridge': 'Demo', 'binance': 'Demo'},
                   'accounts': {'longbridge': {'synthetic-a': 'fake-user'}, 'binance': {'synthetic-a': 'fake-user'}}}
        with patch.dict(os.environ, QSL_DISPLAY_NAMES_JSON=json.dumps(mapping)):
            text = render(payload(row(platform_id='longbridge'), row(platform_id='binance')))
        self.assertEqual(text.count('Demo·fake-user'), 2)
        self.assertEqual(text.count('提交1笔/成交1笔'), 2)
