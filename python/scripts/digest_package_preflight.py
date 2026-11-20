"""Package preflight, isolated origin verification, and §11 item 7 inventory comparison."""
from __future__ import annotations

import ast
import hashlib
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

DEFAULT_MANIFEST = Path(__file__).resolve().with_name('digest_package_manifest.json')
MANIFEST_DESTINATION = 'python/scripts/digest_package_manifest.json'
STATUS_RESOURCE_DESTINATION = 'web/strategy-switch-console/application/runtime_instances/account_management_text.js'
VALID_ROLES = frozenset({'generation', 'preparer', 'both'})
ALLOWED_EXTERNAL_MODULES = frozenset({'google'})
EXPECTED_STATUS_TEXT = {
    'managed': {'zh-CN': '已纳入量化管理', 'en': 'Under quant management'},
    'management_disabled': {'zh-CN': '已停用量化管理', 'en': 'Quant management disabled'},
    'not_under_management': {'zh-CN': '不纳入量化管理', 'en': 'Outside quant management'},
    'unknown': {'zh-CN': '量化管理状态未知', 'en': 'Quant management status unknown'},
}
EXPECTED_EVIDENCE_TEXT = {
    'unknown': {'zh-CN': '证据未知', 'en': 'Evidence unknown'},
    'conflict': {'zh-CN': '证据冲突', 'en': 'Conflicting evidence'},
    'stale': {'zh-CN': '证据已过期', 'en': 'Stale evidence'},
}

_JS_STATIC_RE = re.compile(
    r'(?:^|[;\n}])\s*(?:import|export)\s+(?:type\s+)?'
    r'(?:\*(?:\s+as\s+[A-Za-z0-9_$]+)?\s+from\s+|'
    r'(?:[A-Za-z0-9_$,\s*{}]+?\s+from\s+)?)'
    r'([\'"])([^\'"]+)\1',
)
_JS_STATIC_SIDE_EFFECT_RE = re.compile(r'(?:^|[;\n}])\s*import\s+([\'"])([^\'"]+)\1')
_JS_LITERAL_STR_RE = re.compile(r'^\s*([\'"])([^\'"]+)\1\s*(?:,[\s\S]*)?$')
_JS_NEW_URL_RE = re.compile(
    r'^\s*new\s+URL\s*\(\s*([\'"])([^\'"]+)\1\s*,\s*([A-Za-z0-9_$.]+)\s*\)\s*$',
)


@dataclass(frozen=True)
class DiscoveredEdge:
    """One edge independently extracted from source files on disk."""
    source: str
    target: str
    edge_class: str
    detail: str = ''


def load_manifest(path=None):
    target = Path(path) if path is not None else DEFAULT_MANIFEST
    if not target.is_file():
        raise FileNotFoundError(f'missing_package_member:{MANIFEST_DESTINATION}')
    manifest = json.loads(target.read_text(encoding='utf-8'))
    if not isinstance(manifest, dict) or manifest.get('format') != 'qsl_digest_package_manifest.v1':
        raise ValueError('digest_package_manifest_invalid')
    return manifest


def _wanted_roles(role: str) -> set[str]:
    if role == 'generation':
        return {'generation', 'both'}
    if role == 'preparer':
        return {'preparer', 'both'}
    if role == 'all':
        return {'generation', 'preparer', 'both'}
    raise ValueError(f'invalid_package_role:{role}')


