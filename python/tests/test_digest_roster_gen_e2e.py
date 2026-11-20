"""End-to-end GEN acceptance tests for D2 B3 rows 01-21."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python' / 'scripts'))
sys.path.insert(0, str(ROOT / 'python' / 'tests'))

import cloud_run_daily_digest as app  # noqa: E402
import daily_digest_aggregator as aggregator  # noqa: E402
import digest_roster_authority as authority  # noqa: E402
import digest_roster_envelope as envelope  # noqa: E402
import digest_roster_generation as generation  # noqa: E402
import digest_roster_status_text as status_text  # noqa: E402
import digest_roster_support as support  # noqa: E402
import unified_daily_digest as unified  # noqa: E402
from account_daily_digest import render_account_daily  # noqa: E402
from daily_digest_notify import DailyDigestInput, DigestRunEntry  # noqa: E402
from test_cloud_run_daily_digest import MemoryStore  # noqa: E402
from test_daily_digest_ux import config as ux_config  # noqa: E402
from test_notification_consolidation import candidate as make_candidate  # noqa: E402

JOB = 'projects/synthetic/locations/synthetic/jobs/daily-digest'
DAY = '2026-11-19'
REPORT_DATE = datetime(2026, 11, 20, 7, 0, tzinfo=app.SGT)
OBS_CLOCK = support.OBSERVED + timedelta(seconds=20)


def _boot_env(extra=None):
    boot_json = json.dumps({
        'mode': authority.MAPPING_MODE,
        'origin': support.ORIGIN,
        'service_auth': {
            'issuer': support.POLICY.issuer,
            'audience': support.POLICY.audience,
            'subjects': sorted(support.POLICY.subjects),
        },
        'enrollment_source': support.SOURCE,
        'config_context': 'synthetic_context',
        'read_timeout': 10.0,
    })
    env = {
        'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true',
        'DIGEST_DELIVERY_ENABLED': 'true',
        'DIGEST_SCHEDULER_JOB_NAME': JOB,
        'DIGEST_RECIPIENT_SCOPE': 'syn-scope',
        'DIGEST_CUTOVER_REPORT_DATE': '2026-11-20',
        'DIGEST_ROSTER_BOOT_JSON': boot_json,
    }
    if extra:
        env.update(extra)
    return env


def _platform_config():
    return {
        **ux_config([]),
        'platforms': {
            'ibkr': {'display_rank': 0},
            'firstrade': {'display_rank': 1},
            'schwab': {'display_rank': 2},
            'binance': {'display_rank': 3},
            'longbridge': {'display_rank': 4},
        },
    }


def _make_runner(readbacks, *, artifact_bytes=None, clock_fn=None, snapshots=None,
                 recipient_scope='syn-scope', auth=None, transport=None, source=None):
    raw_bytes = artifact_bytes if artifact_bytes is not None else support.prepare()[0]
    src = source or support.SyntheticEnrollmentSource(raw_bytes)
    tr = transport or support.SyntheticTransport(*(support.ok(doc) for doc in readbacks))
    client = authority.AcquisitionClient(support.BOOT, auth or support.SyntheticAuth(), tr)
    return generation.GenerationRunner(
        support.BOOT, client, src, clock_fn or (lambda: OBS_CLOCK),
        snapshots=snapshots, recipient_scope=recipient_scope,
    )


def _obs(binding, *, facts, business_day=DAY, observed_at=None):
    return {
        'type': 'account_observation',
        **binding,
        'business_day': business_day,
        'observed_at': observed_at or support.stamp(OBS_CLOCK),
        'facts': facts,
    }


def _slot_args(cfg, store, sent, *, preview=False, now_fn=None, provenance='cloud_scheduler',
               runner=None, outcome=None, raw_observations=()):
    schedule = {'scheduled_at': REPORT_DATE.isoformat(), 'trigger_provenance': provenance}
    return app.execute_slot(
        REPORT_DATE.date(), DAY, False, schedule, cfg, store,
        lambda body: (sent.append(body), 101)[1],
        preview=preview,
        now=now_fn or (lambda: REPORT_DATE),
        platform_config=_platform_config(),
        roster_runner=runner,
        roster_outcome=outcome,
        raw_observations=raw_observations,
    )


def _run_row(binding, *, run_id='run-1', actually_ran=True, execution_mode='live',
             orders=0, fills=0, extra=None):
    row = {
        **make_candidate(
            platform_id=binding['platform_id'],
            opaque_account_uid=binding['opaque_account_uid'],
            target_id=binding['target_id'],
            strategy_profile=binding['strategy_profile'],
            source_run_id=run_id,
            business_day=DAY,
            actually_ran=actually_ran,
            order_count=orders,
            fill_count=fills,
            execution_mode=execution_mode,
        ),
    }
    row.pop('notification_event', None)
    if extra:
        row.update(extra)
    return row


class GenE2ETests(unittest.TestCase):
    def test_rows_01_03_04_05_cohorts_and_empty_runs_through_execute_slot(self):
        with support.OutboundTrap():
            with patch.dict(os.environ, _boot_env({'QSL_NOTIFY_LANG': 'en'}), clear=True):
                cfg = app.Configuration.from_environment()
            self.assertTrue(cfg.is_mapping_mode)
            self.assertEqual(cfg.expected, [])

            # Row 01: complete artifact, empty run lists + raw observation links -> 10 headers, 0 runs.
            empty_artifact, _ = support.prepare(links=[], roster=[])
            obs_bindings = support.observation_bindings(support.scenario('all_on'))
            raw_obs = [_obs(obs_bindings[0], facts={'snapshots': [{'as_of': support.stamp(OBS_CLOCK), 'equity': 1000, 'equity_currency': 'USD', 'holdings': []}]})]
            runner = _make_runner([support.scenario('all_on'), support.scenario('all_on')], artifact_bytes=empty_artifact)
            sent = []
            code, res = _slot_args(cfg, MemoryStore({}), sent, runner=runner, raw_observations=raw_obs)
            self.assertEqual((code, res['delivery']), (200, 'accepted'))
            self.assertEqual(sent[0].count('🏦 '), 10)
            self.assertIn('Display 10 | Eligible 9/10 | Live managed 8', sent[0])
            self.assertIn('Paper scope: display 1 | confirmed managed 1', sent[0])
            self.assertIn('Live runs: 0 | targets none', sent[0])

            # Row 03: one_off -> 8 live/paper managed (7 live + 1 paper = 8 total), 1 disabled with visible raw facts.
            one_off = support.scenario('one_off')
            disabled_plat, disabled_key = support.roles_pair = support.CORPUS['roles']['live_off'][0].split('/', 1)
            disabled_obs_b = next(b for b in support.observation_bindings(one_off)
                                  if b['platform'] == disabled_plat and b['legacy_key'] == disabled_key)
            disabled_raw = _obs(disabled_obs_b, facts={'snapshots': [{
                'as_of': support.stamp(OBS_CLOCK), 'equity': 2500.5, 'equity_currency': 'USD',
                'holdings': [{'symbol': 'SPY', 'quantity': 5, 'asset_type': 'stock'}],
            }]})
            runner_03 = _make_runner([one_off, one_off], artifact_bytes=empty_artifact)
            sent_03 = []
            _slot_args(cfg, MemoryStore({}), sent_03, runner=runner_03, raw_observations=[disabled_raw])
            self.assertIn('Live managed 7 (disabled 1, outside 1, unknown 0)', sent_03[0])
            self.assertIn('Quant management disabled', sent_03[0])
            self.assertIn('SPY 5 shares', sent_03[0])
            self.assertIn('Live coverage: managed 0/7 | raw 1/9', sent_03[0])

            # Row 04: all_off -> no managed non-paper accounts, N/A (never 0/0).
            runner_04 = _make_runner([support.scenario('all_off'), support.scenario('all_off')], artifact_bytes=empty_artifact)
            sent_04 = []
            _slot_args(cfg, MemoryStore({}), sent_04, runner=runner_04)
            self.assertIn('no managed non-paper accounts', sent_04[0])
            self.assertIn('Live coverage: managed N/A', sent_04[0])
            self.assertNotIn('0/0', sent_04[0])

            # Row 05: missing_one -> 8 confirmed (7 live + 1 paper), 1 unknown, live totals unavailable.
            runner_05 = _make_runner([support.scenario('missing_one'), support.scenario('missing_one')], artifact_bytes=empty_artifact)
            sent_05 = []
            _slot_args(cfg, MemoryStore({}), sent_05, runner=runner_05)
            self.assertIn('live totals unavailable (management_status_unknown)', sent_05[0])
            self.assertIn('Quant management status unknown (Evidence unknown)', sent_05[0])

    def test_rows_02_07_08_09_10_11_fallback_races_windows_and_unavailable(self):
        with support.OutboundTrap():
            with patch.dict(os.environ, _boot_env({'QSL_NOTIFY_LANG': 'en'}), clear=True):
                cfg = app.Configuration.from_environment()
            snapshots = generation.DisplaySnapshotStore()
            # Seed validated 10-group baseline.
            r_ok = _make_runner([support.scenario('all_on'), support.scenario('all_on')], snapshots=snapshots)
            sent_ok = []
            _slot_args(cfg, MemoryStore({}), sent_ok, runner=r_ok)
            self.assertIn('Under quant management', sent_ok[0])

            # Row 02 / 10: denied / tampered readback keeps 10 dated baseline headers with unknown management.
            bad_doc = support.scenario('all_on')
            bad_doc['format'] = 'qsl_account_management_readback.v2'
            r_bad = _make_runner([bad_doc, bad_doc], snapshots=snapshots,
                                 clock_fn=lambda: support.OBSERVED + timedelta(seconds=90))
            sent_bad = []
            _slot_args(cfg, MemoryStore({}), sent_bad, runner=r_bad)
            self.assertIn('Management roster fallback (unavailable | observed 2026-11-19T23:00:00.000Z | age 90s)', sent_bad[0])
            self.assertEqual(sent_bad[0].count('🏦 '), 10)
            self.assertEqual(sent_bad[0].count('Quant management status unknown (Evidence unknown)'), 10)
            self.assertNotIn('Under quant management', sent_bad[0])

            # Row 08: out-of-window (300.001s) enters stale fallback with 10 dated headers.
            stale_clock = support.OBSERVED + timedelta(seconds=300, milliseconds=1)
            r_stale = _make_runner([support.scenario('all_on'), support.scenario('all_on')],
                                   snapshots=snapshots, clock_fn=lambda: stale_clock)
            sent_stale = []
            _slot_args(cfg, MemoryStore({}), sent_stale, runner=r_stale)
            self.assertIn('Management roster fallback (stale | observed 2026-11-19T23:00:00.000Z | age 300s)', sent_stale[0])
            self.assertEqual(sent_stale[0].count('🏦 '), 10)

            # Row 09: draft_off_only keeps 9 managed and emits no draft label; race then stable reacquisition succeeds.
            r_draft = _make_runner([support.scenario('draft_off_only'), support.scenario('draft_off_only')], snapshots=snapshots)
            sent_draft = []
            _slot_args(cfg, MemoryStore({}), sent_draft, runner=r_draft)
            self.assertIn('Live managed 8', sent_draft[0])
            self.assertNotIn('draft', sent_draft[0].lower())

            r_race = _make_runner([
                support.scenario('all_on'), support.scenario('one_off'),
                support.scenario('one_off'), support.scenario('one_off'),
            ], snapshots=snapshots)
            sent_race = []
            _slot_args(cfg, MemoryStore({}), sent_race, runner=r_race)
            self.assertIn('Live managed 7 (disabled 1', sent_race[0])

            # Row 11: fresh process / different recipient_scope -> unavailable copy even with nonempty legacy env.
            for locale, expected_copy in (('en', 'Account roster unavailable; management status unknown'),
                                          ('zh', '账户名录不可用；量化管理状态未知')):
                with patch.dict(os.environ, _boot_env({
                    'QSL_NOTIFY_LANG': locale,
                    'DIGEST_EXPECTED_TARGETS_JSON': json.dumps([{'platform_id': 'schwab', 'candidate_slot': 's',
                                                                 'opaque_account_uid': 'u', 'target_id': 't',
                                                                 'strategy_profile': 'p'}]),
                }), clear=True):
                    cfg_loc = app.Configuration.from_environment()
                r_unavail = _make_runner([], snapshots=snapshots, recipient_scope='other-scope',
                                         transport=support.SyntheticTransport((403, support.OK_HEADERS, b'{}')))
                sent_unavail = []
                _slot_args(cfg_loc, MemoryStore({}), sent_unavail, runner=r_unavail)
                self.assertIn(expected_copy, sent_unavail[0])
                self.assertEqual(sent_unavail[0].count('🏦 '), 0)
                self.assertLessEqual(len(sent_unavail[0].encode('utf-16-le')) // 2, 3850)

    def test_rows_12_13_14_16_paper_simulation_exclusion_and_recipient_isolation(self):
        with support.OutboundTrap():
            # Row 12 + Row 13: paper group with valid typed observation + simulated strategy rows + live control.
            all_on = support.scenario('all_on')
            obs_bindings = support.observation_bindings(all_on)
            paper_plat, paper_key = support.CORPUS['roles']['paper'][0].split('/', 1)
            paper_obs_b = next(b for b in obs_bindings if b['platform'] == paper_plat and b['legacy_key'] == paper_key)
            paper_obs = _obs(paper_obs_b, facts={'snapshots': [{
                'as_of': support.stamp(OBS_CLOCK), 'equity': 5000, 'equity_currency': 'USD',
                'holdings': [{'symbol': 'AAPL', 'quantity': 2, 'asset_type': 'stock'}],
            }]})

            # Legacy bindings from fixture: ibkr pair (syn-slot-01, syn-slot-01-b), schwab (syn-slot-05), firstrade (syn-slot-10).
            links = support.FIXTURE['enrollment_links']
            live_binding = {**{k: links[2][k] for k in authority.BINDING_FIELDS}, 'strategy_profile': 'syn_profile_2'}
            sim_rows = [
                _run_row(live_binding, run_id=f'sim-{mode}', execution_mode=mode, orders=1, fills=1,
                         extra={'account_daily_facts': {'fills': [{'id': f'f-{mode}', 'order_id': 'o1', 'symbol': 'NVDA',
                                                                   'side': 'buy', 'quantity': 1, 'asset_type': 'stock',
                                                                   'price': 999, 'currency': 'USD',
                                                                   'occurred_at': support.stamp(OBS_CLOCK)}]}})
                for mode in ('dry_run', 'paper', 'shadow', 'plan_only')
            ]
            live_control = _run_row(live_binding, run_id='live-ctrl-1', execution_mode='live', orders=1, fills=1,
                                    extra={'account_daily_facts': {'fills': [{'id': 'f-live', 'order_id': 'o-live',
                                                                              'symbol': 'MSFT', 'side': 'buy',
                                                                              'quantity': 4, 'asset_type': 'stock',
                                                                              'price': 400, 'currency': 'USD',
                                                                              'occurred_at': support.stamp(OBS_CLOCK)}]}})
            store = MemoryStore({
                f"schwab/{DAY}/{live_binding['candidate_slot']}.json": {'runs': [*sim_rows, live_control]},
            })
            # Row 16: IBKR telegram account ID ONLY for authorized non-preview azure_logic_sliding_window.
            ibkr_link = links[0]
            ibkr_json = json.dumps({
                'recipient_id': 'authorized-chat',
                'accounts': [{
                    'candidate_slot': ibkr_link['candidate_slot'],
                    'opaque_account_uid': ibkr_link['opaque_account_uid'],
                    'target_id': ibkr_link['target_id'],
                    'account_id': 'U7770001',
                }],
            })
            with patch.dict(os.environ, _boot_env({
                'QSL_NOTIFY_LANG': 'en',
                'DIGEST_TELEGRAM_IBKR_ACCOUNT_IDS_JSON': ibkr_json,
                'QSL_GLOBAL_TELEGRAM_CHAT_ID': 'authorized-chat',
            }), clear=True):
                cfg = app.Configuration.from_environment()
            self.assertNotIn('U7770001', repr(cfg))

            # Preview & other-sender provenance must NEVER render U7770001.
            with patch.dict(os.environ, {'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true'}, clear=True):
                for provenance, preview, expect_id in (
                    ('cloud_scheduler', False, False),
                    ('azure_functions_timer', False, False),
                    ('azure_logic_sliding_window', True, False),
                    ('azure_logic_sliding_window', False, True),
                ):
                    runner = _make_runner([all_on, all_on])
                    sent = []
                    store_local = MemoryStore(dict(store.rows))
                    code, res = _slot_args(cfg, store_local, sent, preview=preview, provenance=provenance,
                                           runner=runner, raw_observations=[paper_obs])
                    self.assertEqual(code, 200)
                    self.assertNotIn('U7770001', json.dumps(res))
                    self.assertNotIn('U7770001', json.dumps(store_local.records))
                    if not preview:
                        msg = sent[0]
                        self.assertEqual('U7770001' in msg, expect_id)
                        # Row 13: simulated NVDA fill excluded; live MSFT fill & paper AAPL visible; 4 simulated excluded.
                        self.assertNotIn('NVDA', msg)
                        self.assertIn('Simulated runs excluded', msg)
                        self.assertIn('Live runs: 1', msg)
                        self.assertIn('AAPL 2 shares', msg)
                        # Row 14: two-deployment IBKR group renders as ONE header (10 total headers).
                        self.assertEqual(msg.count('🏦 '), 10)
                    else:
                        self.assertEqual(sent, [])

            # Row 13 renderer-side direct exclusion check on render_account_daily:
            sim_entry = DigestRunEntry(
                platform_id='schwab', opaque_account_uid=live_binding['opaque_account_uid'],
                target_id=live_binding['target_id'], strategy_profile=live_binding['strategy_profile'],
                execution_mode='dry_run', fill_count=3, fill_count_status='known',
                order_count=3, order_count_status='known',
            )
            runner_r = _make_runner([all_on, all_on])
            outcome_r = runner_r.run(deadline=OBS_CLOCK + timedelta(seconds=10))
            env_doc = envelope.build_roster_envelope(outcome_r)
            rendered = render_account_daily(
                DailyDigestInput(DAY, locale='en', runs=(sim_entry,)), [], ['present'],
                roster_envelope=env_doc,
            )
            self.assertIn('Simulated runs excluded', rendered)
            self.assertNotIn('Orders: 3', rendered)

    def test_row_17_explicit_v1_context_precedence_all_four_variants_plus_legacy_control(self):
        with support.OutboundTrap():
            all_on = support.scenario('all_on')
            runner = _make_runner([all_on, all_on])
            outcome_current = runner.run(deadline=OBS_CLOCK + timedelta(seconds=10))
            empty_artifact, _ = support.prepare(links=[], roster=[])
            outcome_empty = _make_runner([all_on, all_on], artifact_bytes=empty_artifact).run(
                deadline=OBS_CLOCK + timedelta(seconds=10)
            )
            outcome_unavail = _make_runner([], transport=support.SyntheticTransport((403, support.OK_HEADERS, b'{}'))).run(
                deadline=OBS_CLOCK + timedelta(seconds=10)
            )
            disagreeing_expected = [{'platform_id': 'binance', 'candidate_slot': 'wrong-slot',
                                     'opaque_account_uid': 'wrong-uid', 'target_id': 'wrong-target',
                                     'strategy_profile': 'wrong_strategy'}]
            disagreeing_config = ux_config(disagreeing_expected)

            with patch.dict(os.environ, _boot_env({'QSL_NOTIFY_LANG': 'en'}), clear=True):
                cfg = app.Configuration.from_environment()

            for variant_name, out, env_val, expected_runs_count in (
                ('current_disagreeing_env', outcome_current, json.dumps(disagreeing_expected), 4),
                ('current_malformed_env', outcome_current, '{not-json', 4),
                ('typed_empty_disagreeing_env', outcome_empty, json.dumps(disagreeing_expected), 0),
                ('unavailable_malformed_env', outcome_unavail, '{not-json', 0),
            ):
                with self.subTest(variant=variant_name), patch.dict(os.environ, {
                    'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true',
                    'DIGEST_EXPECTED_TARGETS_JSON': env_val,
                }, clear=True):
                    collected = aggregator.collect_digest_runs(
                        business_day=DAY, config=disagreeing_config, include_github=False, roster_context=out,
                    )
                    self.assertEqual(len(collected.coverage.missing_targets), expected_runs_count)
                    self.assertFalse(any(m.get('platform_id') == 'binance' for m in collected.coverage.missing_targets))
                    _, _, built_col = aggregator.build_digest_payload(
                        business_day=DAY, config=disagreeing_config, include_github=False,
                        render_text=False, roster_context=out,
                    )
                    self.assertEqual(len(built_col.coverage.missing_targets), expected_runs_count)
                    text, _ = app._report(cfg, [], [], DAY, disagreeing_config, roster_outcome=out)
                    self.assertNotIn('wrong-target', text)
                    if out is outcome_unavail:
                        self.assertIn('Account roster unavailable', text)
                    else:
                        self.assertEqual(text.count('🏦 '), 10)

            # Separate legacy-only control retains environment precedence.
            with patch.dict(os.environ, {
                'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true',
                'DIGEST_EXPECTED_TARGETS_JSON': json.dumps(disagreeing_expected),
            }, clear=True):
                legacy_col = aggregator.collect_digest_runs(
                    business_day=DAY, config=ux_config([]), include_github=False,
                )
                self.assertEqual(len(legacy_col.coverage.missing_targets), 1)
                self.assertEqual(legacy_col.coverage.missing_targets[0]['platform_id'], 'binance')

    def test_row_18_coverage_and_run_counts_end_to_end_through_execute_slot(self):
        with support.OutboundTrap():
            with patch.dict(os.environ, _boot_env({'QSL_NOTIFY_LANG': 'en'}), clear=True):
                cfg = app.Configuration.from_environment()
            four_on = support.scenario('four_on')
            roles = support.CORPUS['roles']
            obs_bindings = support.observation_bindings(four_on)

            def obs_for(plat, key, idx=0):
                b = next(item for item in obs_bindings if item['platform'] == plat and item['legacy_key'] == key)
                return _obs(b, facts={'holdings': [{'symbol': f'SYM{idx}', 'quantity': 1, 'asset_type': 'stock'}]})

            # Choose 2 live-on (incl. the two-deployment pair), paper, 1 disabled live, 1 display-only live.
            live_on_0 = roles['live_on'][0][0].split('/', 1)
            live_on_1 = roles['live_on'][1][0].split('/', 1)
            paper_0 = roles['paper'][0].split('/', 1)
            disabled_0 = roles['live_off'][0].split('/', 1)
            display_0 = roles['display_only'][0].split('/', 1)
            disabled_obs = obs_for(*disabled_0, idx=4)
            base_obs = [obs_for(*live_on_0, idx=1), obs_for(*live_on_1, idx=2),
                        obs_for(*paper_0, idx=3), obs_for(*display_0, idx=5)]

            # Two distinct actual runs on the 2 targets of live_on_0 (ibkr pair), repeated receipt, 1 non-run on 3rd target.
            links = support.FIXTURE['enrollment_links']
            run_0 = _run_row({**links[0], 'strategy_profile': 'syn_profile_0'}, run_id='actual-1')
            run_1 = _run_row({**links[1], 'strategy_profile': 'syn_profile_1'}, run_id='actual-2')
            non_run = _run_row({**links[2], 'strategy_profile': 'syn_profile_2'}, run_id='unused', actually_ran=False)
            store = MemoryStore({
                f"ibkr/{DAY}/{links[0]['candidate_slot']}.json": {'runs': [run_0, deepcopy(run_0)]},
                f"ibkr/{DAY}/{links[1]['candidate_slot']}.json": {'runs': [run_1]},
                f"schwab/{DAY}/{links[2]['candidate_slot']}.json": {'runs': [non_run]},
            })

            runner_1 = _make_runner([four_on, four_on])
            sent_1 = []
            _slot_args(cfg, MemoryStore(dict(store.rows)), sent_1, runner=runner_1, raw_observations=[*base_obs, disabled_obs])
            self.assertIn('Display 10 | Eligible 9/10 | Live managed 3 (disabled 5, outside 1, unknown 0)', sent_1[0])
            self.assertIn('Paper scope: display 1 | confirmed managed 1', sent_1[0])
            self.assertIn('Live coverage: managed 2/3 | raw 4/9 | Paper managed 1/1, raw 1/1', sent_1[0])
            self.assertIn('Live runs: 2 | targets 3/4', sent_1[0])

            # Removing disabled observation changes raw coverage to 3/9 only.
            runner_2 = _make_runner([four_on, four_on])
            sent_2 = []
            _slot_args(cfg, MemoryStore(dict(store.rows)), sent_2, runner=runner_2, raw_observations=base_obs)
            self.assertIn('Live coverage: managed 2/3 | raw 3/9 | Paper managed 1/1, raw 1/1', sent_2[0])

            # Unknown live makes live totals unavailable; paper-only unknown leaves live cohort intact.
            runner_live_unk = _make_runner([support.scenario('four_on_live_missing'), support.scenario('four_on_live_missing')])
            sent_live_unk = []
            _slot_args(cfg, MemoryStore(dict(store.rows)), sent_live_unk, runner=runner_live_unk, raw_observations=base_obs)
            self.assertIn('live totals unavailable (management_status_unknown)', sent_live_unk[0])

            runner_paper_unk = _make_runner([support.scenario('four_on_paper_missing'), support.scenario('four_on_paper_missing')])
            sent_paper_unk = []
            _slot_args(cfg, MemoryStore(dict(store.rows)), sent_paper_unk, runner=runner_paper_unk, raw_observations=base_obs)
            self.assertNotIn('live totals unavailable', sent_paper_unk[0])
            self.assertIn('Live coverage: managed 2/3 | raw 3/9', sent_paper_unk[0])

    def test_row_19_locale_parity_expectations_and_no_substitutions(self):
        with support.OutboundTrap():
            # Exercise all 4 statuses and all 3 evidence suffixes, swapped safe labels, expectation disagreement/agreement.
            one_off = support.scenario('one_off')
            missing_one = support.scenario('missing_one')
            conflict_sc = support.scenario('sibling_flag_disagree')
            # Build a single outcome with stale evidence in envelope + expectations.
            instances = support.instances()
            for idx, inst in enumerate(instances):
                inst['config']['label'] = f'SafeLabel-{idx:02d}'
            art_bytes, _ = support.prepare(instance_rows=instances)
            runner = _make_runner([missing_one, missing_one], artifact_bytes=art_bytes)
            outcome = runner.run(deadline=OBS_CLOCK + timedelta(seconds=10))
            env_doc = envelope.build_roster_envelope(outcome)
            # Also exercise stale suffix directly via validated envelope.
            env_stale = deepcopy(env_doc)
            env_stale['groups'][0]['evidence_state'] = 'stale'
            env_stale['groups'][0]['management_status'] = 'unknown'
            env_stale['groups'][0]['processing_eligible'] = False
            env_stale['counts']['managed'] -= 1
            env_stale['counts']['unknown'] += 1

            # Default en when QSL_NOTIFY_LANG is unset, explicit zh when set.
            with patch.dict(os.environ, _boot_env(), clear=True):
                cfg_default = app.Configuration.from_environment()
                self.assertEqual(cfg_default.locale, 'en')
            with patch.dict(os.environ, _boot_env({'QSL_NOTIFY_LANG': 'zh'}), clear=True):
                cfg_zh = app.Configuration.from_environment()
                self.assertEqual(cfg_zh.locale, 'zh')

            # Disagreement expectation vs agreement expectation vs absent expectation.
            managed_pair = (env_doc['groups'][0]['deployments'][0]['platform'],
                            env_doc['groups'][0]['deployments'][0]['legacy_key'])
            text_en = render_account_daily(
                DailyDigestInput(DAY, locale='en'), [], [],
                roster_envelope=env_doc,
                management_expectations={managed_pair: False},
            )
            self.assertIn('Under quant management (differs from expectation)', text_en)
            self.assertIn('Outside quant management', text_en)
            self.assertIn('Quant management status unknown (Evidence unknown)', text_en)
            self.assertNotIn('HK', text_en)

            text_agree = render_account_daily(
                DailyDigestInput(DAY, locale='en'), [], [],
                roster_envelope=env_doc,
                management_expectations={managed_pair: True},
            )
            self.assertNotIn('differs from expectation', text_agree)

            text_zh_stale = render_account_daily(
                DailyDigestInput(DAY, locale='zh'), [], [],
                roster_envelope=env_stale,
            )
            self.assertIn('量化管理状态未知（证据已过期）', text_zh_stale)
            self.assertIn('已纳入量化管理', text_zh_stale)
            self.assertIn('不纳入量化管理', text_zh_stale)

            # Conflict status rendering.
            runner_c = _make_runner([conflict_sc, conflict_sc], artifact_bytes=art_bytes)
            text_c, _ = app._report(cfg_zh, [], [], DAY, _platform_config(),
                                    roster_outcome=runner_c.run(deadline=OBS_CLOCK + timedelta(seconds=10)))
            self.assertIn('量化管理状态未知（证据冲突）', text_c)
            self.assertNotIn('（已启用）', text_c)
            self.assertNotIn('（已停止）', text_c)

    def test_row_20_compact_header_reservation_70_char_labels_30_holdings(self):
        with support.OutboundTrap():
            missing_one = support.scenario('missing_one')
            conflict_sc = support.scenario('sibling_flag_disagree')
            # Prepare 10 distinct safe 70-char labels, each containing a supplementary-plane char 🌟 (len 1 in Python, 2 UTF-16 units).
            instances = support.instances()
            labels_by_pair = {}
            for idx, inst in enumerate(instances):
                # 70-character label: 1 supplementary char + 69 ASCII letters/hyphens.
                lbl = f'🌟Acct-{chr(65 + idx)}-' + ('X' * 62)
                self.assertEqual(len(lbl), 70)
                inst['config']['label'] = lbl
                labels_by_pair[(inst['platform'], inst['key'])] = lbl
            art_bytes, _ = support.prepare(instance_rows=instances)
            runner = _make_runner([missing_one, missing_one], artifact_bytes=art_bytes)
            outcome = runner.run(deadline=OBS_CLOCK + timedelta(seconds=10))
            env_doc = envelope.build_roster_envelope(outcome)
            # Mark 2 groups with missing evidence (group 1 already unknown; mark group 2 unknown as well).
            env_doc['groups'][2]['evidence_state'] = 'unknown'
            env_doc['groups'][2]['management_status'] = 'unknown'
            env_doc['groups'][2]['processing_eligible'] = False
            env_doc['counts']['managed'] -= 1
            env_doc['counts']['unknown'] += 1

            # Supply 30 optional holding details on each of the other 8 groups.
            facts = {}
            for idx, grp in enumerate(env_doc['groups']):
                if idx in {1, 2}:
                    continue
                key = tuple((d['platform'], d['legacy_key']) for d in grp['deployments'])
                facts[key] = {'snapshots': [{
                    'as_of': support.stamp(OBS_CLOCK),
                    'equity': 10000 + idx,
                    'equity_currency': 'USD',
                    'holdings': [{'symbol': f'SYNTH{idx:02d}POS{p:02d}EQ', 'quantity': p + 1, 'asset_type': 'stock'}
                                 for p in range(30)],
                }]}

            for locale in ('en', 'zh'):
                with self.subTest(locale=locale):
                    text = render_account_daily(
                        DailyDigestInput(DAY, locale=locale), [], [],
                        facts=facts, known_platforms=_platform_config()['platforms'],
                        roster_envelope=env_doc,
                    )
                    utf16_units = len(text.encode('utf-16-le')) // 2
                    self.assertLessEqual(utf16_units, 3850)
                    headers = [line for line in text.splitlines() if line.startswith('🏦 ')]
                    self.assertEqual(len(headers), 10)
                    self.assertEqual(len(set(headers)), 10)
                    # All 10 concise status labels survive.
                    status_lines = [
                        line for line in text.splitlines()
                        if any(tok in line for tok in (
                            status_text.MANAGEMENT_STATUS_TEXT[code]['zh-CN' if locale == 'zh' else 'en']
                            for code in authority.MANAGEMENT_STATUSES
                        ))
                    ]
                    self.assertEqual(len(status_lines), 10)
                    import re as _re
                    if locale == 'en':
                        match = _re.search(r'(\d+) items omitted \(holdings: (\d+) shown, (\d+) omitted\)', text)
                    else:
                        match = _re.search(r'另有 (\d+) 项省略（持仓展示 (\d+) 项、省略 (\d+) 项）', text)
                    self.assertIsNotNone(match, text)
                    omitted_total, shown_h, omitted_h = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
                    self.assertGreater(shown_h, 0)
                    self.assertGreater(omitted_h, 0)
                    self.assertEqual(shown_h + omitted_h, 240)
                    self.assertGreaterEqual(omitted_total, omitted_h)

            # Repeat after changing a configured label and removing a holding.
            renamed_instances = support.instances()
            for idx, inst in enumerate(renamed_instances):
                inst['config']['label'] = '🌟Renamed-Primary-Account-' + ('Y' * 45) if idx == 0 else f'🌟Acct-{chr(65 + idx)}-' + ('X' * 62)
            art_2, _ = support.prepare(instance_rows=renamed_instances)
            outcome_2 = _make_runner([missing_one, missing_one], artifact_bytes=art_2).run(
                deadline=OBS_CLOCK + timedelta(seconds=10)
            )
            env_2 = envelope.build_roster_envelope(outcome_2)
            # Only put 1 holding on group 0 and remove holding H0P00.
            g0_key = tuple((d['platform'], d['legacy_key']) for d in env_2['groups'][0]['deployments'])
            text_2 = render_account_daily(
                DailyDigestInput(DAY, locale='en'), [], [],
                facts={g0_key: {'snapshots': [{'as_of': support.stamp(OBS_CLOCK), 'holdings': [
                    {'symbol': 'KEPT1', 'quantity': 7, 'asset_type': 'stock'},
                ]}]}},
                known_platforms=_platform_config()['platforms'],
                roster_envelope=env_2,
            )
            self.assertIn('Renamed-Primary-Account', text_2)
            self.assertIn('KEPT1 7 shares', text_2)
            self.assertNotIn('SYNTH00POS00EQ', text_2)

    def test_row_21_standalone_consolidated_unsupported_and_legacy_preserved(self):
        with support.OutboundTrap():
            legacy_env = {
                'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true',
                'DIGEST_EXPECTED_TARGETS_JSON': json.dumps([{
                    'platform_id': 'schwab', 'candidate_slot': 'syn-slot',
                    'opaque_account_uid': 'uid-1', 'target_id': 'target-1',
                    'strategy_profile': 'synthetic_core',
                }]),
            }
            # Standalone consolidated presentation with v1 requested returns typed unsupported before legacy text.
            with patch.dict(os.environ, {**legacy_env, 'DIGEST_ROSTER_MODE': 'mapping_v1'}, clear=True):
                result = unified.render(DailyDigestInput(DAY, locale='en'))
                self.assertIsInstance(result, unified.UnsupportedConsolidatedPresentation)
                self.assertFalse(result.supported)
                self.assertEqual(result.reason_code, 'standalone_consolidated_mapping_unsupported')
                self.assertEqual(result.deferred_to, 'B9')

                with tempfile.TemporaryDirectory() as tmp:
                    cpath = Path(tmp) / 'c.json'
                    cpath.write_text('{"runs": []}', encoding='utf-8')
                    _, built_text, _ = aggregator.build_digest_payload(
                        business_day=DAY, candidates_path=cpath, include_github=False,
                        config=ux_config([]), roster_mode='mapping_v1',
                    )
                    self.assertIsInstance(built_text, unified.UnsupportedConsolidatedPresentation)

            # Legacy standalone consolidated entry retains target/run behavior when mapping mode is NOT requested.
            with patch.dict(os.environ, legacy_env, clear=True):
                legacy_text = unified.render(DailyDigestInput(DAY, locale='en', runs=(
                    DigestRunEntry(platform_id='schwab', strategy_profile='synthetic_core',
                                   order_count=1, order_count_status='known',
                                   fill_count=1, fill_count_status='known'),
                )))
                self.assertIsInstance(legacy_text, str)
                self.assertIn('Daily trading digest', legacy_text)

            # Reject passing a v1 roster document to legacy array Configuration without mapping mode.
            all_on = support.scenario('all_on')
            v1_doc = envelope.build_roster_envelope(
                _make_runner([all_on, all_on]).run(deadline=OBS_CLOCK + timedelta(seconds=10))
            )
            with self.assertRaisesRegex(ValueError, '^digest_roster_mode_required$'):
                app.Configuration(v1_doc, JOB, 'syn-scope', '2026-11-20')

            # Cloud's normal v1 path displays a roster-only group even when consolidation parsing is enabled.
            empty_art, _ = support.prepare(links=[], roster=[])
            with patch.dict(os.environ, _boot_env({'QSL_NOTIFY_LANG': 'en'}), clear=True):
                cfg = app.Configuration.from_environment()
            runner = _make_runner([all_on, all_on], artifact_bytes=empty_art)
            sent = []
            code, res = _slot_args(cfg, MemoryStore({}), sent, runner=runner)
            self.assertEqual((code, res['delivery']), (200, 'accepted'))
            self.assertEqual(sent[0].count('🏦 '), 10)


if __name__ == '__main__':
    unittest.main()
