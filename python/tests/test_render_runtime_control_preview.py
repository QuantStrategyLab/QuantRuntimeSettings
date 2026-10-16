from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
ROOT = SCRIPTS.parents[1]
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("render_runtime_control_preview", SCRIPTS / "render_runtime_control_preview.py")
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class RenderRuntimeControlPreviewTest(unittest.TestCase):
    def setUp(self):
        self.control = json.loads((ROOT / "examples/runtime_controls/example-paper.example.json").read_text())
        self.policy = json.loads((ROOT / "examples/risk_policies/soxl_soxx_trend_income/soxl-runtime-risk-20260917.example.json").read_text())

    def render(self, control=None, policy=None):
        return module.render_preview(
            self.control if control is None else control,
            self.policy if policy is None else policy,
            preview_enabled=True,
        )

    def test_default_off_does_not_validate_or_render(self):
        self.assertIsNone(module.render_preview(None, None))
        self.assertIsNone(module.render_preview({"invalid": object()}, None))
        with self.assertRaises(TypeError):
            module.render_preview(None, None, preview_enabled="true")

    def test_deterministic_render_and_hash_with_no_order_markers(self):
        result = self.render()
        encoded = result["runtime_control_json"].encode("utf-8")
        self.assertEqual(result["runtime_control_sha256"], hashlib.sha256(encoded).hexdigest())
        policy_json = json.dumps(self.policy, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        self.assertEqual(result["risk_policy_sha256"], hashlib.sha256(policy_json.encode("utf-8")).hexdigest())
        control = json.loads(encoded)
        self.assertFalse(control["enabled"])
        self.assertEqual(control["mode"], "dry_run")
        self.assertFalse(control["options_enabled"])
        self.assertNotIn("description", control)
        self.assertTrue(result["preview_only"])
        self.assertTrue(result["no_order"])
        self.assertFalse(result["execution_authorized"])
        self.assertFalse(result["live_ready"])
        self.assertEqual(self.render(dict(reversed(list(self.control.items())))), result)

    def test_inputs_are_unchanged_and_no_external_ports_are_used(self):
        before = copy.deepcopy((self.control, self.policy))
        with patch("socket.socket", side_effect=AssertionError("network forbidden")), patch(
            "subprocess.run", side_effect=AssertionError("process forbidden")
        ), patch.dict("os.environ", {"RUNTIME_TARGET_ENABLED": "true", "RUNTIME_CONTROL_JSON": "invalid"}):
            self.render()
        self.assertEqual((self.control, self.policy), before)

    def test_rejects_enabled_paper_live_and_options_candidates(self):
        for change in ({"enabled": True}, {"mode": "paper"}, {"mode": "live"}, {"options_enabled": True}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.render({**self.control, **change})

    def test_requires_matching_explicit_policy(self):
        with self.assertRaises(TypeError):
            module.render_preview(self.control, None, preview_enabled=True)
        for key in ("policy_id", "strategy_profile"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.render(policy={**self.policy, key: "other/reference"})

    def test_policy_only_raises_reserve_ratio_and_floor(self):
        control = copy.deepcopy(self.control)
        control["cash_policy"].update(reserved_cash_ratio=0.01, reserved_cash_floor_usd=10)
        policy = copy.deepcopy(self.policy)
        policy["cash_policy"]["reserved_cash_floor_usd"] = 20
        rendered = json.loads(self.render(control, policy)["runtime_control_json"])
        self.assertEqual(rendered["cash_policy"]["reserved_cash_ratio"], 0.03)
        self.assertEqual(rendered["cash_policy"]["reserved_cash_floor_usd"], 20)
        self.assertEqual(control["cash_policy"]["reserved_cash_ratio"], 0.01)

    def test_raised_reserve_cannot_exceed_available_nominal_budget(self):
        control = copy.deepcopy(self.control)
        control["cash_policy"]["reserved_cash_ratio"] = 0.05
        with self.assertRaisesRegex(ValueError, "reserve"):
            self.render(control)

    def test_policy_cash_only_cannot_be_disabled(self):
        control = copy.deepcopy(self.control)
        control["cash_policy"]["cash_only"] = False
        with self.assertRaisesRegex(ValueError, "cash.only"):
            self.render(control)

    def test_without_policy_reference_safe_control_can_render(self):
        control = {key: value for key, value in self.control.items() if key != "risk_limits_ref"}
        result = module.render_preview(control, None, preview_enabled=True)
        self.assertIsNone(result["risk_policy_sha256"])
        with self.assertRaises(ValueError):
            module.render_preview(control, self.policy, preview_enabled=True)

    def test_rejects_malformed_inputs(self):
        changes = [
            {"enabled": "false"}, {"mode": "DRY_RUN"}, {"platform_id": "other"},
            {"risk_limits_ref": ""}, {"risk_limits_ref": 123}, {"strategy_profile": []},
            {"cash_policy": {"cash_only": True, "reserved_cash_ratio": float("nan")}},
            {"cash_policy": {"cash_only": True, "reserved_cash_ratio": 0.03, "reserved_cash_floor_usd": float("inf")}},
            {"description": "account U12345678"}, {"unknown": True},
        ]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.render({**self.control, **change})
        for symbols in ([{}], [1], "SOXL"):
            with self.subTest(symbols=symbols), self.assertRaises(ValueError):
                self.render(policy={**self.policy, "allowed_symbols": symbols})

    def test_loader_rejects_duplicate_keys_constants_and_nonobjects(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "control.json"
            for text in ('{"enabled":false,"enabled":true}', '{"x":NaN}', '[]', 'null', '{'):
                with self.subTest(text=text), self.assertRaises((ValueError, TypeError)):
                    path.write_text(text)
                    module.load_json_object(path)

    def test_actual_cli_off_on_and_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            control = Path(tmp) / "control.json"
            policy = Path(tmp) / "policy.json"
            control.write_text(json.dumps(self.control))
            policy.write_text(json.dumps(self.policy))
            command = [sys.executable, str(SCRIPTS / "render_runtime_control_preview.py")]
            off = subprocess.run(command + ["--control-file", str(control.with_name("absent.json"))], capture_output=True, check=False)
            self.assertEqual(off.returncode, 0)
            self.assertEqual(off.stdout, b"")
            enabled = command + ["--preview-enabled", "--control-file", str(control), "--risk-policy-file", str(policy)]
            on = subprocess.run(enabled, capture_output=True, check=False)
            self.assertEqual(on.returncode, 0, on.stderr)
            self.assertEqual(json.loads(on.stdout), self.render())
            control.write_text(json.dumps({**self.control, "enabled": True}))
            bad = subprocess.run(enabled, capture_output=True, check=False)
            self.assertNotEqual(bad.returncode, 0)
            self.assertEqual(bad.stdout, b"")
            self.assertNotIn(b"Traceback", bad.stderr)
            missing_input = subprocess.run(command + ["--preview-enabled"], capture_output=True, check=False)
            self.assertNotEqual(missing_input.returncode, 0)
            self.assertEqual(missing_input.stdout, b"")
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["control.json", "policy.json"])


if __name__ == "__main__":
    unittest.main()