def _verify_status_resource(package_root: Path) -> None:
    target = package_root / STATUS_RESOURCE_DESTINATION
    if not target.is_file() or target.stat().st_size == 0:
        raise FileNotFoundError(f'missing_package_member:{STATUS_RESOURCE_DESTINATION}')
    from digest_roster_compatibility import _NEUTRAL_UNKNOWN_STATUS

    node = shutil.which('node')
    if node is not None:
        probe = (
            'import { pathToFileURL } from "node:url"; '
            'const mod = await import(pathToFileURL(process.argv[1]).href); '
            'console.log(JSON.stringify({status: mod.MANAGEMENT_STATUS_TEXT, evidence: mod.MANAGEMENT_EVIDENCE_TEXT}));'
        )
        proc = subprocess.run(
            [node, '--input-type=module', '-e', probe, str(target)],
            capture_output=True, text=True, check=False, timeout=15,
        )
        if proc.returncode != 0:
            raise ValueError(f'packaged_status_resource_invalid:{STATUS_RESOURCE_DESTINATION}')
        loaded = json.loads(proc.stdout)
        if loaded.get('status') != EXPECTED_STATUS_TEXT or loaded.get('evidence') != EXPECTED_EVIDENCE_TEXT:
            raise ValueError(f'packaged_status_resource_invalid:{STATUS_RESOURCE_DESTINATION}')
    else:
        text = target.read_text(encoding='utf-8')
        for group in (EXPECTED_STATUS_TEXT, EXPECTED_EVIDENCE_TEXT):
            for key, langs in group.items():
                for label in langs.values():
                    if key not in text or label not in text:
                        raise ValueError(f'packaged_status_resource_invalid:{STATUS_RESOURCE_DESTINATION}')
    if (_NEUTRAL_UNKNOWN_STATUS.get('en') != EXPECTED_STATUS_TEXT['unknown']['en']
            or _NEUTRAL_UNKNOWN_STATUS.get('zh') != EXPECTED_STATUS_TEXT['unknown']['zh-CN']):
        raise ValueError('packaged_status_resource_parity_mismatch')


def verify_package(package_root, *, role='all', manifest_path=None):
    """Verify every required member for `role` exists, pins base SHA-256, and loads schemas/resources."""
    root = Path(package_root).resolve()
    manifest_file = Path(manifest_path) if manifest_path is not None else (root / MANIFEST_DESTINATION)
    if not manifest_file.is_file():
        raise FileNotFoundError(f'missing_package_member:{MANIFEST_DESTINATION}')
    manifest = load_manifest(manifest_file)
    wanted = _wanted_roles(role)
    checked = []
    for member in manifest['members']:
        if member['dependency_role'] not in wanted:
            continue
        dest = root / member['destination']
        if not dest.is_file() or dest.stat().st_size == 0:
            raise FileNotFoundError(f"missing_package_member:{member['destination']}")
        if member.get('origin') == 'base':
            pinned = member.get('sha256')
            if not isinstance(pinned, str) or hashlib.sha256(dest.read_bytes()).hexdigest() != pinned:
                raise ValueError(f"package_member_version_mismatch:{member['destination']}")
        checked.append(member['destination'])

    # Verify schemas package-relatively unless an explicit override is intentionally set.
    from digest_roster_validator import SCHEMA_FILES, verify_packaged_schemas
    schemas = verify_packaged_schemas()
    if set(schemas) != set(SCHEMA_FILES):
        raise ValueError('packaged_schemas_incomplete')

    if 'python/scripts/display_names.json' in checked:
        import display_names
        if _relative(root, Path(display_names.__file__).with_suffix('.json')) is None:
            raise AssertionError('non_packaged_resource:data:display_names')
        if not display_names.safe_display_text('Safe Account'):
            raise ValueError('packaged_display_names_invalid')

    if STATUS_RESOURCE_DESTINATION in checked:
        _verify_status_resource(root)
    return checked


def module_name(destination: str) -> str:
    """Return qualified import name for a packaged Python module under python/scripts/."""
    parts = destination[len('python/scripts/'):-len('.py')].split('/')
    if parts[-1] == '__init__':
        parts = parts[:-1]
    return '.'.join(parts)


def _relative(root: Path, path) -> str | None:
    resolved = Path(path).resolve()
    if resolved != root and root not in resolved.parents:
        return None
    return resolved.relative_to(root).as_posix()


def assert_isolated_imports(package_root, *, allowed_prefixes=()):
    """Verify every loaded packaged Python module originated inside `package_root`."""
    root = Path(package_root).resolve()
    manifest = load_manifest(root / MANIFEST_DESTINATION)
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


