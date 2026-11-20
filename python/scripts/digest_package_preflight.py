"""Package preflight verification for the B3 digest package manifest (Q7)."""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

DEFAULT_MANIFEST = Path(__file__).resolve().with_name('digest_package_manifest.json')
VALID_ROLES = frozenset({'generation', 'preparer', 'both'})
MANIFEST_DESTINATION = 'python/scripts/digest_package_manifest.json'


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
    if manifest_path is None and not (root / MANIFEST_DESTINATION).is_file():
        raise FileNotFoundError(f'missing_package_member:{MANIFEST_DESTINATION}')
    manifest = load_manifest(manifest_path or (root / MANIFEST_DESTINATION))
    wanted = {'generation', 'both'} if role == 'generation' else ({'preparer', 'both'} if role == 'preparer' else VALID_ROLES)
    checked = []
    for member in manifest['members']:
        if member['dependency_role'] not in wanted:
            continue
        dest = root / member['destination']
        if not dest.is_file() or dest.stat().st_size == 0:
            raise FileNotFoundError(f"missing_package_member:{member['destination']}")
        # Base members are pinned to the synthetic base they were declared from.
        if 'sha256' in member and hashlib.sha256(dest.read_bytes()).hexdigest() != member['sha256']:
            raise ValueError(f"package_member_version_mismatch:{member['destination']}")
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


def module_name(destination):
    """The qualified import name of a packaged Python module."""
    parts = destination[len('python/scripts/'):-len('.py')].split('/')
    if parts[-1] == '__init__':
        parts = parts[:-1]
    return '.'.join(parts)


def _relative(root, path):
    resolved = Path(path).resolve()
    if resolved != root and root not in resolved.parents:
        return None
    return resolved.relative_to(root).as_posix()


def assert_isolated_imports(package_root, *, allowed_prefixes=()):
    """Every loaded packaged module, by qualified name, came from
    `package_root`; returns each one's package-relative origin."""
    root = Path(package_root).resolve()
    manifest = load_manifest(root / 'python/scripts/digest_package_manifest.json')
    local_names = {
        module_name(m['destination'])
        for m in manifest['members']
        if m['destination'].startswith('python/scripts/') and m['destination'].endswith('.py')
    }
    origins = {}
    for name in sorted(local_names):
        mod = sys.modules.get(name)
        if mod is None:
            continue
        mod_file = getattr(mod, '__file__', None)
        if not mod_file:
            raise AssertionError(f'missing_module_origin:{name}')
        relative = _relative(root, mod_file)
        if relative is None and not any(_relative(Path(p).resolve(), mod_file) is not None for p in allowed_prefixes):
            raise AssertionError(f'non_packaged_import:{name}')
        origins[name] = relative
    return origins


def resource_origins(package_root):
    """Package-relative origins of the required resources the generation
    reads: the closed schemas and the display-name and platform data."""
    root = Path(package_root).resolve()
    from digest_roster_envelope import SCHEMA_FILES, _schemas_dir
    import display_names
    paths = {f'schema:{name}': _schemas_dir() / name for name in SCHEMA_FILES}
    paths['data:display_names'] = Path(display_names.__file__).with_suffix('.json')
    paths['data:platform_config'] = root / 'platform-config.json'
    origins = {}
    for name, path in paths.items():
        relative = _relative(root, path)
        if relative is None or not (root / relative).is_file():
            raise AssertionError(f'non_packaged_resource:{name}')
        origins[name] = relative
    return origins
