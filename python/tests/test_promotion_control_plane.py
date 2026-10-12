"""Promotion signature, durable single-use ledger and apply readback."""
import base64
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_promotion_manifest as builder
import promotion_ledger as ledger
import promotion_signature as sig
from gcp_kms_policy_gate import calculate_trusted_policy_root_sha256


def _openssl(*args, data=None):
    return subprocess.run(["openssl", *args], input=data, capture_output=True, check=True).stdout


class PromotionSignatureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.key = self.tmp / "key.pem"
        self.key.write_bytes(_openssl("ecparam", "-name", "prime256v1", "-genkey", "-noout"))
        pem = _openssl("ec", "-in", str(self.key), "-pubout").decode()
        now = datetime.now(UTC).replace(microsecond=0)
        root = {
            "schema": "qsl.gcp_kms_policy_root.v1", "root_id": "qsl-longbridgequant-p0-root-v1",
            "created_at": (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "effective_at": (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "expires_at": (now + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "digest_algorithm": "sha256",
            "kms_key_version": "projects/longbridgequant/locations/global/keyRings/qsl-p0-policy-root/cryptoKeys/autonomy-policy-root-v1/cryptoKeyVersions/1",
            "signature_algorithm": "EC_SIGN_P256_SHA256", "public_key_pem": pem,
            "public_key_sha256": hashlib.sha256(pem.encode()).hexdigest(),
        }
        root["trusted_policy_root_sha256"] = calculate_trusted_policy_root_sha256(root)
        (self.tmp / "longbridgequant.json").write_text(json.dumps(root))
        self.pins = {"longbridge": root["trusted_policy_root_sha256"]}
        self.enterContext(patch.object(sig, "ROOTS_DIR", self.tmp))
        self.manifest = builder.build(
            platform="longbridge", target_name="sg", execution_mode="live", strategy_profile="tqqq_growth_income",
            source_revision="a" * 40, artifact_sha256="b" * 64, config_sha256="c" * 64, risk_sha256="d" * 64,
            ttl_hours=6)

    def sign(self, manifest, prefix=sig.PAYLOAD_PREFIX):
        payload = self.tmp / "payload.bin"
        payload.write_bytes(prefix + sig.canonical_promotion_json(manifest).encode())
        der = _openssl("dgst", "-sha256", "-sign", str(self.key), str(payload))
        return base64.b64encode(der).decode()

    def test_valid_signature_verifies(self):
        result = sig.verify(self.manifest, self.sign(self.manifest), platform="longbridge", pinned_roots=self.pins)
        self.assertEqual(result["promotion_sha256"], self.manifest["promotion_sha256"])

    def test_tampered_manifest_or_wrong_domain_fails(self):
        good = self.sign(self.manifest)
        tampered = dict(self.manifest, candidate=dict(self.manifest["candidate"], strategy_profile="other"))
        tampered["promotion_sha256"] = sig.calculate_promotion_sha256(tampered)
        with self.assertRaises(ValueError):
            sig.verify(tampered, good, platform="longbridge", pinned_roots=self.pins)
        with self.assertRaises(ValueError):
            sig.verify(self.manifest, self.sign(self.manifest, prefix=b""), platform="longbridge", pinned_roots=self.pins)

    def test_unpinned_wrong_pin_or_other_platform_fails_closed(self):
        good = self.sign(self.manifest)
        for pins in ({}, {"longbridge": "e" * 64}, {"longbridge": "not-a-digest"}):
            with self.subTest(pins=pins), self.assertRaises(ValueError):
                sig.verify(self.manifest, good, platform="longbridge", pinned_roots=pins)
        with self.assertRaises(ValueError):
            sig.verify(self.manifest, good, platform="ibkr", pinned_roots={"ibkr": "e" * 64})

    def test_bad_signature_encoding_and_long_window_rejected(self):
        for bad in ("", "!!", base64.b64encode(b"x" * 10).decode()):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                sig.verify(self.manifest, bad, platform="longbridge", pinned_roots=self.pins)
        long = dict(self.manifest, expires_at=(datetime.now(UTC) + timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ"))
        long["promotion_sha256"] = sig.calculate_promotion_sha256(long)
        with self.assertRaises(ValueError):
            sig.verify(long, self.sign(long), platform="longbridge", pinned_roots=self.pins)

    def test_envelope_requires_exact_fields(self):
        manifest, signature = sig.unpack_envelope(json.dumps({"promotion_manifest": self.manifest, "kms_signature_b64": "QQ=="}))
        self.assertEqual(manifest, self.manifest)
        for bad in ("[]", json.dumps(self.manifest), json.dumps({"promotion_manifest": self.manifest}),
                    json.dumps({"promotion_manifest": self.manifest, "kms_signature_b64": "QQ==", "x": 1})):
            with self.subTest(bad=bad[:20]), self.assertRaises(ValueError):
                sig.unpack_envelope(bad)

    def test_builder_rejects_overlong_ttl(self):
        with self.assertRaises(ValueError):
            builder.build(platform="longbridge", target_name="sg", execution_mode="live",
                          strategy_profile="tqqq_growth_income", source_revision="a" * 40,
                          artifact_sha256="b" * 64, config_sha256="c" * 64, risk_sha256="d" * 64, ttl_hours=48)


def _response(status, body=None):
    text = f"HTTP/2.0 {status} X\r\nContent-Type: application/json\r\n\r\n" + (json.dumps(body) if body is not None else "")
    return subprocess.CompletedProcess([], 0, stdout=text, stderr="")


PROTECTED = [
    _response(200, [{"id": 7, "enforcement": "active"}]),
    _response(200, {"target": "tag", "bypass_actors": [],
                    "conditions": {"ref_name": {"include": ["refs/tags/qsl-promotion-consumed/**"]}},
                    "rules": [{"type": "deletion"}, {"type": "update"}]}),
]
ARGS = dict(single_use_id="longbridge-sg-0123456789abcdef", promotion_sha256="a" * 64,
            signature_sha256="b" * 64, commit_sha="c" * 40, run_id="123")


class PromotionLedgerTests(unittest.TestCase):
    def run_with(self, responses):
        calls = []

        def fake(command, **kwargs):
            calls.append((command, kwargs.get("input")))
            return responses.pop(0)
        return calls, fake

    def test_consume_creates_tag_once_and_reads_back(self):
        calls, fake = self.run_with([*PROTECTED, _response(404), _response(201, {"sha": "d" * 40}),
                                     _response(201, {}), _response(200, {"object": {"sha": "d" * 40}})])
        result = ledger.consume("o/r", run=fake, **ARGS)
        self.assertEqual(result["consumed"], "true")
        record = json.loads(json.loads(calls[3][1])["message"])
        self.assertEqual(record["promotion_sha256"], "a" * 64)

    def test_already_consumed_or_race_rejected(self):
        _, fake = self.run_with([*PROTECTED, _response(200, {})])
        with self.assertRaisesRegex(ValueError, "already_consumed"):
            ledger.consume("o/r", run=fake, **ARGS)
        _, fake = self.run_with([*PROTECTED, _response(404), _response(201, {"sha": "d" * 40}), _response(422, {})])
        with self.assertRaisesRegex(ValueError, "already_consumed"):
            ledger.consume("o/r", run=fake, **ARGS)

    def test_unprotected_ledger_or_bypass_fails_closed(self):
        for detail in ({"target": "tag", "bypass_actors": [], "conditions": {"ref_name": {"include": ["refs/tags/**"]}},
                        "rules": [{"type": "deletion"}, {"type": "update"}]},
                       {"target": "tag", "bypass_actors": [{"actor_id": 1}],
                        "conditions": {"ref_name": {"include": ["refs/tags/qsl-promotion-consumed/**"]}},
                        "rules": [{"type": "deletion"}, {"type": "update"}]},
                       {"target": "tag", "bypass_actors": [],
                        "conditions": {"ref_name": {"include": ["refs/tags/qsl-promotion-consumed/**"]}},
                        "rules": [{"type": "deletion"}]}):
            _, fake = self.run_with([_response(200, [{"id": 7, "enforcement": "active"}]), _response(200, detail)])
            with self.subTest(detail=detail), self.assertRaisesRegex(ValueError, "protection_missing"):
                ledger.consume("o/r", run=fake, **ARGS)

    def test_unknown_outcomes_and_bad_inputs_fail_closed(self):
        _, fake = self.run_with([*PROTECTED, _response(500)])
        with self.assertRaisesRegex(ValueError, "outcome_unverified"):
            ledger.consume("o/r", run=fake, **ARGS)
        _, fake = self.run_with([*PROTECTED, _response(404), _response(201, {"sha": "d" * 40}),
                                 _response(201, {}), _response(200, {"object": {"sha": "e" * 40}})])
        with self.assertRaisesRegex(ValueError, "readback_unverified"):
            ledger.consume("o/r", run=fake, **ARGS)
        for field, value in (("single_use_id", "../x"), ("promotion_sha256", "x"), ("run_id", "abc")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                ledger.consume("o/r", run=lambda *a, **k: None, **dict(ARGS, **{field: value}))


class WorkflowWiringTests(unittest.TestCase):
    def test_apply_order_is_verify_consume_write_readback(self):
        text = (Path(__file__).resolve().parents[2] / ".github/workflows/manual-strategy-switch.yml").read_text()
        order = ["Verify immutable Promotion Manifest", "Verify Promotion Manifest KMS signature",
                 "Consume single_use_id in the durable ledger", "Apply GitHub variable updates",
                 "Read back applied variables"]
        positions = [text.index(f"- name: {name}") for name in order]
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn("Reject unconnected activation apply", text)
        self.assertIn("trigger_platform_sync remains disabled", text)
        self.assertIn("QSL_PROMOTION_TRUSTED_ROOTS_JSON: ${{ vars.QSL_PROMOTION_TRUSTED_ROOTS_JSON }}", text)


if __name__ == "__main__":
    unittest.main()


class ReadbackTests(unittest.TestCase):
    def test_mismatch_reports_names_only(self):
        import verify_applied_assignments as readback
        from runtime_settings import Assignment
        assignments = [Assignment("longbridge/sg", "o/r", "environment", "longbridge-sg", "A", "1"),
                       Assignment("longbridge/sg", "o/r", "environment", "longbridge-sg", "B", "2")]
        values = {"A": "1\n", "B": "other\n"}

        def fake(command, **kwargs):
            return subprocess.CompletedProcess(command, 0, stdout=values[command[2].rsplit("/", 1)[1]])
        with patch.object(readback, "build_assignments", return_value=assignments):
            self.assertEqual(readback.verify({}, run=fake), ["B"])