def resource_origins(package_root, *, role='all'):
    """Return verified package-relative origins for all schemas, data, and status resources."""
    root = Path(package_root).resolve()
    manifest = load_manifest(root / MANIFEST_DESTINATION)
    wanted = _wanted_roles(role)

    from digest_roster_validator import _schemas_dir
    import display_names

    schema_dir = _schemas_dir()
    origins = {}
    for member in manifest['members']:
        if member['dependency_role'] not in wanted:
            continue
        kind = member.get('kind')
        dest = member['destination']
        if kind == 'schema':
            name = Path(dest).name
            actual = schema_dir / name
            key = f'schema:{name}'
        elif kind == 'data':
            actual = Path(display_names.__file__).with_suffix('.json') if dest == 'python/scripts/display_names.json' else (root / dest)
            key = f'data:{Path(dest).name}'
        elif kind == 'status_resource':
            actual = root / dest
            key = f'status:{Path(dest).name}'
        else:
            continue
        relative = _relative(root, actual)
        if relative is None or not (root / relative).is_file():
            raise AssertionError(f'non_packaged_resource:{key}')
        origins[key] = relative
    return origins


def _strip_js_comments(source: str) -> str:
    """Strip JS // and /* */ comments while preserving string, template, and regex literals."""
    out = []
    i, n = 0, len(source)
    prev_sig = ''
    while i < n:
        ch = source[i]
        nxt = source[i + 1] if i + 1 < n else ''
        if ch in {"'", '"', '`'}:
            quote = ch
            out.append(ch)
            i += 1
            while i < n:
                c = source[i]
                out.append(c)
                if c == '\\' and i + 1 < n:
                    out.append(source[i + 1])
                    i += 2
                    continue
                i += 1
                if c == quote:
                    break
            prev_sig = quote
            continue
        if ch == '/' and nxt == '/':
            out.append('  ')
            i += 2
            while i < n and source[i] != '\n':
                out.append(' ')
                i += 1
            continue
        if ch == '/' and nxt == '*':
            out.append('  ')
            i += 2
            while i + 1 < n and not (source[i] == '*' and source[i + 1] == '/'):
                out.append('\n' if source[i] == '\n' else ' ')
                i += 1
            if i + 1 < n:
                out.extend((' ', ' '))
                i += 2
            continue
        if ch == '/' and prev_sig in {'', '(', '=', ':', ',', '[', '!', '&', '|', '?', ';', '{', '}'}:
            out.append(ch)
            i += 1
            in_class = False
            while i < n:
                c = source[i]
                out.append(c)
                if c == '\\' and i + 1 < n:
                    out.append(source[i + 1])
                    i += 2
                    continue
                if c == '[':
                    in_class = True
                elif c == ']':
                    in_class = False
                elif c == '/' and not in_class:
                    i += 1
                    break
                i += 1
            prev_sig = '/'
            continue
        out.append(ch)
        if not ch.isspace():
            prev_sig = ch
        i += 1
    return ''.join(out)


def _resolve_python_module(modname: str, package_root: Path) -> str | None:
    scripts_dir = package_root / 'python' / 'scripts'
    parts = modname.split('.')
    file_cand = scripts_dir.joinpath(*parts).with_suffix('.py')
    if file_cand.is_file():
        return file_cand.relative_to(package_root).as_posix()
    pkg_cand = scripts_dir.joinpath(*parts, '__init__.py')
    if pkg_cand.is_file():
        return pkg_cand.relative_to(package_root).as_posix()
    return None


def _resolve_declared_target(spec: str, manifest_by_dest: dict[str, dict]) -> str:
    if spec in manifest_by_dest:
        return spec
    cand_py = f"python/scripts/{spec.replace('.', '/')}.py"
    if cand_py in manifest_by_dest:
        return cand_py
    cand_pkg = f"python/scripts/{spec.replace('.', '/')}/__init__.py"
    if cand_pkg in manifest_by_dest:
        return cand_pkg
    return spec


