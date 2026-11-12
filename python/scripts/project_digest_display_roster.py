"""Prepare a private, display-only digest roster from the current account configuration."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from display_names import broker_account_identity, safe_display_text


# The digest target can differ from the management instance key. Compare the
# private enrollment link against the actual digest binding before using it.
BINDING_FIELDS = ('platform_id', 'candidate_slot', 'opaque_account_uid', 'target_id')
CONFIG_IDENTITY_FIELDS = ('account_selector', 'deployment_selector', 'service_name', 'runtime_status_target_id')


def _binding_key(row):
    key = tuple(row.get(field) for field in BINDING_FIELDS)
    if not all(isinstance(value, str) and value for value in key):
        raise ValueError('invalid_digest_binding')
    return key


def _display_label(platform, config, binding):
    label = config.get('label')
    if not isinstance(label, str) or safe_display_text(label) != label or not label:
        raise ValueError('invalid_configured_account_label')
    # The two channel names are display text even when the private LongBridge
    # target uses the same lowercase abbreviation.
    if platform == 'longbridge' and label in {'hk', 'sg'}:
        return label.upper()
    if label in {binding['opaque_account_uid'], binding['target_id'], binding.get('account_hint')}:
        raise ValueError('configured_label_is_private_identity')
    return label


def _project(roster, management, enrollment_links):
    if management.get('initialized') is not True:
        raise ValueError('account_configuration_unavailable')
    configured, platform_order = {}, {}
    for index, instance in enumerate(management['instances']):
        if instance.get('kind') != 'existing':
            continue
        config = instance['config']
        platform = instance['platform']
        platform_order.setdefault(platform, len(platform_order))
        key = platform, config['key']
        if key in configured:
            raise ValueError('duplicate_configured_account')
        configured[key] = index, config

    links = {_binding_key(row): row for row in enrollment_links}
    bindings = {_binding_key(row) for row in roster}
    if len(links) != len(enrollment_links) or len(bindings) != len(roster) or links.keys() != bindings:
        raise ValueError('digest_enrollment_links_do_not_match_roster')
    owners = {}
    ranked, accounts = [], []
    for binding in roster:
        identity = _binding_key(binding)
        platform, _, account_uid, _ = identity
        link = links[identity]
        key = platform, link['account_key']
        if key not in configured:
            raise ValueError('digest_configured_account_missing')
        index, config = configured[key]
        config_identity = {field: config.get(field) for field in CONFIG_IDENTITY_FIELDS}
        if config_identity != link.get('config_identity') or not config_identity['account_selector']:
            raise ValueError('digest_configured_account_identity_changed')
        if owners.setdefault(key, account_uid) != account_uid:
            raise ValueError('digest_configured_account_link_ambiguous')
        projected = dict(binding)
        if platform == 'ibkr':
            account = broker_account_identity(platform, config['account_selector'])
            if not account:
                raise ValueError('invalid_ibkr_account_selector')
            projected.pop('account_label', None)
            accounts.append({**{field: binding[field] for field in BINDING_FIELDS if field != 'platform_id'},
                             'account_id': account})
        else:
            projected['account_label'] = _display_label(platform, config, binding)
        ranked.append(((platform_order[platform], index), projected))

    return [binding for _, binding in sorted(ranked, key=lambda row: row[0])], accounts


def project_display_roster(roster, management, enrollment_links):
    return _project(roster, management, enrollment_links)[0]


def project_telegram_display_settings(roster, management, enrollment_links, recipient):
    if not isinstance(recipient, str) or not recipient.strip():
        raise ValueError('telegram_recipient_required')
    projected, accounts = _project(roster, management, enrollment_links)
    return {'DIGEST_EXPECTED_TARGETS_JSON': json.dumps(projected, ensure_ascii=False),
            'DIGEST_TELEGRAM_IBKR_ACCOUNT_IDS_JSON': json.dumps({'recipient_id': recipient, 'accounts': accounts})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--roster', type=Path, required=True)
    parser.add_argument('--management', type=Path, required=True)
    parser.add_argument('--enrollment-links', type=Path, required=True)
    output = parser.add_mutually_exclusive_group(required=True)
    output.add_argument('--check', action='store_true')
    output.add_argument('--output', type=Path)
    parser.add_argument('--telegram-recipient-file', type=Path)
    args = parser.parse_args()
    if args.telegram_recipient_file and args.check:
        parser.error('--telegram-recipient-file requires --output')
    try:
        roster, management, links = (
            json.loads(path.read_text(encoding='utf-8'))
            for path in (args.roster, args.management, args.enrollment_links)
        )
        if args.telegram_recipient_file:
            projected = project_telegram_display_settings(
                roster, management, links, args.telegram_recipient_file.read_text(encoding='utf-8').strip(),
            )
        else:
            projected = project_display_roster(roster, management, links)
        if args.check:
            print('digest_display_current' if roster == projected else 'digest_display_out_of_sync')
            return 0 if roster == projected else 1
        descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            json.dump(projected, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
    except (AttributeError, KeyError, OSError, TypeError, ValueError):
        print('digest_display_projection_failed')
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
