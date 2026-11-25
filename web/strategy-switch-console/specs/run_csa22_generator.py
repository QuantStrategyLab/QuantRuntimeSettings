"""Invoke a vendored C-SA-22 generator while staging lowercase spec.md as SPEC.md."""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path


def _single_match(spec_dir: Path, pattern: str) -> Path:
    matches = sorted(spec_dir.glob(pattern))
    if len(matches) != 1:
        raise FileNotFoundError(f"Expected 1 match for {pattern} in {spec_dir}, found {len(matches)}")
    return matches[0]


def run_generator(spec_dir: Path, *, write: bool) -> None:
    """Stage tracked lowercase spec.md into a temp dir so pinned generators run unchanged."""
    spec_md = spec_dir / "spec.md"
    if not spec_md.is_file():
        raise FileNotFoundError(f"Missing lowercase spec file: {spec_md}")
    gen_path = _single_match(spec_dir, "generate_expected_*.py")
    exc_path = _single_match(spec_dir, "exceptions-*.json")
    expected_path = _single_match(spec_dir, "expected-*.json")
    manifest_path = spec_dir / "manifest.json"

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        # Vendored manifests pin SPEC.md digests while repository policy requires spec.md.
        shutil.copy2(spec_md, tmp_dir / "SPEC.md")
        shutil.copy2(exc_path, tmp_dir / exc_path.name)
        shutil.copy2(gen_path, tmp_dir / gen_path.name)

        spec = importlib.util.spec_from_file_location("csa22_vendored_generator", tmp_dir / gen_path.name)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Unable to load generator module: {gen_path}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.generate(tmp_dir)

        generated_expected = tmp_dir / expected_path.name
        generated_manifest = json.loads((tmp_dir / "manifest.json").read_text(encoding="utf-8"))
        if write:
            shutil.copy2(generated_expected, expected_path)
            existing = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
            merged = {**existing, **generated_manifest}
            manifest_path.write_text(json.dumps(merged, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            return

        if generated_expected.read_bytes() != expected_path.read_bytes():
            raise AssertionError(f"Generated {expected_path.name} differs from tracked {expected_path}")
        tracked_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for key, expected_val in generated_manifest.items():
            if tracked_manifest.get(key) != expected_val:
                raise AssertionError(f"Tracked manifest.json mismatch for {key!r} in {manifest_path}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Verify generated vectors and manifest match disk.")
    mode.add_argument("--write", action="store_true", help="Write regenerated vectors and manifest to disk.")
    parser.add_argument("spec_dir", type=Path, help="Path to a csa22 spec package directory.")
    args = parser.parse_args(argv)
    run_generator(args.spec_dir.resolve(), write=args.write)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