def _call_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        prefix = _call_name(node.value)
        return f'{prefix}.{node.attr}' if prefix else node.attr
    return ''


def scan_python_edges(
    src_rel: str,
    package_root: Path,
    manifest_entry: dict | None,
    manifest_by_dest: dict[str, dict],
) -> list[DiscoveredEdge]:
    """Independently inventory Python static/nested imports, literal dynamic imports, and resource loads."""
    src_path = package_root / src_rel
    source_text = src_path.read_text(encoding='utf-8')
    tree = ast.parse(source_text, filename=src_rel)
    scripts_dir = package_root / 'python' / 'scripts'
    edges: list[DiscoveredEdge] = []
    nonliteral_map = (manifest_entry or {}).get('nonliteral_import_mappings') or {}

    # Package submodule file implicitly depends on package __init__.py.
    if src_rel.startswith('python/scripts/') and src_path.parent != scripts_dir:
        init_path = src_path.parent / '__init__.py'
        if init_path.is_file() and init_path != src_path:
            edges.append(DiscoveredEdge(src_rel, init_path.relative_to(package_root).as_posix(), 'python_import'))

    known_resource_names = {
        Path(dest).name: dest
        for dest, m in manifest_by_dest.items()
        if m.get('kind') in {'data', 'schema', 'status_resource', 'js_module'}
    }
    known_resource_dests = {
        dest for dest, m in manifest_by_dest.items()
        if m.get('kind') in {'data', 'schema', 'status_resource', 'js_module'}
    }

    def add_mod_edge(modname: str, edge_class: str):
        top = modname.split('.')[0]
        if top in sys.stdlib_module_names or top in ALLOWED_EXTERNAL_MODULES:
            return
        resolved = _resolve_python_module(modname, package_root)
        if resolved is None:
            resolved = _resolve_declared_target(modname, manifest_by_dest)
            raise FileNotFoundError(f'missing_package_member:{resolved} (imported by {src_rel})')
        edges.append(DiscoveredEdge(src_rel, resolved, edge_class, detail=modname))

    import_module_aliases = {'importlib.import_module'}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == 'importlib':
            for alias in node.names:
                if alias.name == 'import_module':
                    import_module_aliases.add(alias.asname or alias.name)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == 'importlib' and alias.asname:
                    import_module_aliases.add(f'{alias.asname}.import_module')

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                add_mod_edge(alias.name, 'python_import')
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ''
            if node.level > 0:
                base_dir = src_path.parent
                for _ in range(node.level - 1):
                    base_dir = base_dir.parent
                rel_parts = base_dir.relative_to(scripts_dir).parts
                mod = '.'.join([*rel_parts, *([mod] if mod else [])])
            if mod:
                add_mod_edge(mod, 'python_import')
                for alias in node.names:
                    sub = f'{mod}.{alias.name}'
                    if _resolve_python_module(sub, package_root) is not None:
                        add_mod_edge(sub, 'python_import')
        elif isinstance(node, ast.Call):
            fn_name = _call_name(node.func)
            if fn_name in import_module_aliases or fn_name == '__import__':
                if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                    add_mod_edge(node.args[0].value, 'python_dynamic_import')
                else:
                    raise ValueError(f'unresolved_nonliteral_import:{src_rel}:{node.lineno}:{fn_name}')
            elif (isinstance(node.func, ast.Attribute) and node.func.attr == 'with_suffix'
                  and node.args and isinstance(node.args[0], ast.Constant)
                  and node.args[0].value == '.json'
                  and '__file__' in ast.unparse(node.func.value)
                  and '.' not in ast.unparse(node.func.value)):
                json_dest = src_path.with_suffix('.json').relative_to(package_root).as_posix()
                edges.append(DiscoveredEdge(src_rel, json_dest, 'data_load', detail='with_suffix(.json)'))
            elif isinstance(node.func, ast.Name) and node.func.id == 'load_roster_schema' and node.args:
                if not isinstance(node.args[0], ast.Constant):
                    for target in nonliteral_map.get('SCHEMA_FILES', ()):
                        edges.append(DiscoveredEdge(src_rel, target, 'schema_load', detail='SCHEMA_FILES'))
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            val = node.value
            if val in known_resource_dests and val != src_rel:
                kind = manifest_by_dest[val]['kind']
                edge_cls = {
                    'schema': 'schema_load',
                    'status_resource': 'status_load',
                    'data': 'data_load',
                    'js_module': 'js_script_load',
                }.get(kind, 'data_load')
                edges.append(DiscoveredEdge(src_rel, val, edge_cls, detail=val))
            elif val in known_resource_names:
                dest = known_resource_names[val]
                if dest != src_rel:
                    kind = manifest_by_dest[dest]['kind']
                    edge_cls = {
                        'schema': 'schema_load',
                        'status_resource': 'status_load',
                        'data': 'data_load',
                        'js_module': 'js_script_load',
                    }.get(kind, 'data_load')
                    edges.append(DiscoveredEdge(src_rel, dest, edge_cls, detail=val))
    return sorted(set(edges), key=lambda e: (e.source, e.target, e.edge_class))


