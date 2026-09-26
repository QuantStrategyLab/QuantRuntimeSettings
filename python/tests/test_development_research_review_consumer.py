from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "python" / "scripts" / "development_research_review_consumer.py"
SPEC = importlib.util.spec_from_file_location("development_research_review_consumer", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
consumer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(consumer)


class DevelopmentResearchReviewConsumerTests(unittest.TestCase):
    def setUp(self) -> None:
        configured = os.environ.get("AIAUDITBRIDGE_REVIEW_MESSAGE")
        if not configured:
            self.skipTest("AIAUDITBRIDGE_REVIEW_MESSAGE must point to the actual local producer output")
        self.message_path = Path(configured)
        self.message = json.loads(self.message_path.read_text(encoding="utf-8"))

    def _reseal(self, message: dict) -> dict:
        message.pop("message_sha256", None)
        message["message_sha256"] = hashlib.sha256(
            consumer.canonical_json(message).encode("utf-8")
        ).hexdigest()
        return message

    def _reseal_projection(self, message: dict) -> dict:
        message["result_digest"] = consumer.digest(message["result"])
        message["provenance"]["normalized_result_sha256"] = message["result_digest"]
        message["provenance"]["upstream_input_index_sha256"] = consumer.digest(message["upstream_input_index"])
        message["duplicate_key"] = consumer.digest(consumer._economic_identity(message))
        return self._reseal(message)

    def test_actual_aab_message_projects_to_stable_read_only_state(self) -> None:
        first = consumer.consume_development_research_review(self.message)
        second = consumer.consume_development_research_review(copy.deepcopy(self.message))

        self.assertEqual(first, second)
        self.assertEqual(first["status"], "reviewable")
        self.assertEqual(first["review_disposition"], "advisory")
        self.assertTrue(first["authority"]["no_order"])
        self.assertFalse(first["authority"]["trade"])
        revision = self.message["identities"]["producer_revision_sha256"]
        self.assertRegex(revision, re.compile(r"^[0-9a-f]{64}$"))
        self.assertEqual(first["identities"]["producer_revision_sha256"], revision)
        self.assertEqual(first["provenance"]["source_summary_bytes_sha256"],
                         "7c4a2dcf03c2becb19c012e015f86c5a1f5b6f845afd7d88516a2c515462da91")
        state_body = dict(first)
        state_identity = state_body.pop("state_identity")
        self.assertEqual(state_identity, consumer.digest(state_body))
        self.assertTrue(any(
            value < 0
            for scale in first["result"]["comparisons"].values()
            for comparison in scale.values()
            for value in comparison.values()
        ))

        registry = consumer.DuplicateReviewRegistry()
        self.assertEqual(registry.record(self.message)["status"], "accepted")
        self.assertEqual(registry.record(copy.deepcopy(self.message))["status"], "duplicate")

        changed_revision = copy.deepcopy(self.message)
        changed_revision["identities"]["producer_revision_sha256"] = "a" * 64
        changed_revision["duplicate_key"] = consumer.digest(consumer._economic_identity(changed_revision))
        changed_state = consumer.consume_development_research_review(self._reseal(changed_revision))
        self.assertNotEqual(changed_state["duplicate_key"], first["duplicate_key"])
        self.assertNotEqual(changed_state["state_identity"], first["state_identity"])

    def test_missing_input_and_summary_or_result_digest_conflicts_are_rejected(self) -> None:
        missing = copy.deepcopy(self.message)
        missing["upstream_input_index"].pop()
        missing["provenance"]["upstream_input_index_sha256"] = consumer.digest(missing["upstream_input_index"])
        with self.assertRaisesRegex(consumer.DevelopmentResearchReviewError, "missing_upstream_input"):
            consumer.validate_development_research_review(self._reseal(missing))

        for field, value, expected in (
            ("source_summary_bytes_sha256", "0" * 64, "source_summary_digest_mismatch"),
            ("result_digest", "0" * 64, "result_digest_mismatch"),
        ):
            with self.subTest(field=field):
                changed = copy.deepcopy(self.message)
                if field == "source_summary_bytes_sha256":
                    changed["provenance"][field] = value
                else:
                    changed[field] = value
                with self.assertRaisesRegex(consumer.DevelopmentResearchReviewError, expected):
                    consumer.validate_development_research_review(self._reseal(changed))

    def test_source_assurance_pit_and_authority_cannot_be_upgraded(self) -> None:
        for field, value, expected in (
            ("source_assurance", "cross_provider_verified", "source_assurance_upgrade"),
            ("strict_point_in_time_certified", True, "pit_upgrade"),
        ):
            with self.subTest(field=field):
                changed = copy.deepcopy(self.message)
                changed[field] = value
                with self.assertRaisesRegex(consumer.DevelopmentResearchReviewError, expected):
                    consumer.validate_development_research_review(self._reseal(changed))

        elevated = copy.deepcopy(self.message)
        elevated["authority"]["trade"] = True
        with self.assertRaisesRegex(consumer.DevelopmentResearchReviewError, "permission_upgrade"):
            consumer.validate_development_research_review(self._reseal(elevated))

    def test_forbidden_fields_and_p3_or_old_schema_relabeling_are_rejected(self) -> None:
        for key in ("source_path", "account_alias", "raw_payload", "credential_ref"):
            with self.subTest(key=key):
                changed = copy.deepcopy(self.message)
                changed[key] = "forbidden"
                with self.assertRaises(consumer.DevelopmentResearchReviewError):
                    consumer.validate_development_research_review(self._reseal(changed))

        for schema in ("qsl.research_task.v1", "qsl.research.p3_observation.v1"):
            with self.subTest(schema=schema):
                changed = copy.deepcopy(self.message)
                changed["schema"] = schema
                with self.assertRaisesRegex(consumer.DevelopmentResearchReviewError, "unsupported_review_schema"):
                    consumer.validate_development_research_review(self._reseal(changed))

    def test_duplicate_key_conflict_is_rejected(self) -> None:
        registry = consumer.DuplicateReviewRegistry()
        accepted = registry.record(self.message)
        self.assertEqual(accepted["status"], "accepted")
        changed = copy.deepcopy(self.message)
        changed["result"]["paths"]["1000"]["C0"]["cumulative_return"] += 0.01
        changed["result_digest"] = consumer.digest(changed["result"])
        changed["provenance"]["normalized_result_sha256"] = changed["result_digest"]
        with self.assertRaisesRegex(consumer.DevelopmentResearchReviewError, "result_anchor_mismatch"):
            registry.record(self._reseal(changed))

    def test_resealed_projection_tampering_is_rejected_against_fixed_a_anchors(self) -> None:
        mutations = (
            ("policy_id", lambda m: m["identities"].update(policy_id="forged_policy")),
            ("policy_digest", lambda m: (m["identities"].update(policy_sha256="a" * 64),
                next(i for i in m["upstream_input_index"] if i["name"] == "capital_policy").update(sha256="a" * 64))),
            ("settlement", lambda m: (m["identities"].update(settlement_policy_id="forged_settlement",
                settlement_policy_sha256="b" * 64),
                next(i for i in m["upstream_input_index"] if i["name"] == "settlement_policy").update(sha256="b" * 64))),
            ("runner", lambda m: (m["identities"].update(runner_id="c" * 64),
                next(i for i in m["upstream_input_index"] if i["name"] == "research_runner").update(sha256="c" * 64))),
            ("strategy", lambda m: (m["identities"].update(strategy_revision_sha256="d" * 64),
                next(i for i in m["upstream_input_index"] if i["name"] == "r8_engine").update(sha256="d" * 64))),
            ("input_index", lambda m: next(i for i in m["upstream_input_index"] if i["name"] == "source_manifest").update(sha256="e" * 64)),
            ("result", lambda m: m["result"]["paths"]["1000"]["C0"].update(
                cumulative_return=m["result"]["paths"]["1000"]["C0"]["cumulative_return"] + 0.01)),
        )
        for label, mutation in mutations:
            with self.subTest(label=label):
                forged = copy.deepcopy(self.message)
                mutation(forged)
                self._reseal_projection(forged)
                with self.assertRaises(consumer.DevelopmentResearchReviewError):
                    consumer.validate_development_research_review(forged)


if __name__ == "__main__":
    unittest.main()
