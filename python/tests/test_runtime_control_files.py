from __future__ import annotations

import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
spec = importlib.util.spec_from_file_location("runtime_control_files", SCRIPTS / "runtime_control_files.py")
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = module
spec.loader.exec_module(module)

POLICY_PATH = module.RISK_POLICY_DIR / "soxl_soxx_trend_income" / "soxl-runtime-risk-20260917.example.json"
CONTROL_PATH = module.RUNTIME_CONTROL_DIR / "example-paper.example.json"


class RuntimeControlFilesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
        self.control = json.loads(CONTROL_PATH.read_text(encoding="utf-8"))

    def test_repository_files_are_valid(self) -> None:
        self.assertEqual(module.validate_tree(), [])

    def test_soxl_reference_matches_owner_red_lines(self) -> None:
        self.assertEqual(self.policy["nominal_caps"]["SOXL"], 0.679)
        self.assertEqual(self.policy["total_nominal_exposure_cap"], 0.97)
        self.assertEqual(self.policy["cash_policy"]["reserved_cash_ratio"], 0.03)
        self.assertTrue(self.policy["cash_policy"]["cash_only"])

    def test_example_control_is_fail_closed(self) -> None:
        self.assertFalse(self.control["enabled"])
        self.assertEqual(self.control["mode"], "dry_run")

    def _policy_errors(self, **changes):
        doc = copy.deepcopy(self.policy)
        doc.update(changes)
        return module.validate_risk_policy("policy", doc)

    def test_cap_above_total_is_rejected(self) -> None:
        caps = {**self.policy["nominal_caps"], "SOXL": 0.99}
        self.assertTrue(any("exceeds total" in e for e in self._policy_errors(nominal_caps=caps)))

    def test_total_plus_reserve_above_one_is_rejected(self) -> None:
        errors = self._policy_errors(cash_policy={"cash_only": True, "reserved_cash_ratio": 0.05})
        self.assertTrue(any("must not exceed 1" in e for e in errors))

    def test_unreachable_effective_cap_is_rejected(self) -> None:
        errors = self._policy_errors(total_effective_exposure_cap=3.5)
        self.assertTrue(any("reachable maximum" in e for e in errors))

    def test_reference_effective_cap_is_reachable_maximum(self) -> None:
        # 0.679 * 3 + (0.97 - 0.679) * 1 = 2.328
        self.assertEqual(self._policy_errors(), [])

    def test_missing_symbol_cap_is_rejected(self) -> None:
        caps = dict(self.policy["nominal_caps"])
        caps.pop("SOXX")
        self.assertTrue(self._policy_errors(nominal_caps=caps))

    def test_control_rejects_bad_mode_and_string_bool(self) -> None:
        doc = {**self.control, "mode": "LIVE", "enabled": "false"}
        errors = module.validate_runtime_control("control", doc)
        self.assertTrue(any("mode" in e for e in errors))
        self.assertTrue(any("enabled" in e for e in errors))

    def test_account_identifiers_and_dangling_refs_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            control_dir = Path(tmp) / "controls"
            policy_dir = Path(tmp) / "policies"
            control_dir.mkdir()
            policy_dir.mkdir()
            doc = {**self.control, "description": "account U12345678", "risk_limits_ref": "missing/ref"}
            (control_dir / "bad.json").write_text(json.dumps(doc), encoding="utf-8")
            errors = module.validate_tree(control_dir, policy_dir)
        self.assertTrue(any("account identifier" in e for e in errors))
        self.assertTrue(any("does not match any risk policy" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
