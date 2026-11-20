"""Prepare a private, display-only digest roster from the current account configuration."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

_SCRIPTS = str(Path(__file__).resolve().parent)
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from digest_roster_validator import (  # noqa: E402
    BINDING_FIELDS,
    CONFIG_IDENTITY_FIELDS,
    SELECTION_FORMAT,
    AuthorityError,
    strict_json,
)
from display_names import broker_account_identity, safe_display_text  # noqa: E402


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


def prepare_mapping_enrollment_bundle(*, js_bundle, legacy_roster, observation_bindings, source, versions,
                                    prepared_at):
    """Compose enrollment artifact, selection, and retained raw PrepInputs from one JS bundle."""
    from digest_roster_authority import prepare_enrollment_bundle

    if not isinstance(js_bundle, dict):
        raise ValueError('digest_mapping_bundle_invalid')
    for required in ('readback', 'effective_export', 'projection', 'instances', 'enrollment_links'):
        if required not in js_bundle:
            raise ValueError('digest_mapping_bundle_invalid')
    prepared = prepare_enrollment_bundle(
        readback=js_bundle['readback'],
        effective_records=js_bundle['effective_export'],
        projection=js_bundle['projection'],
        instances=js_bundle['instances'],
        enrollment_links=js_bundle['enrollment_links'],
        legacy_roster=legacy_roster,
        observation_bindings=observation_bindings,
        source=source,
        versions=versions,
        prepared_at=prepared_at,
        authority_input=js_bundle.get('authority'),
    )
    selection = {
        'format': SELECTION_FORMAT,
        'source': source,
        'version': versions['version'],
        'artifact_sha256': prepared.artifact_sha256,
        'membership_version': versions['membership_version'],
        'label_version': versions['label_version'],
        'link_version': versions['link_version'],
    }
    return prepared, selection


def prepare_mapping_enrollment(*, js_bundle, legacy_roster, observation_bindings, source, versions, prepared_at):
    """Compose a qsl_digest_enrollment_artifact.v1 + selection from one coherent JS observation bundle."""
    prepared, selection = prepare_mapping_enrollment_bundle(
        js_bundle=js_bundle,
        legacy_roster=legacy_roster,
        observation_bindings=observation_bindings,
        source=source,
        versions=versions,
        prepared_at=prepared_at,
    )
    return prepared.artifact_bytes, prepared.artifact_sha256, selection


def _resolve_js_preparer(explicit_path):
    if explicit_path is not None:
        return explicit_path
    here = Path(__file__).resolve()
    for candidate in (here.parent / 'prepare_digest_enrollment_inputs.mjs',
                      here.parents[2] / 'scripts' / 'prepare_digest_enrollment_inputs.mjs'):
        if candidate.is_file():
            return candidate
    raise ValueError('digest_js_preparer_missing')


def _write_private_bytes(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(data)


def _main_prepare_mapping(argv):
    parser = argparse.ArgumentParser(
        prog='project_digest_display_roster.py prepare-mapping',
        description='Prepare qsl_digest_enrollment_artifact.v1 and selection from one DO observation.',
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument('--js-bundle', type=Path)
    source_group.add_argument('--do-observation', type=Path)
    parser.add_argument('--js-preparer', type=Path, default=None)
    parser.add_argument('--legacy-roster', type=Path, required=True)
    parser.add_argument('--observation-bindings', type=Path, required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--membership-version', required=True)
    parser.add_argument('--label-version', required=True)
    parser.add_argument('--link-version', required=True)
    parser.add_argument('--prepared-at', required=True)
    parser.add_argument('--artifact-output', type=Path, required=True)
    parser.add_argument('--selection-output', type=Path, default=None)
    parser.add_argument('--raw-identifiers-output', type=Path, default=None)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args(argv)
    try:
        if args.do_observation is not None:
            script = _resolve_js_preparer(args.js_preparer)
            proc = subprocess.run(
                ['node', str(script), '--input', str(args.do_observation)],
                capture_output=True, check=False, timeout=30,
            )
            if proc.returncode != 0:
                print('digest_mapping_js_preparation_failed')
                return 2
            js_bundle = strict_json(proc.stdout)
        else:
            js_bundle = strict_json(args.js_bundle.read_bytes())
        legacy_roster = strict_json(args.legacy_roster.read_bytes())
        observation_bindings = strict_json(args.observation_bindings.read_bytes())
        versions = {
            'version': args.version,
            'membership_version': args.membership_version,
            'label_version': args.label_version,
            'link_version': args.link_version,
        }
        prepared, selection = prepare_mapping_enrollment_bundle(
            js_bundle=js_bundle,
            legacy_roster=legacy_roster,
            observation_bindings=observation_bindings,
            source=args.source,
            versions=versions,
            prepared_at=args.prepared_at,
        )
        artifact_bytes = prepared.artifact_bytes
        selection_bytes = json.dumps(selection, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
        raw_id_payload = {
            'raw_identifiers': sorted(prepared.prep_inputs.raw_identifiers),
            'by_platform': {
                (plat if plat is not None else '_unscoped'): sorted(vals)
                for plat, vals in sorted(prepared.prep_inputs.raw_identifiers_by_platform.items(),
                                         key=lambda item: '' if item[0] is None else item[0])
            },
        }
        raw_id_bytes = json.dumps(raw_id_payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
        if args.check:
            artifact_ok = args.artifact_output.is_file() and args.artifact_output.read_bytes() == artifact_bytes
            selection_ok = (args.selection_output is None
                            or (args.selection_output.is_file()
                                and strict_json(args.selection_output.read_bytes()) == selection))
            raw_ok = (args.raw_identifiers_output is None
                      or (args.raw_identifiers_output.is_file()
                          and strict_json(args.raw_identifiers_output.read_bytes()) == raw_id_payload))
            print('digest_mapping_current' if (artifact_ok and selection_ok and raw_ok) else 'digest_mapping_out_of_sync')
            return 0 if (artifact_ok and selection_ok and raw_ok) else 1
        _write_private_bytes(args.artifact_output, artifact_bytes)
        if args.selection_output is not None:
            _write_private_bytes(args.selection_output, selection_bytes)
        if args.raw_identifiers_output is not None:
            _write_private_bytes(args.raw_identifiers_output, raw_id_bytes)
        print('digest_mapping_prepared')
    except AuthorityError as error:
        print(error.code)
        return 2
    except (AttributeError, KeyError, OSError, subprocess.SubprocessError, TypeError, ValueError):
        print('digest_mapping_preparation_failed')
        return 2
    return 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == 'prepare-mapping':
        return _main_prepare_mapping(argv[1:])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--roster', type=Path, required=True)
    parser.add_argument('--management', type=Path, required=True)
    parser.add_argument('--enrollment-links', type=Path, required=True)
    output = parser.add_mutually_exclusive_group(required=True)
    output.add_argument('--check', action='store_true')
    output.add_argument('--output', type=Path)
    parser.add_argument('--telegram-recipient-file', type=Path)
    args = parser.parse_args(argv)
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
