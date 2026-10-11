#!/usr/bin/env python3
"""Merge producer DIGEST_CANDIDATES files into one candidates JSON (NOTIFY-04 B2).

Inputs: an optional base file (e.g. materialized from the legacy Environment
secret) plus every ``*.json`` under ``--input-dir`` (files fetched from the
private producer store, one per platform/target). Output: a single
``qsl.digest_candidates.v1`` envelope with concatenated ``runs``.

Freshness is not decided here: the aggregator drops rows whose business day
differs from the digest business day (NOTIFY-04 B0). This script never prints
row contents — only counts — because rows may carry account equity.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "qsl.digest_candidates.v1"


def _rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        raw = payload
    elif isinstance(payload, dict):
        raw = payload.get("runs", payload.get("candidates", []))
    else:
        raise ValueError("candidates payload must be an object or list")
    if not isinstance(raw, list) or not all(isinstance(item, dict) for item in raw):
        raise ValueError("candidates runs must be a list of objects")
    return [dict(item) for item in raw]


def merge(base: Path | None, input_dir: Path | None) -> tuple[dict[str, Any], dict[str, int]]:
    runs: list[dict[str, Any]] = []
    stats = {"base_rows": 0, "files": 0, "file_rows": 0, "invalid_files": 0}
    if base is not None and base.is_file():
        rows = _rows(json.loads(base.read_text(encoding="utf-8")))
        stats["base_rows"] = len(rows)
        runs.extend(rows)
    if input_dir is not None and input_dir.is_dir():
        for path in sorted(input_dir.rglob("*.json")):
            try:
                rows = _rows(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                stats["invalid_files"] += 1
                continue
            stats["files"] += 1
            stats["file_rows"] += len(rows)
            runs.extend(rows)
    return {"schema_version": SCHEMA_VERSION, "runs": runs}, stats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=None)
    parser.add_argument("--input-dir", type=Path, default=None)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    payload, stats = merge(args.base, args.input_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"merged_rows": len(payload["runs"]), **stats}, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
