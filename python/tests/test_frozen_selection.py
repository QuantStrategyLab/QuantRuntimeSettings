import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]

def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'python/scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

build = load('build_config')
runtime = load('runtime_settings')

class FrozenSelectionTest(unittest.TestCase):
    def test_full_target_validation_rejects_retired_profile_spellings(self):
        cases = (
            ('examples/targets/ibkr/us_combo.example.json', 'global_etf_rotation'),
            ('python/tests/fixtures/retired_hk_combo_target.json', 'hk_global_etf_tactical_rotation'),
            ('python/tests/fixtures/retired_cn_combo_target.json', 'cn_industry_etf_rotation'),
        )
        for filename, canonical in cases:
            profiles = [canonical, canonical.replace('_', '-'), canonical.upper().replace('_', '-')]
            if canonical == 'global_etf_rotation':
                profiles.extend(('global_macro_etf_rotation', 'global-macro-etf-rotation',
                                 'global_etf_confidence_vol_gate', 'global-etf-confidence-vol-gate'))
            for profile in profiles:
                with self.subTest(profile=profile):
                    target = json.loads((ROOT / filename).read_text())
                    target['runtime_target']['strategy_profile'] = profile
                    original = copy.deepcopy(target)
                    errors = runtime.validate_target(target)
                    self.assertIn(f'runtime_target.strategy_profile {profile} is frozen for new selection', errors)
                    self.assertEqual(target, original)

    def test_core_profile_spellings_keep_existing_dry_run_policy(self):
        cores = ('tqqq_growth_income', 'soxl_soxx_trend_income',
                 'russell_top50_leader_rotation', 'ibit_smart_dca', 'nasdaq_sp500_smart_dca')
        for canonical in cores:
            for profile in (canonical, canonical.replace('_', '-')):
                with self.subTest(profile=profile):
                    errors = []
                    runtime.validate_runtime_target_strategy_policy(
                        {'platform_id': 'ibkr', 'strategy_profile': profile, 'execution_mode': 'dry_run'}, errors)
                    self.assertEqual(errors, [])

    def test_display_alias_cannot_skip_strategy_policy(self):
        errors = []
        runtime.validate_runtime_target_strategy_policy(
            {'platform_id': 'binance', 'strategy_profile': 'bitcoin_etf_smart_dca', 'execution_mode': 'dry_run'},
            errors,
        )
        self.assertTrue(
            any('domain us_equity is not supported by binance' in error for error in errors),
            errors,
        )

    def test_policy_lookup_preserves_original_legacy_target_and_fingerprint(self):
        target = {'platform_id': 'ibkr', 'strategy_profile': 'GLOBAL-ETF-ROTATION', 'execution_mode': 'live'}
        digest = runtime.runtime_target_fingerprint(target)
        target['live_continuity'] = {
            'state': 'RECONCILE_ONLY', 'baseline_kind': 'legacy_authorized', 'baseline_id': 'legacy',
            'baseline_target_sha256': digest, 'captured_at': '2026-01-01',
        }
        original = copy.deepcopy(target)
        errors = []
        runtime.validate_runtime_target_strategy_policy(target, errors)
        self.assertEqual(errors, [])
        self.assertEqual(target, original)
        self.assertEqual(runtime.runtime_target_fingerprint(target), digest)

    def test_ssot_projection_and_boolean_validation(self):
        config = build.load_config()
        entries = {p['profile']: p for p in build.strategy_to_json_compat(config['strategies'])}
        frozen = {p for p, item in config['strategies'].items() if item.get('frozen') is True}
        self.assertEqual(len(frozen), 14)
        self.assertTrue(all(entries[p]['frozen'] is True for p in frozen))
        self.assertTrue(all(not entries[p].get('frozen', False) for p in ('tqqq_growth_income', 'soxl_soxx_trend_income', 'russell_top50_leader_rotation', 'ibit_smart_dca', 'nasdaq_sp500_smart_dca', 'us_equity_combo', 'crypto_btc_dca')))
        config['strategies']['global_etf_rotation']['frozen'] = 'true'
        self.assertIn('strategy global_etf_rotation: frozen must be boolean', build.validate(config))

    def test_new_frozen_selection_and_valid_risk_reducing_continuity(self):
        config = build.load_config()
        with patch.object(runtime, 'load_platform_config', return_value=config):
            for profile in ('global_etf_rotation', 'global_macro_etf_rotation', 'global_etf_confidence_vol_gate'):
                for mode in ('dry_run', 'paper', 'live'):
                    errors = []
                    runtime.validate_runtime_target_strategy_policy({'platform_id':'ibkr', 'strategy_profile':profile, 'execution_mode':mode}, errors)
                    self.assertIn(f'runtime_target.strategy_profile {profile} is frozen for new selection', errors)
            target = {'platform_id':'ibkr', 'strategy_profile':'global_etf_rotation', 'execution_mode':'live'}
            digest = runtime.runtime_target_fingerprint(target)
            target['live_continuity'] = {'state':'RECONCILE_ONLY', 'baseline_kind':'legacy_authorized', 'baseline_id':'legacy', 'baseline_target_sha256':digest, 'captured_at':'2026-01-01'}
            for state in ('RECONCILE_ONLY', 'RISK_REDUCTION_ONLY'):
                target['live_continuity']['state'] = state
                errors = []
                runtime.validate_runtime_target_strategy_policy(target, errors)
                self.assertEqual(errors, [])
            for state in ('ACTIVE_LKG', 'ACTIVE_REDUCED'):
                target['live_continuity']['state'] = state
                errors = []
                runtime.validate_runtime_target_strategy_policy(target, errors)
                self.assertTrue(any('frozen for new selection' in e for e in errors))
            target['live_continuity']['state'] = 'RECONCILE_ONLY'
            target['live_continuity']['baseline_target_sha256'] = '0' * 64
            errors = []
            runtime.validate_runtime_target_strategy_policy(target, errors)
            self.assertTrue(any('frozen for new selection' in e for e in errors))
