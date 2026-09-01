from __future__ import annotations

import copy
import importlib.util
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "python" / "scripts" / "runtime_settings.py"
SPEC = importlib.util.spec_from_file_location("runtime_settings_decision_data_test", MODULE_PATH)
runtime_settings = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = runtime_settings
SPEC.loader.exec_module(runtime_settings)

_SHA256 = "a" * 64


def _target() -> dict[str, object]:
    path = ROOT / "examples" / "targets" / "ibkr" / "us_combo.example.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_legacy_decision_data_binding_is_observable_without_changing_target_mode() -> None:
    target = _target()
    runtime_target = target["runtime_target"]
    assert isinstance(runtime_target, dict)
    runtime_target["decision_data"] = {
        "binding_id": "legacy-yfinance-us-equity",
        "binding_sha256": _SHA256,
        "strategy_scope": "us_equity_combo",
        "mode": "legacy_runtime_fetch",
        "source_ids": ["yfinance"],
        "assurance_status": "LEGACY",
    }

    assert runtime_settings.validate_target(target) == []


def test_artifact_required_binding_requires_verified_evidence() -> None:
    target = _target()
    runtime_target = target["runtime_target"]
    assert isinstance(runtime_target, dict)
    runtime_target["decision_data"] = {
        "binding_id": "us-equity-daily-v1",
        "binding_sha256": _SHA256,
        "strategy_scope": "us_equity_combo",
        "mode": "artifact_required",
        "source_ids": ["alpaca_sip", "ibkr_data_only"],
        "as_of": "2026-08-31",
        "adjustment_basis": "split_adjusted",
        "artifact_sha256": _SHA256,
        "assurance_status": "VERIFIED",
    }

    assert runtime_settings.validate_target(target) == []

    rejected = copy.deepcopy(target)
    rejected["runtime_target"]["decision_data"]["assurance_status"] = "DEGRADED"
    assert "runtime_target.decision_data artifact_required requires assurance_status VERIFIED" in runtime_settings.validate_target(
        rejected
    )


def test_decision_data_binding_rejects_private_location_shape() -> None:
    target = _target()
    runtime_target = target["runtime_target"]
    assert isinstance(runtime_target, dict)
    runtime_target["decision_data"] = {
        "binding_id": "unsafe-source",
        "binding_sha256": _SHA256,
        "strategy_scope": "us_equity_combo",
        "mode": "legacy_runtime_fetch",
        "source_ids": ["https://private.example/market-data"],
        "assurance_status": "LEGACY",
    }

    assert "runtime_target.decision_data.source_ids must contain unique stable identifiers" in runtime_settings.validate_target(
        target
    )