def _resolve_js_rel(src_rel: str, spec: str) -> str:
    return posixpath.normpath(posixpath.join(posixpath.dirname(src_rel), spec))


_JS_DYN_OPEN_RE = re.compile(r'(?<![.\w$])(import|require)\s*\(')


def _extract_balanced_call_arg(text: str, open_paren_end: int) -> str | None:
    """Return raw argument text inside a `(...)` call starting right after `(`."""
    depth = 1
    i = open_paren_end
    n = len(text)
    while i < n and depth > 0:
        ch = text[i]
        if ch in {"'", '"', '`'}:
            q = ch
            i += 1
            while i < n:
                if text[i] == '\\' and i + 1 < n:
                    i += 2
                    continue
                if text[i] == q:
                    i += 1
                    break
                i += 1
            continue
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                return text[open_paren_end:i]
        i += 1
    return None


def scan_js_edges(
    src_rel: str,
    package_root: Path,
    manifest_entry: dict | None,
) -> list[DiscoveredEdge]:
    """Independently inventory JS static imports/re-exports, literal dynamic/require, and mapped loads."""
    src_path = package_root / src_rel
    stripped = _strip_js_comments(src_path.read_text(encoding='utf-8'))
    edges: list[DiscoveredEdge] = []
    nonliteral_map = (manifest_entry or {}).get('nonliteral_import_mappings') or {}

    for match in _JS_STATIC_RE.finditer(stripped):
        spec = match.group(2)
        if spec.startswith('.'):
            edges.append(DiscoveredEdge(src_rel, _resolve_js_rel(src_rel, spec), 'js_static_import', detail=spec))

    for match in _JS_STATIC_SIDE_EFFECT_RE.finditer(stripped):
        spec = match.group(2)
        if spec.startswith('.'):
            edges.append(DiscoveredEdge(src_rel, _resolve_js_rel(src_rel, spec), 'js_static_import', detail=spec))

    for match in _JS_DYN_OPEN_RE.finditer(stripped):
        kind = match.group(1)
        arg = _extract_balanced_call_arg(stripped, match.end())
        if arg is None:
            continue
        edge_cls = 'js_dynamic_import' if kind == 'import' else 'js_require'
        lit = _JS_LITERAL_STR_RE.match(arg)
        if lit:
            spec = lit.group(2)
            if spec.startswith('.'):
                edges.append(DiscoveredEdge(src_rel, _resolve_js_rel(src_rel, spec), edge_cls, detail=spec))
            continue
        url_match = _JS_NEW_URL_RE.match(arg)
        if url_match:
            rel_target, base_ident = url_match.group(2), url_match.group(3)
            allowed = nonliteral_map.get(base_ident)
            if not isinstance(allowed, dict) or rel_target not in allowed:
                raise ValueError(
                    f'undeclared_nonliteral_import:{src_rel}->{rel_target} (base={base_ident})',
                )
            edges.append(DiscoveredEdge(
                src_rel,
                allowed[rel_target],
                'js_mapped_dynamic_import',
                detail=f'{base_ident}:{rel_target}',
            ))
            continue
        raise ValueError(f'unresolved_nonliteral_import:{src_rel}:{kind}({arg.strip()})')

    return sorted(set(edges), key=lambda e: (e.source, e.target, e.edge_class))


