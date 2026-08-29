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


m0_research_ledger = _load_module("m0_research_ledger")


class M0ResearchLedgerTest(unittest.TestCase):
    def _hypothesis(
        self,
        *,
        report_digest: str = "a" * 64,
        entry_digest: str = "b" * 64,
        hypothesis_id: str = "m0r-semiconductor-1",
        primary_horizon: str = "medium",
    ) -> dict[str, object]:
        return {
            "schema_version": "qsl.m0_research_hypothesis.v1",
            "artifact_type": "research_hypothesis",
            "authority": "research_only",
            "no_order": True,
            "hypothesis_id": hypothesis_id,
            "as_of": "2026-08-20",
            "generated_at": "2026-08-20T12:00:00Z",
            "expires_at": "2026-08-27T12:00:00Z",
            "subject": {"kind": "asset_idea", "identifier": "SOXX"},
            "research_context": {
                "state": "candidate",
                "primary_horizon": primary_horizon,
                "suitable_horizons": [primary_horizon],
                "source_confidence": "high",
                "source_style": "mixed_research",
                "theme_ids": ["semiconductors"],
            },
            "evidence": {
                "source_entry_digest": entry_digest,
                "evidence_ref_count": 3,
                "risk_note_count": 1,
            },
            "provenance": {
                "source_project": "QuantAdvisorResearch",
                "source_schema_version": "6",
                "source_contract_version": "model_recommendations.v6",
                "source_report_digest": report_digest,
                "source_input_digest": "c" * 64,
            },
            "permitted_next_step": "research_validation_only",
        }

    def _snapshot(
        self,
        hypothesis: dict[str, object],
        *,
        source_id: str = "quant-advisor-research",
        data_status: str = "ready",
    ) -> dict[str, object]:
        return {
            "schema_version": "qsl_m0_research_source_snapshot.v1",
            "source_id": source_id,
            "source_report_digest": hypothesis["provenance"]["source_report_digest"],
            "generated_at": "2026-08-20T12:01:00Z",
            "computed_at": "2026-08-20T12:02:00Z",
            "data_status": data_status,
            "hypotheses": [hypothesis],
            "errors": [],
        }

    def test_source_and_ledger_schemas_remain_closed_and_read_only(self):
        source_schema = json.loads(
            (ROOT.parent / "schemas" / "qsl-m0-research-source-snapshot.v1.schema.json").read_text()
        )
        ledger_schema = json.loads((ROOT.parent / "schemas" / "qsl-m0-research-ledger.v1.schema.json").read_text())
        self.assertFalse(source_schema["additionalProperties"])
        self.assertFalse(ledger_schema["additionalProperties"])
        self.assertEqual(source_schema["properties"]["schema_version"]["const"], "qsl_m0_research_source_snapshot.v1")
        self.assertEqual(ledger_schema["properties"]["policy"]["properties"]["no_order"], {"const": True})
        self.assertEqual(
            ledger_schema["properties"]["policy"]["properties"]["permitted_next_step"],
            {"const": "research_validation_only"},
        )

    def test_aggregation_deduplicates_subject_and_source_and_flags_horizon_conflict(self):
        first = self._hypothesis()
        duplicate = copy.deepcopy(first)
        second = self._hypothesis(
            report_digest="d" * 64,
            entry_digest="e" * 64,
            hypothesis_id="m0r-semiconductor-2",
            primary_horizon="long",
        )
        ledger = m0_research_ledger.aggregate_m0_research_sources(
            [
                self._snapshot(first, source_id="quant-advisor-research"),
                self._snapshot(duplicate, source_id="research-mirror"),
                self._snapshot(second, source_id="quant-advisor-research-v2"),
            ],
            now="2026-08-21T12:00:00Z",
        )
        self.assertEqual(ledger["schema_version"], "qsl_m0_research_ledger.v1")
        self.assertEqual(ledger["data_status"], "ready")
        self.assertEqual(ledger["policy"]["authority"], "research_only")
        self.assertTrue(ledger["policy"]["no_order"])
        self.assertEqual(ledger["summary"], {
            "subject_count": 1,
            "observation_count": 2,
            "fresh_observation_count": 2,
            "stale_observation_count": 0,
            "unknown_observation_count": 0,
            "horizon_conflict_count": 1,
        })
        subject = ledger["subjects"][0]
        self.assertEqual(subject["horizon_conflict"], {"status": "conflict", "primary_horizons": ["long", "medium"]})
        self.assertEqual(subject["observations"][0]["source_ids"], ["quant-advisor-research", "research-mirror"])

    def test_expired_or_stale_source_is_visible_but_cannot_become_fresh(self):
        expired = self._snapshot(self._hypothesis(), data_status="ready")
        stale = self._snapshot(
            self._hypothesis(report_digest="d" * 64, entry_digest="e" * 64, hypothesis_id="m0r-stale"),
            data_status="stale",
        )
        ledger = m0_research_ledger.aggregate_m0_research_sources(
            [expired, stale], now="2026-08-28T12:00:00Z"
        )
        self.assertEqual(ledger["data_status"], "stale")
        self.assertEqual(ledger["summary"]["fresh_observation_count"], 0)
        self.assertEqual(ledger["summary"]["stale_observation_count"], 2)
        self.assertEqual(
            {entry["freshness"]["status"] for item in ledger["subjects"] for entry in item["observations"]},
            {"stale"},
        )

    def test_m0_authority_execution_escape_and_source_digest_mismatch_fail_closed(self):
        for mutate, message in (
            (lambda value: value.update(authority="shadow_only"), "authority_invalid"),
            (lambda value: value.update(no_order=False), "no_order_invalid"),
            (lambda value: value["research_context"].update(targetWeight=1), "forbidden_semantic_field"),
        ):
            with self.subTest(mutate=message):
                hypothesis = self._hypothesis()
                mutate(hypothesis)
                with self.assertRaisesRegex(m0_research_ledger.M0ResearchLedgerValidationError, message):
                    m0_research_ledger.validate_m0_research_hypothesis(hypothesis)

        snapshot = self._snapshot(self._hypothesis())
        snapshot["source_report_digest"] = "f" * 64
        with self.assertRaisesRegex(m0_research_ledger.M0ResearchLedgerValidationError, "source_report_digest_mismatch"):
            m0_research_ledger.validate_m0_research_source_snapshot(snapshot)

    def test_same_subject_and_source_with_different_payloads_is_omitted_fail_closed(self):
        first = self._hypothesis()
        collision = self._hypothesis(entry_digest="f" * 64, hypothesis_id="m0r-collision")
        ledger = m0_research_ledger.aggregate_m0_research_sources(
            [
                self._snapshot(first, source_id="quant-advisor-research"),
                self._snapshot(collision, source_id="research-mirror"),
            ],
            now="2026-08-21T12:00:00Z",
        )
        self.assertEqual(ledger["data_status"], "unavailable")
        self.assertEqual(ledger["summary"]["subject_count"], 0)
        self.assertEqual(ledger["errors"], ["m0_source_subject_collision"])


if __name__ == "__main__":
    unittest.main()
