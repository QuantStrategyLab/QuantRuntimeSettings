from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def _load_module(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_load_module("m0_research_ledger")
publisher = _load_module("build_m0_research_publisher_envelope")


class _Response:
    def __init__(self, status: int):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def getcode(self):
        return self.status


class M0ResearchPublisherEnvelopeTest(unittest.TestCase):
    def test_schema_declares_the_cross_module_canonical_utf8_body_limit(self):
        schema = json.loads(
            (ROOT.parent / "schemas" / "qsl-m0-research-publisher-envelope.v1.schema.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(schema["x-qsl-canonical-utf8-max-bytes"], 256 * 1024)
        self.assertIn("canonical UTF-8 JSON request body", schema["$comment"])

    def _snapshot(self) -> dict[str, object]:
        return {
            "schema_version": "qsl_m0_research_source_snapshot.v1",
            "source_id": "quant-advisor-research",
            "source_report_digest": "a" * 64,
            "generated_at": "2026-08-20T12:01:00Z",
            "computed_at": "2026-08-20T12:02:00Z",
            "data_status": "ready",
            "hypotheses": [
                {
                    "schema_version": "qsl.m0_research_hypothesis.v1",
                    "artifact_type": "research_hypothesis",
                    "authority": "research_only",
                    "no_order": True,
                    "hypothesis_id": "m0r-semiconductor-1",
                    "as_of": "2026-08-20",
                    "generated_at": "2026-08-20T12:00:00Z",
                    "expires_at": "2026-08-27T12:00:00Z",
                    "subject": {"kind": "asset_idea", "identifier": "SOXX"},
                    "research_context": {
                        "state": "candidate",
                        "primary_horizon": "medium",
                        "suitable_horizons": ["medium"],
                        "source_confidence": "high",
                        "source_style": "mixed_research",
                        "theme_ids": ["semiconductors"],
                    },
                    "evidence": {
                        "source_entry_digest": "b" * 64,
                        "evidence_ref_count": 3,
                        "risk_note_count": 1,
                    },
                    "provenance": {
                        "source_project": "QuantAdvisorResearch",
                        "source_schema_version": "6",
                        "source_contract_version": "model_recommendations.v6",
                        "source_report_digest": "a" * 64,
                        "source_input_digest": "c" * 64,
                    },
                    "permitted_next_step": "research_validation_only",
                }
            ],
            "errors": [],
        }

    def _artifact(self, sha256: str) -> dict[str, str]:
        return publisher.build_source_artifact_metadata(
            repository="QuantStrategyLab/QuantAdvisorResearch",
            revision="d" * 40,
            run_id="123456789",
            artifact_id="m0-source-snapshot",
            sha256=sha256,
        )

    def _arguments(self, source: Path, output: Path, sha256: str) -> list[str]:
        return [
            "--source-snapshot",
            str(source),
            "--output",
            str(output),
            "--source-artifact-repository",
            "QuantStrategyLab/QuantAdvisorResearch",
            "--source-artifact-revision",
            "d" * 40,
            "--source-artifact-run-id",
            "123456789",
            "--source-artifact-id",
            "m0-source-snapshot",
            "--source-artifact-sha256",
            sha256,
            "--producer-repository",
            "QuantStrategyLab/QuantRuntimeSettings",
            "--producer-revision",
            "e" * 40,
            "--now",
            "2026-08-21T12:00:00Z",
        ]

    def test_build_is_deterministic_hash_bound_and_research_only(self):
        source = self._snapshot()
        artifact = self._artifact("f" * 64)
        first = publisher.build_m0_research_publisher_envelope(
            source_snapshot=source,
            source_artifact=artifact,
            producer_repository="QuantStrategyLab/QuantRuntimeSettings",
            producer_revision="e" * 40,
            now="2026-08-21T12:00:00Z",
        )
        second = publisher.build_m0_research_publisher_envelope(
            source_snapshot=json.loads(json.dumps(source)),
            source_artifact=dict(reversed(artifact.items())),
            producer_repository="QuantStrategyLab/QuantRuntimeSettings",
            producer_revision="e" * 40,
            now="2026-08-21T12:00:00Z",
        )
        self.assertEqual(publisher.canonical_json(first), publisher.canonical_json(second))
        self.assertEqual(first["schema_version"], "qsl_m0_research_publisher_envelope.v1")
        self.assertEqual(first["ledger"]["generated_at"], "2026-08-21T12:00:00Z")
        self.assertEqual(first["ledger"]["computed_at"], "2026-08-21T12:00:00Z")
        self.assertEqual(first["ledger"]["policy"]["authority"], "research_only")
        self.assertTrue(first["ledger"]["policy"]["no_order"])
        self.assertEqual(first["ledger_sha256"], publisher.calculate_ledger_sha256(first["ledger"]))
        self.assertEqual(publisher.validate_m0_research_publisher_envelope(first), first)
        self.assertLessEqual(
            len(publisher.canonical_envelope_body(first)),
            publisher.MAX_PUBLISHER_ENVELOPE_BYTES,
        )

    def test_builder_fails_closed_when_actual_utf8_envelope_body_exceeds_worker_ingress_limit(self):
        oversized = self._snapshot()
        hypotheses = []
        for index in range(500):
            hypothesis = json.loads(json.dumps(oversized["hypotheses"][0]))
            hypothesis["hypothesis_id"] = f"m0r-large-{index:03d}"
            hypothesis["subject"]["identifier"] = f"SOXX-{index:03d}"
            hypotheses.append(hypothesis)
        oversized["hypotheses"] = hypotheses
        with self.assertRaisesRegex(publisher.M0ResearchPublisherEnvelopeError, "publisher_envelope_size_exceeded"):
            publisher.build_m0_research_publisher_envelope(
                source_snapshot=oversized,
                source_artifact=self._artifact("f" * 64),
                producer_repository="QuantStrategyLab/QuantRuntimeSettings",
                producer_revision="e" * 40,
                now="2026-08-21T12:00:00Z",
            )

    def test_envelope_validation_rejects_digest_or_execution_policy_tampering(self):
        envelope = publisher.build_m0_research_publisher_envelope(
            source_snapshot=self._snapshot(),
            source_artifact=self._artifact("f" * 64),
            producer_repository="QuantStrategyLab/QuantRuntimeSettings",
            producer_revision="e" * 40,
            now="2026-08-21T12:00:00Z",
        )
        tampered_digest = json.loads(json.dumps(envelope))
        tampered_digest["ledger_sha256"] = "0" * 64
        with self.assertRaisesRegex(publisher.M0ResearchPublisherEnvelopeError, "ledger_sha256_mismatch"):
            publisher.validate_m0_research_publisher_envelope(tampered_digest)

        tampered_policy = json.loads(json.dumps(envelope))
        tampered_policy["ledger"]["policy"]["no_order"] = False
        with self.assertRaisesRegex(publisher.M0ResearchPublisherEnvelopeError, "ledger_policy_invalid"):
            publisher.validate_m0_research_publisher_envelope(tampered_policy)

    def test_cli_default_is_local_only_and_binds_the_exact_source_bytes(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.json"
            output = root / "envelope.json"
            raw = json.dumps(self._snapshot(), ensure_ascii=False, indent=2).encode("utf-8")
            source.write_bytes(raw)
            sha256 = hashlib.sha256(raw).hexdigest()
            with patch.object(publisher.urllib.request, "urlopen", side_effect=AssertionError("network called")):
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(publisher.main(self._arguments(source, output, sha256)), 0)
            envelope = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(envelope["source_artifact"]["sha256"], sha256)
            self.assertEqual(envelope["ledger_sha256"], publisher.calculate_ledger_sha256(envelope["ledger"]))
            self.assertEqual(output.read_bytes(), publisher.canonical_envelope_body(envelope) + b"\n")

            missing_output = root / "missing.json"
            with self.assertRaisesRegex(publisher.M0ResearchPublisherEnvelopeError, "source_artifact_sha256_mismatch"):
                publisher.main(self._arguments(source, missing_output, "0" * 64))
            self.assertFalse(missing_output.exists())

    def test_cli_oversize_fails_before_any_write_or_opt_in_publish(self):
        oversized = self._snapshot()
        hypotheses = []
        for index in range(500):
            hypothesis = json.loads(json.dumps(oversized["hypotheses"][0]))
            hypothesis["hypothesis_id"] = f"m0r-large-{index:03d}"
            hypothesis["subject"]["identifier"] = f"SOXX-{index:03d}"
            hypotheses.append(hypothesis)
        oversized["hypotheses"] = hypotheses
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "oversized-source.json"
            output = root / "must-not-exist.json"
            raw = json.dumps(oversized, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            source.write_bytes(raw)
            arguments = self._arguments(source, output, hashlib.sha256(raw).hexdigest()) + ["--publish"]
            with patch.object(publisher.urllib.request, "urlopen", side_effect=AssertionError("network called")):
                with self.assertRaisesRegex(
                    publisher.M0ResearchPublisherEnvelopeError,
                    "publisher_envelope_size_exceeded",
                ):
                    publisher.main(arguments)
            self.assertFalse(output.exists())

    def test_publish_requires_dedicated_environment_and_never_serializes_token(self):
        envelope = publisher.build_m0_research_publisher_envelope(
            source_snapshot=self._snapshot(),
            source_artifact=self._artifact("f" * 64),
            producer_repository="QuantStrategyLab/QuantRuntimeSettings",
            producer_revision="e" * 40,
            now="2026-08-21T12:00:00Z",
        )
        with self.assertRaisesRegex(publisher.M0ResearchPublisherEnvelopeError, "m0_publish_environment_missing"):
            publisher.publish_m0_research_publisher_envelope(envelope, environ={})

        secret = "dedicated-publisher-token"
        captured = []

        def fake_urlopen(request, timeout):
            captured.append((request, timeout))
            return _Response(202)

        with patch.object(publisher.urllib.request, "urlopen", side_effect=fake_urlopen):
            publisher.publish_m0_research_publisher_envelope(
                envelope,
                environ={
                    publisher.PUBLISH_URL_ENV: "https://research-console.example/api/internal/m0",
                    publisher.PUBLISH_TOKEN_ENV: secret,
                    "BROKER_API_TOKEN": "must-not-be-read",
                },
            )
        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0][1], 15)
        self.assertNotIn(secret, publisher.canonical_json(envelope))
        self.assertNotIn("BROKER_API_TOKEN", publisher.canonical_json(envelope))

        with self.assertRaisesRegex(publisher.M0ResearchPublisherEnvelopeError, "m0_publish_url_invalid"):
            publisher.publish_m0_research_publisher_envelope(
                envelope,
                environ={
                    publisher.PUBLISH_URL_ENV: "https://research-console.example/api?token=not-allowed",
                    publisher.PUBLISH_TOKEN_ENV: secret,
                },
            )


if __name__ == "__main__":
    unittest.main()