def scan_schema_edges(src_rel: str, package_root: Path) -> list[DiscoveredEdge]:
    """Scan JSON schema for external file $ref dependencies (local #/$defs refs are internal)."""
    doc = json.loads((package_root / src_rel).read_text(encoding='utf-8'))
    edges: list[DiscoveredEdge] = []

    def walk(value):
        if isinstance(value, dict):
            ref = value.get('$ref')
            if isinstance(ref, str) and not ref.startswith('#') and '://' not in ref:
                target_file = ref.split('#', 1)[0]
                if target_file:
                    edges.append(DiscoveredEdge(
                        src_rel,
                        posixpath.normpath(posixpath.join(posixpath.dirname(src_rel), target_file)),
                        'schema_ref',
                        detail=ref,
                    ))
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(doc)
    return sorted(set(edges), key=lambda e: (e.source, e.target, e.edge_class))


def _entry_root(manifest: dict, entry_name: str, manifest_by_dest: dict[str, dict]) -> str:
    entry_spec = (manifest.get('entry_points') or {}).get(entry_name)
    if not isinstance(entry_spec, str) or not entry_spec:
        raise ValueError(f'unknown_manifest_entry:{entry_name}')
    if entry_spec in manifest_by_dest:
        return entry_spec
    mod_part = entry_spec.split('.', 1)[0]
    resolved = _resolve_declared_target(mod_part, manifest_by_dest)
    if resolved not in manifest_by_dest:
        raise ValueError(f'undeclared_entry_member:{entry_name}->{entry_spec}')
    return resolved


def verify_role_closure(
    package_root,
    manifest: dict,
    *,
    entry_name: str,
    allowed_roles: set[str] | frozenset[str],
    edges: list[DiscoveredEdge] | None = None,
) -> list[str]:
    """Verify every member transitively reached from `entry_name` has a permitted role."""
    manifest_by_dest = {m['destination']: m for m in manifest['members']}
    root_dest = _entry_root(manifest, entry_name, manifest_by_dest)
    if edges is None:
        edges = collect_entry_inventory(package_root, manifest, entry_name)['edges']

    reached = [root_dest]
    seen = {root_dest}
    adj: dict[str, list[str]] = {}
    for edge in edges:
        adj.setdefault(edge.source, []).append(edge.target)

    idx = 0
    while idx < len(reached):
        cur = reached[idx]
        idx += 1
        member = manifest_by_dest.get(cur)
        if member is None:
            raise ValueError(f'undeclared_package_member:{cur}')
        if member['dependency_role'] not in allowed_roles:
            raise ValueError(
                f"role_closure_violation:{entry_name}:{cur} has role={member['dependency_role']}",
            )
        for nxt in sorted(set(adj.get(cur, ())) | {
            _resolve_declared_target(imp, manifest_by_dest) for imp in member.get('imports', ())
        }):
            if nxt not in seen:
                seen.add(nxt)
                reached.append(nxt)
    return sorted(reached)


