import json
import unittest
from copy import deepcopy

from project_digest_display_roster import (
    BINDING_FIELDS,
    CONFIG_IDENTITY_FIELDS,
    project_display_roster,
    project_telegram_display_settings,
)


def binding(platform, slot, target):
    return {
        'platform_id': platform, 'candidate_slot': slot,
        'opaque_account_uid': f'uid-{slot}', 'target_id': target,
        'strategy_profile': 'original_strategy', 'account_label': 'original label',
    }


def instance(platform, key, label, selector):
    return {
        'kind': 'existing', 'platform': platform,
        'config': {
            'key': key, 'label': label, 'account_selector': selector,
            'deployment_selector': key, 'service_name': f'{platform}-{key}',
            'runtime_status_target_id': f'{platform}.{key}',
        },
    }


def link(row, item):
    config = item['config']
    return {
        **{field: row[field] for field in BINDING_FIELDS},
        'account_key': config['key'],
        'config_identity': {field: config[field] for field in CONFIG_IDENTITY_FIELDS},
    }


class DisplayRosterTests(unittest.TestCase):
    def setUp(self):
        self.ibkr = instance('ibkr', 'legacy-key', 'Old strategy name', 'U0001234')
        self.longbridge = instance('longbridge', 'sg', 'sg', 'SG')
        self.management = {
            'initialized': True,
            'instances': [instance('longbridge', 'paper', 'paper', 'PAPER'), self.longbridge, self.ibkr],
        }
        self.roster = [binding('ibkr', 'ibkr-live', 'digest-opaque-target'),
                       binding('longbridge', 'sg-snapshot', 'sg')]
        self.links = [link(self.roster[0], self.ibkr), link(self.roster[1], self.longbridge)]

    def test_uses_config_order_and_verified_account_identity(self):
        original = deepcopy(self.roster)
        self.ibkr['config']['label'] = 'New strategy name'
        result = project_display_roster(self.roster, self.management, self.links)
        self.assertEqual(result, [{**original[1], 'account_label': 'SG'},
                                  {key: value for key, value in original[0].items() if key != 'account_label'}])
        self.assertEqual(self.roster, original)

    def test_updates_configured_display_alias(self):
        self.longbridge['config']['label'] = 'Singapore'
        self.assertEqual(project_display_roster(self.roster, self.management, self.links)[0]['account_label'],
                         'Singapore')

    def test_exports_full_account_only_in_recipient_bound_settings(self):
        result = project_telegram_display_settings(self.roster, self.management, self.links, 'recipient')
        self.assertNotIn('U0001234', result['DIGEST_EXPECTED_TARGETS_JSON'])
        self.assertEqual(json.loads(result['DIGEST_TELEGRAM_IBKR_ACCOUNT_IDS_JSON']), {
            'recipient_id': 'recipient',
            'accounts': [{'candidate_slot': 'ibkr-live', 'opaque_account_uid': 'uid-ibkr-live',
                          'target_id': 'digest-opaque-target', 'account_id': 'U0001234'}],
        })

    def test_keeps_platform_together_when_instances_are_interleaved(self):
        second = instance('longbridge', 'hk', 'hk', 'HK')
        self.management['instances'].append(second)
        row = binding('longbridge', 'hk-snapshot', 'hk')
        self.roster.append(row)
        self.links.append(link(row, second))
        result = project_display_roster(self.roster, self.management, self.links)
        self.assertEqual([item.get('account_label') for item in result], ['SG', 'HK', None])

    def test_changed_management_account_cannot_rename_old_digest_binding(self):
        self.ibkr['config']['account_selector'] = 'U0004321'
        with self.assertRaisesRegex(ValueError, 'digest_configured_account_identity_changed'):
            project_display_roster(self.roster, self.management, self.links)

    def test_wrong_digest_target_and_missing_link_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'digest_enrollment_links_do_not_match_roster'):
            project_display_roster(self.roster, self.management, self.links[1:])
        self.roster[0]['target_id'] = 'changed-target'
        with self.assertRaisesRegex(ValueError, 'digest_enrollment_links_do_not_match_roster'):
            project_display_roster(self.roster, self.management, self.links)
