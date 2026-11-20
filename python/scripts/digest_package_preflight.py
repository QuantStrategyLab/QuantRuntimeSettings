"""Package preflight verification for the B3 digest package manifest (Q7)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

DEFAULT_MANIFEST = Path(__file__).resolve().with_name('digest_package_manifest.json')
VALID_ROLES = frozenset({'generation', 'preparer', 'both'})


def load_manifest(path=None):
    target = Path(path) if path is not None else DEFAULT_MANIFEST
    if not target.is_file():
        raise FileNotFoundError(f'missing_package_member:{target.name}')
    manifest = json.loads(target.read_text(encoding='utf-8'))
    if not isinstance(manifest, dict) or manifest.get('format') != 'qsl_digest_package_manifest.v1':
        raise ValueError('digest_package_manifest_invalid')
    return manifest


def verify_package(package_root, *, role='generation', manifest_path=None):
    """Verify every required member for `role` exists under `package_root` and schemas/resources load."""
    root = Path(package_root).resolve()
    manifest = load_manifest(manifest_path or (root / 'python/scripts/digest_package_manifest.json'))
    wanted = {'generation', 'both'} if role == 'generation' else ({'preparer', 'both'} if role == 'preparer' else VALID_ROLES)
    checked = []
    for member in manifest['members']:
        if member['dependency_role'] not in wanted:
            continue
        dest = root / member['destination']
        if not dest.is_file() or dest.stat().st_size == 0:
            raise FileNotFoundError(f"missing_package_member:{member['destination']}")
        checked.append(member['destination'])

    if role in {'generation', 'all'}:
        os.environ['QSL_DIGEST_SCHEMAS_DIR'] = str(root / 'schemas')
        from digest_roster_envelope import verify_packaged_schemas
        from digest_roster_status_text import MANAGEMENT_EVIDENCE_TEXT, MANAGEMENT_STATUS_TEXT
        schemas = verify_packaged_schemas()
        if len(schemas) != 3:
            raise ValueError('packaged_schemas_incomplete')
        if set(MANAGEMENT_STATUS_TEXT) != {'managed', 'management_disabled', 'not_under_management', 'unknown'}:
            raise ValueError('packaged_status_resource_invalid')
        if set(MANAGEMENT_EVIDENCE_TEXT) != {'unknown', 'conflict', 'stale'}:
            raise ValueError('packaged_status_resource_invalid')
    return checked


def assert_isolated_imports(package_root, *, allowed_prefixes=()):
    """Verify every local digest module in sys.modules was loaded from `package_root` only."""
    root = Path(package_root).resolve()
    manifest = load_manifest(root / 'python/scripts/digest_package_manifest.json')
    local_names = {
        Path(m['destination']).stem
        for m in manifest['members']
        if m['destination'].startswith('python/scripts/') and m['destination'].endswith('.py')
    }
    local_names.add('notification_snapshot')
    origins = {}
    for name in sorted(local_names):
        mod = sys.modules.get(name)
        if mod is None:
            continue
        mod_file = getattr(mod, '__file__', None)
        if not mod_file:
            raise AssertionError(f'missing_module_origin:{name}')
        resolved = Path(mod_file).resolve()
        allowed = any(resolved == Path(p).resolve() or Path(p).resolve() in resolved.parents for p in (root, *allowed_prefixes))
        if not allowed:
            raise AssertionError(f'non_packaged_import:{name}:{resolved}')
        origins[name] = str(resolved)
    return origins
