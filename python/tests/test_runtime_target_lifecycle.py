from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
MODULE_PATH = ROOT / "python" / "scripts" / "runtime_target_lifecycle.py"
SPEC = importlib.util.spec_from_file_location("runtime_target_lifecycle", MODULE_PATH)
assert SPEC and SPEC.loader
lifecycle = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = lifecycle
SPEC.loader.exec_module(lifecycle)


def _snapshot(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "source_id": "longbridge.sg",
        "target_id": "longbridge.sg",
        "platform": "longbridge",
        "configured_state": "disabled",
        "execution_mode": "dry_run",
        "runtime_guard": "pass",
        "execution_heartbeat": "not_applicable",
        "observed_at": "2026-08-30T00:00:00Z",
    }
    values.update(overrides)
    return lifecycle.build_runtime_target_lifecycle_source_snapshot(**values)


class RuntimeTargetLifecycleTest(unittest.TestCase):
    def test_console_runtime_status_board_uses_only_the_read_only_central_api(self) -> None:
        console = (ROOT / "web" / "strategy-switch-console" / "app.js").read_text(encoding="utf-8")
        page = (ROOT / "web" / "strategy-switch-console" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="runtime-target-lifecycle-list"', page)
        self.assertIn('requestJson("/api/runtime-target-lifecycle")', console)
        self.assertIn("function renderRuntimeTargetLifecycle()", console)
        self.assertIn('runtimeTargetLifecycleNoOrder', console)
        self.assertIn('runtimeTargetLifecycleObservation', console)
        self.assertIn('runtimeTargetLifecycleOrderEvidenceNotCollected', console)

    def test_disabled_target_remains_in_no_order_validation_lane(self) -> None:
        snapshot = _snapshot()

        target = snapshot["targets"][0]
        self.assertEqual(
            snapshot["schema_version"],
            "qsl_runtime_target_lifecycle_source_snapshot.v1",
        )
        self.assertEqual(target["target"]["configured_state"], "disabled")
        self.assertEqual(
            target["disposition"],
            {
                "code": "continue_disabled_validation",
                "reason_code": "target_intentionally_disabled",
            },
        )
        self.assertIs(target["no_order"], True)


    def test_enabled_target_continues_monitoring_when_checks_pass(self) -> None:
        snapshot = _snapshot(
            configured_state="enabled",
            execution_mode="paper",
            execution_heartbeat="pass",
        )

        self.assertEqual(
            snapshot["targets"][0]["disposition"],
            {
                "code": "continue_enabled_monitoring",
                "reason_code": "none",
            },
        )


    def test_monitoring_failures_park_without_changing_target_state(self) -> None:
        cases = [
        ("attention", "pass", "runtime_guard_attention"),
        ("pass", "attention", "execution_heartbeat_attention"),
        ("unavailable", "pass", "monitoring_unavailable"),
        ]
        for runtime_guard, execution_heartbeat, reason_code in cases:
            with self.subTest(
                runtime_guard=runtime_guard,
                execution_heartbeat=execution_heartbeat,
            ):
                snapshot = _snapshot(
                    configured_state="enabled",
                    execution_mode="paper",
                    runtime_guard=runtime_guard,
                    execution_heartbeat=execution_heartbeat,
                )

                self.assertEqual(
                    snapshot["targets"][0]["disposition"],
                    {
                        "code": "parked",
                        "reason_code": reason_code,
                    },
                )
                self.assertIs(snapshot["targets"][0]["no_order"], True)


    def test_disabled_target_rejects_an_execution_heartbeat_claim(self) -> None:
        with self.assertRaisesRegex(lifecycle.RuntimeTargetLifecycleError, "not_applicable"):
            _snapshot(execution_heartbeat="pass")
