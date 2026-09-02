from __future__ import annotations

import hashlib
import json
import re
import tomllib
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RECEIPT_ROOT = ROOT / "authority" / "receipts"
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
EXPECTED_RECEIPT_SHA256 = {
    "ai-provenance-and-evaluation-v3.json": "5a403948e027db50f0cbf2baa9a9e75abc51198d1475aad38a1c622972b406b1",
    "qsl-dependency-cohort-2026.09.0.json": "ec0e49c503e5ad309e11714f2d994cfecbaf95bd968c1afb80fa27426a1a4a81",
    "tqqq-conservative-research-v1.json": "c0c5020fbe64057b735f987b3bcc490dfe708304b58f01d57cd581344afb44c8",
}


def _load_receipt(name: str) -> dict[str, object]:
    path = RECEIPT_ROOT / name
    raw = path.read_bytes()
    payload = json.loads(raw)
    canonical = (json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()
    if raw != canonical:
        raise AssertionError(f"receipt is not canonical JSON: {path}")
    digest = hashlib.sha256(raw).hexdigest()
    if digest != EXPECTED_RECEIPT_SHA256[name]:
        raise AssertionError(f"receipt bytes changed without an explicit contract update: {path}")
    expected_sidecar = f"{digest}  {path.name}\n"
    if path.with_suffix(path.suffix + ".sha256").read_text() != expected_sidecar:
        raise AssertionError(f"receipt digest sidecar mismatch: {path}")
    return payload


class HumanAuthorityReceiptTest(unittest.TestCase):
    def test_dependency_candidate_receipt_freezes_approved_refs_and_fail_closed_promotion(self) -> None:
        receipt = _load_receipt("qsl-dependency-cohort-2026.09.0.json")

        self.assertEqual(receipt["schema_version"], "qsl.human-authority-receipt.v1")
        self.assertEqual(receipt["authority_role"], "dependency-authority")
        self.assertEqual(receipt["decision"], "CANDIDATE_APPROVED")
        self.assertFalse(receipt["canonical_promotion_authorized"])
        self.assertTrue(receipt["no_live_execution"])
        selected_refs = receipt["selected_refs"]
        self.assertEqual(
            selected_refs,
            {
                "CnEquityStrategies": "aa2af9c56cc6600159a2bf83f2181ef721e14511",
                "CryptoStrategies": "0301b7852f013fb1090497b60dfad6e86801403d",
                "HkEquityStrategies": "6284d95fbf40895cc1b415444d686774f1cfdfb1",
                "MarketSignalSources": "9b3a0d13d29b807ac3fe5de962c37c5e798e322b",
                "QuantPlatformKit": "08eed913248953986224e09ea3a8dd9f5ebedc4e",
                "QuantStrategyPlugins": "a261447bad9bb13525692d41348c98df4f67766c",
                "UsEquityStrategies": "d72fdc9feaa6a9bfe3d91cad240b54c19556d5f1",
            },
        )
        self.assertTrue(all(FULL_SHA.fullmatch(value) for value in selected_refs.values()))
        self.assertEqual(
            receipt["promotion_requires"],
            [
                "all_consumer_pins_converged",
                "all_required_checks_success",
                "qsl_check_all_strict_success",
                "qsl_generate_matrix_check_strict_success",
                "consumer_gate_artifact_digests_recorded",
                "separate_canonical_promotion_receipt",
            ],
        )
        self.assertEqual(
            receipt["prohibited"],
            [
                "main_or_latest_dependency_refs",
                "open_pr_heads_as_authority",
                "lowering_enforce_bundle",
                "provider_or_replay",
                "deployment",
                "paper_or_live_activation",
            ],
        )

    def test_risk_receipt_freezes_conservative_research_only_policy(self) -> None:
        receipt = _load_receipt("tqqq-conservative-research-v1.json")

        self.assertEqual(receipt["authority_role"], "risk-authority")
        self.assertEqual(receipt["decision"], "APPROVE")
        self.assertEqual(receipt["policy_bundle"], "CONSERVATIVE_RESEARCH_V1")
        self.assertEqual(receipt["authority_scope"], "RESEARCH_ONLY")
        self.assertEqual(receipt["allowed_tradable_assets"], ["BOXX", "QQQM", "TQQQ"])
        self.assertEqual(receipt["benchmark_only_assets"], ["QQQ"])
        self.assertEqual(receipt["leverage_factors"], {"BOXX": "1", "QQQM": "1", "TQQQ": "3"})
        self.assertEqual(receipt["total_effective_exposure_cap"], "0.50")
        self.assertEqual(receipt["nominal_product_caps"], {"BOXX": "0.50", "QQQM": "0.50", "TQQQ": "0.15"})
        self.assertEqual(receipt["effective_product_caps"], {"BOXX": "0.50", "QQQM": "0.50", "TQQQ": "0.45"})
        self.assertEqual(receipt["loss_budget_fraction"], "0.01")
        self.assertEqual(receipt["loss_budget_equity_reference"], "completed_session_equity")
        self.assertEqual(
            receipt["drawdown_scalars"],
            [
                {"lower_exclusive": None, "scalar": "1.0", "upper_inclusive": "0.05"},
                {"lower_exclusive": "0.05", "scalar": "0.5", "upper_inclusive": "0.10"},
                {"lower_exclusive": "0.10", "outcome": "PARK", "scalar": "0.0", "upper_inclusive": None},
            ],
        )
        self.assertTrue(receipt["single_consumption"])
        self.assertEqual(receipt["mandate_validity_seconds"], 300)
        self.assertEqual(receipt["snapshot_max_age_seconds"], 300)
        self.assertEqual(receipt["max_nonzero_assets"], 3)
        self.assertEqual(
            receipt["modeled_stress_loss_distance"],
            {"BOXX": "0.05", "QQQM": "0.05", "TQQQ": "0.05"},
        )
        self.assertTrue(receipt["modeled_stress_is_not_stop_order"])
        self.assertEqual(receipt["capital_scope"], "allocated_sleeve")
        self.assertEqual(receipt["valuation_basis"], "allocated_sleeve_ledger")
        self.assertFalse(receipt["fx_conversion_allowed"])
        self.assertEqual(
            receipt["execution_constraints"],
            {
                "no_live": True,
                "no_order": True,
                "no_paper": True,
                "no_promotion_authority": True,
                "no_shadow": True,
            },
        )
        self.assertFalse(receipt["runner_is_authority"])
        self.assertIsNone(receipt["signature"])
        self.assertEqual(
            receipt["prohibited"],
            [
                "runner_or_workflow_self_signature",
                "legacy_p1_p3_mandate_reuse",
                "provider_or_replay_reacquisition",
                "cloud_write",
                "paper_or_live_execution",
            ],
        )

    def test_model_risk_receipt_limits_ai_to_unsigned_offline_evidence(self) -> None:
        receipt = _load_receipt("ai-provenance-and-evaluation-v3.json")

        self.assertEqual(receipt["authority_role"], "model-risk-authority")
        self.assertEqual(receipt["decision"], "APPROVE")
        self.assertEqual(receipt["provenance_schema"], "qsl.ai-artifact-provenance.v3")
        self.assertEqual(receipt["canonical_contract_owner"], "QuantPlatformKit")
        self.assertEqual(receipt["gateway_metadata_owner"], "AIAuditBridge")
        self.assertEqual(receipt["model_risk_owner"], "QuantRuntimeSettings model-risk authority")
        self.assertEqual(
            receipt["immutable_ref_policy"],
            "full_40_char_commit_sha_or_sha256_content_addressed_object_only",
        )
        self.assertEqual(receipt["mutable_refs_forbidden"], ["HEAD", "floating_tag", "latest", "main", "short_sha"])
        self.assertEqual(receipt["missing_closed_label_behavior"], "not_evaluable")
        self.assertEqual(receipt["signature_policy"], "unsigned_integrity_only")
        self.assertIsNone(receipt["signature"])
        self.assertFalse(receipt["signature_verification_enabled"])
        self.assertEqual(receipt["allowed_authority"], ["advisory", "review_evidence", "shadow"])
        self.assertTrue(receipt["review_evidence_is_non_authoritative"])
        self.assertEqual(
            receipt["reason_code_vocabulary"],
            [
                "ai_provenance_authority_forbidden",
                "ai_provenance_digest_mismatch",
                "ai_provenance_lineage_incomplete",
                "ai_provenance_model_unbound",
                "ai_provenance_run_not_succeeded",
                "ai_provenance_schema_invalid",
                "ai_provenance_signature_invalid",
                "ai_provenance_source_untrusted",
                "ai_provenance_time_invalid",
            ],
        )
        self.assertFalse(receipt["provider_network_allowed_in_ci"])
        self.assertFalse(receipt["secret_input_allowed_in_ci"])
        self.assertFalse(receipt["promotion_authority"])
        self.assertFalse(receipt["paper_or_live_authority"])
        self.assertEqual(
            receipt["prohibited"],
            [
                "provider_direct_fallback",
                "raw_provider_output_or_exception_in_logs",
                "ai_generated_order_allocation_or_execution_authority",
                "unsigned_producer_authenticity_claim",
                "paper_or_live_activation",
            ],
        )

    def test_2026_09_0_candidate_matches_dependency_receipt_and_is_not_canonical(self) -> None:
        receipt = _load_receipt("qsl-dependency-cohort-2026.09.0.json")
        candidate_path = ROOT / "authority" / "candidates" / "2026.09.0.toml"
        with candidate_path.open("rb") as handle:
            bundle = tomllib.load(handle)

        self.assertEqual(bundle["name"], "2026.09.0")
        self.assertEqual(bundle["repos"], receipt["selected_refs"])
        self.assertFalse((ROOT / "compat" / "bundles" / "2026.09.0.toml").exists())


if __name__ == "__main__":
    unittest.main()
