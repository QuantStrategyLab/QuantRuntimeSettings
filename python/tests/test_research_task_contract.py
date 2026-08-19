from __future__ import annotations

import copy
import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def _load_module(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


research_task_contract = _load_module("research_task_contract")


class ResearchTaskContractTest(unittest.TestCase):
    def _task(self) -> dict[str, object]:
        task: dict[str, object] = {
            "schema": "qsl.research_task.v1",
            "task_id": "research.tqqq-core-only.20260819",
            "created_at": "2026-08-19T06:00:00Z",
            "digest_algorithm": "sha256",
            "task_type": "strategy_diagnosis",
            "target": {
                "candidate_id": "tqqq_core_only_p2_v5",
                "candidate_kind": "individual",
                "domain": "us_equity",
                "repository": "QuantStrategyLab/UsEquityStrategies",
                "strategy_revision": "a" * 40,
            },
            "evidence": {
                "p1_input_digest": "b" * 64,
                "p2_config_digest": "c" * 64,
                "p3_evidence_id": "d" * 64,
                "producer_revision": "e" * 40,
            },
            "experiment": {
                "objective": "diagnose_degradation",
                "hypothesis": "Evaluate only the frozen research candidate against its recorded evidence.",
                "parameter_bounds_sha256": None,
                "max_runs": 3,
                "max_wall_seconds": 3600,
            },
            "authority": {
                "research_only": True,
                "no_order": True,
                "size_zero_required": True,
                "p4_p5_p6_authorized": False,
            },
        }
        task["task_sha256"] = research_task_contract.calculate_task_sha256(task)
        return task

    def test_schema_and_validator_accept_only_a_bounded_research_task(self):
        schema = json.loads((ROOT.parent / "schemas" / "qsl-research-task.v1.schema.json").read_text())
        self.assertEqual(schema["$id"], "qsl.research_task.v1")
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(schema["properties"]["authority"]["properties"]["no_order"], {"const": True})
        validated = research_task_contract.validate_research_task(self._task())
        self.assertEqual(validated["task_sha256"], research_task_contract.calculate_task_sha256(validated))
        self.assertEqual(validated["authority"]["p4_p5_p6_authorized"], False)

    def test_execution_secret_or_unknown_material_fails_closed(self):
        for key, value in (
            ("order", {"id": "synthetic"}),
            ("credential", "not-a-secret"),
            ("account_alias", "research"),
            ("unknown", True),
        ):
            with self.subTest(key=key):
                task = self._task()
                task[key] = value
                task["task_sha256"] = research_task_contract.calculate_task_sha256(task)
                with self.assertRaisesRegex(research_task_contract.ResearchTaskValidationError, "invalid fields|forbidden"):
                    research_task_contract.validate_research_task(task)

    def test_authority_digest_and_duplicate_keys_fail_closed(self):
        task = self._task()
        task["authority"] = dict(task["authority"], p4_p5_p6_authorized=True)
        task["task_sha256"] = research_task_contract.calculate_task_sha256(task)
        with self.assertRaisesRegex(research_task_contract.ResearchTaskValidationError, "offline research"):
            research_task_contract.validate_research_task(task)

        task = self._task()
        task["task_sha256"] = "0" * 64
        with self.assertRaisesRegex(research_task_contract.ResearchTaskValidationError, "task_sha256 mismatch"):
            research_task_contract.validate_research_task(task)

        duplicate_json = json.dumps(self._task())[:-1] + ',"task_id":"research.other"}'
        with self.assertRaisesRegex(research_task_contract.ResearchTaskValidationError, "invalid research task JSON"):
            research_task_contract.parse_research_task_json(duplicate_json)


if __name__ == "__main__":
    unittest.main()