def collect_entry_inventory(
    package_root,
    manifest: dict,
    entry_name: str,
    *,
    exercised_nonliteral: set[str] | frozenset[str] | None = None,
) -> dict:
    """Compare manifest declarations and roles against an independent inventory of actual edges."""
    root = Path(package_root).resolve()
    manifest_by_dest = {m['destination']: m for m in manifest['members']}
    root_dest = _entry_root(manifest, entry_name, manifest_by_dest)

    visited: set[str] = set()
    queue: list[str] = [root_dest]
    all_edges: list[DiscoveredEdge] = []

    while queue:
        src = queue.pop(0)
        if src in visited:
            continue
        visited.add(src)
        member = manifest_by_dest.get(src)
        if member is None:
            raise ValueError(f'undeclared_package_member:{src}')
        src_file = root / src
        if not src_file.is_file():
            raise FileNotFoundError(f'missing_package_member:{src}')

        suppliers = member.get('suppliers') or {}
        if entry_name not in suppliers:
            raise ValueError(f'missing_entry_supplier:{entry_name}:{src}')

        if src.endswith('.py'):
            actual = scan_python_edges(src, root, member, manifest_by_dest)
        elif src.endswith(('.js', '.mjs', '.cjs')):
            actual = scan_js_edges(src, root, member)
        elif src.endswith('.schema.json'):
            actual = scan_schema_edges(src, root)
        else:
            actual = []

        declared_targets = {
            _resolve_declared_target(imp, manifest_by_dest) for imp in member.get('imports', ())
        }
        for edge in actual:
            if edge.target not in manifest_by_dest:
                raise ValueError(f'undeclared_package_edge:{src}->{edge.target} ({edge.edge_class})')
            if edge.target not in declared_targets:
                raise ValueError(f'undeclared_package_edge:{src}->{edge.target} ({edge.edge_class})')
            if not (root / edge.target).is_file():
                raise FileNotFoundError(f'missing_package_member:{edge.target} (required by {src})')
            all_edges.append(edge)
            if edge.target not in visited:
                queue.append(edge.target)

        nonliteral_map = member.get('nonliteral_import_mappings') or {}
        for mapping in nonliteral_map.values():
            mapped_targets = mapping.values() if isinstance(mapping, dict) else mapping
            for target in mapped_targets:
                if target not in declared_targets:
                    raise ValueError(f'undeclared_nonliteral_target:{src}->{target}')
                if exercised_nonliteral is not None and target not in exercised_nonliteral:
                    raise ValueError(f'unexercised_nonliteral_target:{src}->{target}')

        # Follow declared edges as well so missing declared members or undeclared targets fail.
        for decl in sorted(declared_targets):
            if decl not in manifest_by_dest:
                raise ValueError(f'undeclared_package_member:{decl} (declared by {src})')
            if not (root / decl).is_file():
                raise FileNotFoundError(f'missing_package_member:{decl} (declared by {src})')
            if decl not in visited:
                queue.append(decl)

    return {
        'entry': entry_name,
        'root': root_dest,
        'members': sorted(visited),
        'edges': sorted(set(all_edges), key=lambda e: (e.source, e.target, e.edge_class)),
    }


def verify_entry_inventory(
    package_root,
    manifest: dict | None = None,
    entry_name: str = 'python_preparer',
    *,
    allowed_roles: set[str] | frozenset[str] | None = None,
    exercised_nonliteral: set[str] | frozenset[str] | None = None,
) -> dict:
    """Run independent §11 item 7 inventory comparison (and optional role closure check) for `entry_name`."""
    root = Path(package_root).resolve()
    manifest_obj = manifest if manifest is not None else load_manifest(root / MANIFEST_DESTINATION)
    result = collect_entry_inventory(
        root, manifest_obj, entry_name, exercised_nonliteral=exercised_nonliteral,
    )
    if allowed_roles is not None:
        verify_role_closure(
            root, manifest_obj, entry_name=entry_name,
            allowed_roles=allowed_roles, edges=result['edges'],
        )
    return result


__all__ = [
    'ALLOWED_EXTERNAL_MODULES',
    'DEFAULT_MANIFEST',
    'DiscoveredEdge',
    'EXPECTED_EVIDENCE_TEXT',
    'EXPECTED_STATUS_TEXT',
    'MANIFEST_DESTINATION',
    'STATUS_RESOURCE_DESTINATION',
    'VALID_ROLES',
    'assert_isolated_imports',
    'collect_entry_inventory',
    'load_manifest',
    'module_name',
    'resource_origins',
    'scan_js_edges',
    'scan_python_edges',
    'scan_schema_edges',
    'verify_entry_inventory',
    'verify_package',
    'verify_role_closure',
]
